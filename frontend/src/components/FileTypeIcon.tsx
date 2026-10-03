import { FILE_ICON_BY_EXTENSION, Icons, fileExtension } from '@/lib/icons'

/** File-type glyph for a filename (FL-02 row and FL-06 preview tiles). The
 * lookup indexes a module-level map, so no component is created or aliased
 * during render (react-hooks/static-components). */
export function FileTypeIcon({ filename, ...props }: { filename: string; className?: string; 'aria-hidden'?: boolean }) {
  const Icon = FILE_ICON_BY_EXTENSION[fileExtension(filename)] ?? Icons.fileUnknown
  return <Icon {...props} />
}
