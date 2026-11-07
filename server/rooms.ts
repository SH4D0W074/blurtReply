import { randomBytes, randomUUID } from 'node:crypto';
import type {
  Analysis, AnswerCard, Lesson, Pairing, Participant, ResponseStage, ResultSummary,
  RoomAction, RoomMode, RoomPhase, RoomSnapshot, SubmittedResponse,
} from '../shared/types';
import { getLesson, toPublicLesson } from '../shared/lessons';
import { analyseResponses, getAnalysisStatus } from './analysis';
import { makePairings } from './pairing';
import { HttpError } from './errors';
import { Store } from './store';

type View = 'host' | 'board' | 'student';
interface RoomRow {
  code: string; owner_session_id: string; lesson_id: string; title: string; mode: RoomMode;
  phase: RoomPhase; version: number; created_at: string; revealed: number;
  ai_status: RoomSnapshot['aiStatus']; ai_message: string | null; analysis_token: string | null;
}
interface ParticipantRow {
  id: string; room_code: string; session_id: string | null; alias: string;
  is_demo: number; joined_at: string;
}
interface ResponseRow {
  id: string; room_code: string; participant_id: string; stage: ResponseStage;
  choice_id: string; reason: string; submitted_at: string;
  clarification: string | null; analysis_json: string | null;
}
export type Analyse = typeof analyseResponses;
export interface RoomServiceOptions { analyse?: Analyse; analysisTimeoutMs?: number }

const participantDTO = (row: ParticipantRow): Participant => ({
  id: row.id, alias: row.alias, isDemo: Boolean(row.is_demo), joinedAt: row.joined_at,
});
const responseDTO = (row: ResponseRow): SubmittedResponse => ({
  id: row.id, participantId: row.participant_id, stage: row.stage,
  choiceId: row.choice_id, reason: row.reason, submittedAt: row.submitted_at,
  ...(row.clarification ? { clarification: row.clarification } : {}),
  ...(row.analysis_json ? { analysis: JSON.parse(row.analysis_json) as Analysis } : {}),
});
const publishedPhases: RoomPhase[] = ['discussion', 'retest', 'results', 'closed'];

export class RoomService {
  private analyse: Analyse;
  private analysisTimeoutMs: number;

  constructor(readonly store: Store, options: RoomServiceOptions = {}) {
    this.analyse = options.analyse ?? analyseResponses;
    this.analysisTimeoutMs = options.analysisTimeoutMs ?? 32_000;
    // A process restart cannot resume an in-flight model request. Preserve the answers.
    store.run(`UPDATE rooms SET phase = 'review', version = version + 1,
      ai_status = 'failed', ai_message = ?, analysis_token = NULL WHERE phase = 'analysing'`,
    'The local server restarted during analysis. Your answers are saved; retry analysis or use simple comparison groups.');
  }

  private room(code: string): RoomRow {
    const room = this.store.get<RoomRow>('SELECT * FROM rooms WHERE code = ?', code.toUpperCase());
    if (!room) throw new HttpError(404, 'That room was not found. Check the six-character code.', 'ROOM_NOT_FOUND');
    return room;
  }

  private lesson(room: RoomRow): Lesson {
    const lesson = getLesson(room.lesson_id);
    if (!lesson) throw new HttpError(409, 'This room uses a lesson that is no longer available.', 'LESSON_UNAVAILABLE');
    return lesson;
  }

  private owner(room: RoomRow, sessionId: string) {
    if (room.owner_session_id !== sessionId) {
      throw new HttpError(403, 'Only the lecturer who created this room can control it.', 'HOST_REQUIRED');
    }
  }

  private requirePhase(room: RoomRow, allowed: RoomPhase[]) {
    if (!allowed.includes(room.phase)) {
      throw new HttpError(409, 'The room has moved on. Refresh to see the current activity.', 'WRONG_PHASE');
    }
  }

  private requireVersion(room: RoomRow, version?: number) {
    if (version !== undefined && room.version !== version) {
      throw new HttpError(409, 'The room changed in another tab. Refresh and try again.', 'STALE_VERSION');
    }
  }

