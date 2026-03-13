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

export interface PartnerResearchSource {
  type: "website" | "search" | "intake";
  label: string;
  url?: string;
}

export interface PartnerResearch {
  summary: string;
  domain?: string;
  targetUsers?: string[];
  products?: string[];
  constraints?: string[];
  notes?: string[];
  sources?: PartnerResearchSource[];
}

export interface ResearchSection {
  id: string;
  icon: string;
  label: string;
  sub: string;
  reason: string;
  priority: "required" | "optional";
  category: "core" | "dynamic";
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
  partnerResearch?: PartnerResearch;
  discoveredSections?: ResearchSection[];
  /** Confirmed layers for research (after Proposing step); when set, Research step uses this instead of core + discovered */
  proposedLayers?: ResearchSection[];
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
