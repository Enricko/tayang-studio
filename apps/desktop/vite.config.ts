import path from 'node:path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => {
  const web = mode === 'web';
  // The same React app has two transports. Desktop builds keep the Tauri implementation; the web
  // build gets the HTTP/SSE one. TypeScript always checks the web implementation (the canonical
  // `lib/ipc.ts` / `lib/events.ts`).
  const transport = web
    ? []
    : [
        { find: '@/lib/ipc', replacement: path.resolve(import.meta.dirname, 'src/lib/ipc.desktop.ts') },
        { find: '@/lib/events', replacement: path.resolve(import.meta.dirname, 'src/lib/events.desktop.ts') },
        { find: '@/lib/liveChat', replacement: path.resolve(import.meta.dirname, 'src/lib/liveChat.desktop.ts') },
        { find: '@/lib/cardEvents', replacement: path.resolve(import.meta.dirname, 'src/lib/cardEvents.desktop.ts') },
      ];
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: [
        ...transport,
        { find: '@', replacement: path.resolve(import.meta.dirname, 'src') },
      ],
    },
    clearScreen: false,
    server: {
      port: web ? 5173 : 1420,
      strictPort: true,
      ...(web
        ? {
            proxy: {
              '/api': {
                target: process.env.TAYANG_SERVER_URL || 'http://127.0.0.1:8787',
                changeOrigin: false,
              },
            },
          }
        : {}),
    },
  };
});
