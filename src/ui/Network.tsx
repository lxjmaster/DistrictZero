import { useState } from 'react';
import type { ReactNode } from 'react';
import { amounts, RESIDENTS, RESOURCES, residentNames, resourceNames, UNIT } from '../game/config';
import { DISTRICTS } from '../game/city';
import { capacities, duration, enqueueReason, format, freeResidents, missingCost } from '../game/engine';
import { awayWorkers, cargoFor, contractPlan, departureEnergy, departureReason, fleetSize, MODES, NETWORK_RULES, occupiedVehicles, productResource, RECIPES, reservedSpace, ROUTE_IDS, ROUTES, routeOpen, routeWear, travelSeconds, vehicleCapacity } from '../game/network';
import { ARCHIVES, ARCHIVE_IDS, archiveUnlocked, archivesUnlocked, LEGACY_ARCHIVE_IDS, remainingSpecialtyUses, VEHICLE_MOD_IDS, VEHICLE_MODS } from '../game/journey';
import { STORY_NAMES, storyText, TRAIN_STORY_IDS } from '../game/experience';
import { calendarHeld } from '../game/calendar-config';
import type { Action, Amounts, CargoManifest, DefinitionId, DistrictId, GameState, ProductionMode, RouteId, ArchiveId } from '../game/types';
import { MaterialCost, parseUnits, ProjectPayment } from './Experience';

