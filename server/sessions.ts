import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { Store } from './store';

const COOKIE_NAME = 'vivacoach_session';
const LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

export function getExistingSession(store: Store, req: Request): string | null {
  const token = req.cookies?.[COOKIE_NAME];
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  return store.get<{ id: string }>('SELECT id FROM identities WHERE token_hash = ? AND expires_at > ?',
    hash(token), new Date().toISOString())?.id ?? null;
}

/** Only explicit practice creation may allocate an identity; GETs never replace cookies. */
export function getOrCreateSession(store: Store, req: Request, res: Response, secure = false): string {
  const existing = getExistingSession(store, req);
  if (existing) return existing;
  const token = randomBytes(32).toString('base64url');
  const id = randomUUID();
  store.run('INSERT INTO identities (id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?)',
    id, hash(token), new Date().toISOString(), new Date(Date.now() + LIFETIME_MS).toISOString());
  res.cookie(COOKIE_NAME, token, { httpOnly: true, sameSite: 'lax', secure, maxAge: LIFETIME_MS, path: '/' });
  return id;
}
