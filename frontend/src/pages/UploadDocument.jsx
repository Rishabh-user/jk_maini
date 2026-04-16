import { useState, useEffect, useRef } from 'react'
import {
  Upload, FileSpreadsheet, FileText, Image, File, Trash2, RefreshCw,
  CheckCircle2, XCircle, Clock, Loader2, Eye, ChevronDown, ChevronUp,
  Sparkles, Search
} from 'lucide-react'
import { uploadDocument, fetchUploads, processUpload, deleteUpload, fetchAttachmentRawData } from '../services/api'

const FILE_ICONS = {
  pdf: FileText,
  excel: FileSpreadsheet,
  csv: FileSpreadsheet,
  image: Image,
  unknown: File,
}

const STATUS_CONFIG = {
  PROCESSED: { label: 'Processed', color: 'bg-green-100 text-green-700', icon: CheckCircle2 },
  UNPROCESSED: { label: 'Uploaded', color: 'bg-yellow-100 text-yellow-700', icon: Clock },
  PROCESSING: { label: 'Processing', color: 'bg-blue-100 text-blue-700', icon: Loader2 },
  FAILED: { label: 'Failed', color: 'bg-red-100 text-red-700', icon: XCircle },
}

export default function UploadDocument() {
  const [uploads, setUploads] = useState([])
  const [totalCount, setTotalCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [uploadResult, setUploadResult] = useState(null)
  const [expandedRow, setExpandedRow] = useState(null)
  const [rawData, setRawData] = useState({})
  const [loadingRaw, setLoadingRaw] = useState(null)
  const [search, setSearch] = useState('')
  const fileRef = useRef(null)
  const dropRef = useRef(null)

  useEffect(() => {
    loadUploads()
  }, [])

  const loadUploads = async () => {
    try {
      const res = await fetchUploads(0, 100)
      setUploads(res.data.uploads || [])
      setTotalCount(res.data.total || 0)
    } catch (err) {
      console.error('Failed to load uploads:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleUpload = async (files) => {
    if (!files || files.length === 0) return
    setUploading(true)
    setUploadResult(null)

    const results = []
    for (const file of files) {
      try {
        const res = await uploadDocument(file, true)
        results.push({ success: true, filename: file.name, data: res.data })
      } catch (err) {
        results.push({
          success: false,
          filename: file.name,
          error: err.response?.data?.detail || err.message,
        })
      }
    }

    setUploadResult(results)
    setUploading(false)
    if (fileRef.current) fileRef.current.value = ''
    loadUploads()
  }

  const handleProcess = async (uploadId) => {
    try {
      await processUpload(uploadId)
      loadUploads()
    } catch (err) {
      alert(err.response?.data?.detail || 'Processing failed')
    }
  }

  const handleDelete = async (uploadId) => {
    if (!window.confirm('Delete this upload?')) return
    try {
      await deleteUpload(uploadId)
      loadUploads()
    } catch (err) {
      alert(err.response?.data?.detail || 'Delete failed')
    }
  }

  const toggleRawData = async (upload) => {
    const id = upload.id
    if (expandedRow === id) {
      setExpandedRow(null)
      return
    }
    setExpandedRow(id)

    if (rawData[id]) return
    if (!upload.attachment_id) return

    setLoadingRaw(id)
    try {
      const res = await fetchAttachmentRawData(upload.attachment_id)
      const entries = res.data || []
      const allRows = []
      for (const entry of entries) {
        const rows = entry.extracted_data?.rows || []
        allRows.push(...rows)
      }
      setRawData((prev) => ({ ...prev, [id]: allRows }))
    } catch (err) {
      console.error('Failed to load raw data:', err)
      setRawData((prev) => ({ ...prev, [id]: [] }))
    } finally {
      setLoadingRaw(null)
    }
  }

  // Drag and drop handlers
  const handleDragOver = (e) => {
    e.preventDefault()
    e.stopPropagation()
    dropRef.current?.classList.add('border-blue-500', 'bg-blue-50')
  }

  const handleDragLeave = (e) => {
    e.preventDefault()
    e.stopPropagation()
    dropRef.current?.classList.remove('border-blue-500', 'bg-blue-50')
  }

  const handleDrop = (e) => {
    e.preventDefault()
    e.stopPropagation()
    dropRef.current?.classList.remove('border-blue-500', 'bg-blue-50')
    const files = e.dataTransfer?.files
    if (files?.length) handleUpload(Array.from(files))
  }

  const formatSize = (bytes) => {
    if (!bytes) return '—'
    if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${bytes} B`
  }

  const filteredUploads = uploads.filter((u) =>
    (u.filename || '').toLowerCase().includes(search.toLowerCase()) ||
    (u.uploaded_by || '').toLowerCase().includes(search.toLowerCase())
  )

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
        <h1 className="text-2xl font-bold text-gray-900">Upload Document</h1>
        <p className="text-sm text-gray-500 mt-1">
          Manually upload PDF, Excel, CSV, or Image files — AI extracts and maps columns automatically
        </p>
      </div>

      {/* Upload Zone */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <div
          ref={dropRef}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => !uploading && fileRef.current?.click()}
          className="border-2 border-dashed border-gray-300 rounded-xl p-10 text-center cursor-pointer hover:border-blue-400 transition-all"
        >
          {uploading ? (
            <>
              <Loader2 size={40} className="mx-auto text-blue-500 mb-3 animate-spin" />
              <p className="text-sm font-medium text-blue-700">Uploading & Processing...</p>
              <p className="text-xs text-gray-500 mt-1">AI is extracting data and mapping columns</p>
            </>
          ) : (
            <>
              <Upload size={40} className="mx-auto text-gray-400 mb-3" />
              <p className="text-sm font-semibold text-gray-700">
                Drop files here or click to upload
              </p>
              <p className="text-xs text-gray-500 mt-2">
                Supports: <span className="font-medium">.pdf</span>, <span className="font-medium">.xlsx</span>, <span className="font-medium">.xls</span>, <span className="font-medium">.csv</span>, <span className="font-medium">.png</span>, <span className="font-medium">.jpg</span>, <span className="font-medium">.tiff</span>
              </p>
              <p className="text-xs text-gray-400 mt-1">Files are auto-processed with AI column mapping</p>
            </>
          )}
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.xlsx,.xls,.csv,.png,.jpg,.jpeg,.tiff,.bmp"
            multiple
            onChange={(e) => handleUpload(Array.from(e.target.files || []))}
            className="hidden"
          />
        </div>

        {/* Upload Results */}
        {uploadResult && (
          <div className="mt-4 space-y-2">
            {uploadResult.map((r, i) => (
              <div
                key={i}
                className={`flex items-center gap-3 p-3 rounded-lg text-sm ${
                  r.success
                    ? 'bg-green-50 border border-green-200 text-green-700'
                    : 'bg-red-50 border border-red-200 text-red-700'
                }`}
              >
                {r.success ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
                <div className="flex-1">
                  <span className="font-medium">{r.filename}</span>
                  {r.success && r.data && (
                    <span className="ml-2 text-xs text-green-600">
                      {r.data.rows_extracted ? `${r.data.rows_extracted} rows extracted` : 'Uploaded'}
                      {r.data.columns?.length ? ` | ${r.data.columns.length} columns` : ''}
                    </span>
                  )}
                  {!r.success && <span className="ml-2 text-xs">{r.error}</span>}
                </div>
                {r.success && r.data?.column_mapping && Object.keys(r.data.column_mapping).length > 0 && (
                  <span className="flex items-center gap-1 text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
                    <Sparkles size={10} /> AI Mapped
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs font-medium text-gray-500">Total Uploads</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{totalCount}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs font-medium text-gray-500">Processed</p>
          <p className="text-2xl font-bold text-green-600 mt-1">
            {uploads.filter((u) => u.status === 'PROCESSED').length}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs font-medium text-gray-500">Pending</p>
          <p className="text-2xl font-bold text-yellow-600 mt-1">
            {uploads.filter((u) => u.status === 'UNPROCESSED').length}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs font-medium text-gray-500">Failed</p>
          <p className="text-2xl font-bold text-red-600 mt-1">
            {uploads.filter((u) => u.status === 'FAILED').length}
          </p>
        </div>
      </div>

      {/* Uploads List */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="flex items-center justify-between p-4 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">Uploaded Documents</h2>
          <div className="flex items-center gap-3">
            <div className="relative w-56">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Search files..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg w-full focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <button
              onClick={loadUploads}
              className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
            >
              <RefreshCw size={12} /> Refresh
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                {['File', 'Type', 'Size', 'Rows', 'Status', 'Uploaded', 'Actions'].map((h) => (
                  <th key={h} className="text-left text-xs font-semibold text-gray-500 uppercase px-4 py-3 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredUploads.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center">
                    <Upload size={36} className="mx-auto text-gray-300 mb-3" />
                    <p className="text-sm text-gray-500">No documents uploaded yet</p>
                    <p className="text-xs text-gray-400 mt-1">Upload files above to get started</p>
                  </td>
                </tr>
              ) : (
                filteredUploads.map((upload) => {
                  const FileIcon = FILE_ICONS[upload.source_type] || File
                  const statusCfg = STATUS_CONFIG[upload.status] || STATUS_CONFIG.UNPROCESSED
                  const StatusIcon = statusCfg.icon
                  const isExpanded = expandedRow === upload.id

                  return (
                    <Fragment key={upload.id}>
                      <tr className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <FileIcon size={16} className="text-blue-600 flex-shrink-0" />
                            <span className="text-sm font-medium text-gray-900 truncate max-w-[200px]" title={upload.filename}>
                              {upload.filename}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full capitalize">
                            {upload.source_type}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600">{formatSize(upload.file_size)}</td>
                        <td className="px-4 py-3 text-sm text-gray-600 font-medium">
                          {upload.rows_extracted || '—'}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full ${statusCfg.color}`}>
                            <StatusIcon size={12} className={upload.status === 'PROCESSING' ? 'animate-spin' : ''} />
                            {statusCfg.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-500">
                          {upload.created_at ? new Date(upload.created_at).toLocaleString() : '—'}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1">
                            {upload.status === 'PROCESSED' && upload.attachment_id && (
                              <button
                                onClick={() => toggleRawData(upload)}
                                className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-blue-600 border border-blue-200 rounded hover:bg-blue-50"
                                title="View extracted data"
                              >
                                {isExpanded ? <ChevronUp size={12} /> : <Eye size={12} />}
                                {isExpanded ? 'Hide' : 'View'}
                              </button>
                            )}
                            {(upload.status === 'UNPROCESSED' || upload.status === 'FAILED') && (
                              <button
                                onClick={() => handleProcess(upload.id)}
                                className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-green-600 border border-green-200 rounded hover:bg-green-50"
                                title="Process this file"
                              >
                                <Sparkles size={12} /> Process
                              </button>
                            )}
                            <button
                              onClick={() => handleDelete(upload.id)}
                              className="p-1 text-red-400 hover:text-red-600 hover:bg-red-50 rounded"
                              title="Delete"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>

                      {/* Expanded Raw Data Viewer */}
                      {isExpanded && (
                        <tr>
                          <td colSpan={7} className="p-0">
                            <RawDataPreview
                              uploadId={upload.id}
                              data={rawData[upload.id]}
                              loading={loadingRaw === upload.id}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// Need Fragment import
import { Fragment } from 'react'

function RawDataPreview({ uploadId, data, loading }) {
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 10

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 bg-gray-50 border-t border-gray-100">
        <Loader2 size={24} className="text-blue-500 animate-spin mr-2" />
        <span className="text-sm text-gray-500">Loading extracted data...</span>
      </div>
    )
  }

  if (!data || data.length === 0) {
    return (
      <div className="py-6 text-center text-sm text-gray-500 bg-gray-50 border-t border-gray-100">
        No extracted data available.
      </div>
    )
  }

  const columns = Object.keys(data[0])
  const totalPages = Math.ceil(data.length / PAGE_SIZE)
  const paginated = data.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  return (
    <div className="bg-blue-50/30 border-t border-blue-100">
      <div className="flex items-center justify-between px-4 py-2 border-b border-blue-100">
        <div className="flex items-center gap-2">
          <Sparkles size={14} className="text-blue-500" />
          <span className="text-xs font-semibold text-blue-700">
            AI-Extracted Data — {data.length} rows, {columns.length} columns
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <button
            onClick={() => setPage(Math.max(1, page - 1))}
            disabled={page === 1}
            className="px-2 py-0.5 border border-gray-200 rounded hover:bg-white disabled:opacity-30"
          >
            Prev
          </button>
          <span>Page {page}/{totalPages}</span>
          <button
            onClick={() => setPage(Math.min(totalPages, page + 1))}
            disabled={page >= totalPages}
            className="px-2 py-0.5 border border-gray-200 rounded hover:bg-white disabled:opacity-30"
          >
            Next
          </button>
        </div>
      </div>
      <div className="overflow-x-auto max-h-80">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-blue-50">
              {columns.map((col) => (
                <th key={col} className="text-left font-semibold text-blue-700 px-3 py-2 whitespace-nowrap border-b border-blue-100">
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paginated.map((row, i) => (
              <tr key={i} className="border-b border-blue-50 hover:bg-white/60">
                {columns.map((col) => (
                  <td key={col} className="px-3 py-1.5 text-gray-700 whitespace-nowrap max-w-[180px] truncate" title={String(row[col] || '')}>
                    {String(row[col] || '—')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
