import { useEffect, useState } from 'react';
import { amounts, RESOURCES, resourceNames, UNIT } from '../game/config';
import { districtState, DISTRICTS, localCount } from '../game/city';
import { definitionFor, duration, enqueueReason, format, missingCost, view, workers, stockLimits } from '../game/engine';
import { ASSEMBLY, assemblyRecipe, assemblyUnlocked, MOD_IDS, pendingStories, prefabLimit, radioChoice, RADIO_STORY_IDS, STORY_NAMES, storyText } from '../game/experience';
import { commissionDone } from '../game/neighborhood';
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
    <div className="panel-title"><h2>住客留了话</h2><span className="caption">住客、邮递员与站务员</span></div>
    {pending.map(id => <article key={id} data-testid={`story-${id}`} className="resident-letter">
      <span className="eyebrow">{id} / {id.startsWith('L03') ? '值得等待的列车' : id.startsWith('L02') ? '两封信，一个门牌' : '旧物与新用途'}</span><h3>{STORY_NAMES[id]}</h3><p>{storyText(state, id)}</p>
      {id === 'L01-2' ? <div className="story-options">{(['dismantle', 'restore'] as RadioChoice[]).map(choice => {
        const payment = choice === 'restore' ? ASSEMBLY.restoreCost : amounts(), reward = choice === 'dismantle' ? ASSEMBLY.dismantleReward : amounts();
        const missing = missingCost(state, payment), full = RESOURCES.some(r => state.resources[r] - payment[r] + reward[r] > stockLimits(state)[r]);
        return <div key={choice}><h3>{choice === 'dismantle' ? '留下外壳' : '留下声音'}</h3>
          <p className="small">{choice === 'dismantle' ? '获得2构件与快速夹具蓝图；外壳将成为工具盒。' : <><MaterialCost value={payment} />；获得节料台面蓝图，修好的收音机留下声音。</>}</p>
          <button disabled={disabled || missing.length > 0 || full} onClick={() => send({ type: 'story', node: id, choice })}>{choice === 'dismantle' ? '拆解收音机' : '修复收音机'}</button>
          {(missing.length > 0 || full) && <p className="short small">{full ? '需要2构件的奖励空间，选择会保留。' : missing.join('，')}</p>}
        </div>;
      })}</div> : <button disabled={disabled} onClick={() => send({ type: 'story', node: id })}>{id === 'L01-1' ? '读完装配纸条' : id.startsWith('L03') ? '读完站务员回访' : id.startsWith('L02') ? '读完邮递员回访' : '读完住客回信'}</button>}
      <p className="footnote">可以先放在这里。主线与生产照常继续，决定会等你回来。</p>
    </article>)}
  </section>;
}
export function parseUnits(text: string): number | null {
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
    {RADIO_STORY_IDS.filter(id => state.experience.story[id]).map(id => <details className="archive-event" key={id}><summary>{STORY_NAMES[id]}<span className="small muted">已确认</span></summary><p>{storyText(state, id)}</p></details>)}
    {state.experience.story['L01-3'] && <p className="footnote">已收好线索：{radioChoice(state) === 'restore' ? '未登记的半层与旧调频' : '站台储物柜的编号'}。可在事项的外勤调查继续寻找。</p>}
    {state.completed.includes('P03') && MOD_IDS.filter(mod => !state.experience.blueprints.includes(mod)).map(mod => <article className="mod-card" key={mod}><h3>整理工具清单：{ASSEMBLY.recipes[mod].name}</h3><ProjectPayment state={state} send={send} disabled={disabled} id={`blueprint:${mod}`} ariaLabel={`补学${ASSEMBLY.recipes[mod].name}蓝图`} buttonText="安排整理工具清单" /></article>)}
  </section>;
}
export function StreetScene({ state, district, open }: { state: GameState; district: DistrictId; open: (page: 'operate' | 'work' | 'archive' | 'network', target?: string) => void }) {
  const d = districtState(state, district)!, service = view(state).services[district], lit = state.completed.includes('P01') && service?.light;
  const housing = d.facilities.dorm > 0, mail = d.facilities.mailbox > 0, table = d.facilities.workbench > 0;
  const restored = district === 'district-0' && radioChoice(state) === 'restore';
  const toolbox = district === 'district-0' && radioChoice(state) === 'dismantle' && Boolean(state.experience.story['L01-3']);
  const clothesline = district === 'district-1' && commissionDone(state, 'CM02-2');
  const delivery = district === 'district-2' && commissionDone(state, 'CM03-2'), receipt = district === 'district-2' && commissionDone(state, 'CM03-3');
  const named = district === 'district-2' && state.events.E07?.choice === 'individual', shared = district === 'district-2' && state.events.E07?.choice === 'common';
  const shade = district === 'district-0' && commissionDone(state, 'CM01-2');
  const life = clothesline ? '晾衣绳下留着通行的路' : receipt ? '窗口收好了两张回执' : delivery ? '窗口已投递，待回信' : named ? '门牌背面有两行名字' : shared ? '两家轮流留灯' : '';
  const building = state.queue.some(p => p.district === district && p.status === 'running');
  const facts = [
    { name: '路灯', status: !state.completed.includes('P01') ? '待修复' : lit ? '亮着' : '待供电', page: 'work' as const },
    { name: '住所', status: housing ? `${localCount(d)}人入住` : '待建设', page: 'operate' as const, target: 'facilities' },
    { name: '维修台', status: table ? toolbox ? '工具盒' : `${d.facilities.workbench}级` : '待建设', page: 'operate' as const, target: assemblyUnlocked(state) ? 'assembly' : 'facilities' },
    { name: '信箱', status: mail ? state.neighborhood.mailboxes[district].active === 'voiceBox' ? '留声匣' : state.neighborhood.mailboxes[district].active === 'dispatchBox' ? '投递匣' : '可记录' : '待建设', page: 'operate' as const, target: 'facilities' },
    { name: '旧物', status: restored ? housing ? '窗边收音机' : '修好的声音' : toolbox ? '外壳有新用途' : '等一封来信', page: 'archive' as const },
    { name: '工务', status: building ? '施工中' : state.address ? '地址已登记' : '等维修单', page: 'work' as const }
  ];
  return <div className="street-scene" aria-label={`${DISTRICTS[district].name}街景`} data-testid="street-scene">
    <svg viewBox="0 0 640 140" role="img" aria-label={`${lit ? '路灯亮着' : '路灯等待修复或供电'}；${housing ? `${localCount(d)}人有了住处` : '住所尚未建成'}；${building ? '工务正在施工' : '工务按安排等待'}${life ? `；${life}` : ''}${shade ? '；灯罩把光留在路面' : ''}${restored ? '；收音机的声音留了下来' : toolbox ? '；维修台旁放着工具盒' : ''}`}>
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
      {shade && <path d="M71 31H101L105 41H67Z" className="scene-line" />}
      {district === 'district-1' && <g className={clothesline ? 'scene-built' : 'scene-ghost'}><path d="M120 33L218 28 M133 32V46H146V31 M178 30V44H193V29" className="scene-line" />{clothesline && <path d="M122 119H220" className="scene-lit" />}</g>}
      {district === 'district-2' && <g className="scene-built"><rect x="531" y="37" width="34" height="37" className={shared ? 'scene-lit' : 'scene-building'} /><rect x="577" y="37" width="34" height="37" className={named ? 'scene-lit' : 'scene-window'} /><path d="M533 52H563 M579 52H609" className="scene-line" />{named && <path d="M543 82H597 M543 88H597" className="scene-line" />}{(delivery || receipt) && <g><rect x="554" y="93" width="34" height="19" className="scene-lit" /><path d="M554 93L571 104L588 93" className="scene-line" />{receipt && <path d="M589 96L594 101L604 89" className="scene-line" />}</g>}</g>}
      {building && <g className="scene-construction"><path d="M552 110V86H591V110 M552 91H591 M561 86L571 100 M577 86L587 100" className="scene-line" /><circle cx="571" cy="78" r="4" className="scene-lit" /></g>}
      {state.completed.includes('P01') && district === 'district-0' && <g className="scene-people"><circle cx="44" cy="105" r="3" /><path d="M44 109V121 M41 115H47" /><circle cx="81" cy="104" r="3" /><path d="M81 108V121 M78 114H84" /></g>}
    </svg>
    {district === 'district-0' && state.completed.includes('P08') && <NightPlatform state={state} open={() => open('network')} />}
    {life && <p className="street-life" data-testid="street-life">{life}。{named ? '各留姓名，让每封回信都写得清楚。' : shared ? '今晚的灯留给后来的人。' : '这是你和街坊一起留下的变化。'}</p>}
    <div className="scene-destinations">{facts.map(fact => <button key={fact.name} onClick={() => open(fact.page, fact.target)} aria-label={`查看${fact.name}：${fact.status}`}><span>{fact.name}</span><small>{fact.status}</small></button>)}</div>
  </div>;
}

