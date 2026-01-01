/**
 * Swarm Node
 * ==========
 * 
 * The main orchestrator that ties all components together.
 * This is the thing you instantiate to join a swarm.
 */

import {
  PeerId,
  Transport,
  WireMessage,
  LearningSignal,
  SwarmConfig,
  DEFAULT_CONFIG,
  TState,
  DriftReason,
  AuthorityWindow,
} from './types/index.js';

// Authority
import { TStateManager } from './authority/tstate.js';
import { AuthorityManager } from './authority/manager.js';
import { DriftDetector } from './authority/drift.js';

// Security
import { ReputationSystem } from './security/reputation.js';
import { QuarantineSystem } from './security/quarantine.js';
import { AdmissionController } from './security/admission.js';

// Core
import { BeliefStore } from './beliefs.js';
import { Membership } from './membership.js';
import { Propagation } from './propagation.js';
import { ConflictAccumulator } from './conflict.js';
import { Checkpoints } from './checkpoint.js';
import { RollbackLog } from './rollback.js';
import { Arbitration } from './arbitration.js';
import { PatternBundleManager } from './patterns.js';

// Audit
import { AuditLog } from './audit/log.js';

import { SignalBuilder, createSignalBuilder, buildSignal } from './signal.js';
import { nowMs } from './util/hash.js';

export interface SwarmNodeCallbacks {
  onSignalReceived?: (signal: LearningSignal, from: PeerId) => void;
  onBeliefUpdated?: (claimHash: string, stance: string, confidence: number) => void;
  onConflictDetected?: (claimHash: string, score: number) => void;
  onDriftDetected?: (peerId: PeerId, reason: DriftReason) => void;
  onTStateChanged?: (oldState: TState, newState: TState) => void;
  onAuthorityGranted?: (window: AuthorityWindow) => void;
  onAuthorityRevoked?: (peerId: PeerId, reason: DriftReason) => void;
  onPeerJoined?: (peerId: PeerId) => void;
  onPeerLeft?: (peerId: PeerId) => void;
}

export class SwarmNode {
  // Core identity
  readonly id: PeerId;
  private signalBuilder: SignalBuilder;

  // Config
  private config: SwarmConfig;

  // Components
  readonly tState: TStateManager;
  readonly authority: AuthorityManager;
  readonly drift: DriftDetector;
  readonly reputation: ReputationSystem;
  readonly quarantine: QuarantineSystem;
  readonly admission: AdmissionController;
  readonly beliefs: BeliefStore;
  readonly membership: Membership;
  readonly propagation: Propagation;
  readonly conflicts: ConflictAccumulator;
  readonly checkpoints: Checkpoints;
  readonly rollback: RollbackLog;
  readonly arbitration: Arbitration;
  readonly patterns: PatternBundleManager;
  readonly audit: AuditLog;

  // State
  private started = false;
  private tick = 0;
  private callbacks: SwarmNodeCallbacks = {};

  constructor(
    private transport: Transport,
    private privateKey: string,
    config: Partial<SwarmConfig> = {}
  ) {
    this.id = transport.id;
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Initialize signal builder
    this.signalBuilder = createSignalBuilder(this.id, privateKey, 'default');

    // Initialize components
    this.tState = new TStateManager(this.config);
    this.authority = new AuthorityManager(this.tState, this.config);
    this.drift = new DriftDetector(this.config);
    this.reputation = new ReputationSystem(this.config);
    this.quarantine = new QuarantineSystem(this.config);
    this.admission = new AdmissionController(
      this.reputation,
      this.quarantine,
      this.tState,
      this.config
    );
    this.beliefs = new BeliefStore();
    this.membership = new Membership(transport, this.tState, this.config);
    this.propagation = new Propagation(
      transport,
      this.reputation,
      this.quarantine,
      this.config
    );
    this.conflicts = new ConflictAccumulator(this.config);
    this.checkpoints = new Checkpoints(transport, this.beliefs, this.conflicts);
    this.rollback = new RollbackLog(this.beliefs);
    this.arbitration = new Arbitration(
      transport,
      this.conflicts,
      this.reputation,
      this.quarantine,
      this.config
    );
    this.patterns = new PatternBundleManager(
      transport,
      this.beliefs,
      this.tState,
      this.reputation,
      this.config
    );
    this.audit = new AuditLog();

    this.wireCallbacks();
  }

