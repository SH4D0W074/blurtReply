// Assemble the demo from genuine app capture frames and the original playback audio.
// Inputs stay in ignored .local/demo-video; outputs contain no browser cookies or keys.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = process.cwd();
const base = path.resolve(root, '.local/demo-video');
const take = path.join(base, 'take-2');
const output = path.resolve(root, 'artifacts/demo');
const capture = JSON.parse(fs.readFileSync(path.join(take, 'capture.json'), 'utf8'));
const session = JSON.parse(fs.readFileSync(path.join(take, 'completed.json'), 'utf8'));
const narration = JSON.parse(fs.readFileSync(path.join(base, 'narration/narration.json'), 'utf8'));
assert.equal(session.phase, 'complete');
assert.equal(session.review.source, 'ai');
assert.equal(session.turns.length, 2);
assert.equal(capture.errors.length, 0);
fs.mkdirSync(output, { recursive: true });

const clips = [];
let cursor = 0;
function addCard(name, duration) {
  clips.push({ at: cursor, end: cursor + duration, card: path.join(base, `art/${name}.png`), title: '', subtitle: '' });
  cursor += duration;
}
function addScreen(start, end, { duration = end - start, title, subtitle } = {}) {
  const clip = { at: cursor, end: cursor + duration, start, sourceEnd: end, title, subtitle };
  clips.push(clip);
  cursor += duration;
  return clip;
}
addCard('intro', 3.3);
addScreen(1.3, 2.392, { title: 'Explain your course. Find the gaps.', subtitle: 'Voice revision from your own notes' });
addScreen(2.986, 8.607, { title: 'Choose a subject or bring your course material', subtitle: 'Recorded with the Statistics sample' });
addScreen(8.623, 12.454, { title: 'The planner selects three concepts', subtitle: 'Each concept is linked to an original course excerpt' });
addScreen(12.454, 12.81, { title: 'A conversation about what you understand', subtitle: 'Live AI session · real app audio' });
assert.ok(Math.abs(cursor - 14.2) < 0.001);
const conversationA = addScreen(14.85, 26.5, { title: 'Answer out loud', subtitle: 'Actual app recording · synthetic student voice' });
const conversationB = addScreen(29.3, 51.2, { title: 'An explanation, then a follow-up', subtitle: 'ElevenLabs AI examiner · actual app audio' });
const evidenceAt = cursor + 0.25;
addScreen(56.411, 59.913, { duration: 10.4, title: 'Examiner → evidence checker', subtitle: 'Actual agent activity from this session' });
addScreen(51.9, 55.25, { duration: 5.7, title: 'Read the passage behind the explanation', subtitle: 'Original source text · open it from the feedback' });
const reviewAt = cursor + 0.35;
addScreen(72.382, 73.917, { duration: 2.2, title: 'A review from your own answers', subtitle: 'After a second answer · this same practice session' });
addScreen(73.917, 78.1, { duration: 5.3, title: 'Know what to practise next', subtitle: 'Revision coach · next steps linked to answers and sources' });
addScreen(78.1, 80.95, { duration: 3.8, title: 'Every revision action links back to your work', subtitle: 'Your answer, the feedback and the original passage' });
addCard('outro', 3.75);
const duration = Math.round(cursor * 1000) / 1000;
assert.ok(duration >= 60 && duration <= 90);

function mappedTime(raw, clip) { return clip.at + raw - clip.start; }
const audioStart = n => capture.events.find(e => e.kind === 'audio-start' && e.number === n).at;
const audioEnd = n => capture.events.find(e => e.kind === 'audio-end' && e.number === n).at;
const narrationClip = name => narration.clips.find(c => c.name === name);
const intro = narrationClip('intro'), evidence = narrationClip('evidence'), review = narrationClip('review');
const firstAt = mappedTime(audioStart(1), conversationA);
const studentAt = mappedTime(capture.events.find(e => e.kind === 'microphone-start').at, conversationA);
const replyAt = mappedTime(audioStart(2), conversationB);
const audio = [
  { file: path.join(base, 'narration/intro.mp3'), at: 0.35, duration: intro.durationSeconds },
  { file: path.join(take, 'audio/examiner-1.mp3'), at: firstAt, duration: audioEnd(1) - audioStart(1) },
  { file: path.join(take, 'audio/student.wav'), at: studentAt, duration: capture.student.durationSeconds ?? 3.4553125 },
  { file: path.join(take, 'audio/examiner-2.mp3'), at: replyAt, duration: audioEnd(2) - audioStart(2) },
  { file: path.join(base, 'narration/evidence.mp3'), at: evidenceAt, duration: evidence.durationSeconds },
  { file: path.join(base, 'narration/review.mp3'), at: reviewAt, duration: review.durationSeconds },
];
for (let i = 1; i < audio.length; i++) {
  assert.ok(audio[i].at >= audio[i - 1].at + audio[i - 1].duration - 0.03, `Audio overlap ${i}`);
}
assert.ok(audio.at(-1).at + audio.at(-1).duration < duration);

