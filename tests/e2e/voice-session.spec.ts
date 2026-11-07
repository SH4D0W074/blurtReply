import { test, expect, type Page, type Route } from '@playwright/test';
import type { PracticeSession, ServerStatus, Turn } from '../../shared/types';

const practiceId = '11111111-1111-4111-8111-111111111111';
const firstQuestionId = '22222222-2222-4222-8222-222222222222';
const secondQuestionId = '33333333-3333-4333-8333-333333333333';
const transcript = 'An association alone cannot establish that one variable causes the other.';
const nextQuestionText = 'How could a common cause change the interpretation?';
const unsureReply = 'That is a useful place to begin. An association means two things vary together; it does not establish what causes the change.';
const closingReply = 'You have finished this practice. Revisit the difference between an association and a causal explanation, then try a fresh example.';

function wavFixture(duration = 0.4) {
  const rate = 8000;
  const samples = Math.round(rate * duration);
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36);
  wav.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) wav.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * 220 / rate) * 450), 44 + i * 2);
  return wav;
}

interface BrowserVoiceState {
  microphoneRequests: number; activeTracks: number; recorderStarts: number;
  audioPlays: number; deviceCalls: number; deviceTexts: string[]; timeline: string[]; audioEndedAtMicrophone: boolean[];
}

async function installMicrophone(page: Page, denied = false, holdDeviceSpeech = false) {
  await page.addInitScript(({ wavBase64, denied, holdDeviceSpeech }) => {
    const state: BrowserVoiceState = {
      microphoneRequests: 0, activeTracks: 0, recorderStarts: 0, audioPlays: 0, deviceCalls: 0, deviceTexts: [], timeline: [], audioEndedAtMicrophone: [],
    };
    Object.assign(window, { voiceFlow: state });
    const bytes = Uint8Array.from(atob(wavBase64), character => character.charCodeAt(0));
    let lastQuestionAudio: HTMLMediaElement | null = null;
    let latestPlayback: 'audio' | 'device' = 'audio';
    let deviceEnded = false;
    const completedAudio = new WeakSet<HTMLMediaElement>();

    // The analyser receives a real MediaStream; the recorder returns deterministic valid PCM.
    // This exercises microphone acquisition, stopping, Blob upload and playback without a device/provider.
    navigator.mediaDevices.getUserMedia = async () => {
      state.microphoneRequests += 1;
      state.timeline.push('microphone-request');
      state.audioEndedAtMicrophone.push(latestPlayback === 'device' ? deviceEnded : Boolean(lastQuestionAudio && completedAudio.has(lastQuestionAudio)));
      if (denied) throw new DOMException('Denied by the browser test', 'NotAllowedError');
      const context = new AudioContext();
      const oscillator = context.createOscillator();
      const gain = context.createGain(); gain.gain.value = 0.03;
      const destination = context.createMediaStreamDestination();
      oscillator.connect(gain).connect(destination); oscillator.start();
      await context.resume();
      state.activeTracks += 1;
      const track = destination.stream.getAudioTracks()[0];
      const originalStop = track.stop.bind(track);
      let stopped = false;
      track.stop = () => {
        if (stopped) return;
        stopped = true; state.activeTracks -= 1;
        state.timeline.push('microphone-stopped');
        oscillator.stop(); void context.close(); originalStop();
      };
      return destination.stream;
    };

    class DeterministicRecorder extends EventTarget {
      static isTypeSupported() { return true; }
      readonly mimeType = 'audio/wav';
      state: RecordingState = 'inactive';
      ondataavailable: ((event: BlobEvent) => void) | null = null;
      onstop: ((event: Event) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      constructor(_stream: MediaStream, _options?: MediaRecorderOptions) { super(); }
      start() { this.state = 'recording'; state.recorderStarts += 1; state.timeline.push('recording-started'); }
      stop() {
        if (this.state !== 'recording') return;
        this.state = 'inactive';
        queueMicrotask(() => {
          const data = new BlobEvent('dataavailable', { data: new Blob([bytes], { type: this.mimeType }) });
          this.ondataavailable?.(data); this.dispatchEvent(data);
          const stopped = new Event('stop'); this.onstop?.(stopped); this.dispatchEvent(stopped);
        });
      }
    }
    Object.defineProperty(window, 'MediaRecorder', { configurable: true, value: DeterministicRecorder });
    const originalPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = async function () {
      latestPlayback = 'audio';
      lastQuestionAudio = this;
      Object.assign(window, { lastVoiceFlowAudio: this });
      state.timeline.push('question-play');
      // Capture before the app's onended cleanup resets src/ended and resolves its playback promise.
      this.addEventListener('ended', () => { completedAudio.add(this); state.timeline.push('question-ended'); }, { once: true, capture: true });
      await originalPlay.call(this);
      state.audioPlays += 1;
    };
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
      cancel() {}, getVoices() { return []; },
      speak(utterance: SpeechSynthesisUtterance) {
        state.deviceCalls += 1;
        state.deviceTexts.push(utterance.text);
        latestPlayback = 'device'; deviceEnded = false; state.timeline.push('device-started');
        const finish = () => {
          deviceEnded = true; state.timeline.push('device-ended');
          utterance.onend?.(new Event('end') as SpeechSynthesisEvent);
        };
        Object.assign(window, { finishDeviceSpeech: finish });
        if (!holdDeviceSpeech) window.setTimeout(finish, 20);
      },
    } });
  }, { wavBase64: wavFixture().toString('base64'), denied, holdDeviceSpeech });
}

