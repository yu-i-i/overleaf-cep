import { deleteJSON, postJSON } from '@/infrastructure/fetch-json'
import { Template } from '../../../../../types/template'

export function deleteTemplate(template: Template) {
  return deleteJSON(`/template/${template.id}/delete`, {
    body: {
      version: template.version,
    },
  })
}

type UpdateTemplateOptions = {
  template: Template
  editedTemplate: Template
}

export function updateTemplate({
  template,
  editedTemplate
}: UpdateTemplateOptions): Promise<Template | null> {
  const updatedFields: Partial<Template> = {
    name: editedTemplate.name.trim(),
    license: editedTemplate.license,
    category: editedTemplate.category,
    language: editedTemplate.language,
    authorMD: editedTemplate.authorMD.trim(),
    descriptionMD: editedTemplate.descriptionMD.trim(),
  }

  const changedFields = Object.entries(updatedFields).reduce((diff, [key, value]) => {
    if (value !== undefined && template[key as keyof Template] !== value) {
      diff[key] = value
    }
    return diff
  }, {} as Partial<Template>)

  if (Object.keys(changedFields).length === 0) {
    return Promise.resolve(null)
  }

  return postJSON(`/template/${editedTemplate.id}/edit`, {
    body: changedFields
  })
}
