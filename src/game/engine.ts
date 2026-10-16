import { amounts, BASE, EVENTS, FACILITIES, FACILITY_IDS, FLOWS, INITIAL, INPUTS, JOBS, jobFacility, jobNames, POLICIES, PROJECTS, RESEARCH_EFFECTS, RESIDENTS, RESOURCES, resourceNames, RULES, TRAITS, UNIT, WAREHOUSE_CAPACITY, WORK_JOBS } from './config';
import type { Action, Amounts, DefinitionId, EventId, Facility, GameState, Job, Ledger, Lighting, Project, ProjectDefinition, Resident, ReturnReport } from './types';
import type { DistrictId, PublicFacility } from './types';
import { activeDistricts, arrivalInterval, CITY_RULES, cityPopulation, cityWorkers, dismantleReason, districtState, DISTRICTS, DISTRICT_IDS, emptyDistrict, localBeds, localCount, localWorkers, plotsUsed, PUBLIC_IDS, PUBLIC_WORKS, scopedKey, specialization } from './city';
import { awayWorkers, createNetwork, dispatch, NETWORK_RULES, networkReasons, ROUTE_IDS, ROUTES, routeOpen, tickNetwork, inventoryLimits, networkProof, validContract, MODES, productResource, occupiedVehicles } from './network';
import type { RouteId, VehicleMod } from './types';
import { ARCHIVES, ARCHIVE_IDS, archivesUnlocked, VEHICLE_COST, VEHICLE_MOD_IDS, VEHICLE_MODS, VEHICLE_WORK } from './journey';
import { ASSEMBLY, assemblyRecipe, assemblyUnlocked, createExperience, MOD_IDS, pendingStories, prefabLimit, prefabricated, STORY_NAMES, storyAvailable } from './experience';
import type { AssemblyMod, MailboxMod } from './types';
import { COMMISSION_IDS, commissionDone, commissionVisible, createNeighborhood, deliverCommission, delegationReason, fieldOpenReason, fieldStartReason, heldFieldSupplies, idleResidents, MAIL_MOD_IDS, MAIL_MODS, NEIGHBORHOOD_RULES, recallField, claimField, startField, tickNeighborhood } from './neighborhood';

