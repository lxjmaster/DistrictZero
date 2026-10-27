import { useEffect, useRef, useState } from 'react';
import { amounts, FACILITIES, FACILITY_IDS, JOBS, jobNames, POLICIES, RESIDENTS, RESOURCES, residentNames, resourceNames, RULES, UNIT } from '../game/config';
import { activeDistricts, DISTRICTS } from '../game/city';
import { completionName, duration, format, freeResidents } from '../game/engine';
import { ASSEMBLY, MOD_IDS, STORY_IDS, STORY_NAMES, storyText } from '../game/experience';
import { ARCHIVES, ARCHIVE_IDS, archiveUnlocked, VEHICLE_MODS } from '../game/journey';
import { MAIL_MODS } from '../game/neighborhood';
import { OUTPOST_IDS, OUTPOST_INITIAL, OUTPOST_PROJECTS, OUTPOSTS, SUPPORT_KINDS, SUPPORT_PACKAGES, SUPPORT_RULES, outpostAssemblyRecipe, outpostCapacities, outpostDefinition, outpostEnqueueReason, outpostFree, outpostJobCapacity, outpostMaxLevel, outpostPopulation, outpostPrefabLimit, outpostReservedSpace, outpostSealReason, outpostView, outpostWorkers, supportReason } from '../game/outposts';
import type { Action, Amounts, DefinitionId, Facility, GameState, Lighting, Modification, OutpostId, OutpostProject, OutpostProof, ReturnReport, SupportKind } from '../game/types';
import { MaterialCost, parseUnits, ProjectPayment } from './Experience';
import './outposts.css';

type Props = { state: GameState; send: (action: Action) => void; disabled: boolean };
type SiteProps = Props & { id: OutpostId };
const LOCAL_RESOURCES = ['energy', 'parts', 'memory', 'component'] as const;
const proofName = (proof: OutpostProof) => proof === 'local' ? '本地值守' : '旧城接力';
const amountText = (value: Amounts) => RESOURCES.filter(r => value[r]).map(r => `${format(value[r], 3)}${resourceNames[r]}`).join('、') || '无';
const reserveDraft = (value: Amounts) => Object.fromEntries(RESOURCES.map(r => [r, String(value[r] / UNIT)]));
function crewSources(state: GameState) {
  return activeDistricts(state).flatMap(district => RESIDENTS.map(resident => ({ district, resident, key: `${district}/${resident}`, free: freeResidents(state, resident, district) })));
}

export function OutpostsPage({ state, send, disabled }: Props) {
  const [selected, setSelected] = useState<OutpostId>(state.outposts.active ?? 'O01');
  useEffect(() => { if (state.outposts.active) setSelected(state.outposts.active); }, [state.outposts.active]);
  const id = selected, site = state.outposts.sites[id], active = state.outposts.active === id;
  const current = site ? outpostView(state, id) : null;
  return <div className="stack outposts-page" id="outposts" data-testid="outposts-page">
    <section className="panel">
      <div className="panel-title"><div><span className="eyebrow">未发生之城 / 分所</span><h2>带着办法，去另一面开门</h2></div><span className="tag">同时经营一处</span></div>
      <p>旧城继续按现有安排生产、运货和维护。派驻者仍占原来的住处；带走知识，不复制库存或已制工具。</p>
      <p className="footnote">切换地图或返回旧城只改变查看页面，不暂停经营。全局仍只有一条工务队列，暂停的队首会阻塞两边施工及自动维护。</p>
      {!state.completed.includes('P12') && <div className="outpost-registration"><h3>先设立分所登记台</h3><ProjectPayment state={state} send={send} disabled={disabled} id="P12" ariaLabel="安排设立分所登记台" buttonText="加入旧城工务" /></div>}
    </section>
    <div className="outpost-map-grid" role="group" aria-label="分所地图">
      {OUTPOST_IDS.map(map => <button key={map} className="outpost-map-card" aria-pressed={selected === map} onClick={() => setSelected(map)} aria-label={`查看${OUTPOSTS[map].name}`}>
        <span className="eyebrow">{map}</span><strong>{OUTPOSTS[map].name}</strong><span>{OUTPOSTS[map].description}</span>
        <small>{state.outposts.active === map ? '正在经营' : state.outposts.sites[map] ? '已封存 · 成果保留' : '尚未启用'}{state.outposts.sites[map]?.completed.includes(`${map}-3`) ? ` · ${OUTPOSTS[map].address}` : ''}{state.outposts.sites[map]?.handoff ? ' · 已交接' : ''}</small>
      </button>)}
    </div>
    <section className="panel" aria-label={`${OUTPOSTS[id].name}规则`}>
      <div className="panel-title"><h2>{OUTPOSTS[id].name}</h2><span className="tag">{active ? '活动分所' : site ? '封存地图' : '待派驻'}</span></div>
      <p>{OUTPOSTS[id].description}</p>
      <p className="small">本地发电产出为普通配方的{OUTPOSTS[id].power * 100}%。{outpostMaxLevel(id, 'warehouse') ? '可建1级仓库；基础工位可升至3级。' : '不能建仓库；工作暂存容量固定，基础工位可升至3级。'}宿舍最多1级，不会自动迎来新居民。</p>
      <p className="small">初始暂存：{LOCAL_RESOURCES.map(r => `${resourceNames[r]}${format(OUTPOSTS[id].capacity[r], 0)}`).join(' / ')}。胶片、轨芯与旧城业务留在旧城。</p>
      {site && <OutpostScene state={state} id={id} lightOn={current!.lightOn} />}
      {!active && <Deployment key={id} state={state} send={send} disabled={disabled} id={id} />}
    </section>
    {site && <>
      <section className="panel" aria-label={`${OUTPOSTS[id].name}独立库存`} data-testid={`outpost-stock-${id}`}>
        <div className="panel-title"><h2>{OUTPOSTS[id].name} · 本地库存</h2><span className="caption">与旧城分开记账</span></div>
        <div className="outpost-stocks">{LOCAL_RESOURCES.map(resource => {
          const capacity = outpostCapacities(state, id)[resource], reserved = outpostReservedSpace(state, id)[resource];
          return <details key={resource} className="outpost-stock"><summary><span>{resourceNames[resource]}</span><strong data-testid={`outpost-${id}-${resource}`}>{format(site.resources[resource], 3)} / {format(capacity, 0)}</strong><small>{active ? `${current!.net[resource] >= 0 ? '+' : ''}${format(current!.net[resource], 3)}/秒` : '封存 · 不生产、不耗电'}</small></summary>
            <p className="small">本秒实际生产 {format(current!.production[resource], 3)}，运行消耗 {format(current!.operating[resource], 3)}。</p><p className="small">在途另预留 {format(reserved, 3)}；当前可用空位 {format(Math.max(0, capacity - reserved - site.resources[resource]), 3)}。预留不是已收到物资。</p>
          </details>;
        })}</div>
        {!!current!.reasons.length && <p className="condition" role="status">{current!.reasons.join('；')}。</p>}
      </section>
      {active && <>
        <OutpostWorkers state={state} send={send} disabled={disabled} id={id} />
        <section className="panel" aria-label={`${OUTPOSTS[id].name}工程`}><div className="panel-title"><h2>在这里留下一个地址</h2><span className="caption">使用本地物资和维修工</span></div>
          <div className="stack">{([1, 2, 3] as const).map(step => {
            const definition = `${id}-${step}` as OutpostProject, config = OUTPOST_PROJECTS[definition];
            return <article className="outpost-project" key={definition} data-testid={`outpost-project-${definition}`}><span className="eyebrow">{definition}</span><h3>{config.name}</h3><p className="small muted">{config.description}</p>
              {site.completed.includes(definition) ? <p className="condition">本图已经完成 ✓</p> : <OutpostPayment state={state} send={send} disabled={disabled} id={id} definition={definition} />}
            </article>;
          })}</div>
          <p className="footnote">入队不扣材料，实际开工才在本图预留。查看主页面的全局工务，可逐项重排、暂停或取消；暂停不会让路。</p>
        </section>
        <LocalAssembly key={`assembly-${id}`} state={state} send={send} disabled={disabled} id={id} />
        <LocalFacilities state={state} send={send} disabled={disabled} id={id} />
        <LocalPolicies state={state} send={send} disabled={disabled} id={id} lightOn={current!.lightOn} />
      </>}
      <SiteHistory state={state} id={id} />
    </>}
    {state.completed.includes('P12') && <SupportPanel state={state} send={send} disabled={disabled} />}
    <SharedKnowledge state={state} />
    {active && <SealPanel key={`seal-${id}`} state={state} send={send} disabled={disabled} id={id} />}
  </div>;
}

