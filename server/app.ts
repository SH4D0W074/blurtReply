import express, { type ErrorRequestHandler } from 'express';
import cookieParser from 'cookie-parser';
import { posix } from 'node:path';
import { z } from 'zod';
import type { ServerStatus } from '../shared/types';
import { getTextAIStatus } from './agents';
import { getSamples } from './courses';
import { getVoiceStatus, transcribeAudio, speakQuestion, VoiceError } from './voice';
import { HttpError } from './errors';
import { PracticeService, type PracticeOptions } from './practices';
import { getExistingSession, getOrCreateSession } from './sessions';
import { Store } from './store';

export interface AppOptions extends PracticeOptions {
  store?: Store;
  databasePath?: string;
  localOnly?: boolean;
  secureCookies?: boolean;
  getTextAIStatus?: typeof getTextAIStatus;
  getVoiceStatus?: typeof getVoiceStatus;
  transcribeAudio?: typeof transcribeAudio;
  speakQuestion?: typeof speakQuestion;
}

const practiceId = z.string().uuid();
const createSchema = z.object({
  mode: z.enum(['demo', 'live']), sampleId: z.string().trim().min(1).max(100).optional(),
  title: z.string().trim().min(1).max(100).optional(),
  sourceName: z.string().trim().min(1).max(160).optional(),
  text: z.string().trim().min(80, 'Add at least 80 characters of selectable course text.').max(30_000, 'Keep the course material under 30,000 characters.').optional(),
  origin: z.enum(['upload', 'paste']).optional(),
}).strict().superRefine((value, context) => {
  if (Boolean(value.sampleId) === Boolean(value.text)) {
    context.addIssue({ code: 'custom', message: 'Choose one sample or provide your own course text.' });
  }
});
const answerSchema = z.object({
  questionId: z.string().uuid(), answer: z.string().trim().min(1, 'Add your explanation before submitting.').max(2500),
  idempotencyKey: z.string().min(8).max(128).regex(/^[A-Za-z0-9_-]+$/),
}).strict();
const AUDIO_TYPES = new Set(['audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/m4a', 'audio/x-m4a']);

