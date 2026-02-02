import fs from 'node:fs';
import path from 'node:path';
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';
import { keysDir, nsecPath } from './paths.js';

export type Identity = {
  sk: Uint8Array;
  pk: string; // hex
  nsec: string;
  npub: string;
};

function u8ToHex(u8: Uint8Array) {
  return Buffer.from(u8).toString('hex');
}

function hexToU8(hex: string) {
  return new Uint8Array(Buffer.from(hex, 'hex'));
}

export function ensureKeysDir() {
  fs.mkdirSync(keysDir(), { recursive: true });
}

export function createIdentity(): Identity {
  const sk = generateSecretKey();
  const pk = getPublicKey(sk);
  const nsec = nip19.nsecEncode(sk);
  const npub = nip19.npubEncode(pk);
  return { sk, pk, nsec, npub };
}

export function saveNsec(nsec: string) {
  ensureKeysDir();
  fs.mkdirSync(path.dirname(nsecPath()), { recursive: true });
  // write as plain text; user should protect their home dir.
  fs.writeFileSync(nsecPath(), nsec.trim() + '\n', { encoding: 'utf-8' });
}

export function loadIdentity(): Identity {
  ensureKeysDir();
  const p = nsecPath();
  if (!fs.existsSync(p)) {
    const id = createIdentity();
    saveNsec(id.nsec);
    return id;
  }
  const nsec = fs.readFileSync(p, 'utf-8').trim();
  const decoded = nip19.decode(nsec);
  if (decoded.type !== 'nsec') throw new Error('Invalid nsec file');
  const sk = decoded.data as Uint8Array;
  const pk = getPublicKey(sk);
  const npub = nip19.npubEncode(pk);
  return { sk, pk, nsec, npub };
}

export function normalizePubkey(input: string): string {
  const s = input.trim();
  if (/^[0-9a-f]{64}$/i.test(s)) return s.toLowerCase();
  const decoded = nip19.decode(s);
  if (decoded.type === 'npub') return (decoded.data as string).toLowerCase();
  throw new Error('Expected pubkey hex or npub');
}

export function hexSecretKeyFromNsec(nsec: string): string {
  const decoded = nip19.decode(nsec);
  if (decoded.type !== 'nsec') throw new Error('Invalid nsec');
  return u8ToHex(decoded.data as Uint8Array);
}

export function secretKeyFromHex(hex: string): Uint8Array {
  return hexToU8(hex);
}
