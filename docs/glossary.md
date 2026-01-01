# Glossary

Terms used in this specification and their precise meanings.

---

**Admission** - The process of accepting a new peer into the swarm. Controlled by `AdmissionController` which may apply policies (capacity limits, T-state restrictions, reputation checks).

**Arbitration** - The process of resolving conflicting beliefs through reputation-weighted voting. Triggered when conflict score exceeds threshold. Results in a winner that becomes the swarm's accepted stance.

**Authority** - Permission to act within a defined scope for a bounded duration. Granted through `AuthorityManager`, shrinks under T-state degradation, revoked on drift detection.

**Authority Window** - A time-bounded grant of authority. Contains: scope, expiration time, T-state at grant, and conditions. Expires automatically.

**Belief** - A node's stance on a claim. Contains: claim hash, direction (strengthen/weaken/retract), confidence (0.0-1.0), lineage (prior signals), and timestamp.

**Checkpoint** - A snapshot of belief state across the swarm at a specific moment. Used for conflict verification and rollback.

**Claim** - An assertion that nodes can have beliefs about. Identified by a hash. The claim content itself is application-defined; the swarm only tracks stances on claim hashes.

**Claim Hash** - A unique identifier for a claim. Typically SHA-256 of the claim content. The swarm is agnostic to what the hash represents.

**Confidence** - A value from 0.0 to 1.0 indicating certainty in a belief. Used for tie-breaking and aggregation. Self-reported by nodes.

**Conflict** - A state where peers hold incompatible beliefs about the same claim. Detected via entropy scoring. Triggers checkpointing and potentially arbitration.

**Conflict Score** - Normalized entropy of stance distribution across peers. Range 0.0-1.0. Higher values indicate more disagreement. Default threshold: 0.6.

**Direction** - The type of belief update: `strengthen` (increase confidence), `weaken` (decrease confidence), or `retract` (withdraw claim).

**Domain** - A semantic namespace for signals. Allows filtering by topic. Application-defined string.

**Drift** - Deviation from expected behavior that triggers authority revocation. Four types:
- `HOLD_TOO_LONG`: Node stuck waiting beyond threshold
- `BELIEF_DIVERGENCE`: Stance differs significantly from consensus
- `CONFIDENCE_DECAY`: Self-reported confidence below threshold
- `STALE_COMMS`: No heartbeat received within threshold

**Entropy** - Information-theoretic measure of disagreement. Computed as: `-Σ p(stance) × log2(p(stance))`. Normalized by maximum possible entropy.

**Epoch** - A logical time period. Not currently used in this implementation but reserved for future consensus mechanisms.

**Heartbeat** - Periodic message indicating liveness. Contains: sender ID, timestamp, T-state, and confidence. Absence triggers `STALE_COMMS` drift.

**Influence** - A peer's voting weight in arbitration. Computed from reputation. Range: `newPeerInfluence` (0.1) to 1.0. Quarantined peers have 0 influence.

**Lineage** - The chain of prior signals that led to a belief. Used for provenance queries.

**Peer** - A node participating in the swarm. Identified by Ed25519 public key.

**PeerId** - Hex-encoded Ed25519 public key identifying a peer.

**Progressive Trust** - The principle that new peers start with minimal influence and earn reputation through consistent behavior. Prevents Sybil attacks from having immediate effect.

**Propagation** - The process of forwarding signals through the swarm. Subject to TTL limits, signature verification, and deduplication.

**Provenance** - The traceable history of how a belief came to exist. Queryable via `AuditLog.traceProvenance()`.

**Quarantine** - Isolation of a misbehaving peer. Quarantined peers have zero influence and may be excluded from propagation. Duration increases exponentially with repeat offenses.

**Replay** - Deterministic reconstruction of swarm state from audit log. Used for debugging and verification.

**Reputation** - A score from 0.0 to 1.0 reflecting a peer's reliability. Computed from: accuracy, consistency, age, and violation count.

**Rollback** - Reverting swarm state to a previous checkpoint. Used for recovery from detected attacks or errors.

**Scope** - The domain of authority. A string defining what the authority permits. Application-defined.

**Signal** - A message carrying a belief update. Contains: source ID, signal ID, timestamp, domain, type, payload, TTL, scope, and signature.

**Signal ID** - Monotonically increasing identifier per source. Used for replay detection.

**Stance** - A peer's position on a claim: `strengthen`, `weaken`, `retract`, or `unknown`.

**T-State** - Communication degradation level. Based on tactical communications model:
- `T0`: Full comms, full authority
- `T1`: Partial degradation, 70% authority
- `T2`: Comms loss, 40% authority, no new grants
- `T3`: Extended loss, 10% authority
- `T4`: Recontact, reconciliation mode

**TTL** - Time To Live. Number of hops remaining before a signal stops propagating. Decremented on each forward.

**Transport** - The communication layer abstraction. Implementations: MemoryTransport (testing), BroadcastChannelTransport (browser tabs).

**Vote** - A peer's ballot in arbitration. Contains: proposal ID, chosen option, and weight at vote time. Quarantined votes are ignored.
