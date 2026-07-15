import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    // Server integration tests (real HTTP server + engine-probe subprocesses)
    // nominally run 3-4s on shared CI runners; the 5s vitest default flakes there.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
  server: {
    // Bind IPv4 loopback explicitly: Node 17+ resolves `localhost` to ::1,
    // which browsers with IPv6 disabled cannot reach.
    host: '127.0.0.1',
    proxy: {
      '/api': 'http://127.0.0.1:7791',
    },
  },
});
