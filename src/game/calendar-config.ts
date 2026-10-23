import { amounts, cost, RESOURCES } from './config';
import type { CalendarState } from './calendar-types';
import type { Amounts, GameState, RouteId } from './types';

export const CALENDAR_RULES = {
  round: 600, steps: 60, initialCapacity: 300, capacity: 600,
  initialAllowance: 6, serviceAllowance: 3, history: 12,
  captureCost: cost(0, 0.2, 0.02), boostCost: cost(0, 4, 1),
  serviceCost: cost(20, 10, 5, 1), serviceWork: 120000,
  maxSetting: 1_000_000_000
};
export const CALENDARS = {
  home: { name: '第0街区', offset: 0, end: 360 },
  rain: { name: '雨城', offset: 120, end: 240 },
  station: { name: '长站', offset: 360, end: 240 }
} as const;
export const CALENDAR_PROJECTS = ['P13', 'P14', 'P15', 'P16'] as const;
export function createCalendar(): CalendarState {
  return {
    originSecond: null, storage: { enabled: false, target: 120, reserve: cost(30, 50, 20) },
    stored: 0, captured: 0, allowance: 0, services: 0, enabled: false,
    orders: [], nextOrder: 1, boosts: { rain: { normal: 0, specialty: 0 }, station: { normal: 0, specialty: 0 } },
    crossRound: 0, history: []
  };
}
export const calendarUnlocked = (s: GameState) => !!s.experience.story['L05-2'];
export const calendarCapacity = (s: GameState) => !s.completed.includes('P13') ? 0 : s.completed.includes('P14') ? CALENDAR_RULES.capacity : CALENDAR_RULES.initialCapacity;
export const calendarQueueLimit = (s: GameState) => s.completed.includes('P15') ? 3 : 1;
export const boostCount = (s: GameState) => Object.values(s.calendar.boosts).reduce((n, modes) => n + modes.normal + modes.specialty, 0);
export function calendarClock(s: GameState, id: keyof typeof CALENDARS = 'home') {
  const elapsed = Math.max(0, s.clock.seconds - (s.calendar.originSecond ?? s.clock.seconds));
  const position = elapsed % CALENDAR_RULES.round, local = (position + CALENDARS[id].offset) % CALENDAR_RULES.round;
  const start = id === 'station' ? 240 : 0, end = id === 'rain' ? 120 : 360;
  const overlap = position >= start && position < end;
  return { round: Math.floor(elapsed / CALENDAR_RULES.round), position, local, overlap,
    next: overlap ? 0 : position < start ? start - position : CALENDAR_RULES.round - position + start };
}
// Held inputs stay in node inventory; held outputs share capacity with cargo.
// This module never imports network/engine, keeping their dependency acyclic.
export function calendarHeld(s: GameState, route: RouteId, kind: 'supply' | 'product', excluding?: string): Amounts {
  const held = amounts();
  for (const order of s.calendar.orders) if (order.prepared && order.route === route && order.uid !== excluding) {
    for (const r of RESOURCES) held[r] += order[kind][r];
  }
  return held;
}
