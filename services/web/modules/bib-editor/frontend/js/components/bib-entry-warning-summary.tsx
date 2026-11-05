type BibEntryWarningSummaryProps = {
  missingFields: string[]
  badlyFormattedFields: string[]
  requiredFieldsTitle: string
  badlyFormattedFieldsTitle: string
  listFields?: boolean
}

export default function BibEntryWarningSummary({
  missingFields,
  badlyFormattedFields,
  requiredFieldsTitle,
  badlyFormattedFieldsTitle,
  listFields = false,
}: BibEntryWarningSummaryProps) {
  const renderFields = (fields: string[]) =>
    listFields ? (
      <ul>
        {fields.map(field => <li key={field}>{field}</li>)}
      </ul>
    ) : (
      <>
        <br />
        {fields.join(', ')}
      </>
    )

  return (
    <>
      {missingFields.length > 0 && (
        <>
          <strong>{requiredFieldsTitle}</strong>
          {renderFields(missingFields)}
        </>
      )}
      {!listFields && missingFields.length > 0 && badlyFormattedFields.length > 0 && (
        <>
          <br />
          <br />
        </>
      )}
      {badlyFormattedFields.length > 0 && (
        <>
          <strong>{badlyFormattedFieldsTitle}</strong>
          {renderFields(badlyFormattedFields)}
        </>
      )}
    </>
  )
}
