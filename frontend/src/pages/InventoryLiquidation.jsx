import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AgGridReact } from 'ag-grid-react'
import { AllCommunityModule, ModuleRegistry, themeQuartz } from 'ag-grid-community'
import { Package, Layers, Upload, Download, Filter, RefreshCw, CheckCircle2, AlertCircle, Loader2, Trash2 } from 'lucide-react'
import { fetchInventorySummary, uploadStockFile, runAllocation, fetchAllocations, fetchAllocationDetail, fetchLatestAllocation, deleteStock, deleteAllocations, fetchFgLiquidation, fetchVmiSafety } from '../services/api'
import { useDialog } from '../components/DialogProvider'

ModuleRegistry.registerModules([AllCommunityModule])

const TABS = [
  { id: 'liquidation', label: 'FG Liquidation' },
  { id: 'vmi', label: 'VMI & Safety Stock' },
  { id: 'fg', label: 'FG Allocation' },
  { id: 'wip', label: 'WIP Allocation' },
  { id: 'reports', label: 'Liquidation Reports' },
]

export default function InventoryLiquidation() {
  // Lets the Dashboard's inventory chart link straight into the right tab
  // (e.g. ?tab=wip) instead of always landing on FG Liquidation.
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
      {activeTab === 'vmi' && <VmiSafety />}
      {activeTab === 'fg' && <FGAllocation onRefresh={loadSummary} />}
      {activeTab === 'wip' && <WIPAllocation onRefresh={loadSummary} />}
      {activeTab === 'reports' && <LiquidationReports />}
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

// Shared status pill for allocation rows (FG / WIP / Liquidation Reports) —
// same three states everywhere: full / partial / no_stock.
const ALLOC_STATUS_STYLE = { full: 'bg-green-100 text-green-700', partial: 'bg-yellow-100 text-yellow-700', no_stock: 'bg-red-100 text-red-700' }
const ALLOC_STATUS_DOT = { full: 'bg-green-500', partial: 'bg-yellow-500', no_stock: 'bg-red-500' }
const ALLOC_STATUS_LABEL = { full: 'Full', partial: 'Partial', no_stock: 'No Stock' }
function AllocStatusBadge({ status }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${ALLOC_STATUS_STYLE[status] || 'bg-gray-100 text-gray-600'}`}>
      <span className={`w-2 h-2 rounded-full ${ALLOC_STATUS_DOT[status] || 'bg-gray-400'}`} />
      {ALLOC_STATUS_LABEL[status] || status || '—'}
    </span>
  )
}

// Server-side pagination footer shared by FG Allocation / WIP Allocation /
// Liquidation Reports — same UI + math as the Master Data page's footer.
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
          {(pageSafe - 1) * pageSize + 1}–{Math.min(pageSafe * pageSize, total)} of {total}
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

const gridDefaultColDef = { sortable: true, resizable: true, cellStyle: { color: '#374151', fontSize: '13px', display: 'flex', alignItems: 'center' } }

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

function FGAllocation({ onRefresh }) {
  const dialog = useDialog()
  const [uploading, setUploading] = useState(null)
  const [uploadResults, setUploadResults] = useState({})
  const [allocating, setAllocating] = useState(false)
  // Holds the latest FG allocation, fetched from the server — populated on
  // mount (not just right after clicking "Run Allocation"), so navigating
  // to this tab shows the existing result instead of an empty table.
  const [allocResult, setAllocResult] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [clearing, setClearing] = useState(false)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const inhouseRef = useRef(null)
  const warehouseRef = useRef(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetchLatestAllocation('fg', (page - 1) * pageSize, pageSize)
      setAllocResult(res.data?.id != null ? res.data : null)
    } catch (err) {
      setError(err.response?.data?.detail || err.message)
    } finally {
      setLoading(false)
    }
  }, [page, pageSize])

  useEffect(() => { load() }, [load])

  const handleUpload = async (file, stockType) => {
    if (!file) return
    setUploading(stockType)
    try {
      const res = await uploadStockFile(file, stockType)
      setUploadResults((prev) => ({ ...prev, [stockType]: { success: true, data: res.data } }))
      onRefresh()
    } catch (err) {
      setUploadResults((prev) => ({ ...prev, [stockType]: { success: false, error: err.response?.data?.detail || err.message } }))
    } finally {
      setUploading(null)
    }
  }

  const handleAllocate = async () => {
    setAllocating(true)
    setError('')
    try {
      await runAllocation('fg')
      setPage(1)
      await load()
      onRefresh()
    } catch (err) {
      setError(err.response?.data?.detail || err.message)
    } finally {
      setAllocating(false)
    }
  }

  const handleClearAll = async () => {
    if (!(await dialog.confirm(
      'Delete FG stock data (in-house + warehouse) and allocation results? WIP and other stock types are NOT affected.',
      { title: 'Clear FG data', detail: 'This cannot be undone.' },
    ))) return
    setClearing(true)
    try {
      // Scope the deletion to FG-only stock types. Calling deleteStock()
      // with no argument wipes EVERY stock category (WIP, plant,
      // warehouse, combined, other) — a data-loss bug because this
      // button is visually inside the "FG Allocation" section and the
      // WIP section already has its own separately-scoped Clear button.
      await deleteStock('fg_inhouse')
      await deleteStock('fg_warehouse')
      await deleteAllocations()
      setAllocResult(null)
      setUploadResults({})
      setPage(1)
      onRefresh()
    } catch (err) {
      setError(err.response?.data?.detail || err.message)
    } finally {
      setClearing(false)
    }
  }

  const total = allocResult?.total || 0
  const statusRenderer = useCallback((p) => <AllocStatusBadge status={p.data.status} />, [])
  const columnDefs = useMemo(() => [
    {
      headerName: 'S No', width: 70, sortable: false, filter: false, pinned: 'left',
      valueGetter: (p) => (page - 1) * pageSize + (p.node?.rowIndex ?? 0) + 1,
    },
    { field: 'cust_part_no', headerName: 'Cust Part #', minWidth: 150, pinned: 'left' },
    { field: 'maini_part_no', headerName: 'Maini Part #', minWidth: 150 },
    { field: 'customer', headerName: 'Customer', minWidth: 170 },
    { field: 'demand_qty', headerName: 'Demand Qty', minWidth: 120, type: 'numericColumn', valueFormatter: (p) => fmtNum(p.value) },
    { field: 'fg_inhouse', headerName: 'In-House FG', minWidth: 130, type: 'numericColumn', valueFormatter: (p) => fmtNum(p.value) },
    { field: 'fg_warehouse', headerName: 'Warehouse FG', minWidth: 130, type: 'numericColumn', valueFormatter: (p) => fmtNum(p.value) },
    { field: 'total_fg', headerName: 'Total FG', minWidth: 120, type: 'numericColumn', valueFormatter: (p) => fmtNum(p.value) },
    { field: 'allocated', headerName: 'Allocated', minWidth: 120, type: 'numericColumn', valueFormatter: (p) => fmtNum(p.value) },
    { headerName: 'Stock Status', minWidth: 130, sortable: false, filter: false, cellRenderer: statusRenderer },
  ], [page, pageSize, statusRenderer])

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Finished Goods Allocation</h2>
            <p className="text-sm text-gray-500">
              Upload SAP FG stock report and allocate against demand
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleClearAll}
              disabled={clearing}
              title="Delete all FG stock & allocation data"
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-red-600 border border-red-200 rounded-lg hover:bg-red-50 disabled:opacity-50"
            >
              {clearing ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
              Clear All
            </button>
            <button
              onClick={handleAllocate}
              disabled={allocating}
              className="flex items-center gap-2 px-3 py-2 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {allocating ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              Run Allocation
            </button>
          </div>
        </div>

        {error && <div className="mb-4 p-3 bg-red-50 text-red-700 text-sm rounded-lg border border-red-200">{error}</div>}

        {/* Stock Sources */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <div className="border border-gray-200 rounded-lg p-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-2">In-House FG Stock</h3>
            <div
              className="border-2 border-dashed border-gray-300 rounded-lg p-4 text-center cursor-pointer hover:border-blue-400"
              onClick={() => inhouseRef.current?.click()}
            >
              {uploading === 'fg_inhouse' ? (
                <Loader2 size={20} className="mx-auto text-blue-500 mb-1 animate-spin" />
              ) : (
                <Upload size={20} className="mx-auto text-gray-400 mb-1" />
              )}
              <p className="text-xs text-gray-500">Upload SAP in-house FG report</p>
              <input ref={inhouseRef} type="file" accept=".xlsx,.xls,.csv" onChange={(e) => handleUpload(e.target.files?.[0], 'fg_inhouse')} className="hidden" />
            </div>
            {uploadResults.fg_inhouse && (
              <div className={`mt-2 p-2 rounded text-xs ${uploadResults.fg_inhouse.success ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                {uploadResults.fg_inhouse.success ? `${uploadResults.fg_inhouse.data.row_count} rows uploaded` : uploadResults.fg_inhouse.error}
              </div>
            )}
          </div>
          <div className="border border-gray-200 rounded-lg p-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-2">Warehouse FG Stock</h3>
            <div
              className="border-2 border-dashed border-gray-300 rounded-lg p-4 text-center cursor-pointer hover:border-blue-400"
              onClick={() => warehouseRef.current?.click()}
            >
              {uploading === 'fg_warehouse' ? (
                <Loader2 size={20} className="mx-auto text-blue-500 mb-1 animate-spin" />
              ) : (
                <Upload size={20} className="mx-auto text-gray-400 mb-1" />
              )}
              <p className="text-xs text-gray-500">Upload SAP warehouse FG report</p>
              <input ref={warehouseRef} type="file" accept=".xlsx,.xls,.csv" onChange={(e) => handleUpload(e.target.files?.[0], 'fg_warehouse')} className="hidden" />
            </div>
            {uploadResults.fg_warehouse && (
              <div className={`mt-2 p-2 rounded text-xs ${uploadResults.fg_warehouse.success ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                {uploadResults.fg_warehouse.success ? `${uploadResults.fg_warehouse.data.row_count} rows uploaded` : uploadResults.fg_warehouse.error}
              </div>
            )}
          </div>
        </div>

        {/* Allocation Summary */}
        {allocResult?.summary && (
          <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <h3 className="text-sm font-semibold text-blue-900 mb-2">Allocation Summary</h3>
            <div className="grid grid-cols-4 gap-3 text-center">
              <div><p className="text-lg font-bold text-gray-900">{allocResult.summary.total_parts}</p><p className="text-xs text-gray-500">Total Parts</p></div>
              <div><p className="text-lg font-bold text-green-700">{allocResult.summary.fully_allocated}</p><p className="text-xs text-gray-500">Full Stock</p></div>
              <div><p className="text-lg font-bold text-yellow-700">{allocResult.summary.partial}</p><p className="text-xs text-gray-500">Partial</p></div>
              <div><p className="text-lg font-bold text-red-700">{allocResult.summary.no_stock}</p><p className="text-xs text-gray-500">No Stock</p></div>
            </div>
          </div>
        )}

        {/* Allocation Table — AG Grid, server-side paginated: `allocResult.allocations`
            only ever holds the CURRENT PAGE's rows (see `load` above), same
            pattern as the Master Data page's grid. The grid is only mounted
            once `loading` is false rather than passed `loading` as a
            reactive prop — in this AG Grid version, toggling `loading` on an
            already-mounted grid leaves its loading overlay stuck visible
            even after rowData has updated; mounting fresh each time it's
            true→false avoids that entirely. */}
        <div className="bg-white border border-gray-200 rounded-lg" style={{ height: 440 }}>
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 size={22} className="animate-spin text-blue-500" />
            </div>
          ) : (
            <AgGridReact
              theme={themeQuartz}
              rowData={allocResult?.allocations || []}
              columnDefs={columnDefs}
              defaultColDef={gridDefaultColDef}
              rowHeight={40}
              headerHeight={38}
              pagination={false}
              enableCellTextSelection={true}
              suppressRowClickSelection={true}
              animateRows={true}
              suppressMenuHide={true}
              overlayNoRowsTemplate='<span style="padding:12px;color:#6b7280;font-size:13px;">Upload SAP FG reports and run allocation to see results.</span>'
            />
          )}
        </div>
        <GridPager total={total} page={page} pageSize={pageSize} onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1) }} />

        {/* Legend */}
        <div className="flex items-center gap-4 mt-4">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-green-500" />
            <span className="text-xs text-gray-600">Full Stock</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-yellow-500" />
            <span className="text-xs text-gray-600">Partial Stock</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-red-500" />
            <span className="text-xs text-gray-600">No Stock</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function WIPAllocation({ onRefresh }) {
  const dialog = useDialog()
  const [uploading, setUploading] = useState(false)
  const [uploadResult, setUploadResult] = useState(null)
  const [allocating, setAllocating] = useState(false)
  // Latest WIP allocation, fetched from the server on mount — same fix as
  // FGAllocation: previously this only ever showed data from a "Run
  // Allocation" click made THIS session, so navigating to the tab after a
  // page refresh showed an empty table even though a result already existed.
  const [allocResult, setAllocResult] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [clearing, setClearing] = useState(false)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const fileRef = useRef(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetchLatestAllocation('wip', (page - 1) * pageSize, pageSize)
      setAllocResult(res.data?.id != null ? res.data : null)
    } catch (err) {
      setError(err.response?.data?.detail || err.message)
    } finally {
      setLoading(false)
    }
  }, [page, pageSize])

  useEffect(() => { load() }, [load])

  const handleUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const res = await uploadStockFile(file, 'wip')
      setUploadResult({ success: true, data: res.data })
      onRefresh()
    } catch (err) {
      setUploadResult({ success: false, error: err.response?.data?.detail || err.message })
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const handleAllocate = async () => {
    setAllocating(true)
    setError('')
    try {
      await runAllocation('wip')
      setPage(1)
      await load()
      onRefresh()
    } catch (err) {
      setError(err.response?.data?.detail || err.message)
    } finally {
      setAllocating(false)
    }
  }

  const handleClearWIP = async () => {
    if (!(await dialog.confirm('Delete all WIP stock data and allocation results?', { title: 'Clear WIP data' }))) return
    setClearing(true)
    try {
      await deleteStock('wip')       // WIP uploads are tagged 'wip'
      await deleteAllocations()
      setAllocResult(null)
      setUploadResult(null)
      setPage(1)
      onRefresh()
    } catch (err) {
      setError(err.response?.data?.detail || err.message)
    } finally {
      setClearing(false)
    }
  }

  const total = allocResult?.total || 0
  const statusRenderer = useCallback((p) => <AllocStatusBadge status={p.data.status} />, [])
  const columnDefs = useMemo(() => [
    {
      headerName: 'S No', width: 70, sortable: false, filter: false, pinned: 'left',
      valueGetter: (p) => (page - 1) * pageSize + (p.node?.rowIndex ?? 0) + 1,
    },
    { field: 'cust_part_no', headerName: 'Cust Part #', minWidth: 150, pinned: 'left' },
    { field: 'maini_part_no', headerName: 'Maini Part #', minWidth: 150 },
    { field: 'customer', headerName: 'Customer', minWidth: 170 },
    { field: 'demand_qty', headerName: 'Demand Qty', minWidth: 120, type: 'numericColumn', valueFormatter: (p) => fmtNum(p.value) },
    { field: 'wip_qty', headerName: 'WIP Qty', minWidth: 120, type: 'numericColumn', valueFormatter: (p) => fmtNum(p.value) },
    { field: 'allocated', headerName: 'Allocated', minWidth: 120, type: 'numericColumn', valueFormatter: (p) => fmtNum(p.value) },
    { field: 'gap', headerName: 'Gap', minWidth: 100, type: 'numericColumn', cellClass: 'text-red-600', valueFormatter: (p) => p.value > 0 ? fmtNum(p.value) : '—' },
    { headerName: 'Status', minWidth: 120, sortable: false, filter: false, cellRenderer: statusRenderer },
  ], [page, pageSize, statusRenderer])

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Work in Progress Allocation</h2>
            <p className="text-sm text-gray-500">Allocate complete in-house WIP against demand</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleClearWIP}
              disabled={clearing}
              title="Delete all WIP stock & allocation data"
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-red-600 border border-red-200 rounded-lg hover:bg-red-50 disabled:opacity-50"
            >
              {clearing ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
              Clear All
            </button>
            <button
              onClick={() => fileRef.current?.click()}
              className="flex items-center gap-2 px-3 py-2 text-xs font-medium border border-gray-200 rounded-lg hover:bg-gray-50"
            >
              {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
              Upload WIP Report
            </button>
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleUpload} className="hidden" />
            <button
              onClick={handleAllocate}
              disabled={allocating}
              className="flex items-center gap-2 px-3 py-2 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {allocating ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              Run WIP Allocation
            </button>
          </div>
        </div>

        {error && <div className="mb-4 p-3 bg-red-50 text-red-700 text-sm rounded-lg border border-red-200">{error}</div>}
        {uploadResult && (
          <div className={`mb-4 p-3 rounded-lg text-sm ${uploadResult.success ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
            {uploadResult.success ? `Uploaded ${uploadResult.data.row_count} rows` : uploadResult.error}
          </div>
        )}

        {allocResult?.summary && (
          <div className="mb-4 p-4 bg-purple-50 border border-purple-200 rounded-lg">
            <h3 className="text-sm font-semibold text-purple-900 mb-2">WIP Allocation Summary</h3>
            <div className="grid grid-cols-4 gap-3 text-center">
              <div><p className="text-lg font-bold text-gray-900">{allocResult.summary.total_parts}</p><p className="text-xs text-gray-500">Total Parts</p></div>
              <div><p className="text-lg font-bold text-green-700">{allocResult.summary.fully_allocated}</p><p className="text-xs text-gray-500">Full</p></div>
              <div><p className="text-lg font-bold text-yellow-700">{allocResult.summary.partial}</p><p className="text-xs text-gray-500">Partial</p></div>
              <div><p className="text-lg font-bold text-red-700">{allocResult.summary.no_stock}</p><p className="text-xs text-gray-500">No Stock</p></div>
            </div>
          </div>
        )}

        <div className="bg-white border border-gray-200 rounded-lg" style={{ height: 440 }}>
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 size={22} className="animate-spin text-blue-500" />
            </div>
          ) : (
            <AgGridReact
              theme={themeQuartz}
              rowData={allocResult?.allocations || []}
              columnDefs={columnDefs}
              defaultColDef={gridDefaultColDef}
              rowHeight={40}
              headerHeight={38}
              pagination={false}
              enableCellTextSelection={true}
              suppressRowClickSelection={true}
              animateRows={true}
              suppressMenuHide={true}
              overlayNoRowsTemplate='<span style="padding:12px;color:#6b7280;font-size:13px;">Upload WIP reports and run allocation to see results.</span>'
            />
          )}
        </div>
        <GridPager total={total} page={page} pageSize={pageSize} onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1) }} />
      </div>
    </div>
  )
}

