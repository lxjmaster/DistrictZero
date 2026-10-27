import { amounts, BALANCE_VERSION, EVENT_IDS, FACILITY_IDS, FLOWS, INITIAL, JOBS, POLICIES, PROJECTS, RESIDENTS, RESOURCES, RULES, SAVE_SCHEMA_VERSION, WORK_JOBS } from './config';
import { capacities, createGame, definitionFor, eventTriggers, jobCapacity, jobSlotsUsed, legacyChapterReady, parseCompletionKey, projectKey } from './engine';
import type { Amounts, EventId, GameState, Ledger, ReturnReport } from './types';
import type { DistrictId, DistrictState, WorkTemplate, PublicFacility } from './types';
import { activeDistricts, cityCount, cityPopulation, CITY_RULES, districtState, DISTRICTS, DISTRICT_IDS, emptyDistrict, localBeds, localCount, plotsUsed, PUBLIC_IDS, scopedKey } from './city';
import { awayWorkers, cargoFor, createNetwork, fleetSize, NETWORK_RULES, occupiedVehicles, ROUTE_IDS, ROUTES, routeOpen, vehicleCapacity, reservedSpace, RECIPES, MODES, productResource, validContract, validManifest, baseDepartureEnergy } from './network';
import { ARCHIVES, ARCHIVE_IDS, archiveUnlocked, LEGACY_ARCHIVE_IDS, VEHICLE_MOD_IDS } from './journey';
import type { CargoManifest, VehicleMod, NetworkState } from './types';
import { ASSEMBLY, assemblyUnlocked, createExperience, MOD_IDS, prefabLimit, STORY_IDS, RADIO_STORY_IDS, LETTER_STORY_IDS, TRAIN_STORY_IDS, OUTPOST_STORY_IDS, CALENDAR_STORY_IDS } from './experience';
import type { AssemblyMod, ExperienceState, StoryNode, NeighborhoodState, MailboxMod } from './types';

import { blueprintSources, COMMISSION_IDS, COMMISSIONS, commissionDone, commissionReason, commissionVisible, createNeighborhood, FIELD_IDS, FIELD_SITES, fieldClueKnown, fieldOpenReason, fieldWorkers, heldFieldSupplies, fieldReward, MAIL_MOD_IDS, NEIGHBORHOOD_RULES } from './neighborhood';
import { createOutposts, OUTPOST_IDS } from './outposts';
import { assertOutposts, assertOutpostProject, readOutposts, readOutpostReport, validOutpostCompletion } from './outpost-save';
import { createCalendar } from './calendar-config';
import { assertCalendar, readCalendar, readCalendarReport } from './calendar-save';

import { createCovenants } from './covenants';
import { assertCovenants, readCovenants, readCovenantReport } from './covenant-save';

