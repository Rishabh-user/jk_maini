import { useState, useEffect, useCallback } from 'react'
import { Search, Paperclip, RefreshCw, Play, Trash2, Mail, CheckCircle2, Clock, FileText } from 'lucide-react'
import StatusBadge from '../components/StatusBadge'
import { fetchEmails, fetchGmailEmails, processEmail, deleteEmail } from '../services/api'
import { useDialog } from '../components/DialogProvider'
import { formatError } from '../utils/formatError'

const STATUS_FILTERS = [
  { key: 'all',         label: 'All',         icon: Mail,          color: 'blue'  },
  { key: 'unprocessed', label: 'Unprocessed',  icon: Clock,         color: 'yellow'},
  { key: 'processed',   label: 'Processed',    icon: CheckCircle2,  color: 'green' },
]

// The backend always synthesizes exactly one row named "email_body.html"
// (or "email_body.txt") per email so the body can be scanned for line
// items alongside real attachments — see
// app/services/email_processor.py::_ensure_body_attachment. It is NOT
// something the sender attached, so it shouldn't be lumped into the
// "attachments" count the way it silently was before (an email with 7
// real files showed "8" in the inbox table, which read as a bug).
const BODY_FILENAMES = new Set(['email_body.html', 'email_body.txt'])
const isBodyAttachment = (a) => BODY_FILENAMES.has(a?.filename)

function splitAttachments(attachments) {
  const list = attachments || []
  const real = list.filter((a) => !isBodyAttachment(a))
  const hasBody = list.some(isBodyAttachment)
  return { realCount: real.length, hasBody }
}

