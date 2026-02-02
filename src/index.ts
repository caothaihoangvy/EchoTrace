#!/usr/bin/env node

import { Command } from 'commander';
import { loadConfig, saveConfig, DEFAULT_CONFIG } from './config.js';
import { loadIdentity, normalizePubkey } from './keys.js';
import { openDb, insertEventIfMissing, enforceCacheLimit, dbCounts, addPending, listDuePending, bumpPending, removePending } from './db.js';

async function syncPendingOnce(cfg: any, db: any, limit = 50) {
  const due = listDuePending(db, limit);
  if (!due.length) return { attempted: 0, published: 0, stillPending: 0 };

  let published = 0;
  for (const item of due) {
    try {
      const ev = JSON.parse(item.event_json);
      const results = await publishToRelays(cfg.relays, ev, { timeoutMs: 8000 });
      const ok = results.some((r: any) => r.ok);
      if (ok) {
        removePending(db, item.id);
        published++;
      } else {
        bumpPending(db, item.id, results.map((r: any) => `${r.relay}: ${r.error ?? 'fail'}`).join('; '));
      }
    } catch (e: any) {
      bumpPending(db, item.id, String(e?.message ?? e));
    }
  }

  return { attempted: due.length, published, stillPending: due.length - published };
}
import {
  buildMetadataEvent,
  buildPostEvent,
  buildEncryptedPostEventNip44,
  decryptNip44,
  buildReactionEvent,
  buildReplyEvent,
  publishToRelays,
  subscribeFeed
} from './nostr.js';
import { renderEvent, short } from './format.js';

const program = new Command();
program.name('echotrace').description('EchoTrace – AgentLog miniblog on Nostr (CLI MVP)').version('0.1.0');

program
  .command('init')
  .description('Create/load identity and config (offline-first)')
  .action(() => {
    const id = loadIdentity();
    const cfg = loadConfig();
    saveConfig(cfg);
    console.log('OK');
    console.log('npub:', id.npub);
    console.log('pubkey:', id.pk);
    console.log('config relays:', cfg.relays.join(', '));
  });

program
  .command('me')
  .description('Show current identity')
  .action(() => {
    const id = loadIdentity();
    console.log('npub:', id.npub);
    console.log('pubkey:', id.pk);
  });

program
  .command('meta')
  .description('Publish metadata (kind 0)')
  .option('--name <name>', 'display name')
  .option('--about <about>', 'about')
  .option('--picture <url>', 'avatar url')
  .action(async (opts) => {
    const id = loadIdentity();
    const cfg = loadConfig();
    const db = openDb();

    const ev = buildMetadataEvent(id, { name: opts.name, about: opts.about, picture: opts.picture });

    // persist locally first
    insertEventIfMissing(db, {
      id: ev.id,
      kind: ev.kind,
      pubkey: ev.pubkey,
      created_at: ev.created_at,
      content: ev.content,
      tags_json: JSON.stringify(ev.tags),
      sig: ev.sig,
      raw_json: JSON.stringify(ev),
      received_at: Math.floor(Date.now() / 1000)
    });
    enforceCacheLimit(db, cfg.cache_limit);

    const results = await publishToRelays(cfg.relays, ev, { timeoutMs: 8000 });
    const ok = results.some((r) => r.ok);
    if (!ok) {
      addPending(db, ev.id, JSON.stringify(ev), results.map((r) => `${r.relay}: ${r.error ?? 'fail'}`).join('; '));
      console.error('Published locally, queued for retry (all relays failed).');
    } else {
      console.log('Published kind=0 to relays:', results.filter((r) => r.ok).map((r) => r.relay).join(', '));
    }
  });

