import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AgGridReact } from 'ag-grid-react'
import { AllCommunityModule, ModuleRegistry, themeQuartz } from 'ag-grid-community'
import {
  FileSpreadsheet, Plus, X, Mail, Loader2, ClipboardList,
  CalendarDays, Rows3, Filter, ChevronDown, ChevronUp, Search,
  Download, Columns, FileText,
} from 'lucide-react'
import { fetchZSOReports, exportZSO, generateZSO, fetchEmails } from '../services/api'

ModuleRegistry.registerModules([AllCommunityModule])

// ─── All columns metadata (for the visibility panel) ───────────────────────

const ALL_COLUMN_META = [
  { field: 'kasName',      label: 'KAS Name' },
  { field: 'customerName', label: 'Customer Name' },
  { field: 'siteLocation', label: 'Site Location' },
  { field: 'country',      label: 'Country' },
  { field: 'incoterm',     label: 'Incoterm' },
  { field: 'directSalesWh', label: 'Direct Sales / WH' },
  { field: 'poForecast',   label: 'PO # / Forecast' },
  { field: 'category',     label: 'Category' },
  { field: 'subCategory',  label: 'Sub Category' },
  { field: 'custPart',     label: 'Cust Part #' },
  { field: 'mainiPart',    label: 'Maini Part #' },
  { field: 'openQty',      label: 'Open Qty' },
  { field: 'unitPrice',    label: 'Unit Price' },
  { field: 'currency',     label: 'Currency' },
  { field: 'unitPriceInr', label: 'Unit Price INR' },
  { field: 'totalInr',     label: 'Total in INR' },
  { field: 'docDate',      label: 'Doc Date' },
  { field: 'shipDate',     label: 'Ship Date' },
  { field: 'salesMonth',   label: 'Sales Month' },
]

// ─── Helpers ───────────────────────────────────────────────────────────────

