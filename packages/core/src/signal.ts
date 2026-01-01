/**
 * Learning Signal
 * ===============
 * 
 * Signed, verifiable signals for propagating beliefs across the swarm.
 */

import * as ed from '@noble/ed25519';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils';
import { LearningSignal, LearningSignalPayload, SignalType, Scope } from './types/index.js';

export function canonicalContent(signal: Omit<LearningSignal, 'signature'>): string {
  return JSON.stringify(signal);
}

export function contentHash(signal: Omit<LearningSignal, 'signature'>): Uint8Array {
  return sha256(utf8ToBytes(canonicalContent(signal)));
}

export async function signSignal(
  unsigned: Omit<LearningSignal, 'signature'>, 
  privKeyHex: string
): Promise<LearningSignal> {
  const sig = await ed.sign(contentHash(unsigned), hexToBytes(privKeyHex));
  return { ...unsigned, signature: bytesToHex(sig) };
}

export async function verifySignal(signal: LearningSignal): Promise<boolean> {
  const { signature, ...unsigned } = signal;
  try {
    return await ed.verify(
      hexToBytes(signature), 
      contentHash(unsigned), 
      hexToBytes(signal.source_id)
    );
  } catch {
    return false;
  }
}

export async function generateIdentity(): Promise<{ 
  publicKeyHex: string; 
  privateKeyHex: string 
}> {
  const priv = ed.utils.randomPrivateKey();
  const pub = await ed.getPublicKey(priv);
  return { 
    publicKeyHex: bytesToHex(pub), 
    privateKeyHex: bytesToHex(priv) 
  };
}

export interface SignalBuilder {
  sourceId: string;
  privateKey: string;
  domain: string;
  counter: number;
}

export function createSignalBuilder(
  sourceId: string, 
  privateKey: string, 
  domain: string
): SignalBuilder {
  return { sourceId, privateKey, domain, counter: 0 };
}

export async function buildSignal(
  builder: SignalBuilder,
  payload: LearningSignalPayload,
  options: {
    signalType?: SignalType;
    ttl?: number;
    scope?: Scope;
    priorSignal?: string;
  } = {}
): Promise<LearningSignal> {
  const unsigned: Omit<LearningSignal, 'signature'> = {
    source_id: builder.sourceId,
    signal_id: `${builder.sourceId.slice(0, 8)}-${++builder.counter}`,
    timestamp: Date.now(),
    domain: builder.domain,
    signal_type: options.signalType ?? 'delta',
    payload,
    ttl: options.ttl ?? 8,
    scope: options.scope ?? 'cluster',
    prior_signal: options.priorSignal,
  };

  return signSignal(unsigned, builder.privateKey);
}

export { LearningSignal, LearningSignalPayload, SignalType, Scope };
