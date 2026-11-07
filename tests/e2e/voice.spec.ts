import { test, expect, type Page } from '@playwright/test';
import type { PracticeSession, ServerStatus } from '../../shared/types';

// Test the real player and controls with generated PCM, without paid provider calls.
function audioFixture() {
  const sampleRate = 8000;
  const samples = sampleRate * 3;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24); wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36);
  wav.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) wav.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * 220 / sampleRate) * 500), 44 + i * 2);
  return wav;
}

async function voicePractice(page: Page, mode: 'live' | 'demo' = 'live') {
  const created = await page.request.post('/api/practices', { data: { mode: 'demo', sampleId: 'stats-causation' } });
  const { id } = await created.json() as PracticeSession;
  let session!: PracticeSession;
  await expect.poll(async () => {
    session = await (await page.request.get(`/api/practices/${id}`)).json() as PracticeSession;
    return session.phase;
  }).toBe('ready');
  const status: ServerStatus = {
    aiConfigured: true, aiEnabled: true, model: 'test-only', remainingTextCalls: 0,
    transcriptionAvailable: false, transcriptionModel: 'test-only', remainingTranscriptions: 0,
    voiceProvider: 'elevenlabs', remainingVoiceCalls: 0, localOnly: true,
  };
  await page.route('**/api/status', route => route.fulfill({ json: status }));
  await page.route(`**/api/practices/${id}`, route => route.fulfill({ json: { ...session, mode } }));
  await page.addInitScript(() => {
    const state = { deviceCalls: 0, audioPlays: 0, microphoneRequests: 0, audio: null as HTMLMediaElement | null };
    Object.assign(window, { voiceTest: state });
    Object.defineProperty(window, 'speechSynthesis', { value: {
      cancel() {}, getVoices() { return []; },
      speak() { state.deviceCalls += 1; },
    } });
    navigator.mediaDevices.getUserMedia = async () => {
      state.microphoneRequests += 1;
      throw new DOMException('No microphone is needed for manual question playback.', 'NotAllowedError');
    };
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = async function () {
      await play.call(this);
      state.audio = this;
      state.audioPlays += 1;
    };
  });
  return id;
}

test('plays question audio even at the generation cap, stops it, and clearly names ElevenLabs', async ({ page }) => {
  const id = await voicePractice(page);
  let requests = 0;
  await page.route(`**/api/practices/${id}/question-audio`, route => {
    requests += 1;
    return route.fulfill({ contentType: 'audio/wav', body: audioFixture() });
  });
  await page.goto(`/practice/${id}`);
  await page.getByRole('button', { name: 'Hear the question', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop question audio', exact: true })).toBeVisible();
  await expect(page.locator('.question-playback')).toContainText('ElevenLabs');
  await expect.poll(() => page.evaluate(() => {
    const state = (window as unknown as { voiceTest: { audio: HTMLMediaElement | null } }).voiceTest;
    return (state.audio?.currentTime ?? 0) > 0;
  })).toBe(true);
  await page.getByRole('button', { name: 'Stop question audio', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Hear the question', exact: true })).toBeVisible();
  expect(await page.evaluate(() => {
    const state = (window as unknown as { voiceTest: { audio: HTMLMediaElement | null; deviceCalls: number } }).voiceTest;
    return { paused: state.audio?.paused, deviceCalls: state.deviceCalls };
  })).toEqual({ paused: true, deviceCalls: 0 });
  expect(requests).toBe(1);
});

test('an ElevenLabs failure switches the visible label and speaks once through the device', async ({ page }) => {
  const id = await voicePractice(page);
  await page.route(`**/api/practices/${id}/question-audio`, route => route.fulfill({ status: 503, json: { error: 'Voice unavailable.' } }));
  await page.goto(`/practice/${id}`);
  await page.getByRole('button', { name: 'Hear the question', exact: true }).click();
  await expect(page.locator('.question-playback')).toContainText('Device voice');
  await expect(page.getByText('ElevenLabs audio is unavailable. Using your device voice.')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { voiceTest: { deviceCalls: number } }).voiceTest.deviceCalls)).toBe(1);
});

test('the free guided demo uses device speech even when ElevenLabs is configured', async ({ page }) => {
  const id = await voicePractice(page, 'demo');
  let paidRequests = 0;
  await page.route(`**/api/practices/${id}/question-audio`, route => { paidRequests += 1; return route.abort(); });
  await page.route(`**/api/practices/${id}/transcriptions`, route => { paidRequests += 1; return route.abort(); });
  await page.goto(`/practice/${id}`);
  await expect(page.getByRole('button', { name: 'Start voice session', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Start local microphone rehearsal', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Hear the question', exact: true }).click();
  await expect(page.locator('.question-playback')).toContainText('Device voice');
  expect(await page.evaluate(() => (window as unknown as { voiceTest: { deviceCalls: number } }).voiceTest.deviceCalls)).toBe(1);
  expect(paidRequests).toBe(0);
  expect(await page.evaluate(() => (window as unknown as { voiceTest: { microphoneRequests: number } }).voiceTest.microphoneRequests)).toBe(0);
});

test('cancelling a pending question prevents late playback and device fallback', async ({ page }) => {
  const id = await voicePractice(page);
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  let started = false;
  let finish!: () => void;
  const finished = new Promise<void>(resolve => { finish = resolve; });
  await page.route(`**/api/practices/${id}/question-audio`, async route => {
    started = true;
    await pending;
    await route.fulfill({ contentType: 'audio/wav', body: audioFixture() }).catch(() => {});
    finish();
  });
  await page.goto(`/practice/${id}`);
  await page.getByRole('button', { name: 'Hear the question', exact: true }).click();
  await expect.poll(() => started).toBe(true);
  await page.getByRole('button', { name: 'Cancel playback', exact: true }).click();
  release();
  await finished;
  await expect(page.getByRole('button', { name: 'Hear the question', exact: true })).toBeVisible();
  expect(await page.evaluate(() => {
    const state = (window as unknown as { voiceTest: { deviceCalls: number; audioPlays: number } }).voiceTest;
    return { deviceCalls: state.deviceCalls, audioPlays: state.audioPlays };
  })).toEqual({ deviceCalls: 0, audioPlays: 0 });
});
