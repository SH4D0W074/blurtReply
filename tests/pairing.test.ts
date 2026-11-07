import { describe, expect, it } from 'vitest';
import { LESSONS, getLesson } from '../shared/lessons';
import { makePairings } from '../server/pairing';
import type { Analysis, Lesson, Participant, SubmittedResponse } from '../shared/types';

const sampling = getLesson('sampling')!;

function room(lesson: Lesson, fixtureIndexes = [0, 1, 2, 3, 4, 5]) {
  const participants: Participant[] = fixtureIndexes.map((fixtureIndex, index) => ({
    id: `p-${index}`, alias: lesson.demoResponses[fixtureIndex].alias,
    isDemo: true, joinedAt: `2026-11-07T12:00:0${index}.000Z`,
  }));
  const responses: SubmittedResponse[] = participants.map((participant, index) => {
    const fixture = lesson.demoResponses[fixtureIndexes[index]];
    const analysis: Analysis = {
      responseId: `r-${index}`, categoryId: fixture.categoryId,
      categoryLabel: lesson.categories.find((category) => category.id === fixture.categoryId)!.label,
      quote: fixture.quote, note: 'Authored demonstration fixture.', needsClarification: fixture.categoryId === 'unclear',
      probe: null, source: 'demo',
    };
    return { id: analysis.responseId, participantId: participant.id, stage: 'initial', choiceId: fixture.choiceId, reason: fixture.reason, submittedAt: participant.joinedAt, analysis };
  });
  return { participants, responses };
}

describe('deterministic, defensible peer suggestions', () => {
  it('prioritises an allowed contrast despite the same chosen answer', () => {
    const { participants, responses } = room(sampling);
    const pairings = makePairings(sampling, participants, responses);
    expect(pairings[0].kind).toBe('contrast');
    expect(pairings[0].participantIds).toEqual(['p-1', 'p-2']);
    expect(pairings[0].rationale).toContain('same answer');
    expect(pairings[0].prompt).toContain('sample means');
    expect(pairings).toHaveLength(3);
  });

  it('does not call different but compatible categories a contrast', () => {
    const stats = room(sampling, [0, 1]);
    expect(makePairings(sampling, stats.participants, stats.responses)[0].kind).toBe('compare');
    const physics = getLesson('motion')!;
    const motion = room(physics, [0, 1]);
    expect(makePairings(physics, motion.participants, motion.responses)[0].kind).toBe('compare');
  });

  it('does not manufacture contrast from missing, unclear, stale, fallback or ungrounded analysis', () => {
    for (const bad of ['missing', 'unclear', 'stale', 'fallback', 'snippet'] as const) {
      const { participants, responses } = room(sampling, [1, 2]);
      if (bad === 'missing') delete responses[1].analysis;
      else if (bad === 'unclear') responses[1].analysis!.categoryId = 'unclear';
      else if (bad === 'stale') responses[1].analysis!.responseId = 'old-response';
      else if (bad === 'fallback') responses[1].analysis!.source = 'fallback';
      else responses[1].analysis!.quote = 'reduces random error';
      const [pairing] = makePairings(sampling, participants, responses);
      expect(pairing.kind).toBe('compare');
      expect(pairing.rationale).toContain('No disagreement');
    }
  });

  it('uses only the lesson-authored allowed pairs in either direction', () => {
    for (const lesson of LESSONS) {
      for (let a = 0; a < lesson.demoResponses.length; a += 1) {
        for (let b = 0; b < lesson.demoResponses.length; b += 1) {
          const { participants, responses } = room(lesson, [a, b]);
          const [pairing] = makePairings(lesson, participants, responses);
          const left = responses[0].analysis!.categoryId;
          const right = responses[1].analysis!.categoryId;
          const allowed = lesson.contrastPairs.some(([x, y]) => (x === left && y === right) || (x === right && y === left));
          expect(pairing.kind === 'contrast').toBe(allowed);
        }
      }
    }
  });

  it('covers every initial respondent once, with triads for odd counts and a solo for one', () => {
    for (let count = 0; count <= 6; count += 1) {
      const { participants, responses } = room(sampling, Array.from({ length: count }, (_, index) => index));
      const pairings = makePairings(sampling, participants, responses);
      const allIds = pairings.flatMap((pairing) => pairing.participantIds);
      expect([...allIds].sort()).toEqual(participants.map((participant) => participant.id).sort());
      expect(new Set(allIds).size).toBe(count);
      if (count === 0) expect(pairings).toEqual([]);
      else if (count === 1) expect(pairings[0].kind).toBe('solo');
      else if (count % 2) expect(pairings.filter((pairing) => pairing.participantIds.length === 3)).toHaveLength(1);
      else expect(pairings.every((pairing) => pairing.participantIds.length === 2)).toBe(true);
    }
  });

  it('keeps triad explanations precise about which members suggest a contrast', () => {
    const { participants, responses } = room(sampling, [1, 2, 3]);
    const [pairing] = makePairings(sampling, participants, responses);
    expect(pairing.kind).toBe('contrast');
    expect(pairing.participantIds).toHaveLength(3);
    expect(pairing.rationale).toContain('does not imply all three disagree');
  });

  it('is stable under input reordering and does not mutate caller-owned arrays', () => {
    const { participants, responses } = room(sampling);
    const original = structuredClone({ participants, responses });
    const normal = makePairings(sampling, participants, responses);
    const reversed = makePairings(sampling, [...participants].reverse(), [...responses].reverse());
    expect(reversed).toEqual(normal);
    expect({ participants, responses }).toEqual(original);
  });

  it('ignores transfer-only, unanswered and orphan entries, and uses the newest initial response', () => {
    const { participants, responses } = room(sampling, [1, 2]);
    participants.push({ id: 'unanswered', alias: 'Guest', isDemo: false, joinedAt: '2026-11-07T12:10:00.000Z' });
    responses.push({ ...responses[0], id: 'transfer', participantId: 'unanswered', stage: 'transfer' });
    responses.push({ ...responses[0], id: 'orphan', participantId: 'missing-person' });
    responses.push({ ...responses[1], id: 'newest', reason: 'I am not sure.', submittedAt: '2026-11-07T12:20:00.000Z', analysis: undefined });
    const [pairing] = makePairings(sampling, participants, responses);
    expect(pairing.participantIds).toEqual(['p-0', 'p-1']);
    expect(pairing.kind).toBe('compare');
  });
});
