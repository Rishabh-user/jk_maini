import { useState, useEffect, useCallback } from 'react'
import { Search, Download, FileSpreadsheet, Plus, X, Mail, Loader2 } from 'lucide-react'
import StatusBadge from '../components/StatusBadge'
import { fetchZSOReports, exportZSO, generateZSO, fetchEmails } from '../services/api'

const ZSO_COLUMNS = [
  { key: 'srNo', label: 'S No', align: 'center' },
  { key: 'kasName', label: 'KAS Name' },
  { key: 'customerName', label: 'Customer Name' },
  { key: 'siteLocation', label: 'Site Location' },
  { key: 'country', label: 'Country' },
  { key: 'incoterm', label: 'Incoterm' },
  { key: 'directSalesWh', label: 'Direct Sales / WH Movement' },
  { key: 'poForecast', label: 'PO # / Forecast' },
  { key: 'category', label: 'Category' },
  { key: 'subCategory', label: 'Sub Category' },
  { key: 'custPart', label: 'Cust Part #' },
  { key: 'mainiPart', label: 'Maini Part #' },
  { key: 'openQty', label: 'Open Qty', align: 'right' },
  { key: 'unitPrice', label: 'Unit Price', align: 'right' },
  { key: 'currency', label: 'Currency' },
  { key: 'unitPriceInr', label: 'Unit Price in INR', align: 'right' },
  { key: 'totalInr', label: 'Total in INR', align: 'right' },
  { key: 'docDate', label: 'Doc Date' },
  { key: 'shipDate', label: 'Ship Date' },
  { key: 'salesMonth', label: 'Sales Month' },
]

