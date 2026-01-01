# Protocol Specification

## Why Primitives Are Insufficient

Vector databases give you search. Graph databases give you relationships. CRDTs give you eventual consistency. Transport libraries give you message delivery.

None of them answer: **what happens when nodes disagree about meaning?**

Consider a swarm where:
- Node A believes claim X should be strengthened
- Node B believes claim X should be weakened
- Both have valid signatures, both are connected, both are "working correctly"

What resolves this? In most systems: nothing. Or last-write-wins. Or majority-at-query-time. All of which fail under adversarial conditions.

The primitives work. The coordination doesn't exist.

This protocol exists to specify the minimum coordination layer that sits above primitives and below applications. It is not optional. Without it, "distributed learning" is a marketing term, not an architecture.

---

## Conventions

This specification uses RFC 2119 keywords:
- **MUST** / **MUST NOT**: Absolute requirements
- **SHOULD** / **SHOULD NOT**: Recommended unless good reason exists
- **MAY**: Optional

Sections marked *"Non-normative"* are explanatory and do not define requirements.

---

## Overview

The Epistemic Swarm Protocol enables distributed coordination between browser-based or edge nodes while maintaining semantic coherence without central authority.

## Wire Format

All messages are JSON objects with a common envelope:

```typescript
interface WireMessage {
  type: string;       // Message type identifier
  from: PeerId;       // Ed25519 public key hex (sender)
  ts: number;         // Unix timestamp ms (send time)
  // Additional fields vary by message type (see below)
}
```

### Message Schema Summary

All message types with their required and optional fields:

| Type | Required Fields | Optional Fields | Phase |
|------|-----------------|-----------------|-------|
| `HELLO` | `type`, `from`, `ts` | `tState`, `knownPeers` | 1 |
| `HEARTBEAT` | `type`, `from`, `ts` | `tState`, `confidence` | 1 |
| `PEER_LIST` | `type`, `from`, `ts`, `peers` | | 1 |
| `LEARNING_SIGNAL` | `type`, `from`, `ts`, `signal` | | 2 |
| `CHECKPOINT_REQ` | `type`, `from`, `ts`, `claimHash` | | 3 |
| `CHECKPOINT_RESP` | `type`, `from`, `ts`, `claimHash`, `stance`, `confidence` | `meaning` | 3 |
| `ARBITRATION_PROPOSAL` | `type`, `from`, `ts`, `proposalId`, `claimHash`, `options` | | 3 |
| `ARBITRATION_VOTE` | `type`, `from`, `ts`, `proposalId`, `option`, `weight` | | 3 |
| `AUTHORITY_REQUEST` | `type`, `from`, `ts`, `requestId`, `scope`, `reason` | | 4* |
| `AUTHORITY_GRANT` | `type`, `from`, `ts`, `requestId`, `window` | | 4* |
| `AUTHORITY_DENY` | `type`, `from`, `ts`, `requestId`, `reason` | | 4* |
| `AUTHORITY_REVOKE` | `type`, `from`, `ts`, `windowId`, `reason` | | 4* |
| `PATTERN_BUNDLE` | `type`, `from`, `ts`, `bundle` | | 4* |
| `QUARANTINE_NOTICE` | `type`, `from`, `ts`, `targetPeer`, `reason` | | 4* |

*Phase 4 messages are defined for completeness; distributed negotiation is an extension point.

Implementations MUST include all required fields. Implementations MUST ignore unknown fields (forward compatibility). Implementations SHOULD include optional fields when available.

## Message Types

### Phase 1: Discovery & Membership

Implementations MUST support HELLO, HEARTBEAT, and PEER_LIST messages. Implementations MUST track peer liveness based on heartbeat timestamps. Implementations SHOULD bound the peer set to prevent resource exhaustion.

#### HELLO
Sent on initial connection to announce presence.

```typescript
{
  type: 'HELLO',
  from: PeerId,
  ts: number,
  tState?: TState,        // Current degradation level
  knownPeers?: PeerId[]   // Bootstrap hint
}
```

#### HEARTBEAT
Periodic liveness signal.

