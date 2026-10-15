export type Resource = 'energy' | 'parts' | 'memory' | 'component';
export type Amounts = Record<Resource, number>;
export type Resident = 'shadow' | 'echo';
export type Job = 'power' | 'salvage' | 'repair' | 'record' | 'assemble';
export type WorkJob = Exclude<Job, 'power'>;
export type Facility = 'generator' | 'recycler' | 'workbench' | 'dorm' | 'warehouse' | 'mailbox';
export type Lighting = 'steady' | 'bright' | 'dim';
export type DistrictId = 'district-0' | 'district-1' | 'district-2';
export type BranchId = Exclude<DistrictId, 'district-0'>;
export type PublicFacility = 'relay' | 'registry';
export type MainProject = 'P01' | 'P02' | 'P03' | 'P04' | 'P05' | 'P06' | 'P07' | 'P08' | 'P09' | 'P10' | 'P11';
export type Research = 'R01' | 'R02' | 'R03' | 'R04' | 'R05' | 'R06';
export type RouteId = 'rain' | 'station';
export type Direction = 'outbound' | 'inbound';
export type AssemblyMod = 'quickJig' | 'thriftBench';
export type StoryNode = 'L01-1' | 'L01-2' | 'L01-3' | 'L01-4';
export type RadioChoice = 'dismantle' | 'restore';
export type DefinitionId = MainProject | Research | `build:${Facility}` | `public:${PublicFacility}` | `maintain:${PublicFacility}` | `route:${RouteId}` | `mod:${AssemblyMod}` | `blueprint:${AssemblyMod}`;
export type EventId = 'E01' | 'E02' | 'E03' | 'E04' | 'E05' | 'E06' | 'E07' | 'E08' | 'E09' | 'E10' | 'E11' | 'E12' | 'E13' | 'E14' | 'E15';
export type EventChoice = Lighting | 'common' | 'individual' | 'reliable' | 'express';
export type Flow = 'production' | 'rewards' | 'operating' | 'reserved' | 'refunds' | 'exports' | 'imports' | 'fulfillment';
export type Ledger = Record<Flow, Amounts>;
export interface Project {
  uid: string;
  definition: DefinitionId;
  targetLevel: number;
  status: 'waiting' | 'running' | 'paused';
  progress: number;
  reserved: Amounts;
  district: DistrictId;
  prefab: number;
}
export interface EventState { status: 'pending' | 'claimed'; choice?: EventChoice }
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
  maintenance: number;
  transport: { departures: number; deliveries: number; maintenance: number };
  highlights: string[];
  stories: StoryNode[];
}
export interface NetworkNode {
  resources: Amounts;
  received: Amounts;
  produced: Amounts;
  used: Amounts;
  shipped: Amounts;
  cycle: number;
}
export interface Shipment {
  uid: string;
  direction: Direction;
  loads: 1 | 2;
  cargo: Amounts;
  duration: number;
  remaining: number;
}
export interface NetworkRoute {
  node: NetworkNode;
  condition: number;
  staff: { district: DistrictId; resident: Resident } | null;
  trip: Shipment | null;
  contract: { enabled: boolean; loads: 1 | 2; reserve: Amounts };
  autoRepair: boolean;
  departures: number;
  exports: number;
  imports: number;
}
export interface NetworkState {
  routes: Record<RouteId, NetworkRoute>;
  priority: RouteId[];
  nextTrip: number;
  maintenance: number;
}
export interface DistrictState {
  facilities: Record<Facility, number>;
  population: Record<Resident, number>;
  assignments: Record<Resident, Record<Job, number>>;
  lighting: Lighting;
  publicWorks: Record<PublicFacility, { built: boolean; enabled: boolean; condition: number }>;
  autoRepair: boolean;
}
export interface WorkTemplate {
  name: string;
  district: DistrictId;
  assignments: DistrictState['assignments'];
  lighting: Lighting;
  priority: WorkJob[];
}
export interface ExperienceState {
  story: Partial<Record<StoryNode, { choice?: RadioChoice }>>;
  blueprints: AssemblyMod[];
  benches: Record<DistrictId, { built: AssemblyMod[]; active: AssemblyMod | null }>;
  assembly: { enabled: boolean; target: number; reserve: Amounts };
}
export interface GameState extends DistrictState {
  district: 'district-0';
  resources: Amounts;
  earned: Amounts;
  ledger: Ledger;
  arrivalSeconds: number;
  arrivals: number;
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
  city: { districts: Partial<Record<BranchId, DistrictState>>; templates: WorkTemplate[]; maintenance: number };
  network: NetworkState;
  experience: ExperienceState;
}
export interface ProjectDefinition { id: DefinitionId; name: string; description: string; cost: Amounts; work: number }
export type Action =
  | { type: 'assign'; resident: Resident; job: Job; delta: -1 | 1; district?: DistrictId }
  | { type: 'priority'; order: WorkJob[] }
  | { type: 'enqueue'; definition: DefinitionId; district?: DistrictId; prefab?: number }
  | { type: 'assembly-plan'; enabled: boolean; target: number; reserve: Amounts }
  | { type: 'assembly-mod'; district: DistrictId; mod: AssemblyMod | null }
  | { type: 'story'; node: StoryNode; choice?: RadioChoice }
  | { type: 'scrap'; count: number }
  | { type: 'move'; uid: string; direction: -1 | 1 }
  | { type: 'pause' | 'resume' | 'cancel'; uid: string }
  | { type: 'lighting'; lighting: Lighting; district?: DistrictId }
  | { type: 'event'; event: EventId; choice?: EventChoice }
  | { type: 'relocate'; resident: Resident; from: DistrictId; to: DistrictId }
  | { type: 'public-toggle'; district: DistrictId; facility: PublicFacility }
  | { type: 'auto-repair'; district: DistrictId; enabled: boolean }
  | { type: 'template-save'; district: DistrictId; name: string }
  | { type: 'template-apply' | 'template-delete'; name: string }
  | { type: 'dismantle'; district: BranchId; facility: Facility | PublicFacility }
  | { type: 'dispatch'; route: RouteId; direction: Direction; loads: 1 | 2 }
  | { type: 'network-staff'; route: RouteId; district: DistrictId; resident: Resident; delta: -1 | 1 }
  | { type: 'contract'; route: RouteId; enabled: boolean; loads: 1 | 2; reserve: Amounts }
  | { type: 'network-priority'; order: RouteId[] }
  | { type: 'route-auto'; route: RouteId; enabled: boolean }
  | { type: 'theme'; theme: 'dark' | 'light' }
  | { type: 'dismiss-report' };
