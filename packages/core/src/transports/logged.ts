/**
 * Logged Transport
 * ================
 * 
 * Wrapper that logs all messages to an audit log.
 */

import { Transport, WireMessage, PeerId, LogEntry } from '../types/index.js';
import { AuditLog } from '../audit/log.js';

type Handler = (msg: WireMessage) => void;

export class LoggedTransport implements Transport {
  private handlers: Handler[] = [];

  constructor(
    private inner: Transport,
    private audit: AuditLog
  ) {}

  get id(): PeerId {
    return this.inner.id;
  }

  send(to: PeerId, msg: WireMessage): void {
    this.audit.append('OUT_SEND', { to, msg }, msg.from);
    this.inner.send(to, msg);
  }

  broadcast(msg: WireMessage): void {
    this.audit.append('OUT_BROADCAST', { msg }, msg.from);
    this.inner.broadcast(msg);
  }

  onMessage(handler: Handler): void {
    // Wrap handler to log incoming messages
    const loggingHandler = (msg: WireMessage) => {
      this.audit.append('IN', { msg }, msg.from);
      handler(msg);
    };
    
    this.handlers.push(loggingHandler);
    this.inner.onMessage(loggingHandler);
  }

  connect?(peer: PeerId): void {
    this.inner.connect?.(peer);
  }

  peers?(): PeerId[] {
    return this.inner.peers?.() ?? [];
  }
}

/**
 * Wrap a transport with logging
 */
export function withLogging(transport: Transport, audit: AuditLog): LoggedTransport {
  return new LoggedTransport(transport, audit);
}
