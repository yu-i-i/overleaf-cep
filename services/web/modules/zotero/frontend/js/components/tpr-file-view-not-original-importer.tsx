import type { BinaryFile } from '@/features/file-view/types/binary-file'
import type { LinkedFile, LinkedFileData } from '@/features/file-view/types/binary-file'

type TPRFileViewInfoProps = {
  file: LinkedFile<keyof LinkedFileData>
}

export function TPRFileViewNotOriginalImporter({
  file,
}: TPRFileViewNotOriginalImporterProps) {

  return null
}
