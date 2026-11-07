import type { CourseContent, Feedback, Question, SampleCourse } from '../shared/types';

export interface DemoExample {
  conceptId: string;
  question: string;
  answer: string;
  assessment: Feedback['assessment'];
  observation: string;
  followUp: string;
  followUpKind: Feedback['followUpKind'];
}

interface SampleData { id: string; description: string; course: CourseContent; examples: DemoExample[] }

const statistics: CourseContent = {
  title: 'Correlation, confounding and causal claims',
  subject: 'Statistics',
  sourceName: 'blurtReply authored teaching notes · Statistics (not a university handout)',
  origin: 'sample',
  excerpts: [
    { id: 'stats-association', label: '1 · Association and causation', text: 'Correlation describes an association between measured variables. An association alone does not establish that changing one variable causes the other to change. Reverse causation, a common cause that influences both variables, and chance are possible explanations. A causal claim requires evidence that helps distinguish these alternatives.' },
    { id: 'stats-confounding', label: '2 · Confounding', text: 'A confounder is a pre-existing factor that influences both an exposure and an outcome and can distort their observed association. For example, exercise habits could influence both supplement use and health. Adjusting for a measured confounder can help, but does not guarantee that unmeasured confounding or measurement error has been removed.' },
    { id: 'stats-randomisation', label: '3 · Random assignment and generalisation', text: 'Random assignment makes treatment allocation independent of baseline confounders in expectation, strengthening a causal comparison between treatment groups. It does not guarantee identical groups in one particular experiment. Random assignment is different from random sampling: a valid comparison among trial volunteers does not by itself establish that the effect applies to other populations. Adherence, missing outcomes and measurement quality also matter.' },
  ],
  concepts: [],
};
statistics.concepts = [
  { id: 'association', title: 'Association is not proof of causation', sourceId: 'stats-association', sourceQuote: statistics.excerpts[0].text, openingQuestion: 'A study finds that students who sleep longer tend to score higher. What does that association establish, and what does it leave unresolved?' },
  { id: 'confounding', title: 'Identify a possible confounder', sourceId: 'stats-confounding', sourceQuote: statistics.excerpts[1].text, openingQuestion: 'A survey finds supplement users are healthier. How could exercise habits complicate a causal interpretation?' },
  { id: 'randomisation', title: 'Random assignment has a specific job', sourceId: 'stats-randomisation', sourceQuote: statistics.excerpts[2].text, openingQuestion: 'Why does randomly assigning a supplement or placebo strengthen a causal comparison?' },
];

const cells: CourseContent = {
  title: 'Membranes, ATP and gene expression',
  subject: 'Cell biology',
  sourceName: 'blurtReply authored teaching notes · Cell biology (not a university handout)',
  origin: 'sample',
  excerpts: [
    { id: 'cells-membranes', label: '1 · Selective permeability', text: 'The phospholipid bilayer is selectively permeable. Small nonpolar molecules such as oxygen can diffuse through its lipid region, while charged ions usually need membrane proteins to cross. Movement through a channel down an electrochemical gradient is passive transport and does not directly require ATP. Moving a substance against its electrochemical gradient requires an energy source.' },
    { id: 'cells-atp', label: '2 · ATP and energy coupling', text: 'ATP is a short-term energy carrier rather than a long-term energy store. ATP hydrolysis can be coupled to processes such as pumping ions against an electrochemical gradient. Energy stored in fuels such as glucose is transferred through metabolism into usable forms including ATP; ATP-driven processes cannot generally replace ATP with glucose directly. Cells continually regenerate ATP as they use it.' },
    { id: 'cells-expression', label: '3 · Transcription and translation', text: 'Transcription produces RNA from a DNA template. Translation uses the sequence of codons in messenger RNA at a ribosome to build a polypeptide. In a typical eukaryotic cell, nuclear genes are transcribed in the nucleus, while translation takes place at ribosomes in the cytoplasm or on the rough endoplasmic reticulum. The presence of messenger RNA alone does not guarantee protein production; functioning translation machinery is also required.' },
  ],
  concepts: [],
};
cells.concepts = [
  { id: 'membranes', title: 'Selective permeability and passive transport', sourceId: 'cells-membranes', sourceQuote: cells.excerpts[0].text, openingQuestion: 'Why can oxygen cross a cell membrane directly, while sodium ions usually need a membrane protein?' },
  { id: 'atp', title: 'ATP supplies usable energy', sourceId: 'cells-atp', sourceQuote: cells.excerpts[1].text, openingQuestion: 'How can ATP help a pump move ions against their electrochemical gradient, and is ATP a long-term energy store?' },
  { id: 'expression', title: 'Separate transcription from translation', sourceId: 'cells-expression', sourceQuote: cells.excerpts[2].text, openingQuestion: 'What are the distinct roles of transcription and translation in protein production?' },
];