export function emptyLedger(): Ledger {
  return Object.fromEntries(FLOWS.map(f => [f, amounts()])) as Ledger;
}
export function createGame(now = 0): GameState {
  return {
    district: 'district-0', resources: { ...INITIAL.resources }, earned: amounts(), ledger: emptyLedger(),
    facilities: { generator: 1, recycler: 1, workbench: 1, dorm: 0, warehouse: 0, mailbox: 0 },
    population: { shadow: INITIAL.population, echo: 0 }, arrivalSeconds: 0, arrivals: 0,
    assignments: { shadow: { power: 1, salvage: 1, repair: 0, record: 0, assemble: 0 }, echo: { power: 0, salvage: 0, repair: 0, record: 0, assemble: 0 } },
    lighting: 'steady', lightingChosen: false, priority: [...WORK_JOBS], queue: [], completed: [],
    events: {}, memoryProduced: false, address: null, clock: { seconds: 0, remainderMs: 0, lastAt: now },
    nextProject: 1, theme: 'dark', report: null,
    history: [{ second: 0, text: '收到工务交接单：请让这里有地方可去。' }],
    publicWorks: emptyDistrict().publicWorks, autoRepair: false,
    city: { districts: {}, templates: [], maintenance: 0 }, network: createNetwork(), experience: createExperience(), neighborhood: createNeighborhood()
  };
}
export const populationCapacity = (s: GameState, id: DistrictId = 'district-0') => localBeds(districtState(s, id)!, id);
export const populationCount = (s: GameState, id: DistrictId = 'district-0') => localCount(districtState(s, id)!);
export const workers = (s: GameState, job: Job, id: DistrictId = 'district-0') => localWorkers(districtState(s, id)!, job);
export const freeResidents = (s: GameState, type: Resident, id: DistrictId = 'district-0') => idleResidents(s, id, type);
export const jobCapacity = (s: GameState, job: Job, id: DistrictId = 'district-0') => { const level = districtState(s, id)!.facilities[jobFacility[job]]; return level && (job !== 'assemble' || assemblyUnlocked(s)) ? level + 1 : 0; };
export const jobSlotsUsed = (s: GameState, job: Job, id: DistrictId = 'district-0') => workers(s, job, id) + (job === 'repair' ? workers(s, 'assemble', id) : job === 'assemble' ? workers(s, 'repair', id) : 0);
export const efficiency = (s: GameState, job: Job, id: DistrictId = 'district-0') => 1 + RULES.efficiencyGrowth * (districtState(s, id)!.facilities[jobFacility[job]] - 1);
export function capacities(s: GameState): Amounts {
  const level = activeDistricts(s).reduce((n, id) => n + districtState(s, id)!.facilities.warehouse, 0);
  return amounts(INITIAL.capacities.energy + level * WAREHOUSE_CAPACITY.energy, INITIAL.capacities.parts + level * WAREHOUSE_CAPACITY.parts, INITIAL.capacities.memory + level * WAREHOUSE_CAPACITY.memory, ASSEMBLY.capacity + level * ASSEMBLY.warehouseCapacity, NETWORK_RULES.specialtyCapacity + level * NETWORK_RULES.specialtyWarehouse, NETWORK_RULES.specialtyCapacity + level * NETWORK_RULES.specialtyWarehouse);
}
export const stockLimits = (s: GameState) => inventoryLimits(s, capacities(s));
export function activateNetworkRules(state: GameState, at: number): GameState {
  const s = structuredClone(state);
  if (!s.network.legacyPending) return s;
  const cap = capacities(s);
  for (const id of ROUTE_IDS) if (routeOpen(s, id)) {
    const targets = amounts(); targets[productResource(id, 'normal')] = cap[productResource(id, 'normal')];
    s.network.routes[id].contract.targets = targets;
  }
  s.network.legacyPending = false; s.network.rulesSince = Math.max(s.clock.lastAt, Math.floor(at));
  return s;
}
export const projectKey = (p: Pick<Project, 'definition' | 'targetLevel'> & { district?: DistrictId }) => scopedKey(p.definition.startsWith('build:') ? `${p.definition}:${p.targetLevel}` : p.definition, p.district);
function baseDefinitionFor(s: GameState, id: DefinitionId, targetLevel?: number, district: DistrictId = 'district-0'): ProjectDefinition {
  if (id.startsWith('vehiclemod:')) {
    const mod = id.slice(11) as VehicleMod;
    return { id, name: `制作${VEHICLE_MODS[mod].name}`, description: VEHICLE_MODS[mod].text, cost: VEHICLE_COST, work: VEHICLE_WORK };
  }
  if (id.startsWith('mailmod:')) {
    const mod = id.slice(8) as MailboxMod;
    return { id, name: `制作${MAIL_MODS[mod].name}`, description: MAIL_MODS[mod].text, cost: NEIGHBORHOOD_RULES.mailCost, work: NEIGHBORHOOD_RULES.mailWork };
  }
  if (id.startsWith('mod:') || id.startsWith('blueprint:')) {
    const mod = id.split(':')[1] as AssemblyMod, learn = id.startsWith('blueprint:');
    return { id, name: `${learn ? '整理工具清单：' : '制作'}${ASSEMBLY.recipes[mod].name}`, description: learn ? '补学这份图样。蓝图全城通用，制作方案按街区分别安排。' : '制作一次后可启用，与普通台面及另一种方案择一生效。', cost: learn ? ASSEMBLY.blueprintCost : ASSEMBLY.modCost, work: learn ? ASSEMBLY.blueprintWork : ASSEMBLY.modWork };
  }
  if (id.startsWith('route:')) return { id, name: `维护${ROUTES[id.slice(6) as RouteId].name}线路`, description: '共用工务队列，维护完成后线路状态恢复至1000。已有列车继续运输。', cost: NETWORK_RULES.repairCost, work: NETWORK_RULES.repairWork };
  if (id.startsWith('public:') || id.startsWith('maintain:')) {
    const f = id.split(':')[1] as PublicFacility, d = PUBLIC_WORKS[f];
    return { id, name: `${id.startsWith('maintain:') ? '巡检' : '建设'}${d.name}`, description: d.text,
      cost: id.startsWith('maintain:') ? CITY_RULES.repairCost : d.cost, work: id.startsWith('maintain:') ? CITY_RULES.repairWork : d.work };
  }
  if (!id.startsWith('build:')) return PROJECTS[id as keyof typeof PROJECTS];
  const facility = id.slice(6) as Facility;
  const level = (targetLevel ?? districtState(s, district)!.facilities[facility] + 1) - 1;
  const f = FACILITIES[facility];
  const scaledCost = amounts();
  for (const r of RESOURCES) scaledCost[r] = Math.ceil(f.cost[r] / UNIT * RULES.costGrowth ** level) * UNIT;
  return { id, name: `${f.name} · ${level + 1}级`, description: f.description, cost: scaledCost, work: Math.ceil(f.work / UNIT * RULES.workGrowth ** level) * UNIT };
}
export function definitionFor(s: GameState, id: DefinitionId, targetLevel?: number, district: DistrictId = 'district-0', prefab = 0): ProjectDefinition {
  return prefabricated(baseDefinitionFor(s, id, targetLevel, district), prefab);
}
export function unlockReason(s: GameState, id: DefinitionId, district: DistrictId = 'district-0', legacyChapter = false): string | null {
  const local = districtState(s, district);
  if (!local) return '先测绘这个街区';
  if (id.startsWith('vehiclemod:')) {
    const mod = id.slice(11) as VehicleMod;
    if (!VEHICLE_MOD_IDS.includes(mod) || district !== 'district-0') return '请选择全网车辆方案，在第0街区制作';
    if (!s.completed.includes('P08') || !s.experience.blueprints.includes(mod)) return '需要车队和对应蓝图';
    return s.network.vehicle.built.includes(mod) ? '已经制作过这个车辆方案' : null;
  }
  if (id.startsWith('mailmod:')) {
    const mod = id.slice(8) as MailboxMod;
    if (!MAIL_MOD_IDS.includes(mod)) return '未知信箱方案';
    if (!local.facilities.mailbox) return '先建设本区信箱';
    if (!s.experience.blueprints.includes(mod)) return '先发现对应蓝图';
    return s.neighborhood.mailboxes[district].built.includes(mod) ? '本区已经制作过这个信箱方案' : null;
  }
  if (id.startsWith('mod:') || id.startsWith('blueprint:')) {
    const mod = id.split(':')[1] as AssemblyMod;
    if (!MOD_IDS.includes(mod)) return '未知工具方案';
    if (!assemblyUnlocked(s)) return '先阅读收音机旁的装配纸条';
    if (id.startsWith('blueprint:')) {
      if (district !== 'district-0' || !s.completed.includes('P03')) return '首章完成后在第0街区整理工具清单';
      return s.experience.blueprints.includes(mod) && !s.queue.some(p => p.definition === id) ? '已经知道这份蓝图' : null;
    }
    if (!local.facilities.workbench) return '先建设本区维修台';
    if (!s.experience.blueprints.includes(mod)) return '先发现对应蓝图';
    return s.experience.benches[district].built.includes(mod) ? '这个街区已经制作过该方案' : null;
  }
  if (id.startsWith('route:')) {
    const route = id.slice(6) as RouteId;
    if (!ROUTE_IDS.includes(route) || district !== 'district-0' || !routeOpen(s, route)) return '先开放这条城际线路，在第0街区安排维护';
    return s.network.routes[route].condition >= NETWORK_RULES.condition ? '线路状态完好' : null;
  }
  if (id.startsWith('public:') || id.startsWith('maintain:')) {
    const f = id.split(':')[1] as PublicFacility;
    if (!PUBLIC_IDS.includes(f)) return '未知公共设施';
    if (!s.address) return '先完成首章，登记地址0-001';
    if (id.startsWith('maintain:')) return !local.publicWorks[f].built ? '先建设公共设施' : local.publicWorks[f].condition >= CITY_RULES.condition ? '设备状态完好' : null;
    if (local.publicWorks[f].built) return '已经建成';
    return plotsUsed(local) >= DISTRICTS[district].plots ? '地块已满，请调整闲置设施' : null;
  }
  if (id.startsWith('build:')) {
    const f = id.slice(6) as Facility;
    if (!FACILITY_IDS.includes(f)) return '未知设施';
    if (local.facilities[f] >= RULES.maxLevel) return '已达最高等级';
    if (!local.facilities[f] && plotsUsed(local) >= DISTRICTS[district].plots) return '地块已满，请调整闲置设施';
    if (f === 'dorm' && !s.completed.includes('P01')) return '先让临时路灯亮起';
    if (f === 'warehouse' && s.earned.parts < RULES.warehouseUnlockParts) return `累计取得 ${format(RULES.warehouseUnlockParts)} 零件后开放（现有 ${format(s.earned.parts)}）`;
    if (f === 'mailbox' && !s.completed.includes('P02')) return '先给站牌写上“0”';
    if (f === 'workbench' && !s.memoryProduced) return '信箱首次实际生产记忆后开放';
    return null;
  }
  if (!Object.hasOwn(PROJECTS, id)) return '未知工程';
  if (district !== 'district-0') return '主线与研究统一在第0街区安排';
  if (s.completed.includes(id)) return '已经完成';
  if (id === 'P02' && !s.completed.includes('P01')) return '先让临时路灯亮起';
  if (id === 'P03') {
    if (!s.completed.includes('P02')) return '先给站牌写上“0”';
    if (!s.facilities.dorm || !s.facilities.warehouse || !s.facilities.mailbox) return '需要 1级宿舍、后场仓库和回声信箱';
    if (s.earned.memory < RULES.platformUnlockMemory) return `累计取得 ${format(RULES.platformUnlockMemory)} 记忆后开放（现有 ${format(s.earned.memory)}）`;
  }
  if ((id === 'R01' || id === 'R02') && !s.events.E04) return '等待信箱收到明天的信（信箱建成且累计取得 20 记忆）';
  if (['P04', 'P05', 'P06', 'P07', 'R03', 'R04'].includes(id) && !s.address) return '先完成首章，登记地址0-001';
  if (id === 'P04' && s.events.E05?.status !== 'claimed') return '先读完并归档“第一个地址”来信';
  if (id === 'P05' && !s.completed.includes('P04')) return '先测绘旧巷';
  if ((id === 'P06' || id === 'R03') && s.events.E07?.status !== 'claimed') return '先处理“两家共用一块门牌”的选择';
  if (id === 'P06') {
    if (!s.completed.includes('P05')) return '先登记信笺里';
    if (!legacyChapter && !activeDistricts(s).some(id => PUBLIC_IDS.some(f => districtState(s, id)!.publicWorks[f].built))) return '全城至少需要一种已建公共设施';
    if (['district-1', 'district-2'].some(id => localCount(districtState(s, id as DistrictId)!) < 2)) return '两个新区各需要至少2位居民';
  }
  if (id === 'P07') {
    if (!s.completed.includes('P06')) return '先编成夜城地址簿';
    if (!legacyChapter) {
      const proof = chapterProofs(s);
      if (!proof.lighting) return '三个登记街区都需要有效照明';
      if (!proof.production && !proof.cooperation) return '需要生产保障（在岗且有供料的一处专业街区）或街区协作（CM02-1与CM03-1）';
    }
  }
  if (id === 'R04' && !activeDistricts(s).some(id => PUBLIC_IDS.some(f => districtState(s, id)!.publicWorks[f].built))) return '先建成一种公共设施';
  if (['P08', 'P09', 'P10', 'P11', 'R05', 'R06'].includes(id) && !s.completed.includes('P07')) return '先接通雨城联络线';
  if (id === 'P08' && s.events.E10?.status !== 'claimed') return '先读完并归档“雨城接起了电话”';
  if ((id === 'P09' || id === 'R05') && (s.network.routes.rain.imports < 1 || s.events.E12?.status !== 'claimed')) return '先取回雨城的第一只箱子，并选择稳班或快班';
  if (id === 'R06' && !s.completed.includes('P09')) return '先恢复长站货台';
  if (id === 'P10' && (!s.completed.includes('R05') || !s.completed.includes('R06') || ROUTE_IDS.some(id => s.network.routes[id].imports < 1))) return '两地各完成一次回程，并研究运单规范、联运调度';
  if (id === 'P11' && !legacyChapter) {
    if (s.network.legacyPending) { if (!legacyChapterReady(s, 'P11')) return '先编定时刻表，两地各完成两次回程，启用两个合同并安排外派、维护线路'; }
    else if (!s.completed.includes('P10') || ROUTE_IDS.some(id => s.network.routes[id].imports < 1) || !networkProof(s, capacities(s))) return '先编定时刻表，两地各一次回程，并维持至少一条可响应需求或目标已满足的有效合同';
  }
  return null;
}
export function enqueueReason(s: GameState, id: DefinitionId, district: DistrictId = 'district-0'): string | null {
  const base = unlockReason(s, id, district) ?? (s.queue.some(p => p.definition === id && p.district === district) ? '已在工务队列中' : s.queue.length >= RULES.maxQueue ? '工务队列已满（最多 3项）' : null);
  if (base) return base;
  const d = districtState(s, district)!;
  const newPlot = (id.startsWith('build:') && !d.facilities[id.slice(6) as Facility]) || id.startsWith('public:');
  const planned = s.queue.filter(p => p.district === district && ((p.definition.startsWith('build:') && p.targetLevel === 1) || p.definition.startsWith('public:'))).length;
  return newPlot && plotsUsed(d) + planned >= DISTRICTS[district].plots ? '地块已被待建工程预留' : null;
}
export function missingCost(s: GameState, c: Amounts): string[] {
  return RESOURCES.filter(r => s.resources[r] < c[r]).map(r => `缺少 ${format(c[r] - s.resources[r])} ${resourceNames[r]}`);
}
export function projectReasons(s: GameState, p = s.queue[0]): string[] {
  if (!p) return ['尚未安排工程'];
  if (p.status === 'paused') return ['项目已暂停，等待继续'];
  const reasons: string[] = [];
  if (!cityWorkers(s, 'repair')) reasons.push('未分配维修工');
  if (p.status === 'waiting') {
    const unlock = unlockReason(s, p.definition, p.district, p.legacyChapter);
    if (unlock) reasons.push(unlock);
    reasons.push(...missingCost(s, definitionFor(s, p.definition, p.targetLevel, p.district, p.prefab).cost));
  }
  return reasons;
}
function log(s: GameState, text: string) {
  s.history.push({ second: s.clock.seconds, text });
  if (s.history.length > 40) s.history.shift();
}
function credit(s: GameState, resource: keyof Amounts, value: number, source: 'production' | 'rewards' | 'refunds') {
  const actual = Math.min(value, stockLimits(s)[resource] - s.resources[resource]);
  s.resources[resource] += actual;
  s.ledger[source][resource] += actual;
  if (source !== 'refunds') s.earned[resource] += actual;
}
function spend(s: GameState, inputs: Amounts, source: 'operating' | 'reserved' | 'fulfillment') {
  for (const r of RESOURCES) { s.resources[r] -= inputs[r]; s.ledger[source][r] += inputs[r]; }
}

