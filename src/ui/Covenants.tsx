import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { amounts, RESOURCES, resourceNames, UNIT } from '../game/config';
import { COVENANTS, COVENANT_IDS, COVENANT_PROJECTS, COVENANT_RULES, covenantActive, covenantCost, covenantLimit, covenantProof, covenantStatus, covenantUnlocked } from '../game/covenants';
import { COVENANT_STORY_IDS, STORY_NAMES, storyText } from '../game/experience';
import { format } from '../game/engine';
import type { Action, CovenantId, DefinitionId, GameState, ReturnReport } from '../game/types';
import { MaterialCost, parseUnits } from './Experience';

type Props = { state: GameState; send: (action: Action) => void; disabled: boolean };
function Confirmation({ children, close }: { children: ReactNode; close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} aria-label="确认城市公约" onCancel={close}><h2>确认城市公约</h2>{children}<button className="quiet" onClick={close}>返回修改</button></dialog>;
}
export function CovenantsPage({ state, send, disabled, project }: Props & { project: (id: DefinitionId) => ReactNode }) {
  const c = state.covenants;
  const [selected, setSelected] = useState<CovenantId[]>([...c.selected]);
  const [reserve, setReserve] = useState(() => RESOURCES.map(r => String(c.reserve[r] / UNIT)));
  const [confirm, setConfirm] = useState(false);
  const selectionKey = c.selected.join(','), reserveKey = RESOURCES.map(r => c.reserve[r]).join(',');
  useEffect(() => { setSelected([...c.selected]); setReserve(RESOURCES.map(r => String(c.reserve[r] / UNIT))); setConfirm(false); }, [selectionKey, reserveKey, c.changes]); // Tick updates do not replace an unsaved draft.
  const parsed = reserve.map(parseUnits), valid = parsed.every(v => v !== null) && selected.length > 0 && selected.length <= covenantLimit(state);
  const payment = covenantCost(selected), nextReserve = amounts();
  RESOURCES.forEach((r, i) => { nextReserve[r] = parsed[i] ?? 0; });
  const changed = COVENANT_IDS.some(id => selected.includes(id) !== c.selected.includes(id)) || RESOURCES.some(r => nextReserve[r] !== c.reserve[r]);
  const affordable = RESOURCES.every(r => state.resources[r] - COVENANT_RULES.adjustment[r] >= nextReserve[r]);
  const open = covenantUnlocked(state);
  return <div className="stack covenant-page" data-testid="covenant-panel">
    <section className="panel"><span className="eyebrow">第六章 / 城市公约</span><h2>共同承认，可以重新商量</h2><p className="small muted">每条公约都有收益和代价，只作用于三个旧城街区与此后新发车。外城与历法配方、分所生产和既有承诺保持原规则。</p><p>已开放 {covenantLimit(state)} 条同时生效位置。{!open && '先完成公约桌并到待处理读完规则来信。'}</p></section>
    {open && <section className="panel" aria-label="城市公约安排"><h2>选择要照看的规则</h2>
      <p data-testid="covenant-status" role="status">{c.selected.length ? `${c.selected.map(id => COVENANTS[id].name).join('＋')}：${c.selected.every(id => covenantActive(state, id)) ? '本秒已付费生效' : covenantStatus(state)}` : '公约已暂停，未选择运行组合'}</p>
      <p className="small">已保存整组维护费 / 秒：<MaterialCost value={covenantCost(c.selected)} />。欠费累计 {c.blocked} 秒；双约累计 {c.combined} 秒。</p>
      <div className="stack">{COVENANT_IDS.map(id => <article className="mod-card" key={id} data-testid={`covenant-${id}`}>
        <label className="check-row"><input type="checkbox" checked={selected.includes(id)} disabled={disabled} onChange={e => setSelected(COVENANT_IDS.filter(item => item === id ? e.target.checked : selected.includes(item)))} /> {COVENANTS[id].name}</label>
        <p>{COVENANTS[id].benefit}；{COVENANTS[id].tradeoff}。</p><p className="small">维护 / 秒：<MaterialCost value={COVENANTS[id].upkeep} /></p>
        <p className="small">实际付费 {c.paid[id]} 秒；{id === 'preserve' ? `实际照明省电 ${format(c.lightSaved)}` : id === 'extend' ? `实际加速工程 ${format(c.extraWork)}` : `实际发车省电 ${format(c.feeSaved)}`} · {covenantProof(state, id) ? '方向证明已取得' : '证明需付费60秒并产生实际收益'}</p>
      </article>)}</div>
      <h3>草稿 · 六资源保留线</h3><div className="assembly-fields">{RESOURCES.map((r, i) => <label key={r}>{resourceNames[r]}保留<input aria-label={`公约${resourceNames[r]}保留`} inputMode="decimal" value={reserve[i]} disabled={disabled} onChange={e => setReserve(values => values.map((v, index) => index === i ? e.target.value : v))} /></label>)}</div>
      <p className="small">每项0至1,000,000，最多三位小数。只约束公约调整与维护；不会替其他系统保留库存。</p>
      <p data-testid="covenant-draft">草稿每秒维护：<MaterialCost value={payment} />；施工倍率 {((selected.includes('preserve') ? 0.75 : 1) * (selected.includes('extend') ? 1.25 : 1) * 100).toFixed(2)}%。</p>
      <p>本次调整费：<MaterialCost value={COVENANT_RULES.adjustment} />。下秒起整组付款后生效。</p>
      {!valid && <p className="condition">请选择1至{covenantLimit(state)}条公约并填写有效保留量。草稿不会改变当前安排。</p>}
      {valid && !affordable && <p className="condition">调整费或调整后的保留库存不足；可降低保留量或等待旧城生产。</p>}
      <div className="button-row"><button disabled={disabled || !valid || !changed || !affordable} onClick={() => setConfirm(true)}>预览并确认公约</button><button disabled={disabled || !c.selected.length} onClick={() => send({ type: 'covenant-pause' })}>免费暂停全部公约</button></div>
      <p className="footnote">先支付维护，再进行本秒发电和生产；不足时整组效果暂停，材料足够后自动恢复，不累计债务。暂停不退已付费用；重新启用仍付调整费。手动发车也只享受本秒已付效果。</p>
      {confirm && <Confirmation close={() => setConfirm(false)}><p>{selected.map(id => COVENANTS[id].name).join('＋')}</p>{selected.map(id => <p key={id}>{COVENANTS[id].benefit}；{COVENANTS[id].tradeoff}。</p>)}<p>旧城三个街区与新发车；在途货物、已备料排程及分所不改写。</p><p>本次：<MaterialCost value={COVENANT_RULES.adjustment} />；之后每秒：<MaterialCost value={payment} />。</p><p>确认后下一逻辑秒整组付款才生效；全部保留线：{RESOURCES.map(r => `${resourceNames[r]} ${format(nextReserve[r])}`).join('、')}。</p><button disabled={disabled || !valid || !changed || !affordable} onClick={() => { send({ type: 'covenant-confirm', selected, reserve: nextReserve }); setConfirm(false); }}>支付调整费并确认</button></Confirmation>}
    </section>}
    <section className="stack" aria-label="公约工程"><h2>把约定写进城市</h2>{COVENANT_PROJECTS.filter(id => !state.completed.includes(id)).map(id => <div key={id}>{project(id)}</div>)}</section>
    <section className="panel" aria-label="城市公约历史"><h2>留下的签名</h2><p>累计维护：<MaterialCost value={c.upkeep} />；累计调整：<MaterialCost value={c.adjustments} />。费用已包含在运行支出中。</p><ol>{[...c.history].reverse().map((h, i) => <li key={i}>第{h.second}秒 · {h.kind === 'pause' ? '免费暂停' : h.selected.map(id => COVENANTS[id].name).join('＋')}</li>)}</ol><p className="small">最近12次签名；累计成果不会丢失。</p>{COVENANT_STORY_IDS.filter(id => state.experience.story[id]).map(id => <details key={id}><summary>{id} · {STORY_NAMES[id]}</summary><p>{storyText(state, id)}</p></details>)}</section>
  </div>;
}
export function CovenantReturnReport({ report }: { report: ReturnReport }) {
  const c = report.covenants; if (!c) return null;
  return <section aria-label="公约返回报告" data-testid="covenant-report"><h3>公约 · 实际付费与成果</h3><p>付费秒：封存 {c.paid.preserve}、续建 {c.paid.extend}、并存 {c.paid.coexist}；双约 {c.combined} 秒；缺料暂停 {c.blocked} 秒。</p><p>维护：<MaterialCost value={c.upkeep} />；调整 {c.changes} 次：<MaterialCost value={c.adjustments} />。均已包含在运行支出，勿重复加总。</p><p>照明实际省电 {format(c.lightSaved)}；续建实际加速 {format(c.extraWork)} 工程点；发车实际省电 {format(c.feeSaved)}。</p><p>当前确认：{c.selected.length ? c.selected.map(id => COVENANTS[id].name).join('＋') : '未选择运行组合'}。</p><p>{c.reason ?? '按已保存公约继续运行'}。</p></section>;
}
