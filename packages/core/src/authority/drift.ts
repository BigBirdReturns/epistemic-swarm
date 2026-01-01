/**
 * Drift Detector
 * ==============
 * 
 * Detects various forms of drift that indicate a peer is deviating
 * from expected behavior or semantic alignment.
 * 
 * Drift types:
 * - HOLD_TOO_LONG: Peer has been in hold state too long
 * - BELIEF_DIVERGENCE: Peer's beliefs diverge significantly from consensus
 * - CONFIDENCE_DECAY: Peer's confidence has dropped below threshold
 * - STALE_COMMS: Haven't heard from peer in too long
 */

import {
  PeerId,
  DriftReason,
  DriftEvent,
  Stance,
  SwarmConfig,
  DEFAULT_CONFIG,
} from '../types/index.js';

export interface PeerDriftState {
  peerId: PeerId;
  holdStartTime: number | null;
  lastCommsTime: number;
  confidence: number;
  beliefs: Map<string, { stance: Stance; confidence: number }>;
  driftScore: number;
  triggered: boolean;
}

export class DriftDetector {
  private peerStates = new Map<PeerId, PeerDriftState>();
  private config: SwarmConfig;
  private listeners: Array<(event: DriftEvent) => void> = [];

  constructor(config: Partial<SwarmConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Initialize tracking for a peer
   */
  track(peerId: PeerId, now = Date.now()): void {
    if (!this.peerStates.has(peerId)) {
      this.peerStates.set(peerId, {
        peerId,
        holdStartTime: null,
        lastCommsTime: now,
        confidence: 1.0,
        beliefs: new Map(),
        driftScore: 0,
        triggered: false,
      });
    }
  }

  /**
   * Record that peer entered hold state
   */
  startHold(peerId: PeerId, now = Date.now()): void {
    const state = this.peerStates.get(peerId);
    if (state && state.holdStartTime === null) {
      state.holdStartTime = now;
    }
  }

  /**
   * Record that peer exited hold state
   */
  endHold(peerId: PeerId): void {
    const state = this.peerStates.get(peerId);
    if (state) {
      state.holdStartTime = null;
    }
  }

  /**
   * Update peer's last communication time
   */
  updateComms(peerId: PeerId, now = Date.now()): void {
    const state = this.peerStates.get(peerId);
    if (state) {
      state.lastCommsTime = now;
    }
  }

  /**
   * Update peer's confidence level
   */
  updateConfidence(peerId: PeerId, confidence: number): void {
    const state = this.peerStates.get(peerId);
    if (state) {
      state.confidence = confidence;
    }
  }

  /**
   * Update peer's belief for a claim
   */
  updateBelief(peerId: PeerId, claimHash: string, stance: Stance, confidence: number): void {
    const state = this.peerStates.get(peerId);
    if (state) {
      state.beliefs.set(claimHash, { stance, confidence });
    }
  }

  /**
   * Check all peers for drift and return triggered events
   */
  check(consensusBeliefs: Map<string, { stance: Stance; confidence: number }>, now = Date.now()): DriftEvent[] {
    const events: DriftEvent[] = [];

    for (const state of this.peerStates.values()) {
      if (state.triggered) continue;

      const reason = this.checkPeer(state, consensusBeliefs, now);
      if (reason) {
        state.triggered = true;
        const event: DriftEvent = {
          peerId: state.peerId,
          reason,
          timestamp: now,
          details: this.getDriftDetails(state, reason, consensusBeliefs),
        };
        events.push(event);
        this.notifyListeners(event);
      }
    }

    return events;
  }

  /**
   * Check a single peer for drift
   */
  private checkPeer(
    state: PeerDriftState,
    consensusBeliefs: Map<string, { stance: Stance; confidence: number }>,
    now: number
  ): DriftReason | null {
    // Check hold time
    if (state.holdStartTime !== null) {
      const holdDuration = now - state.holdStartTime;
      if (holdDuration > this.config.holdDriftThresholdMs) {
        return DriftReason.HOLD_TOO_LONG;
      }
    }

    // Check stale comms
    const commsStaleness = now - state.lastCommsTime;
    if (commsStaleness > this.config.staleCommsThresholdMs) {
      return DriftReason.STALE_COMMS;
    }

    // Check confidence
    if (state.confidence < this.config.confidenceDriftThreshold) {
      return DriftReason.CONFIDENCE_DECAY;
    }

    // Check belief divergence
    const divergenceScore = this.calculateDivergence(state.beliefs, consensusBeliefs);
    state.driftScore = divergenceScore;
    if (divergenceScore > this.config.beliefDivergenceThreshold) {
      return DriftReason.BELIEF_DIVERGENCE;
    }

    return null;
  }

  /**
   * Calculate divergence between peer beliefs and consensus
   */
  private calculateDivergence(
    peerBeliefs: Map<string, { stance: Stance; confidence: number }>,
    consensusBeliefs: Map<string, { stance: Stance; confidence: number }>
  ): number {
    if (consensusBeliefs.size === 0) return 0;

    let totalDivergence = 0;
    let count = 0;

    for (const [claimHash, consensus] of consensusBeliefs) {
      const peerBelief = peerBeliefs.get(claimHash);
      if (!peerBelief) continue;

      count++;
      
      // Different stance = high divergence
      if (peerBelief.stance !== consensus.stance && 
          peerBelief.stance !== 'unknown' && 
          consensus.stance !== 'unknown') {
        totalDivergence += 1.0;
      } else {
        // Same stance but different confidence
        const confDiff = Math.abs(peerBelief.confidence - consensus.confidence);
        totalDivergence += confDiff;
      }
    }

    return count > 0 ? totalDivergence / count : 0;
  }

  /**
   * Get details about why drift was triggered
   */
  private getDriftDetails(
    state: PeerDriftState,
    reason: DriftReason,
    _consensusBeliefs: Map<string, { stance: Stance; confidence: number }>
  ): Record<string, unknown> {
    switch (reason) {
      case DriftReason.HOLD_TOO_LONG:
        return {
          holdDuration: state.holdStartTime ? Date.now() - state.holdStartTime : 0,
          threshold: this.config.holdDriftThresholdMs,
        };
      case DriftReason.STALE_COMMS:
        return {
          staleness: Date.now() - state.lastCommsTime,
          threshold: this.config.staleCommsThresholdMs,
        };
      case DriftReason.CONFIDENCE_DECAY:
        return {
          confidence: state.confidence,
          threshold: this.config.confidenceDriftThreshold,
        };
      case DriftReason.BELIEF_DIVERGENCE:
        return {
          divergenceScore: state.driftScore,
          threshold: this.config.beliefDivergenceThreshold,
        };
      default:
        return {};
    }
  }

  /**
   * Reset drift trigger for a peer (e.g., after reconciliation)
   */
  resetTrigger(peerId: PeerId): void {
    const state = this.peerStates.get(peerId);
    if (state) {
      state.triggered = false;
      state.driftScore = 0;
    }
  }

  /**
   * Remove tracking for a peer
   */
  untrack(peerId: PeerId): void {
    this.peerStates.delete(peerId);
  }

  /**
   * Get drift score for a peer
   */
  getDriftScore(peerId: PeerId): number {
    return this.peerStates.get(peerId)?.driftScore ?? 0;
  }

  /**
   * Check if peer has triggered drift
   */
  hasTriggered(peerId: PeerId): boolean {
    return this.peerStates.get(peerId)?.triggered ?? false;
  }

  /**
   * Add listener for drift events
   */
  onDrift(listener: (event: DriftEvent) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private notifyListeners(event: DriftEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  /**
   * Export state for debugging
   */
  export(): Array<PeerDriftState & { beliefCount: number }> {
    return Array.from(this.peerStates.values()).map(s => ({
      ...s,
      beliefs: undefined as any,
      beliefCount: s.beliefs.size,
    }));
  }
}
