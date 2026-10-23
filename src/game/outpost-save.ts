import { amounts, FACILITY_IDS, FLOWS, JOBS, RESIDENTS, RESOURCES, WORK_JOBS } from './config';
import { DISTRICT_IDS, districtState } from './city';
import { ASSEMBLY, MOD_IDS } from './experience';
import { createOutposts, OUTPOST_IDS, OUTPOST_INITIAL, OUTPOST_PROJECTS, SUPPORT_KINDS, SUPPORT_PACKAGES, SUPPORT_RULES, outpostDefinition, outpostJobCapacity, outpostLimits, outpostMaxLevel, outpostPopulation, outpostPrefabLimit, outpostProjectKey } from './outposts';
import type { Amounts, AssemblyMod, Facility, GameState, Ledger, Project, ReturnReport } from './types';
import type { OutpostId, OutpostState, OutpostsState } from './outpost-types';

const bad = (reason: string): never => { throw new Error(`存档无效：${reason}`); };
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : bad('分所需要数据对象');
const integer = (value: unknown, name: string, min = 0, max = Number.MAX_SAFE_INTEGER): number => typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max ? value : bad(`${name}超出范围或不是整数`);
const boolean = (value: unknown, name: string): boolean => typeof value === 'boolean' ? value : bad(`${name}必须是布尔值`);
function choice<T extends string>(value: unknown, values: readonly T[], name: string): T { return typeof value === 'string' && values.includes(value as T) ? value as T : bad(`${name}不受支持`); }
function list(value: unknown, name: string, max: number): unknown[] { return Array.isArray(value) && value.length <= max ? value : bad(`${name}格式错误`); }
function unique<T>(values: T[], name: string): T[] { if (new Set(values).size !== values.length) bad(`${name}重复`); return values; }
function readAmounts(value: unknown, name: string, max = Number.MAX_SAFE_INTEGER): Amounts {
  const o = object(value);
  return Object.fromEntries(RESOURCES.map(r => [r, integer(o[r], name, 0, max)])) as Amounts;
}
function readLedger(value: unknown): Ledger {
  const o = object(value);
  return Object.fromEntries(FLOWS.map(f => [f, readAmounts(o[f], `分所${f}`)])) as Ledger;
}
function readSite(value: unknown): OutpostState {
  const o = object(value), facilities = object(o.facilities), assignments = object(o.assignments), assembly = object(o.assembly), bench = object(o.bench), sent = object(o.sent);
  const priority = unique(list(o.priority, '分所优先级', WORK_JOBS.length).map(j => choice(j, WORK_JOBS, '分所优先级')), '分所优先级');
  if (priority.length !== WORK_JOBS.length) bad('分所优先级不完整');
  return {
    resources: readAmounts(o.resources, '分所库存'), earned: readAmounts(o.earned, '分所累计取得'), ledger: readLedger(o.ledger),
    facilities: Object.fromEntries(FACILITY_IDS.map(f => [f, integer(facilities[f], '分所设施', 0, 3)])) as OutpostState['facilities'],
    assignments: Object.fromEntries(RESIDENTS.map(type => { const jobs = object(assignments[type]); return [type, Object.fromEntries(JOBS.map(j => [j, integer(jobs[j], '分所岗位', 0, 4)]))]; })) as OutpostState['assignments'],
    lighting: choice(o.lighting, ['steady', 'bright', 'dim'] as const, '分所照明'), priority,
    assembly: { enabled: boolean(assembly.enabled, '分所装配开关'), target: integer(assembly.target, '分所构件目标', 0, ASSEMBLY.maxSetting), reserve: readAmounts(assembly.reserve, '分所装配保留', ASSEMBLY.maxSetting) },
    bench: { built: unique(list(bench.built, '分所工具', 2).map(mod => choice(mod, MOD_IDS, '分所工具')), '分所工具'), active: bench.active === null ? null : choice(bench.active, MOD_IDS, '分所启用工具') },
    completed: unique(list(o.completed, '分所成果', 30).map(v => typeof v === 'string' && v.length <= 100 ? v : bad('分所成果格式错误')), '分所成果'),
    roofPrefab: o.roofPrefab === null ? null : integer(o.roofPrefab, '屋檐预制记录', 0, 2),
    proof: o.proof === null ? null : choice(o.proof, ['local', 'relay'] as const, '庭院证明'),
    handoff: boolean(o.handoff, '分所交接'), lightFrame: boolean(o.lightFrame, '回照灯架'), initialTransferred: boolean(o.initialTransferred, '初始支援记录'),
    sent: { light: integer(sent.light, '光包发出次数', 0, SUPPORT_RULES.maxPackages), materials: integer(sent.materials, '工料包发出次数', 0, SUPPORT_RULES.maxPackages) }
  };
}
export function readOutposts(value: unknown): OutpostsState {
  const o = object(value), sites = object(o.sites), support = object(o.support), knowledge = object(o.knowledge), trip = support.trip === null ? null : object(support.trip);
  if (Object.keys(sites).some(id => !OUTPOST_IDS.includes(id as OutpostId))) bad('未知分所地图');
  return {
    active: o.active === null ? null : choice(o.active, OUTPOST_IDS, '活动分所'),
    sites: Object.fromEntries(Object.entries(sites).map(([id, site]) => [id, readSite(site)])),
    crew: list(o.crew, '派驻者', 4).map(v => { const p = object(v); return { uid: typeof p.uid === 'string' ? p.uid : bad('派驻标识错误'), district: choice(p.district, DISTRICT_IDS, '派驻住处'), resident: choice(p.resident, RESIDENTS, '派驻类型') }; }),
    support: { enabled: boolean(support.enabled, '支援开关'), queue: list(support.queue, '支援清单', 3).map(kind => choice(kind, SUPPORT_KINDS, '支援包型')), reserve: readAmounts(support.reserve, '支援保留量', ASSEMBLY.maxSetting),
      trip: trip ? { uid: typeof trip.uid === 'string' ? trip.uid : bad('支援标识错误'), outpost: choice(trip.outpost, OUTPOST_IDS, '支援目的地'), kind: choice(trip.kind, SUPPORT_KINDS, '在途包型'), cargo: readAmounts(trip.cargo, '在途支援'), duration: integer(trip.duration, '支援总时长', 1), remaining: integer(trip.remaining, '支援余时', 1) } : null },
    knowledge: { manifest: boolean(knowledge.manifest, '支援清单知识'), lightFrame: boolean(knowledge.lightFrame, '回照灯架知识') },
    nextCrew: integer(o.nextCrew, '派驻序列', 1), nextTrip: integer(o.nextTrip, '支援序列', 1)
  };
}

