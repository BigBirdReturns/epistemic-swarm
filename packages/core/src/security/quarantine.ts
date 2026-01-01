/**
 * Quarantine System
 * =================
 * 
 * Isolates peers that have triggered drift or other violations.
 * Quarantined peers have reduced influence and restricted propagation.
 */

import {
  PeerId,
  DriftReason,
  SwarmConfig,
  DEFAULT_CONFIG,
} from '../types/index.js';

export interface QuarantineEntry {
  peerId: PeerId;
  reason: DriftReason;
  quarantinedAt: number;
  expiresAt: number;
  violations: number;
}

export class QuarantineSystem {
  private quarantined = new Map<PeerId, QuarantineEntry>();
  private config: SwarmConfig;
  private listeners: Array<(peerId: PeerId, entry: QuarantineEntry | null) => void> = [];

  // Base quarantine duration: 30 seconds
  private baseQuarantineDurationMs = 30_000;

  constructor(config: Partial<SwarmConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Quarantine a peer
   */
  quarantine(peerId: PeerId, reason: DriftReason, now = Date.now()): QuarantineEntry {
    const existing = this.quarantined.get(peerId);
    const violations = existing ? existing.violations + 1 : 1;
    
    // Exponential backoff: each violation doubles quarantine time
    const duration = this.baseQuarantineDurationMs * Math.pow(2, violations - 1);

    const entry: QuarantineEntry = {
      peerId,
      reason,
      quarantinedAt: now,
      expiresAt: now + duration,
      violations,
    };

    this.quarantined.set(peerId, entry);
    this.notifyListeners(peerId, entry);

    return entry;
  }

  /**
   * Check if a peer is quarantined
   */
  isQuarantined(peerId: PeerId, now = Date.now()): boolean {
    const entry = this.quarantined.get(peerId);
    if (!entry) return false;
    
    if (now >= entry.expiresAt) {
      this.release(peerId);
      return false;
    }
    
    return true;
  }

  /**
   * Release a peer from quarantine
   */
  release(peerId: PeerId): boolean {
    const existed = this.quarantined.delete(peerId);
    if (existed) {
      this.notifyListeners(peerId, null);
    }
    return existed;
  }

  /**
   * Get quarantine entry for a peer
   */
  getEntry(peerId: PeerId): QuarantineEntry | undefined {
    return this.quarantined.get(peerId);
  }

  /**
   * Get remaining quarantine time
   */
  getRemaining(peerId: PeerId, now = Date.now()): number {
    const entry = this.quarantined.get(peerId);
    if (!entry) return 0;
    return Math.max(0, entry.expiresAt - now);
  }

  /**
   * Check for expired quarantines and release them
   */
  checkExpirations(now = Date.now()): PeerId[] {
    const released: PeerId[] = [];

    for (const [peerId, entry] of this.quarantined) {
      if (now >= entry.expiresAt) {
        this.quarantined.delete(peerId);
        released.push(peerId);
        this.notifyListeners(peerId, null);
      }
    }

    return released;
  }

  /**
   * Get influence multiplier for a peer (0 if quarantined)
   */
  getInfluenceMultiplier(peerId: PeerId, now = Date.now()): number {
    if (this.isQuarantined(peerId, now)) {
      return 0;
    }
    return 1.0;
  }

  /**
   * Check if peer can propagate signals
   */
  canPropagate(peerId: PeerId, now = Date.now()): boolean {
    return !this.isQuarantined(peerId, now);
  }

  /**
   * Check if peer can receive signals
   */
  canReceive(peerId: PeerId, now = Date.now()): boolean {
    // Quarantined peers can still receive, but not propagate
    // This allows them to resync when released
    return true;
  }

  /**
   * Add listener for quarantine changes
   */
  onQuarantineChange(listener: (peerId: PeerId, entry: QuarantineEntry | null) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private notifyListeners(peerId: PeerId, entry: QuarantineEntry | null): void {
    for (const listener of this.listeners) {
      listener(peerId, entry);
    }
  }

  /**
   * Get count of quarantined peers
   */
  get count(): number {
    return this.quarantined.size;
  }

  /**
   * Get all quarantined peers
   */
  getAll(): QuarantineEntry[] {
    return Array.from(this.quarantined.values());
  }

  /**
   * Export for audit
   */
  export(): QuarantineEntry[] {
    return this.getAll();
  }
}
