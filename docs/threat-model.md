# Threat Model

## Attacker Profiles

### Script Kiddie
**Resources:** Single machine, basic scripting
**Capability:** Spawn a few fake nodes, replay captured messages
**Goal:** Disrupt or observe

### Organized Attacker
**Resources:** Cloud infrastructure, development team
**Capability:** Spawn hundreds of nodes, coordinate timing, analyze protocol
**Goal:** Shift consensus, poison learning, extract value

### Nation-State
**Resources:** Unlimited compute, zero-day capabilities
**Capability:** Full network observation, targeted node compromise
**Goal:** Strategic manipulation of belief systems

## Mitigation Mapping

Each attack vector maps to specific code that defends against it:

| Attack | Mitigation | File | Function/Class |
|--------|------------|------|----------------|
| Sybil (fresh identities) | Progressive trust | `security/reputation.ts` | `ReputationSystem.getInfluence()` |
| Sybil (voting) | Reputation-weighted tally | `arbitration.ts` | `Arbitration.resolve()` |
| Coordinated poisoning | Entropy detection | `conflict.ts` | `ConflictAccumulator.computeScore()` |
| Coordinated poisoning | Checkpoint verification | `checkpoint.ts` | `Checkpoints.requestCheckpoint()` |
| Eclipse (isolation) | Peer exchange gossip | `membership.ts` | `Membership.onWire()` PEER_LIST handler |
| Eclipse (stale beliefs) | T-state degradation | `authority/tstate.ts` | `TStateManager.degrade()` |
| Replay | Monotonic signal IDs | `propagation.ts` | `Propagation.onIncoming()` |
| Replay | Seen-set deduplication | `propagation.ts` | `Propagation.markSeen()` |
| Replay | Hash-chained audit | `audit/log.ts` | `AuditLog.append()` |
| Authority abuse | Time-bounded windows | `authority/manager.ts` | `AuthorityManager.checkExpiration()` |
| Authority abuse | Drift detection | `authority/drift.ts` | `DriftDetector.check()` |
| Authority abuse | Automatic revocation | `authority/manager.ts` | `AuthorityManager.revoke()` |
| Misbehavior | Quarantine isolation | `security/quarantine.ts` | `QuarantineSystem.quarantine()` |
| DoS (peer flood) | Bounded peer set | `membership.ts` | `Membership.boundPeers()` |
| DoS (signal flood) | TTL limiting | `propagation.ts` | TTL check in `onIncoming()` |
| DoS (memory) | Seen-set bounds | `propagation.ts` | `maxSeenSignals` config |

### Verification Points

To audit the implementation against the threat model:

1. **Sybil resistance:** Trace `newPeerInfluence` config through `ReputationSystem` to `Arbitration.resolve()`
2. **Conflict detection:** Verify `computeScore()` uses entropy, not simple majority
3. **Drift detection:** Check all four drift types trigger in `DriftDetector.check()`
4. **Audit integrity:** Verify `AuditLog.append()` computes hash over previous entry

---

## Attack Vectors

### 1. Sybil Attack

**Description:** Create many fake identities to dominate voting and poison learning.

**Attack Flow:**
1. Attacker spawns N nodes with fresh Ed25519 identities
2. Nodes join swarm, appear legitimate
3. Coordinate to vote same way in arbitration
4. Attempt to outvote honest nodes

**Defense: Progressive Trust**

New nodes start with 0.1 influence. Reputation grows slowly:
- +0.05 accuracy per successful signal propagation
- +0.02 consistency per tick of stable behavior
- Age factor normalized over 100 ticks

**Math:**
```
Attacker spawns 100 nodes
Total attacker influence: 100 × 0.1 = 10

Honest swarm has 10 established nodes at 0.8 reputation
Total honest influence: 10 × 0.8 = 8

To guarantee win, attacker needs: 8 / 0.1 = 80 nodes
But these are NEW nodes, so actually need to maintain them
long enough to accrue reputation, which honest nodes will
also be doing during that time.
```

**Residual Risk:** Patient attacker can slowly build reputation over time. Mitigation: external admission control (proof-of-work, stake, identity verification).

### 2. Coordinated Poisoning

**Description:** Multiple colluding nodes inject signals that are individually plausible but collectively shift meaning.

**Attack Flow:**
1. Attackers agree on target claim
2. Each sends slightly-off signals that pass signature verification
3. Aggregate effect: belief drifts from true meaning