  private participants(code: string): Participant[] {
    return this.store.all<ParticipantRow>('SELECT * FROM participants WHERE room_code = ? ORDER BY joined_at, id', code)
      .map(participantDTO);
  }

  private responses(code: string): SubmittedResponse[] {
    return this.store.all<ResponseRow>('SELECT * FROM responses WHERE room_code = ? ORDER BY submitted_at, id', code)
      .map(responseDTO);
  }

  private member(code: string, sessionId: string): ParticipantRow | undefined {
    return this.store.get<ParticipantRow>('SELECT * FROM participants WHERE room_code = ? AND session_id = ?', code, sessionId);
  }

  private requireMember(code: string, sessionId: string): ParticipantRow {
    const participant = this.member(code, sessionId);
    if (!participant) throw new HttpError(403, 'Join this room before responding.', 'JOIN_REQUIRED');
    return participant;
  }

  private savePairings(code: string, pairings: Pairing[]) {
    this.store.run('DELETE FROM pairings WHERE room_code = ?', code);
    for (const pairing of pairings) {
      this.store.run('INSERT INTO pairings (id, room_code, position, data_json) VALUES (?, ?, ?, ?)',
        pairing.id, code, pairing.number, JSON.stringify(pairing));
    }
  }

  private seedInitial(room: RoomRow) {
    const lesson = this.lesson(room);
    for (const fixture of lesson.demoResponses) {
      let participant = this.store.get<ParticipantRow>(
        'SELECT * FROM participants WHERE room_code = ? AND alias = ? AND is_demo = 1', room.code, fixture.alias,
      );
      if (!participant) {
        const id = randomUUID();
        this.store.run('INSERT INTO participants (id, room_code, session_id, alias, is_demo, joined_at) VALUES (?, ?, NULL, ?, 1, ?)',
          id, room.code, fixture.alias, new Date().toISOString());
        participant = this.store.get<ParticipantRow>('SELECT * FROM participants WHERE id = ?', id)!;
      }
      this.store.run(`INSERT OR IGNORE INTO responses
        (id, room_code, participant_id, stage, choice_id, reason, submitted_at) VALUES (?, ?, ?, 'initial', ?, ?, ?)`,
      randomUUID(), room.code, participant.id, fixture.choiceId, fixture.reason, new Date().toISOString());
    }
  }

  private seedTransfer(room: RoomRow) {
    const lesson = this.lesson(room);
    for (const fixture of lesson.demoResponses) {
      const participant = this.store.get<ParticipantRow>(
        'SELECT * FROM participants WHERE room_code = ? AND alias = ? AND is_demo = 1', room.code, fixture.alias,
      );
      if (!participant) continue;
      this.store.run(`INSERT OR IGNORE INTO responses
        (id, room_code, participant_id, stage, choice_id, reason, submitted_at) VALUES (?, ?, ?, 'transfer', ?, ?, ?)`,
      randomUUID(), room.code, participant.id, fixture.transferChoiceId, fixture.transferReason, new Date().toISOString());
    }
  }

