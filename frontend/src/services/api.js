import axios from 'axios'

// In production, VITE_API_URL points to the Render backend URL.
// In dev, the Vite proxy handles /api → localhost:8000.
const API_BASE = import.meta.env.VITE_API_URL
  ? import.meta.env.VITE_API_URL
  : '/api'

const api = axios.create({
  baseURL: API_BASE,
  headers: { 'Content-Type': 'application/json' },
})

// Attach JWT token to every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// Redirect to login on 401 (skip for login endpoint itself)
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401 && !err.config?.url?.includes('/auth/login')) {
      localStorage.removeItem('token')
      localStorage.removeItem('user')
      window.location.href = '/login'
    }
    return Promise.reject(err)
  }
)

// ─── Auth ────────────────────────────────────
export const loginUser = (email, password) =>
  api.post('/auth/login', { email, password })

// ─── Users ───────────────────────────────────
export const fetchUsers = () => api.get('/users/')
export const fetchMe = () => api.get('/users/me')
export const createUser = (data) => api.post('/users/', data)
export const updateUser = (id, data) => api.put(`/users/${id}`, data)

// ─── Dashboard ───────────────────────────────
export const fetchDashboardStats = () => api.get('/dashboard/stats')
export const fetchRecentActivity = () => api.get('/dashboard/recent-activity')

// ─── Emails ──────────────────────────────────
export const fetchEmails = (skip = 0, limit = 50, status, includeManual = false) => {
  const params = { skip, limit }
  if (status) params.status = status
  if (includeManual) params.include_manual = true
  return api.get('/emails/', { params })
}
export const fetchEmailById = (id) => api.get(`/emails/${id}`)
export const fetchGmailEmails = (maxResults = 20) =>
  api.post(`/emails/fetch?max_results=${maxResults}`)
export const processEmail = (id) => api.post(`/emails/process-email/${id}`)
export const deleteEmail = (id) => api.delete(`/emails/${id}`)

// ─── Attachments ─────────────────────────────
export const fetchAttachmentRawData = (id) =>
  api.get(`/attachments/${id}/raw-data`)

