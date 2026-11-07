import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LESSONS, getLesson, toPublicLesson } from '../shared/lessons';
import type { SubmittedResponse } from '../shared/types';

const provider = vi.hoisted(() => ({ create: vi.fn(), construct: vi.fn() }));
vi.mock('openai', () => ({
  default: class {
    responses = { create: provider.create };
    constructor(options: unknown) { provider.construct(options); }
  },
}));

const lesson = getLesson('sampling')!;
function fixture(index = 0): SubmittedResponse {
  const data = lesson.demoResponses[index];
  return {
    id: `r-${index}`, participantId: `p-${index}`, stage: 'initial',
    choiceId: data.choiceId, reason: data.reason, submittedAt: '2026-11-07T12:00:00.000Z',
  };
}
function modelItem(response: SubmittedResponse, categoryId = 'coverage') {
  return { responseId: response.id, categoryId, quote: response.reason, explicit: true };
}
let analysis: typeof import('../server/analysis');

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv('PAIRWISE_LIVE_AI', 'false');
  vi.stubEnv('OPENAI_API_KEY', '');
  vi.stubEnv('PAIRWISE_AI_MAX_CALLS', '');
  vi.stubEnv('PAIRWISE_MAX_AI_CALLS', '20');
  vi.stubEnv('PAIRWISE_AI_MAX_RESPONSES', '');
  vi.stubEnv('PAIRWISE_AI_TIMEOUT_MS', '');
  vi.stubEnv('PAIRWISE_AI_MAX_OUTPUT_TOKENS', '');
  vi.stubEnv('PAIRWISE_AI_MODEL', '');
  vi.stubEnv('OPENAI_MODEL', '');
  analysis = await import('../server/analysis');
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe('teacher-authored lesson fixtures', () => {
  it('provides two valid lessons and six clearly separate initial/transfer fixtures each', () => {
    expect(LESSONS).toHaveLength(2);
    for (const pack of LESSONS) {
      expect(pack.demoResponses).toHaveLength(6);
      const categoryIds = pack.categories.map((category) => category.id);
      expect(categoryIds).toContain('unclear');
      for (const example of pack.demoResponses) {
        expect(pack.initial.options.map((choice) => choice.id)).toContain(example.choiceId);
        expect(pack.transfer.options.map((choice) => choice.id)).toContain(example.transferChoiceId);
        expect(categoryIds).toContain(example.categoryId);
        expect(example.quote).toBe(example.reason);
        expect(example.transferReason).not.toBe(example.reason);
      }
      for (const pair of pack.contrastPairs) {
        expect(categoryIds).toContain(pair[0]);
        expect(categoryIds).toContain(pair[1]);
        expect(pair[0]).not.toBe(pair[1]);
      }
    }
  });

  it('only publishes question content, never rubrics, expected answers or fixture responses', () => {
    const publicLesson = toPublicLesson(lesson);
    expect(Object.keys(publicLesson).sort()).toEqual(['estimatedMinutes', 'id', 'initial', 'subject', 'subtitle', 'title', 'transfer']);
    expect(JSON.stringify(publicLesson)).not.toContain('initialExpectedChoiceId');
    expect(JSON.stringify(publicLesson)).not.toContain('demoResponses');
    publicLesson.initial.options[0].text = 'changed copy';
    expect(lesson.initial.options[0].text).toBe('Yes');
    expect(getLesson('unknown')).toBeUndefined();
  });
});