function Deployment({ state, send, disabled, id }: SiteProps) {
  const sources = crewSources(state), [selected, setSelected] = useState(['', '']);
  const crew = selected.map(key => sources.find(source => source.key === key));
  const ready = crew.every(person => person !== undefined) && sources.every(source => selected.filter(key => key === source.key).length <= source.free);
  const other = state.outposts.active, previous = state.outposts.sites[id];
  const unlocked = state.completed.includes('P12') && Boolean(state.experience.story['L04-2']);
  return <div className="outpost-deployment" id="outpost-workers" tabIndex={-1} aria-label={`${OUTPOSTS[id].name}派驻预览`}>
    <h3>{previous ? '重新入驻，不重新领取物资' : '选择两名来自旧城的空闲居民'}</h3>
    {other ? <p className="condition">请先封存{OUTPOSTS[other].name}。查看这张地图不会切换活动分所。</p> : <>
      <div className="outpost-fields">{selected.map((value, index) => <label key={index}>第{index + 1}位派驻者<select value={value} aria-label={`${OUTPOSTS[id].name}第${index + 1}位派驻者`} disabled={disabled || !unlocked} onChange={event => setSelected(current => current.map((key, i) => i === index ? event.target.value : key))}><option value="">请选择来源与类型</option>{sources.map(source => <option value={source.key} key={source.key}>{DISTRICTS[source.district].name} · {residentNames[source.resident]} · 空闲{source.free}</option>)}</select></label>)}</div>
      <ul className="outpost-preview">{sources.map(source => { const count = selected.filter(key => key === source.key).length; return <li key={source.key}>{DISTRICTS[source.district].name} · {residentNames[source.resident]}：现空闲{source.free}，选择{count}，派出后空闲{source.free - count}{source.free < count ? '（不足）' : ''}</li>; })}</ul>
      <p className="small">原住处和床位保留，不新增居民；本地岗位从0开始。{previous ? '图内库存、设施与成果恢复，初始包不再转入，装配和支援暂停。' : <>首次从旧城转入 <MaterialCost value={OUTPOST_INITIAL} />；不转入已制工具。</>}</p>
      <p className="small">当前旧城保留量：{RESOURCES.map(r => `${resourceNames[r]} ${format(state.outposts.support.reserve[r], 3)}`).join(' / ')}。可在下方支援面板修改，开所也遵守该保留量。</p>
      {!previous && <p className="small">转入后旧城库存预览：{RESOURCES.map(r => `${resourceNames[r]} ${format(state.resources[r] - OUTPOST_INITIAL[r], 3)}`).join(' / ')}；负数或低于保留量时不会开所，也不会部分扣除。</p>}
      <button disabled={disabled || !unlocked || !ready} onClick={() => { if (ready) send({ type: 'outpost-open', outpost: id, crew: crew.map(person => ({ district: person!.district, resident: person!.resident })) }); }}>{previous ? `重新入驻${OUTPOSTS[id].name}` : `确认开设${OUTPOSTS[id].name}`}</button>
      {!unlocked && <p className="condition">先完成分所登记台，再读完“带走的是办法”。</p>}
      {unlocked && !ready && <p className="condition">请明确选择两人；同一来源和类型的选择不能超过旧城空闲人数。</p>}
    </>}
  </div>;
}

