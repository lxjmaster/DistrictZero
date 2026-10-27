import type { OutpostAction, OutpostId, OutpostProject, OutpostProof, OutpostsState } from './outpost-types';
import type { CalendarAction, CalendarReport, CalendarState } from './calendar-types';
import type { CovenantAction, CovenantReport, CovenantState } from './covenant-types';
export type { CovenantAction, CovenantId, CovenantReport, CovenantState } from './covenant-types';
export type { CalendarAction, CalendarOrder, CalendarRecord, CalendarReport, CalendarState } from './calendar-types';
export type { OutpostAction, OutpostId, OutpostProject, OutpostProof, OutpostsState, OutpostState, SupportKind } from './outpost-types';
export type Resource = 'energy' | 'parts' | 'memory' | 'component' | 'rainFilm' | 'railCore';
export type Amounts = Record<Resource, number>;
export type Resident = 'shadow' | 'echo';
export type Job = 'power' | 'salvage' | 'repair' | 'record' | 'assemble';
export type WorkJob = Exclude<Job, 'power'>;
export type Facility = 'generator' | 'recycler' | 'workbench' | 'dorm' | 'warehouse' | 'mailbox';
export type Lighting = 'steady' | 'bright' | 'dim';
export type DistrictId = 'district-0' | 'district-1' | 'district-2';
export type BranchId = Exclude<DistrictId, 'district-0'>;
export type PublicFacility = 'relay' | 'registry';
export type MainProject = 'P01' | 'P02' | 'P03' | 'P04' | 'P05' | 'P06' | 'P07' | 'P08' | 'P09' | 'P10' | 'P11' | 'P12' | 'P13' | 'P14' | 'P15' | 'P16' | 'P17' | 'P18' | 'P19';
export type Research = 'R01' | 'R02' | 'R03' | 'R04' | 'R05' | 'R06';
export type RouteId = 'rain' | 'station';
export type Direction = 'outbound' | 'inbound';
export type AssemblyMod = 'quickJig' | 'thriftBench';
export type MailboxMod = 'voiceBox' | 'dispatchBox';
export type VehicleMod = 'freightRack' | 'railGuard';
export type Modification = AssemblyMod | MailboxMod | VehicleMod;
export type ArchiveId = 'A01' | 'A02' | 'A03' | 'A04';
export type ProductionMode = 'normal' | 'specialty';
export interface CargoManifest { normal: number; specialty: number }
export interface NetworkContract { enabled: boolean; loads: 1 | 2; reserve: Amounts; targets: Amounts; buffer: number; manifest: CargoManifest; order: ProductionMode[] }
export type StoryNode = 'L01-1' | 'L01-2' | 'L01-3' | 'L01-4' | 'L02-1' | 'L02-2' | 'L02-3' | 'L02-4' | 'L03-1' | 'L03-2' | 'L03-3' | 'L03-4' | 'L04-1' | 'L04-2' | 'L04-3' | 'L04-4' | 'L05-1' | 'L05-2' | 'L05-3' | 'L05-4' | 'L06-1' | 'L06-2' | 'L06-3' | 'L06-4';
export type RadioChoice = 'dismantle' | 'restore';
export type DefinitionId = MainProject | Research | OutpostProject | 'lightFrame' | 'calendar:service' | `build:${Facility}` | `public:${PublicFacility}` | `maintain:${PublicFacility}` | `route:${RouteId}` | `mod:${AssemblyMod}` | `blueprint:${AssemblyMod}` | `mailmod:${MailboxMod}` | `vehiclemod:${VehicleMod}`;
export type EventId = 'E01' | 'E02' | 'E03' | 'E04' | 'E05' | 'E06' | 'E07' | 'E08' | 'E09' | 'E10' | 'E11' | 'E12' | 'E13' | 'E14' | 'E15';
export type EventChoice = Lighting | 'common' | 'individual' | 'reliable' | 'express';
export type Flow = 'production' | 'rewards' | 'operating' | 'reserved' | 'refunds' | 'exports' | 'imports' | 'fulfillment' | 'fieldReserved' | 'supportSent' | 'supportReceived';
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
  legacyChapter: boolean;
  outpost?: OutpostId | null;
  proof?: OutpostProof | null;
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
  neighborhood: { deliveries: number; fieldReturns: number; pending: number; held: Amounts };
  calendar?: CalendarReport;
  covenants?: CovenantReport;
  outposts?: { id: OutpostId; start: Amounts; end: Amounts; flows: Ledger; active: boolean; completed: string[]; support: { sent: number; remaining: number; queued: number; inTransit: Amounts }; pending: string[]; reasons: string[] }[];
}
export interface NetworkNode {
  resources: Amounts;
  received: Amounts;
  produced: Amounts;
  used: Amounts;
  shipped: Amounts;
  cycle: number;
  mode: ProductionMode;
  batches: CargoManifest;
}
export interface Shipment {
  uid: string;
  direction: Direction;
  loads: number;
  manifest: CargoManifest;
  mode: ProductionMode;
  spaceReserved: boolean;
  fee: number | null;
  wear: number | null;
  capacity: number | null;
  cargo: Amounts;
  duration: number;
  remaining: number;
}
export interface NetworkRoute {
  node: NetworkNode;
  condition: number;
  staff: { district: DistrictId; resident: Resident } | null;
  trip: Shipment | null;
  contract: NetworkContract;
  autoRepair: boolean;
  departures: number;
  exports: number;
  imports: number;
}
export interface NetworkState {
  legacyPending: boolean;
  rulesSince: number | null;
  vehicle: { built: VehicleMod[]; active: VehicleMod | null };
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
  archives: ArchiveId[];
  story: Partial<Record<StoryNode, { choice?: RadioChoice }>>;
  blueprints: Modification[];
  benches: Record<DistrictId, { built: AssemblyMod[]; active: AssemblyMod | null }>;
  assembly: { enabled: boolean; target: number; reserve: Amounts };
}
export type CommissionGroup = 'CM01' | 'CM02' | 'CM03' | 'CM04' | 'CM05' | 'CM06';
export type CommissionStage = `${CommissionGroup}-${1 | 2 | 3}`;
export type FieldSite = 'F01' | 'F02' | 'F03' | 'F04' | 'F05' | 'F06';
export type FieldKind = 'first' | 'clue' | 'supply';
export interface FieldOrder { site: FieldSite; district: DistrictId; resident: Resident }
export interface FieldTrip extends FieldOrder {
  uid: string; kind: FieldKind; duration: number; remaining: number; reserved: Amounts;
}
export type FieldResult = { uid: string; site: FieldSite } & ({ kind: FieldKind } | { kind: 'refund'; refund: Amounts });
export interface NeighborhoodState {
  commissions: { completed: CommissionStage[]; tracked: CommissionStage[]; shown: Partial<Record<CommissionStage, number>>; nextShown: number };
  field: {
    active: FieldTrip | null; queue: FieldOrder[]; pending: FieldResult[];
    sites: Record<FieldSite, { first: 'a' | 'b' | null; clue: boolean; supplies: number }>;
    nextTrip: number; returns: number; recalls: number;
    consumed: Amounts; refunded: Amounts; rewarded: Amounts;
  };
  mailboxes: Record<DistrictId, { built: MailboxMod[]; active: MailboxMod | null }>;
  delegation: { enabled: boolean; district: DistrictId; stages: CommissionStage[]; reserve: Amounts; deliveries: number };
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
  neighborhood: NeighborhoodState;
  outposts: OutpostsState;
  calendar: CalendarState;
  covenants: CovenantState;
}
export interface ProjectDefinition { id: DefinitionId; name: string; description: string; cost: Amounts; work: number }
export type Action = OutpostAction | CalendarAction | CovenantAction
  | { type: 'assign'; resident: Resident; job: Job; delta: -1 | 1; district?: DistrictId }
  | { type: 'priority'; order: WorkJob[] }
  | { type: 'enqueue'; definition: DefinitionId; district?: DistrictId; prefab?: number }
  | { type: 'assembly-plan'; enabled: boolean; target: number; reserve: Amounts }
  | { type: 'assembly-mod'; district: DistrictId; mod: AssemblyMod | null }
  | { type: 'mailbox-mod'; district: DistrictId; mod: MailboxMod | null }
  | { type: 'commission-show'; stages: CommissionStage[] }
  | { type: 'commission-track' | 'commission-untrack' | 'commission-deliver'; stage: CommissionStage }
  | { type: 'field-start'; site: FieldSite; kind: FieldKind; district: DistrictId; resident: Resident }
  | { type: 'field-recall' }
  | { type: 'field-claim'; uid: string; choice?: 'a' | 'b' }
  | { type: 'field-queue'; orders: FieldOrder[] }
  | { type: 'delegate-plan'; district: DistrictId; stages: CommissionStage[]; reserve: Amounts }
  | { type: 'delegate-pause' }
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
  | { type: 'dispatch'; route: RouteId; direction: Direction; loads: number | CargoManifest }
  | { type: 'production-mode'; route: RouteId; mode: ProductionMode }
  | { type: 'vehicle-mod'; mod: VehicleMod | null }
  | { type: 'archive'; id: ArchiveId }
  | { type: 'network-staff'; route: RouteId; district: DistrictId; resident: Resident; delta: -1 | 1 }
  | { type: 'contract'; route: RouteId; enabled: boolean; loads: 1 | 2; reserve: Amounts; targets?: Amounts; buffer?: number; manifest?: CargoManifest; order?: ProductionMode[] }
  | { type: 'contract-pause'; route: RouteId }
  | { type: 'network-priority'; order: RouteId[] }
  | { type: 'route-auto'; route: RouteId; enabled: boolean }
  | { type: 'theme'; theme: 'dark' | 'light' }
  | { type: 'dismiss-report' };