describe('honest demonstration analysis', () => {
  it('only labels exact authored fixtures from explicitly seeded participants as demo', async () => {
    const responses = lesson.demoResponses.map((_, index) => fixture(index));
    const results = await analysis.analyseResponses(lesson, responses, 'demo', { demoParticipantIds: responses.map((response) => response.participantId) });
    expect(results.map((result) => result.source)).toEqual(Array(6).fill('demo'));
    expect(results.map((result) => result.categoryId)).toEqual(lesson.demoResponses.map((response) => response.categoryId));
    expect(results.every((result) => result.note.includes('Authored demonstration'))).toBe(true);
    expect(provider.create).not.toHaveBeenCalled();
  });

  it('does not pretend a real participant, changed wording or clarification is a demo fixture', async () => {
    const original = fixture();
    const sameRealInput = await analysis.analyseResponses(lesson, [original], 'demo');
    const changed = await analysis.analyseResponses(lesson, [{ ...original, reason: `${original.reason} ` }], 'demo', { demoParticipantIds: [original.participantId] });
    const clarified = await analysis.analyseResponses(lesson, [{ ...original, clarification: 'I changed my mind.' }], 'demo', { demoParticipantIds: [original.participantId] });
    for (const [result] of [sameRealInput, changed, clarified]) {
      expect(result.source).toBe('fallback');
      expect(result.categoryId).toBe('unclear');
      expect(result.quote).toBe('');
    }
    expect(provider.create).not.toHaveBeenCalled();
  });

  it('does not apply initial categories to transfer answers', async () => {
    const response = { ...fixture(), stage: 'transfer' as const };
    const [result] = await analysis.analyseResponses(lesson, [response], 'demo', { demoParticipantIds: [response.participantId] });
    expect(result.source).toBe('fallback');
    expect(result.probe).toBeNull();
  });
});

describe('evidence and schema validation', () => {
  it('accepts whole-field evidence and returns analyses in original response order', () => {
    const first = fixture(0);
    const second = fixture(1);
    const results = analysis.validateAnalysisOutput(lesson, [first, second], { analyses: [modelItem(second, 'distinguishes-uncertainty'), modelItem(first)] });
    expect(results.map((result) => result.responseId)).toEqual([first.id, second.id]);
    expect(results.every((result) => result.source === 'openai')).toBe(true);
  });

  it('accepts exact complete clarification evidence, without mixing fields', () => {
    const response = { ...fixture(), clarification: 'I mean nonmembers are still excluded; I did not mean random error can never decrease.' };
    const [result] = analysis.validateAnalysisOutput(lesson, [response], { analyses: [{ ...modelItem(response), quote: response.clarification }] });
    expect(result.source).toBe('openai');
    expect(result.quote).toBe(response.clarification);
    expect(analysis.isWholeResponseQuote(response, `${response.reason} ${response.clarification}`)).toBe(false);
  });

  it('rejects exact substrings that omit negatives, qualifications, or sentence context', () => {
    const response = fixture(2);
    for (const quote of ['reduces random error', 'increasing sample size never reduces random error', 'Increasing sample size never reduces random error.']) {
      const [result] = analysis.validateAnalysisOutput(lesson, [response], { analyses: [{ ...modelItem(response, 'never-reduces'), quote }] });
      expect(result.source).toBe('fallback');
      expect(result.categoryId).toBe('unclear');
      expect(result.quote).toBe('');
    }
  });

  it('fails closed on invented categories, unknown IDs, duplicate IDs, omissions and unexpected fields', () => {
    const response = fixture();
    const item = modelItem(response);
    const invalid = [
      { analyses: [{ ...item, categoryId: 'mastered' }] },
      { analyses: [{ ...item, responseId: 'invented' }] },
      { analyses: [item, item] },
      { analyses: [] },
      { analyses: [{ ...item, mastery: 100 }] },
    ];
    for (const output of invalid) {
      const [result] = analysis.validateAnalysisOutput(lesson, [response], output);
      expect(result.source).toBe('fallback');
      expect(result.categoryId).toBe('unclear');
    }
  });

  it('turns non-explicit model guesses into uncertainty, never a confident label', () => {
    const response = fixture(3);
    const [result] = analysis.validateAnalysisOutput(lesson, [response], { analyses: [{ ...modelItem(response), explicit: false }] });
    expect(result.categoryId).toBe('unclear');
    expect(result.needsClarification).toBe(true);
    expect(result.source).toBe('openai');
    expect(result.quote).toBe('');
  });
});

