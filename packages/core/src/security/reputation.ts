/**
 * Reputation System
 * =================
 * 
 * Tracks peer reputation based on behavior over time.
 * New peers start with limited influence that grows with consistent behavior.
 * 
 * Reputation affects:
 * - Vote weight in arbitration
 * - Pattern bundle adoption
 * - Authority grant priority
 */

import {
  PeerId,
  ReputationScore,
  AdmissionDecision,
  DriftReason,
  SwarmConfig,
  DEFAULT_CONFIG,
} from '../types/index.js';

export class ReputationSystem {
  private scores = new Map<PeerId, ReputationScore>();
  private config: SwarmConfig;

  constructor(config: Partial<SwarmConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Check if a new peer should be admitted
   */
  checkAdmission(peerId: PeerId): AdmissionDecision {
    const existing = this.scores.get(peerId);
    
    if (existing) {
      // Returning peer
      if (existing.violations > 3) {
        return {
          allowed: false,
          influence: 0,
          reason: 'Too many violations',
        };
      }
      return {
        allowed: true,
        influence: this.calculateInfluence(existing),
      };
    }

    // New peer - admit with limited influence
    return {
      allowed: true,
      influence: this.config.newPeerInfluence,
    };
  }

  /**
   * Initialize or update tracking for a peer
   */
  track(peerId: PeerId, now = Date.now()): ReputationScore {
    const existing = this.scores.get(peerId);
    
    if (existing) {
      existing.lastUpdated = now;
      return existing;
    }

    const score: ReputationScore = {
      peerId,
      score: this.config.newPeerInfluence,
      accuracy: 0.5,
      consistency: 0.5,
      age: 0,
      violations: 0,
      lastUpdated: now,
    };

    this.scores.set(peerId, score);
    return score;
  }

  /**
   * Record a successful action (increases reputation)
   */
  recordSuccess(peerId: PeerId): void {
    const score = this.scores.get(peerId);
    if (!score) return;

    score.accuracy = Math.min(1.0, score.accuracy + 0.05);
    score.score = this.calculateScore(score);
    score.lastUpdated = Date.now();
  }

  /**
   * Record a failed action (decreases reputation)
   */
  recordFailure(peerId: PeerId): void {
    const score = this.scores.get(peerId);
    if (!score) return;

    score.accuracy = Math.max(0, score.accuracy - 0.1);
    score.score = this.calculateScore(score);
    score.lastUpdated = Date.now();
  }

  /**
   * Record a drift violation
   */
  recordViolation(peerId: PeerId, _reason: DriftReason): void {
    const score = this.scores.get(peerId);
    if (!score) return;

    score.violations++;
    score.score = Math.max(0, score.score - 0.2);
    score.lastUpdated = Date.now();
  }

  /**
   * Record consistent behavior (small boost)
   */
  recordConsistency(peerId: PeerId): void {
    const score = this.scores.get(peerId);
    if (!score) return;

    score.consistency = Math.min(1.0, score.consistency + 0.02);
    score.age++;
    score.score = this.calculateScore(score);
    score.lastUpdated = Date.now();
  }

  /**
   * Get reputation score for a peer
   */
  getScore(peerId: PeerId): number {
    return this.scores.get(peerId)?.score ?? 0;
  }

  /**
   * Get full reputation info for a peer
   */
  getReputation(peerId: PeerId): ReputationScore | undefined {
    return this.scores.get(peerId);
  }

  /**
   * Get influence (vote weight) for a peer
   */
  getInfluence(peerId: PeerId): number {
    const score = this.scores.get(peerId);
    if (!score) return this.config.newPeerInfluence;
    return this.calculateInfluence(score);
  }

  /**
   * Check if peer can vote in arbitration
   */
  canVote(peerId: PeerId): boolean {
    const score = this.scores.get(peerId);
    if (!score) return false;
    return score.score >= this.config.minReputationForVote;
  }

  /**
   * Calculate overall score from components
   */
  private calculateScore(rep: ReputationScore): number {
    // Weighted average of components
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

  /**
   * Calculate influence from reputation
   */
  private calculateInfluence(rep: ReputationScore): number {
    // Influence scales with score but has a floor
    const base = this.config.newPeerInfluence;
    const max = 1.0;
    return base + (max - base) * rep.score;
  }

  /**
   * Prune inactive peers
   */
  prune(maxAge: number, now = Date.now()): PeerId[] {
    const pruned: PeerId[] = [];
    
    for (const [peerId, score] of this.scores) {
      if (now - score.lastUpdated > maxAge) {
        this.scores.delete(peerId);
        pruned.push(peerId);
      }
    }

    return pruned;
  }

  /**
   * Get all tracked peers sorted by reputation
   */
  getAll(): ReputationScore[] {
    return Array.from(this.scores.values())
      .sort((a, b) => b.score - a.score);
  }

  /**
   * Export for audit
   */
  export(): ReputationScore[] {
    return this.getAll();
  }
}
