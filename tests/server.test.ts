import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type Server, request as httpRequest } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp, type AppOptions } from '../server/app';
import { Store } from '../server/store';
import { PracticeService } from '../server/practices';
import type { CourseContent, Feedback, PracticeMode, PracticeReview, PracticeSession } from '../shared/types';

const sourceText = 'A representative sample includes the relevant population. Sampling variation can decrease with a larger independent sample. Recruitment bias is not removed merely by increasing sample size.';
const course: CourseContent = {
  title: 'Sampling concepts', subject: 'Statistics', sourceName: 'Test course notes', origin: 'paste',
  excerpts: [{ id: 'source-1', label: 'Course notes', text: sourceText }],
  concepts: [0, 1, 2].map(index => ({ id: `concept-${index + 1}`, title: `Sampling idea ${index + 1}`,
    sourceId: 'source-1', sourceQuote: sourceText, openingQuestion: `Explain sampling idea ${index + 1} in your own words.` })),
};
const feedback: Feedback = {
  assessment: 'partial', claimQuote: 'My explanation.', sourceId: 'source-1', sourceQuote: sourceText,
  observation: 'A fixture observation.', followUp: 'How would your explanation change for a new population?',
  followUpKind: 'transfer', source: 'demo', reviewStatus: 'checked',
};
const review: PracticeReview = { strengths: [], revisit: [], nextSteps: [], source: 'demo', note: 'A labelled fixture review.' };
const stubs: AppOptions = {
  prepareCourse: async (_input, _mode, emit) => {
    emit({ agent: 'planner', state: 'complete', label: 'Prepared fixture concepts', sourceIds: ['source-1'] });
    return structuredClone(course);
  },
  reviewAnswer: async (_course, _question, answer, _turns, _mode, emit) => {
    emit({ agent: 'examiner', state: 'complete', label: 'Fixture examiner proposal', sourceIds: ['source-1'] });
    emit({ agent: 'verifier', state: 'complete', label: 'Fixture evidence check', sourceIds: ['source-1'] });
    return { ...feedback, claimQuote: answer };
  },
  createReview: async (_course, _turns, _mode, emit) => {
    emit({ agent: 'coach', state: 'complete', label: 'Fixture revision review', sourceIds: [] });
    return structuredClone(review);
  },
  getTextAIStatus: () => ({ aiConfigured: false, aiEnabled: false, model: 'test-only', remainingTextCalls: 0 }),
  getVoiceStatus: () => ({ transcriptionAvailable: false, transcriptionModel: 'test-only', remainingTranscriptions: 0, voiceProvider: 'device', remainingVoiceCalls: 0 }),
  transcribeAudio: async () => ({ text: 'An editable transcript.', model: 'test-only' }),
  speakQuestion: async () => Buffer.from('mock-mp3'),
};