function OutpostWorkers({ state, send, disabled, id }: SiteProps) {
  const site = state.outposts.sites[id]!, sources = crewSources(state), [sourceKey, setSourceKey] = useState('');
  const source = sources.find(item => item.key === sourceKey), capacity = 2 + site.facilities.dorm * 2;
  return <section className="panel" id="outpost-workers" tabIndex={-1} aria-label={`${OUTPOSTS[id].name}人手`}>
    <div className="panel-title"><h2>{OUTPOSTS[id].name} · 当地人手</h2><span className="caption">派驻 {outpostPopulation(state, id)} / {capacity}</span></div>
    <p className="small">{RESIDENTS.map(resident => `${residentNames[resident]}${outpostPopulation(state, id, resident)}人，空闲${outpostFree(state, id, resident)}人`).join('；')}。不会自动入住或套用旧城岗位。</p>
    {JOBS.map(job => {
      const used = outpostWorkers(state, id, job) + (job === 'repair' ? outpostWorkers(state, id, 'assemble') : job === 'assemble' ? outpostWorkers(state, id, 'repair') : 0);
      return <div className="worker-job" key={job}><div className="job-title"><h3>{jobNames[job]}</h3><span>{used} / {outpostJobCapacity(state, id, job)} {job === 'repair' || job === 'assemble' ? '共享工位' : '岗位'}</span></div><div className="assignment-row">{RESIDENTS.map(resident => <div className="stepper" key={resident}><span>{resident === 'shadow' ? '影子' : '回声'}</span><button aria-label={`${OUTPOSTS[id].name}减少${residentNames[resident]}${jobNames[job]}`} disabled={disabled || !site.assignments[resident][job]} onClick={() => send({ type: 'outpost-assign', resident, job, delta: -1 })}>−</button><output aria-label={`${OUTPOSTS[id].name}${residentNames[resident]}${jobNames[job]}人数`}>{site.assignments[resident][job]}</output><button aria-label={`${OUTPOSTS[id].name}增加${residentNames[resident]}${jobNames[job]}`} disabled={disabled || outpostFree(state, id, resident) <= 0 || used >= outpostJobCapacity(state, id, job)} onClick={() => send({ type: 'outpost-assign', resident, job, delta: 1 })}>+</button></div>)}</div></div>;
    })}
    <p className="footnote">影子擅长回收，回声擅长记录；两类都能做全部工作。维修与装配共享本地维修台，只有本图工程在全局队首时当地维修工才施工。</p>
    <details className="outpost-crew"><summary>来源、补派与召回</summary><ul>{state.outposts.crew.map(person => <li key={person.uid}><span>{person.uid} · {DISTRICTS[person.district].name} · {residentNames[person.resident]}</span><button aria-label={`召回${person.uid}`} disabled={disabled || state.outposts.crew.length <= 2 || outpostFree(state, id, person.resident) <= 0} onClick={() => send({ type: 'outpost-recall', uid: person.uid })}>召回至原住处</button></li>)}</ul>
      <p className="small">单人召回需先撤回该类型的当地岗位，并至少留下两人。全部撤回请封存；回城者保持空闲。</p>
      <label className="outpost-source">补派来源<select aria-label={`${OUTPOSTS[id].name}补派来源`} value={sourceKey} disabled={disabled} onChange={event => setSourceKey(event.target.value)}><option value="">请选择来源与类型</option>{sources.map(item => <option value={item.key} key={item.key}>{DISTRICTS[item.district].name} · {residentNames[item.resident]} · 空闲{item.free}</option>)}</select></label>
      {source && <p className="small">本次补派1人；旧城该类空闲从{source.free}变为{source.free - 1}，床位仍保留。</p>}
      <button disabled={disabled || !source || source.free <= 0 || state.outposts.crew.length >= capacity} onClick={() => { if (source) send({ type: 'outpost-reinforce', district: source.district, resident: source.resident }); }}>确认补派1人</button>
      {state.outposts.crew.length >= capacity && <p className="condition">当地住处已满；1级宿舍可把派驻上限从2人提高到4人。</p>}
    </details>
  </section>;
}

