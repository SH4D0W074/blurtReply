import { createHash } from 'node:crypto';
import OpenAI, { toFile } from 'openai';
import type { ServerStatus } from '../shared/types.ts';

type VoiceStatus = Pick<ServerStatus, 'transcriptionAvailable' | 'transcriptionModel' | 'remainingTranscriptions' | 'voiceProvider' | 'remainingVoiceCalls'>;
type Environment = Record<string, string | undefined>;
type TranscriptionRequest = { file: File; model: string; prompt?: string };
interface VoiceDependencies {
  environment?: () => Environment;
  transcribe?: (request: TranscriptionRequest, key: string) => Promise<{ text: string }>;
  fetcher?: typeof fetch;
}

const AUDIO_LIMIT = 2 * 1024 * 1024;
const formats: Record<string, string> = {
  'audio/webm': 'webm', 'audio/wav': 'wav', 'audio/x-wav': 'wav',
  'audio/mp4': 'mp4', 'audio/m4a': 'm4a', 'audio/x-m4a': 'm4a',
  'audio/mpeg': 'mp3', 'audio/mp3': 'mp3',
};

export class VoiceError extends Error {
  constructor(message: string, readonly code: string, readonly status = 503) {
    super(message);
    this.name = 'VoiceError';
  }
}

function capped(value: string | undefined, fallback: number, maximum: number) {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? Math.min(parsed, maximum) : fallback;
}

