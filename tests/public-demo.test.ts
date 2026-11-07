import { afterEach, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, request as httpRequest } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const entrypoint = fileURLToPath(new URL('../server/index.ts', import.meta.url));
const publicHost = 'demo-test.trycloudflare.com';
const cleanups: (() => Promise<void>)[] = [];

async function startServer(environment: Record<string, string> = {}) {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'blurt-public-demo-'));
  const directory = join(temporaryRoot, '.demo-checkout');
  mkdirSync(directory);
  mkdirSync(join(directory, 'dist'));
  writeFileSync(join(directory, 'dist', 'index.html'), '<main>Demo fixture</main>');
  const reservation = createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const address = reservation.address();
  if (!address || typeof address === 'string') throw new Error('Missing test listener');
  const port = address.port;
  await new Promise<void>(resolve => reservation.close(() => resolve()));

  // No inherited credentials or project .env files: this process can only run the free demo.
  const child = spawn(process.execPath, ['--import', require.resolve('tsx'), entrypoint], {
    cwd: directory,
    env: {
      PATH: process.env.PATH, NODE_ENV: 'production', PORT: String(port),
      VIVACOACH_DB_PATH: join(directory, 'practice.sqlite'), VIVACOACH_LIVE_AI: 'false',
      OPENAI_API_KEY: '', ELEVENLABS_API_KEY: '', ...environment,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  cleanups.push(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGTERM');
      await exited;
    }
    rmSync(temporaryRoot, { recursive: true, force: true });
  });
  await new Promise<void>((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`Server startup timed out: ${output}`)), 8000);
    const collect = (chunk: Buffer) => {
      output += chunk.toString();
      if (output.includes('blurtReply is ready at')) { clearTimeout(timer); resolve(); }
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Server exited (${code}): ${output}`)); });
  });
  return {
    request(method: string, path: string, host: string, body?: unknown, headers: Record<string, string> = {}) {
      return new Promise<{ status: number; headers: import('node:http').IncomingHttpHeaders; text: string }>((resolve, reject) => {
        const request = httpRequest({ hostname: '127.0.0.1', port, method, path,
          headers: { Host: host, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
        }, response => {
          let text = '';
          response.setEncoding('utf8');
          response.on('data', chunk => { text += chunk; });
          response.on('end', () => resolve({ status: response.statusCode!, headers: response.headers, text }));
        });
        request.on('error', reject);
        request.end(body === undefined ? undefined : JSON.stringify(body));
      });
    },
  };
}

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const input = {
  mode: 'demo',
  text: 'Sampling variation can decrease with a larger independent sample. Recruitment bias is not removed merely by increasing sample size.',
};

describe('production public demo startup', () => {
  it('accepts public HTTPS requests and reloads a practice inside a hidden checkout directory', async () => {
    const server = await startServer({ VIVACOACH_PUBLIC_DEMO: 'true' });
    const status = await server.request('GET', '/api/status', publicHost);
    expect(status.status).toBe(200);
    expect(JSON.parse(status.text).localOnly).toBe(false);
    const created = await server.request('POST', '/api/practices', publicHost, input, { Origin: `https://${publicHost}` });
    expect(created.status).toBe(201);
    const cookie = created.headers['set-cookie']![0].split(';')[0];
    const practice = JSON.parse(created.text);
    expect((await server.request('GET', `/api/practices/${practice.id}`, publicHost, undefined, { Cookie: cookie })).status).toBe(200);
    const page = await server.request('GET', `/practice/${practice.id}`, publicHost);
    expect(page.status).toBe(200);
    expect(page.text).toContain('<main>Demo fixture</main>');
    expect((await server.request('POST', '/api/practices', publicHost, input, { Origin: 'https://unrelated.example' })).status).toBe(403);
  });

  it('marks the session cookie Secure even when the tunnel reaches the server over HTTP', async () => {
    const server = await startServer({ VIVACOACH_PUBLIC_DEMO: 'true' });
    const created = await server.request('POST', '/api/practices', 'localhost', input);
    expect(created.status).toBe(201);
    expect(created.headers['set-cookie']![0]).toMatch(/; Secure(?:;|$)/);
  });

  it('refuses public demo mode before starting a development server', async () => {
    await expect(startServer({ NODE_ENV: 'development', VIVACOACH_PUBLIC_DEMO: 'true' })).rejects.toThrow('NODE_ENV=production');
  });

  it('retains local host restrictions and HTTP-compatible cookies by default', async () => {
    const server = await startServer();
    expect((await server.request('GET', '/api/status', publicHost)).status).toBe(403);
    const status = await server.request('GET', '/api/status', 'localhost');
    expect(JSON.parse(status.text).localOnly).toBe(true);
    const created = await server.request('POST', '/api/practices', 'localhost', input);
    expect(created.status).toBe(201);
    expect(created.headers['set-cookie']![0]).not.toMatch(/; Secure(?:;|$)/);
  });
});
