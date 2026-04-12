import { useState, useEffect, useRef } from 'react'
import {
  Upload, FileSpreadsheet, TrendingUp, TrendingDown, AlertTriangle,
  RefreshCw, ArrowRightLeft, Database, Filter, Download, ChevronDown, ChevronUp,
  Mail, Globe, FileText, File, Loader2
} from 'lucide-react'
import { fetchDemandStats, compareDemand, uploadDemandFile, fetchDemandReports } from '../services/api'

const TABS = [
  { id: 'aggregation', label: 'Data Aggregation' },
  { id: 'comparison', label: 'Demand Comparison' },
  { id: 'vmi', label: 'VMI & Safety Stock' },
  { id: 'sap', label: 'SAP Integration' },
  { id: 'master_correction', label: 'Master Data Correction' },
]

export default function DemandManagement() {
  const [activeTab, setActiveTab] = useState('aggregation')
  const [expandedSection, setExpandedSection] = useState(null)
  const [stats, setStats] = useState(null)

  useEffect(() => {
    loadStats()
  }, [])

  const loadStats = async () => {
    try {
      const res = await fetchDemandStats()
      setStats(res.data)
    } catch (err) {
      console.error('Failed to load demand stats:', err)
    }
  }

  const toggleSection = (id) => setExpandedSection(expandedSection === id ? null : id)

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Demand Management</h1>
        <p className="text-sm text-gray-500 mt-1">
          ZSO Creation — Aggregate, compile, enrich, and analyze demand data
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 rounded-lg p-1 overflow-x-auto">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 text-sm font-medium rounded-md whitespace-nowrap transition-colors ${
              activeTab === tab.id
                ? 'bg-white text-blue-600 shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'aggregation' && <AggregationTab toggleSection={toggleSection} expandedSection={expandedSection} stats={stats} onRefresh={loadStats} />}
      {activeTab === 'comparison' && <ComparisonTab />}
      {activeTab === 'vmi' && <VMITab />}
      {activeTab === 'sap' && <SAPTab />}
      {activeTab === 'master_correction' && <MasterCorrectionTab />}
    </div>
  )
}