async function voiceState(page: Page): Promise<BrowserVoiceState> {
  return page.evaluate(() => (window as unknown as { voiceFlow: BrowserVoiceState }).voiceFlow);
}

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

interface Submission { questionId: string; answer: string; idempotencyKey: string }

async function mockPractice(page: Page, options: {
  denied?: boolean; holdTranscription?: boolean; holdAudio?: boolean; failTranscription?: boolean;
  holdReplyAudio?: boolean; failReplyAudio?: boolean; holdDeviceSpeech?: boolean; transcriptText?: string; finalQuestion?: boolean;
} = {}) {
  await installMicrophone(page, options.denied, options.holdDeviceSpeech);
  const timestamp = '2026-11-07T12:00:00.000Z';
  const source = { id: 'association', label: 'Association and causation', text: 'Correlation describes an association. An association alone does not establish a causal effect.' };
  const firstQuestion = { id: firstQuestionId, number: options.finalQuestion ? 6 : 1, text: 'What does an association establish, and what does it leave unresolved?', conceptId: 'association', kind: 'explain' as const };
  const previousTurns: Turn[] = options.finalQuestion ? Array.from({ length: 5 }, (_, index) => ({
    id: `previous-turn-${index + 1}`, question: { ...firstQuestion, id: `previous-question-${index + 1}`, number: index + 1 },
    answer: 'A previous saved answer in this test fixture.', createdAt: timestamp,
    feedback: { assessment: 'unclear', claimQuote: null, sourceId: source.id, sourceQuote: source.text, observation: 'Previous test feedback.', followUp: firstQuestion.text, followUpKind: 'probe', source: 'fallback', reviewStatus: 'unavailable' },
  })) : [];
  let session: PracticeSession = {
    id: practiceId, mode: 'live', phase: 'ready', version: 1, totalQuestions: 6,
    createdAt: timestamp, updatedAt: timestamp, pendingAnswer: null, message: null, demoAnswer: null,
    turns: previousTurns, events: [], review: null, currentQuestion: firstQuestion,
    course: {
      title: 'Association and evidence', subject: 'Statistics', sourceName: 'Browser test fixture', origin: 'paste',
      excerpts: [source], concepts: [{ id: 'association', title: 'Association and causation', sourceId: source.id, sourceQuote: source.text, openingQuestion: firstQuestion.text }],
    },
  };
  const status: ServerStatus = {
    aiConfigured: true, aiEnabled: true, model: 'mock-only', remainingTextCalls: 60,
    transcriptionAvailable: true, transcriptionModel: 'mock-only', remainingTranscriptions: 12,
    voiceProvider: 'elevenlabs', remainingVoiceCalls: 30, localOnly: true,
  };
  const submissions: Submission[] = [];
  const questionAudio: string[] = [];
  const recordings: Buffer[] = [];
  const audioGate = gate();
  const transcriptionGate = gate();
  let transcriptionResponses = 0;
  let audioResponses = 0;
  const fulfill = (route: Route, data: unknown) => route.fulfill({ json: data });
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/status') return fulfill(route, status);
    if (path === `/api/practices/${practiceId}`) return fulfill(route, session);
    if (path === `/api/practices/${practiceId}/question-audio`) {
      const requestedId = (route.request().postDataJSON() as { questionId: string }).questionId;
      questionAudio.push(requestedId);
      if (options.holdAudio || options.holdReplyAudio && requestedId === secondQuestionId) await audioGate.promise;
      if (options.failReplyAudio && requestedId === secondQuestionId) {
        await route.fulfill({ status: 503, json: { error: 'Test fallback to the device voice.' } });
        audioResponses += 1; return;
      }
      await route.fulfill({ contentType: 'audio/wav', body: wavFixture(options.finalQuestion && session.phase === 'complete' ? 1.2 : 0.4) }).catch(() => {});
      audioResponses += 1;
      return;
    }
    if (path === `/api/practices/${practiceId}/transcriptions`) {
      recordings.push(route.request().postDataBuffer() ?? Buffer.alloc(0));
      if (options.holdTranscription) await transcriptionGate.promise;
      if (options.failTranscription) await route.fulfill({ status: 503, json: { error: 'Transcription is temporarily unavailable in this test.' } }).catch(() => {});
      else await fulfill(route, { text: options.transcriptText ?? transcript, model: 'mock-only' }).catch(() => {});
      transcriptionResponses += 1;
      return;
    }
    if (path === `/api/practices/${practiceId}/answers`) {
      const body = route.request().postDataJSON() as Submission;
      submissions.push(body);
      if (submissions.length > 1) return route.fulfill({ status: 409, json: { error: 'Duplicate submission detected by the test.' } });
      session = { ...session, phase: 'thinking', version: session.version + 1, pendingAnswer: body.answer,
        events: [{ id: 'examiner-working', agent: 'examiner', state: 'working', label: 'Reviewing the saved test answer', sourceIds: [], createdAt: timestamp }] };
      return fulfill(route, session);
    }
    return route.fulfill({ status: 404, json: { error: `Unexpected mocked API path: ${path}` } });
  });
  return {
    submissions, questionAudio, recordings,
    releaseTranscription: transcriptionGate.resolve, releaseAudio: audioGate.resolve,
    transcriptionResponses: () => transcriptionResponses, audioResponses: () => audioResponses,
    advance(reply?: string) {
      if (submissions.length !== 1) throw new Error('A saved answer is required before advancing the mock session.');
      const answer = submissions[0].answer;
      session = { ...session, phase: 'ready', version: session.version + 1, pendingAnswer: null,
        currentQuestion: { id: secondQuestionId, number: 2, text: nextQuestionText, conceptId: 'association', kind: 'probe' },
        turns: [{ id: 'saved-test-turn', question: firstQuestion, answer, createdAt: timestamp,
          feedback: { assessment: 'unclear', claimQuote: null, sourceId: source.id, sourceQuote: source.text,
            ...(reply ? { reply } : {}), observation: 'A mocked response for voice-flow testing.', followUp: nextQuestionText, followUpKind: 'probe', source: 'fallback', reviewStatus: 'unavailable' } }],
      };
    },
    complete(reply: string) {
      if (submissions.length !== 1 || !options.finalQuestion) throw new Error('Save the sixth answer before completing this test session.');
      session = { ...session, phase: 'complete', version: session.version + 1, currentQuestion: null, pendingAnswer: null,
        turns: [...previousTurns, { id: 'final-test-turn', question: firstQuestion, answer: submissions[0].answer, createdAt: timestamp,
          feedback: { assessment: 'unclear', claimQuote: null, sourceId: source.id, sourceQuote: source.text, reply,
            observation: 'The final answer is saved.', followUp: '', followUpKind: 'transfer', source: 'fallback', reviewStatus: 'unavailable' } }],
        review: { strengths: [], revisit: [], nextSteps: [], source: 'fallback', note: 'A mocked review for playback testing.' },
      };
    },
  };
}

