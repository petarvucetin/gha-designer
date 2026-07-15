import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // Bind IPv4 loopback explicitly: Node 17+ resolves `localhost` to ::1,
    // which browsers with IPv6 disabled cannot reach.
    host: '127.0.0.1',
    proxy: {
      '/api': 'http://127.0.0.1:7791',
    },
  },
});
