/**
 * Replay
 * ======
 * 
 * Deterministic replay from audit logs.
 * Allows reconstruction of state at any point in time.
 */

import { 
  LogEntry, 
  LogKind, 
  LearningSignal,
  BeliefState,
  PeerId 
} from './types/index.js';
import { AuditLog } from './audit/log.js';
import { BeliefStore } from './beliefs.js';

export interface ReplayState {
  tick: number;
  ts: number;
  beliefs: Record<string, BeliefState>;
  signals: LearningSignal[];
  peers: Set<PeerId>;
}

export interface ReplayCallbacks {
  onEntry?: (entry: LogEntry, state: ReplayState) => void;
  onComplete?: (state: ReplayState) => void;
}

export class Replay {
  private state: ReplayState;
  private currentIndex = 0;
  private callbacks: ReplayCallbacks = {};

  constructor(
    private log: AuditLog
  ) {
    this.state = {
      tick: 0,
      ts: 0,
      beliefs: {},
      signals: [],
      peers: new Set(),
    };
  }

  /**
   * Set callbacks
   */
  setCallbacks(callbacks: ReplayCallbacks): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  /**
   * Reset to beginning
   */
  reset(): void {
    this.currentIndex = 0;
    this.state = {
      tick: 0,
      ts: 0,
      beliefs: {},
      signals: [],
      peers: new Set(),
    };
  }

  /**
   * Step forward one entry
   */
  step(): LogEntry | null {
    const entry = this.log.get(this.currentIndex);
    if (!entry) return null;

    this.applyEntry(entry);
    this.currentIndex++;

    this.callbacks.onEntry?.(entry, this.getState());

    return entry;
  }

  /**
   * Step forward multiple entries
   */
  stepN(n: number): LogEntry[] {
    const entries: LogEntry[] = [];
    for (let i = 0; i < n; i++) {
      const entry = this.step();
      if (!entry) break;
      entries.push(entry);
    }
    return entries;
  }

  /**
   * Replay to a specific timestamp
   */
  replayToTime(targetTs: number): ReplayState {
    this.reset();

    while (this.currentIndex < this.log.size) {
      const entry = this.log.get(this.currentIndex);
      if (!entry || entry.ts > targetTs) break;
      this.applyEntry(entry);
      this.currentIndex++;
    }

    this.callbacks.onComplete?.(this.getState());
    return this.getState();
  }

  /**
   * Replay to a specific index
   */
  replayToIndex(targetIndex: number): ReplayState {
    this.reset();

    while (this.currentIndex <= targetIndex && this.currentIndex < this.log.size) {
      const entry = this.log.get(this.currentIndex);
      if (!entry) break;
      this.applyEntry(entry);
      this.currentIndex++;
    }

    this.callbacks.onComplete?.(this.getState());
    return this.getState();
  }

  /**
   * Replay entire log
   */
  replayAll(): ReplayState {
    this.reset();

    while (this.currentIndex < this.log.size) {
      const entry = this.log.get(this.currentIndex);
      if (!entry) break;
      this.applyEntry(entry);
      this.currentIndex++;
    }

    this.callbacks.onComplete?.(this.getState());
    return this.getState();
  }

  /**
   * Apply a log entry to state
   */
  private applyEntry(entry: LogEntry): void {
    this.state.tick++;
    this.state.ts = entry.ts;

    if (entry.peerId) {
      this.state.peers.add(entry.peerId);
    }

    const data = entry.data as any;

    switch (entry.kind) {
      case 'IN':
      case 'OUT_SEND':
      case 'OUT_BROADCAST':
        if (data?.signal) {
          const signal = data.signal as LearningSignal;
          this.state.signals.push(signal);
          
          // Apply to beliefs
          const claimHash = signal.payload.claim_hash;
          const existing = this.state.beliefs[claimHash];
          
          if (!existing || signal.timestamp > existing.updatedAt) {
            this.state.beliefs[claimHash] = {
              claimHash,
              stance: signal.payload.direction,
              confidence: signal.payload.confidence,
              updatedAt: signal.timestamp,
              lastSignalId: signal.signal_id,
              lastSourceId: signal.source_id,
            };
          }
        }
        break;

      case 'ROLLBACK':
        // If we had snapshot data, we'd restore here
        // For now, just note it happened
        break;
    }
  }

  /**
   * Get current state (copy)
   */
  getState(): ReplayState {
    return {
      tick: this.state.tick,
      ts: this.state.ts,
      beliefs: { ...this.state.beliefs },
      signals: [...this.state.signals],
      peers: new Set(this.state.peers),
    };
  }

  /**
   * Get current index
   */
  get index(): number {
    return this.currentIndex;
  }

  /**
   * Check if replay is complete
   */
  get isComplete(): boolean {
    return this.currentIndex >= this.log.size;
  }

  /**
   * Get progress as percentage
   */
  get progress(): number {
    if (this.log.size === 0) return 100;
    return (this.currentIndex / this.log.size) * 100;
  }

  /**
   * Compare two replay states for divergence
   */
  static compareDivergence(
    a: ReplayState, 
    b: ReplayState
  ): {
    divergent: boolean;
    beliefDiffs: Array<{ claimHash: string; a?: BeliefState; b?: BeliefState }>;
    peerDiffs: { onlyInA: PeerId[]; onlyInB: PeerId[] };
  } {
    const beliefDiffs: Array<{ claimHash: string; a?: BeliefState; b?: BeliefState }> = [];
    
    const allClaims = new Set([
      ...Object.keys(a.beliefs),
      ...Object.keys(b.beliefs),
    ]);

    for (const claimHash of allClaims) {
      const beliefA = a.beliefs[claimHash];
      const beliefB = b.beliefs[claimHash];

      if (!beliefA || !beliefB) {
        beliefDiffs.push({ claimHash, a: beliefA, b: beliefB });
      } else if (beliefA.stance !== beliefB.stance || beliefA.confidence !== beliefB.confidence) {
        beliefDiffs.push({ claimHash, a: beliefA, b: beliefB });
      }
    }

    const onlyInA = [...a.peers].filter(p => !b.peers.has(p));
    const onlyInB = [...b.peers].filter(p => !a.peers.has(p));

    return {
      divergent: beliefDiffs.length > 0 || onlyInA.length > 0 || onlyInB.length > 0,
      beliefDiffs,
      peerDiffs: { onlyInA, onlyInB },
    };
  }
}