```typescript
{
  type: 'HEARTBEAT',
  from: PeerId,
  ts: number,
  tState?: TState,
  confidence?: number     // 0.0-1.0 self-assessed
}
```

#### PEER_LIST
Gossip protocol for topology discovery.

```typescript
{
  type: 'PEER_LIST',
  from: PeerId,
  ts: number,
  peers: PeerId[]         // Known alive peers
}
```

### Phase 2: Learning Propagation

Implementations MUST verify Ed25519 signatures before accepting signals. Implementations MUST NOT propagate signals with invalid signatures. Implementations MUST decrement TTL on forwarding and MUST NOT forward signals with TTL ≤ 0. Implementations SHOULD deduplicate signals to prevent amplification.

#### LEARNING_SIGNAL
Carries belief updates across the swarm.

```typescript
{
  type: 'LEARNING_SIGNAL',
  from: PeerId,
  ts: number,
  signal: LearningSignal
}

interface LearningSignal {
  source_id: string;      // Original author (Ed25519 pubkey)
  signal_id: string;      // Monotonic ID from source
  timestamp: number;      // Creation time
  domain: string;         // Semantic domain
  signal_type: 'delta' | 'correction' | 'deprecation';
  payload: {
    claim_hash: string;
    direction: 'strengthen' | 'weaken' | 'retract';
    confidence: number;
    evidence_hash?: string;
  };
  ttl: number;            // Remaining hops (decremented on forward)
  scope: 'local' | 'cluster' | 'global';
  signature: string;      // Ed25519 signature over canonical form
  prior_signal?: string;  // For corrections/deprecations
}
```

**Signature Computation:**

Implementations MUST compute signatures as follows:

```typescript
const canonical = JSON.stringify({
  source_id, signal_id, timestamp, domain, 
  signal_type, payload, ttl, scope, prior_signal
});
const signature = ed25519.sign(sha256(canonical), privateKey);
```

Implementations MUST reject signals with invalid signatures. Implementations MUST NOT propagate unsigned or invalid signals.

### Phase 3: Conflict Resolution

Implementations MUST respond to CHECKPOINT_REQ with current belief state. Implementations MUST compute conflict scores using entropy-based methods (simple majority is insufficient). Implementations MUST weight arbitration votes by reputation, not count.

#### CHECKPOINT_REQ
Request peer stance on a claim.

```typescript
{
  type: 'CHECKPOINT_REQ',
  from: PeerId,
  ts: number,
  claimHash: string
}
```

#### CHECKPOINT_RESP
Response with current belief.

```typescript
{
  type: 'CHECKPOINT_RESP',
  from: PeerId,
  ts: number,
  claimHash: string,
  meaning: string,        // Human-readable (optional)
  stance: Stance,
  confidence: number
}
```

#### ARBITRATION_PROPOSAL
Initiate voting on conflicted claim.

```typescript
{
  type: 'ARBITRATION_PROPOSAL',
  from: PeerId,
  ts: number,
  proposalId: string,
  claimHash: string,
  options: string[]       // e.g., ['strengthen', 'weaken', 'retract']
}
```

#### ARBITRATION_VOTE
Cast reputation-weighted ballot.

```typescript
{
  type: 'ARBITRATION_VOTE',
  from: PeerId,
  ts: number,
  proposalId: string,
  option: string,
  weight: number          // Voter's influence at vote time
}
```

### Phase 4: Authority Management

*Implementation note: Phase 4 messages are defined for completeness. This implementation includes local enforcement (T-state tracking, authority windows, drift detection, automatic revocation). Distributed authority negotiation (cross-node grant/deny coordination) is an extension point; the current implementation uses local grants via `node.grantAuthority()`.*

#### AUTHORITY_REQUEST
Request time-bounded authority.

```typescript
{
  type: 'AUTHORITY_REQUEST',
  from: PeerId,
  ts: number,
  requestId: string,
  scope: string,          // Domain of requested authority
  reason: string
}
```

#### AUTHORITY_GRANT
Grant authority with window.

```typescript
{
  type: 'AUTHORITY_GRANT',
  from: PeerId,
  ts: number,
  requestId: string,
  window: AuthorityWindow
}

interface AuthorityWindow {
  id: string;
  peerId: PeerId;
  grantedAt: number;
  expiresAt: number;
  tStateAtGrant: TState;
  scope: string;
  conditions?: Record<string, unknown>;
}
```

