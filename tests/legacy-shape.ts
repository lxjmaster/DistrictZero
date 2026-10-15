// Project additive V0.3.1 fields out when comparing original saved data or
// constructing an intentional historical-format reservation regression.
// Genuine checked-in historical fixtures are never rewritten.
export function preExpansion<T>(value: T): T {
  if (Array.isArray(value)) return value.filter(v => v !== 'assemble').map(preExpansion) as T;
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !['component', 'assemble', 'prefab', 'experience', 'fulfillment', 'highlights', 'stories'].includes(key)).map(([key, v]) => [key, preExpansion(v)])) as T;
}
