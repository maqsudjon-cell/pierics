import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// /api is proxied to the Express backend during dev so the frontend can talk
// to the live pricing engine. The UI also works if the backend is offline
// (it falls back to the local pricing mirror in src/lib/pricing.js).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:3000' },
  },
});
