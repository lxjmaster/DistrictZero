export type Resource = 'energy' | 'parts' | 'memory';
export type Amounts = Record<Resource, number>;
export type Resident = 'shadow' | 'echo';
export type Job = 'power' | 'salvage' | 'repair' | 'record';
export type WorkJob = Exclude<Job, 'power'>;
export type Facility = 'generator' | 'recycler' | 'workbench' | 'dorm' | 'warehouse' | 'mailbox';
export type Lighting = 'steady' | 'bright' | 'dim';
export type MainProject = 'P01' | 'P02' | 'P03';
export type Research = 'R01' | 'R02';
export type DefinitionId = MainProject | Research | `build:${Facility}`;
export type EventId = 'E01' | 'E02' | 'E03' | 'E04' | 'E05';
export type Flow = 'production' | 'rewards' | 'operating' | 'reserved' | 'refunds';
export type Ledger = Record<Flow, Amounts>;
export interface Project {
  uid: string;
  definition: DefinitionId;
  targetLevel: number;
  status: 'waiting' | 'running' | 'paused';
  progress: number;
  reserved: Amounts;
}
export interface EventState { status: 'pending' | 'claimed'; choice?: Lighting }
export interface ReturnReport {
  awayMs: number;
  seconds: number;
  start: Amounts;
  end: Amounts;
  flows: Ledger;
  completed: string[];
  arrivals: Record<Resident, number>;
  events: EventId[];
  pending: EventId[];
  reasons: string[];
  goal: string;
}
export interface GameState {
  district: 'district-0';
  resources: Amounts;
  earned: Amounts;
  ledger: Ledger;
  facilities: Record<Facility, number>;
  population: Record<Resident, number>;
  arrivalSeconds: number;
  arrivals: number;
  assignments: Record<Resident, Record<Job, number>>;
  lighting: Lighting;
  lightingChosen: boolean;
  priority: WorkJob[];
  queue: Project[];
  completed: string[];
  events: Partial<Record<EventId, EventState>>;
  memoryProduced: boolean;
  address: null | '0-001';
  clock: { seconds: number; remainderMs: number; lastAt: number };
  nextProject: number;
  theme: 'dark' | 'light';
  report: ReturnReport | null;
  history: { second: number; text: string }[];
}
export interface ProjectDefinition { id: DefinitionId; name: string; description: string; cost: Amounts; work: number }
export type Action =
  | { type: 'assign'; resident: Resident; job: Job; delta: -1 | 1 }
  | { type: 'priority'; order: WorkJob[] }
  | { type: 'enqueue'; definition: DefinitionId }
  | { type: 'move'; uid: string; direction: -1 | 1 }
  | { type: 'pause' | 'resume' | 'cancel'; uid: string }
  | { type: 'lighting'; lighting: Lighting }
  | { type: 'event'; event: EventId; choice?: Lighting }
  | { type: 'theme'; theme: 'dark' | 'light' }
  | { type: 'dismiss-report' };
