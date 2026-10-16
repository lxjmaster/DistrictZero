import { useEffect, useState } from 'react';
import { amounts, RESIDENTS, RESOURCES, residentNames, resourceNames, UNIT } from '../game/config';
import { activeDistricts, DISTRICTS, districtState } from '../game/city';
import { stockLimits, chapterProofs, duration, servicePreview } from '../game/engine';
import { ASSEMBLY, LETTER_STORY_IDS, STORY_NAMES, storyText } from '../game/experience';
import { blueprintSources, COMMISSION_IDS, COMMISSIONS, commissionDone, commissionOutcome, commissionReason, commissionVisible, delegationReason, deliveryReason, FIELD_IDS, FIELD_SITES, fieldClaimReason, fieldClueKnown, fieldOpenReason, fieldRefund, fieldReward, fieldStartReason, idleResidents, MAIL_MOD_IDS, MAIL_MODS, recommendedCommissions } from '../game/neighborhood';
import type { Action, CommissionStage, DistrictId, FieldOrder, FieldSite, GameState, Resident } from '../game/types';
import { VEHICLE_MODS } from '../game/journey';
import { MaterialCost, parseUnits, ProjectPayment } from './Experience';

type Props = { state: GameState; send: (a: Action) => void; disabled: boolean };
export function CommissionBoard({ state, send, disabled }: Props) {
  const [all, setAll] = useState(false), c = state.neighborhood.commissions;
  const recommended = recommendedCommissions(state), available = COMMISSION_IDS.filter(id => commissionVisible(state, id));
  const ids = [...new Set([...c.tracked, ...(all ? available : recommended)])];
  const unshown = ids.filter(id => !c.shown[id]).join(',');
  useEffect(() => { if (unshown && !disabled) send({ type: 'commission-show', stages: unshown.split(',').slice(0, 3) as CommissionStage[] }); }, [unshown, disabled]); // Explicit visible cards only; no random rerolls.
  return <section className="panel" id="commissions" tabIndex={-1} aria-label="委托板"><div className="panel-title"><h2>有人把需要留在了板上</h2><span className="caption">追踪 {c.tracked.length} / 3</span></div>
    <p className="small muted">接取只追踪，交付才使用材料。每组下一阶段由你确认，不会自动续接。</p>
    <div className="button-row"><button aria-pressed={all} onClick={() => setAll(!all)}>{all ? '收起全部委托' : '查看全部已开放委托'}</button><button disabled={disabled || !recommended.length} onClick={() => send({ type: 'commission-show', stages: recommended })}>换一组推荐</button></div>
    {!ids.length && <p className="muted">先读完装配纸条。新的街区与已完成的调查会带来后续需要。</p>}
    <div className="neighborhood-cards">{ids.map(id => {
      const def = COMMISSIONS[id], tracked = c.tracked.includes(id), why = commissionReason(state, id), deliver = deliveryReason(state, id, stockLimits(state));
      return <article className="matter-card" key={id} data-testid={`commission-${id}`}><span className="eyebrow">{id} · {def.contact}</span><h3>{def.name}</h3><p>{def.text}</p>
        <p className="small">交付：{RESOURCES.some(r => def.payment[r]) ? <MaterialCost value={def.payment} /> : '回应这次来信，无材料费用'}。</p>
        <p className="small">成果：{def.blueprint && `${modName(def.blueprint)}蓝图；`}{RESOURCES.some(r => def.reward[r]) ? <MaterialCost value={def.reward} /> : id.endsWith('-1') ? '调查线索与生活记录' : '收藏与回信'}。</p>
        <p className="condition">{why ?? (tracked ? deliver ?? '这份需要已备齐，可以交付。' : '可接取；不预留材料。')}</p>
        <div className="button-row">{tracked ? <><button disabled={disabled || !!deliver} onClick={() => send({ type: 'commission-deliver', stage: id })}>交付这一阶段</button><button className="quiet" disabled={disabled} onClick={() => send({ type: 'commission-untrack', stage: id })}>取消追踪</button></> : <button disabled={disabled || c.tracked.length >= 3} onClick={() => send({ type: 'commission-track', stage: id })}>追踪这一阶段</button>}</div>
      </article>;
    })}</div>
    <p className="footnote">六位联系人共十八个阶段，随街区与真实到货逐步开放。已经交付的回应和收藏可以在档案回看。</p>
  </section>;
}
function PersonChoice({ state, district, resident, change, disabled, prefix }: { state: GameState; district: DistrictId; resident: Resident; change: (d: DistrictId, r: Resident) => void; disabled: boolean; prefix: string }) {
  return <div className="field-person"><label>来源住处<select aria-label={`${prefix}来源街区`} value={district} disabled={disabled} onChange={e => change(e.target.value as DistrictId, resident)}>{activeDistricts(state).map(id => <option key={id} value={id}>{DISTRICTS[id].name}</option>)}</select></label><label>空闲居民<select aria-label={`${prefix}居民类型`} value={resident} disabled={disabled} onChange={e => change(district, e.target.value as Resident)}>{RESIDENTS.map(r => <option key={r} value={r}>{residentNames[r]} · 空闲 {idleResidents(state, district, r)}</option>)}</select></label></div>;
}
export function FieldPanel({ state, send, disabled }: Props) {
  const [district, setDistrict] = useState<DistrictId>('district-0'), [resident, setResident] = useState<Resident>('shadow'), [queue, setQueue] = useState<FieldOrder[]>([]);
  const f = state.neighborhood.field, capacity = stockLimits(state), known = FIELD_IDS.filter(id => f.sites[id].first);
  const [repeatSite, setRepeatSite] = useState<FieldSite>('F01');
  const effectiveSite = known.includes(repeatSite) ? repeatSite : known[0];
  const choose = (d: DistrictId, r: Resident) => { setDistrict(d); setResident(r); };
  return <section className="panel" id="field" tabIndex={-1} aria-label="外勤调查"><div className="panel-title"><h2>沿着别人留下的路</h2><span className="caption">全城同时1人 · 待领 {f.pending.length} / 3</span></div>
    <p className="small muted">居民保留住处；返程便回家，结果等你选。补给出发时预留，同地点有未领包时不重派。</p>
    <PersonChoice state={state} district={district} resident={resident} change={choose} disabled={disabled} prefix="外勤" />
    {f.active && <article className="matter-card" data-testid="active-field"><h3>{FIELD_SITES[f.active.site].name} · 途中</h3><p>{DISTRICTS[f.active.district].name}的{residentNames[f.active.resident]}，还需 {duration(f.active.remaining)}。</p><progress max={f.active.duration} value={f.active.duration - f.active.remaining} /><p className="small">现在召回可退 <MaterialCost value={fieldRefund(state)} />；放不下的整包留在这里，不丢弃。</p><button disabled={disabled} onClick={() => send({ type: 'field-recall' })}>召回外勤居民</button></article>}
    {f.pending.map(p => <article className="matter-card field-result" key={p.uid} data-testid={`field-result-${p.site}`}><span className="eyebrow">{p.uid} / 结果待处理</span><h3>{FIELD_SITES[p.site].name} · {p.kind === 'first' ? '首访' : p.kind === 'clue' ? '有限线索' : p.kind === 'refund' ? '待退补给' : '普通复访'}</h3>
      {(p.kind === 'first' ? ['a', 'b'] as const : [undefined]).map(branch => { const outcome = fieldReward(p, branch), why = fieldClaimReason(state, p.uid, capacity, branch); return <div key={branch ?? 'claim'} className="field-outcome"><p>{branch ? FIELD_SITES[p.site].branches[branch === 'a' ? 0 : 1] : p.kind === 'clue' ? FIELD_SITES[p.site].clueText : p.kind === 'refund' ? '未用补给完整保留，返还不增加累计取得。' : '这是出发前已知的物资结果。'}</p><p className="small">{RESOURCES.some(r => outcome.payment[r]) && <>另付 <MaterialCost value={outcome.payment} />；</>} {outcome.blueprint ? `${modName(outcome.blueprint)}蓝图；` : ''}<MaterialCost value={outcome.reward} /></p><button disabled={disabled || !!why} onClick={() => send({ type: 'field-claim', uid: p.uid, ...(branch ? { choice: branch } : {}) })}>{branch ? `确认${FIELD_SITES[p.site].branches[branch === 'a' ? 0 : 1]}` : p.kind === 'refund' ? '领回未用补给' : '领取调查结果'}</button>{why && <p className="condition">{why}</p>}</div>; })}
    </article>)}
    <div className="neighborhood-cards">{FIELD_IDS.filter(id => !fieldOpenReason(state, id)).map(id => { const site = FIELD_SITES[id], record = f.sites[id]; const kinds = !record.first ? ['first'] as const : fieldClueKnown(state, id) && !record.clue ? ['clue', 'supply'] as const : ['supply'] as const; return <article className="matter-card" key={id} data-testid={`field-${id}`}><span className="eyebrow">{id}</span><h3>{site.name}</h3><p>{site.text}</p><p className="small">补给 <MaterialCost value={site.payment} /> · {duration(site.seconds)} · 1名空闲居民</p>
      {record.first && <p className="small">已选：{site.branches[record.first === 'a' ? 0 : 1]}。普通复访奖励 <MaterialCost value={site.supply} />。</p>}
      {kinds.map(kind => { const why = fieldStartReason(state, { site: id, district, resident }, kind); return <div key={kind}><button disabled={disabled || !!why} onClick={() => send({ type: 'field-start', site: id, kind, district, resident })}>{kind === 'first' ? '派人首访' : kind === 'clue' ? '调查有限线索' : '普通物资复访'}</button>{why && <p className="condition">{why}</p>}</div>; })}
      {record.clue && <p className="small">有限线索已归档，不会重复发奖。</p>}
    </article>; })}</div>
    {!state.completed.includes('P02') && <p className="condition">给站牌写上“0”后，可以派人寻找这些地点。</p>}
    {known.length > 0 && <details className="repeat-planner"><summary>预排已知普通复访（最多3次）</summary><p className="small">逐条确认地点与上方选择的人手。自动出发不代选首访，也不领取结果；同地点连排会等你收好上次结果。</p><label>普通复访地点<select aria-label="预排复访地点" value={effectiveSite} onChange={e => setRepeatSite(e.target.value as FieldSite)}>{known.map(id => <option value={id} key={id}>{FIELD_SITES[id].name}</option>)}</select></label><button disabled={disabled || queue.length >= 3} onClick={() => setQueue([...queue, { site: effectiveSite, district, resident }])}>加入复访草稿</button><ol>{queue.map((o, i) => <li key={i}>{FIELD_SITES[o.site].name} · {DISTRICTS[o.district].name} · {residentNames[o.resident]}</li>)}</ol><div className="button-row"><button disabled={disabled || !queue.length} onClick={() => { send({ type: 'field-queue', orders: queue }); setQueue([]); }}>保存并预排复访</button><button disabled={disabled || !queue.length} onClick={() => setQueue([])}>清空复访草稿</button></div></details>}
    {f.queue.length > 0 && <div className="matter-card"><h3>已保存的普通复访</h3><ol>{f.queue.map((o, i) => <li key={i}>{FIELD_SITES[o.site].name} · {DISTRICTS[o.district].name} · {residentNames[o.resident]}</li>)}</ol>{!f.active && <p className="condition">{fieldStartReason(state, f.queue[0], 'supply') ?? '下一秒按队首出发'}</p>}<button disabled={disabled} onClick={() => send({ type: 'field-queue', orders: [] })}>取消已保存的复访预排</button></div>}
  </section>;
}
export function DelegationPanel({ state, send, disabled }: Props) {
  const plan = state.neighborhood.delegation;
  // Opening the panel loads the saved plan; live execution must preserve draft edits.
  const [district, setDistrict] = useState<DistrictId>(plan.district), [selected, setSelected] = useState<CommissionStage[]>(plan.stages), [reserves, setReserves] = useState(Object.fromEntries(RESOURCES.map(r => [r, String(plan.reserve[r] / UNIT)])));
  useEffect(() => { setSelected(current => current.filter(stage => state.neighborhood.commissions.tracked.includes(stage))); }, [state.neighborhood.commissions.tracked.join(',')]);
  const parsed = RESOURCES.map(r => parseUnits(reserves[r])), valid = parsed.every(v => v !== null);
  const ready = districtState(state, district)?.facilities.mailbox && state.neighborhood.mailboxes[district].active === 'dispatchBox' && state.completed.includes('R04');
  return <section className="panel" id="delegation" tabIndex={-1} aria-label="委托代办"><div className="panel-title"><h2>把确定的交付交给投递匣</h2><span className="caption">累计代办 {plan.deliveries} 项</span></div><p className="small">每秒只交清单第一项，不接下一阶段。新的选择等你回来。手动交付不受下方自动保留量限制。</p>
    <label>启用街区<select aria-label="代办街区" disabled={disabled} value={district} onChange={e => setDistrict(e.target.value as DistrictId)}>{activeDistricts(state).map(id => <option key={id} value={id}>{DISTRICTS[id].name}</option>)}</select></label>
    <fieldset disabled={disabled}><legend>明确交付清单 · 按勾选顺序</legend>{state.neighborhood.commissions.tracked.map(id => <label className="check-row" key={id}><input type="checkbox" checked={selected.includes(id)} aria-label={`代办${id}`} onChange={e => setSelected(e.target.checked ? [...selected.filter(stage => stage !== id), id] : selected.filter(stage => stage !== id))} />{id} {COMMISSIONS[id].name}</label>)}{!state.neighborhood.commissions.tracked.length && <p className="small muted">先在委托板追踪需要交付的阶段。</p>}</fieldset>
    {selected.length > 0 && <ol className="small">{selected.map(id => <li key={id}>{id} {COMMISSIONS[id].name}</li>)}</ol>}
    <div className="assembly-fields">{RESOURCES.map(r => <label key={r}>自动{resourceNames[r]}保留<input aria-label={`代办${resourceNames[r]}保留`} value={reserves[r]} inputMode="decimal" disabled={disabled} onChange={e => setReserves({ ...reserves, [r]: e.target.value })} /></label>)}</div>
    {!valid && <p className="short small">请输入0至1,000,000，最多3位小数。草稿无效仍可暂停已保存的代办。</p>}
    {!ready && <p className="condition">所选街区需要启用投递匣，并完成巡检手册研究。</p>}
    <div className="button-row"><button disabled={disabled || !ready || !valid || !selected.length || selected.length > 3 || selected.some(id => !state.neighborhood.commissions.tracked.includes(id))} onClick={() => send({ type: 'delegate-plan', district, stages: selected, reserve: amounts(parsed[0]!, parsed[1]!, parsed[2]!, parsed[3]!, parsed[4]!, parsed[5]!) })}>保存清单并启用代办</button><button disabled={disabled || !plan.enabled} onClick={() => send({ type: 'delegate-pause' })}>暂停已保存的代办</button></div>
    <p className="condition" role="status">{delegationReason(state, servicePreview(state)[plan.district]?.light ?? false, stockLimits(state)) ?? '下一逻辑秒尝试已保存的队首'}。</p><p className="small">已保存：{plan.stages.length ? plan.stages.join(' → ') : '无待交付项目'}。免费切换信箱方案会暂停代办，已完成成果保留。</p>
  </section>;
}
export function MailboxPanel({ state, district, send, disabled }: Props & { district: DistrictId }) {
  if (!districtState(state, district)?.facilities.mailbox) return null;
  const box = state.neighborhood.mailboxes[district];
  return <section className="panel" id="mailbox-mods" aria-label="信箱改装"><div className="panel-title"><h2>给信箱一种新用途</h2><span className="caption">{DISTRICTS[district].name} · 一个启用位</span></div><button disabled={disabled || box.active === null} aria-pressed={box.active === null} onClick={() => send({ type: 'mailbox-mod', district, mod: null })}>使用普通信箱</button><div className="mod-options">{MAIL_MOD_IDS.map(mod => <article className="mod-card" key={mod}><h3>{MAIL_MODS[mod].name}</h3><p>{MAIL_MODS[mod].text}</p>{box.built.includes(mod) ? <button disabled={disabled || box.active === mod} aria-pressed={box.active === mod} onClick={() => send({ type: 'mailbox-mod', district, mod })}>{box.active === mod ? `${MAIL_MODS[mod].name}已启用` : `启用${MAIL_MODS[mod].name}`}</button> : state.experience.blueprints.includes(mod) ? <ProjectPayment state={state} send={send} disabled={disabled} id={`mailmod:${mod}`} district={district} ariaLabel={`制作${MAIL_MODS[mod].name}`} buttonText="安排制作" /> : <p className="condition">{mod === 'voiceBox' ? 'F04窗后倾听，或F02半层有限回信留下图样。' : '窗口首访、CM03屋檐委托或邮递员回访留下图样。'}</p>}</article>)}</div><p className="footnote">制作后不自动启用；免费切换，下一秒生效。停用投递匣会暂停代办。</p></section>;
}
export function ChapterProofPanel({ state }: { state: GameState }) {
  if (!state.address || state.completed.includes('P07')) return null;
  const proof = chapterProofs(state);
  return <section className="panel" aria-label="第二章达成证明"><h2>接通雨城的两种证明</h2><p className="small">P06需两个新区各2居民、全城至少一种公共设施与门牌选择。P07需三街区照明有效：{proof.lighting ? '已满足' : '待供电或登记'}，再满足下列任一项。</p><div className="proof-options"><article data-testid="proof-production"><h3>生产保障 · {proof.production ? '已满足' : '待安排'}</h3><p className="small">任一专业街区有对应在岗人员和供料。回收：2影子、2级回收棚、暗灯；记录：2回声、2级信箱、明灯。满仓也能证明。</p>{proof.details.map(d => <p className="small" key={d.district}>{DISTRICTS[d.district].name}：{d.specialization ? d.specialization === 'salvage' ? '回收专业' : '记录专业' : '尚未形成专业组合'} · {d.staffed ? '有在岗人手' : '待安排对应岗位'} · {d.fed ? '供料可用或库存已满' : '待供料'}</p>)}</article><article data-testid="proof-cooperation"><h3>街区协作 · {proof.cooperation ? '已满足' : '待回应'}</h3><p className="small">CM02-1：{commissionDone(state, 'CM02-1') ? '已交付' : '待交付'}；CM03-1：{commissionDone(state, 'CM03-1') ? '已交付' : '待交付'}。合计4构件、4零件、8电量、4记忆，构件还需提前备料。后续回访阶段可自行安排。</p></article></div><p className="footnote">两项可以同时完成；它们是本章的两种证明，各有材料与人手投入。</p></section>;
}
function modName(mod: string) { return mod === 'quickJig' || mod === 'thriftBench' ? ASSEMBLY.recipes[mod].name : mod === 'freightRack' || mod === 'railGuard' ? VEHICLE_MODS[mod].name : MAIL_MODS[mod as 'voiceBox' | 'dispatchBox'].name; }
export function NeighborhoodArchive({ state }: { state: GameState }) {
  const c = state.neighborhood.commissions, f = state.neighborhood.field;
  if (!state.completed.includes('P02') && !c.completed.length) return null;
  return <section className="panel" aria-label="街巷档案"><h2>来往的人与留下的东西</h2>{LETTER_STORY_IDS.filter(id => state.experience.story[id]).map(id => <details className="archive-event" key={id}><summary>{id} {STORY_NAMES[id]} · 邮递员</summary><p>{storyText(state, id)}</p></details>)}{c.completed.map(id => <details className="archive-event" key={id}><summary>{id} {COMMISSIONS[id].name} · {COMMISSIONS[id].contact}</summary><p>{commissionOutcome(state, id)}</p><p className="small">实际交付 <MaterialCost value={COMMISSIONS[id].payment} />{!RESOURCES.some(r => COMMISSIONS[id].payment[r]) && '回应与回信，无材料费用'}。</p></details>)}
    {FIELD_IDS.filter(id => f.sites[id].first).map(id => <details className="archive-event" key={id}><summary>{FIELD_SITES[id].name} · {FIELD_SITES[id].branches[f.sites[id].first === 'a' ? 0 : 1]}</summary><p>{FIELD_SITES[id].text}</p><p>{f.sites[id].clue ? FIELD_SITES[id].clueText : '有限线索仍待核实。'}普通物资复访已领取 {f.sites[id].supplies} 次。</p></details>)}
    {state.experience.blueprints.map(mod => <p className="small" key={mod}>{modName(mod)}蓝图 · 来源：{blueprintSources(state, mod).join('、')}</p>)}
  </section>;
}
export function MattersPage(props: Props) { return <div className="stack"><CommissionBoard {...props} /><FieldPanel {...props} /><DelegationPanel {...props} /></div>; }