  /**
   * Set external callbacks
   */
  setCallbacks(callbacks: SwarmNodeCallbacks): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  /**
   * Wire internal component callbacks
   */
  private wireCallbacks(): void {
    // T-State changes
    this.tState.onStateChange((oldState, newState) => {
      this.audit.logTStateChange(oldState, newState);
      this.authority.shrinkWindows();
      this.callbacks.onTStateChanged?.(oldState, newState);
    });

    // Authority events
    this.authority.setCallbacks({
      onGrant: (peerId, window) => {
        this.audit.logGrant(window);
        this.drift.endHold(peerId);
        this.callbacks.onAuthorityGranted?.(window);
      },
      onDeny: (peerId, reason) => {
        this.audit.logDeny(peerId, reason);
      },
      onRevoke: (peerId, reason) => {
        this.audit.logRevoke(peerId, '', reason);
        this.quarantine.quarantine(peerId, reason);
        this.reputation.recordViolation(peerId, reason);
        this.callbacks.onAuthorityRevoked?.(peerId, reason);
      },
      onExpire: (peerId, windowId) => {
        this.audit.logRevoke(peerId, windowId, 'expired');
      },
    });

    // Drift events
    this.drift.onDrift((event) => {
      this.audit.logDrift(event);
      this.authority.revoke(event.peerId, event.reason);
      this.callbacks.onDriftDetected?.(event.peerId, event.reason);
    });

    // Propagation events
    this.propagation.setCallbacks({
      onAccepted: (signal, from) => {
        this.audit.logSignalReceived(signal, from);
        const belief = this.beliefs.apply(signal);
        
        // Update drift detector
        this.drift.updateBelief(
          from,
          signal.payload.claim_hash,
          signal.payload.direction,
          signal.payload.confidence
        );

        // Update conflict accumulator
        this.conflicts.observeBelief(
          from,
          signal.payload.claim_hash,
          signal.payload.direction,
          signal.payload.confidence,
          signal.timestamp
        );

        this.callbacks.onSignalReceived?.(signal, from);
        this.callbacks.onBeliefUpdated?.(
          signal.payload.claim_hash,
          belief.stance,
          belief.confidence
        );
      },
    });

    // Conflict events
    this.conflicts.setCallbacks({
      onConflictDetected: (record) => {
        this.audit.logConflictDetected(record.claimHash, record.conflictScore);
        this.rollback.checkpoint(`conflict-${record.claimHash}`);
        this.callbacks.onConflictDetected?.(record.claimHash, record.conflictScore);
      },
    });

    // Pattern events
    this.patterns.setCallbacks({
      onBundleGenerated: (bundle) => {
        this.audit.logPatternGenerated(bundle);
      },
      onBundleAdopted: (bundle) => {
        this.audit.logPatternAdopted(bundle.id, this.id);
      },
    });
  }

  /**
   * Start the node
   */
  start(): void {
    if (this.started) return;
    this.started = true;

    this.membership.start();
    this.checkpoints.start();
    this.arbitration.start();
    this.patterns.start();

    // Listen for signals
    this.membership.onMessage(async (m) => {
      if (m.type === 'LEARNING_SIGNAL') {
        await this.propagation.onIncoming(m.signal, m.from);
      }
    });

    this.audit.logAction('node_started', { id: this.id });
  }

  /**
   * Process one tick
   */
  async processTick(): Promise<void> {
    const now = nowMs();
    this.tick++;

    // Update membership
    this.membership.tick(now);

    // Check authority expirations
    this.authority.checkExpirations(now);
    this.authority.advanceTick();

    // Check quarantine expirations
    this.quarantine.checkExpirations(now);

    // Check drift
    const consensusBeliefs = this.beliefs.getConsensus();
    this.drift.check(consensusBeliefs, now);

    // Update T-state
    this.tState.update(now);
    this.tState.prune(now);

    // Prune old data
    if (this.tick % 100 === 0) {
      this.checkpoints.prune();
      this.arbitration.prune();
    }
  }

