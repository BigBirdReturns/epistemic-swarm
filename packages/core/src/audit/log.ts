/**
 * Audit Log
 * =========
 * 
 * Hash-chained event log for full auditability.
 * Supports provenance queries and deterministic replay.
 */

import { 
  LogEntry, 
  LogKind, 
  PeerId,
  BeliefState,
  LearningSignal,
  DriftEvent,
  PatternBundle,
  AuthorityWindow
} from './types/index.js';
import { hashJson, nowMs } from './util/hash.js';

export interface ProvenanceChain {
  claimHash: string;
  entries: Array<{
    ts: number;
    kind: LogKind;
    signalId?: string;
    sourceId?: string;
    data: unknown;
  }>;
}

export class AuditLog {
  private entries: LogEntry[] = [];
  private lastHash: string | null = null;
  private counter = 0;

  /**
   * Append an entry to the log
   */
  append(kind: LogKind, data: unknown, peerId?: PeerId): LogEntry {
    const entry: LogEntry = {
      i: this.counter++,
      ts: nowMs(),
      kind,
      peerId,
      data,
      prev: this.lastHash,
      hash: '', // Will be computed
    };

    entry.hash = hashJson({
      i: entry.i,
      ts: entry.ts,
      kind: entry.kind,
      peerId: entry.peerId,
      data: entry.data,
      prev: entry.prev,
    });

    this.lastHash = entry.hash;
    this.entries.push(entry);

    return entry;
  }

  // Convenience methods for common log types

  logSignalSent(signal: LearningSignal, to?: PeerId): LogEntry {
    return this.append(to ? 'OUT_SEND' : 'OUT_BROADCAST', { signal }, signal.source_id);
  }

  logSignalReceived(signal: LearningSignal, from: PeerId): LogEntry {
    return this.append('IN', { signal, from }, signal.source_id);
  }

  logGrant(window: AuthorityWindow): LogEntry {
    return this.append('GRANT', { window }, window.peerId);
  }

  logDeny(peerId: PeerId, reason: string): LogEntry {
    return this.append('DENY', { reason }, peerId);
  }

  logRevoke(peerId: PeerId, windowId: string, reason: string): LogEntry {
    return this.append('REVOKE', { windowId, reason }, peerId);
  }

  logDrift(event: DriftEvent): LogEntry {
    return this.append('DRIFT', event, event.peerId);
  }

  logTStateChange(oldState: string, newState: string): LogEntry {
    return this.append('T_STATE_CHANGE', { oldState, newState });
  }

  logPatternGenerated(bundle: PatternBundle): LogEntry {
    return this.append('PATTERN_GENERATED', { bundle }, bundle.generatedBy);
  }

  logPatternAdopted(bundleId: string, by: PeerId): LogEntry {
    return this.append('PATTERN_ADOPTED', { bundleId }, by);
  }

  logConflictDetected(claimHash: string, score: number): LogEntry {
    return this.append('CONFLICT_DETECTED', { claimHash, score });
  }

  logRollback(snapshotTs: number, reason: string): LogEntry {
    return this.append('ROLLBACK', { snapshotTs, reason });
  }

  logAction(action: string, details: unknown, peerId?: PeerId): LogEntry {
    return this.append('ACTION', { action, details }, peerId);
  }

  /**
   * Verify chain integrity
   */
  verify(): { valid: boolean; brokenAt?: number } {
    let prevHash: string | null = null;

    for (const entry of this.entries) {
      // Verify prev pointer
      if (entry.prev !== prevHash) {
        return { valid: false, brokenAt: entry.i };
      }

      // Recompute hash
      const computed = hashJson({
        i: entry.i,
        ts: entry.ts,
        kind: entry.kind,
        peerId: entry.peerId,
        data: entry.data,
        prev: entry.prev,
      });

      if (computed !== entry.hash) {
        return { valid: false, brokenAt: entry.i };
      }

      prevHash = entry.hash;
    }

    return { valid: true };
  }

  /**
   * Build provenance chain for a claim
   */
  traceProvenance(claimHash: string): ProvenanceChain {
    const chain: ProvenanceChain = {
      claimHash,
      entries: [],
    };

    for (const entry of this.entries) {
      const data = entry.data as any;
      
      // Check if this entry relates to the claim
      let relates = false;
      let signalId: string | undefined;
      let sourceId: string | undefined;

      if (data?.signal?.payload?.claim_hash === claimHash) {
        relates = true;
        signalId = data.signal.signal_id;
        sourceId = data.signal.source_id;
      } else if (data?.claimHash === claimHash) {
        relates = true;
      }

      if (relates) {
        chain.entries.push({
          ts: entry.ts,
          kind: entry.kind,
          signalId,
          sourceId,
          data: entry.data,
        });
      }
    }

    return chain;
  }

  /**
   * Get entries for a specific peer
   */
  forPeer(peerId: PeerId): LogEntry[] {
    return this.entries.filter(e => e.peerId === peerId);
  }

  /**
   * Get entries by kind
   */
  byKind(kind: LogKind): LogEntry[] {
    return this.entries.filter(e => e.kind === kind);
  }

  /**
   * Get entries in a time range
   */
  inRange(start: number, end: number): LogEntry[] {
    return this.entries.filter(e => e.ts >= start && e.ts <= end);
  }

  /**
   * Get entry by index
   */
  get(index: number): LogEntry | undefined {
    return this.entries[index];
  }

  /**
   * Get latest entry
   */
  latest(): LogEntry | undefined {
    return this.entries[this.entries.length - 1];
  }

  /**
   * Get all entries
   */
  all(): LogEntry[] {
    return [...this.entries];
  }

  /**
   * Get count of entries
   */
  get size(): number {
    return this.entries.length;
  }

  /**
   * Export to JSONL format
   */
  toJSONL(): string {
    return this.entries.map(e => JSON.stringify(e)).join('\n');
  }

  /**
   * Import from JSONL format
   */
  static fromJSONL(jsonl: string): AuditLog {
    const log = new AuditLog();
    const lines = jsonl.trim().split('\n').filter(l => l);
    
    for (const line of lines) {
      const entry = JSON.parse(line) as LogEntry;
      log.entries.push(entry);
      log.lastHash = entry.hash;
      log.counter = entry.i + 1;
    }

    return log;
  }

  /**
   * Export for external storage
   */
  export(): {
    entries: LogEntry[];
    lastHash: string | null;
  } {
    return {
      entries: this.all(),
      lastHash: this.lastHash,
    };
  }
}