type Props = { state: GameState; district: DistrictId; disabled: boolean; send: (action: Action) => void };
const modeName = (mode: ProductionMode) => mode === 'normal' ? '常规' : '特产';
function count(text: string, min = 0, max = 32): number | null { return /^\d+$/.test(text) && Number(text) >= min && Number(text) <= max ? Number(text) : null; }
function Cargo({ value }: { value: Amounts }) { return <MaterialCost value={value} />; }
function RouteCard({ state, district, disabled, send, id }: Props & { id: RouteId }) {
  const route = state.network.routes[id], config = ROUTES[id], saved = route.contract, cap = capacities(state), trip = route.trip;
  const [loads, setLoads] = useState<1 | 2>(saved.loads), [outbound, setOutbound] = useState(String(saved.loads));
  const [manual, setManual] = useState({ normal: String(saved.loads), specialty: '0' });
  const [reserve, setReserve] = useState(() => Object.fromEntries(RESOURCES.map(r => [r, String(saved.reserve[r] / UNIT)])));
  const [targets, setTargets] = useState(() => Object.fromEntries(MODES.map(mode => [mode, String(saved.targets[productResource(id, mode)] / UNIT)])));
  const [buffer, setBuffer] = useState(String(saved.buffer)), [packages, setPackages] = useState({ normal: String(saved.manifest.normal), specialty: String(saved.manifest.specialty) });
  const [first, setFirst] = useState(saved.order[0]), [switchTo, setSwitchTo] = useState<ProductionMode | null>(null);
  const parsedReserve = RESOURCES.map(r => parseUnits(reserve[r])), parsedTargets = MODES.map(m => parseUnits(targets[m]));
  const parsedBuffer = count(buffer, 1, 8), parsedPackages = MODES.map(m => count(packages[m]));
  const valid = parsedReserve.every(v => v !== null) && parsedTargets.every(v => v !== null) && parsedBuffer !== null && parsedPackages.every(v => v !== null) && parsedPackages[0]! + parsedPackages[1]! > 0;
  const saveContract = (enabled: boolean) => {
    if (!valid) return;
    const nextTargets = amounts(); MODES.forEach((mode, i) => { nextTargets[productResource(id, mode)] = parsedTargets[i]!; });
    send({ type: 'contract', route: id, enabled, loads, reserve: Object.fromEntries(RESOURCES.map((r, i) => [r, parsedReserve[i]!])) as Amounts, targets: nextTargets, buffer: parsedBuffer!, manifest: { normal: parsedPackages[0]!, specialty: parsedPackages[1]! }, order: [first, first === 'normal' ? 'specialty' : 'normal'] });
  };
  const template = (mode: ProductionMode) => { setTargets({ normal: mode === 'normal' ? String(cap[productResource(id, mode)] / UNIT) : '0', specialty: mode === 'specialty' ? '6' : '0' }); setPackages({ normal: mode === 'normal' ? String(loads) : '0', specialty: mode === 'specialty' ? '3' : '0' }); setBuffer('2'); setFirst(mode); };
  const manualManifest = { normal: count(manual.normal), specialty: count(manual.specialty) }, outboundCount = count(outbound, 1);
  const currentRecipe = RECIPES[id][route.node.mode], nodeHeld = reservedSpace(state, id), homeHeld = reservedSpace(state, 'home');
  const calendarInputs = calendarHeld(state, id, 'supply'), calendarOutputs = calendarHeld(state, id, 'product');
  const plan = contractPlan(state, id, cap), stop = trip ? trip.remaining ? '已保存合同等待本次运输抵达' : '旧列车等待整车卸货' : 'reason' in plan ? plan.reason : departureReason(state, id, plan.direction, plan.manifest, cap, saved.reserve) ?? '下一秒按已保存合同发车';
  const completedUses = !remainingSpecialtyUses(state).length;
  return <section className="panel network-route" aria-label={`${config.name}线路`} data-testid={`route-${id}`}>
    <div className="panel-title"><div><span className="eyebrow">第0街区 ⇄ {config.name}</span><h2>{config.name}的运单</h2></div><span className={`tag ${saved.enabled ? 'working' : ''}`}>{saved.enabled ? '合同运行中' : '手动发车'}</span></div>
    <p className="muted small">{config.description}</p>
    <div className="node-stocks" aria-label={`${config.name}仓库`}>{RESOURCES.filter(r => config.capacity[r] > 0).map(r => {
      const transportSpace = nodeHeld[r] - calendarOutputs[r];
      return <div key={r}><span className="caption">{resourceNames[r]}</span><strong data-testid={`node-${id}-${r}`}>{format(route.node.resources[r])} / {format(config.capacity[r], 0)}</strong><span className="meter"><span style={{ width: `${route.node.resources[r] / config.capacity[r] * 100}%` }} /></span>
        {transportSpace > 0 && <small>另留 {format(transportSpace)} 给在途货物</small>}
        {calendarOutputs[r] > 0 && <small>历法产物预留空位 {format(calendarOutputs[r])}</small>}
        {calendarInputs[r] > 0 && <small>历法已占原料 {format(calendarInputs[r])} · 可用 {format(route.node.resources[r] - calendarInputs[r])}</small>}
      </div>;
    })}</div>
    {RESOURCES.some(r => calendarInputs[r] || calendarOutputs[r]) && <p className="small muted">历法已占原料仍在当地库存中，产物预留是空位，不是在途货物。加工完成或取消时释放；暂停仍保留。</p>}
    <div className="route-section"><h3>外城生产 · {currentRecipe.name}</h3><p className="small">每60秒使用 <Cargo value={currentRecipe.supply} />，生产 <Cargo value={currentRecipe.product} />。本周期 {route.node.cycle} / 60 秒；缺料或整包空间不足会等待。</p>
      <details className="production-modes" open={completedUses ? undefined : true}><summary>{completedUses ? '有限用途已完成 · 展开生产模式' : '选择常规物资或城市特产'}</summary><p className="small muted">胶片与轨芯用于本章调查、委托、车辆和收藏，用完这些用途后可以正常停产。</p><div className="button-row">{MODES.map(mode => <button key={mode} disabled={disabled || route.node.mode === mode} aria-pressed={route.node.mode === mode} onClick={() => setSwitchTo(mode)}>{route.node.mode === mode ? `正在${RECIPES[id][mode].name}` : `切换为${RECIPES[id][mode].name}`}</button>)}</div>
      </details>
      {switchTo && <div className="inline-confirm" role="group" aria-label={`${config.name}切换生产模式确认`}><p>切换为{RECIPES[id][switchTo].name}？当前 {route.node.cycle} 秒周期将清零。已有库存和运单保留。</p><p className="small">新配方：<Cargo value={RECIPES[id][switchTo].supply} /> → <Cargo value={RECIPES[id][switchTo].product} /></p><div className="button-row"><button disabled={disabled} onClick={() => { send({ type: 'production-mode', route: id, mode: switchTo }); setSwitchTo(null); }}>确认切换{config.name}生产</button><button onClick={() => setSwitchTo(null)}>保留当前生产</button></div></div>}
    </div>
    <div className="route-section"><h3>值守夜工</h3>{route.staff ? <><p className="small">{DISTRICTS[route.staff.district].name}的{residentNames[route.staff.resident]}正在外派，住处保留。</p><button disabled={disabled || !!trip} aria-label={`召回${config.name}夜工`} onClick={() => send({ type: 'network-staff', route: id, ...route.staff!, delta: -1 })}>召回夜工</button>{trip && <p className="condition">本次运输卸货后可以召回。</p>}</> : <><p className="small muted">从当前经营街区“{DISTRICTS[district].name}”派出一人；需先撤回岗位。</p><div className="button-row">{RESIDENTS.map(resident => <button key={resident} aria-label={`外派${residentNames[resident]}至${config.name}`} disabled={disabled || freeResidents(state, resident, district) <= 0} onClick={() => send({ type: 'network-staff', route: id, district, resident, delta: 1 })}>外派{resident === 'shadow' ? '影子' : '回声'} · 空闲 {freeResidents(state, resident, district)}</button>)}</div></>}</div>
    <div className="route-section"><div className="panel-title"><h3>装车与抵达</h3><span className="caption">补给到货 {route.exports} 车 · 回程到货 {route.imports} 车</span></div>
      <svg className="train-scene" viewBox="0 0 500 58" role="img" aria-label={`${config.name}列车${trip ? trip.remaining ? '正在途中' : '到站等待卸货' : '在站待命'}`}><path d="M18 44H482 M18 49H482" className="scene-line" /><text x="18" y="17" className="scene-label">第0街区</text><text x="438" y="17" className="scene-label">{config.name}</text><g transform={`translate(${trip ? trip.direction === 'outbound' ? 30 + (1 - trip.remaining / trip.duration) * 360 : 390 - (1 - trip.remaining / trip.duration) * 360 : 30},0)`}><rect x="0" y="22" width="67" height="18" rx="4" className="scene-building" /><path d="M7 26H23V33H7Z M29 26H45V33H29Z" className="scene-lit" /><circle cx="15" cy="42" r="4" className="scene-lit" /><circle cx="53" cy="42" r="4" className="scene-lit" /></g></svg>
      {trip ? <div className="shipment" role="status" data-testid={`shipment-${id}`}><strong>{trip.direction === 'outbound' ? '补给去程' : '物资回程'} · {trip.remaining > 0 ? `剩余 ${duration(trip.remaining)}` : '已到站，整车等待卸货'}</strong><p className="small"><Cargo value={trip.cargo} /></p><span className="meter large"><span style={{ width: `${(1 - trip.remaining / trip.duration) * 100}%` }} /></span><p className="small">{trip.spaceReserved ? '目的地空间已预留，生产与领奖会为这车让出位置。' : '旧版运单未预留空间；整车放得下时卸货。'}{trip.fee !== null && ` 出发已付${format(trip.fee)}电量、磨损${trip.wear}；单车运量${format(trip.capacity!)}。`}</p>{trip.remaining === 0 && <p className="condition">货物留在车上并占用运力。使用库存后自动卸货。</p>}</div> : <p className="small muted">单程 {duration(travelSeconds(state, id))}，每次发车另耗 {format(departureEnergy(state, id))} 电量、磨损 {routeWear(state)} 状态。货物到站后才可使用。</p>}
      <div className="button-row" role="group" aria-label={`${config.name}装载份数`}>{([1, 2] as const).map(n => <button key={n} disabled={disabled} aria-pressed={loads === n} onClick={() => { setLoads(n); setOutbound(String(n)); setManual({ normal: String(n), specialty: '0' }); setPackages({ normal: String(n), specialty: '0' }); }}>{n}份</button>)}</div>
      <p className="footnote">快捷份数选择常规回程包，并同步合同货单草稿；保存后才修改合同。</p>
      <label className="package-field">去程补给包数<input aria-label={`${config.name}补给包数`} type="number" min="1" max="32" step="1" value={outbound} disabled={disabled} onChange={e => setOutbound(e.target.value)} /></label>
      <div className="assembly-fields">{MODES.map(mode => <label key={mode}>手动{modeName(mode)}回程包<input aria-label={`${config.name}手动${modeName(mode)}包数`} type="number" min="0" max="32" step="1" value={manual[mode]} disabled={disabled} onChange={e => setManual({ ...manual, [mode]: e.target.value })} /></label>)}</div>
      {(['outbound', 'inbound'] as const).map(direction => {
        const manifest: CargoManifest | null = direction === 'outbound' ? outboundCount === null ? null : { normal: outboundCount, specialty: 0 } : MODES.some(m => manualManifest[m] === null) || !manualManifest.normal && !manualManifest.specialty ? null : manualManifest as CargoManifest;
        const reason = !manifest ? '每类0–32整包，至少一包；去程至少一包' : departureReason(state, id, direction, manifest, cap);
        return <div className="freight-option" key={direction}><p className="small">{direction === 'outbound' ? `送去${currentRecipe.name}补给：` : '同车运回：'}{manifest && <Cargo value={cargoFor(id, direction, manifest, route.node.mode)} />}</p><button aria-label={`${direction === 'outbound' ? '发车补给' : '发车取回'}${config.name}`} disabled={disabled || !!reason} onClick={() => manifest && send({ type: 'dispatch', route: id, direction, loads: manifest })}>{direction === 'outbound' ? '发车补给' : '发车取回'}</button><p className="condition">{reason ?? '当前可发车；目的地为整车货物预留空间。'}</p></div>;
      })}
      {RESOURCES.some(r => homeHeld[r]) && <p className="small">本城在途预留 <Cargo value={homeHeld} />，到货前不能用于施工。</p>}
      <p className="footnote">常规包：<Cargo value={RECIPES[id].normal.product} />；特产包：<Cargo value={RECIPES[id].specialty.product} />。同城回程可混装；手动发车不受合同保留量限制。</p>
    </div>
    <div className="route-section"><h3>目标供货合同</h3><p className="small muted">有需求时先取回现有整包；否则为当前模式补足缓冲。达标后待命，使用库存后恢复。合同不会自动切换外城配方。</p>
      <div className="button-row"><button disabled={disabled} onClick={() => template('normal')}>补本城原料</button><button disabled={disabled} onClick={() => template('specialty')}>取城市特产 · 建议6</button></div>
      <div className="assembly-fields">{MODES.map(mode => <label key={mode}>{resourceNames[productResource(id, mode)]}目标<input aria-label={`${config.name}${resourceNames[productResource(id, mode)]}目标`} type="number" min="0" max="1000000" step="0.001" value={targets[mode]} disabled={disabled} onChange={e => setTargets({ ...targets, [mode]: e.target.value })} /></label>)}<label>补给缓冲周期<input aria-label={`${config.name}缓冲周期`} type="number" min="1" max="8" step="1" value={buffer} disabled={disabled} onChange={e => setBuffer(e.target.value)} /></label></div>
      <details><summary>货单、优先装载与本城保留量</summary><div className="assembly-fields">{MODES.map(mode => <label key={mode}>每车最多{modeName(mode)}包<input aria-label={`${config.name}合同${modeName(mode)}包数`} type="number" min="0" max="32" step="1" value={packages[mode]} disabled={disabled} onChange={e => setPackages({ ...packages, [mode]: e.target.value })} /></label>)}<label>优先装载<select aria-label={`${config.name}优先装载`} value={first} disabled={disabled} onChange={e => setFirst(e.target.value as ProductionMode)}>{MODES.map(mode => <option key={mode} value={mode}>{modeName(mode)}物资</option>)}</select></label></div>
      <div className="reserve-fields">{RESOURCES.map(r => <label key={r}>{resourceNames[r]}保留量<input aria-label={`${config.name}保留${resourceNames[r]}`} type="number" min="0" max="1000000" step="0.001" value={reserve[r]} disabled={disabled || !state.completed.includes('R05')} onChange={e => setReserve({ ...reserve, [r]: e.target.value })} /></label>)}</div></details>
      <p className="small muted" data-testid={`contract-saved-${id}`}>已保存：{MODES.map(mode => `${resourceNames[productResource(id, mode)]}目标${format(saved.targets[productResource(id, mode)])}（每车最多${saved.manifest[mode]}包）`).join('；')}；缓冲{saved.buffer}周期；{modeName(saved.order[0])}先装。{RESOURCES.map(r => `${resourceNames[r]}保留${format(saved.reserve[r])}`).join(' · ')}。</p>
      <div className="button-row"><button disabled={disabled || !valid || !state.completed.includes('R05')} aria-label={`保存${config.name}合同配置`} onClick={() => saveContract(saved.enabled)}>保存合同配置</button><button disabled={disabled || (!saved.enabled && !valid) || !state.completed.includes('R05')} aria-label={`${saved.enabled ? '暂停' : '启用'}${config.name}供货合同`} onClick={() => saved.enabled ? send({ type: 'contract-pause', route: id }) : saveContract(true)}>{saved.enabled ? '暂停供货合同' : '启用供货合同'}</button></div>
      <p className="condition" role="status">{saved.enabled ? stop : '已保存合同暂停；在途货物继续抵达。'}</p>
      {!state.completed.includes('R05') && <p className="condition">研究“运单规范”后开放自动供货。</p>}{!valid && <p className="short small">目标与保留量为0到1,000,000，最多三位小数；缓冲1–8周期；每类0–32整包且至少一包。无效草稿仍可暂停已保存合同。</p>}
    </div>
    <div className="route-section"><h3>线路维护</h3><p className="small">线路状态 {route.condition} / {NETWORK_RULES.condition}；状态耗尽后停止新发车。</p><span className="meter"><span style={{ width: `${route.condition / NETWORK_RULES.condition * 100}%` }} /></span><p className="small muted">维护费用 <Cargo value={NETWORK_RULES.repairCost} /> · {format(NETWORK_RULES.repairWork, 0)} 工程点，完成恢复全部状态。</p>
      <ProjectPayment state={state} send={send} disabled={disabled} id={`route:${id}`} ariaLabel={`安排维护${config.name}线路`} buttonText="安排线路维护" /><div className="button-row"><button aria-label={`${route.autoRepair ? '关闭' : '开启'}${config.name}自动维护`} disabled={disabled || !state.completed.includes('R04')} aria-pressed={route.autoRepair} onClick={() => send({ type: 'route-auto', route: id, enabled: !route.autoRepair })}>{route.autoRepair ? '关闭自动维护' : '开启自动维护'}</button></div><p className="condition">{enqueueReason(state, `route:${id}`) ?? '共用工务队列，维修工按原有安排施工。'} 自动维护在状态不超过200时加入队尾；巡检手册解锁。</p>
    </div>
  </section>;
}
function VehiclePanel({ state, disabled, send }: Omit<Props, 'district'>) {
  const active = state.network.vehicle.active, busy = occupiedVehicles(state) > 0;
  return <section className="panel" aria-label="车辆方案"><div className="panel-title"><h2>给下一班车换一套工具</h2><span className="caption">全网共用 · 单启用位</span></div><p className="small">当前：{active ? VEHICLE_MODS[active].name : '普通车辆'}。制作共用工务队列，完工后由你启用。</p><button disabled={disabled || busy || active === null} aria-pressed={active === null} onClick={() => send({ type: 'vehicle-mod', mod: null })}>使用普通车辆</button>
    <div className="mod-options">{VEHICLE_MOD_IDS.filter(mod => state.experience.blueprints.includes(mod)).map(mod => <article key={mod} className="mod-card" data-testid={`vehicle-${mod}`}><h3>{VEHICLE_MODS[mod].name}</h3><p className="small">{VEHICLE_MODS[mod].text}</p>{state.network.vehicle.built.includes(mod) ? <button disabled={disabled || busy || active === mod} aria-pressed={active === mod} onClick={() => send({ type: 'vehicle-mod', mod })}>{active === mod ? `${VEHICLE_MODS[mod].name}已启用` : `启用${VEHICLE_MODS[mod].name}`}</button> : <ProjectPayment state={state} send={send} disabled={disabled} id={`vehiclemod:${mod}`} ariaLabel={`制作${VEHICLE_MODS[mod].name}`} buttonText="安排制作" />}</article>)}</div>
    {!VEHICLE_MOD_IDS.some(mod => state.experience.blueprints.includes(mod)) && <p className="condition">候车乘客的CM04委托与长站F06调查会留下车辆图样。</p>}{busy && <p className="condition">全网途中或待卸列车清空后可切换。可先暂停合同，等已有运单抵达。</p>}
  </section>;
}
export function JourneyArchive({ state, send, disabled }: Omit<Props, 'district'>) {
  const [confirm, setConfirm] = useState<ArchiveId | null>(null), unlocked = archivesUnlocked(state);
  const visible = ARCHIVE_IDS.filter(id => archiveUnlocked(state, id));
  if (!visible.length && !state.experience.story['L03-1']) return null;
  return <section className="panel" aria-label="夜网与复原档案"><div className="panel-title"><h2>列车带回来的来历</h2><span className="caption">站务员 · 已复原 {state.experience.archives.length} / {LEGACY_ARCHIVE_IDS.length + Number(archiveUnlocked(state, 'A04'))}</span></div>
    {TRAIN_STORY_IDS.filter(id => state.experience.story[id]).map(id => <details className="archive-event" key={id}><summary>{id} {STORY_NAMES[id]}</summary><p>{storyText(state, id)}</p></details>)}
    {visible.length > 0 && <><p className="small muted">每份直接支付并复原一次，不占工务队列。胶片与轨芯是这些有限来历的材料。</p>{visible.map(id => {
      const def = ARCHIVES[id], done = state.experience.archives.includes(id), epilogue = id === 'A04';
      const missing = missingCost(state, def.cost, epilogue ? 3 : 2);
      return <article className="mod-card" key={id} data-testid={`archive-${id}`}><span className="eyebrow">{id} · {def.place}{epilogue && ' · 可选尾声'}</span><h3>{def.name}</h3>{done ? <p>{def.text}</p> : <>
        {def.invitation && <p>{def.invitation}</p>}{epilogue && <p className="small muted">一次交接后永久收藏，无数值收益或后续维护。以前留下的库存可直接使用，暂时离开也没有期限。</p>}
        <p className="small">{epilogue ? '交接费用' : '复原费用'} <Cargo value={def.cost} /></p>
        {epilogue && <p className="small">旧城可用：{RESOURCES.filter(r => def.cost[r] > 0).map(r => `${format(state.resources[r], 3)} ${resourceNames[r]}`).join(' · ')}</p>}
        <button disabled={disabled || missing.length > 0} onClick={() => setConfirm(id)}>{epilogue ? '交接并收藏' : `复原${def.name}`}</button>
        {missing.length > 0 && <p className="condition">{missing.join('，')}</p>}{confirm === id && <div className="inline-confirm"><p>支付上述材料，{epilogue ? '永久收藏' : '复原'}“{def.name}”？</p><div className="button-row"><button disabled={disabled || missing.length > 0} onClick={() => { send({ type: 'archive', id }); setConfirm(null); }}>{epilogue ? '确认交接A04' : `确认复原${id}`}</button><button onClick={() => setConfirm(null)}>暂时收好材料</button></div></div>}
      </>}</article>;
    })}</>}
    {!unlocked && <p className="condition">CM05听雨间委托或F05修棚首访会留下前三份档案的复原方法。</p>}
  </section>;
}
export function NetworkPage({ state, district, disabled, send, project }: Props & { project: (id: DefinitionId) => ReactNode }) {
  const uses = remainingSpecialtyUses(state), held = reservedSpace(state, 'home');
  return <div className="stack"><section className="panel network-overview"><span className="eyebrow">第三章 / 城际夜网</span><h2>让下一班车有地方抵达</h2><p className="muted small">本城三个街区共享物资。雨城与长站各有仓库、常规与特产两种配方，同城回程可以混装。</p><p className="network-fleet">共享列车 {occupiedVehicles(state)} / {fleetSize(state)} 辆使用中 · 每车最多 {format(vehicleCapacity(state), 0)} 单位</p><p className="small muted">外派 {RESIDENTS.reduce((n, type) => n + awayWorkers(state, district, type), 0)} 位夜工来自当前街区；外派期间不承担本地岗位，住处保留。</p>
      <div className="priority-list">{state.network.priority.map((id, i) => <div key={id}><span><b>{i + 1}</b>{ROUTES[id].name}合同</span><button disabled={disabled || i === 0} aria-label={`提高${ROUTES[id].name}线路优先级`} onClick={() => send({ type: 'network-priority', order: [...state.network.priority].reverse() })}>优先调度</button></div>)}</div><p className="footnote">合同按此顺序使用共享车辆。稳班磨损80；快班时长×0.8、磨损150；护轨再乘0.75向上取整。已有运单使用出发时的安排。</p>
      {RESOURCES.some(r => held[r]) && <p className="small" data-testid="home-reservations">本城为在途货物留出 <Cargo value={held} />；这是空位，尚未计入收入。</p>}
      <details><summary>{uses.length ? `城市特产还有${uses.length}类有限用途` : '当前特产用途已完成，可以收拢与停产'}</summary><p className="small">{uses.length ? uses.join('、') : '当前开放的调查、委托、车辆方案与档案均已留下。无需每天补交；目标设为0或暂停合同即可停供，生产也可以切回常规。'}</p></details>
    </section>
    {state.completed.includes('P08') && <VehiclePanel state={state} disabled={disabled} send={send} />}
    {ROUTE_IDS.map(id => routeOpen(state, id) ? <RouteCard key={id} state={state} district={district} disabled={disabled} send={send} id={id} /> : <section className="panel" key={id}><h2>{ROUTES[id].name} · 等待通车</h2><p className="muted small">{id === 'rain' ? '先修复末班车厢，再安排外派与第一份补给。' : '先收到雨城的回程箱子，决定班次，再恢复长站货台。'}</p></section>)}
    <section className="stack" aria-label="夜网工程"><h2>把线路写进交接单</h2>{(['P08', 'P09', 'R05', 'R06', 'P10', 'P11'] as const).map(id => <div key={id}>{project(id)}</div>)}</section>
  </div>;
}
