import { useState, useEffect } from 'react'
import { Search, Sparkles, ChevronLeft, ChevronRight, FileSpreadsheet } from 'lucide-react'
import StatusBadge from '../components/StatusBadge'
import { fetchEmails, fetchAttachmentRawData } from '../services/api'

const PAGE_SIZE = 15

export default function RawDataViewer() {
  const [attachments, setAttachments] = useState([])
  const [selectedAtt, setSelectedAtt] = useState(null)
  const [rawEntries, setRawEntries] = useState([])
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [loadingData, setLoadingData] = useState(false)

  // Step 1: Load all emails and collect attachments
  useEffect(() => {
    async function load() {
      try {
        const emailsRes = await fetchEmails(0, 100)
        const emails = emailsRes.data.emails || []
        const atts = []
        for (const email of emails) {
          for (const att of email.attachments || []) {
            atts.push({
              id: att.id,
              filename: att.filename,
              emailSubject: email.subject || '(No subject)',
              emailStatus: email.status,
            })
          }
        }
        setAttachments(atts)
        // Auto-select first attachment
        if (atts.length > 0) {
          setSelectedAtt(atts[0])
        }
      } catch (err) {
        console.error('Failed to load attachments:', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  // Step 2: When attachment is selected, fetch its raw data
  useEffect(() => {
    if (!selectedAtt) return
    setLoadingData(true)
    setPage(1)
    fetchAttachmentRawData(selectedAtt.id)
      .then((res) => {
        const entries = res.data || []
        // Use extracted_data.rows (all original columns) instead of mapped_data
        const allRows = []
        for (const entry of entries) {
          const rows = entry.extracted_data?.rows || []
          for (const row of rows) {
            allRows.push({ ...row, _source: entry.source_type || 'unknown' })
          }
        }
        setRawEntries(allRows)
      })
      .catch((err) => {
        console.error('Failed to load raw data:', err)
        setRawEntries([])
      })
      .finally(() => setLoadingData(false))
  }, [selectedAtt])

  // Get dynamic columns from the data
  const columns = rawEntries.length > 0
    ? Object.keys(rawEntries[0]).filter((k) => k !== '_source')
    : []

  // Filter
  const filtered = rawEntries.filter((row) =>
    columns.some((col) =>
      String(row[col] || '').toLowerCase().includes(search.toLowerCase())
    )
  )

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE) || 1
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

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
        <h1 className="text-2xl font-bold text-gray-900">Raw Data Viewer</h1>
        <p className="text-sm text-gray-500 mt-1">
          AI-extracted data from email attachments ({attachments.length} attachments, {rawEntries.length} rows)
        </p>
      </div>

      {/* Attachment selector */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        {attachments.map((att) => (
          <button
            key={att.id}
            onClick={() => setSelectedAtt(att)}
            className={`flex items-center gap-2 px-3 py-2 text-sm rounded-lg border transition-colors ${
              selectedAtt?.id === att.id
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
            }`}
          >
            <FileSpreadsheet size={14} />
            {att.filename}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="flex items-center justify-between mb-4 gap-4 flex-wrap">
        <div className="relative w-64">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1) }}
            className="pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 w-full"
          />
        </div>
        {selectedAtt && (
          <div className="text-sm text-gray-500">
            <Sparkles size={14} className="inline text-blue-500 mr-1" />
            Source: <span className="font-medium text-gray-700">{selectedAtt.emailSubject}</span>
          </div>
        )}
      </div>

      {/* Data table */}
      {loadingData ? (
        <div className="flex items-center justify-center h-32">
          <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100">
                {columns.map((col) => (
                  <th key={col} className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3 whitespace-nowrap">
                    {col} <span className="text-gray-400">&#8597;</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {paginated.length === 0 ? (
                <tr>
                  <td colSpan={columns.length || 1} className="px-6 py-8 text-center text-sm text-gray-500">
                    {attachments.length === 0
                      ? 'No attachments found. Process emails first to extract data.'
                      : 'No data for this attachment. Click "Process" on the email first.'}
                  </td>
                </tr>
              ) : (
                paginated.map((row, i) => (
                  <tr key={i} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                    {columns.map((col) => (
                      <td key={col} className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap max-w-[200px] truncate" title={String(row[col] || '')}>
                        {String(row[col] || '-')}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>

          {filtered.length > 0 && (
            <div className="flex items-center justify-between px-6 py-3 border-t border-gray-100">
              <span className="text-sm text-gray-500">
                Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} of{' '}
                {filtered.length}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage(Math.max(1, page - 1))}
                  disabled={page === 1}
                  className="p-1 rounded hover:bg-gray-100 disabled:opacity-30"
                >
                  <ChevronLeft size={18} />
                </button>
                <span className="text-sm text-gray-600">
                  Page {page} of {totalPages}
                </span>
                <button
                  onClick={() => setPage(Math.min(totalPages, page + 1))}
                  disabled={page >= totalPages}
                  className="p-1 rounded hover:bg-gray-100 disabled:opacity-30"
                >
                  <ChevronRight size={18} />
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
