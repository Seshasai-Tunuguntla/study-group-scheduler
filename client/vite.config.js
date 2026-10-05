import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Fixed port so it always matches CLIENT_ORIGIN in server/.env (the CORS allow-list).
    port: 5180,
    strictPort: true,
    // Same-origin /api in dev mirrors the Vercel rewrite in production,
    // so the client never needs to know the backend URL. `vite preview` uses the same proxy;
    // the end-to-end tests point it at their own API with API_URL.
    proxy: {
      '/api': process.env.API_URL ?? 'http://localhost:4100',
    },
  },
})
