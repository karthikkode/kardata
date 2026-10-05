// File-owned durable work. Model code never receives database/archive authority.
import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import type { Scope } from '../auth/types.js';
import { ResearchSourceError, withArchiveDeadline, type ArchiveTarget } from '../archive/targets.js';
import { createLogger, logOp } from '../observability/logging.js';
import { appendEvent, type Db } from './events.js';
import type { TransactableDb } from './checkpoints.js';
import { DbContractError, WorkspaceError } from './errors.js';
import { getSector } from './sectors.js';
import { assertFileVisible } from './workspace-library.js'
import { Id, requireThread, workspaceTransaction } from './workspace.js';
import { SECTOR_DOCUMENT_MAX_BYTES, sha256Hex, chunkTextUnits, type ExtractedUnit } from './file-pipeline.js';
import type { IngestedDocument } from './sector-documents.js';
const logger = createLogger({ op: 'file.processing' });
const Hash = z.string().regex(/^[a-f0-9]{64}$/);
export const FileArchiveRef = z.object({ key: z.string().min(1).max(1024), hash: Hash, bytes: z.number().int().positive() }).strict();
export type FileArchiveRef = z.infer<typeof FileArchiveRef>;
export const FileImageIdentity = z.object({ imageId: Id, page: z.number().int().positive(), ordinal: z.number().int().nonnegative(), imageHash: Hash, inputRef: FileArchiveRef, width: z.number().int().positive(), height: z.number().int().positive(), role: z.enum(['embedded', 'page-visual']).default('embedded') }).strict();
export type FileImageIdentity = z.input<typeof FileImageIdentity>;
export interface FileProcessingProgress {
    jobId: string;
    state: 'queued' | 'processing' | 'paused' | 'failed' | 'uncertain' | 'complete';
    revision: number;
    totalImages: number | null;
    completedImages: number;
    failedImages: number;
    uncertainImages: number;
    errorCode: string | null;
    retryRequiresApproval: boolean;
}
export interface FileProcessingJob extends FileProcessingProgress {
    documentId: string;
    sectorId: string;
    originalHash: string;
    archiveKey: string;
    provider: string;
    model: string;
    parserVersion: string;
    promptVersion: string;
    manifestRef: FileArchiveRef | null;
    extractionHash: string | null;
    dispatchState:'unreserved'|'reserved'|'confirmed'|'uncertain';
    dispatchNonce:string|null; dispatchWorkflowId:string|null; dispatchExecutionId:string|null;
}
/** Shared revision guard for the file-processing slices. */
export function assertRevision(job: FileProcessingJob, revision: number) {
    if (!Number.isInteger(revision) || job.revision !== revision)
        throw new WorkspaceError('conflict', 'A newer file processing revision owns this work.');
}
interface JobRow {
    id: string;
    document_id: string;
    sector_id: string;
    original_hash: string;
    archive_key: string;
    provider: string;
    model: string;
    parser_version: string;
    prompt_version: string;
    state: FileProcessingProgress['state'];
    revision: number;
    manifest_ref: FileArchiveRef | null;
    expected_images: number | null;
    extraction_hash: string | null;
    last_error_code: string | null;
    completed_images: number;
    failed_images: number;
    uncertain_images: number;
    dispatch_state:'unreserved'|'reserved'|'confirmed'|'uncertain'; dispatch_nonce:string|null;dispatch_workflow_id:string|null;dispatch_execution_id:string|null;
    requesting_images?: number;
    paid_failed_images?: number;
}
function view(row: JobRow): FileProcessingJob { return { jobId: row.id, documentId: row.document_id, sectorId: row.sector_id, originalHash: row.original_hash, archiveKey: row.archive_key, provider: row.provider, model: row.model, parserVersion: row.parser_version, promptVersion: row.prompt_version, state: row.state, revision: row.revision, manifestRef: row.manifest_ref, extractionHash: row.extraction_hash, dispatchState:row.dispatch_state,dispatchNonce:row.dispatch_nonce,dispatchWorkflowId:row.dispatch_workflow_id,dispatchExecutionId:row.dispatch_execution_id, totalImages: row.expected_images, completedImages: row.completed_images, failedImages: row.failed_images, uncertainImages: row.uncertain_images, errorCode: row.last_error_code, retryRequiresApproval: row.uncertain_images > 0 || (row.requesting_images ?? 0) > 0 || (row.paid_failed_images ?? 0) > 0 || row.last_error_code === 'dispatch_outcome_unknown'||row.dispatch_state==='uncertain' }; }
export function fileProcessingProgress(job: FileProcessingJob): FileProcessingProgress { const { jobId, state, revision, totalImages, completedImages, failedImages, uncertainImages, errorCode, retryRequiresApproval } = job; return { jobId, state, revision, totalImages, completedImages, failedImages, uncertainImages, errorCode, retryRequiresApproval }; }
export async function readFileProcessingJob(db: Db, jobId: string, scope?: Scope): Promise<FileProcessingJob> {
    const { rows } = await db.query<JobRow>(`SELECT j.*,count(*) FILTER(WHERE i.state='complete')::int AS completed_images,count(*) FILTER(WHERE i.state='failed')::int AS failed_images,count(*) FILTER(WHERE i.state='uncertain')::int AS uncertain_images,count(*) FILTER(WHERE i.state='requesting')::int AS requesting_images,count(*) FILTER(WHERE i.state='failed' AND paid.request_started_at IS NOT NULL)::int AS paid_failed_images FROM file_processing_jobs j LEFT JOIN file_processing_images i ON i.job_id=j.id LEFT JOIN file_processing_attempts paid ON paid.job_id=i.job_id AND paid.image_id=i.image_id AND paid.attempt=i.attempt WHERE j.id=$1 GROUP BY j.id`, [Id.parse(jobId)]);
    const row = rows[0];
    if (!row || !(await getSector(db, row.sector_id, scope)))
        throw new WorkspaceError('not_found', 'File processing job not found.');
    return view(row);
}
/** Shared visibility check for the file-processing slices. */
export async function visible(db: Db, job: FileProcessingJob) { await assertFileVisible(db, job.sectorId, job.documentId); }
function coded(code: string): string { return z.string().regex(/^[a-z][a-z0-9_]{0,79}$/).parse(code); }
function identity(input: {
    sectorId: string;
    originalHash: string;
    provider: string;
    model: string;
    parserVersion: string;
    promptVersion: string;
}) { return sha256Hex(JSON.stringify(input)); }
export function fileProcessingArchivePrefix(jobId: string): string { return `file-processing/${Id.parse(jobId)}/`; }
function scopedRef(jobId: string, ref: FileArchiveRef) {
    if (!ref.key.startsWith(fileProcessingArchivePrefix(jobId)))
        throw new WorkspaceError('permission_denied', 'File processing archive reference is outside this job.');
}
export async function createFileProcessingJob(db: TransactableDb, input: {
    sectorId: string;
    filename: string;
    contentBase64: string;
    provider: string;
    model: string;
    parserVersion: string;
    promptVersion: string;
    scope?: Scope;
    archive: ArchiveTarget;
    sourceThread?: string;
}): Promise<{
    document: IngestedDocument;
    job: FileProcessingJob;
}> {
    return logOp(logger, 'file.processing.create', async () => {
        input = { ...input, archive: withArchiveDeadline(input.archive) };
        if (!(await getSector(db, input.sectorId, input.scope)))
            throw new WorkspaceError('not_found', 'Sector not found.');
        if (input.sourceThread) {
            const actor = await requireThread(db, input.sourceThread, input.scope);
            if (actor.session.sectorId && actor.session.sectorId !== input.sectorId)
                throw new WorkspaceError('permission_denied', 'File source thread belongs to another sector.');
        }
        z.string().min(1).max(255).parse(input.filename);
        const bytes = Buffer.from(input.contentBase64, 'base64');
        if (!bytes.length || bytes.length > SECTOR_DOCUMENT_MAX_BYTES)
            throw new DbContractError('Original file must be1–8MiB.');
        const original = bytes.toString('base64'), originalHash = sha256Hex(original);
        const binding = { sectorId: input.sectorId, originalHash, provider: Id.parse(input.provider), model: Id.parse(input.model), parserVersion: Id.parse(input.parserVersion), promptVersion: Id.parse(input.promptVersion) };
        const hash = identity(binding), jobId = `fjob-${hash.slice(0, 48)}`, documentId = `sdoc-${hash.slice(0, 48)}`, archiveKey = `sector-uploads/${sha256Hex(input.sectorId)}/${originalHash}.base64`;
        await input.archive.write(archiveKey, original);
        if (await input.archive.read(archiveKey, 12 * 1024 * 1024) !== original)
            throw new WorkspaceError('conflict', 'Original file archive could not be verified.');
        await workspaceTransaction(db, input.sectorId, async (tx) => {
            if (input.sourceThread) {
                const actor = await requireThread(tx, input.sourceThread, input.scope);
                if (actor.session.sectorId && actor.session.sectorId !== input.sectorId)
                    throw new WorkspaceError('permission_denied', 'File source thread belongs to another sector.');
            }
            await tx.query(`INSERT INTO sector_documents(id,sector_id,filename,media_type,text,sha256,status,tenant_id,project_id,archive_key,original_hash) VALUES($1,$2,$3,'application/pdf','',$4,'processing',$5,$6,$7,$8) ON CONFLICT(id) DO NOTHING`, [documentId, input.sectorId, input.filename, hash, input.scope?.tenantId ?? null, input.scope?.projectId ?? null, archiveKey, originalHash]);
            await tx.query(`INSERT INTO file_processing_jobs(id,document_id,sector_id,original_hash,archive_key,provider,model,parser_version,prompt_version,state) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'queued') ON CONFLICT(id) DO NOTHING`, [jobId, documentId, input.sectorId, originalHash, archiveKey, input.provider, input.model, input.parserVersion, input.promptVersion]);
            await appendEvent(tx, { idempotencyKey: `file-job:${jobId}:created`, partition: `sector:${input.sectorId}`, type: 'sector.file.processing.created', payload: { jobId, fileId: documentId, parserVersion: input.parserVersion, model: input.model, promptVersion: input.promptVersion } });
            if (input.sourceThread)
                await appendEvent(tx, { idempotencyKey: `file-job:${jobId}:source:${sha256Hex(input.sourceThread)}`, partition: `sector:${input.sectorId}`, type: 'sector.file.processing.source', payload: { jobId, fileId: documentId, sourceThread: input.sourceThread } });
        });
        const job = await readFileProcessingJob(db, jobId, input.scope);
        const stored = await db.query<{
            filename: string;
            created_at: Date;
            status: 'indexed' | 'processing' | 'failed';
            text: string;
            full_chars: string | null;
            unit_count: number;
        }>('SELECT d.filename,d.created_at,d.status,d.text,d.full_chars,(SELECT count(*)::int FROM sector_document_units WHERE document_id=d.id) AS unit_count FROM sector_documents d WHERE d.id=$1', [documentId]);
        const doc = stored.rows[0]!;
        return { job, document: { id: documentId, sectorId: input.sectorId, filename: doc.filename, mediaType: 'application/pdf', chars: doc.status === 'indexed' ? Number(doc.full_chars ?? doc.text.length) : 0, sha256: hash, createdAt: new Date(doc.created_at).toISOString(), status: doc.status, unitCount: doc.status === 'indexed' ? doc.unit_count : 0 } };
    }, { sectorId: input.sectorId });
}
async function verifiedJson(archive: ArchiveTarget, ref: FileArchiveRef): Promise<unknown> {
    archive = withArchiveDeadline(archive);
    const body = await archive.read(ref.key, ref.bytes + 1);
    if (body === undefined || Buffer.byteLength(body) !== ref.bytes || createHash('sha256').update(body).digest('hex') !== ref.hash)
        throw new WorkspaceError('conflict', 'File processing archive is missing or corrupt.');
    try {
        return JSON.parse(body);
    }
    catch {
        throw new WorkspaceError('conflict', 'File processing archive contains invalid JSON.');
    }
}
export const FileProcessingManifest = z.object({ version: z.literal(1), records: z.array(z.union([z.object({ kind: z.literal('text'), page: z.number().int().positive(), text: z.string() }).strict(), FileImageIdentity.extend({ kind: z.literal('image') })])) }).strict();
const FileProcessingPagedManifest = z.object({ version: z.literal(2), parts: z.array(FileArchiveRef) }).strict();
export type FileProcessingManifest = z.infer<typeof FileProcessingManifest>;
export interface FileProcessingUnit extends ExtractedUnit {
    page?: number;
    imageId?: string;
    imageOrdinal?: number;
    imageRole?: 'embedded' | 'page-visual';
}
export function fileImageResponseUnits(response: unknown, image: FileImageIdentity): FileProcessingUnit[] {
    const text = z.object({ text: z.string().trim().min(1), completion: z.literal('complete'), toolCalls: z.array(z.unknown()).length(0) }).passthrough().parse(response).text;
    const label = image.role === 'page-visual' ? 'Page visual overview' : `Image ${image.ordinal + 1}`;
    return chunkTextUnits(`## Page ${image.page} · ${label}\n\nAI-derived visual analysis (uncertain)\n\n${text}`).map(unit => ({ ...unit, kind: 'ocr', uncertain: true, page: image.page, imageId: image.imageId, imageOrdinal: image.ordinal, imageRole: image.role ?? 'embedded' }));
}
export async function registerFileImages(db: TransactableDb, jobId: string, manifestRef: FileArchiveRef, images: FileImageIdentity[], archive: ArchiveTarget, revision: number, scope?: Scope): Promise<void> {
    return logOp(logger, 'file.processing.prepare', async () => {
        archive = withArchiveDeadline(archive);
        const manifest = FileArchiveRef.parse(manifestRef), parsed = images.map(i => FileImageIdentity.parse(i));
        scopedRef(jobId, manifest);
        for (const image of parsed)
            scopedRef(jobId, image.inputRef);
        const job = await readFileProcessingJob(db, jobId, scope);
        let describedAt = 0;
        for await (const record of manifestRecords(jobId, manifest, archive)) {
            if (record.kind !== 'image')
                continue;
            const { kind: _kind, ...image } = record;
            if (!isDeepStrictEqual(image, parsed[describedAt++]))
                throw new WorkspaceError('conflict', 'Image identities do not cover the sealed manifest.');
        }
        if (describedAt !== parsed.length)
            throw new WorkspaceError('conflict', 'Image identities do not cover the sealed manifest.');
        for (const image of parsed) {
            const encoded = await archive.read(image.inputRef.key, 12 * 1024 * 1024);
            const bytes = encoded === undefined ? undefined : Buffer.from(encoded, 'base64');
            if (!bytes || bytes.length !== image.inputRef.bytes || bytes.length > 8 * 1024 * 1024 || createHash('sha256').update(bytes).digest('hex') !== image.imageHash || image.inputRef.hash !== image.imageHash)
                throw new WorkspaceError('conflict', 'File image input archive is missing or corrupt.');
        }
        await workspaceTransaction(db, job.sectorId, async (tx) => {
            const current = await readFileProcessingJob(tx, jobId, scope);
            assertRevision(current, revision);
            await visible(tx, current);
            if (!['queued', 'processing', 'complete'].includes(current.state))
                throw new WorkspaceError('conflict', 'File processing must be retried before preparation.');
            if (current.manifestRef && !isDeepStrictEqual(current.manifestRef, manifest))
                throw new WorkspaceError('conflict', 'File extraction manifest changed.');
            for (const i of parsed) {
                const { rows } = await tx.query<{
                    image_hash: string;
                    input_ref: FileArchiveRef;
                    page: number;
                    ordinal: number;
                    width: number;
                    height: number;
                    role: 'embedded' | 'page-visual';
                }>(`INSERT INTO file_processing_images(job_id,image_id,page,ordinal,image_hash,input_ref,width,height,role,state) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending') ON CONFLICT(job_id,image_id) DO UPDATE SET image_id=EXCLUDED.image_id RETURNING image_hash,input_ref,page,ordinal,width,height,role`, [jobId, i.imageId, i.page, i.ordinal, i.imageHash, i.inputRef, i.width, i.height, i.role]);
                const saved = rows[0]!;
                if (saved.image_hash !== i.imageHash || saved.page !== i.page || saved.ordinal !== i.ordinal || saved.width !== i.width || saved.height !== i.height || saved.role !== i.role || !isDeepStrictEqual(saved.input_ref, i.inputRef))
                    throw new WorkspaceError('conflict', 'File image identity changed.');
            }
            await tx.query("UPDATE file_processing_jobs SET manifest_ref=$2,expected_images=$3,state=CASE WHEN state='complete' THEN state ELSE 'processing' END,updated_at=now() WHERE id=$1", [jobId, manifest, parsed.length]);
        });
    }, { jobId });
}
export interface FileImageClaim {
    state: 'claimed' | 'busy' | 'complete' | 'response-staged' | 'uncertain' | 'overload';
    attempt: number;
    lease?: string;
    pendingResponse?: unknown;
    pendingResponseSerialized?: string;
    resultRef?: FileArchiveRef;
    units?: ExtractedUnit[];
}
export async function claimFileImage(db: TransactableDb, jobId: string, imageId: string, producerId: string, revision: number, scope?: Scope): Promise<FileImageClaim> {
    const job = await readFileProcessingJob(db, jobId, scope);
    return logOp(logger, 'file.processing.claim', () => workspaceTransaction(db, job.sectorId, async (tx) => {
        await tx.query("SELECT pg_advisory_xact_lock(hashtext('file-processing-provider-admission'))");
        const current = await readFileProcessingJob(tx, jobId, scope);
        assertRevision(current, revision);
        await visible(tx, current);
        if (['failed', 'uncertain', 'paused'].includes(current.state))
            throw new WorkspaceError('conflict', 'File processing is not accepting new work.');
        const { rows } = await tx.query<{
            state: string;
            attempt_state: string | null;
            attempt: number;
            lease: string | null;
            pending_response: unknown;
            pending_response_text: string | null;
            result_ref: FileArchiveRef | null;
            units: ExtractedUnit[] | null;
            deadline_at: Date | null;
            producer_id: string | null;
        }>(`SELECT i.state,a.state AS attempt_state,i.attempt,a.lease,a.pending_response,a.pending_response_text,a.result_ref,a.units,a.deadline_at,a.producer_id FROM file_processing_images i LEFT JOIN file_processing_attempts a ON a.job_id=i.job_id AND a.image_id=i.image_id AND a.attempt=i.attempt WHERE i.job_id=$1 AND i.image_id=$2 FOR UPDATE OF i`, [jobId, imageId]);
        const row = rows[0];
        if (!row)
            throw new WorkspaceError('not_found', 'File image not found.');
        if (row.state === 'pending' && ['complete', 'response-staged'].includes(row.attempt_state ?? '')) {
            await tx.query('UPDATE file_processing_images SET state=$3 WHERE job_id=$1 AND image_id=$2', [jobId, imageId, row.attempt_state]);
            row.state = row.attempt_state!;
        }
        if (row.state === 'complete')
            return { state: 'complete', attempt: row.attempt, resultRef: row.result_ref!, units: row.units! };
        if (row.state === 'response-staged')
            return { state: 'response-staged', attempt: row.attempt, lease: row.lease!, pendingResponse: row.pending_response, pendingResponseSerialized: row.pending_response_text! };
        if (row.state === 'requesting' || row.state === 'uncertain') {
            if (row.state === 'requesting' && row.deadline_at && new Date(row.deadline_at).getTime() > Date.now())
                return { state: 'busy', attempt: row.attempt };
            await setImageFailure(tx, current, imageId, row.attempt, 'provider_outcome_unknown', true);
            return { state: 'uncertain', attempt: row.attempt };
        }
        if (row.state === 'claimed' && row.deadline_at && new Date(row.deadline_at).getTime() > Date.now())
            return row.producer_id === producerId ? { state: 'claimed', attempt: row.attempt, lease: row.lease! } : { state: 'busy', attempt: row.attempt };
        const capacity = await tx.query<{
            n: number;
        }>("SELECT count(*)::int AS n FROM file_processing_attempts a JOIN file_processing_images i ON i.job_id=a.job_id AND i.image_id=a.image_id AND i.attempt=a.attempt AND i.state=a.state JOIN file_processing_jobs j ON j.id=i.job_id WHERE (a.state='requesting' OR (a.state='claimed' AND j.state IN ('queued','processing'))) AND a.deadline_at>now()");
        if (capacity.rows[0]!.n >= 2)
            return { state: 'overload', attempt: row.attempt };
        if (row.state === 'claimed')
            await tx.query("UPDATE file_processing_attempts SET state='failed',error_code='pre_effect_lease_expired',updated_at=now() WHERE job_id=$1 AND image_id=$2 AND attempt=$3 AND state='claimed'", [jobId, imageId, row.attempt]);
        const attempt = row.attempt + 1, lease = randomUUID();
        await tx.query("INSERT INTO file_processing_attempts(job_id,image_id,attempt,lease,producer_id,deadline_at,state) VALUES($1,$2,$3,$4,$5,now()+interval '2 minutes','claimed')", [jobId, imageId, attempt, lease, Id.parse(producerId)]);
        await tx.query("UPDATE file_processing_images SET attempt=$3,state='claimed' WHERE job_id=$1 AND image_id=$2", [jobId, imageId, attempt]);
        return { state: 'claimed', attempt, lease };
    }), { jobId, imageId });
}
/** Shared receipt ledger for the file-processing slices. */
export async function receiptTransaction<T>(db: TransactableDb, jobId: string, scope: Scope | undefined, operation: string, work: (tx: Db, job: FileProcessingJob) => Promise<T>): Promise<T> {
    const job = await readFileProcessingJob(db, jobId, scope);
    return logOp(logger, operation, () => workspaceTransaction(db, job.sectorId, async (tx) => work(tx, await readFileProcessingJob(tx, jobId, scope))), { jobId });
}
async function guardedAttempt(db: TransactableDb, jobId: string, imageId: string, attempt: number, lease: string, revision: number, scope: Scope | undefined, operation: string, work: (tx: Db, job: FileProcessingJob) => Promise<void>, checkVisible = true) {
    return receiptTransaction(db, jobId, scope, operation, async (tx, current) => {
        assertRevision(current, revision);
        if (checkVisible)
            await visible(tx, current);
        const row = await tx.query<{
            state: string;
            image_state: string;
        }>('SELECT a.state,i.state AS image_state FROM file_processing_attempts a JOIN file_processing_images i ON i.job_id=a.job_id AND i.image_id=a.image_id AND i.attempt=a.attempt WHERE a.job_id=$1 AND a.image_id=$2 AND a.attempt=$3 AND a.lease=$4 FOR UPDATE OF a,i', [jobId, imageId, attempt, lease]);
        if (!row.rows[0] || row.rows[0].state !== row.rows[0].image_state)
            throw new WorkspaceError('conflict', 'A newer image phase owns this work.');
        await work(tx, current);
    });
}
export async function markFileImageRequestStarted(db: TransactableDb, jobId: string, imageId: string, attempt: number, lease: string, revision: number, scope?: Scope): Promise<void> {
    return guardedAttempt(db, jobId, imageId, attempt, lease, revision, scope, 'file.processing.request.start', async (tx, job) => {
        if (!['queued', 'processing'].includes(job.state)) throw new WorkspaceError('conflict', 'File processing is not accepting new paid requests.');
        const changed = await tx.query("UPDATE file_processing_attempts SET state='requesting',request_started_at=now(),updated_at=now() WHERE job_id=$1 AND image_id=$2 AND attempt=$3 AND lease=$4 AND state='claimed' AND deadline_at>now() RETURNING lease", [jobId, imageId, attempt, lease]);
        if (!changed.rows.length)
            throw new WorkspaceError('conflict', 'Image request cannot be dispatched again.');
        await tx.query("UPDATE file_processing_images SET state='requesting' WHERE job_id=$1 AND image_id=$2", [jobId, imageId]);
    });
}
export async function stageFileImageResponse(db: TransactableDb, jobId: string, imageId: string, attempt: number, lease: string, response: unknown, revision: number, scope?: Scope): Promise<void> {
    return logOp(logger, 'file.processing.response.receive', async () => {
        const serialized = JSON.stringify(response);
        if (!serialized || Buffer.byteLength(serialized) > 8 * 1024 * 1024)
            throw new DbContractError('Image response exceeds8MiB.');
        return receiptTransaction(db, jobId, scope, 'file.processing.response.stage', async (tx, current) => {
            const old = await tx.query<{
                state: string;
                pending_response: unknown;
                request_started_at: Date | null;
            }>('SELECT state,pending_response,request_started_at FROM file_processing_attempts WHERE job_id=$1 AND image_id=$2 AND attempt=$3 AND lease=$4 FOR UPDATE', [jobId, imageId, attempt, lease]);
            const row = old.rows[0];
            if (!row || !row.request_started_at)
                throw new WorkspaceError('conflict', 'Image response has no original request receipt.');
            if (row.pending_response !== null) {
                if (!isDeepStrictEqual(row.pending_response, response))
                    throw new WorkspaceError('conflict', 'Paid image response changed.');
                if (row.state === 'failed' || row.state === 'complete')
                    return;
            }
            else {
                // Preserve late paid output, even when a successor now owns the image.
                await tx.query("UPDATE file_processing_attempts SET state='response-staged',pending_response=$4,pending_response_text=$5,updated_at=now() WHERE job_id=$1 AND image_id=$2 AND attempt=$3", [jobId, imageId, attempt, response, serialized]);
            }
            if (current.revision === revision) {
                const adopted = await tx.query("UPDATE file_processing_images SET state='response-staged' WHERE job_id=$1 AND image_id=$2 AND attempt=$3 AND state IN ('requesting','uncertain','pending','response-staged') RETURNING image_id", [jobId, imageId, attempt]);
                if (adopted.rows.length && current.state === 'uncertain' && current.errorCode === 'provider_outcome_unknown') {
                    const blocked = await tx.query("SELECT 1 FROM file_processing_images WHERE job_id=$1 AND state IN ('uncertain','requesting') UNION ALL SELECT 1 FROM workspace_files WHERE sector_id=$2 AND file_id=$3 AND hidden=true LIMIT 1", [jobId, current.sectorId, current.documentId]);
                    if (!blocked.rows.length) {
                        await tx.query("UPDATE file_processing_jobs SET state='processing',last_error_code=NULL,updated_at=now() WHERE id=$1", [jobId]);
                        await tx.query("UPDATE sector_documents SET status='processing' WHERE id=$1", [current.documentId]);
                    }
                }
            }
        });
    }, { jobId });
}
export async function completeFileImage(db: TransactableDb, jobId: string, imageId: string, attempt: number, lease: string, resultRef: FileArchiveRef, units: ExtractedUnit[], archive: ArchiveTarget, revision: number, scope?: Scope): Promise<void> {
    return logOp(logger, 'file.processing.receipt.archive', async () => {
        archive = withArchiveDeadline(archive);
        FileArchiveRef.parse(resultRef);
        validateUnits(units);
        scopedRef(jobId, resultRef);
        const image = await readImageIdentity(db, jobId, imageId, scope, false);
        const archivedBody = await archive.read(resultRef.key, resultRef.bytes + 1);
        if (archivedBody === undefined || Buffer.byteLength(archivedBody) !== resultRef.bytes || createHash('sha256').update(archivedBody).digest('hex') !== resultRef.hash)
            throw new WorkspaceError('conflict', 'Paid response archive is missing or corrupt.');
        return receiptTransaction(db, jobId, scope, 'file.processing.image.complete', async (tx, current) => {
            const row = await tx.query<{
                state: string;
                result_ref: FileArchiveRef | null;
                units: unknown;
                pending_response: unknown;
                pending_response_text: string | null;
            }>('SELECT state,result_ref,units,pending_response,pending_response_text FROM file_processing_attempts WHERE job_id=$1 AND image_id=$2 AND attempt=$3 AND lease=$4 FOR UPDATE', [jobId, imageId, attempt, lease]);
            const saved = row.rows[0];
            if (!saved || saved.pending_response_text !== archivedBody)
                throw new WorkspaceError('conflict', 'Archived image response differs from the exact paid receipt.');
            if (!isDeepStrictEqual(fileImageResponseUnits(saved.pending_response, image), units))
                throw new WorkspaceError('conflict', 'Image units differ from the paid response.');
            if (saved.state === 'complete') {
                if (!isDeepStrictEqual(saved.result_ref, resultRef) || !isDeepStrictEqual(saved.units, units))
                    throw new WorkspaceError('conflict', 'Completed image receipt changed.');
                return;
            }
            if (saved.state !== 'response-staged')
                throw new WorkspaceError('conflict', 'Image result requires a durable paid response.');
            await tx.query("UPDATE file_processing_attempts SET state='complete',result_ref=$4,units=$5,updated_at=now() WHERE job_id=$1 AND image_id=$2 AND attempt=$3", [jobId, imageId, attempt, resultRef, JSON.stringify(units)]);
            if (current.revision === revision)
                await tx.query("UPDATE file_processing_images SET state='complete' WHERE job_id=$1 AND image_id=$2 AND attempt=$3 AND state='response-staged'", [jobId, imageId, attempt]);
        });
    }, { jobId });
}
async function setImageFailure(tx: Db, job: FileProcessingJob, imageId: string, attempt: number, code: string, uncertain: boolean) {
    const prior = await tx.query<{
        state: string;
    }>('SELECT state FROM file_processing_attempts WHERE job_id=$1 AND image_id=$2 AND attempt=$3', [job.jobId, imageId, attempt]);
    if (['complete', 'response-staged'].includes(prior.rows[0]?.state ?? ''))
        return;
    const state = uncertain || prior.rows[0]?.state === 'requesting' ? 'uncertain' : 'failed';
    await tx.query('UPDATE file_processing_attempts SET state=$4,error_code=$5,updated_at=now() WHERE job_id=$1 AND image_id=$2 AND attempt=$3', [job.jobId, imageId, attempt, state, coded(code)]);
    await tx.query('UPDATE file_processing_images SET state=$3 WHERE job_id=$1 AND image_id=$2', [job.jobId, imageId, state]);
    await tx.query('UPDATE file_processing_jobs SET state=$2,last_error_code=$3,updated_at=now() WHERE id=$1', [job.jobId, state, code]);
    await tx.query("UPDATE sector_documents SET status='failed' WHERE id=$1", [job.documentId]);
}
export async function failFileImage(db: TransactableDb, jobId: string, imageId: string, attempt: number, lease: string, code: string, uncertain: boolean, revision: number, scope?: Scope): Promise<void> {
    return guardedAttempt(db, jobId, imageId, attempt, lease, revision, scope, 'file.processing.image.fail', (tx, job) => setImageFailure(tx, job, imageId, attempt, code, uncertain), false);
}
export async function failFileProcessingJob(db: TransactableDb, jobId: string, code: string, revision: number, scope?: Scope): Promise<void> {
    await receiptTransaction(db, jobId, scope, 'file.processing.job.fail', async (tx, job) => { assertRevision(job, revision); await tx.query("UPDATE file_processing_jobs SET state=CASE WHEN $2='dispatch_outcome_unknown' OR EXISTS(SELECT 1 FROM file_processing_images WHERE job_id=$1 AND state='requesting') THEN 'uncertain' ELSE 'failed' END,last_error_code=$2,updated_at=now() WHERE id=$1 AND state<>'complete'", [jobId, coded(code)]); await tx.query("UPDATE sector_documents SET status='failed' WHERE id=$1 AND status<>'indexed'", [job.documentId]); });
}
function validateUnits(units: ExtractedUnit[]) {
    for (const unit of units) {
        if (typeof unit.text !== 'string' || unit.text.length > 2000 || !Number.isInteger(unit.ord) || unit.ord < 0)
            throw new DbContractError('File units require sequential ordinals and the2000-character cap.');
    }
}
async function* manifestRecords(jobId: string, ref: FileArchiveRef, archive: ArchiveTarget): AsyncGenerator<FileProcessingManifest['records'][number]> {
    scopedRef(jobId, ref);
    const json = await verifiedJson(archive, ref);
    const single = FileProcessingManifest.safeParse(json);
    if (single.success) {
        yield* single.data.records;
        return;
    }
    const paged = FileProcessingPagedManifest.parse(json);
    for (const part of paged.parts) {
        scopedRef(jobId, part);
        yield* FileProcessingManifest.parse(await verifiedJson(archive, part)).records;
    }
}
async function* expectedUnits(db: Db, job: FileProcessingJob, archive: ArchiveTarget): AsyncGenerator<FileProcessingUnit> {
    if (!job.manifestRef)
        throw new WorkspaceError('conflict', 'File manifest has not been sealed.');
    let ord = 0;
    for await (const record of manifestRecords(job.jobId, job.manifestRef, archive)) {
        if (record.kind === 'text') {
            if (!record.text.trim())
                continue;
            for (const unit of chunkTextUnits(`## Page ${record.page}\n\n${record.text}`))
                yield { ...unit, page: record.page, ord: ord++ };
        }
        else {
            const saved = await readCurrentFileImageAttempt(db, job.jobId, record.imageId);
            if (!saved || saved.state !== 'complete' || !saved.units || !saved.resultRef)
                throw new WorkspaceError('conflict', 'The sealed manifest has unfinished images.');
            const body = await archive.read(saved.resultRef.key, saved.resultRef.bytes + 1);
            if (body === undefined || body !== saved.pendingResponseSerialized || Buffer.byteLength(body) !== saved.resultRef.bytes || createHash('sha256').update(body).digest('hex') !== saved.resultRef.hash)
                throw new WorkspaceError('conflict', 'Completed paid image archive is missing or corrupt.');
            if (!isDeepStrictEqual(saved.units, fileImageResponseUnits(saved.pendingResponse, record)))
                throw new WorkspaceError('conflict', 'Completed image units changed.');
            for (const unit of saved.units)
                yield { ...unit, ord: ord++ };
        }
    }
}
async function* streamFileProcessingUnits(db: Db, jobId: string, archive: ArchiveTarget, revision: number, scope?: Scope): AsyncGenerator<FileProcessingUnit> {
    const job = await readFileProcessingJob(db, jobId, scope);
    assertRevision(job, revision);
    await visible(db, job);
    yield* expectedUnits(db, job, withArchiveDeadline(archive));
}
/** Compatibility/inspection helper for bounded callers; production uses the stream. */
export async function assembleFileProcessingUnits(db: Db, jobId: string, archive: ArchiveTarget, revision: number, scope?: Scope): Promise<FileProcessingUnit[]> {
    const result: FileProcessingUnit[] = [];
    for await (const unit of streamFileProcessingUnits(db, jobId, archive, revision, scope))
        result.push(unit);
    return result;
}
function canonicalUnit(unit: FileProcessingUnit) { return { ord: unit.ord, kind: unit.kind, text: unit.text, confidence: unit.confidence ?? null, uncertain: unit.uncertain, page: unit.page ?? null, imageId: unit.imageId ?? null, imageOrdinal: unit.imageOrdinal ?? null, imageRole: unit.imageRole ?? null }; }
function previewPrefix(text: string) { let result = text.slice(0, 64000); if (result.length && /[\uD800-\uDBFF]/.test(result.at(-1)!) && /[\uDC00-\uDFFF]/.test(text.charAt(result.length)))
    result = result.slice(0, -1); return result; }
