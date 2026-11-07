import { config } from 'dotenv';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import express from 'express';
import { createApp } from './app';

config({ path: '.env.local', quiet: true });
config({ path: '.env', quiet: true });

const port = Number(process.env.PORT ?? 3000);
const host = process.env.VIVACOACH_HOST ?? '127.0.0.1';
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535.');
const publicDemo = process.env.VIVACOACH_PUBLIC_DEMO === 'true';
if (publicDemo && process.env.NODE_ENV !== 'production') throw new Error('VIVACOACH_PUBLIC_DEMO requires NODE_ENV=production.');
const localOnly = !publicDemo && ['127.0.0.1', 'localhost', '::1'].includes(host);
const app = createApp({
  databasePath: process.env.VIVACOACH_DB_PATH ?? resolve('.local/vivacoach.sqlite'),
  localOnly, secureCookies: publicDemo,
});
const server = createHttpServer(app);

let vite: Awaited<ReturnType<typeof import('vite')['createServer']>> | undefined;
if (process.env.NODE_ENV === 'production') {
  const dist = resolve('dist');
  if (!existsSync(resolve(dist, 'index.html'))) throw new Error('Build the interface before starting production mode.');
  app.use(express.static(dist));
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
    res.sendFile('index.html', { root: dist });
  });
} else {
  const { createServer } = await import('vite');
  vite = await createServer({
    server: { middlewareMode: true, hmr: { server },
      fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.local/**', '**/server/**', '**/tests/**', '**/docs/**'] } },
    appType: 'spa',
  });
  app.use(vite.middlewares);
}

server.listen(port, host, () => {
  console.log(`blurtReply is ready at http://${host.includes(':') ? `[${host}]` : host}:${port}`);
  console.log(publicDemo ? 'Public demo mode: share the HTTPS tunnel URL. Session cookies require HTTPS.'
    : localOnly ? 'Local mode: this computer only.' : 'LAN binding enabled. Only use a trusted network.');
});
server.on('error', error => { console.error(`blurtReply could not start: ${error.message}`); process.exitCode = 1; });

let stopping = false;
function shutdown() {
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
