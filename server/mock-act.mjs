#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';

const fixture = process.env.MOCK_ACT_FIXTURE;
const exitCode = Number(process.env.MOCK_ACT_EXIT ?? '0');
const hold = process.env.MOCK_ACT_HOLD === '1';
const dumpEnv = process.env.MOCK_ACT_DUMP_ENV;

if (dumpEnv) {
  const secrets = Object.keys(process.env).filter((k) => k.startsWith('MOCKSECRET_'));
  writeFileSync(dumpEnv, [
    `DOCKER_HOST=${process.env.DOCKER_HOST ?? ''}`,
    `ARGS=${process.argv.slice(2).join(' ')}`,
    ...secrets.map((k) => `${k}=${process.env[k]}`),
  ].join('\n'));
}

const lines = fixture ? readFileSync(fixture, 'utf8').split('\n').filter((l) => l.trim()) : [];
let i = 0;
const tick = setInterval(() => {
  if (i < lines.length) {
    process.stdout.write(lines[i++] + '\n');
  } else if (!hold) {
    clearInterval(tick);
    process.exit(exitCode);
  }
}, 5);
process.on('SIGTERM', () => process.exit(130));
