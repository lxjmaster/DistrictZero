import { RESOURCES } from './config';
import { COVENANT_IDS, COVENANT_RULES, COVENANT_PROJECTS, COVENANTS, covenantLimit, covenantProjectReason, covenantUnlocked, createCovenants } from './covenants';
import type { CovenantId, CovenantReport, CovenantState } from './covenant-types';
import type { Amounts, GameState } from './types';

const bad = (message: string): never => { throw new Error(`存档无效：${message}`); };
function obj(v: unknown): Record<string, unknown> { return v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : bad('公约需要对象'); }
function integer(v: unknown, max = Number.MAX_SAFE_INTEGER): number { return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= max ? v : bad('公约整数超出范围'); }
function readAmounts(v: unknown, max = Number.MAX_SAFE_INTEGER): Amounts { const o = obj(v); return Object.fromEntries(RESOURCES.map(r => [r, integer(o[r], max)])) as Amounts; }
function selection(v: unknown): CovenantId[] {
  if (!Array.isArray(v) || v.length > 2 || new Set(v).size !== v.length || v.some(id => !COVENANT_IDS.includes(id))) bad('公约组合错误');
  const ids = v as CovenantId[];
  if (JSON.stringify(ids) !== JSON.stringify(COVENANT_IDS.filter(id => ids.includes(id)))) bad('公约组合顺序错误');
  return [...ids];
}
function counters(v: unknown): CovenantState['paid'] { const o = obj(v); return { preserve: integer(o.preserve), extend: integer(o.extend), coexist: integer(o.coexist) }; }
function metrics(o: Record<string, unknown>) {
  return { paid: counters(o.paid), blocked: integer(o.blocked), combined: integer(o.combined), changes: integer(o.changes), upkeep: readAmounts(o.upkeep), adjustments: readAmounts(o.adjustments), lightSaved: integer(o.lightSaved), extraWork: integer(o.extraWork), feeSaved: integer(o.feeSaved) };
}
export function readCovenants(v: unknown): CovenantState {
  const o = obj(v);
  if (!Array.isArray(o.history) || o.history.length > COVENANT_RULES.history) bad('公约历史错误');
  return { ...metrics(o), selected: selection(o.selected), reserve: readAmounts(o.reserve, COVENANT_RULES.maxSetting), paidSecond: o.paidSecond === null ? null : integer(o.paidSecond), history: (o.history as unknown[]).map(v => {
    const h = obj(v);
    if (h.kind !== 'confirm' && h.kind !== 'pause') bad('公约历史动作错误');
    return { second: integer(h.second), kind: h.kind as 'confirm' | 'pause', selected: selection(h.selected) };
  }) };
}
export function readCovenantReport(v: unknown): CovenantReport {
  const o = obj(v);
  if (o.reason !== null && (typeof o.reason !== 'string' || o.reason.length > 1000)) bad('公约报告停因错误');
  return { ...metrics(o), selected: selection(o.selected), reason: o.reason as string | null };
}
function assertMetrics(c: ReturnType<typeof metrics>, seconds: number, operating: Amounts) {
  const paidSum = COVENANT_IDS.reduce((n, id) => n + c.paid[id], 0), elapsed = paidSum - c.combined;
  if (elapsed < 0 || elapsed + c.blocked > seconds || COVENANT_IDS.some(id => c.paid[id] > elapsed) || c.combined > elapsed) bad('公约运行时长不守恒');
  for (const r of RESOURCES) {
    const expected = COVENANT_IDS.reduce((n, id) => n + c.paid[id] * COVENANTS[id].upkeep[r], 0);
    if (!Number.isSafeInteger(expected) || c.upkeep[r] !== expected || c.adjustments[r] !== c.changes * COVENANT_RULES.adjustment[r] || c.upkeep[r] + c.adjustments[r] > operating[r]) bad('公约支出与运行账本不守恒');
  }
  if (!c.paid.preserve && c.lightSaved || !c.paid.extend && c.extraWork || !c.paid.coexist && c.feeSaved) bad('公约收益缺少实际付费');
}
export function assertCovenants(s: GameState) {
  const c = readCovenants(s.covenants), story = s.experience.story;
  const initial = createCovenants();
  const isEmpty = (Object.keys(initial) as (keyof CovenantState)[]).every(key => JSON.stringify(c[key]) === JSON.stringify(initial[key]));
  const nodes = ['L06-1', 'L06-2', 'L06-3', 'L06-4'] as const;
  for (let i = 1; i < nodes.length; i++) if (story[nodes[i]] && !story[nodes[i - 1]]) bad('公约来信顺序错误');
  if (story['L06-1'] && !story['L05-4'] || story['L06-2'] && !s.completed.includes('P17') || story['L06-3'] && !s.completed.includes('P18') || story['L06-4'] && !s.completed.includes('P19')) bad('公约来信缺少实际成果');
  for (const id of COVENANT_PROJECTS) if ((s.completed.includes(id) || s.queue.some(p => p.definition === id)) && covenantProjectReason(s, id)) bad('公约工程缺少实际证明');
  for (const p of s.queue) if (COVENANT_PROJECTS.some(id => id === p.definition) && (p.outpost || p.district !== 'district-0' || p.legacyChapter)) bad('公约工程归属错误');
  if (c.selected.length > covenantLimit(s)) bad('公约组合超出开放上限');
  if (!covenantUnlocked(s)) {
    if (!isEmpty) bad('公约尚未开放不能保存安排或成果');
  } else {
    assertMetrics(c, s.clock.seconds, s.ledger.operating);
    if (!c.changes && !isEmpty) bad('公约缺少确认来源');
    if (c.paidSecond !== null && (c.paidSecond !== s.clock.seconds || !c.selected.length || c.selected.some(id => !c.paid[id]))) bad('公约生效时点错误');
    if (c.combined && !s.completed.includes('P18')) bad('双约尚未开放');
    if (c.lightSaved > c.paid.preserve * 1000 || c.extraWork > s.ledger.reserved.energy * 1000 || c.feeSaved > (s.network.nextTrip - 1) * 1600) bad('公约收益超出实际活动');
  }
  let lastSecond = -1;
  for (const h of c.history) {
    if (h.second < lastSecond || h.second > s.clock.seconds || h.kind === 'pause' && h.selected.length || h.kind === 'confirm' && !h.selected.length || h.selected.length > covenantLimit(s)) bad('公约历史来源错误');
    lastSecond = h.second;
  }
  if (c.changes && !c.history.length || c.history.filter(h => h.kind === 'confirm').length > c.changes || c.history.length && JSON.stringify(c.history.at(-1)!.selected) !== JSON.stringify(c.selected)) bad('公约历史与当前安排不一致');
  const report = s.report?.covenants;
  if (report) {
    readCovenantReport(report); assertMetrics(report, s.report!.seconds, s.report!.flows.operating);
    for (const key of ['blocked', 'combined', 'changes', 'lightSaved', 'extraWork', 'feeSaved'] as const) if (report[key] > c[key]) bad('公约报告超出累计成果');
    for (const id of COVENANT_IDS) if (report.paid[id] > c.paid[id]) bad('公约报告超出累计付费');
    for (const r of RESOURCES) if (report.upkeep[r] > c.upkeep[r] || report.adjustments[r] > c.adjustments[r]) bad('公约报告超出累计支出');
  }
  for (const key of s.report?.completed ?? []) if (COVENANT_PROJECTS.some(id => id === key) && !s.completed.includes(key)) bad('公约报告缺少完工');
}
