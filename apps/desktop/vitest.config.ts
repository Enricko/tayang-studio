import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      // Tests exercise the desktop transport and mock Tauri, as before.
      { find: '@/lib/ipc', replacement: path.resolve(import.meta.dirname, 'src/lib/ipc.desktop.ts') },
      { find: '@/lib/events', replacement: path.resolve(import.meta.dirname, 'src/lib/events.desktop.ts') },
      { find: '@/lib/liveChat', replacement: path.resolve(import.meta.dirname, 'src/lib/liveChat.desktop.ts') },
      { find: '@/lib/cardEvents', replacement: path.resolve(import.meta.dirname, 'src/lib/cardEvents.desktop.ts') },
      { find: '@', replacement: path.resolve(import.meta.dirname, 'src') },
    ],
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
