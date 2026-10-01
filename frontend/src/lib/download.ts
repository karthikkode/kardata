/** User-initiated download. Release the URL after the browser consumes it. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  try { link.click() } finally { setTimeout(() => URL.revokeObjectURL(url), 0) }
}