// Inputs follow cumulative work within this tick. Reusing capacity-blocked
// production charges only the difference, avoiding a second rounding charge.
function perform(s: GameState, wanted: number, inputs: Amounts, room: number, output?: keyof Amounts, produced = 0, reserve = amounts()): number {
  if (wanted <= produced || room <= 0) return 0;
  let ratio = Math.min(1, (produced + room) / wanted);
  const paid = amounts();
  for (const r of RESOURCES) if (inputs[r] > 0) {
    paid[r] = Math.ceil(inputs[r] * produced / wanted - 1e-9);
    ratio = Math.min(ratio, (Math.max(0, s.resources[r] - reserve[r]) + paid[r]) / inputs[r]);
  }
  const actual = Math.floor(wanted * ratio + 1e-9) - produced;
  if (actual <= 0) return 0;
  const used = amounts();
  for (const r of RESOURCES) used[r] = Math.min(s.resources[r], Math.ceil(inputs[r] * (produced + actual) / wanted - 1e-9) - paid[r]);
  spend(s, used, 'operating');
  if (output) credit(s, output, actual, 'production');
  return actual;
}
function weightedWorkers(s: GameState, job: Job, id: DistrictId) {
  const d = districtState(s, id)!;
  return d.assignments.shadow[job] * (job === 'salvage' ? TRAITS.shadowSalvage : 1) + d.assignments.echo[job] * (job === 'record' ? TRAITS.echoMemory : 1);
}
interface Service { light: boolean; public: Record<PublicFacility, boolean> }
type Services = Partial<Record<DistrictId, Service>>;
function powerBudget(s: GameState) {
  return activeDistricts(s).reduce((n, id) => n + Math.round(BASE.power * workers(s, 'power', id) * efficiency(s, 'power', id)), 0);
}
function serviceBudget(s: GameState, energy: number): { services: Services; lighting: number; upkeep: number } {
  const services: Services = {}; let lighting = 0, upkeep = 0;
  const factor = s.events.E07?.choice === 'common' ? CITY_RULES.sharedUpkeep : 1;
  for (const id of activeDistricts(s)) {
    const d = districtState(s, id)!, lightCost = Math.ceil(POLICIES[d.lighting].upkeep * factor);
    const service: Service = { light: energy >= lightCost, public: { relay: false, registry: false } };
    if (service.light) { energy -= lightCost; lighting += lightCost; }
    services[id] = service;
  }
  for (const id of activeDistricts(s)) for (const f of PUBLIC_IDS) {
    const d = districtState(s, id)!, equipment = d.publicWorks[f], charge = Math.ceil(PUBLIC_WORKS[f].upkeep * factor);
    if (equipment.built && equipment.enabled && equipment.condition > 0 && energy >= charge) {
      services[id]!.public[f] = true; energy -= charge; upkeep += charge;
    }
  }
  return { services, lighting, upkeep };
}
export function servicePreview(s: GameState): Services {
  return serviceBudget(s, Math.min(stockLimits(s).energy, s.resources.energy + powerBudget(s))).services;
}
export function chapterProofs(s: GameState) {
  const services = servicePreview(s), capacity = stockLimits(s);
  const supply = serviceBudget(s, Math.min(capacity.energy, s.resources.energy + powerBudget(s)));
  const energy = s.resources.energy + powerBudget(s) - supply.lighting - supply.upkeep;
  const details = activeDistricts(s).map(id => {
    const d = districtState(s, id)!, spec = specialization(d, services[id]?.light);
    const staffed = spec !== null && workers(s, spec, id) > 0;
    const full = spec !== null && s.resources[spec === 'salvage' ? 'parts' : 'memory'] >= capacity[spec === 'salvage' ? 'parts' : 'memory'];
    const fed = full || energy > 0 && (spec === 'salvage' || s.resources.parts > 0 || cityWorkers(s, 'salvage') > 0);
    return { district: id, specialization: spec, staffed, fed, ready: staffed && fed };
  });
  return {
    lighting: DISTRICT_IDS.every(id => Boolean(services[id]?.light)),
    production: details.some(d => d.ready),
    cooperation: commissionDone(s, 'CM02-1') && commissionDone(s, 'CM03-1'), details
  };
}
// Only migration calls this. A compatibility flag belongs to one old queue item,
// never to future projects or newly started chapters.
export function legacyChapterReady(s: GameState, id: 'P06' | 'P07' | 'P11') {
  if (id === 'P11') return s.completed.includes('P10') && ROUTE_IDS.every(id => { const r = s.network.routes[id]; return r.imports >= 2 && r.contract.enabled && r.staff !== null && r.condition > 0; });
  if (id === 'P06') return s.completed.includes('P05') && s.events.E07?.status === 'claimed' && s.publicWorks.relay.built && s.publicWorks.registry.built && ['district-1', 'district-2'].every(id => localCount(districtState(s, id as DistrictId) ?? emptyDistrict()) >= 2);
  const services = servicePreview(s), specs = activeDistricts(s).map(id => specialization(districtState(s, id)!, services[id]?.light));
  return s.completed.includes('P06') && specs.includes('salvage') && specs.includes('record') && Boolean(services['district-0']?.public.relay && services['district-0']?.public.registry);
}
export function eventTriggers(s: GameState, services = servicePreview(s)): Record<EventId, boolean> {
  return {
    E01: s.completed.includes('P01'), E02: s.completed.includes('P02'), E03: cityPopulation(s, 'echo') > 0,
    E04: s.facilities.mailbox > 0 && s.earned.memory >= RULES.researchUnlockMemory, E05: s.completed.includes('P03'),
    E06: s.completed.includes('P04'), E07: s.completed.includes('P05'),
    E08: Boolean(s.events.E08) || (Boolean(s.address) && activeDistricts(s).some(id => specialization(districtState(s, id)!, services[id]?.light))),
    E09: s.completed.includes('P06'), E10: s.completed.includes('P07'),
    E11: s.completed.includes('P08'), E12: s.network.routes.rain.imports > 0,
    E13: s.completed.includes('P09'), E14: s.completed.includes('P10'), E15: s.completed.includes('P11')
  };
}
function triggerEvents(s: GameState, services?: Services) {
  const triggers = eventTriggers(s, services);
  for (const id of Object.keys(triggers) as EventId[]) if (triggers[id] && !s.events[id]) {
    s.events[id] = { status: 'pending' };
    log(s, id === 'E03' ? '一名回声居民抵达，照明选择等你决定。' : id === 'E04' ? '信箱收到一封明天的信，两项研究开放。' : `新的交接事项：${EVENTS[id].name}`);
  }
}
function completeProject(s: GameState, p: Project) {
  const d = districtState(s, p.district)!;
  if (p.definition.startsWith('route:')) {
    s.network.routes[p.definition.slice(6) as RouteId].condition = NETWORK_RULES.condition;
    s.network.maintenance += 1;
  } else if (p.definition.startsWith('maintain:')) {
    d.publicWorks[p.definition.slice(9) as PublicFacility].condition = CITY_RULES.condition;
    s.city.maintenance += 1;
  } else {
    const key = projectKey(p);
    if (!s.completed.includes(key)) {
      s.completed.push(key);
      if (p.definition.startsWith('build:')) d.facilities[p.definition.slice(6) as Facility] = p.targetLevel;
      if (p.definition.startsWith('public:')) d.publicWorks[p.definition.slice(7) as PublicFacility] = { built: true, enabled: true, condition: CITY_RULES.condition };
      if (p.definition.startsWith('vehiclemod:')) s.network.vehicle.built.push(p.definition.slice(11) as VehicleMod);
      if (p.definition.startsWith('mailmod:')) s.neighborhood.mailboxes[p.district].built.push(p.definition.slice(8) as MailboxMod);
      if (p.definition.startsWith('mod:')) s.experience.benches[p.district].built.push(p.definition.slice(4) as AssemblyMod);
      if (p.definition.startsWith('blueprint:') && !s.experience.blueprints.includes(p.definition.slice(10) as AssemblyMod)) s.experience.blueprints.push(p.definition.slice(10) as AssemblyMod);
      if (p.definition === 'P03') s.address = '0-001';
      if (p.definition === 'P04') s.city.districts['district-1'] = emptyDistrict();
      if (p.definition === 'P05') s.city.districts['district-2'] = emptyDistrict();
      if (p.definition === 'P08' || p.definition === 'P09') {
        const id = p.definition === 'P08' ? 'rain' : 'station', route = s.network.routes[id];
        route.condition = NETWORK_RULES.condition;
        if (!s.network.legacyPending) {
          const resource = productResource(id, 'normal');
          route.contract.targets[resource] = capacities(s)[resource];
        }
      }
    }
  }
  log(s, `完工：${definitionFor(s, p.definition, p.targetLevel, p.district).name}${p.district === 'district-0' ? '' : ` · ${DISTRICTS[p.district].name}`}`);
  s.queue.shift();
}
function pushProject(s: GameState, definition: DefinitionId, district: DistrictId, prefab = 0) {
  const targetLevel = definition.startsWith('build:') ? districtState(s, district)!.facilities[definition.slice(6) as Facility] + 1 : 1;
  s.queue.push({ uid: `q-${s.nextProject++}`, definition, district, targetLevel, prefab, legacyChapter: false, status: 'waiting', progress: 0, reserved: amounts() });
}
function scheduleMaintenance(s: GameState) {
  if (!s.completed.includes('R04')) return;
  for (const id of activeDistricts(s)) {
    const d = districtState(s, id)!;
    if (!d.autoRepair) continue;
    for (const f of PUBLIC_IDS) if (d.publicWorks[f].built && d.publicWorks[f].enabled && d.publicWorks[f].condition <= CITY_RULES.repairThreshold) {
      const definition = `maintain:${f}` as const;
      if (!enqueueReason(s, definition, id)) pushProject(s, definition, id);
    }
  }
  for (const id of ROUTE_IDS) if (routeOpen(s, id) && s.network.routes[id].autoRepair && s.network.routes[id].condition <= NETWORK_RULES.threshold && !enqueueReason(s, `route:${id}`)) pushProject(s, `route:${id}`, 'district-0');
}
interface TickResult { lightOn: boolean; services: Services; lightingCost: number; publicCost: number; output: Record<Job, number>; costs: Record<Job, Amounts>; reasons: string[] }
interface ProductionBudget { district: DistrictId; job: 'salvage' | 'record' | 'assemble'; wanted: number; inputs: Amounts; resource: keyof Amounts; capacityBlocked: boolean; produced: number; reserve?: Amounts }
function tick(s: GameState): TickResult {
  s.clock.seconds += 1;
  scheduleMaintenance(s);
  const result: TickResult = { lightOn: false, services: {}, lightingCost: 0, publicCost: 0, output: { power: 0, salvage: 0, repair: 0, record: 0, assemble: 0 }, costs: { power: amounts(), salvage: amounts(), repair: amounts(), record: amounts(), assemble: amounts() }, reasons: [] };
  const capacity = stockLimits(s), districts = activeDistricts(s), powerWanted = powerBudget(s);
  result.output.power = perform(s, powerWanted, amounts(), capacity.energy - s.resources.energy, 'energy');
  const budget = serviceBudget(s, s.resources.energy);
  result.services = budget.services; result.lightingCost = budget.lighting; result.publicCost = budget.upkeep;
  result.lightOn = budget.services['district-0']!.light;
  spend(s, amounts(budget.lighting + budget.upkeep), 'operating');
  for (const id of districts) {
    const d = districtState(s, id)!, service = budget.services[id]!;
    if (!service.light) result.reasons.push(`${id === 'district-0' ? '' : `${DISTRICTS[id].name}：`}照明供电不足，加成暂时失效`);
    for (const f of PUBLIC_IDS) if (d.publicWorks[f].built && d.publicWorks[f].enabled) {
      if (service.public[f]) d.publicWorks[f].condition -= 1;
      else result.reasons.push(`${DISTRICTS[id].name}${PUBLIC_WORKS[f].name}：${d.publicWorks[f].condition === 0 ? '状态耗尽，等待巡检' : '供电不足，效果暂停'}`);
    }
  }
  const production: ProductionBudget[] = [];
  let completed: Project | null = null;
  for (const job of s.priority) {
    const priorCosts = { ...s.ledger.operating };
    if (job === 'repair') {
      const p = s.queue[0], count = cityWorkers(s, 'repair');
      if (!count || !p || p.status === 'paused') continue;
      if (p.status === 'waiting') {
        if (projectReasons(s, p).length) continue;
        if (p.definition === 'P07' && !p.legacyChapter && !DISTRICT_IDS.every(id => budget.services[id]?.light)) continue;
        p.reserved = { ...definitionFor(s, p.definition, p.targetLevel, p.district, p.prefab).cost };
        spend(s, p.reserved, 'reserved'); p.status = 'running';
      }
      const work = definitionFor(s, p.definition, p.targetLevel, p.district, p.prefab).work, inputs = amounts();
      let wanted = 0;
      for (const id of districts) {
        const count = workers(s, 'repair', id), factor = budget.services[id]!.public.relay ? CITY_RULES.relayEnergy : 1;
        inputs.energy += Math.ceil(INPUTS.repair.energy * count * factor);
        wanted += Math.round(BASE.repair * count * efficiency(s, 'repair', id) * (s.completed.includes('R01') ? RESEARCH_EFFECTS.R01 : 1));
      }
      result.output.repair = perform(s, wanted, inputs, work - p.progress);
      p.progress += result.output.repair;
      if (p.progress >= work) completed = p;
      if (!result.output.repair) result.reasons.push('维修工等待电量');
    } else for (const id of districts) {
      const count = workers(s, job, id);
      if (!count) continue;
      const d = districtState(s, id)!, service = budget.services[id]!, inputs = amounts();
      if (job === 'assemble') {
        const plan = s.experience.assembly;
        if (!plan.enabled || !assemblyUnlocked(s)) { result.reasons.push('装配目标尚未启用，装配工待命'); continue; }
        const recipe = assemblyRecipe(s, id), wanted = Math.floor(recipe.rate * count * efficiency(s, job, id));
        inputs.parts = wanted * recipe.parts;
        // Keep the unit recipe exact; perform rounds only cumulative actual output.
        inputs.energy = wanted * recipe.energy * (service.public.relay ? CITY_RULES.relayEnergy : 1);
        const room = Math.max(0, Math.min(capacity.component, plan.target) - s.resources.component);
        const produced = perform(s, wanted, inputs, room, 'component', 0, plan.reserve);
        result.output.assemble += produced;
        production.push({ district: id, job, wanted, inputs, resource: 'component', capacityBlocked: room < wanted && produced === room, produced, reserve: plan.reserve });
        continue;
      }
      const voice = job === 'record' && s.neighborhood.mailboxes[id].active === 'voiceBox' && d.facilities.mailbox > 0;
      for (const r of RESOURCES) inputs[r] = Math.ceil(INPUTS[job][r] * count * (r === 'energy' && service.public.relay ? CITY_RULES.relayEnergy : 1) * (r === 'parts' && voice ? NEIGHBORHOOD_RULES.voiceParts : 1));
      const output = job === 'salvage' ? 'parts' : 'memory', lighting = service.light ? POLICIES[d.lighting][job] : 1;
      const research = job === 'record' && s.completed.includes('R02') ? RESEARCH_EFFECTS.R02 : 1;
      const specialized = s.address && specialization(d, service.light) === job ? CITY_RULES.specialization : 1;
      const publicFactor = job === 'record' && service.public.registry ? CITY_RULES.registryMemory : 1;
      const named = job === 'record' && s.events.E07?.choice === 'individual' ? CITY_RULES.namedMemory : 1;
      const wanted = Math.round(BASE[job] * weightedWorkers(s, job, id) * efficiency(s, job, id) * lighting * research * specialized * publicFactor * named * (voice ? NEIGHBORHOOD_RULES.voiceOutput : 1));
      const room = capacity[output] - s.resources[output], produced = perform(s, wanted, inputs, room, output);
      result.output[job] += produced;
      production.push({ district: id, job, wanted, inputs, resource: output, capacityBlocked: room < wanted && produced === room, produced });
    }
    for (const r of RESOURCES) result.costs[job][r] += s.ledger.operating[r] - priorCosts[r];
  }
  // Reuse only this second's unused capacity-blocked production, including
  // space opened by another district. Charge inputs on cumulative output.
  for (const job of ['assemble', 'record', 'salvage'] as const) for (const budget of production.filter(p => p.job === job)) {
    if (!budget.capacityBlocked) continue;
    const priorCosts = { ...s.ledger.operating };
    const room = (job === 'assemble' ? Math.min(capacity.component, s.experience.assembly.target) : capacity[budget.resource]) - s.resources[budget.resource];
    const added = perform(s, budget.wanted, budget.inputs, room, budget.resource, budget.produced, budget.reserve);
    budget.produced += added; result.output[job] += added;
    for (const r of RESOURCES) result.costs[job][r] += s.ledger.operating[r] - priorCosts[r];
  }
  result.output.power += perform(s, powerWanted, amounts(), capacity.energy - s.resources.energy, 'energy', result.output.power);
  if (result.output.record > 0) s.memoryProduced = true;
  for (const budget of production) if (budget.produced < budget.wanted) {
    const prefix = budget.district === 'district-0' ? '' : `${DISTRICTS[budget.district].name}：`;
    if (budget.job === 'assemble') {
      result.reasons.push(prefix + (s.resources.component >= Math.min(capacity.component, s.experience.assembly.target) ? '达到构件目标，装配工待命' : '装配等待原料或保留库存，按可用供给减产'));
      continue;
    }
    result.reasons.push(prefix + (s.resources[budget.resource] >= capacity[budget.resource] ? `${resourceNames[budget.resource]}满仓，${jobNames[budget.job]}停止或减产` : `${jobNames[budget.job]}原料不足，停止或减产`));
  }
  if (powerWanted > result.output.power && s.resources.energy >= capacity.energy) result.reasons.push(result.output.power ? '电量满仓，发电工按消耗补充' : '电量满仓，发电工待命');
  const open = districts.filter(id => localCount(districtState(s, id)!) < localBeds(districtState(s, id)!, id));
  if (s.completed.includes('P01') && open.length) {
    s.arrivalSeconds += 1;
    if (s.arrivalSeconds >= arrivalInterval(s)) {
      const type: Resident = s.arrivals < RULES.firstEchoArrivals ? 'echo' : (s.arrivals - RULES.firstEchoArrivals) % 2 === 0 ? 'shadow' : 'echo';
      const preferred = type === 'echo' ? 'bright' : 'dim';
      const id = open.find(id => budget.services[id]!.light && districtState(s, id)!.lighting === preferred) ?? open[0];
      districtState(s, id)!.population[type] += 1; s.arrivals += 1; s.arrivalSeconds = 0;
      log(s, `${type === 'echo' ? '回声居民入住，带来一些旧声音。' : '影子居民入住，带来一袋无人认领的螺丝。'}${id === 'district-0' ? '' : `住处：${DISTRICTS[id].name}。`}`);
    }
  } else s.arrivalSeconds = 0;
  if (completed) completeProject(s, completed);
  tickNetwork(s, capacities(s), text => log(s, text));
  tickNeighborhood(s, stockLimits(s), id => budget.services[id]?.light ?? false, text => log(s, text));
  triggerEvents(s, budget.services);
  return result;
}

