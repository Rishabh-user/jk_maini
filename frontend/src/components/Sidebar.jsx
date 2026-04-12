import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard,
  Mail,
  Table2,
  Database,
  FileSpreadsheet,
  Users,
  ClipboardList,
  Package,
  Shield,
  BarChart3,
} from 'lucide-react'

const mainLinks = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/inbox', label: 'Email Inbox', icon: Mail },
  { to: '/raw-data', label: 'Raw Data Viewer', icon: Table2 },
]

const dataLinks = [
  { to: '/master-data', label: 'Master Data', icon: Database },
  { to: '/zso-reports', label: 'ZSO Reports', icon: FileSpreadsheet },
  { to: '/demand-management', label: 'Demand Mgmt', icon: ClipboardList },
]

const operationsLinks = [
  { to: '/inventory-liquidation', label: 'Inventory Liquidation', icon: Package },
  { to: '/coverage-report', label: 'Coverage Report', icon: Shield },
  { to: '/performance', label: 'Performance', icon: BarChart3 },
]

const adminLinks = [
  { to: '/users', label: 'User Management', icon: Users },
]

function SidebarSection({ title, links }) {
  return (
    <div className="mb-4">
      <p className="px-4 mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
        {title}
      </p>
      <nav className="space-y-1">
        {links.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex items-center gap-3 px-4 py-2.5 text-sm font-medium rounded-lg mx-2 transition-colors ${
                isActive
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-300 hover:bg-slate-700 hover:text-white'
              }`
            }
          >
            <Icon size={18} />
            {label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}

export default function Sidebar({ collapsed }) {
  return (
    <aside
      className={`fixed top-0 left-0 h-screen bg-slate-800 text-white flex flex-col transition-all duration-300 z-30 ${
        collapsed ? 'w-0 overflow-hidden' : 'w-56'
      }`}
    >
      {/* Brand */}
      <div className="px-4 py-5 border-b border-slate-700">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-lg bg-blue-600 flex items-center justify-center text-white font-bold text-sm">
            JK
          </div>
          <div>
            <h1 className="text-base font-bold leading-tight">JK Maini</h1>
            <p className="text-xs text-slate-400">AI Email → ZSO</p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <div className="flex-1 py-4 overflow-y-auto">
        <SidebarSection title="Main" links={mainLinks} />
        <SidebarSection title="Data" links={dataLinks} />
        <SidebarSection title="Operations" links={operationsLinks} />
        <SidebarSection title="Admin" links={adminLinks} />
      </div>
    </aside>
  )
}
