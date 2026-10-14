import { cost, FACILITY_IDS, JOBS, RULES } from './config';
import type { DistrictId, DistrictState, Facility, GameState, Job, PublicFacility, Resident } from './types';

export const DISTRICT_IDS: DistrictId[] = ['district-0', 'district-1', 'district-2'];
export const DISTRICTS = {
  'district-0': { name: '第0街区', address: '0-001', plots: 8, text: '站台是所有路的起点。先让这里运转，再把灯光送到别处。' },
  'district-1': { name: '旧巷', address: '0-002', plots: 4, text: '晒衣绳是测绘的终点。影子在暗处收拾旧物，回收棚可以成为这条街的手艺。' },
  'district-2': { name: '信笺里', address: '0-003', plots: 4, text: '每个窗口都等着一封信。明灯、回声居民与信箱，能把声音整理成清楚的地址。' }
};
export const PUBLIC_IDS: PublicFacility[] = ['relay', 'registry'];
export const PUBLIC_WORKS = {
  relay: { name: '配电亭', cost: cost(60, 40, 10), work: 240000, upkeep: 100, text: '工作用电减少25%，每秒维护0.10电量。' },
  registry: { name: '门牌事务所', cost: cost(70, 30, 15), work: 300000, upkeep: 100, text: '本区记忆产出提升15%，每秒维护0.10电量。' }
};
export const CITY_RULES = { condition: 1800, repairThreshold: 300, repairCost: cost(6, 15), repairWork: 60000, maxTemplates: 3, indexedArrival: 90, sharedUpkeep: 0.8, namedMemory: 1.05, specialization: 1.1, relayEnergy: 0.75, registryMemory: 1.15 };
export function emptyDistrict(): DistrictState {
  return {
    facilities: { generator: 0, recycler: 0, workbench: 0, dorm: 0, warehouse: 0, mailbox: 0 },
    population: { shadow: 0, echo: 0 },
    assignments: { shadow: { power: 0, salvage: 0, repair: 0, record: 0 }, echo: { power: 0, salvage: 0, repair: 0, record: 0 } },
    lighting: 'steady', publicWorks: { relay: { built: false, enabled: true, condition: 0 }, registry: { built: false, enabled: true, condition: 0 } }, autoRepair: false
  };
}
export function districtState(s: GameState, id: DistrictId = 'district-0'): DistrictState | undefined {
  return id === 'district-0' ? s : s.city.districts[id];
}
export function activeDistricts(s: GameState): DistrictId[] { return DISTRICT_IDS.filter(id => districtState(s, id)); }
export const localCount = (d: DistrictState) => d.population.shadow + d.population.echo;
export const localBeds = (d: DistrictState, id: DistrictId) => (id === 'district-0' ? 2 : 0) + RULES.bedsPerDormLevel * d.facilities.dorm;
export const localWorkers = (d: DistrictState, job: Job) => d.assignments.shadow[job] + d.assignments.echo[job];
export const localFree = (d: DistrictState, type: Resident) => d.population[type] - JOBS.reduce((n, j) => n + d.assignments[type][j], 0);
export const plotsUsed = (d: DistrictState) => FACILITY_IDS.filter(f => d.facilities[f] > 0).length + PUBLIC_IDS.filter(f => d.publicWorks[f].built).length;
export const specialization = (d: DistrictState, lightOn = true): 'salvage' | 'record' | null => !lightOn ? null
  : d.lighting === 'dim' && d.population.shadow >= 2 && d.facilities.recycler >= 2 ? 'salvage'
  : d.lighting === 'bright' && d.population.echo >= 2 && d.facilities.mailbox >= 2 ? 'record' : null;
export const arrivalInterval = (s: GameState) => s.completed.includes('R03') ? CITY_RULES.indexedArrival : RULES.arrivalSeconds;
export const cityCount = (s: GameState) => activeDistricts(s).reduce((n, id) => n + localCount(districtState(s, id)!), 0);
export const cityPopulation = (s: GameState, type: Resident) => activeDistricts(s).reduce((n, id) => n + districtState(s, id)!.population[type], 0);
export const cityWorkers = (s: GameState, job: Job) => activeDistricts(s).reduce((n, id) => n + localWorkers(districtState(s, id)!, job), 0);
export const scopedKey = (key: string, id: DistrictId = 'district-0') => id === 'district-0' ? key : `${id}/${key}`;
export function dismantleReason(s: GameState, id: DistrictId, facility: Facility | PublicFacility): string | null {
  const d = districtState(s, id);
  if (id === 'district-0' || !d) return '只能调整已经测绘的新街区';
  if (s.queue.some(p => p.district === id && p.definition.endsWith(`:${facility}`))) return '该设施还有未完成的工务项目';
  if (PUBLIC_IDS.includes(facility as PublicFacility)) return d.publicWorks[facility as PublicFacility].built ? null : '设施尚未建设';
  const f = facility as Facility;
  if (!FACILITY_IDS.includes(f) || !d.facilities[f]) return '设施尚未建设';
  const job = ({ generator: 'power', recycler: 'salvage', workbench: 'repair', mailbox: 'record' } as Partial<Record<Facility, Job>>)[f];
  if (job && localWorkers(d, job)) return '请先撤回该设施的工作人员';
  if (f === 'dorm' && localCount(d)) return '请先将居民迁往其他住处';
  return null;
}
