import type { Event } from 'nostr-tools';

export function short(hex: string, n = 8) {
  return hex.length <= n ? hex : hex.slice(0, n);
}

export function renderEvent(ev: Event) {
  const ts = new Date(ev.created_at * 1000).toISOString();
  const kind = ev.kind;
  const id = short(ev.id);
  const pub = short(ev.pubkey);
  let content = ev.content;
  if (content.length > 280) content = content.slice(0, 277) + '...';
  return `[${ts}] kind=${kind} ${id} pub=${pub}: ${content}`;
}
