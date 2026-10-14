import { amounts, BASE, EVENTS, FACILITIES, FACILITY_IDS, FLOWS, INITIAL, INPUTS, JOBS, jobFacility, jobNames, POLICIES, PROJECTS, RESEARCH_EFFECTS, RESIDENTS, RESOURCES, resourceNames, RULES, TRAITS, UNIT, WAREHOUSE_CAPACITY } from './config';
import type { Action, Amounts, DefinitionId, EventId, Facility, GameState, Job, Ledger, Lighting, Project, ProjectDefinition, Resident, ReturnReport } from './types';

export function emptyLedger(): Ledger {
  return Object.fromEntries(FLOWS.map(f => [f, amounts()])) as Ledger;
}
export function createGame(now = 0): GameState {
  return {
    district: 'district-0', resources: { ...INITIAL.resources }, earned: amounts(), ledger: emptyLedger(),
    facilities: { generator: 1, recycler: 1, workbench: 1, dorm: 0, warehouse: 0, mailbox: 0 },
    population: { shadow: INITIAL.population, echo: 0 }, arrivalSeconds: 0, arrivals: 0,
    assignments: { shadow: { power: 1, salvage: 1, repair: 0, record: 0 }, echo: { power: 0, salvage: 0, repair: 0, record: 0 } },
    lighting: 'steady', lightingChosen: false, priority: ['salvage', 'repair', 'record'], queue: [], completed: [],
    events: {}, memoryProduced: false, address: null, clock: { seconds: 0, remainderMs: 0, lastAt: now },
    nextProject: 1, theme: 'dark', report: null,
    history: [{ second: 0, text: '收到工务交接单：请让这里有地方可去。' }]
  };
}
export const populationCapacity = (s: GameState) => INITIAL.population + RULES.bedsPerDormLevel * s.facilities.dorm;
export const populationCount = (s: GameState) => s.population.shadow + s.population.echo;
export const workers = (s: GameState, job: Job) => s.assignments.shadow[job] + s.assignments.echo[job];
export const freeResidents = (s: GameState, type: Resident) => s.population[type] - JOBS.reduce((n, j) => n + s.assignments[type][j], 0);
export const jobCapacity = (s: GameState, job: Job) => s.facilities[jobFacility[job]] ? s.facilities[jobFacility[job]] + 1 : 0;
export const efficiency = (s: GameState, job: Job) => 1 + RULES.efficiencyGrowth * (s.facilities[jobFacility[job]] - 1);
export function capacities(s: GameState): Amounts {
  const level = s.facilities.warehouse;
  return amounts(INITIAL.capacities.energy + level * WAREHOUSE_CAPACITY.energy, INITIAL.capacities.parts + level * WAREHOUSE_CAPACITY.parts, INITIAL.capacities.memory + level * WAREHOUSE_CAPACITY.memory);
}
export const projectKey = (p: Pick<Project, 'definition' | 'targetLevel'>) => p.definition.startsWith('build:') ? `${p.definition}:${p.targetLevel}` : p.definition;
export function definitionFor(s: GameState, id: DefinitionId, targetLevel?: number): ProjectDefinition {
  if (!id.startsWith('build:')) return PROJECTS[id as keyof typeof PROJECTS];
  const facility = id.slice(6) as Facility;
  const level = (targetLevel ?? s.facilities[facility] + 1) - 1;
  const f = FACILITIES[facility];
  const scaledCost = amounts();
  for (const r of RESOURCES) scaledCost[r] = Math.ceil(f.cost[r] / UNIT * RULES.costGrowth ** level) * UNIT;
  return { id, name: `${f.name} · ${level + 1}级`, description: f.description, cost: scaledCost, work: Math.ceil(f.work / UNIT * RULES.workGrowth ** level) * UNIT };
}
export function unlockReason(s: GameState, id: DefinitionId): string | null {
  if (id.startsWith('build:')) {
    const f = id.slice(6) as Facility;
    if (!FACILITY_IDS.includes(f)) return '未知设施';
    if (s.facilities[f] >= RULES.maxLevel) return '已达最高等级';
    if (f === 'dorm' && !s.completed.includes('P01')) return '先让临时路灯亮起';
    if (f === 'warehouse' && s.earned.parts < RULES.warehouseUnlockParts) return `累计取得 ${format(RULES.warehouseUnlockParts)} 零件后开放（现有 ${format(s.earned.parts)}）`;
    if (f === 'mailbox' && !s.completed.includes('P02')) return '先给站牌写上“0”';
    if (f === 'workbench' && !s.memoryProduced) return '信箱首次实际生产记忆后开放';
    return null;
  }
  if (!Object.hasOwn(PROJECTS, id)) return '未知工程';
  if (s.completed.includes(id)) return '已经完成';
  if (id === 'P02' && !s.completed.includes('P01')) return '先让临时路灯亮起';
  if (id === 'P03') {
    if (!s.completed.includes('P02')) return '先给站牌写上“0”';
    if (!s.facilities.dorm || !s.facilities.warehouse || !s.facilities.mailbox) return '需要 1级宿舍、后场仓库和回声信箱';
    if (s.earned.memory < RULES.platformUnlockMemory) return `累计取得 ${format(RULES.platformUnlockMemory)} 记忆后开放（现有 ${format(s.earned.memory)}）`;
  }
  if ((id === 'R01' || id === 'R02') && !s.events.E04) return '等待信箱收到明天的信（信箱建成且累计取得 20 记忆）';
  return null;
}
export function enqueueReason(s: GameState, id: DefinitionId): string | null {
  return unlockReason(s, id) ?? (s.queue.some(p => p.definition === id) ? '已在工务队列中' : s.queue.length >= RULES.maxQueue ? '工务队列已满（最多 3项）' : null);
}
export function missingCost(s: GameState, c: Amounts): string[] {
  return RESOURCES.filter(r => s.resources[r] < c[r]).map(r => `缺少 ${format(c[r] - s.resources[r])} ${resourceNames[r]}`);
}
export function projectReasons(s: GameState, p = s.queue[0]): string[] {
  if (!p) return ['尚未安排工程'];
  if (p.status === 'paused') return ['项目已暂停，等待继续'];
  const reasons: string[] = [];
  if (!workers(s, 'repair')) reasons.push('未分配维修工');
  if (p.status === 'waiting') {
    const unlock = unlockReason(s, p.definition);
    if (unlock) reasons.push(unlock);
    reasons.push(...missingCost(s, definitionFor(s, p.definition, p.targetLevel).cost));
  }
  return reasons;
}
function log(s: GameState, text: string) {
  s.history.push({ second: s.clock.seconds, text });
  if (s.history.length > 40) s.history.shift();
}
function credit(s: GameState, resource: keyof Amounts, value: number, source: 'production' | 'rewards' | 'refunds') {
  const actual = Math.min(value, capacities(s)[resource] - s.resources[resource]);
  s.resources[resource] += actual;
  s.ledger[source][resource] += actual;
  if (source !== 'refunds') s.earned[resource] += actual;
}
function spend(s: GameState, inputs: Amounts, source: 'operating' | 'reserved') {
  for (const r of RESOURCES) { s.resources[r] -= inputs[r]; s.ledger[source][r] += inputs[r]; }
}

