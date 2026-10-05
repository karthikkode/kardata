// File-processing dispatch: workflow-id building, dispatch reservation
// and outcome recording, and admission-candidate listing.
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { Scope } from '../auth/keys.js'
import { appendEvent, type Db } from './events.js'
import type { TransactableDb } from './checkpoints.js'
import { DbContractError, WorkspaceError } from './errors.js'
import { assertRevision, receiptTransaction, visible, type FileProcessingJob } from './file-jobs.js'
import { Id } from './workspace.js'

export function fileProcessingWorkflowId(jobId:string,revision:number):string {Id.parse(jobId);if(!Number.isInteger(revision)||revision<0)throw new DbContractError('File revision must be nonnegative.');return `file-processing-${jobId}-r${revision}`;}
export async function reserveFileProcessingDispatch(db:TransactableDb,jobId:string,revision:number,nonce:string=randomUUID(),scope?:Scope):Promise<{workflowId:string;nonce:string;ownsReservation:boolean;state:FileProcessingJob['dispatchState']}> {
 z.string().uuid().parse(nonce)
 return receiptTransaction(db,jobId,scope,'file.processing.dispatch.reserve',async(tx,job)=>{
  assertRevision(job,revision);await visible(tx,job)
  const workflowId=fileProcessingWorkflowId(jobId,revision)
  if(!['queued','processing'].includes(job.state))throw new WorkspaceError('conflict','File admission is awaiting owner review.')
  if(job.dispatchState!=='unreserved'&&!job.dispatchNonce)throw new WorkspaceError('conflict','File admission is missing its canonical reservation.');
  if(job.dispatchState!=='unreserved')return {workflowId,nonce:job.dispatchNonce!,ownsReservation:job.dispatchState==='reserved'&&job.dispatchNonce===nonce,state:job.dispatchState}
  await tx.query("UPDATE file_processing_jobs SET dispatch_state='reserved',dispatch_nonce=$2,dispatch_workflow_id=$3,updated_at=now() WHERE id=$1",[jobId,nonce,workflowId])
  await appendEvent(tx,{idempotencyKey:`file-job:${jobId}:dispatch:${revision}:reserve`,partition:`sector:${job.sectorId}`,type:'sector.file.dispatch.reserved',payload:{jobId,revision,workflowId,nonce}})
  return {workflowId,nonce,ownsReservation:true,state:'reserved'}
 })
}
export async function markFileProcessingDispatchOutcome(db:TransactableDb,input:{jobId:string;revision:number;nonce:string;workflowId:string;outcome:'confirmed'|'uncertain';executionId?:string;scope?:Scope}):Promise<void> {
 return receiptTransaction(db,input.jobId,input.scope,'file.processing.dispatch.outcome',async(tx,job)=>{
  assertRevision(job,input.revision)
  if(job.dispatchNonce!==input.nonce||job.dispatchWorkflowId!==input.workflowId||input.workflowId!==fileProcessingWorkflowId(input.jobId,input.revision))throw new WorkspaceError('conflict','A different file admission owns this outcome.')
  if(input.outcome==='confirmed'&&!input.executionId)throw new DbContractError('Confirmed file admission requires exact execution identity.')
  if(job.dispatchState==='confirmed'&&input.outcome==='uncertain')return
  await tx.query('UPDATE file_processing_jobs SET dispatch_state=$2,dispatch_execution_id=COALESCE($3,dispatch_execution_id),updated_at=now() WHERE id=$1',[input.jobId,input.outcome,input.executionId??null])
  await appendEvent(tx,{idempotencyKey:`file-job:${input.jobId}:dispatch:${input.revision}:${input.outcome}:${input.executionId??'unknown'}`,partition:`sector:${job.sectorId}`,type:'sector.file.dispatch.outcome',payload:{jobId:input.jobId,revision:input.revision,workflowId:input.workflowId,outcome:input.outcome,...(input.executionId?{executionId:input.executionId}:{})}})
  if(input.outcome==='uncertain'&&job.state!=='complete'){
   await tx.query("UPDATE file_processing_jobs SET state='uncertain',last_error_code='dispatch_outcome_unknown' WHERE id=$1",[input.jobId])
   await tx.query("UPDATE sector_documents SET status='failed' WHERE id=$1 AND status<>'indexed'",[job.documentId])
  }else if(input.outcome==='confirmed'&&job.state==='uncertain'&&job.errorCode==='dispatch_outcome_unknown'&&!job.uncertainImages){
   const flags=await tx.query('SELECT 1 FROM workspace_files WHERE sector_id=$1 AND file_id=$2 AND hidden=true',[job.sectorId,job.documentId])
   if(!flags.rows.length){await tx.query("UPDATE file_processing_jobs SET state='queued',last_error_code=NULL WHERE id=$1",[input.jobId]);await tx.query("UPDATE sector_documents SET status='processing' WHERE id=$1",[job.documentId])}
  }
 })
}
export async function listFileAdmissionCandidates(db:Db,afterId='',limit=100):Promise<Array<{jobId:string;revision:number}>> {
 if(!Number.isInteger(limit)||limit<1||limit>100)throw new DbContractError('File admission pages require1–100 jobs.')
 const {rows}=await db.query<{id:string;revision:number}>("SELECT id,revision FROM file_processing_jobs WHERE id>$1 AND (state='queued' OR (state='uncertain' AND last_error_code='dispatch_outcome_unknown')) ORDER BY id LIMIT $2",[afterId,limit])
 return rows.map(r=>({jobId:r.id,revision:r.revision}))
}
