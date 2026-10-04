import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8080',
      '/mqtt': { target: 'ws://localhost:8080', ws: true },
    },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2500,
    rollupOptions: {
      output: {
        manualChunks: {
          codemirror: ['@uiw/react-codemirror', '@codemirror/lang-cpp', '@codemirror/autocomplete', '@codemirror/lint'],
          sim: ['@esp32lab/sim'],
        },
      },
    },
  },
});
