import { amounts, cost, UNIT } from './config';
import type { Amounts, AssemblyMod, DistrictId, ExperienceState, GameState, ProjectDefinition, StoryNode } from './types';

export const MOD_IDS: AssemblyMod[] = ['quickJig', 'thriftBench'];
export const STORY_IDS: StoryNode[] = ['L01-1', 'L01-2', 'L01-3', 'L01-4'];
export const ASSEMBLY = {
  capacity: 30 * UNIT, warehouseCapacity: 10 * UNIT,
  recipes: {
    ordinary: { name: '普通台面', rate: 20, parts: 8, energy: 4 },
    quickJig: { name: '快速夹具', rate: 30, parts: 12, energy: 6 },
    thriftBench: { name: '节料台面', rate: 15, parts: 6, energy: 3 }
  },
  modCost: cost(8, 10, 4, 2), modWork: 60 * UNIT,
  blueprintCost: cost(12, 0, 4), blueprintWork: 60 * UNIT,
  restoreCost: cost(6, 0, 4, 1), dismantleReward: cost(0, 0, 0, 2),
  scrapParts: 4 * UNIT, prefabParts: 8 * UNIT, prefabWork: 60 * UNIT, maxPrefab: 6,
  maxSetting: 1_000_000 * UNIT
} as const;
export const STORY_NAMES: Record<StoryNode, string> = {
  'L01-1': '没有插头的收音机', 'L01-2': '留下外壳，还是留下声音',
  'L01-3': '多出来的那一下', 'L01-4': '第一站的广播'
};
export function createExperience(): ExperienceState {
  return {
    story: {}, blueprints: [],
    benches: { 'district-0': { built: [], active: null }, 'district-1': { built: [], active: null }, 'district-2': { built: [], active: null } },
    assembly: { enabled: false, target: 5 * UNIT, reserve: amounts(10 * UNIT, 20 * UNIT) }
  };
}
export const assemblyUnlocked = (s: GameState) => Boolean(s.experience.story['L01-1']);
export const radioChoice = (s: GameState) => s.experience.story['L01-2']?.choice;
export function storyAvailable(s: GameState, id: StoryNode): boolean {
  if (!STORY_IDS.includes(id) || s.experience.story[id]) return false;
  if (id === 'L01-1') return s.events.E01?.status === 'claimed';
  if (id === 'L01-2') return Boolean(s.experience.story['L01-1']);
  if (id === 'L01-3') return Boolean(s.experience.story['L01-2']) && s.completed.includes('P02');
  return Boolean(s.experience.story['L01-3']) && s.completed.includes('P03');
}
export const pendingStories = (s: GameState) => STORY_IDS.filter(id => storyAvailable(s, id));
export function storyText(s: GameState, id: StoryNode): string {
  const restored = radioChoice(s) === 'restore';
  if (id === 'L01-1') return '灯亮以后，有人把一台没有插头的收音机放在维修台上。“它以前每天报时。后来，时间不肯认它了。”工具箱里有一张装配纸条：把零件做成标准构件，施工时能先在桌上接好，再搬到现场。住客问，你愿不愿意留下它的声音。';
  if (id === 'L01-2') return `${s.facilities.dorm ? '住客从亮着灯的窗口探出头。' : '来人仍在站台边等一个住处。'}拆下外壳，能留下两份完好的构件和一套快速夹具图样；修复声音，需要投入材料，旧图纸里还夹着一张节料台面的做法。以后可以补学另一种图样，这台收音机的命运会保留下来。`;
  if (id === 'L01-3') return restored
    ? '收音机报了三下，楼上传来第四下。住客把那一声抄在纸上：“没有登记的半层，也许还住着人。”他在纸背记下了旧调频。线索已经收好；眼下可以先把构件用在施工上，窗里的声音会等你回来。'
    : '住客把空外壳改成了工具盒，每把扳手都有一个位置。“声音没有留下，东西也没有白来。”盒底刻着站台储物柜的编号。你把线索收进档案，预制好的构件正好能少跑几趟施工现场。';
  return restored
    ? '地址登记为0-001的那一刻，收音机终于说出了站名。住客把它放在窗口：“这次报的，是我们这里。”没有登记的楼层仍在那张纸上，声音有了可以寄回来的地方。'
    : '地址登记为0-001以后，住客在工具盒上写下了门牌。“借出去的东西，这下能找回来了。”他把最后一把扳手摆正。收音机没有再响，街区已经开始用自己的声音工作。';
}
export function assemblyRecipe(s: GameState, district: DistrictId) {
  const built = district === 'district-0' ? s.facilities.workbench : s.city.districts[district]?.facilities.workbench;
  const mod = built ? s.experience.benches[district].active : null;
  return ASSEMBLY.recipes[mod ?? 'ordinary'];
}
export function prefabLimit(definition: ProjectDefinition): number {
  if (definition.id.startsWith('mod:') || definition.id.startsWith('blueprint:')) return 0;
  return Math.min(ASSEMBLY.maxPrefab, Math.floor(definition.cost.parts / ASSEMBLY.prefabParts), Math.floor(definition.work / (2 * ASSEMBLY.prefabWork)));
}
export function prefabricated(definition: ProjectDefinition, count: number): ProjectDefinition {
  if (!count) return definition;
  const payment: Amounts = { ...definition.cost, parts: definition.cost.parts - count * ASSEMBLY.prefabParts, component: definition.cost.component + count * UNIT };
  return { ...definition, cost: payment, work: definition.work - count * ASSEMBLY.prefabWork };
}
