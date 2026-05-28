import { useEffect, useMemo, useState } from 'react'
import {
  Search, Sparkles, ChevronLeft, ChevronRight, FileSpreadsheet, Upload, Mail,
  FileText, Image, File, Database, Filter
} from 'lucide-react'
import { fetchEmails, fetchAttachmentRawData } from '../services/api'

const PAGE_SIZE = 15

const SOURCE_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'manual', label: 'Manual' },
  { key: 'email', label: 'Email' },
]

const getFileMeta = (filename = '') => {
  const ext = filename.includes('.') ? filename.split('.').pop().toLowerCase() : ''
  if (ext === 'pdf') return { ext, label: 'PDF', Icon: FileText, color: 'text-red-600 bg-red-50' }
  if (['xlsx', 'xls', 'csv'].includes(ext)) return { ext, label: ext.toUpperCase(), Icon: FileSpreadsheet, color: 'text-emerald-600 bg-emerald-50' }
  if (['png', 'jpg', 'jpeg', 'tiff', 'bmp'].includes(ext)) return { ext, label: 'Image', Icon: Image, color: 'text-sky-600 bg-sky-50' }
  return { ext: ext || 'file', label: ext ? ext.toUpperCase() : 'File', Icon: File, color: 'text-gray-600 bg-gray-100' }
}

const formatDate = (value) => {
  if (!value) return 'No date'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'No date'
  return date.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })
}

