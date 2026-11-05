type BibEntryFeedbackProps = {
  message: string
  variant?: 'error' | 'warning'
}

const variantOptions = {
  error: {
    className: 'text-danger',
    icon: 'error',
  },
  warning: {
    className: 'text-warning',
    icon: 'warning',
  },
} as const

export default function BibEntryFeedback({
  message,
  variant = 'error',
}: BibEntryFeedbackProps) {
  const { className, icon } = variantOptions[variant]

  return (
    <div className="invalid-feedback">
      <small className={`${className} form-text`}>
        <span className="form-text-inner">
          <span className="material-symbols" aria-hidden="true" translate="no">
            {icon}
          </span>
          <span>{message}</span>
        </span>
      </small>
    </div>
  )
}
