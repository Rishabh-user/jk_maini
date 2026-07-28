import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { AgGridReact } from 'ag-grid-react'
import { AllCommunityModule, ModuleRegistry, themeQuartz } from 'ag-grid-community'
import { Search, Plus, Pencil, Trash2, X, Upload, RefreshCw, TrendingUp, Calendar, ChevronDown, ChevronRight, Check, CheckCircle2 } from 'lucide-react'
import { fetchMasterData, createMasterData, updateMasterData, deleteMasterData, uploadMasterData, fetchForexRates, addForexRate, updateForexRate, activateForexRate, deleteForexRate, fetchForecastSummary, fetchForecastParts, uploadForecastFile, deleteForecastCustomer } from '../services/api'
import { useDialog } from '../components/DialogProvider'
import { formatError } from '../utils/formatError'

ModuleRegistry.registerModules([AllCommunityModule])

const emptyForm = { customer_name: '', customer_location: '', sold_to_party: '', ship_to_party: '', customer_part_no: '', maini_part_no: '', description: '', country: '', unit_price: '', currency: 'INR', incoterm: '', hsn_code: '' }
const emptyForexForm = { currency_from: 'USD', currency_to: 'INR', rate: '', effective_date: '', notes: '' }
// Supported source currencies for conversion to INR
const FOREX_FROM_CURRENCIES = ['USD', 'EUR', 'GBP']
const FOREX_TO_CURRENCIES = ['INR']

