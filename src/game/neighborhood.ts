import { amounts, cost, RESIDENTS, RESOURCES, UNIT } from './config';
import { activeDistricts, districtState, DISTRICTS, DISTRICT_IDS, localFree } from './city';
import { awayWorkers } from './network';
import type { Amounts, CommissionGroup, CommissionStage, DistrictId, FieldKind, FieldOrder, FieldResult, FieldSite, GameState, MailboxMod, Modification, NeighborhoodState, Resident } from './types';

export const COMMISSION_GROUPS: CommissionGroup[] = ['CM01', 'CM02', 'CM03', 'CM04', 'CM05', 'CM06'];
export const OPEN_GROUPS = COMMISSION_GROUPS.slice(0, 3);
export const COMMISSION_IDS = OPEN_GROUPS.flatMap(id => [1, 2, 3].map(n => `${id}-${n}` as CommissionStage));
export const FIELD_IDS: FieldSite[] = ['F01', 'F02', 'F03', 'F04'];
export const MAIL_MOD_IDS: MailboxMod[] = ['voiceBox', 'dispatchBox'];
export const MAIL_MODS = {
  voiceBox: { name: '留声匣', text: '记录产出×1.20，基础零件消耗×1.50，基础用电不变。' },
  dispatchBox: { name: '投递匣', text: '照明有效且已研究巡检手册时，逐项交付已确认的委托清单。' }
};
export const NEIGHBORHOOD_RULES = { mailCost: cost(0, 10, 8, 3), mailWork: 90 * UNIT, maxSetting: 1_000_000 * UNIT, maxPending: 3, voiceOutput: 1.2, voiceParts: 1.5 };
interface CommissionDefinition {
  name: string; contact: string; text: string; payment: Amounts; reward: Amounts; blueprint?: Modification;
}
export const COMMISSIONS: Record<string, CommissionDefinition> = {
  'CM01-1': { name: '给灯做一顶帽子', contact: '修表住客', text: '“灯光别总朝天上照。”住客拿来一张灯罩草图，旁边是借工具的储物柜编号。', payment: cost(4, 4, 0, 1), reward: amounts(), blueprint: 'quickJig' },
  'CM01-2': { name: '借出的工具回来了', contact: '修表住客', text: '查清储物柜的借还记录后，就能把帽檐固定好。住客想知道你在那里听见或找到了什么。', payment: amounts(), reward: cost(0, 0, 4) },
  'CM01-3': { name: '帽檐下的回信', contact: '修表住客', text: '收音机的那一下已经有了回应。住客留下灯罩草图：“以后谁来修灯，也能照着做。”', payment: amounts(), reward: amounts() },
  'CM02-1': { name: '把晾衣绳留在地图上', contact: '巷口老人', text: '老人不要一条更直的路，只想让衣服和经过的人都能留下。这份协作也可以写进联络证明。', payment: cost(4, 4, 0, 2), reward: amounts(), blueprint: 'thriftBench' },
  'CM02-2': { name: '路从衣服下面经过', contact: '巷口老人', text: '去另一端核实过通行线，再替老人补上一个固定点。地图上可以留下真正走过的路。', payment: cost(1, 2), reward: cost(0, 0, 2) },
  'CM02-3': { name: '一张不再画长的地图', contact: '巷口老人', text: '地址簿已经编好。老人把晾衣绳画在封底：“路到这里就够了，明天还要晒衣服。”', payment: amounts(), reward: amounts() },
  'CM03-1': { name: '给信箱搭一条廊', contact: '邮递员', text: '雨还没来，邮递员先带来屋檐图样。让两扇窗都能找到投递的地方，记作一份街区协作。', payment: cost(0, 4, 4, 2), reward: amounts(), blueprint: 'dispatchBox' },
  'CM03-2': { name: '窗后有人代收', contact: '邮递员', text: '窗口的有限线索核实以后，把这份已确认的信送进去。投递不替窗后的人决定怎么回信。', payment: amounts(), reward: cost(0, 0, 4) },
  'CM03-3': { name: '窗口的回执', contact: '邮递员', text: '听完地址簿后的回访，再收好这张回执。两扇窗留下的字迹不一样。', payment: amounts(), reward: amounts() }
};
export const FIELD_SITES = {
  F01: { name: '站台储物柜', text: '柜门的借还日期停在昨天，里面的工具却每天换一个位置。', payment: cost(4, 4), seconds: 90, branches: ['整理旧工具', '对准旧调频'], rewards: [cost(8, 0, 0, 1), amounts()], blueprints: [null, 'quickJig'], supply: cost(8, 0, 0, 1), clue: cost(0, 0, 2), clueText: '工具借还记录：每个借用的人都给灯留了一点新用途。' },
  F02: { name: '停在半层的楼梯', text: '上半层与下半层都找不到的门，恰好能收到邮差的信。', payment: cost(4, 6), seconds: 120, branches: ['画下电路', '确认住户'], rewards: [cost(0, 20), cost(0, 0, 6)], blueprints: [null, null], supply: cost(0, 0, 14), clue: amounts(), clueText: '半层回信：不用把声音放大，只要让它有地方停留。附留声匣图样。' },
  F03: { name: '晾衣绳另一端', text: '绳子穿过巷口。你从下面走过去，老人便知道今天有人来过。', payment: cost(6, 6), seconds: 180, branches: ['收好旧架', '留下通行的路'], rewards: [cost(12, 0, 0, 1), amounts()], blueprints: [null, 'thriftBench'], supply: cost(14, 0, 0, 2), clue: cost(0, 0, 4), clueText: '巷口通行记录：没有搬走的晾衣绳，也可以是路标。' },
  F04: { name: '无法投递的窗口', text: '同一块门牌，两扇亮着的窗。信封上没有写该敲哪一边。', payment: cost(4, 4, 2), seconds: 180, branches: ['整理投递规则', '听完窗后的话'], rewards: [amounts(), amounts()], blueprints: ['dispatchBox', 'voiceBox'], supply: cost(0, 0, 20), clue: cost(0, 0, 2), clueText: '窗口回执线索：有人愿意代收，也愿意等另一家写完自己的名字。' }
} as const;
export function createNeighborhood(): NeighborhoodState {
  return {
    commissions: { completed: [], tracked: [], shown: {}, nextShown: 1 },
    field: { active: null, queue: [], pending: [], sites: Object.fromEntries(FIELD_IDS.map(id => [id, { first: null, clue: false, supplies: 0 }])) as NeighborhoodState['field']['sites'], nextTrip: 1, returns: 0, recalls: 0, consumed: amounts(), refunded: amounts(), rewarded: amounts() },
    mailboxes: Object.fromEntries(DISTRICT_IDS.map(id => [id, { built: [] as MailboxMod[], active: null as MailboxMod | null }])) as NeighborhoodState['mailboxes'],
    delegation: { enabled: false, district: 'district-0', stages: [], reserve: cost(20, 10, 5), deliveries: 0 }
  };
}
export const commissionDone = (s: GameState, id: CommissionStage) => s.neighborhood.commissions.completed.includes(id);
export function commissionReason(s: GameState, id: CommissionStage): string | null {
  if (!COMMISSION_IDS.includes(id)) return '这组委托尚未开放';
  if (commissionDone(s, id)) return '已经完成这个阶段';
  const [group, number] = id.split('-'), stage = Number(number);
  if (!s.experience.story['L01-1']) return '先读完装配纸条';
  if (group === 'CM01' && s.events.E01?.status !== 'claimed') return '先归档第一盏灯';
  if (group === 'CM02' && !s.completed.includes('P04')) return '先测绘旧巷';
  if (group === 'CM03' && !s.completed.includes('P05')) return '先登记信笺里';
  if (stage > 1 && !commissionDone(s, `${group}-${stage - 1}` as CommissionStage)) return '先回应上一个阶段';
  if (stage === 2 && !s.neighborhood.field.sites[group === 'CM01' ? 'F01' : group === 'CM02' ? 'F03' : 'F04'].clue) return '先调查并领取对应的有限线索';
  if (id === 'CM01-3' && !s.experience.story['L01-3']) return '先读完收音机第三封回信';
  if (id === 'CM02-3' && !s.completed.includes('P06')) return '先编成夜城地址簿';
  if (id === 'CM03-3' && !s.experience.story['L02-4']) return '先读完邮递员最后一封回访';
  return null;
}
// A future stage can be browsed only after its predecessor, even while it waits
// for a field clue. Tracking does not reserve or spend its payment.
export function commissionVisible(s: GameState, id: CommissionStage) {
  if (!COMMISSION_IDS.includes(id) || commissionDone(s, id) || !s.experience.story['L01-1']) return false;
  const [group, stage] = id.split('-');
  return (group === 'CM01' ? s.events.E01?.status === 'claimed' : s.completed.includes(group === 'CM02' ? 'P04' : 'P05')) && (stage === '1' || commissionDone(s, `${group}-${Number(stage) - 1}` as CommissionStage));
}
export function recommendedCommissions(s: GameState) {
  return COMMISSION_IDS.filter(id => commissionVisible(s, id)).sort((a, b) => Number(a.at(-1)) - Number(b.at(-1)) || COMMISSIONS[a].contact.localeCompare(COMMISSIONS[b].contact, 'zh-CN') || (s.neighborhood.commissions.shown[a] ?? 0) - (s.neighborhood.commissions.shown[b] ?? 0) || a.localeCompare(b)).slice(0, 3);
}
export function commissionOutcome(s: GameState, id: CommissionStage): string {
  if (id.startsWith('CM01')) return id === 'CM01-1' ? '快速夹具蓝图已记录，储物柜的借还线索可以复访。' : `${s.neighborhood.field.sites.F01.first === 'a' ? '找回的旧工具' : '调准的旧声音'}固定了灯罩，帽檐把光留在路面。${id.endsWith('3') ? '住客回信与灯罩草图已收藏。' : ''}`;
  if (id.startsWith('CM02')) return id === 'CM02-1' ? '节料台面蓝图和晾衣绳线索已记录，街区协作有了一份证明。' : `${s.neighborhood.field.sites.F03.first === 'b' ? '你特意留下的通行线' : '收好旧架后腾出的通道'}仍通向晾衣绳，老人不用每天重画地图。${id.endsWith('3') ? '地图已收在地址簿封底。' : ''}`;
  return id === 'CM03-1' ? '投递匣蓝图和窗口线索已记录，屋檐成为另一份街区协作证明。' : id === 'CM03-2' ? `你按${s.neighborhood.field.sites.F04.first === 'b' ? '窗后说好的时间' : '核实的投递规则'}送到了信。窗口已投递，待回信。` : '两扇窗各自留下回执。邮递员把这次真正完成的投递记入收藏。';
}
export function blueprintSources(s: GameState, mod: Modification): string[] {
  const sources: string[] = [];
  if (mod === (s.experience.story['L01-2']?.choice === 'restore' ? 'thriftBench' : s.experience.story['L01-2']?.choice === 'dismantle' ? 'quickJig' : null)) sources.push('收音机的选择');
  if (s.completed.includes(`blueprint:${mod}`)) sources.push('首章工具清单');
  for (const id of COMMISSION_IDS) if (commissionDone(s, id) && COMMISSIONS[id].blueprint === mod) sources.push(`${id} ${COMMISSIONS[id].contact}`);
  for (const id of FIELD_IDS) {
    const first = s.neighborhood.field.sites[id].first;
    if (first && FIELD_SITES[id].blueprints[first === 'a' ? 0 : 1] === mod) sources.push(`${id} 首访`);
  }
  if (mod === 'voiceBox' && s.neighborhood.field.sites.F02.clue) sources.push('F02 半层回信');
  if (mod === 'dispatchBox' && s.experience.story['L02-3']) sources.push('L02-3 邮递员');
  return sources;
}
export function fieldOpenReason(s: GameState, id: FieldSite): string | null {
  if (!FIELD_IDS.includes(id)) return '未知调查地点';
  if (!s.completed.includes('P02')) return '先给站牌写上“0”';
  if (id === 'F02' && !activeDistricts(s).some(d => districtState(s, d)!.facilities.dorm > 0)) return '先建设一间宿舍';
  if (id === 'F03' && !s.completed.includes('P04')) return '先测绘旧巷';
  if (id === 'F04' && (!s.completed.includes('P05') || s.events.E07?.status !== 'claimed')) return '先登记信笺里并选择门牌';
  return null;
}
export function fieldClueKnown(s: GameState, id: FieldSite): boolean {
  return id === 'F01' ? commissionDone(s, 'CM01-1') || Boolean(s.experience.story['L01-3'] && s.experience.story['L01-2']?.choice === 'dismantle')
    : id === 'F02' ? Boolean(s.experience.story['L02-1'] || s.experience.story['L01-3'] && s.experience.story['L01-2']?.choice === 'restore')
    : commissionDone(s, id === 'F03' ? 'CM02-1' : 'CM03-1');
}
export const fieldWorkers = (s: GameState, id: DistrictId, resident: Resident) => Number(s.neighborhood.field.active?.district === id && s.neighborhood.field.active.resident === resident);
export const idleResidents = (s: GameState, id: DistrictId, resident: Resident) => { const d = districtState(s, id); return d ? localFree(d, resident) - awayWorkers(s, id, resident) - fieldWorkers(s, id, resident) : 0; };
export function fieldStartReason(s: GameState, order: FieldOrder, kind: FieldKind): string | null {
  const open = fieldOpenReason(s, order.site);
  if (open) return open;
  if (!districtState(s, order.district) || !RESIDENTS.includes(order.resident)) return '请选择已登记街区和居民类型';
  const f = s.neighborhood.field, site = f.sites[order.site];
  if (!['first', 'clue', 'supply'].includes(kind)) return '请选择首访、有限线索或普通复访';
  if (kind === 'first' ? site.first !== null : !site.first) return kind === 'first' ? '已经完成首访' : '先领取并确认首访';
  if (kind === 'clue' && (!fieldClueKnown(s, order.site) || site.clue)) return site.clue ? '有限线索已经领取' : '尚未发现这条有限线索';
  if (f.active) return '全城已有一人正在外勤';
  if (f.pending.length >= NEIGHBORHOOD_RULES.maxPending) return '待领结果已达3包，先收好一包';
  if (f.pending.some(p => p.site === order.site)) return '这个地点还有未领结果';
  if (idleResidents(s, order.district, order.resident) < 1) return '来源街区没有这类空闲居民';
  if (RESOURCES.some(r => s.resources[r] < FIELD_SITES[order.site].payment[r])) return '外勤补给不足';
  return null;
}
function pay(s: GameState, payment: Amounts, flow: 'fulfillment' | 'fieldReserved') {
  for (const r of RESOURCES) { s.resources[r] -= payment[r]; s.ledger[flow][r] += payment[r]; }
}
function receive(s: GameState, reward: Amounts, flow: 'rewards' | 'refunds') {
  for (const r of RESOURCES) { s.resources[r] += reward[r]; s.ledger[flow][r] += reward[r]; if (flow === 'rewards') s.earned[r] += reward[r]; }
}
export function startField(s: GameState, order: FieldOrder, kind: FieldKind, log: (t: string) => void): string | null {
  const reason = fieldStartReason(s, order, kind);
  if (reason) return reason;
  const f = s.neighborhood.field, config = FIELD_SITES[order.site];
  pay(s, config.payment, 'fieldReserved');
  f.active = { ...order, kind, uid: `f-${f.nextTrip++}`, duration: config.seconds, remaining: config.seconds, reserved: { ...config.payment } };
  log(`${DISTRICTS[order.district].name}一位${order.resident === 'echo' ? '回声居民' : '影子居民'}出发调查${config.name}，补给已预留。`);
  return null;
}
export function fieldReward(result: FieldResult, branch?: 'a' | 'b'): { payment: Amounts; reward: Amounts; blueprint: Modification | null } {
  if (result.kind === 'refund') return { payment: amounts(), reward: result.refund, blueprint: null };
  const config = FIELD_SITES[result.site];
  if (result.kind === 'supply') return { payment: amounts(), reward: { ...config.supply }, blueprint: null };
  if (result.kind === 'clue') return { payment: amounts(), reward: { ...config.clue }, blueprint: result.site === 'F02' ? 'voiceBox' : null };
  const index = branch === 'b' ? 1 : 0;
  return { payment: result.site === 'F03' && branch === 'b' ? cost(0, 0, 0, 1) : amounts(), reward: { ...config.rewards[index] }, blueprint: config.blueprints[index] };
}
export function fieldClaimReason(s: GameState, uid: string, capacity: Amounts, branch?: 'a' | 'b') {
  const result = s.neighborhood.field.pending.find(p => p.uid === uid);
  if (!result) return '结果已经领取或尚未返程';
  if (result.kind === 'first' ? branch !== 'a' && branch !== 'b' : branch !== undefined) return '请按这份结果选择有效的处理方式';
  const { payment, reward } = fieldReward(result, branch);
  if (RESOURCES.some(r => s.resources[r] < payment[r])) return '确认这个方向所需的额外材料不足';
  return RESOURCES.some(r => s.resources[r] - payment[r] + reward[r] > capacity[r]) ? '整包所需仓储空间不足，结果保留' : null;
}
export function claimField(s: GameState, uid: string, capacity: Amounts, log: (t: string) => void, branch?: 'a' | 'b'): string | null {
  const reason = fieldClaimReason(s, uid, capacity, branch);
  if (reason) return reason;
  const f = s.neighborhood.field, result = f.pending.find(p => p.uid === uid)!;
  const { payment, reward, blueprint } = fieldReward(result, branch);
  pay(s, payment, 'fulfillment'); receive(s, reward, result.kind === 'refund' ? 'refunds' : 'rewards');
  for (const r of RESOURCES) (result.kind === 'refund' ? f.refunded : f.rewarded)[r] += reward[r];
  if (blueprint && !s.experience.blueprints.includes(blueprint)) s.experience.blueprints.push(blueprint);
  if (result.kind === 'first') f.sites[result.site].first = branch!;
  if (result.kind === 'clue') f.sites[result.site].clue = true;
  if (result.kind === 'supply') f.sites[result.site].supplies += 1;
  f.pending = f.pending.filter(p => p.uid !== uid);
  log(`${FIELD_SITES[result.site].name}：${result.kind === 'first' ? FIELD_SITES[result.site].branches[branch === 'a' ? 0 : 1] : result.kind === 'clue' ? FIELD_SITES[result.site].clueText : result.kind === 'refund' ? '召回补给已完整返还。' : '已收好普通复访物资。'}`);
  return null;
}
export function fieldRefund(s: GameState): Amounts {
  const trip = s.neighborhood.field.active;
  if (!trip) return amounts();
  return Object.fromEntries(RESOURCES.map(r => [r, trip.remaining === trip.duration ? trip.reserved[r] : Math.floor(trip.reserved[r] / UNIT * trip.remaining / trip.duration) * UNIT])) as Amounts;
}
export function recallField(s: GameState, capacity: Amounts, log: (t: string) => void): string | null {
  const f = s.neighborhood.field, trip = f.active;
  if (!trip) return '没有正在外勤的居民';
  const refund = fieldRefund(s);
  for (const r of RESOURCES) f.consumed[r] += trip.reserved[r] - refund[r];
  const fits = RESOURCES.every(r => s.resources[r] + refund[r] <= capacity[r]);
  if (fits) {
    receive(s, refund, 'refunds'); for (const r of RESOURCES) f.refunded[r] += refund[r];
  } else f.pending.push({ uid: trip.uid, site: trip.site, kind: 'refund', refund });
  f.active = null; f.recalls += 1;
  log(`${FIELD_SITES[trip.site].name}外勤已召回，居民回到原住处。${fits ? '未用补给已按剩余时间返还。' : '空间不足，未用补给完整保留为待领包。'}`);
  return null;
}
export function deliveryReason(s: GameState, id: CommissionStage, capacity: Amounts, reserve?: Amounts): string | null {
  const reason = commissionReason(s, id);
  if (reason) return reason;
  if (!s.neighborhood.commissions.tracked.includes(id)) return '先追踪这个阶段';
  const def = COMMISSIONS[id];
  if (RESOURCES.some(r => s.resources[r] < def.payment[r])) return '整份委托材料不足';
  if (reserve && RESOURCES.some(r => s.resources[r] - def.payment[r] < reserve[r])) return '等待自动保留库存';
  if (RESOURCES.some(r => s.resources[r] - def.payment[r] + def.reward[r] > capacity[r])) return '整份奖励所需仓储空间不足';
  return null;
}
export function deliverCommission(s: GameState, id: CommissionStage, capacity: Amounts, log: (t: string) => void, reserve?: Amounts): string | null {
  const reason = deliveryReason(s, id, capacity, reserve);
  if (reason) return reason;
  const def = COMMISSIONS[id], c = s.neighborhood.commissions;
  pay(s, def.payment, 'fulfillment'); receive(s, def.reward, 'rewards');
  if (def.blueprint && !s.experience.blueprints.includes(def.blueprint)) s.experience.blueprints.push(def.blueprint);
  c.completed.push(id); c.tracked = c.tracked.filter(stage => stage !== id);
  s.neighborhood.delegation.stages = s.neighborhood.delegation.stages.filter(stage => stage !== id);
  if (reserve) s.neighborhood.delegation.deliveries += 1;
  log(`${reserve ? '投递匣代办' : '已交付'} ${id}：${commissionOutcome(s, id)}`);
  return null;
}
export function delegationReason(s: GameState, light: boolean, capacity: Amounts): string | null {
  const plan = s.neighborhood.delegation;
  if (!plan.enabled) return '委托代办已暂停';
  if (!plan.stages.length) return '确认清单已交完，下一阶段等你接取';
  if (!districtState(s, plan.district)?.facilities.mailbox || s.neighborhood.mailboxes[plan.district].active !== 'dispatchBox') return '代办等待本区启用投递匣';
  if (!s.completed.includes('R04')) return '代办等待巡检手册研究';
  if (!light) return '代办等待本区有效照明';
  return deliveryReason(s, plan.stages[0], capacity, plan.reserve);
}
export function tickNeighborhood(s: GameState, capacity: Amounts, light: (id: DistrictId) => boolean, log: (t: string) => void) {
  const f = s.neighborhood.field;
  if (f.active) {
    const trip = f.active; trip.remaining -= 1;
    if (trip.remaining === 0) {
      for (const r of RESOURCES) f.consumed[r] += trip.reserved[r];
      f.pending.push({ uid: trip.uid, site: trip.site, kind: trip.kind }); f.active = null; f.returns += 1;
      log(`${FIELD_SITES[trip.site].name}外勤返程，居民已经回家，结果等你处理。`);
    }
  } else if (f.queue.length && !startField(s, f.queue[0], 'supply', log)) f.queue.shift();
  const plan = s.neighborhood.delegation;
  if (plan.enabled && plan.stages.length && !delegationReason(s, light(plan.district), capacity)) deliverCommission(s, plan.stages[0], capacity, log, plan.reserve);
}
export function heldFieldSupplies(s: GameState): Amounts {
  const f = s.neighborhood.field, held = { ...(f.active?.reserved ?? amounts()) };
  for (const p of f.pending) if (p.kind === 'refund') for (const r of RESOURCES) held[r] += p.refund[r];
  return held;
}
