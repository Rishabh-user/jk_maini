import { useState, useEffect, useMemo, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AgGridReact } from 'ag-grid-react'
import { AllCommunityModule, ModuleRegistry, themeQuartz } from 'ag-grid-community'
import { Package, Layers, Upload, Download, RefreshCw, CheckCircle2, AlertCircle, Loader2, Trash2 } from 'lucide-react'
import { fetchInventorySummary, uploadStockFile, deleteStock, fetchFgLiquidation, fetchVmiSafety, fetchStockUploads, fetchStockRows } from '../services/api'
import { useDialog } from '../components/DialogProvider'

ModuleRegistry.registerModules([AllCommunityModule])

// Legacy "FG Allocation / WIP Allocation / Liquidation Reports" tabs were
// retired — FG Liquidation + the Coverage Report supersede them (same
// demand-vs-stock analysis, no "Run Allocation" step). Stock upload became the
// "Stock Data" tab: upload + a full grid to inspect/validate what was ingested.
const TABS = [
  { id: 'liquidation', label: 'FG Liquidation' },
  { id: 'stock', label: 'Stock Data' },
  { id: 'vmi', label: 'VMI & Safety Stock' },
]

export default function InventoryLiquidation() {
  // Lets other pages link straight into a tab (e.g. ?tab=stock) instead of
  // always landing on FG Liquidation. Unknown values fall back to 'liquidation',
  // so old links to the retired allocation tabs degrade gracefully.
  const [searchParams] = useSearchParams()
  const initialTab = searchParams.get('tab')
  const [activeTab, setActiveTab] = useState(
    TABS.some((t) => t.id === initialTab) ? initialTab : 'liquidation'
  )
  const [summary, setSummary] = useState(null)

  useEffect(() => {
    loadSummary()
  }, [])

  const loadSummary = async () => {
    try {
      const res = await fetchInventorySummary()
      setSummary(res.data)
    } catch (err) {
      console.error('Failed to load inventory summary:', err)
    }
  }

  const cats = summary?.categories || {}
  const catCard = (key) => ({ qty: cats[key]?.qty ?? 0, parts: cats[key]?.parts ?? 0 })
  const fg = catCard('fg'), child = catCard('child'), wip = catCard('wip'), rm = catCard('rm')

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Inventory Liquidation</h1>
        <p className="text-sm text-gray-500 mt-1">
          Stock on hand by category, allocation against demand, and liquidation reporting
        </p>
      </div>

      {/* Stock-on-hand snapshot — all four categories from the new classification */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <SummaryCard icon={Package} label="Finished Goods"
          value={fmtNum(fg.qty)} sub={`${fmtNum(fg.parts)} parts on hand`} color="blue" />
        <SummaryCard icon={Layers} label="Child Parts"
          value={fmtNum(child.qty)} sub={`${fmtNum(child.parts)} parts on hand`} color="purple" />
        <SummaryCard icon={Layers} label="Work in Progress"
          value={fmtNum(wip.qty)} sub={`${fmtNum(wip.parts)} parts on hand`} color="orange" />
        <SummaryCard icon={Package} label="Raw Material"
          value={fmtNum(rm.qty)} sub={`${fmtNum(rm.parts)} parts on hand`} color="green" />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 rounded-lg p-1">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
              activeTab === tab.id
                ? 'bg-white text-blue-600 shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'liquidation' && <FGLiquidation />}
      {activeTab === 'stock' && <StockUpload onRefresh={loadSummary} />}
      {activeTab === 'vmi' && <VmiSafety />}
    </div>
  )
}

function SummaryCard({ icon: Icon, label, value, sub, color }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-medium text-gray-600">{label}</span>
        <div className={`w-9 h-9 rounded-lg bg-${color}-50 flex items-center justify-center`}>
          <Icon size={18} className={`text-${color}-600`} />
        </div>
      </div>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
      <p className="text-xs text-gray-500 mt-1">{sub}</p>
    </div>
  )
}

const fmtNum = (n) => (n == null ? '—' : Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 }))
const fmtMoney = (n, cur) => (n == null ? '—' : `${cur === 'INR' ? '₹' : cur + ' '}${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`)
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const fmtMonth = (m) => {
  if (!m || m === 'unscheduled') return 'Unscheduled'
  const [y, mo] = m.split('-')
  return mo ? `${MONTH_NAMES[+mo - 1]} ${y}` : m
}

