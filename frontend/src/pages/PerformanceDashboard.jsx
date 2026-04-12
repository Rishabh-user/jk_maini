import { useState, useEffect, useRef } from 'react'
import { TrendingUp, Target, DollarSign, BarChart3, Upload, Download, Filter, Calendar, Loader2 } from 'lucide-react'
import { fetchDemandVsActual, fetchBudgetVsActual, fetchPerformanceKPIs, uploadSalesData, uploadBudgetData } from '../services/api'

const TABS = [
  { id: 'demand_vs_actual', label: 'Demand vs Actual' },
  { id: 'demand_vs_sales', label: 'Demand vs Sales' },
  { id: 'budget', label: 'Budget vs Actual' },
]

const MONTHS = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar']

export default function PerformanceDashboard() {
  const [activeTab, setActiveTab] = useState('demand_vs_actual')
  const [selectedYear, setSelectedYear] = useState('2025-26')
  const [kpis, setKpis] = useState(null)

  useEffect(() => {
    loadKPIs()
  }, [selectedYear])

  const loadKPIs = async () => {
    try {
      const res = await fetchPerformanceKPIs(selectedYear)
      setKpis(res.data)
    } catch (err) {
      console.error('Failed to load KPIs:', err)
    }
  }

  const fmtValue = (v) => {
    if (!v || v === 0) return '—'
    if (v >= 10000000) return `${(v / 10000000).toFixed(1)} Cr`
    if (v >= 100000) return `${(v / 100000).toFixed(1)} L`
    if (v >= 1000) return `${(v / 1000).toFixed(1)} K`
    return String(Math.round(v))
  }

  return (
    <div>
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Performance Dashboard</h1>
            <p className="text-sm text-gray-500 mt-1">
              Monthly performance tracking — Demand, Sales, and Budget analysis
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Calendar size={16} className="text-gray-400" />
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(e.target.value)}
              className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg bg-white"
            >
              <option value="2025-26">FY 2025-26</option>
              <option value="2024-25">FY 2024-25</option>
              <option value="2026-27">FY 2026-27</option>
            </select>
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <KPICard icon={TrendingUp} label="Total Demand (YTD)" value={fmtValue(kpis?.total_demand)} sub="From ZSO reports" color="blue" />
        <KPICard icon={BarChart3} label="Actual Sales (YTD)" value={fmtValue(kpis?.total_sales)} sub="From Sales reports" color="green" />
        <KPICard icon={Target} label="Budget Target (YTD)" value={fmtValue(kpis?.total_budget)} sub="From Budget sheet" color="purple" />
        <KPICard icon={DollarSign} label="Achievement %" value={kpis?.achievement_pct ? `${kpis.achievement_pct}%` : '—'} sub="Actual vs Budget" color="orange" />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 rounded-lg p-1">
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

      {activeTab === 'demand_vs_actual' && <DemandVsActual fiscalYear={selectedYear} onRefresh={loadKPIs} />}
      {activeTab === 'demand_vs_sales' && <DemandVsSales fiscalYear={selectedYear} />}
      {activeTab === 'budget' && <BudgetVsActual fiscalYear={selectedYear} onRefresh={loadKPIs} />}
    </div>
  )
}