#### AUTHORITY_DENY
Reject authority request.

```typescript
{
  type: 'AUTHORITY_DENY',
  from: PeerId,
  ts: number,
  requestId: string,
  reason: string
}
```

#### AUTHORITY_REVOKE
Revoke granted authority (typically due to drift).

```typescript
{
  type: 'AUTHORITY_REVOKE',
  from: PeerId,
  ts: number,
  windowId: string,
  reason: DriftReason
}
```

#### PATTERN_BUNDLE
Share learned behavior pattern.

```typescript
{
  type: 'PATTERN_BUNDLE',
  from: PeerId,
  ts: number,
  bundle: PatternBundle
}

interface PatternBundle {
  id: string;
  generatedAt: number;
  generatedBy: PeerId;
  context: {
    tState: TState;
    peerCount: number;
    conflictLevel: number;
  };
  pattern: {
    claimHashes: string[];
    stances: Record<string, Stance>;
    confidence: number;
  };
  performance: {
    successRate: number;
    adoptions: number;
  };
  authorityContext: {
    tState: TState;
    scopeHash: string;
  };
  status: 'local' | 'propagating' | 'adopted' | 'rejected';
}
```

#### QUARANTINE_NOTICE
Announce peer isolation.

```typescript
{
  type: 'QUARANTINE_NOTICE',
  from: PeerId,
  ts: number,
  targetPeer: PeerId,
  reason: DriftReason
}
```

## Enumerations

### TState

```typescript
enum TState {
  T0 = 'full_comms',
  T1 = 'partial_degradation',
  T2 = 'comms_loss',
  T3 = 'extended_loss',
  T4 = 'recontact'
}
```

### DriftReason

```typescript
enum DriftReason {
  HOLD_TOO_LONG = 'hold_too_long',
  BELIEF_DIVERGENCE = 'belief_divergence',
  CONFIDENCE_DECAY = 'confidence_decay',
  STALE_COMMS = 'stale_comms',
  QUARANTINED = 'quarantined'
}
```

### Stance

```typescript
type Stance = 'strengthen' | 'weaken' | 'retract' | 'unknown';
```

## Disagreement Taxonomy

Not all disagreements are equivalent. This section categorizes types to prevent collapsing governance into "just voting."

### Epistemic Disagreement
Nodes hold different beliefs about the same claim.

**Example:** Node A believes claim X should be strengthened; Node B believes it should be weakened.

**Detection:** Entropy scoring on stance distribution.

**Resolution:** Arbitration with reputation-weighted voting.

**Implementation:** `conflict.ts`, `arbitration.ts`

### Procedural Disagreement
Nodes disagree about process, not content.

**Example:** Node A believes arbitration should trigger; Node B believes threshold not met.

**Detection:** Conflicting ARBITRATION_PROPOSAL messages for same claim.

**Resolution:** Protocol defaults (threshold is objective, defined in config).

**Implementation:** `conflictThreshold` in config, `ConflictAccumulator.computeScore()`

### Temporal Disagreement
Nodes hold beliefs from different points in time.

**Example:** Node A has current belief; Node B has stale belief from before partition.

**Detection:** T-state degradation (STALE_COMMS drift), signal timestamps.

**Resolution:** T4 reconciliation on recontact; newer timestamps win with same confidence.

**Implementation:** `authority/tstate.ts`, `beliefs.ts` resolution logic

### Scope Disagreement
Nodes disagree about authority boundaries.

**Example:** Node A believes it has authority for action X; Node B believes X is outside A's granted scope.

**Detection:** Authority window inspection, scope string comparison.

**Resolution:** Authority is explicit; scope is a string that either matches or doesn't.

**Implementation:** `authority/manager.ts`, `AuthorityWindow.scope`

---

*This taxonomy is intentionally minimal. The current implementation focuses on epistemic disagreement (the hardest case). Procedural, temporal, and scope disagreements have more mechanical resolutions.*

---

## Disagreement Taxonomy