const statsFollowUps = [
  'A common cause could influence both sleep and scores. What would that change about the conclusion that extra sleep must cause higher scores?',
  'Researchers adjust for recorded exercise habits. Does that settle whether the supplement causes better health? Explain the remaining limitation.',
  'All trial volunteers are healthy people aged 18 to 25. Does random assignment alone justify applying the effect to older patients?',
];
const cellsFollowUps = [
  'A channel allows ions to move down their electrochemical gradient. Does this ion movement directly require ATP? Explain.',
  'A cell has glucose, but ATP production is blocked. Why can most ATP-driven processes not simply use the glucose directly?',
  'A drug blocks ribosomes, but messenger RNA is still present. Which step in protein production is directly blocked, and why?',
];

// These are authored demonstrations, including deliberately imperfect answers. They are not recorded student results.
const SAMPLES: SampleData[] = [
  {
    id: 'stats-causation', description: 'Practise separating association from causation, identifying confounders and explaining random assignment.', course: statistics,
    examples: [
      { conceptId: 'association', question: statistics.concepts[0].openingQuestion, answer: 'Students who sleep more get higher scores, so extra sleep must cause the higher scores.', assessment: 'revisit', observation: 'This turns an association into a definite causal claim. The notes leave reverse causation, common causes and chance open.', followUp: statsFollowUps[0], followUpKind: 'probe' },
      { conceptId: 'association', question: statsFollowUps[0], answer: 'A common cause could explain both variables, so the association alone cannot establish that extra sleep causes higher scores.', assessment: 'supported', observation: 'This explanation identifies a common cause as an alternative to the proposed causal relationship.', followUp: 'What additional comparison would help distinguish the explanations?', followUpKind: 'probe' },
      { conceptId: 'confounding', question: statistics.concepts[1].openingQuestion, answer: 'Exercise habits could affect both supplement use and health, so exercise could explain part of the observed association.', assessment: 'supported', observation: 'This identifies a factor that could influence both exposure and outcome, matching the definition in the notes.', followUp: statsFollowUps[1], followUpKind: 'transfer' },
      { conceptId: 'confounding', question: statsFollowUps[1], answer: 'No. Adjustment addresses the recorded factor, but unmeasured confounders and measurement error can still leave uncertainty.', assessment: 'supported', observation: 'This keeps the limitation of adjustment explicit instead of treating it as proof of causation.', followUp: 'Explain why a measured association can remain uncertain after adjustment.', followUpKind: 'probe' },
      { conceptId: 'randomisation', question: statistics.concepts[2].openingQuestion, answer: 'Random assignment makes treatment independent of baseline confounders in expectation, so systematic group differences are less likely to explain the result.', assessment: 'supported', observation: 'The phrase “in expectation” preserves the qualification that one random allocation need not produce identical groups.', followUp: statsFollowUps[2], followUpKind: 'transfer' },
      { conceptId: 'randomisation', question: statsFollowUps[2], answer: 'No. Random assignment strengthens the comparison within the trial; it does not make the volunteers representative of older patients.', assessment: 'supported', observation: 'This distinguishes the internal comparison from generalisation to a different population.', followUp: 'What further evidence would you want before applying the finding to another population?', followUpKind: 'transfer' },
    ],
  },
  {
    id: 'cell-biology', description: 'Explain membrane transport, ATP coupling and the two stages of gene expression.', course: cells,
    examples: [
      { conceptId: 'membranes', question: cells.concepts[0].openingQuestion, answer: 'Oxygen is small and nonpolar, so it can diffuse through the lipid bilayer. Charged sodium ions usually need a membrane protein.', assessment: 'supported', observation: 'This connects molecular properties to the membrane’s selective permeability.', followUp: cellsFollowUps[0], followUpKind: 'transfer' },
      { conceptId: 'membranes', question: cellsFollowUps[0], answer: 'No. Movement through a channel down an electrochemical gradient is passive transport and does not directly require ATP.', assessment: 'supported', observation: 'This distinguishes passive movement through a protein from energy-requiring movement against a gradient.', followUp: 'How would the energy requirement change if the ions moved against the gradient?', followUpKind: 'transfer' },
      { conceptId: 'atp', question: cells.concepts[1].openingQuestion, answer: 'ATP is the cell’s long-term energy store, and a pump can use some of that stored energy to move ions uphill.', assessment: 'partial', observation: 'The answer links energy to uphill transport, but calls ATP a long-term store. The notes describe it as a short-term carrier coupled through hydrolysis.', followUp: cellsFollowUps[1], followUpKind: 'probe' },
      { conceptId: 'atp', question: cellsFollowUps[1], answer: 'These processes are coupled to ATP hydrolysis. Energy in glucose must first be transferred through metabolism into a usable form such as ATP.', assessment: 'supported', observation: 'This distinguishes energy in a fuel from the energy carrier used by an ATP-coupled process.', followUp: 'Why must a cell continually regenerate ATP?', followUpKind: 'probe' },
      { conceptId: 'expression', question: cells.concepts[2].openingQuestion, answer: 'Transcription makes RNA from a DNA template. Translation reads messenger RNA at a ribosome to build a polypeptide.', assessment: 'supported', observation: 'This assigns different templates and products to the two processes.', followUp: cellsFollowUps[2], followUpKind: 'transfer' },
      { conceptId: 'expression', question: cellsFollowUps[2], answer: 'Translation is directly blocked because ribosomes read messenger RNA to build polypeptides; messenger RNA alone does not make a protein.', assessment: 'supported', observation: 'This explains why the presence of the RNA template is not sufficient when translation machinery is blocked.', followUp: 'Describe which part of gene expression can still occur before translation is restored.', followUpKind: 'transfer' },
    ],
  },
];

