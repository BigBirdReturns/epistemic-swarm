/**
 * Arbitration
 * ===========
 * 
 * Resolves conflicts through reputation-weighted voting.
 * Integrates with admission control to bound influence.
 */

import { 
  Transport, 
  WireMessage, 
  PeerId,
  ConflictRecord,
  SwarmConfig,
  DEFAULT_CONFIG 
} from './types/index.js';
import { ConflictAccumulator } from './conflict.js';
import { ReputationSystem } from './security/reputation.js';
import { QuarantineSystem } from './security/quarantine.js';
import { nowMs, generateId } from './util/hash.js';

export interface Proposal {
  id: string;
  claimHash: string;
  options: string[];
  proposedAt: number;
  proposedBy: PeerId;
  votes: Map<PeerId, { option: string; weight: number; ts: number }>;
  resolved: boolean;
  winner?: string;
}

export interface ArbitrationCallbacks {
  onProposalCreated?: (proposal: Proposal) => void;
  onVoteReceived?: (proposalId: string, from: PeerId, option: string) => void;
  onResolved?: (proposal: Proposal, winner: string) => void;
}

export class Arbitration {
  private proposals = new Map<string, Proposal>();
  private config: SwarmConfig;
  private callbacks: ArbitrationCallbacks = {};

  constructor(
    private transport: Transport,
    private conflicts: ConflictAccumulator,
    private reputation: ReputationSystem,
    private quarantine: QuarantineSystem,
    config: Partial<SwarmConfig> = {}
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Set callbacks
   */
  setCallbacks(callbacks: ArbitrationCallbacks): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  /**
   * Start listening for arbitration messages
   */
  start(): void {
    this.transport.onMessage((m) => this.onWire(m));
  }

  /**
   * Create a proposal to resolve a conflict
   */
  propose(claimHash: string, options: string[]): string {
    const id = generateId('ARB');
    
    const proposal: Proposal = {
      id,
      claimHash,
      options,
      proposedAt: nowMs(),
      proposedBy: this.transport.id,
      votes: new Map(),
      resolved: false,
    };

    this.proposals.set(id, proposal);

    // Broadcast proposal
    this.transport.broadcast({
      type: 'ARBITRATION_PROPOSAL',
      from: this.transport.id,
      ts: nowMs(),
      proposalId: id,
      claimHash,
      options,
    });

    this.callbacks.onProposalCreated?.(proposal);

    return id;
  }

  /**
   * Vote on a proposal
   */
  vote(proposalId: string, option: string): void {
    const proposal = this.proposals.get(proposalId);
    if (!proposal || proposal.resolved) return;
    if (!proposal.options.includes(option)) return;

    // Check if we can vote
    if (!this.reputation.canVote(this.transport.id)) return;
    if (this.quarantine.isQuarantined(this.transport.id)) return;

    const weight = this.reputation.getInfluence(this.transport.id);

    // Record our vote locally
    proposal.votes.set(this.transport.id, { option, weight, ts: nowMs() });

    // Broadcast vote
    this.transport.broadcast({
      type: 'ARBITRATION_VOTE',
      from: this.transport.id,
      ts: nowMs(),
      proposalId,
      option,
      weight,
    });
  }

  /**
   * Tally votes and determine winner
   */
  tally(proposalId: string): string | null {
    const proposal = this.proposals.get(proposalId);
    if (!proposal || proposal.resolved) return proposal?.winner ?? null;

    const scores = new Map<string, number>();
    for (const opt of proposal.options) {
      scores.set(opt, 0);
    }

    for (const [peerId, vote] of proposal.votes) {
      // Check if voter is quarantined (votes don't count)
      if (this.quarantine.isQuarantined(peerId)) continue;
      
      // Get current influence (may have changed since vote)
      const currentWeight = this.reputation.getInfluence(peerId);
      const effectiveWeight = Math.min(vote.weight, currentWeight);

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

    if (winner) {
      proposal.resolved = true;
      proposal.winner = winner;
      this.conflicts.resolve(proposal.claimHash);
      this.callbacks.onResolved?.(proposal, winner);
    }

    return winner;
  }

  /**
   * Handle wire messages
   */
  private onWire(m: WireMessage): void {
    if (m.type === 'ARBITRATION_PROPOSAL') {
      this.handleProposal(m);
    } else if (m.type === 'ARBITRATION_VOTE') {
      this.handleVote(m);
    }
  }

  /**
   * Handle incoming proposal
   */
  private handleProposal(m: WireMessage & { type: 'ARBITRATION_PROPOSAL' }): void {
    if (this.proposals.has(m.proposalId)) return;

    const proposal: Proposal = {
      id: m.proposalId,
      claimHash: m.claimHash,
      options: m.options,
      proposedAt: m.ts,
      proposedBy: m.from,
      votes: new Map(),
      resolved: false,
    };

    this.proposals.set(m.proposalId, proposal);
    this.callbacks.onProposalCreated?.(proposal);
  }

  /**
   * Handle incoming vote
   */
  private handleVote(m: WireMessage & { type: 'ARBITRATION_VOTE' }): void {
    const proposal = this.proposals.get(m.proposalId);
    if (!proposal || proposal.resolved) return;

    // Validate voter
    if (this.quarantine.isQuarantined(m.from)) return;
    if (!this.reputation.canVote(m.from)) return;

    // Verify weight matches our records (prevent inflation)
    const expectedWeight = this.reputation.getInfluence(m.from);
    const effectiveWeight = Math.min(m.weight, expectedWeight);

    proposal.votes.set(m.from, { 
      option: m.option, 
      weight: effectiveWeight, 
      ts: m.ts 
    });

    this.callbacks.onVoteReceived?.(m.proposalId, m.from, m.option);
  }

  /**
   * Get a proposal
   */
  getProposal(proposalId: string): Proposal | undefined {
    return this.proposals.get(proposalId);
  }

  /**
   * Get all active proposals
   */
  activeProposals(): Proposal[] {
    return Array.from(this.proposals.values())
      .filter(p => !p.resolved);
  }

  /**
   * Prune old resolved proposals
   */
  prune(maxAge = 300_000, now = nowMs()): void {
    for (const [id, proposal] of this.proposals) {
      if (proposal.resolved && now - proposal.proposedAt > maxAge) {
        this.proposals.delete(id);
      }
    }
  }

  /**
   * Export for audit
   */
  export(): Array<{
    id: string;
    claimHash: string;
    resolved: boolean;
    winner?: string;
    voteCount: number;
  }> {
    return Array.from(this.proposals.values()).map(p => ({
      id: p.id,
      claimHash: p.claimHash,
      resolved: p.resolved,
      winner: p.winner,
      voteCount: p.votes.size,
    }));
  }
}
