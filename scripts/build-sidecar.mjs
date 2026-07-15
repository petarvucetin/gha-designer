// Compile the Node runner server into a self-contained sidecar binary for Tauri.
// Tauri resolves an externalBin `binaries/gha-runner` to `binaries/gha-runner-<target-triple>[.exe]`.
import { execSync } from 'node:child_process';
import { mkdirSync, copyFileSync } from 'node:fs';

const hostLine = execSync('rustc -Vv').toString().split('\n').find((l) => l.startsWith('host:'));
if (!hostLine) throw new Error('could not determine rustc host triple');
const triple = hostLine.split(/\s+/)[1];
const ext = triple.includes('windows') ? '.exe' : '';

mkdirSync('src-tauri/binaries', { recursive: true });
const out = `src-tauri/binaries/gha-runner-${triple}${ext}`;

console.log(`compiling sidecar → ${out}`);
execSync(`bun build server/runner-entry.ts --compile --outfile ${out}`, { stdio: 'inherit' });
console.log('sidecar built:', out);

// Stage the `act` binary as a second externalBin so the packaged app is self-contained.
const actLookup = process.platform === 'win32' ? 'where act' : 'which act';
let actSrc;
try {
  actSrc = execSync(actLookup).toString().split(/\r?\n/).map((l) => l.trim()).find(Boolean);
} catch {
  actSrc = undefined;
}
if (!actSrc) {
  throw new Error('could not find `act` on PATH to bundle (install: winget install nektos.act)');
}
const actOut = `src-tauri/binaries/act-${triple}${ext}`;
copyFileSync(actSrc, actOut); // follows the WinGet symlink, copies real bytes
console.log('act staged:', actOut, '(from', actSrc + ')');
