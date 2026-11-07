import { describe, expect, it } from 'vitest';
import type { Question } from '../shared/types';
import { authoredFeedback, getDemoAnswer, getDemoExamples, getSample, getSamples } from '../server/courses';

describe('authored course material', () => {
  it('offers two clearly attributed subjects with three source-grounded concepts each', () => {
    expect(getSamples().map((sample) => sample.id)).toEqual(['stats-causation', 'cell-biology']);
    for (const preview of getSamples()) {
      const course = getSample(preview.id)!;
      expect(course.sourceName).toContain('authored teaching notes');
      expect(course.sourceName).toContain('not a university handout');
      expect(course.concepts).toHaveLength(3);
      expect(preview.conceptCount).toBe(3);
      for (const concept of course.concepts) {
        expect(course.excerpts.find((source) => source.id === concept.sourceId)?.text).toBe(concept.sourceQuote);
      }
    }
  });

  it('returns independent copies and refuses unknown samples', () => {
    const course = getSample('stats-causation')!;
    course.excerpts[0].text = 'Changed by a caller';
    course.concepts[0].sourceQuote = 'Changed by a caller';
    expect(getSample('stats-causation')!.excerpts[0].text).not.toBe('Changed by a caller');
    const examples = getDemoExamples('stats-causation');
    examples[0].answer = 'Changed by a caller';
    expect(getDemoExamples('stats-causation')[0].answer).not.toBe('Changed by a caller');
    expect(getSample('unknown')).toBeUndefined();
    expect(getDemoExamples('unknown')).toEqual([]);
  });

  it.each(['stats-causation', 'cell-biology'])('supports an honest six-answer demonstration for %s', (sampleId) => {
    const course = getSample(sampleId)!;
    const examples = getDemoExamples(sampleId);
    expect(examples).toHaveLength(6);
    for (let conceptIndex = 0; conceptIndex < 3; conceptIndex += 1) {
      const concept = course.concepts[conceptIndex];
      let question: Question = { id: `question-${conceptIndex * 2 + 1}`, number: conceptIndex * 2 + 1, conceptId: concept.id, text: concept.openingQuestion, kind: 'explain' };
      for (let phase = 0; phase < 2; phase += 1) {
        const example = examples[conceptIndex * 2 + phase];
        expect(question.text).toBe(example.question);
        expect(getDemoAnswer(course, question)).toBe(example.answer);
        const feedback = authoredFeedback(course, question, example.answer)!;
        expect(feedback.source).toBe('demo');
        expect(feedback.observation).toMatch(/^Authored demo feedback:/);
        expect(feedback.claimQuote).toBe(example.answer);
        expect(feedback.sourceQuote).toBe(course.excerpts.find((source) => source.id === feedback.sourceId)?.text);
        question = { ...question, id: `${question.id}-followup`, number: question.number + 1, text: feedback.followUp, kind: feedback.followUpKind };
      }
    }
  });

  it('does not treat novel answers, changed questions or altered course material as fixtures', () => {
    const course = getSample('stats-causation')!;
    const example = getDemoExamples('stats-causation')[0];
    const question: Question = { id: 'q1', number: 1, conceptId: example.conceptId, text: example.question, kind: 'explain' };
    expect(authoredFeedback(course, question, `I do not agree. ${example.answer}`)).toBeUndefined();
    expect(authoredFeedback(course, question, `${example.answer} `)).toBeUndefined();
    expect(getDemoAnswer(course, { ...question, text: 'An unrelated question?' })).toBeNull();
    course.excerpts[0].text = 'A modified course with a different claim.';
    expect(authoredFeedback(course, question, example.answer)).toBeUndefined();
    expect(getDemoAnswer(course, question)).toBeNull();
  });
});
