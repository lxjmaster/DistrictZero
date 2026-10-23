import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { amounts, RESOURCES, resourceNames, residentNames, UNIT } from '../game/config';
import { DISTRICTS } from '../game/city';
import { duration, format } from '../game/engine';
import { calendarOrderReason, calendarPrepareReason, calendarStorageReason } from '../game/calendar';
import { CALENDARS, CALENDAR_PROJECTS, CALENDAR_RULES, calendarCapacity, calendarClock, calendarHeld, calendarQueueLimit, calendarUnlocked } from '../game/calendar-config';
import { CALENDAR_STORY_IDS, STORY_NAMES, storyText } from '../game/experience';
import { MODES, RECIPES, reservedSpace, ROUTES, ROUTE_IDS } from '../game/network';
import type { Action, Amounts, CalendarOrder, DefinitionId, GameState, ProductionMode, ReturnReport, RouteId } from '../game/types';
import { MaterialCost, parseUnits, ProjectPayment } from './Experience';
import './calendar.css';

type Props = { state: GameState; send: (action: Action) => void; disabled: boolean };
const modeName = (mode: ProductionMode) => mode === 'normal' ? '常规' : '特产';
const settingsText = (value: Amounts) => Object.fromEntries(RESOURCES.map(r => [r, String(value[r] / UNIT)])) as Record<keyof Amounts, string>;
function Materials({ value }: { value: Amounts }) {
  return RESOURCES.some(r => value[r] > 0) ? <MaterialCost value={value} /> : <span className="muted">无</span>;
}

function CalendarClocks({ state }: { state: GameState }) {
  return <section className="panel" aria-label="三地钟面">
    <div className="panel-title"><h2>把三地放在同一天</h2><span className="caption">每轮 {CALENDAR_RULES.round} 游戏秒</span></div>
    <p className="small muted">原点始于校时台完工，不随现实日期或重开变化。只有历法加工需要重叠窗口；原有生产与列车照常运行。</p>
    <div className="calendar-clocks">{(['home', ...ROUTE_IDS] as const).map(id => {
      const clock = calendarClock(state, id), place = CALENDARS[id];
      return <article key={id} data-testid={`calendar-clock-${id}`}>
        <h3>{place.name}</h3><p>第 {clock.round + 1} 轮 · 当地 {clock.local} / {CALENDAR_RULES.round} 秒</p>
        <p className="small muted">相对旧城 +{place.offset} 秒 · 当地记账时段 0–{place.end} 秒（不含终点）</p>
        <span className={`tag ${clock.overlap ? 'working' : ''}`}>{clock.overlap ? id === 'home' ? '旧城记账时段' : '正与旧城重叠' : '等待下一窗口'}</span>
        <p className="small">{id === 'home' ? '旧城基准 0–360 秒' : `旧城每轮 ${id === 'rain' ? '0–120' : '240–360'} 秒重叠`}{clock.overlap ? '，窗口内可加工。' : `；下次还有 ${duration(clock.next)}。`}</p>
      </article>;
    })}</div>
  </section>;
}

