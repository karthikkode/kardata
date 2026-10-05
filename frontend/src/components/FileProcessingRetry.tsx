import { useState } from 'react'
import type { LibraryFile } from '../data/useFiles'
import { Button } from './ui/button'

export function FileProcessingRetry({ file, latest, busy, error, onRetry, onClose }: {
  file: LibraryFile; latest?: LibraryFile; busy: boolean; error: string | null
  onRetry(jobId: string, revision: number, allowDuplicatePaid: boolean): Promise<boolean>
  onClose(): void
}) {
  const [reviewed, setReviewed] = useState(file), [duplicatePaid, setDuplicatePaid] = useState(false)
  const progress = reviewed.processing
  const fingerprint = (item: LibraryFile) => JSON.stringify([item.hash, item.hidden, item.status, item.processing?.jobId, item.processing?.revision, item.processing?.state, item.processing?.totalImages, item.processing?.completedImages, item.processing?.failedImages, item.processing?.uncertainImages, item.processing?.errorCode, item.processing?.retryRequiresApproval])
  const stale = Boolean(latest && fingerprint(latest) !== fingerprint(reviewed))
  const ready = Boolean(progress && latest && !latest.hidden && ['failed','uncertain','paused'].includes(latest.processing?.state ?? '') && !stale)
  return <form className="space-y-4" onSubmit={(event) => {
    event.preventDefault()
    if (!progress || !ready || busy || progress.retryRequiresApproval && !duplicatePaid) return
    void onRetry(progress.jobId, progress.revision, duplicatePaid).then((success) => { if (success) onClose() })
  }}>
    <p className="break-words text-sm font-medium">{reviewed.filename}</p>
    <p className="text-sm text-muted-foreground">Retry resumes this file and reuses saved image results. The original file remains stored.</p>
    {stale ? <div role="alert" className="space-y-2 rounded-lg border border-border p-3 text-sm"><p>Processing changed. Review the latest state before retrying.</p><Button variant="outline" size="sm" onClick={() => { if (latest) { setReviewed(latest); setDuplicatePaid(false) } }}>Review latest processing</Button></div> : null}
    {progress?.retryRequiresApproval ? <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={duplicatePaid} onChange={(event) => setDuplicatePaid(event.target.checked)} className="mt-1 accent-primary" />This retry may repeat paid work. I approve another request when the existing result cannot be used.</label> : null}
    {error ? <p role="alert" className="text-sm text-muted-foreground">{error}</p> : null}
    {!ready && !stale ? <p role="status" className="text-sm text-muted-foreground">This file is no longer awaiting retry, is hidden, or its latest state is unavailable.</p> : null}
    <div className="flex justify-end gap-2"><Button variant="ghost" disabled={busy} onClick={onClose}>Cancel</Button><Button type="submit" disabled={!ready || busy || Boolean(progress?.retryRequiresApproval && !duplicatePaid)}>{busy ? 'Resuming file…' : 'Resume file processing'}</Button></div>
  </form>
}