  create(sessionId: string, input: { lessonId: string; mode: RoomMode; title?: string }): RoomSnapshot {
    const lesson = getLesson(input.lessonId);
    if (!lesson) throw new HttpError(400, 'Choose one of the available lessons.', 'INVALID_LESSON');
    const code = this.store.transaction(() => {
      let code: string;
      do {
        const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        code = [...randomBytes(6)].map(byte => alphabet[byte % alphabet.length]).join('');
      } while (this.store.get('SELECT code FROM rooms WHERE code = ?', code));
      const status = getAnalysisStatus();
      this.store.run(`INSERT INTO rooms
        (code, owner_session_id, lesson_id, title, mode, created_at, ai_status) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      code, sessionId, lesson.id, input.title?.trim() || lesson.title, input.mode, new Date().toISOString(),
      input.mode === 'demo' || (status.aiEnabled && status.aiConfigured) ? 'ready' : 'disabled');
      if (input.mode === 'demo') this.seedInitial(this.room(code));
      return code;
    });
    return this.snapshot(code, sessionId, 'host');
  }

  join(code: string, sessionId: string): RoomSnapshot {
    this.store.transaction(() => {
      const room = this.room(code);
      if (this.member(room.code, sessionId)) return;
      this.requirePhase(room, ['collecting']);
      const count = this.store.get<{ count: number }>('SELECT COUNT(*) AS count FROM participants WHERE room_code = ?', room.code)!.count;
      if (count >= 80) throw new HttpError(409, 'This local prototype supports up to 80 participants per room.', 'ROOM_FULL');
      const birds = ['Finch', 'Robin', 'Wren', 'Swift', 'Lark', 'Heron', 'Puffin', 'Kite'];
      let alias: string;
      do {
        const suffix = randomBytes(2).readUInt16BE() % 900 + 100;
        alias = `${birds[count % birds.length]} ${suffix}`;
      } while (this.store.get('SELECT id FROM participants WHERE room_code = ? AND alias = ?', room.code, alias));
      this.store.run('INSERT INTO participants (id, room_code, session_id, alias, is_demo, joined_at) VALUES (?, ?, ?, ?, 0, ?)',
        randomUUID(), room.code, sessionId, alias, new Date().toISOString());
    });
    return this.snapshot(code, sessionId, 'student');
  }

  submit(code: string, sessionId: string, input: { stage: ResponseStage; choiceId: string; reason: string }): RoomSnapshot {
    this.store.transaction(() => {
      const room = this.room(code);
      const participant = this.requireMember(room.code, sessionId);
      const reason = input.reason.trim();
      const existing = this.store.get<ResponseRow>(
        'SELECT * FROM responses WHERE participant_id = ? AND stage = ?', participant.id, input.stage,
      );
      // A network retry is safe even if the lecturer advanced after the first request.
      if (existing) {
        if (existing.choice_id === input.choiceId && existing.reason === reason) return;
        throw new HttpError(409, 'Your response is already submitted. It stays unchanged so the discussion has a stable starting point.', 'ALREADY_SUBMITTED');
      }
      this.requirePhase(room, input.stage === 'initial' ? ['collecting'] : ['retest']);
      if (input.stage === 'transfer' && !this.store.get(
        "SELECT id FROM responses WHERE participant_id = ? AND stage = 'initial'", participant.id,
      )) throw new HttpError(409, 'A first response is required before the transfer question.', 'INITIAL_REQUIRED');
      const question = input.stage === 'initial' ? this.lesson(room).initial : this.lesson(room).transfer;
      if (!question.options.some(option => option.id === input.choiceId)) {
        throw new HttpError(400, 'Choose one of the options in this question.', 'INVALID_CHOICE');
      }
      this.store.run(`INSERT INTO responses
        (id, room_code, participant_id, stage, choice_id, reason, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      randomUUID(), room.code, participant.id, input.stage, input.choiceId, reason, new Date().toISOString());
    });
    return this.snapshot(code, sessionId, 'student');
  }

  clarify(code: string, sessionId: string, text: string): RoomSnapshot {
    this.store.transaction(() => {
      const room = this.room(code);
      const participant = this.requireMember(room.code, sessionId);
      const response = this.store.get<ResponseRow>(
        "SELECT * FROM responses WHERE participant_id = ? AND stage = 'initial'", participant.id,
      );
      if (!response) throw new HttpError(409, 'Submit your first response before adding a clarification.', 'INITIAL_REQUIRED');
      const clarification = text.trim();
      if (response.clarification === clarification) return;
      this.requirePhase(room, ['review']);
      if (response.clarification) throw new HttpError(409, 'Your clarification is already saved.', 'ALREADY_CLARIFIED');
      const analysis = response.analysis_json ? JSON.parse(response.analysis_json) as Analysis : null;
      if (!analysis?.needsClarification) throw new HttpError(409, 'There is no clarification question for this response.', 'NO_PROBE');
      this.store.run('UPDATE responses SET clarification = ?, analysis_json = NULL WHERE id = ?', clarification, response.id);
      // New evidence invalidates unpublished suggestions, even after a host refresh.
      this.store.run('DELETE FROM pairings WHERE room_code = ?', room.code);
      this.store.run('UPDATE rooms SET version = version + 1, ai_message = ? WHERE code = ?',
        'A participant added a clarification. Review analysis again or make simple comparison groups before publishing.', room.code);
    });
    return this.snapshot(code, sessionId, 'student');
  }

  async action(code: string, sessionId: string, action: RoomAction, version?: number): Promise<RoomSnapshot> {
    if (action === 'analyse') return this.analyseRoom(code, sessionId, version);
    this.store.transaction(() => {
      const room = this.room(code);
      this.owner(room, sessionId);
      this.requireVersion(room, version);
      switch (action) {
        case 'reveal':
          this.requirePhase(room, ['collecting', 'review', 'discussion', 'retest', 'results']);
          if (room.revealed) return;
          this.store.run('UPDATE rooms SET revealed = 1, version = version + 1 WHERE code = ?', room.code);
          break;
        case 'fallback-pairs': {
          this.requirePhase(room, ['collecting', 'review']);
          const responses = this.responses(room.code).filter(response => response.stage === 'initial');
          if (!responses.length) throw new HttpError(409, 'Collect at least one response before making groups.', 'NO_RESPONSES');
          const withoutDiagnostics = responses.map(({ analysis: _analysis, ...response }) => response);
          this.savePairings(room.code, makePairings(this.lesson(room), this.participants(room.code), withoutDiagnostics));
          this.store.run(`UPDATE rooms SET phase = 'review', version = version + 1, analysis_token = NULL,
            ai_message = ? WHERE code = ?`,
          'These are simple comparison groups without AI interpretation. Inspect them before publishing.', room.code);
          break;
        }
        case 'publish-pairs':
          this.requirePhase(room, ['review']);
          if (!this.store.get('SELECT id FROM pairings WHERE room_code = ?', room.code)) {
            throw new HttpError(409, 'Analyse responses or make answer-based groups first.', 'NO_PAIRINGS');
          }
          this.store.run("UPDATE rooms SET phase = 'discussion', version = version + 1 WHERE code = ?", room.code);
          break;
        case 'start-retest':
          this.requirePhase(room, ['discussion']);
          if (room.mode === 'demo') this.seedTransfer(room);
          this.store.run("UPDATE rooms SET phase = 'retest', version = version + 1 WHERE code = ?", room.code);
          break;
        case 'show-results':
          this.requirePhase(room, ['retest']);
          this.store.run("UPDATE rooms SET phase = 'results', version = version + 1 WHERE code = ?", room.code);
          break;
        case 'close':
          if (room.phase === 'closed') return;
          this.store.run(`UPDATE rooms SET phase = 'closed', version = version + 1, analysis_token = NULL,
            ai_status = CASE WHEN ai_status = 'running' THEN 'failed' ELSE ai_status END,
            ai_message = CASE WHEN ai_status = 'running' THEN 'Analysis was stopped when the room closed.' ELSE ai_message END
            WHERE code = ?`, room.code);
          break;
        case 'restart-demo':
          if (room.mode !== 'demo') throw new HttpError(409, 'Only demonstration rooms can be reset.', 'DEMO_ONLY');
          this.store.run('DELETE FROM responses WHERE room_code = ?', room.code);
          this.store.run('DELETE FROM pairings WHERE room_code = ?', room.code);
          this.store.run(`UPDATE rooms SET phase = 'collecting', version = version + 1, revealed = 0,
            ai_status = 'ready', ai_message = NULL, analysis_token = NULL WHERE code = ?`, room.code);
          this.seedInitial(room);
          break;
      }
    });
    return this.snapshot(code, sessionId, 'host');
  }

  private async analyseRoom(code: string, sessionId: string, version?: number): Promise<RoomSnapshot> {
    const frozen = this.store.transaction(() => {
      const room = this.room(code);
      this.owner(room, sessionId);
      this.requireVersion(room, version);
      this.requirePhase(room, ['collecting', 'review']);
      const responses = this.responses(room.code).filter(response => response.stage === 'initial');
      if (!responses.length) throw new HttpError(409, 'Collect at least one response before analysis.', 'NO_RESPONSES');
      const token = randomUUID();
      this.store.run(`UPDATE rooms SET phase = 'analysing', version = version + 1,
        ai_status = 'running', ai_message = NULL, analysis_token = ? WHERE code = ?`, token, room.code);
      this.store.run('DELETE FROM pairings WHERE room_code = ?', room.code);
      this.store.run("UPDATE responses SET analysis_json = NULL WHERE room_code = ? AND stage = 'initial'", room.code);
      return { room, token, responses, participants: this.participants(room.code), lesson: this.lesson(room) };
    });
    let analyses: Analysis[] = [];
    let failed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      analyses = await Promise.race([
        this.analyse(frozen.lesson, frozen.responses, frozen.room.mode, {
          demoParticipantIds: frozen.participants.filter(participant => participant.isDemo).map(participant => participant.id),
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Analysis timed out')), this.analysisTimeoutMs);
        }),
      ]);
    } catch {
      failed = true;
    } finally {
      if (timer) clearTimeout(timer);
    }

    this.store.transaction(() => {
      const current = this.room(code);
      // Closing or resetting a room invalidates this work; late results cannot revive it.
      if (current.analysis_token !== frozen.token || current.phase !== 'analysing') return;
      const expectedIds = new Set(frozen.responses.map(response => response.id));
      for (const analysis of analyses) {
        if (!expectedIds.has(analysis.responseId)) continue;
        this.store.run('UPDATE responses SET analysis_json = ? WHERE id = ? AND room_code = ?',
          JSON.stringify(analysis), analysis.responseId, current.code);
      }
      const responses = this.responses(current.code).filter(response => response.stage === 'initial');
      this.savePairings(current.code, makePairings(frozen.lesson, frozen.participants, responses));
      const hasFallback = analyses.some(analysis => analysis.source === 'fallback');
      const hasDemo = analyses.some(analysis => analysis.source === 'demo');
      const hasLive = analyses.some(analysis => analysis.source === 'openai');
      const status = getAnalysisStatus();
      const aiStatus: RoomSnapshot['aiStatus'] = failed ? 'failed'
        : !hasLive && !hasDemo && (!status.aiEnabled || !status.aiConfigured) ? 'disabled'
        : hasFallback && !hasLive && !hasDemo ? 'failed' : 'complete';
      let message: string | null = null;
      if (failed) message = 'Analysis could not finish. Your answers are saved; simple comparison groups are available. You can retry.';
      else if (hasDemo && hasFallback) message = 'Authored analysis is shown only for labelled demo responses. Other responses have not been interpreted by AI.';
      else if (hasDemo) message = 'These are authored demonstration interpretations, not a live model result.';
      else if (aiStatus === 'disabled') message = 'Live AI is disabled or not configured. These are simple comparison groups without AI interpretation.';
      else if (hasFallback) message = 'Some explanations could not be interpreted reliably. Their uncertainty is preserved; review before publishing.';
      this.store.run(`UPDATE rooms SET phase = 'review', version = version + 1,
        ai_status = ?, ai_message = ?, analysis_token = NULL WHERE code = ?`, aiStatus, message, current.code);
    });
    return this.snapshot(code, sessionId, 'host');
  }