program
  .command('post')
  .description('Publish a miniblog post (kind 1)')
  .argument('<text...>', 'text content')
  .option('--e2ee', 'Encrypt content (NIP-44) and publish as ciphertext')
  .option('--to <pubkeyOrNpub>', 'Recipient pubkey (hex) or npub for E2EE posts')
  .action(async (textParts, opts) => {
    const content = Array.isArray(textParts) ? textParts.join(' ') : String(textParts);
    const id = loadIdentity();
    const cfg = loadConfig();
    const db = openDb();

    const useE2ee = Boolean(opts?.e2ee);
    let ev;
    if (useE2ee) {
      if (!opts?.to) throw new Error('E2EE requires --to <pubkey|npub>');
      const toPk = normalizePubkey(String(opts.to));
      ev = buildEncryptedPostEventNip44(id, toPk, content);
    } else {
      ev = buildPostEvent(id, content);
    }

    insertEventIfMissing(db, {
      id: ev.id,
      kind: ev.kind,
      pubkey: ev.pubkey,
      created_at: ev.created_at,
      content: ev.content,
      tags_json: JSON.stringify(ev.tags),
      sig: ev.sig,
      raw_json: JSON.stringify(ev),
      received_at: Math.floor(Date.now() / 1000)
    });
    enforceCacheLimit(db, cfg.cache_limit);

    const results = await publishToRelays(cfg.relays, ev, { timeoutMs: 8000 });
    const ok = results.some((r) => r.ok);
    if (!ok) {
      addPending(db, ev.id, JSON.stringify(ev), results.map((r) => `${r.relay}: ${r.error ?? 'fail'}`).join('; '));
      console.error('Published locally, queued for retry (all relays failed).');
    } else {
      console.log('OK post id:', ev.id);
    }
  });

const follow = program.command('follow').description('Manage follow list');

follow
  .command('add')
  .argument('<pubkeyOrNpub>', 'pubkey hex or npub')
  .action((pubkeyOrNpub) => {
    const cfg = loadConfig();
    const pk = normalizePubkey(pubkeyOrNpub);
    if (!cfg.follows.includes(pk)) cfg.follows.push(pk);
    saveConfig(cfg);
    console.log('OK follow:', pk);
  });

follow
  .command('ls')
  .action(() => {
    const cfg = loadConfig();
    if (!cfg.follows.length) {
      console.log('(empty)');
      return;
    }
    for (const pk of cfg.follows) console.log(pk);
  });

program
  .command('feed')
  .description('Subscribe realtime feed for followed pubkeys')
  .option('--limit <n>', 'historical limit', '50')
  .action(async (opts) => {
    const cfg = loadConfig();
    const db = openDb();

    if (!cfg.follows.length) {
      console.error('No follows configured. Use: echotrace follow add <npub|pubkeyHex>');
      process.exitCode = 1;
      return;
    }

    const limit = Number(opts.limit ?? 50);

    console.log('Relays:', cfg.relays.join(', '));
    console.log('Following:', cfg.follows.map((x) => short(x)).join(', '));

    const since = Math.floor(Date.now() / 1000) - 60 * 60 * 24 * 7; // 7 days

    const filters = [
      { kinds: [1, 7], authors: cfg.follows, limit, since }
    ];

    const sub = subscribeFeed(cfg.relays, filters, (ev, relay) => {
      insertEventIfMissing(db, {
        id: ev.id,
        kind: ev.kind,
        pubkey: ev.pubkey,
        created_at: ev.created_at,
        content: ev.content,
        tags_json: JSON.stringify(ev.tags),
        sig: ev.sig,
        raw_json: JSON.stringify(ev),
        received_at: Math.floor(Date.now() / 1000)
      });
      enforceCacheLimit(db, cfg.cache_limit);
      console.log(renderEvent(ev), `(via ${relay})`);
    });

    console.log('Subscribed. Press Ctrl+C to exit.');

    const stop = () => {
      sub.close();
      process.exit(0);
    };

    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  });