function CalendarStorage({ state, send, disabled }: Props) {
  const plan = state.calendar.storage, capacity = calendarCapacity(state);
  const [target, setTarget] = useState(String(plan.target));
  const [reserve, setReserve] = useState(() => settingsText(plan.reserve));
  useEffect(() => {
    setTarget(String(plan.target)); setReserve(settingsText(plan.reserve));
  }, [plan.target, plan.reserve.energy, plan.reserve.parts, plan.reserve.memory, plan.reserve.component, plan.reserve.rainFilm, plan.reserve.railCore]);
  const targetValue = /^\d+$/.test(target.trim()) ? Number(target) : NaN;
  const parsed = RESOURCES.map(r => parseUnits(reserve[r]));
  const valid = Number.isSafeInteger(targetValue) && targetValue >= 0 && targetValue <= CALENDAR_RULES.capacity && parsed.every(n => n !== null);
  const save = (enabled: boolean) => {
    if (!valid) return;
    const savedReserve = amounts();
    RESOURCES.forEach((r, i) => { savedReserve[r] = parsed[i]!; });
    send({ type: 'calendar-storage', enabled, target: targetValue, reserve: savedReserve });
  };
  const reason = calendarStorageReason(state);
  return <section className="panel calendar-storage" data-testid="calendar-storage" aria-label="时间储备">
    <div className="panel-title"><h2>把还没用上的一刻收好</h2><span className={`tag ${plan.enabled ? 'working' : ''}`}>{plan.enabled ? '储时已启用' : '储时已暂停'}</span></div>
    <p className="calendar-total" data-testid="calendar-stored">时间储备 <strong>{state.calendar.stored}</strong> / {capacity} 秒</p>
    <p className="small">每个正常游戏秒最多储入1秒，实际消耗 <Materials value={CALENDAR_RULES.captureCost} />；满目标或触及保留量时等待，不收费。</p>
    <form onSubmit={e => { e.preventDefault(); save(true); }}>
      <label className="calendar-target">储时目标（秒）<input aria-label="储时目标（秒）" inputMode="numeric" value={target} disabled={disabled} onChange={e => setTarget(e.target.value)} /></label>
      <div className="calendar-reserves">{RESOURCES.map(r => <label key={r}>{resourceNames[r]}保留量<input aria-label={`历法保留${resourceNames[r]}`} inputMode="decimal" value={reserve[r]} disabled={disabled} onChange={e => setReserve({ ...reserve, [r]: e.target.value })} /></label>)}</div>
      {!valid && <p className="short small" role="status">目标为0–600整数秒；六项保留量为0–1,000,000，最多3位小数。草稿无效仍可暂停已保存储时。</p>}
      {valid && targetValue > capacity && <p className="small">目标高于当前容量，实际最多储至 {capacity} 秒；保存的目标不变。</p>}
      <div className="button-row"><button type="button" disabled={disabled || !valid} onClick={() => save(plan.enabled)}>保存储时配置</button><button type="submit" disabled={disabled || !valid}>保存并启用储时</button><button type="button" disabled={disabled || !plan.enabled} onClick={() => send({ type: 'calendar-storage-pause' })}>暂停储时</button></div>
    </form>
    <p className="small muted" data-testid="calendar-storage-saved">已保存：目标 {plan.target} 秒，当前有效目标 {Math.min(plan.target, capacity)} 秒；{RESOURCES.map(r => `${resourceNames[r]}保留${format(plan.reserve[r], 3)}`).join(' · ')}。</p>
    <p className="condition" role="status">{reason ?? '按已保存配置逐秒储入时间'}。</p>
    <p className="footnote">加工另付 {CALENDAR_RULES.steps} 秒储备、1次校准余量及 <Materials value={CALENDAR_RULES.boostCost} />，同样遵守这六条旧城保留线。储时和加工都记为运行消耗。</p>
  </section>;
}

function CalendarSupply({ state, route: id, draft }: { state: GameState; route: RouteId; draft: CalendarOrder }) {
  const route = state.network.routes[id], held = calendarHeld(state, id, 'supply'), space = reservedSpace(state, id);
  const next = state.calendar.orders.find(order => order.route === id) ?? (draft.route === id ? draft : null);
  const recipe = next ?? RECIPES[id][route.node.mode], otherHeld = calendarHeld(state, id, 'supply', next?.uid);
  const missing = amounts();
  for (const r of RESOURCES) missing[r] = Math.max(0, recipe.supply[r] - Math.max(0, route.node.resources[r] - otherHeld[r]));
  const trip = route.trip, clock = calendarClock(state, id);
  return <article className="calendar-supply" data-testid={`calendar-supply-${id}`} aria-label={`${ROUTES[id].name}历法供料`}>
    <div className="panel-title"><h3>{ROUTES[id].name} · 真实供料</h3><span className="caption">{route.contract.enabled ? '目标合同已启用' : '目标合同已暂停'}</span></div>
    <p className="small">当前生产：{RECIPES[id][route.node.mode].name}；{route.staff ? `${DISTRICTS[route.staff.district].name}的${residentNames[route.staff.resident]}值守` : '尚无外派夜工'}。</p>
    <p className="small muted">已保存合同目标 <Materials value={route.contract.targets} />；当地补给缓冲 {route.contract.buffer} 周期。历法不会修改这些安排。</p>
    <div className="calendar-stock-grid">{RESOURCES.filter(r => ROUTES[id].capacity[r] > 0).map(r => <div key={r}>
      <h4>{resourceNames[r]}</h4><p>当地 {format(route.node.resources[r])} / {format(ROUTES[id].capacity[r], 0)}</p>
      <p className="small muted">已占原料 {format(held[r])} · 可用 {format(Math.max(0, route.node.resources[r] - held[r]))}</p>
      <p className="small muted">预留空位 {format(space[r])} · 剩余空位 {format(Math.max(0, ROUTES[id].capacity[r] - route.node.resources[r] - space[r]))}</p>
    </div>)}</div>
    <p className="small">{next && next.uid !== 'draft' ? `下一张已保存单 ${next.uid}` : draft.route === id ? '当前草稿' : '当前模式'}一批需要 <Materials value={recipe.supply} />；尚缺 <Materials value={missing} />。</p>
    <p className="small">历法产物预留 <Materials value={calendarHeld(state, id, 'product')} />，与列车预留共用仓储空位。</p>
    <p className="small" data-testid={`calendar-transit-${id}`}>{trip ? <>{trip.direction === 'outbound' ? '在途补给' : '回程货物'}：<Materials value={trip.cargo} />；{trip.remaining ? `还有 ${duration(trip.remaining)}` : '已到站，等待整车卸货'}。{trip.direction === 'outbound' && '到货前不计作可用原料。'}</> : '本线没有在途货物。'}</p>
    <p className="condition">{clock.overlap ? '当前与旧城重叠；仍需全部加工条件满足。' : `下次重叠还有 ${duration(clock.next)}；提前运到的材料可在启用排程后整批预留。`}</p>
  </article>;
}

