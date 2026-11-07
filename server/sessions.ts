import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { Store } from './store';

const COOKIE_NAME = 'pairwise_session';
const LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

/** Read-only requests must not race to replace a browser's identity cookie. */
export function getExistingSession(store: Store, req: Request): string | null {
  const token = req.cookies?.[COOKIE_NAME];
  const now = new Date().toISOString();
  if (typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token)) {
    const existing = store.get<{ id: string }>(
      'SELECT id FROM sessions WHERE token_hash = ? AND expires_at > ?', hash(token), now,
    );
    if (existing) return existing.id;
  }
  return null;
}

export function getOrCreateSession(store: Store, req: Request, res: Response, secure: boolean): string {
  const existing = getExistingSession(store, req);
  if (existing) return existing;
  const now = new Date().toISOString();
  const nextToken = randomBytes(32).toString('base64url');
  const id = randomUUID();
  store.run('INSERT INTO sessions (id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?)',
    id, hash(nextToken), now, new Date(Date.now() + LIFETIME_MS).toISOString());
  res.cookie(COOKIE_NAME, nextToken, {
    httpOnly: true, sameSite: 'lax', secure, maxAge: LIFETIME_MS, path: '/',
  });
  return id;
}