export default function EmailInbox() {
  const dialog = useDialog()
  const [emails, setEmails]       = useState([])
  const [counts, setCounts]       = useState({ all: 0, processed: 0, unprocessed: 0 })
  const [search, setSearch]       = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [loading, setLoading]     = useState(true)
  const [fetching, setFetching]   = useState(false)
  const [processing, setProcessing] = useState(null)
  const [deleting, setDeleting]   = useState(null)

  const loadEmails = useCallback(async () => {
    try {
      // Load all three counts in parallel
      const [allRes, procRes, unprocRes] = await Promise.all([
        fetchEmails(0, 500),
        fetchEmails(0, 500, 'processed'),
        fetchEmails(0, 500, 'unprocessed'),
      ])
      setEmails(allRes.data.emails || [])
      setCounts({
        all:         allRes.data.total  || 0,
        processed:   procRes.data.total || 0,
        unprocessed: unprocRes.data.total || 0,
      })
    } catch (err) {
      console.error('Failed to load emails:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadEmails() }, [loadEmails])

  const handleFetchGmail = async () => {
    setFetching(true)
    try {
      const res = await fetchGmailEmails(20)
      await dialog.alert(`Fetched ${res.data.fetched} emails, saved ${res.data.saved} new.`, { title: 'Gmail fetch complete' })
      await loadEmails()
    } catch (err) {
      await dialog.alert('Gmail fetch failed', { tone: 'danger', detail: formatError(err) })
    } finally {
      setFetching(false)
    }
  }

  const handleProcess = async (emailId) => {
    setProcessing(emailId)
    try {
      const res = await processEmail(emailId)
      await dialog.alert(res.data.message, { title: 'Processing complete' })
      await loadEmails()
    } catch (err) {
      await dialog.alert('Processing failed', { tone: 'danger', detail: formatError(err) })
    } finally {
      setProcessing(null)
    }
  }

  const handleDelete = async (emailId) => {
    if (!(await dialog.confirm('Are you sure you want to delete this email?', { title: 'Delete email' }))) return
    setDeleting(emailId)
    try {
      await deleteEmail(emailId)
      await loadEmails()
    } catch (err) {
      await dialog.alert('Delete failed', { tone: 'danger', detail: formatError(err) })
    } finally {
      setDeleting(null)
    }
  }

  // Apply status filter + search client-side
  const filtered = emails.filter((e) => {
    const matchStatus =
      statusFilter === 'all' ||
      (statusFilter === 'processed'   && e.status === 'processed') ||
      (statusFilter === 'unprocessed' && e.status !== 'processed' && e.status !== 'failed')
    const q = search.toLowerCase()
    const matchSearch =
      !q ||
      (e.subject || '').toLowerCase().includes(q) ||
      (e.sender  || '').toLowerCase().includes(q)
    return matchStatus && matchSearch
  })

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Email Inbox</h1>
          <p className="text-sm text-gray-500 mt-1">
            Incoming purchase orders and communications
          </p>
        </div>
        <button
          onClick={handleFetchGmail}
          disabled={fetching}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          <RefreshCw size={16} className={fetching ? 'animate-spin' : ''} />
          Fetch from Gmail
        </button>
      </div>

      {/* Status filter cards */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        {STATUS_FILTERS.map(({ key, label, icon: Icon, color }) => {
          const count = counts[key]
          const active = statusFilter === key
          return (
            <button
              key={key}
              onClick={() => setStatusFilter(key)}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-all ${
                active
                  ? `bg-${color}-50 border-${color}-300 ring-2 ring-${color}-200`
                  : 'bg-white border-gray-200 hover:border-gray-300 hover:bg-gray-50'
              }`}
            >
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${
                active ? `bg-${color}-100` : 'bg-gray-100'
              }`}>
                <Icon size={18} className={active ? `text-${color}-600` : 'text-gray-500'} />
              </div>
              <div>
                <p className={`text-xl font-bold ${active ? `text-${color}-700` : 'text-gray-900'}`}>{count}</p>
                <p className="text-xs text-gray-500">{label}</p>
              </div>
            </button>
          )
        })}
      </div>

      {/* Search */}
      <div className="mb-4">
        <div className="relative w-72">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search subject or sender…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 w-full"
          />
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-100">
              {['#', 'Subject', 'Sender', 'Date', 'Attachments', 'Status', 'Action'].map((h) => (
                <th key={h} className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-6 py-3 whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-6 py-8 text-center text-sm text-gray-500">
                  {search || statusFilter !== 'all'
                    ? 'No emails match your filter.'
                    : 'No emails found. Click "Fetch from Gmail" to import emails.'}
                </td>
              </tr>
            ) : (
              filtered.map((email, idx) => (
                <tr key={email.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-4 text-xs text-gray-400 font-medium w-10">{idx + 1}</td>
                  <td className="px-6 py-4 text-sm font-medium text-gray-900 max-w-xs truncate" title={email.subject}>
                    {email.subject || '(No subject)'}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600 max-w-xs truncate" title={email.sender}>
                    {email.sender || 'Unknown'}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500 whitespace-nowrap">
                    {email.received_at ? new Date(email.received_at).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' }) : '—'}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600">
                    {(() => {
                      const { realCount, hasBody } = splitAttachments(email.attachments)
                      if (realCount === 0 && !hasBody) {
                        return <span className="text-gray-400">—</span>
                      }
                      return (
                        <span className="flex items-center gap-2.5" title={
                          hasBody
                            ? `${realCount} real attachment${realCount === 1 ? '' : 's'} + the email body (auto-scanned for line items)`
                            : `${realCount} real attachment${realCount === 1 ? '' : 's'}`
                        }>
                          {realCount > 0 && (
                            <span className="flex items-center gap-1">
                              <Paperclip size={14} className="text-gray-400" />
                              {realCount}
                            </span>
                          )}
                          {hasBody && (
                            <span className="flex items-center gap-1 text-gray-400">
                              <FileText size={13} />
                              <span className="text-[11px]">body</span>
                            </span>
                          )}
                        </span>
                      )
                    })()}
                  </td>
                  <td className="px-6 py-4">
                    <StatusBadge status={
                      email.status === 'processed' ? 'Processed' :
                      email.status === 'failed'    ? 'Failed'    : 'Pending'
                    } />
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      {email.status !== 'processed' && (
                        <button
                          onClick={() => handleProcess(email.id)}
                          disabled={processing === email.id}
                          className="flex items-center gap-1 px-3 py-1 text-xs font-medium bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50"
                        >
                          <Play size={12} className={processing === email.id ? 'animate-spin' : ''} />
                          {processing === email.id ? 'Processing…' : 'Process'}
                        </button>
                      )}
                      <button
                        onClick={() => handleDelete(email.id)}
                        disabled={deleting === email.id}
                        className="p-1.5 rounded hover:bg-red-50 text-red-500 disabled:opacity-50"
                        title="Delete email"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        {filtered.length > 0 && (
          <div className="px-6 py-3 border-t border-gray-100 text-xs text-gray-400">
            Showing {filtered.length} of {counts[statusFilter] || counts.all} emails
          </div>
        )}
      </div>
    </div>
  )
}