// Caption phrase boundaries follow the recording; within-phrase word timing is approximate.
const cues = [];
function speech(at, length, phrases, speaker) {
  const counts = phrases.map(p => p.split(/\s+/).length);
  const total = counts.reduce((a, b) => a + b, 0);
  let position = at;
  phrases.forEach((text, i) => {
    const end = i === phrases.length - 1 ? at + length : position + length * counts[i] / total;
    assert.ok(text.length <= 95);
    cues.push({ start: position, end, text, speaker });
    position = end;
  });
}
speech(0.35, intro.durationSeconds, [
  'Your lecture notes can look familiar',
  'until someone asks you to explain them.',
  'With blurtReply, choose a sample subject',
  'or bring your own course material.',
  'A planner selects three concepts for your spoken revision session.',
], 'ElevenLabs narration');
speech(firstAt, audio[1].duration, [
  'Why does an observed correlation not, by itself,',
  'show that one variable causes another?',
], 'ElevenLabs AI examiner · actual app audio');
speech(studentAt + 0.25, 2.3053125, [
  '“I don’t know. Could you explain it?”',
], 'Student · synthetic demonstration voice');
speech(replyAt, audio[3].duration, [
  'A correlation shows that variables are associated,',
  'but that alone doesn’t show that changing one causes the other.',
  'Reverse causation, a shared cause, or chance could explain the association.',
  'In your own words, why isn’t an observed correlation enough to show causation?',
], 'ElevenLabs AI examiner · actual app audio');
speech(evidenceAt, evidence.durationSeconds, [
  'The examiner retrieves a passage from your course material',
  'before proposing feedback.',
  'A separate evidence checker reviews that explanation',
  'and can withhold unsupported feedback.',
  'Open the quoted source to compare the explanation with the original wording.',
], 'ElevenLabs narration · cooperating AI agents');
speech(reviewAt, review.durationSeconds, [
  'After your session, the revision coach links next steps',
  'to saved answers and source passages,',
  'giving you a specific explanation to practise in your next study session.',
], 'ElevenLabs narration · review after a second answer');

const visuals = [];
function capturedAt(time) {
  return capture.frames.findLast(f => f.at <= time) ?? capture.frames[0];
}
for (const clip of clips) {
  const entry = file => ({ file, kind: clip.card ? 'card' : 'screen', title: clip.title, subtitle: clip.subtitle });
  visuals.push({ at: clip.at, ...entry(clip.card ?? capturedAt(clip.start).file) });
  if (!clip.card) {
    for (const f of capture.frames) {
      if (f.at > clip.start && f.at < clip.sourceEnd) {
        visuals.push({ at: clip.at + f.at - clip.start, ...entry(f.file) });
      }
    }
  }
}
visuals.sort((a, b) => a.at - b.at);
const boundaries = new Set(visuals.map(v => v.at));
for (const cue of cues) { boundaries.add(cue.start); boundaries.add(cue.end); }
// Acknowledge the one shortened processing wait on screen.
const processingAt = mappedTime(capture.marks.checkingStart, conversationA);
boundaries.add(processingAt);
boundaries.add(replyAt);
const frames = [...boundaries].sort((a, b) => a - b).filter(t => t < duration).map(at => {
  const v = visuals.findLast(f => f.at <= at + 1e-7);
  const cue = cues.find(c => at >= c.start - 1e-7 && at < c.end - 1e-7);
  if (cue) return { ...v, at, title: cue.text, subtitle: cue.speaker };
  if (at >= processingAt && at < replyAt) {
    return { ...v, at, title: 'The examiner retrieves evidence. The checker reviews the response.', subtitle: 'Processing wait shortened by 2.8 seconds' };
  }
  return { ...v, at };
});
const manifest = { output: path.join(output, 'blurtReply-demo.mp4'), width: 1920, height: 1080, fps: 25, duration, frames, audio };
fs.writeFileSync(path.join(base, 'edit.json'), JSON.stringify(manifest, null, 2) + '\n');
function srtTime(seconds) {
  const ms = Math.round(seconds * 1000);
  return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
}
fs.writeFileSync(path.join(output, 'blurtReply-demo.srt'), cues.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`).join('\n'));
fs.writeFileSync(path.join(base, 'edit-timing.json'), JSON.stringify({ duration, clips, audio, cues }, null, 2) + '\n');
console.log(JSON.stringify({ duration, frames: frames.length, audioClips: audio.length, output: manifest.output, evidenceAt, reviewAt }, null, 2));
