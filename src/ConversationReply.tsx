import { useEffect, useMemo, useRef } from 'react';
import { Square, Volume2 } from 'lucide-react';
import type { Feedback, PracticeSession, Question, ServerStatus } from '../shared/types';
import { getSpokenPrompt } from '../shared/conversation';
import { Spinner } from './components';
import { useQuestionVoice } from './voice';
import './conversation.css';

export function ConversationReply({ text, feedback, final = false }: { text: string; feedback: Feedback; final?: boolean }) {
  const provenance = feedback.source === 'demo' ? 'Authored demo response'
    : feedback.source === 'fallback' ? 'Fallback response'
    : feedback.reviewStatus === 'checked' ? 'Evidence checked'
    : feedback.reviewStatus === 'needs-review' ? 'Needs review' : 'Evidence check unavailable';
  return <section className="conversation-reply" aria-label="Coach response">
    <div className="conversation-reply__heading"><span className="eyebrow">{final ? 'A response to your final answer' : 'Coach response'}</span><span>{provenance}</span></div>
    <p>{text}</p>
  </section>;
}

interface CompletedReplyPlaybackProps {
  session: PracticeSession;
  status: ServerStatus | null;
  voiceEnabled: boolean;
  voicePaused: boolean;
}

/** A closing response only: this component never acquires a microphone. */
export function CompletedReplyPlayback({ session, status, voiceEnabled, voicePaused }: CompletedReplyPlaybackProps) {
  const prompt = getSpokenPrompt(session);
  const lastTurn = session.turns.at(-1);
  const question: Question | null = useMemo(() => prompt && lastTurn ? {
    ...lastTurn.question, id: prompt.id, text: prompt.text,
  } : null, [prompt?.id, prompt?.text, lastTurn?.question]);
  const voice = useQuestionVoice(session.id, question, session.mode, status, prompt?.text);
  const attempted = useRef(false);
  const epoch = useRef(0);
  const mayAutoplay = session.phase === 'complete' && session.mode === 'live'
    && session.totalQuestions === 6 && session.turns.length === 6 && voiceEnabled && !voicePaused;

  useEffect(() => {
    if (!mayAutoplay || !prompt) {
      attempted.current = false;
      epoch.current += 1;
      voice.stop();
      return;
    }
    const currentEpoch = ++epoch.current;
    // Avoid a provider request from a discarded StrictMode effect.
    queueMicrotask(() => {
      if (epoch.current !== currentEpoch || attempted.current) return;
      attempted.current = true;
      void voice.play();
    });
    return () => { epoch.current += 1; attempted.current = false; voice.stop(); };
  }, [mayAutoplay, voiceEnabled, voicePaused, prompt?.id, prompt?.text, voice.play, voice.stop]);

  if (!prompt || !lastTurn) return null;
  const closing = prompt.reply && prompt.text.startsWith(prompt.reply) ? prompt.text.slice(prompt.reply.length).trim() : prompt.text;
  return <div className="completed-reply">
    {prompt.reply && <ConversationReply text={prompt.reply} feedback={lastTurn.feedback} final />}
    <div className="completed-reply__playback" role="group" aria-label="Final response playback">
      <button type="button" className="text-button" onClick={() => void voice.speak()}>
        {voice.state === 'loading' ? <Spinner size={15} /> : voice.state === 'playing' ? <Square size={13} /> : <Volume2 size={16} />}
        {voice.state === 'loading' ? 'Cancel playback' : voice.state === 'playing' ? 'Stop final response audio' : 'Hear final response'}
      </button>
      <span aria-live="polite">{voice.sourceLabel}</span>
    </div>
    {voice.notice && <p className="voice-notice" role="status">{voice.notice}</p>}
    <p className="completed-reply__closing">{closing}</p>
  </div>;
}
