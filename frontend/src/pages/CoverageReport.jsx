import { useState, useEffect, useMemo } from 'react'
import { AgGridReact } from 'ag-grid-react'
import { AllCommunityModule, ModuleRegistry, themeQuartz } from 'ag-grid-community'
import { Shield, Download, Upload, RefreshCw, AlertTriangle, Share2, Loader2 } from 'lucide-react'
import { generateCoverage, fetchCoverageReport, fetchCoverageExceptions } from '../services/api'

ModuleRegistry.registerModules([AllCommunityModule])

const LEVEL_STYLE = {
  full: 'bg-green-100 text-green-700', partial: 'bg-yellow-100 text-yellow-700',
  low: 'bg-orange-100 text-orange-700', none: 'bg-red-100 text-red-700',
}
const LEVEL_DOT = { full: 'bg-green-500', partial: 'bg-yellow-500', low: 'bg-orange-500', none: 'bg-red-500' }
const LEVEL_LABEL = { full: 'Full', partial: 'Partial', low: 'Low', none: 'None' }
function CovLevelBadge({ value }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${LEVEL_STYLE[value] || 'bg-gray-100 text-gray-600'}`}>
      <span className={`w-2 h-2 rounded-full ${LEVEL_DOT[value] || 'bg-gray-400'}`} />
      {LEVEL_LABEL[value] || value}
    </span>
  )
}
const covGridDefaultColDef = { sortable: true, resizable: true, filter: true, cellStyle: { color: '#374151', fontSize: '13px' } }

const COVERAGE_LEVELS = [
  { key: 'full', label: 'Full Coverage', color: 'bg-green-500', textColor: 'text-green-700', bgColor: 'bg-green-50', borderColor: 'border-green-200', desc: 'FG + WIP + RM covers demand' },
  { key: 'partial', label: 'Partial Coverage', color: 'bg-yellow-500', textColor: 'text-yellow-700', bgColor: 'bg-yellow-50', borderColor: 'border-yellow-200', desc: 'Some allocation gaps exist' },
  { key: 'low', label: 'Low Coverage', color: 'bg-orange-500', textColor: 'text-orange-700', bgColor: 'bg-orange-50', borderColor: 'border-orange-200', desc: 'Significant shortfall' },
  { key: 'none', label: 'No Coverage', color: 'bg-red-500', textColor: 'text-red-700', bgColor: 'bg-red-50', borderColor: 'border-red-200', desc: 'No stock or RM available' },
]

const covNum = (n) => (n == null ? '—' : Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 }))
const covMoney = (n, cur) => (n == null ? '—' : `${cur === 'INR' ? '₹' : (cur || '') + ' '}${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`)

export default function CoverageReport() {
  const [viewMode, setViewMode] = useState('customer')
  const [metric, setMetric] = useState('qty')      // 'qty' | 'value'
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

  const columnDefs = useMemo(() => {
    const money = (p) => (p.value == null ? '—' : covMoney(p.value, p.data?.currency))
    const num = (p) => covNum(p.value)
    const idCols = viewMode === 'customer'
      ? [
          { field: 'customer', headerName: 'Customer', minWidth: 160 },
          { field: 'cust_part_no', headerName: 'Cust Part #', minWidth: 140 },
          { field: 'maini_part_no', headerName: 'Maini Part #', minWidth: 150 },
        ]
      : [
          { field: 'maini_part_no', headerName: 'Maini Part #', minWidth: 150 },
          { field: 'cust_part_no', headerName: 'Cust Part #', minWidth: 140 },
          { field: 'customer', headerName: 'Customer', minWidth: 160 },
        ]
    const numCols = metric === 'qty'
      ? [
          { field: 'demand_qty', headerName: 'Demand Qty', type: 'numericColumn', minWidth: 120, valueFormatter: num },
          { field: 'fg_stock', headerName: 'FG Stock', type: 'numericColumn', minWidth: 110, valueFormatter: num },
          { field: 'wip', headerName: 'WIP', type: 'numericColumn', minWidth: 100, valueFormatter: num },
          { field: 'rm_stock', headerName: 'RM Stock', type: 'numericColumn', minWidth: 110, valueFormatter: num, cellClass: 'text-gray-400', headerTooltip: 'Informational — not counted in coverage until BOM' },
          { field: 'rm_in_transit', headerName: 'In-Transit', type: 'numericColumn', minWidth: 110, valueFormatter: num, cellClass: 'text-gray-400', headerTooltip: 'Informational — not counted in coverage until BOM' },
          { field: 'total_coverage', headerName: 'Total Coverage', type: 'numericColumn', minWidth: 130, valueFormatter: num },
          { field: 'gap', headerName: 'Gap', type: 'numericColumn', minWidth: 100, valueFormatter: (p) => (p.value > 0 ? covNum(p.value) : '—'), cellClass: 'text-red-600' },
          { field: 'coverage_pct', headerName: 'Coverage %', type: 'numericColumn', minWidth: 120, valueFormatter: (p) => `${p.value}%` },
          { field: 'level', headerName: 'Status', minWidth: 120, sortable: true, filter: true, cellRenderer: CovLevelBadge },
        ]
      : [
          { field: 'unit_price', headerName: 'Unit Price', type: 'numericColumn', minWidth: 120, valueFormatter: money, cellClass: 'text-gray-500' },
          { field: 'demand_value', headerName: 'Demand Value', type: 'numericColumn', minWidth: 140, valueFormatter: money },
          { field: 'coverage_value', headerName: 'Coverage Value', type: 'numericColumn', minWidth: 150, valueFormatter: money },
          { field: 'gap_value', headerName: 'Gap Value', type: 'numericColumn', minWidth: 130, valueFormatter: (p) => (p.value > 0 ? covMoney(p.value, p.data?.currency) : '—'), cellClass: 'text-red-600' },
          { field: 'coverage_pct', headerName: 'Coverage %', type: 'numericColumn', minWidth: 120, valueFormatter: (p) => `${p.value}%` },
          { field: 'level', headerName: 'Status', minWidth: 120, sortable: true, filter: true, cellRenderer: CovLevelBadge },
        ]
    return [...idCols, ...numCols]
  }, [viewMode, metric])

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Master Coverage Report</h1>
        <p className="text-sm text-gray-500 mt-1">
          Per-part demand vs stock, color-coded. Coverage counts <b>FG + WIP</b>; RM &amp; in-transit are shown
          for context but not counted until BOM.
          {report?.summary?.zso_report_id ? ` · demand from ZSO #${report.summary.zso_report_id}` : ''}
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
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-700">View by:</span>
            {['customer', 'part'].map((mode) => (
              <button key={mode} onClick={() => setViewMode(mode)}
                className={`px-3 py-1.5 text-sm rounded-lg capitalize ${viewMode === mode ? 'bg-blue-600 text-white' : 'border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                {mode === 'customer' ? 'Customer-wise' : 'Part-wise'}
              </button>
            ))}
          </div>
          <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
            <button onClick={() => setMetric('qty')}
              className={`px-3 py-1.5 ${metric === 'qty' ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}>Quantity</button>
            <button onClick={() => setMetric('value')}
              className={`px-3 py-1.5 ${metric === 'value' ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}>Value</button>
          </div>
          {Object.keys(report?.summary?.value_by_currency || {}).length > 0 && (
            <span className="text-xs text-gray-500">
              {Object.entries(report.summary.value_by_currency).map(([c, v]) =>
                `${c}: demand ${covMoney(v.demand, c)} · gap ${covMoney(v.gap, c)}`).join('   ·   ')}
            </span>
          )}
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

      {/* Coverage Table — AG Grid (client-side, paginated + virtualized) */}
      <div className="bg-white border border-gray-200 rounded-xl" style={{ height: 560 }}>
        <AgGridReact
          theme={themeQuartz}
          rowData={displayRows}
          columnDefs={columnDefs}
          defaultColDef={covGridDefaultColDef}
          rowHeight={40}
          headerHeight={38}
          pagination={true}
          paginationPageSize={50}
          paginationPageSizeSelector={[25, 50, 100, 250]}
          enableCellTextSelection={true}
          suppressRowClickSelection={true}
          animateRows={true}
          overlayNoRowsTemplate='<span style="padding:12px;color:#6b7280;font-size:13px;">No coverage data yet — upload stock, have a ZSO report, then click &quot;Generate Coverage&quot;.</span>'
        />
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
