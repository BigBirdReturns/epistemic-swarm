/**
 * Pattern Bundles
 * ===============
 * 
 * Learns from successful behavior and propagates patterns to peers.
 * Integrates with authority context to ensure patterns are valid.
 */

import {
  PeerId,
  PatternBundle,
  PatternStatus,
  TState,
  Stance,
  SwarmConfig,
  DEFAULT_CONFIG,
  Transport,
  WireMessage
} from './types/index.js';
import { BeliefStore } from './beliefs.js';
import { TStateManager } from './authority/tstate.js';
import { ReputationSystem } from './security/reputation.js';
import { nowMs, generateId, hashJson } from './util/hash.js';

export interface PatternCallbacks {
  onBundleGenerated?: (bundle: PatternBundle) => void;
  onBundleReceived?: (bundle: PatternBundle) => void;
  onBundleAdopted?: (bundle: PatternBundle) => void;
  onBundleRejected?: (bundle: PatternBundle, reason: string) => void;
}

export class PatternBundleManager {
  private bundles = new Map<string, PatternBundle>();
  private successCount = 0;
  private failureCount = 0;
  private config: SwarmConfig;
  private callbacks: PatternCallbacks = {};

  constructor(
    private transport: Transport,
    private beliefs: BeliefStore,
    private tStateManager: TStateManager,
    private reputation: ReputationSystem,
    config: Partial<SwarmConfig> = {}
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Set callbacks
   */
  setCallbacks(callbacks: PatternCallbacks): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  /**
   * Start listening for pattern messages
   */
  start(): void {
    this.transport.onMessage((m) => this.onWire(m));
  }

  /**
   * Record a successful action
   */
  recordSuccess(): void {
    this.successCount++;
    this.checkGeneration();
  }

  /**
   * Record a failed action
   */
  recordFailure(): void {
    this.failureCount++;
  }

  /**
   * Check if we should generate a pattern bundle
   */
  private checkGeneration(): void {
    const total = this.successCount + this.failureCount;
    if (total < this.config.patternBundleThreshold) return;

    const successRate = this.successCount / total;
    if (successRate < this.config.minSuccessRateForBundle) {
      // Reset and try again later
      this.successCount = 0;
      this.failureCount = 0;
      return;
    }

    // Generate bundle
    const bundle = this.generateBundle(successRate);
    this.bundles.set(bundle.id, bundle);

    // Reset counters
    this.successCount = 0;
    this.failureCount = 0;

    this.callbacks.onBundleGenerated?.(bundle);

    // Propagate if conditions allow
    if (this.tStateManager.canPropagateLearning()) {
      this.propagate(bundle);
    }
  }

  /**
   * Generate a pattern bundle from current beliefs
   */
  private generateBundle(successRate: number): PatternBundle {
    const beliefs = this.beliefs.all();
    const claimHashes = beliefs.map(b => b.claimHash);
    const stances: Record<string, Stance> = {};
    
    let totalConfidence = 0;
    for (const belief of beliefs) {
      stances[belief.claimHash] = belief.stance;
      totalConfidence += belief.confidence;
    }

    return {
      id: generateId('PB'),
      generatedAt: nowMs(),
      generatedBy: this.transport.id,
      context: {
        tState: this.tStateManager.state,
        peerCount: 0, // Would come from membership
        conflictLevel: 0, // Would come from conflict detector
      },
      pattern: {
        claimHashes,
        stances,
        confidence: beliefs.length > 0 ? totalConfidence / beliefs.length : 0,
      },
      performance: {
        successRate,
        adoptions: 0,
      },
      authorityContext: {
        tState: this.tStateManager.state,
        scopeHash: hashJson({ claims: claimHashes.sort() }),
      },
      status: 'local' as PatternStatus,
    };
  }

  /**
   * Propagate a bundle to peers
   */
  propagate(bundle: PatternBundle): void {
    bundle.status = 'propagating';
    
    this.transport.broadcast({
      type: 'PATTERN_BUNDLE',
      from: this.transport.id,
      ts: nowMs(),
      bundle,
    });
  }

  /**
   * Evaluate if a received bundle should be adopted
   */
  evaluate(bundle: PatternBundle): { adopt: boolean; reason?: string } {
    // Check T-state compatibility
    if (bundle.authorityContext.tState !== this.tStateManager.state) {
      return { adopt: false, reason: `T-state mismatch: ${bundle.authorityContext.tState} vs ${this.tStateManager.state}` };
    }

    // Check performance threshold
    if (bundle.performance.successRate < this.config.minSuccessRateForBundle) {
      return { adopt: false, reason: `Low success rate: ${bundle.performance.successRate}` };
    }

    // Check sender reputation
    const senderRep = this.reputation.getScore(bundle.generatedBy);
    if (senderRep < this.config.minReputationForVote) {
      return { adopt: false, reason: `Low sender reputation: ${senderRep}` };
    }

    return { adopt: true };
  }

  /**
   * Adopt a pattern bundle (apply its beliefs)
   */
  adopt(bundle: PatternBundle): void {
    for (const [claimHash, stance] of Object.entries(bundle.pattern.stances)) {
      const existing = this.beliefs.get(claimHash);
      
      // Only adopt if we don't have a stronger belief
      if (!existing || existing.confidence < bundle.pattern.confidence) {
        // Create a synthetic signal to apply
        this.beliefs.apply({
          source_id: bundle.generatedBy,
          signal_id: `${bundle.id}-adopted`,
          timestamp: nowMs(),
          domain: 'pattern-adoption',
          signal_type: 'delta',
          payload: {
            claim_hash: claimHash,
            direction: stance,
            confidence: bundle.pattern.confidence,
          },
          ttl: 0,
          scope: 'local',
          signature: '',
        });
      }
    }

    bundle.status = 'adopted';
    bundle.performance.adoptions++;
    this.bundles.set(bundle.id, bundle);

    this.callbacks.onBundleAdopted?.(bundle);
  }

  /**
   * Handle wire messages
   */
  private onWire(m: WireMessage): void {
    if (m.type === 'PATTERN_BUNDLE') {
      this.handleBundle(m);
    }
  }

  /**
   * Handle incoming pattern bundle
   */
  private handleBundle(m: WireMessage & { type: 'PATTERN_BUNDLE' }): void {
    const bundle = m.bundle;

    // Don't process our own bundles
    if (bundle.generatedBy === this.transport.id) return;

    // Don't process duplicates
    if (this.bundles.has(bundle.id)) return;

    this.callbacks.onBundleReceived?.(bundle);

    // Evaluate and potentially adopt
    const { adopt, reason } = this.evaluate(bundle);

    if (adopt) {
      this.adopt(bundle);
    } else {
      bundle.status = 'rejected';
      this.bundles.set(bundle.id, bundle);
      this.callbacks.onBundleRejected?.(bundle, reason!);
    }
  }

  /**
   * Get a bundle by ID
   */
  getBundle(id: string): PatternBundle | undefined {
    return this.bundles.get(id);
  }

  /**
   * Get all bundles
   */
  getAllBundles(): PatternBundle[] {
    return Array.from(this.bundles.values());
  }

  /**
   * Get bundles by status
   */
  getBundlesByStatus(status: PatternStatus): PatternBundle[] {
    return this.getAllBundles().filter(b => b.status === status);
  }

  /**
   * Export for audit
   */
  export(): {
    bundles: PatternBundle[];
    stats: { successCount: number; failureCount: number };
  } {
    return {
      bundles: this.getAllBundles(),
      stats: {
        successCount: this.successCount,
        failureCount: this.failureCount,
      },
    };
  }
}
