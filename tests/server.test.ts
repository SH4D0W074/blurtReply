import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { request as httpRequest, type Server } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp, type AppOptions } from '../server/app';
import { Store } from '../server/store';
import type { Analyse } from '../server/rooms';
import { LESSONS } from '../shared/lessons';
import type { Analysis, RoomSnapshot } from '../shared/types';

const lesson = LESSONS[0];
type ApiResult = { status: number; data: any; headers: Headers };
class Browser {
  cookie = '';
  constructor(readonly baseUrl: string) {}
  async request(method: string, path: string, body?: unknown, extraHeaders: Record<string, string> = {}): Promise<ApiResult> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method, headers: { ...(this.cookie ? { Cookie: this.cookie } : {}),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...extraHeaders },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const cookie = response.headers.get('set-cookie');
    if (cookie) this.cookie = cookie.split(';')[0];
    return { status: response.status, data: await response.json(), headers: response.headers };
  }
  get(path: string) { return this.request('GET', path); }
  post(path: string, body: unknown) { return this.request('POST', path, body); }
}

const cleanups: (() => Promise<void> | void)[] = [];
async function fixture(options: AppOptions = {}) {
  const store = options.store ?? new Store(':memory:');
  const app = createApp({ ...options, store });
  const server = await new Promise<Server>(resolve => {
    const running = app.listen(0, '127.0.0.1', () => resolve(running));
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test address');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    store.close();
  };
  cleanups.push(close);
  return { store, baseUrl, browser: () => new Browser(baseUrl), close };
}
async function createRoom(host: Browser, mode: 'demo' | 'live' = 'live'): Promise<RoomSnapshot> {
  const result = await host.post('/api/rooms', { lessonId: lesson.id, mode });
  expect(result.status).toBe(201);
  return result.data;
}
async function joinAndAnswer(browser: Browser, code: string, reason = 'Recruiting only club members still excludes other students.') {
  const joined = await browser.post(`/api/rooms/${code}/join`, {});
  expect(joined.status).toBe(200);
  const answer = { stage: 'initial', choiceId: lesson.initial.options[0].id, reason };
  const submitted = await browser.post(`/api/rooms/${code}/responses`, answer);
  expect(submitted.status).toBe(200);
  return { participant: submitted.data.self.participant, answer, snapshot: submitted.data as RoomSnapshot };
}
const action = (host: Browser, code: string, name: string, version?: number) =>
  host.post(`/api/rooms/${code}/actions`, { action: name, ...(version === undefined ? {} : { version }) });

beforeEach(() => {
  vi.stubEnv('PAIRWISE_LIVE_AI', 'false');
  vi.stubEnv('OPENAI_API_KEY', '');
});
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.unstubAllEnvs();
});

