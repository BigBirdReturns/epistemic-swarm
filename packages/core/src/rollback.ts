/**
 * Rollback
 * ========
 * 
 * Manages belief snapshots for rollback during conflict resolution.
 */

import { BeliefStore, BeliefState } from './beliefs.js';

export interface Snapshot {
  ts: number;
  reason: string;
  beliefs: Record<string, BeliefState>;
}

export class RollbackLog {
  private snapshots: Snapshot[] = [];

  constructor(
    private beliefs: BeliefStore,
    private maxSnapshots = 64
  ) {}

  /**
   * Create a checkpoint snapshot
   */
  checkpoint(reason: string): void {
    this.snapshots.push({
      ts: Date.now(),
      reason,
      beliefs: this.beliefs.snapshot(),
    });

    // Bound history
    if (this.snapshots.length > this.maxSnapshots) {
      this.snapshots.shift();
    }
  }

  /**
   * Rollback to a previous state
   */
  rollback(steps = 1): Snapshot | null {
    const idx = this.snapshots.length - 1 - Math.max(0, steps - 1);
    const entry = this.snapshots[idx];
    
    if (!entry) {
      return null;
    }

    this.beliefs.restore(entry.beliefs);

    // Truncate forward history
    this.snapshots = this.snapshots.slice(0, idx + 1);

    return entry;
  }

  /**
   * Rollback to a specific timestamp
   */
  rollbackToTime(targetTs: number): Snapshot | null {
    // Find the snapshot closest to but not after targetTs
    let targetIdx = -1;
    for (let i = this.snapshots.length - 1; i >= 0; i--) {
      if (this.snapshots[i].ts <= targetTs) {
        targetIdx = i;
        break;
      }
    }

    if (targetIdx < 0) {
      return null;
    }

    const entry = this.snapshots[targetIdx];
    this.beliefs.restore(entry.beliefs);
    this.snapshots = this.snapshots.slice(0, targetIdx + 1);

    return entry;
  }

  /**
   * Get snapshot at a specific index
   */
  getSnapshot(index: number): Snapshot | undefined {
    return this.snapshots[index];
  }

  /**
   * Get the most recent snapshot
   */
  getLatest(): Snapshot | undefined {
    return this.snapshots[this.snapshots.length - 1];
  }

  /**
   * Get history of snapshots (metadata only)
   */
  history(): Array<{ ts: number; reason: string; beliefCount: number }> {
    return this.snapshots.map(s => ({
      ts: s.ts,
      reason: s.reason,
      beliefCount: Object.keys(s.beliefs).length,
    }));
  }

  /**
   * Get count of snapshots
   */
  get size(): number {
    return this.snapshots.length;
  }

  /**
   * Clear all snapshots
   */
  clear(): void {
    this.snapshots = [];
  }
}
