/**
 * Production Server
 *
 * Wraps the Astro standalone handler. SSE and POST endpoints
 * are handled by Astro's built-in API routing.
 *
 * Usage:  node server.mjs
 * Env:    HOST (default 0.0.0.0), PORT (default 4321)
 */

import { createServer } from 'node:http';
import { handler } from './dist/server/entry.mjs';

const HOST = process.env.HOST ?? '0.0.0.0';
const PORT = Number(process.env.PORT ?? 4321);

const httpServer = createServer(handler);

httpServer.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});
