import { SimplePool, finalizeEvent, verifyEvent, type Event, type UnsignedEvent } from 'nostr-tools';
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

export async function publishToRelays(relays: string[], ev: Event) {
  const pool = new SimplePool();
  const results: RelayPublishResult[] = [];

  await Promise.all(
    relays.map(async (relay) => {
      try {
        const pubs = pool.publish([relay], ev);
        // nostr-tools returns a Promise-like (or event emitter in older versions);
        // in v2, publish returns Promise<void>.
        await pubs;
        results.push({ ok: true, relay });
      } catch (e: any) {
        results.push({ ok: false, relay, error: String(e?.message ?? e) });
      }
    })
  );

  try {
    pool.close(relays);
  } catch {
    // ignore
  }

  return results;
}

export function verifyOrThrow(ev: Event) {
  if (!verifyEvent(ev)) throw new Error('Invalid signature');
}

export function subscribeFeed(relays: string[], filters: any[], onEvent: (ev: Event, relay: string) => void) {
  const pool = new SimplePool();
  const sub = pool.subscribeMany(relays, filters, {
    onevent: (ev: Event, relay: string) => {
      try {
        if (!verifyEvent(ev)) return;
        onEvent(ev, relay);
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
      try { pool.close(relays); } catch {}
    }
  };
}