  private summary(lesson: Lesson, participants: Participant[], responses: SubmittedResponse[], includeReasons: boolean): ResultSummary {
    const initial = responses.filter(response => response.stage === 'initial');
    const transfer = responses.filter(response => response.stage === 'transfer');
    const initialByParticipant = new Map(initial.map(response => [response.participantId, response]));
    const participantById = new Map(participants.map(participant => [participant.id, participant]));
    const distribution = (items: SubmittedResponse[], options: { id: string }[]) => {
      const result: Record<string, number> = Object.fromEntries(options.map(option => [option.id, 0]));
      for (const item of items) result[item.choiceId] = (result[item.choiceId] ?? 0) + 1;
      return result;
    };
    const matched = transfer.filter(response => initialByParticipant.has(response.participantId));
    const demoCount = matched.filter(response => participantById.get(response.participantId)?.isDemo).length;
    return {
      initialTotal: initial.length, transferTotal: transfer.length,
      initialExpected: initial.filter(response => response.choiceId === lesson.initialExpectedChoiceId).length,
      transferExpected: transfer.filter(response => response.choiceId === lesson.transferExpectedChoiceId).length,
      matchedRespondents: matched.length,
      initialDistribution: distribution(initial, lesson.initial.options),
      transferDistribution: distribution(transfer, lesson.transfer.options),
      examples: includeReasons ? matched.slice(0, 8).map(response => ({
        alias: participantById.get(response.participantId)?.alias ?? 'Participant',
        before: initialByParticipant.get(response.participantId)!.reason,
        after: response.reason, isDemo: Boolean(participantById.get(response.participantId)?.isDemo),
      })) : [],
      explanation: `${matched.length} participant${matched.length === 1 ? '' : 's'} answered both questions${demoCount ? `, including ${demoCount} labelled demonstration entries` : ''}. `
        + 'The counts describe responses to two different questions. They do not establish mastery or prove that discussion caused learning.',
    };
  }

