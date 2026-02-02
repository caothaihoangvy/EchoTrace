#!/usr/bin/env node

import { Command } from 'commander';
import { loadConfig, saveConfig, DEFAULT_CONFIG } from './config.js';
import { loadIdentity, normalizePubkey } from './keys.js';
import { openDb, insertEventIfMissing, addPending, listDuePending, bumpPending, removePending } from './db.js';
import {
  buildMetadataEvent,
  buildPostEvent,
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

    const results = await publishToRelays(cfg.relays, ev);
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
  .action(async (textParts) => {
    const content = Array.isArray(textParts) ? textParts.join(' ') : String(textParts);
    const id = loadIdentity();
    const cfg = loadConfig();
    const db = openDb();

    const ev = buildPostEvent(id, content);

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

    const results = await publishToRelays(cfg.relays, ev);
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

    const results = await publishToRelays(cfg.relays, ev);
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

    const results = await publishToRelays(cfg.relays, ev);
    const ok = results.some((x) => x.ok);
    if (!ok) {
      addPending(db, ev.id, JSON.stringify(ev), results.map((x) => `${x.relay}: ${x.error ?? 'fail'}`).join('; '));
      console.error('Reply saved locally; queued retry.');
    } else {
      console.log('OK reply id:', ev.id);
    }
  });

program
  .command('sync')
  .description('Retry pending publishes')
  .action(async () => {
    const cfg = loadConfig();
    const db = openDb();
    const due = listDuePending(db, 50);

    if (!due.length) {
      console.log('No pending publishes due.');
      return;
    }

    console.log(`Retrying ${due.length} pending events...`);

    for (const item of due) {
      try {
        const ev = JSON.parse(item.event_json);
        const results = await publishToRelays(cfg.relays, ev);
        const ok = results.some((r) => r.ok);
        if (ok) {
          removePending(db, item.id);
          console.log('OK published:', item.id);
        } else {
          bumpPending(db, item.id, results.map((r) => `${r.relay}: ${r.error ?? 'fail'}`).join('; '));
          console.log('Still failing:', item.id);
        }
      } catch (e: any) {
        bumpPending(db, item.id, String(e?.message ?? e));
        console.log('Error parsing/publishing:', item.id);
      }
    }
  });

program
  .command('config')
  .description('Print current config')
  .action(() => {
    const cfg = loadConfig();
    console.log(JSON.stringify(cfg, null, 2));
  });

program
  .command('config-reset')
  .description('Reset config to defaults (keeps keys/db)')
  .action(() => {
    saveConfig(DEFAULT_CONFIG);
    console.log('OK reset config');
  });

await program.parseAsync(process.argv);