export interface SaveEnvelope { format: 'districtzero'; schemaVersion: typeof SAVE_SCHEMA_VERSION; balanceVersion: string; savedAt: number; state: GameState; migratedFrom?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 }
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
  return Object.fromEntries(RESOURCES.map(r => [r, integer(o[r], label)])) as Amounts;
}
function readLedger(v: unknown, schema = 8): Ledger {
  const o = obj(v);
  return Object.fromEntries(FLOWS.map(f => {
    if (schema < 7 && (f === 'supportSent' || f === 'supportReceived')) return [f, amounts()];
    if (schema < 3 && (f === 'imports' || f === 'exports')) {
      if (o[f] !== undefined && RESOURCES.some(r => readAmounts(o[f], f)[r] !== 0)) bad('旧版不支持运输账本');
      return [f, amounts()];
    }
    if (schema < 5 && f === 'fieldReserved') return [f, amounts()];
    if (schema < 4 && f === 'fulfillment') return [f, amounts()];
    return [f, readAmounts(o[f], f)];
  })) as Ledger;
}
function sourceStories(schema: number): StoryNode[] {
  return schema < 5 ? RADIO_STORY_IDS : schema < 6 ? [...RADIO_STORY_IDS, ...LETTER_STORY_IDS] : schema < 7 ? [...RADIO_STORY_IDS, ...LETTER_STORY_IDS, ...TRAIN_STORY_IDS] : schema < 8 ? [...RADIO_STORY_IDS, ...LETTER_STORY_IDS, ...TRAIN_STORY_IDS, ...OUTPOST_STORY_IDS] : schema < 9 ? [...RADIO_STORY_IDS, ...LETTER_STORY_IDS, ...TRAIN_STORY_IDS, ...OUTPOST_STORY_IDS, ...CALENDAR_STORY_IDS] : STORY_IDS;
}
function readReport(v: unknown, schema: number = SAVE_SCHEMA_VERSION): ReturnReport | null {
  if (v === null) return null;
  const o = obj(v), arrivals = obj(o.arrivals);
  const ids = EVENT_IDS.slice(0, schema === 1 ? 5 : schema === 2 ? 10 : EVENT_IDS.length);
  const events = strings(o.events, '报告事件', ids.length).map(e => choice(e, ids, '报告事件'));
  const pending = strings(o.pending, '待处理事件', ids.length).map(e => choice(e, ids, '待处理事件'));
  const completed = strings(o.completed, '报告完工记录');
  for (const key of completed) {
    if (key.includes('@')) {
      if (schema < 7 || !validOutpostCompletion(key)) bad('报告分所完工记录错误');
      continue;
    }
    const parsed = parseCompletionKey(key);
    if (!parsed || (schema < 7 && parsed.local === 'P12') || (schema < 6 && /^vehiclemod:/.test(parsed.local)) || (schema < 5 && /^mailmod:/.test(parsed.local)) || (schema < 4 && /^(mod|blueprint):/.test(parsed.local)) || (schema < 3 && !parsed.local.startsWith('build:') && !(schema === 1 ? LEGACY_PROJECT_IDS : [...V2_PROJECT_IDS, 'public:relay', 'public:registry']).includes(parsed.local)) || (schema === 1 && parsed.district !== 'district-0')) bad('报告完工记录包含未知或不兼容的标识');
  }
  if (typeof o.goal !== 'string' || o.goal.length > 1000) bad('报告目标格式错误');
  const report: ReturnReport = {
    awayMs: integer(o.awayMs, '离开时长'), seconds: integer(o.seconds, '结算时长'),
    start: readAmounts(o.start, '开始库存'), end: readAmounts(o.end, '结束库存'), flows: readLedger(o.flows, schema),
    completed, arrivals: { shadow: integer(arrivals.shadow, '新居民'), echo: integer(arrivals.echo, '新居民') },
    events, pending, reasons: strings(o.reasons, '停工原因'), goal: o.goal as string, maintenance: schema === 1 ? 0 : integer(o.maintenance, '巡检次数'),
    transport: schema < 3 ? { departures: 0, deliveries: 0, maintenance: 0 } : (() => { const t = obj(o.transport); return { departures: integer(t.departures, '发车次数'), deliveries: integer(t.deliveries, '到货次数'), maintenance: integer(t.maintenance, '线路维护次数') }; })(),
    highlights: schema < 4 ? [] : strings(o.highlights, '成果摘要', 3),
    stories: schema < 4 ? [] : strings(o.stories, '住客事项', sourceStories(schema).length).map(id => choice(id, sourceStories(schema), '住客事项'))
    , neighborhood: schema < 5 ? { deliveries: 0, fieldReturns: 0, pending: 0, held: amounts() } : (() => { const n = obj(o.neighborhood); return { deliveries: integer(n.deliveries, '代办交付'), fieldReturns: integer(n.fieldReturns, '外勤返程'), pending: integer(n.pending, '待领结果', 0, 3), held: readAmounts(n.held, '持有补给') }; })()
    , ...(schema >= 7 && o.outposts !== undefined ? { outposts: readOutpostReport(o.outposts) } : {})
    , ...(schema >= 8 && o.calendar !== undefined ? { calendar: readCalendarReport(o.calendar) } : {})
    , ...(schema >= 9 && o.covenants !== undefined ? { covenants: readCovenantReport(o.covenants) } : {})
  };
  for (const r of RESOURCES) {
    const expected = report.start[r] + report.flows.production[r] + report.flows.rewards[r] + report.flows.refunds[r] + report.flows.imports[r] + report.flows.supportReceived[r] - report.flows.supportSent[r] - report.flows.exports[r] - report.flows.operating[r] - report.flows.reserved[r] - report.flows.fulfillment[r] - report.flows.fieldReserved[r];
    if (report.flows.supportReceived[r]) bad('旧城不能接收分所支援');
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
  const order = strings(v, '优先级', WORK_JOBS.length).map(j => choice(j, WORK_JOBS, '优先级'));
  if (order.length !== WORK_JOBS.length || new Set(order).size !== WORK_JOBS.length) bad('工作优先级不完整');
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
function readNetwork(v: unknown, schema = 6): NetworkState {
  const o = obj(v), routes = obj(o.routes), old = schema < 6;
  if (Object.keys(routes).length !== ROUTE_IDS.length) bad('夜网线路不完整');
  const vehicle = old ? null : obj(o.vehicle);
  const built = vehicle ? strings(vehicle.built, '车辆方案', 2).map(id => choice(id, VEHICLE_MOD_IDS, '车辆方案')) : [];
  if (new Set(built).size !== built.length || !old && typeof o.legacyPending !== 'boolean') bad('车辆或旧规则标记错误');
  const manifest = (value: unknown): CargoManifest => { const m = obj(value); return { normal: integer(m.normal, '普通整包', 0, 32), specialty: integer(m.specialty, '特产整包', 0, 32) }; };
  const state: NetworkState = { ...createNetwork(), legacyPending: old || o.legacyPending === true,
    rulesSince: old || o.rulesSince === null ? null : integer(o.rulesSince, '新规则时点'),
    vehicle: { built, active: !vehicle || vehicle.active === null ? null : choice(vehicle.active, VEHICLE_MOD_IDS, '车辆启用') },
    priority: strings(o.priority, '线路优先级', 2).map(id => choice(id, ROUTE_IDS, '线路优先级')), nextTrip: integer(o.nextTrip, '运单序列', 1), maintenance: integer(o.maintenance, '线路维护次数') };
  for (const id of ROUTE_IDS) {
    const route = obj(routes[id]), node = obj(route.node), contract = obj(route.contract);
    if (typeof route.autoRepair !== 'boolean' || typeof contract.enabled !== 'boolean') bad('线路开关格式错误');
    const staff = route.staff === null ? null : obj(route.staff), trip = route.trip === null ? null : obj(route.trip);
    if (contract.loads !== 1 && contract.loads !== 2) bad('合同兼容份数错误');
    if (trip && (typeof trip.uid !== 'string' || !old && typeof trip.spaceReserved !== 'boolean')) bad('运单标识或预留标记错误');
    const produced = readAmounts(node.produced, '城市生产');
    const normalResource = productResource(id, 'normal');
    state.routes[id] = {
      node: { resources: readAmounts(node.resources, '城市库存'), received: readAmounts(node.received, '城市收到'), produced, used: readAmounts(node.used, '城市消耗'), shipped: readAmounts(node.shipped, '城市发出'), cycle: integer(node.cycle, '城市生产计时', 0, NETWORK_RULES.cycle), mode: old ? 'normal' : choice(node.mode, MODES, '生产模式'), batches: old ? { normal: integer(produced[normalResource] / ROUTES[id].product[normalResource], '旧配方周期'), specialty: 0 } : (() => { const b = obj(node.batches); return { normal: integer(b.normal, '常规周期'), specialty: integer(b.specialty, '特产周期') }; })() },
      condition: integer(route.condition, '线路状态', 0, NETWORK_RULES.condition), autoRepair: route.autoRepair as boolean,
      contract: { enabled: contract.enabled as boolean, loads: contract.loads as 1 | 2, reserve: readAmounts(contract.reserve, '合同保留库存'), targets: old ? amounts() : readAmounts(contract.targets, '产物目标'), buffer: old ? 2 : integer(contract.buffer, '补给缓冲', 1, 8), manifest: old ? { normal: contract.loads as number, specialty: 0 } : manifest(contract.manifest), order: old ? ['normal', 'specialty'] : strings(contract.order, '货单顺序', 2).map(mode => choice(mode, MODES, '货单顺序')) },
      staff: staff ? { district: choice(staff.district, DISTRICT_IDS, '外派住处'), resident: choice(staff.resident, RESIDENTS, '外派居民') } : null,
      trip: trip ? { uid: trip.uid as string, direction: choice(trip.direction, ['outbound', 'inbound'] as const, '运输方向'), loads: integer(trip.loads, '运单整包', 1, old ? 2 : 64), manifest: old ? { normal: trip.loads as number, specialty: 0 } : manifest(trip.manifest), mode: old ? 'normal' : choice(trip.mode, MODES, '出发配方'), spaceReserved: !old && trip.spaceReserved === true, fee: old || trip.fee === null ? null : integer(trip.fee, '发车电量'), wear: old || trip.wear === null ? null : integer(trip.wear, '发车磨损', 1), capacity: old || trip.capacity === null ? null : integer(trip.capacity, '出发运量', 1), cargo: readAmounts(trip.cargo, '在途货物'), duration: integer(trip.duration, '运输总时长', 1), remaining: integer(trip.remaining, '运输余时') } : null,
      departures: integer(route.departures, '发车次数'), exports: integer(route.exports, '补给到货次数'), imports: integer(route.imports, '回程到货次数')
    };
  }
  return state;
}
function readExperience(v: unknown, schema: number = SAVE_SCHEMA_VERSION): ExperienceState {
  const o = obj(v), story = obj(o.story), benches = obj(o.benches), plan = obj(o.assembly);
  if (Object.keys(story).some(id => !sourceStories(schema).includes(id as StoryNode)) || Object.keys(benches).length !== DISTRICT_IDS.length || typeof plan.enabled !== 'boolean') bad('旧物与装配状态错误');
  const mods = <T extends string>(v: unknown, label: string, ids: T[]) => {
    const list = strings(v, label, ids.length).map(id => choice(id, ids, label));
    if (new Set(list).size !== list.length) bad(`${label}重复`);
    return list;
  };
  return {
    archives: schema < 6 ? [] : strings(o.archives, '复原档案', schema < 10 ? LEGACY_ARCHIVE_IDS.length : ARCHIVE_IDS.length).map(id => choice(id, schema < 10 ? LEGACY_ARCHIVE_IDS : ARCHIVE_IDS, '复原档案')),
    story: Object.fromEntries(Object.entries(story).map(([id, value]) => {
      const node = obj(value);
      if (Object.keys(node).some(key => key !== 'choice') || (id === 'L01-2' ? node.choice === undefined : node.choice !== undefined)) bad('住客节点选择错误');
      return [id, node.choice === undefined ? {} : { choice: choice(node.choice, ['dismantle', 'restore'] as const, '旧物命运') }];
    })),
    blueprints: mods(o.blueprints, '工具蓝图', schema < 5 ? MOD_IDS : schema < 6 ? [...MOD_IDS, ...MAIL_MOD_IDS] : [...MOD_IDS, ...MAIL_MOD_IDS, ...VEHICLE_MOD_IDS]),
    benches: Object.fromEntries(DISTRICT_IDS.map(id => {
      const bench = obj(benches[id]);
      return [id, { built: mods(bench.built, '已制作工具', MOD_IDS), active: bench.active === null ? null : choice(bench.active, MOD_IDS, '启用工具') }];
    })) as ExperienceState['benches'],
    assembly: { enabled: plan.enabled as boolean, target: integer(plan.target, '构件目标', 0, ASSEMBLY.maxSetting), reserve: readAmounts(plan.reserve, '装配保留量') }
  };
}
function readNeighborhood(v: unknown, schema = 6): NeighborhoodState {
  const stagesAllowed = schema < 6 ? COMMISSION_IDS.slice(0, 9) : COMMISSION_IDS, fieldsAllowed = schema < 6 ? FIELD_IDS.slice(0, 4) : FIELD_IDS;
  const o = obj(v), c = obj(o.commissions), f = obj(o.field), sites = obj(f.sites), boxes = obj(o.mailboxes), plan = obj(o.delegation);
  const stages = (v: unknown, label: string, max: number) => {
    const list = strings(v, label, max).map(id => choice(id, stagesAllowed, label));
    if (new Set(list).size !== list.length) bad(`${label}重复`);
    return list;
  };
  const order = (v: unknown) => { const o = obj(v); return { site: choice(o.site, fieldsAllowed, '外勤地点'), district: choice(o.district, DISTRICT_IDS, '外勤住处'), resident: choice(o.resident, RESIDENTS, '外勤居民') }; };
  if (!Array.isArray(f.queue) || f.queue.length > 3 || !Array.isArray(f.pending) || f.pending.length > 3 || typeof plan.enabled !== 'boolean' || Object.keys(sites).length !== fieldsAllowed.length || Object.keys(boxes).length !== 3) bad('街巷状态结构错误');
  const shown = Object.fromEntries(Object.entries(obj(c.shown)).map(([id, sequence]) => [choice(id, stagesAllowed, '展示委托'), integer(sequence, '展示序列', 1)]));
  const active = f.active === null ? null : obj(f.active);
  return {
    commissions: { completed: stages(c.completed, '完成委托', schema < 6 ? 9 : 18), tracked: stages(c.tracked, '追踪委托', 3), shown, nextShown: integer(c.nextShown, '委托展示序列', 1) },
    field: {
      active: active ? { ...order(active), uid: choiceUid(active.uid), kind: choice(active.kind, ['first', 'clue', 'supply'] as const, '调查类型'), duration: integer(active.duration, '外勤总时长', 1), remaining: integer(active.remaining, '外勤余时', 1), reserved: readAmounts(active.reserved, '持有补给') } : null,
      queue: (f.queue as unknown[]).map(order), pending: (f.pending as unknown[]).map(v => {
        const p = obj(v), kind = choice(p.kind, ['first', 'clue', 'supply', 'refund'] as const, '待领结果');
        const base = { uid: choiceUid(p.uid), site: choice(p.site, fieldsAllowed, '结果地点') };
        return kind === 'refund' ? { ...base, kind, refund: readAmounts(p.refund, '待退补给') } : { ...base, kind };
      }),
      sites: Object.fromEntries(FIELD_IDS.map(id => { const site = obj(sites[id] ?? (schema < 6 && !fieldsAllowed.includes(id) ? { first: null, clue: false, supplies: 0 } : undefined)); if (typeof site.clue !== 'boolean') bad('线索状态错误'); return [id, { first: site.first === null ? null : choice(site.first, ['a', 'b'] as const, '首访分支'), clue: site.clue as boolean, supplies: integer(site.supplies, '普通复访次数') }]; })) as NeighborhoodState['field']['sites'],
      nextTrip: integer(f.nextTrip, '外勤序列', 1), returns: integer(f.returns, '外勤返程次数'), recalls: integer(f.recalls, '外勤召回次数'), consumed: readAmounts(f.consumed, '已用补给'), refunded: readAmounts(f.refunded, '已退补给'), rewarded: readAmounts(f.rewarded, '调查已领物资')
    },
    mailboxes: Object.fromEntries(DISTRICT_IDS.map(id => { const box = obj(boxes[id]); const built = strings(box.built, '信箱制作', 2).map(mod => choice(mod, MAIL_MOD_IDS, '信箱制作')); if (new Set(built).size !== built.length) bad('信箱改装重复'); return [id, { built, active: box.active === null ? null : choice(box.active, MAIL_MOD_IDS, '启用信箱改装') }]; })) as NeighborhoodState['mailboxes'],
    delegation: { enabled: plan.enabled as boolean, district: choice(plan.district, DISTRICT_IDS, '代办街区'), stages: stages(plan.stages, '代办清单', 3), reserve: readAmounts(plan.reserve, '代办保留量'), deliveries: integer(plan.deliveries, '代办交付次数', 0, schema < 6 ? 9 : 18) }
  };
}
function choiceUid(v: unknown): string { return typeof v === 'string' && /^f-([1-9]\d*)$/.test(v) ? v : bad('外勤结果序列错误'); }
function assertNeighborhood(s: GameState) {
  const n = readNeighborhood(s.neighborhood), c = n.commissions, f = n.field, plan = n.delegation;
  for (const [id, seq] of Object.entries(c.shown)) if (!seq || seq >= c.nextShown || (!commissionDone(s, id as typeof c.completed[number]) && !commissionVisible(s, id as typeof c.completed[number]))) bad('委托展示记录错误');
  if (new Set(Object.values(c.shown)).size !== Object.keys(c.shown).length) bad('委托展示序列重复');
  const paid = amounts(), rewards = amounts();
  for (const id of c.completed) {
    const def = COMMISSIONS[id], before = structuredClone(s);
    before.neighborhood.commissions.completed = c.completed.filter(stage => stage !== id);
    if (commissionReason(before, id) || !c.shown[id]) bad('委托缺少阶段条件或展示');
    for (const r of RESOURCES) { paid[r] += def.payment[r]; rewards[r] += def.reward[r]; }
    if (def.blueprint && !s.experience.blueprints.includes(def.blueprint)) bad('委托缺少蓝图成果');
  }
  for (const id of c.tracked) if (!commissionVisible(s, id) || !c.shown[id]) bad('追踪了未展示或已完成的阶段');
  if (plan.deliveries > c.completed.length || plan.enabled && !s.completed.includes('R04') || !districtState(s, plan.district) || plan.stages.some(id => !c.tracked.includes(id) || !c.shown[id])) bad('代办清单或权限错误');
  for (const r of RESOURCES) integer(plan.reserve[r], '代办保留量', 0, NEIGHBORHOOD_RULES.maxSetting);
  const seen = new Set<string>();
  for (const p of [...f.pending, ...(f.active ? [f.active] : [])]) {
    if (seen.has(p.uid) || Number(p.uid.slice(2)) >= f.nextTrip) bad('外勤标识重复或越界'); seen.add(p.uid);
    if (fieldOpenReason(s, p.site)) bad('调查地点尚未开放');
    const site = f.sites[p.site];
    if (p.kind !== 'refund' && (p.kind === 'first' ? site.first !== null : !site.first)) bad('调查首访与复访状态冲突');
    if (p.kind === 'clue' && (site.clue || !fieldClueKnown(s, p.site))) bad('调查线索重复或未发现');
  }
  if (new Set(f.pending.map(p => p.site)).size !== f.pending.length || f.active && (f.pending.length >= 3 || f.pending.some(p => p.site === f.active!.site))) bad('调查待领位置冲突');
  if (f.active) {
    const trip = f.active, config = FIELD_SITES[trip.site];
    if (!districtState(s, trip.district) || trip.duration !== config.seconds || trip.remaining > trip.duration || RESOURCES.some(r => trip.reserved[r] !== config.payment[r])) bad('外勤补给或时长错误');
  }
  for (const order of f.queue) if (fieldOpenReason(s, order.site) || !f.sites[order.site].first || !districtState(s, order.district)) bad('预排只能安排已知普通复访');
  let claims = 0;
  const fieldRewards = amounts();
  for (const id of FIELD_IDS) {
    const site = f.sites[id], config = FIELD_SITES[id];
    if ((site.first || site.clue || site.supplies) && fieldOpenReason(s, id)) bad('调查记录缺少开放条件');
    if ((site.clue || site.supplies) && !site.first || site.clue && !fieldClueKnown(s, id)) bad('复访缺少首访或线索');
    if (site.first) {
      claims += 1; const i = site.first === 'a' ? 0 : 1;
      for (const r of RESOURCES) fieldRewards[r] += config.rewards[i][r];
      if (config.blueprints[i] && !s.experience.blueprints.includes(config.blueprints[i]!)) bad('调查缺少蓝图成果');
      const payment = fieldReward({ uid: 'f-1', site: id, kind: 'first' }, site.first).payment;
      for (const r of RESOURCES) paid[r] += payment[r];
    }
    if (site.clue) { claims += 1; for (const r of RESOURCES) fieldRewards[r] += config.clue[r]; if (id === 'F02' && !s.experience.blueprints.includes('voiceBox')) bad('半层回信缺少蓝图'); }
    claims += site.supplies; for (const r of RESOURCES) fieldRewards[r] += config.supply[r] * site.supplies;
  }
  if (f.returns !== claims + f.pending.filter(p => p.kind !== 'refund').length || f.nextTrip !== f.returns + f.recalls + Number(Boolean(f.active)) + 1 || f.pending.filter(p => p.kind === 'refund').length > f.recalls) bad('外勤次数不守恒');
  for (const p of f.pending) if (p.kind === 'refund' && RESOURCES.some(r => p.refund[r] > FIELD_SITES[p.site].payment[r] || p.refund[r] % 1000)) bad('待退补给超额或非整份');
  const held = heldFieldSupplies(s);
  for (const r of RESOURCES) {
    if (s.ledger.fieldReserved[r] !== f.consumed[r] + f.refunded[r] + held[r]) bad('外勤补给持有与返还不守恒');
    if (f.refunded[r] > s.ledger.refunds[r] || f.rewarded[r] !== fieldRewards[r] || rewards[r] + f.rewarded[r] > s.ledger.rewards[r] || paid[r] > s.ledger.fulfillment[r]) bad('委托调查成果与账本不一致');
  }
  for (const id of DISTRICT_IDS) {
    const box = n.mailboxes[id];
    if (!districtState(s, id) && (box.built.length || box.active) || box.active && (!box.built.includes(box.active) || !districtState(s, id)?.facilities.mailbox)) bad('信箱改装与设施不一致');
    for (const mod of box.built) if (!s.experience.blueprints.includes(mod) || !s.completed.includes(scopedKey(`mailmod:${mod}`, id))) bad('信箱缺少蓝图或制作记录');
  }
  return paid;
}
function assertExperience(s: GameState, neighborhoodPayments: Amounts) {
  const e = readExperience(s.experience), story = e.story;
  for (const ids of [RADIO_STORY_IDS, LETTER_STORY_IDS, TRAIN_STORY_IDS]) for (let i = 1; i < ids.length; i++) if (story[ids[i]] && !story[ids[i - 1]]) bad('住客支线顺序错误');
  if (story['L03-1'] && !s.completed.includes('P08') || story['L03-2'] && s.events.E12?.status !== 'claimed' || story['L03-3'] && !s.completed.includes('P09') || story['L03-4'] && !s.completed.includes('P11')) bad('站务回访缺少实际成果');
  if (new Set(e.archives).size !== e.archives.length || e.archives.some(id => !archiveUnlocked(s, id))) bad('档案重复或尚未开放');
  const payments = amounts(); for (const id of e.archives) for (const r of RESOURCES) payments[r] += ARCHIVES[id].cost[r];
  if (RESOURCES.some(r => payments[r] > s.ledger.fulfillment[r])) bad('档案缺少实际支付');
  // A04 cannot reuse a payment already committed to a completed commission,
  // claimed first visit, radio restoration, or another archive. Restrict the
  // stronger combined check to A04 so old source boundaries remain unchanged.
  if (e.archives.includes('A04')) {
    const radio = story['L01-2']?.choice === 'restore' ? ASSEMBLY.restoreCost : amounts();
    if (RESOURCES.some(r => payments[r] + neighborhoodPayments[r] + radio[r] > s.ledger.fulfillment[r])) bad('三地候车回执缺少独立支付');
  }
  if (story['L02-1'] && !s.completed.includes('P04') || story['L02-2'] && s.events.E07?.status !== 'claimed' || story['L02-3'] && !commissionDone(s, 'CM03-1') || story['L02-4'] && !s.completed.includes('P06')) bad('邮递员回访缺少实际成果');
  if (story['L02-3'] && !e.blueprints.includes('dispatchBox')) bad('邮递员回访缺少投递匣蓝图');
  if (story['L01-1'] && s.events.E01?.status !== 'claimed') bad('装配纸条缺少第一盏灯');
  if (story['L01-3'] && !s.completed.includes('P02') || story['L01-4'] && !s.completed.includes('P03')) bad('住客回信缺少章节成果');
  const granted = story['L01-2']?.choice === 'restore' ? 'thriftBench' : story['L01-2']?.choice === 'dismantle' ? 'quickJig' : null;
  if (granted && !e.blueprints.includes(granted)) bad('旧物选择缺少蓝图成果');
  if (story['L01-2']?.choice === 'dismantle' && s.ledger.rewards.component < ASSEMBLY.dismantleReward.component) bad('拆解缺少一次性奖励记录');
  if (story['L01-2']?.choice === 'restore' && RESOURCES.some(r => s.ledger.fulfillment[r] < ASSEMBLY.restoreCost[r])) bad('修复缺少实际支付记录');
  for (const mod of e.blueprints) if (!blueprintSources(s, mod).length) bad('蓝图缺少发现来源');
  for (const id of DISTRICT_IDS) {
    const bench = e.benches[id];
    if (!districtState(s, id) && (bench.built.length || bench.active)) bad('未测绘街区不能拥有工具');
    if (bench.active && !bench.built.includes(bench.active)) bad('启用了尚未制作的工具');
    if (bench.active && !districtState(s, id)?.facilities.workbench) bad('没有维修台时不能启用工具');
    for (const mod of bench.built) if (!e.blueprints.includes(mod) || !s.completed.includes(scopedKey(`mod:${mod}`, id))) bad('工具缺少蓝图或制作记录');
  }
  for (const r of RESOURCES) integer(e.assembly.reserve[r], '装配保留量', 0, ASSEMBLY.maxSetting);
  if (e.assembly.reserve.memory || e.assembly.reserve.component || e.assembly.reserve.rainFilm || e.assembly.reserve.railCore) bad('装配不能保留非原料资源');
  if (!assemblyUnlocked(s) && (e.assembly.enabled || DISTRICT_IDS.some(id => e.benches[id].built.length))) bad('装配尚未开放');
}
// Old versions are validated against their original content boundary. Only
// zero-valued new dimensions are then supplied to the unchanged economy rules.
function rejectOldCovenantContent(value: unknown): void {
  if (Array.isArray(value)) {
    if (value.some(v => typeof v === 'string' && (/^L06-[1-4]$/.test(v) || /(^|[/@])P1[7-9]$/.test(v)))) bad('旧版存档包含公约新内容');
    value.forEach(rejectOldCovenantContent); return;
  }
  if (value === null || typeof value !== 'object') return;
  const o = obj(value);
  if (Object.keys(o).some(key => key === 'covenants' || /^L06-[1-4]$/.test(key)) || typeof o.definition === 'string' && /^P1[7-9]$/.test(o.definition)) bad('旧版存档包含公约新内容');
  Object.values(o).forEach(rejectOldCovenantContent);
}
function rejectOldCalendarContent(value: unknown): void {
  if (Array.isArray(value)) {
    if (value.some(v => typeof v === 'string' && (/^L05-[1-4]$/.test(v) || /(^|[/@])(P1[3-6]|calendar:service)$/.test(v)))) bad('旧版存档包含历法新内容');
    value.forEach(rejectOldCalendarContent); return;
  }
  if (value === null || typeof value !== 'object') return;
  const o = obj(value);
  if (Object.keys(o).some(key => key === 'calendar' || /^L05-[1-4]$/.test(key))) bad('旧版存档包含历法新内容');
  if (typeof o.definition === 'string' && /^(P1[3-6]|calendar:service)$/.test(o.definition)) bad('旧版不支持历法工程');
  Object.values(o).forEach(rejectOldCalendarContent);
}
function rejectOldOutpostContent(value: unknown): void {
  if (Array.isArray(value)) { value.forEach(rejectOldOutpostContent); return; }
  if (value === null || typeof value !== 'object') return;
  const o = obj(value);
  if (['outposts', 'outpost', 'proof', 'supportSent', 'supportReceived'].some(key => Object.hasOwn(o, key))) bad('旧版存档包含分所新内容');
  if (typeof o.definition === 'string' && (o.definition === 'P12' || o.definition === 'lightFrame' || /^O0[12]-/.test(o.definition))) bad('旧版不支持分所工程');
  if (Array.isArray(o.completed) && o.completed.some(key => typeof key === 'string' && (key === 'P12' || key === 'lightFrame' || /^O0[12][@-]/.test(key)))) bad('旧版不支持分所成果');
  Object.values(o).forEach(rejectOldOutpostContent);
}
function normalizeFreight(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeFreight);
  if (value === null || typeof value !== 'object') return value;
  const o = obj(value);
  if (['rainFilm', 'railCore', 'mode', 'batches', 'manifest', 'spaceReserved', 'fee', 'wear', 'capacity', 'vehicle', 'targets', 'buffer', 'order', 'legacyPending', 'rulesSince', 'archives'].some(key => Object.hasOwn(o, key))) bad('旧版存档包含列车新内容');
  if (typeof o.definition === 'string' && o.definition.startsWith('vehiclemod:')) bad('旧版不支持车辆工程');
  if (Array.isArray(o.completed) && o.completed.some(key => typeof key === 'string' && key.startsWith('vehiclemod:'))) bad('旧版不支持车辆成果');
  const next = Object.fromEntries(Object.entries(o).map(([key, data]) => [key, normalizeFreight(data)]));
  if (['energy', 'parts', 'memory'].every(key => Object.hasOwn(o, key))) { next.rainFilm = 0; next.railCore = 0; }
  return next;
}
function normalizeLegacy(v: unknown): unknown {
  function expand(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(expand);
    if (value === null || typeof value !== 'object') return value;
    const old = obj(value);
    if (['component', 'assemble', 'prefab', 'experience', 'fulfillment', 'highlights', 'stories', 'neighborhood', 'fieldReserved', 'legacyChapter'].some(key => Object.hasOwn(old, key))) bad('旧版存档包含新版本内容');
    const result = Object.fromEntries(Object.entries(old).map(([key, data]) => [key, expand(data)]));
    if (['energy', 'parts', 'memory'].every(key => Object.hasOwn(old, key))) result.component = 0;
    if (['power', 'salvage', 'repair', 'record'].every(key => Object.hasOwn(old, key))) result.assemble = 0;
    return result;
  }
  const raw = obj(v), state = obj(expand(v));
  const priority = (value: unknown) => {
    const old = strings(value, '旧版工作优先级', 3);
    if (old.length !== 3 || new Set(old).size !== 3 || old.some(j => !['salvage', 'repair', 'record'].includes(j))) bad('旧版工作优先级错误');
    return [...old, 'assemble'];
  };
  state.priority = priority(raw.priority);
  if (Array.isArray(state.queue)) for (const value of state.queue) {
    const p = obj(value);
    if (typeof p.definition === 'string' && /^(mod|blueprint):/.test(p.definition)) bad('旧版不支持工具工程');
    p.prefab = 0;
  }
  if (Array.isArray(state.completed) && state.completed.some(key => typeof key === 'string' && /(^|\/)(mod|blueprint):/.test(key))) bad('旧版不支持工具成果');
  if (state.city) {
    const city = obj(state.city);
    if (Array.isArray(city.templates)) for (const value of city.templates) {
      const template = obj(value); template.priority = priority(template.priority);
    }
  }
  state.experience = createExperience();
  return state;
}
function assertNetwork(s: GameState) {
  const network = readNetwork(s.network), seen = new Set<string>();
  if (network.priority.length !== 2 || new Set(network.priority).size !== 2) bad('线路优先级不完整');
  if (occupiedVehicles(s) > fleetSize(s)) bad('列车超出共享运力');
  const vehicle = network.vehicle;
  if (vehicle.active && !vehicle.built.includes(vehicle.active)) bad('启用了未制作的车辆方案');
  for (const mod of vehicle.built) if (!s.completed.includes(`vehiclemod:${mod}`) || !s.experience.blueprints.includes(mod) || !fleetSize(s)) bad('车辆缺少制作或蓝图');
  if (network.legacyPending && (vehicle.built.length || network.rulesSince !== null)) bad('旧规则桥接状态冲突');
  let totalDepartures = 0;
  const exports = amounts(), imports = amounts();
  for (const id of ROUTE_IDS) {
    const route = network.routes[id], config = ROUTES[id], node = route.node, trip = route.trip;
    if (!validContract(id, route.contract)) bad('目标合同配置错误');
    if (!routeOpen(s, id)) {
      const initial = createNetwork().routes[id];
      if (route.condition || route.staff || trip || route.autoRepair || route.contract.enabled || route.contract.loads !== 1 || route.departures || route.exports || route.imports || node.cycle || node.mode !== 'normal' || node.batches.normal || node.batches.specialty || RESOURCES.some(r => route.contract.reserve[r] !== initial.contract.reserve[r] || route.contract.targets[r] || node.resources[r] || node.received[r] || node.produced[r] || node.used[r] || node.shipped[r])) bad('未开放线路存在城市或运输进度');
    }
    if (route.contract.enabled && !s.completed.includes('R05')) bad('自动合同尚未解锁');
    if (route.autoRepair && !s.completed.includes('R04')) bad('线路自动维护尚未解锁');
    if (route.staff && !districtState(s, route.staff.district)) bad('外派人员来自未知街区');
    if (route.departures !== route.exports + route.imports + Number(Boolean(trip))) bad('运单次数不守恒');
    totalDepartures += route.departures;
    const totalSupply = node.received.energy / RECIPES[id].normal.supply.energy;
    const normal = id === 'rain' ? (node.received.parts - 12000 * totalSupply) / 8000 : (node.received.memory - 6000 * totalSupply) / 2000;
    const specialty = totalSupply - normal;
    integer(normal, '普通补给包'); integer(specialty, '特产补给包');
    if (totalSupply < route.exports || totalSupply > (network.legacyPending ? 2 : 32) * route.exports || network.legacyPending && specialty !== 0) bad('补给包数与到货记录不一致');
    const normalShipped = node.shipped[productResource(id, 'normal')] / RECIPES[id].normal.product[productResource(id, 'normal')];
    const specialtyShipped = node.shipped[productResource(id, 'specialty')] / 2000;
    integer(normalShipped, '普通取货包'); integer(specialtyShipped, '特产取货包');
    const inbound = route.imports + Number(trip?.direction === 'inbound');
    if (normalShipped + specialtyShipped < inbound || normalShipped + specialtyShipped > (network.legacyPending ? 2 : 64) * inbound || network.legacyPending && (specialtyShipped || node.batches.specialty || node.mode !== 'normal')) bad('取货包数或旧规则特产记录错误');
    const held = reservedSpace(s, id);
    for (const r of RESOURCES) {
      if (node.received[r] !== normal * RECIPES[id].normal.supply[r] + specialty * RECIPES[id].specialty.supply[r]) bad('补给货包内容错误');
      if (node.produced[r] !== node.batches.normal * RECIPES[id].normal.product[r] + node.batches.specialty * RECIPES[id].specialty.product[r] || node.used[r] !== node.batches.normal * RECIPES[id].normal.supply[r] + node.batches.specialty * RECIPES[id].specialty.supply[r]) bad('城市配方投入与产出不一致');
      if (node.shipped[r] !== normalShipped * RECIPES[id].normal.product[r] + specialtyShipped * RECIPES[id].specialty.product[r]) bad('回程货包内容错误');
      integer(node.resources[r], '城市库存', 0, config.capacity[r] - held[r]);
      if (node.resources[r] !== node.received[r] + node.produced[r] - node.used[r] - node.shipped[r]) bad('城市库存收支不守恒');
      exports[r] += node.received[r] + (trip?.direction === 'outbound' ? trip.cargo[r] : 0);
      imports[r] += node.shipped[r] - (trip?.direction === 'inbound' ? trip.cargo[r] : 0);
    }
    if (trip) {
      const uid = /^t-([1-9]\d*)$/.exec(trip.uid), expected = cargoFor(id, trip.direction, trip.manifest, trip.mode);
      if (!route.staff || !uid || Number(uid[1]) >= network.nextTrip || seen.has(trip.uid)) bad('运单人员或序列错误'); seen.add(trip.uid);
      const size = RESOURCES.reduce((n, r) => n + trip.cargo[r], 0);
      if (!validManifest(trip.manifest) || trip.direction === 'outbound' && trip.manifest.specialty || trip.loads !== trip.manifest.normal + trip.manifest.specialty || RESOURCES.some(r => trip.cargo[r] !== expected[r])) bad('货物或整包货单错误');
      const rack = vehicle.active === 'freightRack' ? 20000 : 0, guard = vehicle.active === 'railGuard' ? 0.75 : 1;
      const validWear = [Math.ceil((s.events.E12?.choice === 'reliable' ? 80 : s.events.E12?.choice === 'express' ? 150 : 100) * guard), ...(!vehicle.active ? [100] : [])];
      const baseFee = baseDepartureEnergy(s, id), validFees = [baseFee, ...(s.covenants.paid.coexist && s.covenants.feeSaved >= Math.ceil(baseFee * 0.2) ? [Math.ceil(baseFee * 0.8)] : [])];
      if (trip.spaceReserved ? ![40000 + rack, 80000 + rack].includes(trip.capacity!) || trip.capacity! > vehicleCapacity(s) || size > trip.capacity! || !validFees.includes(trip.fee!) || !validWear.includes(trip.wear!) : trip.mode !== 'normal' || trip.manifest.specialty || trip.loads > 2 || trip.fee !== null || trip.wear !== null || trip.capacity !== null || size > (s.completed.includes('R06') ? 80000 : 40000)) bad('运单快照或旧车兼容标记错误');
      if (trip.remaining > trip.duration || trip.duration !== config.seconds && !(s.events.E12?.choice === 'express' && trip.duration === Math.ceil(config.seconds * NETWORK_RULES.expressTime))) bad('运输时长错误');
    }
  }
  if (network.nextTrip !== totalDepartures + 1) bad('运单序列与发车记录不一致');
  if (RESOURCES.some(r => exports[r] !== s.ledger.exports[r] || imports[r] !== s.ledger.imports[r])) bad('在途货物与两端运输账本不守恒');
}
export function assertInvariants(s: GameState, legacy = false) {
  const physical = capacities(s), held = reservedSpace(s, 'home'), cap = Object.fromEntries(RESOURCES.map(r => [r, physical[r] - held[r]])) as Amounts, initial = createGame();
  for (const r of RESOURCES) {
    integer(s.resources[r], r, 0, cap[r]); integer(s.earned[r], '累计取得');
    for (const f of FLOWS) integer(s.ledger[f][r], f);
    if (s.earned[r] !== s.ledger.production[r] + s.ledger.rewards[r]) bad('累计取得与生产奖励记录不一致');
    const expected = initial.resources[r] + s.ledger.production[r] + s.ledger.rewards[r] + s.ledger.refunds[r] + s.ledger.imports[r] + s.ledger.supportReceived[r] - s.ledger.supportSent[r] - s.ledger.exports[r] - s.ledger.operating[r] - s.ledger.reserved[r] - s.ledger.fulfillment[r] - s.ledger.fieldReserved[r];
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
      if (JOBS.reduce((sum, j) => sum + integer(d.assignments[type][j], '岗位人数', 0, 8), 0) + awayWorkers(s, id, type) + fieldWorkers(s, id, type) + s.outposts.crew.filter(person => person.district === id && person.resident === type).length > d.population[type]) bad('岗位与外派人数超过居民人数');
    }
    for (const job of JOBS) if ((job === 'assemble' ? d.assignments.shadow.assemble + d.assignments.echo.assemble : jobSlotsUsed(s, job, id)) > jobCapacity(s, job, id)) bad('岗位超过设施共享容量');
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
  if (new Set(s.queue.map(p => `${p.outpost ?? p.district}/${p.definition}`)).size !== s.queue.length || new Set(s.queue.map(p => p.uid)).size !== s.queue.length) bad('队列项目重复');
  if (new Set(s.completed).size !== s.completed.length) bad('完工成果重复');
  for (const key of s.completed) {
    if (key.includes('@')) {
      if (!validOutpostCompletion(key)) bad('分所完工标识错误');
      continue;
    }
    if (Object.hasOwn(PROJECTS, key)) continue;
    const [district, local] = key.includes('/') ? key.split('/') : ['district-0', key];
    const d = districtState(s, district as DistrictId);
    if (!d) bad('完工成果属于未知街区');
    if (district === 'district-0' && local.startsWith('vehiclemod:') && VEHICLE_MOD_IDS.includes(local.slice(11) as VehicleMod) && s.network.vehicle.built.includes(local.slice(11) as VehicleMod)) continue;
    if (local.startsWith('mailmod:') && MAIL_MOD_IDS.includes(local.slice(8) as MailboxMod) && s.neighborhood.mailboxes[district as DistrictId].built.includes(local.slice(8) as MailboxMod)) continue;
    if (local.startsWith('mod:') && MOD_IDS.includes(local.slice(4) as AssemblyMod) && s.experience.benches[district as DistrictId].built.includes(local.slice(4) as AssemblyMod)) continue;
    if (district === 'district-0' && local.startsWith('blueprint:') && MOD_IDS.includes(local.slice(10) as AssemblyMod) && s.experience.blueprints.includes(local.slice(10) as AssemblyMod)) continue;
    if (local.startsWith('public:') && PUBLIC_IDS.includes(local.slice(7) as PublicFacility) && d!.publicWorks[local.slice(7) as PublicFacility].built) continue;
    const match = /^build:(generator|recycler|workbench|dorm|warehouse|mailbox):([1-3])$/.exec(local);
    if (!match || Number(match[2]) > d!.facilities[match[1] as keyof DistrictState['facilities']] || (district === 'district-0' && Number(match[2]) <= initial.facilities[match[1] as keyof typeof s.facilities])) bad('未知或不一致的完工成果');
  }
  for (const p of s.queue) {
    const d = districtState(s, p.district), uid = /^q-(\d+)$/.exec(p.uid);
    if (!d || !uid || Number(uid[1]) >= s.nextProject || Number(uid[1]) < 1) bad('项目序列或街区错误');
    if (p.outpost) { assertOutpostProject(s, p); continue; }
    if (p.outpost !== undefined && p.outpost !== null || p.proof !== undefined && p.proof !== null) bad('旧城工程不能保存分所证明');
    if (s.completed.includes(projectKey(p))) bad('已完成项目重复入队');
    if (p.definition.startsWith('build:')) {
      const f = p.definition.slice(6) as keyof typeof s.facilities;
      if (!FACILITY_IDS.includes(f) || p.targetLevel !== d!.facilities[f] + 1 || p.targetLevel > 3) bad('设施目标等级错误');
    } else if (p.definition.startsWith('public:') || p.definition.startsWith('maintain:')) {
      const f = p.definition.split(':')[1] as PublicFacility;
      if (!s.address || !PUBLIC_IDS.includes(f) || p.targetLevel !== 1 || d!.publicWorks[f].built !== p.definition.startsWith('maintain:')) bad('公共设施工程状态错误');
    } else if (p.definition.startsWith('route:')) {
      if (!ROUTE_IDS.includes(p.definition.slice(6) as keyof NetworkState['routes']) || !routeOpen(s, p.definition.slice(6) as keyof NetworkState['routes']) || p.targetLevel !== 1 || p.district !== 'district-0') bad('线路维护工程错误');
    } else if (p.definition === 'calendar:service') {
      if (!s.completed.includes('P13') || p.targetLevel !== 1 || p.district !== 'district-0' || p.prefab !== 0 || p.legacyChapter) bad('校准工程错误');
    } else if (p.definition.startsWith('vehiclemod:')) {
      const mod = p.definition.slice(11) as VehicleMod;
      if (!VEHICLE_MOD_IDS.includes(mod) || !s.experience.blueprints.includes(mod) || !fleetSize(s) || p.targetLevel !== 1 || p.district !== 'district-0') bad('车辆制作前置错误');
    } else if (p.definition.startsWith('mailmod:')) {
      const mod = p.definition.slice(8) as MailboxMod;
      if (!MAIL_MOD_IDS.includes(mod) || !s.experience.blueprints.includes(mod) || !d!.facilities.mailbox || p.targetLevel !== 1) bad('信箱改装前置错误');
    } else if (p.definition.startsWith('mod:') || p.definition.startsWith('blueprint:')) {
      const mod = p.definition.split(':')[1] as AssemblyMod;
      if (!MOD_IDS.includes(mod) || p.targetLevel !== 1 || !assemblyUnlocked(s) || (p.definition.startsWith('mod:') ? !s.experience.blueprints.includes(mod) || !d!.facilities.workbench : p.district !== 'district-0' || !s.completed.includes('P03'))) bad('工具工程前置错误');
    } else if (!Object.hasOwn(PROJECTS, p.definition) || p.targetLevel !== 1 || p.district !== 'district-0') bad('工程定义错误');
    if (typeof p.legacyChapter !== 'boolean' || p.legacyChapter && (p.district !== 'district-0' || !['P06', 'P07', 'P11'].includes(p.definition))) bad('旧工程兼容标记错误');
    integer(p.prefab, '预制份数', 0, prefabLimit(definitionFor(s, p.definition, p.targetLevel, p.district)));
    if (p.prefab && !assemblyUnlocked(s)) bad('预制施工尚未开放');
    const def = definitionFor(s, p.definition, p.targetLevel, p.district, p.prefab);
    integer(p.progress, '工程进度', 0, def.work - 1);
    for (const r of RESOURCES) if (p.reserved[r] !== (p.status === 'waiting' ? 0 : def.cost[r])) bad('预留费用不一致');
    if (p.status === 'waiting' && p.progress !== 0) bad('未开工项目存在进度');
  }
  for (const id of activeDistricts(s)) {
    const planned = s.queue.filter(p => !p.outpost && p.district === id && ((p.definition.startsWith('build:') && p.targetLevel === 1) || p.definition.startsWith('public:'))).length;
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
  if (s.completed.includes('P11') && ROUTE_IDS.some(id => s.network.routes[id].imports < (s.network.legacyPending ? 2 : 1))) bad('第三章缺少实际回程');
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
  const neighborhoodPayments = assertNeighborhood(s);
  assertExperience(s, neighborhoodPayments);
  readReport(s.report);
  assertNetwork(s);
  assertOutposts(s);
  assertCalendar(s);
  assertCovenants(s);
}
function readState(v: unknown, schema: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10): GameState {
  const legacy = schema === 1;
  const o = obj(v), clock = obj(o.clock), events = obj(o.events), ids = EVENT_IDS.slice(0, legacy ? 5 : schema === 2 ? 10 : EVENT_IDS.length);
  if (o.district !== 'district-0' || typeof o.lightingChosen !== 'boolean' || typeof o.memoryProduced !== 'boolean') bad('街区或状态标志错误');
  if (Object.keys(events).some(id => !ids.includes(id as EventId))) bad('未知事件');
  if (!Array.isArray(o.queue) || o.queue.length > 3) bad('工务队列格式错误');
  if (!Array.isArray(o.history) || o.history.length > 40) bad('近期记录格式错误');
  const city = legacy ? null : obj(o.city), districts = city ? obj(city.districts) : {};
  if (Object.keys(districts).some(id => id !== 'district-1' && id !== 'district-2')) bad('未知街区');
  const completed = strings(o.completed, '成果', legacy ? 23 : schema < 7 ? 100 : 160);
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
        status: choice(p.status, ['waiting', 'running', 'paused'] as const, '项目状态'), progress: integer(p.progress, '进度'), reserved: readAmounts(p.reserved, '预留费用'), prefab: integer(p.prefab, '预制份数', 0, ASSEMBLY.maxPrefab), legacyChapter: schema < 5 ? false : typeof p.legacyChapter === 'boolean' ? p.legacyChapter : bad('旧工程兼容标记错误'),
        ...(schema >= 7 && p.outpost !== undefined ? { outpost: p.outpost === null ? null : choice(p.outpost, OUTPOST_IDS, '工程分所') } : {}),
        ...(schema >= 7 && p.proof !== undefined ? { proof: p.proof === null ? null : choice(p.proof, ['local', 'relay'] as const, '工程证明') } : {}) };
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
    network: schema < 3 ? createNetwork() : readNetwork(o.network, schema),
    experience: readExperience(o.experience, schema), neighborhood: schema < 5 ? createNeighborhood() : readNeighborhood(o.neighborhood, schema),
    outposts: schema < 7 ? createOutposts() : readOutposts(o.outposts),
    calendar: schema < 8 ? createCalendar() : readCalendar(o.calendar),
    covenants: schema < 9 ? createCovenants() : readCovenants(o.covenants),
    history: (o.history as unknown[]).map(v => {
      const h = obj(v);
      if (typeof h.text !== 'string' || h.text.length > 1000) bad('近期文字格式错误');
      return { second: integer(h.second, '记录时间'), text: h.text as string };
    })
  };
  if (schema < 6) {
    s.network.legacyPending = true;
    for (const p of s.queue) if (p.definition === 'P11' && (p.status !== 'waiting' || legacyChapterReady(s, 'P11'))) p.legacyChapter = true;
  }
  if (schema < 5) for (const p of s.queue) if ((p.definition === 'P06' || p.definition === 'P07') && (p.status !== 'waiting' || legacyChapterReady(s, p.definition))) p.legacyChapter = true;
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
  return JSON.stringify({ format: 'districtzero', schemaVersion: SAVE_SCHEMA_VERSION, balanceVersion: BALANCE_VERSION, savedAt: integer(savedAt, '保存时间'), state } satisfies SaveEnvelope, null, 2);
}
export function decodeSave(text: string): SaveEnvelope {
  if (text.length > 2_000_000) bad('文件超过 2 MB');
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return bad('无法解析 JSON 文本'); }
  const o = obj(parsed);
  if (o.format !== 'districtzero') bad('这不是第0街区存档');
  const schema = o.schemaVersion;
  if (schema !== 1 && schema !== 2 && schema !== 3 && schema !== 4 && schema !== 5 && schema !== 6 && schema !== 7 && schema !== 8 && schema !== 9 && schema !== SAVE_SCHEMA_VERSION) throw new SaveVersionError('结构版本不兼容，当前支持版本1–9迁移与版本10');
  if (o.balanceVersion !== (schema === 1 ? '0.1.0' : schema === 2 ? '0.2.0' : schema === 3 ? '0.3.0' : schema === 4 ? '0.3.1' : schema === 5 ? '0.3.2' : schema === 6 ? '0.3.3' : schema === 7 ? '0.4.0' : schema === 8 ? '0.5.0' : schema === 9 ? '0.6.0' : BALANCE_VERSION)) throw new SaveVersionError('数值版本不兼容');
  if (schema < 10) {
    const experience = obj(o.state).experience;
    if (experience !== undefined) {
      const archives = obj(experience).archives;
      if (Array.isArray(archives) && archives.includes('A04')) bad('旧版存档包含三地候车回执');
    }
  }
  if (schema < 9) rejectOldCovenantContent(o.state);
  if (schema < 8) rejectOldCalendarContent(o.state);
  if (schema < 7) rejectOldOutpostContent(o.state);
  if (schema === 4) {
    const old = obj(o.state);
    if (old.neighborhood !== undefined || obj(old.ledger).fieldReserved !== undefined || old.report !== null && (obj(old.report).neighborhood !== undefined || obj(obj(old.report).flows).fieldReserved !== undefined) || Array.isArray(old.queue) && old.queue.some(p => obj(p).legacyChapter !== undefined)) bad('旧版存档包含街巷新内容');
  }
  return { format: 'districtzero', schemaVersion: SAVE_SCHEMA_VERSION, balanceVersion: BALANCE_VERSION, savedAt: integer(o.savedAt, '保存时间'), state: readState(schema < 4 ? normalizeLegacy(normalizeFreight(o.state)) : schema < 6 ? normalizeFreight(o.state) : o.state, schema), ...(schema < SAVE_SCHEMA_VERSION ? { migratedFrom: schema as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 } : {}) };
}
