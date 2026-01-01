/**
 * Membership
 * ==========
 * 
 * Manages swarm membership with heartbeats, liveness detection,
 * and T-state aware peer exchange.
 */

import { 
  PeerId, 
  Transport, 
  WireMessage, 
  TState,
  SwarmConfig,
  DEFAULT_CONFIG 
} from './types/index.js';
import { nowMs } from './util/hash.js';
import { TStateManager } from './authority/tstate.js';

export interface PeerInfo {
  id: PeerId;
  lastSeen: number;
  alive: boolean;
  confidence: number;
  tState?: TState;
}

export class Membership {
  private peers = new Map<PeerId, PeerInfo>();
  private config: SwarmConfig;
  private handlers: Array<(msg: WireMessage) => void> = [];

  constructor(
    private transport: Transport,
    private tStateManager: TStateManager,
    config: Partial<SwarmConfig> = {}
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Start membership protocol
   */
  start(): void {
    this.transport.onMessage((m) => this.onWire(m));
    
    // Initial hello
    this.transport.broadcast({
      type: 'HELLO',
      from: this.transport.id,
      ts: nowMs(),
      tState: this.tStateManager.state,
    });
  }

  /**
   * Process a tick - send heartbeats, check liveness
   */
  tick(now = nowMs()): void {
    // Heartbeat
    if (now % this.config.heartbeatIntervalMs < 50) {
      this.transport.broadcast({
        type: 'HEARTBEAT',
        from: this.transport.id,
        ts: now,
        tState: this.tStateManager.state,
        confidence: 1.0, // Could be dynamic
      });
    }

    // Peer exchange
    if (now % (this.config.heartbeatIntervalMs * 2) < 50) {
      this.transport.broadcast({
        type: 'PEER_LIST',
        from: this.transport.id,
        ts: now,
        peers: this.connectedPeers(),
      });
    }

    // Update liveness
    for (const p of this.peers.values()) {
      if (p.id === this.transport.id) continue;
      p.alive = (now - p.lastSeen) <= this.config.peerTimeoutMs;
    }

    // Update T-state observations
    for (const p of this.peers.values()) {
      if (p.alive) {
        this.tStateManager.observe(p.id, p.confidence, p.lastSeen);
      }
    }
    this.tStateManager.update(now);

    // Bound peer set
    this.boundPeers();
  }

  /**
   * Get list of connected (alive) peers
   */
  connectedPeers(): PeerId[] {
    return Array.from(this.peers.values())
      .filter(p => p.alive && p.id !== this.transport.id)
      .sort((a, b) => b.lastSeen - a.lastSeen)
      .slice(0, this.config.maxPeers)
      .map(p => p.id);
  }

  /**
   * Get count of alive peers
   */
  get peerCount(): number {
    return this.connectedPeers().length;
  }

  /**
   * Observe a peer (update last seen)
   */
  observe(peer: PeerId, ts: number, confidence = 1.0, tState?: TState): void {
    if (peer === this.transport.id) return;

    const prev = this.peers.get(peer);
    if (!prev) {
      this.peers.set(peer, {
        id: peer,
        lastSeen: ts,
        alive: true,
        confidence,
        tState,
      });
      return;
    }

    prev.lastSeen = Math.max(prev.lastSeen, ts);
    prev.alive = true;
    prev.confidence = confidence;
    if (tState) prev.tState = tState;
  }

  /**
   * Handle incoming wire message
   */
  private onWire(m: WireMessage): void {
    switch (m.type) {
      case 'HELLO': {
        this.observe(m.from, m.ts, 1.0, m.tState);
        // Reply with peer list
        this.transport.send(m.from, {
          type: 'PEER_LIST',
          from: this.transport.id,
          ts: nowMs(),
          peers: this.connectedPeers().concat([this.transport.id]),
        });
        break;
      }
      case 'HEARTBEAT':
        this.observe(m.from, m.ts, m.confidence ?? 1.0, m.tState);
        break;
      case 'PEER_LIST':
        this.observe(m.from, m.ts);
        for (const p of m.peers) {
          this.observe(p, m.ts);
        }
        break;
    }

    // Forward to other handlers
    for (const h of this.handlers) {
      h(m);
    }
  }

  /**
   * Register additional message handler
   */
  onMessage(handler: (msg: WireMessage) => void): void {
    this.handlers.push(handler);
  }

  /**
   * Bound peer set to maxPeers
   */
  private boundPeers(): void {
    const all = Array.from(this.peers.values())
      .filter(p => p.id !== this.transport.id);
    
    if (all.length <= this.config.maxPeers) return;

    // Sort by last seen (oldest first) and remove excess
    all.sort((a, b) => a.lastSeen - b.lastSeen);
    const drop = all.slice(0, all.length - this.config.maxPeers);
    for (const p of drop) {
      this.peers.delete(p.id);
    }
  }

  /**
   * Get peer info
   */
  getPeer(peerId: PeerId): PeerInfo | undefined {
    return this.peers.get(peerId);
  }

  /**
   * Check if peer is alive
   */
  isAlive(peerId: PeerId): boolean {
    return this.peers.get(peerId)?.alive ?? false;
  }

  /**
   * Export for debugging
   */
  export(): PeerInfo[] {
    return Array.from(this.peers.values());
  }
}
