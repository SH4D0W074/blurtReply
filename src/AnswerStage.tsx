import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowDown, ArrowRight, Mic, Play, Square, Type, Volume2 } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import type { PracticeSession, ServerStatus } from '../shared/types';
import { getSpokenPrompt } from '../shared/conversation';
import { api, errorMessage } from './api';
import { ErrorNotice, Spinner, VoiceForm } from './components';
import { submissionKey, useDraft } from './hooks';
import { useMicrophone, useQuestionVoice } from './voice';
import { ConversationReply } from './ConversationReply';
import './voice-session.css';

export interface AnswerStageProps {
  session: PracticeSession;
  status: ServerStatus | null;
  connected: boolean;
  accept: (next: PracticeSession) => void;
  notify: (message: string) => void;
  voiceEnabled: boolean;
  voicePaused: boolean;
  onVoiceEnabled: (enabled: boolean) => void;
  onVoicePaused: (paused: boolean) => void;
  onResumeBlockedChange: (blocked: boolean) => void;
}

type RecordingContext = { epoch: number; hadDraft: boolean };

export function AnswerStage({ session, status, connected, accept, notify, voiceEnabled, voicePaused, onVoiceEnabled, onVoicePaused, onResumeBlockedChange }: AnswerStageProps) {
  const question = session.currentQuestion!;
  const prompt = getSpokenPrompt(session);
  const previousTurn = session.turns.at(-1);
  const reduce = useReducedMotion();
  const [answer, setAnswer] = useDraft(`vivacoach:answer:${session.id}:${question.id}`, '');
  const [reviewTranscript, setReviewTranscript] = useDraft('vivacoach:review-transcript', false);
  const [pending, setPending] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [startingTurn, setStartingTurn] = useState(false);
  const [transcriptReady, setTranscriptReady] = useState(false);
  const [recordedAudio, setRecordedAudio] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const alive = useRef(true);
  const epoch = useRef(0);
  const attempted = useRef(false);
  const pendingRef = useRef(false);
  const transcribingRef = useRef(false);
  const startingRef = useRef(false);
  const answerRef = useRef(answer);
  const recordingContext = useRef<RecordingContext | null>(null);
  const previouslyPaused = useRef(voicePaused);
  const gate = useRef({ enabled: voiceEnabled, paused: voicePaused, connected, review: reviewTranscript });
  answerRef.current = answer;
  gate.current = { enabled: voiceEnabled, paused: voicePaused, connected, review: reviewTranscript };

  const voice = useQuestionVoice(session.id, question, session.mode, status, prompt?.text);
  const microphone = useMicrophone(audio => { void transcribe(audio); });
  const controls = useRef({ voice, microphone });
  controls.current = { voice, microphone };
  const canRecord = session.mode === 'live' && Boolean(status?.transcriptionAvailable && status.remainingTranscriptions > 0);

  const saveDraft = (value: string) => { answerRef.current = value; setAnswer(value); };
  const cancelTurn = () => {
    epoch.current += 1;
    attempted.current = false;
    startingRef.current = false;
    controls.current.voice.stop();
    controls.current.microphone.cancel();
    if (alive.current) setStartingTurn(false);
  };
  const pauseForTyping = () => {
    cancelTurn();
    if (gate.current.enabled) {
      gate.current.paused = true;
      onVoicePaused(true);
    }
  };

  async function sendAnswer(value: string, automatic = false, recordingEpoch?: number) {
    const text = value.trim();
    if (!text || text.length > 2500 || pendingRef.current || !gate.current.connected || !alive.current) return;
    if (automatic && (!gate.current.enabled || gate.current.paused || gate.current.review || recordingEpoch !== epoch.current)) return;
    pendingRef.current = true;
    setPending(true); setError(null);
    controls.current.voice.stop();
    try {
      const next = await api.answer(session.id, question.id, text, submissionKey(session.id, question.id, text));
      if (alive.current) accept(next);
    } catch (failure) {
      if (alive.current) {
        setError(errorMessage(failure));
        setTranscriptReady(true);
        // A failed send is reviewed manually; never silently retry it as another voice turn.
        epoch.current += 1;
      }
    } finally {
      pendingRef.current = false;
      if (alive.current) setPending(false);
    }
  }

  async function transcribe(audio: Blob, forceReview = false) {
    if (!alive.current || session.mode !== 'live' || transcribingRef.current || pendingRef.current) return;
    const context = recordingContext.current;
    transcribingRef.current = true;
    setTranscribing(true); setError(null); setRecordedAudio(audio);
    controls.current.voice.stop();
    try {
      const transcript = await api.transcribe(session.id, audio);
      if (!alive.current) return;
      const words = transcript.text.trim();
      if (!words) throw new Error('No words were found in that recording. Try again or type your answer.');
      const existing = answerRef.current;
      const nextAnswer = existing.trim() ? `${existing}\n\n${words}` : words;
      const autoSend = !forceReview && context !== null && context.epoch === epoch.current
        && !context.hadDraft && !existing.trim() && !gate.current.review
        && gate.current.enabled && !gate.current.paused && gate.current.connected
        && !controls.current.microphone.error && nextAnswer.length <= 2500;
      saveDraft(nextAnswer);
      setRecordedAudio(null);
      setTranscriptReady(true);
      transcribingRef.current = false;
      setTranscribing(false);
      if (autoSend) {
        await sendAnswer(nextAnswer, true, context.epoch);
      } else {
        notify('Transcript saved. Review the wording, then submit your answer.');
        if (nextAnswer.length > 2500) setError('Your transcript is saved. Shorten it to 2,500 characters before sending.');
        textarea.current?.focus();
      }
    } catch (failure) {
      if (alive.current) {
        setError(errorMessage(failure));
        epoch.current += 1;
      }
    } finally {
      transcribingRef.current = false;
      if (alive.current) setTranscribing(false);
    }
  }

  async function beginVoiceTurn(explicit = false) {
    if (session.mode !== 'live' || !canRecord || !gate.current.connected || !gate.current.enabled || gate.current.paused
      || pendingRef.current || transcribingRef.current || startingRef.current || controls.current.microphone.recording
      || (!explicit && answerRef.current.trim())) return;
    const currentEpoch = ++epoch.current;
    attempted.current = true;
    startingRef.current = true;
    setStartingTurn(true); setError(null); setTranscriptReady(false);
    recordingContext.current = { epoch: currentEpoch, hadDraft: Boolean(answerRef.current.trim()) };
    const current = () => alive.current && epoch.current === currentEpoch && gate.current.enabled && !gate.current.paused && gate.current.connected;
    try {
      const result = await controls.current.voice.play();
      if (!current()) return;
      if (result !== 'ended') {
        gate.current.paused = true;
        onVoicePaused(true);
        return;
      }
      const started = await controls.current.microphone.start();
      if (!current()) return;
      if (!started) {
        gate.current.paused = true;
        onVoicePaused(true);
      }
    } catch {
      if (current()) {
        setError('Voice could not start. You can read the question and type your answer below.');
        gate.current.paused = true;
        onVoicePaused(true);
      }
    } finally {
      if (alive.current && epoch.current === currentEpoch) {
        startingRef.current = false;
        setStartingTurn(false);
      }
    }
  }

  const flow = useRef({ beginVoiceTurn, cancelTurn });
  flow.current = { beginVoiceTurn, cancelTurn };
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; flow.current.cancelTurn(); };
  }, []);
  useEffect(() => {
    onResumeBlockedChange(transcribing || pending || Boolean(recordedAudio) || !canRecord);
    return () => onResumeBlockedChange(false);
  }, [transcribing, pending, recordedAudio, canRecord, onResumeBlockedChange]);
  useEffect(() => {
    // A toolbar Resume is an explicit action, unlike an automatic question remount.
    const explicitResume = voiceEnabled && previouslyPaused.current && !voicePaused;
    previouslyPaused.current = voicePaused;
    if (session.mode !== 'live' || !voiceEnabled || voicePaused || !connected) {
      flow.current.cancelTurn();
      return;
    }
    if (!attempted.current && (explicitResume || !answerRef.current.trim()) && !transcribingRef.current && !pendingRef.current && canRecord) {
      const scheduledEpoch = epoch.current;
      // Let a discarded StrictMode effect clean up before making an audio request.
      // Explicit user starts remain immediate; only question-remount starts are deferred.
      queueMicrotask(() => {
        if (alive.current && scheduledEpoch === epoch.current && !attempted.current
          && gate.current.enabled && !gate.current.paused && gate.current.connected
          && (explicitResume || !answerRef.current.trim()) && !transcribingRef.current && !pendingRef.current) {
          void flow.current.beginVoiceTurn(explicitResume);
        }
      });
    }
  }, [session.mode, voiceEnabled, voicePaused, connected, canRecord, transcribing, pending]);

  const startSession = () => {
    gate.current.enabled = true;
    gate.current.paused = false;
    onVoicePaused(false);
    onVoiceEnabled(true);
    void beginVoiceTurn(true);
  };
  const manualPlayback = () => {
    if (microphone.recording || microphone.requesting || transcribingRef.current || pendingRef.current) return;
    if (voiceEnabled && !voicePaused && voice.state !== 'idle') {
      pauseForTyping();
    } else void voice.speak();
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (microphone.recording || microphone.requesting || transcribingRef.current) return;
    void sendAnswer(answerRef.current);
  };
  const showTyping = () => {
    pauseForTyping();
    textarea.current?.focus();
    textarea.current?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'nearest' });
  };
  const concept = session.course.concepts.find(item => item.id === question.conceptId);
  const seconds = Math.floor(microphone.duration);
  const timer = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  const speaking = voice.state === 'playing';
  const opensMicrophoneNext = voiceEnabled && !voicePaused && startingTurn;
  const busy = pending || transcribing || microphone.requesting || startingTurn || microphone.recording;
  const stateLabel = pending ? 'Sending your answer' : transcribing ? 'Transcribing your answer' : microphone.recording ? 'Your turn'
    : microphone.requesting ? 'Waiting for your microphone' : speaking ? prompt?.reply ? 'Coach speaking' : 'Examiner speaking' : voice.state === 'loading' || startingTurn ? prompt?.reply ? 'Preparing response audio' : 'Preparing question audio'
    : voiceEnabled && voicePaused ? 'Voice session paused' : transcriptReady ? 'Review your transcript' : answer.trim() ? 'Your draft is here' : voiceEnabled ? 'Ready to continue' : 'Have a conversation';
  const stateDetail = pending ? 'Your explanation is being saved.' : transcribing ? voicePaused ? 'Your transcript is still being prepared. Resume becomes available when it is saved.' : 'You can pause or stop voice. The transcript will still be saved for review.'
    : microphone.recording ? `${timer} / 01:30 · Choose Done speaking when you are ready.`
    : microphone.requesting ? 'Allow microphone access in your browser, or type below.'
    : speaking ? opensMicrophoneNext ? prompt?.reply ? 'Listen to the response and next question. Your microphone opens when they finish.' : 'Your microphone opens after the question finishes.' : 'Listen, then type your answer below.'
    : voice.state === 'loading' || startingTurn ? opensMicrophoneNext ? 'Your microphone stays off until the response and question have finished.' : 'Loading audio. Your microphone is off.'
    : voiceEnabled && voicePaused ? recordedAudio ? 'Your recording is saved. Retry transcription or discard the audio below before resuming.' : answer.trim() ? 'Your draft stays here. Resume replays the prompt; any new speech is added for review.' : 'Resume to hear the prompt again, then continue speaking. Your microphone is off until then.'
    : transcriptReady ? 'Check the words below, then send your answer.'
    : answer.trim() ? 'Your saved draft stays here. A spoken answer will be added for review.'
    : 'Hear each question, then explain it in your own words.';

  return <section className={`answer-stage voice-answer-stage ${session.mode === 'demo' ? 'voice-answer-stage--demo' : ''}`}>
    {prompt?.reply && previousTurn && <ConversationReply text={prompt.reply} feedback={previousTurn.feedback} />}
    <div className="question-overline"><span className="eyebrow">{question.kind === 'explain' ? 'Explain it in your words' : question.kind === 'transfer' ? 'Try it in a new situation' : 'Let’s look a little closer'}</span><span>{concept?.title}</span></div>
    <AnimatePresence mode="wait"><motion.h1 key={question.id} initial={reduce ? false : { opacity: 0, y: 9 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: reduce ? 1 : 0 }} transition={{ duration: reduce ? 0 : .25 }}>{question.text}</motion.h1></AnimatePresence>
    <div className="question-playback"><button type="button" className="text-button" onClick={manualPlayback} disabled={microphone.recording || microphone.requesting || pending || transcribing}>{voice.state === 'loading' ? <Spinner size={15} /> : speaking ? <Square size={13} /> : <Volume2 size={16} />}{voice.state === 'loading' ? 'Cancel playback' : speaking ? prompt?.reply ? 'Stop response audio' : 'Stop question audio' : prompt?.reply ? 'Hear response and question' : 'Hear the question'}</button><span aria-live="polite">{voice.sourceLabel}</span></div>
    {voice.notice && <p className="voice-notice" role="status">{voice.notice}</p>}

    {session.mode === 'live' && <div className={`voice-session ${microphone.recording ? 'voice-session--listening' : ''} ${voiceEnabled && voicePaused ? 'voice-session--paused' : ''}`} role="group" aria-label="Voice session">
      <div className="voice-session__body"><div className="voice-session__form"><VoiceForm level={microphone.level} recording={microphone.recording} /></div><div className="voice-session__copy"><div className="voice-session__state" role="status" aria-live="polite">{(transcribing || microphone.requesting || voice.state === 'loading' || pending) && <Spinner size={15} />}<h2>{stateLabel}</h2></div><p className={microphone.recording ? 'voice-session__timer' : ''}>{stateDetail}</p>
        <div className="voice-session__actions">
          {microphone.recording ? <button type="button" className="button button--accent voice-session__primary" onClick={() => microphone.stop()}><Square size={15} fill="currentColor" />Done speaking</button>
            : voiceEnabled && voicePaused ? <button type="button" className="button button--accent voice-session__primary voice-session__resume" disabled={!canRecord || !connected || busy || Boolean(recordedAudio)} onClick={startSession}><Play size={16} />Resume voice session</button>
            : !busy && <button type="button" className="button button--accent voice-session__primary" disabled={!canRecord || !connected || Boolean(recordedAudio)} onClick={startSession}>{voiceEnabled ? <Play size={16} /> : <Mic size={18} />}{voiceEnabled ? answer.trim() ? 'Add a spoken answer' : 'Continue voice session' : 'Start voice session'}</button>}
          {!pending && <button type="button" className="text-button voice-session__type" onClick={showTyping}><Type size={15} />{transcriptReady ? 'Edit transcript' : 'Type instead'}<ArrowDown size={12} /></button>}
        </div>
      </div></div>
      <div className="voice-session__preferences"><label className="voice-session__review"><input type="checkbox" checked={Boolean(reviewTranscript)} disabled={pending} onChange={event => { gate.current.review = event.target.checked; setReviewTranscript(event.target.checked); }} /><span>Review transcript before sending</span></label><p>{reviewTranscript ? 'After each question, your microphone opens. Done speaking creates an editable transcript.' : 'After each question, your microphone opens. Done speaking transcribes and sends your answer.'}</p></div>
      {!canRecord && <p className="voice-session__availability" role="status">{!status ? 'Checking voice availability… You can type below.' : 'Voice transcription is unavailable. Your typed answer works here.'}</p>}
    </div>}

    <ErrorNotice>{microphone.error}</ErrorNotice>
    <form className="answer-form" onSubmit={submit}>
      <div className="answer-form__heading"><label htmlFor="answer-text"><Type size={15} />Your answer</label>{session.mode === 'demo' && session.demoAnswer && <button type="button" className="example-answer-button" disabled={pending} onClick={() => { saveDraft(session.demoAnswer!); notify('Authored example added. You can edit it before submitting.'); textarea.current?.focus(); }}>Use example answer <ArrowDown size={13} /></button>}</div>
      <textarea ref={textarea} id="answer-text" value={answer} onChange={event => { saveDraft(event.target.value); pauseForTyping(); }} placeholder={session.mode === 'demo' ? 'Use the authored example above, or try your own explanation…' : 'Type your explanation here, or use the voice session above…'} rows={4} disabled={pending} maxLength={2500} aria-describedby="answer-help" />
      <div className="answer-form__meta" id="answer-help"><span>{answer ? 'Draft saved on this device' : session.mode === 'demo' ? 'The example follows an authored demo path.' : 'Typing is always available.'}</span><span className={answer.length > 2500 ? 'text-warning' : ''}>{answer.length.toLocaleString()} / 2,500</span></div>
      <ErrorNotice>{error}</ErrorNotice>
      {recordedAudio && !transcribing && <div className="transcription-retry"><button className="text-button" type="button" disabled={!connected || pending} onClick={() => void transcribe(recordedAudio, true)}>Try transcription again <ArrowRight size={14} /></button><button className="text-button" type="button" disabled={pending} onClick={() => { setRecordedAudio(null); setError(null); }}>Discard audio</button></div>}
      <div className="answer-submit"><p>{session.mode === 'demo' ? 'Guided demo. Example answers follow an authored path; your own wording receives a labelled fallback.' : 'Your explanation is checked against your course material. Open the source to review the feedback.'}</p><button className="button button--accent" type="submit" disabled={!answer.trim() || answer.length > 2500 || pending || transcribing || microphone.recording || microphone.requesting || !connected}>{pending ? <><Spinner />Saving your answer…</> : <>{question.number === session.totalQuestions ? 'Finish with this answer' : 'Submit answer'}<ArrowRight size={18} /></>}</button></div>
    </form>
  </section>;
}
