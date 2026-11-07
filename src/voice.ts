import { useCallback, useEffect, useRef, useState } from 'react';
import type { Question, ServerStatus } from '../shared/types';
import { api } from './api';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(settle => { resolve = settle; });
  return { promise, resolve, settled: false };
}

interface MicrophoneAttempt {
  phase: 'requesting' | 'recording' | 'stopping';
  cancelled: boolean;
  started: ReturnType<typeof deferred<boolean>>;
  stream: MediaStream | null;
  context: AudioContext | null;
  recorder: MediaRecorder | null;
  frame: number | null;
  timer: number | null;
}

export function useMicrophone(onRecorded: (audio: Blob) => void) {
  const [recording, setRecording] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [duration, setDuration] = useState(0);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const active = useRef<MicrophoneAttempt | null>(null);
  const alive = useRef(true);
  const callback = useRef(onRecorded);
  callback.current = onRecorded;

  const settleStart = useCallback((attempt: MicrophoneAttempt, began: boolean) => {
    if (attempt.started.settled) return;
    attempt.started.settled = true;
    attempt.started.resolve(began);
  }, []);
  const releaseCapture = useCallback((attempt: MicrophoneAttempt) => {
    if (attempt.timer !== null) window.clearInterval(attempt.timer);
    if (attempt.frame !== null) cancelAnimationFrame(attempt.frame);
    attempt.timer = null; attempt.frame = null;
    attempt.stream?.getTracks().forEach(track => track.stop()); attempt.stream = null;
    const context = attempt.context; attempt.context = null;
    if (context && context.state !== 'closed') void context.close().catch(() => {});
  }, []);
  const discardAttempt = useCallback((attempt: MicrophoneAttempt) => {
    attempt.cancelled = true;
    const recorder = attempt.recorder;
    if (recorder) {
      recorder.ondataavailable = null; recorder.onstop = null; recorder.onerror = null;
      if (recorder.state !== 'inactive') { try { recorder.stop(); } catch { /* Capture tracks are still released below. */ } }
    }
    releaseCapture(attempt);
    settleStart(attempt, false);
  }, [releaseCapture, settleStart]);
  const cancel = useCallback(() => {
    const attempt = active.current;
    // Invalidate before releasing resources: browser events may arrive during cleanup.
    active.current = null;
    if (attempt) discardAttempt(attempt);
    if (alive.current) { setRequesting(false); setRecording(false); setLevel(0); }
  }, [discardAttempt]);
  const stop = useCallback(() => {
    const attempt = active.current;
    if (!attempt) return;
    if (attempt.phase === 'requesting') { cancel(); return; }
    if (attempt.phase === 'stopping') return;
    attempt.phase = 'stopping';
    if (alive.current) { setRecording(false); setLevel(0); }
    try {
      if (attempt.recorder?.state === 'recording') attempt.recorder.stop();
      else {
        active.current = null; discardAttempt(attempt);
        if (alive.current) setError('The recording ended before audio could be saved. Please try again or type your answer.');
      }
    } catch {
      active.current = null; discardAttempt(attempt);
      if (alive.current) setError('The recording couldn’t finish. Please try again or type your answer.');
    }
    // MediaRecorder keeps its queued final data event; no input track stays live while it flushes.
    releaseCapture(attempt);
  }, [cancel, discardAttempt, releaseCapture]);

  useEffect(() => { alive.current = true; return () => { alive.current = false; cancel(); }; }, [cancel]);

  const start = useCallback((): Promise<boolean> => {
    if (!alive.current) return Promise.resolve(false);
    const previous = active.current;
    if (previous) return previous.phase === 'stopping' ? Promise.resolve(false) : previous.started.promise;
    const attempt: MicrophoneAttempt = { phase: 'requesting', cancelled: false, started: deferred<boolean>(), stream: null, context: null, recorder: null, frame: null, timer: null };
    active.current = attempt;
    setError(null); setRequesting(true); setDuration(0); setLevel(0);
    const isCurrent = () => alive.current && active.current === attempt && !attempt.cancelled;
    const fail = (message: string) => {
      const current = isCurrent();
      if (active.current === attempt) active.current = null;
      discardAttempt(attempt);
      if (current) { setRequesting(false); setRecording(false); setLevel(0); setError(message); }
    };
    void (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw new Error('This browser can’t record audio here. You can type your answer below.');
        const input = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        attempt.stream = input;
        if (!isCurrent()) { discardAttempt(attempt); return; }
        const audioContext = new AudioContext(); attempt.context = audioContext;
        await audioContext.resume();
        // Permission and audio activation can each outlive a pause or a route change.
        if (!isCurrent()) { discardAttempt(attempt); return; }
        const analyser = audioContext.createAnalyser(); analyser.fftSize = 256;
        audioContext.createMediaStreamSource(input).connect(analyser);
        const data = new Uint8Array(analyser.fftSize);
        const mime = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find(type => MediaRecorder.isTypeSupported(type));
        const recorder = new MediaRecorder(input, mime ? { mimeType: mime } : undefined);
        attempt.recorder = recorder;
        const chunks: BlobPart[] = [];
        recorder.ondataavailable = event => { if (!attempt.cancelled && event.data.size) chunks.push(event.data); };
        recorder.onstop = () => {
          const deliver = isCurrent();
          if (active.current === attempt) active.current = null;
          recorder.ondataavailable = null; recorder.onstop = null; recorder.onerror = null;
          releaseCapture(attempt);
          if (!deliver) { settleStart(attempt, false); return; }
          setRequesting(false); setRecording(false); setLevel(0);
          const audio = new Blob(chunks, { type: recorder.mimeType || mime || 'audio/webm' });
          if (audio.size) callback.current(audio);
          else setError('No audio was captured. Please try again or type your answer.');
        };
        recorder.onerror = () => fail('The recording was interrupted. Your typed answer is still here. Please try again.');
        recorder.start(1000);
        attempt.phase = 'recording';
        setRecording(true); setRequesting(false);
        settleStart(attempt, true);
        let last = 0;
        const measure = (now: number) => {
          if (!isCurrent() || attempt.phase !== 'recording') return;
          if (now - last > 45) {
            analyser.getByteTimeDomainData(data);
            const rms = Math.sqrt(data.reduce((sum, value) => sum + ((value - 128) / 128) ** 2, 0) / data.length);
            setLevel(previousLevel => previousLevel * .35 + Math.min(1, rms * 5) * .65); last = now;
          }
          attempt.frame = requestAnimationFrame(measure);
        };
        const started = Date.now(); attempt.frame = requestAnimationFrame(measure);
        attempt.timer = window.setInterval(() => {
          if (!isCurrent() || attempt.phase !== 'recording') return;
          const elapsed = Math.min(90, (Date.now() - started) / 1000);
          setDuration(elapsed); if (elapsed >= 90) stop();
        }, 200);
      } catch (failure) {
        fail(failure instanceof DOMException && failure.name === 'NotAllowedError' ? 'Microphone access wasn’t allowed. You can enable it in your browser or type your answer below.' : failure instanceof DOMException && failure.name === 'NotFoundError' ? 'No microphone was found. You can type your answer below.' : failure instanceof Error ? failure.message : 'The microphone couldn’t start. You can still type your answer.');
      }
    })();
    return attempt.started.promise;
  }, [discardAttempt, releaseCapture, settleStart, stop]);
  return { recording, requesting, duration, level, error, start, stop, cancel };
}