const formatDate = (value) => {
  if (!value) return ''
  const d = new Date(value)
  if (isNaN(d.getTime())) return String(value)
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

const formatDateTime = (value) => {
  if (!value) return ''
  const d = new Date(value)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

const formatMoney = (v) => `₹${Number(v || 0).toLocaleString('en-IN')}`
const safeFilename = (v) =>
  String(v || 'ZSO_Report').replace(/\.[^.]+$/, '').replace(/[^a-z0-9_-]+/gi, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'ZSO_Report'

const isForecastLabel = (po) => {
  const v = String(po || '').trim()
  return v.length > 0 && !/^[\d\-/]+$/.test(v)
}

const getItems = (r) => r?.report_data?.items || []
const getReportTotal = (r) => {
  if (r?.total_inr != null) return Number(r.total_inr || 0)
  return getItems(r).reduce((s, i) => s + Number(i.total_inr || 0), 0)
}
const getReportCustomers = (r) => new Set(getItems(r).map(i => i.customer_name).filter(Boolean)).size
const getForexRatesUsed = (r) => r?.report_data?.forex_rates_used || {}

const buildEmailIndex = (emails) =>
  emails.reduce((idx, e) => { idx[e.id] = { subject: e.subject || '', sender: e.sender || '', attachments: e.attachments || [] }; return idx }, {})

const getReportFileNames = (r, ei) => ((ei[r?.email_id] || {}).attachments || []).map(a => a.filename).filter(Boolean)
const getReportFileLabel = (r, ei) => getReportFileNames(r, ei)[0] || (ei[r?.email_id] || {}).subject || `Report #${r.id}`
const getReportFileMeta = (r, ei) => {
  const fns = getReportFileNames(r, ei)
  if (fns.length > 1) return `+${fns.length - 1} more`
  return (ei[r?.email_id] || {}).subject || `Report #${r.id}`
}

const flattenReportRows = (report, emailIndex) =>
  getItems(report).map((item) => ({
    reportId: report.id,
    reportLabel: getReportFileLabel(report, emailIndex),
    srNo: item.sr_no || '',
    kasName: item.kas_name || report.kas_name || '',
    customerName: item.customer_name || '',
    siteLocation: item.site_location || '',
    country: item.country || '',
    incoterm: item.incoterm || '',
    directSalesWh: item.direct_sales_wh_movement || '',
    poForecast: item.po_forecast || '',
    category: item.category || '',
    subCategory: item.sub_category || '',
    custPart: item.cust_part_no || '',
    mainiPart: item.maini_part_no || '',
    openQty: item.open_qty ?? 0,
    unitPrice: item.unit_price || 0,
    currency: item.currency || 'INR',
    unitPriceInr: item.unit_price_inr || 0,
    totalInr: item.total_inr || 0,
    docDate: item.doc_date || '',
    shipDate: item.ship_date || '',
    salesMonth: item.sales_month || '',
    rowId: item.row_id || '',
    forecastSchedule: item.forecast_schedule || null,
    status: report.status || 'draft',
  }))

const StatusPill = ({ status }) => {
  const n = (status || 'draft').toLowerCase()
  const c = n === 'exported' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-amber-50 text-amber-700 border-amber-100'
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${c}`}>{n}</span>
}

// ─── Schedule preview panel ────────────────────────────────────────────────

const SchedulePreview = ({ schedule, partNo, poLabel, onClose }) => {
  if (!schedule) return null
  const entries = Object.entries(schedule).sort(([a], [b]) => a.localeCompare(b))
  const total = entries.reduce((s, [, q]) => s + Number(q), 0)
  return (
    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-3">
      <div className="flex items-start justify-between mb-2">
        <div className="flex flex-wrap items-center gap-2">
          <CalendarDays size={15} className="text-blue-600 shrink-0" />
          <span className="text-sm font-semibold text-blue-800">Forecast Schedule — {partNo}</span>
          <span className="text-xs rounded-full bg-amber-100 text-amber-700 border border-amber-200 px-2 py-0.5">{poLabel}</span>
          <span className="text-xs text-blue-500">{entries.length} delivery buckets · Total: {total.toLocaleString('en-IN')} pcs</span>
        </div>
        <button onClick={onClose} className="p-1 rounded hover:bg-blue-100 text-blue-400 hover:text-blue-600 shrink-0 ml-2"><X size={14} /></button>
      </div>
      <p className="text-xs text-blue-500 mb-2 italic">
        Ship Date in the grid shows the earliest bucket ({formatDate(entries[0]?.[0])}). All {entries.length} dates are below.
      </p>
      <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
        {entries.map(([date, qty]) => (
          <div key={date} className="flex items-center gap-1 rounded border border-blue-100 bg-white px-2 py-1 text-xs shadow-sm">
            <span className="font-medium text-gray-700">{formatDate(date)}</span>
            <span className="text-gray-400">·</span>
            <span className="font-semibold text-blue-700">{Number(qty).toLocaleString('en-IN')} pcs</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Column Visibility Panel ───────────────────────────────────────────────

const ColumnPanel = ({ visibleFields, onToggle, onClose, anchorRef }) => (
  <div className="absolute right-0 top-10 z-40 bg-white border border-gray-200 rounded-xl shadow-xl w-52 py-2" style={{ boxShadow: '0 8px 24px rgba(0,0,0,.12)' }}>
    <div className="flex items-center justify-between px-3 pb-2 mb-1 border-b border-gray-100">
      <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Show / Hide Columns</span>
      <button onClick={onClose} className="p-0.5 rounded hover:bg-gray-100 text-gray-400"><X size={13} /></button>
    </div>
    <div className="max-h-72 overflow-y-auto">
      {ALL_COLUMN_META.map(({ field, label }) => (
        <label key={field} className="flex items-center gap-2.5 px-3 py-1.5 cursor-pointer hover:bg-gray-50 select-none">
          <input
            type="checkbox"
            checked={visibleFields.has(field)}
            onChange={() => onToggle(field)}
            className="w-3.5 h-3.5 rounded accent-blue-600"
          />
          <span className="text-sm text-gray-700">{label}</span>
        </label>
      ))}
    </div>
    <div className="px-3 pt-2 mt-1 border-t border-gray-100 flex gap-2">
      <button
        onClick={() => ALL_COLUMN_META.forEach(c => !visibleFields.has(c.field) && onToggle(c.field))}
        className="text-xs text-blue-600 hover:underline"
      >Show all</button>
    </div>
  </div>
)

// ─── Export Dropdown ───────────────────────────────────────────────────────

const ExportDropdown = ({ onCSV, onExcel, isAllReports, onClose }) => (
  <div className="absolute right-0 top-10 z-40 bg-white border border-gray-200 rounded-xl shadow-xl w-52 py-1.5" style={{ boxShadow: '0 8px 24px rgba(0,0,0,.12)' }}>
    <button
      onClick={() => { onCSV(); onClose() }}
      className="flex items-center gap-2.5 w-full px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
    >
      <FileText size={15} className="text-gray-400" />
      <div className="text-left">
        <p className="leading-tight">Export as CSV</p>
        <p className="text-[11px] text-gray-400">Respects visible columns &amp; filters</p>
      </div>
    </button>
    <button
      onClick={() => { onExcel(); onClose() }}
      className="flex items-center gap-2.5 w-full px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
    >
      <FileSpreadsheet size={15} className="text-emerald-500" />
      <div className="text-left">
        <p className="leading-tight">Export as Excel</p>
        <p className="text-[11px] text-gray-400">
          {isAllReports ? 'Select a report from sidebar first' : 'Respects visible columns'}
        </p>
      </div>
    </button>
  </div>
)

// ─── Main component ────────────────────────────────────────────────────────

export default function ZSOReports() {
  const gridRef = useRef(null)
  const colPanelRef = useRef(null)
  const exportPanelRef = useRef(null)

  const [reports, setReports] = useState([])
  const [emailIndex, setEmailIndex] = useState({})
  const [selectedReportId, setSelectedReportId] = useState('all')
  const [reportSearch, setReportSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [quickFilter, setQuickFilter] = useState('')

  const [showGenerate, setShowGenerate] = useState(false)
  const [processedEmails, setProcessedEmails] = useState([])
  const [loadingEmails, setLoadingEmails] = useState(false)
  const [selectedEmailId, setSelectedEmailId] = useState(null)
  const [generating, setGenerating] = useState(false)

  const [forecastPreview, setForecastPreview] = useState(null)
  const [showColPanel, setShowColPanel] = useState(false)
  const [showExportPanel, setShowExportPanel] = useState(false)

  // All columns visible by default
  const [visibleFields, setVisibleFields] = useState(
    () => new Set(ALL_COLUMN_META.map(c => c.field))
  )

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e) => {
      if (colPanelRef.current && !colPanelRef.current.contains(e.target)) setShowColPanel(false)
      if (exportPanelRef.current && !exportPanelRef.current.contains(e.target)) setShowExportPanel(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const toggleColumn = useCallback((field) => {
    // Compute new visibility FIRST, then apply to both React state AND AG Grid
    const nowVisible = !visibleFields.has(field)
    const next = new Set(visibleFields)
    if (nowVisible) { next.add(field) } else { next.delete(field) }
    setVisibleFields(next)
    // Apply to AG Grid synchronously (outside state setter so timing is guaranteed)
    gridRef.current?.api?.setColumnsVisible([field], nowVisible)
  }, [visibleFields])

  const loadReports = useCallback(async () => {
    try {
      const [rr, er] = await Promise.allSettled([fetchZSOReports(), fetchEmails(0, 500)])
      if (rr.status === 'fulfilled') setReports(rr.value.data || [])
      if (er.status === 'fulfilled') setEmailIndex(buildEmailIndex(er.value.data?.emails || []))
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { loadReports() }, [loadReports])

  const reportStats = useMemo(() => ({
    lineItems: reports.reduce((s, r) => s + getItems(r).length, 0),
    totalInr: reports.reduce((s, r) => s + getReportTotal(r), 0),
  }), [reports])

  const filteredReports = useMemo(() => {
    const q = reportSearch.trim().toLowerCase()
    if (!q) return reports
    return reports.filter(r =>
      [`#${r.id}`, String(r.id), r.kas_name || '', r.status || '', getReportFileLabel(r, emailIndex)].join(' ').toLowerCase().includes(q)
    )
  }, [reports, reportSearch, emailIndex])

  useEffect(() => {
    if (selectedReportId !== 'all' && !reports.some(r => r.id === selectedReportId)) setSelectedReportId('all')
  }, [reports, selectedReportId])

  const selectedReport = selectedReportId === 'all' ? null : reports.find(r => r.id === selectedReportId) || null
  const visibleReports = selectedReport ? [selectedReport] : reports

  const rowData = useMemo(
    () => visibleReports.flatMap(r => flattenReportRows(r, emailIndex)),
    [visibleReports, emailIndex]
  )

  // ── Cell renderers ────────────────────────────────────────────────────────

  const POCellRenderer = useCallback(({ data, value }) => {
    const hasSched = isForecastLabel(value) && data?.forecastSchedule && Object.keys(data.forecastSchedule).length > 0
    if (!hasSched) return <span className="text-gray-600">{value || '—'}</span>
    const isActive = forecastPreview?.custPart === data.custPart && forecastPreview?.poLabel === value
    return (
      <div
        className="flex items-center gap-1.5 cursor-pointer select-none"
        onClick={() => isActive
          ? setForecastPreview(null)
          : setForecastPreview({ schedule: data.forecastSchedule, partNo: data.custPart, poLabel: value, custPart: data.custPart })}
      >
        <span className="inline-flex items-center rounded-full bg-amber-50 border border-amber-200 text-amber-700 text-xs font-medium px-2 py-0.5">{value}</span>
        {isActive ? <ChevronUp size={13} className="text-amber-500" /> : <ChevronDown size={13} className="text-gray-400" />}
      </div>
    )
  }, [forecastPreview])

  const ShipDateRenderer = useCallback(({ data, value }) => {
    const schedCount = data?.forecastSchedule ? Object.keys(data.forecastSchedule).length : 0
    if (isForecastLabel(data?.poForecast) && schedCount > 1) {
      return (
        <span className="text-xs text-blue-600 italic" title="Earliest delivery date. Click Forecast badge to see all.">
          {formatDate(value)} +{schedCount - 1} more
        </span>
      )
    }
    return <span className="text-gray-600">{value ? formatDate(value) : '—'}</span>
  }, [])

  const SalesMonthRenderer = useCallback(({ data, value }) => {
    const schedCount = data?.forecastSchedule ? Object.keys(data.forecastSchedule).length : 0
    if (isForecastLabel(data?.poForecast) && schedCount > 1)
      return <span className="text-xs text-blue-600 italic" title="Based on earliest delivery date.">{value} (earliest)</span>
    return <span className="text-gray-600">{value || '—'}</span>
  }, [])

  // ── Column definitions ────────────────────────────────────────────────────

  const columnDefs = useMemo(() => {
    const dateFilterParams = {
      comparator: (filterDate, cellValue) => {
        if (!cellValue) return -1
        const d = new Date(cellValue)
        if (isNaN(d)) return -1
        return d < filterDate ? -1 : d > filterDate ? 1 : 0
      },
    }

    const cols = [
      // S No — no filter, pinned left, not moveable
      {
        field: 'srNo', headerName: 'S No', width: 76, minWidth: 70,
        filter: false, sortable: false, pinned: 'left', suppressMovable: true,
        cellStyle: { textAlign: 'center', color: '#6b7280' },
      },
      { field: 'kasName',      headerName: 'KAS Name',            minWidth: 120, filter: 'agSetColumnFilter' },
      { field: 'customerName', headerName: 'Customer Name',       minWidth: 160, filter: 'agSetColumnFilter' },
      { field: 'siteLocation', headerName: 'Site Location',       minWidth: 140, filter: 'agTextColumnFilter' },
      { field: 'country',      headerName: 'Country',             minWidth: 110, filter: 'agSetColumnFilter' },
      { field: 'incoterm',     headerName: 'Incoterm',            minWidth: 110, filter: 'agSetColumnFilter' },
      { field: 'directSalesWh', headerName: 'Direct Sales / WH', minWidth: 150, filter: 'agSetColumnFilter' },
      {
        field: 'poForecast',   headerName: 'PO # / Forecast',     minWidth: 165, filter: 'agTextColumnFilter',
        cellRenderer: POCellRenderer,
      },
      { field: 'category',     headerName: 'Category',            minWidth: 120, filter: 'agSetColumnFilter' },
      { field: 'subCategory',  headerName: 'Sub Category',        minWidth: 130, filter: 'agSetColumnFilter' },
      { field: 'custPart',     headerName: 'Cust Part #',         minWidth: 150, filter: 'agTextColumnFilter', cellStyle: { fontFamily: 'monospace', fontSize: '12px' } },
      { field: 'mainiPart',    headerName: 'Maini Part #',        minWidth: 150, filter: 'agTextColumnFilter', cellStyle: { fontFamily: 'monospace', fontSize: '12px' } },
      { field: 'openQty',      headerName: 'Open Qty',            minWidth: 110, filter: 'agNumberColumnFilter', type: 'numericColumn' },
      { field: 'unitPrice',    headerName: 'Unit Price',          minWidth: 110, filter: 'agNumberColumnFilter', type: 'numericColumn' },
      { field: 'currency',     headerName: 'Currency',            minWidth: 100, filter: 'agSetColumnFilter', cellStyle: { textAlign: 'center' } },
      { field: 'unitPriceInr', headerName: 'Unit Price INR',      minWidth: 130, filter: 'agNumberColumnFilter', type: 'numericColumn',
        valueFormatter: p => p.value != null ? `₹${Number(p.value).toLocaleString('en-IN')}` : '₹0' },
      {
        field: 'totalInr',     headerName: 'Total in INR',        minWidth: 145, filter: 'agNumberColumnFilter', type: 'numericColumn',
        valueFormatter: p => p.value != null ? `₹${Number(p.value).toLocaleString('en-IN')}` : '₹0',
        cellStyle: { fontWeight: 600, color: '#047857' },
      },
      {
        field: 'docDate',  headerName: 'Doc Date',    minWidth: 130, filter: 'agDateColumnFilter', filterParams: dateFilterParams,
        valueFormatter: p => formatDate(p.value),
      },
      {
        field: 'shipDate', headerName: 'Ship Date',   minWidth: 165, filter: 'agDateColumnFilter', filterParams: dateFilterParams,
        cellRenderer: ShipDateRenderer,
      },
      {
        field: 'salesMonth', headerName: 'Sales Month', minWidth: 145, filter: 'agSetColumnFilter',
        cellRenderer: SalesMonthRenderer,
      },
    ]

    if (selectedReportId === 'all') {
      cols.unshift({
        field: 'reportLabel', headerName: 'Source File', minWidth: 190,
        filter: 'agSetColumnFilter', pinned: 'left',
      })
    }

    return cols
  }, [selectedReportId, POCellRenderer, ShipDateRenderer, SalesMonthRenderer])

  const defaultColDef = useMemo(() => ({
    sortable: true,
    resizable: true,
    // Menu icon (≡) always visible via suppressMenuHide on the grid.
    // Clicking ≡ opens the column menu: filter, sort, pin column.
    cellStyle: { color: '#374151', fontSize: '13px' },
  }), [])

  const getRowStyle = useCallback((params) => {
    if (isForecastLabel(params.data?.poForecast)) return { background: '#fffbeb' }
    return undefined
  }, [])

  // ── Export handlers ───────────────────────────────────────────────────────

  const handleExportExcel = useCallback(async () => {
    if (selectedReportId === 'all') {
      alert('Please select a single report from the sidebar to export as Excel.')
      return
    }
    setExporting(true)
    try {
      const report = reports.find(r => r.id === selectedReportId)
      // Pass the currently visible columns so the Excel export matches what's on screen
      const visibleColIds = gridRef.current?.api
        ?.getAllDisplayedColumns()
        ?.map(col => col.getColId()) ?? []
      const res = await exportZSO(selectedReportId, visibleColIds.length ? visibleColIds : null)
      const blob = new Blob([res.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${safeFilename(getReportFileLabel(report || { id: selectedReportId }, emailIndex))}_ZSO_${selectedReportId}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
      await loadReports()
    } catch (err) { alert('Export failed: ' + (err.response?.data?.detail || err.message)) }
    finally { setExporting(false) }
  }, [selectedReportId, reports, emailIndex, loadReports])

  const handleExportCSV = useCallback(() => {
    if (!gridRef.current) return
    const name = selectedReport
      ? `ZSO_Report_${selectedReport.id}_${new Date().toISOString().split('T')[0]}`
      : `ZSO_All_Reports_${new Date().toISOString().split('T')[0]}`

    // Collect only the columns currently visible in the grid
    // getAllDisplayedColumns() reflects what the Columns panel toggled
    const visibleColKeys = gridRef.current.api
      .getAllDisplayedColumns()
      ?.map(col => col.getColId()) ?? []

    gridRef.current.api.exportDataAsCsv({
      fileName: `${name}.csv`,
      // Passing columnKeys restricts export to only the visible columns
      columnKeys: visibleColKeys.length ? visibleColKeys : undefined,
    })
  }, [selectedReport])

  const openGenerateModal = async () => {
    setShowGenerate(true)
    setLoadingEmails(true)
    setSelectedEmailId(null)
    try {
      const res = await fetchEmails(0, 100, 'processed')
      setProcessedEmails(res.data?.emails || [])
    } catch (e) { console.error(e) }
    finally { setLoadingEmails(false) }
  }

  const handleGenerate = async () => {
    if (!selectedEmailId) return
    setGenerating(true)
    try {
      await generateZSO(selectedEmailId)
      setShowGenerate(false)
      await loadReports()
    } catch (err) { alert('Generation failed: ' + (err.response?.data?.detail || err.message)) }
    finally { setGenerating(false) }
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
      {/* Header — only Generate button here now */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">ZSO Reports</h1>
          <p className="text-sm text-gray-500 mt-1">Generated Zero Stock Out reports</p>
        </div>
        <button onClick={openGenerateModal} className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-md hover:bg-blue-700">
          <Plus size={16} /> Generate Report
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
        {/* Sidebar */}
        <aside className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="p-4 border-b border-gray-100 space-y-3">
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Search reports or files"
                value={reportSearch}
                onChange={e => setReportSearch(e.target.value)}
                className="pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 w-full"
              />
            </div>
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <Filter size={14} /><span>{filteredReports.length} reports shown</span>
            </div>
          </div>

          <div className="max-h-[650px] overflow-y-auto">
            <button
              onClick={() => setSelectedReportId('all')}
              className={`w-full text-left px-4 py-3 border-b border-gray-100 transition-colors ${selectedReportId === 'all' ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
            >
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-blue-50 text-blue-600"><ClipboardList size={17} /></span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-gray-900">All Reports</span>
                  <span className="mt-1 block text-xs text-gray-500">{reports.length} reports, {reportStats.lineItems} line items</span>
                  <span className="mt-2 block text-xs font-medium text-gray-700">{formatMoney(reportStats.totalInr)}</span>
                </span>
              </div>
            </button>

            {filteredReports.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <ClipboardList size={24} className="mx-auto text-gray-300 mb-2" />
                <p className="text-sm text-gray-500">No reports found</p>
              </div>
            ) : filteredReports.map(report => {
              const selected = selectedReportId === report.id
              const fileLabel = getReportFileLabel(report, emailIndex)
              const fileMeta = getReportFileMeta(report, emailIndex)
              return (
                <button
                  key={report.id}
                  onClick={() => setSelectedReportId(report.id)}
                  className={`w-full text-left px-4 py-3 border-b border-gray-100 transition-colors ${selected ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-emerald-50 text-emerald-600"><FileSpreadsheet size={17} /></span>
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate text-sm font-medium ${selected ? 'text-blue-900' : 'text-gray-900'}`}>{fileLabel}</span>
                      <span className="mt-1 block truncate text-xs text-gray-500">Report #{report.id} · {report.kas_name || 'Unassigned KAS'}</span>
                      {fileMeta && fileMeta !== fileLabel && <span className="mt-1 block truncate text-xs text-gray-400">{fileMeta}</span>}
                      <span className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-gray-500">
                        <span className="inline-flex items-center gap-1 rounded bg-gray-100 px-1.5 py-0.5"><Rows3 size={10} /> {getItems(report).length} rows</span>
                        <span className="inline-flex items-center rounded bg-gray-100 px-1.5 py-0.5">{getReportCustomers(report)} customers</span>
                        <span className="inline-flex items-center gap-1 rounded bg-gray-100 px-1.5 py-0.5"><CalendarDays size={10} /> {formatDate(report.created_at)}</span>
                      </span>
                      <span className="mt-2 flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-gray-700">{formatMoney(getReportTotal(report))}</span>
                        <StatusPill status={report.status} />
                      </span>
                    </span>
                  </div>
                </button>
              )
            })}
          </div>
        </aside>

        {/* Main panel */}
        <section className="min-w-0 space-y-3">
          {/* Summary bar */}
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <h2 className="truncate text-base font-semibold text-gray-900">
                  {selectedReport ? getReportFileLabel(selectedReport, emailIndex) : 'All ZSO Reports'}
                </h2>
                <p className="mt-1 text-sm text-gray-500">
                  {selectedReport
                    ? `Report #${selectedReport.id} · ${selectedReport.kas_name || 'Unassigned KAS'} · Created ${formatDateTime(selectedReport.created_at)}`
                    : `${reports.length} reports`}
                </p>
              </div>
              <div className="grid grid-cols-3 gap-6 text-right shrink-0">
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-gray-500">Reports</p>
                  <p className="text-sm font-semibold text-gray-900">{visibleReports.length}</p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-gray-500">Line Items</p>
                  <p className="text-sm font-semibold text-gray-900">{rowData.length}</p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-gray-500">Total INR</p>
                  <p className="text-sm font-semibold text-gray-900">{formatMoney(visibleReports.reduce((s, r) => s + getReportTotal(r), 0))}</p>
                </div>
              </div>
            </div>
            {selectedReport && Object.keys(getForexRatesUsed(selectedReport)).length > 0 && (
              <div className="mt-3 pt-3 border-t border-gray-100 flex flex-wrap gap-2 items-center">
                <span className="text-[11px] text-gray-400 uppercase tracking-wide">Forex rates used:</span>
                {Object.entries(getForexRatesUsed(selectedReport)).map(([cur, fx]) => (
                  <span key={cur} className="inline-flex items-center gap-1 rounded-full bg-blue-50 border border-blue-100 text-blue-700 text-xs px-2.5 py-0.5">
                    1 {cur} = {fx.rate} INR
                    {fx.effective_date && <span className="text-blue-400">· eff. {new Date(fx.effective_date).toLocaleDateString('en-IN')}</span>}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Forecast schedule preview */}
          {forecastPreview && (
            <SchedulePreview
              schedule={forecastPreview.schedule}
              partNo={forecastPreview.partNo}
              poLabel={forecastPreview.poLabel}
              onClose={() => setForecastPreview(null)}
            />
          )}

          {/* ── Toolbar: search | columns | export ── */}
          <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-3 py-2.5 shadow-sm">
            {/* Global search */}
            <div className="relative flex-1 max-w-xs">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Search all columns…"
                value={quickFilter}
                onChange={e => setQuickFilter(e.target.value)}
                className="pl-9 pr-3 py-1.5 text-sm border border-gray-200 rounded-md bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white w-full"
              />
            </div>

            {/* Spacer */}
            <div className="flex-1" />

            {/* Column visibility button */}
            <div className="relative" ref={colPanelRef}>
              <button
                onClick={() => { setShowColPanel(v => !v); setShowExportPanel(false) }}
                className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border rounded-lg transition-colors ${showColPanel ? 'bg-blue-50 border-blue-300 text-blue-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
              >
                <Columns size={15} />
                Columns
                <ChevronDown size={13} className={`transition-transform ${showColPanel ? 'rotate-180' : ''}`} />
              </button>
              {showColPanel && (
                <ColumnPanel
                  visibleFields={visibleFields}
                  onToggle={toggleColumn}
                  onClose={() => setShowColPanel(false)}
                />
              )}
            </div>

            {/* Export dropdown button */}
            <div className="relative" ref={exportPanelRef}>
              <button
                onClick={() => { setShowExportPanel(v => !v); setShowColPanel(false) }}
                disabled={exporting}
                className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border rounded-lg transition-colors ${showExportPanel ? 'bg-emerald-50 border-emerald-300 text-emerald-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'} disabled:opacity-50`}
              >
                {exporting ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
                Export
                <ChevronDown size={13} className={`transition-transform ${showExportPanel ? 'rotate-180' : ''}`} />
              </button>
              {showExportPanel && (
                <ExportDropdown
                  onCSV={handleExportCSV}
                  onExcel={handleExportExcel}
                  isAllReports={selectedReportId === 'all'}
                  onClose={() => setShowExportPanel(false)}
                />
              )}
            </div>
          </div>

          {/* AG Grid */}
          <div style={{ width: '100%', height: '62vh', minHeight: 400 }}>
            <AgGridReact
              ref={gridRef}
              theme={themeQuartz}
              rowData={rowData}
              columnDefs={columnDefs}
              defaultColDef={defaultColDef}
              getRowStyle={getRowStyle}
              quickFilterText={quickFilter}
              rowHeight={44}
              headerHeight={44}
              pagination={true}
              paginationPageSize={25}
              paginationPageSizeSelector={[25, 50, 100, 250]}
              enableCellTextSelection={true}
              suppressRowClickSelection={true}
              animateRows={true}
              suppressMenuHide={true}
            />
          </div>
        </section>
      </div>

      {/* Generate modal */}
      {showGenerate && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-semibold text-gray-900">Generate ZSO Report</h2>
              <button onClick={() => setShowGenerate(false)} className="p-1 rounded hover:bg-gray-100"><X size={18} /></button>
            </div>
            <p className="text-sm text-gray-500 mb-4">Select a processed upload or email to generate a ZSO report.</p>
            {loadingEmails ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 size={24} className="animate-spin text-blue-600" />
                <span className="ml-2 text-sm text-gray-500">Loading...</span>
              </div>
            ) : processedEmails.length === 0 ? (
              <div className="text-center py-8">
                <Mail size={32} className="mx-auto text-gray-300 mb-2" />
                <p className="text-sm text-gray-500">No processed emails found.</p>
              </div>
            ) : (
              <div className="max-h-72 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
                {processedEmails.map(email => (
                  <button
                    key={email.id}
                    onClick={() => setSelectedEmailId(email.id)}
                    className={`w-full text-left px-4 py-3 hover:bg-blue-50 transition-colors ${selectedEmailId === email.id ? 'bg-blue-50 border-l-4 border-l-blue-600' : ''}`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-900 truncate">{email.subject || '(No subject)'}</p>
                        <p className="text-xs text-gray-500 mt-0.5 truncate">{email.sender}</p>
                      </div>
                      <span className="ml-3 text-xs text-gray-400 shrink-0">{email.attachments?.length || 0} file{(email.attachments?.length || 0) !== 1 ? 's' : ''}</span>
                    </div>
                    <p className="text-xs text-gray-400 mt-1">{formatDateTime(email.received_at || email.created_at)}</p>
                  </button>
                ))}
              </div>
            )}
            <div className="flex justify-end gap-3 mt-6">
              <button onClick={() => setShowGenerate(false)} className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50">Cancel</button>
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
