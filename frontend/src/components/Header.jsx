import { Search, Bell, Moon, PanelLeftClose, PanelLeft } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'

export default function Header({ collapsed, setCollapsed }) {
  const { user, logout } = useAuth()

  const initials = user?.full_name
    ? user.full_name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
    : 'U'

  return (
    <header className="h-14 bg-white border-b border-gray-200 flex items-center justify-between px-4 sticky top-0 z-20">
      {/* Left */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="p-1.5 rounded-md hover:bg-gray-100 text-gray-500"
        >
          {collapsed ? <PanelLeft size={20} /> : <PanelLeftClose size={20} />}
        </button>
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search..."
            className="pl-9 pr-4 py-1.5 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent w-56"
          />
        </div>
      </div>

      {/* Right */}
      <div className="flex items-center gap-3">
        <button className="p-1.5 rounded-md hover:bg-gray-100 text-gray-500">
          <Moon size={18} />
        </button>
        <button className="p-1.5 rounded-md hover:bg-gray-100 text-gray-500 relative">
          <Bell size={18} />
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
            3
          </span>
        </button>
        <div className="flex items-center gap-2 ml-2 cursor-pointer" onClick={logout}>
          <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white text-xs font-semibold">
            {initials}
          </div>
          <div className="hidden sm:block text-right">
            <p className="text-sm font-medium text-gray-800 leading-tight">
              {user?.full_name || 'User'}
            </p>
            <p className="text-xs text-gray-500 capitalize">{user?.role || 'viewer'}</p>
          </div>
        </div>
      </div>
    </header>
  )
}