function KPICard({ icon: Icon, label, value, sub, color }) {
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

function DemandVsActual({ fiscalYear, onRefresh }) {
  const [data, setData] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [uploadResult, setUploadResult] = useState(null)
  const fileRef = useRef(null)

  useEffect(() => {
    loadData()
  }, [fiscalYear])

  const loadData = async () => {
    try {
      const res = await fetchDemandVsActual(fiscalYear)
      setData(res.data)
    } catch (err) {
      console.error('Failed to load demand vs actual:', err)
    }
  }

  const handleUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const res = await uploadSalesData(file, fiscalYear)
      setUploadResult({ success: true, data: res.data })
      loadData()
      onRefresh()
    } catch (err) {
      setUploadResult({ success: false, error: err.response?.data?.detail || err.message })
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const monthly = data?.monthly || []
  const totals = data?.totals || {}

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Monthly Demand vs Actual</h2>
            <p className="text-sm text-gray-500">Data from ZSO and Sales reports — FY {fiscalYear}</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => fileRef.current?.click()}
              className="flex items-center gap-2 px-3 py-2 text-xs font-medium border border-gray-200 rounded-lg hover:bg-gray-50"
            >
              {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
              Upload Sales Data
            </button>
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleUpload} className="hidden" />
          </div>
        </div>

        {uploadResult && (
          <div className={`mb-4 p-3 rounded-lg text-sm ${uploadResult.success ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
            {uploadResult.success ? `Sales data uploaded: ${uploadResult.data.filename}` : uploadResult.error}
          </div>
        )}

        {/* Chart placeholder with bars */}
        <div className="border border-gray-200 rounded-lg p-6 mb-6">
          <div className="flex items-end gap-2 h-48 justify-around">
            {monthly.map((m) => {
              const maxVal = Math.max(...monthly.map(x => Math.max(x.demand, x.actual)), 1)
              const dH = (m.demand / maxVal) * 160
              const aH = (m.actual / maxVal) * 160
              return (
                <div key={m.month} className="flex flex-col items-center gap-1 flex-1">
                  <div className="flex items-end gap-0.5 h-40">
                    <div className="w-3 bg-blue-400 rounded-t" style={{ height: `${dH}px` }} title={`Demand: ${m.demand}`} />
                    <div className="w-3 bg-green-400 rounded-t" style={{ height: `${aH}px` }} title={`Actual: ${m.actual}`} />
                  </div>
                  <span className="text-xs text-gray-500">{m.month}</span>
                </div>
              )
            })}
          </div>
          <div className="flex items-center justify-center gap-6 mt-3">
            <div className="flex items-center gap-1"><div className="w-3 h-3 bg-blue-400 rounded" /><span className="text-xs text-gray-600">Demand</span></div>
            <div className="flex items-center gap-1"><div className="w-3 h-3 bg-green-400 rounded" /><span className="text-xs text-gray-600">Actual</span></div>
          </div>
        </div>

        {/* Monthly Table */}
        <div className="border border-gray-200 rounded-lg overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left text-xs font-semibold text-gray-500 uppercase px-4 py-3">Metric</th>
                {MONTHS.map((m) => (
                  <th key={m} className="text-center text-xs font-semibold text-gray-500 uppercase px-3 py-3">{m}</th>
                ))}
                <th className="text-center text-xs font-semibold text-gray-500 uppercase px-4 py-3">Total</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-gray-100">
                <td className="px-4 py-3 text-sm font-medium text-blue-700 bg-blue-50">Demand</td>
                {monthly.map((m) => (
                  <td key={m.month} className="px-3 py-3 text-sm text-center text-gray-700">{m.demand || '—'}</td>
                ))}
                <td className="px-4 py-3 text-sm text-center font-semibold text-gray-900">{totals.demand || '—'}</td>
              </tr>
              <tr className="border-b border-gray-100">
                <td className="px-4 py-3 text-sm font-medium text-green-700 bg-green-50">Actual</td>
                {monthly.map((m) => (
                  <td key={m.month} className="px-3 py-3 text-sm text-center text-gray-700">{m.actual || '—'}</td>
                ))}
                <td className="px-4 py-3 text-sm text-center font-semibold text-gray-900">{totals.actual || '—'}</td>
              </tr>
              <tr>
                <td className="px-4 py-3 text-sm font-medium text-orange-700 bg-orange-50">Variance</td>
                {monthly.map((m) => (
                  <td key={m.month} className={`px-3 py-3 text-sm text-center ${m.variance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {m.variance || '—'}
                  </td>
                ))}
                <td className={`px-4 py-3 text-sm text-center font-semibold ${(totals.variance || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {totals.variance || '—'}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function DemandVsSales({ fiscalYear }) {
  const [data, setData] = useState(null)

  useEffect(() => {
    loadData()
  }, [fiscalYear])

  const loadData = async () => {
    try {
      const res = await fetchDemandVsActual(fiscalYear)
      setData(res.data)
    } catch (err) {
      console.error('Failed to load:', err)
    }
  }

  const monthly = data?.monthly || []
  const totals = data?.totals || {}

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Monthly Demand vs Sales</h2>
            <p className="text-sm text-gray-500">Data from ZSO reports and Sales downloads — FY {fiscalYear}</p>
          </div>
        </div>

        {/* Summary */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="border border-blue-200 bg-blue-50 rounded-lg p-4">
            <p className="text-xs font-medium text-blue-700">Total Demand</p>
            <p className="text-xl font-bold text-blue-900">{totals.demand || '—'}</p>
          </div>
          <div className="border border-green-200 bg-green-50 rounded-lg p-4">
            <p className="text-xs font-medium text-green-700">Total Sales</p>
            <p className="text-xl font-bold text-green-900">{totals.actual || '—'}</p>
          </div>
          <div className={`border rounded-lg p-4 ${(totals.variance || 0) >= 0 ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
            <p className="text-xs font-medium text-gray-700">Variance</p>
            <p className={`text-xl font-bold ${(totals.variance || 0) >= 0 ? 'text-green-900' : 'text-red-900'}`}>{totals.variance || '—'}</p>
          </div>
        </div>

        {/* Monthly breakdown */}
        <div className="border border-gray-200 rounded-lg overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                {['Month', 'Demand Value', 'Sales Value', 'Variance', 'Variance %'].map((h) => (
                  <th key={h} className="text-left text-xs font-semibold text-gray-500 uppercase px-4 py-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {monthly.length > 0 ? monthly.map((m) => (
                <tr key={m.month} className="border-b border-gray-100">
                  <td className="px-4 py-2 text-sm font-medium">{m.month}</td>
                  <td className="px-4 py-2 text-sm">{m.demand || '—'}</td>
                  <td className="px-4 py-2 text-sm">{m.actual || '—'}</td>
                  <td className={`px-4 py-2 text-sm ${m.variance >= 0 ? 'text-green-600' : 'text-red-600'}`}>{m.variance || '—'}</td>
                  <td className={`px-4 py-2 text-sm ${m.variance_pct >= 0 ? 'text-green-600' : 'text-red-600'}`}>{m.variance_pct ? `${m.variance_pct}%` : '—'}</td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-sm text-gray-500">
                    Upload ZSO and Sales data to compare demand vs sales performance.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function BudgetVsActual({ fiscalYear, onRefresh }) {
  const [data, setData] = useState(null)
  const [uploading, setUploading] = useState(null) // 'budget' | 'sales' | null
  const [uploadResult, setUploadResult] = useState(null)
  const budgetRef = useRef(null)
  const salesRef = useRef(null)

  useEffect(() => {
    loadData()
  }, [fiscalYear])

  const loadData = async () => {
    try {
      const res = await fetchBudgetVsActual(fiscalYear)
      setData(res.data)
    } catch (err) {
      console.error('Failed to load budget vs actual:', err)
    }
  }

  const handleBudgetUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading('budget')
    try {
      const res = await uploadBudgetData(file, fiscalYear)
      setUploadResult({ success: true, msg: `Budget data uploaded: ${res.data.filename}` })
      loadData()
      onRefresh()
    } catch (err) {
      setUploadResult({ success: false, msg: err.response?.data?.detail || err.message })
    } finally {
      setUploading(null)
      if (budgetRef.current) budgetRef.current.value = ''
    }
  }

  const handleSalesUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading('sales')
    try {
      const res = await uploadSalesData(file, fiscalYear)
      setUploadResult({ success: true, msg: `Sales data uploaded: ${res.data.filename}` })
      loadData()
      onRefresh()
    } catch (err) {
      setUploadResult({ success: false, msg: err.response?.data?.detail || err.message })
    } finally {
      setUploading(null)
      if (salesRef.current) salesRef.current.value = ''
    }
  }

  const monthly = data?.monthly || []
  const totals = data?.totals || {}
  const achievement = totals.achievement_pct || 0

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Budget vs Actual (YTD)</h2>
            <p className="text-sm text-gray-500">
              Targets from Budget sheet, actuals from Sales downloads — FY {fiscalYear}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => budgetRef.current?.click()}
              className="flex items-center gap-2 px-3 py-2 text-xs font-medium border border-gray-200 rounded-lg hover:bg-gray-50"
            >
              {uploading === 'budget' ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
              Upload Budget Sheet
            </button>
            <input ref={budgetRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleBudgetUpload} className="hidden" />
            <button
              onClick={() => salesRef.current?.click()}
              className="flex items-center gap-2 px-3 py-2 text-xs font-medium border border-gray-200 rounded-lg hover:bg-gray-50"
            >
              {uploading === 'sales' ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
              Upload Sales Data
            </button>
            <input ref={salesRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleSalesUpload} className="hidden" />
          </div>
        </div>

        {uploadResult && (
          <div className={`mb-4 p-3 rounded-lg text-sm ${uploadResult.success ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
            {uploadResult.msg}
          </div>
        )}

        {/* Overall Progress */}
        <div className="border border-gray-200 rounded-lg p-5 mb-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold text-gray-900">Overall Achievement</span>
            <span className="text-sm font-bold text-gray-900">{achievement}%</span>
          </div>
          <div className="w-full h-4 bg-gray-200 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${achievement >= 80 ? 'bg-green-500' : achievement >= 50 ? 'bg-yellow-500' : 'bg-blue-600'}`}
              style={{ width: `${Math.min(achievement, 100)}%` }}
            />
          </div>
          <div className="flex items-center justify-between mt-2 text-xs text-gray-500">
            <span>Budget: {totals.budget || '—'}</span>
            <span>Actual: {totals.actual || '—'}</span>
          </div>
        </div>

        {/* Monthly Table */}
        <div className="border border-gray-200 rounded-lg overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left text-xs font-semibold text-gray-500 uppercase px-4 py-3">Metric</th>
                {MONTHS.map((m) => (
                  <th key={m} className="text-center text-xs font-semibold text-gray-500 uppercase px-3 py-3">{m}</th>
                ))}
                <th className="text-center text-xs font-semibold text-gray-500 uppercase px-4 py-3">Total</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-gray-100">
                <td className="px-4 py-3 text-sm font-medium text-purple-700 bg-purple-50">Budget</td>
                {monthly.map((m) => (
                  <td key={m.month} className="px-3 py-3 text-sm text-center text-gray-700">{m.budget || '—'}</td>
                ))}
                <td className="px-4 py-3 text-sm text-center font-semibold text-gray-900">{totals.budget || '—'}</td>
              </tr>
              <tr className="border-b border-gray-100">
                <td className="px-4 py-3 text-sm font-medium text-green-700 bg-green-50">Actual</td>
                {monthly.map((m) => (
                  <td key={m.month} className="px-3 py-3 text-sm text-center text-gray-700">{m.actual || '—'}</td>
                ))}
                <td className="px-4 py-3 text-sm text-center font-semibold text-gray-900">{totals.actual || '—'}</td>
              </tr>
              <tr className="border-b border-gray-100">
                <td className="px-4 py-3 text-sm font-medium text-orange-700 bg-orange-50">Variance</td>
                {monthly.map((m) => (
                  <td key={m.month} className={`px-3 py-3 text-sm text-center ${m.variance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {m.variance || '—'}
                  </td>
                ))}
                <td className={`px-4 py-3 text-sm text-center font-semibold ${(totals.variance || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {totals.variance || '—'}
                </td>
              </tr>
              <tr>
                <td className="px-4 py-3 text-sm font-medium text-blue-700 bg-blue-50">Achievement %</td>
                {monthly.map((m) => (
                  <td key={m.month} className="px-3 py-3 text-sm text-center font-medium">
                    {m.achievement_pct ? (
                      <span className={m.achievement_pct >= 80 ? 'text-green-600' : m.achievement_pct >= 50 ? 'text-yellow-600' : 'text-red-600'}>
                        {m.achievement_pct}%
                      </span>
                    ) : '—'}
                  </td>
                ))}
                <td className="px-4 py-3 text-sm text-center font-bold">
                  <span className={achievement >= 80 ? 'text-green-600' : achievement >= 50 ? 'text-yellow-600' : 'text-red-600'}>
                    {achievement}%
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Granularity Note */}
        <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
          <p className="text-xs text-blue-700">
            <strong>Granularity:</strong> This report supports drill-down by Customer, Value, Part Number, and Percentage of Achievement.
            Upload Budget and Sales data to populate all monthly columns.
          </p>
        </div>
      </div>
    </div>
  )
}
