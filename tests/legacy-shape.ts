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
  if (Array.isArray(value)) return value.map(preFreight) as T;
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !['rainFilm', 'railCore', 'mode', 'batches', 'manifest', 'spaceReserved', 'fee', 'wear', 'capacity', 'vehicle', 'targets', 'buffer', 'order', 'legacyPending', 'rulesSince', 'archives', 'F05', 'F06'].includes(key)).map(([key, v]) => [key, preFreight(v)])) as T;
}
