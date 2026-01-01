/**
 * Belief Store
 * ============
 * 
 * Stores and manages beliefs with full lineage tracking for audit.
 */

import { 
  BeliefState, 
  Stance, 
  LearningSignal,
  PeerId 
} from './types/index.js';

export interface BeliefHistory {
  claimHash: string;
  entries: Array<{
    timestamp: number;
    stance: Stance;
    confidence: number;
    signalId: string;
    sourceId: string;
  }>;
}

export class BeliefStore {
  private beliefs = new Map<string, BeliefState>();
  private history = new Map<string, BeliefHistory>();

  /**
   * Get belief for a claim
   */
  get(claimHash: string): BeliefState | undefined {
    return this.beliefs.get(claimHash);
  }

  /**
   * Get all beliefs
   */
  all(): BeliefState[] {
    return Array.from(this.beliefs.values());
  }

  /**
   * Apply a learning signal to update beliefs
   */
  apply(signal: LearningSignal): BeliefState {
    const claimHash = signal.payload.claim_hash;
    const prev = this.beliefs.get(claimHash);

    const next: BeliefState = {
      claimHash,
      stance: signal.payload.direction,
      confidence: signal.payload.confidence,
      updatedAt: signal.timestamp,
      lastSignalId: signal.signal_id,
      lastSourceId: signal.source_id,
    };

    // Resolution: newer timestamp wins; if equal, higher confidence wins
    if (!prev) {
      this.beliefs.set(claimHash, next);
      this.recordHistory(claimHash, next, signal);
      return next;
    }

    if (signal.timestamp > prev.updatedAt) {
      this.beliefs.set(claimHash, next);
      this.recordHistory(claimHash, next, signal);
      return next;
    }

    if (signal.timestamp === prev.updatedAt && signal.payload.confidence >= prev.confidence) {
      this.beliefs.set(claimHash, next);
      this.recordHistory(claimHash, next, signal);
      return next;
    }

    return prev;
  }

  /**
   * Record history for lineage tracking
   */
  private recordHistory(claimHash: string, belief: BeliefState, signal: LearningSignal): void {
    let history = this.history.get(claimHash);
    if (!history) {
      history = { claimHash, entries: [] };
      this.history.set(claimHash, history);
    }

    history.entries.push({
      timestamp: belief.updatedAt,
      stance: belief.stance,
      confidence: belief.confidence,
      signalId: signal.signal_id,
      sourceId: signal.source_id,
    });

    // Keep bounded history
    if (history.entries.length > 100) {
      history.entries = history.entries.slice(-100);
    }
  }

  /**
   * Get history for a claim
   */
  getHistory(claimHash: string): BeliefHistory | undefined {
    return this.history.get(claimHash);
  }

  /**
   * Get consensus beliefs (for drift detection)
   */
  getConsensus(): Map<string, { stance: Stance; confidence: number }> {
    const result = new Map<string, { stance: Stance; confidence: number }>();
    for (const [hash, belief] of this.beliefs) {
      result.set(hash, { stance: belief.stance, confidence: belief.confidence });
    }
    return result;
  }

  /**
   * Create snapshot for rollback
   */
  snapshot(): Record<string, BeliefState> {
    const out: Record<string, BeliefState> = {};
    for (const [k, v] of this.beliefs) {
      out[k] = { ...v };
    }
    return out;
  }

  /**
   * Restore from snapshot
   */
  restore(snapshot: Record<string, BeliefState>): void {
    this.beliefs.clear();
    for (const [k, v] of Object.entries(snapshot)) {
      this.beliefs.set(k, v);
    }
  }

  /**
   * Get count of beliefs
   */
  get size(): number {
    return this.beliefs.size;
  }

  /**
   * Clear all beliefs (for testing)
   */
  clear(): void {
    this.beliefs.clear();
    this.history.clear();
  }
}

export { BeliefState, Stance };