function OutpostPayment({ state, send, disabled, id, definition }: SiteProps & { definition: DefinitionId }) {
  const level = definition.startsWith('build:') ? state.outposts.sites[id]!.facilities[definition.slice(6) as Facility] + 1 : 1;
  return <OutpostPaymentForm key={`${id}/${definition}/${level}`} state={state} send={send} disabled={disabled} id={id} definition={definition} />;
}
function OutpostPaymentForm({ state, send, disabled, id, definition }: SiteProps & { definition: DefinitionId }) {
  const [prefab, setPrefab] = useState(0), [proof, setProof] = useState<OutpostProof>('local');
  const selectedProof = state.queue.find(project => project.outpost === id && project.definition === definition)?.proof ?? proof;
  const site = state.outposts.sites[id]!, base = outpostDefinition(state, id, definition), limit = outpostPrefabLimit(base);
  const count = Math.min(prefab, limit), quote = outpostDefinition(state, id, definition, undefined, count);
  const reason = outpostEnqueueReason(state, id, definition, definition === 'O02-2' ? selectedProof : undefined);
  const missing = LOCAL_RESOURCES.filter(r => site.resources[r] < quote.cost[r]).map(r => `缺${format(quote.cost[r] - site.resources[r], 3)}${resourceNames[r]}`);
  return <div className="project-payment">
    {definition === 'O02-2' && <fieldset className="outpost-proof"><legend>入队后保留本次证明选择</legend>{(['local', 'relay'] as const).map(value => <label key={value}><input type="radio" name={`proof-${id}`} value={value} checked={selectedProof === value} disabled={disabled || !!reason} onChange={() => setProof(value)} />{proofName(value)}：{value === 'local' ? `累计实际发电 ${format(site.ledger.production.energy, 3)} / 60` : `追加补给已收到电量 ${format(Math.max(0, site.ledger.supportReceived.energy - OUTPOST_INITIAL.energy), 3)} / 80`}</label>)}<p className="small">初始包、在途货物和未发清单不算接力证明。可先排入队列，实际达到所选条件才开工；取消后才能另选。</p></fieldset>}
    <div className="project-facts"><MaterialCost value={quote.cost} /><span>{format(quote.work, 0)} 点工程</span></div>
    {limit > 0 && <label className="prefab-choice">本地预制施工<select aria-label={`${OUTPOSTS[id].name}${base.name}预制份数`} disabled={disabled || !!reason} value={count} onChange={event => setPrefab(Number(event.target.value))}>{Array.from({ length: limit + 1 }, (_, i) => <option value={i} key={i}>{i ? `${i}份构件 · 减少${format(i * ASSEMBLY.prefabWork, 0)}工程点` : '普通施工 · 不用预制构件'}</option>)}</select></label>}
    {count > 0 && <p className="small">替代 {format(count * ASSEMBLY.prefabParts, 0)} 零件，减少 {format(count * ASSEMBLY.prefabWork, 0)} 工程点；原有构件费用不抵销。</p>}
    <p className="condition">{reason ?? (missing.length ? `${missing.join('，')}；可以先安排，开工时统一预留。` : '本地材料已够，轮到本图且有维修工时开工。')}</p>
    <button aria-label={`安排${OUTPOSTS[id].name}${base.name}`} disabled={disabled || !!reason} onClick={() => send({ type: 'outpost-enqueue', definition, prefab: count, ...(definition === 'O02-2' ? { proof: selectedProof } : {}) })}>加入全局工务</button>
  </div>;
}

function LocalFacilities({ state, send, disabled, id }: SiteProps) {
  const site = state.outposts.sites[id]!;
  return <section className="panel" aria-label={`${OUTPOSTS[id].name}设施`}><div className="panel-title"><h2>当地已有的工位</h2><span className="caption">不复制旧城等级</span></div><div className="outpost-facilities">{FACILITY_IDS.map(facility => {
    const level = site.facilities[facility], max = outpostMaxLevel(id, facility);
    return <article className="facility-card" key={facility}><h3>{FACILITIES[facility].name}</h3><p className="small">{!max ? '本图规则：不能建设仓库。' : `${level} / ${max}级。`}{facility === 'dorm' ? '建成可再派驻两人，不自动入住。' : facility === 'warehouse' ? max > 0 ? '增加本地100电量、150零件、20记忆、10构件容量。' : '' : FACILITIES[facility].description}</p>
      {max > level ? <OutpostPayment state={state} send={send} disabled={disabled} id={id} definition={`build:${facility}`} /> : <p className="condition">{max ? '已达本图上限' : '使用有限工作暂存'}</p>}
    </article>;
  })}</div><p className="footnote">本版分所设施不提供拆除，四个基础工位始终保留，资源耗尽后仍可重新安排岗位恢复。</p>
    <div className="outpost-lightframe"><h3>回照灯架</h3><p className="small">当地照明耗电减半；不会提高发电、工作倍率或容量，不需要额外维护。</p>{site.lightFrame ? <p className="condition">本图已建成；仍需实际供电。</p> : state.outposts.knowledge.lightFrame ? <OutpostPayment state={state} send={send} disabled={disabled} id={id} definition="lightFrame" /> : <p className="condition">蓝图尚未交接；完成借光庭并亲自确认后，可在任一分所制作。</p>}</div>
  </section>;
}

