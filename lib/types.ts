export interface Intake {
  company: string;
  website: string;
  projectName: string;
  status: string;
  problemStatement: string;
  functionalReqs: string;
  languages: string;
  techContact: string;
  additionalNotes: string;
}

export interface Inferred {
  projectType?: string;
  stack?: string[];
  constraints?: string[];
  integrations?: string[];
  targetUsers?: string[];
  domain?: string;
}

export interface SDSOption {
  name: string;
  verdict: "recommended" | "viable" | "avoid";
  reason: string;
}

export interface SDSData {
  recommendation: string;
  options: SDSOption[];
}

export interface SDSStateSection {
  status: string;
  data?: SDSData;
  selectedOption: { index: number; name: string } | null;
  decisionRecord?: string;
  chatHistory: Array<{ role: string; content: string }>;
}

export interface BriefState {
  intake?: Intake;
  inferred?: Inferred;
  companyProfile?: string;
}

export interface PlanState {
  plan?: string;
  projectbrief?: string;
  productcontext?: string;
  systempatterns?: string;
  techcontext?: string;
  activecontext?: string;
  progressfile?: string;
}

export interface AppState {
  brief: BriefState;
  research: Record<string, unknown>;
  prd: string;
  plan: PlanState;
}

export interface SavedSession {
  state: AppState;
  snap: Record<string, Partial<SDSStateSection>>;
  completedSteps: number[];
  currentStep: number;
  savedAt: number;
}