describe('optional live analysis with a mocked provider', () => {
  function enable() {
    vi.stubEnv('PAIRWISE_LIVE_AI', 'true');
    vi.stubEnv('OPENAI_API_KEY', 'unit-test-placeholder-not-a-real-key');
  }

  it('does not contact a provider without both an explicit true flag and configured key', async () => {
    for (const flag of ['false', 'TRUE', '', '1']) {
      vi.stubEnv('PAIRWISE_LIVE_AI', flag);
      vi.stubEnv('OPENAI_API_KEY', 'unit-test-placeholder-not-a-real-key');
      expect((await analysis.analyseResponses(lesson, [fixture()], 'live'))[0].source).toBe('fallback');
    }
    vi.stubEnv('PAIRWISE_LIVE_AI', 'true');
    vi.stubEnv('OPENAI_API_KEY', '');
    expect((await analysis.analyseResponses(lesson, [fixture()], 'live'))[0].source).toBe('fallback');
    expect(provider.create).not.toHaveBeenCalled();
    expect(provider.construct).not.toHaveBeenCalled();
  });

  it('uses strict Responses JSON, disables storage/retries, and enforces a process call budget', async () => {
    enable();
    vi.stubEnv('PAIRWISE_MAX_AI_CALLS', '1');
    const response = fixture();
    provider.create.mockResolvedValue({ status: 'completed', output_text: JSON.stringify({ analyses: [modelItem(response)] }) });
    const [result] = await analysis.analyseResponses(lesson, [response], 'live');
    expect(result.source).toBe('openai');
    expect(provider.construct).toHaveBeenCalledWith({ timeout: 30000, maxRetries: 0 });
    const [request, options] = provider.create.mock.calls[0];
    expect(request.store).toBe(false);
    expect(request.text.format.type).toBe('json_schema');
    expect(request.text.format.strict).toBe(true);
    expect(request.max_output_tokens).toBe(6000);
    expect(request.model).toBe('gpt-6-luna');
    expect(request.reasoning).toEqual({ effort: 'low' });
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(request.input).responses[0].reason).toBe(response.reason);
    expect(analysis.getAnalysisStatus().remainingAiCalls).toBe(0);
    expect((await analysis.analyseResponses(lesson, [response], 'live'))[0].source).toBe('fallback');
    expect(provider.create).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['gpt-5', 'minimal'],
    ['gpt-5-mini', 'minimal'],
    ['gpt-5-nano', 'minimal'],
    ['gpt-6-luna', 'low'],
    ['gpt-5.4-mini', undefined],
    ['gpt-6-luna-custom', undefined],
    ['gpt-4.1-mini', undefined],
  ])('preserves configured %s and only sets an effort documented for that exact alias', async (model, effort) => {
    enable();
    vi.stubEnv('OPENAI_MODEL', model!);
    provider.create.mockResolvedValue({ status: 'completed', output_text: JSON.stringify({ analyses: [modelItem(fixture())] }) });
    await analysis.analyseResponses(lesson, [fixture()], 'live');
    const [request] = provider.create.mock.calls[0];
    expect(request.model).toBe(model);
    if (effort) expect(request.reasoning).toEqual({ effort });
    else expect(request).not.toHaveProperty('reasoning');
  });

  it('sends at most eight explanations by default and retains excess responses with actionable fallback', async () => {
    enable();
    const responses = Array.from({ length: 10 }, (_, index) => ({ ...fixture(), id: `r-${index}`, participantId: `p-${index}` }));
    provider.create.mockResolvedValue({ status: 'completed', output_text: JSON.stringify({ analyses: responses.slice(0, 8).map((response) => modelItem(response)) }) });
    const results = await analysis.analyseResponses(lesson, responses, 'live');
    expect(JSON.parse(provider.create.mock.calls[0][0].input).responses).toHaveLength(8);
    expect(results).toHaveLength(10);
    expect(results.slice(0, 8).every((result) => result.source === 'openai')).toBe(true);
    for (const result of results.slice(8)) {
      expect(result.source).toBe('fallback');
      expect(result.categoryId).toBe('unclear');
      expect(result.quote).toBe('');
      expect(result.note).toContain('Not sent to AI');
      expect(result.note).toContain('simple comparison groups');
      expect(result.note).toContain('does not advance to a new batch');
    }
    expect(provider.create).toHaveBeenCalledTimes(1);
  });

  it('keeps unsent overflow distinct from a failed provider request', async () => {
    enable();
    vi.stubEnv('PAIRWISE_AI_MAX_RESPONSES', '1');
    provider.create.mockRejectedValueOnce(new Error('unavailable'));
    const results = await analysis.analyseResponses(lesson, [fixture(0), fixture(1)], 'live');
    expect(results[0].note).toContain('unavailable');
    expect(results[1].note).toContain('Not sent to AI');
    expect(results[1].note).toContain('limited to 1 explanation.');
  });

  it('clamps oversized configuration values to the hard time and output caps', async () => {
    enable();
    vi.stubEnv('PAIRWISE_AI_TIMEOUT_MS', '600000');
    vi.stubEnv('PAIRWISE_AI_MAX_OUTPUT_TOKENS', '100000');
    provider.create.mockResolvedValue({ status: 'completed', output_text: JSON.stringify({ analyses: [modelItem(fixture())] }) });
    await analysis.analyseResponses(lesson, [fixture()], 'live');
    expect(provider.construct).toHaveBeenCalledWith({ timeout: 30000, maxRetries: 0 });
    expect(provider.create.mock.calls[0][0].max_output_tokens).toBe(8000);
  });

  it('does not truncate an overlong response into a misleading claim', async () => {
    enable();
    const valid = fixture();
    const long = { ...fixture(1), reason: `I do not mean that ${'a'.repeat(1300)}` };
    provider.create.mockResolvedValue({ status: 'completed', output_text: JSON.stringify({ analyses: [modelItem(valid)] }) });
    const results = await analysis.analyseResponses(lesson, [valid, long], 'live');
    expect(results.map((result) => result.source)).toEqual(['openai', 'fallback']);
    expect(JSON.parse(provider.create.mock.calls[0][0].input).responses).toHaveLength(1);
  });

  it('returns saved-response fallbacks on malformed, incomplete or refused output', async () => {
    enable();
    for (const output of [
      { status: 'completed', output_text: 'not JSON' },
      { status: 'incomplete', output_text: '{}' },
      { status: 'completed', output_text: '' },
    ]) {
      provider.create.mockResolvedValueOnce(output);
      const [result] = await analysis.analyseResponses(lesson, [fixture()], 'live');
      expect(result.source).toBe('fallback');
      expect(result.categoryId).toBe('unclear');
    }
  });

  it('keeps provider errors out of feedback and makes no hidden retry', async () => {
    enable();
    provider.create.mockRejectedValueOnce(new Error('private-provider-detail'));
    const [result] = await analysis.analyseResponses(lesson, [fixture()], 'live');
    expect(result.source).toBe('fallback');
    expect(result.note).not.toContain('private-provider-detail');
    expect(provider.create).toHaveBeenCalledTimes(1);
  });

  it('aborts a slow request and releases the in-flight guard', async () => {
    enable();
    vi.useFakeTimers();
    vi.stubEnv('PAIRWISE_AI_TIMEOUT_MS', '1000');
    provider.create.mockImplementationOnce((_request: unknown, options: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('aborted')));
    }));
    const pending = analysis.analyseResponses(lesson, [fixture()], 'live');
    const [overlap] = await analysis.analyseResponses(lesson, [fixture()], 'live');
    expect(overlap.source).toBe('fallback');
    expect(overlap.note).toContain('still running');
    await vi.advanceTimersByTimeAsync(1000);
    const [timedOut] = await pending;
    expect(timedOut.note).toContain('timed out');
    provider.create.mockResolvedValueOnce({ status: 'completed', output_text: JSON.stringify({ analyses: [modelItem(fixture())] }) });
    expect((await analysis.analyseResponses(lesson, [fixture()], 'live'))[0].source).toBe('openai');
  });
});
