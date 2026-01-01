/**
 * BroadcastChannel Transport
 * ==========================
 * 
 * Browser transport using BroadcastChannel API.
 * Allows communication between tabs/windows on same origin.
 */

import { Transport, WireMessage, PeerId } from '../types/index.js';

type Handler = (msg: WireMessage) => void;

export class BroadcastChannelTransport implements Transport {
  private channel: BroadcastChannel;
  private handlers: Handler[] = [];

  constructor(
    public readonly id: PeerId,
    channelName = 'epistemic-swarm'
  ) {
    this.channel = new BroadcastChannel(channelName);
    
    this.channel.onmessage = (event) => {
      const msg = event.data as WireMessage;
      // Don't process our own messages
      if (msg.from === this.id) return;
      
      for (const h of this.handlers) {
        h(msg);
      }
    };
  }

  send(to: PeerId, msg: WireMessage): void {
    // BroadcastChannel doesn't support point-to-point
    // We broadcast with a 'to' field and recipients filter
    const withTo = { ...msg, _to: to };
    this.channel.postMessage(withTo);
  }

  broadcast(msg: WireMessage): void {
    this.channel.postMessage(msg);
  }

  onMessage(handler: Handler): void {
    this.handlers.push(handler);
  }

  close(): void {
    this.channel.close();
  }
}

/**
 * Create a transport with auto-generated ID
 */
export function createBroadcastTransport(
  channelName = 'epistemic-swarm'
): BroadcastChannelTransport {
  const id = `browser-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return new BroadcastChannelTransport(id, channelName);
}
