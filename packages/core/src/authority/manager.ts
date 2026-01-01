/**
 * Authority Manager
 * =================
 * 
 * Manages authority windows for peers. Authority is time-bounded and
 * shrinks based on T-state degradation.
 */

import {
  PeerId,
  AuthorityWindow,
  AuthorityStatus,
  TState,
  T_STATE_MULTIPLIERS,
  DriftReason,
  SwarmConfig,
  DEFAULT_CONFIG,
} from '../types/index.js';
import { TStateManager } from './tstate.js';
import { hashJson } from '../util/hash.js';

export interface AuthorityRequest {
  id: string;
  peerId: PeerId;
  scope: string;
  reason: string;
  requestedAt: number;
}

export interface AuthorityCallbacks {
  onGrant?: (peerId: PeerId, window: AuthorityWindow) => void;
  onDeny?: (peerId: PeerId, reason: string) => void;
  onRevoke?: (peerId: PeerId, reason: DriftReason) => void;
  onExpire?: (peerId: PeerId, windowId: string) => void;
}

export class AuthorityManager {
  private windows = new Map<PeerId, AuthorityWindow>();
  private pending = new Map<string, AuthorityRequest>();
  private config: SwarmConfig;
  private callbacks: AuthorityCallbacks = {};
  private tick = 0;

  constructor(
    private tStateManager: TStateManager,
    config: Partial<SwarmConfig> = {}
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Set callbacks for authority events
   */
  setCallbacks(callbacks: AuthorityCallbacks): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  /**
   * Request authority for a peer
   */
  request(peerId: PeerId, scope: string, reason: string): string | null {
    // Check if grants are allowed in current T-state
    if (!this.tStateManager.canGrantNewAuthority()) {
      this.callbacks.onDeny?.(peerId, `No new grants in ${this.tStateManager.state}`);
      return null;
    }

    const requestId = `REQ-${peerId}-${this.tick}-${hashJson({ peerId, scope, reason }).slice(0, 8)}`;
    
    this.pending.set(requestId, {
      id: requestId,
      peerId,
      scope,
      reason,
      requestedAt: Date.now(),
    });

    return requestId;
  }

  /**
   * Grant authority for a pending request
   */
  grant(requestId: string): AuthorityWindow | null {
    const request = this.pending.get(requestId);
    if (!request) {
      return null;
    }

    this.pending.delete(requestId);

    // Calculate duration based on T-state
    const multiplier = this.tStateManager.multiplier;
    const duration = this.config.baseAuthorityDurationMs * multiplier;
    const now = Date.now();

    const window: AuthorityWindow = {
      id: `AUTH-${request.peerId}-${this.tick}`,
      peerId: request.peerId,
      grantedAt: now,
      expiresAt: now + duration,
      tStateAtGrant: this.tStateManager.state,
      scope: request.scope,
    };

    this.windows.set(request.peerId, window);
    this.callbacks.onGrant?.(request.peerId, window);

    return window;
  }

  /**
   * Deny a pending authority request
   */
  deny(requestId: string, reason: string): boolean {
    const request = this.pending.get(requestId);
    if (!request) {
      return false;
    }

    this.pending.delete(requestId);
    this.callbacks.onDeny?.(request.peerId, reason);
    return true;
  }

  /**
   * Revoke authority from a peer
   */
  revoke(peerId: PeerId, reason: DriftReason): boolean {
    const window = this.windows.get(peerId);
    if (!window) {
      return false;
    }

    this.windows.delete(peerId);
    this.callbacks.onRevoke?.(peerId, reason);
    return true;
  }

  /**
   * Check if a peer has valid authority
   */
  hasAuthority(peerId: PeerId, now = Date.now()): boolean {
    const window = this.windows.get(peerId);
    if (!window) {
      return false;
    }
    return now < window.expiresAt;
  }

  /**
   * Get remaining authority time for a peer
   */
  getRemaining(peerId: PeerId, now = Date.now()): number {
    const window = this.windows.get(peerId);
    if (!window) {
      return 0;
    }
    return Math.max(0, window.expiresAt - now);
  }

  /**
   * Get authority window for a peer
   */
  getWindow(peerId: PeerId): AuthorityWindow | undefined {
    return this.windows.get(peerId);
  }

  /**
   * Get all pending requests
   */
  getPending(): AuthorityRequest[] {
    return Array.from(this.pending.values());
  }

  /**
   * Shrink all authority windows based on current T-state
   */
  shrinkWindows(): void {
    const multiplier = this.tStateManager.multiplier;
    const now = Date.now();

    for (const window of this.windows.values()) {
      const remaining = window.expiresAt - now;
      const newRemaining = remaining * multiplier;
      window.expiresAt = now + newRemaining;
    }
  }

  /**
   * Check for expired authority windows
   */
  checkExpirations(now = Date.now()): PeerId[] {
    const expired: PeerId[] = [];

    for (const [peerId, window] of this.windows) {
      if (now >= window.expiresAt) {
        expired.push(peerId);
        this.windows.delete(peerId);
        this.callbacks.onExpire?.(peerId, window.id);
      }
    }

    return expired;
  }

  /**
   * Advance tick counter
   */
  advanceTick(): void {
    this.tick++;
  }

  /**
   * Get count of active authority windows
   */
  get activeCount(): number {
    return this.windows.size;
  }

  /**
   * Get count of pending requests
   */
  get pendingCount(): number {
    return this.pending.size;
  }

  /**
   * Export state for audit
   */
  export(): {
    windows: Array<AuthorityWindow>;
    pending: Array<AuthorityRequest>;
  } {
    return {
      windows: Array.from(this.windows.values()),
      pending: Array.from(this.pending.values()),
    };
  }
}
