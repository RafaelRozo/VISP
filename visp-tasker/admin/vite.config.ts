import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': {
        target: 'https://api.richieyanez.com',
        changeOrigin: true,
        secure: true,
      },
      '/uploads': {
        target: 'https://api.richieyanez.com',
        changeOrigin: true,
        secure: true,
      },
    },
  },
});
