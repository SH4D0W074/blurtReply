export type PracticeMode = 'demo' | 'live';
export type AgentName = 'planner' | 'examiner' | 'verifier' | 'coach';
export type AgentState = 'working' | 'complete' | 'limited' | 'failed';
export interface AgentEvent {
  id: string; agent: AgentName; state: AgentState; label: string;
  detail?: string; sourceIds: string[]; createdAt: string;
}
export type AgentReporter = (event: Omit<AgentEvent, 'id' | 'createdAt'>) => void;
export interface SourceExcerpt { id: string; label: string; text: string; page?: number }
export interface Concept { id: string; title: string; sourceId: string; sourceQuote: string; openingQuestion: string }
export interface CourseContent {
  title: string; subject: string; sourceName: string; origin: 'sample' | 'upload' | 'paste';
  excerpts: SourceExcerpt[]; concepts: Concept[];
}
export interface SampleCourse { id: string; title: string; subject: string; description: string; sourceName: string; conceptCount: number }
export interface CourseInput { sampleId?: string; title?: string; sourceName?: string; text?: string; origin?: 'upload' | 'paste' }
export type QuestionKind = 'explain' | 'probe' | 'transfer';
export interface Question { id: string; number: number; text: string; conceptId: string; kind: QuestionKind }
export type Assessment = 'supported' | 'partial' | 'revisit' | 'unclear';
export interface Feedback {
  assessment: Assessment; claimQuote: string | null; sourceId: string | null; sourceQuote: string | null;
  /** Conversational response; absent on practices saved before this field was introduced. */
  reply?: string;
  observation: string; followUp: string; followUpKind: 'probe' | 'transfer';
  source: 'ai' | 'demo' | 'fallback'; reviewStatus: 'checked' | 'needs-review' | 'unavailable';
}
export interface Turn { id: string; question: Question; answer: string; feedback: Feedback; createdAt: string }
export interface ReviewPoint { text: string; turnId: string | null; sourceId: string | null }
export interface PracticeReview {
  strengths: ReviewPoint[]; revisit: ReviewPoint[]; nextSteps: ReviewPoint[];
  source: 'ai' | 'demo' | 'fallback'; note: string;
}
export interface PracticeSession {
  id: string; mode: PracticeMode; course: CourseContent; phase: 'ready' | 'thinking' | 'complete';
  currentQuestion: Question | null; turns: Turn[]; events: AgentEvent[];
  review: PracticeReview | null; version: number; totalQuestions: number;
  createdAt: string; updatedAt: string; pendingAnswer: string | null; message: string | null;
  demoAnswer?: string | null;
}
export interface RecentPractice { id: string; title: string; mode: PracticeMode; phase: PracticeSession['phase']; turnCount: number; totalQuestions: number; updatedAt: string }
export interface ServerStatus {
  aiConfigured: boolean; aiEnabled: boolean; model: string; remainingTextCalls: number;
  transcriptionAvailable: boolean; transcriptionModel: string; remainingTranscriptions: number;
  voiceProvider: 'device' | 'elevenlabs'; remainingVoiceCalls: number; localOnly: boolean;
}
