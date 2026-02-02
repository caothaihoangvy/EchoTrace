import fs from 'node:fs';
import path from 'node:path';
import { baseDir, configPath } from './paths.js';

export type EchoTraceConfig = {
  relays: string[];
  follows: string[]; // pubkey hex
  cache_limit: number;
  autopost?: {
    enabled: boolean;
    interval_minutes: number;
  };
};

export const DEFAULT_CONFIG: EchoTraceConfig = {
  relays: ['wss://relay.damus.io', 'wss://nos.lol'],
  follows: [],
  cache_limit: 1000,
  autopost: { enabled: false, interval_minutes: 60 }
};

export function ensureBaseDir() {
  fs.mkdirSync(baseDir(), { recursive: true });
}

export function loadConfig(): EchoTraceConfig {
  ensureBaseDir();
  const p = configPath();
  if (!fs.existsSync(p)) return structuredClone(DEFAULT_CONFIG);
  const raw = fs.readFileSync(p, 'utf-8');
  const cfg = JSON.parse(raw) as Partial<EchoTraceConfig>;
  return {
    ...DEFAULT_CONFIG,
    ...cfg,
    relays: cfg.relays?.length ? cfg.relays : DEFAULT_CONFIG.relays,
    follows: cfg.follows ?? [],
    cache_limit: cfg.cache_limit ?? DEFAULT_CONFIG.cache_limit,
    autopost: cfg.autopost ?? DEFAULT_CONFIG.autopost
  };
}

export function saveConfig(cfg: EchoTraceConfig) {
  ensureBaseDir();
  const p = configPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2), 'utf-8');
}
