import { BALANCE_VERSION, EVENT_IDS, FACILITY_IDS, FLOWS, INITIAL, JOBS, POLICIES, PROJECTS, RESIDENTS, RESOURCES, RULES } from './config';
import { capacities, createGame, definitionFor, eventTriggers, jobCapacity, parseCompletionKey, projectKey } from './engine';
import type { Amounts, EventId, GameState, Ledger, ReturnReport } from './types';
import type { DistrictId, DistrictState, WorkTemplate, PublicFacility } from './types';
import { activeDistricts, cityCount, cityPopulation, CITY_RULES, districtState, DISTRICTS, DISTRICT_IDS, emptyDistrict, localBeds, localCount, plotsUsed, PUBLIC_IDS, scopedKey } from './city';
import { awayWorkers, cargoFor, createNetwork, fleetSize, NETWORK_RULES, occupiedVehicles, ROUTE_IDS, ROUTES, routeOpen, vehicleCapacity } from './network';
import type { NetworkState } from './types';

export interface SaveEnvelope { format: 'districtzero'; schemaVersion: 3; balanceVersion: string; savedAt: number; state: GameState; migratedFrom?: 1 | 2 }
export class SaveVersionError extends Error {
  constructor(reason: string) { super(`存档无效：${reason}`); this.name = 'SaveVersionError'; }
}
const LEGACY_PROJECT_IDS = ['P01', 'P02', 'P03', 'R01', 'R02'];
const V2_PROJECT_IDS = [...LEGACY_PROJECT_IDS, 'P04', 'P05', 'P06', 'P07', 'R03', 'R04'];
const bad = (reason: string): never => { throw new Error(`存档无效：${reason}`); };
function obj(v: unknown): Record<string, unknown> { return v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : bad('需要数据对象'); }
function integer(v: unknown, label: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= max ? v : bad(`${label}超出范围或不是整数`);
}
function choice<T extends string>(v: unknown, options: readonly T[], label: string): T {
  return typeof v === 'string' && options.includes(v as T) ? v as T : bad(`${label}不受支持`);
}
function strings(v: unknown, label: string, max = 100): string[] {
  if (!Array.isArray(v) || v.length > max || v.some(x => typeof x !== 'string' || x.length > 1000)) bad(`${label}格式错误`);
  return v as string[];
}
function readAmounts(v: unknown, label: string): Amounts {
  const o = obj(v);
  return { energy: integer(o.energy, label), parts: integer(o.parts, label), memory: integer(o.memory, label) };
}
function readLedger(v: unknown, schema = 3): Ledger {
  const o = obj(v);
  return Object.fromEntries(FLOWS.map(f => {
    if (schema < 3 && (f === 'imports' || f === 'exports')) {
      if (o[f] !== undefined && RESOURCES.some(r => readAmounts(o[f], f)[r] !== 0)) bad('旧版不支持运输账本');
      return [f, { energy: 0, parts: 0, memory: 0 }];
    }
    return [f, readAmounts(o[f], f)];
  })) as Ledger;
}
function readReport(v: unknown, schema = 3): ReturnReport | null {
  if (v === null) return null;
  const o = obj(v), arrivals = obj(o.arrivals);
  const ids = EVENT_IDS.slice(0, schema === 1 ? 5 : schema === 2 ? 10 : EVENT_IDS.length);
  const events = strings(o.events, '报告事件', ids.length).map(e => choice(e, ids, '报告事件'));
  const pending = strings(o.pending, '待处理事件', ids.length).map(e => choice(e, ids, '待处理事件'));
  const completed = strings(o.completed, '报告完工记录');
  for (const key of completed) {
    const parsed = parseCompletionKey(key);
    if (!parsed || (schema < 3 && !parsed.local.startsWith('build:') && !(schema === 1 ? LEGACY_PROJECT_IDS : [...V2_PROJECT_IDS, 'public:relay', 'public:registry']).includes(parsed.local)) || (schema === 1 && parsed.district !== 'district-0')) bad('报告完工记录包含未知或不兼容的标识');
  }
  if (typeof o.goal !== 'string' || o.goal.length > 1000) bad('报告目标格式错误');
  const report: ReturnReport = {
    awayMs: integer(o.awayMs, '离开时长'), seconds: integer(o.seconds, '结算时长'),
    start: readAmounts(o.start, '开始库存'), end: readAmounts(o.end, '结束库存'), flows: readLedger(o.flows, schema),
    completed, arrivals: { shadow: integer(arrivals.shadow, '新居民'), echo: integer(arrivals.echo, '新居民') },
    events, pending, reasons: strings(o.reasons, '停工原因'), goal: o.goal as string, maintenance: schema === 1 ? 0 : integer(o.maintenance, '巡检次数'),
    transport: schema < 3 ? { departures: 0, deliveries: 0, maintenance: 0 } : (() => { const t = obj(o.transport); return { departures: integer(t.departures, '发车次数'), deliveries: integer(t.deliveries, '到货次数'), maintenance: integer(t.maintenance, '线路维护次数') }; })()
  };
  for (const r of RESOURCES) {
    const expected = report.start[r] + report.flows.production[r] + report.flows.rewards[r] + report.flows.refunds[r] + report.flows.imports[r] - report.flows.exports[r] - report.flows.operating[r] - report.flows.reserved[r];
    if (report.end[r] !== expected) bad('返回报告收支不守恒');
  }
  return report;
}
function readAssignments(v: unknown): DistrictState['assignments'] {
  const assignment = obj(v);
  return Object.fromEntries(RESIDENTS.map(type => {
    const jobs = obj(assignment[type]);
    return [type, Object.fromEntries(JOBS.map(job => [job, integer(jobs[job], '分配人数', 0, 8)]))];
  })) as DistrictState['assignments'];
}
function readDistrict(v: unknown, legacy = false): DistrictState {
  const o = obj(v), f = obj(o.facilities), population = obj(o.population), base = emptyDistrict();
  const works = legacy ? null : obj(o.publicWorks);
  if (!legacy && typeof o.autoRepair !== 'boolean') bad('巡检开关格式错误');
  return {
    facilities: Object.fromEntries(FACILITY_IDS.map(id => [id, integer(f[id], '设施等级', 0, 3)])) as DistrictState['facilities'],
    population: { shadow: integer(population.shadow, '影子居民', 0, 8), echo: integer(population.echo, '回声居民', 0, 8) },
    assignments: readAssignments(o.assignments), lighting: choice(o.lighting, Object.keys(POLICIES) as DistrictState['lighting'][], '照明'),
    publicWorks: works ? Object.fromEntries(PUBLIC_IDS.map(id => {
      const f = obj(works[id]);
      if (typeof f.built !== 'boolean' || typeof f.enabled !== 'boolean') bad('公共设施状态错误');
      return [id, { built: f.built, enabled: f.enabled, condition: integer(f.condition, '设备状态', 0, CITY_RULES.condition) }];
    })) as DistrictState['publicWorks'] : base.publicWorks,
    autoRepair: legacy ? false : o.autoRepair as boolean
  };
}
function readPriority(v: unknown): GameState['priority'] {
  const order = strings(v, '优先级', 3).map(j => choice(j, ['salvage', 'repair', 'record'] as const, '优先级'));
  if (order.length !== 3 || new Set(order).size !== 3) bad('工作优先级不完整');
  return order;
}
function readTemplates(v: unknown): WorkTemplate[] {
  if (!Array.isArray(v) || v.length > CITY_RULES.maxTemplates) bad('工作模板格式错误');
  return (v as unknown[]).map(v => {
    const t = obj(v);
    if (typeof t.name !== 'string' || !t.name.trim() || t.name !== t.name.trim() || t.name.length > 24) bad('模板名称错误');
    return { name: t.name as string, district: choice(t.district, DISTRICT_IDS, '模板街区'),
      assignments: readAssignments(t.assignments), lighting: choice(t.lighting, ['steady', 'bright', 'dim'] as const, '模板照明'), priority: readPriority(t.priority) };
  });
}
function readNetwork(v: unknown): NetworkState {
  const o = obj(v), routes = obj(o.routes);
  if (Object.keys(routes).length !== ROUTE_IDS.length) bad('夜网线路不完整');
  const state: NetworkState = { priority: strings(o.priority, '线路优先级', 2).map(id => choice(id, ROUTE_IDS, '线路优先级')), nextTrip: integer(o.nextTrip, '运单序列', 1), maintenance: integer(o.maintenance, '线路维护次数'), routes: {} as NetworkState['routes'] };
  for (const id of ROUTE_IDS) {
    const route = obj(routes[id]), node = obj(route.node), contract = obj(route.contract);
    if (typeof route.autoRepair !== 'boolean' || typeof contract.enabled !== 'boolean') bad('线路开关格式错误');
    const staff = route.staff === null ? null : obj(route.staff), trip = route.trip === null ? null : obj(route.trip);
    if (contract.loads !== 1 && contract.loads !== 2) bad('合同货物份数错误');
    if (trip && ((trip.loads !== 1 && trip.loads !== 2) || typeof trip.uid !== 'string')) bad('运单份数或标识错误');
    state.routes[id] = {
      node: { resources: readAmounts(node.resources, '城市库存'), received: readAmounts(node.received, '城市收到'), produced: readAmounts(node.produced, '城市生产'), used: readAmounts(node.used, '城市消耗'), shipped: readAmounts(node.shipped, '城市发出'), cycle: integer(node.cycle, '城市生产计时', 0, NETWORK_RULES.cycle) },
      condition: integer(route.condition, '线路状态', 0, NETWORK_RULES.condition), autoRepair: route.autoRepair as boolean,
      contract: { enabled: contract.enabled as boolean, loads: contract.loads as 1 | 2, reserve: readAmounts(contract.reserve, '合同保留库存') },
      staff: staff ? { district: choice(staff.district, DISTRICT_IDS, '外派住处'), resident: choice(staff.resident, RESIDENTS, '外派居民') } : null,
      trip: trip ? { uid: trip.uid as string, direction: choice(trip.direction, ['outbound', 'inbound'] as const, '运输方向'), loads: trip.loads as 1 | 2, cargo: readAmounts(trip.cargo, '在途货物'), duration: integer(trip.duration, '运输总时长', 1), remaining: integer(trip.remaining, '运输余时') } : null,
      departures: integer(route.departures, '发车次数'), exports: integer(route.exports, '补给到货次数'), imports: integer(route.imports, '回程到货次数')
    };
  }
  return state;
}
function assertNetwork(s: GameState) {
  const network = readNetwork(s.network), seen = new Set<string>();
  if (network.priority.length !== 2 || new Set(network.priority).size !== 2) bad('线路优先级不完整');
  if (occupiedVehicles(s) > fleetSize(s)) bad('列车超出共享运力');
  let totalDepartures = 0;
  const exports = { energy: 0, parts: 0, memory: 0 }, imports = { ...exports };
  for (const id of ROUTE_IDS) {
    const route = network.routes[id], config = ROUTES[id], node = route.node, trip = route.trip;
    if (!routeOpen(s, id)) {
      const initial = createNetwork().routes[id];
      if (route.condition || route.staff || trip || route.autoRepair || route.contract.enabled || route.contract.loads !== 1 || route.departures || route.exports || route.imports || node.cycle || RESOURCES.some(r => route.contract.reserve[r] !== initial.contract.reserve[r] || node.resources[r] || node.received[r] || node.produced[r] || node.used[r] || node.shipped[r])) bad('未开放线路存在城市或运输进度');
    }
    if (route.contract.enabled && !s.completed.includes('R05')) bad('自动合同尚未解锁');
    if (route.autoRepair && !s.completed.includes('R04')) bad('线路自动维护尚未解锁');
    if (route.staff && !districtState(s, route.staff.district)) bad('外派人员来自未知街区');
    if (route.departures !== route.exports + route.imports + (trip ? 1 : 0)) bad('运单次数不守恒');
    totalDepartures += route.departures;
    const wholeBundles = (value: Amounts, bundle: Amounts, trips?: number) => {
      const unit = RESOURCES.find(r => bundle[r] > 0)!;
      const batches = value[unit] / bundle[unit];
      if (!Number.isSafeInteger(batches) || RESOURCES.some(r => value[r] !== bundle[r] * batches) || (trips !== undefined && (batches < trips || batches > 2 * trips))) bad('城市物资与配方或运单不一致');
      return batches;
    };
    wholeBundles(node.received, config.supply, route.exports);
    const cycles = wholeBundles(node.produced, config.product);
    if (RESOURCES.some(r => node.used[r] !== config.supply[r] * cycles)) bad('城市配方投入与产出不一致');
    wholeBundles(node.shipped, config.product, route.imports + (trip?.direction === 'inbound' ? 1 : 0));
    for (const r of RESOURCES) {
      integer(node.resources[r], '城市库存', 0, config.capacity[r]);
      if (node.resources[r] !== node.received[r] + node.produced[r] - node.used[r] - node.shipped[r]) bad('城市库存收支不守恒');
      exports[r] += node.received[r] + (trip?.direction === 'outbound' ? trip.cargo[r] : 0);
      imports[r] += node.shipped[r] - (trip?.direction === 'inbound' ? trip.cargo[r] : 0);
    }
    if (trip) {
      const uid = /^t-([1-9]\d*)$/.exec(trip.uid), expected = cargoFor(id, trip.direction, trip.loads);
      if (!route.staff || !uid || Number(uid[1]) >= network.nextTrip || seen.has(trip.uid)) bad('运单人员或序列错误');
      seen.add(trip.uid);
      if (RESOURCES.some(r => trip.cargo[r] !== expected[r]) || RESOURCES.reduce((n, r) => n + trip.cargo[r], 0) > vehicleCapacity(s)) bad('货物或单车运量错误');
      if (trip.remaining > trip.duration || (trip.duration !== config.seconds && !(s.events.E12?.choice === 'express' && trip.duration === Math.ceil(config.seconds * NETWORK_RULES.expressTime)))) bad('运输时长错误');
    }
  }
  if (network.nextTrip !== totalDepartures + 1) bad('运单序列与发车记录不一致');
  if (RESOURCES.some(r => exports[r] !== s.ledger.exports[r] || imports[r] !== s.ledger.imports[r])) bad('在途货物与两端运输账本不守恒');
}
export function assertInvariants(s: GameState, legacy = false) {
  const cap = capacities(s), initial = createGame();
  for (const r of RESOURCES) {
    integer(s.resources[r], r, 0, cap[r]); integer(s.earned[r], '累计取得');
    for (const f of FLOWS) integer(s.ledger[f][r], f);
    if (s.earned[r] !== s.ledger.production[r] + s.ledger.rewards[r]) bad('累计取得与生产奖励记录不一致');
    const expected = initial.resources[r] + s.ledger.production[r] + s.ledger.rewards[r] + s.ledger.refunds[r] + s.ledger.imports[r] - s.ledger.exports[r] - s.ledger.operating[r] - s.ledger.reserved[r];
    if (s.resources[r] !== expected) bad('库存收支不守恒');
  }
  if (Boolean(s.city.districts['district-1']) !== s.completed.includes('P04') || Boolean(s.city.districts['district-2']) !== s.completed.includes('P05')) bad('测绘成果与街区不一致');
  if (cityCount(s) !== s.arrivals + INITIAL.population || cityPopulation(s, 'shadow') < INITIAL.population) bad('居民到达记录不一致');
  const expectedEcho = s.arrivals < RULES.firstEchoArrivals ? s.arrivals : RULES.firstEchoArrivals + Math.floor((s.arrivals - RULES.firstEchoArrivals) / 2);
  if (cityPopulation(s, 'echo') !== expectedEcho) bad('居民类型与到达顺序不一致');
  for (const id of activeDistricts(s)) {
    const d = districtState(s, id)!;
    for (const f of FACILITY_IDS) integer(d.facilities[f], '设施等级', id === 'district-0' ? initial.facilities[f] : 0, RULES.maxLevel);
    if (localCount(d) > localBeds(d, id)) bad('人口超出住处容量');
    if (plotsUsed(d) > DISTRICTS[id].plots) bad('设施超出街区地块');
    for (const type of RESIDENTS) {
      integer(d.population[type], '居民人数', 0, 8);
      if (JOBS.reduce((sum, j) => sum + integer(d.assignments[type][j], '岗位人数', 0, 8), 0) + awayWorkers(s, id, type) > d.population[type]) bad('岗位与外派人数超过居民人数');
    }
    for (const job of JOBS) if (d.assignments.shadow[job] + d.assignments.echo[job] > jobCapacity(s, job, id)) bad('岗位超过设施容量');
    for (const f of FACILITY_IDS) for (let level = (id === 'district-0' ? initial.facilities[f] : 0) + 1; level <= d.facilities[f]; level++) {
      if (!s.completed.includes(scopedKey(`build:${f}:${level}`, id))) bad('缺少设施完工记录');
    }
    for (const f of PUBLIC_IDS) {
      const equipment = d.publicWorks[f];
      integer(equipment.condition, '设备状态', 0, CITY_RULES.condition);
      if (typeof equipment.built !== 'boolean' || typeof equipment.enabled !== 'boolean' || (!equipment.built && equipment.condition !== 0)) bad('公共设施状态不一致');
      if (equipment.built !== s.completed.includes(scopedKey(`public:${f}`, id))) bad('公共设施完工记录不一致');
      if (equipment.built && !s.address) bad('公共设施缺少首章成果');
    }
    if (typeof d.autoRepair !== 'boolean' || (d.autoRepair && !s.completed.includes('R04'))) bad('自动巡检未解锁');
    if (!s.lightingChosen && d.lighting !== 'steady') bad('照明尚未开放');
  }
  readPriority(s.priority);
  if (s.queue.length > 3 || s.queue.filter(p => p.status !== 'waiting').length > 1 || s.queue.slice(1).some(p => p.status !== 'waiting')) bad('工务队列状态冲突');
  if (new Set(s.queue.map(p => `${p.district}/${p.definition}`)).size !== s.queue.length || new Set(s.queue.map(p => p.uid)).size !== s.queue.length) bad('队列项目重复');
  if (new Set(s.completed).size !== s.completed.length) bad('完工成果重复');
  for (const key of s.completed) {
    if (Object.hasOwn(PROJECTS, key)) continue;
    const [district, local] = key.includes('/') ? key.split('/') : ['district-0', key];
    const d = districtState(s, district as DistrictId);
    if (!d) bad('完工成果属于未知街区');
    if (local.startsWith('public:') && PUBLIC_IDS.includes(local.slice(7) as PublicFacility) && d!.publicWorks[local.slice(7) as PublicFacility].built) continue;
    const match = /^build:(generator|recycler|workbench|dorm|warehouse|mailbox):([1-3])$/.exec(local);
    if (!match || Number(match[2]) > d!.facilities[match[1] as keyof DistrictState['facilities']] || (district === 'district-0' && Number(match[2]) <= initial.facilities[match[1] as keyof typeof s.facilities])) bad('未知或不一致的完工成果');
  }
  for (const p of s.queue) {
    const d = districtState(s, p.district), uid = /^q-(\d+)$/.exec(p.uid);
    if (!d || !uid || Number(uid[1]) >= s.nextProject || Number(uid[1]) < 1) bad('项目序列或街区错误');
    if (s.completed.includes(projectKey(p))) bad('已完成项目重复入队');
    if (p.definition.startsWith('build:')) {
      const f = p.definition.slice(6) as keyof typeof s.facilities;
      if (!FACILITY_IDS.includes(f) || p.targetLevel !== d!.facilities[f] + 1 || p.targetLevel > 3) bad('设施目标等级错误');
    } else if (p.definition.startsWith('public:') || p.definition.startsWith('maintain:')) {
      const f = p.definition.split(':')[1] as PublicFacility;
      if (!s.address || !PUBLIC_IDS.includes(f) || p.targetLevel !== 1 || d!.publicWorks[f].built !== p.definition.startsWith('maintain:')) bad('公共设施工程状态错误');
    } else if (p.definition.startsWith('route:')) {
      if (!ROUTE_IDS.includes(p.definition.slice(6) as keyof NetworkState['routes']) || !routeOpen(s, p.definition.slice(6) as keyof NetworkState['routes']) || p.targetLevel !== 1 || p.district !== 'district-0') bad('线路维护工程错误');
    } else if (!Object.hasOwn(PROJECTS, p.definition) || p.targetLevel !== 1 || p.district !== 'district-0') bad('工程定义错误');
    const def = definitionFor(s, p.definition, p.targetLevel, p.district);
    integer(p.progress, '工程进度', 0, def.work - 1);
    for (const r of RESOURCES) if (p.reserved[r] !== (p.status === 'waiting' ? 0 : def.cost[r])) bad('预留费用不一致');
    if (p.status === 'waiting' && p.progress !== 0) bad('未开工项目存在进度');
  }
  for (const id of activeDistricts(s)) {
    const planned = s.queue.filter(p => p.district === id && ((p.definition.startsWith('build:') && p.targetLevel === 1) || p.definition.startsWith('public:'))).length;
    if (plotsUsed(districtState(s, id)!) + planned > DISTRICTS[id].plots) bad('待建工程超出街区地块');
  }
  if (s.completed.includes('P02') && !s.completed.includes('P01')) bad('主线顺序错误');
  if (s.completed.includes('P03') && (!s.completed.includes('P02') || !s.facilities.mailbox || !s.facilities.dorm || !s.facilities.warehouse || s.earned.memory < RULES.platformUnlockMemory)) bad('首章成果缺少条件');
  if (s.address !== (s.completed.includes('P03') ? '0-001' : null)) bad('地址与首章成果不一致');
  if (s.completed.includes('P04') && s.events.E05?.status !== 'claimed') bad('测绘缺少来信');
  for (const [next, previous] of [['P05', 'P04'], ['P06', 'P05'], ['P07', 'P06']] as const) if (s.completed.includes(next) && !s.completed.includes(previous)) bad('第二章主线顺序错误');
  if ((s.completed.includes('P06') || s.completed.includes('R03')) && s.events.E07?.status !== 'claimed') bad('地址簿缺少门牌选择');
  if (s.completed.includes('R04') && !s.address) bad('巡检研究缺少首章成果');
  for (const [next, previous] of [['P08', 'P07'], ['P09', 'P08'], ['P10', 'P09'], ['P11', 'P10'], ['R05', 'P08'], ['R06', 'P09']] as const) if (s.completed.includes(next) && !s.completed.includes(previous)) bad('第三章顺序错误');
  if (s.completed.includes('P08') && s.events.E10?.status !== 'claimed') bad('车厢修复缺少来信');
  if ((s.completed.includes('P09') || s.completed.includes('R05')) && (s.events.E12?.status !== 'claimed' || !s.network.routes.rain.imports)) bad('夜网发展缺少雨城回程与班次选择');
  if (s.completed.includes('P10') && (!s.completed.includes('R05') || !s.completed.includes('R06') || ROUTE_IDS.some(id => s.network.routes[id].imports < 1))) bad('时刻表缺少联运成果');
  if (s.completed.includes('P11') && ROUTE_IDS.some(id => s.network.routes[id].imports < 2)) bad('第三章缺少持续回程');
  const triggers = eventTriggers(s);
  for (const id of legacy ? EVENT_IDS.slice(0, 5) : EVENT_IDS) if (Boolean(s.events[id]) !== triggers[id]) bad('事件与触发条件不一致');
  if (s.events.E08 && !s.address) bad('专业街区缺少首章成果');
  if (s.completed.some(id => id === 'R01' || id === 'R02') && !s.events.E04) bad('研究缺少解锁条件');
  if (s.lightingChosen !== (s.events.E03?.status === 'claimed')) bad('照明选择状态不一致');
  if (s.lightingChosen && !s.events.E03?.choice) bad('缺少首次照明选择');
  if (s.events.E07?.status === 'claimed' && !s.events.E07.choice) bad('缺少门牌选择');
  if (s.events.E12?.status === 'claimed' && !s.events.E12.choice) bad('缺少班次选择');
  for (const [id, e] of Object.entries(s.events)) {
    if (!EVENT_IDS.includes(id as EventId) || !['pending', 'claimed'].includes(e.status)) bad('事件状态错误');
    if (e.choice && (e.status !== 'claimed' || (id === 'E03' ? !['bright', 'dim'].includes(e.choice) : id === 'E07' ? !['common', 'individual'].includes(e.choice) : id === 'E12' ? !['reliable', 'express'].includes(e.choice) : true))) bad('事件选择错误');
  }
  if (s.memoryProduced && (!s.facilities.mailbox || !s.ledger.production.memory)) bad('记忆生产状态不一致');
  const templates = readTemplates(s.city.templates);
  if (templates.length && !s.address) bad('模板缺少首章成果');
  if (new Set(templates.map(t => t.name)).size !== templates.length || templates.some(t => !districtState(s, t.district) || (!s.lightingChosen && t.lighting !== 'steady'))) bad('模板重复或街区照明未开放');
  integer(s.city.maintenance, '巡检次数'); integer(s.arrivals, '到达人数', 0, 18);
  integer(s.arrivalSeconds, '到达计时', 0, 119);
  integer(s.clock.seconds, '模拟时间'); integer(s.clock.lastAt, '最近结算时间'); integer(s.clock.remainderMs, '毫秒余量', 0, 999);
  readReport(s.report);
  assertNetwork(s);
}
function readState(v: unknown, schema: 1 | 2 | 3): GameState {
  const legacy = schema === 1;
  const o = obj(v), clock = obj(o.clock), events = obj(o.events), ids = EVENT_IDS.slice(0, legacy ? 5 : schema === 2 ? 10 : EVENT_IDS.length);
  if (o.district !== 'district-0' || typeof o.lightingChosen !== 'boolean' || typeof o.memoryProduced !== 'boolean') bad('街区或状态标志错误');
  if (Object.keys(events).some(id => !ids.includes(id as EventId))) bad('未知事件');
  if (!Array.isArray(o.queue) || o.queue.length > 3) bad('工务队列格式错误');
  if (!Array.isArray(o.history) || o.history.length > 40) bad('近期记录格式错误');
  const city = legacy ? null : obj(o.city), districts = city ? obj(city.districts) : {};
  if (Object.keys(districts).some(id => id !== 'district-1' && id !== 'district-2')) bad('未知街区');
  const completed = strings(o.completed, '成果', legacy ? 23 : 100);
  if (legacy && (o.city !== undefined || completed.some(key => !LEGACY_PROJECT_IDS.includes(key) && !/^build:(generator|recycler|workbench|dorm|warehouse|mailbox):[1-3]$/.test(key)))) bad('旧版成果格式错误');
  if (schema < 3 && (o.network !== undefined || completed.some(key => { const p = parseCompletionKey(key); return !p || (!p.local.startsWith('build:') && !p.local.startsWith('public:') && !(legacy ? LEGACY_PROJECT_IDS : V2_PROJECT_IDS).includes(p.local)); }))) bad('旧版不支持夜网成果');
  const s: GameState = {
    ...readDistrict(o, legacy),
    district: 'district-0', resources: readAmounts(o.resources, '库存'), earned: readAmounts(o.earned, '累计取得'), ledger: readLedger(o.ledger, schema),
    arrivalSeconds: integer(o.arrivalSeconds, '到达计时', 0, 119), arrivals: integer(o.arrivals, '到达人数', 0, legacy ? 6 : 18),
    lightingChosen: o.lightingChosen as boolean, priority: readPriority(o.priority),
    queue: (o.queue as unknown[]).map(v => {
      const p = obj(v);
      if (typeof p.uid !== 'string' || typeof p.definition !== 'string' || p.definition.length > 40) bad('项目标识错误');
      if (legacy && (!LEGACY_PROJECT_IDS.includes(p.definition as string) && !/^build:(generator|recycler|workbench|dorm|warehouse|mailbox)$/.test(p.definition as string))) bad('旧版工程定义错误');
      if (schema === 2 && !V2_PROJECT_IDS.includes(p.definition as string) && !/^(build|public|maintain):/.test(p.definition as string)) bad('旧版工程定义错误');
      return { uid: p.uid as string, definition: p.definition as GameState['queue'][number]['definition'], district: legacy ? 'district-0' : choice(p.district, DISTRICT_IDS, '工程街区'), targetLevel: integer(p.targetLevel, '目标等级', 1, 3),
        status: choice(p.status, ['waiting', 'running', 'paused'] as const, '项目状态'), progress: integer(p.progress, '进度'), reserved: readAmounts(p.reserved, '预留费用') };
    }),
    completed,
    events: Object.fromEntries(Object.entries(events).map(([id, v]) => {
      const e = obj(v), status = choice(e.status, ['pending', 'claimed'] as const, '事件状态');
      const chosen = e.choice === undefined ? undefined : choice(e.choice, ['bright', 'dim', 'common', 'individual', 'reliable', 'express'] as const, '事件选择');
      if (chosen && (status !== 'claimed' || (id === 'E03' ? !['bright', 'dim'].includes(chosen) : id === 'E07' ? !['common', 'individual'].includes(chosen) : id === 'E12' ? !['reliable', 'express'].includes(chosen) : true))) bad('事件选择错误');
      return [id, chosen ? { status, choice: chosen } : { status }];
    })),
    memoryProduced: o.memoryProduced as boolean, address: o.address === null ? null : choice(o.address, ['0-001'] as const, '地址'),
    clock: { seconds: integer(clock.seconds, '模拟时间'), remainderMs: integer(clock.remainderMs, '毫秒余量', 0, 999), lastAt: integer(clock.lastAt, '最近结算时间') },
    nextProject: integer(o.nextProject, '项目序列', 1), theme: choice(o.theme, ['dark', 'light'] as const, '主题'), report: readReport(o.report, schema),
    city: { districts: Object.fromEntries(Object.entries(districts).map(([id, d]) => [id, readDistrict(d)])), templates: city ? readTemplates(city.templates) : [], maintenance: city ? integer(city.maintenance, '巡检次数') : 0 },
    network: schema < 3 ? createNetwork() : readNetwork(o.network),
    history: (o.history as unknown[]).map(v => {
      const h = obj(v);
      if (typeof h.text !== 'string' || h.text.length > 1000) bad('近期文字格式错误');
      return { second: integer(h.second, '记录时间'), text: h.text as string };
    })
  };
  // Validate the old state before enabling any V0.2 discoveries. E08 may become
  // immediately eligible in a developed V0.1 save, but cannot alter old counters.
  if (legacy) {
    assertInvariants(s, true);
    const triggers = eventTriggers(s);
    if (triggers.E08) s.events.E08 = { status: 'pending' };
  }
  assertInvariants(s);
  return s;
}
export function encodeSave(state: GameState, savedAt: number): string {
  assertInvariants(state);
  return JSON.stringify({ format: 'districtzero', schemaVersion: 3, balanceVersion: BALANCE_VERSION, savedAt: integer(savedAt, '保存时间'), state } satisfies SaveEnvelope, null, 2);
}
export function decodeSave(text: string): SaveEnvelope {
  if (text.length > 2_000_000) bad('文件超过 2 MB');
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return bad('无法解析 JSON 文本'); }
  const o = obj(parsed);
  if (o.format !== 'districtzero') bad('这不是第0街区存档');
  const schema = o.schemaVersion;
  if (schema !== 1 && schema !== 2 && schema !== 3) throw new SaveVersionError('结构版本不兼容，当前支持版本1/2迁移与版本3');
  if (o.balanceVersion !== (schema === 1 ? '0.1.0' : schema === 2 ? '0.2.0' : BALANCE_VERSION)) throw new SaveVersionError('数值版本不兼容');
  return { format: 'districtzero', schemaVersion: 3, balanceVersion: BALANCE_VERSION, savedAt: integer(o.savedAt, '保存时间'), state: readState(o.state, schema), ...(schema < 3 ? { migratedFrom: schema as 1 | 2 } : {}) };
}