function LocalAssembly({ state, send, disabled, id }: SiteProps) {
  const site = state.outposts.sites[id]!, saved = site.assembly, recipe = outpostAssemblyRecipe(state, id);
  const [target, setTarget] = useState(String(saved.target / UNIT)), [parts, setParts] = useState(String(saved.reserve.parts / UNIT)), [energy, setEnergy] = useState(String(saved.reserve.energy / UNIT));
  const values = [parseUnits(target), parseUnits(parts), parseUnits(energy)], valid = values.every(value => value !== null);
  const save = () => { if (valid) send({ type: 'outpost-assembly', enabled: true, target: values[0]!, reserve: amounts(values[2]!, values[1]!) }); };
  return <section className="panel" aria-label={`${OUTPOSTS[id].name}装配`}><div className="panel-title"><h2>本地构件装配</h2><span className="caption">独立目标与原料保留</span></div>
    <p className="small">{recipe.name}：每构件用{recipe.parts}零件、{recipe.energy}电量，基础每人每分钟{format(recipe.rate * 60, 3)}构件。维修和装配共享工位。</p>
    <form onSubmit={event => { event.preventDefault(); save(); }}><div className="outpost-fields">{[['构件目标', target, setTarget], ['零件保留', parts, setParts], ['电量保留', energy, setEnergy]].map(([label, value, set]) => <label key={label as string}>{label as string}<input aria-label={`${OUTPOSTS[id].name}${label}`} inputMode="decimal" value={value as string} disabled={disabled} onChange={event => (set as (text: string) => void)(event.target.value)} /></label>)}</div>
      {!valid && <p className="short small">请输入0至1,000,000，最多3位小数；错误草稿仍可暂停现有装配。</p>}
      <div className="button-row"><button type="submit" disabled={disabled || !valid}>保存并启用本地装配</button><button type="button" disabled={disabled || !saved.enabled} onClick={() => send({ type: 'outpost-assembly', ...saved, enabled: false })}>暂停本地装配</button></div>
    </form><p className="small" data-testid="outpost-assembly-saved">已保存：{saved.enabled ? '启用' : '暂停'}；目标{format(saved.target, 3)}构件，保留{format(saved.reserve.parts, 3)}零件、{format(saved.reserve.energy, 3)}电量。</p>
    <p className="footnote">实际最多备到本地容量和在途预留允许的数量。零目标有效；使用库存后，启用的装配继续补到目标。暂停不提交输入草稿、不改派工人。</p>
    <div className="mod-options"><h3>本图维修台方案</h3><button disabled={disabled || site.bench.active === null} aria-pressed={site.bench.active === null} onClick={() => send({ type: 'outpost-mod', mod: null })}>本图使用普通台面</button>{MOD_IDS.map(mod => <article key={mod} className="mod-card"><h3>{ASSEMBLY.recipes[mod].name}</h3><p className="small">每构件{ASSEMBLY.recipes[mod].parts}零件、{ASSEMBLY.recipes[mod].energy}电量；基础每人每分钟{format(ASSEMBLY.recipes[mod].rate * 60, 3)}构件。</p>{site.bench.built.includes(mod) ? <button disabled={disabled || site.bench.active === mod} aria-pressed={site.bench.active === mod} onClick={() => send({ type: 'outpost-mod', mod })}>{site.bench.active === mod ? `本图${ASSEMBLY.recipes[mod].name}已启用` : `本图启用${ASSEMBLY.recipes[mod].name}`}</button> : state.experience.blueprints.includes(mod) ? <OutpostPayment state={state} send={send} disabled={disabled} id={id} definition={`mod:${mod}`} /> : <p className="condition">尚未发现这份蓝图；旧城发现后共享知识，本地仍需制作。</p>}</article>)}</div>
  </section>;
}

function LocalPolicies({ state, send, disabled, id, lightOn }: SiteProps & { lightOn: boolean }) {
  const site = state.outposts.sites[id]!;
  return <section className="panel" aria-label={`${OUTPOSTS[id].name}照明与优先级`}><h2>只改变这里的安排</h2><p className="small">照明{lightOn ? '有效' : '待供电'}；每次切换包括首次都花{format(RULES.switchParts, 0)}本地零件。旧城门牌与公共设备效果不叠加到分所。</p><div className="outpost-policies">{(Object.keys(POLICIES) as Lighting[]).map(lighting => <button key={lighting} aria-pressed={site.lighting === lighting} disabled={disabled || lighting === site.lighting || site.resources.parts < RULES.switchParts} onClick={() => send({ type: 'outpost-lighting', lighting })} aria-label={`${OUTPOSTS[id].name}切换${POLICIES[lighting].name}`}><strong>{POLICIES[lighting].name}</strong><span>照明每秒{format(Math.ceil(POLICIES[lighting].upkeep * (site.lightFrame ? 0.5 : 1)), 3)}电量</span><small>回收×{POLICIES[lighting].salvage} · 记忆×{POLICIES[lighting].record}</small></button>)}</div>
    <h3>本地工作优先级</h3><p className="small">先发电、照明，再按以下顺序使用可用原料。只改变本图，不重排全局工务。</p><ol className="outpost-priority">{site.priority.map((job, index) => <li key={job}><span>{jobNames[job]}</span><div className="button-row"><button aria-label={`${OUTPOSTS[id].name}提高${jobNames[job]}优先级`} disabled={disabled || index === 0} onClick={() => { const order = [...site.priority]; [order[index - 1], order[index]] = [order[index], order[index - 1]]; send({ type: 'outpost-priority', order }); }}>↑ 提高</button><button aria-label={`${OUTPOSTS[id].name}降低${jobNames[job]}优先级`} disabled={disabled || index === site.priority.length - 1} onClick={() => { const order = [...site.priority]; [order[index + 1], order[index]] = [order[index], order[index + 1]]; send({ type: 'outpost-priority', order }); }}>↓ 降低</button></div></li>)}</ol>
  </section>;
}

