import { useState, useEffect } from 'react'
import { Mail, Paperclip, FileSpreadsheet, AlertTriangle } from 'lucide-react'
import StatusBadge from '../components/StatusBadge'
import { fetchDashboardStats, fetchRecentActivity } from '../services/api'

function StatCard({ title, value, subtitle, icon: Icon, color }) {
  const colorMap = {
    blue: 'text-blue-600 bg-blue-50',
    green: 'text-green-600 bg-green-50',
    purple: 'text-purple-600 bg-purple-50',
    orange: 'text-orange-600 bg-orange-50',
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 flex justify-between items-start">
      <div>
        <p className="text-sm text-gray-500 font-medium">{title}</p>
        <p className="text-3xl font-bold text-gray-900 mt-1">{value}</p>
        <p className="text-xs text-gray-500 mt-1">{subtitle}</p>
      </div>
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${colorMap[color]}`}>
        <Icon size={20} />
      </div>
    </div>
  )
}

function timeAgo(isoString) {
  if (!isoString) return ''
  const diff = Date.now() - new Date(isoString).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export default function Dashboard() {
  const [stats, setStats] = useState(null)
  const [activity, setActivity] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const [statsRes, activityRes] = await Promise.all([
          fetchDashboardStats(),
          fetchRecentActivity(),
        ])
        setStats(statsRes.data)
        setActivity(activityRes.data)
      } catch (err) {
        console.error('Dashboard load error:', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

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
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-500 mt-1">
          Overview of your email-to-ZSO automation pipeline
        </p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard
          title="Total Emails Processed"
          value={stats?.processed_emails?.toLocaleString() || '0'}
          subtitle={`${stats?.total_emails || 0} total received`}
          icon={Mail}
          color="blue"
        />
        <StatCard
          title="Total Attachments"
          value={stats?.total_attachments?.toLocaleString() || '0'}
          subtitle="Files extracted"
          icon={Paperclip}
          color="green"
        />
        <StatCard
          title="ZSO Generated"
          value={stats?.total_zso?.toLocaleString() || '0'}
          subtitle="Reports created"
          icon={FileSpreadsheet}
          color="purple"
        />
        <StatCard
          title="Pending / Errors"
          value={`${stats?.pending_emails || 0} / ${stats?.failed_emails || 0}`}
          subtitle="Needs attention"
          icon={AlertTriangle}
          color="orange"
        />
      </div>

      {/* Recent Activity */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">Recent Activity</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-6 py-3">Action</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-6 py-3">Detail</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-6 py-3">Time</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-6 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {activity.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-6 py-8 text-center text-sm text-gray-500">
                    No recent activity. Fetch emails to get started.
                  </td>
                </tr>
              ) : (
                activity.map((item, i) => (
                  <tr key={i} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4 text-sm font-medium text-gray-900">{item.action}</td>
                    <td className="px-6 py-4 text-sm text-gray-600">{item.detail}</td>
                    <td className="px-6 py-4 text-sm text-gray-500">{timeAgo(item.time)}</td>
                    <td className="px-6 py-4">
                      <StatusBadge status={item.status} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
