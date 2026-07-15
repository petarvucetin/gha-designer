#!/usr/bin/env node
// Test double for `ssh`: ignores argv (the real ssh arg shape is still exercised by the
// caller — see runManager.test.ts's vm test), reads the bootstrap script piped to stdin,
// and emits a minimal act --json stream mirroring a real job success.
let buf = '';
process.stdin.on('data', (d) => (buf += d));
process.stdin.on('end', () => {
  // surface a workflow line so the parser produces a 'line' event
  process.stdout.write(JSON.stringify({ level: 'info', msg: 'hi\n', raw_output: true, job: 'b', jobID: 'b', stage: 'Main', step: 'echo hi', stepID: ['0'] }) + '\n');
  process.stdout.write(JSON.stringify({ level: 'info', msg: '🏁  Job succeeded', job: 'b', jobID: 'b', jobResult: 'success' }) + '\n');
  process.exit(0);
});
