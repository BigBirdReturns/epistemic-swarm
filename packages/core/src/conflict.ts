/**
 * Conflict Detector
 * =================
 * 
 * Detects semantic conflicts when peers disagree on beliefs.
 * Uses entropy-based scoring to identify sustained disagreement.
 */

import { 
  PeerId, 
  Stance, 
  ConflictRecord,
  SwarmConfig,
  DEFAULT_CONFIG 
} from './types/index.js';

export interface ConflictCallbacks {
  onConflictDetected?: (record: ConflictRecord) => void;
  onConflictResolved?: (claimHash: string) => void;
}

export class ConflictAccumulator {
  private records = new Map<string, ConflictRecord>();
  private config: SwarmConfig;
  private callbacks: ConflictCallbacks = {};

  constructor(config: Partial<SwarmConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Set callbacks
   */
  setCallbacks(callbacks: ConflictCallbacks): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  /**
   * Record a belief observation from a peer
   */
  observeBelief(
    peerId: PeerId,
    claimHash: string,
    stance: Stance,
    confidence: number,
    ts: number,
    meaning?: string
  ): ConflictRecord {
    let rec = this.records.get(claimHash);
    
    if (!rec) {
      rec = {
        claimHash,
        meaning,
        counts: {},
        stances: new Map(),
        conflictScore: 0,
      };
      this.records.set(claimHash, rec);
    }

    rec.meaning = rec.meaning ?? meaning;
    rec.stances.set(peerId, { stance, confidence, ts });

    // Rebuild counts
    rec.counts = {};
    for (const s of rec.stances.values()) {
      rec.counts[s.stance] = (rec.counts[s.stance] ?? 0) + 1;
    }

    const oldScore = rec.conflictScore;
    rec.conflictScore = this.computeScore(rec);

    // Check if conflict threshold crossed
    if (oldScore < this.config.beliefDivergenceThreshold && 
        rec.conflictScore >= this.config.beliefDivergenceThreshold) {
      this.callbacks.onConflictDetected?.(rec);
    }

    return rec;
  }

  /**
   * Compute conflict score using entropy
   */
  private computeScore(rec: ConflictRecord): number {
    const total = rec.stances.size;
    if (total <= 1) return 0;

    const uniqueStances = new Set(
      Array.from(rec.stances.values())
        .map(x => x.stance)
        .filter(s => s !== 'unknown')
    );

    if (uniqueStances.size <= 1) return 0;

    // Normalized entropy on stance distribution
    let entropy = 0;
    for (const [stance, count] of Object.entries(rec.counts)) {
      if (stance === 'unknown') continue;
      const p = count / total;
      entropy += -p * Math.log2(p);
    }

    const maxEntropy = Math.log2(Math.max(2, uniqueStances.size));
    return Math.min(1, entropy / maxEntropy);
  }

  /**
   * Get conflict record for a claim
   */
  get(claimHash: string): ConflictRecord | undefined {
    return this.records.get(claimHash);
  }

  /**
   * Get all conflict records sorted by score
   */
  all(): ConflictRecord[] {
    return Array.from(this.records.values())
      .sort((a, b) => b.conflictScore - a.conflictScore);
  }

  /**
   * Get active conflicts (above threshold)
   */
  active(threshold?: number): ConflictRecord[] {
    const t = threshold ?? this.config.beliefDivergenceThreshold;
    return this.all().filter(c => c.conflictScore >= t);
  }

  /**
   * Mark a conflict as resolved
   */
  resolve(claimHash: string): void {
    const rec = this.records.get(claimHash);
    if (rec) {
      rec.conflictScore = 0;
      rec.stances.clear();
      rec.counts = {};
      this.callbacks.onConflictResolved?.(claimHash);
    }
  }

  /**
   * Remove old observations for a claim
   */
  prune(claimHash: string, maxAge: number, now = Date.now()): void {
    const rec = this.records.get(claimHash);
    if (!rec) return;

    for (const [peerId, obs] of rec.stances) {
      if (now - obs.ts > maxAge) {
        rec.stances.delete(peerId);
      }
    }

    // Rebuild counts
    rec.counts = {};
    for (const s of rec.stances.values()) {
      rec.counts[s.stance] = (rec.counts[s.stance] ?? 0) + 1;
    }

    rec.conflictScore = this.computeScore(rec);
  }

  /**
   * Get count of tracked claims
   */
  get size(): number {
    return this.records.size;
  }

  /**
   * Clear all records
   */
  clear(): void {
    this.records.clear();
  }

  /**
   * Export for audit
   */
  export(): Array<{
    claimHash: string;
    meaning?: string;
    conflictScore: number;
    stanceCount: number;
    counts: Record<string, number>;
  }> {
    return this.all().map(r => ({
      claimHash: r.claimHash,
      meaning: r.meaning,
      conflictScore: r.conflictScore,
      stanceCount: r.stances.size,
      counts: r.counts,
    }));
  }
}
