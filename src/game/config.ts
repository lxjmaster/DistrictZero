import type { Amounts, Facility, Flow, Job, Lighting, ProjectDefinition, Resident, Resource, EventId } from './types';

export const UNIT = 1000;
export const BALANCE_VERSION = '0.3.1';
export const BASE_RESOURCES = ['energy', 'parts', 'memory'] as const;
export const RESOURCES: Resource[] = ['energy', 'parts', 'memory', 'component'];
export const JOBS: Job[] = ['power', 'salvage', 'repair', 'record', 'assemble'];
export const WORK_JOBS = ['salvage', 'repair', 'record', 'assemble'] as const;
export const RESIDENTS: Resident[] = ['shadow', 'echo'];
export const FACILITY_IDS: Facility[] = ['generator', 'recycler', 'workbench', 'dorm', 'warehouse', 'mailbox'];
export const EVENT_IDS: EventId[] = ['E01', 'E02', 'E03', 'E04', 'E05', 'E06', 'E07', 'E08', 'E09', 'E10', 'E11', 'E12', 'E13', 'E14', 'E15'];
export const FLOWS: Flow[] = ['production', 'rewards', 'operating', 'reserved', 'refunds', 'exports', 'imports', 'fulfillment'];
export const resourceNames = { energy: '电量', parts: '零件', memory: '记忆', component: '标准构件' };
export const flowNames = { production: '实际生产', rewards: '领取奖励', operating: '运行消耗', reserved: '工程预留', refunds: '实际返还', exports: '发出货物', imports: '运回物资', fulfillment: '支线与拆回支出' };
export const residentNames = { shadow: '影子居民', echo: '回声居民' };
export const jobNames = { power: '发电工', salvage: '回收工', repair: '维修工', record: '记录员', assemble: '装配工' };
export const jobFacility: Record<Job, Facility> = { power: 'generator', salvage: 'recycler', repair: 'workbench', record: 'mailbox', assemble: 'workbench' };
export const amounts = (energy = 0, parts = 0, memory = 0, component = 0): Amounts => ({ energy, parts, memory, component });
export const cost = (parts = 0, energy = 0, memory = 0, component = 0) => amounts(energy * UNIT, parts * UNIT, memory * UNIT, component * UNIT);
export const INITIAL = { resources: amounts(30000, 10000, 0), capacities: amounts(200000, 100000, 60000), population: 2 };
export const RULES = { maxLevel: 3, maxQueue: 3, arrivalSeconds: 120, switchParts: 5000, costGrowth: 1.18, workGrowth: 1.15, efficiencyGrowth: 0.15, bedsPerDormLevel: 2, firstEchoArrivals: 2, warehouseUnlockParts: 50000, platformUnlockMemory: 30000, researchUnlockMemory: 20000 };
export const WAREHOUSE_CAPACITY = amounts(100000, 150000, 20000);
export const TRAITS = { shadowSalvage: 1.2, echoMemory: 1.2 };
export const RESEARCH_EFFECTS = { R01: 1.2, R02: 1.2 };
export const BASE = { power: 500, salvage: 200, repair: 1000, record: 50 };
export const INPUTS = { salvage: amounts(100), repair: amounts(150), record: amounts(50, 30) };
export const POLICIES: Record<Lighting, { name: string; upkeep: number; salvage: number; record: number; text: string }> = {
  steady: { name: '常灯', upkeep: 50, salvage: 1, record: 1, text: '每秒维护 0.05 电量，保持平常的光。' },
  bright: { name: '明灯', upkeep: 100, salvage: 1, record: 1.25, text: '每秒维护 0.10 电量，记忆产出 +25%。' },
  dim: { name: '暗灯', upkeep: 100, salvage: 1.25, record: 0.9, text: '每秒维护 0.10 电量，回收产出 +25%，记忆产出 −10%。' }
};
export const FACILITIES: Record<Facility, { name: string; cost: Amounts; work: number; description: string; mark: string }> = {
  generator: { name: '手摇发电机', cost: cost(24), work: 90000, description: '摇动的时候，远处也有一盏灯跟着亮。提高发电效率与岗位容量。', mark: '01' },
  recycler: { name: '回收棚', cost: cost(24, 10), work: 90000, description: '失物招领处拒绝接收的东西，在这里有了用途。提高回收效率与岗位容量。', mark: '02' },
  workbench: { name: '维修台', cost: cost(30, 10, 4), work: 120000, description: '抽屉里总有一把合适的扳手。提高维修效率与岗位容量。', mark: '03' },
  dorm: { name: '夜居民宿舍', cost: cost(30, 15), work: 120000, description: '床头写着：名字可以明天再填。每级增加 2 个住处，最多 8 位居民。', mark: '04' },
  warehouse: { name: '后场仓库', cost: cost(40, 20), work: 150000, description: '不再把未来堆在门口。每级增加 150 零件、100 电量、20 记忆容量。', mark: '05' },
  mailbox: { name: '回声信箱', cost: cost(45, 20, 4), work: 150000, description: '邮件偶尔先于寄件人到达。开放记录员，提高记忆效率与岗位容量。', mark: '06' }
};
export const PROJECTS = {
  P01: { id: 'P01', name: '让临时路灯亮起', description: '先让经过的人看见这里。完成后开放宿舍与居民到达；事件奖励 6 记忆。', cost: cost(15, 10), work: 60000 },
  P02: { id: 'P02', name: '给站牌写上“0”', description: '空着的那一行，也是一条线路。完成后开放回声信箱；事件奖励 8 记忆。', cost: cost(20, 15), work: 120000 },
  P03: { id: 'P03', name: '修复旧站台', description: '让这里有地方可去。完成首章，登记第一个有效地址 0-001。', cost: cost(180, 100, 25), work: 900000 },
  R01: { id: 'R01', name: '工具规范', description: '给每一把工具一个确定的位置。维修进度永久提升 20%。', cost: cost(50, 0, 20), work: 300000 },
  R02: { id: 'R02', name: '回声整理', description: '把声音放回它发生的地方。记忆产出永久提升 20%。', cost: cost(50, 0, 20), work: 300000 },
  P04: { id: 'P04', name: '测绘没有尽头的旧巷', description: '巷子每晚多出一扇窗。沿着仍有人使用的路测绘，登记旧巷 0-002，开放迁居与分区建设。', cost: cost(100, 60, 20), work: 450000 },
  P05: { id: 'P05', name: '为信笺里补上门牌', description: '那些没有收件地址的信，终于有了住处。登记信笺里 0-003，与第0街区相连。', cost: cost(120, 60, 25), work: 540000 },
  P06: { id: 'P06', name: '编成夜城地址簿', description: '给两个新区各留下至少两位居民，在第0街区建成配电亭与门牌事务所，确认如何共用门牌。三个地方开始互相找到。', cost: cost(160, 80, 35), work: 720000 },
  P07: { id: 'P07', name: '接通雨城联络线', description: '维持回收与记录两种专业街区，给第0街区的两种公共设施供电。线路图的终点终于可以写下雨城。', cost: cost(220, 120, 50), work: 900000 },
  R03: { id: 'R03', name: '地址索引', description: '不必从头查完所有门牌。居民到达间隔从 120 秒缩短为 90 秒。', cost: cost(60, 20, 20), work: 300000 },
  R04: { id: 'R04', name: '巡检手册', description: '把下一次检查写进值班安排。开放按区自动巡检：设备状态不超过 300 时加入队尾；开放线路后也可安排自动维护。', cost: cost(80, 30, 25), work: 360000 },
  P08: { id: 'P08', name: '修复末班车厢', description: '雨城已经接起电话，还需要一辆真的会抵达的车。修复车厢，开放雨城供需、外派夜工与第一辆共享列车。', cost: cost(120, 80, 30), work: 420000 },
  P09: { id: 'P09', name: '恢复长站货台', description: '雨城送回第一只箱子后，长站也寄来运单。把站务记忆与电量送过去，旧轨材就能回到街区。', cost: cost(160, 100, 40), work: 540000 },
  P10: { id: 'P10', name: '编定联运时刻表', description: '雨城和长站都完成过回程，运单规范与联运调度已经研究。让两条线开始共用一张可靠的时刻表。', cost: cost(200, 100, 50), work: 720000 },
  P11: { id: 'P11', name: '让末班车每天抵达', description: '两地各完成至少两次回程，启用两个供货合同，安排两位外派夜工并维护线路。让抵达成为可以信任的日常，完成第三章。', cost: cost(240, 140, 60), work: 900000 },
  R05: { id: 'R05', name: '运单规范', description: '记录货物份数与本城保留库存。处理雨城的第一份回程来信后，可按优先级自动补给和取货。', cost: cost(80, 40, 25), work: 360000 },
  R06: { id: 'R06', name: '联运调度', description: '长站恢复后，把空闲车厢也编进班次。共享列车增至2辆，单车运量从40增至80，可安排整车2份货物。', cost: cost(100, 60, 30), work: 420000 }
} satisfies Record<string, ProjectDefinition>;
export const EVENTS: Record<EventId, { name: string; text: string; reward: Amounts }> = {
  E01: { name: '第一盏灯', text: '灯亮了。两名夜工抬起头，其中一位说：“原来我们在这里。”另一位把这句话记在交接单背面。纸上终于留下了字。', reward: cost(0, 0, 6) },
  E02: { name: '站牌上的0', text: '你给站牌写上0。没有车来，但玻璃后面多出了一张线路图。第一站就是这里，终点那一格还空着。', reward: cost(0, 0, 8) },
  E03: { name: '有人来住', text: '新住客敲了三下门，声音却敲了四下。“多出来那一下是昨天的。”他问：夜里要把灯调亮一点，还是给影子留些暗处？', reward: cost() },
  E04: { name: '一封明天的信', text: '信箱里有一封日期写着“明天”的信：“工具请按规范归还，回声请按发生顺序整理。”落款是你，字迹也是你。两份研究方案夹在信里。', reward: cost() },
  E05: { name: '第一个地址', text: '名录终于接受了这行字：第0街区，0-001。站台广播说：“这里是第一站。”外部来信随即抵达：有一座雨城正在等工务人员。先测绘站台旁的旧巷，把眼前的地方连起来。未来有了投递地址。', reward: cost() },
  E06: { name: '巷子的另一端', text: '旧巷里的人一直在等你画完最后一条线。“这条巷子没有尽头吗？”你问。老人指着晾衣绳：“有，我们每天都走到这儿。”你以那件没有干的衬衫为界，写下0-002。空闲夜工现在可以迁居；灯光会替新住客指路。', reward: cost(0, 0, 12) },
  E07: { name: '两家共用一块门牌', text: '信笺里两家人都叫自己“最后一家”。邮递员把两封信投进同一扇窗，窗后传来两声谢谢。事务所问：门牌可以共用一盏灯，还是给每个名字留一行？他们说，只要还能找到彼此，就都可以。', reward: cost() },
  E08: { name: '有了各自的手艺', text: '旧物被送到擅长回收的地方，旧声音被送到愿意倾听的地方。一名夜工说：“原来不用每一条街都做所有的事。”袋子里多了三十枚整理好的零件，纸上留下了八段清楚的记忆。', reward: cost(30, 0, 8) },
  E09: { name: '夜城有了通讯录', text: '通讯录第一页写着0-001，第二页写着0-002，第三页写着0-003。有人在封底写下：“走错也没关系，从任何一页都能问到路。”你把站牌背面的线路图展开，这一次，空白的终点旁有了一个电话号码。', reward: cost(0, 0, 15) },
  E10: { name: '雨城接起了电话', text: '电话里一直下着雨。“您好，这里是第0街区。”你说。对方停了一会儿：“我们找了很久。”第一条对外线路在地图上亮起。先修复末班车厢，让电话里的问候有机会变成真正的抵达。', reward: cost() },
  E11: { name: '末班车认出了站台', text: '司机把站牌看了两遍：“上次经过时，这里还没有名字。”你把第一份补给装上车。雨城有自己的仓库，零件和电量要真的送到，记忆才能跟着下一班车回来。先撤回一位夜工的岗位，再安排外派；住处一直替他留着。', reward: cost() },
  E12: { name: '雨城送回的第一只箱子', text: '箱子是干的，里面却有雨声。随车的运单问：往后的列车应该慢一点、稳一点，还是尽快让等待的人收到消息？没有人催你签字，车站会把这张单子留下。', reward: cost() },
  E13: { name: '长站有人留灯', text: '长站的站务员说，站台太长，灯就不能只亮一头。你把交班记忆和电量送去，他们把整理好的旧轨材运回来。“下次不必打电话，我们按运单等。”', reward: cost() },
  E14: { name: '同一张时刻表', text: '三座城第一次在同一张纸上写下自己的需要。雨城的字有些洇开，长站的横线一直画到纸边。你在第0街区那一行留了足够的空白，写下备用库存。列车终于可以按约定继续。', reward: cost() },
  E15: { name: '每天都有人在等', text: '末班车抵达时，站台上已经有人等着接货。没有庆典，大家只是核对完运单，问起明天。最后一只空箱里夹着一张没有落成的城市图，角落写着：“如果开一间分所，这里也能等到车吗？”', reward: cost() }
};