function LiquidationReports() {
  const [allocations, setAllocations] = useState([])
  const [selectedAlloc, setSelectedAlloc] = useState(null)
  const [detail, setDetail] = useState(null)
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)

  useEffect(() => {
    loadAllocations()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadAllocations = async () => {
    try {
      const res = await fetchAllocations()
      setAllocations(res.data)
      // Auto-select the most recent report so its detail is visible right
      // away — previously this tab always started on "Select an allocation
      // report to view details" even though a report already existed.
      if (res.data?.length > 0) {
        setSelectedAlloc((cur) => cur ?? res.data[0].id)
      }
    } catch (err) {
      console.error('Failed to load allocations:', err)
    }
  }

  // Any change to the selected report or the page size invalidates the
  // current page — same pattern as Master Data's search/pageSize reset.
  useEffect(() => { setPage(1) }, [selectedAlloc, pageSize])

  const loadDetail = useCallback(async () => {
    if (selectedAlloc == null) { setDetail(null); return }
    setLoading(true)
    try {
      const res = await fetchAllocationDetail(selectedAlloc, (page - 1) * pageSize, pageSize)
      setDetail(res.data)
    } catch (err) {
      console.error('Failed to load allocation detail:', err)
    } finally {
      setLoading(false)
    }
  }, [selectedAlloc, page, pageSize])

  useEffect(() => { loadDetail() }, [loadDetail])

  const total = detail?.total || 0
  const statusRenderer = useCallback((p) => <AllocStatusBadge status={p.data.status} />, [])
  const columnDefs = useMemo(() => [
    {
      headerName: 'S No', width: 70, sortable: false, filter: false, pinned: 'left',
      valueGetter: (p) => (page - 1) * pageSize + (p.node?.rowIndex ?? 0) + 1,
    },
    { headerName: 'Part #', minWidth: 150, pinned: 'left', valueGetter: (p) => p.data?.cust_part_no || p.data?.maini_part_no },
    { field: 'customer', headerName: 'Customer', minWidth: 170 },
    { field: 'demand_qty', headerName: 'Demand Qty', minWidth: 120, type: 'numericColumn', valueFormatter: (p) => fmtNum(p.value) },
    { field: 'total_fg', headerName: 'FG Allocated', minWidth: 130, type: 'numericColumn', valueFormatter: (p) => fmtNum(p.value || 0) },
    { field: 'wip_qty', headerName: 'WIP Allocated', minWidth: 130, type: 'numericColumn', valueFormatter: (p) => fmtNum(p.value || 0) },
    { field: 'allocated', headerName: 'Total Allocated', minWidth: 140, type: 'numericColumn', valueFormatter: (p) => fmtNum(p.value) },
    { field: 'gap', headerName: 'Unallocated', minWidth: 120, type: 'numericColumn', cellClass: 'text-red-600', valueFormatter: (p) => p.value > 0 ? fmtNum(p.value) : '—' },
    { headerName: 'Status', minWidth: 120, sortable: false, filter: false, cellRenderer: statusRenderer },
  ], [page, pageSize, statusRenderer])

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">FG & WIP Liquidation Reports</h2>
            <p className="text-sm text-gray-500">Published liquidation reports detailed by Part, Customer, and Value</p>
          </div>
        </div>

        {/* Allocation List */}
        {allocations.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
            {allocations.map((a) => (
              <button
                key={a.id}
                onClick={() => setSelectedAlloc(a.id)}
                className={`border rounded-lg p-3 text-left transition-colors ${
                  selectedAlloc === a.id ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-blue-300'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-900">#{a.id} — {a.allocation_type?.toUpperCase()}</span>
                  <span className="text-xs text-gray-500">{a.created_at?.split('T')[0]}</span>
                </div>
                {a.summary && (
                  <div className="flex gap-3 mt-2 text-xs">
                    <span className="text-green-600">Full: {a.summary.fully_allocated}</span>
                    <span className="text-yellow-600">Partial: {a.summary.partial}</span>
                    <span className="text-red-600">No Stock: {a.summary.no_stock}</span>
                  </div>
                )}
              </button>
            ))}
          </div>
        )}

        {/* Detail Table — AG Grid, server-side paginated per selected report.
            Mounted only once `loading` is false (see FGAllocation's comment
            on why `loading` isn't passed as a reactive prop here). */}
        <div className="bg-white border border-gray-200 rounded-lg" style={{ height: 440 }}>
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 size={22} className="animate-spin text-blue-500" />
            </div>
          ) : (
            <AgGridReact
              theme={themeQuartz}
              rowData={detail?.allocations || []}
              columnDefs={columnDefs}
              defaultColDef={gridDefaultColDef}
              rowHeight={40}
              headerHeight={38}
              pagination={false}
              enableCellTextSelection={true}
              suppressRowClickSelection={true}
              animateRows={true}
              suppressMenuHide={true}
              overlayNoRowsTemplate={`<span style="padding:12px;color:#6b7280;font-size:13px;">${
                allocations.length > 0 ? 'Select an allocation report to view details.' : 'Run FG and WIP allocations first to generate liquidation reports.'
              }</span>`}
            />
          )}
        </div>
        <GridPager total={total} page={page} pageSize={pageSize} onPage={setPage} onPageSize={setPageSize} />
      </div>
    </div>
  )
}
