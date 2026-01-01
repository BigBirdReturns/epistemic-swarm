/**
 * Memory Transport
 * ================
 * 
 * In-memory transport for testing. All nodes share a message bus.
 */

import { Transport, WireMessage, PeerId } from '../types/index.js';

type Handler = (msg: WireMessage) => void;

export class MemoryBus {
  private transports = new Map<PeerId, MemoryTransport>();

  register(transport: MemoryTransport): void {
    this.transports.set(transport.id, transport);
  }

  unregister(id: PeerId): void {
    this.transports.delete(id);
  }

  send(from: PeerId, to: PeerId, msg: WireMessage): void {
    const target = this.transports.get(to);
    if (target && target.id !== from) {
      target.deliver(msg);
    }
  }

  broadcast(from: PeerId, msg: WireMessage): void {
    for (const [id, transport] of this.transports) {
      if (id !== from) {
        transport.deliver(msg);
      }
    }
  }

  peers(): PeerId[] {
    return Array.from(this.transports.keys());
  }
}

export class MemoryTransport implements Transport {
  private handlers: Handler[] = [];

  constructor(
    public readonly id: PeerId,
    private bus: MemoryBus
  ) {
    bus.register(this);
  }

  send(to: PeerId, msg: WireMessage): void {
    this.bus.send(this.id, to, msg);
  }

  broadcast(msg: WireMessage): void {
    this.bus.broadcast(this.id, msg);
  }

  onMessage(handler: Handler): void {
    this.handlers.push(handler);
  }

  deliver(msg: WireMessage): void {
    for (const h of this.handlers) {
      h(msg);
    }
  }

  peers(): PeerId[] {
    return this.bus.peers().filter(p => p !== this.id);
  }

  disconnect(): void {
    this.bus.unregister(this.id);
  }
}

/**
 * Create a bus and multiple connected transports
 */
export function createMemorySwarm(count: number): {
  bus: MemoryBus;
  transports: MemoryTransport[];
} {
  const bus = new MemoryBus();
  const transports: MemoryTransport[] = [];

  for (let i = 0; i < count; i++) {
    transports.push(new MemoryTransport(`node-${i}`, bus));
  }

  return { bus, transports };
}