function SupportPanel({ state, send, disabled }: Props) {
  const saved = state.outposts.support, active = state.outposts.active, limit = state.outposts.knowledge.manifest ? 3 : 1;
  const [queue, setQueue] = useState<SupportKind[]>([...saved.queue]), [reserve, setReserve] = useState(() => reserveDraft(saved.reserve));
  const [editedQueue, setEditedQueue] = useState(false), [changed, setChanged] = useState(false);
  const savedKey = saved.queue.join(','), previousKey = useRef(savedKey);
  useEffect(() => {
    if (savedKey === previousKey.current) return;
    if (!editedQueue) setQueue([...saved.queue]); else setChanged(true);
    previousKey.current = savedKey;
  }, [savedKey, saved.queue, editedQueue]);
  const parsed = RESOURCES.map(resource => parseUnits(reserve[resource])), valid = parsed.every(value => value !== null) && queue.length <= limit;
  const apply = (enabled: boolean) => {
    if (!valid) return;
    send({ type: 'support-plan', enabled, queue, reserve: Object.fromEntries(RESOURCES.map((resource, index) => [resource, parsed[index]!])) as Amounts });
    setEditedQueue(false); setChanged(false);
  };
  const sent = active ? state.outposts.sites[active]!.sent : null;
  return <section className="panel" id="outpost-support" aria-label="分所支援清单">
    <div className="panel-title"><h2>旧城支援 · 有限补给</h2><span className="caption">{active ? `只送往${OUTPOSTS[active].name}` : '当前没有活动分所'}</span></div>
    <p className="small">不占夜网列车，不运构件或特产，不支持返运。每图一共{SUPPORT_RULES.maxPackages}次追加发运，不因封存、重入或完成刷新。每包另付旧城{format(SUPPORT_RULES.fee, 0)}电量，单程{duration(SUPPORT_RULES.seconds)}。</p>
    {sent && <p className="outpost-budget" data-testid="outpost-support-budget">本图已发{sent.light + sent.materials} / {SUPPORT_RULES.maxPackages}包（光包{sent.light}、工料包{sent.materials}，含在途）；剩余额度{SUPPORT_RULES.maxPackages - sent.light - sent.materials}。</p>}
    {saved.trip && <div className="shipment" role="status" data-testid="outpost-support-trip"><strong>{OUTPOSTS[saved.trip.outpost].name} · {SUPPORT_PACKAGES[saved.trip.kind].name}在途</strong><p><MaterialCost value={saved.trip.cargo} /> · 剩余{duration(saved.trip.remaining)}</p><p className="small">目的地已预留整包空间。暂停、清单编辑和切页不会取消货物，抵达后才算实际收到。</p><span className="meter"><span style={{ width: `${(1 - saved.trip.remaining / saved.trip.duration) * 100}%` }} /></span></div>}
    <p className="small" data-testid="outpost-support-saved">已保存：{saved.enabled ? '启用' : '暂停'}；未发清单 {saved.queue.length ? saved.queue.map(kind => SUPPORT_PACKAGES[kind].name).join(' → ') : '空'}。</p>
    <p className="condition" role="status">{supportReason(state) ?? '下一逻辑秒按已保存清单尝试发运'}。</p>
    <form onSubmit={event => { event.preventDefault(); apply(saved.enabled); }}>
      <fieldset className="outpost-support-draft"><legend>编辑下一次保存的未发清单 · 最多{limit}包</legend>
        <ol>{queue.map((kind, index) => <li key={index}><span>{SUPPORT_PACKAGES[kind].name}：<MaterialCost value={SUPPORT_PACKAGES[kind].cargo} /></span><button type="button" aria-label={`移除草稿第${index + 1}包`} disabled={disabled} onClick={() => { setQueue(current => current.filter((_, i) => i !== index)); setEditedQueue(true); }}>移除</button></li>)}</ol>
        <div className="button-row">{SUPPORT_KINDS.map(kind => <button type="button" key={kind} disabled={disabled || !active || queue.length >= limit} onClick={() => { setQueue(current => [...current, kind]); setEditedQueue(true); }}>草稿加入{SUPPORT_PACKAGES[kind].name}</button>)}</div>
        <p className="small">光包：<MaterialCost value={SUPPORT_PACKAGES.light.cargo} />；工料包：<MaterialCost value={SUPPORT_PACKAGES.materials.cargo} />。清单不预扣库存；逐包发出时支付货物和运费，不自动续填。</p>
        {changed && <p className="short small">已保存清单已推进；正在编辑的草稿未自动提交。请核对在途包和剩余额度，保存将替换当前未发清单。</p>}
      </fieldset>
      <h3>旧城保留量（开所转入也遵守）</h3><div className="outpost-fields">{RESOURCES.map(resource => <label key={resource}>{resourceNames[resource]}保留<input aria-label={`支援保留${resourceNames[resource]}`} inputMode="decimal" value={reserve[resource]} disabled={disabled} onChange={event => setReserve(current => ({ ...current, [resource]: event.target.value }))} /></label>)}</div>
      <p className="small">已保存保留：{RESOURCES.map(resource => `${resourceNames[resource]}${format(saved.reserve[resource], 3)}`).join(' / ')}。发运费也必须留在保留线以上。</p>
      {!valid && <p className="short small">保留量为0至1,000,000，最多3位小数；清单不超过{limit}包。错误草稿不会阻止暂停。</p>}
      <div className="button-row"><button type="submit" disabled={disabled || !valid || !active && queue.length > 0}>保存支援配置</button><button type="button" disabled={disabled || !active || !valid} onClick={() => apply(true)}>保存并启用支援</button><button type="button" disabled={disabled || !saved.enabled} onClick={() => send({ type: 'support-pause' })}>暂停已保存支援</button><button type="button" disabled={disabled} onClick={() => { setQueue([...saved.queue]); setReserve(reserveDraft(saved.reserve)); setEditedQueue(false); setChanged(false); }}>重新读取已保存配置</button></div>
    </form>
    <p className="footnote">暂停只停后续发运，不提交草稿、不撤销在途包；已有货物仍会抵达。无活动分所时可以先保存保留量，但不能安排或启用追加支援。</p>
  </section>;
}

function SealPanel({ state, send, disabled, id }: SiteProps) {
  const [confirm, setConfirm] = useState(false), [clear, setClear] = useState(false), panel = useRef<HTMLDivElement>(null);
  useEffect(() => { if (confirm) panel.current?.focus(); }, [confirm]);
  const reason = outpostSealReason(state), count = state.outposts.support.queue.length;
  return <section className="panel" aria-label={`${OUTPOSTS[id].name}封存`}><h2>暂时关门，成果仍在</h2><p className="small">封存会召回全部{state.outposts.crew.length}人至各自原住处并保持空闲。清零当地岗位、暂停装配与后续支援；库存、设施、蓝图、工程成果和累计额度保留，不搬回旧城。</p>
    <button className="danger" disabled={disabled} onClick={() => { setConfirm(true); setClear(false); }}>查看封存{OUTPOSTS[id].name}影响</button>
    {confirm && <div ref={panel} tabIndex={-1} className="inline-confirm" role="group" aria-label={`确认封存${OUTPOSTS[id].name}`} onKeyDown={event => { if (event.key === 'Escape') setConfirm(false); }}>
      <h3>确认封存{OUTPOSTS[id].name}？</h3><p>封存后本图不生产、不耗电，也不会得到离线收益。重入需要重新选择两名空闲居民，不再领取初始包。</p><ul>{state.outposts.crew.map(person => <li key={person.uid}>{person.uid} → {DISTRICTS[person.district].name} · {residentNames[person.resident]}，空闲</li>)}</ul>
      {reason && <p className="condition" role="status">{reason}。请使用全局工务逐项处理，不会替你取消。</p>}
      {count > 0 ? <label className="outpost-checkbox"><input type="checkbox" checked={clear} disabled={disabled} onChange={event => setClear(event.target.checked)} />我确认清空{count}包未发清单：{state.outposts.support.queue.map(kind => SUPPORT_PACKAGES[kind].name).join(' → ')}；它们尚未扣料。</label> : <p className="small">未发清单为空，不会取消其他城市的工程。</p>}
      <div className="button-row"><button className="danger" disabled={disabled || !!reason || count > 0 && !clear} onClick={() => { send({ type: 'outpost-seal', confirmClear: clear }); setConfirm(false); }}>确认封存{OUTPOSTS[id].name}</button><button onClick={() => setConfirm(false)}>继续经营，不封存</button></div>
    </div>}
  </section>;
}

