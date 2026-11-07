import express, { type ErrorRequestHandler } from 'express';
import cookieParser from 'cookie-parser';
import { posix } from 'node:path';
import { z } from 'zod';
import { LESSONS, toPublicLesson } from '../shared/lessons';
import type { ServerStatus } from '../shared/types';
import { getAnalysisStatus } from './analysis';
import { HttpError } from './errors';
import { RoomService, type RoomServiceOptions } from './rooms';
import { getExistingSession, getOrCreateSession } from './sessions';
import { Store } from './store';

export interface AppOptions extends RoomServiceOptions {
  store?: Store;
  databasePath?: string;
  localOnly?: boolean;
  secureCookies?: boolean;
  joinBaseUrl?: string;
}

const codeSchema = z.string().trim().toUpperCase().regex(/^[A-Z2-9]{6}$/);
const creationSchema = z.object({
  lessonId: z.string().min(1).max(80), mode: z.enum(['demo', 'live']),
  title: z.string().trim().min(1).max(100).optional(),
}).strict();
const responseSchema = z.object({
  stage: z.enum(['initial', 'transfer']), choiceId: z.string().min(1).max(80),
  reason: z.string().trim().min(1, 'Add a short explanation.').max(1200, 'Keep your explanation under 1,200 characters.'),
}).strict();
const actionSchema = z.object({
  action: z.enum(['analyse', 'reveal', 'publish-pairs', 'start-retest', 'show-results', 'close', 'restart-demo', 'fallback-pairs']),
  version: z.number().int().positive().optional(),
}).strict();

function requireExistingSession(sessionId: string | null): string {
  if (!sessionId) {
    throw new HttpError(403, 'Open the browser you used for this room, or join before responding.', 'SESSION_REQUIRED');
  }
  return sessionId;
}

export function createApp(options: AppOptions = {}) {
  const app = express();
  const store = options.store ?? new Store(options.databasePath);
  const rooms = new RoomService(store, options);
  const localOnly = options.localOnly ?? true;
  app.locals.store = store;
  app.locals.rooms = rooms;
  app.disable('x-powered-by');
  app.set('trust proxy', false);

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    // Default loopback mode rejects attacker-controlled Host headers as well as remote binding.
    if (localOnly && !['127.0.0.1', 'localhost', '[::1]', '::1'].includes(req.hostname)) {
      return next(new HttpError(403, 'This server is configured for this computer only.', 'LOCAL_ONLY'));
    }
    let requestedPath = req.path;
    try {
      for (let depth = 0; depth < 4; depth++) {
        const decoded = decodeURIComponent(requestedPath);
        if (decoded === requestedPath) break;
        requestedPath = decoded;
      }
      if (/%[0-9a-f]{2}/i.test(requestedPath)) throw new Error('Excessive path encoding');
      requestedPath = posix.normalize(requestedPath.replaceAll('\\', '/'));
    }
    catch { return next(new HttpError(400, 'The requested path is invalid.', 'INVALID_PATH')); }
    // Vite serves source modules in development. Keep server code and authored answer keys private there too.
    if (/(^|\/)(server|\.local|\.git|\.tools)(\/|$)/i.test(requestedPath)
      || /(^|\/)\.env(?:\.|$)/i.test(requestedPath)
      || /\/shared\/lessons(?:\.|\/|$)/i.test(requestedPath)) {
      return next(new HttpError(404, 'That resource is not public.', 'NOT_FOUND'));
    }
    next();
  });

  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      if (!req.is('application/json')) {
        return next(new HttpError(415, 'Send this request as JSON.', 'JSON_REQUIRED'));
      }
      const origin = req.headers.origin;
      if (origin) {
        try {
          if (new URL(origin).host !== req.headers.host) {
            return next(new HttpError(403, 'Requests must come from the Pairwise page you opened.', 'ORIGIN_MISMATCH'));
          }
        } catch {
          return next(new HttpError(403, 'The request origin could not be verified.', 'ORIGIN_MISMATCH'));
        }
      }
      if (req.headers['sec-fetch-site'] === 'cross-site') {
        return next(new HttpError(403, 'Cross-site requests are not accepted.', 'ORIGIN_MISMATCH'));
      }
    }
    next();
  });
  app.use('/api', express.json({ limit: '24kb' }));
  app.use('/api', cookieParser());
  app.use('/api', (req, res, next) => {
    res.locals.sessionId = getExistingSession(store, req);
    next();
  });

  app.get('/api/status', (_req, res) => {
    const status: ServerStatus = {
      ...getAnalysisStatus(), storage: 'sqlite', localOnly,
      joinBaseUrl: options.joinBaseUrl ?? `http://localhost:${process.env.PORT || 3000}`,
    };
    res.json(status);
  });
  app.get('/api/lessons', (_req, res) => res.json(LESSONS.map(toPublicLesson)));
  app.post('/api/rooms', (req, res) => {
    const input = creationSchema.parse(req.body);
    const sessionId = getOrCreateSession(store, req, res, options.secureCookies ?? false);
    res.status(201).json(rooms.create(sessionId, input));
  });
  app.get('/api/rooms/:code', (req, res) => {
    const code = codeSchema.parse(req.params.code);
    const view = z.enum(['host', 'board', 'student']).parse(req.query.view ?? 'student');
    res.json(rooms.snapshot(code, res.locals.sessionId, view));
  });
  app.post('/api/rooms/:code/join', (req, res) => {
    z.object({}).strict().parse(req.body);
    const code = codeSchema.parse(req.params.code);
    const sessionId = getOrCreateSession(store, req, res, options.secureCookies ?? false);
    res.json(rooms.join(code, sessionId));
  });
  app.post('/api/rooms/:code/responses', (req, res) => {
    res.json(rooms.submit(codeSchema.parse(req.params.code), requireExistingSession(res.locals.sessionId), responseSchema.parse(req.body)));
  });
  app.post('/api/rooms/:code/clarification', (req, res) => {
    const body = z.object({ text: z.string().trim().min(1).max(1200) }).strict().parse(req.body);
    res.json(rooms.clarify(codeSchema.parse(req.params.code), requireExistingSession(res.locals.sessionId), body.text));
  });
  app.post('/api/rooms/:code/actions', async (req, res, next) => {
    try {
      const body = actionSchema.parse(req.body);
      res.json(await rooms.action(codeSchema.parse(req.params.code), requireExistingSession(res.locals.sessionId), body.action, body.version));
    } catch (error) { next(error); }
  });
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'That API route does not exist.', 'NOT_FOUND')));
  const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
    if (error instanceof HttpError) {
      res.status(error.status).json({ error: error.message, code: error.code });
    } else if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.issues[0]?.message ?? 'Check the submitted values.', code: 'INVALID_INPUT' });
    } else if (error instanceof SyntaxError && 'body' in error) {
      res.status(400).json({ error: 'The request contained invalid JSON.', code: 'INVALID_JSON' });
    } else if (error?.type === 'entity.too.large') {
      res.status(413).json({ error: 'That request is too large.', code: 'REQUEST_TOO_LARGE' });
    } else {
      // Do not log student reasoning, request bodies, model responses, cookies or keys.
      console.error('[Pairwise] Request failed:', error instanceof Error ? error.name : 'UnknownError');
      res.status(500).json({ error: 'The local server could not finish that request. Your saved responses remain available.', code: 'SERVER_ERROR' });
    }
  };
  app.use(errorHandler);
  return app;
}