function localCompletion(id: OutpostId, key: string): boolean {
  if (Object.hasOwn(OUTPOST_PROJECTS, key)) return key.startsWith(`${id}-`);
  if (key === 'lightFrame') return true;
  if (key.startsWith('mod:')) return MOD_IDS.includes(key.slice(4) as AssemblyMod);
  const build = /^build:(generator|recycler|workbench|dorm|warehouse|mailbox):([1-3])$/.exec(key);
  if (!build) return false;
  const facility = build[1] as Facility, level = Number(build[2]);
  return level > (facility === 'dorm' || facility === 'warehouse' ? 0 : 1) && level <= outpostMaxLevel(id, facility);
}
export function validOutpostCompletion(key: string): boolean {
  const match = /^(O01|O02)@(.+)$/.exec(key);
  return !!match && localCompletion(match[1] as OutpostId, match[2]);
}
const proofReady = (site: OutpostState, proof: 'local' | 'relay') => proof === 'local' ? site.ledger.production.energy >= 60000 : site.ledger.supportReceived.energy - OUTPOST_INITIAL.energy >= 80000;

export function assertOutpostProject(s: GameState, p: Project): void {
  const id = choice(p.outpost, OUTPOST_IDS, '工程分所');
  if (s.outposts.active !== id || !s.outposts.sites[id] || p.district !== 'district-0' || p.legacyChapter !== false) bad('分所工程归属错误');
  const site = s.outposts.sites[id]!;
  if (p.definition.startsWith('build:')) {
    const facility = p.definition.slice(6) as Facility;
    if (!FACILITY_IDS.includes(facility) || p.targetLevel !== site.facilities[facility] + 1 || p.targetLevel > outpostMaxLevel(id, facility)) bad('分所设施目标等级错误');
  } else {
    if (p.targetLevel !== 1) bad('分所项目目标等级错误');
    if (Object.hasOwn(OUTPOST_PROJECTS, p.definition)) {
      const stage = Number(p.definition.at(-1));
      if (!p.definition.startsWith(`${id}-`) || stage > 1 && !site.completed.includes(`${id}-${stage - 1}`)) bad('分所工程顺序错误');
    } else if (p.definition === 'lightFrame') {
      if (!s.outposts.knowledge.lightFrame) bad('灯架缺少交接知识');
    } else if (p.definition.startsWith('mod:')) {
      const mod = p.definition.slice(4) as AssemblyMod;
      if (!MOD_IDS.includes(mod) || !s.experience.blueprints.includes(mod)) bad('分所工具缺少蓝图');
    } else bad('分所不能安排此工程');
  }
  if (s.completed.includes(outpostProjectKey(p))) bad('分所成果重复入队');
  if (p.definition === 'O02-2') {
    const proof = choice(p.proof, ['local', 'relay'] as const, '庭院证明');
    if (p.status !== 'waiting' && !proofReady(site, proof)) bad('庭院工程没有实际证明');
  } else if (p.proof !== undefined && p.proof !== null) bad('其他工程不能携带庭院证明');
  const original = outpostDefinition(s, id, p.definition, p.targetLevel);
  integer(p.prefab, '分所预制份数', 0, outpostPrefabLimit(original));
  const def = outpostDefinition(s, id, p.definition, p.targetLevel, p.prefab);
  integer(p.progress, '分所工程进度', 0, def.work - 1);
  if (!['waiting', 'running', 'paused'].includes(p.status) || p.status === 'waiting' && p.progress !== 0) bad('分所工程状态错误');
  for (const r of RESOURCES) if (p.reserved[r] !== (p.status === 'waiting' ? 0 : def.cost[r])) bad('分所工程预留费用错误');
}

