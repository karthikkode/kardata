// Execution record API: per-thread record pages and bodies.
import { z } from 'zod'
import { requestValidated, type StagingConfig } from './client'

const ExecutionRecordMetadata = z.object({ seq: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), at: z.string().datetime({ offset: true }), runKey: z.string().min(1).max(255), attemptLease: z.string().uuid(), round: z.number().int().nonnegative(), kind: z.enum(['request', 'response', 'tool-result']), roundKind: z.enum(['turn', 'compaction']).optional(), workflowId: z.string().min(1).max(255).optional(), executionId: z.string().min(1).max(255).optional(), ownerEpoch: z.string().uuid().optional(), ref: z.object({ hash: z.string().regex(/^[a-f0-9]{64}$/), bytes: z.number().int().positive().max(16 * 1024 * 1024) }).strict() }).strict()
const ExecutionRecordPage = z.object({ records: z.array(ExecutionRecordMetadata).max(100), nextAfterSeq: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable() }).strict()
const ExecutionRecordBody = z.object({ record: z.record(z.string(), z.unknown()) }).strict()
export type ExecutionRecordMetadata = z.infer<typeof ExecutionRecordMetadata>
export type ExecutionRecordPage = z.infer<typeof ExecutionRecordPage>
export type ExecutionRecordBody = z.infer<typeof ExecutionRecordBody>
export const listExecutionRecords = (config: StagingConfig, thread: string, afterSeq = 0) => requestValidated(config, 'GET', `/v1/threads/${encodeURIComponent(thread)}/execution-records?afterSeq=${afterSeq}&limit=20`, ExecutionRecordPage)
export const getExecutionRecord = (config: StagingConfig, thread: string, seq: number) => requestValidated(config, 'GET', `/v1/threads/${encodeURIComponent(thread)}/execution-records/${seq}`, ExecutionRecordBody)
