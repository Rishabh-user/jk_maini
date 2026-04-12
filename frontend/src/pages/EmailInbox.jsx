import { useState, useEffect, useCallback } from 'react'
import { Search, Paperclip, RefreshCw, Play, Trash2 } from 'lucide-react'
import StatusBadge from '../components/StatusBadge'
import { fetchEmails, fetchGmailEmails, processEmail, deleteEmail } from '../services/api'

export default function EmailInbox() {
  const [emails, setEmails] = useState([])
  const [total, setTotal] = useState(0)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [fetching, setFetching] = useState(false)
  const [processing, setProcessing] = useState(null)
  const [deleting, setDeleting] = useState(null)

  const loadEmails = useCallback(async () => {
    try {
      const res = await fetchEmails(0, 50)
      setEmails(res.data.emails || [])
      setTotal(res.data.total || 0)
    } catch (err) {
      console.error('Failed to load emails:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadEmails()
  }, [loadEmails])

  const handleFetchGmail = async () => {
    setFetching(true)
    try {
      const res = await fetchGmailEmails(20)
      alert(`Fetched ${res.data.fetched} emails, saved ${res.data.saved} new.`)
      await loadEmails()
    } catch (err) {
      alert('Gmail fetch failed: ' + (err.response?.data?.detail || err.message))
    } finally {
      setFetching(false)
    }
  }

  const handleProcess = async (emailId) => {
    setProcessing(emailId)
    try {
      const res = await processEmail(emailId)
      alert(res.data.message)
      await loadEmails()
    } catch (err) {
      alert('Processing failed: ' + (err.response?.data?.detail || err.message))
    } finally {
      setProcessing(null)
    }
  }

  const handleDelete = async (emailId) => {
    if (!confirm('Are you sure you want to delete this email?')) return
    setDeleting(emailId)
    try {
      await deleteEmail(emailId)
      await loadEmails()
    } catch (err) {
      alert('Delete failed: ' + (err.response?.data?.detail || err.message))
    } finally {
      setDeleting(null)
    }
  }

  const filtered = emails.filter(
    (e) =>
      (e.subject || '').toLowerCase().includes(search.toLowerCase()) ||
      (e.sender || '').toLowerCase().includes(search.toLowerCase())
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
        <h1 className="text-2xl font-bold text-gray-900">Email Inbox</h1>
        <p className="text-sm text-gray-500 mt-1">
          Incoming purchase orders and communications ({total} total)
        </p>
      </div>

      <div className="flex items-center justify-between mb-4 gap-4 flex-wrap">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 w-64"
          />
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

      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-100">
              {['Subject', 'Sender', 'Date', 'Attachments', 'Status', 'Action'].map((h) => (
                <th key={h} className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-6 py-3">
                  {h} {h !== 'Action' && <span className="text-gray-400">&#8597;</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-6 py-8 text-center text-sm text-gray-500">
                  No emails found. Click "Fetch from Gmail" to import emails.
                </td>
              </tr>
            ) : (
              filtered.map((email) => (
                <tr key={email.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-4 text-sm font-medium text-gray-900">{email.subject || '(No subject)'}</td>
                  <td className="px-6 py-4 text-sm text-gray-600">{email.sender || 'Unknown'}</td>
                  <td className="px-6 py-4 text-sm text-gray-500">
                    {email.received_at ? new Date(email.received_at).toLocaleDateString() : '-'}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600">
                    <span className="flex items-center gap-1">
                      <Paperclip size={14} className="text-gray-400" />
                      {email.attachments?.length || 0}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <StatusBadge status={email.status === 'processed' ? 'Processed' : email.status === 'failed' ? 'Failed' : 'Pending'} />
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
                          {processing === email.id ? 'Processing...' : 'Process'}
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
      </div>
    </div>
  )
}
