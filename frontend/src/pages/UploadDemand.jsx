import { useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle2, FileUp, FolderUp, Loader2, Upload, XCircle } from 'lucide-react'
import { uploadDemandFiles } from '../services/api'

const SUPPORTED_EXTENSIONS = ['pdf', 'xlsx', 'xls', 'csv', 'png', 'jpg', 'jpeg', 'tiff', 'bmp']

function fileKey(file) {
  return `${file.webkitRelativePath || file.name}-${file.size}-${file.lastModified}`
}

export default function UploadDemand() {
  const [files, setFiles] = useState([])
  const [uploading, setUploading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const folderInputRef = useRef(null)

  useEffect(() => {
    if (folderInputRef.current) {
      folderInputRef.current.setAttribute('webkitdirectory', '')
      folderInputRef.current.setAttribute('directory', '')
    }
  }, [])

  const validFiles = useMemo(() => {
    return files.filter((file) => {
      const ext = file.name.includes('.') ? file.name.split('.').pop().toLowerCase() : ''
      return SUPPORTED_EXTENSIONS.includes(ext)
    })
  }, [files])

  const unsupportedCount = files.length - validFiles.length

  const addFiles = (selectedFiles) => {
    const incoming = Array.from(selectedFiles || [])
    setResult(null)
    setError('')
    setFiles((current) => {
      const merged = [...current]
      const seen = new Set(current.map(fileKey))
      incoming.forEach((file) => {
        const key = fileKey(file)
        if (!seen.has(key)) {
          merged.push(file)
          seen.add(key)
        }
      })
      return merged
    })
  }

  const removeFile = (target) => {
    setFiles((current) => current.filter((file) => fileKey(file) !== fileKey(target)))
  }

  const clearFiles = () => {
    setFiles([])
    setResult(null)
    setError('')
  }

  const handleUpload = async () => {
    if (!validFiles.length) {
      setError('Select at least one supported demand file.')
      return
    }

    setUploading(true)
    setError('')
    setResult(null)

    try {
      const res = await uploadDemandFiles(validFiles)
      setResult(res.data)
      setFiles([])
    } catch (err) {
      setError(err.response?.data?.detail || 'Upload failed. Please try again.')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Upload Demand</h1>
        <p className="text-sm text-gray-500 mt-1">
          Upload files directly into the same extraction flow used for email attachments.
        </p>
      </div>

      <div>
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <div className="border-2 border-dashed border-gray-200 rounded-lg p-8 text-center">
            <div className="w-12 h-12 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center mx-auto mb-4">
              <Upload size={24} />
            </div>
            <h2 className="text-lg font-semibold text-gray-900">Select demand files</h2>
            <p className="text-sm text-gray-500 mt-2">
              PDF, Excel, CSV, and image files are processed automatically after upload.
            </p>

            <div className="flex flex-wrap justify-center gap-3 mt-6">
              <label className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white cursor-pointer hover:bg-blue-700">
                <FileUp size={16} />
                Choose Files
                <input
                  type="file"
                  multiple
                  className="hidden"
                  accept=".pdf,.xlsx,.xls,.csv,.png,.jpg,.jpeg,.tiff,.bmp"
                  onChange={(e) => addFiles(e.target.files)}
                />
              </label>

              <label className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-white text-gray-700 border border-gray-200 cursor-pointer hover:bg-gray-50">
                <FolderUp size={16} />
                Choose Folder
                <input
                  ref={folderInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => addFiles(e.target.files)}
                />
              </label>
            </div>
          </div>

          <div className="mt-6">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div>
                <h3 className="text-sm font-semibold text-gray-900">Selected Files</h3>
                <p className="text-xs text-gray-500">
                  {validFiles.length} supported file{validFiles.length === 1 ? '' : 's'}
                  {unsupportedCount > 0 ? `, ${unsupportedCount} skipped` : ''}
                </p>
              </div>
              {files.length > 0 && (
                <button
                  type="button"
                  onClick={clearFiles}
                  className="text-sm text-gray-500 hover:text-gray-700"
                >
                  Clear
                </button>
              )}
            </div>

            <div className="border border-gray-200 rounded-lg overflow-hidden">
              {files.length === 0 ? (
                <div className="px-4 py-8 text-sm text-gray-500 text-center">
                  No files selected.
                </div>
              ) : (
                <div className="divide-y divide-gray-100 max-h-80 overflow-y-auto">
                  {files.map((file) => {
                    const ext = file.name.includes('.') ? file.name.split('.').pop().toLowerCase() : ''
                    const supported = SUPPORTED_EXTENSIONS.includes(ext)
                    return (
                      <div key={fileKey(file)} className="flex items-center justify-between gap-3 px-4 py-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-800 truncate">
                            {file.webkitRelativePath || file.name}
                          </p>
                          <p className="text-xs text-gray-500">
                            {(file.size / 1024).toFixed(1)} KB
                            {!supported ? ' - unsupported format' : ''}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeFile(file)}
                          className="text-gray-400 hover:text-gray-700"
                          aria-label={`Remove ${file.name}`}
                        >
                          <XCircle size={18} />
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {error && (
              <div className="mt-4 px-4 py-3 rounded-lg bg-red-50 border border-red-100 text-sm text-red-700">
                {error}
              </div>
            )}

            <div className="mt-5 flex items-center gap-3">
              <button
                type="button"
                onClick={handleUpload}
                disabled={uploading || validFiles.length === 0}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {uploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                {uploading ? 'Processing...' : 'Upload and Process'}
              </button>
              <span className="text-xs text-gray-500">
                Files are processed immediately.
              </span>
            </div>
          </div>
        </div>
      </div>

      {result && (
        <div className="mt-6 bg-white border border-gray-200 rounded-lg p-5">
          <div className="flex items-center gap-2 mb-4">
            <CheckCircle2 size={20} className="text-green-600" />
            <h2 className="text-lg font-semibold text-gray-900">Upload Complete</h2>
          </div>
          <p className="text-sm text-gray-600 mb-4">
            Processed {result.processed} file{result.processed === 1 ? '' : 's'}
            {result.failed ? `, ${result.failed} failed` : ''}. Batch email ID: {result.email_id}.
          </p>
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase px-4 py-3">File</th>
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase px-4 py-3">Status</th>
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase px-4 py-3">Rows</th>
                </tr>
              </thead>
              <tbody>
                {(result.results || []).map((item) => (
                  <tr key={item.filename} className="border-b border-gray-50">
                    <td className="px-4 py-3 text-sm text-gray-700">{item.filename}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{item.status}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{item.rows ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