function CalendarOrders({ state, send, disabled, openNetwork }: Props & { openNetwork: () => void }) {
  const [route, setRoute] = useState<RouteId>('rain'), [mode, setMode] = useState<ProductionMode>('normal'), [delay, setDelay] = useState<0 | 1 | 2>(0);
  const calendar = state.calendar, round = calendarClock(state).round, recipe = RECIPES[route][mode], limit = calendarQueueLimit(state);
  const draft: CalendarOrder = { uid: 'draft', route, mode, supply: recipe.supply, product: recipe.product, createdRound: round, earliestRound: round + delay, prepared: false };
  const preparation = calendarPrepareReason(state, draft);
  return <>
    <section className="panel calendar-orders" data-testid="calendar-orders" aria-label="历法排程">
      <div className="panel-title"><h2>为下一次重叠留一批供料</h2><span className="caption">已保存 {calendar.orders.length} / {limit} 项</span></div>
      <p className="small muted">只执行明确加入的单据，不续填、不替你切配方或发车。每秒只处理队首；错过窗口保留到下次，等待不扣费。</p>
      <div className="calendar-draft" aria-label="新排程草稿">
        <h3>新排程草稿</h3><div className="calendar-order-fields">
          <label>城市<select aria-label="历法加工城市" value={route} disabled={disabled} onChange={e => setRoute(e.target.value as RouteId)}>{ROUTE_IDS.map(id => <option key={id} value={id}>{ROUTES[id].name}</option>)}</select></label>
          <label>配方<select aria-label="历法加工配方" value={mode} disabled={disabled} onChange={e => setMode(e.target.value as ProductionMode)}>{MODES.map(id => <option key={id} value={id}>{modeName(id)} · {RECIPES[route][id].name}</option>)}</select></label>
          <label>最早轮次<select aria-label="历法最早轮次" value={delay} disabled={disabled} onChange={e => setDelay(Number(e.target.value) as 0 | 1 | 2)}><option value="0">本轮起</option><option value="1">下一轮起</option><option value="2">隔一轮起</option></select></label>
        </div>
        <p className="small">从第 {round + delay + 1} 轮起等待重叠。整批投入 <Materials value={recipe.supply} /> → 当地产出 <Materials value={recipe.product} />。</p>
        <p className="small">实际执行才支付 {CALENDAR_RULES.steps} 秒储备、1次校准余量和 <Materials value={CALENDAR_RULES.boostCost} />。</p>
        <p className="condition">{preparation ?? '当地原料与产物空间足够；启用后可尝试整批备料。'}</p>
        <button disabled={disabled || calendar.orders.length >= limit} onClick={() => send({ type: 'calendar-add', route, mode, delay })}>加入历法排程</button>
        <p className="footnote">加入时保存城市、配方和最早轮次；之后修改上面的草稿不影响已保存单据。缺料也可先安排。</p>
      </div>
      <div className="panel-title calendar-order-heading"><h3>已保存排程</h3><span className={`tag ${calendar.enabled ? 'working' : ''}`}>{calendar.enabled ? '排程已启用' : '排程已暂停'}</span></div>
      <div className="button-row"><button disabled={disabled || calendar.enabled} onClick={() => send({ type: 'calendar-toggle', enabled: true })}>启用历法排程</button><button disabled={disabled || !calendar.enabled} onClick={() => send({ type: 'calendar-toggle', enabled: false })}>暂停历法排程</button></div>
      {!calendar.orders.length && <p className="condition">没有已保存单据；启用也不会自动增加任务。</p>}
      {calendar.orders.map((order, index) => {
        const reason = calendarOrderReason(state, order), prepare = calendarPrepareReason(state, order);
        return <article className="calendar-order" data-testid={`cal-order-${order.uid}`} key={order.uid}>
          <h4>{index + 1}. {ROUTES[order.route].name} · {RECIPES[order.route][order.mode].name}</h4>
          <p className="small muted">{order.uid} · 创建于第 {order.createdRound + 1} 轮 · 最早第 {order.earliestRound + 1} 轮执行</p>
          <p className="small">已保存投入 <Materials value={order.supply} /> → 产物 <Materials value={order.product} />。</p>
          <p className="small">{order.prepared ? '整批已备料，原料和产物空间已保留。' : `尚未整批备料：${prepare ?? '等待本秒备料顺序'}。`}</p>
          <p className="condition">{index > 0 ? '等待前一项排程；' : ''}{reason ?? '全部条件已具备，下一秒按顺序加工'}。</p>
          <div className="button-row"><button disabled={disabled || index === 0} aria-label={`前移排程${order.uid}`} onClick={() => send({ type: 'calendar-move', uid: order.uid, direction: -1 })}>↑ 前移</button><button disabled={disabled || index === calendar.orders.length - 1} aria-label={`后移排程${order.uid}`} onClick={() => send({ type: 'calendar-move', uid: order.uid, direction: 1 })}>↓ 后移</button><button className="quiet danger" disabled={disabled} aria-label={`取消排程${order.uid}`} onClick={() => send({ type: 'calendar-cancel', uid: order.uid })}>取消排程</button></div>
        </article>;
      })}
      <p className="footnote">暂停保留已备料单的占用；取消立即释放占用，不改变当地库存与账本，也不取消任何列车。</p>
    </section>
    <section className="panel" aria-label="历法提前供货"><div className="panel-title"><h2>先让材料真正抵达</h2><button onClick={openNetwork}>前往夜网安排运输</button></div><p className="small muted">下列供料来自外城独立库存。历法不会暗中启用合同、增加缓冲或发运；旧城仓库里的材料不算已到货。</p>{ROUTE_IDS.map(id => <CalendarSupply key={id} state={state} route={id} draft={draft} />)}</section>
  </>;
}

