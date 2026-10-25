import { amounts, cost, RESOURCES } from './config';
import type { Amounts, GameState } from './types';
import type { CovenantAction, CovenantId, CovenantReport, CovenantState } from './covenant-types';

export const COVENANT_IDS: CovenantId[] = ['preserve', 'extend', 'coexist'];
export const COVENANT_PROJECTS = ['P17', 'P18', 'P19'] as const;
export const COVENANT_RULES = { adjustment: cost(4, 6, 2), proofSeconds: 60, maxSetting: 1_000_000_000, history: 12 };
export const COVENANTS = {
  preserve: { name: '封存·把灯留住', benefit: '旧城各街区照明电耗减少25%', tradeoff: '旧城施工慢25%；入住每5秒只推进4秒', upkeep: amounts(20, 0, 10) },
  extend: { name: '续建·把路接下去', benefit: '旧城施工产能增加25%', tradeoff: '旧城记录产量减少20%', upkeep: amounts(50, 20) },
  coexist: { name: '并存·给不同日期留座', benefit: '新发车运行电量减少20%（含货架附加费）', tradeoff: '旧城回收产量减少20%', upkeep: amounts(0, 20, 10) }
} as const;
export function createCovenants(): CovenantState {
  return { selected: [], reserve: amounts(), paidSecond: null, changes: 0, paid: { preserve: 0, extend: 0, coexist: 0 }, blocked: 0, combined: 0, upkeep: amounts(), adjustments: amounts(), lightSaved: 0, extraWork: 0, feeSaved: 0, history: [] };
}
export const covenantLimit = (s: GameState) => s.completed.includes('P18') ? 2 : 1;
export const covenantUnlocked = (s: GameState) => s.completed.includes('P17') && !!s.experience.story['L06-2'] && !s.network.legacyPending;
export const covenantActive = (s: GameState, id: CovenantId) => s.covenants.paidSecond === s.clock.seconds && s.covenants.selected.includes(id);
export function covenantCost(selected: readonly CovenantId[]): Amounts {
  const payment = amounts();
  for (const id of selected) for (const r of RESOURCES) payment[r] += COVENANTS[id].upkeep[r];
  return payment;
}
export function covenantReason(s: GameState): string | null {
  const c = s.covenants;
  if (!c.selected.length) return '公约已暂停，尚未确认运行组合';
  if (!covenantUnlocked(s)) return '先建公约桌并手动阅读规则来信';
  const payment = covenantCost(c.selected);
  if (RESOURCES.some(r => s.resources[r] - payment[r] < c.reserve[r])) return '公约等待旧城维护材料或保留库存；补足后下秒自动恢复';
  return null;
}
// Describe the last real tick, even when that tick's generation already made
// next-second payment possible. A fresh confirmation has not tried upkeep yet.
export function covenantStatus(s: GameState): string | null {
  if (!s.covenants.selected.length) return '公约已暂停，尚未确认运行组合';
  if (s.covenants.paidSecond === s.clock.seconds) return null;
  if (s.covenants.history.at(-1)?.second === s.clock.seconds) return '已确认，等待下一逻辑秒整组付款';
  return '本秒维护材料或保留库存不足，整组效果暂停；补足后下秒自动恢复';
}
function history(s: GameState, kind: 'confirm' | 'pause') {
  s.covenants.history.push({ second: s.clock.seconds, kind, selected: [...s.covenants.selected] });
  if (s.covenants.history.length > COVENANT_RULES.history) s.covenants.history.shift();
}
export function covenantAction(s: GameState, action: CovenantAction): string | null {
  const c = s.covenants;
  if (action.type === 'covenant-pause') {
    if (c.selected.length) { c.selected = []; c.paidSecond = null; history(s, 'pause'); }
    return null;
  }
  if (!covenantUnlocked(s)) return '先建公约桌并手动阅读规则来信';
  if (!Array.isArray(action.selected) || !action.selected.length || action.selected.length > covenantLimit(s) || new Set(action.selected).size !== action.selected.length || action.selected.some(id => !COVENANT_IDS.includes(id))) return `请选择1至${covenantLimit(s)}条不同公约`;
  if (!action.reserve || RESOURCES.some(r => !Number.isSafeInteger(action.reserve[r]) || action.reserve[r] < 0 || action.reserve[r] > COVENANT_RULES.maxSetting)) return '保留量需为0至1,000,000，最多3位小数';
  const selected = COVENANT_IDS.filter(id => action.selected.includes(id));
  if (JSON.stringify(selected) === JSON.stringify(c.selected) && RESOURCES.every(r => action.reserve[r] === c.reserve[r])) return '已是这个组合与保留量，无需重复支付';
  if (RESOURCES.some(r => s.resources[r] - COVENANT_RULES.adjustment[r] < action.reserve[r])) return '调整费或调整后的保留库存不足，原组合保留';
  for (const r of RESOURCES) {
    s.resources[r] -= COVENANT_RULES.adjustment[r]; s.ledger.operating[r] += COVENANT_RULES.adjustment[r]; c.adjustments[r] += COVENANT_RULES.adjustment[r];
  }
  c.selected = selected; c.reserve = { ...action.reserve }; c.paidSecond = null; c.changes += 1; history(s, 'confirm');
  return null;
}
// Before this second's power generation; a selected group pays all or nothing.
export function tickCovenants(s: GameState) {
  const c = s.covenants; c.paidSecond = null;
  if (!c.selected.length) return;
  if (covenantReason(s)) { c.blocked += 1; return; }
  const payment = covenantCost(c.selected);
  for (const r of RESOURCES) { s.resources[r] -= payment[r]; s.ledger.operating[r] += payment[r]; c.upkeep[r] += payment[r]; }
  c.paidSecond = s.clock.seconds;
  for (const id of c.selected) c.paid[id] += 1;
  if (c.selected.length === 2) c.combined += 1;
}
export const covenantWorkFactor = (s: GameState) => (covenantActive(s, 'preserve') ? 0.75 : 1) * (covenantActive(s, 'extend') ? 1.25 : 1);
export const covenantProof = (s: GameState, id: CovenantId) => s.covenants.paid[id] >= COVENANT_RULES.proofSeconds && s.covenants[id === 'preserve' ? 'lightSaved' : id === 'extend' ? 'extraWork' : 'feeSaved'] > 0;
export function covenantProjectReason(s: GameState, id: string): string | null {
  if (id === 'P17') return !s.experience.story['L06-1'] ? '先读完共同日期与城市公约的来信' : null;
  if (id === 'P18') return !s.completed.includes('P17') || !s.experience.story['L06-2'] || !COVENANT_IDS.some(c => covenantProof(s, c)) ? '先阅读规则来信，让任一公约付费运行60秒并产生实际收益' : null;
  if (id === 'P19') return !s.completed.includes('P18') || !s.experience.story['L06-3'] || !COVENANT_IDS.every(c => covenantProof(s, c)) || s.covenants.combined < 60 ? '三方向各需60秒付费运行与真实收益，并让双约运行60秒，读完组合来信' : null;
  return null;
}
export function summarizeCovenants(before: GameState, after: GameState): CovenantReport {
  const a = after.covenants, b = before.covenants, upkeep = amounts(), adjustments = amounts();
  for (const r of RESOURCES) { upkeep[r] = a.upkeep[r] - b.upkeep[r]; adjustments[r] = a.adjustments[r] - b.adjustments[r]; }
  return { paid: { preserve: a.paid.preserve - b.paid.preserve, extend: a.paid.extend - b.paid.extend, coexist: a.paid.coexist - b.paid.coexist }, blocked: a.blocked - b.blocked, combined: a.combined - b.combined, changes: a.changes - b.changes, upkeep, adjustments, lightSaved: a.lightSaved - b.lightSaved, extraWork: a.extraWork - b.extraWork, feeSaved: a.feeSaved - b.feeSaved, selected: [...a.selected], reason: covenantStatus(after) };
}