type PlaybackResult = 'ended' | 'cancelled' | 'unavailable';
type PlaybackSource = 'elevenlabs' | 'device' | 'device-fallback' | 'unavailable' | null;
interface PlaybackAttempt {
  key: string;
  completion: ReturnType<typeof deferred<PlaybackResult>>;
  controller: AbortController | null;
  player: HTMLAudioElement | null;
  objectUrl: string | null;
  utterance: SpeechSynthesisUtterance | null;
  deviceStarted: boolean;
}

export function useQuestionVoice(id: string, question: Question | null, mode: 'demo' | 'live', status: ServerStatus | null) {
  const [state, setState] = useState<'idle' | 'loading' | 'playing'>('idle');
  const [source, setSource] = useState<PlaybackSource>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const active = useRef<PlaybackAttempt | null>(null);
  const alive = useRef(true);
  const input = useRef({ id, question, mode, status });
  input.current = { id, question, mode, status };
  const releasePlayer = useCallback((attempt: PlaybackAttempt) => {
    const player = attempt.player; attempt.player = null;
    if (player) {
      player.onended = null; player.onerror = null;
      player.pause(); player.src = '';
    }
    if (attempt.objectUrl) URL.revokeObjectURL(attempt.objectUrl);
    attempt.objectUrl = null;
  }, []);
  const settle = useCallback((attempt: PlaybackAttempt, result: PlaybackResult) => {
    if (attempt.completion.settled) return;
    attempt.completion.settled = true;
    const current = active.current === attempt;
    if (current) active.current = null;
    attempt.controller?.abort(); attempt.controller = null;
    releasePlayer(attempt);
    if (attempt.utterance) {
      attempt.utterance.onend = null; attempt.utterance.onerror = null; attempt.utterance.onstart = null;
      attempt.utterance = null;
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    }
    if (current && alive.current) setState('idle');
    attempt.completion.resolve(result);
  }, [releasePlayer]);
  const stop = useCallback(() => {
    const attempt = active.current;
    if (attempt) settle(attempt, 'cancelled');
    else if (alive.current) setState('idle');
  }, [settle]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; stop(); }; }, [stop]);
  useEffect(() => { stop(); setSource(null); setNotice(null); }, [id, question?.id, question?.text, mode, stop]);

  const play = useCallback((): Promise<PlaybackResult> => {
    if (!alive.current) return Promise.resolve('cancelled');
    const { id: practiceId, question: currentQuestion, mode: currentMode, status: currentStatus } = input.current;
    if (!currentQuestion) return Promise.resolve('unavailable');
    const key = `${practiceId}:${currentQuestion.id}:${currentMode}`;
    if (active.current?.key === key) return active.current.completion.promise;
    stop();
    const attempt: PlaybackAttempt = { key, completion: deferred<PlaybackResult>(), controller: null, player: null, objectUrl: null, utterance: null, deviceStarted: false };
    active.current = attempt;
    setNotice(null); setState('loading');
    const useElevenLabs = currentMode === 'live' && currentStatus?.voiceProvider === 'elevenlabs';
    const isCurrent = () => alive.current && active.current === attempt && !attempt.completion.settled;
    const deviceVoice = () => {
      if (!isCurrent() || attempt.deviceStarted) return;
      attempt.deviceStarted = true;
      releasePlayer(attempt);
      if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') {
        setSource('unavailable');
        setNotice(useElevenLabs ? 'ElevenLabs audio is unavailable, and this browser has no device voice. You can read the full question above.' : 'Device voice isn’t available in this browser. The full question is shown above.');
        settle(attempt, 'unavailable'); return;
      }
      try {
        const utterance = new SpeechSynthesisUtterance(currentQuestion.text); attempt.utterance = utterance;
        utterance.lang = 'en-GB'; utterance.rate = .94;
        const voice = window.speechSynthesis.getVoices().find(candidate => candidate.lang === 'en-GB');
        if (voice) utterance.voice = voice;
        utterance.onend = () => { if (isCurrent()) settle(attempt, 'ended'); };
        utterance.onerror = event => {
          if (!isCurrent()) return;
          if (event.error === 'canceled' || event.error === 'interrupted') settle(attempt, 'cancelled');
          else {
            setSource('unavailable'); setNotice('The device voice couldn’t play. You can read the full question above.');
            settle(attempt, 'unavailable');
          }
        };
        setSource(useElevenLabs ? 'device-fallback' : 'device');
        setState('playing');
        window.speechSynthesis.speak(utterance);
      } catch {
        if (!isCurrent()) return;
        setSource('unavailable'); setNotice('The device voice couldn’t play. You can read the full question above.');
        settle(attempt, 'unavailable');
      }
    };
    if (useElevenLabs) {
      // Cached audio can still be replayed after the generation budget is exhausted.
      setSource('elevenlabs'); attempt.controller = new AbortController();
      void (async () => {
        try {
          const audio = await api.questionAudio(practiceId, currentQuestion.id, attempt.controller!.signal);
          if (!isCurrent()) return;
          const url = URL.createObjectURL(audio); attempt.objectUrl = url;
          const player = new Audio(url); attempt.player = player;
          player.onended = () => { if (isCurrent() && !attempt.deviceStarted) settle(attempt, 'ended'); };
          player.onerror = () => {
            if (!isCurrent() || attempt.deviceStarted) return;
            setNotice('ElevenLabs audio couldn’t play. Using your device voice.'); deviceVoice();
          };
          await player.play();
          if (isCurrent() && !attempt.deviceStarted) { setSource('elevenlabs'); setState('playing'); }
        } catch (failure) {
          if (!isCurrent() || attempt.deviceStarted) return;
          if (failure instanceof DOMException && failure.name === 'AbortError') settle(attempt, 'cancelled');
          else { setNotice('ElevenLabs audio is unavailable. Using your device voice.'); deviceVoice(); }
        }
      })();
    } else deviceVoice();
    return attempt.completion.promise;
  }, [releasePlayer, settle, stop]);
  const speak = useCallback((): Promise<PlaybackResult> => {
    if (active.current) { stop(); return Promise.resolve('cancelled'); }
    return play();
  }, [play, stop]);
  const sourceLabel = source === 'device-fallback' ? 'Device voice · fallback' : source === 'device' ? 'Device voice' : source === 'unavailable' ? 'Audio unavailable' : source === 'elevenlabs' || mode === 'live' && status?.voiceProvider === 'elevenlabs' ? 'ElevenLabs voice' : mode === 'live' && !status ? 'Checking voice…' : 'Device voice';
  return { state, sourceLabel, notice, play, speak, stop };
}
