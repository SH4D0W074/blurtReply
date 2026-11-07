import { randomUUID } from 'node:crypto';
import type {
  AgentEvent, AgentReporter, CourseContent, CourseInput, Feedback, PracticeMode,
  PracticeReview, PracticeSession, Question, RecentPractice, Turn,
} from '../shared/types';
import { prepareCourse, reviewAnswer, createReview } from './agents';
import { getDemoAnswer, getSamples } from './courses';
import { HttpError } from './errors';
import { Store } from './store';

interface PracticeRow {
  id: string; owner_id: string; state_json: string; input_json: string;
  operation_kind: 'prepare' | 'answer' | 'review' | null; operation_token: string | null;
  updated_at: string;
}
interface AnswerRow {
  id: string; practice_id: string; idempotency_key: string; question_id: string;
  answer: string; question_json: string; status: 'pending' | 'complete'; created_at: string;
}
export interface PracticeOptions {
  prepareCourse?: typeof prepareCourse;
  reviewAnswer?: typeof reviewAnswer;
  createReview?: typeof createReview;
  prepareTimeoutMs?: number;
  answerTimeoutMs?: number;
  reviewTimeoutMs?: number;
}

const TOTAL_QUESTIONS = 6;
const now = () => new Date().toISOString();
const readState = (row: PracticeRow): PracticeSession => JSON.parse(row.state_json) as PracticeSession;

function limitedFeedback(note: string): Feedback {
  return {
    assessment: 'unclear', claimQuote: null, sourceId: null, sourceQuote: null,
    observation: note,
    followUp: 'Explain the idea again in your own words. Which part of your course material supports your explanation?',
    followUpKind: 'probe', source: 'fallback', reviewStatus: 'unavailable',
  };
}

function limitedReview(turns: Turn[], note: string): PracticeReview {
  return {
    strengths: [], revisit: [],
    nextSteps: turns.length ? turns.slice(0, 3).map(turn => ({
      text: `Compare your explanation of “${turn.question.text}” with the original course material.`,
      turnId: turn.id, sourceId: turn.feedback.sourceId,
    })) : [{ text: 'Start a new practice with this material when preparation is available.', turnId: null, sourceId: null }],
    source: 'fallback', note,
  };
}

async function bounded<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Agent deadline exceeded')), timeoutMs);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

export class PracticeService {
  private readonly prepare: typeof prepareCourse;
  private readonly examine: typeof reviewAnswer;
  private readonly coach: typeof createReview;
  private readonly jobs = new Set<Promise<void>>();

  constructor(readonly store: Store, private readonly options: PracticeOptions = {}) {
    this.prepare = options.prepareCourse ?? prepareCourse;
    this.examine = options.reviewAnswer ?? reviewAnswer;
    this.coach = options.createReview ?? createReview;
    this.recoverInterrupted();
  }

  private row(id: string): PracticeRow | undefined {
    return this.store.get<PracticeRow>('SELECT * FROM practices WHERE id = ?', id);
  }

  private owned(id: string, ownerId: string | null): PracticeRow {
    const row = this.row(id);
    if (!ownerId || !row || row.owner_id !== ownerId) {
      throw new HttpError(404, 'This practice is not available in this browser.', 'PRACTICE_NOT_FOUND');
    }
    return row;
  }

  private present(state: PracticeSession): PracticeSession {
    return { ...state, demoAnswer: state.mode === 'demo' && state.currentQuestion
      ? getDemoAnswer(state.course, state.currentQuestion) : null };
  }

  snapshot(id: string, ownerId: string | null): PracticeSession { return this.present(readState(this.owned(id, ownerId))); }

  recent(ownerId: string | null): RecentPractice[] {
    if (!ownerId) return [];
    return this.store.all<PracticeRow>('SELECT * FROM practices WHERE owner_id = ? ORDER BY updated_at DESC LIMIT 30', ownerId)
      .map(row => {
        const state = readState(row);
        return { id: state.id, title: state.course.title, mode: state.mode, phase: state.phase,
          turnCount: state.turns.length, totalQuestions: state.totalQuestions, updatedAt: state.updatedAt };
      });
  }

