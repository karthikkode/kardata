// Admission repair is trusted worker maintenance, never a model/tool authority.
import {Context} from '@temporalio/activity'
import {Client,Connection,WorkflowNotFoundError} from '@temporalio/client'
import {defaultPayloadConverter} from '@temporalio/common'
import {listFileAdmissionCandidates,readFileJobBoundary,pauseFileProcessingJob,markFileProcessingDispatchOutcome,failFileProcessingJob,fileProcessingWorkflowId,workerPoolFromEnv,type TransactableDb,type FileProcessingJob} from '../../db/index.js'
import {projectNewEvents} from '../../projector.js'
import {createLogger,logOp} from '../../observability/logging.js'
import {connectClient,temporalNamespace} from '../connection.js'
import {TemporalRunsGateway} from '../runs-gateway.js'

export type FileAdmissionOwner={state:'running'|'closed';executionId:string}|{state:'absent'|'unavailable'|'mismatch'}
export async function inspectFileAdmissionOwner(client:Client,job:FileProcessingJob):Promise<FileAdmissionOwner>{
 const workflowId=fileProcessingWorkflowId(job.jobId,job.revision),deadline=Date.now()+2000
 try{
  const description=await client.connection.withDeadline(deadline,()=>client.workflow.getHandle(workflowId).describe())
  if(description.type!=='fileProcessing')return {state:'mismatch'}
  const history=await client.connection.withDeadline(deadline,()=>client.connection.workflowService.getWorkflowExecutionHistory({namespace:client.options.namespace,execution:{workflowId,runId:description.runId},maximumPageSize:20}))
  if(Buffer.byteLength(JSON.stringify(history.history?.events??[]))>1024*1024)return {state:'mismatch'}
  const first=history.history?.events?.find(event=>event.workflowExecutionStartedEventAttributes)?.workflowExecutionStartedEventAttributes
  const payload=first?.input?.payloads?.[0]
  if(!payload)return {state:'mismatch'}
  const input=defaultPayloadConverter.fromPayload<{jobId?:string;revision?:number;dispatchNonce?:string}>(payload)
  if(input.jobId!==job.jobId||input.revision!==job.revision||!job.dispatchNonce||input.dispatchNonce!==job.dispatchNonce)return {state:'mismatch'}
  return {state:description.status.name==='RUNNING'?'running':'closed',executionId:description.runId}
 }catch(error){
  if(error instanceof WorkflowNotFoundError||(error&&typeof error==='object'&&'code'in error&&error.code===5))return {state:'absent'}
  createLogger().warn({event:'file.admission.owner_unavailable',jobId:job.jobId,code:error instanceof Error?error.name:'unknown'},'File owner status unavailable')
  return {state:'unavailable'}
 }
}
export async function reconcileFileAdmissionPage(db:TransactableDb,cursor:string,inspect:(job:FileProcessingJob)=>Promise<FileAdmissionOwner>,start:(jobId:string,revision:number)=>Promise<void>,heartbeat:()=>void=()=>{}){
 return logOp(createLogger({op:'file.admission'}),'file.admission.page',async()=>{
  const projection=await projectNewEvents(db)
  if(!projection.caughtUp)return {cursor,inspected:0,started:0,recovered:0,parked:0,deferred:true}
  const candidates=await listFileAdmissionCandidates(db,cursor,100)
  let started=0,recovered=0,parked=0
  for(let at=0;at<candidates.length;at+=4){await Promise.all(candidates.slice(at,at+4).map(async candidate=>{
   const boundary=await readFileJobBoundary(db,candidate.jobId,candidate.revision)
   const job=boundary.job;heartbeat()
   if(boundary.hidden){await pauseFileProcessingJob(db,job.jobId,'file_hidden',job.revision);parked++;return}
   const owner=await inspect(job)
   if(owner.state==='running'&&job.dispatchNonce){await markFileProcessingDispatchOutcome(db,{jobId:job.jobId,revision:job.revision,nonce:job.dispatchNonce,workflowId:fileProcessingWorkflowId(job.jobId,job.revision),outcome:'confirmed',executionId:owner.executionId});recovered++;return}
   if(owner.state==='unavailable'&&['unreserved','confirmed'].includes(job.dispatchState))return
   if(owner.state==='closed'){await failFileProcessingJob(db,job.jobId,'file_owner_closed',job.revision);parked++;return}
   if(owner.state==='absent'&&job.dispatchState==='unreserved'&&job.state==='queued'){
    try{await start(job.jobId,job.revision);started++}catch(error){await failFileProcessingJob(db,job.jobId,'dispatch_outcome_unknown',job.revision);createLogger().warn({event:'file.admission.dispatch_unresolved',jobId:job.jobId,code:error instanceof Error?error.name:'unknown'},'File admission requires owner review');parked++}
    return
   }
   if(job.dispatchNonce){await markFileProcessingDispatchOutcome(db,{jobId:job.jobId,revision:job.revision,nonce:job.dispatchNonce,workflowId:fileProcessingWorkflowId(job.jobId,job.revision),outcome:'uncertain'})}
   else await failFileProcessingJob(db,job.jobId,'dispatch_outcome_unknown',job.revision)
   parked++
  }));heartbeat()}
  return {cursor:candidates.length<100?'':candidates.at(-1)!.jobId,inspected:candidates.length,started,recovered,parked,deferred:false}
 },{cursor})
}
export async function fileAdmissionPageActivity(cursor:string){
 const connection:Connection=await connectClient(),context=Context.current()
 try{
  const client=new Client({connection,namespace:context.info.namespace??temporalNamespace()})
  const db=workerPoolFromEnv(),gateway=new TemporalRunsGateway(db,connection)
  return await reconcileFileAdmissionPage(db,cursor,job=>inspectFileAdmissionOwner(client,job),(id,revision)=>gateway.startFileProcessing(id,revision),()=>context.heartbeat({phase:'file-admission'}))
 }finally{await connection.close()}
}