function SharedKnowledge({ state }: { state: GameState }) {
  const names: Record<Modification, string> = { quickJig: ASSEMBLY.recipes.quickJig.name, thriftBench: ASSEMBLY.recipes.thriftBench.name, voiceBox: MAIL_MODS.voiceBox.name, dispatchBox: MAIL_MODS.dispatchBox.name, freightRack: VEHICLE_MODS.freightRack.name, railGuard: VEHICLE_MODS.railGuard.name };
  return <section className="panel" aria-label="共享知识与来信历史"><h2>随行的是已学会的办法</h2><p className="small">R01工具规范：{state.completed.includes('R01') ? '已学会，可用于当地维修' : '尚未学会'}；R02回声整理：{state.completed.includes('R02') ? '已学会，可用于当地记录' : '尚未学会'}。其他研究、门牌、专业组合与公共设备仍作用于旧城。</p>
    <details><summary>蓝图 · 已知{state.experience.blueprints.length}份</summary><ul>{Object.entries(names).map(([key, name]) => <li key={key}>{state.experience.blueprints.includes(key as Modification) ? `${name} · 已知${MOD_IDS.includes(key as typeof MOD_IDS[number]) ? '，分所需重新制作' : '，对应业务留在旧城'}` : '一份尚未发现的工具图样'}</li>)}</ul><p className="small">已制工具不会随派驻复制；工具完工也不会自动启用。</p></details>
    <details><summary>复原档案 · 已读{state.experience.archives.length}份</summary>{ARCHIVE_IDS.filter(archive => archive !== 'A04' || archiveUnlocked(state, archive)).map(archive => state.experience.archives.includes(archive) ? <article key={archive}><h3>{ARCHIVES[archive].name}</h3><p className="small">{ARCHIVES[archive].text}</p></article> : <p className="small muted" key={archive}>{archive} · 尚未发现/复原，不显示未读结论。</p>)}</details>
    <details><summary>回看联系人已读来信</summary>{STORY_IDS.filter(story => state.experience.story[story]).map(story => <details className="archive-event" key={story}><summary>{story} · {STORY_NAMES[story]}</summary><p>{storyText(state, story)}</p></details>)}</details>
    <p className="small">分所补给清单：{state.outposts.knowledge.manifest ? '已交接，最多明确预排3包' : '尚未交接，最多1包'}；回照灯架：{state.outposts.knowledge.lightFrame ? '已交接，可在分所各制作一次' : '尚未交接'}。</p>
  </section>;
}

function SiteHistory({ state, id }: { state: GameState; id: OutpostId }) {
  const site = state.outposts.sites[id]!;
  return <section className="panel" aria-label={`${OUTPOSTS[id].name}交接与历史`}><h2>{OUTPOSTS[id].name}留下的记录</h2>
    {site.handoff && <p className="condition">地图交接已确认，知识只获得一次。{id === 'O01' ? '补给清单不自动替你追加安排。' : '回照灯架仍需在各分所当地制作。'}</p>}
    <details><summary>已完成的本地工程 · {site.completed.length}项</summary>{site.completed.length ? <ul>{site.completed.map(key => <li key={key}>{completionName(`${id}@${key}`)}</li>)}</ul> : <p className="small">这里还没有完成记录。</p>}</details>
    <p className="small">累计本地实际发电{format(site.ledger.production.energy, 3)}；实际收到支援：{amountText(site.ledger.supportReceived)}（含唯一初始包）。已发追加光包{site.sent.light}、工料包{site.sent.materials}，不会重置。</p>
  </section>;
}
function Handoff({ state, send, disabled, id }: SiteProps) {
  const site = state.outposts.sites[id]!;
  return <article className="outpost-handoff" data-testid={`outpost-handoff-${id}`}><span className="eyebrow">来自{OUTPOSTS[id].name} · {OUTPOSTS[id].address}</span><h3>地图交接：{id === 'O01' ? '分所补给清单' : '回照灯架'}</h3><p>{id === 'O01' ? `屋檐${site.roofPrefab ? `使用了${site.roofPrefab}份预制构件` : '由工人逐段现场接好'}。明确的补给清单可以多写到3包，额度仍是每图4包，不会自行续填。` : `庭院以“${site.proof ? proofName(site.proof) : '尚未记录'}”留下交班证明。灯架蓝图可以让当地照明耗电减半；并不是已经建好的设备。`}</p><button disabled={disabled} onClick={() => send({ type: 'outpost-handoff', outpost: id })}>确认{OUTPOSTS[id].name}地图交接</button><p className="footnote">纯知识，不占库存，不自动改变岗位、发运或工具；不必为了确认交接重新入驻。</p></article>;
}
export function OutpostPending({ state, send, disabled }: Props) {
  const pending = OUTPOST_IDS.filter(id => state.outposts.sites[id]?.completed.includes(`${id}-3`) && !state.outposts.sites[id]?.handoff);
  if (!pending.length) return null;
  return <section className="panel outposts-page" aria-label="分所待交接"><div className="panel-title"><h2>异地交班</h2><span className="caption">{pending.length}份地图成果等待确认</span></div>{pending.map(id => <Handoff key={id} state={state} send={send} disabled={disabled} id={id} />)}</section>;
}

