import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, LogOut, Moon, PanelLeft, PanelLeftClose, User } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'

// Reworked header — three fixes vs the original:
//
//  1. Avatar area no longer logs out on ANY click. It opens a proper
//     dropdown menu with "Signed in as …" + "Sign out". Previously any
//     click on the avatar (accidental double-clicks, hitting it while
//     tabbing) instantly killed the session.
//
//  2. The dead search input is removed. It had no handler — a fake
//     control is worse than no control (people type into it, wonder why
//     nothing happens). Bring it back once the app has a real global
//     search endpoint.
//
//  3. The fake red "3" notification badge is gone. It was hardcoded and
//     misleading. The bell icon stays as a placeholder but no longer
//     lies about pending notifications.
export default function Header({ collapsed, setCollapsed }) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  const initials = user?.full_name
    ? user.full_name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()
    : 'U'

  // Menu state + click-outside-to-close.
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef(null)

  useEffect(() => {
    if (!menuOpen) return
    function onDocClick(e) {
      if (!menuRef.current) return
      if (!menuRef.current.contains(e.target)) setMenuOpen(false)
    }
    function onKey(e) {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  function handleSignOut() {
    setMenuOpen(false)
    logout()
    navigate('/login', { replace: true })
  }

  return (
    <header className="h-14 bg-white border-b border-gray-200 flex items-center justify-between px-4 sticky top-0 z-20">
      {/* Left — collapse button only */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="p-1.5 rounded-md hover:bg-gray-100 text-gray-500"
        >
          {collapsed ? <PanelLeft size={20} /> : <PanelLeftClose size={20} />}
        </button>
      </div>

      {/* Right */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label="Toggle theme (not yet implemented)"
          title="Theme toggle — coming soon"
          className="p-1.5 rounded-md text-gray-400 cursor-not-allowed"
          disabled
        >
          <Moon size={18} />
        </button>
        <button
          type="button"
          aria-label="Notifications"
          title="No new notifications"
          className="p-1.5 rounded-md hover:bg-gray-100 text-gray-500"
        >
          <Bell size={18} />
        </button>

        {/* User menu — this is the important fix. A dedicated button
            opens a dropdown; the click no longer nukes the session. */}
        <div className="relative ml-2" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label="Account menu"
            className="flex items-center gap-2 rounded-full pl-1 pr-2 py-1 hover:bg-gray-100"
          >
            <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white text-xs font-semibold">
              {initials}
            </div>
            <div className="hidden sm:block text-left leading-tight">
              <p className="text-sm font-medium text-gray-800">
                {user?.full_name || 'User'}
              </p>
              <p className="text-[11px] text-gray-500 capitalize">
                {user?.role || 'viewer'}
              </p>
            </div>
          </button>

          {menuOpen && (
            <div
              role="menu"
              className="absolute right-0 mt-2 w-64 rounded-lg border border-gray-200 bg-white shadow-lg py-1.5 z-30"
            >
              <div className="px-3 py-2 border-b border-gray-100">
                <p className="text-[11px] uppercase tracking-wide text-gray-400">
                  Signed in as
                </p>
                <p className="text-sm font-medium text-gray-900 truncate">
                  {user?.email || '—'}
                </p>
                <p className="text-[11px] text-gray-500 capitalize mt-0.5">
                  {user?.role || 'viewer'} · {user?.is_active === false ? 'inactive' : 'active'}
                </p>
              </div>
              <button
                type="button"
                role="menuitem"
                onClick={() => { setMenuOpen(false); navigate('/profile') }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                <User size={14} />
                Profile
              </button>
              <div className="my-1 h-px bg-gray-100" />
              <button
                type="button"
                role="menuitem"
                onClick={handleSignOut}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-rose-600 hover:bg-rose-50"
              >
                <LogOut size={14} />
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
