/**
 * Core Types for Epistemic Swarm Coordination
 * ============================================
 * 
 * These types define the foundational concepts for distributed
 * epistemic coordination with authority management.
 */

// =============================================================================
// IDENTITY
// =============================================================================

export type PeerId = string;

// =============================================================================
// T-STATE (Degradation Levels)
// =============================================================================

/**
 * T-State represents the degradation level of a node or the swarm.
 * Derived from NEWT-T tactical communications model.
 * 
 * As T-state degrades:
 * - Authority windows shrink
 * - New grants become restricted
 * - Learning propagation becomes conservative
 */
export enum TState {
  T0 = 'full_comms',           // Full authority, free coordination
  T1 = 'partial_degradation',  // Windows shrink, precompiled rules only
  T2 = 'comms_loss',           // Intent-only, no new grants
  T3 = 'extended_loss',        // Contract further, hold or retreat
  T4 = 'recontact',            // Reconciliation, restore coordination
}

/**
 * Multipliers for authority duration based on T-state
 */
export const T_STATE_MULTIPLIERS: Record<TState, number> = {
  [TState.T0]: 1.0,    // Full authority
  [TState.T1]: 0.7,    // 30% reduction
  [TState.T2]: 0.4,    // 60% reduction
  [TState.T3]: 0.1,    // 90% reduction
  [TState.T4]: 1.0,    // Restored after reconciliation
};

// =============================================================================
// AUTHORITY
// =============================================================================

export enum AuthorityStatus {
  GRANTED = 'granted',
  DENIED = 'denied',
  PENDING = 'pending',
  EXPIRED = 'expired',
  REVOKED = 'revoked',
}

export interface AuthorityWindow {
  id: string;
  peerId: PeerId;
  grantedAt: number;
  expiresAt: number;
  tStateAtGrant: TState;
  scope: string;           // Domain scope for this authority
  conditions?: Record<string, unknown>;
}

// =============================================================================
// DRIFT
// =============================================================================

export enum DriftReason {
  HOLD_TOO_LONG = 'hold_too_long',
  BELIEF_DIVERGENCE = 'belief_divergence',
  CONFIDENCE_DECAY = 'confidence_decay',
  STALE_COMMS = 'stale_comms',
  QUARANTINED = 'quarantined',
}

export interface DriftEvent {
  peerId: PeerId;
  reason: DriftReason;
  timestamp: number;
  details?: Record<string, unknown>;
}

// =============================================================================
// BELIEFS & SIGNALS
// =============================================================================

export type SignalType = 'delta' | 'correction' | 'deprecation';
export type Direction = 'strengthen' | 'weaken' | 'retract';
export type Scope = 'local' | 'cluster' | 'global';
export type Stance = 'strengthen' | 'weaken' | 'retract' | 'unknown';

export interface LearningSignalPayload {
  claim_hash: string;
  direction: Direction;
  confidence: number;
  evidence_hash?: string;
}

export interface LearningSignal {
  source_id: string;
  signal_id: string;
  timestamp: number;
  domain: string;
  signal_type: SignalType;
  payload: LearningSignalPayload;
  ttl: number;
  scope: Scope;
  signature: string;
  prior_signal?: string;
}

export interface BeliefState {
  claimHash: string;
  stance: Stance;
  confidence: number;
  updatedAt: number;
  lastSignalId?: string;
  lastSourceId?: string;
}

// =============================================================================
// CONFLICT
// =============================================================================

export interface ConflictRecord {
  claimHash: string;
  meaning?: string;
  counts: Record<string, number>;
  stances: Map<string, { stance: Stance; confidence: number; ts: number }>;
  conflictScore: number;
}

// =============================================================================
// PATTERN BUNDLES (Learning)
// =============================================================================

export type PatternStatus = 'local' | 'propagating' | 'adopted' | 'rejected';

export interface PatternBundle {
  id: string;
  generatedAt: number;
  generatedBy: PeerId;
  context: {
    tState: TState;
    peerCount: number;
    conflictLevel: number;
  };
  pattern: {
    claimHashes: string[];
    stances: Record<string, Stance>;
    confidence: number;
  };
  performance: {
    successRate: number;
    adoptions: number;
  };
  authorityContext: {
    tState: TState;
    scopeHash: string;
  };
  status: PatternStatus;
}

// =============================================================================
// REPUTATION & TRUST
// =============================================================================

export interface ReputationScore {
  peerId: PeerId;
  score: number;           // 0.0 - 1.0
  accuracy: number;        // Historical accuracy
  consistency: number;     // Belief consistency over time
  age: number;             // Ticks since first seen
  violations: number;      // Drift/quarantine count
  lastUpdated: number;
}

