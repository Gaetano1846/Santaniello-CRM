import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'client',
  plugins: [react()],
  build: { outDir: '../dist', emptyOutDir: true },
  server: {
    host: true,
    allowedHosts: true,
    port: 5173,
    proxy: {
      '/api': 'http://localhost:4310',
      '/storage': 'http://localhost:4310',
    },
  },
});
