/**
 * T-State Manager
 * ===============
 * 
 * Manages degradation state based on communications quality and confidence.
 * As T-state degrades, authority windows shrink and new grants become restricted.
 */

import { 
  TState, 
  T_STATE_MULTIPLIERS, 
  PeerId,
  SwarmConfig,
  DEFAULT_CONFIG 
} from '../types/index.js';

export interface TStateObservation {
  peerId: PeerId;
  timestamp: number;
  confidence: number;
}

export class TStateManager {
  private _state: TState = TState.T0;
  private observations = new Map<PeerId, TStateObservation>();
  private config: SwarmConfig;
  private listeners: Array<(oldState: TState, newState: TState) => void> = [];

  constructor(config: Partial<SwarmConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  get state(): TState {
    return this._state;
  }

  get multiplier(): number {
    return T_STATE_MULTIPLIERS[this._state];
  }

  /**
   * Record an observation from a peer
   */
  observe(peerId: PeerId, confidence: number, timestamp = Date.now()): void {
    this.observations.set(peerId, { peerId, timestamp, confidence });
  }

  /**
   * Update T-state based on current observations
   */
  update(now = Date.now()): TState {
    if (this.observations.size === 0) {
      return this._state;
    }

    let maxStaleness = 0;
    let minConfidence = 1.0;

    for (const obs of this.observations.values()) {
      const staleness = now - obs.timestamp;
      maxStaleness = Math.max(maxStaleness, staleness);
      minConfidence = Math.min(minConfidence, obs.confidence);
    }

    const oldState = this._state;
    let newState: TState;

    if (maxStaleness > this.config.staleCommsThresholdMs * 3) {
      newState = TState.T3;
    } else if (maxStaleness > this.config.staleCommsThresholdMs * 2) {
      newState = TState.T2;
    } else if (maxStaleness > this.config.staleCommsThresholdMs || minConfidence < 0.5) {
      newState = TState.T1;
    } else {
      newState = TState.T0;
    }

    if (newState !== oldState) {
      this._state = newState;
      this.notifyListeners(oldState, newState);
    }

    return this._state;
  }

  /**
   * Force T-state (for testing/simulation)
   */
  force(state: TState): void {
    const oldState = this._state;
    this._state = state;
    if (oldState !== state) {
      this.notifyListeners(oldState, state);
    }
  }

  /**
   * Check if new authority grants are allowed in current T-state
   */
  canGrantNewAuthority(): boolean {
    return this._state === TState.T0 || this._state === TState.T1 || this._state === TState.T4;
  }

  /**
   * Check if learning propagation is allowed
   */
  canPropagateLearning(): boolean {
    return this._state === TState.T0 || this._state === TState.T4;
  }

  /**
   * Initiate recontact (T4 transition)
   */
  initiateRecontact(): void {
    if (this._state === TState.T2 || this._state === TState.T3) {
      this.force(TState.T4);
    }
  }

  /**
   * Complete recontact and return to normal operations
   */
  completeRecontact(): void {
    if (this._state === TState.T4) {
      this.force(TState.T0);
    }
  }

  /**
   * Add listener for T-state changes
   */
  onStateChange(listener: (oldState: TState, newState: TState) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private notifyListeners(oldState: TState, newState: TState): void {
    for (const listener of this.listeners) {
      listener(oldState, newState);
    }
  }

  /**
   * Remove stale observations
   */
  prune(now = Date.now()): void {
    const threshold = now - this.config.staleCommsThresholdMs * 4;
    for (const [peerId, obs] of this.observations) {
      if (obs.timestamp < threshold) {
        this.observations.delete(peerId);
      }
    }
  }

  /**
   * Get current observations for debugging
   */
  getObservations(): Map<PeerId, TStateObservation> {
    return new Map(this.observations);
  }
}
