import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import type { GameController, Snapshot } from '../app/controller';
import { BALANCE_VERSION, EVENTS, EVENT_IDS, FACILITIES, FACILITY_IDS, FLOWS, JOBS, jobNames, POLICIES, RESIDENTS, RESOURCES, residentNames, resourceNames, flowNames } from '../game/config';
import { completionName, definitionFor, duration, enqueueReason, format, freeResidents, jobCapacity, missingCost, populationCapacity, populationCount, projectReasons, refundPreview, view, workers } from '../game/engine';
import type { Action, Amounts, DefinitionId, GameState, Lighting, ReturnReport } from '../game/types';

type Page = 'operate' | 'work' | 'archive' | 'settings';
type Confirm = { kind: 'cancel'; uid: string } | { kind: 'reset' } | { kind: 'lighting'; lighting: Lighting } | null;
type Send = (action: Action) => void;

function Costs({ value, state, label = '费用' }: { value: Amounts; state?: GameState; label?: string }) {
  return <span className="costs" aria-label={label}>{RESOURCES.filter(r => value[r] > 0).map(r => <span key={r} className={state && state.resources[r] < value[r] ? 'short' : ''}>{format(value[r])} {resourceNames[r]}</span>)}{RESOURCES.every(r => value[r] === 0) && <span>无</span>}</span>;
}
function PanelTitle({ note, children }: { note?: ReactNode; children: ReactNode }) {
  return <div className="panel-title"><h2>{children}</h2>{note && <span className="caption">{note}</span>}</div>;
}
function ResourcePanel({ state }: { state: GameState }) {
  const current = view(state);
  return <section className="panel resources" aria-label="街区资源">
    <PanelTitle note="每秒净变化">夜间物资</PanelTitle>
    {RESOURCES.map((r, i) => <details className={`resource resource-${r}`} key={r}>
      <summary><span className="resource-label"><span className="resource-icon">{['↯', '◇', '◌'][i]}</span>{resourceNames[r]}</span>
        <strong data-testid={`${r}-stock`}>{format(state.resources[r])}<small> / {format(current.capacities[r], 0)}</small></strong>
        <span className={`rate ${current.net[r] < 0 ? 'negative' : ''}`}>{current.net[r] > 0 ? '+' : ''}{format(current.net[r])}/秒</span>
        <span className="meter"><span style={{ width: `${state.resources[r] / current.capacities[r] * 100}%` }} /></span>
      </summary>
      <div className="resource-detail"><p>本秒生产 {format(current.production[r])} · 消耗 {format(current.operating[r])} · 净变化 {format(current.net[r])}</p>
        <p>{r === 'energy' ? `发电 ${format(current.output.power)}；照明 ${current.lightOn ? format(POLICIES[state.lighting].upkeep) : '未供电'}；回收 ${format(current.costs.salvage.energy)}、维修 ${format(current.costs.repair.energy)}、记录 ${format(current.costs.record.energy)}。` : r === 'parts' ? `回收 ${format(current.output.salvage)}；记录员实际消耗 ${format(current.costs.record.parts)}/秒。` : `记录 ${format(current.output.record)}；故事奖励等待你领取。`}</p>
        <p>累计取得 {format(state.earned[r])}</p>
        {FLOWS.map(f => <p key={f}>{flowNames[f]}：{format(state.ledger[f][r])}</p>)}
      </div>
    </details>)}
  </section>;
}
function WorkerPanel({ state, send, disabled }: { state: GameState; send: Send; disabled: boolean }) {
  return <section className="panel workers" aria-label="岗位分配">
    <PanelTitle note={`${populationCount(state)} / ${populationCapacity(state)} 位`}>留下来的人</PanelTitle>
    <p className="muted small">{RESIDENTS.map(type => `${residentNames[type]}空闲 ${freeResidents(state, type)}`).join(' · ')}</p>
    <div className="worker-types"><span>影子 · 回收 +20%</span><span>回声 · 记忆 +20%</span></div>
    {JOBS.map(job => <div className="worker-job" key={job}>
      <div className="job-title"><h3>{jobNames[job]}</h3><span>{workers(state, job)} / {jobCapacity(state, job)} 人</span></div>
      <p className="small muted">{job === 'power' ? '发电 0.50/人/秒' : job === 'repair' ? '工程 1 点/人/秒 · 耗电 0.15' : job === 'salvage' ? '零件 0.20/人/秒 · 耗电 0.10' : '记忆 0.05/人/秒 · 电量 0.05 / 零件 0.03'}{job === 'repair' && !state.queue.length ? ' · 待命不耗电' : ''}</p>
      <div className="assignment-row">{RESIDENTS.map(resident => <div className="stepper" key={resident}>
        <span>{resident === 'shadow' ? '影子' : '回声'}</span>
        <button aria-label={`减少${residentNames[resident]}${jobNames[job]}`} disabled={disabled || !state.assignments[resident][job]} onClick={() => send({ type: 'assign', resident, job, delta: -1 })}>−</button>
        <output aria-label={`${residentNames[resident]}${jobNames[job]}人数`}>{state.assignments[resident][job]}</output>
        <button aria-label={`增加${residentNames[resident]}${jobNames[job]}`} disabled={disabled || freeResidents(state, resident) <= 0 || workers(state, job) >= jobCapacity(state, job)} onClick={() => send({ type: 'assign', resident, job, delta: 1 })}>+</button>
      </div>)}</div>
    </div>)}
    <p className="footnote">{!state.completed.includes('P01') ? '灯亮、宿舍建成后，每 120 秒迎来一名居民。' : populationCount(state) >= populationCapacity(state) ? '住处已满。升级宿舍，让更多人找到这里。' : `下一名住客约 ${120 - state.arrivalSeconds} 秒后到达。新住客先保持空闲。`}</p>
  </section>;
}
function ProjectCard({ id, state, send, disabled }: { id: DefinitionId; state: GameState; send: Send; disabled: boolean }) {
  const d = definitionFor(state, id), reason = enqueueReason(state, id), missing = missingCost(state, d.cost);
  return <article className="project-card" data-testid={`project-${id}`}>
    <span className="eyebrow">{id.startsWith('R') ? '研究方案' : `主线工程 / ${id}`}</span><h3>{d.name}</h3><p className="muted">{d.description}</p>
    <div className="project-facts"><Costs value={d.cost} state={state} /><span>{format(d.work, 0)} 点工程</span></div>
    <p className="condition">{reason ?? (missing.length ? `${missing.join('，')}；可先安排，材料足够后自动开工。` : '材料已够。分配维修工后，队首自动开工。')}</p>
    <button className="primary" disabled={disabled || !!reason} onClick={() => send({ type: 'enqueue', definition: id })} aria-label={`安排${d.name}`}>{state.completed.includes(id) ? '已经完成 ✓' : state.queue.some(p => p.definition === id) ? '已在队列' : '加入工务 →'}</button>
  </article>;
}
function Queue({ state, send, disabled, cancel }: { state: GameState; send: Send; disabled: boolean; cancel: (uid: string) => void }) {
  const current = view(state);
  return <section className="panel queue-panel" aria-label="工务队列">
    <PanelTitle note={`${state.queue.length} / 3 项 · 同时执行 1 项`}>工务队列</PanelTitle>
    {!state.queue.length && <div className="empty"><span className="empty-mark">∅</span><p>工作台上还没有新的维修单。</p><small>安排工程，分配维修工。费用会在实际开工时预留。</small></div>}
    {state.queue.map((p, i) => {
      const d = definitionFor(state, p.definition, p.targetLevel), reasons = i === 0 ? projectReasons(state, p) : ['等待前一项工程'];
      const progress = p.progress / d.work * 100;
      return <article className="queue-item" key={p.uid} data-testid={`queue-${p.definition}`}>
        <div className="queue-heading"><span className="queue-number">0{i + 1}</span><div><h3>{d.name}</h3><span className={`tag ${p.status === 'running' ? 'working' : ''}`}>{p.status === 'running' ? '施工中' : p.status === 'paused' ? '暂停' : '等待开工'}</span></div><strong>{progress.toFixed(1)}%</strong></div>
        <div className="meter large"><span style={{ width: `${progress}%` }} /></div>
        <p className="small muted">{format(p.progress)} / {format(d.work, 0)} 点 · {i === 0 && !reasons.length && current.output.repair > 0 ? `按当前供给约 ${duration((d.work - p.progress) / current.output.repair)}` : '等待条件满足'}</p>
        <p className="small">{p.status === 'waiting' ? '开工时预留：' : '已预留：'}<Costs value={p.status === 'waiting' ? d.cost : p.reserved} state={p.status === 'waiting' ? state : undefined} /></p>
        <p className="condition" data-testid={`queue-reason-${p.definition}`}>{[...reasons, ...(i === 0 && p.status === 'running' && !current.output.repair && workers(state, 'repair') ? ['维修工等待电量'] : [])].join('；') || '按现有安排自动推进'}</p>
        <div className="queue-actions">
          {p.status === 'running' && <button disabled={disabled} onClick={() => send({ type: 'pause', uid: p.uid })}>暂停</button>}
          {p.status === 'paused' && <button disabled={disabled} onClick={() => send({ type: 'resume', uid: p.uid })}>继续</button>}
          {p.status === 'waiting' && <><button aria-label={`前移${d.name}`} disabled={disabled || i === 0 || state.queue[i - 1]?.status !== 'waiting'} onClick={() => send({ type: 'move', uid: p.uid, direction: -1 })}>↑ 前移</button><button aria-label={`后移${d.name}`} disabled={disabled || i === state.queue.length - 1 || state.queue[i + 1]?.status !== 'waiting'} onClick={() => send({ type: 'move', uid: p.uid, direction: 1 })}>↓ 后移</button></>}
          <button className="quiet danger" disabled={disabled} onClick={() => cancel(p.uid)}>取消项目</button>
        </div>
      </article>;
    })}
  </section>;
}
function Facilities({ state, send, disabled }: { state: GameState; send: Send; disabled: boolean }) {
  return <section aria-label="街区设施"><PanelTitle note="每种最高 3级">灯光照到的地方</PanelTitle><div className="facility-grid">{FACILITY_IDS.map(id => {
    const f = FACILITIES[id], level = state.facilities[id], def = `build:${id}` as const;
    const reason = enqueueReason(state, def), d = definitionFor(state, def);
    return <article className={`facility-card ${level ? '' : 'unbuilt'}`} key={id}>
      <div className="facility-heading"><span className="facility-mark">{f.mark}</span><span className="tag">{level ? `${level}级 · 使用中` : '尚未建设'}</span></div>
      <h3>{f.name}</h3><p className="muted">{f.description}</p>
      {['generator', 'recycler', 'workbench', 'mailbox'].includes(id) && level > 0 && <p className="small">岗位 {level + 1} 人 · 效率 +{Math.round((level - 1) * 15)}%</p>}
      {level < 3 && <><div className="project-facts"><Costs value={d.cost} state={state} /><span>{format(d.work, 0)} 点</span></div><p className="condition">{reason ?? (missingCost(state, d.cost).join('，') || '可安排，队首满足费用后自动开工')}</p></>}
      <button disabled={disabled || !!reason} aria-label={`安排${f.name}${level ? '升级' : '建设'}`} onClick={() => send({ type: 'enqueue', definition: def })}>{level >= 3 ? '已达最高等级' : state.queue.some(p => p.definition === def) ? '已在队列' : level ? `安排升级至 ${level + 1}级` : '安排建设'}</button>
    </article>;
  })}</div></section>;
}
function Policies({ state, send, disabled, confirm }: { state: GameState; send: Send; disabled: boolean; confirm: (lighting: Lighting) => void }) {
  const current = view(state);
  return <section className="panel" aria-label="照明与优先级"><PanelTitle note={current.lightOn ? '照明供电正常' : '照明加成暂时失效'}>夜间安排</PanelTitle>
    <div className="policy-grid">{(Object.keys(POLICIES) as Lighting[]).map(id => <button key={id} className={`policy ${state.lighting === id ? 'selected' : ''}`} aria-pressed={state.lighting === id} aria-label={`切换${POLICIES[id].name}`} disabled={disabled || !state.lightingChosen || state.lighting === id} onClick={() => confirm(id)}>
      <strong>{POLICIES[id].name} {state.lighting === id ? '· 当前' : ''}</strong><span>{POLICIES[id].text}</span>
    </button>)}</div>
    <p className="footnote">{state.lightingChosen ? '此后每次切换消耗 5 零件，确认前可查看。' : '第一名回声居民入住后，通过“有人来住”事件免费选择。'}</p>
    <div className="priority-title"><h3>供给优先级</h3><span className="muted small">发电 → 照明 → 下列工作</span></div>
    <div className="priority-list">{state.priority.map((job, i) => <div key={job}><span><b>{i + 1}</b>{jobNames[job]}</span><button aria-label={`提高${jobNames[job]}优先级`} disabled={disabled || i === 0} onClick={() => {
      const order = [...state.priority]; [order[i], order[i - 1]] = [order[i - 1], order[i]]; send({ type: 'priority', order });
    }}>↑ 提前</button></div>)}</div><p className="footnote">满仓或缺料会同比减少产出与投入。待命的维修工不消耗电量。</p>
  </section>;
}
function EventInbox({ state, send, disabled }: { state: GameState; send: Send; disabled: boolean }) {
  const pending = EVENT_IDS.filter(id => state.events[id]?.status === 'pending');
  return <section className="panel inbox" aria-label="待处理事件"><PanelTitle note={pending.length ? `${pending.length} 份未处理` : '暂无来信'}>交接事项</PanelTitle>
    {!pending.length && <p className="muted small">重要的信与决定会在这里等你。夜工继续按现有安排工作。</p>}
    {pending.map(id => <article className="event" key={id} data-testid={`event-${id}`}><span className="eyebrow">{id} / 待你处理</span><h3>{EVENTS[id].name}</h3><p>{EVENTS[id].text}</p>
      {id === 'E03' ? <><p className="small muted">第一次选择免费。明灯：记忆 +25%；暗灯：回收 +25%，记忆 −10%。维护均为 0.10 电量/秒。</p><div className="event-options"><button disabled={disabled} onClick={() => send({ type: 'event', event: id, choice: 'bright' })}>选择明灯</button><button disabled={disabled} onClick={() => send({ type: 'event', event: id, choice: 'dim' })}>选择暗灯</button></div></> : <>
        {EVENTS[id].reward.memory > 0 && <p className="small">奖励 <Costs value={EVENTS[id].reward} /> · 记忆空间 {format(view(state).capacities.memory - state.resources.memory)}</p>}
        <button disabled={disabled || state.resources.memory + EVENTS[id].reward.memory > view(state).capacities.memory} onClick={() => send({ type: 'event', event: id })}>{EVENTS[id].reward.memory ? '领取并归档' : '读完并归档'}</button>
        {state.resources.memory + EVENTS[id].reward.memory > view(state).capacities.memory && <p className="short small">记忆容量不足，奖励留在这里等你。</p>}
      </>}
    </article>)}
  </section>;
}
function Report({ report, close, disabled }: { report: ReturnReport; close: () => void; disabled: boolean }) {
  return <section className="panel return-report" aria-label="返回报告">
    <div className="panel-title"><div><span className="eyebrow">夜班交接 / 返回报告</span><h2>你离开时，街区仍在工作。</h2></div><button disabled={disabled} onClick={close}>收好报告</button></div>
    <p className="muted">离开 {duration(report.awayMs / 1000)}，实际结算 {duration(report.seconds)}。{report.completed.length ? `完成：${report.completed.map(completionName).join('、')}。` : '本次没有工程完工。'}新增影子 {report.arrivals.shadow} 位、回声 {report.arrivals.echo} 位。</p>
    <div className="report-resources">{RESOURCES.map(r => <div key={r}><h3>{resourceNames[r]}</h3><p>{format(report.start[r])} → <strong>{format(report.end[r])}</strong></p>{FLOWS.map(f => <p className="small" key={f}><span>{flowNames[f]}</span><span>{format(report.flows[f][r])}</span></p>)}</div>)}</div>
    <p className="small">{report.pending.length ? `等待你处理：${report.pending.map(id => EVENTS[id].name).join('、')}。` : '没有待处理选择。'}{report.events.length > 0 && ` 新事项：${report.events.map(id => EVENTS[id].name).join('、')}。`}</p>
    <p className="condition">当前等待：{report.reasons.join('；') || '按安排继续生产'}。</p><p>下一步：{report.goal}</p>
  </section>;
}
function Archive({ state, send, disabled }: { state: GameState; send: Send; disabled: boolean }) {
  return <div className="stack"><section className="panel address-card"><span className="eyebrow">地点名录 / 第一章</span><h2>{state.address ? '第0街区 · 0-001' : '第0街区 · 尚未登记'}</h2><p>{state.address ? '这里已经是一个有效的存在。雨城的工务请求保留在来信中；当前街区仍可继续建设。' : '只要有人开始生活、使用和记住它，空白也能成为第一个地址。'}</p></section>
    <section><PanelTitle note="明天的信带来的方法">研究档案</PanelTitle><div className="facility-grid">{(['R01', 'R02'] as const).map(id => <ProjectCard key={id} id={id} state={state} send={send} disabled={disabled} />)}</div></section>
    <section className="panel"><PanelTitle>居民名录</PanelTitle>{RESIDENTS.map(type => <p key={type}><strong>{residentNames[type]} · {state.population[type]} 位</strong><br /><span className="muted">{type === 'shadow' ? '习惯收集无人认领的旧设备。回收产出提升 20%。' : '能够整理留在旧物里的声音。记忆产出提升 20%。'}</span></p>)}</section>
    <section className="panel"><PanelTitle note={`${EVENT_IDS.filter(id => state.events[id]?.status === 'claimed').length} / 5 份`}>交接档案</PanelTitle>{EVENT_IDS.map(id => <details className="archive-event" key={id}><summary>{state.events[id] ? EVENTS[id].name : '尚未抵达的交接事项'} <span className="muted small">{state.events[id]?.status === 'claimed' ? '已归档' : state.events[id] ? '待处理' : '未发现'}</span></summary>{state.events[id] && <p>{EVENTS[id].text}{state.events[id]?.choice && ` 当时选择：${POLICIES[state.events[id]!.choice!].name}。`}</p>}</details>)}</section>
    <section className="panel"><PanelTitle>完工记录</PanelTitle>{state.completed.length ? state.completed.map(key => <p key={key} className="small">✓ {completionName(key)}</p>) : <p className="muted">第一张维修单还在等待。</p>}</section>
  </div>;
}
function Settings({ controller, snapshot, reset }: { controller: GameController; snapshot: Snapshot; reset: () => void }) {
  const [text, setText] = useState(''), [preview, setPreview] = useState<GameState | null>(null), [error, setError] = useState<string | null>(null), [fileName, setFileName] = useState('');
  const disabled = !snapshot.owner || snapshot.busy !== null;
  const exportSave = () => {
    try {
      const blob = new Blob([controller.exportText()], { type: 'application/json' }), url = URL.createObjectURL(blob);
      const link = document.createElement('a'); link.href = url; link.download = 'DistrictZero-存档.json'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { setError(e instanceof Error ? e.message : '导出失败'); }
  };
  return <div className="stack"><section className="panel"><PanelTitle>保存与恢复</PanelTitle><p role="status">{snapshot.saveStatus}</p><p className="muted small">每 10 秒自动保存，关键操作立即保存。恢复副本保留最近一次有效进度；导入前保留替换前的进度。</p><div className="button-row"><button disabled={disabled} onClick={() => void controller.saveNow()}>立即保存</button><button onClick={exportSave}>导出存档</button><button disabled={disabled} onClick={() => void controller.restore()}>读取恢复副本</button></div><p className="footnote">存档只保存在当前浏览器、当前地址中。换浏览器、端口或设备前，请先导出。</p></section>
    <section className="panel"><PanelTitle>导入交接记录</PanelTitle><p className="muted small">选择 JSON 文件或粘贴存档。检查后会显示摘要，再确认替换当前进度。</p>
      <label className={`file-label ${disabled ? 'disabled' : ''}`}><span className="file-button">选择存档文件</span><span className="file-name">{fileName || '尚未选择文件'}</span><input aria-label="选择存档文件" type="file" accept=".json,application/json" disabled={disabled} onChange={async e => { const file = e.target.files?.[0]; if (file) { setFileName(file.name); if (file.size > 2_000_000) { setError('文件超过 2 MB'); return; } setText(await file.text()); setPreview(null); setError(null); } }} /></label>
      <label htmlFor="save-text" className="small muted">存档文本</label><textarea id="save-text" value={text} disabled={disabled} onChange={e => { setText(e.target.value); setPreview(null); setError(null); }} placeholder="在这里粘贴第0街区的 JSON 存档" />
      {error && <p className="short" role="alert">{error}</p>}
      <button disabled={disabled || !text} onClick={() => { try { setPreview(controller.previewImport(text).state); setError(null); } catch (e) { setPreview(null); setError(e instanceof Error ? e.message : '无法读取存档'); } }}>检查存档</button>
      {preview && <div className="import-preview"><h3>检查通过 · 等待确认</h3><p>将以 {duration(preview.clock.seconds)} 的进度、{populationCount(preview)} 位居民、{preview.address ?? '未登记地址'} 替换当前 {duration(snapshot.state.clock.seconds)} 的进度。</p><p className="small">现有进度先保留为恢复副本，导入档按其最近结算时间补算。</p><button className="primary" disabled={disabled} onClick={() => { void controller.importText(text); setPreview(null); setText(''); }}>确认导入并替换</button></div>}
    </section>
    <section className="panel"><PanelTitle>显示与关于</PanelTitle><div className="button-row"><button disabled={disabled} aria-pressed={snapshot.state.theme === 'dark'} onClick={() => void controller.dispatch({ type: 'theme', theme: 'dark' })}>夜色主题</button><button disabled={disabled} aria-pressed={snapshot.state.theme === 'light'} onClick={() => void controller.dispatch({ type: 'theme', theme: 'light' })}>纸色主题</button></div><p className="small muted">DistrictZero V0.1 · 数值版本 {BALANCE_VERSION} · 存档结构版本 1</p><p className="muted">从0开始，让一座城有地方可去。</p><button className="danger" disabled={disabled} onClick={reset}>重置本地进度</button></section>
  </div>;
}
function Dialog({ title, children, close }: { title: string; children: ReactNode; close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} aria-label={title} onCancel={close}><h2>{title}</h2>{children}<button className="quiet" onClick={close}>返回</button></dialog>;
}
export function App({ controller }: { controller: GameController }) {
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot), state = snapshot.state;
  const [page, setPage] = useState<Page>('operate'), [confirmation, setConfirmation] = useState<Confirm>(null);
  const disabled = !snapshot.owner || snapshot.busy !== null, current = view(state);
  const send: Send = action => { void controller.dispatch(action); };
  const nextMain = (['P01', 'P02', 'P03'] as const).find(id => !state.completed.includes(id));
  useEffect(() => { document.documentElement.dataset.theme = state.theme; }, [state.theme]);
  const canceled = confirmation?.kind === 'cancel' ? state.queue.find(p => p.uid === confirmation.uid) : undefined;
  const refund = canceled ? refundPreview(state, canceled) : null;
  return <div className="app-shell">
    <header className="masthead"><a className="brand" href="#" onClick={e => { e.preventDefault(); setPage('operate'); }} aria-label="第0街区首页"><span className="brand-zero">0<span /></span><span><strong>第0街区</strong><small>DISTRICTZERO · 夜间工务处</small></span></a>
      <div className="header-right"><span className="night"><i /> 第 {Math.floor(state.clock.seconds / 600) + 1} 夜 · {state.address ?? '尚未登记'}</span><span className={`save-status ${snapshot.saveStatus.startsWith('保存失败') ? 'short' : ''}`} data-testid="save-status">{snapshot.saveStatus}</span></div>
    </header>
    {!snapshot.owner && <div className="notice" role="status">{snapshot.session === 'unsupported' ? snapshot.message : '另一页面正在运行，或正在取得会话。此页暂不推进、不写入；关闭主页面后会自动接管。'}</div>}
    {snapshot.busy !== null && <div className="notice" role="status">正在整理离开期间的交接记录… {snapshot.busy}%</div>}
    {snapshot.message && snapshot.session !== 'unsupported' && <div className="notice" role="alert"><span>{snapshot.message}</span><button className="quiet" onClick={() => controller.clearMessage()}>知道了</button></div>}
    {state.report && <Report report={state.report} disabled={disabled} close={() => send({ type: 'dismiss-report' })} />}
    <div className="district-layout"><aside className="left-column"><ResourcePanel state={state} /><WorkerPanel state={state} send={send} disabled={disabled} /></aside>
      <main className="main-column"><section className="goal-card"><div className="goal-top"><span className="eyebrow">工务交接单 · 第0街区</span><span className="caption">第一章 / 未登记的开始</span></div><h1>{current.goal}</h1><p>{state.address ? '这里是第一站。未来已经有了投递地址。' : !state.completed.includes('P01') ? '两名夜工，一盏临时路灯。先积累 15 零件，再让一位夜工转去维修。' : '灯光、住处与被记住的声音，正在把空白变成一个地方。'}</p><div className="goal-bottom"><span className="small">{state.completed.filter(id => ['P01', 'P02', 'P03'].includes(id)).length} / 3 项主线完成</span><button className="quiet" onClick={() => setPage('work')}>查看维修单 ↗</button></div><div className="street-line" aria-hidden="true"><span /><span /><span /><span /><span /></div></section>
        <nav className="tabs" aria-label="主要页面">{([['operate', '经营'], ['work', '工务'], ['archive', '档案'], ['settings', '设置']] as const).map(([id, label]) => <button key={id} aria-label={label} aria-current={page === id ? 'page' : undefined} className={page === id ? 'active' : ''} onClick={() => setPage(id)}>{label}{id === 'work' && state.queue.length > 0 && <small aria-hidden="true">{state.queue.length}</small>}</button>)}</nav>
        <div className="page-content">{page === 'operate' && <div className="stack">{nextMain && !enqueueReason(state, nextMain) && <ProjectCard id={nextMain} state={state} send={send} disabled={disabled} />}<Facilities state={state} send={send} disabled={disabled} /><Policies state={state} send={send} disabled={disabled} confirm={lighting => setConfirmation({ kind: 'lighting', lighting })} /></div>}
          {page === 'work' && <div className="stack"><Queue state={state} send={send} disabled={disabled} cancel={uid => setConfirmation({ kind: 'cancel', uid })} /><section><PanelTitle note="费用在实际开工时预留">主线维修单</PanelTitle><div className="stack">{(['P01', 'P02', 'P03'] as const).map(id => <ProjectCard key={id} id={id} state={state} send={send} disabled={disabled} />)}</div></section></div>}
          {page === 'archive' && <Archive state={state} send={send} disabled={disabled} />}
          {page === 'settings' && <Settings controller={controller} snapshot={snapshot} reset={() => setConfirmation({ kind: 'reset' })} />}
        </div>
      </main>
      <aside className="right-column"><EventInbox state={state} send={send} disabled={disabled} /><section className="panel status-panel"><PanelTitle note="按当前安排">值班提示</PanelTitle>{current.reasons.map(reason => <p className="small" key={reason}><span className="status-dot" />{reason}</p>)}<p className="footnote">不必一直守着页面。工程与生产继续，重要决定等你回来。</p></section><section className="panel history"><PanelTitle>夜间记录</PanelTitle><ol>{state.history.slice(-8).reverse().map((item, i) => <li key={`${item.second}-${i}`}><time>第 {Math.floor(item.second / 600) + 1} 夜 · {duration(item.second % 600)}</time><p>{item.text}</p></li>)}</ol></section></aside>
    </div>
    <footer><span>DistrictZero</span><span>未被登记，不妨碍开始。</span><span>第0街区 · 夜间工务处</span></footer>
    {confirmation && <Dialog title={confirmation.kind === 'reset' ? '重置第0街区进度' : confirmation.kind === 'lighting' ? '调整夜间照明' : '取消这张维修单'} close={() => setConfirmation(null)}>
      {confirmation.kind === 'cancel' && <>{canceled && refund ? <><p>{definitionFor(state, canceled.definition, canceled.targetLevel).name}的工程进度将丢失。运行中已经消耗的电量不返还。</p><p>按当前剩余工程可返还：<Costs value={refund.full} /></p><p>实际入库：<Costs value={refund.actual} /></p><p className="short">容量溢出、无法返还：<Costs value={refund.overflow} /></p><div className="button-row"><button className="danger" disabled={disabled} onClick={() => { send({ type: 'cancel', uid: canceled.uid }); setConfirmation(null); }}>确认取消</button>{canceled.status === 'running' && <button onClick={() => { send({ type: 'pause', uid: canceled.uid }); setConfirmation(null); }}>保留项目并暂停</button>}</div></> : <p>项目已经完工或不在队列中。</p>}</>}
      {confirmation.kind === 'lighting' && <><p>{POLICIES[confirmation.lighting].name}：{POLICIES[confirmation.lighting].text}</p><p>本次切换消耗 5 零件。当前有 {format(state.resources.parts)} 零件。</p><button className="primary" disabled={disabled || state.resources.parts < 5000} onClick={() => { send({ type: 'lighting', lighting: confirmation.lighting }); setConfirmation(null); }}>确认切换</button></>}
      {confirmation.kind === 'reset' && <><p>将清空当前浏览器、当前地址下第0街区的主存档与恢复副本，并从两名夜工重新开始。此操作不会清除其他站点数据。</p><p className="muted">需要保留这个街区，请先在设置中导出存档。</p><button className="danger" disabled={disabled} onClick={() => { void controller.reset(); setConfirmation(null); }}>确认重置这两个存档</button></>}
    </Dialog>}
  </div>;
}
