import { useState, useEffect } from 'react'
import { Shield, Download, Upload, RefreshCw, AlertTriangle, Share2, Loader2 } from 'lucide-react'
import { generateCoverage, fetchCoverageReport, fetchCoverageExceptions } from '../services/api'

const COVERAGE_LEVELS = [
  { key: 'full', label: 'Full Coverage', color: 'bg-green-500', textColor: 'text-green-700', bgColor: 'bg-green-50', borderColor: 'border-green-200', desc: 'FG + WIP + RM covers demand' },
  { key: 'partial', label: 'Partial Coverage', color: 'bg-yellow-500', textColor: 'text-yellow-700', bgColor: 'bg-yellow-50', borderColor: 'border-yellow-200', desc: 'Some allocation gaps exist' },
  { key: 'low', label: 'Low Coverage', color: 'bg-orange-500', textColor: 'text-orange-700', bgColor: 'bg-orange-50', borderColor: 'border-orange-200', desc: 'Significant shortfall' },
  { key: 'none', label: 'No Coverage', color: 'bg-red-500', textColor: 'text-red-700', bgColor: 'bg-red-50', borderColor: 'border-red-200', desc: 'No stock or RM available' },
]

export default function CoverageReport() {
  const [viewMode, setViewMode] = useState('customer')
  const [report, setReport] = useState(null)
  const [exceptions, setExceptions] = useState(null)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    loadReport()
  }, [])

  const loadReport = async () => {
    try {
      const res = await fetchCoverageReport()
      setReport(res.data)
      const excRes = await fetchCoverageExceptions()
      setExceptions(excRes.data)
    } catch (err) {
      // No report yet — that's OK
    }
  }

  const handleGenerate = async () => {
    setGenerating(true)
    setError('')
    try {
      const res = await generateCoverage()
      setReport({ summary: res.data.summary, rows: res.data.rows })
      // Also load exceptions
      const excRes = await fetchCoverageExceptions()
      setExceptions(excRes.data)
    } catch (err) {
      setError(err.response?.data?.detail || err.message)
    } finally {
      setGenerating(false)
    }
  }

  const summary = report?.summary || {}
  const rows = report?.rows || []

  // Group by customer or part for view modes
  const displayRows = viewMode === 'customer'
    ? [...rows].sort((a, b) => (a.customer || '').localeCompare(b.customer || ''))
    : [...rows].sort((a, b) => (a.maini_part_no || '').localeCompare(b.maini_part_no || ''))

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Master Coverage Report</h1>
        <p className="text-sm text-gray-500 mt-1">
          Color-coded coverage analysis — FG stock, WIP, RM stock allocation, and allocated RM in orders
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        {COVERAGE_LEVELS.map((level) => (
          <div key={level.key} className={`${level.bgColor} border ${level.borderColor} rounded-xl p-5`}>
            <div className="flex items-center gap-2 mb-2">
              <div className={`w-3 h-3 rounded-full ${level.color}`} />
              <span className={`text-sm font-semibold ${level.textColor}`}>{level.label}</span>
            </div>
            <p className={`text-2xl font-bold ${level.textColor}`}>{summary[level.key] ?? '—'}</p>
            <p className="text-xs text-gray-500 mt-1">{level.desc}</p>
          </div>
        ))}
      </div>

      {/* Actions Bar */}
      <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-700">View by:</span>
          {['customer', 'part'].map((mode) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              className={`px-3 py-1.5 text-sm rounded-lg capitalize ${
                viewMode === mode
                  ? 'bg-blue-600 text-white'
                  : 'border border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              {mode === 'customer' ? 'Customer-wise' : 'Part-wise'}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="flex items-center gap-2 px-3 py-2 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {generating ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Generate Coverage
          </button>
        </div>
      </div>

      {error && <div className="mb-4 p-3 bg-red-50 text-red-700 text-sm rounded-lg border border-red-200">{error}</div>}

      {/* Coverage Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              {viewMode === 'customer' ? (
                <>
                  {['Customer', 'Part #', 'Maini Part #', 'Demand Qty', 'FG Stock', 'WIP', 'RM Stock', 'RM in Orders', 'Total Coverage', 'Gap', 'Coverage %', 'Status'].map((h) => (
                    <th key={h} className="text-left text-xs font-semibold text-gray-500 uppercase px-4 py-3 whitespace-nowrap">{h}</th>
                  ))}
                </>
              ) : (
                <>
                  {['Maini Part #', 'Cust Part #', 'Customer', 'Demand Qty', 'FG Stock', 'WIP', 'RM Stock', 'RM in Orders', 'Total Coverage', 'Gap', 'Coverage %', 'Status'].map((h) => (
                    <th key={h} className="text-left text-xs font-semibold text-gray-500 uppercase px-4 py-3 whitespace-nowrap">{h}</th>
                  ))}
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {displayRows.length > 0 ? (
              displayRows.map((row, i) => {
                const levelColor =
                  row.level === 'full' ? 'bg-green-100 text-green-700' :
                  row.level === 'partial' ? 'bg-yellow-100 text-yellow-700' :
                  row.level === 'low' ? 'bg-orange-100 text-orange-700' :
                  'bg-red-100 text-red-700'
                const dotColor =
                  row.level === 'full' ? 'bg-green-500' :
                  row.level === 'partial' ? 'bg-yellow-500' :
                  row.level === 'low' ? 'bg-orange-500' : 'bg-red-500'

                return (
                  <tr key={i} className="border-b border-gray-100">
                    {viewMode === 'customer' ? (
                      <>
                        <td className="px-4 py-2 text-sm">{row.customer}</td>
                        <td className="px-4 py-2 text-sm">{row.cust_part_no}</td>
                        <td className="px-4 py-2 text-sm">{row.maini_part_no}</td>
                      </>
                    ) : (
                      <>
                        <td className="px-4 py-2 text-sm">{row.maini_part_no}</td>
                        <td className="px-4 py-2 text-sm">{row.cust_part_no}</td>
                        <td className="px-4 py-2 text-sm">{row.customer}</td>
                      </>
                    )}
                    <td className="px-4 py-2 text-sm">{row.demand_qty}</td>
                    <td className="px-4 py-2 text-sm">{row.fg_stock}</td>
                    <td className="px-4 py-2 text-sm">{row.wip}</td>
                    <td className="px-4 py-2 text-sm">{row.rm_stock}</td>
                    <td className="px-4 py-2 text-sm">{row.rm_in_orders}</td>
                    <td className="px-4 py-2 text-sm font-medium">{row.total_coverage}</td>
                    <td className="px-4 py-2 text-sm text-red-600">{row.gap > 0 ? row.gap : '—'}</td>
                    <td className="px-4 py-2 text-sm font-medium">{row.coverage_pct}%</td>
                    <td className="px-4 py-2">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${levelColor}`}>
                        <div className={`w-2 h-2 rounded-full ${dotColor}`} />
                        {row.level === 'full' ? 'Full' : row.level === 'partial' ? 'Partial' : row.level === 'low' ? 'Low' : 'None'}
                      </span>
                    </td>
                  </tr>
                )
              })
            ) : (
              <tr>
                <td colSpan={12} className="px-6 py-12 text-center">
                  <Shield size={40} className="mx-auto text-gray-300 mb-3" />
                  <p className="text-sm font-medium text-gray-500">No coverage data generated yet</p>
                  <p className="text-xs text-gray-400 mt-1">
                    Run inventory allocation first, then click "Generate Coverage" to create the report.
                  </p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Exception Report Section */}
      <div className="mt-6 bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-orange-50 flex items-center justify-center">
              <AlertTriangle size={20} className="text-orange-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Exception Report</h2>
              <p className="text-sm text-gray-500">Coverage gaps and issues for internal review</p>
            </div>
          </div>
          {exceptions && (
            <div className="flex gap-3 text-sm">
              <span className="text-red-600 font-medium">Critical: {exceptions.critical || 0}</span>
              <span className="text-orange-600 font-medium">Warning: {exceptions.warning || 0}</span>
            </div>
          )}
        </div>

        <div className="border border-gray-200 rounded-lg overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-orange-50 border-b border-orange-200">
                {['#', 'Part #', 'Customer', 'Issue Type', 'Demand Qty', 'Available', 'Shortfall', 'Severity', 'Action Required'].map((h) => (
                  <th key={h} className="text-left text-xs font-semibold text-orange-700 uppercase px-4 py-3 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {exceptions?.exceptions?.length > 0 ? (
                exceptions.exceptions.map((exc, i) => (
                  <tr key={i} className="border-b border-gray-100">
                    <td className="px-4 py-2 text-sm text-gray-500">{i + 1}</td>
                    <td className="px-4 py-2 text-sm">{exc.cust_part_no || exc.maini_part_no}</td>
                    <td className="px-4 py-2 text-sm">{exc.customer}</td>
                    <td className="px-4 py-2 text-sm">{exc.issue_type}</td>
                    <td className="px-4 py-2 text-sm">{exc.demand_qty}</td>
                    <td className="px-4 py-2 text-sm">{exc.available}</td>
                    <td className="px-4 py-2 text-sm text-red-600 font-medium">{exc.shortfall}</td>
                    <td className="px-4 py-2">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        exc.severity === 'critical' ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'
                      }`}>
                        {exc.severity}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-xs text-gray-600">{exc.action_required}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={9} className="px-6 py-6 text-center text-sm text-gray-500">
                    Generate coverage report first to identify exceptions.
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
