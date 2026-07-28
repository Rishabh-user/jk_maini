// Turns any thrown error into a human-readable message.
//
// Handles the common shapes that show up in this app:
//   * FastAPI 4xx / 5xx with a scalar detail string    -> use detail
//   * FastAPI 422 with an array of validation objects  -> "field: message; …"
//   * axios NetworkError                                -> "Cannot reach the server."
//   * plain Error                                       -> err.message
//
// Without this helper, ~20 pages in the app were calling
//   err.response?.data?.detail || err.message
// which on a 422 evaluates to `[object Object]` in red text because
// `detail` is an Array of {loc, msg, type} — truthy but not a string.
//
// Usage:
//   try { ... } catch (err) { setError(formatError(err)) }
export function formatError(err, fallback = 'Something went wrong.') {
  if (!err) return fallback

  // axios network-level failure (no HTTP status)
  if (err.code === 'ERR_NETWORK' || (err.message && /Network Error/i.test(err.message))) {
    return 'Cannot reach the server. Is the backend running?'
  }

  const detail = err.response?.data?.detail
  if (typeof detail === 'string' && detail.trim()) return detail
  if (Array.isArray(detail) && detail.length > 0) {
    return detail
      .map((d) => {
        if (typeof d === 'string') return d
        // FastAPI 422 shape: { loc: ['body','email'], msg: 'field required', type: '...' }
        const where = Array.isArray(d?.loc)
          ? d.loc.filter((p) => p !== 'body').join('.')
          : ''
        const msg = d?.msg || JSON.stringify(d)
        return where ? `${where}: ${msg}` : msg
      })
      .join('; ')
  }
  if (detail && typeof detail === 'object') {
    return JSON.stringify(detail)
  }

  // Non-axios errors (`throw new Error(...)`)
  if (typeof err.message === 'string' && err.message.trim()) return err.message

  return fallback
}
