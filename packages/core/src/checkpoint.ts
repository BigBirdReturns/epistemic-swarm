/**
 * Checkpoints
 * ===========
 * 
 * Semantic checkpoints for verifying belief alignment across peers.
 * Used to detect divergence before it compounds.
 */

import { 
  Transport, 
  WireMessage, 
  PeerId,
  Stance 
} from './types/index.js';
import { BeliefStore } from './beliefs.js';
import { ConflictAccumulator } from './conflict.js';
import { nowMs } from './util/hash.js';

export interface CheckpointResponse {
  peerId: PeerId;
  claimHash: string;
  stance: Stance;
  confidence: number;
  ts: number;
}

export class Checkpoints {
  private pending = new Map<string, {
    claimHash: string;
    requestedAt: number;
    responses: CheckpointResponse[];
  }>();
  
  private responseCallbacks = new Map<string, (responses: CheckpointResponse[]) => void>();

  constructor(
    private transport: Transport,
    private beliefs: BeliefStore,
    private conflicts: ConflictAccumulator
  ) {}

  /**
   * Start listening for checkpoint messages
   */
  start(): void {
    this.transport.onMessage((m) => this.onWire(m));
  }

  /**
   * Request checkpoint for a claim
   */
  requestCheckpoint(claimHash: string, callback?: (responses: CheckpointResponse[]) => void): string {
    const requestId = `CKP-${claimHash.slice(0, 8)}-${nowMs()}`;
    
    this.pending.set(requestId, {
      claimHash,
      requestedAt: nowMs(),
      responses: [],
    });

    if (callback) {
      this.responseCallbacks.set(requestId, callback);
    }

    this.transport.broadcast({
      type: 'CHECKPOINT_REQ',
      from: this.transport.id,
      ts: nowMs(),
      claimHash,
    });

    return requestId;
  }

  /**
   * Get responses for a pending checkpoint
   */
  getResponses(requestId: string): CheckpointResponse[] | undefined {
    return this.pending.get(requestId)?.responses;
  }

  /**
   * Handle wire messages
   */
  private onWire(m: WireMessage): void {
    if (m.type === 'CHECKPOINT_REQ') {
      this.handleRequest(m);
    } else if (m.type === 'CHECKPOINT_RESP') {
      this.handleResponse(m);
    }
  }

  /**
   * Handle incoming checkpoint request
   */
  private handleRequest(m: WireMessage & { type: 'CHECKPOINT_REQ' }): void {
    const belief = this.beliefs.get(m.claimHash);
    const stance = belief?.stance ?? 'unknown';
    const confidence = belief?.confidence ?? 0;

    this.transport.send(m.from, {
      type: 'CHECKPOINT_RESP',
      from: this.transport.id,
      ts: nowMs(),
      claimHash: m.claimHash,
      meaning: '',
      stance,
      confidence,
    });
  }

  /**
   * Handle incoming checkpoint response
   */
  private handleResponse(m: WireMessage & { type: 'CHECKPOINT_RESP' }): void {
    // Find matching pending request
    for (const [requestId, pending] of this.pending) {
      if (pending.claimHash === m.claimHash) {
        const response: CheckpointResponse = {
          peerId: m.from,
          claimHash: m.claimHash,
          stance: m.stance as Stance,
          confidence: m.confidence,
          ts: m.ts,
        };

        pending.responses.push(response);

        // Update conflict accumulator
        this.conflicts.observeBelief(
          m.from,
          m.claimHash,
          m.stance as Stance,
          m.confidence,
          m.ts,
          m.meaning
        );

        // Call callback if set
        const callback = this.responseCallbacks.get(requestId);
        if (callback) {
          callback(pending.responses);
        }

        break;
      }
    }
  }

  /**
   * Clean up old pending requests
   */
  prune(maxAge = 30_000, now = nowMs()): void {
    for (const [requestId, pending] of this.pending) {
      if (now - pending.requestedAt > maxAge) {
        this.pending.delete(requestId);
        this.responseCallbacks.delete(requestId);
      }
    }
  }

  /**
   * Get count of pending checkpoints
   */
  get pendingCount(): number {
    return this.pending.size;
  }
}