const formatSize = (bytes) => {
  if (!bytes) return ''
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} B`
}

export default function RawDataViewer() {
  const [attachments, setAttachments] = useState([])
  const [selectedAtt, setSelectedAtt] = useState(null)
  const [rawEntries, setRawEntries] = useState([])
  const [rowCounts, setRowCounts] = useState({})
  const [fileSearch, setFileSearch] = useState('')
  const [tableSearch, setTableSearch] = useState('')
  const [sourceFilter, setSourceFilter] = useState('all')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [loadingData, setLoadingData] = useState(false)

  useEffect(() => {
    async function load() {
      try {
        const emailsRes = await fetchEmails(0, 200)
        const emails = emailsRes.data.emails || []
        const atts = []

        for (const email of emails) {
          const status = (email.status || '').toLowerCase()
          if (status !== 'processed') continue

          const isManual = (email.gmail_message_id || '').startsWith('manual-upload-')
          for (const att of email.attachments || []) {
            atts.push({
              id: att.id,
              filename: att.filename,
              fileSize: att.file_size,
              createdAt: att.created_at || email.received_at || email.created_at,
              contentType: att.content_type,
              emailSubject: email.subject || '(No subject)',
              sender: email.sender || '',
              isManual,
            })
          }
        }

        setAttachments(atts)
        setSelectedAtt(atts[0] || null)
      } catch (err) {
        console.error('Failed to load attachments:', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  useEffect(() => {
    if (!selectedAtt) {
      setRawEntries([])
      return
    }

    setLoadingData(true)
    setPage(1)
    fetchAttachmentRawData(selectedAtt.id)
      .then((res) => {
        const entries = res.data || []
        const allRows = []
        for (const entry of entries) {
          const extracted = entry.extracted_data || {}
          for (const row of extracted.rows || []) {
            allRows.push({ ...row, _source: entry.source_type || 'unknown' })
          }
        }
        setRawEntries(allRows)
        setRowCounts((prev) => ({ ...prev, [selectedAtt.id]: allRows.length }))
      })
      .catch((err) => {
        console.error('Failed to load raw data:', err)
        setRawEntries([])
        setRowCounts((prev) => ({ ...prev, [selectedAtt.id]: 0 }))
      })
      .finally(() => setLoadingData(false))
  }, [selectedAtt])

  useEffect(() => {
    setPage(1)
  }, [tableSearch, selectedAtt?.id])

  const sourceCounts = useMemo(() => ({
    all: attachments.length,
    manual: attachments.filter((att) => att.isManual).length,
    email: attachments.filter((att) => !att.isManual).length,
  }), [attachments])

  const filteredAttachments = useMemo(() => {
    const query = fileSearch.trim().toLowerCase()
    return attachments.filter((att) => {
      const sourceMatch =
        sourceFilter === 'all' ||
        (sourceFilter === 'manual' && att.isManual) ||
        (sourceFilter === 'email' && !att.isManual)
      if (!sourceMatch) return false
      if (!query) return true
      return (
        (att.filename || '').toLowerCase().includes(query) ||
        (att.emailSubject || '').toLowerCase().includes(query) ||
        (att.sender || '').toLowerCase().includes(query)
      )
    })
  }, [attachments, fileSearch, sourceFilter])

  useEffect(() => {
    if (!filteredAttachments.length) {
      if (selectedAtt) setSelectedAtt(null)
      return
    }
    if (!selectedAtt || !filteredAttachments.some((att) => att.id === selectedAtt.id)) {
      setSelectedAtt(filteredAttachments[0])
    }
  }, [filteredAttachments, selectedAtt])

  const columns = rawEntries.length > 0
    ? Array.from(
      rawEntries.reduce((set, row) => {
        Object.keys(row || {}).forEach((key) => {
          if (key !== '_source') set.add(key)
        })
        return set
      }, new Set())
    )
    : []

  const filteredRows = rawEntries.filter((row) => {
    if (!tableSearch.trim()) return true
    const query = tableSearch.toLowerCase()
    return columns.some((col) => String(row[col] || '').toLowerCase().includes(query))
  })

  const totalPages = Math.ceil(filteredRows.length / PAGE_SIZE) || 1
  const paginated = filteredRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const selectedMeta = selectedAtt ? getFileMeta(selectedAtt.filename) : null

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
          <h1 className="text-2xl font-bold text-gray-900">Raw Data Viewer</h1>
          <p className="text-sm text-gray-500 mt-1">
            Extracted data from processed files
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="px-3 py-2 bg-white border border-gray-200 rounded-lg">
            <p className="text-[11px] uppercase tracking-wider text-gray-500">Files</p>
            <p className="text-sm font-semibold text-gray-900">{attachments.length}</p>
          </div>
          <div className="px-3 py-2 bg-white border border-gray-200 rounded-lg">
            <p className="text-[11px] uppercase tracking-wider text-gray-500">Rows</p>
            <p className="text-sm font-semibold text-gray-900">{rawEntries.length}</p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="p-4 border-b border-gray-100 space-y-3">
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Search files"
                value={fileSearch}
                onChange={(e) => setFileSearch(e.target.value)}
                className="pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 w-full"
              />
            </div>
            <div className="flex items-center gap-2">
              <Filter size={14} className="text-gray-400" />
              <div className="flex gap-1">
                {SOURCE_FILTERS.map((filter) => (
                  <button
                    key={filter.key}
                    onClick={() => setSourceFilter(filter.key)}
                    className={`px-2.5 py-1.5 text-xs rounded-md border transition-colors ${
                      sourceFilter === filter.key
                        ? 'bg-blue-600 border-blue-600 text-white'
                        : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    {filter.label} {sourceCounts[filter.key]}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="max-h-[640px] overflow-y-auto">
            {filteredAttachments.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <Database size={24} className="mx-auto text-gray-300 mb-2" />
                <p className="text-sm text-gray-500">No files found</p>
              </div>
            ) : (
              filteredAttachments.map((att) => {
                const meta = getFileMeta(att.filename)
                const Icon = meta.Icon
                const selected = selectedAtt?.id === att.id
                return (
                  <button
                    key={att.id}
                    onClick={() => setSelectedAtt(att)}
                    className={`w-full text-left px-4 py-3 border-b border-gray-100 transition-colors ${
                      selected ? 'bg-blue-50' : 'hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-start gap-3 min-w-0">
                      <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${meta.color}`}>
                        <Icon size={17} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={`block truncate text-sm font-medium ${selected ? 'text-blue-900' : 'text-gray-900'}`}>
                          {att.filename}
                        </span>
                        <span className="mt-1 block truncate text-xs text-gray-500">
                          {att.emailSubject}
                        </span>
                        <span className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-gray-500">
                          <span className="inline-flex items-center gap-1 rounded bg-gray-100 px-1.5 py-0.5">
                            {att.isManual ? <Upload size={10} /> : <Mail size={10} />}
                            {att.isManual ? 'Manual' : 'Email'}
                          </span>
                          <span>{formatDate(att.createdAt)}</span>
                          {formatSize(att.fileSize) && <span>{formatSize(att.fileSize)}</span>}
                        </span>
                      </span>
                      <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-gray-600">
                        {rowCounts[att.id] !== undefined ? `${rowCounts[att.id]}` : meta.label}
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
            {selectedAtt ? (
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex min-w-0 items-start gap-3">
                  <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md ${selectedMeta.color}`}>
                    <selectedMeta.Icon size={18} />
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="truncate text-base font-semibold text-gray-900">{selectedAtt.filename}</h2>
                      <span className="inline-flex items-center gap-1 rounded bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                        <Sparkles size={12} />
                        Processed
                      </span>
                    </div>
                    <p className="mt-1 truncate text-sm text-gray-500">{selectedAtt.emailSubject}</p>
                    {selectedAtt.sender && (
                      <p className="mt-1 truncate text-xs text-gray-400">{selectedAtt.sender}</p>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 text-right">
                  <div>
                    <p className="text-[11px] uppercase tracking-wider text-gray-500">Rows</p>
                    <p className="text-sm font-semibold text-gray-900">{rawEntries.length}</p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-wider text-gray-500">Columns</p>
                    <p className="text-sm font-semibold text-gray-900">{columns.length}</p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-wider text-gray-500">Type</p>
                    <p className="text-sm font-semibold text-gray-900">{selectedMeta.label}</p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="py-8 text-center">
                <Database size={28} className="mx-auto text-gray-300 mb-2" />
                <p className="text-sm text-gray-500">Select a file to view extracted rows</p>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="relative w-full sm:w-72">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Search rows"
                value={tableSearch}
                onChange={(e) => setTableSearch(e.target.value)}
                className="pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 w-full"
              />
            </div>
            <p className="text-sm text-gray-500">
              {filteredRows.length} of {rawEntries.length} rows
            </p>
          </div>

          {loadingData ? (
            <div className="flex items-center justify-center h-40 bg-white border border-gray-200 rounded-lg">
              <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full min-w-max">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50">
                      {columns.map((col) => (
                        <th key={col} className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3 whitespace-nowrap">
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {paginated.length === 0 ? (
                      <tr>
                        <td colSpan={columns.length || 1} className="px-6 py-10 text-center text-sm text-gray-500">
                          {attachments.length === 0
                            ? 'No processed data available.'
                            : 'No rows for the current selection.'}
                        </td>
                      </tr>
                    ) : (
                      paginated.map((row, i) => (
                        <tr key={i} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                          {columns.map((col) => (
                            <td key={col} className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap max-w-[220px] truncate" title={String(row[col] || '')}>
                              {String(row[col] || '-')}
                            </td>
                          ))}
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
          )}
        </section>
      </div>
    </div>
  )
}