export function createApp(options: AppOptions = {}) {
  const app = express();
  const store = options.store ?? new Store(options.databasePath);
  const practices = new PracticeService(store, options);
  const localOnly = options.localOnly ?? true;
  const transcribe = options.transcribeAudio ?? transcribeAudio;
  const speak = options.speakQuestion ?? speakQuestion;
  const audioInFlight = new Set<string>();
  app.locals.store = store;
  app.locals.practices = practices;
  app.disable('x-powered-by');
  app.set('trust proxy', false);

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    if (localOnly && !['127.0.0.1', 'localhost', '[::1]', '::1'].includes(req.hostname)) {
      return next(new HttpError(403, 'This server is available on this computer only.', 'LOCAL_ONLY'));
    }
    let requestedPath = req.path;
    try {
      for (let depth = 0; depth < 4; depth++) {
        const decoded = decodeURIComponent(requestedPath);
        if (decoded === requestedPath) break;
        requestedPath = decoded;
      }
      if (/%[0-9a-f]{2}/i.test(requestedPath)) throw new Error('Excessive encoding');
      requestedPath = posix.normalize(requestedPath.replaceAll('\\', '/'));
    } catch { return next(new HttpError(400, 'The requested path is invalid.', 'INVALID_PATH')); }
    if (/(^|\/)(server|\.local|\.git|\.tools|tests|docs)(\/|$)/i.test(requestedPath)
      || /(^|\/)\.env(?:\.|$)/i.test(requestedPath)) {
      return next(new HttpError(404, 'That resource is not public.', 'NOT_FOUND'));
    }
    next();
  });
  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const isAudio = req.method === 'POST' && /^\/practices\/[^/]+\/transcriptions\/?$/.test(req.path);
      if (!isAudio && !req.is('application/json')) return next(new HttpError(415, 'Send this request as JSON.', 'JSON_REQUIRED'));
      const origin = req.headers.origin;
      if (origin) {
        try {
          if (new URL(origin).host !== req.headers.host) throw new Error('Cross-origin request');
        } catch { return next(new HttpError(403, 'Open this action from your VivaCoach page.', 'ORIGIN_MISMATCH')); }
      }
      if (req.headers['sec-fetch-site'] === 'cross-site') {
        return next(new HttpError(403, 'Cross-site requests are not accepted.', 'ORIGIN_MISMATCH'));
      }
    }
    next();
  });
  app.use('/api', cookieParser());
  app.use('/api', (req, res, next) => { res.locals.ownerId = getExistingSession(store, req); next(); });
  app.use('/api', express.json({ limit: '192kb' }));

  app.get('/api/status', (_req, res) => {
    const status: ServerStatus = {
      ...(options.getTextAIStatus ?? getTextAIStatus)(), ...(options.getVoiceStatus ?? getVoiceStatus)(), localOnly,
    };
    res.json(status);
  });
  app.get('/api/samples', (_req, res) => res.json(getSamples()));
  app.get('/api/practices', (_req, res) => res.json(practices.recent(res.locals.ownerId)));
  app.post('/api/practices', (req, res) => {
    const { mode, ...input } = createSchema.parse(req.body);
    if (input.sampleId && !getSamples().some(sample => sample.id === input.sampleId)) {
      throw new HttpError(400, 'Choose an available sample course.', 'INVALID_SAMPLE');
    }
    const ownerId = getOrCreateSession(store, req, res, options.secureCookies);
    res.status(201).json(practices.create(ownerId, input, mode));
  });
  app.get('/api/practices/:id', (req, res) => res.json(practices.snapshot(practiceId.parse(req.params.id), res.locals.ownerId)));
  app.post('/api/practices/:id/answers', (req, res) => {
    res.json(practices.submit(practiceId.parse(req.params.id), res.locals.ownerId, answerSchema.parse(req.body)));
  });
  app.post('/api/practices/:id/finish', (req, res) => {
    z.object({}).strict().parse(req.body);
    res.json(practices.finish(practiceId.parse(req.params.id), res.locals.ownerId));
  });
  app.post('/api/practices/:id/transcriptions', (req, res, next) => {
    const state = practices.snapshot(practiceId.parse(req.params.id), res.locals.ownerId);
    if (state.mode === 'demo') throw new HttpError(409, 'The free demo uses typed example answers and device voice. Start a live practice to transcribe audio.', 'DEMO_AUDIO');
    if (state.phase !== 'ready' || !state.currentQuestion) throw new HttpError(409, 'Wait for an available question before recording.', 'PRACTICE_BUSY');
    const mime = req.headers['content-type']?.split(';')[0].trim().toLowerCase() ?? '';
    if (!AUDIO_TYPES.has(mime)) throw new HttpError(415, 'Use a supported audio recording format.', 'AUDIO_TYPE');
    res.locals.audioMime = mime;
    res.locals.practice = state;
    next();
  }, express.raw({ type: () => true, limit: 2 * 1024 * 1024, inflate: false }), async (req, res, next) => {
    const state = res.locals.practice as ReturnType<PracticeService['snapshot']>;
    try {
      if (!Buffer.isBuffer(req.body) || !req.body.length) throw new HttpError(400, 'Record some audio before transcribing.', 'EMPTY_AUDIO');
      const beforeTranscription = practices.snapshot(state.id, res.locals.ownerId);
      if (beforeTranscription.phase !== 'ready' || beforeTranscription.currentQuestion?.id !== state.currentQuestion?.id) {
        throw new HttpError(409, 'The practice moved on while the recording uploaded. Your saved answers are unchanged.', 'STALE_QUESTION');
      }
      if (audioInFlight.has(state.id)) throw new HttpError(409, 'A recording is already being transcribed for this practice.', 'AUDIO_BUSY');
      audioInFlight.add(state.id);
      try {
        const result = await transcribe(req.body, res.locals.audioMime, `${state.course.subject}: ${state.course.title}`.slice(0, 160));
        const current = practices.snapshot(state.id, res.locals.ownerId);
        if (current.phase !== 'ready' || current.currentQuestion?.id !== state.currentQuestion?.id) {
          throw new HttpError(409, 'The practice moved on while this recording was transcribed. Your saved answers are unchanged.', 'STALE_QUESTION');
        }
        res.json(result);
      } finally { audioInFlight.delete(state.id); }
    } catch (error) { next(error); }
  });
  app.post('/api/practices/:id/question-audio', async (req, res, next) => {
    try {
      const { questionId } = z.object({ questionId: z.string().uuid() }).strict().parse(req.body);
      const state = practices.snapshot(practiceId.parse(req.params.id), res.locals.ownerId);
      if (state.mode === 'demo') throw new HttpError(409, 'The free demo uses the voice available on your device.', 'DEMO_AUDIO');
      if (state.phase !== 'ready' || state.currentQuestion?.id !== questionId) {
        throw new HttpError(409, 'That question is no longer active.', 'STALE_QUESTION');
      }
      const audio = await speak(state.currentQuestion.text, `${state.id}:${questionId}`);
      res.type('audio/mpeg').send(audio);
    } catch (error) { next(error); }
  });
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'That API route does not exist.', 'NOT_FOUND')));
  const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
    if (error instanceof HttpError || error instanceof VoiceError) {
      res.status(error.status).json({ error: error.message, code: error.code });
    } else if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.issues[0]?.message ?? 'Check the submitted values.', code: 'INVALID_INPUT' });
    } else if (error?.type === 'entity.too.large') {
      res.status(413).json({ error: 'This upload is too large. Use a shorter recording or less course text.', code: 'REQUEST_TOO_LARGE' });
    } else if (error?.type === 'encoding.unsupported') {
      res.status(415).json({ error: 'Compressed audio request bodies are not supported.', code: 'AUDIO_ENCODING' });
    } else if (error instanceof SyntaxError && 'body' in error) {
      res.status(400).json({ error: 'The request contained invalid JSON.', code: 'INVALID_JSON' });
    } else {
      console.error('[VivaCoach] Request failed:', error instanceof Error ? error.name : 'UnknownError');
      res.status(500).json({ error: 'The local server could not finish this request. Saved material and answers remain available.', code: 'SERVER_ERROR' });
    }
  };
  app.use(errorHandler);
  return app;
}
