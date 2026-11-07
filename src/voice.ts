import { useCallback, useEffect, useRef, useState } from 'react';
import type { Question, ServerStatus } from '../shared/types';
import { api } from './api';

export function useMicrophone(onRecorded: (audio: Blob) => void) {
  const [recording, setRecording] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [duration, setDuration] = useState(0);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const context = useRef<AudioContext | null>(null);
  const frame = useRef<number>(0);
  const timer = useRef<number>(0);
  const alive = useRef(true);
  const cancelled = useRef(false);
  const callback = useRef(onRecorded);
  callback.current = onRecorded;
  const release = useCallback(() => {
    window.clearInterval(timer.current); cancelAnimationFrame(frame.current);
    stream.current?.getTracks().forEach(track => track.stop()); stream.current = null;
    void context.current?.close().catch(() => {}); context.current = null;
    if (alive.current) { setRecording(false); setLevel(0); }
  }, []);
  const stop = useCallback(() => {
    if (recorder.current?.state === 'recording') recorder.current.stop();
  }, []);
  const cancel = useCallback(() => {
    cancelled.current = true;
    if (recorder.current?.state === 'recording') recorder.current.stop();
    release();
  }, [release]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; cancel(); }; }, [cancel]);
  const start = async () => {
    if (recording || requesting) return;
    setError(null); setRequesting(true); cancelled.current = false;
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw new Error('This browser can’t record audio here. You can type your answer below.');
      const input = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      if (!alive.current || cancelled.current) { input.getTracks().forEach(track => track.stop()); return; }
      stream.current = input;
      const mime = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find(type => MediaRecorder.isTypeSupported(type));
      const nextRecorder = new MediaRecorder(input, mime ? { mimeType: mime } : undefined);
      recorder.current = nextRecorder;
      const chunks: BlobPart[] = [];
      nextRecorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      nextRecorder.onstop = () => {
        const audio = new Blob(chunks, { type: nextRecorder.mimeType || mime || 'audio/webm' });
        release();
        if (alive.current && !cancelled.current && audio.size) callback.current(audio);
      };
      nextRecorder.onerror = () => { cancelled.current = true; release(); if (alive.current) setError('The recording was interrupted. Your typed answer is still here. Please try again.'); };
      const audioContext = new AudioContext(); context.current = audioContext;
      await audioContext.resume();
      const analyser = audioContext.createAnalyser(); analyser.fftSize = 256;
      audioContext.createMediaStreamSource(input).connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      let last = 0;
      const measure = (now: number) => {
        if (!alive.current || cancelled.current) return;
        if (now - last > 45) {
          analyser.getByteTimeDomainData(data);
          const rms = Math.sqrt(data.reduce((sum, value) => sum + ((value - 128) / 128) ** 2, 0) / data.length);
          setLevel(previous => previous * .35 + Math.min(1, rms * 5) * .65); last = now;
        }
        frame.current = requestAnimationFrame(measure);
      };
      nextRecorder.start(1000); setRecording(true); setDuration(0);
      const started = Date.now(); frame.current = requestAnimationFrame(measure);
      timer.current = window.setInterval(() => { const elapsed = Math.min(90, (Date.now() - started) / 1000); setDuration(elapsed); if (elapsed >= 90) stop(); }, 200);
    } catch (failure) {
      cancelled.current = true; release();
      if (alive.current) setError(failure instanceof DOMException && failure.name === 'NotAllowedError' ? 'Microphone access wasn’t allowed. You can enable it in your browser or type your answer below.' : failure instanceof DOMException && failure.name === 'NotFoundError' ? 'No microphone was found. You can type your answer below.' : failure instanceof Error ? failure.message : 'The microphone couldn’t start. You can still type your answer.');
    } finally { if (alive.current) setRequesting(false); }
  };
  return { recording, requesting, duration, level, error, start, stop, cancel };
}

export function useQuestionVoice(id: string, question: Question | null, mode: 'demo' | 'live', status: ServerStatus | null) {
  const [state, setState] = useState<'idle' | 'loading' | 'playing'>('idle');
  const [notice, setNotice] = useState<string | null>(null);
  const player = useRef<HTMLAudioElement | null>(null);
  const objectUrl = useRef<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const epoch = useRef(0);
  const stop = useCallback(() => {
    epoch.current += 1; controller.current?.abort(); controller.current = null;
    if (player.current) { player.current.pause(); player.current.src = ''; player.current = null; }
    if (objectUrl.current) { URL.revokeObjectURL(objectUrl.current); objectUrl.current = null; }
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    setState('idle');
  }, []);
  useEffect(() => { stop(); setNotice(null); return stop; }, [question?.id, stop]);
  const speak = async () => {
    if (!question) return;
    if (state !== 'idle') { stop(); return; }
    stop(); setNotice(null);
    const currentEpoch = epoch.current;
    let deviceStarted = false;
    const deviceVoice = () => {
      if (currentEpoch !== epoch.current || deviceStarted) return;
      deviceStarted = true;
      if (!('speechSynthesis' in window)) { setState('idle'); setNotice('Device voice isn’t available in this browser. The full question is shown above.'); return; }
      const utterance = new SpeechSynthesisUtterance(question.text);
      utterance.lang = 'en-GB'; utterance.rate = .94;
      const voice = window.speechSynthesis.getVoices().find(candidate => candidate.lang === 'en-GB');
      if (voice) utterance.voice = voice;
      utterance.onend = () => { if (currentEpoch === epoch.current) setState('idle'); };
      utterance.onerror = event => { if (currentEpoch === epoch.current) { setState('idle'); if (event.error !== 'canceled' && event.error !== 'interrupted') setNotice('The device voice couldn’t play. You can read the full question above.'); } };
      setState('playing'); window.speechSynthesis.speak(utterance);
    };
    if (mode === 'live' && status?.voiceProvider === 'elevenlabs' && status.remainingVoiceCalls > 0) {
      setState('loading'); controller.current = new AbortController();
      try {
        const audio = await api.questionAudio(id, question.id, controller.current.signal);
        if (currentEpoch !== epoch.current) return;
        const url = URL.createObjectURL(audio); objectUrl.current = url;
        const nextPlayer = new Audio(url); player.current = nextPlayer;
        nextPlayer.onended = () => { if (currentEpoch === epoch.current) { setState('idle'); if (objectUrl.current) URL.revokeObjectURL(objectUrl.current); objectUrl.current = null; } };
        nextPlayer.onerror = () => { if (currentEpoch === epoch.current) { setNotice('Recorded voice is unavailable. Using your device voice.'); deviceVoice(); } };
        await nextPlayer.play(); if (currentEpoch === epoch.current) setState('playing');
      } catch (failure) {
        if (currentEpoch === epoch.current && !(failure instanceof DOMException && failure.name === 'AbortError')) { setNotice('Recorded voice is unavailable. Using your device voice.'); deviceVoice(); }
      }
    } else deviceVoice();
  };
  return { state, notice, speak, stop };
}