*Non-normative: This section classifies types of disagreement the protocol can detect and resolve. Current implementation handles epistemic disagreement. Other types are noted for implementers extending the protocol.*

Disagreement in distributed systems is not monolithic. Different types require different resolution strategies:

| Type | Definition | Detection | Resolution |
|------|------------|-----------|------------|
| **Epistemic** | Nodes disagree about truth of a claim | Entropy scoring on stance distribution | Reputation-weighted arbitration |
| **Procedural** | Nodes disagree about process (e.g., who can vote) | Authority conflicts, role violations | Hierarchical override or consensus |
| **Temporal** | Nodes have different information due to timing | Stale timestamps, version mismatches | Latest-with-valid-lineage wins |
| **Scope** | Nodes disagree about what domain a claim belongs to | Domain field conflicts | Domain authority determines |

This implementation focuses on **epistemic disagreement**: the core case where nodes hold conflicting beliefs about the same claim. The conflict detection and arbitration mechanisms are designed for this case.

Procedural, temporal, and scope disagreements are partially addressed:
- **Procedural:** Authority system limits who can act, quarantine removes bad actors
- **Temporal:** Timestamps and monotonic IDs order signals; checkpoint reveals staleness
- **Scope:** Domain field on signals allows filtering; not currently enforced

Implementations MAY extend the protocol to handle other disagreement types explicitly.

---

## Algorithms

### Conflict Scoring

Entropy-based scoring for sustained disagreement:

```typescript
function computeConflictScore(stances: Map<PeerId, Stance>): number {
  const total = stances.size;
  if (total <= 1) return 0;
  
  const counts: Record<Stance, number> = {};
  for (const stance of stances.values()) {
    counts[stance] = (counts[stance] ?? 0) + 1;
  }
  
  const uniqueStances = Object.keys(counts).filter(s => s !== 'unknown');
  if (uniqueStances.length <= 1) return 0;
  
  let entropy = 0;
  for (const [stance, count] of Object.entries(counts)) {
    if (stance === 'unknown') continue;
    const p = count / total;
    entropy += -p * Math.log2(p);
  }
  
  const maxEntropy = Math.log2(uniqueStances.length);
  return Math.min(1.0, entropy / maxEntropy);
}
```

### Reputation Calculation

```typescript
function calculateReputation(rep: ReputationRecord): number {
  const accuracyWeight = 0.4;
  const consistencyWeight = 0.3;
  const ageWeight = 0.2;
  const violationPenalty = 0.1 * rep.violations;
  
  const ageNormalized = Math.min(1.0, rep.age / 100);
  
  const base = 
    rep.accuracy * accuracyWeight +
    rep.consistency * consistencyWeight +
    ageNormalized * ageWeight;
  
  return Math.max(0, Math.min(1.0, base - violationPenalty));
}

function calculateInfluence(rep: ReputationRecord, config: Config): number {
  const base = config.newPeerInfluence;  // 0.1
  const max = 1.0;
  return base + (max - base) * calculateReputation(rep);
}
```

### T-State Multipliers

```typescript
const T_STATE_MULTIPLIERS: Record<TState, number> = {
  T0: 1.0,   // Full authority
  T1: 0.7,   // 30% reduction
  T2: 0.4,   // 60% reduction
  T3: 0.1,   // 90% reduction
  T4: 1.0    // Restored after reconciliation
};

function authorityDuration(base: number, tState: TState): number {
  return base * T_STATE_MULTIPLIERS[tState];
}
```

### Arbitration Tally

```typescript
function tallyVotes(
  votes: Map<PeerId, { option: string; weight: number }>,
  quarantine: QuarantineSystem,
  reputation: ReputationSystem
): string | null {
  const scores = new Map<string, number>();
  
  for (const [peerId, vote] of votes) {
    // Skip quarantined voters
    if (quarantine.isQuarantined(peerId)) continue;
    
    // Use minimum of claimed and current influence
    const currentInfluence = reputation.getInfluence(peerId);
    const effectiveWeight = Math.min(vote.weight, currentInfluence);
    
    const current = scores.get(vote.option) ?? 0;
    scores.set(vote.option, current + effectiveWeight);
  }
  
  // Find winner
  let maxScore = 0;
  let winner: string | null = null;
  
  for (const [option, score] of scores) {
    if (score > maxScore) {
      maxScore = score;
      winner = option;
    }
  }
  
  return winner;
}
```

