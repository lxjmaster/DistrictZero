import { amounts, cost, RESOURCES, UNIT } from './config';
import type { Amounts, Direction, DistrictId, GameState, NetworkRoute, NetworkState, Resident, RouteId } from './types';

export const ROUTE_IDS: RouteId[] = ['rain', 'station'];
export const NETWORK_RULES = { condition: 1000, threshold: 200, wear: 100, reliableWear: 80, expressWear: 150, expressTime: 0.8, cycle: 60, capacity: 40 * UNIT, expandedCapacity: 80 * UNIT, repairCost: cost(12, 20), repairWork: 120 * UNIT };
export const ROUTES = {
  rain: { name: '雨城', project: 'P08', description: '雨一直下着，记忆需要有人送来新的外壳。补给电量与零件，取回整理好的记忆。', capacity: amounts(100000, 160000, 100000), supply: cost(20, 10), product: cost(0, 0, 12), seconds: 120, energy: 4000 },
  station: { name: '长站', project: 'P09', description: '站台很长，交班的人总能记得你。送来站务记忆和电量，旧轨材就有机会回到街区。', capacity: amounts(120000, 160000, 100000), supply: cost(0, 12, 8), product: cost(32), seconds: 180, energy: 6000 }
} as const;
export function createNetwork(): NetworkState {
  const route = (): NetworkRoute => ({
    node: { resources: amounts(), received: amounts(), produced: amounts(), used: amounts(), shipped: amounts(), cycle: 0 },
    condition: 0, staff: null, trip: null, contract: { enabled: false, loads: 1, reserve: cost(50, 50, 20) }, autoRepair: false,
    departures: 0, exports: 0, imports: 0
  });
  return { routes: { rain: route(), station: route() }, priority: [...ROUTE_IDS], nextTrip: 1, maintenance: 0 };
}
export const routeOpen = (s: GameState, id: RouteId) => s.completed.includes(ROUTES[id].project);
export const fleetSize = (s: GameState) => s.completed.includes('R06') ? 2 : s.completed.includes('P08') ? 1 : 0;
export const vehicleCapacity = (s: GameState) => s.completed.includes('R06') ? NETWORK_RULES.expandedCapacity : NETWORK_RULES.capacity;
export const occupiedVehicles = (s: GameState) => ROUTE_IDS.filter(id => s.network.routes[id].trip).length;
export const awayWorkers = (s: GameState, district: DistrictId, resident: Resident) => ROUTE_IDS.filter(id => {
  const staff = s.network.routes[id].staff; return staff?.district === district && staff.resident === resident;
}).length;
export const routeWear = (s: GameState) => s.events.E12?.choice === 'reliable' ? NETWORK_RULES.reliableWear : s.events.E12?.choice === 'express' ? NETWORK_RULES.expressWear : NETWORK_RULES.wear;
export const travelSeconds = (s: GameState, id: RouteId) => Math.ceil(ROUTES[id].seconds * (s.events.E12?.choice === 'express' ? NETWORK_RULES.expressTime : 1));
export function cargoFor(id: RouteId, direction: Direction, loads: number): Amounts {
  const cargo = direction === 'outbound' ? ROUTES[id].supply : ROUTES[id].product;
  return amounts(cargo.energy * loads, cargo.parts * loads, cargo.memory * loads);
}
const fits = (stock: Amounts, cargo: Amounts, capacity: Amounts) => RESOURCES.every(r => stock[r] + cargo[r] <= capacity[r]);
export function departureReason(s: GameState, id: RouteId, direction: Direction, loads: number, capacity: Amounts, reserve?: Amounts): string | null {
  if (!ROUTE_IDS.includes(id) || !['outbound', 'inbound'].includes(direction) || (loads !== 1 && loads !== 2)) return '请选择有效线路、方向与整份货物';
  if (!routeOpen(s, id)) return `先修复${id === 'rain' ? '末班车厢' : '长站货台'}`;
  const route = s.network.routes[id], config = ROUTES[id], cargo = cargoFor(id, direction, loads);
  if (!route.staff) return '需要外派一名空闲夜工';
  if (route.trip) return route.trip.remaining ? '本线列车仍在途中' : '到站列车等待空间卸货';
  if (occupiedVehicles(s) >= fleetSize(s)) return '共享列车已全部占用';
  if (RESOURCES.reduce((n, r) => n + cargo[r], 0) > vehicleCapacity(s)) return '货物超过单车运量，请减少份数或研究联运调度';
  if (route.condition <= 0) return '线路状态耗尽，等待维护';
  const source = direction === 'outbound' ? s.resources : route.node.resources;
  if (RESOURCES.some(r => source[r] < cargo[r])) return direction === 'outbound' ? '本城补给不足' : '目的城市特产尚未备齐';
  if (s.resources.energy < config.energy + (direction === 'outbound' ? cargo.energy : 0)) return '发车运行电量不足';
  if (!fits(direction === 'outbound' ? route.node.resources : s.resources, cargo, direction === 'outbound' ? config.capacity : capacity)) return direction === 'outbound' ? '目的城市仓储不足' : '本城仓储不足';
  if (reserve && RESOURCES.some(r => s.resources[r] - (direction === 'outbound' ? cargo[r] : 0) - (r === 'energy' ? config.energy : 0) < reserve[r])) return '自动合同等待本城保留库存';
  return null;
}
export function dispatch(s: GameState, id: RouteId, direction: Direction, loads: 1 | 2, capacity: Amounts, log: (text: string) => void, reserve?: Amounts): string | null {
  const reason = departureReason(s, id, direction, loads, capacity, reserve);
  if (reason) return reason;
  const route = s.network.routes[id], config = ROUTES[id], cargo = cargoFor(id, direction, loads), source = direction === 'outbound' ? s.resources : route.node.resources;
  for (const r of RESOURCES) {
    source[r] -= cargo[r];
    if (direction === 'outbound') s.ledger.exports[r] += cargo[r]; else route.node.shipped[r] += cargo[r];
  }
  s.resources.energy -= config.energy; s.ledger.operating.energy += config.energy;
  const duration = travelSeconds(s, id);
  route.trip = { uid: `t-${s.network.nextTrip++}`, direction, loads, cargo, duration, remaining: duration };
  route.departures += 1; route.condition = Math.max(0, route.condition - routeWear(s));
  log(`${config.name}${direction === 'outbound' ? '补给' : '回程'}列车发车，装载${loads}份货物。`);
  return null;
}
export function tickNetwork(s: GameState, capacity: Amounts, log: (text: string) => void) {
  for (const id of ROUTE_IDS) {
    if (!routeOpen(s, id)) continue;
    const route = s.network.routes[id], config = ROUTES[id], node = route.node, trip = route.trip;
    if (trip) {
      if (trip.remaining > 0) trip.remaining -= 1;
      const target = trip.direction === 'outbound' ? node.resources : s.resources, cap = trip.direction === 'outbound' ? config.capacity : capacity;
      if (trip.remaining === 0 && fits(target, trip.cargo, cap)) {
        for (const r of RESOURCES) {
          target[r] += trip.cargo[r];
          if (trip.direction === 'outbound') node.received[r] += trip.cargo[r]; else s.ledger.imports[r] += trip.cargo[r];
        }
        if (trip.direction === 'outbound') route.exports += 1; else route.imports += 1;
        log(`${config.name}${trip.direction === 'outbound' ? '收到补给' : '物资回到第0街区'}，已完整卸货。`);
        route.trip = null;
      }
    }
    node.cycle = Math.min(NETWORK_RULES.cycle, node.cycle + 1);
    if (node.cycle === NETWORK_RULES.cycle && RESOURCES.every(r => node.resources[r] >= config.supply[r]) && fits(node.resources, config.product, config.capacity)) {
      for (const r of RESOURCES) { node.resources[r] += config.product[r] - config.supply[r]; node.produced[r] += config.product[r]; node.used[r] += config.supply[r]; }
      node.cycle = 0;
    }
  }
  for (const id of s.network.priority) {
    const route = s.network.routes[id];
    if (!route.contract.enabled || !routeOpen(s, id)) continue;
    const { loads, reserve } = route.contract;
    if (dispatch(s, id, 'inbound', loads, capacity, log, reserve)) dispatch(s, id, 'outbound', loads, capacity, log, reserve);
  }
}
export function networkReasons(s: GameState, capacity: Amounts): string[] {
  const reasons: string[] = [];
  for (const id of ROUTE_IDS) {
    const route = s.network.routes[id];
    if (!routeOpen(s, id)) continue;
    if (route.trip?.remaining === 0) reasons.push(`${ROUTES[id].name}列车等待仓储空间卸货`);
    if (!route.contract.enabled || route.trip) continue;
    const incoming = departureReason(s, id, 'inbound', route.contract.loads, capacity, route.contract.reserve);
    const outgoing = departureReason(s, id, 'outbound', route.contract.loads, capacity, route.contract.reserve);
    if (incoming && outgoing) reasons.push(`${ROUTES[id].name}合同：${incoming}；${outgoing}`);
  }
  return reasons;
}
