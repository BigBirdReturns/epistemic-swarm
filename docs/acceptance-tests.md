# Acceptance Tests

These are the falsification criteria for the epistemic swarm implementation. A system passes if it survives all tests. Failure on any test indicates a missing governance capability.

## Test Matrix

| ID | Test | Pass Condition | Failure Indicates |
|----|------|----------------|-------------------|
| A1 | Sybil resistance | 20 attackers cannot flip belief held by 5 honest nodes | No progressive trust |
| A2 | Conflict detection | Disagreement surfaces within 10 ticks | No entropy monitoring |
| A3 | Arbitration resolution | Winner determined by reputation weight, not count | Naive voting |
| A4 | Quarantine effectiveness | Quarantined peer has zero influence | Leaky isolation |
| A5 | Drift revocation | Authority revoked within 5s of drift trigger | No drift detection |
| A6 | Audit integrity | Hash chain verifies after 1000 entries | Broken provenance |
| A7 | Replay determinism | Replayed state matches original | Non-deterministic execution |
| A8 | T-state degradation | Authority window shrinks under comms loss | No degradation model |
| A9 | Signature verification | Unsigned signal rejected | No authentication |
| A10 | Deduplication | Replayed signal ignored | Replay vulnerability |

---

## A1: Sybil Resistance

**Setup:**
- 5 honest nodes establish belief: `{ claim: X, direction: strengthen, confidence: 0.85 }`
- Wait 40 ticks for reputation accrual
- 20 attacker nodes join
- Attackers publish: `{ claim: X, direction: weaken, confidence: 0.95 }`
- Trigger arbitration

**Pass:** Arbitration winner is `strengthen`

**Fail:** Arbitration winner is `weaken`

**Run:** `npm run adversarial` in `packages/demo`

---

## A2: Conflict Detection

**Setup:**
- 3 nodes with belief `strengthen`
- 2 nodes with belief `weaken`
- Same claim hash

**Pass:** `conflictScore > 0.6` within 10 ticks

**Fail:** No conflict detected or score below threshold

**Verification:** `node.conflicts.get(claimHash).conflictScore`

---

## A3: Arbitration Resolution

**Setup:**
- Node A: reputation 0.8, votes `strengthen`
- Node B: reputation 0.8, votes `strengthen`
- Nodes C, D, E: reputation 0.1 each, vote `weaken`

**Pass:** Winner is `strengthen` (weight 1.6 vs 0.3)

**Fail:** Winner is `weaken` (would indicate count-based voting)

**Verification:** `node.resolveArbitration(proposalId)`

---

## A4: Quarantine Effectiveness

**Setup:**
- Peer X quarantined
- Peer X votes in arbitration

**Pass:** Vote weight is 0, vote does not affect outcome

**Fail:** Vote counted with any weight

**Verification:** `quarantine.isQuarantined(peerId)` returns true, vote ignored in tally

---

## A5: Drift Revocation

**Setup:**
- Node granted authority
- Node stops sending heartbeats (simulates comms failure)
- Wait 5 seconds

**Pass:** Authority revoked, drift reason is `STALE_COMMS`

**Fail:** Authority persists beyond threshold

**Verification:** `node.hasAuthority()` returns false, audit log contains `REVOKE` entry

---

## A6: Audit Integrity

**Setup:**
- Generate 1000 log entries through normal operation
- Tamper with entry 500 (change any field)

**Pass:** `audit.verify()` returns `{ valid: false, brokenAt: 500 }`

**Fail:** Verification passes despite tampering

**Verification:** `node.audit.verify()`

---

## A7: Replay Determinism

**Setup:**
- Run scenario, export audit log
- Create new node, replay log

**Pass:** Final belief state matches original

**Fail:** States diverge

**Verification:** Compare `replay.state()` with original `node.beliefs.snapshot()`

---

## A8: T-State Degradation

**Setup:**
- Node at T0 (full comms)
- Grant authority with base duration 60s
- Degrade to T2 (comms loss)

**Pass:** Authority duration is now 24s (40% of 60s)

**Fail:** Duration unchanged

**Verification:** `authority.remainingMs()` reflects multiplier

---

## A9: Signature Verification

**Setup:**
- Create signal with invalid signature (wrong key or corrupted)
- Attempt to propagate

**Pass:** Signal rejected, not added to beliefs

**Fail:** Signal accepted

**Verification:** `propagation.onIncoming()` returns null

---

## A10: Deduplication

**Setup:**
- Valid signal propagated and processed
- Same signal sent again

**Pass:** Second signal ignored (no state change, no re-broadcast)

**Fail:** Signal processed twice

**Verification:** Belief history shows single entry, seen-set contains signal key

---

## Running All Tests

The test suite in `packages/core/test/swarm.test.ts` covers most of these scenarios. Run with:

```bash
npm test
```

The adversarial demo (A1) runs separately:

```bash
cd packages/demo
npm run adversarial
```

---

## Applying These Tests to Other Systems

For any system claiming distributed coordination:

1. Can you run test A1? If not, why not?
2. Which tests does your system pass?
3. For failures, what's the mitigation plan?

A system that cannot articulate answers to these questions is not ready for adversarial deployment.