class Browser {
  cookie = '';
  constructor(readonly base: string) {}
  async request(method: string, path: string, body?: unknown, extra: Record<string, string> = {}) {
    const response = await fetch(this.base + path, { method,
      headers: { ...(this.cookie ? { Cookie: this.cookie } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...extra },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const cookie = response.headers.get('set-cookie');
    if (cookie) this.cookie = cookie.split(';')[0];
    return { status: response.status, headers: response.headers, data: await response.json() as any };
  }
  get(path: string) { return this.request('GET', path); }
  post(path: string, body: unknown) { return this.request('POST', path, body); }
  async audio(path: string, bytes: Buffer, mime = 'audio/webm') {
    const response = await fetch(this.base + path, { method: 'POST',
      headers: { Cookie: this.cookie, 'Content-Type': mime }, body: new Uint8Array(bytes) });
    return { status: response.status, data: await response.json() as any };
  }
}

const cleanups: (() => Promise<void> | void)[] = [];
const releases: (() => void)[] = [];
function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  releases.push(resolve);
  return { promise, resolve };
}
async function fixture(options: AppOptions = {}) {
  const store = options.store ?? new Store(':memory:');
  const app = createApp({ ...stubs, ...options, store });
  const service = app.locals.practices as PracticeService;
  const server = await new Promise<Server>(resolve => { const running = app.listen(0, '127.0.0.1', () => resolve(running)); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test address');
  const base = `http://127.0.0.1:${address.port}`;
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await service.idle();
    await new Promise<void>(resolve => server.close(() => resolve()));
    store.close();
  };
  cleanups.push(close);
  return { store, service, base, close, browser: () => new Browser(base) };
}
async function create(browser: Browser, service: PracticeService, mode: PracticeMode = 'demo') {
  const result = await browser.post('/api/practices', { mode, text: sourceText, title: course.title, origin: 'paste' });
  expect(result.status).toBe(201);
  expect(result.data.phase).toBe('thinking');
  await service.idle();
  return (await browser.get(`/api/practices/${result.data.id}`)).data as PracticeSession;
}
const answerInput = (session: PracticeSession, answer = 'My explanation.') => ({ questionId: session.currentQuestion!.id, answer, idempotencyKey: randomUUID() });

beforeEach(() => { vi.stubEnv('VIVACOACH_LIVE_AI', 'false'); vi.stubEnv('OPENAI_API_KEY', ''); vi.stubEnv('ELEVENLABS_API_KEY', ''); });
afterEach(async () => {
  for (const release of releases.splice(0)) release();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.unstubAllEnvs();
});

describe('local ownership and request privacy', () => {
  it('allocates identity only on creation and keeps practices private to the original browser', async () => {
    const f = await fixture();
    const owner = f.browser();
    const reads = await Promise.all(['/api/status', '/api/samples', '/api/practices'].map(path => owner.get(path)));
    expect(reads.every(result => result.status === 200 && !result.headers.has('set-cookie'))).toBe(true);
    expect(f.store.get<{ count: number }>('SELECT COUNT(*) AS count FROM identities')!.count).toBe(0);
    const session = await create(owner, f.service);
    const token = owner.cookie.split('=')[1];
    const identity = f.store.get<{ token_hash: string }>('SELECT token_hash FROM identities')!;
    expect(identity.token_hash).toBe(createHash('sha256').update(token).digest('hex'));
    const stranger = f.browser();
    expect((await stranger.get('/api/practices')).data).toEqual([]);
    expect((await stranger.get(`/api/practices/${session.id}`)).status).toBe(404);
    expect((await stranger.post(`/api/practices/${session.id}/answers`, answerInput(session))).status).toBe(404);
    expect((await stranger.post(`/api/practices/${session.id}/finish`, {})).status).toBe(404);
    expect(stranger.cookie).toBe('');
    expect(f.store.get<{ count: number }>('SELECT COUNT(*) AS count FROM identities')!.count).toBe(1);
    const ownReads = await Promise.all([owner.get('/api/status'), owner.get(`/api/practices/${session.id}`)]);
    expect(ownReads.every(result => !result.headers.has('set-cookie'))).toBe(true);
    expect((await owner.get('/api/practices')).data[0].id).toBe(session.id);
    expect(JSON.stringify(session)).not.toMatch(/owner_id|token_hash|input_json|operation_token/);
  });

  it('rejects cross-origin actions, hostile hosts, private source paths and excessive input', async () => {
    const f = await fixture();
    const browser = f.browser();
    const input = { mode: 'demo', text: sourceText };
    expect((await browser.request('POST', '/api/practices', input, { Origin: 'https://example.invalid' })).status).toBe(403);
    expect((await browser.post('/api/practices', { ...input, text: 'x'.repeat(30_001) })).status).toBe(400);
    expect((await browser.post('/api/practices', { ...input, sampleId: 'also-a-sample' })).status).toBe(400);
    expect((await browser.post('/api/practices', { mode: 'demo', sampleId: 'not-a-sample' })).status).toBe(400);
    expect(browser.cookie).toBe('');
    const hostStatus = await new Promise<number | undefined>((resolve, reject) => {
      const request = httpRequest(`${f.base}/api/status`, { headers: { Host: 'example.invalid' } }, response => {
        response.resume(); response.on('end', () => resolve(response.statusCode));
      });
      request.on('error', reject); request.end();
    });
    expect(hostStatus).toBe(403);
    for (const path of ['/server/agents.ts', '/%73erver/agents.ts', '/%2573erver/courses.ts', '/.env.local', '/%2eenv.local', '/.local/vivacoach.sqlite', '/@fs/private/project/server/courses.ts', '/tests/server.test.ts']) {
      expect((await browser.get(path)).status).toBe(404);
    }
    const session = await create(browser, f.service);
    expect((await browser.post(`/api/practices/${session.id}/answers`, answerInput(session, 'x'.repeat(2501)))).status).toBe(400);
    expect((await browser.get(`/api/practices/${session.id}`)).data.turns).toEqual([]);
  });
});

describe('six-question state machine and visible work', () => {
  it('returns preparation immediately and exposes only actual emitted planner events', async () => {
    const wait = gate();
    const f = await fixture({ prepareCourse: async (_input, _mode, emit) => {
      emit({ agent: 'planner', state: 'working', label: 'Reading supplied excerpts', sourceIds: [] });
      await wait.promise;
      emit({ agent: 'planner', state: 'complete', label: 'Three concepts prepared', sourceIds: ['source-1'] });
      return structuredClone(course);
    } });
    const owner = f.browser();
    const result = await owner.post('/api/practices', { mode: 'live', text: sourceText });
    expect(result.status).toBe(201);
    expect(result.data.currentQuestion).toBeNull();
    const thinking = (await owner.get(`/api/practices/${result.data.id}`)).data as PracticeSession;
    expect(thinking.phase).toBe('thinking');
    expect(thinking.course.excerpts[0].text).toBe(sourceText);
    expect(thinking.events.map(event => event.label)).toEqual(['Reading supplied excerpts']);
    wait.resolve(); await f.service.idle();
    const ready = (await owner.get(`/api/practices/${result.data.id}`)).data as PracticeSession;
    expect(ready.phase).toBe('ready');
    expect(ready.currentQuestion).toMatchObject({ number: 1, conceptId: 'concept-1', kind: 'explain' });
    expect(ready.events).toHaveLength(2);
    expect(ready.version).toBeGreaterThan(thinking.version);
  });

  it('runs one opening and adaptive follow-up per concept, then one evidence-linked review', async () => {
    const coach = vi.fn(stubs.createReview!);
    const examiner = vi.fn(stubs.reviewAnswer!);
    const f = await fixture({ createReview: coach, reviewAnswer: examiner });
    const owner = f.browser();
    let session = await create(owner, f.service);
    const questionIds = new Set<string>();
    for (let number = 1; number <= 6; number++) {
      const question = session.currentQuestion!;
      questionIds.add(question.id);
      expect(question.number).toBe(number);
      expect(question.conceptId).toBe(`concept-${Math.ceil(number / 2)}`);
      expect(question.kind).toBe(number % 2 ? 'explain' : 'transfer');
      if (!(number % 2)) expect(question.text).toBe(feedback.followUp);
      const result = await owner.post(`/api/practices/${session.id}/answers`, answerInput(session, `My explanation ${number}.`));
      expect(result.status).toBe(200);
      expect(result.data.phase).toBe('thinking');
      expect(result.data.pendingAnswer).toBe(`My explanation ${number}.`);
      await f.service.idle();
      session = (await owner.get(`/api/practices/${session.id}`)).data;
      expect(session.turns).toHaveLength(number);
    }
    expect(questionIds.size).toBe(6);
    expect(session.phase).toBe('complete');
    expect(session.currentQuestion).toBeNull();
    expect(session.pendingAnswer).toBeNull();
    expect(session.review?.source).toBe('demo');
    expect(examiner).toHaveBeenCalledTimes(6);
    expect(coach).toHaveBeenCalledTimes(1);
    expect(coach.mock.calls[0][1]).toHaveLength(6);
    expect((await owner.post(`/api/practices/${session.id}/finish`, {})).status).toBe(200);
    expect(coach).toHaveBeenCalledTimes(1);
  });

  it('persists the input before agent work, safely replays duplicates and rejects conflicting or overlapping writes', async () => {
    const wait = gate();
    const examiner = vi.fn(async (...args: Parameters<NonNullable<AppOptions['reviewAnswer']>>) => {
      args[5]({ agent: 'examiner', state: 'working', label: 'Checking the saved answer', sourceIds: [] });
      await wait.promise;
      return { ...feedback, claimQuote: args[2] };
    });
    const f = await fixture({ reviewAnswer: examiner });
    const owner = f.browser();
    const session = await create(owner, f.service);
    const input = answerInput(session);
    const duplicates = await Promise.all([owner.post(`/api/practices/${session.id}/answers`, input), owner.post(`/api/practices/${session.id}/answers`, input)]);
    expect(duplicates.every(result => result.status === 200)).toBe(true);
    expect(examiner).toHaveBeenCalledTimes(1);
    expect(f.store.get<{ count: number }>('SELECT COUNT(*) AS count FROM answers')!.count).toBe(1);
    const saved = f.store.get<{ answer: string; status: string }>('SELECT answer, status FROM answers')!;
    expect(saved).toEqual({ answer: input.answer, status: 'pending' });
    const thinking = (await owner.get(`/api/practices/${session.id}`)).data;
    expect(thinking.pendingAnswer).toBe(input.answer);
    expect(thinking.events.at(-1).state).toBe('working');
    expect((await owner.post(`/api/practices/${session.id}/answers`, { ...input, answer: 'A conflicting answer.' })).data.code).toBe('IDEMPOTENCY_CONFLICT');
    expect((await owner.post(`/api/practices/${session.id}/answers`, { ...input, idempotencyKey: randomUUID() })).data.code).toBe('ALREADY_SUBMITTED');
    expect((await owner.post(`/api/practices/${session.id}/finish`, {})).data.code).toBe('PRACTICE_BUSY');
    wait.resolve(); await f.service.idle();
    const replay = await owner.post(`/api/practices/${session.id}/answers`, input);
    expect(replay.status).toBe(200);
    expect(replay.data.turns).toHaveLength(1);
    expect(replay.data.currentQuestion.number).toBe(2);
    expect(examiner).toHaveBeenCalledTimes(1);
    expect((await owner.post(`/api/practices/${session.id}/answers`, { ...input, questionId: randomUUID(), idempotencyKey: randomUUID() })).data.code).toBe('STALE_QUESTION');
  });

  it('finishes early from completed turns and never assesses an empty practice', async () => {
    const coach = vi.fn(stubs.createReview!);
    const f = await fixture({ createReview: coach });
    const owner = f.browser();
    const empty = await create(owner, f.service);
    await owner.post(`/api/practices/${empty.id}/finish`, {}); await f.service.idle();
    const ended = (await owner.get(`/api/practices/${empty.id}`)).data;
    expect(ended.review.note).toContain('no evidence to assess');
    expect(coach).not.toHaveBeenCalled();
    const session = await create(owner, f.service);
    await owner.post(`/api/practices/${session.id}/answers`, answerInput(session)); await f.service.idle();
    const finish = await owner.post(`/api/practices/${session.id}/finish`, {});
    expect(finish.data.phase).toBe('thinking');
    await f.service.idle();
    expect((await owner.get(`/api/practices/${session.id}`)).data.turns).toHaveLength(1);
    expect(coach).toHaveBeenCalledTimes(1);
    expect(coach.mock.calls[0][1]).toHaveLength(1);
  });
});

describe('failure and process recovery', () => {
  it('keeps source text when preparation fails, without exposing provider errors', async () => {
    const f = await fixture({ prepareCourse: async () => { throw new Error('secret provider response'); } });
    const owner = f.browser();
    const session = await create(owner, f.service);
    expect(session.phase).toBe('complete');
    expect(session.course.excerpts[0].text).toBe(sourceText);
    expect(session.review?.source).toBe('fallback');
    expect(JSON.stringify(session)).not.toContain('secret provider response');
  });

  it('bounds stalled agents and preserves the answer with explicit fallback feedback and review', async () => {
    const f = await fixture({ reviewAnswer: async () => new Promise<Feedback>(() => {}), answerTimeoutMs: 10,
      createReview: async () => { throw new Error('provider secret'); } });
    const owner = f.browser();
    const session = await create(owner, f.service);
    await owner.post(`/api/practices/${session.id}/answers`, answerInput(session)); await f.service.idle();
    const saved = (await owner.get(`/api/practices/${session.id}`)).data as PracticeSession;
    expect(saved.phase).toBe('ready');
    expect(saved.turns[0].answer).toBe('My explanation.');
    expect(saved.turns[0].feedback).toMatchObject({ source: 'fallback', assessment: 'unclear', reviewStatus: 'unavailable' });
    await owner.post(`/api/practices/${session.id}/finish`, {}); await f.service.idle();
    const finished = (await owner.get(`/api/practices/${session.id}`)).data;
    expect(finished.review.source).toBe('fallback');
    expect(finished.review.nextSteps[0].turnId).toBe(saved.turns[0].id);
    expect(JSON.stringify(finished)).not.toContain('provider secret');
  });

  it('restores ownership and interrupted answers from disk without making a replacement agent call', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'vivacoach-server-'));
    cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
    const filename = join(directory, 'test.sqlite');
    const first = await fixture({ store: new Store(filename) });
    const owner = first.browser();
    const session = await create(owner, first.service);
    const cookie = owner.cookie;
    const answerId = randomUUID();
    const question = session.currentQuestion!;
    session.phase = 'thinking'; session.pendingAnswer = 'Saved immediately before restart.';
    first.store.run(`INSERT INTO answers (id, practice_id, idempotency_key, question_id, answer, question_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`, answerId, session.id, randomUUID(), question.id, session.pendingAnswer, JSON.stringify(question), new Date().toISOString());
    first.store.run("UPDATE practices SET state_json = ?, operation_kind = 'answer', operation_token = 'interrupted' WHERE id = ?", JSON.stringify(session), session.id);
    await first.close();
    const examiner = vi.fn(stubs.reviewAnswer!);
    const second = await fixture({ store: new Store(filename), reviewAnswer: examiner });
    const rejoined = second.browser(); rejoined.cookie = cookie;
    const restored = (await rejoined.get(`/api/practices/${session.id}`)).data as PracticeSession;
    expect(restored.phase).toBe('ready');
    expect(restored.turns[0]).toMatchObject({ id: answerId, answer: 'Saved immediately before restart.', feedback: { source: 'fallback' } });
    expect(restored.currentQuestion?.number).toBe(2);
    expect(restored.message).toContain('no paid request was retried');
    expect(examiner).not.toHaveBeenCalled();
    expect((await second.browser().get(`/api/practices/${session.id}`)).status).toBe(404);
  });
});