export default function MasterData() {
  const dialog = useDialog()
  const gridRef = useRef(null)
  // `data` holds only the CURRENT PAGE's rows — server-side pagination,
  // not a client-side slice of an all-rows array. `total` is the
  // table-wide row count from the server, used for the pager UI.
  // `extraColumns` is the union of extra_data keys across the WHOLE
  // table (also from the server) — any column an upload couldn't map to
  // a known field still shows up here as a real AG Grid column instead
  // of being silently dropped.
  const [data, setData] = useState([])
  const [total, setTotal] = useState(0)
  const [extraColumns, setExtraColumns] = useState([])
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('') // debounced into `search`
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editItem, setEditItem] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef(null)
  const [activeTab, setActiveTab] = useState('parts')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)

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
      await dialog.alert('Please enter the customer name before uploading.')
      return
    }
    setForecastUploading(true)
    try {
      const res = await uploadForecastFile(file, forecastCustomerName.trim())
      const { inserted, part_count, period_count } = res.data
      await dialog.alert('Forecast uploaded!', {
        detail: `${part_count} parts x ${period_count} periods\n${inserted} total entries saved for "${forecastCustomerName.trim()}"`,
      })
      setForecastCustomerName('')
      await loadForecastSummary()
    } catch (err) {
      await dialog.alert('Upload failed', { tone: 'danger', detail: formatError(err) })
    } finally {
      setForecastUploading(false)
      if (forecastFileRef.current) forecastFileRef.current.value = ''
    }
  }

  const handleForecastDelete = async (customerName) => {
    if (!(await dialog.confirm(`Delete ALL forecast data for "${customerName}"?`, { title: 'Delete forecast data' }))) return
    try {
      await deleteForecastCustomer(customerName)
      if (expandedForecastCustomer === customerName) {
        setExpandedForecastCustomer(null)
        setForecastParts([])
      }
      await loadForecastSummary()
    } catch (err) {
      await dialog.alert('Delete failed', { tone: 'danger', detail: formatError(err) })
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
  // Set while editing an EXISTING rate (Edit pencil) — the form switches
  // to "Edit Rate" mode and Save calls the update endpoint instead of
  // create. null means the form is in normal "add a new rate" mode.
  const [editingRateId, setEditingRateId] = useState(null)
  // Tracks which single rate row is mid-activate, so only that row's
  // button shows a spinner rather than the whole table.
  const [activatingId, setActivatingId] = useState(null)
  // Shown right after a Master Data upload completes — reuses the exact
  // same "Add New Rate" UI as the Forex Rates tab so users don't forget
  // to keep rates current for the currencies they just uploaded pricing
  // in (this is the gap that caused a real ZSO report to show un-converted
  // USD prices — the rate simply didn't exist yet when it was generated).
  const [showForexReminder, setShowForexReminder] = useState(false)
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
      if (editingRateId) {
        // Edit mode — update in place. Does NOT change which rate is
        // active; that's a separate, explicit action (the Activate
        // button) so fixing a typo can never accidentally flip which
        // rate ZSO reports use.
        await updateForexRate(editingRateId, {
          currency_to: forexForm.currency_to.toUpperCase(),
          rate: parseFloat(forexForm.rate),
          effective_date: new Date(forexForm.effective_date).toISOString(),
          notes: forexForm.notes || null,
        })
        setEditingRateId(null)
      } else {
        // New rate — becomes active immediately (see backend docstring):
        // matches "the rate I just entered is the one now in effect".
        await addForexRate({
          currency_from: forexForm.currency_from.toUpperCase(),
          currency_to: forexForm.currency_to.toUpperCase(),
          rate: parseFloat(forexForm.rate),
          effective_date: new Date(forexForm.effective_date).toISOString(),
          notes: forexForm.notes || null,
        })
      }
      setForexForm(emptyForexForm)
      setShowForexForm(false)
      await loadForexRates()
    } catch (err) {
      await dialog.alert(editingRateId ? 'Failed to update rate' : 'Failed to save rate', { tone: 'danger', detail: formatError(err) })
    } finally {
      setForexSaving(false)
    }
  }

  // Loads an existing rate's values into the form and switches it to
  // edit mode. Currency From is intentionally left as-is in the form but
  // the backend ignores any change to it — see ForexRateUpdate's comment.
  const startEditForexRate = (rate) => {
    setEditingRateId(rate.id)
    setForexForm({
      currency_from: rate.currency_from,
      currency_to: rate.currency_to,
      rate: String(rate.rate),
      effective_date: rate.effective_date ? new Date(rate.effective_date).toISOString().slice(0, 10) : '',
      notes: rate.notes || '',
    })
  }

  const cancelEditForexRate = () => {
    setEditingRateId(null)
    setForexForm(emptyForexForm)
  }

  const handleActivateForexRate = async (id) => {
    setActivatingId(id)
    try {
      await activateForexRate(id)
      await loadForexRates()
    } catch (err) {
      await dialog.alert('Failed to activate rate', { tone: 'danger', detail: formatError(err) })
    } finally {
      setActivatingId(null)
    }
  }

  const handleDeleteForexRate = async (id) => {
    if (!(await dialog.confirm('Delete this forex rate?'))) return
    try {
      await deleteForexRate(id)
      if (editingRateId === id) cancelEditForexRate()
      await loadForexRates()
    } catch (err) {
      await dialog.alert('Delete failed', { tone: 'danger', detail: formatError(err) })
    }
  }

  // The "Add New Rate" form + rates table — extracted so the EXACT same
  // markup renders both in the Forex Rates tab and in the post-upload
  // reminder modal (setShowForexReminder), rather than keeping two copies
  // that could drift apart. Closes over the component's own state/handlers,
  // so it's a plain function, not a separate component.
  function renderForexRateManager() {
    const isEditing = editingRateId !== null
    return (
      <>
        {/* Add / Edit rate form */}
        <div className={`bg-white border rounded-lg p-5 mb-4 ${isEditing ? 'border-amber-300 ring-1 ring-amber-100' : 'border-gray-200'}`}>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-gray-900">
              {isEditing ? `Edit Rate #${editingRateId}` : 'Add New Rate'}
            </h3>
            <button onClick={loadForexRates} className="p-1.5 rounded hover:bg-gray-100" title="Refresh list">
              <RefreshCw size={14} className={forexLoading ? 'animate-spin text-blue-500' : 'text-gray-400'} />
            </button>
          </div>
          {!isEditing && (
            <>
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
            </>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 items-end">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">From Currency</label>
              <select value={forexForm.currency_from}
                onChange={(e) => setForexForm({ ...forexForm, currency_from: e.target.value })}
                disabled={isEditing}
                title={isEditing ? "Can't change currency on an existing rate — add a new rate instead" : undefined}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:ring-2 focus:ring-emerald-500 focus:outline-none disabled:bg-gray-50 disabled:text-gray-400">
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
          {isEditing && (
            <p className="mt-2 text-xs text-amber-700">
              Editing does not change which rate is active — use the "Activate" button in the table to switch that.
            </p>
          )}
          <div className="flex justify-end gap-2 mt-4">
            {isEditing && (
              <button onClick={cancelEditForexRate} disabled={forexSaving}
                className="px-4 py-2 text-sm font-medium text-gray-600 rounded-lg hover:bg-gray-100 disabled:opacity-50">
                Cancel
              </button>
            )}
            <button onClick={handleAddForexRate} disabled={forexSaving || !forexForm.rate || !forexForm.effective_date}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium text-white rounded-lg disabled:opacity-50 ${isEditing ? 'bg-amber-600 hover:bg-amber-700' : 'bg-emerald-600 hover:bg-emerald-700'}`}>
              {isEditing ? <Pencil size={15} /> : <Plus size={15} />}
              {forexSaving ? 'Saving...' : isEditing ? 'Update Rate' : 'Save Rate'}
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
                forexRates.map((r) => (
                  <tr key={r.id} className={`border-b border-gray-50 hover:bg-gray-50 ${r.is_active ? 'bg-emerald-50/40' : ''} ${editingRateId === r.id ? 'ring-1 ring-inset ring-amber-300' : ''}`}>
                    <td className="px-4 py-3 font-semibold text-gray-700">{r.currency_from}</td>
                    <td className="px-4 py-3 text-gray-500">{r.currency_to}</td>
                    <td className="px-4 py-3">
                      <span className="font-bold text-emerald-700">{r.rate}</span>
                      {r.is_active && <span className="ml-2 text-[10px] bg-emerald-100 text-emerald-600 rounded-full px-1.5 py-0.5 font-medium">ACTIVE</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-500">{new Date(r.effective_date).toLocaleDateString('en-IN')}</td>
                    <td className="px-4 py-3 text-gray-400 max-w-xs truncate">{r.notes || '—'}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{new Date(r.created_at).toLocaleDateString('en-IN')}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        {r.is_active ? (
                          <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 px-2 py-1" title="This is the rate ZSO reports currently use">
                            <CheckCircle2 size={13} /> In use
                          </span>
                        ) : (
                          <button
                            onClick={() => handleActivateForexRate(r.id)}
                            disabled={activatingId === r.id}
                            title={`Switch ${r.currency_from}→${r.currency_to} to use this rate`}
                            className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-600 hover:bg-blue-50 rounded px-2 py-1 disabled:opacity-50"
                          >
                            <Check size={13} /> {activatingId === r.id ? 'Activating...' : 'Activate'}
                          </button>
                        )}
                        <button onClick={() => startEditForexRate(r)} className="p-1 text-gray-400 hover:text-amber-600 rounded transition-colors" title="Edit this rate">
                          <Pencil size={14} />
                        </button>
                        <button onClick={() => handleDeleteForexRate(r.id)} className="p-1 text-red-300 hover:text-red-600 rounded transition-colors" title="Delete this rate">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-gray-400">
          The row marked ACTIVE / "In use" is the one ZSO report generation reads. Click "Activate" on any other
          rate to switch — useful when you've entered a few candidate rates and want to pick one, or need to
          revert to an earlier rate.
        </p>
      </>
    )
  }

  // Debounce the raw search input into `search` so typing doesn't fire a
  // network request per keystroke. 350ms is enough to let a normal typist
  // finish a word.
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 350)
    return () => clearTimeout(t)
  }, [searchInput])

  // Any filter change invalidates the current page — start back at page 1,
  // otherwise you could land on "page 5" of a search result that only has
  // 2 pages.
  useEffect(() => { setPage(1) }, [search, pageSize])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetchMasterData(search, (page - 1) * pageSize, pageSize)
      setData(res.data?.items || [])
      setTotal(res.data?.total || 0)
      setExtraColumns(res.data?.extra_columns || [])
    } catch (err) {
      console.error('Failed to load master data:', err)
    } finally {
      setLoading(false)
    }
  }, [search, page, pageSize])

  useEffect(() => { load() }, [load])
  useEffect(() => { loadForexRates() }, [loadForexRates])
  useEffect(() => { loadForecastSummary() }, [loadForecastSummary])

  // Search now happens server-side (see `load`) — filtering is already
  // done by the time `data` arrives, so no client-side filter here.
  // Pagination math is derived from the server's `total`, not a
  // client-side array length.
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const pageSafe = Math.min(page, totalPages)

  // ── AG Grid column definitions ──────────────────────────────────────────
  // EVERY MainiPart field gets a column — the old plain <table> only
  // rendered a subset (Customer Name/Location/Part#s/Description/Country/
  // Incoterm) and silently never showed Unit Price, Currency, or HSN Code
  // even though they exist on every row. Fixed here: show all of them.
  //
  // Any column an Excel upload couldn't map to a known field (see
  // app/services/master_data_mapping.py) lands in `extra_data` instead of
  // being dropped — `extraColumns` (from the server, table-wide) gets one
  // AG Grid column per such key so that data is visible too, not just
  // preserved invisibly in the database.
  const actionsRenderer = useCallback((params) => (
    <div className="flex items-center gap-2 h-full">
      <button
        type="button"
        onClick={() => openEdit(params.data)}
        className="p-1.5 rounded hover:bg-gray-100 text-gray-500"
        title="Edit"
      >
        <Pencil size={15} />
      </button>
      <button
        type="button"
        onClick={() => handleDelete(params.data.id)}
        className="p-1.5 rounded hover:bg-red-50 text-red-500"
        title="Delete"
      >
        <Trash2 size={15} />
      </button>
    </div>
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [])

  const columnDefs = useMemo(() => {
    const cols = [
      {
        headerName: 'S No',
        width: 80,
        valueGetter: (p) => (pageSafe - 1) * pageSize + (p.node?.rowIndex ?? 0) + 1,
        sortable: false,
        filter: false,
        pinned: 'left',
      },
      { field: 'customer_name',     headerName: 'Customer Name',     minWidth: 160 },
      { field: 'customer_location', headerName: 'Location',          minWidth: 130 },
      { field: 'sold_to_party',     headerName: 'Sold To Party',     minWidth: 150 },
      { field: 'ship_to_party',     headerName: 'Ship To Party',     minWidth: 150 },
      { field: 'customer_part_no',  headerName: 'Customer Part #',   minWidth: 160, pinned: 'left' },
      { field: 'maini_part_no',     headerName: 'Maini Part #',      minWidth: 150 },
      { field: 'description',       headerName: 'Description',       minWidth: 220 },
      { field: 'country',           headerName: 'Country',           minWidth: 110 },
      {
        field: 'unit_price', headerName: 'Unit Price', minWidth: 120, type: 'numericColumn',
        valueFormatter: (p) => p.value != null ? Number(p.value).toLocaleString('en-IN', { maximumFractionDigits: 4 }) : '-',
      },
      { field: 'currency',  headerName: 'Currency',  minWidth: 100 },
      { field: 'incoterm',  headerName: 'Incoterm',  minWidth: 100 },
      { field: 'hsn_code',  headerName: 'HSN Code',  minWidth: 110 },
      // Dynamic "extra" columns — one per unmapped-upload key seen
      // anywhere in the table. Reading from `extra_data` on each row.
      ...extraColumns.map((key) => ({
        headerName: key,
        colId: `extra__${key}`,
        minWidth: 150,
        valueGetter: (p) => p.data?.extra_data?.[key] ?? null,
        cellClass: 'text-amber-700',
        headerClass: 'ag-header-extra',
      })),
      {
        headerName: 'Actions', width: 100, pinned: 'right',
        sortable: false, filter: false, resizable: false,
        cellRenderer: actionsRenderer,
      },
    ]
    return cols
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extraColumns, pageSafe, pageSize, actionsRenderer])

  const defaultColDef = useMemo(() => ({
    sortable: true,
    resizable: true,
    cellStyle: { color: '#374151', fontSize: '13px', display: 'flex', alignItems: 'center' },
  }), [])

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
      sold_to_party: item.sold_to_party || '',
      ship_to_party: item.ship_to_party || '',
      customer_part_no: item.customer_part_no || '',
      maini_part_no: item.maini_part_no || '',
      description: item.description || '',
      country: item.country || '',
      unit_price: item.unit_price != null ? String(item.unit_price) : '',
      currency: item.currency || 'INR',
      incoterm: item.incoterm || '',
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
      await dialog.alert('Save failed', { tone: 'danger', detail: formatError(err) })
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id) => {
    if (!(await dialog.confirm('Are you sure you want to delete this entry?', { title: 'Delete entry' }))) return
    try {
      await deleteMasterData(id)
      await load()
    } catch (err) {
      await dialog.alert('Delete failed', { tone: 'danger', detail: formatError(err) })
    }
  }

  const handleUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const res = await uploadMasterData(file)
      const { inserted, updated, total_rows, column_mapping, unmapped_columns } = res.data

      // Surface exactly what the alias list + Claude decided for each
      // column — mapped columns went straight to a known field; anything
      // in unmapped_columns is still fully preserved, just as an "extra"
      // column (visible in the grid) rather than a fixed schema field.
      const mappedCount = column_mapping
        ? Object.values(column_mapping).filter((v) => v !== 'UNMAPPED').length
        : 0
      const mappingLines = column_mapping
        ? Object.entries(column_mapping).map(([src, field]) => `  "${src}" -> ${field}`).join('\n')
        : ''
      const extraNote = unmapped_columns?.length
        ? `\n\n${unmapped_columns.length} column(s) didn't match a known field — kept as extra data (still visible as columns in the grid, nothing was dropped):\n  ${unmapped_columns.join(', ')}`
        : ''

      await dialog.alert('Upload complete!', {
        detail:
          `${total_rows} rows processed - ${inserted} new, ${updated} updated\n` +
          `${mappedCount} column(s) mapped to known fields via alias/AI matching:\n${mappingLines}` +
          extraNote,
      })
      await load()
      // Prompt for a forex rate right after upload — new/updated parts
      // routinely bring in a new currency (or stale pricing), and a
      // report generated before the right rate exists silently shows
      // un-converted values with no error. Refresh the rates list first
      // so the reminder modal shows what's ACTUALLY current, not stale
      // state from before the upload.
      await loadForexRates()
      setShowForexReminder(true)
    } catch (err) {
      await dialog.alert('Upload failed', { tone: 'danger', detail: formatError(err) })
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
          <span className="ml-2 text-xs rounded-full bg-gray-100 text-gray-500 px-1.5 py-0.5">{total}</span>
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
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
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

      {/* AG Grid — server-side pagination: `data` only ever holds the
          CURRENT PAGE's rows (see `load`), fetched fresh from the server
          on every page/pageSize/search change. AG Grid's own `pagination`
          prop is intentionally OFF since there's only ever one page's
          worth of rows in the grid at a time — page navigation is our own
          footer below, driving a real network request each time. */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div style={{ width: '100%', height: '60vh', minHeight: 400 }}>
          <AgGridReact
            ref={gridRef}
            theme={themeQuartz}
            rowData={data}
            columnDefs={columnDefs}
            defaultColDef={defaultColDef}
            loading={loading}
            rowHeight={42}
            headerHeight={42}
            pagination={false}
            enableCellTextSelection={true}
            suppressRowClickSelection={true}
            animateRows={true}
            suppressMenuHide={true}
            overlayNoRowsTemplate={
              '<span style="padding:12px;color:#6b7280;font-size:13px;">No master data entries. Upload an Excel file or click "Add Entry".</span>'
            }
          />
        </div>
      </div>

      {/* Pagination footer — same UI as before, now driven by the
          server's `total` instead of a client-side array length. */}
      {total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 mt-3 text-sm text-gray-600">
          <div className="flex items-center gap-2">
            <span>Rows per page:</span>
            <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}
              className="border border-gray-200 rounded-md px-2 py-1 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
              {[25, 50, 100, 200].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
            <span className="text-gray-400">
              {(pageSafe - 1) * pageSize + 1}–{Math.min(pageSafe * pageSize, total)} of {total}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage(1)} disabled={pageSafe <= 1}
              className="px-2 py-1 rounded-md border border-gray-200 hover:bg-gray-50 disabled:opacity-40">« First</button>
            <button onClick={() => setPage(pageSafe - 1)} disabled={pageSafe <= 1}
              className="px-2 py-1 rounded-md border border-gray-200 hover:bg-gray-50 disabled:opacity-40">‹ Prev</button>
            <span className="px-2">Page {pageSafe} of {totalPages}</span>
            <button onClick={() => setPage(pageSafe + 1)} disabled={pageSafe >= totalPages}
              className="px-2 py-1 rounded-md border border-gray-200 hover:bg-gray-50 disabled:opacity-40">Next ›</button>
            <button onClick={() => setPage(totalPages)} disabled={pageSafe >= totalPages}
              className="px-2 py-1 rounded-md border border-gray-200 hover:bg-gray-50 disabled:opacity-40">Last »</button>
          </div>
        </div>
      )}

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

          {renderForexRateManager()}
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
                { key: 'sold_to_party', label: 'Sold To Party' },
                { key: 'ship_to_party', label: 'Ship To Party' },
                { key: 'customer_part_no', label: 'Customer Part #' },
                { key: 'maini_part_no', label: 'Maini Part #' },
                { key: 'description', label: 'Description' },
                { key: 'country', label: 'Country' },
                { key: 'unit_price', label: 'Unit Price', type: 'number' },
                { key: 'currency', label: 'Currency' },
                { key: 'incoterm', label: 'Incoterm' },
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

      {/* Post-upload forex-rate reminder — same "Add New Rate" form + table
          as the Forex Rates tab (via renderForexRateManager), so setting a
          rate right after an upload works identically to doing it from the
          tab. This exists because a report generated before the right
          currency's rate is entered silently shows un-converted values —
          see the "Unit Price INR" investigation. */}
      {showForexReminder && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[85vh] overflow-y-auto p-6">
            <div className="flex justify-between items-start mb-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Don't forget to update Forex Rates</h2>
                <p className="text-sm text-gray-500 mt-1">
                  Master data was just uploaded — if it introduced pricing in a new currency (or the
                  existing rate is stale), update it now. Any ZSO report generated before a currency's
                  rate exists will show un-converted values with no INR conversion.
                </p>
              </div>
              <button onClick={() => setShowForexReminder(false)} className="p-1 rounded hover:bg-gray-100 shrink-0">
                <X size={18} />
              </button>
            </div>

            {renderForexRateManager()}

            <div className="flex justify-end gap-3 mt-2">
              <button
                onClick={() => setShowForexReminder(false)}
                className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
