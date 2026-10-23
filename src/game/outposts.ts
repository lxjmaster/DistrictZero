import { amounts, BASE, cost, FACILITIES, FACILITY_IDS, FLOWS, INPUTS, JOBS, jobFacility, POLICIES, RESEARCH_EFFECTS, RESIDENTS, RESOURCES, resourceNames, RULES, TRAITS, UNIT, WAREHOUSE_CAPACITY, WORK_JOBS } from './config';
import { ASSEMBLY, MOD_IDS, prefabLimit, prefabricated } from './experience';
import { idleResidents } from './neighborhood';
import type { Amounts, AssemblyMod, DefinitionId, DistrictId, Facility, GameState, Job, Ledger, Project, ProjectDefinition, Resident, Resource } from './types';
import type { OutpostAction, OutpostId, OutpostProject, OutpostProof, OutpostState, OutpostsState, SupportKind } from './outpost-types';

export const OUTPOST_IDS: OutpostId[] = ['O01', 'O02'];
export const OUTPOSTS = {
  O01: { name: '无库巷', address: '0-101', capacity: amounts(80000, 80000, 24000, 6000), power: 1, description: '不能建仓库，只有有限工作暂存；在需要的时候安排生产与施工。' },
  O02: { name: '借光庭', address: '0-102', capacity: amounts(120000, 120000, 40000, 10000), power: 0.5, description: '本地发电产出减半；留人值守，或使用有限旧城补给。' }
} satisfies Record<OutpostId, { name: string; address: string; capacity: Amounts; power: number; description: string }>;
export const OUTPOST_INITIAL = amounts(20000, 20000, 8000);
export const SUPPORT_RULES = { fee: 4000, seconds: 60, maxPackages: 4 };
export const SUPPORT_KINDS: SupportKind[] = ['light', 'materials'];
export const SUPPORT_PACKAGES = {
  light: { name: '光包', cargo: amounts(40000) },
  materials: { name: '工料包', cargo: amounts(10000, 20000, 4000) }
};
export const OUTPOST_PROJECTS: Record<OutpostProject, ProjectDefinition> = {
  'O01-1': { id: 'O01-1', name: '清出巷口工作台', description: '给每件正在使用的东西留一处工位。', cost: cost(30, 20, 6), work: 180000 },
  'O01-2': { id: 'O01-2', name: '把屋檐接成一条路', description: '可以现场施工，也可以选用预制；回信会记住真正采用的方式。', cost: cost(24, 10, 4), work: 240000 },
  'O01-3': { id: 'O01-3', name: '给无库巷留下地址', description: '登记0-101，等待你确认分所补给清单的交接。', cost: cost(50, 30, 12, 3), work: 300000 },
  'O02-1': { id: 'O02-1', name: '接好借光插口', description: '接好庭院的入口；插口不会凭空产生电量。', cost: cost(30, 20, 6), work: 180000 },
  'O02-2': { id: 'O02-2', name: '安排庭院的下一班', description: '选择累计实际发电60，或收到追加补给电量80，作为交班证明。', cost: cost(40, 20, 8, 2), work: 240000 },
  'O02-3': { id: 'O02-3', name: '让院子有自己的地址', description: '登记0-102，等待你确认回照灯架蓝图的交接。', cost: cost(60, 40, 16, 3), work: 360000 }
};

