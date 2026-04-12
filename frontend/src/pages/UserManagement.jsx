import { useState, useEffect, useCallback } from 'react'
import { Search, Plus, Pencil, X } from 'lucide-react'
import StatusBadge from '../components/StatusBadge'
import { fetchUsers, createUser, updateUser } from '../services/api'

export default function UserManagement() {
  const [users, setUsers] = useState([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editUser, setEditUser] = useState(null)
  const [form, setForm] = useState({ full_name: '', email: '', role: 'VIEWER', password: '' })
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetchUsers()
      setUsers(res.data || [])
    } catch (err) {
      console.error('Failed to load users:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = users.filter(
    (u) =>
      (u.full_name || '').toLowerCase().includes(search.toLowerCase()) ||
      (u.email || '').toLowerCase().includes(search.toLowerCase())
  )

  const openAdd = () => {
    setEditUser(null)
    setForm({ full_name: '', email: '', role: 'VIEWER', password: '' })
    setShowModal(true)
  }

  const openEdit = (user) => {
    setEditUser(user)
    setForm({ full_name: user.full_name, email: user.email, role: user.role, password: '' })
    setShowModal(true)
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      if (editUser) {
        await updateUser(editUser.id, {
          full_name: form.full_name,
          role: form.role,
          is_active: true,
        })
      } else {
        await createUser({
          full_name: form.full_name,
          email: form.email,
          password: form.password,
          role: form.role,
        })
      }
      setShowModal(false)
      await load()
    } catch (err) {
      alert('Save failed: ' + (err.response?.data?.detail || err.message))
    } finally {
      setSaving(false)
    }
  }

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
        <h1 className="text-2xl font-bold text-gray-900">User Management</h1>
        <p className="text-sm text-gray-500 mt-1">Manage users and role-based access control ({users.length} users)</p>
      </div>

      <div className="flex items-center justify-between mb-4 gap-4 flex-wrap">
        <div className="relative w-64">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 w-full"
          />
        </div>
        <button
          onClick={openAdd}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          <Plus size={16} />
          Add User
        </button>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-100">
              {['Name', 'Email', 'Role', 'Status', 'Created', ''].map((h) => (
                <th key={h || 'actions'} className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-6 py-3">
                  {h} {h && <span className="text-gray-400">&#8597;</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-6 py-8 text-center text-sm text-gray-500">
                  No users found.
                </td>
              </tr>
            ) : (
              filtered.map((user) => (
                <tr key={user.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-4 text-sm font-medium text-gray-900">{user.full_name}</td>
                  <td className="px-6 py-4 text-sm text-gray-600">{user.email}</td>
                  <td className="px-6 py-4 text-sm text-gray-600">
                    <span className="inline-flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full border-2 border-gray-400" />
                      {user.role}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <StatusBadge status={user.is_active ? 'Active' : 'Inactive'} />
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500">
                    {user.created_at ? new Date(user.created_at).toLocaleDateString() : '-'}
                  </td>
                  <td className="px-6 py-4">
                    <button onClick={() => openEdit(user)} className="p-1.5 rounded hover:bg-gray-100 text-gray-500">
                      <Pencil size={16} />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-semibold text-gray-900">
                {editUser ? 'Edit User' : 'Add New User'}
              </h2>
              <button onClick={() => setShowModal(false)} className="p-1 rounded hover:bg-gray-100">
                <X size={18} />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
                <input
                  value={form.full_name}
                  onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  disabled={!!editUser}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
                />
              </div>
              {!editUser && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                  <input
                    type="password"
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
                <select
                  value={form.role}
                  onChange={(e) => setForm({ ...form, role: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                >
                  <option value="ADMIN">Admin</option>
                  <option value="KAS">KAS</option>
                  <option value="VIEWER">Viewer</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50">
                Cancel
              </button>
              <button onClick={handleSave} disabled={saving} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
                {saving ? 'Saving...' : editUser ? 'Save Changes' : 'Add User'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