program
  .command('react')
  .description('React to an event (kind 7)')
  .argument('<eventId>', 'target event id')
  .argument('<reaction>', '+ or -')
  .option('--target-pubkey <hex>', 'target author pubkey (hex). If omitted, will try from local DB and may fail.')
  .action(async (eventId, reaction, opts) => {
    const id = loadIdentity();
    const cfg = loadConfig();
    const db = openDb();

    const r = reaction === '-' ? '-' : '+';

    let targetPubkey = String(opts.targetPubkey ?? '').trim();
    if (!targetPubkey) {
      const row = db.prepare('SELECT raw_json FROM events WHERE id=?').get(eventId) as { raw_json: string } | undefined;
      if (!row) throw new Error('Need --target-pubkey (target not in local DB)');
      const raw = JSON.parse(row.raw_json);
      targetPubkey = raw.pubkey;
    }

    const ev = buildReactionEvent(id, eventId, targetPubkey, r);

    insertEventIfMissing(db, {
      id: ev.id,
      kind: ev.kind,
      pubkey: ev.pubkey,
      created_at: ev.created_at,
      content: ev.content,
      tags_json: JSON.stringify(ev.tags),
      sig: ev.sig,
      raw_json: JSON.stringify(ev),
      received_at: Math.floor(Date.now() / 1000)
    });
    enforceCacheLimit(db, cfg.cache_limit);

    const results = await publishToRelays(cfg.relays, ev, { timeoutMs: 8000 });
    const ok = results.some((x) => x.ok);
    if (!ok) {
      addPending(db, ev.id, JSON.stringify(ev), results.map((x) => `${x.relay}: ${x.error ?? 'fail'}`).join('; '));
      console.error('Reaction saved locally; queued retry.');
    } else {
      console.log('OK reacted. id:', ev.id);
    }
  });

program
  .command('reply')
  .description('Reply to an event (kind 1 + NIP-10 tags basic)')
  .argument('<eventId>', 'root event id')
  .argument('<text...>', 'reply content')
  .option('--target-pubkey <hex>', 'root author pubkey (hex). If omitted, will try from local DB and may fail.')
  .action(async (eventId, textParts, opts) => {
    const id = loadIdentity();
    const cfg = loadConfig();
    const db = openDb();

    const content = Array.isArray(textParts) ? textParts.join(' ') : String(textParts);

    let targetPubkey = String(opts.targetPubkey ?? '').trim();
    if (!targetPubkey) {
      const row = db.prepare('SELECT raw_json FROM events WHERE id=?').get(eventId) as { raw_json: string } | undefined;
      if (!row) throw new Error('Need --target-pubkey (target not in local DB)');
      const raw = JSON.parse(row.raw_json);
      targetPubkey = raw.pubkey;
    }

    const ev = buildReplyEvent(id, eventId, targetPubkey, content);

    insertEventIfMissing(db, {
      id: ev.id,
      kind: ev.kind,
      pubkey: ev.pubkey,
      created_at: ev.created_at,
      content: ev.content,
      tags_json: JSON.stringify(ev.tags),
      sig: ev.sig,
      raw_json: JSON.stringify(ev),
      received_at: Math.floor(Date.now() / 1000)
    });
    enforceCacheLimit(db, cfg.cache_limit);

    const results = await publishToRelays(cfg.relays, ev, { timeoutMs: 8000 });
    const ok = results.some((x) => x.ok);
    if (!ok) {
      addPending(db, ev.id, JSON.stringify(ev), results.map((x) => `${x.relay}: ${x.error ?? 'fail'}`).join('; '));
      console.error('Reply saved locally; queued retry.');
    } else {
      console.log('OK reply id:', ev.id);
    }
  });

program
  .command('decrypt')
  .description('Decrypt an E2EE post (EchoTrace tag: echotrace,e2ee,nip44) from local DB')
  .argument('<eventId>', 'event id')
  .action((eventId) => {
    const me = loadIdentity();
    const db = openDb();
    const row = db.prepare('SELECT raw_json FROM events WHERE id=?').get(eventId) as { raw_json: string } | undefined;
    if (!row) throw new Error('Event not found in local DB');
    const ev = JSON.parse(row.raw_json);
    const tags = Array.isArray(ev.tags) ? ev.tags : [];
    const hasE2ee = tags.some((t: any) => Array.isArray(t) && t[0] === 'echotrace' && t[1] === 'e2ee' && t[2] === 'nip44');
    if (!hasE2ee) throw new Error('Not an EchoTrace NIP-44 encrypted post');

    let otherPubkey = '';
    if (ev.pubkey === me.pk) {
      const ptag = tags.find((t: any) => Array.isArray(t) && t[0] === 'p' && typeof t[1] === 'string');
      if (!ptag) throw new Error('Missing p-tag (recipient pubkey)');
      otherPubkey = ptag[1];
    } else {
      otherPubkey = ev.pubkey;
    }

    const plaintext = decryptNip44(me, otherPubkey, ev.content);
    console.log(plaintext);
  });

