import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, LineChart, Line, LabelList,
} from 'recharts'
import { Mail, Paperclip, FileSpreadsheet, AlertTriangle, Upload, ArrowUpRight } from 'lucide-react'
import StatusBadge from '../components/StatusBadge'
import { fetchDashboardStats, fetchRecentActivity, fetchDashboardCharts } from '../services/api'
import { STATUS, categoricalColor } from '../utils/chartColors'

function StatCard({ title, value, subtitle, icon: Icon, color }) {
  const colorMap = {
    blue: 'text-blue-600 bg-blue-50',
    green: 'text-green-600 bg-green-50',
    purple: 'text-purple-600 bg-purple-50',
    orange: 'text-orange-600 bg-orange-50',
    indigo: 'text-indigo-600 bg-indigo-50',
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

const fmtInr = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
const fmtCompactInr = (n) => {
  const v = Number(n || 0)
  if (v >= 1e7) return `₹${(v / 1e7).toFixed(1)}Cr`
  if (v >= 1e5) return `₹${(v / 1e5).toFixed(1)}L`
  if (v >= 1e3) return `₹${(v / 1e3).toFixed(1)}K`
  return `₹${v.toFixed(0)}`
}

// Every chart lives in one of these — a title, an optional one-line stat,
// a "go to the real page" link (click target #1), and the chart itself
// (click target #2: clicking a bar/slice navigates the same place). Two
// click targets on the same destination is intentional — a bare chart
// with no visible affordance reads as decorative, not navigable.
function ChartCard({ title, subtitle, onNavigate, children, empty }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 flex flex-col">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
          {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
        </div>
        <button
          onClick={onNavigate}
          className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 whitespace-nowrap shrink-0"
        >
          View page <ArrowUpRight size={13} />
        </button>
      </div>
      <div className="flex-1 min-h-[220px]">
        {empty ? (
          <div className="h-full min-h-[220px] flex items-center justify-center text-sm text-gray-400">
            {empty}
          </div>
        ) : children}
      </div>
    </div>
  )
}

const donutTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null
  const p = payload[0]
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-sm px-3 py-2 text-xs">
      <span className="font-semibold text-gray-900">{p.name}</span>: <span className="text-gray-600">{p.value.toLocaleString('en-IN')}</span>
    </div>
  )
}

