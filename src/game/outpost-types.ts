import type { Amounts, AssemblyMod, DefinitionId, DistrictId, Facility, Job, Ledger, Lighting, Resident, WorkJob } from './types';

export type OutpostId = 'O01' | 'O02';
export type OutpostProject = 'O01-1' | 'O01-2' | 'O01-3' | 'O02-1' | 'O02-2' | 'O02-3';
export type OutpostProof = 'local' | 'relay';
export type SupportKind = 'light' | 'materials';
export interface OutpostPerson { uid: string; district: DistrictId; resident: Resident }
export interface SupportTrip { uid: string; outpost: OutpostId; kind: SupportKind; cargo: Amounts; duration: number; remaining: number }
export interface OutpostState {
  resources: Amounts;
  earned: Amounts;
  ledger: Ledger;
  facilities: Record<Facility, number>;
  assignments: Record<Resident, Record<Job, number>>;
  lighting: Lighting;
  priority: WorkJob[];
  assembly: { enabled: boolean; target: number; reserve: Amounts };
  bench: { built: AssemblyMod[]; active: AssemblyMod | null };
  completed: string[];
  roofPrefab: number | null;
  proof: OutpostProof | null;
  handoff: boolean;
  lightFrame: boolean;
  initialTransferred: boolean;
  sent: Record<SupportKind, number>;
}
export interface OutpostsState {
  active: OutpostId | null;
  sites: Partial<Record<OutpostId, OutpostState>>;
  crew: OutpostPerson[];
  support: { enabled: boolean; queue: SupportKind[]; reserve: Amounts; trip: SupportTrip | null };
  knowledge: { manifest: boolean; lightFrame: boolean };
  nextCrew: number;
  nextTrip: number;
}
export type OutpostAction =
  | { type: 'outpost-open'; outpost: OutpostId; crew: { district: DistrictId; resident: Resident }[] }
  | { type: 'outpost-seal'; confirmClear: boolean }
  | { type: 'outpost-reinforce'; district: DistrictId; resident: Resident }
  | { type: 'outpost-recall'; uid: string }
  | { type: 'outpost-assign'; resident: Resident; job: Job; delta: -1 | 1 }
  | { type: 'outpost-priority'; order: WorkJob[] }
  | { type: 'outpost-lighting'; lighting: Lighting }
  | { type: 'outpost-assembly'; enabled: boolean; target: number; reserve: Amounts }
  | { type: 'outpost-mod'; mod: AssemblyMod | null }
  | { type: 'outpost-enqueue'; definition: DefinitionId; prefab?: number; proof?: OutpostProof }
  | { type: 'outpost-handoff'; outpost: OutpostId }
  | { type: 'support-plan'; enabled: boolean; queue: SupportKind[]; reserve: Amounts }
  | { type: 'support-pause' };
