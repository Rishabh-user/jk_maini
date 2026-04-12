import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import Header from './Header'

export default function Layout() {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <div className="min-h-screen bg-[#fdf6f0]">
      <Sidebar collapsed={collapsed} />
      <div
        className={`transition-all duration-300 ${collapsed ? 'ml-0' : 'ml-56'}`}
      >
        <Header collapsed={collapsed} setCollapsed={setCollapsed} />
        <main className="p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