describe('anonymous ownership and privacy', () => {
  it('uses a hashed HttpOnly session, rejoins one identity, and rejects host impersonation', async () => {
    const f = await fixture();
    const host = f.browser();
    const creation = await host.post('/api/rooms', { lessonId: lesson.id, mode: 'live' });
    const room = creation.data as RoomSnapshot;
    expect(creation.headers.get('set-cookie')).toMatch(/HttpOnly/i);
    expect(creation.headers.get('set-cookie')).toMatch(/SameSite=Lax/i);
    const token = host.cookie.split('=')[1];
    const sessions = f.store.all<{ token_hash: string }>('SELECT token_hash FROM sessions');
    expect(sessions).toHaveLength(1);
    expect(sessions[0].token_hash).toBe(createHash('sha256').update(token).digest('hex'));
    expect(JSON.stringify(sessions)).not.toContain(token);

    const student = f.browser();
    const first = await student.post(`/api/rooms/${room.code}/join`, {});
    const rejoined = await student.post(`/api/rooms/${room.code}/join`, {});
    expect(rejoined.data.self.participant.id).toBe(first.data.self.participant.id);
    expect(rejoined.data.participantCount).toBe(1);
    expect((await student.get(`/api/rooms/${room.code}?view=host`)).status).toBe(403);
    expect((await action(student, room.code, 'reveal')).status).toBe(403);
    expect((await student.post(`/api/rooms/${room.code}/join`, { isDemo: true })).status).toBe(400);
  });

  it('redacts keys and diagnostics on the board, including for the owner, until explicit reasoning reveal', async () => {
    const f = await fixture();
    const host = f.browser();
    const room = await createRoom(host, 'demo');
    expect(room.initialCount).toBe(lesson.demoResponses.length);
    const lessons = await host.get('/api/lessons');
    for (const item of lessons.data) {
      expect(item).not.toHaveProperty('initialExpectedChoiceId');
      expect(item).not.toHaveProperty('transferExpectedChoiceId');
      expect(item).not.toHaveProperty('demoResponses');
      expect(item).not.toHaveProperty('categories');
      expect(item).not.toHaveProperty('probes');
    }
    const analysed = await action(host, room.code, 'analyse');
    expect(analysed.status).toBe(200);
    expect(analysed.data.host.responses.some((response: any) => response.analysis?.source === 'demo')).toBe(true);
    const board = await host.get(`/api/rooms/${room.code}?view=board`);
    expect(board.data.isHost).toBe(false);
    expect(board.data.self).toBeNull();
    expect(board.data).not.toHaveProperty('host');
    expect(board.data.cards.every((card: any) => card.reason === null && !('analysis' in card))).toBe(true);
    expect(board.data.pairings).toEqual([]);
    await action(host, room.code, 'reveal');
    await action(host, room.code, 'publish-pairs');
    const revealed = await host.get(`/api/rooms/${room.code}?view=board`);
    expect(revealed.data.cards.every((card: any) => typeof card.reason === 'string' && !('analysis' in card))).toBe(true);
    expect(revealed.data.pairings.every((pair: any) => pair.rationale === '' && pair.kind !== 'contrast')).toBe(true);
    expect(JSON.stringify(revealed.data)).not.toContain('owner_session_id');
  });

  it('rejects cross-origin, non-JSON and invalid submissions without returning secrets', async () => {
    const f = await fixture();
    const browser = f.browser();
    const origin = await browser.request('POST', '/api/rooms', { lessonId: lesson.id, mode: 'live' }, { Origin: 'https://example.invalid' });
    expect(origin.status).toBe(403);
    const form = await fetch(`${f.baseUrl}/api/rooms`, { method: 'POST', body: 'mode=demo', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    expect(form.status).toBe(415);
    // Fetch normalises the Host header; use the HTTP client to exercise an actual hostile Host.
    const rebindingStatus = await new Promise<number | undefined>((resolve, reject) => {
      const request = httpRequest(`${f.baseUrl}/api/status`, { headers: { Host: 'example.invalid' } }, response => {
        response.resume();
        response.on('end', () => resolve(response.statusCode));
      });
      request.on('error', reject);
      request.end();
    });
    expect(rebindingStatus).toBe(403);
    const status = await browser.get('/api/status');
    expect(status.data.aiEnabled).toBe(false);
    expect(status.data.storage).toBe('sqlite');
    expect(status.data.localOnly).toBe(true);
    expect(status.data).not.toHaveProperty('apiKey');
    for (const path of [
      '/shared/lessons.ts', '/server/analysis.ts', '/.env.local', '/.local/pairwise.sqlite',
      '/@fs/private/project/shared/lessons.ts', '/shared/%6cessons.ts?raw', '/%73erver/analysis.ts',
      '/%2eenv.local', '/.local%2fpairwise.sqlite', '/%2573erver/analysis.ts',
      '/@fs/private/project/src/%252e%252e/shared/lessons.ts',
    ]) {
      expect((await browser.get(path)).status).toBe(404);
    }
  });
});

describe('room state and independent responses', () => {
  it('keeps duplicate submissions idempotent and rejects late, changed or invalid answers', async () => {
    const f = await fixture();
    const host = f.browser();
    const room = await createRoom(host);
    const student = f.browser();
    const { answer, participant } = await joinAndAnswer(student, room.code);
    const duplicates = await Promise.all([
      student.post(`/api/rooms/${room.code}/responses`, answer),
      student.post(`/api/rooms/${room.code}/responses`, answer),
    ]);
    expect(duplicates.every(result => result.status === 200 && result.data.initialCount === 1)).toBe(true);
    const changed = await student.post(`/api/rooms/${room.code}/responses`, { ...answer, reason: 'Changed after submission.' });
    expect(changed.status).toBe(409);
    const waiting = f.browser();
    await waiting.post(`/api/rooms/${room.code}/join`, {});
    const invalid = await waiting.post(`/api/rooms/${room.code}/responses`, { ...answer, choiceId: 'not-an-option' });
    expect(invalid.status).toBe(400);
    await action(host, room.code, 'fallback-pairs');
    expect((await waiting.post(`/api/rooms/${room.code}/responses`, answer)).status).toBe(409);
    expect((await student.post(`/api/rooms/${room.code}/responses`, answer)).status).toBe(200);
    const newBrowser = f.browser();
    expect((await newBrowser.post(`/api/rooms/${room.code}/join`, {})).status).toBe(409);
    const rejoined = await student.post(`/api/rooms/${room.code}/join`, {});
    expect(rejoined.data.self.participant.id).toBe(participant.id);
  });

  it('completes a live loop with stable pairs, private transfer responses and honest totals', async () => {
    const f = await fixture();
    const host = f.browser();
    const room = await createRoom(host);
    const students = [f.browser(), f.browser(), f.browser()];
    const participants = [];
    for (const [index, student] of students.entries()) participants.push(await joinAndAnswer(student, room.code, `My original explanation ${index}.`));
    const grouped = await action(host, room.code, 'fallback-pairs');
    expect(grouped.data.pairings).toHaveLength(1);
    expect(grouped.data.pairings[0].participantIds).toHaveLength(3);
    const published = await action(host, room.code, 'publish-pairs', grouped.data.version);
    expect(published.status).toBe(200);
    const one = await students[0].get(`/api/rooms/${room.code}?view=student`);
    const two = await students[1].get(`/api/rooms/${room.code}?view=student`);
    expect(one.data.self.pairing.id).toBe(two.data.self.pairing.id);
    const refresh = await students[0].get(`/api/rooms/${room.code}?view=student`);
    expect(refresh.data.self.pairing.id).toBe(one.data.self.pairing.id);
    expect((await action(host, room.code, 'publish-pairs', grouped.data.version)).status).toBe(409);
    const transfer = { stage: 'transfer', choiceId: lesson.transferExpectedChoiceId, reason: 'This later response compares the sampling frame and random uncertainty.' };
    expect((await students[0].post(`/api/rooms/${room.code}/responses`, transfer)).status).toBe(409);
    await action(host, room.code, 'start-retest');
    const submitted = await students[0].post(`/api/rooms/${room.code}/responses`, transfer);
    expect(submitted.status).toBe(200);
    const beforeResults = await students[1].get(`/api/rooms/${room.code}?view=student`);
    expect(beforeResults.data.summary).toBeNull();
    expect(beforeResults.data.self.transfer).toBeNull();
    expect(JSON.stringify(beforeResults.data)).not.toContain(transfer.reason);
    const results = await action(host, room.code, 'show-results');
    expect(results.data.summary).toMatchObject({ initialTotal: 3, transferTotal: 1, matchedRespondents: 1, transferExpected: 1 });
    expect(results.data.summary.explanation).toContain('do not establish mastery');
    const board = await host.get(`/api/rooms/${room.code}?view=board`);
    expect(board.data.summary.examples).toEqual([]);
    await action(host, room.code, 'reveal');
    const revealed = await host.get(`/api/rooms/${room.code}?view=board`);
    expect(revealed.data.summary.examples[0].after).toBe(transfer.reason);
  });

  it('does not fabricate demo responses or transfer results for real participants', async () => {
    const f = await fixture();
    const host = f.browser();
    const room = await createRoom(host, 'demo');
    const student = f.browser();
    const fixtureAnswer = lesson.demoResponses[0];
    await student.post(`/api/rooms/${room.code}/join`, {});
    await student.post(`/api/rooms/${room.code}/responses`, { stage: 'initial', choiceId: fixtureAnswer.choiceId, reason: fixtureAnswer.reason });
    const analysed = await action(host, room.code, 'analyse');
    const realResponse = analysed.data.host.responses.find((response: any) => response.participantId === analysed.data.host.participants.find((participant: any) => !participant.isDemo).id);
    expect(realResponse.analysis.source).toBe('fallback');
    await action(host, room.code, 'publish-pairs');
    await action(host, room.code, 'start-retest');
    const results = await action(host, room.code, 'show-results');
    expect(results.data.transferCount).toBe(lesson.demoResponses.length);
    expect(results.data.initialCount).toBe(lesson.demoResponses.length + 1);
    expect(results.data.summary.examples.every((example: any) => example.isDemo)).toBe(true);
    const reset = await action(host, room.code, 'restart-demo');
    expect(reset.data.phase).toBe('collecting');
    expect(reset.data.initialCount).toBe(lesson.demoResponses.length);
    expect(reset.data.transferCount).toBe(0);
    const rejoined = await student.post(`/api/rooms/${room.code}/join`, {});
    expect(rejoined.data.self.initial).toBeNull();
    expect(rejoined.data.self.participant.isDemo).toBe(false);
  });
});

describe('analysis and recovery', () => {
  it('freezes analysis once, rejects overlapping transitions and ignores completion after close', async () => {
    let resolveAnalysis!: (analyses: Analysis[]) => void;
    let signalStarted!: () => void;
    const started = new Promise<void>(resolve => { signalStarted = resolve; });
    const analyse: Analyse = vi.fn(async () => {
      signalStarted();
      return new Promise<Analysis[]>(resolve => { resolveAnalysis = resolve; });
    });
    const f = await fixture({ analyse });
    const host = f.browser();
    const room = await createRoom(host);
    const student = f.browser();
    await joinAndAnswer(student, room.code);
    const pending = action(host, room.code, 'analyse', room.version);
    await started;
    const running = await host.get(`/api/rooms/${room.code}?view=host`);
    expect(running.data.phase).toBe('analysing');
    expect((await action(host, room.code, 'analyse')).status).toBe(409);
    await action(host, room.code, 'close', running.data.version);
    resolveAnalysis([]);
    expect((await pending).data.phase).toBe('closed');
    const closed = await host.get(`/api/rooms/${room.code}?view=host`);
    expect(closed.data.pairings).toEqual([]);
    expect(analyse).toHaveBeenCalledOnce();
  });

  it('invalidates pair previews when clarification is saved and preserves the original answer', async () => {
    const analyse: Analyse = async (_lesson, responses) => responses.map(response => ({
      responseId: response.id, categoryId: 'unclear', categoryLabel: 'Needs explanation',
      quote: response.reason, note: 'A clarification would help.', needsClarification: true,
      probe: 'What changes when the sample becomes larger?', source: 'fallback',
    }));
    const f = await fixture({ analyse });
    const host = f.browser();
    const room = await createRoom(host);
    const student = f.browser();
    const original = await joinAndAnswer(student, room.code);
    const reviewed = await action(host, room.code, 'analyse');
    expect(reviewed.data.pairings).toHaveLength(1);
    const clarification = await student.post(`/api/rooms/${room.code}/clarification`, { text: 'Random uncertainty can reduce while coverage stays unchanged.' });
    expect(clarification.status).toBe(200);
    expect(clarification.data.self.initial.reason).toBe(original.answer.reason);
    expect(clarification.data.self.initial.clarification).toContain('coverage stays unchanged');
    expect(clarification.data.self.initial).not.toHaveProperty('analysis');
    const after = await host.get(`/api/rooms/${room.code}?view=host`);
    expect(after.data.pairings).toEqual([]);
    expect((await action(host, room.code, 'publish-pairs', reviewed.data.version)).status).toBe(409);
    expect((await action(host, room.code, 'publish-pairs', after.data.version)).status).toBe(409);
    expect((await action(host, room.code, 'analyse', after.data.version)).status).toBe(200);
  });

  it('bounds analysis failures and retains every saved response for fallback groups', async () => {
    const analyse: Analyse = async () => new Promise<Analysis[]>(() => {});
    const f = await fixture({ analyse, analysisTimeoutMs: 20 });
    const host = f.browser();
    const room = await createRoom(host);
    const student = f.browser();
    await joinAndAnswer(student, room.code);
    const analysed = await action(host, room.code, 'analyse');
    expect(analysed.status).toBe(200);
    expect(analysed.data.aiStatus).toBe('failed');
    expect(analysed.data.phase).toBe('review');
    expect(analysed.data.initialCount).toBe(1);
    expect(analysed.data.pairings[0].kind).toBe('solo');
    expect(analysed.data.host.responses[0]).not.toHaveProperty('analysis');
  });

  it('persists identity, ownership and answers across process restarts', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'pairwise-test-'));
    cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
    const filename = join(directory, 'test.sqlite');
    const first = await fixture({ store: new Store(filename) });
    const host = first.browser();
    const room = await createRoom(host);
    const student = first.browser();
    const original = await joinAndAnswer(student, room.code);
    const hostCookie = host.cookie;
    const studentCookie = student.cookie;
    // Simulate interruption just after the analysis snapshot was frozen.
    first.store.run("UPDATE rooms SET phase = 'analysing', ai_status = 'running', analysis_token = 'pending' WHERE code = ?", room.code);
    await first.close();
    const second = await fixture({ store: new Store(filename) });
    const reconnectedHost = second.browser();
    reconnectedHost.cookie = hostCookie;
    const restored = await reconnectedHost.get(`/api/rooms/${room.code}?view=host`);
    expect(restored.status).toBe(200);
    expect(restored.data.phase).toBe('review');
    expect(restored.data.aiStatus).toBe('failed');
    const reconnectedStudent = second.browser();
    reconnectedStudent.cookie = studentCookie;
    const rejoined = await reconnectedStudent.post(`/api/rooms/${room.code}/join`, {});
    expect(rejoined.data.self.participant.id).toBe(original.participant.id);
    expect(rejoined.data.self.initial.reason).toBe(original.answer.reason);
  });
});