const emptyAssignments = (): OutpostState['assignments'] => ({ shadow: { power: 0, salvage: 0, repair: 0, record: 0, assemble: 0 }, echo: { power: 0, salvage: 0, repair: 0, record: 0, assemble: 0 } });
function createSite(): OutpostState {
  return {
    resources: amounts(), earned: amounts(), ledger: Object.fromEntries(FLOWS.map(flow => [flow, amounts()])) as Ledger,
    facilities: { generator: 1, recycler: 1, workbench: 1, dorm: 0, warehouse: 0, mailbox: 1 },
    assignments: emptyAssignments(), lighting: 'steady', priority: [...WORK_JOBS],
    assembly: { enabled: false, target: 3000, reserve: amounts(10000, 10000) }, bench: { built: [], active: null },
    completed: [], roofPrefab: null, proof: null, handoff: false, lightFrame: false, initialTransferred: false,
    sent: { light: 0, materials: 0 }
  };
}
export function createOutposts(): OutpostsState {
  return { active: null, sites: {}, crew: [], support: { enabled: false, queue: [], reserve: amounts(50000, 30000, 10000), trip: null }, knowledge: { manifest: false, lightFrame: false }, nextCrew: 1, nextTrip: 1 };
}
export function outpostCapacities(s: GameState, id: OutpostId): Amounts {
  const capacity = { ...OUTPOSTS[id].capacity }, level = s.outposts.sites[id]?.facilities.warehouse ?? 0;
  for (const r of RESOURCES) capacity[r] += level * (r === 'component' ? ASSEMBLY.warehouseCapacity : WAREHOUSE_CAPACITY[r]);
  return capacity;
}
export function outpostReservedSpace(s: GameState, id: OutpostId): Amounts {
  const trip = s.outposts.support.trip;
  return trip?.outpost === id ? { ...trip.cargo } : amounts();
}
export function outpostLimits(s: GameState, id: OutpostId): Amounts {
  const capacity = outpostCapacities(s, id), held = outpostReservedSpace(s, id);
  for (const r of RESOURCES) capacity[r] -= held[r];
  return capacity;
}
export const stationedWorkers = (s: GameState, district: DistrictId, resident: Resident) => s.outposts.crew.filter(p => p.district === district && p.resident === resident).length;
export const outpostWorkers = (s: GameState, id: OutpostId, job: Job) => { const d = s.outposts.sites[id]; return d ? d.assignments.shadow[job] + d.assignments.echo[job] : 0; };
export const outpostFree = (s: GameState, id: OutpostId, resident: Resident) => s.outposts.active === id ? s.outposts.crew.filter(p => p.resident === resident).length - JOBS.reduce((sum, job) => sum + (s.outposts.sites[id]?.assignments[resident][job] ?? 0), 0) : 0;
export const outpostJobCapacity = (s: GameState, id: OutpostId, job: Job) => { const level = s.outposts.sites[id]?.facilities[jobFacility[job]] ?? 0; return level ? level + 1 : 0; };
export const outpostMaxLevel = (id: OutpostId, facility: Facility) => facility === 'warehouse' ? id === 'O01' ? 0 : 1 : facility === 'dorm' ? 1 : RULES.maxLevel;
export const outpostPopulation = (s: GameState, id: OutpostId, resident?: Resident) => s.outposts.active === id ? s.outposts.crew.filter(p => resident === undefined || p.resident === resident).length : 0;
export const outpostAssemblyRecipe = (s: GameState, id: OutpostId) => ASSEMBLY.recipes[s.outposts.sites[id]?.bench.active ?? 'ordinary'];
const efficiency = (d: OutpostState, job: Job) => 1 + RULES.efficiencyGrowth * (d.facilities[jobFacility[job]] - 1);
const localKey = (p: Pick<Project, 'definition' | 'targetLevel'>) => p.definition.startsWith('build:') ? `${p.definition}:${p.targetLevel}` : p.definition;
export const outpostProjectKey = (p: Pick<Project, 'definition' | 'targetLevel' | 'outpost'>) => `${p.outpost}@${localKey(p)}`;
export const outpostPrefabLimit = (definition: ProjectDefinition) => definition.id === 'lightFrame' ? 0 : prefabLimit(definition);
export function outpostDefinition(s: GameState, id: OutpostId, definition: DefinitionId, targetLevel?: number, prefab = 0): ProjectDefinition {
  let base: ProjectDefinition;
  if (Object.hasOwn(OUTPOST_PROJECTS, definition)) base = OUTPOST_PROJECTS[definition as OutpostProject];
  else if (definition === 'lightFrame') base = { id: definition, name: '建造回照灯架', description: '当地照明耗电减半，不提高工作倍率、不新增维护消耗。', cost: cost(20, 10, 4, 2), work: 120000 };
  else if (definition.startsWith('mod:')) {
    const mod = definition.slice(4) as AssemblyMod;
    base = { id: definition, name: `制作${ASSEMBLY.recipes[mod].name}`, description: '本地制作，不复制旧城工具；完工后可手动启用。', cost: ASSEMBLY.modCost, work: ASSEMBLY.modWork };
  } else if (definition.startsWith('build:')) {
    const facility = definition.slice(6) as Facility, config = FACILITIES[facility];
    const level = (targetLevel ?? (s.outposts.sites[id]?.facilities[facility] ?? 0) + 1) - 1, payment = amounts();
    for (const r of RESOURCES) payment[r] = Math.ceil(config.cost[r] / UNIT * RULES.costGrowth ** level) * UNIT;
    base = { id: definition, name: `${config.name} · ${level + 1}级`, description: config.description, cost: payment, work: Math.ceil(config.work / UNIT * RULES.workGrowth ** level) * UNIT };
  } else throw new Error('未知分所工程');
  return prefabricated(base, prefab);
}
function unlockReason(s: GameState, id: OutpostId, definition: DefinitionId): string | null {
  const d = s.outposts.sites[id];
  if (!OUTPOST_IDS.includes(id) || !d || s.outposts.active !== id) return '请先启用这个分所';
  if (Object.hasOwn(OUTPOST_PROJECTS, definition)) {
    if (!definition.startsWith(`${id}-`)) return '这项工程属于另一张地图';
    if (d.completed.includes(definition)) return '本图已经完成该工程';
    const step = Number(definition.at(-1));
    return step > 1 && !d.completed.includes(`${id}-${step - 1}`) ? '请先完成本图上一项工程' : null;
  }
  if (definition === 'lightFrame') return !s.outposts.knowledge.lightFrame ? '先确认借光庭的蓝图交接' : d.lightFrame ? '本图已经建好回照灯架' : null;
  if (definition.startsWith('mod:')) {
    const mod = definition.slice(4) as AssemblyMod;
    return !MOD_IDS.includes(mod) || !s.experience.blueprints.includes(mod) ? '先发现对应工具蓝图' : d.bench.built.includes(mod) ? '本图已经制作过该工具' : null;
  }
  if (definition.startsWith('build:')) {
    const f = definition.slice(6) as Facility;
    if (!FACILITY_IDS.includes(f)) return '未知分所设施';
    if (f === 'warehouse' && id === 'O01') return '无库巷不能建设仓库';
    return d.facilities[f] >= outpostMaxLevel(id, f) ? '本图设施已达等级上限' : null;
  }
  return '这项工程不能安排在分所';
}
export function outpostEnqueueReason(s: GameState, id: OutpostId, definition: DefinitionId, proof?: OutpostProof): string | null {
  const why = unlockReason(s, id, definition);
  if (why) return why;
  if (definition === 'O02-2' ? proof !== 'local' && proof !== 'relay' : proof !== undefined) return '请为庭院交班选择有效证明，其他工程不需要证明';
  if (s.queue.some(p => p.outpost === id && p.definition === definition)) return '已在全局工务队列中';
  return s.queue.length >= RULES.maxQueue ? '全局工务队列已满（最多3项）' : null;
}
export function outpostProjectReasons(s: GameState, p: Project): string[] {
  if (!p.outpost || s.outposts.active !== p.outpost) return ['工程所属分所尚未启用'];
  if (p.status === 'paused') return ['项目已暂停，仍阻塞全局队首'];
  const d = s.outposts.sites[p.outpost]!, reasons: string[] = [];
  if (!outpostWorkers(s, p.outpost, 'repair')) reasons.push('本图未分配维修工');
  if (p.status === 'waiting') {
    const why = unlockReason(s, p.outpost, p.definition); if (why) reasons.push(why);
    if (p.definition === 'O02-2') {
      if (p.proof === 'local' && d.ledger.production.energy < 60000) reasons.push('本地值守等待累计实际发电60');
      else if (p.proof === 'relay' && d.ledger.supportReceived.energy - OUTPOST_INITIAL.energy < 80000) reasons.push('旧城接力等待追加补给实际收到80电量');
      else if (p.proof !== 'local' && p.proof !== 'relay') reasons.push('缺少庭院交班证明');
    }
    const payment = outpostDefinition(s, p.outpost, p.definition, p.targetLevel, p.prefab).cost;
    for (const r of RESOURCES) if (d.resources[r] < payment[r]) reasons.push(`本图缺少${((payment[r] - d.resources[r]) / UNIT).toFixed(3).replace(/\.?0+$/, '')}${resourceNames[r]}`);
  }
  return reasons;
}
function log(s: GameState, text: string) { s.history.push({ second: s.clock.seconds, text }); if (s.history.length > 40) s.history.shift(); }
function spend(d: Pick<OutpostState, 'resources' | 'ledger'>, payment: Amounts, flow: 'operating' | 'reserved' | 'supportSent') {
  for (const r of RESOURCES) { d.resources[r] -= payment[r]; d.ledger[flow][r] += payment[r]; }
}
function receive(d: OutpostState, cargo: Amounts) { for (const r of RESOURCES) { d.resources[r] += cargo[r]; d.ledger.supportReceived[r] += cargo[r]; } }
function validReserve(value: Amounts) { return !!value && RESOURCES.every(r => Number.isSafeInteger(value[r]) && value[r] >= 0 && value[r] <= ASSEMBLY.maxSetting); }
function transferReason(s: GameState, payment: Amounts, fee = 0): string | null {
  for (const r of RESOURCES) {
    const needed = payment[r] + (r === 'energy' ? fee : 0);
    if (s.resources[r] < needed) return `旧城${resourceNames[r]}不足`;
    if (s.resources[r] - needed < s.outposts.support.reserve[r]) return `等待旧城${resourceNames[r]}保留量`;
  }
  return null;
}
export function outpostSealReason(s: GameState): string | null {
  const id = s.outposts.active;
  if (!id) return '没有活动分所';
  if (s.queue.some(p => p.outpost === id)) return '请先完成或逐项确认取消本图全部工务';
  return s.outposts.support.trip ? '请先等待已发补给到达，不能取消在途货物' : null;
}
export function supportReason(s: GameState): string | null {
  const state = s.outposts, plan = state.support, id = state.active;
  if (!id) return '没有活动分所';
  if (!plan.enabled) return '支援清单已暂停';
  if (!plan.queue.length) return '支援清单已空，不会自动续填';
  if (plan.trip) return '已有一包补给在途';
  const d = state.sites[id]!;
  if (d.sent.light + d.sent.materials >= SUPPORT_RULES.maxPackages) return '本图4次追加补给额度已用完';
  const cargo = SUPPORT_PACKAGES[plan.queue[0]].cargo, reason = transferReason(s, cargo, SUPPORT_RULES.fee);
  if (reason) return reason;
  const limits = outpostLimits(s, id);
  return RESOURCES.some(r => d.resources[r] + cargo[r] > limits[r]) ? '分所整包空间不足，等待使用库存' : null;
}
export function outpostAction(s: GameState, action: OutpostAction): string | null {
  const state = s.outposts, id = state.active, d = id ? state.sites[id]! : undefined;
  if (action.type === 'support-pause') { state.support.enabled = false; return null; }
  if (action.type === 'support-plan') {
    if (!s.completed.includes('P12')) return '先完成分所登记台';
    if (typeof action.enabled !== 'boolean' || !Array.isArray(action.queue) || action.queue.length > (state.knowledge.manifest ? 3 : 1) || action.queue.some(k => !SUPPORT_KINDS.includes(k)) || !validReserve(action.reserve)) return '请填写有效补给清单与保留量';
    if (!id && (action.enabled || action.queue.length)) return '先启用分所再安排追加补给';
    state.support.enabled = action.enabled; state.support.queue = [...action.queue]; state.support.reserve = { ...action.reserve }; return null;
  }
  if (action.type === 'outpost-open') {
    if (!s.completed.includes('P12') || !s.experience.story['L04-2']) return '先完成分所登记台并阅读“带走的是办法”';
    if (!OUTPOST_IDS.includes(action.outpost) || id) return id ? '请先封存当前分所' : '未知分所地图';
    if (!Array.isArray(action.crew) || action.crew.length !== 2) return '请明确选择两名空闲居民';
    const requested = new Map<string, number>();
    for (const person of action.crew) {
      if (!RESIDENTS.includes(person.resident)) return '未知居民类型';
      const key = `${person.district}/${person.resident}`, count = (requested.get(key) ?? 0) + 1;
      if (idleResidents(s, person.district, person.resident) < count) return '来源街区没有足够空闲居民，请先撤回岗位或外派';
      requested.set(key, count);
    }
    const previous = state.sites[action.outpost];
    if (!previous) {
      const reason = transferReason(s, OUTPOST_INITIAL); if (reason) return reason;
      if (RESOURCES.some(r => OUTPOST_INITIAL[r] > OUTPOSTS[action.outpost].capacity[r])) return '目的分所初始容量不足';
    }
    const site = previous ?? createSite();
    if (!previous) { spend(s, OUTPOST_INITIAL, 'supportSent'); receive(site, OUTPOST_INITIAL); site.initialTransferred = true; state.sites[action.outpost] = site; }
    state.active = action.outpost;
    state.crew = action.crew.map(p => ({ ...p, uid: `o-person-${state.nextCrew++}` }));
    site.assignments = emptyAssignments(); site.assembly.enabled = false; state.support.enabled = false; state.support.queue = [];
    log(s, `${previous ? '重入' : '启用'}${OUTPOSTS[action.outpost].name}，两名居民的原住处保留。`); return null;
  }
  if (action.type === 'outpost-handoff') {
    if (!OUTPOST_IDS.includes(action.outpost)) return '未知分所地图';
    const site = state.sites[action.outpost];
    if (!site?.completed.includes(`${action.outpost}-3`) || site.handoff) return '这份地图交接尚未开放或已经确认';
    site.handoff = true;
    if (action.outpost === 'O01') state.knowledge.manifest = true; else state.knowledge.lightFrame = true;
    log(s, `${OUTPOSTS[action.outpost].name}交接已确认，知识保留，现有安排没有改变。`); return null;
  }
  if (!id || !d) return '请先启用分所';
  switch (action.type) {
    case 'outpost-seal': {
      const reason = outpostSealReason(s); if (reason) return reason;
      if (state.support.queue.length && action.confirmClear !== true) return '封存将清空未发补给清单，请明确确认';
      d.assignments = emptyAssignments(); d.assembly.enabled = false;
      state.support.enabled = false; state.support.queue = []; state.active = null; state.crew = [];
      log(s, `${OUTPOSTS[id].name}已封存；居民返回原住处并保持空闲，图内库存与成果保留。`); return null;
    }
    case 'outpost-reinforce':
      if (state.crew.length >= 2 + d.facilities.dorm * 2) return '分所住处已满，1级宿舍可增加两名派驻者';
      if (!RESIDENTS.includes(action.resident) || idleResidents(s, action.district, action.resident) <= 0) return '来源街区没有这类空闲居民';
      state.crew.push({ uid: `o-person-${state.nextCrew++}`, district: action.district, resident: action.resident }); return null;
    case 'outpost-recall': {
      const person = state.crew.find(p => p.uid === action.uid);
      if (!person) return '这名居民不在分所';
      if (state.crew.length <= 2) return '至少保留两名居民；全部撤回请封存分所';
      if (outpostFree(s, id, person.resident) <= 0) return '请先撤回这类居民的当地岗位';
      state.crew = state.crew.filter(p => p.uid !== action.uid); return null;
    }
    case 'outpost-assign': {
      if (!RESIDENTS.includes(action.resident) || !JOBS.includes(action.job) || action.delta !== 1 && action.delta !== -1) return '无效岗位操作';
      if (action.delta > 0) {
        if (outpostFree(s, id, action.resident) <= 0) return '分所没有这类空闲人手';
        const used = outpostWorkers(s, id, action.job) + (action.job === 'repair' ? outpostWorkers(s, id, 'assemble') : action.job === 'assemble' ? outpostWorkers(s, id, 'repair') : 0);
        if (used >= outpostJobCapacity(s, id, action.job)) return '分所岗位容量已满，维修与装配共享工位';
      } else if (d.assignments[action.resident][action.job] <= 0) return '该岗位没有可撤回的居民';
      d.assignments[action.resident][action.job] += action.delta; return null;
    }
    case 'outpost-priority':
      if (!Array.isArray(action.order) || action.order.length !== WORK_JOBS.length || new Set(action.order).size !== WORK_JOBS.length || !WORK_JOBS.every(j => action.order.includes(j))) return '优先级需要完整且不重复的岗位';
      d.priority = [...action.order]; return null;
    case 'outpost-lighting':
      if (!Object.hasOwn(POLICIES, action.lighting)) return '未知照明策略';
      if (d.lighting === action.lighting) return '已经使用该照明策略';
      if (d.resources.parts < RULES.switchParts) return '本地切换照明需要5零件';
      spend(d, amounts(0, RULES.switchParts), 'operating'); d.lighting = action.lighting; return null;
    case 'outpost-assembly':
      if (typeof action.enabled !== 'boolean' || !Number.isSafeInteger(action.target) || action.target < 0 || action.target > ASSEMBLY.maxSetting || !validReserve(action.reserve) || action.reserve.memory || action.reserve.component || action.reserve.rainFilm || action.reserve.railCore) return '装配目标与保留量无效，只能保留电量和零件';
      d.assembly = { enabled: action.enabled, target: action.target, reserve: { ...action.reserve } }; return null;
    case 'outpost-mod':
      if (action.mod !== null && !d.bench.built.includes(action.mod)) return '需要先在本图制作该工具';
      d.bench.active = action.mod; return null;
    case 'outpost-enqueue': {
      const reason = outpostEnqueueReason(s, id, action.definition, action.proof); if (reason) return reason;
      const base = outpostDefinition(s, id, action.definition), count = action.prefab ?? 0;
      if (!Number.isSafeInteger(count) || count < 0 || count > outpostPrefabLimit(base)) return '预制份数超出该工程上限';
      s.queue.push({ uid: `q-${s.nextProject++}`, definition: action.definition, district: 'district-0', outpost: id, targetLevel: action.definition.startsWith('build:') ? d.facilities[action.definition.slice(6) as Facility] + 1 : 1, prefab: count, proof: action.proof ?? null, legacyChapter: false, status: 'waiting', progress: 0, reserved: amounts() }); return null;
    }
  }
}

