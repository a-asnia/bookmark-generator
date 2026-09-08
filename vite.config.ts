import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Served from https://<user>.github.io/bookmark-generator/
export default defineConfig({
  plugins: [react()],
  base: './',
  build: { target: 'es2020', chunkSizeWarningLimit: 1500 },
});