function CalendarHistory({ state }: { state: GameState }) {
  const calendar = state.calendar;
  return <section className="panel" data-testid="calendar-history" aria-label="历法加工记录">
    <div className="panel-title"><h2>写进共同的交班</h2><span className="caption">最近 {CALENDAR_RULES.history} 项</span></div>
    <p className="small">累计储入 {calendar.captured} 秒；实际跨轮完成 {calendar.crossRound} 项。只有完成轮次晚于创建轮次，才记作跨轮。</p>
    {ROUTE_IDS.map(id => <p key={id} className="small">{ROUTES[id].name}累计历法加工：常规 {calendar.boosts[id].normal} 批 · 特产 {calendar.boosts[id].specialty} 批。</p>)}
    {!calendar.history.length && <p className="muted small">还没有实际完成的历法加工。排队与到货不会冒充完成。</p>}
    <ol className="calendar-history">{[...calendar.history].reverse().map(record => <li key={record.uid}><strong>{ROUTES[record.route].name} · {RECIPES[record.route][record.mode].name}</strong><p className="small">{record.uid} · 第 {record.createdRound + 1} 轮创建 → 第 {record.completedRound + 1} 轮完成{record.completedRound > record.createdRound ? ' · 跨轮完成' : ''}；游戏时间 {duration(record.second)}。</p></li>)}</ol>
    {CALENDAR_STORY_IDS.filter(id => state.experience.story[id]).map(id => <details className="archive-event" key={id}><summary>{id} · {STORY_NAMES[id]}<span className="small muted">已读</span></summary><p>{storyText(state, id)}</p></details>)}
  </section>;
}

