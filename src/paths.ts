import os from 'node:os';
import path from 'node:path';

export function baseDir() {
  return path.join(os.homedir(), '.agentlog');
}

export function configPath() {
  return path.join(baseDir(), 'config.json');
}

export function keysDir() {
  return path.join(baseDir(), 'keys');
}

export function nsecPath() {
  return path.join(keysDir(), 'nsec');
}

export function dbPath() {
  return path.join(baseDir(), 'db.sqlite');
}
