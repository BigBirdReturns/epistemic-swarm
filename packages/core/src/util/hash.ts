import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';

export function hashJson(obj: unknown): string {
  const s = JSON.stringify(obj);
  return bytesToHex(sha256(utf8ToBytes(s)));
}

export function nowMs(): number {
  return Date.now();
}

export function generateId(prefix = ''): string {
  const rand = Math.random().toString(36).substring(2, 10);
  const ts = Date.now().toString(36);
  return prefix ? `${prefix}-${ts}-${rand}` : `${ts}-${rand}`;
}