async function beginRecording(page: Page) {
  await page.goto(`/practice/${practiceId}`);
  await page.getByRole('button', { name: 'Start voice session', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Done speaking', exact: true })).toBeVisible();
}

async function settleReact(page: Page) {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

function stageResume(page: Page) {
  return page.getByRole('group', { name: 'Voice session', exact: true }).getByRole('button', { name: 'Resume voice session', exact: true });
}
function toolbarResume(page: Page) {
  return page.getByRole('group', { name: 'Voice session controls', exact: true }).getByRole('button', { name: 'Resume voice session', exact: true });
}

test('a live voice session hears the question, sends one answer, then automatically starts the next turn', async ({ page }) => {
  const mock = await mockPractice(page);
  await page.goto(`/practice/${practiceId}`);
  await expect(page.getByRole('checkbox', { name: 'Review transcript before sending', exact: true })).not.toBeChecked();
  await page.getByRole('button', { name: 'Start voice session', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Done speaking', exact: true })).toBeVisible();
  const beforeAnswer = await voiceState(page);
  expect(beforeAnswer.audioEndedAtMicrophone).toEqual([true]);
  expect(beforeAnswer.audioPlays).toBe(1);
  expect(beforeAnswer.microphoneRequests).toBe(1);
  await page.getByRole('button', { name: 'Done speaking', exact: true }).click();
  await expect.poll(() => mock.submissions.length).toBe(1);
  expect(mock.submissions[0]).toMatchObject({ questionId: firstQuestionId, answer: transcript });
  expect(mock.submissions[0].idempotencyKey).toMatch(/^[a-f0-9-]+$/);
  expect(mock.recordings).toHaveLength(1);
  expect(mock.recordings[0].subarray(0, 4).toString()).toBe('RIFF');
  mock.advance(unsureReply);
  await expect(page.getByRole('heading', { name: 'How could a common cause change the interpretation?', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Coach response', exact: true })).toContainText(unsureReply);
  await expect(page.getByRole('button', { name: 'Done speaking', exact: true })).toBeVisible();
  await expect.poll(async () => (await voiceState(page)).microphoneRequests).toBe(2);
  expect(mock.questionAudio).toEqual([firstQuestionId, secondQuestionId]);
  const progressed = await voiceState(page);
  expect(progressed.audioPlays).toBe(2);
  expect(progressed.recorderStarts).toBe(2);
  expect(progressed.audioEndedAtMicrophone).toEqual([true, true]);
  await page.getByRole('button', { name: 'Stop voice session', exact: true }).click();
  await expect.poll(async () => (await voiceState(page)).activeTracks).toBe(0);
  await settleReact(page);
  expect(mock.submissions).toHaveLength(1);
  expect(mock.recordings).toHaveLength(1);
});

test('an unsure answer receives a visible reply and the device finishes reply plus question before listening', async ({ page }) => {
  const mock = await mockPractice(page, { transcriptText: "I don't know.", failReplyAudio: true, holdDeviceSpeech: true });
  await beginRecording(page);
  await page.getByRole('button', { name: 'Done speaking', exact: true }).click();
  await expect.poll(() => mock.submissions.length).toBe(1);
  expect(mock.submissions[0].answer).toBe("I don't know.");
  mock.advance(unsureReply);
  const reply = page.getByRole('region', { name: 'Coach response', exact: true });
  await expect(reply).toContainText(unsureReply);
  await expect(page.getByRole('heading', { name: nextQuestionText, exact: true })).toBeVisible();
  expect(await reply.evaluate((element, question) => {
    const heading = [...document.querySelectorAll('h1,h2,h3')].find(item => item.textContent === question);
    return Boolean(heading && element.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING);
  }, nextQuestionText)).toBe(true);
  await expect.poll(async () => (await voiceState(page)).deviceCalls).toBe(1);
  const speaking = await voiceState(page);
  expect(speaking.deviceTexts.map(text => text.replace(/\s+/g, ' ').trim())).toEqual([`${unsureReply} ${nextQuestionText}`]);
  expect(speaking.microphoneRequests).toBe(1);
  await expect(page.getByRole('button', { name: 'Done speaking', exact: true })).toHaveCount(0);
  await expect(page.locator('.question-playback')).toContainText('Device voice');
  await page.evaluate(() => (window as unknown as { finishDeviceSpeech(): void }).finishDeviceSpeech());
  await expect(page.getByRole('button', { name: 'Done speaking', exact: true })).toBeVisible();
  const listening = await voiceState(page);
  expect(listening.microphoneRequests).toBe(2);
  expect(listening.audioEndedAtMicrophone).toEqual([true, true]);
  expect(listening.timeline.lastIndexOf('device-ended')).toBeLessThan(listening.timeline.lastIndexOf('microphone-request'));
  expect(mock.questionAudio).toEqual([firstQuestionId, secondQuestionId]);
  await page.getByRole('button', { name: 'Stop voice session', exact: true }).click();
  expect(mock.submissions).toHaveLength(1);
  expect(mock.recordings).toHaveLength(1);
});

test('pausing a pending conversational reply keeps it visible without late playback or listening', async ({ page }) => {
  const mock = await mockPractice(page, { holdReplyAudio: true });
  try {
    await beginRecording(page);
    await page.getByRole('button', { name: 'Done speaking', exact: true }).click();
    await expect.poll(() => mock.submissions.length).toBe(1);
    mock.advance(unsureReply);
    await expect.poll(() => mock.questionAudio.length).toBe(2);
    await expect(page.getByRole('region', { name: 'Coach response', exact: true })).toContainText(unsureReply);
    await page.getByRole('button', { name: 'Pause voice session', exact: true }).click();
    mock.releaseAudio();
    await expect.poll(mock.audioResponses).toBe(2);
    await expect(stageResume(page)).toBeVisible();
    await settleReact(page);
    const paused = await voiceState(page);
    expect(paused.audioPlays).toBe(1);
    expect(paused.deviceCalls).toBe(0);
    expect(paused.microphoneRequests).toBe(1);
    expect(paused.activeTracks).toBe(0);
    await expect(page.getByRole('button', { name: 'Hear response and question', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Done speaking', exact: true })).toHaveCount(0);
    expect(mock.submissions).toHaveLength(1);
  } finally { mock.releaseAudio(); }
});

test('the sixth answer plays its closing reply once and never reopens the microphone', async ({ page }) => {
  const mock = await mockPractice(page, { finalQuestion: true });
  await beginRecording(page);
  await page.getByRole('button', { name: 'Done speaking', exact: true }).click();
  await expect.poll(() => mock.submissions.length).toBe(1);
  mock.complete(closingReply);
  await expect(page.getByRole('heading', { name: /A clearer place to go next/ })).toBeVisible();
  await expect(page.getByText(closingReply, { exact: true }).first()).toBeVisible();
  await expect.poll(async () => (await voiceState(page)).audioPlays).toBe(2);
  const playback = page.getByRole('group', { name: 'Final response playback', exact: true });
  await expect(playback.getByRole('button', { name: 'Hear final response', exact: true })).toBeVisible();
  const complete = await voiceState(page);
  expect(complete.timeline.filter(event => event === 'question-ended')).toHaveLength(2);
  expect(complete.microphoneRequests).toBe(1);
  expect(complete.activeTracks).toBe(0);
  expect(mock.questionAudio).toEqual([firstQuestionId, firstQuestionId]);
  expect(mock.recordings).toHaveLength(1);
  expect(mock.submissions).toHaveLength(1);
  await expect(page.getByRole('button', { name: 'Done speaking', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Pause voice session', exact: true }).click();
  await playback.getByRole('button', { name: 'Hear final response', exact: true }).click();
  await expect(playback.getByRole('button', { name: 'Stop final response audio', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Stop voice session', exact: true }).click();
  await expect(playback.getByRole('button', { name: 'Hear final response', exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { lastVoiceFlowAudio: HTMLMediaElement }).lastVoiceFlowAudio.paused)).toBe(true);
  expect((await voiceState(page)).microphoneRequests).toBe(1);
  expect(mock.questionAudio).toEqual([firstQuestionId, firstQuestionId, firstQuestionId]);
  await page.reload();
  await expect(playback.getByRole('button', { name: 'Hear final response', exact: true })).toBeVisible();
  await settleReact(page);
  expect((await voiceState(page)).audioPlays).toBe(0);
  expect((await voiceState(page)).microphoneRequests).toBe(0);
  await playback.getByRole('button', { name: 'Hear final response', exact: true }).click();
  await expect.poll(async () => (await voiceState(page)).audioPlays).toBe(1);
  await expect(playback.getByRole('button', { name: 'Hear final response', exact: true })).toBeVisible();
  expect((await voiceState(page)).microphoneRequests).toBe(0);
  expect(mock.questionAudio).toEqual([firstQuestionId, firstQuestionId, firstQuestionId, firstQuestionId]);
});

test('transcript review is persisted and waits for an explicit submission', async ({ page }) => {
  const mock = await mockPractice(page);
  await page.goto(`/practice/${practiceId}`);
  const review = page.getByRole('checkbox', { name: 'Review transcript before sending', exact: true });
  await review.check();
  await page.getByRole('button', { name: 'Start voice session', exact: true }).click();
  await page.getByRole('button', { name: 'Done speaking', exact: true }).click();
  await expect(page.getByLabel('Your answer', { exact: true })).toHaveValue(transcript);
  expect(mock.submissions).toHaveLength(0);
  await page.reload();
  await expect(review).toBeChecked();
  await expect(page.getByLabel('Your answer', { exact: true })).toHaveValue(transcript);
  await expect(page.getByRole('button', { name: 'Start voice session', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Resume voice session', exact: true })).toHaveCount(0);
  await settleReact(page);
  expect((await voiceState(page)).microphoneRequests).toBe(0);
  expect(mock.questionAudio).toEqual([firstQuestionId]);
  await page.getByRole('button', { name: 'Submit answer', exact: true }).click();
  await expect.poll(() => mock.submissions.length).toBe(1);
  expect(mock.submissions[0].answer).toBe(transcript);
});

test('pausing while a transcript is pending prevents its late automatic submission', async ({ page }) => {
  const mock = await mockPractice(page, { holdTranscription: true });
  try {
    await beginRecording(page);
    await page.getByRole('button', { name: 'Done speaking', exact: true }).click();
    await expect.poll(() => mock.recordings.length).toBe(1);
    await page.getByRole('button', { name: 'Pause voice session', exact: true }).click();
    await expect(stageResume(page)).toBeVisible();
    await expect(stageResume(page)).toBeDisabled();
    await expect(toolbarResume(page)).toBeDisabled();
    mock.releaseTranscription();
    await expect.poll(mock.transcriptionResponses).toBe(1);
    await expect(page.getByLabel('Your answer', { exact: true })).toHaveValue(transcript);
    await expect(stageResume(page)).toBeEnabled();
    await expect(toolbarResume(page)).toBeEnabled();
    await settleReact(page);
    expect(mock.submissions).toHaveLength(0);
    expect((await voiceState(page)).microphoneRequests).toBe(1);
    expect((await voiceState(page)).activeTracks).toBe(0);
    await expect(page.getByRole('button', { name: 'Done speaking', exact: true })).toHaveCount(0);
  } finally { mock.releaseTranscription(); }
});

test('pausing a pending examiner playback prevents late playback and microphone activation', async ({ page }) => {
  const mock = await mockPractice(page, { holdAudio: true });
  try {
    await page.goto(`/practice/${practiceId}`);
    await page.getByRole('button', { name: 'Start voice session', exact: true }).click();
    await expect.poll(() => mock.questionAudio.length).toBe(1);
    await page.getByRole('button', { name: 'Pause voice session', exact: true }).click();
    mock.releaseAudio();
    await expect.poll(mock.audioResponses).toBe(1);
    await expect(stageResume(page)).toBeVisible();
    await expect(toolbarResume(page)).toBeVisible();
    await settleReact(page);
    const state = await voiceState(page);
    expect(state.audioPlays).toBe(0);
    expect(state.deviceCalls).toBe(0);
    expect(state.microphoneRequests).toBe(0);
    expect(mock.submissions).toHaveLength(0);
  } finally { mock.releaseAudio(); }
});

test('the visible stage Resume restarts a paused ready question without submitting the discarded recording', async ({ page }) => {
  const mock = await mockPractice(page);
  await beginRecording(page);
  await page.getByRole('button', { name: 'Pause voice session', exact: true }).click();
  await expect(stageResume(page)).toBeVisible();
  await expect(stageResume(page)).toBeInViewport();
  await expect(stageResume(page)).toBeEnabled();
  await expect.poll(async () => (await voiceState(page)).activeTracks).toBe(0);
  expect(mock.recordings).toHaveLength(0);
  expect(mock.submissions).toHaveLength(0);
  await stageResume(page).click();
  await expect(page.getByRole('button', { name: 'Done speaking', exact: true })).toBeVisible();
  const resumed = await voiceState(page);
  expect(resumed.microphoneRequests).toBe(2);
  expect(resumed.audioEndedAtMicrophone).toEqual([true, true]);
  expect(mock.questionAudio).toEqual([firstQuestionId, firstQuestionId]);
  await page.getByRole('button', { name: 'Done speaking', exact: true }).click();
  await expect.poll(() => mock.submissions.length).toBe(1);
  expect(mock.submissions[0].answer).toBe(transcript);
  expect(mock.recordings).toHaveLength(1);
});

for (const control of ['stage', 'toolbar'] as const) {
  test(`${control} Resume waits for a paused transcript, then records without overwriting or sending the saved draft`, async ({ page }) => {
    const mock = await mockPractice(page, { holdTranscription: true });
    try {
      await beginRecording(page);
      await page.getByRole('button', { name: 'Done speaking', exact: true }).click();
      await expect.poll(() => mock.recordings.length).toBe(1);
      await page.getByRole('button', { name: 'Pause voice session', exact: true }).click();
      await expect(stageResume(page)).toBeVisible();
      await expect(stageResume(page)).toBeDisabled();
      await expect(toolbarResume(page)).toBeDisabled();
      await expect(page.getByRole('group', { name: 'Voice session', exact: true })).toContainText('Resume becomes available when it is saved');
      expect((await voiceState(page)).microphoneRequests).toBe(1);
      mock.releaseTranscription();
      await expect(page.getByLabel('Your answer', { exact: true })).toHaveValue(transcript);
      await expect(stageResume(page)).toBeEnabled();
      await expect(toolbarResume(page)).toBeEnabled();
      expect(mock.submissions).toHaveLength(0);
      await (control === 'stage' ? stageResume(page) : toolbarResume(page)).click();
      await expect(page.getByRole('button', { name: 'Done speaking', exact: true })).toBeVisible();
      expect((await voiceState(page)).microphoneRequests).toBe(2);
      await expect(page.getByLabel('Your answer', { exact: true })).toHaveValue(transcript);
      expect(mock.submissions).toHaveLength(0);
      await page.getByRole('button', { name: 'Done speaking', exact: true }).click();
      await expect.poll(mock.transcriptionResponses).toBe(2);
      const combined = `${transcript}\n\n${transcript}`;
      await expect(page.getByLabel('Your answer', { exact: true })).toHaveValue(combined);
      await settleReact(page);
      expect(mock.submissions).toHaveLength(0);
      await page.getByRole('button', { name: 'Submit answer', exact: true }).click();
      await expect.poll(() => mock.submissions.length).toBe(1);
      expect(mock.submissions[0].answer).toBe(combined);
    } finally { mock.releaseTranscription(); }
  });
}

test('both Resume controls preserve failed audio until it is retried or explicitly discarded', async ({ page }) => {
  const mock = await mockPractice(page, { failTranscription: true });
  await beginRecording(page);
  await page.getByRole('button', { name: 'Done speaking', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Try transcription again' })).toBeVisible();
  await page.getByRole('button', { name: 'Pause voice session', exact: true }).click();
  await expect(stageResume(page)).toBeDisabled();
  await expect(toolbarResume(page)).toBeDisabled();
  expect((await voiceState(page)).microphoneRequests).toBe(1);
  expect(mock.recordings).toHaveLength(1);
  expect(mock.submissions).toHaveLength(0);
  await page.getByRole('button', { name: 'Discard audio', exact: true }).click();
  await expect(stageResume(page)).toBeEnabled();
  await expect(toolbarResume(page)).toBeEnabled();
  await toolbarResume(page).click();
  await expect(page.getByRole('button', { name: 'Done speaking', exact: true })).toBeVisible();
  expect((await voiceState(page)).microphoneRequests).toBe(2);
  await page.getByRole('button', { name: 'Stop voice session', exact: true }).click();
});

test('microphone denial in live practice preserves a working typed submission path', async ({ page }) => {
  const mock = await mockPractice(page, { denied: true });
  await page.goto(`/practice/${practiceId}`);
  await page.getByRole('button', { name: 'Start voice session', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: /Microphone access.*allowed/i })).toBeVisible();
  await page.getByLabel('Your answer', { exact: true }).fill('This is my typed explanation after microphone denial.');
  await page.getByRole('button', { name: 'Submit answer', exact: true }).click();
  await expect.poll(() => mock.submissions.length).toBe(1);
  expect(mock.submissions[0].answer).toBe('This is my typed explanation after microphone denial.');
  expect(mock.recordings).toHaveLength(0);
  expect((await voiceState(page)).microphoneRequests).toBe(1);
});
