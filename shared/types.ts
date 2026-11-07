export type RoomPhase = 'collecting' | 'analysing' | 'review' | 'discussion' | 'retest' | 'results' | 'closed';
export type RoomMode = 'demo' | 'live';
export type ResponseStage = 'initial' | 'transfer';
export type AnalysisSource = 'openai' | 'demo' | 'fallback';

export interface Choice { id: string; label: string; text: string }
export interface Question { id: string; prompt: string; context?: string; options: Choice[] }
export interface PublicLesson {
  id: string;
  title: string;
  subject: string;
  subtitle: string;
  estimatedMinutes: number;
  initial: Question;
  transfer: Question;
}
export interface RubricCategory { id: string; label: string; description: string; probeId: string | null }
export interface DiagnosticProbe { id: string; prompt: string; expectedReasoning: string }
export interface DemoResponse {
  alias: string;
  choiceId: string;
  reason: string;
  categoryId: string;
  quote: string;
  transferChoiceId: string;
  transferReason: string;
}
export interface Lesson extends PublicLesson {
  initialExpectedChoiceId: string;
  transferExpectedChoiceId: string;
  initialExpectedReasoning: string;
  transferExpectedReasoning: string;
  categories: RubricCategory[];
  probes: DiagnosticProbe[];
  contrastPairs: [string, string][];
  defaultDiscussionPrompt: string;
  demoResponses: DemoResponse[];
}
export interface Analysis {
  responseId: string;
  categoryId: string;
  categoryLabel: string;
  quote: string;
  note: string;
  needsClarification: boolean;
  probe: string | null;
  source: AnalysisSource;
}
export interface SubmittedResponse {
  id: string;
  participantId: string;
  stage: ResponseStage;
  choiceId: string;
  reason: string;
  submittedAt: string;
  clarification?: string;
  analysis?: Analysis;
}
export interface Participant {
  id: string;
  alias: string;
  isDemo: boolean;
  joinedAt: string;
}
export interface Pairing {
  id: string;
  number: number;
  participantIds: string[];
  aliases: string[];
  prompt: string;
  rationale: string;
  kind: 'contrast' | 'compare' | 'solo';
}
export interface AnswerCard {
  responseId: string;
  participantId: string;
  alias: string;
  choiceId: string;
  reason: string | null;
  isDemo: boolean;
  analysis?: Analysis;
}
export interface ResultSummary {
  initialTotal: number;
  transferTotal: number;
  initialExpected: number;
  transferExpected: number;
  matchedRespondents: number;
  initialDistribution: Record<string, number>;
  transferDistribution: Record<string, number>;
  examples: { alias: string; before: string; after: string; isDemo: boolean }[];
  explanation: string;
}
export interface RoomSnapshot {
  code: string;
  title: string;
  mode: RoomMode;
  phase: RoomPhase;
  version: number;
  createdAt: string;
  lesson: PublicLesson;
  participantCount: number;
  initialCount: number;
  transferCount: number;
  revealed: boolean;
  aiStatus: 'ready' | 'disabled' | 'running' | 'complete' | 'failed';
  aiMessage: string | null;
  cards: AnswerCard[];
  pairings: Pairing[];
  summary: ResultSummary | null;
  isHost: boolean;
  self: {
    participant: Participant;
    initial: SubmittedResponse | null;
    transfer: SubmittedResponse | null;
    pairing: Pairing | null;
  } | null;
  host?: {
    participants: Participant[];
    responses: SubmittedResponse[];
    analysisCounts: { categoryId: string; label: string; count: number }[];
  };
}
export type RoomAction = 'analyse' | 'reveal' | 'publish-pairs' | 'start-retest' | 'show-results' | 'close' | 'restart-demo' | 'fallback-pairs';
export interface ServerStatus {
  aiConfigured: boolean;
  aiEnabled: boolean;
  model: string;
  remainingAiCalls: number;
  storage: 'sqlite';
  localOnly: boolean;
  joinBaseUrl: string;
}
