import type { Amounts, Facility, Flow, Job, Lighting, ProjectDefinition, Resident, Resource, EventId } from './types';

export const UNIT = 1000;
export const BALANCE_VERSION = '0.1.0';
export const RESOURCES: Resource[] = ['energy', 'parts', 'memory'];
export const JOBS: Job[] = ['power', 'salvage', 'repair', 'record'];
export const RESIDENTS: Resident[] = ['shadow', 'echo'];
export const FACILITY_IDS: Facility[] = ['generator', 'recycler', 'workbench', 'dorm', 'warehouse', 'mailbox'];
export const EVENT_IDS: EventId[] = ['E01', 'E02', 'E03', 'E04', 'E05'];
export const FLOWS: Flow[] = ['production', 'rewards', 'operating', 'reserved', 'refunds'];
export const resourceNames = { energy: '电量', parts: '零件', memory: '记忆' };
export const flowNames = { production: '实际生产', rewards: '领取奖励', operating: '运行消耗', reserved: '工程预留', refunds: '取消返还' };
export const residentNames = { shadow: '影子居民', echo: '回声居民' };
export const jobNames = { power: '发电工', salvage: '回收工', repair: '维修工', record: '记录员' };
export const jobFacility: Record<Job, Facility> = { power: 'generator', salvage: 'recycler', repair: 'workbench', record: 'mailbox' };
export const amounts = (energy = 0, parts = 0, memory = 0): Amounts => ({ energy, parts, memory });
export const cost = (parts = 0, energy = 0, memory = 0) => amounts(energy * UNIT, parts * UNIT, memory * UNIT);
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
export const PROJECTS: Record<'P01' | 'P02' | 'P03' | 'R01' | 'R02', ProjectDefinition> = {
  P01: { id: 'P01', name: '让临时路灯亮起', description: '先让经过的人看见这里。完成后开放宿舍与居民到达；事件奖励 6 记忆。', cost: cost(15, 10), work: 60000 },
  P02: { id: 'P02', name: '给站牌写上“0”', description: '空着的那一行，也是一条线路。完成后开放回声信箱；事件奖励 8 记忆。', cost: cost(20, 15), work: 120000 },
  P03: { id: 'P03', name: '修复旧站台', description: '让这里有地方可去。完成首章，登记第一个有效地址 0-001。', cost: cost(180, 100, 25), work: 900000 },
  R01: { id: 'R01', name: '工具规范', description: '给每一把工具一个确定的位置。维修进度永久提升 20%。', cost: cost(50, 0, 20), work: 300000 },
  R02: { id: 'R02', name: '回声整理', description: '把声音放回它发生的地方。记忆产出永久提升 20%。', cost: cost(50, 0, 20), work: 300000 }
};
export const EVENTS: Record<EventId, { name: string; text: string; reward: Amounts }> = {
  E01: { name: '第一盏灯', text: '灯亮了。两名夜工抬起头，其中一位说：“原来我们在这里。”另一位把这句话记在交接单背面。纸上终于留下了字。', reward: cost(0, 0, 6) },
  E02: { name: '站牌上的0', text: '你给站牌写上0。没有车来，但玻璃后面多出了一张线路图。第一站就是这里，终点那一格还空着。', reward: cost(0, 0, 8) },
  E03: { name: '有人来住', text: '新住客敲了三下门，声音却敲了四下。“多出来那一下是昨天的。”他问：夜里要把灯调亮一点，还是给影子留些暗处？', reward: cost() },
  E04: { name: '一封明天的信', text: '信箱里有一封日期写着“明天”的信：“工具请按规范归还，回声请按发生顺序整理。”落款是你，字迹也是你。两份研究方案夹在信里。', reward: cost() },
  E05: { name: '第一个地址', text: '名录终于接受了这行字：第0街区，0-001。站台广播说：“这里是第一站。”外部来信随即抵达：有一座雨城正在等工务人员。你把信放好，未来有了投递地址。', reward: cost() }
};
