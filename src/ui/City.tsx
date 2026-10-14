import { useState } from 'react';
import { RESIDENTS, RESOURCES, resourceNames, residentNames } from '../game/config';
import { activeDistricts, CITY_RULES, cityCount, dismantleReason, districtState, DISTRICTS, DISTRICT_IDS, localBeds, localCount, localFree, plotsUsed, PUBLIC_IDS, PUBLIC_WORKS, specialization } from '../game/city';
import { definitionFor, duration, enqueueReason, format, servicePreview } from '../game/engine';
import type { Action, DistrictId, Facility, GameState, PublicFacility } from '../game/types';

type Props = { state: GameState; district: DistrictId; send: (action: Action) => void; disabled: boolean };
export function CityPage({ state, district, send, disabled, manage }: Props & { manage: (id: DistrictId) => void }) {
  const services = servicePreview(state), current = districtState(state, district)!;
  return <div className="stack">
    <section className="panel city-map" aria-label="夜城地图">
      <div className="panel-title"><h2>灯光之间的路</h2><span className="caption">{activeDistricts(state).length} / 3 地址 · {cityCount(state)} 位居民</span></div>
      <p className="muted small">从第0街区出发，两条支路各有自己的生活。物资经过这些路共用，人手在各自的住处工作。</p>
      <div className="map-route" aria-label="街区连接">旧巷 ← 第0街区 → 信笺里</div>
      <div className="district-cards">{DISTRICT_IDS.map(id => {
        const d = districtState(state, id), spec = d ? specialization(d, services[id]?.light) : null;
        return <article key={id} className={`district-card ${d ? 'connected' : 'unmapped'}`} data-testid={`district-${id}`}>
          <span className="eyebrow">{d ? DISTRICTS[id].address : '地图上的空白'}</span><h3>{DISTRICTS[id].name}</h3><p className="muted small">{DISTRICTS[id].text}</p>
          {d ? <><p className="small">地块 {plotsUsed(d)} / {DISTRICTS[id].plots} · 住处 {localCount(d)} / {localBeds(d, id)}</p><p className={spec ? 'specialty' : 'muted small'}>{spec === 'salvage' ? '回收街区 · 额外产出 +10%' : spec === 'record' ? '记录街区 · 额外产出 +10%' : '尚未形成专业组合'}</p><button aria-label={`管理${DISTRICTS[id].name}`} onClick={() => manage(id)}>安排这里 →</button></> : <p className="condition">{id === 'district-1' ? '完成旧巷测绘后开放' : '完成信笺里门牌工程后开放'}</p>}
        </article>;
      })}</div>
      <div className="line-status"><span className="eyebrow">对外线路 / 0</span><h3>{state.completed.includes('P07') ? '第0街区 ── 雨城 · 已接通' : '第0街区 ── 雨城 · 等待接通'}</h3><p className="small muted">{state.completed.includes('P07') ? '电话那头的雨声，现在有人接听。运输合同将在下一章展开。' : '编成地址簿，维持回收与记录专业街区，再让公共设施为联络线供电。'}</p></div>
    </section>
    <section className="panel" aria-label="居民迁居"><div className="panel-title"><h2>让人找到合适的住处</h2><span className="caption">当前：{DISTRICTS[district].name}</span></div>
      <p className="small muted">先撤回岗位，再迁居空闲居民。新住客优先选择供电正常的明灯（回声）或暗灯（影子），人数与到达顺序不变。</p>
      {RESIDENTS.map(resident => <div className="relocation" key={resident}><p><strong>{residentNames[resident]}</strong><span className="small muted"> · 当前空闲 {localFree(current, resident)}</span></p><div className="button-row">{activeDistricts(state).filter(id => id !== district).map(to => <button key={to} disabled={disabled || localFree(current, resident) === 0 || localCount(districtState(state, to)!) >= localBeds(districtState(state, to)!, to)} aria-label={`迁居${residentNames[resident]}至${DISTRICTS[to].name}`} onClick={() => send({ type: 'relocate', resident, from: district, to })}>迁往{DISTRICTS[to].name} · 空床 {localBeds(districtState(state, to)!, to) - localCount(districtState(state, to)!)}</button>)}</div></div>)}
      <p className="footnote">回收组合：2位影子 + 2级回收棚 + 暗灯。记录组合：2位回声 + 2级信箱 + 明灯。照明断供时专业加成暂时失效。</p>
    </section>
  </div>;
}
export function PublicInfrastructure({ state, district, send, disabled, dismantle }: Props & { dismantle: (f: Facility | PublicFacility) => void }) {
  const d = districtState(state, district)!, services = servicePreview(state);
  return <section aria-label="公共设施"><div className="panel-title"><h2>公共设施与巡检</h2><span className="caption">地块 {plotsUsed(d)} / {DISTRICTS[district].plots}</span></div>
    <div className="facility-grid">{PUBLIC_IDS.map(f => {
      const config = PUBLIC_WORKS[f], equipment = d.publicWorks[f], definition = `${equipment.built ? 'maintain' : 'public'}:${f}` as const;
      const reason = enqueueReason(state, definition, district), project = definitionFor(state, definition, undefined, district);
      return <article className="facility-card" key={f} data-testid={`public-${f}`}><div className="facility-heading"><span className="facility-mark">{f === 'relay' ? '↯' : '⌂'}</span><span className={`tag ${services[district]?.public[f] ? 'working' : ''}`}>{!equipment.built ? '尚未建设' : !equipment.enabled ? '已停用' : services[district]?.public[f] ? '供电运行' : '效果暂停'}</span></div><h3>{config.name}</h3><p className="muted">{config.text}</p>
        {state.events.E07?.choice === 'common' && <p className="small muted">共灯生效，实际维护 {format(Math.ceil(config.upkeep * CITY_RULES.sharedUpkeep))} 电量/秒。</p>}
        {equipment.built && <><p className="small">设备状态 {equipment.condition} / {CITY_RULES.condition} · 可运行 {duration(equipment.condition)}</p><span className="meter"><span style={{ width: `${equipment.condition / CITY_RULES.condition * 100}%` }} /></span><p className="muted small">巡检花费6零件、15电量、60工程点；完成恢复全部状态。</p></>}
        <div className="project-facts"><span className="costs">{RESOURCES.filter(r => project.cost[r]).map(r => <span key={r}>{format(project.cost[r])} {resourceNames[r]}</span>)}</span><span>{format(project.work, 0)} 点</span></div>
        <p className="condition">{reason ?? '费用在开工时预留，全城维修工共用一条队列。'}</p><button disabled={disabled || !!reason} aria-label={`安排${equipment.built ? '巡检' : '建设'}${config.name}`} onClick={() => send({ type: 'enqueue', district, definition })}>{equipment.built ? '安排巡检' : '安排建设'}</button>
        {equipment.built && <button className="quiet" disabled={disabled} aria-label={`${equipment.enabled ? '停用' : '启用'}${config.name}`} onClick={() => send({ type: 'public-toggle', district, facility: f })}>{equipment.enabled ? '停用，保留设备状态' : '重新启用'}</button>}
        {equipment.built && district !== 'district-0' && <button className="quiet danger" disabled={disabled || !!dismantleReason(state, district, f)} onClick={() => dismantle(f)}>拆除闲置{config.name}</button>}
      </article>;
    })}</div>
    <div className="panel automation"><h3>值班巡检</h3><p className="small muted">研究巡检手册后，状态不超过300的启用设备自动加入队尾；已有项目与暂停项目优先。缺料或无人维修时继续等待。</p><button aria-pressed={d.autoRepair} disabled={disabled || !state.completed.includes('R04')} onClick={() => send({ type: 'auto-repair', district, enabled: !d.autoRepair })}>{d.autoRepair ? '关闭本区自动巡检' : '开启本区自动巡检'}</button>{!state.completed.includes('R04') && <p className="condition">在档案页研究“巡检手册”。</p>}</div>
  </section>;
}
export function WorkTemplates({ state, district, send, disabled }: Props) {
  const [name, setName] = useState('夜班安排');
  return <section className="panel" aria-label="工作配置模板"><div className="panel-title"><h2>把这班的安排留下</h2><span className="caption">{state.city.templates.length} / 3 套模板</span></div><p className="small muted">保存当前街区的岗位、照明与全城工作优先级。同名保存会更新该模板；应用时保留多余居民为空闲。</p>
    <div className="template-form"><label htmlFor="template-name" className="small">模板名称</label><input id="template-name" maxLength={24} value={name} disabled={disabled} onChange={e => setName(e.target.value)} /><button disabled={disabled || !name.trim()} onClick={() => send({ type: 'template-save', district, name })}>保存当前安排</button></div>
    {state.city.templates.map(t => <article className="template-row" key={t.name}><h3>{t.name} <span className="small muted">· {DISTRICTS[t.district].name}</span></h3><p className="small muted">应用所需照明切换费用：{districtState(state, t.district)!.lighting === t.lighting ? '0' : '5'} 零件。居民或岗位不足时，当前安排保留。</p><div className="button-row"><button disabled={disabled} aria-label={`应用模板${t.name}`} onClick={() => send({ type: 'template-apply', name: t.name })}>应用安排</button><button className="quiet danger" disabled={disabled} aria-label={`删除模板${t.name}`} onClick={() => send({ type: 'template-delete', name: t.name })}>删除</button></div></article>)}
  </section>;
}