function AggregationTab({ toggleSection, expandedSection, stats, onRefresh }) {
  const [uploading, setUploading] = useState(false)
  const [uploadResult, setUploadResult] = useState(null)
  const fileRef = useRef(null)

  const DATA_SOURCES = [
    { id: 'email', label: 'Email Attachments', icon: Mail, color: 'blue', count: stats?.sources?.email || 0 },
    { id: 'portal', label: 'Customer Portals', icon: Globe, color: 'purple', count: 0, comingSoon: true },
    { id: 'pdf', label: 'PDF Documents', icon: FileText, color: 'red', count: stats?.sources?.pdf || 0 },
    { id: 'excel', label: 'Excel / CSV Files', icon: File, color: 'green', count: (stats?.sources?.excel || 0) + (stats?.sources?.csv || 0) },
    { id: 'lta', label: 'Long Term Agreements', icon: FileSpreadsheet, color: 'orange', count: 0, comingSoon: true },
  ]

  const handleUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setUploadResult(null)
    try {
      const res = await uploadDemandFile(file, 'manual')
      setUploadResult({ success: true, data: res.data })
      onRefresh()
    } catch (err) {
      setUploadResult({ success: false, error: err.response?.data?.detail || err.message })
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <div className="space-y-6">
      {/* Data Sources */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Data Sources</h2>
          <button onClick={onRefresh} className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">
            <RefreshCw size={12} /> Refresh
          </button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
          {DATA_SOURCES.map((src) => (
            <div
              key={src.id}
              className={`border rounded-lg p-4 ${
                src.comingSoon ? 'border-dashed border-gray-300 opacity-60' : 'border-gray-200'
              }`}
            >
              <div className="flex items-center gap-2 mb-2">
                <src.icon size={18} className={`text-${src.color}-600`} />
                <span className="text-sm font-medium text-gray-900">{src.label}</span>
              </div>
              {src.comingSoon ? (
                <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full">Coming Soon</span>
              ) : (
                <p className="text-2xl font-bold text-gray-900">{src.count}</p>
              )}
            </div>
          ))}
        </div>

        {/* Additional Stats */}
        {stats && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4 pt-4 border-t border-gray-100">
            <div className="border border-blue-200 bg-blue-50 rounded-lg p-3">
              <p className="text-xs font-medium text-blue-700">ZSO Reports</p>
              <p className="text-xl font-bold text-blue-900">{stats.zso_reports || 0}</p>
            </div>
            <div className="border border-green-200 bg-green-50 rounded-lg p-3">
              <p className="text-xs font-medium text-green-700">Total Line Items</p>
              <p className="text-xl font-bold text-green-900">{stats.total_line_items || 0}</p>
            </div>
            <div className="border border-purple-200 bg-purple-50 rounded-lg p-3">
              <p className="text-xs font-medium text-purple-700">Demand Uploads</p>
              <p className="text-xl font-bold text-purple-900">
                {(stats.uploads?.vmi || 0) + (stats.uploads?.safety_stock || 0) + (stats.uploads?.sap || 0) + (stats.uploads?.manual || 0)}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Aggregation Actions */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Aggregation Pipeline</h2>
        <div className="space-y-3">
          {[
            { id: 'fetch', icon: RefreshCw, title: 'Fetch Demand Data', desc: 'Pull latest demand from all connected sources (Emails, Portals, PDFs, Excel, LTAs)', action: 'Fetch Now' },
            { id: 'compile', icon: FileSpreadsheet, title: 'Compile into ZSO Format', desc: 'Aggregate and compile all fetched data into the standardized ZSO format', action: 'Compile' },
            { id: 'enrich', icon: Database, title: 'Enrich with Master Data', desc: 'Add JKMGAL part number, Unit prices, Incoterms, Production category, Sales category, KAM Name, Location', action: 'Enrich' },
          ].map((step) => (
            <div key={step.id} className="border border-gray-200 rounded-lg">
              <button
                onClick={() => toggleSection(step.id)}
                className="w-full flex items-center justify-between p-4 hover:bg-gray-50"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center">
                    <step.icon size={20} className="text-blue-600" />
                  </div>
                  <div className="text-left">
                    <p className="text-sm font-semibold text-gray-900">{step.title}</p>
                    <p className="text-xs text-gray-500">{step.desc}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={(e) => { e.stopPropagation(); alert('This feature will be connected to the backend pipeline.') }}
                    className="px-4 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                  >
                    {step.action}
                  </button>
                  {expandedSection === step.id ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
                </div>
              </button>
              {expandedSection === step.id && (
                <div className="border-t border-gray-100 p-4 bg-gray-50">
                  <p className="text-sm text-gray-500">
                    {step.id === 'fetch' && 'Connects to Email inbox, Customer Portals, and file uploads to pull the latest demand data. Supports PDF, Excel, CSV, and image attachments with AI-powered extraction.'}
                    {step.id === 'compile' && 'Maps all extracted columns to the ZSO schema (S No, KAS Name, Customer Name, Site Location, Country, Incoterm, Direct Sales/WH Movement, PO#/Forecast, Category, Sub Category, Cust Part#, Maini Part#, Open Qty, Unit Price, Currency, Unit Price in INR, Total in INR, Doc Date, Ship Date, Sales Month).'}
                    {step.id === 'enrich' && 'Looks up each Cust Part# in Master Data to fill in JKMGAL Part Number, Unit Prices, Incoterms, Production Category (FAIR, FAIR Bulk, First Bulk, Production), Sales Category, KAM Name, and Location.'}
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Upload Section */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Manual Upload</h2>
        <div
          className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-blue-400 transition-colors cursor-pointer"
          onClick={() => fileRef.current?.click()}
        >
          {uploading ? (
            <Loader2 size={32} className="mx-auto text-blue-500 mb-3 animate-spin" />
          ) : (
            <Upload size={32} className="mx-auto text-gray-400 mb-3" />
          )}
          <p className="text-sm font-medium text-gray-700">
            {uploading ? 'Uploading...' : 'Drop demand files here or click to upload'}
          </p>
          <p className="text-xs text-gray-500 mt-1">Supports Excel (.xlsx, .xls) and CSV files</p>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleUpload} className="hidden" />
        </div>
        {uploadResult && (
          <div className={`mt-4 p-3 rounded-lg text-sm ${uploadResult.success ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
            {uploadResult.success
              ? `Uploaded "${uploadResult.data.filename}" — ${uploadResult.data.row_count} rows parsed`
              : `Upload failed: ${uploadResult.error}`}
          </div>
        )}
      </div>
    </div>
  )
}

function ComparisonTab() {
  const [reports, setReports] = useState([])
  const [currentId, setCurrentId] = useState('')
  const [previousId, setPreviousId] = useState('')
  const [comparison, setComparison] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    loadReports()
  }, [])

  const loadReports = async () => {
    try {
      const res = await fetchDemandReports()
      setReports(res.data)
    } catch (err) {
      console.error('Failed to load reports:', err)
    }
  }

  const runComparison = async () => {
    if (!currentId || !previousId) {
      setError('Please select both current and previous reports')
      return
    }
    setLoading(true)
    setError('')
    try {
      const res = await compareDemand(currentId, previousId)
      setComparison(res.data)
    } catch (err) {
      setError(err.response?.data?.detail || err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Demand Comparison</h2>
            <p className="text-sm text-gray-500">Compare current demand with previous demand files</p>
          </div>
        </div>

        {/* Report Selectors */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Current Report</label>
            <select
              value={currentId}
              onChange={(e) => setCurrentId(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
            >
              <option value="">Select current report...</option>
              {reports.map((r) => (
                <option key={r.id} value={r.id}>
                  #{r.id} — {r.kas_name || 'Unknown'} ({r.created_at?.split('T')[0]})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Previous Report</label>
            <select
              value={previousId}
              onChange={(e) => setPreviousId(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
            >
              <option value="">Select previous report...</option>
              {reports.map((r) => (
                <option key={r.id} value={r.id}>
                  #{r.id} — {r.kas_name || 'Unknown'} ({r.created_at?.split('T')[0]})
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex gap-2 mb-6">
          <button
            onClick={runComparison}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <ArrowRightLeft size={14} />}
            Run Comparison
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 text-red-700 text-sm rounded-lg border border-red-200">{error}</div>
        )}

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="border border-green-200 bg-green-50 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp size={16} className="text-green-600" />
              <span className="text-sm font-medium text-green-800">Increases</span>
            </div>
            <p className="text-2xl font-bold text-green-700">{comparison?.summary?.total_increases ?? '—'}</p>
          </div>
          <div className="border border-red-200 bg-red-50 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-1">
              <TrendingDown size={16} className="text-red-600" />
              <span className="text-sm font-medium text-red-800">Decreases</span>
            </div>
            <p className="text-2xl font-bold text-red-700">{comparison?.summary?.total_decreases ?? '—'}</p>
          </div>
          <div className="border border-blue-200 bg-blue-50 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp size={16} className="text-blue-600" />
              <span className="text-sm font-medium text-blue-800">New Items</span>
            </div>
            <p className="text-2xl font-bold text-blue-700">{comparison?.summary?.total_new ?? '—'}</p>
          </div>
          <div className="border border-yellow-200 bg-yellow-50 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-1">
              <AlertTriangle size={16} className="text-yellow-600" />
              <span className="text-sm font-medium text-yellow-800">Removed</span>
            </div>
            <p className="text-2xl font-bold text-yellow-700">{comparison?.summary?.total_removed ?? '—'}</p>
          </div>
        </div>

        {/* Comparison Table */}
        {comparison && (comparison.increases.length > 0 || comparison.decreases.length > 0) && (
          <div className="border border-gray-200 rounded-lg overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  {['Cust Part #', 'Customer', 'Prev Qty', 'Curr Qty', 'Change', 'Direction'].map((h) => (
                    <th key={h} className="text-left text-xs font-semibold text-gray-500 uppercase px-4 py-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {comparison.increases.map((item, i) => (
                  <tr key={`inc-${i}`} className="border-b border-gray-100 bg-green-50/30">
                    <td className="px-4 py-2 text-sm">{item.part}</td>
                    <td className="px-4 py-2 text-sm">{item.customer}</td>
                    <td className="px-4 py-2 text-sm">{item.prev_qty}</td>
                    <td className="px-4 py-2 text-sm">{item.curr_qty}</td>
                    <td className="px-4 py-2 text-sm font-medium text-green-700">+{item.change}</td>
                    <td className="px-4 py-2"><TrendingUp size={14} className="text-green-600" /></td>
                  </tr>
                ))}
                {comparison.decreases.map((item, i) => (
                  <tr key={`dec-${i}`} className="border-b border-gray-100 bg-red-50/30">
                    <td className="px-4 py-2 text-sm">{item.part}</td>
                    <td className="px-4 py-2 text-sm">{item.customer}</td>
                    <td className="px-4 py-2 text-sm">{item.prev_qty}</td>
                    <td className="px-4 py-2 text-sm">{item.curr_qty}</td>
                    <td className="px-4 py-2 text-sm font-medium text-red-700">{item.change}</td>
                    <td className="px-4 py-2"><TrendingDown size={14} className="text-red-600" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {comparison && comparison.increases.length === 0 && comparison.decreases.length === 0 && (
          <div className="border border-gray-200 rounded-lg p-8 text-center text-sm text-gray-500">
            No quantity changes detected between the selected reports.
          </div>
        )}

        {!comparison && (
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  {['Cust Part #', 'Customer', 'Prev Qty', 'Curr Qty', 'Change', 'Direction'].map((h) => (
                    <th key={h} className="text-left text-xs font-semibold text-gray-500 uppercase px-4 py-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-sm text-gray-500">
                    Select two ZSO reports and click "Run Comparison" to see changes.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function VMITab() {
  const [uploading, setUploading] = useState(null) // 'vmi' | 'safety_stock' | null
  const [results, setResults] = useState({})
  const vmiRef = useRef(null)
  const ssRef = useRef(null)

  const handleUpload = async (file, type) => {
    if (!file) return
    setUploading(type)
    try {
      const res = await uploadDemandFile(file, type)
      setResults((prev) => ({ ...prev, [type]: { success: true, data: res.data } }))
    } catch (err) {
      setResults((prev) => ({ ...prev, [type]: { success: false, error: err.response?.data?.detail || err.message } }))
    } finally {
      setUploading(null)
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* VMI Demand */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-2">VMI Demand</h2>
          <p className="text-sm text-gray-500 mb-4">
            Fetch VMI demand from portal data dumps — VMI stock-to-green and consumption data
          </p>
          <div
            className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center mb-4 cursor-pointer hover:border-blue-400"
            onClick={() => vmiRef.current?.click()}
          >
            {uploading === 'vmi' ? (
              <Loader2 size={24} className="mx-auto text-blue-500 mb-2 animate-spin" />
            ) : (
              <Upload size={24} className="mx-auto text-gray-400 mb-2" />
            )}
            <p className="text-sm text-gray-600">Upload VMI Portal Data Dump</p>
            <p className="text-xs text-gray-400 mt-1">.xlsx, .csv</p>
            <input ref={vmiRef} type="file" accept=".xlsx,.xls,.csv" onChange={(e) => handleUpload(e.target.files?.[0], 'vmi')} className="hidden" />
          </div>
          {results.vmi && (
            <div className={`p-3 rounded-lg text-sm ${results.vmi.success ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
              {results.vmi.success ? `Uploaded ${results.vmi.data.row_count} rows` : results.vmi.error}
            </div>
          )}
        </div>

        {/* Safety Stock */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-2">Safety Stock Demand</h2>
          <p className="text-sm text-gray-500 mb-4">
            Retrieve safety stock demand from contractual clauses
          </p>
          <div
            className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center mb-4 cursor-pointer hover:border-blue-400"
            onClick={() => ssRef.current?.click()}
          >
            {uploading === 'safety_stock' ? (
              <Loader2 size={24} className="mx-auto text-blue-500 mb-2 animate-spin" />
            ) : (
              <Upload size={24} className="mx-auto text-gray-400 mb-2" />
            )}
            <p className="text-sm text-gray-600">Upload Contract / Safety Stock File</p>
            <p className="text-xs text-gray-400 mt-1">.xlsx, .csv</p>
            <input ref={ssRef} type="file" accept=".xlsx,.xls,.csv" onChange={(e) => handleUpload(e.target.files?.[0], 'safety_stock')} className="hidden" />
          </div>
          {results.safety_stock && (
            <div className={`p-3 rounded-lg text-sm ${results.safety_stock.success ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
              {results.safety_stock.success ? `Uploaded ${results.safety_stock.data.row_count} rows` : results.safety_stock.error}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function SAPTab() {
  const [uploading, setUploading] = useState(false)
  const [result, setResult] = useState(null)
  const fileRef = useRef(null)

  const handleUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const res = await uploadDemandFile(file, 'sap')
      setResult({ success: true, data: res.data })
    } catch (err) {
      setResult({ success: false, error: err.response?.data?.detail || err.message })
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">SAP Integration</h2>
            <p className="text-sm text-gray-500">Format and upload demand data into SAP</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => fileRef.current?.click()}
              className="flex items-center gap-2 px-3 py-2 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
              Upload SAP Data
            </button>
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleUpload} className="hidden" />
          </div>
        </div>

        {result && (
          <div className={`mb-4 p-3 rounded-lg text-sm ${result.success ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
            {result.success ? `Uploaded "${result.data.filename}" — ${result.data.row_count} rows parsed` : result.error}
          </div>
        )}

        <div className="border border-gray-200 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-gray-900 mb-3">SAP vs ZSO Exception Report</h3>
          <p className="text-sm text-gray-500 mb-3">
            Compare SAP Demand Data against ZSO data and highlight discrepancies.
          </p>
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  {['Part #', 'Customer', 'ZSO Qty', 'SAP Qty', 'ZSO Value', 'SAP Value', 'Exception Type'].map((h) => (
                    <th key={h} className="text-left text-xs font-semibold text-gray-500 uppercase px-4 py-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td colSpan={7} className="px-6 py-6 text-center text-sm text-gray-500">
                    Upload SAP data and generate an exception report to view discrepancies.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}

function MasterCorrectionTab() {
  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Master Data Correction Workflow</h2>
            <p className="text-sm text-gray-500">
              Submit and approve master data corrections based on demand analysis
            </p>
          </div>
          <button className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700">
            + New Correction Request
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          {[
            { label: 'Pending Review', count: '—', color: 'yellow' },
            { label: 'Approved', count: '—', color: 'green' },
            { label: 'Rejected', count: '—', color: 'red' },
            { label: 'Applied', count: '—', color: 'blue' },
          ].map((s) => (
            <div key={s.label} className={`border border-${s.color}-200 bg-${s.color}-50 rounded-lg p-4`}>
              <p className={`text-sm font-medium text-${s.color}-800`}>{s.label}</p>
              <p className={`text-2xl font-bold text-${s.color}-700 mt-1`}>{s.count}</p>
            </div>
          ))}
        </div>

        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                {['Request ID', 'Part #', 'Field', 'Old Value', 'New Value', 'Requested By', 'Status', 'Actions'].map((h) => (
                  <th key={h} className="text-left text-xs font-semibold text-gray-500 uppercase px-4 py-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td colSpan={8} className="px-6 py-8 text-center text-sm text-gray-500">
                  No correction requests yet. Click "New Correction Request" to submit one.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
