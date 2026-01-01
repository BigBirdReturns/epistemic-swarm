/**
 * Admission Control
 * =================
 * 
 * Controls which peers can join the swarm and what influence they have.
 * Implements progressive trust: new peers start limited and earn influence.
 */

import {
  PeerId,
  AdmissionDecision,
  TState,
  SwarmConfig,
  DEFAULT_CONFIG,
} from '../types/index.js';
import { ReputationSystem } from './reputation.js';
import { QuarantineSystem } from './quarantine.js';
import { TStateManager } from '../authority/tstate.js';

export interface AdmissionPolicy {
  name: string;
  check(peerId: PeerId, context: AdmissionContext): AdmissionDecision;
}

export interface AdmissionContext {
  tState: TState;
  peerCount: number;
  maxPeers: number;
  isReturning: boolean;
}

/**
 * Open admission - everyone allowed with base influence
 */
export class OpenAdmissionPolicy implements AdmissionPolicy {
  name = 'open';
  
  constructor(private baseInfluence: number = 0.1) {}

  check(_peerId: PeerId, _context: AdmissionContext): AdmissionDecision {
    return {
      allowed: true,
      influence: this.baseInfluence,
    };
  }
}

/**
 * Capacity-limited admission - reject when at capacity
 */
export class CapacityAdmissionPolicy implements AdmissionPolicy {
  name = 'capacity';

  check(_peerId: PeerId, context: AdmissionContext): AdmissionDecision {
    if (context.peerCount >= context.maxPeers) {
      return {
        allowed: false,
        influence: 0,
        reason: 'At capacity',
      };
    }
    return {
      allowed: true,
      influence: 0.1,
    };
  }
}

/**
 * T-State aware admission - restrict during degradation
 */
export class TStateAdmissionPolicy implements AdmissionPolicy {
  name = 'tstate';

  check(peerId: PeerId, context: AdmissionContext): AdmissionDecision {
    // During T2/T3, only allow returning peers
    if (context.tState === TState.T2 || context.tState === TState.T3) {
      if (!context.isReturning) {
        return {
          allowed: false,
          influence: 0,
          reason: `No new peers during ${context.tState}`,
        };
      }
    }
    
    return {
      allowed: true,
      influence: context.isReturning ? 0.5 : 0.1,
    };
  }
}

/**
 * Admission Controller
 * Combines multiple policies and integrates with reputation/quarantine
 */
export class AdmissionController {
  private policies: AdmissionPolicy[] = [];
  private config: SwarmConfig;
  private knownPeers = new Set<PeerId>();

  constructor(
    private reputation: ReputationSystem,
    private quarantine: QuarantineSystem,
    private tStateManager: TStateManager,
    config: Partial<SwarmConfig> = {}
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    // Default policies
    this.policies = [
      new CapacityAdmissionPolicy(),
      new TStateAdmissionPolicy(),
    ];
  }

  /**
   * Add a custom admission policy
   */
  addPolicy(policy: AdmissionPolicy): void {
    this.policies.push(policy);
  }

  /**
   * Remove a policy by name
   */
  removePolicy(name: string): void {
    this.policies = this.policies.filter(p => p.name !== name);
  }

  /**
   * Check if a peer should be admitted
   */
  checkAdmission(peerId: PeerId, currentPeerCount: number): AdmissionDecision {
    // Check quarantine first
    if (this.quarantine.isQuarantined(peerId)) {
      return {
        allowed: false,
        influence: 0,
        reason: 'Quarantined',
      };
    }

    const context: AdmissionContext = {
      tState: this.tStateManager.state,
      peerCount: currentPeerCount,
      maxPeers: this.config.maxPeers,
      isReturning: this.knownPeers.has(peerId),
    };

    // Run all policies - all must allow
    for (const policy of this.policies) {
      const decision = policy.check(peerId, context);
      if (!decision.allowed) {
        return decision;
      }
    }

    // Get reputation-based influence
    const repDecision = this.reputation.checkAdmission(peerId);
    if (!repDecision.allowed) {
      return repDecision;
    }

    // Admitted - track as known
    this.knownPeers.add(peerId);

    return {
      allowed: true,
      influence: repDecision.influence,
    };
  }

  /**
   * Record that a peer has connected
   */
  recordConnection(peerId: PeerId): void {
    this.knownPeers.add(peerId);
    this.reputation.track(peerId);
  }

  /**
   * Record that a peer has disconnected
   */
  recordDisconnection(peerId: PeerId): void {
    // Keep in knownPeers so they're recognized as returning
  }

  /**
   * Check if peer is a known returning peer
   */
  isReturning(peerId: PeerId): boolean {
    return this.knownPeers.has(peerId);
  }

  /**
   * Get influence for a peer (combining reputation and quarantine)
   */
  getInfluence(peerId: PeerId): number {
    const repInfluence = this.reputation.getInfluence(peerId);
    const quarantineMultiplier = this.quarantine.getInfluenceMultiplier(peerId);
    return repInfluence * quarantineMultiplier;
  }

  /**
   * Export state for debugging
   */
  export(): {
    knownPeers: PeerId[];
    policies: string[];
  } {
    return {
      knownPeers: Array.from(this.knownPeers),
      policies: this.policies.map(p => p.name),
    };
  }
}
