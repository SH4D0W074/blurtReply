import { config } from 'dotenv';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import express from 'express';
import { createApp } from './app';

config({ path: '.env.local', quiet: true });
config({ path: '.env', quiet: true });

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '127.0.0.1';
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535.');
const localOnly = ['127.0.0.1', 'localhost', '::1'].includes(host);
const lanAddress = Object.values(networkInterfaces()).flat().find(address => address?.family === 'IPv4' && !address.internal)?.address;
const browserHost = localOnly ? 'localhost' : host === '0.0.0.0' ? lanAddress ?? 'localhost' : host;
const app = createApp({
  databasePath: process.env.PAIRWISE_DATABASE_PATH ?? resolve('.local/pairwise.sqlite'),
  localOnly,
  joinBaseUrl: process.env.PAIRWISE_JOIN_BASE_URL ?? `http://${browserHost}:${port}`,
});
const server = createHttpServer(app);

let vite: Awaited<ReturnType<typeof import('vite')['createServer']>> | undefined;
if (process.env.NODE_ENV === 'production') {
  const dist = resolve('dist');
  if (!existsSync(resolve(dist, 'index.html'))) throw new Error('Build the interface before starting production mode.');
  app.use(express.static(dist));
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
    res.sendFile(resolve(dist, 'index.html'));
  });
} else {
  const { createServer } = await import('vite');
  vite = await createServer({
    server: {
      middlewareMode: true, hmr: { server },
      fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.local/**', '**/server/**', '**/shared/lessons.ts'] },
    },
    appType: 'spa',
  });
  app.use(vite.middlewares);
}

server.listen(port, host, () => {
  console.log(`Pairwise is ready at http://localhost:${port}`);
  console.log(localOnly ? 'Local mode: this computer only.' : 'LAN mode enabled. Only share this server on a trusted network.');
});
server.on('error', error => {
  console.error(`Pairwise could not start: ${error.message}`);
  process.exitCode = 1;
});

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  server.close(async () => {
    await vite?.close();
    app.locals.store.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
