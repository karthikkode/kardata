// The + menu: every file in the session's artifact index. Uploads have no
// backend endpoint, so the menu lists indexed files only.
import { fileIcon } from '@/lib/icons'
import { focusRingInset } from '@/lib/interaction'
import { popoverEnter, popoverExit } from '@/lib/motion'
import { Caption } from '../text'
import type { ChatFile } from './messages'

export function FilesMenu({
  files,
  closing,
  onPick,
  onClose,
  onEscape,
}: {
  files: ChatFile[]
  closing: boolean
  onPick: (file: ChatFile) => void
  onClose: () => void
  onEscape: () => void
}) {
  return (
    <>
      <button
        type="button"
        aria-label="Dismiss files"
        onClick={onClose}
        className="fixed inset-0 z-40 cursor-default bg-transparent"
      />
      <div
        role="menu"
        aria-label="Attach file"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            onEscape()
          }
        }}
        className={`absolute bottom-full left-0 z-50 mb-2 max-h-64 w-72 scroll-slim overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-md ${closing ? popoverExit : popoverEnter}`}
      >
        {files.length === 0 ? (
          <p className="px-2 py-1.5 text-ui text-muted-foreground">
            No files indexed in this session yet.
          </p>
        ) : null}
        {files.map((file) => {
          const FileTypeIcon = fileIcon(file.name)
          return (
            <button
              key={file.id}
              type="button"
              role="menuitem"
              onClick={() => onPick(file)}
              className={`flex min-h-9 w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1 text-left text-ui hover:bg-surface-hover ${focusRingInset}`}
            >
              <FileTypeIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block truncate">{file.name}</span>
                <Caption as="span" className="block truncate">{file.source}</Caption>
              </span>
            </button>
          )
        })}
      </div>
    </>
  )
}
