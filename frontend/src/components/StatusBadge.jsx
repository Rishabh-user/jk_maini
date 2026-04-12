const variants = {
  success: 'bg-green-100 text-green-700 border-green-200',
  processed: 'bg-green-100 text-green-700 border-green-200',
  confirmed: 'bg-green-100 text-green-700 border-green-200',
  active: 'bg-green-100 text-green-700 border-green-200',
  error: 'bg-red-100 text-red-700 border-red-200',
  failed: 'bg-red-100 text-red-700 border-red-200',
  pending: 'bg-orange-100 text-orange-700 border-orange-200',
  unprocessed: 'bg-orange-100 text-orange-700 border-orange-200',
  shipped: 'bg-purple-100 text-purple-700 border-purple-200',
  inactive: 'bg-gray-100 text-gray-600 border-gray-200',
  draft: 'bg-gray-100 text-gray-600 border-gray-200',
  manual: 'bg-gray-100 text-gray-700 border-gray-300',
}

export default function StatusBadge({ status }) {
  const key = status?.toLowerCase() || 'draft'
  const classes = variants[key] || variants.draft

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${classes}`}
    >
      {status}
    </span>
  )
}
