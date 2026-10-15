import { useEffect, useState } from 'react';
import { amounts, RESOURCES, resourceNames, UNIT } from '../game/config';
import { districtState, DISTRICTS, localCount } from '../game/city';
import { definitionFor, duration, enqueueReason, format, missingCost, view, workers } from '../game/engine';
import { ASSEMBLY, assemblyRecipe, assemblyUnlocked, MOD_IDS, pendingStories, prefabLimit, radioChoice, STORY_IDS, STORY_NAMES, storyText } from '../game/experience';
import type { Action, Amounts, DefinitionId, DistrictId, Facility, GameState, RadioChoice } from '../game/types';

type Send = (action: Action) => void;
type Props = { state: GameState; send: Send; disabled: boolean };
export function MaterialCost({ value }: { value: Amounts }) {
  return <span className="costs">{RESOURCES.filter(r => value[r] > 0).map(r => <span key={r}>{format(value[r])} {resourceNames[r]}</span>)}</span>;
}
type PaymentProps = Props & { id: DefinitionId; district?: DistrictId; ariaLabel: string; buttonText: string };
export function ProjectPayment(props: PaymentProps) {
  const district = props.district ?? 'district-0';
  const level = props.id.startsWith('build:') ? districtState(props.state, district)!.facilities[props.id.slice(6) as Facility] + 1 : 1;
  return <ProjectPaymentForm key={`${district}/${props.id}/${level}`} {...props} />;
}
function ProjectPaymentForm({ state, send, disabled, id, district = 'district-0', ariaLabel, buttonText }: PaymentProps) {
  const [selected, setSelected] = useState(0);
  const base = definitionFor(state, id, undefined, district), limit = prefabLimit(base), reason = enqueueReason(state, id, district);
  const count = assemblyUnlocked(state) && selected <= limit ? selected : 0;
  const quote = definitionFor(state, id, undefined, district, count), missing = missingCost(state, quote.cost);
  const maxed = reason === '已达最高等级';
  return <div className="project-payment">
    {!maxed && <><div className="project-facts"><MaterialCost value={quote.cost} /><span>{format(quote.work, 0)} 点工程</span></div>
      {assemblyUnlocked(state) && limit > 0 && <label className="prefab-choice">预制施工
        <select aria-label={`${base.name}预制份数`} value={count} disabled={disabled || !!reason} onChange={e => setSelected(Number(e.target.value))}>
          {Array.from({ length: limit + 1 }, (_, i) => <option key={i} value={i}>{i ? `${i} 构件 · 节省${i * 60}工程点` : '普通施工 · 不用构件'}</option>)}
        </select>
      </label>}
      {count > 0 && <p className="small prefab-savings">替代 {count * 8} 零件，减少 {count * 60} 工程点。构件在实际开工时预留。</p>}
      <p className="condition">{reason ?? (missing.length ? `${missing.join('，')}；可先安排，材料足够后自动开工。` : '材料已够，队首有维修工时自动开工。')}</p></>}
    <button disabled={disabled || !!reason} aria-label={ariaLabel} onClick={() => send({ type: 'enqueue', definition: id, district, prefab: count })}>{buttonText}</button>
  </div>;
}
export function ResidentInbox({ state, send, disabled }: Props) {
  const pending = pendingStories(state);
  if (!pending.length) return null;
  return <section className="panel resident-inbox" aria-label="住客来信">
    <div className="panel-title"><h2>住客留了话</h2><span className="caption">带收音机的住客</span></div>
    {pending.map(id => <article key={id} data-testid={`story-${id}`} className="resident-letter">
      <span className="eyebrow">{id} / 旧物与新用途</span><h3>{STORY_NAMES[id]}</h3><p>{storyText(state, id)}</p>
      {id === 'L01-2' ? <div className="story-options">{(['dismantle', 'restore'] as RadioChoice[]).map(choice => {
        const payment = choice === 'restore' ? ASSEMBLY.restoreCost : amounts(), reward = choice === 'dismantle' ? ASSEMBLY.dismantleReward : amounts();
        const missing = missingCost(state, payment), full = RESOURCES.some(r => state.resources[r] - payment[r] + reward[r] > view(state).capacities[r]);
        return <div key={choice}><h3>{choice === 'dismantle' ? '留下外壳' : '留下声音'}</h3>
          <p className="small">{choice === 'dismantle' ? '获得2构件与快速夹具蓝图；外壳将成为工具盒。' : <><MaterialCost value={payment} />；获得节料台面蓝图，修好的收音机留下声音。</>}</p>
          <button disabled={disabled || missing.length > 0 || full} onClick={() => send({ type: 'story', node: id, choice })}>{choice === 'dismantle' ? '拆解收音机' : '修复收音机'}</button>
          {(missing.length > 0 || full) && <p className="short small">{full ? '需要2构件的奖励空间，选择会保留。' : missing.join('，')}</p>}
        </div>;
      })}</div> : <button disabled={disabled} onClick={() => send({ type: 'story', node: id })}>{id === 'L01-1' ? '读完装配纸条' : '读完住客回信'}</button>}
      <p className="footnote">可以先放在这里。主线与生产照常继续，决定会等你回来。</p>
    </article>)}
  </section>;
}
function parseUnits(text: string): number | null {
  const value = text.trim();
  if (!/^(?:\d+(?:\.\d{0,3})?|\.\d{1,3})$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  const result = Number(whole) * UNIT + Number(fraction.padEnd(3, '0'));
  return Number.isSafeInteger(result) && result <= ASSEMBLY.maxSetting ? result : null;
}
export function AssemblyPanel({ state, send, disabled, district }: Props & { district: DistrictId }) {
  const plan = state.experience.assembly;
  const [target, setTarget] = useState(String(plan.target / UNIT)), [parts, setParts] = useState(String(plan.reserve.parts / UNIT)), [energy, setEnergy] = useState(String(plan.reserve.energy / UNIT));
  useEffect(() => { setTarget(String(plan.target / UNIT)); setParts(String(plan.reserve.parts / UNIT)); setEnergy(String(plan.reserve.energy / UNIT)); }, [plan.target, plan.reserve.parts, plan.reserve.energy]);
  if (!assemblyUnlocked(state)) return null;
  const current = view(state), recipe = assemblyRecipe(state, district), bench = state.experience.benches[district];
  const parsed = [parseUnits(target), parseUnits(parts), parseUnits(energy)], valid = parsed.every(n => n !== null);
  const apply = (enabled: boolean) => { if (valid) send({ type: 'assembly-plan', enabled, target: parsed[0]!, reserve: amounts(parsed[2]!, parsed[1]!) }); };
  const effective = Math.min(plan.target, current.capacities.component), remaining = Math.max(0, effective - state.resources.component);
  const working = workers(state, 'assemble', district), repair = workers(state, 'repair', district), hasBench = districtState(state, district)!.facilities.workbench > 0;
  const status = !plan.enabled ? '装配已暂停，已有安排的人手待命' : remaining === 0 ? '达到构件目标，正常待命' : !working ? '本区等待分配装配工' : !current.output.assemble ? '等待原料，或已到保留线' : `全城正在装配，按当前产速约 ${duration(remaining / current.output.assemble)} 达到目标`;
  return <section className="panel assembly-panel" aria-label="构件装配">
    <div className="panel-title"><h2>把零件接成新的用途</h2><span className="caption">{DISTRICTS[district].name} · 维修台</span></div>
    <p className="small muted">构件可用于预制施工与工具改装。维修 {repair} ＋ 装配 {working}／{hasBench ? districtState(state, district)!.facilities.workbench + 1 : 0} 共享岗位。</p>
    <p className="assembly-recipe"><strong>{recipe.name}</strong> · 每构件 {recipe.parts} 零件、{recipe.energy} 电量 · 基础每人每分钟 {format(recipe.rate * 60)} 构件</p>
    <p className="small muted">全城本秒：产出 {format(current.output.assemble)} 构件，消耗 {format(current.costs.assemble.parts)} 零件、{format(current.costs.assemble.energy)} 电量。设施效率和供电已计入实际变化。</p>
    <form onSubmit={e => { e.preventDefault(); apply(true); }}>
      <div className="assembly-fields">{[['构件目标', target, setTarget], ['零件保留', parts, setParts], ['电量保留', energy, setEnergy]] .map(([label, value, set]) => <label key={label as string}>{label as string}<input inputMode="decimal" aria-label={label as string} value={value as string} disabled={disabled} onChange={e => (set as (value: string) => void)(e.target.value)} /></label>)}</div>
      {!valid && <p className="short small">请输入0至1,000,000，最多3位小数。</p>}
      {valid && parsed[0]! > current.capacities.component && <p className="small">目标高于仓储容量，实际最多备到 {format(current.capacities.component)}；保存的目标不会改变。</p>}
      {valid && (parsed[1]! > current.capacities.parts || parsed[2]! > current.capacities.energy) && <p className="small">保留量高于容量，装配会等待；可修改保留量或增加仓储。</p>}
      <div className="button-row"><button disabled={disabled || !valid} type="submit">保存并启用装配</button><button type="button" disabled={disabled || !plan.enabled} onClick={() => send({ type: 'assembly-plan', ...plan, enabled: false })}>暂停装配</button></div>
    </form>
    <p className="condition" role="status">{status}。</p><p className="footnote">目标与保留量全城共用。施工使用构件后会继续补至库存目标；只备这一批时可暂停装配。待命不扣原料，也不会自动改派工人。</p>
    <div className="mod-options" aria-label="维修台方案">
      <h3>本区工具方案</h3>
      <button aria-pressed={bench.active === null} disabled={disabled || !hasBench || bench.active === null} onClick={() => send({ type: 'assembly-mod', district, mod: null })}>使用普通台面</button>
      {MOD_IDS.map(mod => <article key={mod} className="mod-card"><h3>{ASSEMBLY.recipes[mod].name}</h3><p className="small muted">{mod === 'quickJig' ? '装配快50%，每构件多用4零件、2电量。适合原料有余、备料时间紧张。' : '每构件少用2零件、1电量，装配慢25%。适合可以提前安排加工的时候。'}</p>
        {bench.built.includes(mod) ? <button disabled={disabled || !hasBench || bench.active === mod} aria-pressed={bench.active === mod} onClick={() => send({ type: 'assembly-mod', district, mod })}>{bench.active === mod ? `${ASSEMBLY.recipes[mod].name}已启用` : `启用${ASSEMBLY.recipes[mod].name}`}</button>
          : state.experience.blueprints.includes(mod) ? <ProjectPayment state={state} send={send} disabled={disabled} id={`mod:${mod}`} district={district} ariaLabel={`制作${ASSEMBLY.recipes[mod].name}`} buttonText="安排制作" />
            : <p className="condition">还没有图样。住客的旧物或首章后的工具清单会留下线索。</p>}
      </article>)}
    </div>
    <details className="recovery-control"><summary>构件备多了</summary><p className="small">每整份可拆回4零件。损失一部分加工材料，适合纠正过量安排。</p><button disabled={disabled || state.resources.component < UNIT || state.resources.parts + ASSEMBLY.scrapParts > current.capacities.parts} onClick={() => send({ type: 'scrap', count: 1 })}>拆回1构件</button></details>
  </section>;
}
export function ResidentArchive({ state, send, disabled }: Props) {
  if (!assemblyUnlocked(state)) return null;
  return <section className="panel" aria-label="住客档案"><div className="panel-title"><h2>带收音机的住客</h2><span className="caption">第一次见面：临时路灯下</span></div>
    <p className="small">{radioChoice(state) === 'restore' ? '你留下了声音。窗口的收音机仍记得报时。' : radioChoice(state) === 'dismantle' ? '你留下了外壳。住客正在把旧物变成工具盒。' : '收音机放在维修台旁，住客仍在等你的决定。'}</p>
    {STORY_IDS.filter(id => state.experience.story[id]).map(id => <details className="archive-event" key={id}><summary>{STORY_NAMES[id]}<span className="small muted">已确认</span></summary><p>{storyText(state, id)}</p></details>)}
    {state.experience.story['L01-3'] && <p className="footnote">已收好线索：{radioChoice(state) === 'restore' ? '未登记的半层与旧调频' : '站台储物柜的编号'}。后续外勤调查开放后可继续寻找。</p>}
    {state.completed.includes('P03') && MOD_IDS.filter(mod => !state.experience.blueprints.includes(mod)).map(mod => <article className="mod-card" key={mod}><h3>整理工具清单：{ASSEMBLY.recipes[mod].name}</h3><ProjectPayment state={state} send={send} disabled={disabled} id={`blueprint:${mod}`} ariaLabel={`补学${ASSEMBLY.recipes[mod].name}蓝图`} buttonText="安排整理工具清单" /></article>)}
  </section>;
}
export function StreetScene({ state, district, open }: { state: GameState; district: DistrictId; open: (page: 'operate' | 'work' | 'archive', target?: string) => void }) {
  const d = districtState(state, district)!, service = view(state).services[district], lit = state.completed.includes('P01') && service?.light;
  const housing = d.facilities.dorm > 0, mail = d.facilities.mailbox > 0, table = d.facilities.workbench > 0;
  const restored = district === 'district-0' && radioChoice(state) === 'restore';
  const toolbox = district === 'district-0' && radioChoice(state) === 'dismantle' && Boolean(state.experience.story['L01-3']);
  const building = state.queue.some(p => p.district === district && p.status === 'running');
  const facts = [
    { name: '路灯', status: !state.completed.includes('P01') ? '待修复' : lit ? '亮着' : '待供电', page: 'work' as const },
    { name: '住所', status: housing ? `${localCount(d)}人入住` : '待建设', page: 'operate' as const, target: 'facilities' },
    { name: '维修台', status: table ? toolbox ? '工具盒' : `${d.facilities.workbench}级` : '待建设', page: 'operate' as const, target: assemblyUnlocked(state) ? 'assembly' : 'facilities' },
    { name: '信箱', status: mail ? '可记录' : '待建设', page: 'operate' as const, target: 'facilities' },
    { name: '旧物', status: restored ? housing ? '窗边收音机' : '修好的声音' : toolbox ? '外壳有新用途' : '等一封来信', page: 'archive' as const },
    { name: '工务', status: building ? '施工中' : state.address ? '地址已登记' : '等维修单', page: 'work' as const }
  ];
  return <div className="street-scene" aria-label={`${DISTRICTS[district].name}街景`} data-testid="street-scene">
    <svg viewBox="0 0 640 140" role="img" aria-label={`${lit ? '路灯亮着' : '路灯等待修复或供电'}；${housing ? `${localCount(d)}人有了住处` : '住所尚未建成'}；${building ? '工务正在施工' : '工务按安排等待'}${restored ? '；收音机的声音留了下来' : toolbox ? '；维修台旁放着工具盒' : ''}`}>
      <path d="M16 124H624 M18 130H622" className="street-road" />
      {lit && <ellipse cx="65" cy="118" rx="48" ry="8" className="lamp-pool" />}
      <path d="M65 122V32H86" className="scene-line" /><path d="M76 33L74 41H97L94 33" className={lit ? 'scene-lit' : 'scene-building'} />
      <g className={housing ? 'scene-built' : 'scene-ghost'}><path d="M125 58L172 39L219 58V122H125Z" className="scene-building" /><path d="M158 121V97H178V121" className="scene-line" />
        {Array.from({ length: 6 }, (_, i) => <rect key={i} x={137 + i % 3 * 27} y={65 + Math.floor(i / 3) * 19} width="12" height="12" className={housing && i < localCount(d) ? 'scene-lit' : 'scene-window'} />)}
        {housing && d.facilities.dorm > 1 && <path d="M127 57H217M130 53H214" className="scene-line" />}
      </g>
      <g className={table ? 'scene-built' : 'scene-ghost'}><path d="M250 79H329V88H250Z M257 89V122 M322 89V122" className="scene-line" />
        <path d="M264 78L277 67 M275 65L281 71 M296 77V65H310V77" className="scene-line" />
        {table && d.facilities.workbench > 1 && <path d="M257 108H322" className="scene-line" />}
        {toolbox && <><rect x="333" y="97" width="29" height="23" rx="3" className="scene-lit" /><path d="M340 97V92H353V97" className="scene-line" /></>}
      </g>
      <g className={mail ? 'scene-built' : 'scene-ghost'}><path d="M388 92V122 M372 73H406V99H372Z" className="scene-building" /><path d="M379 82H399" className="scene-line" />{mail && d.facilities.mailbox > 1 && <path d="M379 91H399" className="scene-line" />}</g>
      <path d="M450 117H620 M461 124V112 M493 124V112 M525 124V112 M557 124V112 M589 124V112" className="scene-line" />
      <path d="M480 115V55H520" className="scene-line" /><rect x="489" y="50" width="37" height="22" className={state.completed.includes('P02') ? 'scene-lit' : 'scene-window'} />
      {state.completed.includes('P02') && <text x="504" y="66" className="scene-number">0</text>}
      {restored && <g className="scene-radio"><rect x={housing ? 192 : 272} y={housing ? 64 : 58} width="22" height="14" rx="2" className="scene-lit" /><path d={housing ? 'M198 65L196 57' : 'M278 59L276 51'} className="scene-line" /></g>}
      {building && <g className="scene-construction"><path d="M552 110V86H591V110 M552 91H591 M561 86L571 100 M577 86L587 100" className="scene-line" /><circle cx="571" cy="78" r="4" className="scene-lit" /></g>}
      {state.completed.includes('P01') && district === 'district-0' && <g className="scene-people"><circle cx="44" cy="105" r="3" /><path d="M44 109V121 M41 115H47" /><circle cx="81" cy="104" r="3" /><path d="M81 108V121 M78 114H84" /></g>}
    </svg>
    <div className="scene-destinations">{facts.map(fact => <button key={fact.name} onClick={() => open(fact.page, fact.target)} aria-label={`查看${fact.name}：${fact.status}`}><span>{fact.name}</span><small>{fact.status}</small></button>)}</div>
  </div>;
}
