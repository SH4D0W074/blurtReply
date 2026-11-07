import { chromium } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

// This captures the real app, including paid provider work. It never mocks API responses.
// The student is a disclosed prerecorded WAV routed through Chrome's fake microphone.
// Browser identity, snapshots, frames and downloaded speech must stay under ignored .local/.
const root = fileURLToPath(new URL('../../', import.meta.url));
const ignoredRoot = path.join(root, '.local');
const directory = path.resolve(root, process.argv[2] ?? process.env.BLURT_DEMO_DIR ?? '.local/demo-video');
const relativeDirectory = path.relative(ignoredRoot, directory);
assert.ok(relativeDirectory && !relativeDirectory.startsWith(`..${path.sep}`) && relativeDirectory !== '..' && !path.isAbsolute(relativeDirectory), 'Choose an output directory inside the repository’s ignored .local/ directory.');
const baseUrl = new URL(process.env.BLURT_DEMO_URL ?? 'http://localhost:3000');
assert.ok(['http:', 'https:'].includes(baseUrl.protocol) && !baseUrl.username && !baseUrl.password && baseUrl.pathname === '/' && !baseUrl.search && !baseUrl.hash, 'BLURT_DEMO_URL must be a plain application origin without credentials or a path.');
const base = baseUrl.origin;
const runBudget = { textRequests: 10, transcriptions: 1, voiceGenerations: 2 };
const student = JSON.parse(await readFile(path.join(directory, 'audio/student.json'), 'utf8'));
assert.ok(Number.isFinite(student.duration) && student.duration > .35 && student.duration <= 90, 'student.json must provide a WAV duration between 0.35 and 90 seconds.');
const browserLocation = process.env.BLURT_DEMO_CHROME_PATH
  ? { executablePath: path.resolve(process.env.BLURT_DEMO_CHROME_PATH) }
  : { channel: process.env.BLURT_DEMO_BROWSER_CHANNEL ?? 'chrome' };
