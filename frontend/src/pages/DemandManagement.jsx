import { useState, useEffect, useRef, useCallback } from 'react'
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
  fetchCorrections, fetchCorrectionStats, createCorrection, reviewCorrection, deleteCorrection
} from '../services/api'

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
    { id: 'email', label: 'Email Attachments', icon: Mail,          color: 'blue',   count: stats?.sources?.email || 0 },
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
            <StatCard label="ZSO Reports"    value={stats.zso_reports}                 color="blue" />
            <StatCard label="Total Line Items" value={stats.total_line_items?.toLocaleString()} color="green" />
            <StatCard label="Demand Uploads" value={Object.values(stats.uploads || {}).reduce((a, b) => a + b, 0)} color="purple" />
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
  const [reports, setReports] = useState([])
  const [currentId, setCurrentId] = useState('')
  const [previousId, setPreviousId] = useState('')
  const [comparison, setComparison] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [activeSection, setActiveSection] = useState('changes')

  useEffect(() => {
    fetchDemandReports().then(r => setReports(r.data)).catch(console.error)
  }, [])

  const runComparison = async () => {
    if (!currentId || !previousId) { setError('Select both reports'); return }
    if (currentId === previousId) { setError('Select two different reports'); return }
    setLoading(true); setError(''); setComparison(null)
    try { const res = await compareDemand(currentId, previousId); setComparison(res.data) }
    catch (err) { setError(err.response?.data?.detail || err.message) }
    finally { setLoading(false) }
  }

  const reportLabel = (r) => {
    // Customer name(s) — most meaningful identifier
    const customers = (r.customers || []).filter(Boolean)
    const customerStr = customers.length > 0
      ? customers.slice(0, 2).join(' · ') + (customers.length > 2 ? ` +${customers.length - 2}` : '')
      : null

    // PO numbers — up to 2, truncated if long
    const pos = (r.po_numbers || []).filter(Boolean)
    const poStr = pos.length > 0
      ? pos.slice(0, 2).map(p => p.length > 14 ? p.slice(0, 14) + '…' : p).join(', ')
      : null

    // Date — short format "Jun 09"
    const date = r.created_at
      ? new Date(r.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
      : ''

    const itemStr = r.total_items ? `${r.total_items} items` : ''

    // Build label: "Safran HAL · 12 items · PO 25PO000950 (Jun 09)"
    const parts = [customerStr, itemStr, poStr ? `PO ${poStr}` : null].filter(Boolean)
    return `#${r.id}  ${parts.length ? '— ' + parts.join('  ·  ') : ''}  (${date})`
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Demand Comparison</h2>
        <p className="text-sm text-gray-500 mb-5">Select two ZSO reports to compare demand changes between cycles.</p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          {[
            ['Current Report (newer)', currentId, setCurrentId],
            ['Previous Report (older)', previousId, setPreviousId],
          ].map(([label, val, setter]) => (
            <div key={label}>
              <label className="block text-xs font-medium text-gray-700 mb-1">{label}</label>
              <select value={val} onChange={e => setter(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none bg-white">
                <option value="">Select report…</option>
                {reports.map(r => (
                  <option key={r.id} value={r.id}>{reportLabel(r)}</option>
                ))}
              </select>
              {/* Show a richer preview card for the selected report */}
              {val && (() => {
                const sel = reports.find(r => String(r.id) === String(val))
                if (!sel) return null
                const customers = (sel.customers || []).filter(Boolean)
                const pos = (sel.po_numbers || []).filter(Boolean)
                return (
                  <div className="mt-2 px-3 py-2 bg-blue-50 border border-blue-100 rounded-lg text-xs text-blue-800 space-y-0.5">
                    {customers.length > 0 && <div><span className="font-medium">Customer:</span> {customers.join(', ')}</div>}
                    {pos.length > 0 && <div><span className="font-medium">PO(s):</span> {pos.join(', ')}</div>}
                    {sel.total_items > 0 && <div><span className="font-medium">Line Items:</span> {sel.total_items}</div>}
                    <div><span className="font-medium">Generated:</span> {sel.created_at ? new Date(sel.created_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}</div>
                    <div><span className="font-medium">Status:</span> <span className="capitalize">{sel.status}</span></div>
                  </div>
                )
              })()}
            </div>
          ))}
        </div>

        <button onClick={runComparison} disabled={loading || !currentId || !previousId}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
          {loading ? <Loader2 size={14} className="animate-spin" /> : <ArrowRightLeft size={14} />}
          Run Comparison
        </button>

        {error && <div className="mt-3 p-3 bg-red-50 text-red-700 text-sm rounded-lg border border-red-200">{error}</div>}
      </div>

      {comparison && (
        <>
          {/* Summary */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: 'Qty Increases', count: comparison.summary.total_increases, color: 'green', icon: TrendingUp, id: 'changes' },
              { label: 'Qty Decreases', count: comparison.summary.total_decreases, color: 'red', icon: TrendingDown, id: 'changes' },
              { label: 'New Items', count: comparison.summary.total_new, color: 'blue', icon: Plus, id: 'new' },
              { label: 'Removed Items', count: comparison.summary.total_removed, color: 'yellow', icon: AlertTriangle, id: 'removed' },
            ].map(s => (
              <button key={s.label} onClick={() => setActiveSection(s.id)}
                className={`border bg-${s.color}-50 border-${s.color}-200 rounded-lg p-4 text-left hover:shadow-sm transition-shadow ${activeSection === s.id ? 'ring-2 ring-' + s.color + '-400' : ''}`}>
                <div className={`flex items-center gap-2 mb-1 text-${s.color}-700`}>
                  <s.icon size={15} /><span className="text-xs font-medium">{s.label}</span>
                </div>
                <p className={`text-2xl font-bold text-${s.color}-800`}>{s.count}</p>
              </button>
            ))}
          </div>

          {/* Changes table */}
          {activeSection === 'changes' && (
            <ComparisonTable
              title="Quantity Changes"
              columns={['Cust Part #', 'Customer', 'Prev Qty', 'Curr Qty', 'Change', 'PO / Forecast', 'Ship Date']}
              rows={[...comparison.increases, ...comparison.decreases]}
              renderRow={(item, i) => (
                <tr key={i} className={`border-b border-gray-50 ${item.change > 0 ? 'bg-green-50/20' : 'bg-red-50/20'}`}>
                  <td className="px-4 py-2 font-mono text-xs text-gray-800">{item.part}</td>
                  <td className="px-4 py-2 text-sm text-gray-600">{item.customer || '—'}</td>
                  <td className="px-4 py-2 text-sm">{item.prev_qty}</td>
                  <td className="px-4 py-2 text-sm font-semibold">{item.curr_qty}</td>
                  <td className="px-4 py-2 text-sm font-bold">
                    <span className={item.change > 0 ? 'text-green-700' : 'text-red-700'}>
                      {item.change > 0 ? '+' : ''}{item.change}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-xs text-gray-500">{item.po || '—'}</td>
                  <td className="px-4 py-2 text-xs text-gray-500">{item.ship_date || '—'}</td>
                </tr>
              )}
              empty="No quantity changes between these two reports."
            />
          )}

          {activeSection === 'new' && (
            <ComparisonTable
              title="New Items (in current, not in previous)"
              columns={['Cust Part #', 'Customer', 'Qty', 'PO / Forecast', 'Ship Date']}
              rows={comparison.new_items}
              renderRow={(item, i) => (
                <tr key={i} className="border-b border-gray-50 bg-blue-50/20">
                  <td className="px-4 py-2 font-mono text-xs text-gray-800">{item.part}</td>
                  <td className="px-4 py-2 text-sm text-gray-600">{item.customer || '—'}</td>
                  <td className="px-4 py-2 text-sm font-semibold text-blue-700">{item.qty}</td>
                  <td className="px-4 py-2 text-xs text-gray-500">{item.po || '—'}</td>
                  <td className="px-4 py-2 text-xs text-gray-500">{item.ship_date || '—'}</td>
                </tr>
              )}
              empty="No new items."
            />
          )}

          {activeSection === 'removed' && (
            <ComparisonTable
              title="Removed Items (in previous, not in current)"
              columns={['Cust Part #', 'Customer', 'Qty', 'PO / Forecast', 'Ship Date']}
              rows={comparison.removed_items}
              renderRow={(item, i) => (
                <tr key={i} className="border-b border-gray-50 bg-yellow-50/20">
                  <td className="px-4 py-2 font-mono text-xs text-gray-800">{item.part}</td>
                  <td className="px-4 py-2 text-sm text-gray-600">{item.customer || '—'}</td>
                  <td className="px-4 py-2 text-sm font-semibold text-yellow-700">{item.qty}</td>
                  <td className="px-4 py-2 text-xs text-gray-500">{item.po || '—'}</td>
                  <td className="px-4 py-2 text-xs text-gray-500">{item.ship_date || '—'}</td>
                </tr>
              )}
              empty="No removed items."
            />
          )}
        </>
      )}

      {!comparison && !loading && (
        <div className="bg-white rounded-xl border border-gray-200 p-10 text-center text-sm text-gray-400">
          <ArrowRightLeft size={32} className="mx-auto mb-3 opacity-30" />
          Select two ZSO reports above and click "Run Comparison" to see what changed.
        </div>
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
      alert('Upload failed: ' + (err.response?.data?.detail || err.message))
    } finally { setUploading(null) }
  }

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this upload?')) return
    try { await deleteDemandUpload(id); load() }
    catch (err) { alert('Delete failed') }
  }

  const handlePreview = async (id) => {
    if (previewData?.id === id) { setPreviewData(null); return }
    try { const res = await previewDemandUpload(id); setPreviewData(res.data) }
    catch (err) { alert('Preview failed') }
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
      alert('Customer Part # and New Value are required.'); return
    }
    setSubmitting(true)
    try {
      await createCorrection(form)
      setForm(emptyForm); setShowForm(false); load()
    } catch (err) {
      alert('Submit failed: ' + (err.response?.data?.detail || err.message))
    } finally { setSubmitting(false) }
  }

  const handleReview = async (id, action) => {
    setSubmitting(true)
    try {
      await reviewCorrection(id, { status: action, review_notes: reviewNotes || null })
      setReviewModal(null); setReviewNotes(''); load()
    } catch (err) {
      alert('Review failed: ' + (err.response?.data?.detail || err.message))
    } finally { setSubmitting(false) }
  }

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this correction request?')) return
    try { await deleteCorrection(id); load() }
    catch (err) { alert('Delete failed') }
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
function StatCard({ label, value, color }) {
  return (
    <div className={`border border-${color}-200 bg-${color}-50 rounded-lg p-3`}>
      <p className={`text-xs font-medium text-${color}-700`}>{label}</p>
      <p className={`text-xl font-bold text-${color}-900`}>{value ?? 0}</p>
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
