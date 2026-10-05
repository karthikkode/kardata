// Chat pre-conversation states: compact notice plus the no-backend,
// denied, loading, failed, and offline branches.
import { Icons } from '@/lib/icons'
import type { StagingConfig } from '../../data/useApi'
import { Button } from '../ui/button'
import { CardTitle, Description } from '../text'
import { Skeleton } from '../ui/skeleton'
import { PanelError, UnavailableNotice } from '../research-parts'

export function ChatStates({
  config,
  denied,
  loading,
  failed,
  offline,
  retryOffline,
}: {
  config: StagingConfig | null
  denied: boolean
  loading: boolean
  failed: (() => void) | null
  offline: boolean
  retryOffline: () => void
}) {
  return (
    <>
      {!config ? (
        <div className="flex flex-1 flex-col items-center px-6 py-12 text-center">
          <span className="flex size-10 items-center justify-center rounded-full bg-muted">
            <Icons.notConnected className="size-5 text-muted-foreground" aria-hidden />
          </span>
          <CardTitle as="span" className="mt-3 block">Chat needs a backend connection.</CardTitle>
          <Description className="mt-1 max-w-80">Set the staging API URL and key, then reload.</Description>
          <Button type="button" variant="secondary" size="sm" className="mt-4" onClick={() => window.location.reload()}>
            Reload
          </Button>
        </div>
      ) : denied ? (
        <div className="flex flex-1 flex-col items-center px-6 py-12 text-center">
          <span className="flex size-10 items-center justify-center rounded-full bg-muted">
            <Icons.denied className="size-5 text-muted-foreground" aria-hidden />
          </span>
          <CardTitle as="span" className="mt-3 block">Chat is not shared with this key.</CardTitle>
          <Description className="mt-1 max-w-80">Ask an admin for access to use it.</Description>
        </div>
      ) : loading ? (
        <div role="status" aria-label="Chat history is loading" className="flex flex-1 flex-col gap-6 px-4 py-6">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-3.5 w-11/12" />
            <Skeleton className="h-3.5 w-3/4" />
          </div>
          <div className="flex justify-end">
            <Skeleton className="h-10 w-2/3 rounded-xl rounded-br-sm" />
          </div>
          <div className="flex flex-col gap-2">
            <Skeleton className="h-3.5 w-full" />
            <Skeleton className="h-3.5 w-2/3" />
          </div>
        </div>
      ) : failed ? (
        <div className="p-4">
          <PanelError
            heading="Chat history did not load."
            detail="Check your connection and try again."
            onRetry={failed}
          />
        </div>
      ) : offline ? (
        <div className="p-4">
          <UnavailableNotice onRetry={retryOffline} />
        </div>
      ) : null}
    </>
  )
}
