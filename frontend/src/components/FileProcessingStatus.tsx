import type { FileProcessingProgress } from '../data/workspace-api'
import { Button } from './ui/button'

const labels: Record<FileProcessingProgress['state'], string> = {
  queued: 'Queued for processing', processing: 'Processing PDF', paused: 'Processing paused',
  failed: 'Processing failed', uncertain: 'Image result needs review', complete: 'Indexed',
}
export function FileProcessingStatus({ progress, hidden, busy, onRetry }: {
  progress: FileProcessingProgress; hidden: boolean; busy: boolean; onRetry?: () => void
}) {
  return <div className="mt-2 space-y-1 text-xs">
    <p role="status">{progress.state === 'processing' && progress.totalImages === null ? 'Reading PDF pages' : labels[progress.state]}</p>
    {progress.totalImages !== null ? <p className="text-muted-foreground">{progress.completedImages} of {progress.totalImages} image analyses saved{progress.state === 'processing' && progress.completedImages === progress.totalImages ? ' · organizing text' : ''}</p> : null}
    {progress.state === 'failed' || progress.state === 'uncertain' ? <p className="text-muted-foreground">The original file and saved image results are retained.</p> : null}
    {progress.errorCode ? <details className="text-muted-foreground"><summary className="cursor-pointer">Processing details</summary><p className="break-all">{progress.errorCode}</p></details> : null}
    {!hidden && onRetry && ['paused', 'failed', 'uncertain'].includes(progress.state) ? <Button variant="outline" size="sm" disabled={busy} onClick={onRetry}>Review file retry</Button> : null}
  </div>
}