// ─── Master Data ─────────────────────────────
export const fetchMasterData = (search) => {
  const params = {}
  if (search) params.search = search
  return api.get('/master-data/', { params })
}
export const createMasterData = (data) => api.post('/master-data/', data)
export const updateMasterData = (id, data) => api.put(`/master-data/${id}`, data)
export const deleteMasterData = (id) => api.delete(`/master-data/${id}`)
export const uploadMasterData = (file) => {
  const formData = new FormData()
  formData.append('file', file)
  return api.post('/master-data/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
}

// ─── ZSO ─────────────────────────────────────
export const generateZSO = (emailId) =>
  api.post('/zso/generate', { email_id: emailId })
export const fetchZSOReports = () => api.get('/zso/')
export const fetchZSOById = (id) => api.get(`/zso/${id}`)
export const exportZSO = (id, visibleColumns = null) =>
  api.post(
    `/zso/export/${id}`,
    visibleColumns ? visibleColumns : null,   // send column list as JSON body when provided
    { responseType: 'blob' }
  )
export const mapColumns = (sourceColumns) =>
  api.post('/zso/map-columns', { source_columns: sourceColumns })

// ─── Demand Management ──────────────────────
export const fetchDemandStats = () => api.get('/demand/stats')
export const compareDemand = (currentId, previousId) =>
  api.post(`/demand/compare?current_report_id=${currentId}&previous_report_id=${previousId}`)
export const uploadDemandFile = (file, uploadType) => {
  const formData = new FormData()
  formData.append('file', file)
  return api.post(`/demand/upload?upload_type=${uploadType}`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
}
export const fetchDemandReports = () => api.get('/demand/reports')
export const fetchComparableReports = (reportId) => api.get(`/demand/comparable/${reportId}`)
export const fetchFollowups = (currentId, previousId) =>
  api.get('/demand/followups', { params: { current_report_id: currentId, previous_report_id: previousId } })
export const createFollowup = (payload) => api.post('/demand/followups', payload)
export const updateFollowup = (id, payload) => api.patch(`/demand/followups/${id}`, payload)
export const deleteFollowup = (id) => api.delete(`/demand/followups/${id}`)
export const fetchDemandUploads = (type) => api.get('/demand/uploads', { params: type ? { upload_type: type } : {} })
export const previewDemandUpload = (id) => api.get(`/demand/uploads/${id}/preview`)
export const deleteDemandUpload = (id) => api.delete(`/demand/uploads/${id}`)

export const fetchCorrections = (status) => api.get('/demand/corrections', { params: status ? { status } : {} })
export const fetchCorrectionStats = () => api.get('/demand/corrections/stats')
export const createCorrection = (data) => api.post('/demand/corrections', data)
export const reviewCorrection = (id, data) => api.put(`/demand/corrections/${id}/review`, data)
export const deleteCorrection = (id) => api.delete(`/demand/corrections/${id}`)

// ─── Inventory & Liquidation ────────────────
export const fetchInventorySummary = () => api.get('/inventory/summary')
export const uploadStockFile = (file, stockType) => {
  const formData = new FormData()
  formData.append('file', file)
  return api.post(`/inventory/upload-stock?stock_type=${stockType}`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
}
export const runAllocation = (allocationType, zsoReportId) => {
  const params = new URLSearchParams({ allocation_type: allocationType })
  if (zsoReportId) params.append('zso_report_id', zsoReportId)
  return api.post(`/inventory/allocate?${params.toString()}`)
}
export const fetchAllocations = () => api.get('/inventory/allocations')
export const fetchAllocationDetail = (id) => api.get(`/inventory/allocations/${id}`)
export const deleteStock = (stockType) =>
  api.delete('/inventory/stock', { params: stockType ? { stock_type: stockType } : {} })
export const deleteAllocations = () => api.delete('/inventory/allocations')

// ─── Coverage Report ────────────────────────
export const generateCoverage = (allocationId) => {
  const params = allocationId ? `?allocation_id=${allocationId}` : ''
  return api.post(`/coverage/generate${params}`)
}
export const fetchCoverageReport = (reportId) => {
  const params = reportId ? `?report_id=${reportId}` : ''
  return api.get(`/coverage/report${params}`)
}
export const fetchCoverageExceptions = (reportId) => {
  const params = reportId ? `?report_id=${reportId}` : ''
  return api.get(`/coverage/exceptions${params}`)
}
export const fetchCoverageReports = () => api.get('/coverage/reports')

// ─── Performance Dashboard ──────────────────
export const fetchDemandVsActual = (fiscalYear) =>
  api.get(`/performance/demand-vs-actual?fiscal_year=${fiscalYear}`)
export const uploadSalesData = (file, fiscalYear) => {
  const formData = new FormData()
  formData.append('file', file)
  return api.post(`/performance/upload-sales?fiscal_year=${fiscalYear}`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
}
export const uploadBudgetData = (file, fiscalYear) => {
  const formData = new FormData()
  formData.append('file', file)
  return api.post(`/performance/upload-budget?fiscal_year=${fiscalYear}`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
}
export const fetchBudgetVsActual = (fiscalYear) =>
  api.get(`/performance/budget-vs-actual?fiscal_year=${fiscalYear}`)
export const fetchPerformanceKPIs = (fiscalYear) =>
  api.get(`/performance/kpis?fiscal_year=${fiscalYear}`)

// ─── Document Upload ───────────────────────
export const uploadDocument = (file, autoProcess = true) => {
  const formData = new FormData()
  formData.append('file', file)
  return api.post(`/uploads/document?process=${autoProcess}`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
}
export const processUpload = (uploadId) =>
  api.post(`/uploads/document/${uploadId}/process`)
export const fetchUploads = (skip = 0, limit = 50) =>
  api.get(`/uploads/documents?skip=${skip}&limit=${limit}`)
export const deleteUpload = (uploadId) =>
  api.delete(`/uploads/document/${uploadId}`)

// ─── Forex Rates ──────────────────────────
export const fetchForexRates = () => api.get('/forex/')
export const fetchCurrentForexRates = () => api.get('/forex/current')
export const addForexRate = (data) => api.post('/forex/', data)
export const deleteForexRate = (id) => api.delete(`/forex/${id}`)

// ─── Internal Forecast Data ──────────────────
export const fetchForecastSummary = () => api.get('/forecast-data/summary')
export const fetchForecastParts = (customer) => api.get('/forecast-data/parts', { params: { customer } })
export const uploadForecastFile = (file, customerName) => {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('customer_name', customerName)
  return api.post('/forecast-data/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
}
export const deleteForecastCustomer = (customerName) =>
  api.delete(`/forecast-data/${encodeURIComponent(customerName)}`)

export default api
