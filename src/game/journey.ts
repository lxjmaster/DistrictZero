import { cost, UNIT } from './config';
import type { Amounts, ArchiveId, GameState, VehicleMod } from './types';

export const VEHICLE_MOD_IDS: VehicleMod[] = ['freightRack', 'railGuard'];
export const VEHICLE_MODS = {
  freightRack: { name: '强化货架', text: '单车运量增加20；每次发车额外使用2电量。' },
  railGuard: { name: '护轨挂架', text: '发车磨损乘0.75后向上取整；保持基础运量。' }
};
export const VEHICLE_COST = cost(0, 20, 0, 4, 0, 2);
export const VEHICLE_WORK = 120 * UNIT;
export const LEGACY_ARCHIVE_IDS: ArchiveId[] = ['A01', 'A02', 'A03'];
export const ARCHIVE_IDS: ArchiveId[] = [...LEGACY_ARCHIVE_IDS, 'A04'];
export const ARCHIVES: Record<ArchiveId, { name: string; cost: Amounts; place: string; text: string; invitation?: string }> = {
  A01: { name: '没有寄件人的雨声', cost: cost(0, 0, 4, 0, 2), place: '雨城站棚与听雨间', text: '胶片里的雨声来自棚顶的旧接缝。寄件人没有署名，因为那时还没有门牌；如今听雨的人可以在屋里认出自己的那一段。' },
  A02: { name: '第0节的交班', cost: cost(0, 0, 4, 0, 1, 1), place: '长站第0节与修车棚', text: '运单的第0行是留给接班人的。旧接头上磨掉的字与交班记录吻合：车厢没有少一节，有人一直把下一班的位置留下。' },
  A03: { name: '空白地址的另一面', cost: cost(0, 0, 6, 1, 2), place: '第0街区与信笺里窗口', text: '胶片上的窗口倒影和第一张交接单指向同一个空白。那不是已经消失的城市，而是尚未有人写下收件人的地方；两张回执替它留下了可以回来的路。' },
  A04: { name: '三地候车回执', cost: cost(0, 0, 4, 1, 2, 2), place: '第0街区·共同候车处', invitation: '雨城寄来一张没有雨痕的回执，长站的回执却还带着车轮声。登记员把它们放在第0街区的候车处：“不必再修一座站台，替三地各留一个可以签名的位置就好。”准备一格留声的地方和两份回执；以前留下的胶片与轨芯也可以用。', text: '胶片展开后，雨声只落在纸的左边；轨芯压住右角，纸上多了一条通向下一班的横线。你用构件把两份回执固定在旧站牌背面，记下三地共同交接的这一天。雨城签了“到过”，长站签了“还会来”。第0街区那一栏留着一小块空白，旁边写着：“这里也可以等人。”候车处没有新的值班表，回执会一直留在这里。' }
};
export const archivesUnlocked = (s: GameState) => s.neighborhood.commissions.completed.includes('CM05-1') || s.neighborhood.field.sites.F05.first === 'b';
export const archiveUnlocked = (s: GameState, id: ArchiveId) => ARCHIVE_IDS.includes(id) && (id === 'A04' ? s.completed.includes('P19') && !!s.experience.story['L06-4'] && !s.network.legacyPending : archivesUnlocked(s));
export function remainingSpecialtyUses(s: GameState): string[] {
  const remaining: string[] = [];
  for (const id of ['CM05', 'CM06'] as const) if (!s.neighborhood.commissions.completed.includes(`${id}-2`)) remaining.push(id === 'CM05' ? '听雨间委托' : '修车棚委托');
  for (const id of ['F05', 'F06'] as const) if (!s.neighborhood.field.sites[id].clue) remaining.push(id === 'F05' ? '雨城首访/有限线索' : '长站首访/有限线索');
  if (s.network.vehicle.built.length < 2) remaining.push('尚未制作的车辆方案');
  if (LEGACY_ARCHIVE_IDS.some(id => !s.experience.archives.includes(id))) remaining.push('尚未复原的档案');
  if (archiveUnlocked(s, 'A04') && !s.experience.archives.includes('A04')) remaining.push('三地候车回执（可选尾声）');
  return remaining;
}
