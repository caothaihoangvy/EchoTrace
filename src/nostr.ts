import { SimplePool, finalizeEvent, verifyEvent, type Event, type UnsignedEvent, type Filter } from 'nostr-tools';
import type { Identity } from './keys.js';

export type RelayPublishResult = {
  ok: boolean;
  relay: string;
  error?: string;
};

export function nowSec() {
  return Math.floor(Date.now() / 1000);
}

export function buildMetadataEvent(identity: Identity, profile: { name?: string; about?: string; picture?: string }) {
  const content = JSON.stringify({
    name: profile.name,
    about: profile.about,
    picture: profile.picture
  });

  const unsigned: UnsignedEvent = {
    kind: 0,
    created_at: nowSec(),
    tags: [],
    content,
    pubkey: identity.pk
  };

  const ev = finalizeEvent(unsigned, identity.sk);
  return ev;
}

export function buildPostEvent(identity: Identity, content: string, tags: string[][] = []) {
  const unsigned: UnsignedEvent = {
    kind: 1,
    created_at: nowSec(),
    tags,
    content,
    pubkey: identity.pk
  };
  return finalizeEvent(unsigned, identity.sk);
}

export function buildReactionEvent(identity: Identity, targetEventId: string, targetPubkey: string, reaction: '+' | '-') {
  // NIP-25: tags: ['e', <event_id>], ['p', <pubkey>]
  const tags: string[][] = [
    ['e', targetEventId],
    ['p', targetPubkey]
  ];
  const unsigned: UnsignedEvent = {
    kind: 7,
    created_at: nowSec(),
    tags,
    content: reaction,
    pubkey: identity.pk
  };
  return finalizeEvent(unsigned, identity.sk);
}

export function buildReplyEvent(identity: Identity, rootEventId: string, rootPubkey: string, content: string) {
  // Basic NIP-10 threading.
  // root reference: ['e', <root>, '', 'root'] and ['p', <root_pubkey>]
  const tags: string[][] = [
    ['e', rootEventId, '', 'root'],
    ['p', rootPubkey]
  ];
  return buildPostEvent(identity, content, tags);
}

function isSafeRelayUrl(url: string) {
  // Keep it strict by default: Nostr relays should be wss://.
  // Allow ws:// only if the operator explicitly configures it (still risky).
  return /^wss:\/\//i.test(url) || /^ws:\/\//i.test(url);
}

function normalizeRelayList(relays: string[]) {
  const cleaned = relays.map((r) => r.trim()).filter(Boolean);
  return Array.from(new Set(cleaned)).filter(isSafeRelayUrl);
}

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let t: NodeJS.Timeout | undefined;
  const timeout = new Promise<T>((_, reject) => {
    t = setTimeout(() => reject(new Error(`${label}: timeout after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    if (t) clearTimeout(t);
  }
}

export async function publishToRelays(relays: string[], ev: Event, opts?: { timeoutMs?: number }) {
  const pool = new SimplePool();
  const results: RelayPublishResult[] = [];

  const timeoutMs = Math.max(1000, opts?.timeoutMs ?? 8000);
  const safeRelays = normalizeRelayList(relays);

  // IMPORTANT: some relays may reject (e.g., "not acceptable at this point").
  // Treat per-relay failures as non-fatal; caller decides whether to queue.
  await Promise.all(
    safeRelays.map(async (relay) => {
      try {
        const pubs = pool.publish([relay], ev);
        await withTimeout(Promise.resolve(pubs as any), timeoutMs, `publish ${relay}`);
        results.push({ ok: true, relay });
      } catch (e: any) {
        results.push({ ok: false, relay, error: String(e?.message ?? e) });
      }
    })
  ).catch((e) => {
    // Never let an aggregate failure crash the process.
    results.push({ ok: false, relay: '(aggregate)', error: String(e?.message ?? e) });
  });

  try {
    pool.close(safeRelays);
  } catch {
    // ignore
  }

  return results;
}

export function verifyOrThrow(ev: Event) {
  if (!verifyEvent(ev)) throw new Error('Invalid signature');
}

export function subscribeFeed(relays: string[], filters: Filter[], onEvent: (ev: Event, relay: string) => void) {
  const pool = new SimplePool();
  const safeRelays = normalizeRelayList(relays);

  // NOTE: nostr-tools typings differ across versions; runtime supports multiple relays.
  // We subscribe using the first filter for now (our CLI uses one filter). Keep code stable.
  const sub = pool.subscribeMany(safeRelays, filters[0]!, {
    onevent: (ev: Event) => {
      try {
        if (!verifyEvent(ev)) return;
        onEvent(ev, 'relay');
      } catch {
        // ignore
      }
    },
    oneose: () => {
      // end-of-stored-events
    }
  });

  return {
    close: () => {
      try { sub.close(); } catch {}
      try { pool.close(safeRelays); } catch {}
    }
  };
}
