import { amounts, cost, UNIT } from './config';
import type { Amounts, AssemblyMod, DistrictId, ExperienceState, GameState, ProjectDefinition, StoryNode } from './types';
import { commissionDone } from './neighborhood';

export const MOD_IDS: AssemblyMod[] = ['quickJig', 'thriftBench'];
export const RADIO_STORY_IDS: StoryNode[] = ['L01-1', 'L01-2', 'L01-3', 'L01-4'];
export const LETTER_STORY_IDS: StoryNode[] = ['L02-1', 'L02-2', 'L02-3', 'L02-4'];
export const TRAIN_STORY_IDS: StoryNode[] = ['L03-1', 'L03-2', 'L03-3', 'L03-4'];
export const OUTPOST_STORY_IDS: StoryNode[] = ['L04-1', 'L04-2', 'L04-3', 'L04-4'];
export const CALENDAR_STORY_IDS: StoryNode[] = ['L05-1', 'L05-2', 'L05-3', 'L05-4'];
export const COVENANT_STORY_IDS: StoryNode[] = ['L06-1', 'L06-2', 'L06-3', 'L06-4'];
export const STORY_IDS: StoryNode[] = [...RADIO_STORY_IDS, ...LETTER_STORY_IDS, ...TRAIN_STORY_IDS, ...OUTPOST_STORY_IDS, ...CALENDAR_STORY_IDS, ...COVENANT_STORY_IDS];
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
  'L06-1': '空白处可以写约定', 'L06-2': '规则要有人照看', 'L06-3': '两行字之间的空隙', 'L06-4': '第0街区仍有下一页',
  'L05-1': '日期为0的维修单', 'L05-2': '把还没用上的一刻收好', 'L05-3': '三处钟面，一份交班', 'L05-4': '今天有了共同的名字',
  'L04-1': '另一面也有人等开门', 'L04-2': '带走的是办法', 'L04-3': '第一处异地交班', 'L04-4': '两份地址都能收到信',
  'L01-1': '没有插头的收音机', 'L01-2': '留下外壳，还是留下声音',
  'L01-3': '多出来的那一下', 'L01-4': '第一站的广播',
  'L02-1': '总投进同一扇窗', 'L02-2': '门牌背面的字', 'L02-3': '可以代收吗', 'L02-4': '每个人都收到了',
  'L03-1': '空箱上的名字', 'L03-2': '运单上的笔迹', 'L03-3': '长站的第0节', 'L03-4': '明天仍会寄来'
};
export function createExperience(): ExperienceState {
  return {
    story: {}, blueprints: [], archives: [],
    benches: { 'district-0': { built: [], active: null }, 'district-1': { built: [], active: null }, 'district-2': { built: [], active: null } },
    assembly: { enabled: false, target: 5 * UNIT, reserve: amounts(10 * UNIT, 20 * UNIT) }
  };
}
export const assemblyUnlocked = (s: GameState) => Boolean(s.experience.story['L01-1']);
export const radioChoice = (s: GameState) => s.experience.story['L01-2']?.choice;
export function storyAvailable(s: GameState, id: StoryNode): boolean {
  if (!STORY_IDS.includes(id) || s.experience.story[id] || id.startsWith('L03') && s.network.legacyPending) return false;
  if (id.startsWith('L04') && s.network.legacyPending) return false;
  if (id.startsWith('L05') && s.network.legacyPending) return false;
  if (id.startsWith('L06') && s.network.legacyPending) return false;
  if (id === 'L06-1') return !!s.experience.story['L05-4'];
  if (id === 'L06-2') return !!s.experience.story['L06-1'] && s.completed.includes('P17');
  if (id === 'L06-3') return !!s.experience.story['L06-2'] && s.completed.includes('P18');
  if (id === 'L06-4') return !!s.experience.story['L06-3'] && s.completed.includes('P19');
  if (id === 'L05-1') return !!s.experience.story['L04-4'];
  if (id === 'L05-2') return !!s.experience.story['L05-1'] && s.completed.includes('P13');
  if (id === 'L05-3') return !!s.experience.story['L05-2'] && s.completed.includes('P15');
  if (id === 'L05-4') return !!s.experience.story['L05-3'] && s.completed.includes('P16');
  if (id === 'L04-1') return s.completed.includes('P11') && s.events.E15?.status === 'claimed' && Boolean(s.experience.story['L03-4']);
  if (id === 'L04-2') return Boolean(s.experience.story['L04-1']) && s.completed.includes('P12');
  if (id === 'L04-3') return Boolean(s.experience.story['L04-2']) && (s.outposts.sites.O01?.completed.includes('O01-3') === true || s.outposts.sites.O02?.completed.includes('O02-3') === true);
  if (id === 'L04-4') return Boolean(s.experience.story['L04-3']) && s.outposts.sites.O01?.handoff === true && s.outposts.sites.O02?.handoff === true;
  if (id === 'L03-1') return s.completed.includes('P08');
  if (id === 'L03-2') return Boolean(s.experience.story['L03-1']) && s.events.E12?.status === 'claimed';
  if (id === 'L03-3') return Boolean(s.experience.story['L03-2']) && s.completed.includes('P09');
  if (id === 'L03-4') return Boolean(s.experience.story['L03-3']) && s.completed.includes('P11');
  if (id === 'L02-1') return s.completed.includes('P04');
  if (id === 'L02-2') return Boolean(s.experience.story['L02-1']) && s.events.E07?.status === 'claimed';
  if (id === 'L02-3') return Boolean(s.experience.story['L02-2']) && commissionDone(s, 'CM03-1');
  if (id === 'L02-4') return Boolean(s.experience.story['L02-3']) && s.completed.includes('P06');
  if (id === 'L01-1') return s.events.E01?.status === 'claimed';
  if (id === 'L01-2') return Boolean(s.experience.story['L01-1']);
  if (id === 'L01-3') return Boolean(s.experience.story['L01-2']) && s.completed.includes('P02');
  return Boolean(s.experience.story['L01-3']) && s.completed.includes('P03');
}
export const pendingStories = (s: GameState) => STORY_IDS.filter(id => storyAvailable(s, id));
export function storyText(s: GameState, id: StoryNode): string {
  if (id === 'L06-1') return '共同名录还有一页空白。登记员问：“既然日期可以共同承认，明天的生活能不能也商量着来？”先摆开公约桌。城市不会替你选择要留下什么；三条方向可以比较，也可以付费调整。';
  if (id === 'L06-2') return '灯可以留住，路可以接下去，不同日期也可以共处。每条约定都有持续投入和真实代价：照明省电会慢下施工与入住；施工加快会少记一些声音；列车省电要让回收慢一点。确认花6电、4零件、2记忆，下秒整组支付维护才生效。缺料就暂停效果，不欠债；免费暂停永远可用。';
  if (id === 'L06-3') return '第二行字写下后，空隙也成为约定的一部分。封存与续建相乘，施工会是原来的93.75%；并存仍需要回收者让出一点速度。你可以带着一种约定体验另一种，也可以全部暂停。运途中的箱子和已经备好的原料，不会因为改约而变成另一份承诺。';
  if (id === 'L06-4') return `第0街区没有得到一个不能更改的结局。留灯实际节省了${s.covenants.lightSaved / UNIT}电量，续建实际多完成${s.covenants.extraWork / UNIT}工程点，日期之间的列车实际少用${s.covenants.feeSaved / UNIT}电量；双约照看了${s.covenants.combined}秒。留下、继续、一起生活，都有过你的签名。0还留着空白，下一页可以重新商量。`;
  if (id === 'L05-1') return '两处分所的回信在同一天寄出，却写着不同的日期。旧站台抽屉里的维修单终于有了收件人：“日期：0。请让今天能够交班。”先修复旧城校时台；三地仍各自工作，新的日期不会替你决定生产什么。';
  if (id === 'L05-2') return '校时员拿出一只空盒：“还没用上的一刻，也可以收好。”每储一秒花0.20电量和0.02记忆；一次加工要60秒储备、一次校准，再花4电量和1记忆。原料须坐真实列车到达，整批备好后等待两地窗口；原来的列车、工务和住客不会跟着快进。装置与排程都还关着，启用的时机由你决定。';
  if (id === 'L05-3') return `雨城已经完成${s.calendar.boosts.rain.normal + s.calendar.boosts.rain.specialty}次历法加工，长站完成${s.calendar.boosts.station.normal + s.calendar.boosts.station.specialty}次。校时员把三处钟面画在同一张纸上：“对齐不是同时做同一件事，是知道什么时候交到下一双手里。”${s.calendar.crossRound ? `其中${s.calendar.crossRound}项真正等到了下一轮，货物仍以实际回程为准。` : '目前还没有跨轮完成的排程；写进清单不等于已经加工。'}三项清单只做你明确写下的工作，空下的位置不会自行填满。`;
  if (id === 'L05-4') return `名录第一次容得下三地的今天。${s.calendar.crossRound}项跨轮加工留下了交班记录，时间盒里还有${s.calendar.stored}秒，剩余${s.calendar.allowance}次校准。今天不再是空白，也不要求每一刻都被用完。下一页只写着一个问题：“这些共同承认的约定，能不能成为城市公约？”空白处的来信正等你阅读。`;
  if (id === 'L04-1') return '城市图翻到背面，还有一盏临时灯。门后的人问：“旧城的办法，能在这里用一次吗？”旧城会继续按现有安排工作，不会被重置。登记台需要真实材料；派去的人也仍占着原来的床位。你可以先读信，再决定什么时候开门。';
  if (id === 'L04-2') return `登记员把两张地图摆在桌上：无库巷没有仓库，借光庭留不住一半本地产出的光。带走的是${s.experience.blueprints.length}份已知蓝图与${s.experience.archives.length}份已读档案，不是复制一套库存或工具。每处先派两名空闲居民，旧城另转入20电量、20零件和8记忆；其后的补给每图一共四次，不会每天刷新。`;
  if (id === 'L04-3') {
    const first = s.completed.find(k => k === 'O01@O01-3' || k === 'O02@O02-3');
    return first === 'O01@O01-3' ? `无库巷第一次交班。屋檐${s.outposts.sites.O01?.roofPrefab ? `用了${s.outposts.sites.O01.roofPrefab}份预制构件` : '由工人逐段现场接好'}，现在信件可以写上0-101。地图交接还等你亲自确认，清单知识不会自动替你发下一包。` : `借光庭第一次交班。庭院记下了${s.outposts.sites.O02?.proof === 'relay' ? '旧城实际收到的追加电量与接力' : '本地发电者值守过的时间'}，现在信件可以写上0-102。回照灯架的图样等你确认交接；图样不是已经造好的设备。`;
  }
  if (id === 'L04-4') return `0-101和0-102都能收到信了。无库巷的屋檐${s.outposts.sites.O01?.roofPrefab ? `留下${s.outposts.sites.O01.roofPrefab}份预制的接缝` : '由现场施工连接'}，借光庭以${s.outposts.sites.O02?.proof === 'relay' ? '旧城接力' : '本地值守'}留下了证明。两份知识已经交接，封存不是遗忘，重入也不会重新领取物资。信纸角落写着一个尚未发生的日期——${s.experience.story['L05-1'] ? '日期为0的维修单已经收好，校时台留下了新的交接工作。' : '日期为0的维修单正等你阅读，三地的今天还需要一次修复。'}`;
  if (id === 'L03-1') return '车厢修好后，座位下面有一只空箱。箱盖写着长站站务员的称呼：“如果到站时还有空位，替候车的人留一把椅子。”它不是已经送到的货物，只留下一条回信地址。';
  if (id === 'L03-2') return s.events.E12?.choice === 'express' ? '站务员把运单压在箱底：“快班来得早，接头要更勤检查。”箱子没有额外奖励；等待的人知道该在哪一边抬头看车。' : '站务员在运单上画了一条平直的线：“稳班慢一点，接头就能多用几趟。”候车的人把椅子转向灯还亮着的一边。';
  if (id === 'L03-3') return '长站第0节不在车厢号码表上，却有人在那里交班。F06有限线索已经记下，实际运回轨芯后可去首访。强化货架增加20运量、每车多用2电；护轨挂架减四分之一磨损，保留原运量。图样还需委托或调查发现，方案由你选择。';
  if (id === 'L03-4') return `站务员回信：“明天仍会给这里留一只空箱。”现在${Object.values(s.network.routes).filter(r => r.contract.enabled).length}条合同启用，雨城${s.network.routes.rain.node.mode === 'specialty' ? '封装雨声' : '整理记忆'}，长站${s.network.routes.station.node.mode === 'specialty' ? '整备轨芯' : '回收旧轨'}；${s.network.vehicle.active === 'freightRack' ? '强化货架替货物多留了一格' : s.network.vehicle.active === 'railGuard' ? '护轨挂架替下一班照看接头' : '普通车辆仍按原来的运量运行'}。空白城市图留给未来的分所，尚未发现的胶片、轨芯和档案仍等你去认识。`;
  if (id === 'L02-1') return '邮递员沿着晾衣绳走来：“旧巷画进地图以后，终于不用先问路。”他指了指委托板：修灯的住客、巷口的老人都留了话。另一张纸上写着停在半层的楼梯——那扇门也应该有一个投递地址。F02有限线索已记下，先去首访确认住户。';
  if (id === 'L02-2') return s.events.E07?.choice === 'common' ? '两家在门牌背面画了一盏灯。“轮到谁，谁就留到晚一点。”邮递员不必分清先敲哪边，两扇窗已经商量好轮流照着路。共灯的经营效果保留。' : '门牌背面留着两行名字，笔迹深浅不同。“我们住得近，也可以各有自己的那一行。”邮递员照着两行字分别投递，各留姓名的经营效果保留。';
  if (id === 'L02-3') return `屋檐已经搭好，邮递员补上一份投递匣图样。“清单可以交给它，新的决定还得等你。”${commissionDone(s, 'CM03-2') ? '那封信已经投进窗口，窗后的人正在写回信。' : '窗口仍等你核实线索、完成投递，还没有记作送达。'}`;
  if (id === 'L02-4') return `地址簿把两扇窗写在同一页，邮递员终于知道每一封信该去哪里。${commissionDone(s, 'CM03-2') ? '这次投递已经完成，两家各自留下一张回执，等你去委托板收好。' : '那份窗口委托还没有投递，回执也仍在等；地址被找到，不等于信已经送达。'}${s.events.E07?.choice === 'common' ? '今晚留灯的人换成了另一家。' : '两行名字下面，各多了一枚小小的邮戳。'}`;
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
  if (definition.id === 'lightFrame' || definition.id === 'calendar:service') return 0;
  if (definition.id.startsWith('mod:') || definition.id.startsWith('blueprint:') || definition.id.startsWith('mailmod:') || definition.id.startsWith('vehiclemod:')) return 0;
  return Math.min(ASSEMBLY.maxPrefab, Math.floor(definition.cost.parts / ASSEMBLY.prefabParts), Math.floor(definition.work / (2 * ASSEMBLY.prefabWork)));
}
export function prefabricated(definition: ProjectDefinition, count: number): ProjectDefinition {
  if (!count) return definition;
  const payment: Amounts = { ...definition.cost, parts: definition.cost.parts - count * ASSEMBLY.prefabParts, component: definition.cost.component + count * UNIT };
  return { ...definition, cost: payment, work: definition.work - count * ASSEMBLY.prefabWork };
}
