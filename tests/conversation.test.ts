import { describe, expect, it } from 'vitest';
import { getSpokenPrompt } from '../shared/conversation';
import type { PracticeSession } from '../shared/types';

function practice(): PracticeSession {
  return {
    id: 'practice', mode: 'live', phase: 'ready', currentQuestion: { id: 'question-2', number: 2, text: 'What does a larger sample change?', conceptId: 'sampling', kind: 'probe' },
    course: { title: 'Statistics', subject: 'Statistics', sourceName: 'Notes', origin: 'paste', excerpts: [], concepts: [] },
    turns: [{ id: 'turn-1', question: { id: 'question-1', number: 1, text: 'Explain sampling.', conceptId: 'sampling', kind: 'explain' }, answer: 'I don’t know.',
      feedback: { assessment: 'unclear', observation: 'Your answer does not yet explain sampling.', followUp: 'What does a larger sample change?', followUpKind: 'probe', claimQuote: null, sourceId: null, sourceQuote: null, source: 'ai', reviewStatus: 'checked' }, createdAt: '' }],
    events: [], review: null, version: 1, totalQuestions: 6, createdAt: '', updatedAt: '', pendingAnswer: null, message: null,
  };
}

describe('saved conversation speech', () => {
  it('keeps existing practices readable and gives new conversational replies precedence', () => {
    const session = practice();
    expect(getSpokenPrompt(session)?.text).toBe('Your answer does not yet explain sampling.\n\nWhat does a larger sample change?');
    session.turns[0].feedback.reply = 'Let’s start with one idea: a larger sample can reduce sampling variation.';
    expect(getSpokenPrompt(session)?.text).toBe('Let’s start with one idea: a larger sample can reduce sampling variation.\n\nWhat does a larger sample change?');
    session.turns = [];
    expect(getSpokenPrompt(session)).toEqual({ id: 'question-2', text: session.currentQuestion!.text, reply: null });
  });

  it('never exposes a pending answer or starts speech while feedback is still being checked', () => {
    const session = practice();
    session.phase = 'thinking'; session.pendingAnswer = 'An unreviewed answer.';
    expect(getSpokenPrompt(session)).toBeNull();
  });

  it('closes a completed conversation with the last saved reply and handles an empty finish', () => {
    const session = practice();
    session.phase = 'complete'; session.currentQuestion = null;
    expect(getSpokenPrompt(session)).toMatchObject({ id: 'question-1', reply: session.turns[0].feedback.observation });
    expect(getSpokenPrompt(session)?.text).toContain('Your review is ready below.');
    session.turns = [];
    expect(getSpokenPrompt(session)).toBeNull();
  });
});
