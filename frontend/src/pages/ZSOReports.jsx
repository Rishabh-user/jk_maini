import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Search, Download, FileSpreadsheet, Plus, X, Mail, Loader2, ClipboardList,
  CalendarDays, Rows3, Filter, ChevronLeft, ChevronRight
} from 'lucide-react'
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

const PAGE_SIZE = 25

const formatDate = (value) => {
  if (!value) return 'No date'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'No date'
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

const formatDateTime = (value) => {
  if (!value) return 'No date'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'No date'
  return date.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const formatMoney = (value) => {
  const amount = Number(value || 0)
  return `₹${amount.toLocaleString('en-IN')}`
}

const safeFilename = (value) => String(value || 'ZSO_Report')
  .replace(/\.[^.]+$/, '')
  .replace(/[^a-z0-9_-]+/gi, '_')
  .replace(/^_+|_+$/g, '')
  .slice(0, 80) || 'ZSO_Report'

const getItems = (report) => report?.report_data?.items || []

const getReportTotal = (report) => {
  if (report?.total_inr !== null && report?.total_inr !== undefined) return Number(report.total_inr || 0)
  return getItems(report).reduce((sum, item) => sum + Number(item.total_inr || item.total_price || 0), 0)
}

const getReportCustomers = (report) => {
  const customers = new Set()
  getItems(report).forEach((item) => {
    if (item.customer_name) customers.add(item.customer_name)
  })
  return customers.size
}

const buildEmailIndex = (emails) => emails.reduce((index, email) => {
  index[email.id] = {
    subject: email.subject || '',
    sender: email.sender || '',
    attachments: email.attachments || [],
  }
  return index
}, {})

const getReportSource = (report, emailIndex) => emailIndex[report?.email_id] || {}

const getReportFileNames = (report, emailIndex) => {
  const source = getReportSource(report, emailIndex)
  return (source.attachments || []).map((att) => att.filename).filter(Boolean)
}

const getReportFileLabel = (report, emailIndex) => {
  const filenames = getReportFileNames(report, emailIndex)
  if (filenames.length > 0) return filenames[0]
  const source = getReportSource(report, emailIndex)
  return source.subject || `Report #${report.id}`
}

const getReportFileMeta = (report, emailIndex) => {
  const filenames = getReportFileNames(report, emailIndex)
  if (filenames.length > 1) return `+${filenames.length - 1} more file${filenames.length - 1 === 1 ? '' : 's'}`
  const source = getReportSource(report, emailIndex)
  return source.subject || `Report #${report.id}`
}

const flattenReportRows = (report, emailIndex) => {
  const items = getItems(report)
  const reportLabel = getReportFileLabel(report, emailIndex)
  return items.map((item) => ({
    reportId: report.id,
    reportLabel,
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
  }))
}

const StatusPill = ({ status }) => {
  const normalized = (status || 'draft').toLowerCase()
  const palette = normalized === 'exported'
    ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
    : 'bg-amber-50 text-amber-700 border-amber-100'
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${palette}`}>
      {normalized}
    </span>
  )
}

export default function ZSOReports() {
  const [reports, setReports] = useState([])
  const [emailIndex, setEmailIndex] = useState({})
  const [selectedReportId, setSelectedReportId] = useState('all')
  const [reportSearch, setReportSearch] = useState('')
  const [tableSearch, setTableSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(null)
  const [page, setPage] = useState(1)

  const [showGenerate, setShowGenerate] = useState(false)
  const [processedEmails, setProcessedEmails] = useState([])
  const [loadingEmails, setLoadingEmails] = useState(false)
  const [selectedEmailId, setSelectedEmailId] = useState(null)
  const [generating, setGenerating] = useState(false)

  const loadReports = useCallback(async () => {
    try {
      const [reportsResult, emailsResult] = await Promise.allSettled([
        fetchZSOReports(),
        fetchEmails(0, 500),
      ])

      if (reportsResult.status === 'fulfilled') {
        setReports(reportsResult.value.data || [])
      } else {
        console.error('Failed to load ZSO reports:', reportsResult.reason)
      }

      if (emailsResult.status === 'fulfilled') {
        setEmailIndex(buildEmailIndex(emailsResult.value.data?.emails || []))
      } else {
        console.error('Failed to load source email metadata:', emailsResult.reason)
      }
    } catch (err) {
      console.error('Failed to load ZSO reports:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadReports() }, [loadReports])

  const reportStats = useMemo(() => {
    const lineItems = reports.reduce((sum, report) => sum + getItems(report).length, 0)
    const totalInr = reports.reduce((sum, report) => sum + getReportTotal(report), 0)
    return { lineItems, totalInr }
  }, [reports])

  const filteredReports = useMemo(() => {
    const query = reportSearch.trim().toLowerCase()
    if (!query) return reports
    return reports.filter((report) => {
      const haystack = [
        `#${report.id}`,
        String(report.id),
        report.kas_name || '',
        report.status || '',
        formatDate(report.created_at),
        String(report.email_id || ''),
        getReportFileLabel(report, emailIndex),
        getReportFileMeta(report, emailIndex),
      ].join(' ').toLowerCase()
      return haystack.includes(query)
    })
  }, [reports, reportSearch, emailIndex])

  useEffect(() => {
    if (selectedReportId === 'all') return
    if (!reports.some((report) => report.id === selectedReportId)) {
      setSelectedReportId('all')
    }
  }, [reports, selectedReportId])

  useEffect(() => {
    setPage(1)
  }, [selectedReportId, tableSearch])

  const selectedReport = selectedReportId === 'all'
    ? null
    : reports.find((report) => report.id === selectedReportId) || null

  const visibleReports = selectedReport ? [selectedReport] : reports
  const flatRows = useMemo(
    () => visibleReports.flatMap((report) => flattenReportRows(report, emailIndex)),
    [visibleReports, emailIndex]
  )

  const filteredRows = useMemo(() => {
    const query = tableSearch.trim().toLowerCase()
    if (!query) return flatRows
    return flatRows.filter((row) =>
      [
        row.reportLabel,
        row.kasName,
        row.customerName,
        row.siteLocation,
        row.country,
        row.poForecast,
        row.custPart,
        row.mainiPart,
        row.category,
        row.subCategory,
      ].some((value) => String(value || '').toLowerCase().includes(query))
    )
  }, [flatRows, tableSearch])

  const displayColumns = selectedReportId === 'all'
    ? [{ key: 'reportLabel', label: 'Source File' }, ...ZSO_COLUMNS]
    : ZSO_COLUMNS
  const totalPages = Math.ceil(filteredRows.length / PAGE_SIZE) || 1
  const paginated = filteredRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

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
    if (!reportId || reportId === 'all') return
    setExporting(reportId)
    try {
      const report = reports.find((r) => r.id === reportId)
      const res = await exportZSO(reportId)
      const blob = new Blob([res.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${safeFilename(getReportFileLabel(report || { id: reportId }, emailIndex))}_ZSO_${reportId}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
      await loadReports()
    } catch (err) {
      alert('Export failed: ' + (err.response?.data?.detail || err.message))
    } finally {
      setExporting(null)
    }
  }

  const handleExportCSV = () => {
    if (filteredRows.length === 0) return
    const headers = displayColumns.map((c) => c.label)
    const rows = filteredRows.map((r) =>
      displayColumns.map((c) => {
        const val = r[c.key]
        return typeof val === 'number' ? val : val || ''
      })
    )
    const csv = [headers.join(','), ...rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = selectedReport
      ? `ZSO_Report_${selectedReport.id}_${new Date().toISOString().split('T')[0]}.csv`
      : `ZSO_All_Reports_${new Date().toISOString().split('T')[0]}.csv`
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
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">ZSO Reports</h1>
          <p className="text-sm text-gray-500 mt-1">
            Generated Zero Stock Out reports
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={openGenerateModal}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            <Plus size={16} />
            Generate Report
          </button>
          <button
            onClick={() => handleExport(selectedReportId)}
            disabled={selectedReportId === 'all' || exporting === selectedReportId}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-emerald-600 text-white rounded-md hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <FileSpreadsheet size={16} />
            {exporting === selectedReportId ? 'Exporting...' : 'Export XLSX'}
          </button>
          <button
            onClick={handleExportCSV}
            disabled={filteredRows.length === 0}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium border border-gray-200 text-gray-700 rounded-md hover:bg-gray-50 disabled:opacity-50"
          >
            <Download size={16} />
            Export CSV
          </button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="p-4 border-b border-gray-100 space-y-3">
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Search reports or files"
                value={reportSearch}
                onChange={(e) => setReportSearch(e.target.value)}
                className="pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 w-full"
              />
            </div>
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <Filter size={14} />
              <span>{filteredReports.length} reports shown</span>
            </div>
          </div>

          <div className="max-h-[650px] overflow-y-auto">
            <button
              onClick={() => setSelectedReportId('all')}
              className={`w-full text-left px-4 py-3 border-b border-gray-100 transition-colors ${
                selectedReportId === 'all' ? 'bg-blue-50' : 'hover:bg-gray-50'
              }`}
            >
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-blue-50 text-blue-600">
                  <ClipboardList size={17} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-gray-900">All Reports</span>
                  <span className="mt-1 block text-xs text-gray-500">
                    {reports.length} reports, {reportStats.lineItems} line items
                  </span>
                  <span className="mt-2 block text-xs font-medium text-gray-700">{formatMoney(reportStats.totalInr)}</span>
                </span>
              </div>
            </button>

            {filteredReports.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <ClipboardList size={24} className="mx-auto text-gray-300 mb-2" />
                <p className="text-sm text-gray-500">No reports found</p>
              </div>
            ) : (
              filteredReports.map((report) => {
                const items = getItems(report)
                const selected = selectedReportId === report.id
                const fileLabel = getReportFileLabel(report, emailIndex)
                const fileMeta = getReportFileMeta(report, emailIndex)
                return (
                  <button
                    key={report.id}
                    onClick={() => setSelectedReportId(report.id)}
                    className={`w-full text-left px-4 py-3 border-b border-gray-100 transition-colors ${
                      selected ? 'bg-blue-50' : 'hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-start gap-3 min-w-0">
                      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-emerald-50 text-emerald-600">
                        <FileSpreadsheet size={17} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={`block truncate text-sm font-medium ${selected ? 'text-blue-900' : 'text-gray-900'}`}>
                          {fileLabel}
                        </span>
                        <span className="mt-1 block truncate text-xs text-gray-500">
                          Report #{report.id} · {report.kas_name || 'Unassigned KAS'}
                        </span>
                        {fileMeta && fileMeta !== fileLabel && (
                          <span className="mt-1 block truncate text-xs text-gray-400">
                            {fileMeta}
                          </span>
                        )}
                        <span className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-gray-500">
                          <span className="inline-flex items-center gap-1 rounded bg-gray-100 px-1.5 py-0.5">
                            <Rows3 size={10} />
                            {items.length} rows
                          </span>
                          <span className="inline-flex items-center rounded bg-gray-100 px-1.5 py-0.5">
                            {getReportCustomers(report)} customers
                          </span>
                          <span className="inline-flex items-center gap-1 rounded bg-gray-100 px-1.5 py-0.5">
                            <CalendarDays size={10} />
                            {formatDate(report.created_at)}
                          </span>
                        </span>
                        <span className="mt-2 flex items-center justify-between gap-2">
                          <span className="text-xs font-medium text-gray-700">{formatMoney(getReportTotal(report))}</span>
                          <StatusPill status={report.status} />
                        </span>
                      </span>
                    </div>
                  </button>
                )
              })
            )}
          </div>
        </aside>

        <section className="min-w-0 space-y-4">
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="truncate text-base font-semibold text-gray-900">
                    {selectedReport ? getReportFileLabel(selectedReport, emailIndex) : 'All ZSO Reports'}
                  </h2>
                  {selectedReport && <StatusPill status={selectedReport.status} />}
                </div>
                <p className="mt-1 text-sm text-gray-500">
                  {selectedReport
                    ? `Report #${selectedReport.id} · ${selectedReport.kas_name || 'Unassigned KAS'} · Created ${formatDateTime(selectedReport.created_at)}`
                    : `${reports.length} reports selected`}
                </p>
                {selectedReport && getReportFileMeta(selectedReport, emailIndex) !== getReportFileLabel(selectedReport, emailIndex) && (
                  <p className="mt-1 truncate text-xs text-gray-400">
                    {getReportFileMeta(selectedReport, emailIndex)}
                  </p>
                )}
              </div>
              <div className="grid grid-cols-3 gap-4 text-right">
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-gray-500">Reports</p>
                  <p className="text-sm font-semibold text-gray-900">{visibleReports.length}</p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-gray-500">Line Items</p>
                  <p className="text-sm font-semibold text-gray-900">{flatRows.length}</p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-gray-500">Total INR</p>
                  <p className="text-sm font-semibold text-gray-900">
                    {formatMoney(visibleReports.reduce((sum, report) => sum + getReportTotal(report), 0))}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="relative w-full sm:w-72">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Search line items"
                value={tableSearch}
                onChange={(e) => setTableSearch(e.target.value)}
                className="pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 w-full"
              />
            </div>
            <p className="text-sm text-gray-500">
              {filteredRows.length} of {flatRows.length} line items
            </p>
          </div>

          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-max">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    {displayColumns.map((col) => (
                      <th
                        key={col.key}
                        className={`text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3 whitespace-nowrap ${
                          col.align === 'right' ? 'text-right' : 'text-left'
                        }`}
                      >
                        {col.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {paginated.length === 0 ? (
                    <tr>
                      <td colSpan={displayColumns.length} className="px-6 py-10 text-center text-sm text-gray-500">
                        No ZSO line items found.
                      </td>
                    </tr>
                  ) : (
                    paginated.map((row, i) => (
                      <tr key={`${row.reportId}-${row.srNo}-${i}`} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                        {displayColumns.map((col) => {
                          const val = row[col.key]
                          const isNum = col.align === 'right'
                          const display = isNum && typeof val === 'number' ? val.toLocaleString('en-IN') : val || '-'
                          return (
                            <td
                              key={col.key}
                              className={`px-4 py-3.5 text-sm text-gray-600 whitespace-nowrap max-w-[240px] truncate ${
                                isNum ? 'text-right' : ''
                              }`}
                              title={String(display)}
                            >
                              {col.key === 'totalInr' ? formatMoney(val) : display}
                            </td>
                          )
                        })}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {filteredRows.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-3 border-t border-gray-100">
                <span className="text-sm text-gray-500">
                  Showing {(page - 1) * PAGE_SIZE + 1}-{Math.min(page * PAGE_SIZE, filteredRows.length)} of {filteredRows.length}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPage(Math.max(1, page - 1))}
                    disabled={page === 1}
                    className="p-1 rounded-md hover:bg-gray-100 disabled:opacity-30"
                  >
                    <ChevronLeft size={18} />
                  </button>
                  <span className="text-sm text-gray-600">
                    Page {page} of {totalPages}
                  </span>
                  <button
                    onClick={() => setPage(Math.min(totalPages, page + 1))}
                    disabled={page >= totalPages}
                    className="p-1 rounded-md hover:bg-gray-100 disabled:opacity-30"
                  >
                    <ChevronRight size={18} />
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>

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
                      {formatDateTime(email.received_at || email.created_at)}
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
