import { amounts, cost, RESOURCES, UNIT } from './config';
import type { Amounts, CargoManifest, Direction, DistrictId, GameState, NetworkContract, NetworkRoute, NetworkState, ProductionMode, Resident, Resource, RouteId } from './types';

export const ROUTE_IDS: RouteId[] = ['rain', 'station'];
export const MODES: ProductionMode[] = ['normal', 'specialty'];
export const NETWORK_RULES = { condition: 1000, threshold: 200, wear: 100, reliableWear: 80, expressWear: 150, expressTime: 0.8, cycle: 60, capacity: 40 * UNIT, expandedCapacity: 80 * UNIT, repairCost: cost(12, 20), repairWork: 120 * UNIT, specialtyCapacity: 12 * UNIT, specialtyWarehouse: 4 * UNIT, maxSetting: 1_000_000 * UNIT };
export const ROUTES = {
  rain: { name: '雨城', project: 'P08', description: '雨一直下着，记忆需要新的外壳；雨声也能封存在一格胶片里。', capacity: amounts(100000, 160000, 100000, 0, 24000), supply: cost(20, 10), product: cost(0, 0, 12), seconds: 120, energy: 4000 },
  station: { name: '长站', project: 'P09', description: '交班记忆能换回旧轨材，也能把仍可使用的接头整备成轨芯。', capacity: amounts(120000, 160000, 100000, 0, 0, 24000), supply: cost(0, 12, 8), product: cost(32), seconds: 180, energy: 6000 }
} as const;
export const RECIPES = {
  rain: { normal: { name: '常规整理', supply: ROUTES.rain.supply, product: ROUTES.rain.product }, specialty: { name: '雨声封装', supply: cost(12, 10), product: cost(0, 0, 0, 0, 2) } },
  station: { normal: { name: '旧轨回收', supply: ROUTES.station.supply, product: ROUTES.station.product }, specialty: { name: '轨芯整备', supply: cost(0, 12, 6), product: cost(0, 0, 0, 0, 0, 2) } }
} as const;
export const productResource = (id: RouteId, mode: ProductionMode): Resource => mode === 'specialty' ? id === 'rain' ? 'rainFilm' : 'railCore' : id === 'rain' ? 'memory' : 'parts';
export function createNetwork(): NetworkState {
  const route = (): NetworkRoute => ({
    node: { resources: amounts(), received: amounts(), produced: amounts(), used: amounts(), shipped: amounts(), cycle: 0, mode: 'normal', batches: { normal: 0, specialty: 0 } },
    condition: 0, staff: null, trip: null,
    contract: { enabled: false, loads: 1, reserve: cost(50, 50, 20), targets: amounts(), buffer: 2, manifest: { normal: 1, specialty: 1 }, order: ['normal', 'specialty'] }, autoRepair: false,
    departures: 0, exports: 0, imports: 0
  });
  return { routes: { rain: route(), station: route() }, priority: [...ROUTE_IDS], nextTrip: 1, maintenance: 0, vehicle: { built: [], active: null }, legacyPending: false, rulesSince: null };
}
export const routeOpen = (s: GameState, id: RouteId) => s.completed.includes(ROUTES[id].project);
export const fleetSize = (s: GameState) => s.completed.includes('R06') ? 2 : s.completed.includes('P08') ? 1 : 0;
export const vehicleCapacity = (s: GameState) => (s.completed.includes('R06') ? NETWORK_RULES.expandedCapacity : NETWORK_RULES.capacity) + (s.network.vehicle.active === 'freightRack' ? 20000 : 0);
export const occupiedVehicles = (s: GameState) => ROUTE_IDS.filter(id => s.network.routes[id].trip).length;
export const awayWorkers = (s: GameState, district: DistrictId, resident: Resident) => ROUTE_IDS.filter(id => {
  const staff = s.network.routes[id].staff; return staff?.district === district && staff.resident === resident;
}).length;
export const routeWear = (s: GameState) => Math.ceil((s.events.E12?.choice === 'reliable' ? NETWORK_RULES.reliableWear : s.events.E12?.choice === 'express' ? NETWORK_RULES.expressWear : NETWORK_RULES.wear) * (s.network.vehicle.active === 'railGuard' ? 0.75 : 1));
export const travelSeconds = (s: GameState, id: RouteId) => Math.ceil(ROUTES[id].seconds * (s.events.E12?.choice === 'express' ? NETWORK_RULES.expressTime : 1));
export const departureEnergy = (s: GameState, id: RouteId) => ROUTES[id].energy + (s.network.vehicle.active === 'freightRack' ? 2000 : 0);
export const asManifest = (value: number | CargoManifest): CargoManifest => typeof value === 'number' ? { normal: value, specialty: 0 } : value;
export const validManifest = (v: CargoManifest) => !!v && MODES.every(mode => Number.isSafeInteger(v[mode]) && v[mode] >= 0 && v[mode] <= 32) && v.normal + v.specialty > 0;
export function cargoFor(id: RouteId, direction: Direction, value: number | CargoManifest, mode: ProductionMode = 'normal'): Amounts {
  const manifest = asManifest(value), cargo = amounts();
  for (const r of RESOURCES) cargo[r] = direction === 'outbound' ? RECIPES[id][mode].supply[r] * manifest.normal : RECIPES[id].normal.product[r] * manifest.normal + RECIPES[id].specialty.product[r] * manifest.specialty;
  return cargo;
}
export function reservedSpace(s: GameState, destination: 'home' | RouteId, excluding?: string): Amounts {
  const held = amounts();
  for (const id of ROUTE_IDS) {
    const trip = s.network.routes[id].trip;
    if (!trip?.spaceReserved || trip.uid === excluding || (trip.direction === 'inbound' ? destination !== 'home' : destination !== id)) continue;
    for (const r of RESOURCES) held[r] += trip.cargo[r];
  }
  return held;
}
export function inventoryLimits(s: GameState, capacity: Amounts): Amounts {
  const held = reservedSpace(s, 'home');
  return Object.fromEntries(RESOURCES.map(r => [r, capacity[r] - held[r]])) as Amounts;
}
const size = (cargo: Amounts) => RESOURCES.reduce((n, r) => n + cargo[r], 0);
function fits(s: GameState, id: RouteId, direction: Direction, cargo: Amounts, capacity: Amounts, excluding?: string) {
  const target = direction === 'outbound' ? s.network.routes[id].node.resources : s.resources;
  const cap = direction === 'outbound' ? ROUTES[id].capacity : capacity, held = reservedSpace(s, direction === 'outbound' ? id : 'home', excluding);
  return RESOURCES.every(r => target[r] + held[r] + cargo[r] <= cap[r]);
}
export function departureReason(s: GameState, id: RouteId, direction: Direction, value: number | CargoManifest, capacity: Amounts, reserve?: Amounts): string | null {
  const manifest = asManifest(value);
  if (!ROUTE_IDS.includes(id) || !['outbound', 'inbound'].includes(direction) || !validManifest(manifest) || direction === 'outbound' && manifest.specialty !== 0) return '请选择有效线路、方向与整份货物';
  if (!routeOpen(s, id)) return `先修复${id === 'rain' ? '末班车厢' : '长站货台'}`;
  const route = s.network.routes[id], cargo = cargoFor(id, direction, manifest, route.node.mode), fee = departureEnergy(s, id);
  if (!route.staff) return '需要外派一名空闲夜工';
  if (route.trip) return route.trip.remaining ? '本线列车仍在途中' : '到站列车等待空间卸货';
  if (occupiedVehicles(s) >= fleetSize(s)) return '共享列车已全部占用';
  if (size(cargo) > vehicleCapacity(s)) return '货物超过单车运量，请减少份数或研究联运调度';
  if (route.condition <= 0) return '线路状态耗尽，等待维护';
  const source = direction === 'outbound' ? s.resources : route.node.resources;
  if (RESOURCES.some(r => source[r] < cargo[r])) return direction === 'outbound' ? '本城补给不足' : '目的城市货物尚未备齐';
  if (s.resources.energy < fee + (direction === 'outbound' ? cargo.energy : 0)) return '发车运行电量不足';
  if (!fits(s, id, direction, cargo, capacity)) return s.network.legacyPending ? direction === 'outbound' ? '目的城市仓储不足' : '本城仓储不足' : direction === 'outbound' ? '目的城市仓储或在途预留空间不足' : '本城仓储或在途预留空间不足';
  if (reserve && RESOURCES.some(r => s.resources[r] - (direction === 'outbound' ? cargo[r] : 0) - (r === 'energy' ? fee : 0) < reserve[r])) return '自动合同等待本城保留库存';
  return null;
}
export function dispatch(s: GameState, id: RouteId, direction: Direction, value: number | CargoManifest, capacity: Amounts, log: (text: string) => void, reserve?: Amounts): string | null {
  const reason = departureReason(s, id, direction, value, capacity, reserve);
  if (reason) return reason;
  const route = s.network.routes[id], manifest = asManifest(value), cargo = cargoFor(id, direction, manifest, route.node.mode), source = direction === 'outbound' ? s.resources : route.node.resources, fee = departureEnergy(s, id), wear = routeWear(s);
  for (const r of RESOURCES) { source[r] -= cargo[r]; if (direction === 'outbound') s.ledger.exports[r] += cargo[r]; else route.node.shipped[r] += cargo[r]; }
  s.resources.energy -= fee; s.ledger.operating.energy += fee;
  const duration = travelSeconds(s, id), reserved = !s.network.legacyPending;
  route.trip = { uid: `t-${s.network.nextTrip++}`, direction, loads: manifest.normal + manifest.specialty, manifest: { ...manifest }, mode: route.node.mode, cargo, duration, remaining: duration, spaceReserved: reserved, fee: reserved ? fee : null, wear: reserved ? wear : null, capacity: reserved ? vehicleCapacity(s) : null };
  route.departures += 1; route.condition = Math.max(0, route.condition - wear);
  log(`${ROUTES[id].name}${direction === 'outbound' ? '补给' : '回程'}列车发车，装载${route.trip.loads}${reserved ? '包货物。目的地空间已预留。' : '份货物。'}`);
  return null;
}
export function validContract(id: RouteId, c: NetworkContract): boolean {
  const products = MODES.map(mode => productResource(id, mode));
  return typeof c.enabled === 'boolean' && (c.loads === 1 || c.loads === 2) && !!c.reserve && !!c.targets && RESOURCES.every(r => Number.isSafeInteger(c.reserve[r]) && c.reserve[r] >= 0 && c.reserve[r] <= NETWORK_RULES.maxSetting && Number.isSafeInteger(c.targets[r]) && c.targets[r] >= 0 && c.targets[r] <= NETWORK_RULES.maxSetting && (products.includes(r) || c.targets[r] === 0)) && Number.isSafeInteger(c.buffer) && c.buffer >= 1 && c.buffer <= 8 && validManifest(c.manifest) && Array.isArray(c.order) && c.order.length === 2 && new Set(c.order).size === 2 && MODES.every(mode => c.order.includes(mode));
}
export function contractPlan(s: GameState, id: RouteId, capacity: Amounts): { direction: Direction; manifest: CargoManifest } | { reason: string } {
  const route = s.network.routes[id], c = route.contract, manifest = { normal: 0, specialty: 0 };
  let room = vehicleCapacity(s);
  const held = reservedSpace(s, 'home');
  for (const mode of c.order) {
    const r = productResource(id, mode), unit = RECIPES[id][mode].product[r], gap = c.targets[r] - s.resources[r] - held[r];
    const count = Math.max(0, Math.min(c.manifest[mode], Math.ceil(gap / unit), Math.floor(route.node.resources[r] / unit), Math.floor((capacity[r] - s.resources[r] - held[r]) / unit), Math.floor(room / unit)));
    manifest[mode] = count; room -= count * unit;
  }
  if (manifest.normal + manifest.specialty > 0) return { direction: 'inbound', manifest };
  const current = route.node.mode, resource = productResource(id, current);
  if (c.targets[resource] <= s.resources[resource] + held[resource]) return { reason: MODES.every(mode => c.targets[productResource(id, mode)] <= s.resources[productResource(id, mode)] + held[productResource(id, mode)]) ? '产物目标已满足，合同待命' : '当前模式没有需求；另一产物需手动切换模式或等待现存货物' };
  if (!c.manifest[current]) return { reason: '当前产物的取货包数为0，等待调整合同货单' };
  const recipe = RECIPES[id][current], reserved = reservedSpace(s, id);
  const inputs = RESOURCES.filter(r => recipe.supply[r] > 0);
  const needed = Math.max(...inputs.map(r => Math.ceil((recipe.supply[r] * c.buffer - route.node.resources[r] - reserved[r]) / recipe.supply[r])));
  if (needed <= 0) return { reason: '外城补给缓冲已足，等待生产与可取货空间' };
  let count = Math.min(32, needed, Math.floor(vehicleCapacity(s) / size(recipe.supply)));
  for (const r of inputs) count = Math.min(count, Math.floor((ROUTES[id].capacity[r] - route.node.resources[r] - reserved[r]) / recipe.supply[r]), Math.floor(Math.max(0, s.resources[r] - c.reserve[r] - (r === 'energy' ? departureEnergy(s, id) : 0)) / recipe.supply[r]));
  if (count < 1) return { reason: '等待补给、保留库存或目的城市预留空间' };
  return { direction: 'outbound', manifest: { normal: count, specialty: 0 } };
}
export function tickNetwork(s: GameState, capacity: Amounts, log: (text: string) => void) {
  for (const id of ROUTE_IDS) {
    if (!routeOpen(s, id)) continue;
    const route = s.network.routes[id], node = route.node, trip = route.trip;
    if (trip) {
      if (trip.remaining > 0) trip.remaining -= 1;
      if (trip.remaining === 0 && fits(s, id, trip.direction, trip.cargo, capacity, trip.uid)) {
        const target = trip.direction === 'outbound' ? node.resources : s.resources;
        for (const r of RESOURCES) { target[r] += trip.cargo[r]; if (trip.direction === 'outbound') node.received[r] += trip.cargo[r]; else s.ledger.imports[r] += trip.cargo[r]; }
        if (trip.direction === 'outbound') route.exports += 1; else route.imports += 1;
        log(`${ROUTES[id].name}${trip.direction === 'outbound' ? '收到补给' : '物资回到第0街区'}，已完整卸货。`); route.trip = null;
      }
    }
    const mode = s.network.legacyPending ? 'normal' : node.mode, recipe = RECIPES[id][mode];
    node.cycle = Math.min(NETWORK_RULES.cycle, node.cycle + 1);
    const held = reservedSpace(s, id);
    if (node.cycle === NETWORK_RULES.cycle && RESOURCES.every(r => node.resources[r] >= recipe.supply[r] && node.resources[r] + held[r] + recipe.product[r] - recipe.supply[r] <= ROUTES[id].capacity[r])) {
      for (const r of RESOURCES) { node.resources[r] += recipe.product[r] - recipe.supply[r]; node.produced[r] += recipe.product[r]; node.used[r] += recipe.supply[r]; }
      node.batches[mode] += 1; node.cycle = 0;
    }
  }
  for (const id of s.network.priority) {
    const route = s.network.routes[id];
    if (!route.contract.enabled || !routeOpen(s, id)) continue;
    if (s.network.legacyPending) {
      const { loads, reserve } = route.contract;
      if (dispatch(s, id, 'inbound', loads, capacity, log, reserve)) dispatch(s, id, 'outbound', loads, capacity, log, reserve);
    } else {
      const plan = contractPlan(s, id, capacity);
      if ('direction' in plan) dispatch(s, id, plan.direction, plan.manifest, capacity, log, route.contract.reserve);
    }
  }
}
export function networkReasons(s: GameState, capacity: Amounts): string[] {
  const reasons: string[] = [];
  for (const id of ROUTE_IDS) {
    const route = s.network.routes[id]; if (!routeOpen(s, id)) continue;
    if (route.trip?.remaining === 0) reasons.push(`${ROUTES[id].name}${s.network.legacyPending ? '' : '旧'}列车等待仓储空间卸货`);
    if (!route.contract.enabled || route.trip) continue;
    if (s.network.legacyPending) {
      const incoming = departureReason(s, id, 'inbound', route.contract.loads, capacity, route.contract.reserve);
      const outgoing = departureReason(s, id, 'outbound', route.contract.loads, capacity, route.contract.reserve);
      if (incoming && outgoing) reasons.push(`${ROUTES[id].name}合同：${incoming}；${outgoing}`);
      continue;
    }
    const plan = contractPlan(s, id, capacity);
    const reason = 'reason' in plan ? plan.reason : departureReason(s, id, plan.direction, plan.manifest, capacity, route.contract.reserve);
    if (reason) reasons.push(`${ROUTES[id].name}合同：${reason}`);
  }
  return reasons;
}
export function networkProof(s: GameState, capacity: Amounts): boolean {
  return ROUTE_IDS.some(id => {
    const route = s.network.routes[id], c = route.contract;
    if (!routeOpen(s, id) || !c.enabled || !route.staff || route.condition <= 0 || !MODES.some(mode => c.targets[productResource(id, mode)] > 0)) return false;
    if (MODES.every(mode => s.resources[productResource(id, mode)] >= c.targets[productResource(id, mode)])) return true;
    const trip = route.trip;
    if (trip) {
      // This trip's fee is already paid, but its load must still serve a
      // current demand. Old unreserved loads must also be able to unload.
      if (!fits(s, id, trip.direction, trip.cargo, capacity, trip.uid)) return false;
      return MODES.some(mode => {
        const r = productResource(id, mode), recipe = RECIPES[id][mode];
        if (s.resources[r] >= c.targets[r]) return false;
        if (trip.direction === 'inbound') return trip.cargo[r] > 0;
        if (!c.manifest[mode] || size(recipe.product) > vehicleCapacity(s) || !fits(s, id, 'inbound', recipe.product, capacity)) return false;
        if (route.node.resources[r] >= recipe.product[r]) return true;
        return mode === route.node.mode && RESOURCES.every(input => {
          const available = route.node.resources[input] + trip.cargo[input];
          return available >= recipe.supply[input] && available - recipe.supply[input] + recipe.product[input] <= ROUTES[id].capacity[input];
        });
      });
    }
    const plan = contractPlan(s, id, capacity);
    if ('direction' in plan && (plan.direction === 'inbound' || fits(s, id, 'inbound', RECIPES[id][route.node.mode].product, capacity)) && !departureReason(s, id, plan.direction, plan.manifest, capacity, c.reserve)) return true;
    // Existing supplies can serve current demand without filling the buffer.
    // Prove one whole production and return, including pickup, space and fee,
    // independently of the immediate dispatch plan or its displayed stop reason.
    const mode = route.node.mode, resource = productResource(id, mode);
    if (!c.manifest[mode] || c.targets[resource] <= s.resources[resource] + reservedSpace(s, 'home')[resource] || occupiedVehicles(s) >= fleetSize(s)) return false;
    const recipe = RECIPES[id][mode], cargo = recipe.product;
    return size(cargo) <= vehicleCapacity(s) && fits(s, id, 'inbound', cargo, capacity) &&
      RESOURCES.every(r => route.node.resources[r] >= recipe.supply[r] && route.node.resources[r] - recipe.supply[r] + cargo[r] <= ROUTES[id].capacity[r] && s.resources[r] - (r === 'energy' ? departureEnergy(s, id) : 0) >= c.reserve[r]);
  });
}