**Defense: Conflict Detection**

Entropy-based scoring identifies sustained disagreement:
```
Score = entropy(stance_distribution) / max_entropy
```

When score exceeds threshold (default 0.6):
1. Conflict flagged
2. Checkpoint taken
3. Arbitration triggered

**Defense: Checkpoint Protocol**

Any node can request peer stances:
```typescript
node.requestCheckpoint(claimHash);
// Receives CHECKPOINT_RESP from all peers
// Feeds into conflict accumulator
```

Reveals divergence that gradual poisoning tries to hide.

**Residual Risk:** If attackers control >50% of reputation-weighted influence, they can win arbitration. Mitigation: diversity requirements, geographic distribution.

### 3. Eclipse Attack

**Description:** Isolate a target node by controlling all its connections.

**Attack Flow:**
1. Attacker identifies target node
2. Floods target with connection requests from controlled nodes
3. Legitimate peers get pushed out of bounded peer set
4. Target now sees only attacker-controlled view of swarm

**Defense: Peer Exchange Gossip**

Nodes periodically broadcast known peers:
```typescript
{ type: 'PEER_LIST', peers: ['a1f2b3c4d5e6', 'b2c3d4e5f6a7', 'c3d4e5f6a7b8'] }
```

Target receives peer lists from (potentially honest) nodes, learns about peers outside attacker's control.

**Defense: T-State Degradation**

If communications become stale (no heartbeats from diverse sources), T-state degrades:
- T1: Authority shrinks 30%
- T2: No new authority grants
- T3: Minimal authority (10%)

Degraded node can't act on potentially-manipulated beliefs.

**Defense: Recontact Protocol (T4)**

When communications restore:
1. Node enters T4 (recontact)
2. Belief histories merged with peers
3. Conflicts identified and resolved
4. T-state returns to T0

**Residual Risk:** Target may make bad decisions during eclipse before T-state degrades. Mitigation: faster degradation thresholds for high-value nodes.

### 4. Replay Attack

**Description:** Re-send old valid messages to revert state or cause confusion.

**Attack Flow:**
1. Attacker captures valid LEARNING_SIGNAL
2. Waits for belief to change
3. Replays old signal to revert

**Defense: Monotonic Signal IDs**

Each signal has `signal_id` that must be monotonically increasing per `source_id`. Replayed signals fail:
```typescript
if (signal.signal_id <= lastSeenId[signal.source_id]) {
  reject();
}
```

**Defense: Seen-Set Deduplication**

Signals are hashed and tracked:
```typescript
const key = hash(source_id + signal_id + payload);
if (seen.has(key)) return; // Drop duplicate
seen.add(key);
```

**Defense: Hash-Chained Audit**

Log entries form a hash chain:
```typescript
entry.hash = sha256(entry.i + entry.ts + entry.data + entry.prev);
```

Tampering breaks the chain, detected on verification.

**Residual Risk:** If attacker controls significant portion of swarm, they can collectively "forget" they saw a signal. Mitigation: external anchoring (e.g., periodic merkle root to blockchain).

### 5. Authority Abuse

**Description:** Request authority, then act outside sanctioned bounds.

**Attack Flow:**
1. Node requests authority for scope X
2. Authority granted
3. Node acts outside scope X or beyond expiration
4. Attempts to claim actions were authorized

**Defense: Time-Bounded Windows**

Authority expires automatically:
```typescript
interface AuthorityWindow {
  expiresAt: number;  // Hard deadline
  scope: string;      // What's authorized
}
```

Any action must be validated against window before execution.

**Defense: Drift Detection**

Four types of drift trigger automatic revocation:

| Type | Trigger |
|------|---------|
| HOLD_TOO_LONG | Node stuck >3s |
| BELIEF_DIVERGENCE | Entropy >0.6 vs consensus |
| CONFIDENCE_DECAY | Self-reported confidence <0.3 |
| STALE_COMMS | No heartbeat >5s |

**Defense: Quarantine**

Revoked nodes enter quarantine:
- Influence = 0
- Can receive but not propagate signals
- Duration doubles on repeat offenses

**Residual Risk:** Malicious actions during valid authority window. Mitigation: shorter windows, tighter drift thresholds, human-in-loop for high-stakes decisions.

### 6. Denial of Service

**Description:** Overwhelm nodes with traffic to prevent legitimate operation.

