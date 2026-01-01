# Falsification Test

This is not a feature demo. It is a test that distinguishes systems with governance from systems without it.

## The Claim Being Tested

> "A distributed learning system can maintain coherent beliefs under adversarial conditions."

Most systems claiming "swarm intelligence" or "collective learning" fail this test silently. They work in demos where all nodes are honest and cooperative. They collapse when that assumption breaks.

## The Test

**Setup:**
- 5 honest nodes establish a belief (direction: `strengthen`, confidence: 0.85)
- 20 attacker nodes join the swarm
- Attackers coordinate to flip the belief (direction: `weaken`, confidence: 0.95)

**Naive outcome (majority voting):**
- 20 votes for `weaken`, 5 votes for `strengthen`
- Attackers win
- Belief flips

**Governed outcome (this system):**
- 20 attackers × 0.1 influence = 2.0 total attacker weight
- 5 honest nodes × ~0.8 influence = 4.0 total honest weight
- Honest nodes win
- Belief holds

## Running It

```bash
npm install
npm run build
npm run adversarial
```

## Expected Output

```
NAIVE BASELINE
--------------
Honest nodes: 5
Attacker nodes: 20
Rule: majority direction wins immediately.
Naive winner: weaken
This is what most 'swarm learning' repos silently implement.

DEFENDED RUN
------------
Beliefs after attack (honest nodes):
- node-0: strengthen (0.85)
- node-1: strengthen (0.85)
- node-2: strengthen (0.85)
- node-3: strengthen (0.85)
- node-4: strengthen (0.85)

Conflict detected:
- claim: claim:target-X
- conflictScore: 0.9182
- counts: {"strengthen":5,"weaken":20}

Arbitration proposed: ARB-7f2a3b-1704067200
Arbitration winner: strengthen
```

## What This Proves

If your system produces `weaken` as the winner, it has no Sybil resistance. The moment attackers outnumber honest nodes, beliefs flip.

If your system doesn't detect the conflict at all, it has no disagreement governance. Nodes silently diverge.

If your system can't answer "why did it decide `strengthen`?", it has no audit trail. Decisions are untraceable.

## Applying This Test to Other Systems

For any claimed distributed learning system, ask:

1. Run this scenario. What happens?
2. If you can't run it, why not? (Missing primitives? No adversarial model?)
3. If attackers win, what's the mitigation? (If "don't let attackers join," that's not a mitigation.)

The test is simple. The implications are not.
