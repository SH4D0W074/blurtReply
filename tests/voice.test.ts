import { describe, expect, it, vi } from 'vitest';
import { createVoiceService } from '../server/voice.ts';

const enabled = { VIVACOACH_LIVE_AI: 'true', OPENAI_API_KEY: 'unit-test-only', ELEVENLABS_API_KEY: 'unit-test-only' };
const audio = Buffer.alloc(300, 1);

describe('bounded voice providers', () => {
  it('does not contact any provider when disabled', async () => {
    const transcribe = vi.fn();
    const fetcher = vi.fn();
    const service = createVoiceService({ environment: () => ({}), transcribe, fetcher });
    expect(service.getVoiceStatus()).toMatchObject({ transcriptionAvailable: false, voiceProvider: 'device' });
    await expect(service.transcribeAudio(audio, 'audio/webm', 'Stats')).rejects.toMatchObject({ code: 'TRANSCRIPTION_UNAVAILABLE' });
    await expect(service.speakQuestion('Explain correlation.', 'q1')).rejects.toMatchObject({ code: 'DEVICE_VOICE' });
    expect(transcribe).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('validates type and size without spending a call', async () => {
    const transcribe = vi.fn();
    const service = createVoiceService({ environment: () => enabled, transcribe });
    await expect(service.transcribeAudio(audio, 'text/html', '')).rejects.toMatchObject({ code: 'AUDIO_FORMAT' });
    await expect(service.transcribeAudio(Buffer.alloc(2 * 1024 * 1024 + 1), 'audio/webm', '')).rejects.toMatchObject({ code: 'AUDIO_SIZE' });
    expect(service.getVoiceStatus().remainingTranscriptions).toBe(12);
    expect(transcribe).not.toHaveBeenCalled();
  });

  it('reserves the budget before concurrent requests and gives editable text', async () => {
    let finish!: (value: { text: string }) => void;
    const transcribe = vi.fn((_request: unknown, _key: string) => new Promise<{ text: string }>(resolve => { finish = resolve; }));
    const service = createVoiceService({ environment: () => ({ ...enabled, VIVACOACH_MAX_TRANSCRIPTIONS: '1' }), transcribe });
    const first = service.transcribeAudio(audio, 'audio/webm;codecs=opus', 'Statistics');
    await expect(service.transcribeAudio(audio, 'audio/webm', '')).rejects.toMatchObject({ code: 'TRANSCRIPTION_LIMIT' });
    await vi.waitFor(() => expect(transcribe).toHaveBeenCalledTimes(1));
    expect(transcribe.mock.calls[0][0]).toMatchObject({ model: 'gpt-transcribe', prompt: 'Statistics' });
    finish({ text: '  Association does not establish causation.  ' });
    await expect(first).resolves.toEqual({ text: 'Association does not establish causation.', model: 'gpt-transcribe' });
    expect(service.getVoiceStatus().transcriptionAvailable).toBe(false);
  });

  it('counts failures, never retries, and hides provider error bodies', async () => {
    const transcribe = vi.fn(async () => { throw new Error('private provider error and key'); });
    const service = createVoiceService({ environment: () => enabled, transcribe });
    await expect(service.transcribeAudio(audio, 'audio/wav', '')).rejects.toMatchObject({ code: 'TRANSCRIPTION_FAILED' });
    expect(transcribe).toHaveBeenCalledTimes(1);
    expect(service.getVoiceStatus().remainingTranscriptions).toBe(11);
  });

  it('shares concurrent question audio and never reuses audio for a different question', async () => {
    const fetcher = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'audio/mpeg' } }));
    const service = createVoiceService({ environment: () => enabled, fetcher });
    const results = await Promise.all([service.speakQuestion('Why?', 'q1'), service.speakQuestion('Why?', 'q1')]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(results[0]).toEqual(results[1]);
    await service.speakQuestion('How?', 'q1');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('evicts failed audio and enforces the voice budget', async () => {
    const fetcher = vi.fn(async () => new Response('provider secret', { status: 401 }));
    const service = createVoiceService({ environment: () => ({ ...enabled, VIVACOACH_MAX_VOICE_CALLS: '1' }), fetcher });
    await expect(service.speakQuestion('Why?', 'q1')).rejects.toMatchObject({ code: 'VOICE_FAILED' });
    await expect(service.speakQuestion('Why?', 'q1')).rejects.toMatchObject({ code: 'VOICE_LIMIT' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('replays cached audio after the generation budget is exhausted', async () => {
    const fetcher = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'audio/mpeg' } }));
    const service = createVoiceService({ environment: () => ({ ...enabled, VIVACOACH_MAX_VOICE_CALLS: '1' }), fetcher });
    const first = await service.speakQuestion('Explain correlation.', 'q1');
    expect(service.getVoiceStatus().remainingVoiceCalls).toBe(0);
    await expect(service.speakQuestion('Explain correlation.', 'q1')).resolves.toEqual(first);
    await expect(service.speakQuestion('Explain causation.', 'q2')).rejects.toMatchObject({ code: 'VOICE_LIMIT' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('rejects an oversized streamed response without caching it or exposing the provider body', async () => {
    let cancelled = false;
    const fetcher = vi.fn(async () => new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(2 * 1024 * 1024 + 1)); },
      cancel() { cancelled = true; },
    }), { headers: { 'Content-Type': 'audio/mpeg' } }));
    const service = createVoiceService({ environment: () => enabled, fetcher });
    await expect(service.speakQuestion('Why?', 'q1')).rejects.toMatchObject({ code: 'VOICE_FAILED' });
    expect(cancelled).toBe(true);
    await expect(service.speakQuestion('Why?', 'q1')).rejects.toMatchObject({ code: 'VOICE_FAILED' });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(service.getVoiceStatus().remainingVoiceCalls).toBe(28);
  });
});
