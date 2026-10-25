// Project additive V0.3.1 fields out when comparing original saved data or
// constructing an intentional historical-format reservation regression.
// Genuine checked-in historical fixtures are never rewritten.
export function preExpansion<T>(value: T): T {
  value = preFreight(value);
  if (Array.isArray(value)) return value.filter(v => v !== 'assemble').map(preExpansion) as T;
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !['component', 'assemble', 'prefab', 'experience', 'fulfillment', 'highlights', 'stories', 'neighborhood', 'fieldReserved', 'legacyChapter'].includes(key)).map(([key, v]) => [key, preExpansion(v)])) as T;
}

// Projection used only for checking genuine prior-version fields, never by the
// production decoder. It also permits deliberate historical queue regressions.
export function preFreight<T>(value: T): T {
  value = preCalendar(value);
  if (Array.isArray(value)) return value.filter(v => typeof v !== 'string' || !/^L04-[1-4]$/.test(v)).map(preFreight) as T;
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !['rainFilm', 'railCore', 'mode', 'batches', 'manifest', 'spaceReserved', 'fee', 'wear', 'capacity', 'vehicle', 'targets', 'buffer', 'order', 'legacyPending', 'rulesSince', 'archives', 'F05', 'F06', 'outposts', 'outpost', 'proof', 'supportSent', 'supportReceived', 'L04-1', 'L04-2', 'L04-3', 'L04-4'].includes(key)).map(([key, v]) => [key, preFreight(v)])) as T;
}

// Compare genuine schema-6 fields without inventing a historical save. Newly
// available, unconfirmed L04 letters are additive UI state, not old production.
export function preOutposts<T>(value: T): T {
  value = preCalendar(value);
  if (Array.isArray(value)) return value.filter(v => typeof v !== 'string' || !/^L04-[1-4]$/.test(v)).map(preOutposts) as T;
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !['outposts', 'outpost', 'proof', 'supportSent', 'supportReceived', 'L04-1', 'L04-2', 'L04-3', 'L04-4'].includes(key)).map(([key, v]) => [key, preOutposts(v)])) as T;
}

// Genuine schema-7 comparisons keep all V0.4 state. Calendar data and newly
// available, unconfirmed L05 letters are additive, not old settlement effects.
export function preCalendar<T>(value: T): T {
  value = preCovenants(value);
  if (Array.isArray(value)) return value.filter(v => typeof v !== 'string' || !/^L05-[1-4]$/.test(v)).map(preCalendar) as T;
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'calendar' && !/^L05-[1-4]$/.test(key)).map(([key, v]) => [key, preCalendar(v)])) as T;
}

// Project only additive V0.6 state and unconfirmed L06 prompts from old evidence.
export function preCovenants<T>(value: T): T {
  if (Array.isArray(value)) return value.filter(v => typeof v !== 'string' || !/^L06-[1-4]$/.test(v)).map(preCovenants) as T;
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'covenants' && !/^L06-[1-4]$/.test(key)).map(([key, v]) => [key, preCovenants(v)])) as T;
}