  private save(state: PracticeSession, operationKind: PracticeRow['operation_kind'], token: string | null) {
    state.updatedAt = now();
    state.version += 1;
    this.store.run('UPDATE practices SET state_json = ?, operation_kind = ?, operation_token = ?, updated_at = ? WHERE id = ?',
      JSON.stringify(state), operationKind, token, state.updatedAt, state.id);
  }

  private emit(id: string, token: string): AgentReporter {
    return event => {
      this.store.transaction(() => {
        const row = this.row(id);
        if (!row || row.operation_token !== token) return;
        const state = readState(row);
        const entry: AgentEvent = {
          id: randomUUID(), createdAt: now(), agent: event.agent, state: event.state,
          label: event.label.slice(0, 160), sourceIds: event.sourceIds.slice(0, 12),
          ...(event.detail ? { detail: event.detail.slice(0, 600) } : {}),
        };
        state.events = [...state.events, entry].slice(-120);
        this.save(state, row.operation_kind, token);
      });
    };
  }

  private launch(work: () => Promise<void>) {
    const job = Promise.resolve().then(work).catch(() => {
      // Never log source text, answers, model output, credentials, or provider errors.
      console.error('[blurtReply] Background work stopped; saved practice data remains available.');
    }).finally(() => { this.jobs.delete(job); });
    this.jobs.add(job);
  }

  /** Allows orderly test cleanup. Process shutdown keeps pending records for recovery instead of re-spending. */
  async idle() { await Promise.all([...this.jobs]); }

  create(ownerId: string, input: CourseInput, mode: PracticeMode): PracticeSession {
    const sample = input.sampleId ? getSamples().find(item => item.id === input.sampleId) : undefined;
    if (input.sampleId && !sample) throw new HttpError(400, 'Choose an available sample course.', 'INVALID_SAMPLE');
    const id = randomUUID();
    const token = randomUUID();
    const timestamp = now();
    const state: PracticeSession = {
      id, mode, phase: 'thinking', currentQuestion: null, turns: [], events: [], review: null,
      version: 1, totalQuestions: TOTAL_QUESTIONS, createdAt: timestamp, updatedAt: timestamp,
      pendingAnswer: null, message: 'Preparing three concepts from your course material.',
      course: {
        title: input.title || sample?.title || 'Your course revision', subject: sample?.subject || 'Course material',
        sourceName: input.sourceName || sample?.sourceName || 'Pasted course material',
        origin: sample ? 'sample' : input.origin ?? 'paste', concepts: [],
        excerpts: input.text ? [{ id: 'original-material', label: input.sourceName || 'Your course material', text: input.text }] : [],
      },
    };
    this.store.run(`INSERT INTO practices (id, owner_id, state_json, input_json, operation_kind, operation_token, updated_at)
      VALUES (?, ?, ?, ?, 'prepare', ?, ?)`, id, ownerId, JSON.stringify(state), JSON.stringify(input), token, timestamp);
    this.launch(() => this.preparePractice(id, token, input, mode));
    return this.present(state);
  }

  private async preparePractice(id: string, token: string, input: CourseInput, mode: PracticeMode) {
    const emit = this.emit(id, token);
    let course: CourseContent | undefined;
    try {
      const prepared: CourseContent = await bounded(this.prepare(input, mode, emit), this.options.prepareTimeoutMs ?? 35_000);
      if (prepared.concepts.length !== 3 || !prepared.excerpts.length
        || prepared.concepts.some(concept => !concept.openingQuestion.trim() || !concept.sourceQuote.trim()
          || !prepared.excerpts.some(source => source.id === concept.sourceId && source.text.includes(concept.sourceQuote)))) {
        throw new Error('Prepared course could not be verified');
      }
      course = prepared;
    } catch {
      course = undefined;
      emit({ agent: 'planner', state: 'failed', label: 'Course preparation unavailable',
        detail: 'Your original material is saved. No concepts or assessment have been invented.', sourceIds: [] });
    }
    this.store.transaction(() => {
      const row = this.row(id);
      if (!row || row.operation_token !== token) return;
      const state = readState(row);
      if (course) {
        state.course = course;
        state.currentQuestion = this.opening(course, 0);
        state.phase = 'ready';
        state.message = null;
      } else {
        state.phase = 'complete';
        state.message = 'Course preparation could not finish. Your original material is saved; start another practice to try again.';
        state.review = limitedReview([], state.message);
      }
      this.save(state, null, null);
    });
  }

