import { BALANCE_VERSION, EVENT_IDS, FACILITY_IDS, FLOWS, INITIAL, JOBS, POLICIES, PROJECTS, RESIDENTS, RESOURCES, RULES } from './config';
import { capacities, createGame, definitionFor, jobCapacity, populationCapacity, populationCount, projectKey } from './engine';
import type { Amounts, EventId, GameState, Ledger, ReturnReport } from './types';

export interface SaveEnvelope { format: 'districtzero'; schemaVersion: 1; balanceVersion: string; savedAt: number; state: GameState }
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
function readLedger(v: unknown): Ledger {
  const o = obj(v);
  return Object.fromEntries(FLOWS.map(f => [f, readAmounts(o[f], f)])) as Ledger;
}
function readReport(v: unknown): ReturnReport | null {
  if (v === null) return null;
  const o = obj(v), arrivals = obj(o.arrivals);
  const events = strings(o.events, '报告事件', 5).map(e => choice(e, EVENT_IDS, '报告事件'));
  const pending = strings(o.pending, '待处理事件', 5).map(e => choice(e, EVENT_IDS, '待处理事件'));
  if (typeof o.goal !== 'string' || o.goal.length > 1000) bad('报告目标格式错误');
  const report: ReturnReport = {
    awayMs: integer(o.awayMs, '离开时长'), seconds: integer(o.seconds, '结算时长'),
    start: readAmounts(o.start, '开始库存'), end: readAmounts(o.end, '结束库存'), flows: readLedger(o.flows),
    completed: strings(o.completed, '完工记录'), arrivals: { shadow: integer(arrivals.shadow, '新居民'), echo: integer(arrivals.echo, '新居民') },
    events, pending, reasons: strings(o.reasons, '停工原因'), goal: o.goal as string
  };
  for (const r of RESOURCES) {
    const expected = report.start[r] + report.flows.production[r] + report.flows.rewards[r] + report.flows.refunds[r] - report.flows.operating[r] - report.flows.reserved[r];
    if (report.end[r] !== expected) bad('返回报告收支不守恒');
  }
  return report;
}
export function assertInvariants(s: GameState) {
  const cap = capacities(s), initial = createGame();
  for (const r of RESOURCES) {
    integer(s.resources[r], r, 0, cap[r]);
    integer(s.earned[r], '累计取得');
    for (const f of FLOWS) integer(s.ledger[f][r], f);
    if (s.earned[r] !== s.ledger.production[r] + s.ledger.rewards[r]) bad('累计取得与生产奖励记录不一致');
    const expected = initial.resources[r] + s.ledger.production[r] + s.ledger.rewards[r] + s.ledger.refunds[r] - s.ledger.operating[r] - s.ledger.reserved[r];
    if (s.resources[r] !== expected) bad('库存收支不守恒');
  }
  for (const f of FACILITY_IDS) integer(s.facilities[f], '设施等级', initial.facilities[f], RULES.maxLevel);
  if (populationCount(s) > populationCapacity(s)) bad('人口超出住处容量');
  if (s.population.shadow < INITIAL.population || s.population.echo < 0 || populationCount(s) !== s.arrivals + INITIAL.population) bad('居民到达记录不一致');
  const expectedEcho = s.arrivals < RULES.firstEchoArrivals ? s.arrivals : RULES.firstEchoArrivals + Math.floor((s.arrivals - RULES.firstEchoArrivals) / 2);
  if (s.population.echo !== expectedEcho) bad('居民类型与到达顺序不一致');
  for (const type of RESIDENTS) {
    integer(s.population[type], '居民人数', 0, 8);
    if (JOBS.reduce((sum, j) => sum + integer(s.assignments[type][j], '岗位人数', 0, 8), 0) > s.population[type]) bad('分配人数超过居民人数');
  }
  for (const job of JOBS) if (s.assignments.shadow[job] + s.assignments.echo[job] > jobCapacity(s, job)) bad('岗位超过设施容量');
  if (s.priority.length !== 3 || new Set(s.priority).size !== 3 || !['salvage', 'repair', 'record'].every(j => s.priority.includes(j as typeof s.priority[number]))) bad('工作优先级不完整');
  if (s.queue.length > 3 || s.queue.filter(p => p.status !== 'waiting').length > 1 || s.queue.slice(1).some(p => p.status !== 'waiting')) bad('工务队列状态冲突');
  if (new Set(s.queue.map(p => p.definition)).size !== s.queue.length || new Set(s.queue.map(p => p.uid)).size !== s.queue.length) bad('队列项目重复');
  if (new Set(s.completed).size !== s.completed.length) bad('完工成果重复');
  for (const key of s.completed) {
    if (Object.hasOwn(PROJECTS, key)) continue;
    const match = /^build:(generator|recycler|workbench|dorm|warehouse|mailbox):([1-3])$/.exec(key);
    if (!match || Number(match[2]) > s.facilities[match[1] as keyof typeof s.facilities] || Number(match[2]) <= initial.facilities[match[1] as keyof typeof s.facilities]) bad('未知或不一致的完工成果');
  }
  for (const f of FACILITY_IDS) for (let level = initial.facilities[f] + 1; level <= s.facilities[f]; level++) {
    if (!s.completed.includes(`build:${f}:${level}`)) bad('缺少设施完工记录');
  }
  for (const p of s.queue) {
    const uid = /^q-(\d+)$/.exec(p.uid);
    if (!uid || Number(uid[1]) >= s.nextProject || Number(uid[1]) < 1) bad('项目序列错误');
    if (s.completed.includes(projectKey(p))) bad('已完成项目重复入队');
    if (p.definition.startsWith('build:')) {
      const f = p.definition.slice(6) as keyof typeof s.facilities;
      if (!FACILITY_IDS.includes(f) || p.targetLevel !== s.facilities[f] + 1 || p.targetLevel > 3) bad('设施目标等级错误');
    } else if (!Object.hasOwn(PROJECTS, p.definition) || p.targetLevel !== 1) bad('工程定义错误');
    const d = definitionFor(s, p.definition, p.targetLevel);
    integer(p.progress, '工程进度', 0, d.work - 1);
    for (const r of RESOURCES) if (p.reserved[r] !== (p.status === 'waiting' ? 0 : d.cost[r])) bad('预留费用不一致');
    if (p.status === 'waiting' && p.progress !== 0) bad('未开工项目存在进度');
  }
  if (s.completed.includes('P02') && !s.completed.includes('P01')) bad('主线顺序错误');
  if (s.completed.includes('P03') && (!s.completed.includes('P02') || !s.facilities.mailbox || !s.facilities.dorm || !s.facilities.warehouse || s.earned.memory < RULES.platformUnlockMemory)) bad('首章成果缺少条件');
  if (s.address !== (s.completed.includes('P03') ? '0-001' : null)) bad('地址与首章成果不一致');
  const triggers = { E01: s.completed.includes('P01'), E02: s.completed.includes('P02'), E03: s.population.echo > 0, E04: s.facilities.mailbox > 0 && s.earned.memory >= RULES.researchUnlockMemory, E05: s.completed.includes('P03') };
  for (const id of EVENT_IDS) if (Boolean(s.events[id]) !== triggers[id]) bad('事件与触发条件不一致');
  if (s.completed.some(id => id === 'R01' || id === 'R02') && !s.events.E04) bad('研究缺少解锁条件');
  if (s.lightingChosen !== (s.events.E03?.status === 'claimed')) bad('照明选择状态不一致');
  if (s.lightingChosen && !s.events.E03?.choice) bad('缺少首次照明选择');
  if (!s.lightingChosen && s.lighting !== 'steady') bad('照明尚未开放');
  if (s.memoryProduced && (!s.facilities.mailbox || !s.ledger.production.memory)) bad('记忆生产状态不一致');
  integer(s.arrivalSeconds, '到达计时', 0, 119);
  integer(s.clock.seconds, '模拟时间'); integer(s.clock.lastAt, '最近结算时间'); integer(s.clock.remainderMs, '毫秒余量', 0, 999);
}
function readState(v: unknown): GameState {
  const o = obj(v), f = obj(o.facilities), population = obj(o.population), assignment = obj(o.assignments), clock = obj(o.clock), events = obj(o.events);
  if (o.district !== 'district-0' || typeof o.lightingChosen !== 'boolean' || typeof o.memoryProduced !== 'boolean') bad('街区或状态标志错误');
  if (Object.keys(events).some(id => !EVENT_IDS.includes(id as EventId))) bad('未知事件');
  if (!Array.isArray(o.queue) || o.queue.length > 3) bad('工务队列格式错误');
  if (!Array.isArray(o.history) || o.history.length > 40) bad('近期记录格式错误');
  const s: GameState = {
    district: 'district-0', resources: readAmounts(o.resources, '库存'), earned: readAmounts(o.earned, '累计取得'), ledger: readLedger(o.ledger),
    facilities: Object.fromEntries(FACILITY_IDS.map(id => [id, integer(f[id], '设施等级', 0, 3)])) as GameState['facilities'],
    population: { shadow: integer(population.shadow, '影子居民', 0, 8), echo: integer(population.echo, '回声居民', 0, 8) },
    arrivalSeconds: integer(o.arrivalSeconds, '到达计时', 0, 119), arrivals: integer(o.arrivals, '到达人数', 0, 6),
    assignments: Object.fromEntries(RESIDENTS.map(type => {
      const jobs = obj(assignment[type]);
      return [type, Object.fromEntries(JOBS.map(job => [job, integer(jobs[job], '分配人数', 0, 8)]))];
    })) as GameState['assignments'],
    lighting: choice(o.lighting, Object.keys(POLICIES) as GameState['lighting'][], '照明'), lightingChosen: o.lightingChosen as boolean,
    priority: strings(o.priority, '优先级', 3).map(j => choice(j, ['salvage', 'repair', 'record'] as const, '优先级')),
    queue: (o.queue as unknown[]).map(v => {
      const p = obj(v);
      if (typeof p.uid !== 'string' || typeof p.definition !== 'string' || p.definition.length > 40) bad('项目标识错误');
      return { uid: p.uid as string, definition: p.definition as GameState['queue'][number]['definition'], targetLevel: integer(p.targetLevel, '目标等级', 1, 3),
        status: choice(p.status, ['waiting', 'running', 'paused'] as const, '项目状态'), progress: integer(p.progress, '进度'), reserved: readAmounts(p.reserved, '预留费用') };
    }),
    completed: strings(o.completed, '成果', 23),
    events: Object.fromEntries(Object.entries(events).map(([id, v]) => {
      const e = obj(v), status = choice(e.status, ['pending', 'claimed'] as const, '事件状态');
      const chosen = e.choice === undefined ? undefined : choice(e.choice, ['bright', 'dim'] as const, '事件选择');
      if (chosen && (id !== 'E03' || status !== 'claimed')) bad('事件选择错误');
      return [id, chosen ? { status, choice: chosen } : { status }];
    })),
    memoryProduced: o.memoryProduced as boolean, address: o.address === null ? null : choice(o.address, ['0-001'] as const, '地址'),
    clock: { seconds: integer(clock.seconds, '模拟时间'), remainderMs: integer(clock.remainderMs, '毫秒余量', 0, 999), lastAt: integer(clock.lastAt, '最近结算时间') },
    nextProject: integer(o.nextProject, '项目序列', 1), theme: choice(o.theme, ['dark', 'light'] as const, '主题'), report: readReport(o.report),
    history: (o.history as unknown[]).map(v => {
      const h = obj(v);
      if (typeof h.text !== 'string' || h.text.length > 1000) bad('近期文字格式错误');
      return { second: integer(h.second, '记录时间'), text: h.text as string };
    })
  };
  assertInvariants(s);
  return s;
}
export function encodeSave(state: GameState, savedAt: number): string {
  assertInvariants(state);
  return JSON.stringify({ format: 'districtzero', schemaVersion: 1, balanceVersion: BALANCE_VERSION, savedAt: integer(savedAt, '保存时间'), state } satisfies SaveEnvelope, null, 2);
}
export function decodeSave(text: string): SaveEnvelope {
  if (text.length > 2_000_000) bad('文件超过 2 MB');
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return bad('无法解析 JSON 文本'); }
  const o = obj(parsed);
  if (o.format !== 'districtzero') bad('这不是第0街区存档');
  if (o.schemaVersion !== 1) bad('结构版本不兼容，当前仅支持版本 1');
  if (o.balanceVersion !== BALANCE_VERSION) bad('数值版本不兼容');
  return { format: 'districtzero', schemaVersion: 1, balanceVersion: BALANCE_VERSION, savedAt: integer(o.savedAt, '保存时间'), state: readState(o.state) };
}