export function CalendarPage({ state, send, disabled, project, openNetwork, openWork }: Props & { project: (id: DefinitionId) => ReactNode; openNetwork: () => void; openWork: () => void }) {
  if (!state.experience.story['L05-1']) return null;
  const open = calendarUnlocked(state), built = state.calendar.originSecond !== null;
  return <div className="stack calendar-page" data-testid="calendar-panel">
    <section className="panel calendar-intro"><span className="eyebrow">第五章 / 历法维修</span><h2>让今天有一个共同的名字</h2><p className="muted small">提前供货，保存一批原料，在三地日期重叠时完成额外加工。只推进指定外城的60个生产步；旧城、分所、列车与工务不会跳过时间。</p>{!built ? <p className="condition">先在旧城修复街区校时台；完工后手动阅读新来信，再安排储时与加工。</p> : !open ? <p className="condition">校时台已建成。请到“待处理”读完“把还没用上的一刻收好”，再启用储时与排程。</p> : <p className="small">储时和排程分别启停；重要来信仍留在“待处理”等你确认。</p>}</section>
    {built && <CalendarClocks state={state} />}
    {open && <><CalendarStorage state={state} send={send} disabled={disabled} /><CalendarOrders state={state} send={send} disabled={disabled} openNetwork={openNetwork} /></>}
    {built && <section className="panel" data-testid="calendar-service" aria-label="历法校准"><div className="panel-title"><h2>校准走失的刻度</h2><span className="caption">余量 {state.calendar.allowance} / {CALENDAR_RULES.initialAllowance} 次</span></div><p className="small">余量不超过3次时可安排校准；与旧城、分所工程共用唯一工务队列，用旧城材料和维修工。完工补3次，不填时间、不启用排程。</p><p className="small">已完成校准 {state.calendar.services} 次。校准不支持预制，暂停或取消沿用工务规则。</p><ProjectPayment state={state} send={send} disabled={disabled} id="calendar:service" ariaLabel="安排校准走失的刻度" buttonText="安排历法校准" /><button className="quiet" onClick={openWork}>查看全局工务队列</button></section>}
    <section className="stack" aria-label="历法工程"><h2>给日期留下锚点</h2>{CALENDAR_PROJECTS.filter(id => !state.completed.includes(id)).map(id => <div key={id}>{project(id)}</div>)}{CALENDAR_PROJECTS.some(id => state.completed.includes(id)) && <details className="completed-projects"><summary>已完成的历法工程（{CALENDAR_PROJECTS.filter(id => state.completed.includes(id)).length}）</summary>{CALENDAR_PROJECTS.filter(id => state.completed.includes(id)).map(id => <div key={id}>{project(id)}</div>)}</details>}</section>
    {built && <CalendarHistory state={state} />}
  </div>;
}

export function CalendarReturnReport({ report }: { report: ReturnReport }) {
  const calendar = report.calendar;
  if (!calendar) return null;
  return <section className="calendar-report" data-testid="calendar-report" aria-label="历法返回报告"><h3>历法 · 实际储入与加工</h3>
    <p className="small">本次储入 {calendar.captured} 秒，使用 {calendar.used} 秒；完成校准 {calendar.services} 次。当前储备 {calendar.stored} 秒，校准余量 {calendar.allowance} 次。</p>
    {ROUTE_IDS.map(id => <p className="small" key={id}>{ROUTES[id].name}额外加工：常规 {calendar.boosts[id].normal} 批、特产 {calendar.boosts[id].specialty} 批；当地产出 <Materials value={calendar.produced[id]} />。</p>)}
    <p className="small">仍在排 {calendar.queued} 项，其中整批已备料 {calendar.prepared} 项。产物在当地，是否运回仍以列车到货记录为准。</p>
    <p className="condition">{calendar.reasons.join('；') || '历法按已保存安排运行或等待新单'}。</p>
  </section>;
}
