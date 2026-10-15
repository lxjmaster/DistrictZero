import { useState } from 'react';
import type { ReactNode } from 'react';
import { amounts, RESIDENTS, RESOURCES, residentNames, resourceNames, UNIT } from '../game/config';
import { DISTRICTS } from '../game/city';
import { capacities, duration, enqueueReason, format, freeResidents } from '../game/engine';
import { awayWorkers, cargoFor, departureReason, fleetSize, NETWORK_RULES, occupiedVehicles, ROUTE_IDS, ROUTES, routeOpen, routeWear, travelSeconds, vehicleCapacity } from '../game/network';
import type { Action, Amounts, DefinitionId, DistrictId, GameState, RouteId } from '../game/types';

type Props = { state: GameState; district: DistrictId; disabled: boolean; send: (action: Action) => void };
function parseReserve(values: Record<keyof Amounts, string>): Amounts | null {
  const parsed = amounts();
  for (const resource of RESOURCES) {
    const value = values[resource].trim();
    if (!/^(?:\d+(?:\.\d{0,3})?|\.\d{1,3})$/.test(value)) return null;
    const [whole, fraction = ''] = value.split('.');
    // Convert decimal digits directly to internal units to avoid floating-point multiplication.
    const amount = Number(whole) * UNIT + Number(fraction.padEnd(3, '0'));
    if (!Number.isSafeInteger(amount) || amount > 1000000 * UNIT) return null;
    parsed[resource] = amount;
  }
  return parsed;
}
function Cargo({ value }: { value: Amounts }) {
  return <span className="costs">{RESOURCES.filter(r => value[r]).map(r => <span key={r}>{format(value[r])} {resourceNames[r]}</span>)}</span>;
}
function RouteCard({ state, district, disabled, send, id }: Props & { id: RouteId }) {
  const route = state.network.routes[id], config = ROUTES[id];
  const [loads, setLoads] = useState<1 | 2>(route.contract.loads);
  const [reserve, setReserve] = useState(() => Object.fromEntries(RESOURCES.map(r => [r, String(route.contract.reserve[r] / UNIT)])) as Record<keyof Amounts, string>);
  const cap = capacities(state), trip = route.trip;
  const maintenanceReason = enqueueReason(state, `route:${id}`);
  const parsedReserve = parseReserve(reserve), invalidReserve = parsedReserve === null;
  const saveContract = (enabled: boolean) => {
    if (parsedReserve) send({ type: 'contract', route: id, enabled, loads, reserve: parsedReserve });
  };
  const toggleContract = () => {
    if (route.contract.enabled) send({ type: 'contract', route: id, ...route.contract, enabled: false });
    else saveContract(true);
  };
  return <section className="panel network-route" aria-label={`${config.name}线路`} data-testid={`route-${id}`}>
    <div className="panel-title"><div><span className="eyebrow">第0街区 ⇄ {config.name}</span><h2>{config.name}的运单</h2></div><span className={`tag ${route.contract.enabled ? 'working' : ''}`}>{route.contract.enabled ? '合同运行中' : '手动发车'}</span></div>
    <p className="muted small">{config.description}</p>
    <div className="node-stocks" aria-label={`${config.name}仓库`}>{RESOURCES.map(r => <div key={r}><span className="caption">{resourceNames[r]}</span><strong data-testid={`node-${id}-${r}`}>{format(route.node.resources[r])} / {format(config.capacity[r], 0)}</strong><span className="meter"><span style={{ width: `${route.node.resources[r] / config.capacity[r] * 100}%` }} /></span></div>)}</div>
    <p className="small muted">每60秒使用 <Cargo value={config.supply} />，生产 <Cargo value={config.product} />。缺料或特产满仓时等待。</p>
    <div className="route-section"><h3>值守夜工</h3>{route.staff ? <><p className="small">{DISTRICTS[route.staff.district].name}的{residentNames[route.staff.resident]}正在外派，住处保留。</p><button disabled={disabled || !!trip} aria-label={`召回${config.name}夜工`} onClick={() => send({ type: 'network-staff', route: id, ...route.staff!, delta: -1 })}>召回夜工</button>{trip && <p className="condition">本次运输卸货后可以召回。</p>}</> : <><p className="small muted">从当前经营街区“{DISTRICTS[district].name}”派出一人；需先撤回岗位。</p><div className="button-row">{RESIDENTS.map(resident => <button key={resident} aria-label={`外派${residentNames[resident]}至${config.name}`} disabled={disabled || freeResidents(state, resident, district) <= 0} onClick={() => send({ type: 'network-staff', route: id, district, resident, delta: 1 })}>外派{resident === 'shadow' ? '影子' : '回声'} · 空闲 {freeResidents(state, resident, district)}</button>)}</div></>}</div>
    <div className="route-section"><div className="panel-title"><h3>装车与抵达</h3><span className="caption">补给到货 {route.exports} 车 · 回程到货 {route.imports} 车</span></div>
      {trip ? <div className="shipment" role="status" data-testid={`shipment-${id}`}><strong>{trip.direction === 'outbound' ? '补给去程' : '特产回程'} · {trip.remaining > 0 ? `剩余 ${duration(trip.remaining)}` : '已到站，整车等待卸货'}</strong><p className="small"><Cargo value={trip.cargo} /></p><span className="meter large"><span style={{ width: `${(1 - trip.remaining / trip.duration) * 100}%` }} /></span>{trip.remaining === 0 && <p className="condition">目的地空间不足，货物留在车上并占用运力。使用库存后自动卸货。</p>}</div> : <p className="small muted">单程 {duration(travelSeconds(state, id))}，每次发车另耗 {format(config.energy)} 电量、磨损 {routeWear(state)} 状态。货物到站后才可使用。</p>}
      <div className="button-row" role="group" aria-label={`${config.name}装载份数`}>{([1, 2] as const).map(n => <button key={n} disabled={disabled} aria-pressed={loads === n} onClick={() => setLoads(n)}>{n}份</button>)}</div>
      {(['outbound', 'inbound'] as const).map(direction => {
        const reason = departureReason(state, id, direction, loads, cap);
        return <div className="freight-option" key={direction}><p className="small">{direction === 'outbound' ? '送去补给：' : '运回特产：'}<Cargo value={cargoFor(id, direction, loads)} /></p><button aria-label={`${direction === 'outbound' ? '发车补给' : '发车取回'}${config.name}`} disabled={disabled || !!reason} onClick={() => send({ type: 'dispatch', route: id, direction, loads })}>{direction === 'outbound' ? '发车补给' : '发车取回'}</button><p className="condition">{reason ?? '当前可发车。运行电量从本城扣除。'}</p></div>;
      })}
      <p className="footnote">取货前可让记录员/回收工待命，或安排工程腾出本城仓储；手动发车使用当前库存，不受合同保留量限制。</p>
    </div>
    <div className="route-section"><h3>自动供货合同</h3><p className="small muted">优先取回备齐的特产，再尝试补给。发车后保留下面的本城库存，运行电量也计入检查。停用后本次运输继续。</p>
      <div className="reserve-fields">{RESOURCES.map(r => <label key={r}>{resourceNames[r]}保留量<input aria-label={`${config.name}保留${resourceNames[r]}`} type="number" min="0" max="1000000" step="0.001" value={reserve[r]} disabled={disabled || !state.completed.includes('R05')} onChange={e => setReserve({ ...reserve, [r]: e.target.value })} /></label>)}</div>
      <p className="small muted">已保存：每车{route.contract.loads}份；{RESOURCES.map(r => `${resourceNames[r]} ${format(route.contract.reserve[r])}`).join(' · ')}。</p>
      <div className="button-row"><button disabled={disabled || invalidReserve || !state.completed.includes('R05')} aria-label={`保存${config.name}合同配置`} onClick={() => saveContract(route.contract.enabled)}>保存合同配置</button><button disabled={disabled || (!route.contract.enabled && invalidReserve) || !state.completed.includes('R05')} aria-label={`${route.contract.enabled ? '暂停' : '启用'}${config.name}供货合同`} onClick={toggleContract}>{route.contract.enabled ? '暂停供货合同' : '启用供货合同'}</button></div>
      {!state.completed.includes('R05') && <p className="condition">研究“运单规范”后开放自动供货。</p>}{invalidReserve && <p className="short small">保留量需为0到1,000,000之间的有效数值，最多三位小数。</p>}
    </div>
    <div className="route-section"><h3>线路维护</h3><p className="small">线路状态 {route.condition} / {NETWORK_RULES.condition}；状态耗尽后停止新发车。</p><span className="meter"><span style={{ width: `${route.condition / NETWORK_RULES.condition * 100}%` }} /></span><p className="small muted">维护费用 <Cargo value={NETWORK_RULES.repairCost} /> · {format(NETWORK_RULES.repairWork, 0)} 工程点，完成恢复全部状态。</p>
      <div className="button-row"><button aria-label={`安排维护${config.name}线路`} disabled={disabled || !!maintenanceReason} onClick={() => send({ type: 'enqueue', definition: `route:${id}` })}>安排线路维护</button><button aria-label={`${route.autoRepair ? '关闭' : '开启'}${config.name}自动维护`} disabled={disabled || !state.completed.includes('R04')} aria-pressed={route.autoRepair} onClick={() => send({ type: 'route-auto', route: id, enabled: !route.autoRepair })}>{route.autoRepair ? '关闭自动维护' : '开启自动维护'}</button></div><p className="condition">{maintenanceReason ?? '共用工务队列，维修工按原有安排施工。'} 自动维护在状态不超过200时加入队尾；巡检手册解锁。</p>
    </div>
  </section>;
}
export function NetworkPage({ state, district, disabled, send, project }: Props & { project: (id: DefinitionId) => ReactNode }) {
  return <div className="stack"><section className="panel network-overview"><span className="eyebrow">第三章 / 城际夜网</span><h2>让下一班车有地方抵达</h2><p className="muted small">本城三个街区共享物资。雨城与长站各有自己的仓库，运单把它们连起来。</p><p className="network-fleet">共享列车 {occupiedVehicles(state)} / {fleetSize(state)} 辆使用中 · 每车最多 {format(vehicleCapacity(state), 0)} 单位</p><p className="small muted">外派 {RESIDENTS.reduce((n, type) => n + awayWorkers(state, district, type), 0)} 位夜工来自当前街区；外派期间不承担本地岗位，住处保留。</p>
      <div className="priority-list">{state.network.priority.map((id, i) => <div key={id}><span><b>{i + 1}</b>{ROUTES[id].name}合同</span><button disabled={disabled || i === 0} aria-label={`提高${ROUTES[id].name}线路优先级`} onClick={() => send({ type: 'network-priority', order: [...state.network.priority].reverse() })}>优先调度</button></div>)}</div><p className="footnote">自动合同按此顺序使用共享列车。稳班每次磨损80；快班缩短20%路程时间、每次磨损150。首次回程后选择。</p>
    </section>
    {ROUTE_IDS.map(id => routeOpen(state, id) ? <RouteCard key={id} state={state} district={district} disabled={disabled} send={send} id={id} /> : <section className="panel" key={id}><h2>{ROUTES[id].name} · 等待通车</h2><p className="muted small">{id === 'rain' ? '先修复末班车厢，再安排外派与第一份补给。' : '先收到雨城的回程箱子，决定班次，再恢复长站货台。'}</p></section>)}
    <section className="stack" aria-label="夜网工程"><h2>把线路写进交接单</h2>{(['P08', 'P09', 'R05', 'R06', 'P10', 'P11'] as const).map(id => <div key={id}>{project(id)}</div>)}</section>
  </div>;
}