export function getSamples(): SampleCourse[] {
  return SAMPLES.map(({ id, description, course }) => ({ id, description, title: course.title, subject: course.subject, sourceName: course.sourceName, conceptCount: course.concepts.length }));
}

export function getSample(id: string): CourseContent | undefined {
  const sample = SAMPLES.find((candidate) => candidate.id === id);
  return sample ? structuredClone(sample.course) : undefined;
}

/** Safe to expose only as explicitly labelled demo examples, never as results from an AI call. */
export function getDemoExamples(id: string): DemoExample[] {
  return structuredClone(SAMPLES.find((sample) => sample.id === id)?.examples ?? []);
}

export function getDemoAnswer(course: CourseContent, question: Question): string | null {
  const sample = SAMPLES.find((candidate) => JSON.stringify(candidate.course) === JSON.stringify(course));
  return sample?.examples.find((candidate) => candidate.conceptId === question.conceptId && candidate.question === question.text)?.answer ?? null;
}

export function authoredFeedback(course: CourseContent, question: Question, answer: string): Feedback | undefined {
  const sample = SAMPLES.find((candidate) => JSON.stringify(candidate.course) === JSON.stringify(course));
  const example = sample?.examples.find((candidate) => candidate.conceptId === question.conceptId && candidate.question === question.text && candidate.answer === answer);
  const concept = course.concepts.find((candidate) => candidate.id === question.conceptId);
  if (!example || !concept) return undefined;
  return {
    assessment: example.assessment, claimQuote: answer, sourceId: concept.sourceId, sourceQuote: concept.sourceQuote,
    observation: `Authored demo feedback: ${example.observation}`,
    followUp: example.followUp, followUpKind: example.followUpKind,
    source: 'demo', reviewStatus: 'checked',
  };
}
