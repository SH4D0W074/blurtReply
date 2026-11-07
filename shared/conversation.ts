import type { PracticeSession } from './types';

export interface SpokenPrompt {
  id: string;
  text: string;
  reply: string | null;
}

/** One saved reply followed by one question; shared by server audio and device voice. */
export function getSpokenPrompt(session: PracticeSession): SpokenPrompt | null {
  if (session.phase === 'thinking') return null;
  const lastTurn = session.turns.at(-1);
  // Existing saved practices predate conversational replies, but their feedback remains readable.
  const reply = lastTurn ? (lastTurn.feedback.reply?.trim() || lastTurn.feedback.observation.trim() || null) : null;
  if (session.phase === 'ready' && session.currentQuestion) {
    return {
      id: session.currentQuestion.id,
      text: [reply, session.currentQuestion.text].filter(Boolean).join('\n\n'),
      reply,
    };
  }
  if (session.phase === 'complete' && lastTurn && reply) {
    return {
      id: lastTurn.question.id,
      text: `${reply}\n\nThat’s our last answer for this session. Your review is ready below.`,
      reply,
    };
  }
  return null;
}
