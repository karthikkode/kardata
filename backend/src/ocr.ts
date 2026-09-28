// Model-backed OCR: transcription through the vision model over the
// existing Meta credential (KARDATA_META_KEY). No new key, no new endpoint:
// OCR is one chat call with an image part. Model transcripts are
// uncalibrated, so confidence is a standing prior (documented here, not
// measured); the uncertain mechanism stays for dedicated OCR endpoints.
import type { ProviderAdapter } from '@kardata/agents'
import type { OcrAdapter } from './db/file-pipeline.js'

/** Standing prior for model transcripts: high but explicitly unmeasured. */
export const MODEL_OCR_CONFIDENCE = 0.9

const TRANSCRIBE_SYSTEM =
  'Transcribe the image verbatim. Return only the transcribed text: no commentary, no description, no formatting changes. Preserve reading order and line breaks.'

export function createModelOcrAdapter(adapter: ProviderAdapter): OcrAdapter {
  return {
    async recognize(image: Uint8Array, mediaType: string) {
      const response = await adapter.chat({
        systemPrompt: TRANSCRIBE_SYSTEM,
        messages: [
          {
            role: 'user',
            text: 'Transcribe this image.',
            images: [{ mediaType, base64: Buffer.from(image).toString('base64') }],
          },
        ],
        tools: [],
        toolChoice: { mode: 'none' },
      })
      const text = response.text.trim()
      if (!text) throw new Error('vision model returned no transcript')
      return { text, confidence: MODEL_OCR_CONFIDENCE }
    },
  }
}