function OutpostScene({ state, id, lightOn }: { state: GameState; id: OutpostId; lightOn: boolean }) {
  const site = state.outposts.sites[id]!, first = site.completed.includes(`${id}-1`), second = site.completed.includes(`${id}-2`), registered = site.completed.includes(`${id}-3`);
  const detail = id === 'O01' ? second ? site.roofPrefab ? `屋檐留下${site.roofPrefab}份预制接缝` : '屋檐由现场施工逐段接好' : '屋檐还没有接成路' : second && site.proof ? `庭院留下${proofName(site.proof)}证明` : first ? '借光插口已经接好，等待实际电量' : '借光插口等待修复';
  const facts = `${detail}；${registered ? `地址${OUTPOSTS[id].address}` : '地址尚未登记'}；${site.lightFrame ? `回照灯架已建成，${lightOn ? '灯光有效' : '等待供电或重入'}` : '回照灯架尚未建成'}`;
  return <div className="outpost-scene" data-testid={`outpost-scene-${id}`}><svg viewBox="0 0 600 150" role="img" aria-label={`${OUTPOSTS[id].name}街景：${facts}`}><path d="M16 129H584 M20 135H580" className="street-road" />
    <g className={first ? 'scene-built' : 'scene-ghost'}><path d="M60 90H177V102H60 M69 102V129 M168 102V129" className="scene-line" /><rect x="83" y="73" width="28" height="16" className="scene-building" /><text x="70" y="60" className="scene-label">{id === 'O01' ? '巷口工位' : '借光插口'}</text></g>
    {id === 'O01' ? <g className={second ? 'scene-built' : 'scene-ghost'}><path d="M215 78L265 50H395L445 78 M230 78V129 M430 78V129" className="scene-line" />{second && site.roofPrefab !== null && site.roofPrefab > 0 && Array.from({ length: site.roofPrefab }, (_, i) => <path key={i} d={`M${285 + i * 45} 51V78`} className="scene-line" />)}<text x="277" y="105" className="scene-label">{second ? site.roofPrefab ? '预制屋檐' : '现场接好' : '屋檐待接'}</text></g> : <g className={second ? 'scene-built' : 'scene-ghost'}><path d="M215 121V76H443V121 M233 77V48H422V77" className="scene-line" /><rect x="270" y="82" width="115" height="26" className={second ? 'scene-lit' : 'scene-building'} /><text x="285" y="100" className="scene-label">{second && site.proof ? proofName(site.proof) : '下一班待定'}</text></g>}
    <g><path d="M510 129V39H544" className="scene-line" /><rect x="492" y="75" width="70" height="25" className={registered ? 'scene-lit' : 'scene-window'} /><text x="498" y="92" className="scene-label">{registered ? OUTPOSTS[id].address : '未登记'}</text>{site.lightFrame && <><path d="M504 44L530 23L551 44 M510 48H551" className="scene-line" />{lightOn && <ellipse cx="530" cy="123" rx="48" ry="7" className="lamp-pool" />}</>}</g>
  </svg><p className="street-life">{facts}。</p></div>;
}

export function OutpostReport({ report }: { report: ReturnReport }) {
  if (!report.outposts?.length) return null;
  return <section className="outposts-page outpost-report" aria-label="分所返回记录">
    <h3>旧城与分所支援</h3><p className="small">旧城实际发出：{amountText(report.flows.supportSent)}。转移不增加累计取得，未发清单不算已发物资。</p>
    {report.outposts.map(item => <section key={item.id} className="outpost-report-site"><h3>{OUTPOSTS[item.id].name} · {item.active ? '活动分所' : '封存保留进度'}</h3><p className="small">本段实际收到：{amountText(item.flows.supportReceived)}。{!item.active && '封存时不进行当地自动生产。'}</p>
      <p className="small">追加额度：已发{item.support.sent}包，剩余{item.support.remaining}包；未发清单{item.support.queued}包。在途：{amountText(item.support.inTransit)}（未计入本段实际收到）。</p>
      {!!item.pending.length && <p className="condition">待处理：{item.pending.join('；')}。</p>}
      {!!item.reasons.length && <p className="condition">停因：{item.reasons.join('；')}。</p>}
      {!!item.completed.length && <p className="small">完成：{item.completed.map(key => completionName(key.includes('@') ? key : `${item.id}@${key}`)).join('、')}。</p>}
      <details><summary>当地库存与收支明细</summary><div className="outpost-report-grid">{LOCAL_RESOURCES.map(resource => <article key={resource}><h4>{resourceNames[resource]}</h4><dl><div><dt>开始 → 结束</dt><dd>{format(item.start[resource], 3)} → {format(item.end[resource], 3)}</dd></div><div><dt>实际生产 / 奖励</dt><dd>{format(item.flows.production[resource], 3)} / {format(item.flows.rewards[resource], 3)}</dd></div><div><dt>运行 / 工程预留</dt><dd>{format(item.flows.operating[resource], 3)} / {format(item.flows.reserved[resource], 3)}</dd></div><div><dt>实际返还 / 支援收到</dt><dd>{format(item.flows.refunds[resource], 3)} / {format(item.flows.supportReceived[resource], 3)}</dd></div></dl></article>)}</div></details>
    </section>)}
  </section>;
}
