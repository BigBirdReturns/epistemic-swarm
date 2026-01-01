/**
 * Propagation
 * ===========
 * 
 * Handles signal propagation with verification, deduplication,
 * and reputation-weighted forwarding.
 */

import { 
  Transport, 
  PeerId, 
  LearningSignal,
  SwarmConfig,
  DEFAULT_CONFIG 
} from './types/index.js';
import { verifySignal } from './signal.js';
import { nowMs, hashJson } from './util/hash.js';
import { ReputationSystem } from './security/reputation.js';
import { QuarantineSystem } from './security/quarantine.js';

export interface PropagationCallbacks {
  onAccepted?: (signal: LearningSignal, from: PeerId) => void;
  onRejected?: (signal: LearningSignal, from: PeerId, reason: string) => void;
}

export class Propagation {
  private seen = new Set<string>();
  private config: SwarmConfig;
  private callbacks: PropagationCallbacks = {};

  constructor(
    private transport: Transport,
    private reputation: ReputationSystem,
    private quarantine: QuarantineSystem,
    config: Partial<SwarmConfig> = {}
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Set callbacks
   */
  setCallbacks(callbacks: PropagationCallbacks): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  /**
   * Publish a locally-generated signal
   */
  async publish(signal: LearningSignal): Promise<void> {
    const ok = await verifySignal(signal);
    if (!ok) {
      throw new Error('Refusing to publish unsigned/invalid signal');
    }

    this.markSeen(this.signalKey(signal));
    this.forward(signal, this.transport.id);
  }

  /**
   * Handle an incoming signal
   */
  async onIncoming(signal: LearningSignal, from: PeerId): Promise<LearningSignal | null> {
    // Check if sender is quarantined
    if (this.quarantine.isQuarantined(from)) {
      this.callbacks.onRejected?.(signal, from, 'Sender quarantined');
      return null;
    }

    // Verify signature
    const ok = await verifySignal(signal);
    if (!ok) {
      this.reputation.recordFailure(from);
      this.callbacks.onRejected?.(signal, from, 'Invalid signature');
      return null;
    }

    // TTL gate
    if (signal.ttl <= 0) {
      this.callbacks.onRejected?.(signal, from, 'TTL expired');
      return null;
    }

    // Dedupe
    const key = this.signalKey(signal);
    if (this.seen.has(key)) {
      return null; // Silent dedupe, not a rejection
    }

    this.markSeen(key);

    // Record success for sender
    this.reputation.recordSuccess(from);

    // Forward with decremented TTL
    const forwarded: LearningSignal = { ...signal, ttl: signal.ttl - 1 };
    this.forward(forwarded, from);

    this.callbacks.onAccepted?.(signal, from);
    return signal;
  }

  /**
   * Forward a signal to peers
   */
  private forward(signal: LearningSignal, from: PeerId): void {
    // Don't forward if we're quarantined
    if (this.quarantine.isQuarantined(this.transport.id)) {
      return;
    }

    const msg = {
      type: 'LEARNING_SIGNAL' as const,
      from: this.transport.id,
      ts: nowMs(),
      signal,
    };

    this.transport.broadcast(msg);
  }

  /**
   * Generate dedupe key for a signal
   */
  private signalKey(signal: LearningSignal): string {
    return hashJson({
      s: signal.source_id,
      id: signal.signal_id,
      p: signal.payload,
      d: signal.domain,
    });
  }

  /**
   * Mark a signal as seen
   */
  private markSeen(key: string): void {
    this.seen.add(key);
    
    // Crude eviction when too large
    if (this.seen.size > this.config.maxSeenSignals) {
      const arr = Array.from(this.seen);
      this.seen = new Set(arr.slice(arr.length - Math.floor(this.config.maxSeenSignals * 0.9)));
    }
  }

  /**
   * Check if a signal has been seen
   */
  hasSeen(signal: LearningSignal): boolean {
    return this.seen.has(this.signalKey(signal));
  }

  /**
   * Get count of seen signals
   */
  get seenCount(): number {
    return this.seen.size;
  }

  /**
   * Clear seen set (for testing)
   */
  clearSeen(): void {
    this.seen.clear();
  }
}