async function receiptDigest(db: Db, jobId: string): Promise<string> {
    const digest = createHash('sha256');
    let after = { page: 0, ordinal: -1 };
    for (;;) {
        const { rows } = await db.query<{
            page: number;
            ordinal: number;
            image_id: string;
            attempt: number;
            state: string;
            result_ref: FileArchiveRef | null;
            units: FileProcessingUnit[] | null;
        }>(`SELECT i.page,i.ordinal,i.image_id,i.attempt,i.state,a.result_ref,a.units FROM file_processing_images i LEFT JOIN file_processing_attempts a ON a.job_id=i.job_id AND a.image_id=i.image_id AND a.attempt=i.attempt WHERE i.job_id=$1 AND (i.page,i.ordinal)>($2,$3) ORDER BY i.page,i.ordinal LIMIT 1`, [jobId, after.page, after.ordinal]);
        const row = rows[0];
        if (!row)
            break;
        digest.update(JSON.stringify({ id: row.image_id, attempt: row.attempt, state: row.state, ref: row.result_ref, units: (row.units ?? []).map(canonicalUnit) }) + '\n');
        after = { page: row.page, ordinal: row.ordinal };
    }
    return digest.digest('hex');
}
async function stagingTransaction<T>(db: TransactableDb, sectorId: string, work: (tx: Db) => Promise<T>): Promise<T> {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`workspace:${sectorId}`]);
        const result = await work({ query: async <R>(sql: string, params?: unknown[]) => { const value = await client.query(sql, params); return { rows: value.rows as R[], rowCount: value.rowCount }; } });
        await client.query('COMMIT');
        return result;
    }
    catch (error) {
        await client.query('ROLLBACK');
        throw error;
    }
    finally {
        client.release();
    }
}
async function fence(db: Db, jobId: string, revision: number, manifest: FileArchiveRef | null, scope?: Scope) { const current = await readFileProcessingJob(db, jobId, scope); assertRevision(current, revision); await visible(db, current); if (current.totalImages === null || current.completedImages !== current.totalImages || current.failedImages || current.uncertainImages || !isDeepStrictEqual(current.manifestRef, manifest) || !['queued', 'processing'].includes(current.state))
    throw new WorkspaceError('conflict', 'File processing changed during unit staging.'); return current; }
