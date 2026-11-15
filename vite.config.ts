import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { officialRobots } from './tools/official-robots.mjs';

export default defineConfig({
  // Relative paths, so the built site works at any address, such as username.github.io/repository/.
  base: './',
  plugins: [react(), officialRobots()],
  server: { port: 5173 },
  // Some tests simulate a full field for many seconds, which is slow when every file runs at once.
  test: { environment: 'node', include: ['tests/**/*.test.ts'], testTimeout: 60000 },
});