const PAGE_SIZE = 50

// No display:flex here — it disables AG Grid's built-in cell clipping and lets
// long values (e.g. Description) bleed into the next column. The native cell
// already clips with an ellipsis and vertically centres text.
const gridDefaultColDef = { sortable: true, resizable: true, cellStyle: { color: '#374151', fontSize: '13px' } }

// VMI / Safety status pill renderers (used as AG Grid cellRenderers)
const VMI_STYLE = { below_min: 'bg-red-100 text-red-700', in_band: 'bg-green-100 text-green-700', above_max: 'bg-blue-100 text-blue-700' }
const VMI_LABEL = { below_min: 'Below Min', in_band: 'In Band', above_max: 'Above Max' }
function VmiStatusBadge({ value }) {
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${VMI_STYLE[value] || 'bg-gray-100 text-gray-600'}`}>{VMI_LABEL[value] || value}</span>
}
function SafetyStatusBadge({ value }) {
  const short = value === 'short'
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${short ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>{short ? 'Short' : 'Met'}</span>
}

function FGLiquidation() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [zsoId, setZsoId] = useState('')          // '' = latest
  const [scope, setScope] = useState('report')     // 'report' | 'all'
  const [page, setPage] = useState(1)

  useEffect(() => { load() }, [zsoId, scope])

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetchFgLiquidation(zsoId || undefined, scope)
      setData(res.data)
      setPage(1)
    } catch (err) {
      setError(err.response?.data?.detail || err.message)
    } finally {
      setLoading(false)
    }
  }

  const filtered = (data?.rows || []).filter((r) => {
    if (statusFilter !== 'all' && r.status !== statusFilter) return false
    if (search) {
      const q = search.toLowerCase()
      if (!(`${r.maini_part_no} ${r.cust_part_no} ${r.customer} ${r.description}`.toLowerCase().includes(q))) return false
    }
    return true
  })

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const pageSafe = Math.min(page, pageCount)
  const rows = filtered.slice((pageSafe - 1) * PAGE_SIZE, pageSafe * PAGE_SIZE)

  const t = data?.totals || {}
  const months = data?.months || []
  const valueParts = Object.entries(data?.value_by_currency || {})
  const reports = data?.available_reports || []
  const COLS = 15   // fixed columns before month columns

  const STATUS_STYLE = {
    surplus: 'bg-blue-100 text-blue-700',
    covered: 'bg-green-100 text-green-700',
    short: 'bg-red-100 text-red-700',
    no_demand: 'bg-gray-100 text-gray-600',
  }
  const STATUS_LABEL = { surplus: 'Surplus', covered: 'Covered', short: 'Backlog', no_demand: 'No Demand' }

  return (
    <div className="space-y-6">
      {/* Summary strip */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <SummaryCard icon={Package} label="Total FG Qty" value={fmtNum(t.fg)} sub={`Plant ${fmtNum(t.fg_plant)} · WH ${fmtNum(t.fg_warehouse)}`} color="blue" />
        <SummaryCard icon={Download} label="FG Value"
          value={valueParts.length ? valueParts.map(([c, v]) => fmtMoney(v, c)).join(' · ') : '—'}
          sub={`${data?.coverage?.priced_parts || 0} priced · ${data?.coverage?.unpriced_parts || 0} unpriced`} color="green" />
        <SummaryCard icon={Layers} label="Child / WIP Qty" value={`${fmtNum(t.child)} / ${fmtNum(t.wip)}`} sub="Support stock" color="purple" />
        <SummaryCard icon={CheckCircle2} label="Surplus Qty" value={fmtNum(t.surplus)} sub="FG above PO demand (liquidatable)" color="blue" />
        <SummaryCard icon={AlertCircle} label="Backlog Qty" value={fmtNum(t.backlog)} sub="PO demand above FG (shortfall)" color="orange" />
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">FG Liquidation — Part-wise</h2>
            <p className="text-sm text-gray-500">
              Firm <b>PO demand</b> drives status; <b>Forecast</b> is informational only.
              {data?.demand_source?.zso_report_id ? ` · demand from ZSO #${data.demand_source.zso_report_id}` : ' · no ZSO demand loaded'}
              {` · ${scope === 'report' ? 'parts in this report' : 'all stock parts'}`}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {/* ZSO selector */}
            <select value={zsoId} onChange={(e) => setZsoId(e.target.value)}
              title="Demand source report"
              className="px-3 py-2 text-sm border border-gray-200 rounded-lg max-w-[180px]">
              <option value="">Latest ZSO</option>
              {reports.map((r) => (
                <option key={r.id} value={r.id}>{r.label}{r.at ? ` · ${r.at.split('T')[0]}` : ''}</option>
              ))}
            </select>
            {/* Scope toggle */}
            <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs font-medium">
              <button onClick={() => setScope('report')}
                className={`px-3 py-2 ${scope === 'report' ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}>
                This report
              </button>
              <button onClick={() => setScope('all')}
                className={`px-3 py-2 ${scope === 'all' ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}>
                All stock
              </button>
            </div>
            <input
              value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }}
              placeholder="Search part / customer…"
              className="px-3 py-2 text-sm border border-gray-200 rounded-lg w-44"
            />
            <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1) }}
              className="px-3 py-2 text-sm border border-gray-200 rounded-lg">
              <option value="all">All statuses</option>
              <option value="surplus">Surplus</option>
              <option value="covered">Covered</option>
              <option value="short">Backlog</option>
              <option value="no_demand">No Demand</option>
            </select>
            <button onClick={load} disabled={loading}
              className="flex items-center gap-2 px-3 py-2 text-xs font-medium border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50">
              {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              Refresh
            </button>
          </div>
        </div>

        {error && <div className="mb-4 p-3 bg-red-50 text-red-700 text-sm rounded-lg border border-red-200">{error}</div>}

        <div className="border border-gray-200 rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                {['Maini Part #', 'Cust Part #', 'Customer', 'FG Qty', 'Plant', 'WH', 'Child', 'WIP', 'Unit Price', 'FG Value', 'PO Demand', 'Forecast', 'Surplus', 'Backlog', 'Status'].map((h) => (
                  <th key={h} className="text-left text-xs font-semibold text-gray-500 uppercase px-3 py-3 whitespace-nowrap">{h}</th>
                ))}
                {months.map((m) => (
                  <th key={m} className="text-right text-xs font-semibold text-gray-400 px-3 py-3 whitespace-nowrap">{fmtMonth(m)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={COLS + months.length} className="px-6 py-8 text-center"><Loader2 size={20} className="mx-auto text-blue-500 animate-spin" /></td></tr>
              ) : rows.length > 0 ? (
                rows.map((r, i) => (
                  <tr key={i} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-3 py-2 font-medium whitespace-nowrap">{r.maini_part_no}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{r.cust_part_no || '—'}</td>
                    <td className="px-3 py-2 whitespace-nowrap max-w-[160px] truncate" title={r.customer}>{r.customer || '—'}</td>
                    <td className="px-3 py-2 text-right font-medium">{fmtNum(r.fg_qty)}</td>
                    <td className="px-3 py-2 text-right text-gray-500">{fmtNum(r.fg_plant)}</td>
                    <td className="px-3 py-2 text-right text-gray-500">{fmtNum(r.fg_warehouse)}</td>
                    <td className="px-3 py-2 text-right text-gray-500">{fmtNum(r.child_qty)}</td>
                    <td className="px-3 py-2 text-right text-gray-500">{fmtNum(r.wip_qty)}</td>
                    <td className="px-3 py-2 text-right text-gray-500">{r.unit_price == null ? '—' : fmtMoney(r.unit_price, r.currency)}</td>
                    <td className="px-3 py-2 text-right font-medium">{r.fg_value == null ? '—' : fmtMoney(r.fg_value, r.currency)}</td>
                    <td className="px-3 py-2 text-right">{fmtNum(r.demand_qty)}</td>
                    <td className="px-3 py-2 text-right text-gray-400" title="Forecast — informational, does not affect status">{r.forecast_qty > 0 ? fmtNum(r.forecast_qty) : '—'}</td>
                    <td className="px-3 py-2 text-right text-blue-600">{r.surplus_qty > 0 ? fmtNum(r.surplus_qty) : '—'}</td>
                    <td className="px-3 py-2 text-right text-red-600">{r.backlog_qty > 0 ? fmtNum(r.backlog_qty) : '—'}</td>
                    <td className="px-3 py-2">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${STATUS_STYLE[r.status]}`}>{STATUS_LABEL[r.status]}</span>
                      {r.forecast_qty > 0 && <span className="ml-1 text-[10px] text-gray-400" title="Has forecast demand">fcst</span>}
                    </td>
                    {months.map((m) => (
                      <td key={m} className="px-3 py-2 text-right text-gray-500">{r.monthly_demand?.[m] ? fmtNum(r.monthly_demand[m]) : ''}</td>
                    ))}
                  </tr>
                ))
              ) : (
                <tr><td colSpan={COLS + months.length} className="px-6 py-10 text-center text-sm text-gray-500">
                  {!data
                    ? 'Loading…'
                    : (data.rows?.length || 0) === 0
                      ? (scope === 'report'
                          ? 'This ZSO has no PO/forecast lines, or no stock is loaded. Try "All stock", or pick another report.'
                          : 'No stock or demand loaded yet. Upload a stock file in the FG Allocation tab, then Refresh.')
                      : 'No parts match your search or status filter.'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Legend + pagination */}
        <div className="flex items-center gap-4 mt-4 flex-wrap">
          {Object.entries(STATUS_LABEL).map(([k, label]) => (
            <div key={k} className="flex items-center gap-1.5">
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLE[k]}`}>{label}</span>
              <span className="text-xs text-gray-500">({data?.status_counts?.[k] ?? 0})</span>
            </div>
          ))}
          <span className="text-xs text-gray-400 ml-auto">PO demand drives status · Forecast is informational</span>
        </div>

        {filtered.length > 0 && (
          <div className="flex items-center justify-between mt-4 text-sm">
            <span className="text-gray-500">
              {filtered.length > PAGE_SIZE
                ? `Showing ${(pageSafe - 1) * PAGE_SIZE + 1}–${Math.min(pageSafe * PAGE_SIZE, filtered.length)} of ${filtered.length} parts`
                : `${filtered.length} part${filtered.length > 1 ? 's' : ''}`}
            </span>
            {filtered.length > PAGE_SIZE && (
              <div className="flex items-center gap-1">
                <button onClick={() => setPage(1)} disabled={pageSafe === 1}
                  className="px-2 py-1 border border-gray-200 rounded disabled:opacity-40">« First</button>
                <button onClick={() => setPage(pageSafe - 1)} disabled={pageSafe === 1}
                  className="px-2 py-1 border border-gray-200 rounded disabled:opacity-40">‹ Prev</button>
                <span className="px-2 text-gray-600">Page {pageSafe} / {pageCount}</span>
                <button onClick={() => setPage(pageSafe + 1)} disabled={pageSafe === pageCount}
                  className="px-2 py-1 border border-gray-200 rounded disabled:opacity-40">Next ›</button>
                <button onClick={() => setPage(pageCount)} disabled={pageSafe === pageCount}
                  className="px-2 py-1 border border-gray-200 rounded disabled:opacity-40">Last »</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function VmiSafety() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { load() }, [])

  const load = async () => {
    setLoading(true); setError('')
    try {
      const res = await fetchVmiSafety()
      setData(res.data)
    } catch (err) {
      setError(err.response?.data?.detail || err.message)
    } finally {
      setLoading(false)
    }
  }

  const vmi = data?.vmi || {}
  const safety = data?.safety || {}

  const vmiCols = useMemo(() => [
    { field: 'maini_part_no', headerName: 'Maini Part #', minWidth: 150 },
    { field: 'cust_part_no', headerName: 'Cust Part #', minWidth: 130 },
    { field: 'min_qty', headerName: 'Min', type: 'numericColumn', minWidth: 90, valueFormatter: (p) => fmtNum(p.value) },
    { field: 'max_qty', headerName: 'Max', type: 'numericColumn', minWidth: 90, valueFormatter: (p) => fmtNum(p.value) },
    { field: 'fg_qty', headerName: 'FG On Hand', type: 'numericColumn', minWidth: 120, valueFormatter: (p) => fmtNum(p.value) },
    { field: 'replenish_to_max', headerName: 'Replenish to Max', type: 'numericColumn', minWidth: 150, valueFormatter: (p) => (p.value > 0 ? fmtNum(p.value) : '—'), cellClass: 'text-red-600' },
    { field: 'status', headerName: 'Status', minWidth: 120, cellRenderer: VmiStatusBadge },
  ], [])

  const safetyCols = useMemo(() => [
    { field: 'maini_part_no', headerName: 'Maini Part #', minWidth: 150 },
    { field: 'cust_part_no', headerName: 'Cust Part #', minWidth: 130 },
    { field: 'customer', headerName: 'Customer', minWidth: 150 },
    { field: 'kas', headerName: 'KAS', minWidth: 120 },
    { field: 'site', headerName: 'Site', minWidth: 120 },
    { field: 'safety_qty', headerName: 'Safety Qty', type: 'numericColumn', minWidth: 120, valueFormatter: (p) => fmtNum(p.value) },
    { field: 'fg_qty', headerName: 'FG On Hand', type: 'numericColumn', minWidth: 120, valueFormatter: (p) => fmtNum(p.value) },
    { field: 'shortfall', headerName: 'Shortfall', type: 'numericColumn', minWidth: 120, valueFormatter: (p) => (p.value > 0 ? fmtNum(p.value) : '—'), cellClass: 'text-red-600' },
    { field: 'status', headerName: 'Status', minWidth: 100, cellRenderer: SafetyStatusBadge },
  ], [])

  return (
    <div className="space-y-6">
      {/* Read-only: files are uploaded in Demand Management */}
      <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800 flex items-center justify-between flex-wrap gap-2">
        <span>
          📄 Analysis of VMI &amp; Safety Stock <b>uploaded in Demand Management → VMI &amp; Safety Stock</b>.
          {' '}Sources: {vmi.source || 'no VMI file'} · {safety.source || 'no Safety file'}.
          {' '}<span className="text-blue-600">(Will move into the Coverage Report.)</span>
        </span>
        <button onClick={load} disabled={loading}
          className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium border border-blue-200 rounded-lg bg-white hover:bg-blue-50 disabled:opacity-50">
          {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Refresh
        </button>
      </div>

      {error && <div className="p-3 bg-red-50 text-red-700 text-sm rounded-lg border border-red-200">{error}</div>}

      {/* VMI section */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">VMI — Min/Max vs FG on hand</h2>
            <p className="text-sm text-gray-500">{vmi.total || 0} parts · <span className="text-red-600 font-medium">{vmi.below_min || 0} below min</span> (replenish)</p>
          </div>
          <button onClick={load} disabled={loading} className="flex items-center gap-2 px-3 py-2 text-xs font-medium border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50">
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Refresh
          </button>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg" style={{ height: 380 }}>
          <AgGridReact
            theme={themeQuartz}
            rowData={vmi.rows || []}
            columnDefs={vmiCols}
            defaultColDef={gridDefaultColDef}
            rowHeight={38} headerHeight={38}
            pagination={true} paginationPageSize={25} paginationPageSizeSelector={[25, 50, 100]}
            enableCellTextSelection={true} suppressRowClickSelection={true} animateRows={true}
            overlayNoRowsTemplate='<span style="padding:12px;color:#6b7280;font-size:13px;">Upload a VMI file (Demand Management) to see the Min/Max replenishment view.</span>'
          />
        </div>
      </div>

      {/* Safety stock section */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Safety Stock — Customer-facing</h2>
          <p className="text-sm text-gray-500">
            {safety.total || 0} parts · <span className="text-red-600 font-medium">{safety.short || 0} short</span> of safety level
          </p>
          {safety.note && <p className="text-xs text-amber-600 mt-1">⚠ {safety.note}</p>}
        </div>

        {/* by-customer segregation */}
        {safety.by_customer && Object.keys(safety.by_customer).length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            {Object.entries(safety.by_customer).map(([cust, g]) => (
              <div key={cust} className="border border-gray-200 rounded-lg p-3">
                <p className="text-sm font-semibold text-gray-900 truncate" title={cust}>{cust}</p>
                <p className="text-xs text-gray-500">{g.parts} parts · safety {fmtNum(g.safety_qty)}</p>
                {g.short > 0 && <p className="text-xs text-red-600">{g.short} short</p>}
              </div>
            ))}
          </div>
        )}

        <div className="bg-white border border-gray-200 rounded-lg" style={{ height: 480 }}>
          <AgGridReact
            theme={themeQuartz}
            rowData={safety.rows || []}
            columnDefs={safetyCols}
            defaultColDef={gridDefaultColDef}
            rowHeight={38} headerHeight={38}
            pagination={true} paginationPageSize={50} paginationPageSizeSelector={[25, 50, 100, 250]}
            enableCellTextSelection={true} suppressRowClickSelection={true} animateRows={true}
            overlayNoRowsTemplate='<span style="padding:12px;color:#6b7280;font-size:13px;">Upload a Safety Stock file (Demand Management) to see coverage vs safety levels.</span>'
          />
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// STOCK DATA — upload + inspect
// Upload SAP stock / open-orders exports (auto-classified into FG / Child / WIP
// / RM by material type + storage location; plant vs warehouse from the plant
// code). Below, a file selector drives ONE AG Grid so you can actually validate
// the data: server-side paging (files run to ~20k rows), category chips,
// search, plant/warehouse filter, and export.
//
// Excluded rows (scrap / rework / non-valuated / no-part) never affect any
// inventory total — they're shown only for reconciliation & troubleshooting,
// behind the "Excluded" chip.
// ─────────────────────────────────────────────────────────────────────────────
const CAT_STYLE = {
  fg: 'bg-blue-100 text-blue-700', child: 'bg-purple-100 text-purple-700',
  wip: 'bg-orange-100 text-orange-700', rm: 'bg-green-100 text-green-700',
  excluded: 'bg-gray-200 text-gray-600',
}
const CAT_LABEL = { fg: 'FG', child: 'Child', wip: 'WIP', rm: 'Raw Material', excluded: 'Excluded', other: 'Other' }
function CategoryBadge({ value }) {
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${CAT_STYLE[value] || 'bg-gray-100 text-gray-600'}`}>{CAT_LABEL[value] || value || '—'}</span>
}

function StockUpload({ onRefresh }) {
  const dialog = useDialog()
  const [uploading, setUploading] = useState(false)
  const [uploads, setUploads] = useState([])
  const [error, setError] = useState('')
  const [clearing, setClearing] = useState(false)
  const fileRef = useRef(null)

  // Grid state
  const [selected, setSelected] = useState('active')   // 'active' | upload id
  const [category, setCategory] = useState('')          // '' = all (excl. excluded)
  const [plantGroup, setPlantGroup] = useState('')
  const [search, setSearch] = useState('')
  const [data, setData] = useState(null)                // { total, rows, facets, reconciliation, sources }
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)

  const loadUploads = async () => {
    try {
      const res = await fetchStockUploads()
      setUploads(res.data?.uploads || [])
    } catch (err) { console.error(err) }
  }

  const loadRows = async () => {
    setLoading(true)
    try {
      const params = { skip: (page - 1) * pageSize, limit: pageSize }
      if (selected !== 'active') params.upload_id = selected
      if (category) params.category = category
      if (plantGroup) params.plant_group = plantGroup
      if (search.trim()) params.search = search.trim()
      const res = await fetchStockRows(params)
      setData(res.data)
    } catch (err) {
      setError(err.response?.data?.detail || err.message)
    } finally { setLoading(false) }
  }

  useEffect(() => { loadUploads() }, [])
  useEffect(() => { loadRows() }, [selected, category, plantGroup, page, pageSize])
  // debounce search
  useEffect(() => {
    const t = setTimeout(() => { setPage(1); loadRows() }, 350)
    return () => clearTimeout(t)
  }, [search])

  const handleUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true); setError('')
    try {
      const res = await uploadStockFile(file)
      await loadUploads()
      setSelected(res.data?.id ?? 'active')   // jump to what was just uploaded
      setPage(1)
      onRefresh?.()
    } catch (err) {
      setError(err.response?.data?.detail || err.message)
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const handleClearAll = async () => {
    if (!(await dialog.confirm('Delete ALL uploaded stock data (plant, warehouse and WIP)? This cannot be undone.'))) return
    setClearing(true); setError('')
    try {
      await deleteStock()
      setSelected('active'); setData(null)
      await loadUploads(); onRefresh?.()
    } catch (err) {
      setError(err.response?.data?.detail || err.message)
    } finally { setClearing(false) }
  }

  const exportCsv = () => {
    const rows = data?.rows || []
    if (!rows.length) return
    const cols = ['part', 'material_type', 'category', 'excluded_reason', 'plant', 'plant_group', 'location', 'description', 'qty', 'in_transit']
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
    const a = document.createElement('a')
    a.href = url; a.download = `stock_data_page${page}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  const columnDefs = useMemo(() => [
    { field: 'part', headerName: 'Part #', minWidth: 150 },
    { field: 'description', headerName: 'Description', minWidth: 200 },
    { field: 'material_type', headerName: 'Material Type', minWidth: 130 },
    { field: 'category', headerName: 'Category', minWidth: 120, cellRenderer: CategoryBadge },
    { field: 'excluded_reason', headerName: 'Exclusion Reason', minWidth: 210, valueFormatter: (p) => p.value || '—' },
    { field: 'plant', headerName: 'Plant', minWidth: 100 },
    { field: 'plant_group', headerName: 'Plant / WH', minWidth: 120 },
    { field: 'location', headerName: 'Storage Location', minWidth: 150 },
    { field: 'qty', headerName: 'Qty', type: 'numericColumn', minWidth: 110, valueFormatter: (p) => fmtNum(p.value) },
    { field: 'in_transit', headerName: 'In-Transit', type: 'numericColumn', minWidth: 120, valueFormatter: (p) => fmtNum(p.value) },
  ], [])

  const facets = data?.facets || {}
  const rec = data?.reconciliation
  const total = data?.total || 0
  const CHIPS = [
    { key: '', label: 'All included' },
    { key: 'fg', label: 'FG' }, { key: 'child', label: 'Child' },
    { key: 'wip', label: 'WIP' }, { key: 'rm', label: 'Raw Material' },
    { key: 'excluded', label: 'Excluded' },
  ]

  return (
    <div className="space-y-6">
      {/* Upload */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-start justify-between mb-4 gap-3 flex-wrap">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Stock Data</h2>
            <p className="text-sm text-gray-500 max-w-2xl">
              Upload SAP <b>Plant Stock</b>, <b>Warehouse Stock</b>, <b>Open Orders (WIP)</b> — or one combined export.
              Rows are auto-classified by material type + storage location. Re-uploading the same kind replaces the previous one.
            </p>
          </div>
          <button onClick={handleClearAll} disabled={clearing}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-red-600 border border-red-200 rounded-lg hover:bg-red-50 disabled:opacity-50">
            {clearing ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />} Clear All Stock
          </button>
        </div>

        <div className="border-2 border-dashed border-gray-300 rounded-lg p-5 text-center cursor-pointer hover:border-blue-400"
          onClick={() => fileRef.current?.click()}>
          {uploading ? <Loader2 size={22} className="mx-auto text-blue-500 mb-1 animate-spin" /> : <Upload size={22} className="mx-auto text-gray-400 mb-1" />}
          <p className="text-sm font-medium text-gray-700">{uploading ? 'Uploading & classifying…' : 'Click to upload a stock file'}</p>
          <p className="text-xs text-gray-400 mt-0.5">.xlsx, .xls or .csv</p>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleUpload} className="hidden" />
        </div>

        {error && <div className="mt-4 p-3 bg-red-50 text-red-700 text-sm rounded-lg border border-red-200">{error}</div>}

        {/* Loaded files — selector */}
        <div className="mt-5">
          <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Loaded stock files</p>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => { setSelected('active'); setPage(1) }}
              className={`px-3 py-2 text-xs rounded-lg border text-left ${selected === 'active' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 hover:bg-gray-50'}`}>
              <span className="font-semibold">All stock (active)</span>
              <span className="block text-gray-500">combined — what the reports use</span>
            </button>
            {uploads.map((u) => (
              <button key={u.id} onClick={() => { setSelected(u.id); setPage(1) }}
                className={`px-3 py-2 text-xs rounded-lg border text-left ${selected === u.id ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 hover:bg-gray-50'}`}>
                <span className="font-semibold">{u.filename}</span>
                <span className="block text-gray-500">
                  {u.kind} · {fmtNum(u.row_count)} rows · {u.at ? u.at.split('T')[0] : ''}
                  {!u.is_active && <span className="ml-1 text-amber-600">· superseded</span>}
                </span>
              </button>
            ))}
            {uploads.length === 0 && <span className="text-sm text-gray-400">No stock uploaded yet.</span>}
          </div>
        </div>
      </div>

      {/* Reconciliation banner */}
      {rec && rec.file_rows > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
            <span className="text-gray-700">Rows in file: <b>{fmtNum(rec.file_rows)}</b></span>
            <span className="text-green-700">Included: <b>{fmtNum(rec.included_rows)}</b></span>
            <span className="text-gray-500">Excluded: <b>{fmtNum(rec.excluded_rows)}</b></span>
            {Object.entries(rec.excluded_by_reason || {}).map(([r, n]) => (
              <span key={r} className="text-xs text-gray-500">• {r}: {fmtNum(n)}</span>
            ))}
          </div>
          <p className="text-xs text-gray-400 mt-1">
            Excluded rows never affect inventory calculations — shown for validation only (open the “Excluded” chip to inspect).
          </p>
        </div>
      )}

      {/* Filters + grid */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          {CHIPS.map((c) => (
            <button key={c.key} onClick={() => { setCategory(c.key); setPage(1) }}
              className={`px-2.5 py-1 text-xs font-medium rounded-full border ${category === c.key ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
              {c.label}{c.key && facets[c.key] != null ? ` (${fmtNum(facets[c.key])})` : ''}
            </button>
          ))}
          <select value={plantGroup} onChange={(e) => { setPlantGroup(e.target.value); setPage(1) }}
            className="px-2 py-1.5 text-sm border border-gray-200 rounded-lg ml-1">
            <option value="">Plant &amp; Warehouse</option>
            <option value="plant">Plant only</option>
            <option value="warehouse">Warehouse only</option>
            <option value="unknown">Unknown</option>
          </select>
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search part / location / type…"
            className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg w-56" />
          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs text-gray-500">{fmtNum(total)} rows</span>
            <button onClick={loadRows} disabled={loading}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50">
              {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Refresh
            </button>
            <button onClick={exportCsv} disabled={!data?.rows?.length}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50">
              <Download size={13} /> Export page
            </button>
          </div>
        </div>

        <div style={{ height: 560 }}>
          {loading ? (
            <div className="flex items-center justify-center h-full"><Loader2 size={22} className="animate-spin text-blue-500" /></div>
          ) : (
            <AgGridReact
              theme={themeQuartz}
              rowData={data?.rows || []}
              columnDefs={columnDefs}
              defaultColDef={{ ...gridDefaultColDef, filter: true }}
              rowHeight={38} headerHeight={38}
              pagination={false}
              enableCellTextSelection={true} suppressRowClickSelection={true} animateRows={true}
              overlayNoRowsTemplate='<span style="padding:12px;color:#6b7280;font-size:13px;">No stock rows for this selection — upload a stock file or clear the filters.</span>'
            />
          )}
        </div>
        <GridPager total={total} page={page} pageSize={pageSize}
          onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1) }} />
      </div>
    </div>
  )
}

// Server-side pagination footer (same UI/maths as the Master Data page).
function GridPager({ total, page, pageSize, onPage, onPageSize }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const pageSafe = Math.min(page, totalPages)
  if (total === 0) return null
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 mt-3 text-sm text-gray-600">
      <div className="flex items-center gap-2">
        <span>Rows per page:</span>
        <select value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))}
          className="border border-gray-200 rounded-md px-2 py-1 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
          {[25, 50, 100, 200].map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <span className="text-gray-400">
          {(pageSafe - 1) * pageSize + 1}–{Math.min(pageSafe * pageSize, total)} of {fmtNum(total)}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <button onClick={() => onPage(1)} disabled={pageSafe <= 1}
          className="px-2 py-1 rounded-md border border-gray-200 hover:bg-gray-50 disabled:opacity-40">« First</button>
        <button onClick={() => onPage(pageSafe - 1)} disabled={pageSafe <= 1}
          className="px-2 py-1 rounded-md border border-gray-200 hover:bg-gray-50 disabled:opacity-40">‹ Prev</button>
        <span className="px-2">Page {pageSafe} of {totalPages}</span>
        <button onClick={() => onPage(pageSafe + 1)} disabled={pageSafe >= totalPages}
          className="px-2 py-1 rounded-md border border-gray-200 hover:bg-gray-50 disabled:opacity-40">Next ›</button>
        <button onClick={() => onPage(totalPages)} disabled={pageSafe >= totalPages}
          className="px-2 py-1 rounded-md border border-gray-200 hover:bg-gray-50 disabled:opacity-40">Last »</button>
      </div>
    </div>
  )
}