export interface AdmissionDecision {
  allowed: boolean;
  influence: number;       // 0.0 - 1.0 weight on votes
  reason?: string;
}

// =============================================================================
// AUDIT
// =============================================================================

export type LogKind = 
  | 'OUT_SEND' 
  | 'OUT_BROADCAST' 
  | 'IN' 
  | 'ACTION'
  | 'GRANT'
  | 'DENY'
  | 'REVOKE'
  | 'DRIFT'
  | 'T_STATE_CHANGE'
  | 'PATTERN_GENERATED'
  | 'PATTERN_ADOPTED'
  | 'CONFLICT_DETECTED'
  | 'ROLLBACK';

export interface LogEntry {
  i: number;
  ts: number;
  kind: LogKind;
  peerId?: PeerId;
  data: unknown;
  prev: string | null;
  hash: string;
}

// =============================================================================
// WIRE MESSAGES
// =============================================================================

export type WireMessage =
  | { type: 'HELLO'; from: PeerId; to?: PeerId; ts: number; knownPeers?: PeerId[]; tState?: TState }
  | { type: 'HEARTBEAT'; from: PeerId; ts: number; tState?: TState; confidence?: number }
  | { type: 'PEER_LIST'; from: PeerId; ts: number; peers: PeerId[] }
  | { type: 'LEARNING_SIGNAL'; from: PeerId; ts: number; signal: LearningSignal }
  | { type: 'CHECKPOINT_REQ'; from: PeerId; ts: number; claimHash: string }
  | { type: 'CHECKPOINT_RESP'; from: PeerId; ts: number; claimHash: string; meaning: string; stance: string; confidence: number }
  | { type: 'ARBITRATION_PROPOSAL'; from: PeerId; ts: number; proposalId: string; claimHash: string; options: string[] }
  | { type: 'ARBITRATION_VOTE'; from: PeerId; ts: number; proposalId: string; option: string; weight: number }
  | { type: 'AUTHORITY_REQUEST'; from: PeerId; ts: number; requestId: string; scope: string; reason: string }
  | { type: 'AUTHORITY_GRANT'; from: PeerId; ts: number; requestId: string; window: AuthorityWindow }
  | { type: 'AUTHORITY_DENY'; from: PeerId; ts: number; requestId: string; reason: string }
  | { type: 'AUTHORITY_REVOKE'; from: PeerId; ts: number; windowId: string; reason: DriftReason }
  | { type: 'PATTERN_BUNDLE'; from: PeerId; ts: number; bundle: PatternBundle }
  | { type: 'QUARANTINE_NOTICE'; from: PeerId; ts: number; targetPeer: PeerId; reason: DriftReason };

// =============================================================================
// TRANSPORT
// =============================================================================

export interface Transport {
  id: PeerId;
  send(to: PeerId, msg: WireMessage): void;
  broadcast(msg: WireMessage): void;
  onMessage(handler: (msg: WireMessage) => void): void;
  connect?(peer: PeerId): void;
  peers?(): PeerId[];
}

// =============================================================================
// CONFIGURATION
// =============================================================================

export interface SwarmConfig {
  // Authority
  baseAuthorityDurationMs: number;
  
  // Drift thresholds
  holdDriftThresholdMs: number;
  beliefDivergenceThreshold: number;
  confidenceDriftThreshold: number;
  staleCommsThresholdMs: number;
  
  // Membership
  heartbeatIntervalMs: number;
  peerTimeoutMs: number;
  maxPeers: number;
  
  // Propagation
  defaultTtl: number;
  maxSeenSignals: number;
  
  // Reputation
  minReputationForVote: number;
  newPeerInfluence: number;
  
  // Pattern bundles
  patternBundleThreshold: number;
  minSuccessRateForBundle: number;
}

export const DEFAULT_CONFIG: SwarmConfig = {
  baseAuthorityDurationMs: 60_000,
  holdDriftThresholdMs: 3_000,
  beliefDivergenceThreshold: 0.6,
  confidenceDriftThreshold: 0.3,
  staleCommsThresholdMs: 5_000,
  heartbeatIntervalMs: 1_000,
  peerTimeoutMs: 4_000,
  maxPeers: 32,
  defaultTtl: 8,
  maxSeenSignals: 50_000,
  minReputationForVote: 0.2,
  newPeerInfluence: 0.1,
  patternBundleThreshold: 5,
  minSuccessRateForBundle: 0.6,
};
