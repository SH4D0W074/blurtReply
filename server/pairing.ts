import type { Lesson, Pairing, Participant, SubmittedResponse } from '../shared/types';
import { isWholeResponseQuote } from './analysis';

interface Candidate { participant: Participant; response: SubmittedResponse; categoryId: string | null }

function lexical(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }

function allowedContrast(lesson: Lesson, a: Candidate, b: Candidate): boolean {
  if (!a.categoryId || !b.categoryId || a.categoryId === 'unclear' || b.categoryId === 'unclear') return false;
  return lesson.contrastPairs.some(([left, right]) =>
    (a.categoryId === left && b.categoryId === right) || (a.categoryId === right && b.categoryId === left));
}

function candidatesFor(lesson: Lesson, participants: Participant[], responses: SubmittedResponse[]): Candidate[] {
  const latestInitial = new Map<string, SubmittedResponse>();
  for (const response of [...responses].sort((a, b) => lexical(a.submittedAt, b.submittedAt) || lexical(a.id, b.id))) {
    if (response.stage === 'initial') latestInitial.set(response.participantId, response);
  }
  const uniqueParticipants = new Map(participants.map((participant) => [participant.id, participant]));
  return [...uniqueParticipants.values()]
    .sort((a, b) => lexical(a.joinedAt, b.joinedAt) || lexical(a.id, b.id))
    .flatMap((participant): Candidate[] => {
      const response = latestInitial.get(participant.id);
      if (!response) return [];
      const analysis = response.analysis;
      const validCategory = analysis && analysis.responseId === response.id && analysis.source !== 'fallback'
        && lesson.categories.some((category) => category.id === analysis.categoryId)
        && isWholeResponseQuote(response, analysis.quote);
      return [{ participant, response, categoryId: validCategory ? analysis.categoryId : null }];
    });
}

/** Deterministic suggestions: only authored contrast pairs count as contrasting claims.
 * Every participant with an initial response appears once. No mastery or conflict is inferred from different labels.
 */
export function makePairings(lesson: Lesson, participants: Participant[], responses: SubmittedResponse[]): Pairing[] {
  const candidates = candidatesFor(lesson, participants, responses);
  const remaining = new Set(candidates.map((candidate) => candidate.participant.id));
  const groups: { members: Candidate[]; kind: Pairing['kind'] }[] = [];

  const contrasts: { a: Candidate; b: Candidate; sameChoice: boolean; order: number }[] = [];
  for (let i = 0; i < candidates.length; i += 1) {
    for (let j = i + 1; j < candidates.length; j += 1) {
      if (allowedContrast(lesson, candidates[i], candidates[j])) {
        contrasts.push({ a: candidates[i], b: candidates[j], sameChoice: candidates[i].response.choiceId === candidates[j].response.choiceId, order: i * candidates.length + j });
      }
    }
  }
  contrasts.sort((a, b) => Number(b.sameChoice) - Number(a.sameChoice) || a.order - b.order);
  for (const { a, b } of contrasts) {
    if (!remaining.has(a.participant.id) || !remaining.has(b.participant.id)) continue;
    groups.push({ members: [a, b], kind: 'contrast' });
    remaining.delete(a.participant.id);
    remaining.delete(b.participant.id);
  }

  const rest = candidates.filter((candidate) => remaining.has(candidate.participant.id));
  for (let i = 0; i + 1 < rest.length; i += 2) {
    groups.push({ members: [rest[i], rest[i + 1]], kind: 'compare' });
  }
  if (rest.length % 2 === 1) {
    const last = rest[rest.length - 1];
    if (groups.length === 0) groups.push({ members: [last], kind: 'solo' });
    else {
      // Prefer a comparison group so a third member is not presented as taking either side of a contrast.
      const group = groups.find((candidate) => candidate.kind === 'compare') ?? groups[groups.length - 1];
      group.members.push(last);
    }
  }

  return groups.map(({ members, kind }, index): Pairing => {
    const triad = members.length === 3;
    const sameAnswer = members[0].response.choiceId === members[1]?.response.choiceId;
    const participantIds = members.map(({ participant }) => participant.id);
    const firstProbe = lesson.categories.find((category) => category.id === members[0].categoryId)?.probeId;
    const secondProbe = lesson.categories.find((category) => category.id === members[1]?.categoryId)?.probeId;
    const contrastProbe = kind === 'contrast' && firstProbe && firstProbe === secondProbe
      ? lesson.probes.find((probe) => probe.id === firstProbe)?.prompt
      : undefined;
    const intro = kind === 'solo'
      ? 'Work independently for now. Write one reason for your answer and one way to check it.'
      : triad
        ? 'Take turns explaining your reasoning. The third person checks the assumptions and summarises what is agreed.'
        : 'Take turns: explain your own reasoning, then restate your partner’s reasoning before responding.';
    return {
      id: `pair-${index + 1}-${participantIds.map(encodeURIComponent).join('-')}`,
      number: index + 1,
      participantIds,
      aliases: members.map(({ participant }) => participant.alias),
      prompt: `${intro} ${contrastProbe ? `${contrastProbe} Then explain whether this changes your reasoning on the original question.` : lesson.defaultDiscussionPrompt}`,
      rationale: kind === 'solo'
        ? 'One initial response is available. This is an individual reflection activity, not a peer comparison.'
        : kind === 'contrast'
          ? `${sameAnswer ? 'The first two participants chose the same answer, but their' : 'The first two participants’'} explanations contain an authored contrast worth checking.${triad ? ' The third participant is a discussion partner; this does not imply all three disagree.' : ''} Lecturer review is required.`
          : 'Compare explanations and assumptions. No disagreement or difference in understanding has been inferred.',
      kind,
    };
  });
}