export function readOutpostReport(value: unknown): NonNullable<ReturnReport['outposts']> {
  const reports = list(value, '分所返回报告', 2).map(v => {
    const o = object(v), id = choice(o.id, OUTPOST_IDS, '报告分所'), support = object(o.support);
    const textList = (value: unknown, name: string) => list(value, name, 30).map(v => typeof v === 'string' && v.length <= 1000 ? v : bad(`${name}格式错误`));
    const completed = unique(list(o.completed, '分所报告成果', 30).map(key => typeof key === 'string' && (localCompletion(id, key) || key.startsWith(`${id}@`) && validOutpostCompletion(key)) ? key : bad('分所报告成果归属错误')), '分所报告成果');
    const report = { id, start: readAmounts(o.start, '分所报告开始库存'), end: readAmounts(o.end, '分所报告结束库存'), flows: readLedger(o.flows), active: boolean(o.active, '分所报告活动标记'), completed,
      support: { sent: integer(support.sent, '报告支援发出次数', 0, SUPPORT_RULES.maxPackages), remaining: integer(support.remaining, '报告支援剩余额度', 0, SUPPORT_RULES.maxPackages), queued: integer(support.queued, '报告待发补给', 0, 3), inTransit: readAmounts(support.inTransit, '报告在途补给') },
      pending: textList(o.pending, '分所待处理事项'), reasons: textList(o.reasons, '分所停因') };
    const hasTransit = RESOURCES.some(r => report.support.inTransit[r] > 0);
    if (report.support.sent + report.support.remaining !== SUPPORT_RULES.maxPackages || hasTransit && (!report.support.sent || !SUPPORT_KINDS.some(kind => RESOURCES.every(r => report.support.inTransit[r] === SUPPORT_PACKAGES[kind].cargo[r]))) || !report.active && (report.support.queued || hasTransit)) bad('分所报告支援额度或在途内容错误');
    for (const r of RESOURCES) {
      const f = report.flows;
      if (f.rewards[r] || f.exports[r] || f.imports[r] || f.fulfillment[r] || f.fieldReserved[r] || f.supportSent[r]) bad('分所报告出现不支持的流量');
      if (report.end[r] !== report.start[r] + f.production[r] + f.refunds[r] + f.supportReceived[r] - f.operating[r] - f.reserved[r]) bad('分所报告收支不守恒');
      if ((r === 'rainFilm' || r === 'railCore') && (report.start[r] || report.end[r] || FLOWS.some(flow => f[flow][r]))) bad('分所报告夹带特产');
    }
    return report;
  });
  unique(reports.map(report => report.id), '分所返回报告');
  if (reports.filter(report => report.active).length > 1 || reports.filter(report => RESOURCES.some(r => report.support.inTransit[r])).length > 1) bad('分所报告出现多个活动图或在途包');
  return reports;
}