async function stagedDigest(db: Db, documentId: string): Promise<{
    count: number;
    hash: string;
}> { const hash = createHash('sha256'); let after = -1, count = 0; for (;;) {
    const { rows } = await db.query<{
        ord: number;
        kind: ExtractedUnit['kind'];
        text: string;
        confidence: number | null;
        uncertain: boolean;
        source_page: number | null;
        source_image_id: string | null;
        source_image_ordinal: number | null;
        source_image_role: FileProcessingUnit['imageRole'] | null;
    }>('SELECT * FROM sector_document_units WHERE document_id=$1 AND ord>$2 ORDER BY ord LIMIT 100', [documentId, after]);
    if (!rows.length)
        break;
    for (const r of rows) {
        if (r.ord !== count)
            throw new WorkspaceError('conflict', 'Staged file unit coverage has a gap.');
        hash.update(JSON.stringify(canonicalUnit({ ord: r.ord, kind: r.kind, text: r.text, uncertain: r.uncertain, ...(r.confidence === null ? {} : { confidence: r.confidence }), ...(r.source_page === null ? {} : { page: r.source_page }), ...(r.source_image_id === null ? {} : { imageId: r.source_image_id }), ...(r.source_image_ordinal === null ? {} : { imageOrdinal: r.source_image_ordinal }), ...(r.source_image_role === null ? {} : { imageRole: r.source_image_role }) })) + '\n');
        count++;
        after = r.ord;
    }
} return { count, hash: hash.digest('hex') }; }
export async function stageAndPublishFileProcessingJob(db: TransactableDb, jobId: string, archive: ArchiveTarget, revision: number, scope?: Scope, expectedArray?: FileProcessingUnit[]): Promise<void> {
    return logOp(logger, 'file.processing.publish.stream', async () => {
        const job = await readFileProcessingJob(db, jobId, scope);
        assertRevision(job, revision);
        await visible(db, job);
        archive = withArchiveDeadline(archive);
        const digestBefore = await receiptDigest(db, jobId), hash = createHash('sha256');
        let count = 0, fullChars = 0, preview = '', previewStopped = false, batch: FileProcessingUnit[] = [];
        const flush = async () => { if (!batch.length || job.state === 'complete')
            return; const owned = batch; batch = []; await stagingTransaction(db, job.sectorId, async (tx) => { await fence(tx, jobId, revision, job.manifestRef, scope); await tx.query(`INSERT INTO sector_document_units(document_id,ord,kind,text,confidence,uncertain,sha256,source_page,source_image_id,source_image_ordinal,source_image_role) SELECT $1,u.ord,u.kind,u.text,u.confidence,u.uncertain,u.sha256,u.page,u.image_id,u.image_ordinal,u.image_role FROM jsonb_to_recordset($2::jsonb) AS u(ord integer,kind text,text text,confidence double precision,uncertain boolean,sha256 text,page integer,image_id text,image_ordinal integer,image_role text) ON CONFLICT(document_id,ord) DO UPDATE SET kind=EXCLUDED.kind,text=EXCLUDED.text,confidence=EXCLUDED.confidence,uncertain=EXCLUDED.uncertain,sha256=EXCLUDED.sha256,source_page=EXCLUDED.source_page,source_image_id=EXCLUDED.source_image_id,source_image_ordinal=EXCLUDED.source_image_ordinal,source_image_role=EXCLUDED.source_image_role`, [job.documentId, JSON.stringify(owned.map(u => ({ ...u, sha256: sha256Hex(u.text), confidence: u.confidence ?? null, image_id: u.imageId ?? null, image_ordinal: u.imageOrdinal ?? null, image_role: u.imageRole ?? null })))]); await tx.query('UPDATE file_processing_jobs SET staged_revision=$2,staged_count=$3,staged_digest=$4,staged_full_chars=$5,staged_preview=$6,updated_at=now() WHERE id=$1', [jobId, revision, count, hash.copy().digest('hex'), fullChars, preview]); }); };
        for await (const unit of streamFileProcessingUnits(db, jobId, archive, revision, scope)) {
            validateUnits([unit]);
            if (expectedArray && !isDeepStrictEqual(expectedArray[count], unit))
                throw new WorkspaceError('conflict', 'Publication units do not cover the sealed manifest.');
            const separator = count ? '\n\n' : '';
            fullChars += separator.length + unit.text.length;
            if (!previewStopped) {
                preview = previewPrefix(preview + separator + unit.text);
                if (fullChars > 64000)
                    previewStopped = true;
            }
            hash.update(JSON.stringify(canonicalUnit(unit)) + '\n');
            count++;
            if (job.state !== 'complete') {
                batch.push(unit);
                if (batch.length === 100)
                    await flush();
            }
        }
        if (expectedArray && expectedArray.length !== count)
            throw new WorkspaceError('conflict', 'Publication units do not cover the sealed manifest.');
        const digest = hash.copy().digest('hex');
        if (job.state === 'complete') {
            if (job.extractionHash !== digest)
                throw new WorkspaceError('conflict', 'Completed extraction changed.');
            return;
        }
        await flush();
        await stagingTransaction(db, job.sectorId, async (tx) => { await fence(tx, jobId, revision, job.manifestRef, scope); await tx.query('DELETE FROM sector_document_units WHERE document_id=$1 AND ord>=$2', [job.documentId, count]); });
        const staged = await stagedDigest(db, job.documentId);
        if (staged.count !== count || staged.hash !== digest)
            throw new WorkspaceError('conflict', 'Staged extraction does not match complete source coverage.');
        const digestAfter = await receiptDigest(db, jobId);
        if (digestBefore !== digestAfter)
            throw new WorkspaceError('conflict', 'Image receipt ownership changed during staging.');
        await workspaceTransaction(db, job.sectorId, async (tx) => { const current = await fence(tx, jobId, revision, job.manifestRef, scope); if (current.totalImages === null || current.completedImages !== current.totalImages || current.failedImages || current.uncertainImages)
            throw new WorkspaceError('conflict', 'File extraction is incomplete.'); const saved = await tx.query<{
            staged_revision: number;
            staged_count: string;
            staged_digest: string;
        }>('SELECT staged_revision,staged_count,staged_digest FROM file_processing_jobs WHERE id=$1', [jobId]); if (count && (!saved.rows[0] || saved.rows[0].staged_revision !== revision || Number(saved.rows[0].staged_count) !== count || saved.rows[0].staged_digest !== digest))
            throw new WorkspaceError('conflict', 'Staged file checkpoint changed.'); await tx.query("UPDATE sector_documents SET text=$2,full_chars=$3,text_truncated=$4,status='indexed' WHERE id=$1", [job.documentId, preview, fullChars, preview.length < fullChars]); await tx.query("UPDATE file_processing_jobs SET state='complete',extraction_hash=$2,last_error_code=NULL,updated_at=now() WHERE id=$1", [jobId, digest]); await appendEvent(tx, { idempotencyKey: `file-job:${jobId}:indexed`, partition: `sector:${job.sectorId}`, type: 'sector.file.processing.indexed', payload: { jobId, fileId: job.documentId, extractionHash: digest, unitCount: count, fullChars } }); });
    }, { jobId, revision });
}
export async function finalizeFileProcessingJob(db: TransactableDb, jobId: string, units: FileProcessingUnit[], archive: ArchiveTarget, revision: number, scope?: Scope): Promise<void> { return stageAndPublishFileProcessingJob(db, jobId, archive, revision, scope, units); }
export async function retryFileProcessingJob(db: TransactableDb, input: {
    sectorId: string;
    fileId: string;
    jobId: string;
    revision: number;
    allowDuplicatePaid: boolean;
    author: string;
    scope?: Scope;
}): Promise<FileProcessingJob> {
    return logOp(logger, 'file.processing.retry', async () => {
        const job = await readFileProcessingJob(db, input.jobId, input.scope);
        if (job.sectorId !== input.sectorId || job.documentId !== input.fileId)
            throw new WorkspaceError('not_found', 'File processing job not found.');
        await workspaceTransaction(db, job.sectorId, async (tx) => {
            const current = await readFileProcessingJob(tx, job.jobId, input.scope);
            await visible(tx, current);
            if (current.revision !== input.revision)
                throw new WorkspaceError('conflict', 'File processing changed. Review the latest state.');
            if (!['failed', 'uncertain', 'paused'].includes(current.state))
                throw new WorkspaceError('conflict', 'File is not awaiting retry.');
            const active = await tx.query<{
                image_id: string;
                attempt: number;
                deadline_at: Date;
            }>(`SELECT i.image_id,i.attempt,a.deadline_at FROM file_processing_images i JOIN file_processing_attempts a ON a.job_id=i.job_id AND a.image_id=i.image_id AND a.attempt=i.attempt WHERE i.job_id=$1 AND i.state='requesting'`, [job.jobId]);
            if (active.rows.some(r => new Date(r.deadline_at).getTime() > Date.now()))
                throw new WorkspaceError('conflict', 'An image request is still in flight. Wait for its bounded operation to settle.');
            if ((current.retryRequiresApproval || active.rows.length > 0) && !input.allowDuplicatePaid)
                throw new WorkspaceError('conflict', 'This retry may repeat paid work. Explicit owner approval is required.');
            for (const request of active.rows)
                await tx.query("UPDATE file_processing_attempts SET state='uncertain',error_code='provider_outcome_unknown',updated_at=now() WHERE job_id=$1 AND image_id=$2 AND attempt=$3 AND state='requesting'", [job.jobId, request.image_id, request.attempt]);
            await tx.query("UPDATE file_processing_images SET state='pending' WHERE job_id=$1 AND state IN ('failed','uncertain','requesting','claimed')", [job.jobId]);
            await tx.query("UPDATE file_processing_jobs SET state='queued',revision=revision+1,dispatch_state='unreserved',dispatch_nonce=NULL,dispatch_workflow_id=NULL,dispatch_execution_id=NULL,last_error_code=NULL,updated_at=now() WHERE id=$1", [job.jobId]);
            await tx.query("UPDATE sector_documents SET status='processing' WHERE id=$1", [job.documentId]);
            await appendEvent(tx, { idempotencyKey: `file-job:${job.jobId}:retry:${input.revision + 1}`, partition: `sector:${job.sectorId}`, type: 'sector.file.processing.retry_approved', payload: { jobId: job.jobId, fileId: job.documentId, revision: input.revision + 1, author: input.author, allowDuplicatePaid: input.allowDuplicatePaid } });
        });
        return readFileProcessingJob(db, job.jobId, input.scope);
    }, { sectorId: input.sectorId });
}
async function readImageIdentity(db: Db, jobId: string, imageId: string, scope: Scope | undefined, checkVisible: boolean): Promise<FileImageIdentity> {
    const job = await readFileProcessingJob(db, jobId, scope);
    if (checkVisible)
        await visible(db, job);
    const { rows } = await db.query<{
        image_id: string;
        page: number;
        ordinal: number;
        image_hash: string;
        input_ref: FileArchiveRef;
        width: number;
        height: number;
        role: 'embedded' | 'page-visual';
    }>('SELECT * FROM file_processing_images WHERE job_id=$1 AND image_id=$2', [jobId, imageId]);
    const r = rows[0];
    if (!r)
        throw new WorkspaceError('not_found', 'File image not found.');
    return FileImageIdentity.parse({ imageId: r.image_id, page: r.page, ordinal: r.ordinal, imageHash: r.image_hash, inputRef: r.input_ref, width: r.width, height: r.height, role: r.role });
}
export async function listSectorFileProcessing(db: Db, sectorId: string, scope?: Scope): Promise<Record<string, FileProcessingProgress>> {
    if (!(await getSector(db, sectorId, scope)))
        throw new WorkspaceError('not_found', 'Sector not found.');
    const { rows } = await db.query<JobRow>(`SELECT j.*,count(*) FILTER(WHERE i.state='complete')::int AS completed_images,count(*) FILTER(WHERE i.state='failed')::int AS failed_images,count(*) FILTER(WHERE i.state='uncertain')::int AS uncertain_images,count(*) FILTER(WHERE i.state='requesting')::int AS requesting_images,count(*) FILTER(WHERE i.state='failed' AND paid.request_started_at IS NOT NULL)::int AS paid_failed_images FROM file_processing_jobs j LEFT JOIN file_processing_images i ON i.job_id=j.id LEFT JOIN file_processing_attempts paid ON paid.job_id=i.job_id AND paid.image_id=i.image_id AND paid.attempt=i.attempt WHERE j.sector_id=$1 GROUP BY j.id`, [sectorId]);
    return Object.fromEntries(rows.map(row => [row.document_id, fileProcessingProgress(view(row))]));
}
export async function readFileImage(db: Db, jobId: string, imageId: string, scope?: Scope): Promise<FileImageIdentity> { return readImageIdentity(db, jobId, imageId, scope, true); }
/** Private worker recovery only: never expose the lease/producer through UI or MCP. */
export async function readFileImageAttempt(db: Db, jobId: string, imageId: string, attempt: number, scope?: Scope) {
    return logOp(logger, 'file.processing.attempt.read', async () => {
        const job = await readFileProcessingJob(db, jobId, scope), image = await readImageIdentity(db, jobId, imageId, scope, false);
        if (!Number.isInteger(attempt) || attempt < 1)
            throw new DbContractError('Image attempt must be positive.');
        const { rows } = await db.query<{
            lease: string;
            producer_id: string;
            state: string;
            request_started_at: Date | null;
            pending_response: unknown;
            pending_response_text: string | null;
            result_ref: FileArchiveRef | null;
            units: FileProcessingUnit[] | null;
            error_code: string | null;
        }>('SELECT lease,producer_id,state,request_started_at,pending_response,pending_response_text,result_ref,units,error_code FROM file_processing_attempts WHERE job_id=$1 AND image_id=$2 AND attempt=$3', [jobId, imageId, attempt]);
        const row = rows[0];
        if (!row)
            throw new WorkspaceError('not_found', 'File image attempt not found.');
        return { job, image, attempt, lease: row.lease, producerId: row.producer_id, state: row.state, requestStartedAt: row.request_started_at ? new Date(row.request_started_at).toISOString() : null, pendingResponse: row.pending_response, pendingResponseSerialized: row.pending_response_text, resultRef: row.result_ref, units: row.units, errorCode: row.error_code };
    }, { jobId, imageId, attempt });
}
/** A proven unusable paid result needs an explicit owner decision before spending again. */
export async function rejectFileImageResponse(db: TransactableDb, jobId: string, imageId: string, attempt: number, lease: string, resultRef: FileArchiveRef, archive: ArchiveTarget, code: string, revision: number, scope?: Scope): Promise<void> {
    await readFileProcessingJob(db, jobId, scope);
    scopedRef(jobId, FileArchiveRef.parse(resultRef));
    const body = await withArchiveDeadline(archive).read(resultRef.key, resultRef.bytes + 1);
    if (body === undefined || Buffer.byteLength(body) !== resultRef.bytes || createHash('sha256').update(body).digest('hex') !== resultRef.hash)
        throw new WorkspaceError('conflict', 'Unusable paid response archive is missing or corrupt.');
    if (!['image_output_incomplete', 'image_output_unverified'].includes(code))
        throw new DbContractError('Unusable image output needs a verified reason code.');
    return guardedAttempt(db, jobId, imageId, attempt, lease, revision, scope, 'file.processing.response.reject', async (tx, job) => {
        const { rows } = await tx.query<{
            state: string;
            pending_response_text: string | null;
            result_ref: FileArchiveRef | null;
            error_code: string | null;
        }>('SELECT state,pending_response_text,result_ref,error_code FROM file_processing_attempts WHERE job_id=$1 AND image_id=$2 AND attempt=$3', [jobId, imageId, attempt]);
        const row = rows[0];
        if (!row || row.pending_response_text !== body)
            throw new WorkspaceError('conflict', 'Unusable response does not match the original paid receipt.');
        if (row.state === 'failed' && row.error_code === code && isDeepStrictEqual(row.result_ref, resultRef))
            return;
        if (row.state !== 'response-staged')
            throw new WorkspaceError('conflict', 'Only a current staged response may be rejected.');
        await tx.query("UPDATE file_processing_attempts SET state='failed',result_ref=$4,error_code=$5,updated_at=now() WHERE job_id=$1 AND image_id=$2 AND attempt=$3", [jobId, imageId, attempt, resultRef, code]);
        await tx.query("UPDATE file_processing_images SET state='failed' WHERE job_id=$1 AND image_id=$2 AND attempt=$3", [jobId, imageId, attempt]);
        await tx.query("UPDATE file_processing_jobs SET state='failed',last_error_code=$2,updated_at=now() WHERE id=$1", [jobId, code]);
        await tx.query("UPDATE sector_documents SET status='failed' WHERE id=$1", [job.documentId]);
    }, false);
}
/** Recover a canonical reply before claiming a successor that would spend again. */
export async function readCurrentFileImageAttempt(db: Db, jobId: string, imageId: string, scope?: Scope) {
    await readFileProcessingJob(db, jobId, scope);
    const { rows } = await db.query<{
        attempt: number;
    }>('SELECT attempt FROM file_processing_images WHERE job_id=$1 AND image_id=$2', [jobId, imageId]);
    const attempt = rows[0]?.attempt;
    return attempt ? readFileImageAttempt(db, jobId, imageId, attempt, scope) : null;
}
export async function readNextFileImage(db: Db, jobId: string, after: {
    page: number;
    ordinal: number;
} | null, revision: number, scope?: Scope): Promise<{
    imageId: string;
    page: number;
    ordinal: number;
} | null> {
    const job = await readFileProcessingJob(db, jobId, scope);
    assertRevision(job, revision);
    await visible(db, job);
    if (after)
        z.object({ page: z.number().int().positive(), ordinal: z.number().int().nonnegative() }).strict().parse(after);
    const { rows } = await db.query<{
        image_id: string;
        page: number;
        ordinal: number;
    }>('SELECT image_id,page,ordinal FROM file_processing_images WHERE job_id=$1 AND ($2::int IS NULL OR (page,ordinal)>($2,$3)) ORDER BY page,ordinal LIMIT 1', [jobId, after?.page ?? null, after?.ordinal ?? null]);
    const row = rows[0];
    return row ? { imageId: row.image_id, page: row.page, ordinal: row.ordinal } : null;
}
export async function pauseFileProcessingJob(db: TransactableDb, jobId: string, code: 'file_hidden' | 'file_cancelled', revision: number, scope?: Scope): Promise<void> {
    return receiptTransaction(db, jobId, scope, 'file.processing.pause', async (tx, job) => {
        assertRevision(job, revision);
        await tx.query("UPDATE file_processing_jobs SET state=CASE WHEN EXISTS(SELECT 1 FROM file_processing_images WHERE job_id=$1 AND state='requesting') THEN 'uncertain' ELSE 'paused' END,last_error_code=$2,updated_at=now() WHERE id=$1 AND state<>'complete'", [jobId, code]);
        await tx.query("UPDATE sector_documents SET status='processing' WHERE id=$1 AND status<>'indexed'", [job.documentId]);
    });
}
export async function readFileJobBoundary(db: Db, jobId: string, revision: number, scope?: Scope): Promise<{
    job: FileProcessingJob;
    hidden: boolean;
}> {
    const job = await readFileProcessingJob(db, jobId, scope);
    assertRevision(job, revision);
    const { rows } = await db.query<{
        hidden: boolean;
    }>('SELECT hidden FROM workspace_files WHERE sector_id=$1 AND file_id=$2', [job.sectorId, job.documentId]);
    return { job, hidden: rows[0]?.hidden ?? false };
}
/** Recreate a missing/corrupt archived reply from its exact durable paid record. */
export async function restoreFileImageArchive(db: Db, jobId: string, imageId: string, attempt: number, archive: ArchiveTarget, scope?: Scope): Promise<void> {
    return logOp(logger, 'file.processing.archive.restore', async () => {
        const saved = await readFileImageAttempt(db, jobId, imageId, attempt, scope);
        const ref = saved.resultRef, text = saved.pendingResponseSerialized;
        if (!ref || !text || Buffer.byteLength(text) !== ref.bytes || createHash('sha256').update(text).digest('hex') !== ref.hash)
            throw new WorkspaceError('conflict', 'No exact durable image response is available for archive recovery.');
        scopedRef(jobId, ref);
        archive = withArchiveDeadline(archive);
        let existing: string | undefined;
        try {
            existing = await archive.read(ref.key, ref.bytes + 1);
        }
        catch (error) {
            if (!(error instanceof ResearchSourceError) || error.code !== 'source_limit')
                throw error;
            logger.warn({ event: 'file.processing.archive.corrupt', code: 'source_limit', jobId, imageId, attempt }, 'Stored image response exceeds its recorded size; restoring exact durable content');
        }
        if (existing === text)
            return;
        await archive.write(ref.key, text);
        if (await archive.read(ref.key, ref.bytes + 1) !== text)
            throw new WorkspaceError('conflict', 'Image response archive recovery could not be verified.');
    }, { jobId, imageId, attempt });
}
/** A prepare heartbeat is not a substitute for this durable lifecycle transition. */
export async function beginFileProcessingJob(db: TransactableDb, jobId: string, revision: number, scope?: Scope): Promise<void> {
    return receiptTransaction(db, jobId, scope, 'file.processing.begin', async (tx, job) => {
        assertRevision(job, revision);
        await visible(tx, job);
        if (!['queued', 'processing'].includes(job.state))
            throw new WorkspaceError('conflict', 'File processing is not ready to prepare.');
        await tx.query("UPDATE file_processing_jobs SET state='processing',last_error_code=NULL,updated_at=now() WHERE id=$1", [jobId]);
    });
}