  private opening(course: CourseContent, conceptIndex: number): Question {
    const concept = course.concepts[conceptIndex];
    return { id: randomUUID(), number: conceptIndex * 2 + 1, text: concept.openingQuestion, conceptId: concept.id, kind: 'explain' };
  }

  submit(id: string, ownerId: string | null, input: { questionId: string; answer: string; idempotencyKey: string }): PracticeSession {
    const result = this.store.transaction(() => {
      const row = this.owned(id, ownerId);
      const state = readState(row);
      const existing = this.store.get<AnswerRow>('SELECT * FROM answers WHERE practice_id = ? AND idempotency_key = ?', id, input.idempotencyKey);
      if (existing) {
        if (existing.question_id !== input.questionId || existing.answer !== input.answer) {
          throw new HttpError(409, 'This submission identifier was already used for a different answer.', 'IDEMPOTENCY_CONFLICT');
        }
        return { state, token: null, answer: null };
      }
      if (this.store.get('SELECT id FROM answers WHERE practice_id = ? AND question_id = ?', id, input.questionId)) {
        throw new HttpError(409, 'That answer is already saved. Refresh to continue the practice.', 'ALREADY_SUBMITTED');
      }
      if (state.phase !== 'ready' || !state.currentQuestion) {
        throw new HttpError(409, 'Wait for the current review to finish before submitting another answer.', 'PRACTICE_BUSY');
      }
      if (state.currentQuestion.id !== input.questionId) {
        throw new HttpError(409, 'The practice has moved to a different question. Refresh before answering.', 'STALE_QUESTION');
      }
      const token = randomUUID();
      const answer: AnswerRow = {
        id: randomUUID(), practice_id: id, idempotency_key: input.idempotencyKey, question_id: input.questionId,
        answer: input.answer, question_json: JSON.stringify(state.currentQuestion), status: 'pending', created_at: now(),
      };
      this.store.run(`INSERT INTO answers (id, practice_id, idempotency_key, question_id, answer, question_json, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`, answer.id, id, input.idempotencyKey, input.questionId, input.answer, answer.question_json, answer.created_at);
      state.phase = 'thinking'; state.pendingAnswer = input.answer; state.message = null;
      this.save(state, 'answer', token);
      return { state, token, answer };
    });
    if (result.token && result.answer) this.launch(() => this.reviewSubmission(id, result.token!, result.answer!));
    return this.present(result.state);
  }

  private async reviewSubmission(id: string, token: string, answer: AnswerRow) {
    const startingRow = this.row(id);
    if (!startingRow || startingRow.operation_token !== token) return;
    const starting = readState(startingRow);
    const question = JSON.parse(answer.question_json) as Question;
    const emit = this.emit(id, token);
    let feedback: Feedback;
    try {
      feedback = await bounded(this.examine(starting.course, question, answer.answer, starting.turns, starting.mode, emit),
        this.options.answerTimeoutMs ?? 70_000);
    } catch {
      feedback = limitedFeedback('Your answer is saved, but the agents could not review it. Compare it with the source before drawing a conclusion.');
      emit({ agent: 'verifier', state: 'failed', label: 'Answer retained without an assessment', sourceIds: [],
        detail: 'Review could not finish. No claim about understanding has been applied.' });
    }
    const reviewToken = this.store.transaction(() => {
      const row = this.row(id);
      if (!row || row.operation_token !== token) return null;
      const state = readState(row);
      this.appendTurn(state, answer, feedback);
      this.store.run("UPDATE answers SET status = 'complete' WHERE id = ?", answer.id);
      if (state.turns.length >= TOTAL_QUESTIONS) {
        const nextToken = randomUUID();
        state.phase = 'thinking'; state.currentQuestion = null;
        state.message = 'Preparing your evidence-linked revision review.';
        this.save(state, 'review', nextToken);
        return nextToken;
      }
      this.save(state, null, null);
      return null;
    });
    if (reviewToken) await this.finishReview(id, reviewToken);
  }

