// Actual keyed HTTP handlers + owned Postgres/archive. No provider/Temporal claim.
import {randomUUID} from 'node:crypto'
import {mkdtemp} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {Pool} from 'pg'
import {describe,expect,it,vi} from 'vitest'
import {buildApp} from '../../backend/src/app.js'
import {FilesystemTarget} from '../../backend/src/archive/targets.js'
import {hashKey} from '../../backend/src/auth/keys.js'
import {createSector,registerApiKey,setFileVisibility,failFileProcessingJob,readFileProcessingJob,fileProcessingArchivePrefix,registerFileImages,stageAndPublishFileProcessingJob,reserveFileProcessingDispatch,markFileProcessingDispatchOutcome,listFileAdmissionCandidates} from '../../backend/src/db/index.js'
import {reconcileFileAdmissionPage} from '../../backend/src/temporal/activities/file-admission.js'
import {createHash} from 'node:crypto'
import {projectNewEvents} from '../../backend/src/projector.js'
import {FakeRunsGateway} from './fake-gateway.js'
import {ensureTestDb,TEST_DATABASE_URL} from './db-helper.js'
const scope={tenantId:'TEST file API owner',projectId:null}
const header=(key='TEST approver')=>({authorization:`Bearer ${key}`})
async function fixture(){
 const pool=new Pool({connectionString:await ensureTestDb('kardata_test_file_processing_api')})
 const archive=new FilesystemTarget(await mkdtemp(join(tmpdir(),'kardata-file-api-')))
 const runs=Object.assign(new FakeRunsGateway(pool),{startFileProcessing:vi.fn(async(_jobId:string,_revision:number)=>{})})
 const app=buildApp({pool,archiveTarget:archive,runs,auth:true})
 for(const [key,role,tenant] of [['TEST approver','approver',scope.tenantId],['TEST viewer','viewer',scope.tenantId],['TEST foreign','approver','TEST foreign tenant']] as const)await registerApiKey(pool,{keyId:key,keyHash:hashKey(key),scope:{tenantId:tenant,projectId:null},role})
 const sectorId='sec-'+randomUUID();await createSector(pool,{sectorId,name:'TEST file API',scope});await projectNewEvents(pool)
 const bytes=Buffer.from('%PDF-1.7\nTEST queue-only retention fixture\n')
 const response=await app.inject({method:'POST',url:`/v1/sectors/${sectorId}/documents`,headers:header(),payload:{filename:'TEST queue.pdf',contentBase64:bytes.toString('base64')}})
 expect(response.statusCode).toBe(201)
 return {pool,archive,runs,app,sectorId,bytes,file:response.json().data}
}
describe.skipIf(!TEST_DATABASE_URL)('PDF processing HTTP contracts [F:http.attachSectorDocument] [F:http.listSectorFiles] [F:http.getSectorFileBody] [F:http.getSectorFileUnits] [F:http.retryFileProcessing] [F:backend.activity.file_admission.reconcileFileAdmissionPage]',()=>{
 it('retains original bytes, queues promptly and exposes only scoped public progress',async()=>{
  const f=await fixture()
  try{
   expect(f.file.status).toBe('processing');expect(f.file.processing.state).toBe('queued');expect(f.runs.startFileProcessing).toHaveBeenCalledOnce()
   const files=await f.app.inject({method:'GET',url:`/v1/sectors/${f.sectorId}/files`,headers:header('TEST viewer')})
   expect(files.statusCode).toBe(200);expect(files.json().data[0].processing.jobId).toBe(f.file.processing.jobId)
   expect(JSON.stringify(files.json())).not.toMatch(/archiveKey|manifestRef|lease|pendingResponse|producerId/)
   const body=await f.app.inject({method:'GET',url:`/v1/sectors/${f.sectorId}/files/${f.file.id}/body`,headers:header()})
   expect(body.statusCode).toBe(200);expect(Buffer.from(body.json().data.contentBase64,'base64')).toEqual(f.bytes)
   const partial=await f.app.inject({method:'GET',url:`/v1/sectors/${f.sectorId}/files/${f.file.id}/units?fromOrd=0&limit=20`,headers:header()})
   expect(partial.json().data).toMatchObject({status:'processing',units:[],nextOrd:null,fullChars:0})
  }finally{await f.app.close();await f.pool.end()}
 })
 it('requires approver retry, rejects stale revisions and retains file identity and originals',async()=>{
  const f=await fixture()
  try{
   await failFileProcessingJob(f.pool,f.file.processing.jobId,'image_pre_effect_failed',0,scope)
   const url=`/v1/sectors/${f.sectorId}/files/${f.file.id}/retry`,payload={jobId:f.file.processing.jobId,revision:0,allowDuplicatePaid:false}
   expect((await f.app.inject({method:'POST',url,headers:header('TEST viewer'),payload})).statusCode).toBe(403)
   expect((await f.app.inject({method:'POST',url,headers:header('TEST foreign'),payload})).statusCode).toBe(404)
   const success=await f.app.inject({method:'POST',url,headers:header(),payload});expect(success.statusCode).toBe(200)
   expect(success.json().data).toMatchObject({jobId:payload.jobId,revision:1,state:'queued'})
   expect((await f.app.inject({method:'POST',url,headers:header(),payload})).statusCode).toBe(409)
   expect((await readFileProcessingJob(f.pool,payload.jobId,scope)).documentId).toBe(f.file.id)
  }finally{await f.app.close();await f.pool.end()}
 })
 it('denies hidden or foreign indexed sections and validates bounded cursors',async()=>{
  const f=await fixture()
  try{
   const url=`/v1/sectors/${f.sectorId}/files/${f.file.id}/units`
   expect((await f.app.inject({method:'GET',url,headers:header('TEST foreign')})).statusCode).toBe(404)
   for(const query of ['?fromOrd=-1','?fromOrd=2147483648','?limit=101','?unknown=1'])expect((await f.app.inject({method:'GET',url:url+query,headers:header()})).statusCode).toBe(400)
   await setFileVisibility(f.pool,f.sectorId,f.file.id,true,scope)
   expect((await f.app.inject({method:'GET',url,headers:header()})).statusCode).toBe(403)
  }finally{await f.app.close();await f.pool.end()}
 })
 it('publishes complete native content with an explicit bounded preview and exact section pagination',async()=>{
  const f=await fixture()
  try{
   const jobId=f.file.processing.jobId
   const text='TEST complete native text. '.repeat(12000)
   const body=JSON.stringify({version:1,records:[{kind:'text',page:1,text}]})
   const key=fileProcessingArchivePrefix(jobId)+'manifest.json'
   await f.archive.write(key,body)
   await registerFileImages(f.pool,jobId,{key,hash:createHash('sha256').update(body).digest('hex'),bytes:Buffer.byteLength(body)},[],f.archive,0,scope)
   await stageAndPublishFileProcessingJob(f.pool,jobId,f.archive,0,scope)
   const preview=await f.app.inject({method:'GET',url:`/v1/sectors/${f.sectorId}/files/${f.file.id}/body`,headers:header()})
   expect(preview.statusCode).toBe(200)
   expect(preview.json().data).toMatchObject({textTruncated:true,nextOrd:0})
   expect(preview.json().data.fullChars).toBeGreaterThan(64000)
   expect(preview.json().data.text.length).toBeLessThanOrEqual(64000)
   const url=`/v1/sectors/${f.sectorId}/files/${f.file.id}/units`
   const first=await f.app.inject({method:'GET',url:url+'?fromOrd=0&limit=20',headers:header('TEST viewer')})
   expect(first.json().data.units).toHaveLength(20)
   expect(first.json().data.nextOrd).toBe(20)
   const second=await f.app.inject({method:'GET',url:url+'?fromOrd=20&limit=20',headers:header()})
   expect(second.json().data.units[0].ord).toBe(20)
   expect(second.json().data.fullChars).toBe(preview.json().data.fullChars)
   await setFileVisibility(f.pool,f.sectorId,f.file.id,true,scope)
   expect((await f.app.inject({method:'GET',url,headers:header()})).statusCode).toBe(403)
  }finally{await f.app.close();await f.pool.end()}
 })
 it('retains a retry RPC lost acknowledgement as uncertain and allows exact running-owner reconciliation',async()=>{
  const f=await fixture()
  try{
   const jobId=f.file.processing.jobId
   await failFileProcessingJob(f.pool,jobId,'image_pre_effect_failed',0,scope)
   f.runs.startFileProcessing.mockImplementation(async(id,revision)=>{
    const reservation=await reserveFileProcessingDispatch(f.pool,id,revision)
    await markFileProcessingDispatchOutcome(f.pool,{jobId:id,revision,workflowId:reservation.workflowId,nonce:reservation.nonce,outcome:'uncertain'})
    throw new Error('TEST RPC acknowledgement unavailable')
   })
   const response=await f.app.inject({method:'POST',url:`/v1/sectors/${f.sectorId}/files/${f.file.id}/retry`,headers:header(),payload:{jobId,revision:0,allowDuplicatePaid:false}})
   expect(response.statusCode).toBe(500)
   expect(await readFileProcessingJob(f.pool,jobId,scope)).toMatchObject({state:'uncertain',errorCode:'dispatch_outcome_unknown',retryRequiresApproval:true,revision:1})
   expect((await listFileAdmissionCandidates(f.pool)).some(job=>job.jobId===jobId)).toBe(true)
   const neverStart=vi.fn(async()=>{})
   await reconcileFileAdmissionPage(f.pool,'',async()=>({state:'running',executionId:randomUUID()}),neverStart)
   expect(neverStart).not.toHaveBeenCalled()
   expect(await readFileProcessingJob(f.pool,jobId,scope)).toMatchObject({state:'queued',errorCode:null,dispatchState:'confirmed'})
  }finally{await f.app.close();await f.pool.end()}
 })
})
