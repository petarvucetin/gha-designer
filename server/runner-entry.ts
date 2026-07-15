// Sidecar entry: explicitly starts the runner server (the index.ts auto-start
// guard keys off argv[1] matching index.*, which a compiled exe won't).
import { startServer } from './index';

startServer().then(
  ({ port }) => console.log(`gha-designer runner (sidecar) listening on http://127.0.0.1:${port}`),
  (err) => { console.error(`runner sidecar failed: ${err instanceof Error ? err.message : err}`); process.exit(1); },
);
