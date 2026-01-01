# Epistemic Swarm

**The missing layer between "distributed learning" and "survives disagreement."**

## What This Is

This repository exists to answer one question:

> What is the minimum architecture required for distributed nodes to maintain shared meaning under disagreement?

Most systems claiming "swarm intelligence," "collective learning," or "distributed AI" skip this question entirely. They provide primitives (vector search, graph sync, signal propagation) and assume coherence emerges automatically.

It doesn't.

When nodes disagree, when attackers join, when communications degrade, when beliefs diverge silently across partitions—what happens?

If your system doesn't have an explicit answer, it doesn't have a system. It has a demo.

## What This Is Not

This is not:
- A framework to build applications on
- A competitor to vector databases
- A machine learning library
- A consensus protocol

This is a **reference implementation** of the governance layer that sits between primitives and coherent collective behavior. It exists to make the gap visible.

## The Gap

Consider any system that claims distributed learning:

| Capability | Primitives Handle It? | What Actually Happens |
|------------|----------------------|----------------------|
| Nodes find each other | Sometimes | Usually hardcoded or centralized |
| Signals propagate | Yes | But with no authenticity or bounds |
| Nodes disagree | **No** | Silently diverge or last-write-wins |
| Attackers join | **No** | Immediate influence, no vetting |
| Comms degrade | **No** | Stale beliefs treated as current |
| Decision audit | **No** | "The swarm decided" with no trace |

The bottom four are where systems fail. Not in demos. In deployment.

## The Falsification Test

This repository includes an adversarial demo that any claimed swarm system can be measured against:

```bash
cd packages/demo
npm install && npm run build
npm run adversarial
```

The test:
- 5 honest nodes establish a belief
- 20 attacker nodes join and attempt to flip it
- Naive majority voting: **attackers win**
- With governance layer: **attackers lose**

```
NAIVE BASELINE
--------------
Honest nodes: 5
Attacker nodes: 20
Naive winner: weaken

DEFENDED RUN
------------
Arbitration winner: strengthen
```

If your system can't survive this test, it can't survive deployment.

## The Minimum Architecture

After removing everything optional, this is what remains:

### 1. Authenticated Signals
Beliefs propagate as signed, verifiable messages. No signature, no propagation.

### 2. Conflict Detection
Entropy-based scoring surfaces sustained disagreement. Hidden divergence becomes visible.

### 3. Arbitration Protocol
When conflict is detected, reputation-weighted voting resolves it. Not majority voting. Not last-write-wins. Weighted by demonstrated reliability.

### 4. Progressive Trust
New nodes start with minimal influence (0.1). Reputation accrues through consistent behavior. 20 fresh attackers have less weight than 5 established honest nodes.

### 5. Drift Detection
Nodes that diverge from consensus, go silent, or act erratically lose authority automatically. No manual intervention required.

### 6. Audit Trail
Every signal, every vote, every decision is logged with hash chaining. "Why does the swarm believe X?" has an answer.

Remove any one of these and the system fails the adversarial test.

## What Happens Without This Layer

| Failure Mode | Symptom | Root Cause |
|--------------|---------|------------|
| Sybil takeover | Beliefs flip unexpectedly | No progressive trust |
| Silent divergence | Partitions develop incompatible meanings | No conflict detection |
| Stale authority | Nodes act on outdated beliefs | No drift detection |
| Unaccountable decisions | "The AI decided" with no trace | No audit trail |
| Coordination collapse | Nodes thrash between states | No arbitration protocol |

These aren't hypotheticals. They're what happens when you deploy primitives without governance.

## Reading the Code

The implementation is intentionally minimal. ~5,000 lines of TypeScript.

```
packages/core/src/
├── membership.ts      # Discovery, heartbeats, liveness
├── signal.ts          # Ed25519 signing and verification
├── beliefs.ts         # Local belief store with history
├── propagation.ts     # Authenticated signal forwarding
├── conflict.ts        # Entropy-based disagreement detection
├── arbitration.ts     # Reputation-weighted resolution
├── security/
│   ├── reputation.ts  # Progressive trust scoring
│   ├── quarantine.ts  # Isolation for misbehavior
│   └── admission.ts   # Gated entry
├── authority/
│   ├── tstate.ts      # Communication degradation model
│   ├── manager.ts     # Time-bounded authority windows
│   └── drift.ts       # Automatic revocation triggers
└── audit/
    ├── log.ts         # Hash-chained event log
    ├── replay.ts      # Deterministic reconstruction
    └── why.ts         # Provenance queries
```

Each file addresses a specific failure mode. The connections between them are documented in [docs/protocol.md](docs/protocol.md).

## The Question This Raises

For any system claiming distributed intelligence:

1. What happens when 20% of nodes are malicious?
2. What happens when the network partitions and heals?
3. What happens when a node acts on stale beliefs?
4. Can you trace why the system believes what it believes?

If the answer is "we haven't addressed that yet" or "that's a future roadmap item," then the system is a demo, not a deployment.

This repository is the minimum viable answer to those questions.

## What Ships vs What Doesn't

To prevent misreading:

**Implemented and tested:**
- Discovery and membership (heartbeats, peer exchange, liveness)
- Authenticated signal propagation (Ed25519, TTL, deduplication)
- Belief store with history and lineage tracking
- Conflict detection (entropy-based scoring)
- Arbitration protocol (reputation-weighted voting)
- Progressive trust (reputation accrual and decay)
- Quarantine system (isolation with exponential backoff)
- T-state degradation model (authority shrinkage under comms loss)
- Drift detection (hold time, divergence, confidence, staleness)
- Audit log (hash-chained, provenance queries, replay)
- Transports: Memory (testing), BroadcastChannel (browser tabs)

**Interface-ready extension points:**
- Custom transports (implement `Transport` interface)
- Custom admission policies (implement `AdmissionPolicy` interface)
- External reputation sources
- Application-layer encryption

**Not implemented in this repo:**
- WebRTC transport (would require signaling server)
- Persistent storage (logs are in-memory)
- UI or visualization
- Integration with specific vector databases or ML frameworks

## Documentation

- [Protocol Specification](docs/protocol.md) - Wire format, algorithms, timing parameters
- [Threat Model](docs/threat-model.md) - Attack vectors, defenses, code traceability
- [Acceptance Tests](docs/acceptance-tests.md) - Falsification criteria with run commands
- [Glossary](docs/glossary.md) - Precise definitions of all terms used in this spec

## Running It

```bash
npm install
npm run build
npm test

# The adversarial demo
cd packages/demo
npm run adversarial
```

## License

MIT

---

*This repository exists because the gap needed to be visible. The code is secondary to the question it forces.*