export default function Dashboard() {
  const navigate = useNavigate()
  const [stats, setStats] = useState(null)
  const [activity, setActivity] = useState([])
  const [charts, setCharts] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const [statsRes, activityRes, chartsRes] = await Promise.all([
          fetchDashboardStats(),
          fetchRecentActivity(),
          fetchDashboardCharts(),
        ])
        setStats(statsRes.data)
        setActivity(activityRes.data)
        setCharts(chartsRes.data)
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

  // ── Email Inbox — status donut ────────────────────────────────────────
  const ep = charts?.email_pipeline || {}
  const emailData = [
    { key: 'processed', name: 'Processed', value: ep.processed || 0, color: STATUS.good },
    { key: 'unprocessed', name: 'Unprocessed', value: ep.unprocessed || 0, color: STATUS.pending },
    { key: 'failed', name: 'Failed', value: ep.failed || 0, color: STATUS.critical },
  ]
  const emailHasData = emailData.some((d) => d.value > 0)
  const goInbox = (status) => navigate(status ? `/inbox?status=${status}` : '/inbox')

  // ── ZSO Reports — total value by month (report count as a data label,
  // not a second axis — two measures of different scale stay on one chart
  // only via a label, never a dual y-axis) ─────────────────────────────
  const zsoByMonth = charts?.zso_by_month || []
  const zsoHasData = zsoByMonth.length > 0

  // ── Master Data — currency mix ────────────────────────────────────────
  const md = charts?.master_data || {}
  const currencyEntries = Object.entries(md.by_currency || {})
  const currencyData = currencyEntries.map(([name, value], i) => ({ name, value, color: categoricalColor(i) }))
  const masterHasData = currencyData.length > 0

  // ── Demand Management — data source mix ───────────────────────────────
  const sourceEntries = Object.entries(charts?.demand_sources || {})
  const sourceData = sourceEntries.map(([name, value], i) => ({ name, value, color: categoricalColor(i) }))
  const sourcesHasData = sourceData.length > 0

  // ── Inventory Liquidation — FG vs WIP allocation status ───────────────
  const inv = charts?.inventory_allocation || {}
  const invData = [
    { name: 'FG', full: inv.fg?.fully_allocated || 0, partial: inv.fg?.partial || 0, no_stock: inv.fg?.no_stock || 0, tab: 'fg' },
    { name: 'WIP', full: inv.wip?.fully_allocated || 0, partial: inv.wip?.partial || 0, no_stock: inv.wip?.no_stock || 0, tab: 'wip' },
  ]
  const invHasData = invData.some((d) => d.full || d.partial || d.no_stock)

  // ── Coverage Report — coverage level donut ────────────────────────────
  const cov = charts?.coverage || {}
  const covData = [
    { key: 'full', name: 'Full', value: cov.full || 0, color: STATUS.good },
    { key: 'partial', name: 'Partial', value: cov.partial || 0, color: STATUS.pending },
    { key: 'low', name: 'Low', value: cov.low || 0, color: STATUS.warning },
    { key: 'none', name: 'None', value: cov.none || 0, color: STATUS.critical },
  ]
  const covHasData = covData.some((d) => d.value > 0)

  // ── Performance — demand vs actual vs budget, one shared axis (all
  // three are money values, so one y-scale is correct here — not the
  // dual-axis anti-pattern, which is specifically about mismatched scales) ─
  const perf = charts?.performance
  const perfHasData = (perf?.monthly || []).some((m) => m.demand || m.actual || m.budget)

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-500 mt-1">
          Overview of your email-to-ZSO automation pipeline
        </p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
        <StatCard
          title="Total Emails Processed"
          value={stats?.processed_emails?.toLocaleString() || '0'}
          subtitle={`${stats?.total_emails || 0} total received`}
          icon={Mail}
          color="blue"
        />
        <StatCard
          title="Total Manually Processed"
          value={stats?.processed_manual?.toLocaleString() || '0'}
          subtitle={`${stats?.total_manual || 0} total uploaded`}
          icon={Upload}
          color="indigo"
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

      {/* Chart grid — one card per page, click a slice/bar or "View page"
          to jump straight to that page's own data. */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">

        {/* Email Inbox */}
        <ChartCard
          title="Email Pipeline"
          subtitle={`${(ep.processed || 0) + (ep.unprocessed || 0) + (ep.failed || 0)} emails received`}
          onNavigate={() => goInbox()}
          empty={!emailHasData ? 'No emails yet — fetch from Gmail to get started.' : null}
        >
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie
                isAnimationActive={false}
                data={emailData} dataKey="value" nameKey="name"
                cx="50%" cy="50%" innerRadius={55} outerRadius={80}
                paddingAngle={2} cursor="pointer"
                onClick={(d) => goInbox(d.key)}
              >
                {emailData.map((d) => <Cell key={d.key} fill={d.color} stroke="#fff" strokeWidth={2} />)}
              </Pie>
              <Tooltip content={donutTooltip} />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* ZSO Reports */}
        <ChartCard
          title="ZSO Reports"
          subtitle="Total value by month (last 6 months)"
          onNavigate={() => navigate('/zso-reports')}
          empty={!zsoHasData ? 'No ZSO reports generated yet.' : null}
        >
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={zsoByMonth} margin={{ top: 20, right: 8, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e1e0d9" />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#898781' }} axisLine={{ stroke: '#c3c2b7' }} tickLine={false} />
              <YAxis tickFormatter={fmtCompactInr} tick={{ fontSize: 11, fill: '#898781' }} axisLine={false} tickLine={false} width={55} />
              <Tooltip formatter={(v) => fmtInr(v)} labelFormatter={(l) => `Month: ${l}`} />
              <Bar isAnimationActive={false} dataKey="total_inr" name="Total value" fill={categoricalColor(0)} radius={[4, 4, 0, 0]} cursor="pointer" onClick={() => navigate('/zso-reports')}>
                <LabelList dataKey="count" position="top" formatter={(v) => `${v} rpt${v === 1 ? '' : 's'}`} style={{ fontSize: 10, fill: '#52514e' }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Master Data */}
        <ChartCard
          title="Master Data"
          subtitle={`${md.total_parts || 0} parts · ${md.active_forex_rates || 0} active forex rate(s) · ${md.forecast_customers || 0} forecast customer(s)`}
          onNavigate={() => navigate('/master-data')}
          empty={!masterHasData ? 'No master data uploaded yet.' : null}
        >
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie
                isAnimationActive={false}
                data={currencyData} dataKey="value" nameKey="name"
                cx="50%" cy="50%" innerRadius={55} outerRadius={80}
                paddingAngle={2} cursor="pointer"
                onClick={() => navigate('/master-data')}
              >
                {currencyData.map((d) => <Cell key={d.name} fill={d.color} stroke="#fff" strokeWidth={2} />)}
              </Pie>
              <Tooltip content={donutTooltip} />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Demand Management */}
        <ChartCard
          title="Demand Management"
          subtitle="Attachments processed, by source format"
          onNavigate={() => navigate('/demand-management')}
          empty={!sourcesHasData ? 'No demand data processed yet.' : null}
        >
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={sourceData} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e1e0d9" />
              <XAxis type="number" tick={{ fontSize: 11, fill: '#898781' }} axisLine={false} tickLine={false} allowDecimals={false} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 12, fill: '#52514e' }} axisLine={false} tickLine={false} width={55} />
              <Tooltip />
              <Bar isAnimationActive={false} dataKey="value" name="Attachments" radius={[0, 4, 4, 0]} cursor="pointer" onClick={() => navigate('/demand-management')}>
                {sourceData.map((d) => <Cell key={d.name} fill={d.color} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Inventory Liquidation */}
        <ChartCard
          title="Inventory Allocation"
          subtitle="Latest FG vs WIP allocation, by stock status"
          onNavigate={() => navigate('/inventory-liquidation')}
          empty={!invHasData ? 'Run an FG or WIP allocation to see this chart.' : null}
        >
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={invData} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e1e0d9" />
              <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#52514e' }} axisLine={{ stroke: '#c3c2b7' }} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#898781' }} axisLine={false} tickLine={false} allowDecimals={false} width={30} />
              <Tooltip />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
              <Bar isAnimationActive={false} dataKey="full" name="Full Stock" stackId="s" fill={STATUS.good} cursor="pointer" onClick={(d) => navigate(`/inventory-liquidation?tab=${d.tab}`)} />
              <Bar isAnimationActive={false} dataKey="partial" name="Partial" stackId="s" fill={STATUS.pending} cursor="pointer" onClick={(d) => navigate(`/inventory-liquidation?tab=${d.tab}`)} />
              <Bar isAnimationActive={false} dataKey="no_stock" name="No Stock" stackId="s" fill={STATUS.critical} radius={[4, 4, 0, 0]} cursor="pointer" onClick={(d) => navigate(`/inventory-liquidation?tab=${d.tab}`)} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Coverage Report */}
        <ChartCard
          title="Coverage Report"
          subtitle={`${cov.total || 0} parts in latest coverage snapshot`}
          onNavigate={() => navigate('/coverage-report')}
          empty={!covHasData ? 'Generate a coverage report to see this chart.' : null}
        >
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie
                isAnimationActive={false}
                data={covData} dataKey="value" nameKey="name"
                cx="50%" cy="50%" innerRadius={55} outerRadius={80}
                paddingAngle={2} cursor="pointer"
                onClick={() => navigate('/coverage-report')}
              >
                {covData.map((d) => <Cell key={d.key} fill={d.color} stroke="#fff" strokeWidth={2} />)}
              </Pie>
              <Tooltip content={donutTooltip} />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Performance Dashboard — spans full width, it's a 3-series time series */}
        <div className="md:col-span-2 lg:col-span-3">
          <ChartCard
            title="Performance — Demand vs Actual vs Budget"
            subtitle={`Fiscal year ${perf?.fiscal_year || '—'}`}
            onNavigate={() => navigate('/performance')}
            empty={!perfHasData ? 'Upload sales/budget data to see this chart.' : null}
          >
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={perf?.monthly || []} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e1e0d9" />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#898781' }} axisLine={{ stroke: '#c3c2b7' }} tickLine={false} />
                <YAxis tickFormatter={fmtCompactInr} tick={{ fontSize: 11, fill: '#898781' }} axisLine={false} tickLine={false} width={55} />
                <Tooltip formatter={(v) => fmtInr(v)} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                <Line isAnimationActive={false} type="monotone" dataKey="demand" name="Demand" stroke={categoricalColor(0)} strokeWidth={2} dot={{ r: 3, cursor: 'pointer', onClick: () => navigate('/performance') }} activeDot={{ r: 5 }} />
                <Line isAnimationActive={false} type="monotone" dataKey="actual" name="Actual" stroke={categoricalColor(1)} strokeWidth={2} dot={{ r: 3, cursor: 'pointer', onClick: () => navigate('/performance') }} activeDot={{ r: 5 }} />
                <Line isAnimationActive={false} type="monotone" dataKey="budget" name="Budget" stroke={categoricalColor(2)} strokeWidth={2} strokeDasharray="4 3" dot={{ r: 3, cursor: 'pointer', onClick: () => navigate('/performance') }} activeDot={{ r: 5 }} />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>
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
