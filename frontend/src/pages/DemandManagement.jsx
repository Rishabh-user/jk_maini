import { useState, useEffect, useRef, useCallback, Fragment } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Upload, FileSpreadsheet, TrendingUp, TrendingDown, AlertTriangle,
  RefreshCw, ArrowRightLeft, Database, Download, ChevronDown, ChevronUp,
  Mail, Globe, FileText, File, Loader2, Trash2, Eye, CheckCircle,
  XCircle, Clock, Plus, X, Shield, ExternalLink
} from 'lucide-react'
import {
  fetchDemandStats, compareDemand, uploadDemandFile, fetchDemandReports,
  fetchDemandUploads, previewDemandUpload, deleteDemandUpload,
  fetchCorrections, fetchCorrectionStats, createCorrection, reviewCorrection, deleteCorrection,
  fetchComparableReports, fetchFollowups, createFollowup, updateFollowup, deleteFollowup
} from '../services/api'
import { useDialog } from '../components/DialogProvider'

const TABS = [
  { id: 'aggregation',        label: 'Data Aggregation' },
  { id: 'comparison',         label: 'Demand Comparison' },
  { id: 'vmi',                label: 'VMI & Safety Stock' },
  { id: 'master_correction',  label: 'Master Data Correction' },
]

export default function DemandManagement() {
  const [activeTab, setActiveTab] = useState('aggregation')
  const [stats, setStats] = useState(null)

  const loadStats = useCallback(async () => {
    try { const res = await fetchDemandStats(); setStats(res.data) }
    catch (err) { console.error('Failed to load demand stats:', err) }
  }, [])

  useEffect(() => { loadStats() }, [loadStats])

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Demand Management</h1>
        <p className="text-sm text-gray-500 mt-1">
          Aggregate, enrich, compare and correct demand data for ZSO generation
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 rounded-lg p-1 overflow-x-auto">
        {TABS.map((tab) => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 text-sm font-medium rounded-md whitespace-nowrap transition-colors ${
              activeTab === tab.id ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-600 hover:text-gray-900'
            }`}>
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'aggregation'       && <AggregationTab stats={stats} onRefresh={loadStats} />}
      {activeTab === 'comparison'        && <ComparisonTab />}
      {activeTab === 'vmi'               && <VMITab />}
      {activeTab === 'master_correction' && <MasterCorrectionTab />}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 1: DATA AGGREGATION
// Purpose: Dashboard showing all demand sources + clickable pipeline steps
//          that navigate directly to the relevant pages.
// ─────────────────────────────────────────────────────────────────────────────
function AggregationTab({ stats, onRefresh }) {
  const navigate = useNavigate()
  const [expandedStep, setExpandedStep] = useState(null)

  const DATA_SOURCES = [
    { id: 'email', label: 'Extracted Files',    icon: Mail,          color: 'blue',   count: stats?.sources?.email || 0 },
    { id: 'portal', label: 'Customer Portals', icon: Globe,         color: 'purple', count: 0, comingSoon: true },
    { id: 'pdf',   label: 'PDF Documents',     icon: FileText,      color: 'red',    count: stats?.sources?.pdf || 0 },
    { id: 'excel', label: 'Excel / CSV',        icon: File,         color: 'green',  count: (stats?.sources?.excel || 0) + (stats?.sources?.csv || 0) },
    { id: 'lta',   label: 'Long Term Agreements', icon: FileSpreadsheet, color: 'orange', count: 0, comingSoon: true },
  ]

  const PIPELINE_STEPS = [
    {
      id: 'fetch',
      icon: Upload,
      title: 'Step 1 — Upload & Extract',
      desc: 'Upload any customer demand file — PDF, Excel, CSV, MSG, EML.',
      detail: 'Go to "Upload Document" to upload any customer demand file. The system automatically extracts all rows using AI-powered parsing, maps columns to the ZSO schema (Part #, Qty, Dates, PO Number…), and stores the structured data ready for ZSO generation.',
      action: 'Go to Upload Document →',
      route: '/upload-document',
      color: 'blue',
    },
    {
      id: 'compile',
      icon: FileSpreadsheet,
      title: 'Step 2 — Generate ZSO',
      desc: 'Compile extracted data into ZSO format with all standard columns.',
      detail: 'Once a file is uploaded and extracted, open "ZSO Reports" and click "Generate ZSO" on the file. This compiles all rows into: S No · KAS Name · Customer Name · Site · Country · Incoterm · Direct Sales/WH · PO#/Forecast · Category · Sub Category · Cust Part# · Maini Part# · Open Qty · Unit Price · Currency · INR Price · Total INR · Doc Date · Ship Date · Sales Month.',
      action: 'Go to ZSO Reports →',
      route: '/zso-reports',
      color: 'indigo',
    },
    {
      id: 'enrich',
      icon: Database,
      title: 'Step 3 — Enrich with Master Data',
      desc: 'Lookup Cust Part# → fills Maini Part#, Unit Price, Currency. Injects Internal Forecast rows.',
      detail: 'Enrichment happens automatically at ZSO generation. Every Customer Part # is looked up in Master Data — filling Maini Part #, Unit Price, and Currency. Internal Forecast rows (uploaded in Master Data → Forecast Data tab) are also automatically injected for matching parts. Unmatched parts show with empty Maini Part# — fix them via "Master Data Correction" tab or upload to Master Data.',
      action: 'Go to Master Data →',
      route: '/master-data',
      color: 'emerald',
    },
  ]

  return (
    <div className="space-y-6">
      {/* Data Source Cards */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Data Sources</h2>
          <button onClick={onRefresh} className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">
            <RefreshCw size={12} /> Refresh
          </button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          {DATA_SOURCES.map((src) => (
            <div key={src.id} className={`border rounded-lg p-4 ${src.comingSoon ? 'border-dashed border-gray-300 opacity-60' : 'border-gray-200'}`}>
              <div className="flex items-center gap-2 mb-2">
                <src.icon size={16} className={`text-${src.color}-600`} />
                <span className="text-xs font-medium text-gray-700">{src.label}</span>
              </div>
              {src.comingSoon
                ? <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full">Coming Soon</span>
                : <p className="text-2xl font-bold text-gray-900">{src.count}</p>}
            </div>
          ))}
        </div>
        {stats && (
          <div className="grid grid-cols-3 gap-4 mt-4 pt-4 border-t border-gray-100">
            <StatCard label="ZSO Reports"     value={stats.zso_reports}                        color="blue"   />
            <StatCard label="Total Line Items" value={stats.total_line_items?.toLocaleString()} color="green"  />
            <StatCard
              label="Unmatched Parts"
              value={stats.unmatched_parts ?? '—'}
              color={stats.unmatched_parts > 0 ? "red" : "green"}
              subtitle="No Maini Part # in latest ZSO"
            />
          </div>
        )}
      </div>

      {/* Pipeline Steps — expandable detail + redirect button */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-1">ZSO Creation Pipeline</h2>
        <p className="text-sm text-gray-500 mb-4">Click any step to see details and jump directly to that page.</p>
        <div className="space-y-3">
          {PIPELINE_STEPS.map((step, idx) => (
            <div key={step.id} className={`border rounded-xl overflow-hidden transition-shadow ${expandedStep === step.id ? 'border-' + step.color + '-300 shadow-sm' : 'border-gray-200'}`}>
              {/* Header row — click to expand */}
              <button
                onClick={() => setExpandedStep(expandedStep === step.id ? null : step.id)}
                className="w-full flex items-center justify-between p-4 hover:bg-gray-50 text-left"
              >
                <div className="flex items-center gap-3">
                  <div className={`w-7 h-7 rounded-full bg-${step.color}-600 text-white text-xs font-bold flex items-center justify-center flex-shrink-0`}>
                    {idx + 1}
                  </div>
                  <div className={`w-9 h-9 rounded-lg bg-${step.color}-50 flex items-center justify-center flex-shrink-0`}>
                    <step.icon size={18} className={`text-${step.color}-600`} />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{step.title}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{step.desc}</p>
                  </div>
                </div>
                {expandedStep === step.id
                  ? <ChevronUp size={16} className="text-gray-400 flex-shrink-0" />
                  : <ChevronDown size={16} className="text-gray-400 flex-shrink-0" />}
              </button>

              {/* Expanded detail + redirect */}
              {expandedStep === step.id && (
                <div className={`border-t border-${step.color}-100 bg-${step.color}-50/40 px-5 py-4`}>
                  <p className="text-sm text-gray-700 leading-relaxed mb-4">{step.detail}</p>
                  <button
                    onClick={() => navigate(step.route)}
                    className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-${step.color}-600 rounded-lg hover:bg-${step.color}-700 transition-colors`}
                  >
                    <ExternalLink size={14} />
                    {step.action}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 2: DEMAND COMPARISON
// Purpose: Compare two ZSO reports side-by-side to spot what changed between
//          two demand cycles — new parts, removed parts, qty increases/decreases.
// ─────────────────────────────────────────────────────────────────────────────
function ComparisonTab() {
  const dialog = useDialog()
  const [reports, setReports] = useState([])
  const [currentId, setCurrentId] = useState('')
  const [previousId, setPreviousId] = useState('')
  const [comparable, setComparable] = useState(null)   // { target, comparables: [] }
  const [loadingComparable, setLoadingComparable] = useState(false)
  const [comparison, setComparison] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [activeSection, setActiveSection] = useState('summary')
  const [followups, setFollowups] = useState([])
  const [expandedCust, setExpandedCust] = useState(null)
  const [changeView, setChangeView] = useState('line')   // 'line' | 'part'
  const [monthFilter, setMonthFilter] = useState('all')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')

  useEffect(() => {
    fetchDemandReports().then(r => setReports(r.data)).catch(console.error)
  }, [])

  // When the "current" report changes, fetch only the reports that are
  // actually comparable to it (by part-number overlap) for the second dropdown.
  useEffect(() => {
    setPreviousId(''); setComparison(null); setComparable(null)
    if (!currentId) return
    setLoadingComparable(true)
    fetchComparableReports(currentId)
      .then(r => setComparable(r.data))
      .catch(err => setError(err.response?.data?.detail || err.message))
      .finally(() => setLoadingComparable(false))
  }, [currentId])

  const loadFollowups = useCallback(async (cur, prev) => {
    try {
      const res = await fetchFollowups(cur, prev)
      setFollowups(res.data || [])
    } catch { setFollowups([]) }
  }, [])

  const runComparison = async () => {
    if (!currentId || !previousId) { setError('Select both reports'); return }
    if (currentId === previousId) { setError('Select two different reports'); return }
    setLoading(true); setError(''); setComparison(null)
    try {
      const res = await compareDemand(currentId, previousId)
      setComparison(res.data)
      await loadFollowups(currentId, previousId)
    }
    catch (err) { setError(err.response?.data?.detail || err.message) }
    finally { setLoading(false) }
  }

  // ── Follow-up actions ──
  const logFollowup = async (item) => {
    const note = await dialog.prompt(`Log follow-up for ${item.part}`, {
      title: 'Add follow-up note',
      placeholder: 'e.g. "Confirmed +500 with customer on call"',
      defaultValue: '',
    })
    if (note === null) return
    try {
      await createFollowup({
        current_report_id: Number(currentId),
        previous_report_id: Number(previousId),
        row_id: item.row_id, part: item.part, customer: item.customer,
        change_type: item.change_type,
        prev_qty: item.prev_qty ?? null, curr_qty: item.curr_qty ?? item.qty ?? null,
        note,
      })
      await loadFollowups(currentId, previousId)
    } catch (err) { await dialog.alert('Failed', { tone: 'danger', detail: err.response?.data?.detail || err.message }) }
  }
  const toggleFollowup = async (f) => {
    try { await updateFollowup(f.id, { status: f.status === 'done' ? 'open' : 'done' }); await loadFollowups(currentId, previousId) }
    catch (err) { await dialog.alert('Failed', { tone: 'danger', detail: err.response?.data?.detail || err.message }) }
  }
  const removeFollowup = async (f) => {
    if (!(await dialog.confirm('Delete this follow-up?'))) return
    try { await deleteFollowup(f.id); await loadFollowups(currentId, previousId) }
    catch (err) { await dialog.alert('Failed', { tone: 'danger', detail: err.response?.data?.detail || err.message }) }
  }
  const followupRowIds = new Set(followups.map(f => f.row_id).filter(Boolean))

  const reportLabel = (r) => {
    const customers = (r.customers || []).filter(Boolean)
    const customerStr = customers.length > 0
      ? customers.slice(0, 2).join(' · ') + (customers.length > 2 ? ` +${customers.length - 2}` : '')
      : 'No customer name'
    const date = r.created_at
      ? new Date(r.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
      : ''
    const itemStr = r.total_items ? `${r.total_items} items` : ''
    const parts = [customerStr, itemStr].filter(Boolean)
    return `#${r.id} — ${parts.join('  ·  ')}  (${date})`
  }

  // Label for a comparable report option: version + match strength
  const comparableLabel = (c) => {
    const customers = (c.customers || []).filter(Boolean)
    const cust = customers.length ? customers.slice(0, 2).join(' · ') : 'No customer name'
    const date = c.created_at ? new Date(c.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : ''
    return `${c.version} · ${c.overlap_pct}% match (${c.shared_parts} shared) — ${cust} (${date})`
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Demand Comparison</h2>
        <p className="text-sm text-gray-500 mb-5">
          Pick a report, then compare it against an earlier <strong>version of the same demand</strong>.
          Only reports that share part numbers are offered — so you never compare unrelated customers by mistake.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          {/* Current report — free choice across all reports */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Report to analyse {comparable?.target?.version ? `(${comparable.target.version})` : ''}</label>
            <select value={currentId} onChange={e => setCurrentId(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none bg-white">
              <option value="">Select report…</option>
              {reports.map(r => (
                <option key={r.id} value={r.id}>{reportLabel(r)}</option>
              ))}
            </select>
          </div>

          {/* Previous version — filtered to comparable reports only */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Compare against (matching versions only)</label>
            <select value={previousId} onChange={e => setPreviousId(e.target.value)}
              disabled={!currentId || loadingComparable}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none bg-white disabled:bg-gray-50 disabled:text-gray-400">
              <option value="">
                {!currentId ? 'Select a report first…'
                  : loadingComparable ? 'Finding matching versions…'
                  : (comparable?.comparables?.length ? 'Select a matching version…' : 'No matching versions found')}
              </option>
              {(comparable?.comparables || []).map(c => (
                <option key={c.id} value={c.id}>{comparableLabel(c)}</option>
              ))}
            </select>
            {currentId && !loadingComparable && comparable && comparable.comparables.length === 0 && (
              <p className="mt-1.5 text-xs text-amber-600">
                No other report shares enough part numbers with this one. Upload an earlier/later version of the same demand to compare.
              </p>
            )}
          </div>
        </div>

        <button onClick={runComparison} disabled={loading || !currentId || !previousId}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
          {loading ? <Loader2 size={14} className="animate-spin" /> : <ArrowRightLeft size={14} />}
          Run Comparison
        </button>

        {error && <div className="mt-3 p-3 bg-red-50 text-red-700 text-sm rounded-lg border border-red-200">{error}</div>}
      </div>

      {comparison && (() => {
        const k = comparison.kpi || {}
        const SECTIONS = [
          { id: 'summary', label: 'Summary' },
          { id: 'changes', label: 'Quantity Changes' },
          { id: 'new', label: 'New Parts' },
          { id: 'removed', label: 'Removed Parts' },
          { id: 'customer', label: 'Customer Summary' },
          { id: 'monthly', label: 'Monthly Summary' },
        ]
        return (
        <>
          {/* KPI strip — Drop / Increase, qty + value */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="border bg-green-50 border-green-200 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-1 text-green-700"><TrendingUp size={15} /><span className="text-xs font-medium">Increase</span></div>
              <p className="text-2xl font-bold text-green-800">{cmpNum(k.increase_qty)}<span className="text-sm font-medium text-green-600"> qty</span></p>
              <p className="text-xs text-green-700 mt-0.5">{cmpMoney(k.increase_value)} · {k.increase_lines + k.new_lines} lines</p>
            </div>
            <div className="border bg-red-50 border-red-200 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-1 text-red-700"><TrendingDown size={15} /><span className="text-xs font-medium">Drop</span></div>
              <p className="text-2xl font-bold text-red-800">{cmpNum(k.drop_qty)}<span className="text-sm font-medium text-red-600"> qty</span></p>
              <p className="text-xs text-red-700 mt-0.5">{cmpMoney(k.drop_value)} · {k.drop_lines + k.removed_lines} lines</p>
            </div>
            <div className="border bg-blue-50 border-blue-200 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-1 text-blue-700"><ArrowRightLeft size={15} /><span className="text-xs font-medium">Net Change</span></div>
              <p className={`text-2xl font-bold ${k.net_qty >= 0 ? 'text-green-800' : 'text-red-800'}`}>{k.net_qty >= 0 ? '+' : ''}{cmpNum(k.net_qty)}</p>
              <p className="text-xs text-blue-700 mt-0.5">{k.net_value >= 0 ? '+' : '−'}{cmpMoney(Math.abs(k.net_value))} net value</p>
            </div>
            <div className="border bg-orange-50 border-orange-200 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-1 text-orange-700"><AlertTriangle size={15} /><span className="text-xs font-medium">New / Removed / Follow-ups</span></div>
              <p className="text-2xl font-bold text-orange-800">{k.new_lines} / {k.removed_lines} / {k.abrupt_changes}</p>
              <p className="text-xs text-orange-700 mt-0.5">new · removed · need follow-up</p>
            </div>
          </div>

          {/* Segmented switcher */}
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1 flex-wrap">
            {SECTIONS.map(s => (
              <button key={s.id} onClick={() => setActiveSection(s.id)}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${activeSection === s.id ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}>
                {s.label}
              </button>
            ))}
          </div>

          {/* SUMMARY — overview + follow-up audit trail */}
          {activeSection === 'summary' && (
            <div className="space-y-4">
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <p className="text-sm text-gray-700 mb-3">
                Net change vs the selected earlier version:{' '}
                <b className={k.net_qty >= 0 ? 'text-green-700' : 'text-red-700'}>{k.net_qty >= 0 ? '+' : ''}{cmpNum(k.net_qty)} qty</b>
                {' '}({k.net_value >= 0 ? '+' : '−'}{cmpMoney(Math.abs(k.net_value))}). Click a card to jump to its detail.
              </p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {[
                  { label: 'Qty Increased', n: k.increase_lines, id: 'changes' },
                  { label: 'Qty Dropped', n: k.drop_lines, id: 'changes' },
                  { label: 'New Parts', n: k.new_lines, id: 'new' },
                  { label: 'Removed Parts', n: k.removed_lines, id: 'removed' },
                ].map(s => (
                  <button key={s.label} onClick={() => setActiveSection(s.id)}
                    className="border border-gray-200 rounded-lg p-3 text-left hover:bg-gray-50 transition-colors">
                    <p className="text-xs text-gray-500">{s.label}</p>
                    <p className="text-2xl font-bold text-gray-800">{s.n}</p>
                  </button>
                ))}
              </div>
              <p className="text-xs text-gray-400 mt-3">An empty section simply means there were no changes of that type between these two versions.</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100 bg-orange-50 flex items-center gap-2">
                <AlertTriangle size={15} className="text-orange-600" />
                <h3 className="text-sm font-semibold text-orange-800">Customer Follow-ups <span className="text-orange-400 font-normal ml-1">({followups.length})</span></h3>
              </div>
              {followups.length === 0 ? (
                <div className="px-5 py-8 text-center text-sm text-gray-400">
                  No follow-ups yet. Open Quantity Changes / New / Removed and click
                  <span className="mx-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 text-xs"><AlertTriangle size={11}/> Log follow-up</span>
                  on an abrupt change to start the audit trail.
                </div>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {followups.map(f => (
                    <li key={f.id} className="px-5 py-3 flex items-start gap-3">
                      <button onClick={() => toggleFollowup(f)} className="mt-0.5 shrink-0" title={f.status === 'done' ? 'Mark open' : 'Mark done'}>
                        {f.status === 'done' ? <CheckCircle size={18} className="text-green-600" /> : <Clock size={18} className="text-orange-500" />}
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs text-gray-800">{f.part || '—'}</span>
                          {f.customer && <span className="text-xs text-gray-500">· {f.customer}</span>}
                          <span className={`text-[11px] px-1.5 py-0.5 rounded capitalize ${
                            f.change_type === 'new' ? 'bg-blue-100 text-blue-700'
                            : f.change_type === 'removed' ? 'bg-yellow-100 text-yellow-700'
                            : f.change_type === 'increase' ? 'bg-green-100 text-green-700'
                            : 'bg-red-100 text-red-700'}`}>{f.change_type === 'decrease' ? 'drop' : f.change_type}</span>
                          {(f.prev_qty != null || f.curr_qty != null) && (<span className="text-[11px] text-gray-400">{f.prev_qty ?? '—'} → {f.curr_qty ?? '—'}</span>)}
                          {f.status === 'done' && <span className="text-[11px] text-green-600">✓ resolved</span>}
                        </div>
                        <p className={`text-sm mt-0.5 ${f.status === 'done' ? 'text-gray-400 line-through' : 'text-gray-700'}`}>{f.note || '(no note)'}</p>
                        <p className="text-[11px] text-gray-400 mt-0.5">{f.created_at ? new Date(f.created_at).toLocaleString('en-IN', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }) : ''}</p>
                      </div>
                      <button onClick={() => removeFollowup(f)} className="p-1 rounded hover:bg-red-50 text-red-400 shrink-0" title="Delete"><Trash2 size={15} /></button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            </div>
          )}

          {/* QUANTITY CHANGES — per-line / per-part toggle + month filter */}
          {activeSection === 'changes' && (() => {
            const months = (comparison.monthly_summary || []).map(m => m.month)
            const lines = [...comparison.increases, ...comparison.decreases]
              .filter(x => monthFilter === 'all' || x.month === monthFilter)
              .filter(x => inDateRange(x.ship_date, fromDate, toDate))
            return (
              <div className="space-y-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs font-medium">
                    <button onClick={() => setChangeView('line')} className={`px-3 py-1.5 ${changeView === 'line' ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}>Per line</button>
                    <button onClick={() => setChangeView('part')} className={`px-3 py-1.5 ${changeView === 'part' ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}>Per part (net)</button>
                  </div>
                  <select value={monthFilter} onChange={e => setMonthFilter(e.target.value)}
                    className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg">
                    <option value="all">All ship months</option>
                    {months.map(m => <option key={m} value={m}>{cmpMonth(m)}</option>)}
                  </select>
                  <DateRangeFilter from={fromDate} to={toDate} setFrom={setFromDate} setTo={setToDate} />
                </div>

                {changeView === 'line' ? (
                  <ComparisonTable
                    title="Quantity Changes — per line (biggest first)"
                    columns={['Cust Part #', 'Customer', 'Prev Qty', 'Curr Qty', 'Change', 'PO / Forecast', 'Ship Date', 'Follow-up']}
                    rows={lines}
                    renderRow={(item, i) => (
                      <tr key={i} className={`border-b border-gray-50 ${item.abrupt ? 'bg-orange-50/40' : item.change > 0 ? 'bg-green-50/20' : 'bg-red-50/20'}`}>
                        <td className="px-4 py-2 font-mono text-xs text-gray-800">{item.part}</td>
                        <td className="px-4 py-2 text-sm text-gray-600">{item.customer || '—'}</td>
                        <td className="px-4 py-2 text-sm">{cmpNum(item.prev_qty)}</td>
                        <td className="px-4 py-2 text-sm font-semibold">{cmpNum(item.curr_qty)}</td>
                        <td className="px-4 py-2 text-sm font-bold"><span className={item.change > 0 ? 'text-green-700' : 'text-red-700'}>{item.change > 0 ? '+' : ''}{cmpNum(item.change)}</span></td>
                        <td className="px-4 py-2 text-xs text-gray-500">{item.po || '—'}</td>
                        <td className="px-4 py-2 text-xs text-gray-500">{item.ship_date || '—'}</td>
                        <td className="px-4 py-2">{renderFollowupCell(item, followupRowIds, logFollowup)}</td>
                      </tr>
                    )}
                    empty="No quantity changes for this filter."
                  />
                ) : (
                  <ComparisonTable
                    title="Quantity Changes — per part (net, biggest first)"
                    columns={['Maini Part #', 'Cust Part #', 'Customer', 'Net Change', 'Lines']}
                    rows={rollupByPart(lines)}
                    renderRow={(p, i) => (
                      <tr key={i} className={`border-b border-gray-50 ${p.abrupt ? 'bg-orange-50/40' : p.net_change >= 0 ? 'bg-green-50/20' : 'bg-red-50/20'}`}>
                        <td className="px-4 py-2 font-mono text-xs text-gray-800">{p.maini_part_no || '—'}</td>
                        <td className="px-4 py-2 font-mono text-xs text-gray-600">{p.part || '—'}</td>
                        <td className="px-4 py-2 text-sm text-gray-600">{p.customer || '—'}</td>
                        <td className="px-4 py-2 text-sm font-bold"><span className={p.net_change >= 0 ? 'text-green-700' : 'text-red-700'}>{p.net_change > 0 ? '+' : ''}{cmpNum(p.net_change)}</span></td>
                        <td className="px-4 py-2 text-xs text-gray-500">{p.lines}</td>
                      </tr>
                    )}
                    empty="No quantity changes for this filter."
                  />
                )}
              </div>
            )
          })()}

          {/* NEW PARTS */}
          {activeSection === 'new' && (
            <ComparisonTable
              title="New Parts (in current, not in previous)"
              columns={['Cust Part #', 'Customer', 'Qty', 'PO / Forecast', 'Ship Date', 'Follow-up']}
              rows={comparison.new_items}
              renderRow={(item, i) => (
                <tr key={i} className="border-b border-gray-50 bg-blue-50/20">
                  <td className="px-4 py-2 font-mono text-xs text-gray-800">{item.part}</td>
                  <td className="px-4 py-2 text-sm text-gray-600">{item.customer || '—'}</td>
                  <td className="px-4 py-2 text-sm font-semibold text-blue-700">{cmpNum(item.qty)}</td>
                  <td className="px-4 py-2 text-xs text-gray-500">{item.po || '—'}</td>
                  <td className="px-4 py-2 text-xs text-gray-500">{item.ship_date || '—'}</td>
                  <td className="px-4 py-2">{renderFollowupCell(item, followupRowIds, logFollowup)}</td>
                </tr>
              )}
              empty="No new parts."
            />
          )}

          {/* REMOVED PARTS */}
          {activeSection === 'removed' && (
            <ComparisonTable
              title="Removed Parts (in previous, not in current)"
              columns={['Cust Part #', 'Customer', 'Qty', 'PO / Forecast', 'Ship Date', 'Follow-up']}
              rows={comparison.removed_items}
              renderRow={(item, i) => (
                <tr key={i} className="border-b border-gray-50 bg-yellow-50/20">
                  <td className="px-4 py-2 font-mono text-xs text-gray-800">{item.part}</td>
                  <td className="px-4 py-2 text-sm text-gray-600">{item.customer || '—'}</td>
                  <td className="px-4 py-2 text-sm font-semibold text-yellow-700">{cmpNum(item.qty)}</td>
                  <td className="px-4 py-2 text-xs text-gray-500">{item.po || '—'}</td>
                  <td className="px-4 py-2 text-xs text-gray-500">{item.ship_date || '—'}</td>
                  <td className="px-4 py-2">{renderFollowupCell(item, followupRowIds, logFollowup)}</td>
                </tr>
              )}
              empty="No removed parts."
            />
          )}

          {/* CUSTOMER SUMMARY — Drop & Increase by customer, expandable */}
          {activeSection === 'customer' && (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100 bg-gray-50">
                <h3 className="text-sm font-semibold text-gray-800">Drop &amp; Increase Summary — by Customer <span className="text-gray-400 font-normal ml-1">({(comparison.customer_summary || []).length})</span></h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-gray-100">
                    {['', 'Customer', 'Increase Qty', 'Drop Qty', 'Net Qty', 'Increase Value', 'Drop Value', 'Net Value', 'Parts'].map(h => (
                      <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase whitespace-nowrap">{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {(comparison.customer_summary || []).length === 0
                      ? <tr><td colSpan={9} className="px-4 py-6 text-center text-sm text-gray-400">No changes to summarize.</td></tr>
                      : comparison.customer_summary.map((c, i) => {
                        const open = expandedCust === c.customer
                        return (
                          <Fragment key={i}>
                            <tr className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer" onClick={() => setExpandedCust(open ? null : c.customer)}>
                              <td className="px-4 py-2 text-gray-400">{open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</td>
                              <td className="px-4 py-2 font-medium text-gray-800">{c.customer}</td>
                              <td className="px-4 py-2 text-green-700">{cmpNum(c.increase_qty)}</td>
                              <td className="px-4 py-2 text-red-700">{cmpNum(c.drop_qty)}</td>
                              <td className={`px-4 py-2 font-semibold ${c.net_qty >= 0 ? 'text-green-800' : 'text-red-800'}`}>{c.net_qty >= 0 ? '+' : ''}{cmpNum(c.net_qty)}</td>
                              <td className="px-4 py-2 text-green-700">{cmpMoney(c.increase_value)}</td>
                              <td className="px-4 py-2 text-red-700">{cmpMoney(c.drop_value)}</td>
                              <td className={`px-4 py-2 font-semibold ${c.net_value >= 0 ? 'text-green-800' : 'text-red-800'}`}>{c.net_value >= 0 ? '+' : '−'}{cmpMoney(Math.abs(c.net_value))}</td>
                              <td className="px-4 py-2 text-gray-500">{c.part_count}</td>
                            </tr>
                            {open && (
                              <tr className="bg-gray-50/60"><td></td><td colSpan={8} className="px-4 py-2">
                                <table className="w-full text-xs">
                                  <thead><tr className="text-gray-400">
                                    {['Cust Part #', 'Type', 'Prev', 'Curr', 'Change', 'Ship Date'].map(h => <th key={h} className="text-left font-medium py-1 pr-4">{h}</th>)}
                                  </tr></thead>
                                  <tbody>
                                    {c.parts.map((p, j) => (
                                      <tr key={j} className="border-t border-gray-100">
                                        <td className="py-1 pr-4 font-mono text-gray-700">{p.part}</td>
                                        <td className="py-1 pr-4 capitalize">{p.change_type}</td>
                                        <td className="py-1 pr-4">{p.prev_qty != null ? cmpNum(p.prev_qty) : '—'}</td>
                                        <td className="py-1 pr-4">{p.curr_qty != null ? cmpNum(p.curr_qty) : (p.qty != null ? cmpNum(p.qty) : '—')}</td>
                                        <td className={`py-1 pr-4 font-medium ${(p.change ?? p.qty ?? 0) >= 0 && p.change_type !== 'drop' && p.change_type !== 'removed' ? 'text-green-700' : 'text-red-700'}`}>
                                          {p.change != null ? (p.change > 0 ? '+' : '') + cmpNum(p.change) : (p.change_type === 'removed' ? '−' + cmpNum(p.qty) : '+' + cmpNum(p.qty))}
                                        </td>
                                        <td className="py-1 pr-4 text-gray-400">{p.ship_date || '—'}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </td></tr>
                            )}
                          </Fragment>
                        )
                      })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* MONTHLY SUMMARY — by ship month, with month filter */}
          {activeSection === 'monthly' && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                <select value={monthFilter} onChange={e => setMonthFilter(e.target.value)}
                  className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg">
                  <option value="all">All ship months</option>
                  {(comparison.monthly_summary || []).map(m => <option key={m.month} value={m.month}>{cmpMonth(m.month)}</option>)}
                </select>
                <DateRangeFilter from={fromDate} to={toDate} setFrom={setFromDate} setTo={setToDate} />
              </div>
              <ComparisonTable
                title="Monthly Summary — changes by ship month"
                columns={['Ship Month', 'Increase Qty', 'Drop Qty', 'Net Qty', 'Increase Value', 'Drop Value', 'Net Value', 'Parts']}
                rows={(comparison.monthly_summary || []).filter(m => (monthFilter === 'all' || m.month === monthFilter) && monthInRange(m.month, fromDate, toDate))}
                renderRow={(m, i) => (
                <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="px-4 py-2 font-medium text-gray-800">{cmpMonth(m.month)}</td>
                  <td className="px-4 py-2 text-green-700">{cmpNum(m.increase_qty)}</td>
                  <td className="px-4 py-2 text-red-700">{cmpNum(m.drop_qty)}</td>
                  <td className={`px-4 py-2 font-semibold ${m.net_qty >= 0 ? 'text-green-800' : 'text-red-800'}`}>{m.net_qty >= 0 ? '+' : ''}{cmpNum(m.net_qty)}</td>
                  <td className="px-4 py-2 text-green-700">{cmpMoney(m.increase_value)}</td>
                  <td className="px-4 py-2 text-red-700">{cmpMoney(m.drop_value)}</td>
                  <td className={`px-4 py-2 font-semibold ${m.net_value >= 0 ? 'text-green-800' : 'text-red-800'}`}>{m.net_value >= 0 ? '+' : '−'}{cmpMoney(Math.abs(m.net_value))}</td>
                  <td className="px-4 py-2 text-gray-500">{m.part_count}</td>
                </tr>
              )}
              empty="No monthly changes."
              />
            </div>
          )}
        </>
        )
      })()}

      {!comparison && !loading && (
        <div className="bg-white rounded-xl border border-gray-200 p-10 text-center text-sm text-gray-400">
          <ArrowRightLeft size={32} className="mx-auto mb-3 opacity-30" />
          Select two ZSO reports above and click "Run Comparison" to see what changed.
        </div>
      )}
    </div>
  )
}

// Renders the Follow-up cell for a comparison row: shows an abrupt badge +
// "Log follow-up" button, or a ✓ Logged chip if one already exists for the row.
function renderFollowupCell(item, followupRowIds, logFollowup) {
  const logged = item.row_id && followupRowIds.has(item.row_id)
  if (logged) {
    return <span className="inline-flex items-center gap-1 text-xs text-green-700"><CheckCircle size={13} /> Logged</span>
  }
  if (!item.abrupt) return <span className="text-xs text-gray-300">—</span>
  return (
    <button onClick={() => logFollowup(item)}
      className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium bg-orange-100 text-orange-700 rounded hover:bg-orange-200">
      <AlertTriangle size={12} /> Log follow-up
    </button>
  )
}

// Filter a line by its ship-date against a From/To range (inclusive). A line
// with no/unparseable ship date is excluded once any bound is set.
const inDateRange = (shipDate, from, to) => {
  if (!from && !to) return true
  if (!shipDate) return false
  const t = new Date(shipDate).getTime()
  if (isNaN(t)) return false
  if (from && t < new Date(from).getTime()) return false
  if (to && t > new Date(to + 'T23:59:59').getTime()) return false
  return true
}
// Same idea for a YYYY-MM month bucket (used by Monthly Summary).
const monthInRange = (month, from, to) => {
  if (!from && !to) return true
  if (!month || month === 'Unscheduled') return false
  if (from && month < from.slice(0, 7)) return false
  if (to && month > to.slice(0, 7)) return false
  return true
}

// Aggregate per-line changes into one net row per Maini part (for #6 per-part view).
function rollupByPart(lines) {
  const map = {}
  for (const x of lines) {
    const key = x.maini_part_no || x.part || x.row_id
    const g = map[key] || (map[key] = {
      maini_part_no: x.maini_part_no || '', part: x.part || '', customer: x.customer || '',
      net_change: 0, net_value: 0, lines: 0, abrupt: false,
    })
    g.net_change += (x.change || 0)
    g.net_value += (x.value_change || 0)
    g.lines += 1
    g.abrupt = g.abrupt || !!x.abrupt
  }
  return Object.values(map).sort((a, b) => Math.abs(b.net_change) - Math.abs(a.net_change))
}

const cmpNum = (n) => Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })
const cmpMoney = (n) => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })
const CMP_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const cmpMonth = (m) => {
  if (!m || m === 'Unscheduled') return 'Unscheduled'
  const [y, mo] = m.split('-')
  return mo ? `${CMP_MONTHS[+mo - 1]} ${y}` : m
}

function DateRangeFilter({ from, to, setFrom, setTo }) {
  return (
    <div className="flex items-center gap-1.5 text-sm">
      <span className="text-xs text-gray-500">Ship date</span>
      <input type="date" value={from} onChange={e => setFrom(e.target.value)} max={to || undefined}
        className="px-2 py-1.5 text-sm border border-gray-200 rounded-lg" title="From ship date" />
      <span className="text-gray-400">→</span>
      <input type="date" value={to} onChange={e => setTo(e.target.value)} min={from || undefined}
        className="px-2 py-1.5 text-sm border border-gray-200 rounded-lg" title="To ship date" />
      {(from || to) && (
        <button onClick={() => { setFrom(''); setTo('') }}
          className="px-2 py-1 text-xs text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50">Clear</button>
      )}
    </div>
  )
}

function ComparisonTable({ title, columns, rows, renderRow, empty }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-5 py-3 border-b border-gray-100 bg-gray-50">
        <h3 className="text-sm font-semibold text-gray-800">{title} <span className="text-gray-400 font-normal ml-1">({rows.length})</span></h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-gray-100">
            {columns.map(h => <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase">{h}</th>)}
          </tr></thead>
          <tbody>
            {rows.length === 0
              ? <tr><td colSpan={columns.length} className="px-4 py-6 text-center text-sm text-gray-400">{empty}</td></tr>
              : rows.map(renderRow)}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 3: VMI & SAFETY STOCK
// Purpose: Upload and view VMI (Vendor Managed Inventory) demand data and
//          Safety Stock contractual requirements. These are separate from PO
//          demand — VMI is continuous replenishment, Safety Stock is a buffer
//          commitment defined in contracts.
// ─────────────────────────────────────────────────────────────────────────────
function VMITab() {
  const dialog = useDialog()
  const [vmiUploads, setVmiUploads] = useState([])
  const [ssUploads, setSsUploads] = useState([])
  const [uploading, setUploading] = useState(null)
  const [previewData, setPreviewData] = useState(null)
  const vmiRef = useRef(null)
  const ssRef = useRef(null)

  const load = useCallback(async () => {
    try {
      const [vmi, ss] = await Promise.all([fetchDemandUploads('vmi'), fetchDemandUploads('safety_stock')])
      setVmiUploads(vmi.data || [])
      setSsUploads(ss.data || [])
    } catch (err) { console.error(err) }
  }, [])

  useEffect(() => { load() }, [load])

  const handleUpload = async (file, type) => {
    if (!file) return
    setUploading(type)
    try {
      await uploadDemandFile(file, type)
      load()
    } catch (err) {
      await dialog.alert('Upload failed', { tone: 'danger', detail: err.response?.data?.detail || err.message })
    } finally { setUploading(null) }
  }

  const handleDelete = async (id) => {
    if (!(await dialog.confirm('Delete this upload?'))) return
    try { await deleteDemandUpload(id); load() }
    catch (err) { await dialog.alert('Delete failed', { tone: 'danger' }) }
  }

  const handlePreview = async (id) => {
    if (previewData?.id === id) { setPreviewData(null); return }
    try { const res = await previewDemandUpload(id); setPreviewData(res.data) }
    catch (err) { await dialog.alert('Preview failed', { tone: 'danger' }) }
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* VMI */}
        <UploadCard
          title="VMI Demand"
          subtitle="Vendor Managed Inventory — continuous stock replenishment data from customer portals. Upload the portal data dump showing min/max stock levels and consumption."
          type="vmi"
          uploads={vmiUploads}
          uploading={uploading === 'vmi'}
          previewData={previewData}
          fileRef={vmiRef}
          onUpload={e => handleUpload(e.target.files?.[0], 'vmi')}
          onDelete={handleDelete}
          onPreview={handlePreview}
          color="purple"
        />
        {/* Safety Stock */}
        <UploadCard
          title="Safety Stock Demand"
          subtitle="Contractual safety stock buffer requirements. Upload the contract or safety stock file specifying minimum stock commitments per part."
          type="safety_stock"
          uploads={ssUploads}
          uploading={uploading === 'safety_stock'}
          previewData={previewData}
          fileRef={ssRef}
          onUpload={e => handleUpload(e.target.files?.[0], 'safety_stock')}
          onDelete={handleDelete}
          onPreview={handlePreview}
          color="teal"
        />
      </div>
    </div>
  )
}

function UploadCard({ title, subtitle, type, uploads, uploading, previewData, fileRef, onUpload, onDelete, onPreview, color }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <h2 className="text-base font-semibold text-gray-900 mb-1">{title}</h2>
      <p className="text-xs text-gray-500 mb-4 leading-relaxed">{subtitle}</p>

      <div className="border-2 border-dashed border-gray-200 rounded-lg p-5 text-center mb-4 cursor-pointer hover:border-blue-400 transition-colors"
        onClick={() => fileRef.current?.click()}>
        {uploading
          ? <Loader2 size={22} className="mx-auto text-blue-500 mb-2 animate-spin" />
          : <Upload size={22} className="mx-auto text-gray-400 mb-2" />}
        <p className="text-sm text-gray-600">{uploading ? 'Uploading…' : 'Click to upload'}</p>
        <p className="text-xs text-gray-400 mt-0.5">.xlsx, .xls, .csv</p>
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={onUpload} className="hidden" />
      </div>

      {/* Uploaded files list */}
      {uploads.length > 0 ? (
        <div className="border border-gray-100 rounded-lg overflow-hidden">
          {uploads.map(u => (
            <div key={u.id}>
              <div className="flex items-center justify-between px-3 py-2 border-b border-gray-50 hover:bg-gray-50">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-gray-800 truncate">{u.filename}</p>
                  <p className="text-xs text-gray-400">{u.row_count} rows · {u.created_at?.split('T')[0]}</p>
                </div>
                <div className="flex items-center gap-1 ml-2 flex-shrink-0">
                  <button onClick={() => onPreview(u.id)} className="p-1 text-gray-400 hover:text-blue-600 rounded"><Eye size={13} /></button>
                  <button onClick={() => onDelete(u.id)} className="p-1 text-gray-400 hover:text-red-600 rounded"><Trash2 size={13} /></button>
                </div>
              </div>
              {previewData?.id === u.id && (
                <div className="bg-gray-50 px-3 py-2 border-b border-gray-100">
                  <div className="overflow-x-auto max-h-36 border border-gray-200 rounded">
                    <table className="text-xs w-full">
                      <thead className="bg-white sticky top-0">
                        <tr>{previewData.columns.map(c => <th key={c} className="px-2 py-1 text-left font-semibold text-gray-500 border-b whitespace-nowrap">{c}</th>)}</tr>
                      </thead>
                      <tbody>
                        {previewData.rows.slice(0, 20).map((row, i) => (
                          <tr key={i} className="border-b border-gray-50">
                            {previewData.columns.map(c => <td key={c} className="px-2 py-0.5 text-gray-600 whitespace-nowrap">{row[c] || ''}</td>)}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-gray-400 text-center py-2">No {type.replace('_', ' ')} files uploaded yet.</p>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 4: MASTER DATA CORRECTION
// Purpose: When ZSO shows an unmatched part (Maini Part # missing, wrong price,
//          etc.), KAS submits a correction request. Admin reviews and approves —
//          which automatically updates the Master Data record.
// ─────────────────────────────────────────────────────────────────────────────
const FIELD_LABELS = {
  maini_part_no: 'Maini Part #',
  unit_price: 'Unit Price',
  currency: 'Currency',
  description: 'Description',
  country: 'Country',
  hsn_code: 'HSN Code',
  customer_name: 'Customer Name',
  customer_location: 'Customer Location',
}

function MasterCorrectionTab() {
  const dialog = useDialog()
  const [corrections, setCorrections] = useState([])
  const [corrStats, setCorrStats] = useState({ pending: 0, approved: 0, rejected: 0 })
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('all')
  const [showForm, setShowForm] = useState(false)
  const [reviewModal, setReviewModal] = useState(null) // {id, action}
  const [reviewNotes, setReviewNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const emptyForm = { customer_part_no: '', customer_name: '', field_name: 'maini_part_no', new_value: '', reason: '' }
  const [form, setForm] = useState(emptyForm)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [corr, stats] = await Promise.all([
        fetchCorrections(statusFilter === 'all' ? undefined : statusFilter),
        fetchCorrectionStats(),
      ])
      setCorrections(corr.data || [])
      setCorrStats(stats.data || { pending: 0, approved: 0, rejected: 0 })
    } catch (err) { console.error(err) }
    finally { setLoading(false) }
  }, [statusFilter])

  useEffect(() => { load() }, [load])

  const handleSubmit = async () => {
    if (!form.customer_part_no.trim() || !form.new_value.trim()) {
      await dialog.alert('Customer Part # and New Value are required.')
      return
    }
    setSubmitting(true)
    try {
      await createCorrection(form)
      setForm(emptyForm); setShowForm(false); load()
    } catch (err) {
      await dialog.alert('Submit failed', { tone: 'danger', detail: err.response?.data?.detail || err.message })
    } finally { setSubmitting(false) }
  }

  const handleReview = async (id, action) => {
    setSubmitting(true)
    try {
      await reviewCorrection(id, { status: action, review_notes: reviewNotes || null })
      setReviewModal(null); setReviewNotes(''); load()
    } catch (err) {
      await dialog.alert('Review failed', { tone: 'danger', detail: err.response?.data?.detail || err.message })
    } finally { setSubmitting(false) }
  }

  const handleDelete = async (id) => {
    if (!(await dialog.confirm('Delete this correction request?'))) return
    try { await deleteCorrection(id); load() }
    catch (err) { await dialog.alert('Delete failed', { tone: 'danger' }) }
  }

  const STATUS_BADGE = {
    pending:  'bg-yellow-100 text-yellow-700',
    approved: 'bg-green-100 text-green-700',
    rejected: 'bg-red-100 text-red-700',
  }
  const STATUS_ICON = {
    pending:  <Clock size={12} />,
    approved: <CheckCircle size={12} />,
    rejected: <XCircle size={12} />,
  }

  return (
    <div className="space-y-5">
      {/* Info banner */}
      <div className="p-4 bg-amber-50 border border-amber-100 rounded-lg flex gap-3">
        <Shield size={18} className="text-amber-500 flex-shrink-0 mt-0.5" />
        <div className="text-sm text-amber-800">
          <p className="font-medium">How corrections work</p>
          <p className="mt-1 text-amber-700">
            When a ZSO shows a part with missing Maini Part #, wrong unit price, or any other master data issue —
            submit a correction request here. An Admin reviews and approves it, which <strong>automatically updates</strong> the
            Master Data record. The next ZSO generated will use the corrected data.
          </p>
        </div>
      </div>

      {/* Stats + actions */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex gap-3">
          {[
            { label: 'Pending', key: 'pending', color: 'yellow' },
            { label: 'Approved', key: 'approved', color: 'green' },
            { label: 'Rejected', key: 'rejected', color: 'red' },
          ].map(s => (
            <button key={s.key} onClick={() => setStatusFilter(statusFilter === s.key ? 'all' : s.key)}
              className={`border rounded-lg px-3 py-2 text-center transition-colors ${statusFilter === s.key ? `border-${s.color}-400 bg-${s.color}-50` : 'border-gray-200 bg-white hover:bg-gray-50'}`}>
              <p className={`text-xs font-medium text-${s.color}-700`}>{s.label}</p>
              <p className={`text-xl font-bold text-${s.color}-800`}>{corrStats[s.key]}</p>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50">
            <RefreshCw size={14} className={loading ? 'animate-spin text-blue-500' : 'text-gray-400'} />
          </button>
          <button onClick={() => setShowForm(true)}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700">
            <Plus size={15} /> New Correction Request
          </button>
        </div>
      </div>

      {/* Corrections table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>{['Cust Part #', 'Customer', 'Field', 'Old Value', 'New Value', 'Reason', 'Status', 'Date', 'Actions'].map(h => (
              <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase whitespace-nowrap">{h}</th>
            ))}</tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} className="px-4 py-8 text-center text-sm text-gray-400"><Loader2 size={18} className="animate-spin mx-auto" /></td></tr>
            ) : corrections.length === 0 ? (
              <tr><td colSpan={9} className="px-4 py-8 text-center text-sm text-gray-400">
                No correction requests {statusFilter !== 'all' ? `with status "${statusFilter}"` : 'yet'}.
              </td></tr>
            ) : corrections.map(c => (
              <tr key={c.id} className="border-b border-gray-50 hover:bg-gray-50">
                <td className="px-4 py-3 font-mono text-xs text-gray-800">{c.customer_part_no}</td>
                <td className="px-4 py-3 text-xs text-gray-600">{c.customer_name || '—'}</td>
                <td className="px-4 py-3"><span className="bg-gray-100 text-gray-700 text-xs px-2 py-0.5 rounded-full">{FIELD_LABELS[c.field_name] || c.field_name}</span></td>
                <td className="px-4 py-3 text-xs text-gray-500 max-w-24 truncate" title={c.old_value}>{c.old_value || '—'}</td>
                <td className="px-4 py-3 text-xs font-semibold text-gray-900 max-w-24 truncate" title={c.new_value}>{c.new_value}</td>
                <td className="px-4 py-3 text-xs text-gray-500 max-w-32 truncate" title={c.reason}>{c.reason || '—'}</td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_BADGE[c.status]}`}>
                    {STATUS_ICON[c.status]}{c.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-gray-400">{c.created_at?.split('T')[0]}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1">
                    {c.status === 'pending' && (
                      <>
                        <button onClick={() => { setReviewModal({ id: c.id, action: 'approved' }); setReviewNotes('') }}
                          className="p-1 text-green-400 hover:text-green-700 rounded hover:bg-green-50" title="Approve">
                          <CheckCircle size={15} />
                        </button>
                        <button onClick={() => { setReviewModal({ id: c.id, action: 'rejected' }); setReviewNotes('') }}
                          className="p-1 text-red-400 hover:text-red-700 rounded hover:bg-red-50" title="Reject">
                          <XCircle size={15} />
                        </button>
                      </>
                    )}
                    <button onClick={() => handleDelete(c.id)} className="p-1 text-gray-300 hover:text-red-500 rounded" title="Delete">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* New Correction Modal */}
      {showForm && (
        <Modal title="New Correction Request" onClose={() => setShowForm(false)}>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField label="Customer Part # *" value={form.customer_part_no} onChange={v => setForm({ ...form, customer_part_no: v })} placeholder="e.g. 649-481-136-0" />
              <FormField label="Customer Name" value={form.customer_name} onChange={v => setForm({ ...form, customer_name: v })} placeholder="e.g. Safran HAL" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Field to Correct *</label>
              <select value={form.field_name} onChange={e => setForm({ ...form, field_name: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none">
                {Object.entries(FIELD_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <FormField label="New Value *" value={form.new_value} onChange={v => setForm({ ...form, new_value: v })} placeholder={form.field_name === 'unit_price' ? '105.87' : 'Enter new value'} />
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Reason</label>
              <textarea value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} rows={2}
                placeholder="Why is this correction needed?"
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none resize-none" />
            </div>
          </div>
          <div className="flex justify-end gap-3 mt-5">
            <button onClick={() => setShowForm(false)} className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50">Cancel</button>
            <button onClick={handleSubmit} disabled={submitting}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
              {submitting ? 'Submitting…' : 'Submit Request'}
            </button>
          </div>
        </Modal>
      )}

      {/* Review Modal */}
      {reviewModal && (
        <Modal title={reviewModal.action === 'approved' ? '✓ Approve Correction' : '✗ Reject Correction'} onClose={() => setReviewModal(null)}>
          <p className="text-sm text-gray-600 mb-4">
            {reviewModal.action === 'approved'
              ? 'Approving will immediately update the Master Data record.'
              : 'Rejecting will dismiss the request without any changes.'}
          </p>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Review Notes (optional)</label>
            <textarea value={reviewNotes} onChange={e => setReviewNotes(e.target.value)} rows={2}
              placeholder="Optional note for the requester…"
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none resize-none" />
          </div>
          <div className="flex justify-end gap-3 mt-4">
            <button onClick={() => setReviewModal(null)} className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50">Cancel</button>
            <button onClick={() => handleReview(reviewModal.id, reviewModal.action)} disabled={submitting}
              className={`px-4 py-2 text-sm text-white rounded-lg disabled:opacity-50 ${reviewModal.action === 'approved' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'}`}>
              {submitting ? 'Processing…' : reviewModal.action === 'approved' ? 'Approve & Apply' : 'Reject'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ─── Shared helpers ───────────────────────────────────────────────────────────
function StatCard({ label, value, color, subtitle }) {
  return (
    <div className={`border border-${color}-200 bg-${color}-50 rounded-lg p-3`}>
      <p className={`text-xs font-medium text-${color}-700`}>{label}</p>
      <p className={`text-xl font-bold text-${color}-900`}>{value ?? 0}</p>
      {subtitle && <p className={`text-xs text-${color}-600 mt-0.5`}>{subtitle}</p>}
    </div>
  )
}

function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-gray-900">{title}</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100"><X size={17} /></button>
        </div>
        {children}
      </div>
    </div>
  )
}

function FormField({ label, value, onChange, placeholder, type = 'text' }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-700 mb-1">{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none" />
    </div>
  )
}