  /**
   * Publish a new belief signal
   */
  async publishBelief(
    claimHash: string,
    direction: 'strengthen' | 'weaken' | 'retract',
    confidence: number,
    options: { domain?: string; scope?: 'local' | 'cluster' | 'global' } = {}
  ): Promise<LearningSignal> {
    if (options.domain) {
      this.signalBuilder.domain = options.domain;
    }

    const signal = await buildSignal(
      this.signalBuilder,
      {
        claim_hash: claimHash,
        direction,
        confidence,
      },
      {
        scope: options.scope ?? 'cluster',
        ttl: this.config.defaultTtl,
      }
    );

    await this.propagation.publish(signal);
    this.beliefs.apply(signal);
    this.audit.logSignalSent(signal);

    // Record success for pattern generation
    this.patterns.recordSuccess();

    return signal;
  }

  /**
   * Request authority to act
   */
  requestAuthority(scope: string, reason: string): string | null {
    this.drift.startHold(this.id);
    return this.authority.request(this.id, scope, reason);
  }

  /**
   * Grant authority (operator action)
   */
  grantAuthority(requestId: string): AuthorityWindow | null {
    return this.authority.grant(requestId);
  }

  /**
   * Deny authority (operator action)
   */
  denyAuthority(requestId: string, reason: string): boolean {
    return this.authority.deny(requestId, reason);
  }

  /**
   * Check if we have authority
   */
  hasAuthority(): boolean {
    return this.authority.hasAuthority(this.id);
  }

  /**
   * Get remaining authority time
   */
  authorityRemaining(): number {
    return this.authority.getRemaining(this.id);
  }

  /**
   * Request a semantic checkpoint
   */
  requestCheckpoint(claimHash: string): string {
    return this.checkpoints.requestCheckpoint(claimHash);
  }

  /**
   * Propose arbitration for a conflict
   */
  proposeArbitration(claimHash: string, options: string[]): string {
    return this.arbitration.propose(claimHash, options);
  }

  /**
   * Vote on an arbitration proposal
   */
  vote(proposalId: string, option: string): void {
    this.arbitration.vote(proposalId, option);
  }

  /**
   * Tally and resolve an arbitration
   */
  resolveArbitration(proposalId: string): string | null {
    const winner = this.arbitration.tally(proposalId);
    if (winner) {
      this.rollback.checkpoint(`arbitration-resolved-${proposalId}`);
    }
    return winner;
  }

  /**
   * Trigger a rollback
   */
  triggerRollback(steps = 1): void {
    const snapshot = this.rollback.rollback(steps);
    if (snapshot) {
      this.audit.logRollback(snapshot.ts, snapshot.reason);
    }
  }

  /**
   * Force T-state (for testing)
   */
  forceTState(state: TState): void {
    this.tState.force(state);
  }

  /**
   * Get current status
   */
  status(): {
    id: PeerId;
    tick: number;
    tState: TState;
    peerCount: number;
    beliefCount: number;
    hasAuthority: boolean;
    authorityRemaining: number;
    quarantined: boolean;
    reputation: number;
    conflictCount: number;
    patternCount: number;
    auditEntries: number;
  } {
    return {
      id: this.id,
      tick: this.tick,
      tState: this.tState.state,
      peerCount: this.membership.peerCount,
      beliefCount: this.beliefs.size,
      hasAuthority: this.hasAuthority(),
      authorityRemaining: this.authorityRemaining(),
      quarantined: this.quarantine.isQuarantined(this.id),
      reputation: this.reputation.getScore(this.id),
      conflictCount: this.conflicts.active().length,
      patternCount: this.patterns.getAllBundles().length,
      auditEntries: this.audit.size,
    };
  }

  /**
   * Export full state for audit
   */
  export(): {
    status: ReturnType<SwarmNode['status']>;
    beliefs: ReturnType<BeliefStore['all']>;
    conflicts: ReturnType<ConflictAccumulator['export']>;
    authority: ReturnType<AuthorityManager['export']>;
    reputation: ReturnType<ReputationSystem['export']>;
    quarantine: ReturnType<QuarantineSystem['export']>;
    patterns: ReturnType<PatternBundleManager['export']>;
    audit: ReturnType<AuditLog['export']>;
  } {
    return {
      status: this.status(),
      beliefs: this.beliefs.all(),
      conflicts: this.conflicts.export(),
      authority: this.authority.export(),
      reputation: this.reputation.export(),
      quarantine: this.quarantine.export(),
      patterns: this.patterns.export(),
      audit: this.audit.export(),
    };
  }
}