export function advance(state: GameState, elapsedMs: number): GameState {
  if (!Number.isFinite(elapsedMs)) throw new Error('经过时间必须是有限数值');
  const s = structuredClone(state);
  const total = s.clock.remainderMs + Math.max(0, Math.floor(elapsedMs));
  const seconds = Math.floor(total / 1000);
  s.clock.remainderMs = total % 1000;
  for (let i = 0; i < seconds; i++) tick(s);
  return s;
}
export function advanceTo(s: GameState, now: number): GameState {
  const advanced = advance(s, Math.max(0, now - s.clock.lastAt));
  // Keep a high-water mark when the system clock moves backward.
  advanced.clock.lastAt = Math.max(now, s.clock.lastAt);
  return advanced;
}
export function goal(s: GameState): string {
  if (s.completed.includes('P11')) return '末班车每天抵达。下一张城市图，正等待一间分所。';
  if (s.completed.includes('P07')) {
    if (s.events.E10?.status !== 'claimed') return '归档雨城的来信，开始修复末班车厢';
    if (!s.completed.includes('P08')) return '修复末班车厢，让问候变成真正的抵达';
    if (!s.network.routes.rain.imports) return '外派一位空闲夜工，补给雨城并取回第一只箱子';
    if (s.events.E12?.status !== 'claimed') return '决定末班车采用稳班还是快班';
    if (!s.completed.includes('P09')) return '恢复长站货台，接通第二条供需线路';
    if (!s.completed.includes('R05') || !s.completed.includes('R06')) return '研究运单规范与联运调度，安排共享列车';
    if (!s.completed.includes('P10')) return '两地各取回一车物资，编定联运时刻表';
    return '两地各一次回程，维持一条有目标的有效合同，让末班车每天抵达';
  }
  if (s.address) {
    if (s.events.E05?.status !== 'claimed') return '读完第一个地址的来信，开始测绘夜城';
    if (!s.completed.includes('P04')) return '测绘旧巷，让地图走出第0街区';
    if (!s.completed.includes('P05')) return '为信笺里补上门牌，连接第三个地址';
    if (s.events.E07?.status !== 'claimed') return '决定两家如何共用门牌';
    if (!s.completed.includes('P06')) return '给新区安排住处与居民，编成夜城地址簿';
    return '选择生产保障或街区协作，接通雨城联络线';
  }
  if (!s.completed.includes('P01')) return '让临时路灯重新亮起';
  if (!s.facilities.dorm) return '建一间宿舍，给夜工一个住处';
  if (!s.completed.includes('P02')) return '给站牌写上“0”';
  if (!s.facilities.mailbox) return '建造回声信箱，让旧物留下声音';
  if (!s.facilities.warehouse) return '建造后场仓库，为站台备料';
  if (s.earned.memory < RULES.platformUnlockMemory) return `安排记录员，累计取得 ${format(RULES.platformUnlockMemory)} 记忆`;
  return '修复旧站台，登记地址 0-001';
}
export function view(s: GameState) {
  const next = structuredClone(s);
  const tickResult = tick(next);
  const net = amounts(), production = amounts(), operating = amounts();
  for (const r of RESOURCES) {
    production[r] = next.ledger.production[r] - s.ledger.production[r];
    operating[r] = next.ledger.operating[r] - s.ledger.operating[r];
    net[r] = production[r] - operating[r] + next.ledger.imports[r] - s.ledger.imports[r] - next.ledger.exports[r] + s.ledger.exports[r] + next.ledger.rewards[r] - s.ledger.rewards[r] - next.ledger.fulfillment[r] + s.ledger.fulfillment[r] - next.ledger.fieldReserved[r] + s.ledger.fieldReserved[r];
  }
  const reasons = [...projectReasons(s), ...tickResult.reasons, ...networkReasons(s, capacities(s))];
  const field = s.neighborhood.field, plan = s.neighborhood.delegation;
  if (field.queue.length && !field.active) { const why = fieldStartReason(s, field.queue[0], 'supply'); if (why) reasons.push(`预排外勤：${why}`); }
  if (plan.enabled && plan.stages.length) { const why = delegationReason(s, servicePreview(s)[plan.district]?.light ?? false, stockLimits(s)); if (why) reasons.push(why); }
  for (const id of activeDistricts(s)) {
    const d = districtState(s, id)!;
    if (d.autoRepair && PUBLIC_IDS.some(f => d.publicWorks[f].built && d.publicWorks[f].enabled && d.publicWorks[f].condition <= CITY_RULES.repairThreshold && !s.queue.some(p => p.district === id && p.definition === `maintain:${f}`))) reasons.push(`${DISTRICTS[id].name}自动巡检等待队列空位`);
  }
  return { capacities: capacities(s), net, production, operating, costs: tickResult.costs, output: tickResult.output, lightOn: tickResult.lightOn, services: tickResult.services, lightingCost: tickResult.lightingCost, publicCost: tickResult.publicCost, reasons: [...new Set(reasons)], goal: goal(s) };
}
export function summarize(before: GameState, after: GameState, awayMs: number): ReturnReport {
  const flows = emptyLedger();
  for (const f of FLOWS) for (const r of RESOURCES) flows[f][r] = after.ledger[f][r] - before.ledger[f][r];
  return {
    awayMs: Math.max(0, awayMs), seconds: after.clock.seconds - before.clock.seconds,
    start: { ...before.resources }, end: { ...after.resources }, flows,
    completed: after.completed.filter(id => !before.completed.includes(id)),
    arrivals: { shadow: cityPopulation(after, 'shadow') - cityPopulation(before, 'shadow'), echo: cityPopulation(after, 'echo') - cityPopulation(before, 'echo') },
    events: (Object.keys(after.events) as EventId[]).filter(id => !before.events[id]),
    pending: (Object.keys(after.events) as EventId[]).filter(id => after.events[id]?.status === 'pending'),
    reasons: view(after).reasons, goal: goal(after), maintenance: after.city.maintenance - before.city.maintenance,
    transport: { departures: ROUTE_IDS.reduce((n, id) => n + after.network.routes[id].departures - before.network.routes[id].departures, 0), deliveries: ROUTE_IDS.reduce((n, id) => n + after.network.routes[id].exports + after.network.routes[id].imports - before.network.routes[id].exports - before.network.routes[id].imports, 0), maintenance: after.network.maintenance - before.network.maintenance }
    , stories: pendingStories(after), highlights: [
      ...after.completed.filter(id => !before.completed.includes(id)).map(key => `完工：${completionName(key)}`),
      ...(cityPopulation(after, 'echo') + cityPopulation(after, 'shadow') > cityPopulation(before, 'echo') + cityPopulation(before, 'shadow') ? ['新的窗口亮了，住客已经入住。'] : []),
      ...(['rainFilm', 'railCore'] as const).filter(r => after.ledger.imports[r] > before.ledger.imports[r]).map(r => `${resourceNames[r]}实际到货 ${format(after.ledger.imports[r] - before.ledger.imports[r])}，可用于调查、委托与收藏。`),
      ...(after.resources.component > before.resources.component ? [`备好了 ${format(after.resources.component - before.resources.component)} 构件，可用于预制施工或改装。`] : [])
      , ...(after.neighborhood.field.returns > before.neighborhood.field.returns ? [`外勤已返程 ${after.neighborhood.field.returns - before.neighborhood.field.returns} 次，结果等你领取。`] : []),
      ...(after.neighborhood.delegation.deliveries > before.neighborhood.delegation.deliveries ? [`投递匣完成 ${after.neighborhood.delegation.deliveries - before.neighborhood.delegation.deliveries} 项已确认委托。`] : [])
    ].slice(0, 3),
    neighborhood: { deliveries: after.neighborhood.delegation.deliveries - before.neighborhood.delegation.deliveries, fieldReturns: after.neighborhood.field.returns - before.neighborhood.field.returns, pending: after.neighborhood.field.pending.length, held: heldFieldSupplies(after) }
  };
}
export function refundPreview(s: GameState, p: Project) {
  const full = amounts(), actual = amounts(), overflow = amounts();
  const work = definitionFor(s, p.definition, p.targetLevel, p.district, p.prefab).work;
  for (const r of RESOURCES) {
    full[r] = Math.floor(p.reserved[r] / UNIT * (work - p.progress) / work) * UNIT;
    actual[r] = Math.min(full[r], stockLimits(s)[r] - s.resources[r]);
    overflow[r] = full[r] - actual[r];
  }
  return { full, actual, overflow };
}
export function applyAction(state: GameState, action: Action): { state: GameState; error: string | null } {
  const s = structuredClone(state);
  const fail = (error: string) => ({ state, error });
  switch (action.type) {
    case 'production-mode': {
      if (!ROUTE_IDS.includes(action.route) || !routeOpen(s, action.route) || !MODES.includes(action.mode) || s.network.legacyPending) return fail('请先通车并完成旧版时间结算');
      const node = s.network.routes[action.route].node;
      if (node.mode === action.mode) return fail('已经使用这个生产模式');
      node.mode = action.mode; node.cycle = 0;
      log(s, `${ROUTES[action.route].name}切换生产模式，未结算周期已清零；库存及在途货物保留。`); break;
    }
    case 'vehicle-mod': {
      if (occupiedVehicles(s)) return fail('全网途中或待卸列车清空后才能切换车辆方案');
      if (action.mod !== null && !s.network.vehicle.built.includes(action.mod)) return fail('需要先制作车辆方案');
      s.network.vehicle.active = action.mod; break;
    }
    case 'archive': {
      if (!ARCHIVE_IDS.includes(action.id) || !archivesUnlocked(s) || s.experience.archives.includes(action.id)) return fail('档案尚未开放或已经复原');
      const def = ARCHIVES[action.id], missing = missingCost(s, def.cost);
      if (missing.length) return fail(missing.join('，'));
      spend(s, def.cost, 'fulfillment'); s.experience.archives.push(action.id);
      log(s, `档案复原：${def.name}。${def.text}`); break;
    }
    case 'mailbox-mod': {
      const d = districtState(s, action.district), box = s.neighborhood.mailboxes[action.district];
      if (!d?.facilities.mailbox || !box || action.mod !== null && !box.built.includes(action.mod)) return fail('需要本区信箱和已制作的方案');
      box.active = action.mod; break;
    }
    case 'commission-show': {
      if (!Array.isArray(action.stages) || action.stages.length > 3 || new Set(action.stages).size !== action.stages.length || action.stages.some(id => !commissionVisible(s, id))) return fail('请选择至多3项已开放的委托');
      for (const id of action.stages) s.neighborhood.commissions.shown[id] = s.neighborhood.commissions.nextShown++;
      break;
    }
    case 'commission-track': case 'commission-untrack': {
      const c = s.neighborhood.commissions, id = action.stage;
      if (action.type === 'commission-untrack') {
        if (!c.tracked.includes(id)) return fail('尚未追踪这个阶段');
        c.tracked = c.tracked.filter(stage => stage !== id);
        s.neighborhood.delegation.stages = s.neighborhood.delegation.stages.filter(stage => stage !== id);
      } else {
        if (!commissionVisible(s, id) || c.tracked.includes(id) || c.tracked.length >= 3) return fail('只能追踪至多3项已开放且未追踪的阶段');
        c.shown[id] = c.nextShown++; c.tracked.push(id);
      }
      break;
    }
    case 'commission-deliver': {
      const reason = deliverCommission(s, action.stage, stockLimits(s), text => log(s, text));
      if (reason) return fail(reason);
      break;
    }
    case 'field-start': {
      const reason = startField(s, action, action.kind, text => log(s, text));
      if (reason) return fail(reason);
      break;
    }
    case 'field-recall': {
      const reason = recallField(s, stockLimits(s), text => log(s, text));
      if (reason) return fail(reason);
      break;
    }
    case 'field-claim': {
      const reason = claimField(s, action.uid, stockLimits(s), text => log(s, text), action.choice);
      if (reason) return fail(reason);
      break;
    }
    case 'field-queue': {
      if (!Array.isArray(action.orders) || action.orders.length > 3 || action.orders.some(o => fieldOpenReason(s, o.site) || !s.neighborhood.field.sites[o.site].first || !districtState(s, o.district) || !RESIDENTS.includes(o.resident))) return fail('至多预排3次首访已领取的普通复访，指定来源街区与居民');
      s.neighborhood.field.queue = structuredClone(action.orders); break;
    }
    case 'delegate-plan': {
      const plan = s.neighborhood.delegation;
      if (!districtState(s, action.district)?.facilities.mailbox || s.neighborhood.mailboxes[action.district].active !== 'dispatchBox' || !s.completed.includes('R04')) return fail('需要本区启用投递匣并研究巡检手册');
      if (!Array.isArray(action.stages) || !action.stages.length || action.stages.length > 3 || new Set(action.stages).size !== action.stages.length || action.stages.some(id => !COMMISSION_IDS.includes(id) || !s.neighborhood.commissions.tracked.includes(id) || !s.neighborhood.commissions.shown[id])) return fail('请确认至多3项已展示且已追踪的阶段，不会自动续接');
      if (!action.reserve || RESOURCES.some(r => !Number.isSafeInteger(action.reserve[r]) || action.reserve[r] < 0 || action.reserve[r] > NEIGHBORHOOD_RULES.maxSetting)) return fail('保留量需为0至1,000,000，最多3位小数');
      s.neighborhood.delegation = { ...plan, district: action.district, stages: [...action.stages], reserve: { ...action.reserve }, enabled: true }; break;
    }
    case 'delegate-pause': s.neighborhood.delegation.enabled = false; break;
    case 'assign': {
      const { resident, job, delta } = action;
      const id = action.district ?? 'district-0', d = districtState(s, id);
      if (!d) return fail('先测绘这个街区');
      if (!RESIDENTS.includes(resident) || !JOBS.includes(job) || (delta !== 1 && delta !== -1)) return fail('无效岗位操作');
      if (delta > 0 && freeResidents(s, resident, id) <= 0) return fail('这类居民没有空闲人手，请先撤回其他岗位');
      if (delta > 0 && jobSlotsUsed(s, job, id) >= jobCapacity(s, job, id)) return fail(job === 'repair' || job === 'assemble' ? '维修与装配共享岗位容量已满，或装配尚未开放' : '岗位容量已满或设施尚未建设');
      if (delta < 0 && d.assignments[resident][job] <= 0) return fail('该岗位没有可撤回的居民');
      d.assignments[resident][job] += delta;
      break;
    }
    case 'priority':
      if (action.order.length !== WORK_JOBS.length || new Set(action.order).size !== WORK_JOBS.length || !WORK_JOBS.every(j => action.order.includes(j))) return fail('优先级需要完整且不重复的岗位');
      s.priority = [...action.order]; break;
    case 'enqueue': {
      const id = action.district ?? 'district-0', reason = enqueueReason(s, action.definition, id);
      if (reason) return fail(reason);
      const count = action.prefab ?? 0, limit = prefabLimit(definitionFor(s, action.definition, undefined, id));
      if (!Number.isSafeInteger(count) || count < 0 || count > limit || (count > 0 && !assemblyUnlocked(s))) return fail('预制份数超出本项目上限，或尚未阅读装配纸条');
      pushProject(s, action.definition, id, count);
      break;
    }
    case 'assembly-plan': {
      if (!assemblyUnlocked(s)) return fail('先阅读装配纸条');
      if (typeof action.enabled !== 'boolean' || !Number.isSafeInteger(action.target) || action.target < 0 || action.target > ASSEMBLY.maxSetting || !action.reserve || RESOURCES.some(r => !Number.isSafeInteger(action.reserve[r]) || action.reserve[r] < 0 || action.reserve[r] > ASSEMBLY.maxSetting) || action.reserve.memory || action.reserve.component || action.reserve.rainFilm || action.reserve.railCore) return fail('目标与保留量需为0至1,000,000，最多3位小数；装配只保留电量和零件');
      s.experience.assembly = { enabled: action.enabled, target: action.target, reserve: { ...action.reserve } }; break;
    }
    case 'assembly-mod': {
      const d = districtState(s, action.district), bench = s.experience.benches[action.district];
      if (!d?.facilities.workbench || !bench || !assemblyUnlocked(s) || (action.mod !== null && !bench.built.includes(action.mod))) return fail('需要本区维修台和已制作的方案');
      bench.active = action.mod; break;
    }
    case 'story': {
      if (!storyAvailable(s, action.node)) return fail('这项住客来信尚未开放或已经处理');
      if (action.node === 'L01-2') {
        if (action.choice !== 'dismantle' && action.choice !== 'restore') return fail('请选择拆解或修复收音机');
        const payment = action.choice === 'restore' ? ASSEMBLY.restoreCost : amounts(), reward = action.choice === 'dismantle' ? ASSEMBLY.dismantleReward : amounts();
        const missing = missingCost(s, payment);
        if (missing.length) return fail(missing.join('，'));
        if (RESOURCES.some(r => s.resources[r] - payment[r] + reward[r] > stockLimits(s)[r])) return fail('奖励所需容量不足，整份来信保留待处理');
        spend(s, payment, 'fulfillment');
        for (const r of RESOURCES) credit(s, r, reward[r], 'rewards');
        const mod = action.choice === 'restore' ? 'thriftBench' : 'quickJig';
        if (!s.experience.blueprints.includes(mod)) s.experience.blueprints.push(mod);
        s.experience.story[action.node] = { choice: action.choice };
      } else {
        if (action.choice !== undefined) return fail('这封来信无需选择分支');
        s.experience.story[action.node] = {};
        if (action.node === 'L02-3' && !s.experience.blueprints.includes('dispatchBox')) s.experience.blueprints.push('dispatchBox');
      }
      log(s, `住客回信：${STORY_NAMES[action.node]}${action.node === 'L01-2' ? action.choice === 'restore' ? '，收音机的声音留了下来。' : '，外壳留作工具盒。' : '。'}`);
      break;
    }
    case 'scrap': {
      if (!assemblyUnlocked(s) || !Number.isSafeInteger(action.count) || action.count < 1 || action.count * UNIT > s.resources.component) return fail('请选择库存内的整份构件');
      const returned = action.count * ASSEMBLY.scrapParts;
      if (returned > stockLimits(s).parts - s.resources.parts) return fail('拆回零件所需空间不足');
      spend(s, amounts(0, 0, 0, action.count * UNIT), 'fulfillment');
      credit(s, 'parts', returned, 'refunds'); break;
    }
    case 'move': {
      const index = s.queue.findIndex(p => p.uid === action.uid);
      const other = index + action.direction;
      if (index < 0 || other < 0 || other >= s.queue.length || s.queue[index].status !== 'waiting' || s.queue[other].status !== 'waiting') return fail('只能重排尚未开工的项目');
      [s.queue[index], s.queue[other]] = [s.queue[other], s.queue[index]]; break;
    }
    case 'pause': case 'resume': case 'cancel': {
      const p = s.queue.find(p => p.uid === action.uid);
      if (!p) return fail('项目已不在队列中');
      if (action.type === 'pause') {
        if (p.status !== 'running') return fail('只能暂停已开工项目');
        p.status = 'paused';
      } else if (action.type === 'resume') {
        if (p.status !== 'paused') return fail('该项目没有暂停');
        p.status = 'running';
      } else {
        const refunds = refundPreview(s, p);
        for (const r of RESOURCES) credit(s, r, refunds.actual[r], 'refunds');
        s.queue = s.queue.filter(item => item.uid !== action.uid);
        log(s, `取消：${definitionFor(s, p.definition, p.targetLevel, p.district).name}，剩余费用已按容量返还。`);
      }
      break;
    }
    case 'lighting': {
      const d = districtState(s, action.district ?? 'district-0');
      if (!d) return fail('先测绘这个街区');
      if (!s.lightingChosen || !s.events.E03 || !(action.lighting in POLICIES)) return fail('请先在“有人来住”事件中选择照明');
      if (d.lighting === action.lighting) return fail('已使用该照明策略');
      if (s.resources.parts < RULES.switchParts) return fail('切换需要 5 零件');
      spend(s, amounts(0, RULES.switchParts), 'operating'); d.lighting = action.lighting; break;
    }
    case 'event': {
      const e = s.events[action.event];
      if (!e || e.status !== 'pending') return fail('该事件尚未出现或已经处理');
      if (action.event === 'E03') {
        if (action.choice !== 'bright' && action.choice !== 'dim') return fail('请选择明灯或暗灯');
        s.lighting = action.choice; s.lightingChosen = true; e.choice = action.choice;
      } else if (action.event === 'E07') {
        if (action.choice !== 'common' && action.choice !== 'individual') return fail('请选择共灯或各留姓名');
        e.choice = action.choice;
      } else if (action.event === 'E12') {
        if (action.choice !== 'reliable' && action.choice !== 'express') return fail('请选择稳班或快班');
        e.choice = action.choice;
      } else {
        const reward = EVENTS[action.event].reward, cap = stockLimits(s);
        if (RESOURCES.some(r => s.resources[r] + reward[r] > cap[r])) return fail('奖励所需容量不足，请先腾出空间；整份奖励保留待领取');
        for (const r of RESOURCES) credit(s, r, reward[r], 'rewards');
      }
      e.status = 'claimed'; log(s, `已处理交接事项：${EVENTS[action.event].name}`); triggerEvents(s); break;
    }
    case 'relocate': {
      const from = districtState(s, action.from), to = districtState(s, action.to);
      if (!s.address || !from || !to || action.from === action.to || !RESIDENTS.includes(action.resident)) return fail('请选择两个已测绘的不同街区');
      if (freeResidents(s, action.resident, action.from) <= 0) return fail('只能迁居空闲居民，请先撤回岗位或召回外派夜工');
      if (localCount(to) >= localBeds(to, action.to)) return fail('目的街区没有空余住处');
      from.population[action.resident] -= 1; to.population[action.resident] += 1;
      log(s, `${action.resident === 'shadow' ? '影子居民' : '回声居民'}迁居至${DISTRICTS[action.to].name}。`);
      break;
    }
    case 'public-toggle': {
      const d = districtState(s, action.district);
      if (!d || !PUBLIC_IDS.includes(action.facility) || !d.publicWorks[action.facility].built) return fail('公共设施尚未建设');
      d.publicWorks[action.facility].enabled = !d.publicWorks[action.facility].enabled; break;
    }
    case 'auto-repair': {
      const d = districtState(s, action.district);
      if (!d || !s.completed.includes('R04')) return fail('先研究巡检手册');
      d.autoRepair = action.enabled; break;
    }
    case 'template-save': {
      const d = districtState(s, action.district), name = action.name.trim();
      if (!s.address || !d) return fail('首章结束后开放工作模板');
      if (!name || name.length > 24) return fail('模板名称需要1至24个字');
      const index = s.city.templates.findIndex(t => t.name === name);
      if (index < 0 && s.city.templates.length >= CITY_RULES.maxTemplates) return fail('最多保存3套模板，请先删除一套');
      const template = { name, district: action.district, assignments: structuredClone(d.assignments), lighting: d.lighting, priority: [...s.priority] };
      if (index < 0) s.city.templates.push(template); else s.city.templates[index] = template;
      break;
    }
    case 'template-apply': case 'template-delete': {
      const t = s.city.templates.find(t => t.name === action.name);
      if (!t) return fail('模板不存在');
      if (action.type === 'template-delete') { s.city.templates = s.city.templates.filter(t => t.name !== action.name); break; }
      const d = districtState(s, t.district)!;
      if (RESIDENTS.some(r => JOBS.reduce((n, j) => n + t.assignments[r][j], 0) + awayWorkers(s, t.district, r) + Number(s.neighborhood.field.active?.district === t.district && s.neighborhood.field.active.resident === r) > d.population[r])) return fail('模板所需居民不足或正在外派，当前安排保留');
      if (JOBS.some(j => RESIDENTS.reduce((n, r) => n + t.assignments[r][j], 0) > jobCapacity(s, j, t.district))) return fail('模板所需岗位容量不足，当前安排保留');
      if (RESIDENTS.reduce((n, r) => n + t.assignments[r].repair + t.assignments[r].assemble, 0) > jobCapacity(s, 'repair', t.district)) return fail('模板超过维修与装配共享岗位上限，当前安排保留');
      if (d.lighting !== t.lighting) {
        if (!s.lightingChosen || s.resources.parts < RULES.switchParts) return fail('模板切换照明需要已开放照明与5零件，当前安排保留');
        spend(s, amounts(0, RULES.switchParts), 'operating');
      }
      d.assignments = structuredClone(t.assignments); d.lighting = t.lighting; s.priority = [...t.priority]; break;
    }
    case 'dismantle': {
      const reason = dismantleReason(s, action.district, action.facility);
      if (reason) return fail(reason);
      const d = districtState(s, action.district)!;
      const isPublic = PUBLIC_IDS.includes(action.facility as PublicFacility);
      if (isPublic) d.publicWorks[action.facility as PublicFacility] = { built: false, enabled: true, condition: 0 };
      else d.facilities[action.facility as Facility] = 0;
      if (action.facility === 'workbench') s.experience.benches[action.district].active = null;
      if (action.facility === 'mailbox') s.neighborhood.mailboxes[action.district].active = null;
      const cap = stockLimits(s);
      if (RESOURCES.some(r => s.resources[r] > cap[r])) return fail('拆除后仓储不足以容纳库存和在途预留，请先使用库存或等货到站');
      const prefix = scopedKey(`${isPublic ? 'public' : 'build'}:${action.facility}`, action.district);
      s.completed = s.completed.filter(key => key !== prefix && !key.startsWith(`${prefix}:`));
      log(s, `${DISTRICTS[action.district].name}拆除闲置设施，空出一个地块。材料不返还。`); break;
    }
    case 'dispatch': {
      const reason = dispatch(s, action.route, action.direction, action.loads, capacities(s), text => log(s, text));
      if (reason) return fail(reason);
      break;
    }
    case 'network-staff': {
      if (!ROUTE_IDS.includes(action.route) || !routeOpen(s, action.route)) return fail('先开放这条线路');
      const route = s.network.routes[action.route];
      if (action.delta === -1) {
        if (!route.staff || route.trip) return fail('没有可召回人员，或列车仍在运输、等待卸货');
        route.staff = null;
      } else {
        if (action.delta !== 1 || route.staff || !districtState(s, action.district) || !RESIDENTS.includes(action.resident) || freeResidents(s, action.resident, action.district) <= 0) return fail('需要一名空闲夜工，请先撤回岗位');
        route.staff = { district: action.district, resident: action.resident };
      }
      break;
    }
    case 'contract-pause': {
      if (!ROUTE_IDS.includes(action.route)) return fail('未知线路');
      s.network.routes[action.route].contract.enabled = false; break;
    }
    case 'contract': {
      if (!ROUTE_IDS.includes(action.route) || !routeOpen(s, action.route) || !s.completed.includes('R05')) return fail('先开放线路并研究运单规范');
      const before = s.network.routes[action.route].contract, targets = action.targets ?? { ...before.targets };
      const contract = { ...before, enabled: action.enabled, loads: action.loads, reserve: action.reserve, targets, buffer: action.buffer ?? before.buffer, manifest: action.manifest ?? { normal: action.loads, specialty: 0 }, order: action.order ?? before.order };
      if (!validContract(action.route, contract)) return fail('合同需有效目标、保留量、1–8周期缓冲和0–32整包货单');
      s.network.routes[action.route].contract = structuredClone(contract); break;
    }
    case 'network-priority': {
      if (action.order.length !== ROUTE_IDS.length || new Set(action.order).size !== ROUTE_IDS.length || !ROUTE_IDS.every(id => action.order.includes(id))) return fail('线路优先级必须完整且不重复');
      s.network.priority = [...action.order]; break;
    }
    case 'route-auto': {
      if (!ROUTE_IDS.includes(action.route) || !routeOpen(s, action.route) || !s.completed.includes('R04') || typeof action.enabled !== 'boolean') return fail('先开放线路并研究巡检手册');
      s.network.routes[action.route].autoRepair = action.enabled; break;
    }
    case 'theme': s.theme = action.theme; break;
    case 'dismiss-report': s.report = null; break;
  }
  triggerEvents(s);
  return { state: s, error: null };
}
export function format(value: number, decimals = 2) {
  return (value / UNIT).toLocaleString('zh-CN', { maximumFractionDigits: decimals });
}
export function duration(seconds: number) {
  if (!Number.isFinite(seconds)) return '等待条件';
  if (seconds < 60) return `${Math.ceil(seconds)} 秒`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分 ${Math.ceil(seconds % 60)} 秒`;
  return `${Math.floor(seconds / 3600)} 小时 ${Math.floor(seconds % 3600 / 60)} 分`;
}
export function parseCompletionKey(key: string): { district: DistrictId; local: string } | null {
  const pieces = key.split('/');
  if (pieces.length > 2) return null;
  const district = (pieces.length === 2 ? pieces[0] : 'district-0') as DistrictId, local = pieces.at(-1)!;
  if (!DISTRICT_IDS.includes(district) || (pieces.length === 2 && district === 'district-0')) return null;
  if (Object.hasOwn(PROJECTS, local)) return district === 'district-0' ? { district, local } : null;
  if (local.startsWith('vehiclemod:') && VEHICLE_MOD_IDS.includes(local.slice(11) as VehicleMod)) return district === 'district-0' ? { district, local } : null;
  if (local.startsWith('mailmod:') && MAIL_MOD_IDS.includes(local.slice(8) as MailboxMod)) return { district, local };
  if (local.startsWith('mod:') && MOD_IDS.includes(local.slice(4) as AssemblyMod)) return { district, local };
  if (local.startsWith('blueprint:') && MOD_IDS.includes(local.slice(10) as AssemblyMod)) return district === 'district-0' ? { district, local } : null;
  const build = /^build:([^:]+):([1-3])$/.exec(local);
  if (build && FACILITY_IDS.includes(build[1] as Facility)) return { district, local };
  if (local.startsWith('public:') && PUBLIC_IDS.includes(local.slice(7) as PublicFacility)) return { district, local };
  return null;
}
export function completionName(key: string): string {
  const parsed = parseCompletionKey(key);
  if (!parsed) return key;
  const { district, local } = parsed;
  let name: string;
  if (Object.hasOwn(PROJECTS, local)) name = PROJECTS[local as keyof typeof PROJECTS].name;
  else if (local.startsWith('vehiclemod:')) name = `制作${VEHICLE_MODS[local.slice(11) as VehicleMod].name}`;
  else if (local.startsWith('mailmod:')) name = `制作${MAIL_MODS[local.slice(8) as MailboxMod].name}`;
  else if (local.startsWith('mod:') || local.startsWith('blueprint:')) name = `${local.startsWith('mod:') ? '制作' : '整理工具清单：'}${ASSEMBLY.recipes[local.split(':')[1] as AssemblyMod].name}`;
  else if (local.startsWith('public:')) name = `建设${PUBLIC_WORKS[local.slice(7) as PublicFacility].name}`;
  else {
    const [, facility, level] = local.split(':');
    name = `${FACILITIES[facility as Facility].name} · ${level}级`;
  }
  return district === 'district-0' ? name : `${DISTRICTS[district].name} · ${name}`;
}
export function policyName(lighting: Lighting) { return POLICIES[lighting].name; }