describe('bounded audio routes', () => {
  it('authorises audio before provider calls, bounds upload size, and speaks only the saved current question', async () => {
    const transcribe = vi.fn(stubs.transcribeAudio!);
    const speak = vi.fn(stubs.speakQuestion!);
    const f = await fixture({ transcribeAudio: transcribe, speakQuestion: speak });
    const owner = f.browser();
    const session = await create(owner, f.service, 'live');
    const stranger = f.browser();
    const path = `/api/practices/${session.id}/transcriptions`;
    expect((await stranger.audio(path, Buffer.alloc(128))).status).toBe(404);
    expect((await owner.audio(path, Buffer.alloc(128), 'text/plain')).status).toBe(415);
    expect((await owner.audio(path, Buffer.alloc(2 * 1024 * 1024 + 1))).status).toBe(413);
    expect(transcribe).not.toHaveBeenCalled();
    const transcript = await owner.audio(path, Buffer.alloc(128));
    expect(transcript.status).toBe(200);
    expect(transcript.data.text).toBe('An editable transcript.');
    expect(transcribe.mock.calls[0][2]).toBe('Statistics: Sampling concepts');
    expect(transcribe.mock.calls[0][2]).not.toContain(session.currentQuestion!.text);
    const audioPath = `/api/practices/${session.id}/question-audio`;
    expect((await stranger.post(audioPath, { questionId: session.currentQuestion!.id })).status).toBe(404);
    expect((await owner.post(audioPath, { questionId: randomUUID() })).status).toBe(409);
    expect((await owner.post(audioPath, { questionId: session.currentQuestion!.id, text: 'Untrusted speech input' })).status).toBe(400);
    const audio = await fetch(f.base + audioPath, { method: 'POST', headers: { Cookie: owner.cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ questionId: session.currentQuestion!.id }) });
    expect(audio.status).toBe(200);
    expect(audio.headers.get('content-type')).toContain('audio/mpeg');
    expect(Buffer.from(await audio.arrayBuffer()).toString()).toBe('mock-mp3');
    expect(speak.mock.calls[0][0]).toBe(session.currentQuestion!.text);
    expect(f.store.all('SELECT * FROM answers')).toEqual([]);
  });

  it('keeps both paid audio paths disabled in demo mode', async () => {
    const transcribe = vi.fn(stubs.transcribeAudio!);
    const speak = vi.fn(stubs.speakQuestion!);
    const f = await fixture({ transcribeAudio: transcribe, speakQuestion: speak });
    const owner = f.browser();
    const session = await create(owner, f.service);
    expect((await owner.audio(`/api/practices/${session.id}/transcriptions`, Buffer.alloc(128))).data.code).toBe('DEMO_AUDIO');
    expect((await owner.post(`/api/practices/${session.id}/question-audio`, { questionId: session.currentQuestion!.id })).data.code).toBe('DEMO_AUDIO');
    expect(transcribe).not.toHaveBeenCalled();
    expect(speak).not.toHaveBeenCalled();
  });
});
