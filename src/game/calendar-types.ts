import type { Amounts, ProductionMode, RouteId } from './types';

export interface CalendarOrder {
  uid: string;
  route: RouteId;
  mode: ProductionMode;
  supply: Amounts;
  product: Amounts;
  createdRound: number;
  earliestRound: number;
  prepared: boolean;
}
export interface CalendarRecord {
  uid: string;
  route: RouteId;
  mode: ProductionMode;
  createdRound: number;
  completedRound: number;
  second: number;
}
export interface CalendarState {
  originSecond: number | null;
  storage: { enabled: boolean; target: number; reserve: Amounts };
  stored: number;
  captured: number;
  allowance: number;
  services: number;
  enabled: boolean;
  orders: CalendarOrder[];
  nextOrder: number;
  boosts: Record<RouteId, Record<ProductionMode, number>>;
  crossRound: number;
  history: CalendarRecord[];
}
export interface CalendarReport {
  captured: number;
  used: number;
  services: number;
  boosts: CalendarState['boosts'];
  produced: Record<RouteId, Amounts>;
  queued: number;
  prepared: number;
  stored: number;
  allowance: number;
  reasons: string[];
}
export type CalendarAction =
  | { type: 'calendar-storage'; enabled: boolean; target: number; reserve: Amounts }
  | { type: 'calendar-storage-pause' }
  | { type: 'calendar-toggle'; enabled: boolean }
  | { type: 'calendar-add'; route: RouteId; mode: ProductionMode; delay: 0 | 1 | 2 }
  | { type: 'calendar-cancel'; uid: string }
  | { type: 'calendar-move'; uid: string; direction: -1 | 1 };