  snapshot(code: string, sessionId: string, view: View = 'student'): RoomSnapshot {
    const room = this.room(code);
    if (view === 'host') this.owner(room, sessionId);
    const isHost = view === 'host';
    const lesson = this.lesson(room);
    const participants = this.participants(room.code);
    const participantById = new Map(participants.map(participant => [participant.id, participant]));
    const responses = this.responses(room.code);
    const initial = responses.filter(response => response.stage === 'initial');
    const transfer = responses.filter(response => response.stage === 'transfer');
    const member = view === 'board' ? undefined : this.member(room.code, sessionId);
    const allPairings = this.store.all<{ data_json: string }>(
      'SELECT data_json FROM pairings WHERE room_code = ? ORDER BY position', room.code,
    ).map(row => JSON.parse(row.data_json) as Pairing);
    const published = publishedPhases.includes(room.phase);
    const publicPair = (pair: Pairing): Pairing => ({
      id: pair.id, number: pair.number, participantIds: pair.participantIds, aliases: pair.aliases,
      prompt: view === 'board' && !room.revealed ? lesson.defaultDiscussionPrompt : pair.prompt,
      rationale: '', kind: pair.kind === 'solo' ? 'solo' : 'compare',
    });
    const visiblePairs = isHost ? allPairings : !published ? []
      : view === 'student' ? allPairings.filter(pair => member && pair.participantIds.includes(member.id)).map(publicPair)
      : allPairings.map(publicPair);
    const cards: AnswerCard[] = initial.map(response => ({
      responseId: response.id, participantId: response.participantId,
      alias: participantById.get(response.participantId)?.alias ?? 'Participant',
      choiceId: response.choiceId, reason: isHost || room.revealed ? response.reason : null,
      isDemo: Boolean(participantById.get(response.participantId)?.isDemo),
      ...(isHost && response.analysis ? { analysis: response.analysis } : {}),
    }));
    const counts = new Map<string, number>();
    for (const response of initial) if (response.analysis) {
      counts.set(response.analysis.categoryId, (counts.get(response.analysis.categoryId) ?? 0) + 1);
    }
    return {
      code: room.code, title: room.title, mode: room.mode, phase: room.phase, version: room.version,
      createdAt: room.created_at, lesson: toPublicLesson(lesson), participantCount: participants.length,
      initialCount: initial.length, transferCount: transfer.length, revealed: Boolean(room.revealed),
      aiStatus: room.ai_status, aiMessage: room.ai_message, cards, pairings: visiblePairs,
      summary: room.phase === 'results' || (room.phase === 'closed' && transfer.length > 0)
        ? this.summary(lesson, participants, responses, isHost || Boolean(room.revealed)) : null,
      isHost,
      self: member ? {
        participant: participantDTO(member),
        initial: initial.find(response => response.participantId === member.id) ?? null,
        transfer: transfer.find(response => response.participantId === member.id) ?? null,
        pairing: published ? allPairings.filter(pair => pair.participantIds.includes(member.id)).map(publicPair)[0] ?? null : null,
      } : null,
      ...(isHost ? {
        host: {
          participants, responses,
          analysisCounts: [...counts].map(([categoryId, count]) => ({
            categoryId, label: lesson.categories.find(category => category.id === categoryId)?.label ?? 'Needs review', count,
          })),
        },
      } : {}),
    };
  }
}