  private appendTurn(state: PracticeSession, answer: AnswerRow, feedback: Feedback) {
    const question = JSON.parse(answer.question_json) as Question;
    state.turns.push({ id: answer.id, question, answer: answer.answer, feedback, createdAt: answer.created_at });
    state.pendingAnswer = null;
    state.message = feedback.source === 'fallback' ? 'Your answer is saved. This feedback is a labelled fallback, not a completed AI assessment.' : null;
    state.phase = 'ready';
    if (state.turns.length >= TOTAL_QUESTIONS) state.currentQuestion = null;
    else if (state.turns.length % 2 === 1) {
      state.currentQuestion = { id: randomUUID(), number: state.turns.length + 1, conceptId: question.conceptId,
        kind: feedback.followUpKind, text: feedback.followUp };
    } else state.currentQuestion = this.opening(state.course, Math.floor(state.turns.length / 2));
  }

  finish(id: string, ownerId: string | null): PracticeSession {
    const result = this.store.transaction(() => {
      const row = this.owned(id, ownerId);
      const state = readState(row);
      if (state.phase === 'complete' || row.operation_kind === 'review') return { state, token: null };
      if (state.phase !== 'ready') throw new HttpError(409, 'Wait for the current agent work to finish before ending practice.', 'PRACTICE_BUSY');
      const token = randomUUID();
      state.phase = 'thinking'; state.currentQuestion = null;
      state.message = 'Preparing your review from the answers you completed.';
      this.save(state, 'review', token);
      return { state, token };
    });
    if (result.token) this.launch(() => this.finishReview(id, result.token!));
    return this.present(result.state);
  }

  private async finishReview(id: string, token: string) {
    const row = this.row(id);
    if (!row || row.operation_token !== token) return;
    const state = readState(row);
    const emit = this.emit(id, token);
    let review: PracticeReview;
    if (!state.turns.length) {
      review = limitedReview([], 'This practice ended before any answers were submitted. There is no evidence to assess.');
      emit({ agent: 'coach', state: 'limited', label: 'No completed answers to review', sourceIds: [] });
    } else {
      try {
        review = await bounded(this.coach(state.course, state.turns, state.mode, emit), this.options.reviewTimeoutMs ?? 35_000);
      } catch {
        review = limitedReview(state.turns, 'Your answers are saved. The revision coach could not finish, so these are source-comparison prompts rather than an AI assessment.');
        emit({ agent: 'coach', state: 'failed', label: 'Revision prompts preserved', sourceIds: [],
          detail: 'The coach could not finish. Review the saved answers and course material together.' });
      }
    }
    this.store.transaction(() => {
      const current = this.row(id);
      if (!current || current.operation_token !== token) return;
      const next = readState(current);
      next.review = review; next.phase = 'complete'; next.currentQuestion = null; next.pendingAnswer = null;
      next.message = review.source === 'fallback' ? review.note : null;
      this.save(next, null, null);
    });
  }

  private recoverInterrupted() {
    const interrupted = this.store.all<PracticeRow>('SELECT * FROM practices WHERE operation_token IS NOT NULL');
    for (const row of interrupted) this.store.transaction(() => {
      const state = readState(row);
      const detail = 'The local server restarted. Saved material and answers remain available; no paid request was retried automatically.';
      if (row.operation_kind === 'answer') {
        const answer = this.store.get<AnswerRow>("SELECT * FROM answers WHERE practice_id = ? AND status = 'pending' ORDER BY created_at LIMIT 1", row.id);
        if (answer) {
          this.appendTurn(state, answer, limitedFeedback('Review was interrupted by a server restart. This answer is saved without an assessment.'));
          this.store.run("UPDATE answers SET status = 'complete' WHERE id = ?", answer.id);
        }
        if (state.turns.length >= TOTAL_QUESTIONS || !answer) {
          state.phase = 'complete'; state.currentQuestion = null;
          state.review = limitedReview(state.turns, detail);
        }
      } else {
        state.phase = 'complete'; state.currentQuestion = null; state.pendingAnswer = null;
        state.review = limitedReview(state.turns, detail);
      }
      state.message = detail;
      state.events.push({ id: randomUUID(), createdAt: now(), agent: row.operation_kind === 'prepare' ? 'planner' : row.operation_kind === 'answer' ? 'verifier' : 'coach',
        state: 'limited', label: 'Recovered saved practice after restart', detail, sourceIds: [] });
      this.save(state, null, null);
    });
  }
}