// A process-local budget is reserved before I/O, including failed attempts.
// Failed requests are never automatically retried and raw audio is never written to disk.
export function createVoiceService(dependencies: VoiceDependencies = {}) {
  const environment = dependencies.environment ?? (() => process.env);
  const fetcher = dependencies.fetcher ?? fetch;
  let transcriptions = 0;
  let voiceCalls = 0;
  const audioCache = new Map<string, Promise<Buffer>>();

  function config() {
    const env = environment();
    return {
      enabled: env.VIVACOACH_LIVE_AI === 'true',
      openaiKey: env.OPENAI_API_KEY?.trim() ?? '',
      elevenKey: env.ELEVENLABS_API_KEY?.trim() ?? '',
      voiceId: env.ELEVENLABS_VOICE_ID?.trim() || 'JBFqnCBsd6RMkjVDRZzb',
      model: env.OPENAI_TRANSCRIPTION_MODEL?.trim() || 'gpt-transcribe',
      maxTranscriptions: capped(env.VIVACOACH_MAX_TRANSCRIPTIONS, 12, 60),
      maxVoiceCalls: capped(env.VIVACOACH_MAX_VOICE_CALLS, 30, 120),
    };
  }

  function getVoiceStatus(): VoiceStatus {
    const c = config();
    return {
      transcriptionAvailable: c.enabled && !!c.openaiKey && transcriptions < c.maxTranscriptions,
      transcriptionModel: c.model,
      remainingTranscriptions: Math.max(0, c.maxTranscriptions - transcriptions),
      voiceProvider: c.enabled && c.elevenKey ? 'elevenlabs' : 'device',
      remainingVoiceCalls: Math.max(0, c.maxVoiceCalls - voiceCalls),
    };
  }

  async function transcribeAudio(buffer: Buffer, mime: string, context: string) {
    const c = config();
    const contentType = mime.toLowerCase().split(';')[0].trim();
    const extension = formats[contentType];
    if (!extension) throw new VoiceError('Use a WebM, WAV, MP4 or MP3 recording.', 'AUDIO_FORMAT', 415);
    if (buffer.length < 100 || buffer.length > AUDIO_LIMIT) {
      throw new VoiceError('Record a short answer of up to 90 seconds (maximum 2 MB).', 'AUDIO_SIZE', 413);
    }
    if (!c.enabled || !c.openaiKey) throw new VoiceError('Voice transcription is unavailable. You can type your answer.', 'TRANSCRIPTION_UNAVAILABLE');
    if (transcriptions >= c.maxTranscriptions) throw new VoiceError('The recording limit for this server run has been reached. You can still type.', 'TRANSCRIPTION_LIMIT', 429);
    transcriptions += 1;
    try {
      const request: TranscriptionRequest = {
        file: await toFile(buffer, `answer.${extension}`, { type: contentType }),
        model: c.model,
        // Course title is a vocabulary hint, never an expected answer.
        prompt: context.trim().slice(0, 160) || undefined,
      };
      const result = dependencies.transcribe
        ? await dependencies.transcribe(request, c.openaiKey)
        : await new OpenAI({ apiKey: c.openaiKey, maxRetries: 0, timeout: 30_000 }).audio.transcriptions.create(request);
      const text = result.text?.trim();
      if (!text) throw new VoiceError('No speech was detected. Try again or type your answer.', 'NO_SPEECH', 422);
      if (text.length > 2500) throw new VoiceError('That transcript is too long. Record a shorter answer or type a summary.', 'TRANSCRIPT_TOO_LONG', 422);
      return { text, model: c.model };
    } catch (error) {
      if (error instanceof VoiceError) throw error;
      throw new VoiceError('Transcription could not finish. Your typed answer is still available; you can retry the recording.', 'TRANSCRIPTION_FAILED');
    }
  }

  async function speakQuestion(text: string, cacheKey: string) {
    const c = config();
    if (!c.enabled || !c.elevenKey) throw new VoiceError('Use the voice available on your device.', 'DEVICE_VOICE');
    if (!/^[a-zA-Z0-9]{10,80}$/.test(c.voiceId)) throw new VoiceError('The examiner voice is not configured correctly. Use device voice.', 'VOICE_CONFIGURATION');
    if (!text.trim() || text.length > 1200) throw new VoiceError('This question cannot be played. You can read it on screen.', 'QUESTION_AUDIO_INVALID', 400);
    const hash = createHash('sha256').update(`${cacheKey}\0${c.voiceId}\0${text}`).digest('hex');
    const cached = audioCache.get(hash);
    if (cached) return cached;
    if (voiceCalls >= c.maxVoiceCalls) throw new VoiceError('The examiner voice limit has been reached. Use device voice.', 'VOICE_LIMIT', 429);
    voiceCalls += 1;

    const request = (async () => {
      try {
        const response = await fetcher(`https://api.elevenlabs.io/v1/text-to-speech/${c.voiceId}?output_format=mp3_22050_32`, {
          method: 'POST',
          headers: { 'xi-api-key': c.elevenKey, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
          body: JSON.stringify({ text, model_id: 'eleven_flash_v2_5', voice_settings: { stability: 0.5, similarity_boost: 0.75 } }),
          signal: AbortSignal.timeout(20_000),
          redirect: 'error',
        });
        if (!response.ok || !response.headers.get('content-type')?.startsWith('audio/')) {
          throw new Error('Voice provider did not return audio');
        }
        // A question should be much smaller; cap responses even without Content-Length.
        if (Number(response.headers.get('content-length')) > AUDIO_LIMIT || !response.body) throw new Error('Audio size');
        const chunks: Uint8Array[] = [];
        let size = 0;
        const reader = response.body.getReader();
        try {
          while (true) {
            const part = await reader.read();
            if (part.done) break;
            size += part.value.byteLength;
            if (size > AUDIO_LIMIT) { await reader.cancel(); throw new Error('Audio size'); }
            chunks.push(part.value);
          }
        } finally { reader.releaseLock(); }
        if (!size) throw new Error('Empty audio');
        return Buffer.concat(chunks);
      } catch {
        audioCache.delete(hash);
        throw new VoiceError('The examiner voice could not load. Use device voice or read the question.', 'VOICE_FAILED');
      }
    })();
    audioCache.set(hash, request);
    // Keep memory bounded; fulfilled questions can be requested again within the call cap.
    if (audioCache.size > 40) audioCache.delete(audioCache.keys().next().value!);
    return request;
  }

  return { getVoiceStatus, transcribeAudio, speakQuestion };
}

const service = createVoiceService();
export const getVoiceStatus = service.getVoiceStatus;
export const transcribeAudio = service.transcribeAudio;
export const speakQuestion = service.speakQuestion;