**Attack Flow:**
1. Flood target with HELLO, HEARTBEAT, or LEARNING_SIGNAL
2. Target exhausts resources processing
3. Legitimate messages dropped or delayed

**Defense: Bounded Peer Set**

```typescript
maxPeers: 32  // Won't track more than this
```

Excess peers are dropped (oldest first).

**Defense: TTL Limiting**

```typescript
defaultTtl: 8  // Signals die after 8 hops
```

Amplification attacks limited by TTL decay.

**Defense: Seen-Set Bounds**

```typescript
maxSeenSignals: 50_000  // Evict old entries
```

Memory bounded even under flood.

**Residual Risk:** Sophisticated attacker can still degrade performance. Mitigation: rate limiting at transport layer, proof-of-work for expensive operations.

## Security Guarantees

### What We Guarantee

1. **Bounded Influence**
   - No single peer can exceed 1.0 influence
   - New peers start at 0.1
   - Quarantined peers have 0 influence
   - Math is verifiable

2. **Detectable Divergence**
   - Entropy scoring surfaces disagreement
   - Checkpoint protocol reveals hidden divergence
   - Audit trail enables post-hoc analysis

3. **Recoverable State**
   - Rollback log maintains bounded history
   - Arbitration triggers automatic checkpoints
   - T4 reconciliation merges divergent histories

4. **Auditable History**
   - Hash-chained log entries
   - Provenance queries for any claim
   - Deterministic replay from log

### What We Do NOT Guarantee

1. **Byzantine Fault Tolerance**
   - This is NOT a BFT consensus protocol
   - >50% malicious (reputation-weighted) can shift consensus
   - Trade-off: much lower latency and complexity than BFT

2. **Real-Time Convergence**
   - Eventual consistency, not strong consistency
   - Conflicts may persist during arbitration
   - T-state degradation intentionally slows coordination

3. **Perfect Sybil Resistance**
   - Progressive trust slows but doesn't prevent determined attackers
   - Given infinite resources and time, attacker wins
   - For strong guarantees, add external admission control

4. **Privacy**
   - Beliefs propagate in cleartext
   - Audit logs are comprehensive
   - For privacy, add encryption at application layer

## Comparison to Alternatives

| Property | Epistemic Swarm | PBFT | Raft | CRDTs | Min-Cut Only |
|----------|----------------|------|------|-------|--------------|
| Latency | Low | High | Medium | Low | Low |
| Throughput | High | Low | Medium | High | High |
| Byzantine Tolerance | Partial | 33% | 0% | 0% | 0% |
| Semantic Awareness | ✓ | ✗ | ✗ | ✗ | ✗ |
| Drift Detection | ✓ | ✗ | ✗ | ✗ | Structural |
| Progressive Trust | ✓ | ✗ | ✗ | ✗ | ✗ |
| Works in Browser | ✓ | ✗ | ✗ | ✓ | ✓ |

**Key differentiator:** Min-cut detects when the graph fragments. We detect when nodes agree structurally but diverge semantically. These are different failure modes requiring different detection.

## Recommendations

### For Deployers

1. **Add External Admission Control**
   - Proof-of-work for resource commitment
   - Proof-of-personhood for human verification
   - Stake for economic alignment
   - Don't rely solely on progressive trust for high-stakes applications

2. **Monitor Conflict Levels**
   - High sustained conflict indicates attack or misconfiguration
   - Set up alerts for entropy spikes
   - Investigate claims with conflictScore > 0.5

3. **Audit Log Analysis**
   - Regularly verify chain integrity
   - Look for anomalous patterns:
     - Many signals from few sources
     - Coordinated timing
     - Unusual claim_hash distribution

4. **Configure Thresholds**
   - Tighter thresholds = faster detection, more false positives
   - Tune for your risk tolerance
   - Consider different thresholds for different claim domains

### For Operators

1. **Authority Window Duration**
   - Shorter windows = more frequent re-authorization = more overhead
   - Longer windows = more exposure to drift
   - Default 60s is reasonable for most applications

2. **Understand T-State Transitions**
   - T0 → T1: Some degradation, still functional
   - T1 → T2: Significant degradation, no new grants
   - T2 → T3: Extended outage, minimal authority
   - T3 → T4: Recontact, reconciliation mode
   - T4 → T0: Normal operations restored

3. **Pattern Bundle Review**
   - Periodically review adopted bundles
   - Reject bundles from low-reputation sources
   - Consider manual approval for high-impact patterns
