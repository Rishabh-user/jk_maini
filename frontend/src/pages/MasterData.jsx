import { useState, useEffect, useCallback, useRef } from 'react'
import { Search, Plus, Pencil, Trash2, X, Upload } from 'lucide-react'
import { fetchMasterData, createMasterData, updateMasterData, deleteMasterData, uploadMasterData } from '../services/api'

const emptyForm = { customer_name: '', customer_location: '', customer_part_no: '', maini_part_no: '', description: '', country: '', unit_price: '', currency: 'INR', hsn_code: '' }

export default function MasterData() {
  const [data, setData] = useState([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editItem, setEditItem] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef(null)

  const load = useCallback(async () => {
    try {
      const res = await fetchMasterData()
      setData(res.data || [])
    } catch (err) {
      console.error('Failed to load master data:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = data.filter(
    (d) =>
      (d.customer_name || '').toLowerCase().includes(search.toLowerCase()) ||
      (d.customer_location || '').toLowerCase().includes(search.toLowerCase()) ||
      (d.customer_part_no || '').toLowerCase().includes(search.toLowerCase()) ||
      (d.maini_part_no || '').toLowerCase().includes(search.toLowerCase()) ||
      (d.description || '').toLowerCase().includes(search.toLowerCase()) ||
      (d.country || '').toLowerCase().includes(search.toLowerCase())
  )

  const openAdd = () => {
    setEditItem(null)
    setForm(emptyForm)
    setShowModal(true)
  }

  const openEdit = (item) => {
    setEditItem(item)
    setForm({
      customer_name: item.customer_name || '',
      customer_location: item.customer_location || '',
      customer_part_no: item.customer_part_no || '',
      maini_part_no: item.maini_part_no || '',
      description: item.description || '',
      country: item.country || '',
      unit_price: item.unit_price != null ? String(item.unit_price) : '',
      currency: item.currency || 'INR',
      hsn_code: item.hsn_code || '',
    })
    setShowModal(true)
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const payload = {
        ...form,
        unit_price: form.unit_price ? parseFloat(form.unit_price) : null,
      }
      if (editItem) {
        await updateMasterData(editItem.id, payload)
      } else {
        await createMasterData(payload)
      }
      setShowModal(false)
      await load()
    } catch (err) {
      alert('Save failed: ' + (err.response?.data?.detail || err.message))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id) => {
    if (!confirm('Are you sure you want to delete this entry?')) return
    try {
      await deleteMasterData(id)
      await load()
    } catch (err) {
      alert('Delete failed: ' + (err.response?.data?.detail || err.message))
    }
  }

  const handleUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const res = await uploadMasterData(file)
      const { inserted, updated, total_rows } = res.data
      alert(`Upload complete!\n${total_rows} rows processed\n${inserted} new entries added\n${updated} existing entries updated`)
      await load()
    } catch (err) {
      alert('Upload failed: ' + (err.response?.data?.detail || err.message))
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
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
        <h1 className="text-2xl font-bold text-gray-900">Master Data</h1>
        <p className="text-sm text-gray-500 mt-1">Customer and part number mappings ({data.length} entries)</p>
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
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={handleUpload}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
          >
            <Upload size={16} />
            {uploading ? 'Uploading...' : 'Upload Excel'}
          </button>
          <button
            onClick={openAdd}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            <Plus size={16} />
            Add Entry
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-100">
              {['Customer Name', 'Location', 'Customer Part #', 'Maini Part #', 'Description', 'Country', 'Actions'].map(
                (h) => (
                  <th key={h} className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3 whitespace-nowrap">
                    {h} {h !== 'Actions' && <span className="text-gray-400">&#8597;</span>}
                  </th>
                )
              )}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-6 py-8 text-center text-sm text-gray-500">
                  No master data entries. Upload an Excel file or click "Add Entry".
                </td>
              </tr>
            ) : (
              filtered.map((row) => (
                <tr key={row.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3.5 text-sm font-medium text-gray-900 whitespace-nowrap">{row.customer_name || '-'}</td>
                  <td className="px-4 py-3.5 text-sm text-gray-600 whitespace-nowrap">{row.customer_location || '-'}</td>
                  <td className="px-4 py-3.5 text-sm text-gray-600">{row.customer_part_no}</td>
                  <td className="px-4 py-3.5 text-sm text-gray-600">{row.maini_part_no}</td>
                  <td className="px-4 py-3.5 text-sm text-gray-600">{row.description || '-'}</td>
                  <td className="px-4 py-3.5 text-sm text-gray-600">{row.country || '-'}</td>
                  <td className="px-4 py-3.5">
                    <div className="flex items-center gap-2">
                      <button onClick={() => openEdit(row)} className="p-1.5 rounded hover:bg-gray-100 text-gray-500">
                        <Pencil size={16} />
                      </button>
                      <button onClick={() => handleDelete(row.id)} className="p-1.5 rounded hover:bg-red-50 text-red-500">
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

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-semibold text-gray-900">
                {editItem ? 'Edit Entry' : 'Add New Entry'}
              </h2>
              <button onClick={() => setShowModal(false)} className="p-1 rounded hover:bg-gray-100">
                <X size={18} />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-4">
              {[
                { key: 'customer_name', label: 'Customer Name' },
                { key: 'customer_location', label: 'Customer Location' },
                { key: 'customer_part_no', label: 'Customer Part #' },
                { key: 'maini_part_no', label: 'Maini Part #' },
                { key: 'description', label: 'Description' },
                { key: 'country', label: 'Country' },
                { key: 'unit_price', label: 'Unit Price', type: 'number' },
                { key: 'currency', label: 'Currency' },
                { key: 'hsn_code', label: 'HSN Code' },
              ].map(({ key, label, type }) => (
                <div key={key} className={key === 'description' ? 'col-span-2' : ''}>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
                  <input
                    type={type || 'text'}
                    value={form[key]}
                    onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50">
                Cancel
              </button>
              <button onClick={handleSave} disabled={saving} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
                {saving ? 'Saving...' : editItem ? 'Save Changes' : 'Add Entry'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
