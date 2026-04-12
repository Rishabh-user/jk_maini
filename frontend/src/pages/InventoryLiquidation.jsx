import { useState, useEffect, useRef } from 'react'
import { Package, Layers, Upload, Download, Filter, RefreshCw, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react'
import { fetchInventorySummary, uploadStockFile, runAllocation, fetchAllocations, fetchAllocationDetail } from '../services/api'

const TABS = [
  { id: 'fg', label: 'FG Allocation' },
  { id: 'wip', label: 'WIP Allocation' },
  { id: 'reports', label: 'Liquidation Reports' },
]

export default function InventoryLiquidation() {
  const [activeTab, setActiveTab] = useState('fg')
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

  const latestSummary = summary?.latest_summary || {}

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Inventory Liquidation</h1>
        <p className="text-sm text-gray-500 mt-1">
          FG & WIP allocation against demand — stock status and liquidation reporting
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <SummaryCard
          icon={Package} label="Total FG Stock"
          value={`${summary?.stocks?.fg_inhouse?.rows || 0} + ${summary?.stocks?.fg_warehouse?.rows || 0}`}
          sub="In-house + Warehouse rows" color="blue"
        />
        <SummaryCard
          icon={Layers} label="Total WIP"
          value={String(summary?.stocks?.wip?.rows || 0)}
          sub="Work in Progress rows" color="purple"
        />
        <SummaryCard
          icon={CheckCircle2} label="Fully Allocated"
          value={String(latestSummary.fully_allocated ?? '—')}
          sub="Full stock parts" color="green"
        />
        <SummaryCard
          icon={AlertCircle} label="Partial / No Stock"
          value={String((latestSummary.partial ?? 0) + (latestSummary.no_stock ?? 0) || '—')}
          sub="Coverage gaps" color="orange"
        />
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

function FGAllocation({ onRefresh }) {
  const [uploading, setUploading] = useState(null)
  const [uploadResults, setUploadResults] = useState({})
  const [allocating, setAllocating] = useState(false)
  const [allocResult, setAllocResult] = useState(null)
  const [error, setError] = useState('')
  const inhouseRef = useRef(null)
  const warehouseRef = useRef(null)

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
      const res = await runAllocation('fg')
      setAllocResult(res.data)
      onRefresh()
    } catch (err) {
      setError(err.response?.data?.detail || err.message)
    } finally {
      setAllocating(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Finished Goods Allocation</h2>
            <p className="text-sm text-gray-500">
              Fetch SAP reports for in-house FG stock and allocate against demand
            </p>
          </div>
          <button
            onClick={handleAllocate}
            disabled={allocating}
            className="flex items-center gap-2 px-3 py-2 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {allocating ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Run Allocation
          </button>
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
        {allocResult && (
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

        {/* Allocation Table */}
        <div className="border border-gray-200 rounded-lg overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                {['Cust Part #', 'Maini Part #', 'Customer', 'Demand Qty', 'In-House FG', 'Warehouse FG', 'Total FG', 'Allocated', 'Stock Status'].map((h) => (
                  <th key={h} className="text-left text-xs font-semibold text-gray-500 uppercase px-4 py-3 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {allocResult?.allocations?.length > 0 ? (
                allocResult.allocations.map((row, i) => (
                  <tr key={i} className="border-b border-gray-100">
                    <td className="px-4 py-2 text-sm">{row.cust_part_no}</td>
                    <td className="px-4 py-2 text-sm">{row.maini_part_no}</td>
                    <td className="px-4 py-2 text-sm">{row.customer}</td>
                    <td className="px-4 py-2 text-sm">{row.demand_qty}</td>
                    <td className="px-4 py-2 text-sm">{row.fg_inhouse}</td>
                    <td className="px-4 py-2 text-sm">{row.fg_warehouse}</td>
                    <td className="px-4 py-2 text-sm">{row.total_fg}</td>
                    <td className="px-4 py-2 text-sm font-medium">{row.allocated}</td>
                    <td className="px-4 py-2">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                        row.status === 'full' ? 'bg-green-100 text-green-700' :
                        row.status === 'partial' ? 'bg-yellow-100 text-yellow-700' :
                        'bg-red-100 text-red-700'
                      }`}>
                        <div className={`w-2 h-2 rounded-full ${
                          row.status === 'full' ? 'bg-green-500' :
                          row.status === 'partial' ? 'bg-yellow-500' : 'bg-red-500'
                        }`} />
                        {row.status === 'full' ? 'Full' : row.status === 'partial' ? 'Partial' : 'No Stock'}
                      </span>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={9} className="px-6 py-8 text-center text-sm text-gray-500">
                    Upload SAP FG reports and run allocation to see results.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

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
  const [uploading, setUploading] = useState(false)
  const [uploadResult, setUploadResult] = useState(null)
  const [allocating, setAllocating] = useState(false)
  const [allocResult, setAllocResult] = useState(null)
  const [error, setError] = useState('')
  const fileRef = useRef(null)

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
      const res = await runAllocation('wip')
      setAllocResult(res.data)
      onRefresh()
    } catch (err) {
      setError(err.response?.data?.detail || err.message)
    } finally {
      setAllocating(false)
    }
  }

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

        {allocResult && (
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

        <div className="border border-gray-200 rounded-lg overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                {['Cust Part #', 'Maini Part #', 'Customer', 'Demand Qty', 'WIP Qty', 'Allocated', 'Gap', 'Status'].map((h) => (
                  <th key={h} className="text-left text-xs font-semibold text-gray-500 uppercase px-4 py-3 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {allocResult?.allocations?.length > 0 ? (
                allocResult.allocations.map((row, i) => (
                  <tr key={i} className="border-b border-gray-100">
                    <td className="px-4 py-2 text-sm">{row.cust_part_no}</td>
                    <td className="px-4 py-2 text-sm">{row.maini_part_no}</td>
                    <td className="px-4 py-2 text-sm">{row.customer}</td>
                    <td className="px-4 py-2 text-sm">{row.demand_qty}</td>
                    <td className="px-4 py-2 text-sm">{row.wip_qty}</td>
                    <td className="px-4 py-2 text-sm font-medium">{row.allocated}</td>
                    <td className="px-4 py-2 text-sm text-red-600">{row.gap > 0 ? row.gap : '—'}</td>
                    <td className="px-4 py-2">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                        row.status === 'full' ? 'bg-green-100 text-green-700' :
                        row.status === 'partial' ? 'bg-yellow-100 text-yellow-700' :
                        'bg-red-100 text-red-700'
                      }`}>
                        {row.status === 'full' ? 'Full' : row.status === 'partial' ? 'Partial' : 'No Stock'}
                      </span>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={8} className="px-6 py-8 text-center text-sm text-gray-500">
                    Upload WIP reports and run allocation to see results.
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

function LiquidationReports() {
  const [allocations, setAllocations] = useState([])
  const [selectedAlloc, setSelectedAlloc] = useState(null)
  const [detail, setDetail] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    loadAllocations()
  }, [])

  const loadAllocations = async () => {
    try {
      const res = await fetchAllocations()
      setAllocations(res.data)
    } catch (err) {
      console.error('Failed to load allocations:', err)
    }
  }

  const viewDetail = async (id) => {
    setLoading(true)
    try {
      const res = await fetchAllocationDetail(id)
      setDetail(res.data)
      setSelectedAlloc(id)
    } catch (err) {
      console.error('Failed to load allocation detail:', err)
    } finally {
      setLoading(false)
    }
  }

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
                onClick={() => viewDetail(a.id)}
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

        {/* Detail Table */}
        <div className="border border-gray-200 rounded-lg overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                {['Part #', 'Customer', 'Demand Qty', 'FG Allocated', 'WIP Allocated', 'Total Allocated', 'Unallocated', 'Status'].map((h) => (
                  <th key={h} className="text-left text-xs font-semibold text-gray-500 uppercase px-4 py-3 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-6 py-8 text-center">
                    <Loader2 size={20} className="mx-auto text-blue-500 animate-spin" />
                  </td>
                </tr>
              ) : detail?.allocations?.length > 0 ? (
                detail.allocations.map((row, i) => (
                  <tr key={i} className="border-b border-gray-100">
                    <td className="px-4 py-2 text-sm">{row.cust_part_no || row.maini_part_no}</td>
                    <td className="px-4 py-2 text-sm">{row.customer}</td>
                    <td className="px-4 py-2 text-sm">{row.demand_qty}</td>
                    <td className="px-4 py-2 text-sm">{row.total_fg || 0}</td>
                    <td className="px-4 py-2 text-sm">{row.wip_qty || 0}</td>
                    <td className="px-4 py-2 text-sm font-medium">{row.allocated}</td>
                    <td className="px-4 py-2 text-sm text-red-600">{row.gap > 0 ? row.gap : '—'}</td>
                    <td className="px-4 py-2">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        row.status === 'full' ? 'bg-green-100 text-green-700' :
                        row.status === 'partial' ? 'bg-yellow-100 text-yellow-700' :
                        'bg-red-100 text-red-700'
                      }`}>
                        {row.status === 'full' ? 'Full' : row.status === 'partial' ? 'Partial' : 'No Stock'}
                      </span>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={8} className="px-6 py-8 text-center text-sm text-gray-500">
                    {allocations.length > 0 ? 'Select an allocation report to view details.' : 'Run FG and WIP allocations first to generate liquidation reports.'}
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
