
/**
 * Adversarial Demo
 * ================
 *
 * This demo shows the gap between naive "swarm learning" and an epistemic swarm:
 * - Sybil attack: many fresh identities attempt to flip a belief quickly.
 * - Defense: progressive trust, influence gating, and conflict + arbitration prevent takeover.
 *
 * Run:
 *   npm install
 *   npm run build
 *   npm run adversarial --workspaces --if-present
 * Or:
 *   npm run demo:adversarial
 */

import crypto from "crypto";
import {
  createMemorySwarm,
  SwarmNode,
  createSignalBuilder,
  buildSignal,
  DEFAULT_CONFIG,
  why
} from "@epistemic-swarm/core";

type NodeBundle = {
  id: string;
  node: SwarmNode;
  privateKey: string;
};

const CLAIM = "claim:target-X";
const DOMAIN = "demo";

function randomPrivKeyHex(): string {
  return crypto.randomBytes(32).toString("hex");
}

async function makeNode(transport: any, config: Partial<typeof DEFAULT_CONFIG> = {}): Promise<NodeBundle> {
  const privateKey = randomPrivKeyHex();
  const node = new SwarmNode(transport, privateKey, config);
  node.start();
  return { id: transport.id, node, privateKey };
}

async function tickAll(nodes: NodeBundle[], steps: number, delayMs: number) {
  for (let i = 0; i < steps; i++) {
    await Promise.all(nodes.map(n => n.node.processTick()));
    if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
  }
}

function stanceLabel(stance: string, conf: number) {
  return `${stance} (${conf.toFixed(2)})`;
}

async function naiveOutcome(honest: number, attackers: number): Promise<void> {
  console.log("\nNAIVE BASELINE");
  console.log("--------------");
  console.log(`Honest nodes: ${honest}`);
  console.log(`Attacker nodes: ${attackers}`);
  console.log("Rule: majority direction wins immediately.");

  const honestVotes = Array(honest).fill("strengthen");
  const attackerVotes = Array(attackers).fill("weaken");
  const all = [...honestVotes, ...attackerVotes];

  const strengthen = all.filter(x => x === "strengthen").length;
  const weaken = all.filter(x => x === "weaken").length;

  const winner = strengthen >= weaken ? "strengthen" : "weaken";
  console.log(`Naive winner: ${winner}`);
  console.log("This is what most 'swarm learning' repos silently implement.");
}

async function defendedOutcome(): Promise<void> {
  console.log("\nDEFENDED RUN");
  console.log("------------");

  const honestCount = 5;
  const attackerCount = 20;

  await naiveOutcome(honestCount, attackerCount);

  const { transports } = createMemorySwarm(honestCount + attackerCount);

  // Defenses: new peers have low influence; voting requires minimum reputation.
  // Keep defaults unless the repo changes them.
  const config = {
    ...DEFAULT_CONFIG,
    maxPeers: 64
  };

  const honest: NodeBundle[] = [];
  const attackers: NodeBundle[] = [];

  for (let i = 0; i < honestCount; i++) honest.push(await makeNode(transports[i], config));

  // Let honest nodes form stable membership first.
  await tickAll(honest, 40, 10);

  // Honest establishes a belief.
  await Promise.all(honest.map(h => h.node.publishBelief(CLAIM, "strengthen", 0.85, { scope: "cluster" })));

  await tickAll(honest, 40, 10);

  // Attackers join late and attempt a fast flip.
  for (let i = honestCount; i < honestCount + attackerCount; i++) {
    attackers.push(await makeNode(transports[i], config));
  }

  // Let membership see them.
  await tickAll([...honest, ...attackers], 40, 10);

  // Coordinated attacker push.
  await Promise.all(attackers.map(a => a.node.publishBelief(CLAIM, "weaken", 0.95, { scope: "cluster" })));

  await tickAll([...honest, ...attackers], 60, 10);

  // Show belief snapshots per honest node.
  console.log("\nBeliefs after attack (honest nodes):");
  for (const h of honest) {
    const b = h.node.beliefs.get(CLAIM);
    if (!b) {
      console.log(`- ${h.id}: no belief`);
      continue;
    }
    console.log(`- ${h.id}: ${stanceLabel(b.stance, b.confidence)}`);
  }

  // Identify conflict score as seen by leader.
  const leader = honest[0].node;
  const conflicts = leader.conflicts.all();
  const conflict = conflicts.find(c => c.claimHash === CLAIM);


if (conflict) {
  console.log("\nConflict detected:");
  console.log(`- claim: ${conflict.claimHash}`);
  console.log(`- conflictScore: ${conflict.conflictScore.toFixed(4)}`);
  console.log(`- counts: ${JSON.stringify(conflict.counts)}`);
} else {
  console.log("\nNo conflict record found. This likely means the attack did not create sustained divergence.");
}

  // Force arbitration on the belief direction.
  const proposalId = leader.proposeArbitration(CLAIM, ["strengthen", "weaken", "retract"]);
  console.log(`\nArbitration proposed: ${proposalId}`);

  // All nodes attempt to vote based on their local stance.
  for (const bundle of [...honest, ...attackers]) {
    const b = bundle.node.beliefs.get(CLAIM);
    const option = b?.stance ?? "unknown";
    if (option === "unknown") continue;
    bundle.node.vote(proposalId, option);
  }

  await tickAll([...honest, ...attackers], 40, 10);

  const winner = leader.resolveArbitration(proposalId);
  console.log(`Arbitration winner: ${winner ?? "none"}`);

  // Export audit why for leader.
  const q = why(leader.beliefs, CLAIM);
  console.log("\nWhy query (leader):");
  console.log(JSON.stringify(q, null, 2));

  // Show reputation and quarantine summary.
  const exportState = leader.export();
  console.log("\nLeader security summary:");
  console.log(`- peersKnown: ${exportState.status.peers}`);
  console.log(`- quarantined: ${exportState.quarantine.quarantinedPeers.length}`);
  console.log(`- reputationPeers: ${exportState.reputation.scores.length}`);

  console.log("\nIf winner stays strengthen and attacker votes do not dominate, the defense holds.");
}

await defendedOutcome();