const browser = await chromium.launch({ ...browserLocation, headless: true, args: [
  '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
  `--use-file-for-fake-audio-capture=${path.join(directory, 'audio/student.wav')}`,
] });
const context = await browser.newContext({ viewport: { width: 1440, height: 720 }, permissions: ['microphone'], reducedMotion: 'reduce' });
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
const started = Date.now();
const frames = [], events = [], marks = {}, audioFiles = [], errors = [], writes = [];
const elapsed = () => (Date.now() - started) / 1000;
const mark = name => { marks[name] = elapsed(); console.log(JSON.stringify({ scene: name, time: marks[name] })); };
let lastFrame = -1, frameNumber = 0;
let sessionId, before, consumed;
await mkdir(path.join(directory, 'frames'), { recursive: true });
await page.exposeFunction('recordDemoEvent', event => { events.push({ ...event, at: (event.time - started) / 1000 }); });
await page.exposeFunction('recordDemoAudio', async ({ number, base64 }) => {
  const buffer = Buffer.from(base64, 'base64');
  assert.ok(buffer.length > 100, 'Audio capture must contain the actual decoded response bytes.');
  const file = path.join(directory, `audio/examiner-${number}.mp3`);
  await writeFile(file, buffer);
  audioFiles.push({ number, file, bytes: buffer.length });
  console.log(JSON.stringify({ audioSaved: number, bytes: buffer.length }));
});
await page.addInitScript(() => {
  const send = detail => { void window.recordDemoEvent({ time: Date.now(), ...detail }); };
  let audioNumber = 0;
  let downloadedAudio = 0;
  const originalBlob = Response.prototype.blob;
  Response.prototype.blob = async function (...args) {
    const blob = await originalBlob.apply(this, args);
    if (this.url.endsWith('/question-audio') && this.ok) {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = '';
      for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
      await window.recordDemoAudio({ number: ++downloadedAudio, base64: btoa(binary) });
    }
    return blob;
  };
  const originalPlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    const number = ++audioNumber;
    this.addEventListener('playing', () => send({ kind: 'audio-start', number }), { once: true });
    this.addEventListener('ended', () => send({ kind: 'audio-end', number }), { once: true });
    return originalPlay.call(this);
  };
  const originalRecord = MediaRecorder.prototype.start;
  MediaRecorder.prototype.start = function (...args) {
    send({ kind: 'microphone-start' });
    return originalRecord.apply(this, args);
  };
  window.addEventListener('DOMContentLoaded', () => {
    const pointer = document.createElement('div');
    pointer.id = 'demo-pointer';
    pointer.style.cssText = 'position:fixed;left:0;top:0;width:18px;height:18px;border:2px solid #eeedff;border-radius:50%;background:#a49afc66;box-shadow:0 0 0 5px #a49afc18;pointer-events:none;z-index:2147483647;transform:translate(-100px,-100px);';
    document.body.append(pointer);
    document.addEventListener('mousemove', event => { pointer.style.transform = `translate(${event.clientX - 9}px,${event.clientY - 9}px)`; });
    document.addEventListener('mousedown', () => { pointer.style.boxShadow = '0 0 0 12px #a49afc66'; });
    document.addEventListener('mouseup', () => { pointer.style.boxShadow = '0 0 0 5px #a49afc18'; });
  });
});
page.on('pageerror', error => errors.push(error.message));
cdp.on('Page.screencastFrame', event => {
  void cdp.send('Page.screencastFrameAck', { sessionId: event.sessionId }).catch(() => {});
  const time = elapsed();
  if (time - lastFrame < 1 / 15) return;
  lastFrame = time;
  const file = path.join(directory, 'frames', `${String(++frameNumber).padStart(6, '0')}.jpg`);
  frames.push({ at: time, file });
  writes.push(writeFile(file, Buffer.from(event.data, 'base64')));
});
const wait = milliseconds => page.waitForTimeout(milliseconds);
async function click(locator) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  assert.ok(box);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 16 });
  await wait(220);
  await locator.click();
}
async function eventCount(kind, number, timeout = 60000) {
  const deadline = Date.now() + timeout;
  while (!events.some(event => event.kind === kind && (!number || event.number === number))) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${kind} ${number ?? ''}`);
    await wait(100);
  }
}
try {
  before = await (await page.request.get(base + '/api/status')).json();
  assert.equal(before.voiceProvider, 'elevenlabs');
  assert.ok(before.remainingTextCalls >= runBudget.textRequests && before.remainingVoiceCalls >= runBudget.voiceGenerations && before.remainingTranscriptions >= runBudget.transcriptions, 'The server lacks enough remaining calls for this bounded capture. Do not retry or restart it just to bypass a configured limit.');
  await page.goto(base);
  await page.getByRole('link', { name: 'Set up your practice', exact: true }).waitFor();
  await documentFonts(page);
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 90, maxWidth: 1440, maxHeight: 720, everyNthFrame: 1 });
  mark('homeStart'); await wait(2300); mark('homeEnd');
  await click(page.getByRole('link', { name: 'Set up your practice', exact: true }));
  await page.evaluate(() => window.scrollTo(0, document.getElementById('setup').offsetTop - 25));
  mark('setupStart'); await wait(1200);
  await click(page.getByRole('button', { name: 'Bring your material', exact: false }));
  await wait(1800);
  await click(page.getByRole('button', { name: 'Try a subject', exact: true }));
  await wait(1000);
  await click(page.getByRole('button', { name: 'Start practising', exact: true }));
  mark('setupEnd');
  await page.waitForURL(/\/practice\//);
  sessionId = page.url().split('/').at(-1);
  mark('prepareStart');
  await page.getByRole('button', { name: 'Start voice session', exact: true }).waitFor({ timeout: 65000 });
  await context.storageState({ path: path.join(directory, 'context.json') });
  const prepared = await (await page.request.get(`${base}/api/practices/${sessionId}`)).json();
  await writeFile(path.join(directory, 'prepared.json'), JSON.stringify(prepared, null, 2));
  assert.equal(prepared.mode, 'live');
  await page.evaluate(() => window.scrollTo(0, 0));
  mark('questionStart'); await wait(1600);
  await click(page.getByRole('button', { name: 'Start voice session', exact: true }));
  await eventCount('audio-start', 1);
  mark('questionSpeaking');
  await page.getByRole('button', { name: 'Done speaking', exact: true }).waitFor({ timeout: 60000 });
  mark('studentStart');
  await wait((student.duration - .35) * 1000);
  await click(page.getByRole('button', { name: 'Done speaking', exact: true }));
  mark('checkingStart');
  await page.getByRole('region', { name: 'Coach response', exact: true }).waitFor({ timeout: 65000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  mark('replyVisible');
  await eventCount('audio-start', 2);
  const firstAnswer = await (await page.request.get(`${base}/api/practices/${sessionId}`)).json();
  await writeFile(path.join(directory, 'first-answer.json'), JSON.stringify(firstAnswer, null, 2));
  assert.equal(firstAnswer.turns.length, 1);
  assert.match(firstAnswer.turns[0].answer, /know|explain/i);
  assert.equal(firstAnswer.turns[0].feedback.source, 'ai');
  assert.equal(firstAnswer.turns[0].feedback.reviewStatus, 'checked');
  await eventCount('audio-end', 2);
  await click(page.getByRole('button', { name: 'Pause voice session', exact: true }));
  mark('replyEnd'); await wait(750);
  mark('sourceStart');
  await click(page.locator('.evidence .source-link').first());
  await wait(3400);
  await page.keyboard.press('Escape');
  mark('sourceEnd');
  await click(page.getByRole('tab', { name: 'Agents', exact: true }));
  await page.evaluate(() => window.scrollTo(0, 0));
  mark('agentsStart'); await wait(3500); mark('agentsEnd');

  // Continue the same practice honestly, using the explanation just received.
  const correction = 'An association alone does not show that one variable causes the other to change. Reverse causation, a shared cause, or chance could explain the pattern, so we need evidence that distinguishes those alternatives.';
  const answerBox = page.getByRole('textbox', { name: 'Your answer', exact: true });
  await answerBox.fill(correction);
  await click(page.getByRole('button', { name: 'Submit answer', exact: true }));
  mark('secondAnswerStart');
  await page.waitForFunction(() => document.querySelector('.practice-progress__label')?.textContent?.includes('03'), null, { timeout: 65000 });
  await page.getByRole('button', { name: 'Hear response and question', exact: true }).waitFor({ timeout: 65000 });
  const second = await (await page.request.get(`${base}/api/practices/${sessionId}`)).json();
  assert.equal(second.turns.length, 2);
  await writeFile(path.join(directory, 'second-answer.json'), JSON.stringify(second, null, 2));
  mark('secondAnswerEnd');
  await click(page.getByRole('button', { name: 'Finish here', exact: false }));
  await click(page.getByRole('button', { name: 'Create my review', exact: true }));
  await page.getByRole('heading', { name: /A clearer/ }).waitFor({ timeout: 65000 });
  mark('reviewStart');
  // Lead with the review itself; the last spoken reply remains above it.
  await page.locator('.review-intro').evaluate(element => window.scrollTo(0, element.getBoundingClientRect().top + window.scrollY - 22));
  await wait(1500);
  await page.locator('.review-columns').evaluate(element => window.scrollTo(0, element.getBoundingClientRect().top + window.scrollY - 40));
  await wait(4200);
  const answerLink = page.locator('.review-point__links').getByRole('button', { name: 'Your answer', exact: false }).first();
  if (await answerLink.count()) { await click(answerLink); await wait(2400); }
  mark('reviewEnd');
  const completed = await (await page.request.get(`${base}/api/practices/${sessionId}`)).json();
  await writeFile(path.join(directory, 'completed.json'), JSON.stringify(completed, null, 2));
  assert.equal(completed.phase, 'complete');
  assert.equal(completed.review.source, 'ai');
  assert.equal(completed.turns.length, 2);
  assert.deepEqual(errors, []);
  const after = await (await page.request.get(base + '/api/status')).json();
  consumed = { textRequests: before.remainingTextCalls - after.remainingTextCalls, transcriptions: before.remainingTranscriptions - after.remainingTranscriptions, voiceGenerations: before.remainingVoiceCalls - after.remainingVoiceCalls };
  assert.ok(consumed.textRequests <= runBudget.textRequests && consumed.transcriptions <= runBudget.transcriptions && consumed.voiceGenerations <= runBudget.voiceGenerations, 'Observed call usage exceeded the capture plan; use an isolated server when measuring this run.');
  console.log(JSON.stringify({ captured: true, sessionId, reviewSource: completed.review.source, ...consumed }));
} catch (error) {
  errors.push(error.message);
  console.log(JSON.stringify({ captureFailed: error.message, sessionId }));
  await page.screenshot({ path: path.join(directory, 'capture-failure.png') }).catch(() => {});
  process.exitCode = 1;
} finally {
  await cdp.send('Page.stopScreencast').catch(() => {});
  await Promise.allSettled(writes);
  await writeFile(path.join(directory, 'capture.json'), JSON.stringify({ started, sessionId, duration: elapsed(), frames, events, marks, audioFiles, errors, student, runBudget, consumed, disclosures: { prerecordedStudent: true, realAppRequests: true, apiResponsesMocked: false } }, null, 2));
  await browser.close();
}
async function documentFonts(page) { await page.evaluate(() => document.fonts.ready); }
