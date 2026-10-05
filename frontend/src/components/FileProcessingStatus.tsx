import type { FileProcessingProgress } from '../data/useFiles'
import { Button } from './ui/button'

const labels: Record<FileProcessingProgress['state'], string> = {
  queued: 'Queued for processing',
  processing: 'Processing PDF',
  paused: 'Processing paused',
  failed: 'Processing failed',
  uncertain: 'Image result needs review',
  complete: 'Indexed',
}

/** Inline processing state under a file row (FL-03): determinate bar
 * when image totals are known, one honest status line, and the retry
 * entry for paused/failed/uncertain work. Never a percentage. */
export function FileProcessingStatus({ progress, hidden, busy, onRetry }: {
  progress: FileProcessingProgress; hidden: boolean; busy: boolean; onRetry?: () => void
}) {
  const { state, totalImages, completedImages } = progress
  const determinate = totalImages !== null
  const organizing = state === 'processing' && determinate && completedImages === totalImages
  const status =
    state === 'processing' && !determinate
      ? 'Reading PDF pages'
      : state === 'processing' && organizing
        ? 'Organizing text'
        : state === 'processing'
          ? `Analysing images ${completedImages} of ${totalImages}`
          : labels[state]
  const percent = determinate && totalImages > 0 ? Math.min(100, Math.round((completedImages / totalImages) * 100)) : 0
  const retryable = state === 'paused' || state === 'failed' || state === 'uncertain'
  return (
    <div className="mt-1.5 min-w-0">
      {determinate ? (
        <div role="progressbar" aria-label="File processing progress" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} className="h-1 w-full overflow-hidden rounded-full bg-surface-active">
          <div className="h-full rounded-full bg-primary transition-[width] duration-240 ease-out motion-reduce:transition-none" style={{ width: `${percent}%` }} />
        </div>
      ) : null}
      <p role="status" className="mt-1 text-xs text-muted-foreground">{status}</p>
      {determinate && state !== 'processing' ? (
        <p className="mt-0.5 text-xs text-muted-foreground">{completedImages} of {totalImages} image analyses saved</p>
      ) : null}
      {state === 'failed' || state === 'uncertain' ? (
        <p className="mt-0.5 text-xs text-muted-foreground">The original file and saved image results are retained.</p>
      ) : null}
      {progress.errorCode ? (
        <details className="mt-1 text-xs text-muted-foreground">
          <summary className="w-fit cursor-pointer rounded-sm outline-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">Processing details</summary>
          <p className="mt-0.5 font-mono text-xs break-all">{progress.errorCode}</p>
        </details>
      ) : null}
      {!hidden && onRetry && retryable ? (
        <Button type="button" variant="secondary" size="xs" disabled={busy} onClick={onRetry} className="mt-2">Review retry</Button>
      ) : null}
    </div>
  )
}