## Audit Log Format

Hash-chained JSONL format:

```typescript
interface LogEntry {
  i: number;           // Monotonic index
  ts: number;          // Unix timestamp ms
  kind: LogKind;       // Event type
  peerId?: PeerId;     // Related peer
  data: unknown;       // Event-specific payload
  prev: string | null; // Hash of previous entry
  hash: string;        // SHA-256 of this entry
}

type LogKind = 
  | 'OUT_SEND' | 'OUT_BROADCAST' | 'IN' | 'ACTION'
  | 'GRANT' | 'DENY' | 'REVOKE' | 'DRIFT'
  | 'T_STATE_CHANGE' | 'PATTERN_GENERATED' | 'PATTERN_ADOPTED'
  | 'CONFLICT_DETECTED' | 'ROLLBACK';
```

**Hash Computation:**

Implementations MUST compute entry hashes as follows:

```typescript
function computeEntryHash(entry: Omit<LogEntry, 'hash'>): string {
  const canonical = JSON.stringify({
    i: entry.i,
    ts: entry.ts,
    kind: entry.kind,
    peerId: entry.peerId,
    data: entry.data,
    prev: entry.prev
  });
  return sha256Hex(canonical);
}
```

Implementations MUST include `prev` pointing to the previous entry's hash (or null for the first entry). Implementations SHOULD verify chain integrity on startup.

## Transport Requirements

Transports must implement:

```typescript
interface Transport {
  id: PeerId;
  send(to: PeerId, msg: WireMessage): void;
  broadcast(msg: WireMessage): void;
  onMessage(handler: (msg: WireMessage) => void): void;
}
```

Provided implementations:
- `MemoryTransport` - In-process testing
- `BroadcastChannelTransport` - Cross-tab browser communication
- `LoggedTransport` - Wrapper that logs to AuditLog

## Timing Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `heartbeatIntervalMs` | 1000 | Heartbeat frequency |
| `peerTimeoutMs` | 4000 | Peer considered dead after |
| `baseAuthorityDurationMs` | 60000 | Full T0 authority duration |
| `holdDriftThresholdMs` | 3000 | Max hold time before drift |
| `staleCommsThresholdMs` | 5000 | Comms staleness threshold |
| `defaultTtl` | 8 | Signal hop limit |

## Default Parameters

These values are policy, not protocol invariants. Implementations MAY adjust them. The defaults represent a reasonable starting point for browser-based swarms.

| Parameter | Default | Range | Notes |
|-----------|---------|-------|-------|
| `newPeerInfluence` | 0.1 | 0.0-1.0 | Starting influence for fresh nodes |
| `minReputationForVote` | 0.2 | 0.0-1.0 | Below this, votes are ignored |
| `conflictThreshold` | 0.6 | 0.0-1.0 | Entropy score triggering conflict |
| `maxPeers` | 32 | 1-256 | Bounded peer set size |
| `maxSeenSignals` | 50000 | 1000+ | Deduplication cache size |
| `quarantineBaseDurationMs` | 30000 | 1000+ | Initial quarantine period |
| `quarantineBackoffMultiplier` | 2.0 | 1.0+ | Exponential backoff factor |
| `reputationAccuracyWeight` | 0.4 | 0.0-1.0 | Weight for accuracy in score |
| `reputationConsistencyWeight` | 0.3 | 0.0-1.0 | Weight for consistency in score |
| `reputationAgeWeight` | 0.2 | 0.0-1.0 | Weight for age in score |
| `reputationViolationPenalty` | 0.1 | 0.0-1.0 | Penalty per violation |

### T-State Multipliers

| State | Multiplier | Authority at 60s base |
|-------|------------|----------------------|
| T0 | 1.0 | 60s |
| T1 | 0.7 | 42s |
| T2 | 0.4 | 24s |
| T3 | 0.1 | 6s |
| T4 | 1.0 | 60s (reconciliation) |