export default function ZSOReports() {
  const [reports, setReports] = useState([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(null)

  // Generate modal state
  const [showGenerate, setShowGenerate] = useState(false)
  const [processedEmails, setProcessedEmails] = useState([])
  const [loadingEmails, setLoadingEmails] = useState(false)
  const [selectedEmailId, setSelectedEmailId] = useState(null)
  const [generating, setGenerating] = useState(false)

  const loadReports = useCallback(async () => {
    try {
      const res = await fetchZSOReports()
      setReports(res.data || [])
    } catch (err) {
      console.error('Failed to load ZSO reports:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadReports() }, [loadReports])

  // Flatten report_data items for display
  const flatRows = []
  for (const report of reports) {
    const items = report.report_data?.items || []
    for (const item of items) {
      flatRows.push({
        reportId: report.id,
        srNo: item.sr_no || '',
        kasName: item.kas_name || report.kas_name || '',
        customerName: item.customer_name || '',
        siteLocation: item.site_location || '',
        country: item.country || '',
        incoterm: item.incoterm || '',
        directSalesWh: item.direct_sales_wh_movement || '',
        poForecast: item.po_forecast || item.po_number || '',
        category: item.category || '',
        subCategory: item.sub_category || '',
        custPart: item.cust_part_no || item.customer_part_no || '',
        mainiPart: item.maini_part_no || '',
        openQty: item.open_qty ?? item.quantity ?? 0,
        unitPrice: item.unit_price || 0,
        currency: item.currency || 'INR',
        unitPriceInr: item.unit_price_inr || item.unit_price || 0,
        totalInr: item.total_inr || item.total_price || 0,
        docDate: item.doc_date || '',
        shipDate: item.ship_date || item.delivery_date || '',
        salesMonth: item.sales_month || '',
        status: report.status || 'draft',
      })
    }
  }

  const filtered = flatRows.filter(
    (d) =>
      d.kasName.toLowerCase().includes(search.toLowerCase()) ||
      d.customerName.toLowerCase().includes(search.toLowerCase()) ||
      String(d.custPart).toLowerCase().includes(search.toLowerCase()) ||
      String(d.mainiPart).toLowerCase().includes(search.toLowerCase()) ||
      String(d.poForecast).toLowerCase().includes(search.toLowerCase())
  )

  const openGenerateModal = async () => {
    setShowGenerate(true)
    setLoadingEmails(true)
    setSelectedEmailId(null)
    try {
      const res = await fetchEmails(0, 100, 'processed')
      setProcessedEmails(res.data?.emails || [])
    } catch (err) {
      console.error('Failed to load emails:', err)
    } finally {
      setLoadingEmails(false)
    }
  }

  const handleGenerate = async () => {
    if (!selectedEmailId) return
    setGenerating(true)
    try {
      await generateZSO(selectedEmailId)
      setShowGenerate(false)
      await loadReports()
    } catch (err) {
      alert('Generation failed: ' + (err.response?.data?.detail || err.message))
    } finally {
      setGenerating(false)
    }
  }

  const handleExport = async (reportId) => {
    setExporting(reportId)
    try {
      const res = await exportZSO(reportId)
      const blob = new Blob([res.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `ZSO_Report_${reportId}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      alert('Export failed: ' + (err.response?.data?.detail || err.message))
    } finally {
      setExporting(null)
    }
  }

  const handleExportCSV = () => {
    if (filtered.length === 0) return
    const headers = ZSO_COLUMNS.map((c) => c.label)
    const rows = filtered.map((r) =>
      ZSO_COLUMNS.map((c) => {
        const val = r[c.key]
        return typeof val === 'number' ? val : val || ''
      })
    )
    const csv = [headers.join(','), ...rows.map((r) => r.map((v) => `"${v}"`).join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `ZSO_Report_${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">ZSO Reports</h1>
        <p className="text-sm text-gray-500 mt-1">
          Generated Zero Stock Out reports ({reports.length} reports, {flatRows.length} line items)
        </p>
      </div>

      <div className="flex items-center justify-between mb-4 gap-4 flex-wrap">
        <div className="relative w-64">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 w-full"
          />
        </div>
        <div className="flex gap-2">
          <button
            onClick={openGenerateModal}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            <Plus size={16} />
            Generate Report
          </button>
          {reports.map((r) => (
            <button
              key={r.id}
              onClick={() => handleExport(r.id)}
              disabled={exporting === r.id}
              className="flex items-center gap-2 px-3 py-2 text-xs font-medium bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
            >
              <FileSpreadsheet size={14} />
              {exporting === r.id ? 'Exporting...' : `Export #${r.id}`}
            </button>
          ))}
          <button
            onClick={handleExportCSV}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50"
          >
            <Download size={16} />
            Export CSV
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-100">
              {ZSO_COLUMNS.map((col) => (
                <th
                  key={col.key}
                  className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3 whitespace-nowrap"
                >
                  {col.label} <span className="text-gray-400">&#8597;</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={ZSO_COLUMNS.length} className="px-6 py-8 text-center text-sm text-gray-500">
                  No ZSO reports yet. Click "Generate Report" to create one from a processed email.
                </td>
              </tr>
            ) : (
              filtered.map((row, i) => (
                <tr key={i} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                  {ZSO_COLUMNS.map((col) => {
                    const val = row[col.key]
                    const isNum = col.align === 'right'
                    const display = isNum && typeof val === 'number' ? val.toLocaleString() : val || '-'
                    return (
                      <td
                        key={col.key}
                        className={`px-4 py-3.5 text-sm text-gray-600 whitespace-nowrap ${isNum ? 'text-right' : ''}`}
                      >
                        {col.key === 'totalInr' ? `₹${Number(val).toLocaleString()}` : display}
                      </td>
                    )
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Generate Report Modal */}
      {showGenerate && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-semibold text-gray-900">Generate ZSO Report</h2>
              <button onClick={() => setShowGenerate(false)} className="p-1 rounded hover:bg-gray-100">
                <X size={18} />
              </button>
            </div>

            <p className="text-sm text-gray-500 mb-4">
              Select a processed email to generate a ZSO report from its parsed attachment data.
            </p>

            {loadingEmails ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 size={24} className="animate-spin text-blue-600" />
                <span className="ml-2 text-sm text-gray-500">Loading processed emails...</span>
              </div>
            ) : processedEmails.length === 0 ? (
              <div className="text-center py-8">
                <Mail size={32} className="mx-auto text-gray-300 mb-2" />
                <p className="text-sm text-gray-500">No processed emails found.</p>
                <p className="text-xs text-gray-400 mt-1">
                  Go to Email Inbox, fetch emails, and process them first.
                </p>
              </div>
            ) : (
              <div className="max-h-72 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
                {processedEmails.map((email) => (
                  <button
                    key={email.id}
                    onClick={() => setSelectedEmailId(email.id)}
                    className={`w-full text-left px-4 py-3 hover:bg-blue-50 transition-colors ${
                      selectedEmailId === email.id ? 'bg-blue-50 border-l-4 border-l-blue-600' : ''
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-900 truncate">
                          {email.subject || '(No subject)'}
                        </p>
                        <p className="text-xs text-gray-500 mt-0.5 truncate">{email.sender}</p>
                      </div>
                      <div className="ml-3 flex-shrink-0">
                        <span className="text-xs text-gray-400">
                          {email.attachments?.length || 0} file{(email.attachments?.length || 0) !== 1 ? 's' : ''}
                        </span>
                      </div>
                    </div>
                    <p className="text-xs text-gray-400 mt-1">
                      {new Date(email.received_at).toLocaleDateString('en-IN', {
                        day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
                      })}
                    </p>
                  </button>
                ))}
              </div>
            )}

            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setShowGenerate(false)}
                className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleGenerate}
                disabled={!selectedEmailId || generating}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
              >
                {generating && <Loader2 size={14} className="animate-spin" />}
                {generating ? 'Generating...' : 'Generate Report'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