export function assertOutposts(s: GameState): void {
  const o = readOutposts(s.outposts), story = s.experience.story, trip = o.support.trip;
  if (story['L04-1'] && (!s.completed.includes('P11') || s.events.E15?.status !== 'claimed' || !story['L03-4'])) bad('分所来信缺少前三章成果');
  if (s.completed.includes('P12') && !story['L04-1']) bad('分所登记台缺少来信');
  if (s.queue.some(p => p.definition === 'P12' && !p.outpost) && !story['L04-1']) bad('登记台工程缺少来信');
  const storyIds = ['L04-1', 'L04-2', 'L04-3', 'L04-4'] as const;
  for (let i = 1; i < storyIds.length; i++) if (story[storyIds[i]] && !story[storyIds[i - 1]]) bad('分所来信顺序错误');
  if (story['L04-2'] && !s.completed.includes('P12')) bad('带走办法前尚未完成登记台');
  if (story['L04-3'] && !OUTPOST_IDS.some(id => o.sites[id]?.completed.includes(`${id}-3`))) bad('异地交班缺少地图成果');
  if (story['L04-4'] && !OUTPOST_IDS.every(id => o.sites[id]?.handoff)) bad('两份地址缺少交接');
  if (s.network.legacyPending && (Object.keys(o.sites).length || s.completed.includes('P12') || story['L04-1'])) bad('旧离线规则尚未结算不能出现分所');
  if (Object.keys(o.sites).length && (!s.completed.includes('P12') || !story['L04-2'])) bad('分所缺少登记与阅读前置');
  if (o.active === null ? o.crew.length || o.support.enabled || o.support.queue.length || trip : !o.sites[o.active]) bad('封存与活动分所状态冲突');
  if (o.support.queue.length > (o.knowledge.manifest ? 3 : 1)) bad('补给清单尚未解锁三包');
  if (!s.completed.includes('P12') && (o.support.enabled || o.support.queue.length || trip || o.nextCrew !== 1 || o.nextTrip !== 1)) bad('分所尚未开放');
  if (!s.completed.includes('P12') && RESOURCES.some(r => o.support.reserve[r] !== createOutposts().support.reserve[r])) bad('分所未开放不能改写支援保留量');
  if (o.nextCrew < Object.keys(o.sites).length * 2 + 1) bad('分所实例缺少实际派驻序列');
  if (o.active && (o.crew.length < 2 || o.crew.length > 2 + o.sites[o.active]!.facilities.dorm * 2)) bad('派驻人数超出分所住处');
  unique(o.crew.map(person => person.uid), '派驻标识');
  for (const person of o.crew) {
    const match = /^o-person-([1-9]\d*)$/.exec(person.uid);
    if (!match || !Number.isSafeInteger(Number(match[1])) || Number(match[1]) >= o.nextCrew || !districtState(s, person.district)) bad('派驻来源或序列错误');
  }
  if (o.knowledge.manifest !== (o.sites.O01?.handoff === true) || o.knowledge.lightFrame !== (o.sites.O02?.handoff === true)) bad('分所知识没有唯一交接来源');
  const totalSent = amounts(); let sentPackages = 0;
  for (const id of OUTPOST_IDS) {
    const site = o.sites[id];
    if (!site) {
      if (s.completed.some(key => key.startsWith(`${id}@`)) || s.queue.some(p => p.outpost === id)) bad('未建立分所包含工程');
      continue;
    }
    if (!site.initialTransferred) bad('分所缺少唯一初始转入');
    if (site.sent.light + site.sent.materials > SUPPORT_RULES.maxPackages) bad('分所追加额度超出四包');
    sentPackages += site.sent.light + site.sent.materials;
    if (id !== o.active && (site.assembly.enabled || RESIDENTS.some(type => JOBS.some(job => site.assignments[type][job])) || s.queue.some(p => p.outpost === id))) bad('封存地图仍在工作或排队');
    const limits = outpostLimits(s, id);
    for (const r of RESOURCES) {
      integer(site.resources[r], '分所库存及预留', 0, limits[r]);
      const f = site.ledger;
      if (f.rewards[r] || f.exports[r] || f.imports[r] || f.fulfillment[r] || f.fieldReserved[r] || f.supportSent[r]) bad('分所账本出现不支持的流量');
      if (site.earned[r] !== f.production[r]) bad('支援或退款不能增加分所累计取得');
      const sent = OUTPOST_INITIAL[r] + SUPPORT_KINDS.reduce((sum, kind) => sum + site.sent[kind] * SUPPORT_PACKAGES[kind].cargo[r], 0);
      if (f.supportReceived[r] !== sent - (trip?.outpost === id ? trip.cargo[r] : 0)) bad('分所初始包与各包型累计收支不守恒');
      totalSent[r] += sent;
      if (site.resources[r] !== f.production[r] + f.refunds[r] + f.supportReceived[r] - f.operating[r] - f.reserved[r]) bad('分所库存收支不守恒');
      if (f.refunds[r] > f.reserved[r]) bad('分所退款超过工程支出');
      if ((r === 'rainFilm' || r === 'railCore') && (site.resources[r] || site.earned[r] || FLOWS.some(flow => f[flow][r]))) bad('分所不能持有特产');
      if (s.queue.filter(p => p.outpost === id).reduce((sum, p) => sum + p.reserved[r], 0) > f.reserved[r] - f.refunds[r]) bad('分所运行项目缺少已预留支出');
    }
    for (const f of FACILITY_IDS) {
      const initial = f === 'dorm' || f === 'warehouse' ? 0 : 1;
      integer(site.facilities[f], '分所设施等级', initial, outpostMaxLevel(id, f));
      for (let level = initial + 1; level <= site.facilities[f]; level++) if (!site.completed.includes(`build:${f}:${level}`)) bad('分所设施缺少完工记录');
    }
    for (const type of RESIDENTS) if (JOBS.reduce((sum, job) => sum + site.assignments[type][job], 0) > outpostPopulation(s, id, type)) bad('分所岗位超过派驻人手');
    for (const job of JOBS) {
      const used = RESIDENTS.reduce((sum, type) => sum + site.assignments[type][job] + (job === 'repair' ? site.assignments[type].assemble : job === 'assemble' ? site.assignments[type].repair : 0), 0);
      if (used > outpostJobCapacity(s, id, job)) bad('分所岗位超过共享工位');
    }
    if (site.assembly.reserve.memory || site.assembly.reserve.component || site.assembly.reserve.rainFilm || site.assembly.reserve.railCore) bad('分所装配只能保留原料');
    if (site.bench.active && !site.bench.built.includes(site.bench.active)) bad('分所启用了未制作工具');
    for (const mod of site.bench.built) if (!s.experience.blueprints.includes(mod) || !site.completed.includes(`mod:${mod}`)) bad('分所工具缺少蓝图或制作记录');
    for (const key of site.completed) {
      if (!localCompletion(id, key) || !s.completed.includes(`${id}@${key}`)) bad('分所成果与全局记录不一致');
      if (key.startsWith('build:')) { const [, facility, level] = key.split(':'); if (Number(level) > site.facilities[facility as Facility]) bad('分所设施记录超出实际等级'); }
      if (key.startsWith('mod:') && !site.bench.built.includes(key.slice(4) as AssemblyMod)) bad('分所工具成果不一致');
    }
    for (const key of s.completed.filter(key => key.startsWith(`${id}@`))) if (!site.completed.includes(key.slice(4))) bad('全局分所成果缺少当地记录');
    for (let stage = 2; stage <= 3; stage++) if (site.completed.includes(`${id}-${stage}`) && !site.completed.includes(`${id}-${stage - 1}`)) bad('分所地图成果顺序错误');
    if (site.handoff && !site.completed.includes(`${id}-3`)) bad('分所交接未登记地址');
    if (site.lightFrame !== site.completed.includes('lightFrame') || site.lightFrame && !o.knowledge.lightFrame) bad('回照灯架缺少实际建造或知识');
    if (id === 'O01' ? (site.roofPrefab !== null) !== site.completed.includes('O01-2') || site.proof !== null : site.roofPrefab !== null || (site.proof !== null) !== site.completed.includes('O02-2')) bad('屋檐或庭院证明记录不一致');
    if (site.proof && !proofReady(site, site.proof)) bad('庭院成果缺少实际发电或已收支援');
  }
  if (o.nextTrip !== sentPackages + 1) bad('支援运单序列与发出次数不符');
  for (const r of RESOURCES) if (s.ledger.supportReceived[r] || s.ledger.supportSent[r] !== totalSent[r]) bad('旧城支援与所有分所及在途不守恒');
  if (s.ledger.operating.energy < sentPackages * SUPPORT_RULES.fee) bad('支援缺少实际发运费');
  if (trip) {
    if (trip.outpost !== o.active || !o.sites[trip.outpost] || trip.uid !== `o-trip-${o.nextTrip - 1}` || trip.duration !== SUPPORT_RULES.seconds || trip.remaining > trip.duration || o.sites[trip.outpost]!.sent[trip.kind] < 1 || RESOURCES.some(r => trip.cargo[r] !== SUPPORT_PACKAGES[trip.kind].cargo[r])) bad('支援在途目标、包型或快照错误');
  }
  for (const report of s.report?.outposts ?? []) {
    if (!o.sites[report.id]) bad('报告地图尚未建立');
    if (report.support.sent > o.sites[report.id]!.sent.light + o.sites[report.id]!.sent.materials || report.support.queued > (o.knowledge.manifest ? 3 : 1)) bad('分所报告支援记录尚未发生');
    for (const key of report.completed) if (!s.completed.includes(key.includes('@') ? key : `${report.id}@${key}`)) bad('分所报告缺少实际成果');
  }
  for (const key of s.report?.completed ?? []) if (key.includes('@') && !s.completed.includes(key)) bad('返回报告缺少实际分所成果');
}
