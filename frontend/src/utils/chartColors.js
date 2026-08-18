// Chart color roles for the Dashboard's recharts graphs.
//
// STATUS colors reuse this app's EXISTING badge conventions (green-500 =
// good/full, yellow-500 = partial/pending, orange-500 = low/warning,
// red-500 = critical/failed, blue-600 = info/primary) — see
// CoverageReport.jsx's LEVEL_DOT and InventoryLiquidation.jsx's
// AllocStatusBadge for the source of truth these mirror, so a dashboard
// chart and the detail page it links to always agree on what a color means.
export const STATUS = {
  good: '#22c55e',      // green-500 — processed / full / fully_allocated
  pending: '#eab308',   // yellow-500 — unprocessed / partial
  warning: '#f97316',   // orange-500 — low coverage
  critical: '#ef4444',  // red-500 — failed / no_stock / none
  info: '#2563eb',      // blue-600 — primary / manual uploads
  neutral: '#94a3b8',   // slate-400 — unknown/other
}

// Fixed-order categorical palette for identity distinctions (currencies,
// data sources, demand/actual/budget series) — assign by position, never
// re-picked per value, so the same slot always means the same thing across
// a render. Validated CVD-safe ordering (see the dataviz skill's palette.md).
export const CATEGORICAL = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948']

export function categoricalColor(index) {
  return CATEGORICAL[index % CATEGORICAL.length]
}
