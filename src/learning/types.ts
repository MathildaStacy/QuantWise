export type LearningGoal = 'foundation' | 'factor' | 'research';
export interface LearningPlan {
  goal: LearningGoal;
  minutes: 10 | 20 | 40;
  days: 3 | 5 | 7;
  bookId: string | null;
}
export type ConceptId =
  | 'returns'
  | 'drawdown'
  | 'sharpe'
  | 'momentum'
  | 'ic'
  | 'costs'
  | 'leakage'
  | 'overfit';
export interface Concept {
  id: ConceptId;
  title: string;
  english: string;
  group: LearningGoal;
  definition: string;
  formula: string;
  example: string;
  pitfall: string;
  prerequisites: ConceptId[];
  sectionId: string;
}
export interface Question {
  id: string;
  conceptId: ConceptId;
  prompt: string;
  options: string[];
  answer: number;
  explanation: string;
}
export interface Attempt {
  id: number;
  runId: string;
  questionId: string;
  choice: number;
  correct: boolean;
  day: string;
  createdAt: string;
}
export type CheckId = 'timing' | 'universe' | 'cost' | 'holdout';
export interface ResearchSource {
  bookId: string;
  sectionId: string;
  bookTitle: string;
  sectionTitle: string;
}
export interface ResearchNote {
  id: string;
  title: string;
  hypothesis: string;
  method: string;
  evidence: string;
  conclusion: string;
  nextStep: string;
  conceptId: ConceptId | null;
  source: ResearchSource | null;
  checks: Record<CheckId, string>;
  createdAt: string;
  updatedAt: string;
  createdDay: string;
  updatedDay: string;
}
export type ResearchDraft = Omit<
  ResearchNote,
  'createdAt' | 'updatedAt' | 'createdDay' | 'updatedDay'
>;
export interface LearningData {
  plan: LearningPlan;
  saved: ConceptId[];
  attempts: Attempt[];
  notes: ResearchNote[];
}