function NightPlatform({ state, open }: { state: GameState; open: () => void }) {
  const trip = state.network.routes.rain.trip ?? state.network.routes.station.trip;
  const bench = commissionDone(state, 'CM04-2'), rain = commissionDone(state, 'CM05-2'), shed = commissionDone(state, 'CM06-2');
  const shelter = state.neighborhood.field.sites.F05.first === 'b';
  const position = trip ? trip.direction === 'outbound' ? 26 + (1 - trip.remaining / trip.duration) * 420 : 446 - (1 - trip.remaining / trip.duration) * 420 : 26;
  const facts = [trip ? trip.remaining ? `列车正在${trip.direction === 'outbound' ? '送出补给' : '带回物资'}` : '旧列车等整车卸货' : '列车在站待命', bench ? '候车长椅已按班次转向' : '候车长椅等待CM04回应', rain ? '听雨间已有雨声' : shelter ? '雨城站棚已由首访修好' : '听雨间等待CM05回应', shed ? '修车棚留好了交班工具' : '修车棚等待CM06回应'];
  return <div className="night-platform" data-testid="night-platform"><svg viewBox="0 0 640 100" role="img" aria-label={facts.join('；')}>
    <path d="M16 85H624 M16 91H624" className="street-road" />
    <g transform={`translate(${position},0)`}><rect x="0" y="61" width="65" height="19" rx="4" className="scene-building" /><path d="M7 65H22V73H7Z M29 65H45V73H29Z" className="scene-lit" /><circle cx="14" cy="83" r="4" className="scene-lit" /><circle cx="53" cy="83" r="4" className="scene-lit" /></g>
    {bench && <g><path d="M112 49H178 M115 54H175 M121 54V65 M168 54V65" className="scene-line" /><text x="116" y="39" className="scene-label">候车长椅</text></g>}
    {(rain || shelter) && <g><path d="M245 28L285 12L325 28V66H245Z" className="scene-building" /><path d="M256 43H270V56H256Z M297 35V65" className="scene-lit" /><text x="264" y="83" className="scene-label">{rain ? '听雨间' : '雨城站棚'}</text>{state.experience.archives.includes('A01') && <path d="M277 38Q284 33 291 38 M277 46Q284 41 291 46" className="scene-line" />}</g>}
    {shed && <g><path d="M398 31H482L490 42H390Z M398 43V65 M482 43V65 M410 50H469" className="scene-line" /><text x="412" y="21" className="scene-label">修车棚</text>{state.experience.archives.includes('A02') && <text x="433" y="46" className="scene-label">0</text>}</g>}
    {state.experience.archives.includes('A03') && <g><rect x="548" y="25" width="35" height="29" className="scene-lit" /><path d="M548 25L566 40L583 25" className="scene-line" /></g>}
  </svg><p className="street-life">{facts.join('；')}。{state.experience.archives.length > 0 && `${state.experience.archives.length}份复原来历已留在这里。`}</p><button className="quiet" onClick={open}>查看列车与夜网运单</button></div>;
}
