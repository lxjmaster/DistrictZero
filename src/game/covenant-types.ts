import type { Amounts } from './types';

export type CovenantId = 'preserve' | 'extend' | 'coexist';
export interface CovenantState {
  selected: CovenantId[];
  reserve: Amounts;
  paidSecond: number | null;
  changes: number;
  paid: Record<CovenantId, number>;
  blocked: number;
  combined: number;
  upkeep: Amounts;
  adjustments: Amounts;
  lightSaved: number;
  extraWork: number;
  feeSaved: number;
  history: { second: number; kind: 'confirm' | 'pause'; selected: CovenantId[] }[];
}
export interface CovenantReport {
  paid: Record<CovenantId, number>;
  blocked: number;
  combined: number;
  changes: number;
  upkeep: Amounts;
  adjustments: Amounts;
  lightSaved: number;
  extraWork: number;
  feeSaved: number;
  selected: CovenantId[];
  reason: string | null;
}
export type CovenantAction = { type: 'covenant-confirm'; selected: CovenantId[]; reserve: Amounts } | { type: 'covenant-pause' };