// Inputs follow cumulative work within this tick. Reusing capacity-blocked
// production charges only the difference, avoiding a second rounding charge.
function perform(s: GameState, wanted: number, inputs: Amounts, room: number, output?: keyof Amounts, produced = 0): number {
  if (wanted <= produced || room <= 0) return 0;
  let ratio = Math.min(1, (produced + room) / wanted);
  const paid = amounts();
  for (const r of RESOURCES) if (inputs[r] > 0) {
    paid[r] = Math.ceil(inputs[r] * produced / wanted - 1e-9);
    ratio = Math.min(ratio, (s.resources[r] + paid[r]) / inputs[r]);
  }
  const actual = Math.floor(wanted * ratio + 1e-9) - produced;
  if (actual <= 0) return 0;
  const used = amounts();
  for (const r of RESOURCES) used[r] = Math.min(s.resources[r], Math.ceil(inputs[r] * (produced + actual) / wanted - 1e-9) - paid[r]);
  spend(s, used, 'operating');
  if (output) credit(s, output, actual, 'production');
  return actual;
}
function weightedWorkers(s: GameState, job: Job) {
  return s.assignments.shadow[job] * (job === 'salvage' ? TRAITS.shadowSalvage : 1) + s.assignments.echo[job] * (job === 'record' ? TRAITS.echoMemory : 1);
}
function triggerEvents(s: GameState) {
  const triggers: Record<EventId, boolean> = {
    E01: s.completed.includes('P01'), E02: s.completed.includes('P02'), E03: s.population.echo > 0,
    E04: s.facilities.mailbox > 0 && s.earned.memory >= RULES.researchUnlockMemory, E05: s.completed.includes('P03')
  };
  for (const id of Object.keys(triggers) as EventId[]) if (triggers[id] && !s.events[id]) {
    s.events[id] = { status: 'pending' };
    log(s, id === 'E03' ? '一名回声居民抵达，照明选择等你决定。' : id === 'E04' ? '信箱收到一封明天的信，两项研究开放。' : `新的交接事项：${EVENTS[id].name}`);
  }
}
function completeProject(s: GameState, p: Project) {
  const key = projectKey(p);
  if (!s.completed.includes(key)) {
    s.completed.push(key);
    if (p.definition.startsWith('build:')) s.facilities[p.definition.slice(6) as Facility] = p.targetLevel;
    if (p.definition === 'P03') s.address = '0-001';
    log(s, `完工：${definitionFor(s, p.definition, p.targetLevel).name}`);
  }
  s.queue.shift();
}
interface TickResult { lightOn: boolean; output: Record<Job, number>; costs: Record<Job, Amounts>; reasons: string[] }
interface ProductionBudget { wanted: number; inputs: Amounts; resource: keyof Amounts; capacityBlocked: boolean }
function tick(s: GameState): TickResult {
  s.clock.seconds += 1;
  const result: TickResult = { lightOn: false, output: { power: 0, salvage: 0, repair: 0, record: 0 }, costs: { power: amounts(), salvage: amounts(), repair: amounts(), record: amounts() }, reasons: [] };
  const capacity = capacities(s);
  const powerWanted = Math.round(BASE.power * workers(s, 'power') * efficiency(s, 'power'));
  result.output.power = perform(s, powerWanted, amounts(), capacity.energy - s.resources.energy, 'energy');
  const production: Partial<Record<'salvage' | 'record', ProductionBudget>> = {};
  const policy = POLICIES[s.lighting];
  result.lightOn = s.resources.energy >= policy.upkeep;
  if (result.lightOn) spend(s, amounts(policy.upkeep), 'operating');
  else result.reasons.push('照明供电不足，加成暂时失效');
  let completed: Project | null = null;
  for (const job of s.priority) {
    const count = workers(s, job);
    if (!count) continue;
    const priorCosts = { ...s.ledger.operating };
    const inputs = amounts();
    for (const r of RESOURCES) inputs[r] = INPUTS[job][r] * count;
    if (job === 'repair') {
      const p = s.queue[0];
      if (!p || p.status === 'paused') continue;
      if (p.status === 'waiting') {
        if (projectReasons(s, p).length) continue;
        p.reserved = { ...definitionFor(s, p.definition, p.targetLevel).cost };
        spend(s, p.reserved, 'reserved');
        p.status = 'running';
      }
      const work = definitionFor(s, p.definition, p.targetLevel).work;
      const wanted = Math.round(BASE.repair * count * efficiency(s, 'repair') * (s.completed.includes('R01') ? RESEARCH_EFFECTS.R01 : 1));
      result.output.repair = perform(s, wanted, inputs, work - p.progress);
      p.progress += result.output.repair;
      if (p.progress >= work) completed = p;
      if (!result.output.repair) result.reasons.push('维修工等待电量');
    } else {
      const output = job === 'salvage' ? 'parts' : 'memory';
      const lighting = result.lightOn ? policy[job] : 1;
      const research = job === 'record' && s.completed.includes('R02') ? RESEARCH_EFFECTS.R02 : 1;
      const wanted = Math.round(BASE[job] * weightedWorkers(s, job) * efficiency(s, job) * lighting * research);
      const room = capacity[output] - s.resources[output];
      result.output[job] = perform(s, wanted, inputs, room, output);
      if (job === 'record' && result.output.record > 0) s.memoryProduced = true;
      production[job] = { wanted, inputs, resource: output, capacityBlocked: room < wanted && result.output[job] === room };
    }
    for (const r of RESOURCES) result.costs[job][r] = s.ledger.operating[r] - priorCosts[r];
  }
  // Later consumption and reservations can open storage space. Reuse only the
  // original capacity-blocked budget, after normal priority allocation. Refill
  // consumers before their inputs: memory, parts, then energy.
  for (const job of ['record', 'salvage'] as const) {
    const budget = production[job];
    if (!budget?.capacityBlocked) continue;
    const priorCosts = { ...s.ledger.operating };
    result.output[job] += perform(s, budget.wanted, budget.inputs, capacity[budget.resource] - s.resources[budget.resource], budget.resource, result.output[job]);
    for (const r of RESOURCES) result.costs[job][r] += s.ledger.operating[r] - priorCosts[r];
  }
  result.output.power += perform(s, powerWanted, amounts(), capacity.energy - s.resources.energy, 'energy', result.output.power);
  if (result.output.record > 0) s.memoryProduced = true;
  for (const job of ['salvage', 'record'] as const) {
    const budget = production[job];
    if (budget && result.output[job] < budget.wanted) result.reasons.push(s.resources[budget.resource] >= capacity[budget.resource] ? `${resourceNames[budget.resource]}满仓，${jobNames[job]}停止或减产` : `${jobNames[job]}原料不足，停止或减产`);
  }
  if (powerWanted > result.output.power && s.resources.energy >= capacity.energy) result.reasons.push(result.output.power ? '电量满仓，发电工按消耗补充' : '电量满仓，发电工待命');
  if (s.completed.includes('P01') && populationCount(s) < populationCapacity(s)) {
    s.arrivalSeconds += 1;
    if (s.arrivalSeconds >= RULES.arrivalSeconds) {
      const type: Resident = s.arrivals < RULES.firstEchoArrivals ? 'echo' : (s.arrivals - RULES.firstEchoArrivals) % 2 === 0 ? 'shadow' : 'echo';
      s.population[type] += 1; s.arrivals += 1; s.arrivalSeconds = 0;
      log(s, type === 'echo' ? '回声居民入住，带来一些旧声音。' : '影子居民入住，带来一袋无人认领的螺丝。');
    }
  } else s.arrivalSeconds = 0;
  if (completed) completeProject(s, completed);
  triggerEvents(s);
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
  if (s.address) return '地址 0-001 已登记。雨城的来信，等下一班车。';
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
    net[r] = production[r] - operating[r];
  }
  const reasons = [...projectReasons(s), ...tickResult.reasons];
  return { capacities: capacities(s), net, production, operating, costs: tickResult.costs, output: tickResult.output, lightOn: tickResult.lightOn, reasons: [...new Set(reasons)], goal: goal(s) };
}
export function summarize(before: GameState, after: GameState, awayMs: number): ReturnReport {
  const flows = emptyLedger();
  for (const f of FLOWS) for (const r of RESOURCES) flows[f][r] = after.ledger[f][r] - before.ledger[f][r];
  return {
    awayMs: Math.max(0, awayMs), seconds: after.clock.seconds - before.clock.seconds,
    start: { ...before.resources }, end: { ...after.resources }, flows,
    completed: after.completed.filter(id => !before.completed.includes(id)),
    arrivals: { shadow: after.population.shadow - before.population.shadow, echo: after.population.echo - before.population.echo },
    events: (Object.keys(after.events) as EventId[]).filter(id => !before.events[id]),
    pending: (Object.keys(after.events) as EventId[]).filter(id => after.events[id]?.status === 'pending'),
    reasons: view(after).reasons, goal: goal(after)
  };
}
export function refundPreview(s: GameState, p: Project) {
  const full = amounts(), actual = amounts(), overflow = amounts();
  const work = definitionFor(s, p.definition, p.targetLevel).work;
  for (const r of RESOURCES) {
    full[r] = Math.floor(p.reserved[r] / UNIT * (work - p.progress) / work) * UNIT;
    actual[r] = Math.min(full[r], capacities(s)[r] - s.resources[r]);
    overflow[r] = full[r] - actual[r];
  }
  return { full, actual, overflow };
}
export function applyAction(state: GameState, action: Action): { state: GameState; error: string | null } {
  const s = structuredClone(state);
  const fail = (error: string) => ({ state, error });
  switch (action.type) {
    case 'assign': {
      const { resident, job, delta } = action;
      if (!RESIDENTS.includes(resident) || !JOBS.includes(job) || (delta !== 1 && delta !== -1)) return fail('无效岗位操作');
      if (delta > 0 && freeResidents(s, resident) <= 0) return fail('这类居民没有空闲人手，请先撤回其他岗位');
      if (delta > 0 && workers(s, job) >= jobCapacity(s, job)) return fail('岗位容量已满或设施尚未建设');
      if (delta < 0 && s.assignments[resident][job] <= 0) return fail('该岗位没有可撤回的居民');
      s.assignments[resident][job] += delta;
      break;
    }
    case 'priority':
      if (action.order.length !== 3 || new Set(action.order).size !== 3 || !['salvage', 'repair', 'record'].every(j => action.order.includes(j as typeof action.order[number]))) return fail('优先级需要完整且不重复的岗位');
      s.priority = [...action.order]; break;
    case 'enqueue': {
      const reason = enqueueReason(s, action.definition);
      if (reason) return fail(reason);
      const targetLevel = action.definition.startsWith('build:') ? s.facilities[action.definition.slice(6) as Facility] + 1 : 1;
      s.queue.push({ uid: `q-${s.nextProject++}`, definition: action.definition, targetLevel, status: 'waiting', progress: 0, reserved: amounts() });
      break;
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
        log(s, `取消：${definitionFor(s, p.definition, p.targetLevel).name}，剩余费用已按容量返还。`);
      }
      break;
    }
    case 'lighting': {
      if (!s.lightingChosen || !s.events.E03 || !(action.lighting in POLICIES)) return fail('请先在“有人来住”事件中选择照明');
      if (s.lighting === action.lighting) return fail('已使用该照明策略');
      if (s.resources.parts < RULES.switchParts) return fail('切换需要 5 零件');
      spend(s, amounts(0, RULES.switchParts), 'operating'); s.lighting = action.lighting; break;
    }
    case 'event': {
      const e = s.events[action.event];
      if (!e || e.status !== 'pending') return fail('该事件尚未出现或已经处理');
      if (action.event === 'E03') {
        if (action.choice !== 'bright' && action.choice !== 'dim') return fail('请选择明灯或暗灯');
        s.lighting = action.choice; s.lightingChosen = true; e.choice = action.choice;
      } else {
        const reward = EVENTS[action.event].reward.memory;
        if (s.resources.memory + reward > capacities(s).memory) return fail('记忆容量不足，请先腾出空间；奖励保留待领取');
        credit(s, 'memory', reward, 'rewards');
      }
      e.status = 'claimed'; log(s, `已处理交接事项：${EVENTS[action.event].name}`); triggerEvents(s); break;
    }
    case 'theme': s.theme = action.theme; break;
    case 'dismiss-report': s.report = null; break;
  }
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
export function completionName(key: string) {
  if (Object.hasOwn(PROJECTS, key)) return PROJECTS[key as keyof typeof PROJECTS].name;
  const [, facility, level] = key.split(':');
  return `${FACILITIES[facility as Facility]?.name ?? key} · ${level}级`;
}
export function policyName(lighting: Lighting) { return POLICIES[lighting].name; }