program
  .command('sync')
  .description('Retry pending publishes')
  .action(async () => {
    const cfg = loadConfig();
    const db = openDb();

    const res = await syncPendingOnce(cfg, db, 50);
    if (!res.attempted) {
      console.log('No pending publishes due.');
      return;
    }
    console.log(`Retried ${res.attempted}. Published ${res.published}. Still pending ${res.stillPending}.`);
  });

program
  .command('config')
  .description('Print current config')
  .action(() => {
    const cfg = loadConfig();
    console.log(JSON.stringify(cfg, null, 2));
  });

program
  .command('status')
  .description('Show local health/status (events cached, pending queue, relays, follows)')
  .action(() => {
    const cfg = loadConfig();
    const me = loadIdentity();
    const db = openDb();
    const counts = dbCounts(db);

    console.log(JSON.stringify({
      agent: { npub: me.npub, pubkey: me.pk },
      relays: cfg.relays,
      follows: cfg.follows,
      cache_limit: cfg.cache_limit,
      db: counts
    }, null, 2));
  });

program
  .command('watch')
  .description('Long-running mode: subscribe feed + periodically sync pending publishes')
  .option('--sync-every <seconds>', 'sync interval seconds', '60')
  .option('--limit <n>', 'historical limit for initial subscribe', '50')
  .action(async (opts) => {
    const cfg = loadConfig();
    const db = openDb();

    if (!cfg.follows.length) {
      console.error('No follows configured. Use: echotrace follow add <npub|pubkeyHex>');
      process.exitCode = 1;
      return;
    }

    const syncEverySec = Math.max(5, Number(opts.syncEvery ?? 60));
    const limit = Number(opts.limit ?? 50);

    console.log('watch: starting');
    console.log('Relays:', cfg.relays.join(', '));
    console.log('Following:', cfg.follows.map((x) => short(x)).join(', '));
    console.log('Sync every:', syncEverySec, 'sec');

    let stopped = false;
    const stop = () => { stopped = true; };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);

    // Subscribe
    const since = Math.floor(Date.now() / 1000) - 60 * 60 * 24 * 7; // 7 days
    const filters = [{ kinds: [1, 7], authors: cfg.follows, limit, since }];

    const sub = subscribeFeed(cfg.relays, filters as any, (ev, relay) => {
      insertEventIfMissing(db, {
        id: ev.id,
        kind: ev.kind,
        pubkey: ev.pubkey,
        created_at: ev.created_at,
        content: ev.content,
        tags_json: JSON.stringify(ev.tags),
        sig: ev.sig,
        raw_json: JSON.stringify(ev),
        received_at: Math.floor(Date.now() / 1000)
      });
      console.log(renderEvent(ev), `(via ${relay})`);
    });

    // Periodic sync loop
    while (!stopped) {
      try {
        const res = await syncPendingOnce(cfg, db, 50);
        if (res.attempted) {
          console.log(`sync: attempted=${res.attempted} published=${res.published} stillPending=${res.stillPending}`);
        }
      } catch (e: any) {
        console.error('sync loop error:', String(e?.message ?? e));
      }

      await new Promise((r) => setTimeout(r, syncEverySec * 1000));
    }

    try { sub.close(); } catch {}
    console.log('watch: stopped');
  });

program
  .command('config-reset')
  .description('Reset config to defaults (keeps keys/db)')
  .action(() => {
    saveConfig(DEFAULT_CONFIG);
    console.log('OK reset config');
  });

await program.parseAsync(process.argv);
