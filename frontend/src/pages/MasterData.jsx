import { useState, useEffect, useCallback, useRef } from 'react'
import { Search, Plus, Pencil, Trash2, X, Upload, RefreshCw, TrendingUp, Calendar, ChevronDown, ChevronRight } from 'lucide-react'
import { fetchMasterData, createMasterData, updateMasterData, deleteMasterData, uploadMasterData, fetchForexRates, addForexRate, deleteForexRate, fetchForecastSummary, fetchForecastParts, uploadForecastFile, deleteForecastCustomer } from '../services/api'

const emptyForm = { customer_name: '', customer_location: '', customer_part_no: '', maini_part_no: '', description: '', country: '', unit_price: '', currency: 'INR', hsn_code: '' }
const emptyForexForm = { currency_from: 'USD', currency_to: 'INR', rate: '', effective_date: '', notes: '' }
// Supported source currencies for conversion to INR
const FOREX_FROM_CURRENCIES = ['USD', 'EUR', 'GBP']
const FOREX_TO_CURRENCIES = ['INR']

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
  const [activeTab, setActiveTab] = useState('parts')

  // Forecast state
  const [forecastSummary, setForecastSummary] = useState([])
  const [forecastLoading, setForecastLoading] = useState(false)
  const [forecastUploading, setForecastUploading] = useState(false)
  const [forecastCustomerName, setForecastCustomerName] = useState('')
  const [expandedForecastCustomer, setExpandedForecastCustomer] = useState(null)
  const [forecastParts, setForecastParts] = useState([])
  const [forecastPartsLoading, setForecastPartsLoading] = useState(false)
  const forecastFileRef = useRef(null)

  const loadForecastSummary = useCallback(async () => {
    setForecastLoading(true)
    try {
      const res = await fetchForecastSummary()
      setForecastSummary(res.data || [])
    } catch (err) {
      console.error('Failed to load forecast summary:', err)
    } finally {
      setForecastLoading(false)
    }
  }, [])

  const handleForecastUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!forecastCustomerName.trim()) {
      alert('Please enter the customer name before uploading.')
      return
    }
    setForecastUploading(true)
    try {
      const res = await uploadForecastFile(file, forecastCustomerName.trim())
      const { inserted, part_count, period_count } = res.data
      alert(`Forecast uploaded!\n${part_count} parts × ${period_count} periods\n${inserted} total entries saved for "${forecastCustomerName.trim()}"`)
      setForecastCustomerName('')
      await loadForecastSummary()
    } catch (err) {
      alert('Upload failed: ' + (err.response?.data?.detail || err.message))
    } finally {
      setForecastUploading(false)
      if (forecastFileRef.current) forecastFileRef.current.value = ''
    }
  }

  const handleForecastDelete = async (customerName) => {
    if (!window.confirm(`Delete ALL forecast data for "${customerName}"?`)) return
    try {
      await deleteForecastCustomer(customerName)
      if (expandedForecastCustomer === customerName) {
        setExpandedForecastCustomer(null)
        setForecastParts([])
      }
      await loadForecastSummary()
    } catch (err) {
      alert('Delete failed: ' + (err.response?.data?.detail || err.message))
    }
  }

  const toggleForecastExpand = async (customerName) => {
    if (expandedForecastCustomer === customerName) {
      setExpandedForecastCustomer(null)
      setForecastParts([])
      return
    }
    setExpandedForecastCustomer(customerName)
    setForecastPartsLoading(true)
    try {
      const res = await fetchForecastParts(customerName)
      setForecastParts(res.data || [])
    } catch (err) {
      console.error('Failed to load forecast parts:', err)
    } finally {
      setForecastPartsLoading(false)
    }
  }

  // Forex rate state
  const [forexRates, setForexRates] = useState([])
  const [forexLoading, setForexLoading] = useState(false)
  const [showForexForm, setShowForexForm] = useState(false)
  const [forexForm, setForexForm] = useState(emptyForexForm)
  const [forexSaving, setForexSaving] = useState(false)
  // Currencies added by the user at runtime via the free-text box (e.g. AED, SGD)
  const [extraCurrencies, setExtraCurrencies] = useState([])
  const [newCurrency, setNewCurrency] = useState('')

  // Dropdown options = built-in list + user-added + any currency already saved in rates.
  // So a currency you add (or have ever saved a rate for) shows up in the dropdown.
  const fromOptions = Array.from(new Set([
    ...FOREX_FROM_CURRENCIES, ...extraCurrencies,
    ...forexRates.map((r) => r.currency_from).filter(Boolean),
  ]))
  const toOptions = Array.from(new Set([
    ...FOREX_TO_CURRENCIES, ...extraCurrencies,
    ...forexRates.map((r) => r.currency_to).filter(Boolean),
  ]))

  const handleAddCurrency = () => {
    const code = newCurrency.trim().toUpperCase()
    if (!code) return
    if (!extraCurrencies.includes(code)) setExtraCurrencies([...extraCurrencies, code])
    // Select the newly added currency as the "From" by default
    setForexForm({ ...forexForm, currency_from: code })
    setNewCurrency('')
  }

  const loadForexRates = useCallback(async () => {
    setForexLoading(true)
    try {
      const res = await fetchForexRates()
      setForexRates(res.data || [])
    } catch (err) {
      console.error('Failed to load forex rates:', err)
    } finally {
      setForexLoading(false)
    }
  }, [])

  const handleAddForexRate = async () => {
    if (!forexForm.rate || !forexForm.effective_date) return
    setForexSaving(true)
    try {
      await addForexRate({
        currency_from: forexForm.currency_from.toUpperCase(),
        currency_to: forexForm.currency_to.toUpperCase(),
        rate: parseFloat(forexForm.rate),
        effective_date: new Date(forexForm.effective_date).toISOString(),
        notes: forexForm.notes || null,
      })
      setForexForm(emptyForexForm)
      setShowForexForm(false)
      await loadForexRates()
    } catch (err) {
      alert('Failed to save rate: ' + (err.response?.data?.detail || err.message))
    } finally {
      setForexSaving(false)
    }
  }

  const handleDeleteForexRate = async (id) => {
    if (!window.confirm('Delete this forex rate?')) return
    try {
      await deleteForexRate(id)
      await loadForexRates()
    } catch (err) {
      alert('Delete failed: ' + (err.response?.data?.detail || err.message))
    }
  }

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
  useEffect(() => { loadForexRates() }, [loadForexRates])
  useEffect(() => { loadForecastSummary() }, [loadForecastSummary])

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
        <p className="text-sm text-gray-500 mt-1">Part mappings, pricing, and exchange rates</p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 mb-6 border-b border-gray-200">
        <button
          onClick={() => setActiveTab('parts')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${activeTab === 'parts' ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
        >
          Part Mappings
          <span className="ml-2 text-xs rounded-full bg-gray-100 text-gray-500 px-1.5 py-0.5">{data.length}</span>
        </button>
        <button
          onClick={() => setActiveTab('forex')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${activeTab === 'forex' ? 'border-emerald-600 text-emerald-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
        >
          <TrendingUp size={14} />
          Forex Rates
          {forexRates.length > 0 && (
            <span className="text-xs rounded-full bg-emerald-100 text-emerald-600 px-1.5 py-0.5">{forexRates.length}</span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('forecast')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${activeTab === 'forecast' ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
        >
          <Calendar size={14} />
          Forecast Data
          {forecastSummary.length > 0 && (
            <span className="text-xs rounded-full bg-indigo-100 text-indigo-600 px-1.5 py-0.5">{forecastSummary.reduce((s, c) => s + c.part_count, 0)} parts</span>
          )}
        </button>
      </div>

      {activeTab === 'parts' && <>
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
                    {h}
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

      </> }

      {/* ── FOREX RATES TAB ───────────────────────────────────────── */}
      {activeTab === 'forex' && (
        <div>
          {/* Info banner */}
          <div className="mb-4 p-4 bg-blue-50 border border-blue-100 rounded-lg flex gap-3">
            <TrendingUp size={18} className="text-blue-500 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-blue-800">
              <p className="font-medium">How forex rates work</p>
              <p className="mt-1 text-blue-700">
                When generating a ZSO report, the system multiplies the <strong>USD unit price</strong> (from master data)
                by the <strong>latest rate entered here</strong> to get <strong>Unit Price in INR</strong> and <strong>Total in INR</strong>.
                The rate used is stamped on every ZSO report for transparency.
                Finance team should update this monthly (or as agreed).
              </p>
            </div>
          </div>

          {/* Add rate form */}
          <div className="bg-white border border-gray-200 rounded-lg p-5 mb-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-gray-900">Add New Rate</h3>
              <button onClick={loadForexRates} className="p-1.5 rounded hover:bg-gray-100" title="Refresh list">
                <RefreshCw size={14} className={forexLoading ? 'animate-spin text-blue-500' : 'text-gray-400'} />
              </button>
            </div>
            {/* Free-text: add any currency code not in the dropdowns (e.g. AED for Dubai Dirham).
                Once added it appears in the dropdowns below; it persists after you save a rate with it. */}
            <div className="mb-3 flex items-end gap-2">
              <div className="flex-1 max-w-xs">
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Add a currency not listed (type a code, e.g. AED, SGD, JPY)
                </label>
                <input value={newCurrency}
                  onChange={(e) => setNewCurrency(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddCurrency() } }}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg uppercase focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                  placeholder="e.g. AED" />
              </div>
              <button type="button" onClick={handleAddCurrency} disabled={!newCurrency.trim()}
                className="px-3 py-2 text-sm font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50">
                Add to list
              </button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 items-end">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">From Currency</label>
                <select value={forexForm.currency_from}
                  onChange={(e) => setForexForm({ ...forexForm, currency_from: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:ring-2 focus:ring-emerald-500 focus:outline-none">
                  {fromOptions.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">To Currency</label>
                <select value={forexForm.currency_to}
                  onChange={(e) => setForexForm({ ...forexForm, currency_to: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:ring-2 focus:ring-emerald-500 focus:outline-none">
                  {toOptions.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Rate (1 USD = ? INR)</label>
                <input type="number" step="0.01" value={forexForm.rate}
                  onChange={(e) => setForexForm({ ...forexForm, rate: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                  placeholder="84.50" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Effective From</label>
                <input type="date" value={forexForm.effective_date}
                  onChange={(e) => setForexForm({ ...forexForm, effective_date: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:outline-none" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
                <input value={forexForm.notes}
                  onChange={(e) => setForexForm({ ...forexForm, notes: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                  placeholder="e.g. Apr 2026, finance approved" />
              </div>
            </div>
            <div className="flex justify-end mt-4">
              <button onClick={handleAddForexRate} disabled={forexSaving || !forexForm.rate || !forexForm.effective_date}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50">
                <Plus size={15} />
                {forexSaving ? 'Saving...' : 'Save Rate'}
              </button>
            </div>
          </div>

          {/* Rates table */}
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  {['From', 'To', 'Rate', 'Effective From', 'Notes', 'Added On', ''].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {forexLoading ? (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-gray-400">Loading...</td></tr>
                ) : forexRates.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-gray-400">
                    No rates entered yet — ZSO reports will show 0 in the INR columns until you add one.
                  </td></tr>
                ) : (
                  forexRates.map((r, idx) => (
                    <tr key={r.id} className={`border-b border-gray-50 hover:bg-gray-50 ${idx === 0 ? 'bg-emerald-50/40' : ''}`}>
                      <td className="px-4 py-3 font-semibold text-gray-700">{r.currency_from}</td>
                      <td className="px-4 py-3 text-gray-500">{r.currency_to}</td>
                      <td className="px-4 py-3">
                        <span className="font-bold text-emerald-700">{r.rate}</span>
                        {idx === 0 && <span className="ml-2 text-[10px] bg-emerald-100 text-emerald-600 rounded-full px-1.5 py-0.5 font-medium">ACTIVE</span>}
                      </td>
                      <td className="px-4 py-3 text-gray-500">{new Date(r.effective_date).toLocaleDateString('en-IN')}</td>
                      <td className="px-4 py-3 text-gray-400 max-w-xs truncate">{r.notes || '—'}</td>
                      <td className="px-4 py-3 text-gray-400 text-xs">{new Date(r.created_at).toLocaleDateString('en-IN')}</td>
                      <td className="px-4 py-3">
                        <button onClick={() => handleDeleteForexRate(r.id)} className="p-1 text-red-300 hover:text-red-600 rounded transition-colors">
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-gray-400">Rates are sorted newest first. The top row (marked ACTIVE) is the one currently used in ZSO reports.</p>
        </div>
      )}

      {/* ── FORECAST DATA TAB ─────────────────────────────────────── */}
      {activeTab === 'forecast' && (
        <div>
          {/* Info banner */}
          <div className="mb-4 p-4 bg-indigo-50 border border-indigo-100 rounded-lg flex gap-3">
            <Calendar size={18} className="text-indigo-500 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-indigo-800">
              <p className="font-medium">How internal forecast works</p>
              <p className="mt-1 text-indigo-700">
                Upload Maini's internal customer forecast Excel (e.g. <em>Maini Forecast - August 2025.xlsx</em>).
                When a ZSO is generated for a customer, the system automatically appends <strong>Internal Forecast</strong> rows
                from this table — linked via <strong>Customer Part #</strong> — alongside the PO demand rows from the uploaded file.
                Unit price and Maini Part # are looked up from Master Data.
              </p>
            </div>
          </div>

          {/* Upload panel */}
          <div className="bg-white border border-gray-200 rounded-lg p-5 mb-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-900">Upload Forecast File</h3>
              <button onClick={loadForecastSummary} className="p-1.5 rounded hover:bg-gray-100" title="Refresh">
                <RefreshCw size={14} className={forecastLoading ? 'animate-spin text-indigo-500' : 'text-gray-400'} />
              </button>
            </div>
            <div className="flex flex-col sm:flex-row gap-3 items-end">
              <div className="flex-1">
                <label className="block text-xs font-medium text-gray-600 mb-1">Customer Name</label>
                <input
                  value={forecastCustomerName}
                  onChange={(e) => setForecastCustomerName(e.target.value)}
                  placeholder="e.g. Safran HAL"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                />
              </div>
              <div>
                <input ref={forecastFileRef} type="file" accept=".xlsx,.xls" onChange={handleForecastUpload} className="hidden" />
                <button
                  onClick={() => forecastFileRef.current?.click()}
                  disabled={forecastUploading || !forecastCustomerName.trim()}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 whitespace-nowrap"
                >
                  <Upload size={15} />
                  {forecastUploading ? 'Uploading...' : 'Upload Excel'}
                </button>
              </div>
            </div>
            <p className="mt-2 text-xs text-gray-400">
              Format: Sl No | Comp. Part Number | month columns (Oct-25, Nov-2025 …). Re-uploading replaces existing data for that customer.
            </p>
          </div>

          {/* Summary table */}
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  {['', 'Customer', 'Parts', 'Periods', 'Total Forecast Qty', 'Source File', 'Uploaded At', ''].map((h, i) => (
                    <th key={i} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {forecastLoading ? (
                  <tr><td colSpan={8} className="px-4 py-8 text-center text-sm text-gray-400">Loading…</td></tr>
                ) : forecastSummary.length === 0 ? (
                  <tr><td colSpan={8} className="px-4 py-8 text-center text-sm text-gray-400">
                    No forecast data yet — upload a Maini Forecast Excel above.
                  </td></tr>
                ) : (
                  forecastSummary.map((s) => (
                    <>
                      <tr key={s.customer_name} className="border-b border-gray-50 hover:bg-gray-50">
                        <td className="px-3 py-3">
                          <button onClick={() => toggleForecastExpand(s.customer_name)} className="text-gray-400 hover:text-indigo-600 transition-colors">
                            {expandedForecastCustomer === s.customer_name ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                          </button>
                        </td>
                        <td className="px-4 py-3 font-medium text-gray-900">{s.customer_name}</td>
                        <td className="px-4 py-3">
                          <span className="bg-indigo-100 text-indigo-700 text-xs rounded-full px-2 py-0.5 font-medium">{s.part_count}</span>
                        </td>
                        <td className="px-4 py-3 text-gray-500">{s.period_count} months</td>
                        <td className="px-4 py-3 font-semibold text-gray-700">{s.total_quantity?.toLocaleString()}</td>
                        <td className="px-4 py-3 text-gray-400 text-xs max-w-xs truncate">{s.source_file || '—'}</td>
                        <td className="px-4 py-3 text-gray-400 text-xs">{s.uploaded_at ? new Date(s.uploaded_at).toLocaleDateString('en-IN') : '—'}</td>
                        <td className="px-4 py-3">
                          <button onClick={() => handleForecastDelete(s.customer_name)} className="p-1 text-red-300 hover:text-red-600 rounded transition-colors" title="Delete all forecast for this customer">
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                      {/* Expanded part list */}
                      {expandedForecastCustomer === s.customer_name && (
                        <tr key={`${s.customer_name}-parts`}>
                          <td colSpan={8} className="bg-indigo-50/40 px-6 py-3 border-b border-indigo-100">
                            {forecastPartsLoading ? (
                              <p className="text-xs text-indigo-400">Loading parts…</p>
                            ) : (
                              <div className="overflow-x-auto">
                                <table className="w-full text-xs">
                                  <thead>
                                    <tr className="text-indigo-600 font-semibold">
                                      <th className="text-left py-1 pr-4 whitespace-nowrap">Part Number</th>
                                      <th className="text-right py-1 pr-4">Total Qty</th>
                                      <th className="text-left py-1">Period Range</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {forecastParts.slice(0, 50).map((p) => {
                                      const periods = Object.keys(p.schedule || {})
                                      const range = periods.length > 0 ? `${periods[0]} → ${periods[periods.length - 1]}` : '—'
                                      return (
                                        <tr key={p.part_number} className="border-t border-indigo-100/60">
                                          <td className="py-1 pr-4 font-mono text-gray-700 whitespace-nowrap">{p.part_number}</td>
                                          <td className="py-1 pr-4 text-right text-indigo-700 font-medium">{p.total_quantity?.toLocaleString()}</td>
                                          <td className="py-1 text-gray-500">{range}</td>
                                        </tr>
                                      )
                                    })}
                                    {forecastParts.length > 50 && (
                                      <tr><td colSpan={3} className="py-1 text-indigo-400 italic">… and {forecastParts.length - 50} more parts</td></tr>
                                    )}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-gray-400">
            When ZSO is generated, <strong>Internal Forecast</strong> rows from this table are automatically appended for matching customers — no extra steps needed.
          </p>
        </div>
      )}

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