// As in the home economy, inputs are charged against cumulative actual work.
// Capacity released later in the same second reuses only that second's budget.
function perform(d: OutpostState, wanted: number, inputs: Amounts, room: number, output?: Resource, produced = 0, reserve = amounts()): number {
  if (wanted <= produced || room <= 0) return 0;
  let ratio = Math.min(1, (produced + room) / wanted);
  const paid = amounts();
  for (const r of RESOURCES) if (inputs[r] > 0) {
    paid[r] = Math.ceil(inputs[r] * produced / wanted - 1e-9);
    ratio = Math.min(ratio, (Math.max(0, d.resources[r] - reserve[r]) + paid[r]) / inputs[r]);
  }
  const actual = Math.floor(wanted * ratio + 1e-9) - produced;
  if (actual <= 0) return 0;
  const used = amounts();
  for (const r of RESOURCES) used[r] = Math.min(d.resources[r], Math.ceil(inputs[r] * (produced + actual) / wanted - 1e-9) - paid[r]);
  spend(d, used, 'operating');
  if (output) { d.resources[output] += actual; d.ledger.production[output] += actual; d.earned[output] += actual; }
  return actual;
}
interface ProductionBudget { job: 'salvage' | 'record' | 'assemble'; wanted: number; inputs: Amounts; output: Resource; produced: number; blocked: boolean; reserve: Amounts }
export function tickOutpost(s: GameState, fixedHead: Project | undefined): Project | null {
  const id = s.outposts.active;
  if (!id) return null;
  const d = s.outposts.sites[id]!, limits = outpostLimits(s, id);
  const powerWanted = Math.round(BASE.power * outpostWorkers(s, id, 'power') * efficiency(d, 'power') * OUTPOSTS[id].power);
  const powerMade = perform(d, powerWanted, amounts(), limits.energy - d.resources.energy, 'energy');
  const upkeep = Math.ceil(POLICIES[d.lighting].upkeep * (d.lightFrame ? 0.5 : 1)), light = d.resources.energy >= upkeep;
  if (light) spend(d, amounts(upkeep), 'operating');
  const budgets: ProductionBudget[] = [];
  let completed: Project | null = null;
  for (const job of d.priority) {
    const count = outpostWorkers(s, id, job); if (!count) continue;
    if (job === 'repair') {
      const p = fixedHead;
      if (!p || p.outpost !== id || p.status === 'paused') continue;
      if (p.status === 'waiting') {
        if (outpostProjectReasons(s, p).length) continue;
        p.reserved = { ...outpostDefinition(s, id, p.definition, p.targetLevel, p.prefab).cost };
        spend(d, p.reserved, 'reserved'); p.status = 'running';
      }
      const work = outpostDefinition(s, id, p.definition, p.targetLevel, p.prefab).work;
      const wanted = Math.round(BASE.repair * count * efficiency(d, 'repair') * (s.completed.includes('R01') ? RESEARCH_EFFECTS.R01 : 1));
      p.progress += perform(d, wanted, amounts(INPUTS.repair.energy * count), work - p.progress);
      if (p.progress >= work) completed = p;
      continue;
    }
    let wanted: number, inputs: Amounts, output: Resource, room: number, reserve = amounts();
    if (job === 'assemble') {
      if (!d.assembly.enabled) continue;
      const recipe = outpostAssemblyRecipe(s, id);
      wanted = Math.floor(recipe.rate * count * efficiency(d, job));
      inputs = amounts(wanted * recipe.energy, wanted * recipe.parts); output = 'component';
      room = Math.max(0, Math.min(limits.component, d.assembly.target) - d.resources.component); reserve = d.assembly.reserve;
    } else {
      const weighted = d.assignments.shadow[job] * (job === 'salvage' ? TRAITS.shadowSalvage : 1) + d.assignments.echo[job] * (job === 'record' ? TRAITS.echoMemory : 1);
      wanted = Math.round(BASE[job] * weighted * efficiency(d, job) * (light ? POLICIES[d.lighting][job] : 1) * (job === 'record' && s.completed.includes('R02') ? RESEARCH_EFFECTS.R02 : 1));
      inputs = amounts(INPUTS[job].energy * count, INPUTS[job].parts * count); output = job === 'salvage' ? 'parts' : 'memory'; room = limits[output] - d.resources[output];
    }
    const produced = perform(d, wanted, inputs, room, output, 0, reserve);
    budgets.push({ job, wanted, inputs, output, produced, blocked: room < wanted && produced === room, reserve });
  }
  for (const job of ['assemble', 'record', 'salvage'] as const) for (const budget of budgets.filter(b => b.job === job && b.blocked)) {
    const room = (job === 'assemble' ? Math.min(limits.component, d.assembly.target) : limits[budget.output]) - d.resources[budget.output];
    perform(d, budget.wanted, budget.inputs, room, budget.output, budget.produced, budget.reserve);
  }
  perform(d, powerWanted, amounts(), limits.energy - d.resources.energy, 'energy', powerMade);
  return completed;
}
export function completeOutpostProject(s: GameState, p: Project): void {
  if (!p.outpost) return;
  const d = s.outposts.sites[p.outpost]; if (!d) return;
  const key = localKey(p); if (d.completed.includes(key)) return;
  d.completed.push(key); s.completed.push(outpostProjectKey(p));
  if (p.definition.startsWith('build:')) d.facilities[p.definition.slice(6) as Facility] = p.targetLevel;
  else if (p.definition.startsWith('mod:')) d.bench.built.push(p.definition.slice(4) as AssemblyMod);
  else if (p.definition === 'lightFrame') d.lightFrame = true;
  else if (p.definition === 'O01-2') d.roofPrefab = p.prefab;
  else if (p.definition === 'O02-2') d.proof = p.proof ?? null;
  log(s, `完工：${outpostDefinition(s, p.outpost, p.definition, p.targetLevel, p.prefab).name} · ${OUTPOSTS[p.outpost].name}`);
}
export function tickSupport(s: GameState): void {
  const state = s.outposts, plan = state.support, trip = plan.trip;
  if (trip) {
    if (trip.remaining > 0) trip.remaining -= 1;
    if (trip.remaining === 0) {
      const d = state.sites[trip.outpost], capacity = outpostCapacities(s, trip.outpost);
      if (d && state.active === trip.outpost && RESOURCES.every(r => d.resources[r] + trip.cargo[r] <= capacity[r])) {
        receive(d, trip.cargo); plan.trip = null; log(s, `${OUTPOSTS[trip.outpost].name}收到${SUPPORT_PACKAGES[trip.kind].name}，整包已入库。`);
      }
    }
  }
  if (supportReason(s)) return;
  const id = state.active!, kind = plan.queue[0], cargo = { ...SUPPORT_PACKAGES[kind].cargo };
  spend(s, cargo, 'supportSent'); spend(s, amounts(SUPPORT_RULES.fee), 'operating');
  plan.trip = { uid: `o-trip-${state.nextTrip++}`, outpost: id, kind, cargo, duration: SUPPORT_RULES.seconds, remaining: SUPPORT_RULES.seconds };
  state.sites[id]!.sent[kind] += 1; plan.queue.shift();
  log(s, `向${OUTPOSTS[id].name}发出${SUPPORT_PACKAGES[kind].name}，目的地空间已预留。`);
}
export function outpostView(s: GameState, id: OutpostId) {
  const d = s.outposts.sites[id], net = amounts(), production = amounts(), operating = amounts(), reasons: string[] = [];
  if (!d || s.outposts.active !== id) return { lightOn: false, net, production, operating, reasons: ['地图尚未启用或已封存，不计生产'] };
  const clone = structuredClone(s), before = clone.outposts.sites[id]!, power = Math.round(BASE.power * outpostWorkers(s, id, 'power') * efficiency(d, 'power') * OUTPOSTS[id].power);
  const lightOn = Math.min(outpostLimits(s, id).energy, d.resources.energy + power) >= Math.ceil(POLICIES[d.lighting].upkeep * (d.lightFrame ? 0.5 : 1));
  tickOutpost(clone, clone.queue[0]);
  tickSupport(clone);
  for (const r of RESOURCES) {
    production[r] = before.ledger.production[r] - d.ledger.production[r]; operating[r] = before.ledger.operating[r] - d.ledger.operating[r];
    net[r] = production[r] - operating[r] + before.ledger.supportReceived[r] - d.ledger.supportReceived[r];
  }
  if (!lightOn) reasons.push('本图照明不足，加成暂时失效');
  if (s.queue[0]?.outpost === id) reasons.push(...outpostProjectReasons(s, s.queue[0]));
  else if (outpostWorkers(s, id, 'repair')) reasons.push('本图维修工等待所属工程成为全局队首');
  for (const job of ['salvage', 'record', 'assemble'] as const) if (outpostWorkers(s, id, job)) {
    const resource = job === 'salvage' ? 'parts' : job === 'record' ? 'memory' : 'component';
    if (!production[resource]) reasons.push(job === 'assemble' && !d.assembly.enabled ? '本图装配已暂停' : `${resourceNames[resource]}生产等待原料、目标或可用容量`);
  }
  return { lightOn, net, production, operating, reasons };
}
