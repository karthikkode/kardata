import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { describe,expect,it,vi } from 'vitest'
import { buildApp } from '../../backend/src/app.js'
import { hashKey } from '../../backend/src/auth/keys.js'
import { appendEvent,beginThreadTurn,createSector,createSession,listReconciliationCandidates,recordReconciliation,registerApiKey,renameSession,reserveExecutionIntent } from '../../backend/src/db/index.js'
import { listSupervisionAlerts } from '../../backend/src/db/alerts.js'
import { projectNewEvents } from '../../backend/src/projector.js'
import * as projector from '../../backend/src/projector.js'
import { reconcileObservation } from '../../backend/src/observability/reconciliation.js'
import { ensureTestDb,TEST_DATABASE_URL } from './db-helper.js'

const scope={tenantId:'TEST alerts owner',projectId:null}
async function fixture() {
  const pool=new Pool({connectionString:await ensureTestDb('kardata_test_alerts')})
  const session=await createSession(pool,'TEST alert session',scope)
  await registerApiKey(pool,{keyId:'TEST viewer',keyHash:hashKey('TEST viewer key'),scope,role:'viewer'})
  await projectNewEvents(pool)
  return {pool,session}
}
async function observe(pool:Pool,sessionId:string,kind='missing-heartbeat') {
  return appendEvent(pool,{idempotencyKey:randomUUID(),partition:`session:${sessionId}`,type:'t.reconciliation.finding',payload:{threadKey:sessionId,kind,response:'observe',reason:'TEST secret body must never escape',ownerExecutionId:'TEST private execution'}})
}
async function park(pool:Pool,sessionId:string) {
  const input={sessionId,threadKey:sessionId,workflowId:`session-run-${sessionId}`,requestKey:randomUUID()}
  const epoch=await reserveExecutionIntent(pool,input),executionId=randomUUID()
  await beginThreadTurn(pool,sessionId,'TEST original task',{...input,epoch,executionId,firstExecutionId:executionId})
  const candidate=(await listReconciliationCandidates(pool))[0]!
  const finding=reconcileObservation(candidate,{state:'closed',executionId},Date.now())[0]!
  expect(finding.response).toBe('park')
  await recordReconciliation(pool,candidate,finding,1)
  await projectNewEvents(pool)
  return input
}

describe.skipIf(!TEST_DATABASE_URL)('scoped in-app supervision delivery',()=>{
  it('requires a validated key even in open app mode and inherits request correlation',async()=>{
    const {pool,session}=await fixture(),app=buildApp({pool,auth:false})
    try {
      await observe(pool,session.id)
      const denied=await app.inject({method:'GET',url:'/v1/alerts'})
      expect(denied.statusCode).toBe(403)
      const ok=await app.inject({method:'GET',url:'/v1/alerts',headers:{authorization:'Bearer TEST viewer key'}})
      expect(ok.statusCode).toBe(200);expect(ok.headers['traceparent']).toBeTruthy()
      expect(ok.json().data.items).toHaveLength(1)
      expect(JSON.stringify(ok.json())).not.toMatch(/secret body|private execution|reason|ownerExecutionId/)
    } finally {await app.close();await pool.end()}
  })
  it('excludes foreign tenants, projects, deleted sessions and misattributed thread findings',async()=>{
    const {pool,session}=await fixture()
    try {
      const other=await createSession(pool,'TEST foreign',{tenantId:'TEST another tenant',projectId:null})
      const project=await createSession(pool,'TEST project',{...scope,projectId:'TEST P'})
      const deleted=await createSession(pool,'TEST deleted',scope)
      await observe(pool,session.id);await observe(pool,other.id);await observe(pool,project.id);await observe(pool,deleted.id)
      await appendEvent(pool,{idempotencyKey:randomUUID(),partition:`session:${deleted.id}`,type:'t.session.deleted',payload:{sessionId:deleted.id}})
      await appendEvent(pool,{idempotencyKey:randomUUID(),partition:`session:${session.id}`,type:'t.reconciliation.finding',payload:{threadKey:other.id,kind:'closed-owner',response:'park'}})
      await projectNewEvents(pool)
      expect((await listSupervisionAlerts(pool,scope)).items.map(x=>x.sessionId).sort()).toEqual([session.id,project.id].sort())
      expect((await listSupervisionAlerts(pool,{...scope,projectId:'TEST P'})).items.map(x=>x.sessionId)).toEqual([project.id])
    } finally {await pool.end()}
  })
  it('paginates descending without duplicates while new findings arrive and rejects invalid limits',async()=>{
    const {pool,session}=await fixture()
    try {
      for(let i=0;i<5;i++)await observe(pool,session.id)
      const first=await listSupervisionAlerts(pool,scope,Number.MAX_SAFE_INTEGER,2)
      await observe(pool,session.id)
      const second=await listSupervisionAlerts(pool,scope,first.nextBeforeSeq!,2)
      const last=await listSupervisionAlerts(pool,scope,second.nextBeforeSeq!,2)
      expect([...first.items,...second.items,...last.items]).toHaveLength(5)
      expect(new Set([...first.items,...second.items,...last.items].map(x=>x.seq)).size).toBe(5)
      expect(last.nextBeforeSeq).toBeNull()
      await expect(listSupervisionAlerts(pool,scope,0,20)).rejects.toThrow('Invalid scoped')
      await expect(listSupervisionAlerts(pool,scope,Number.MAX_SAFE_INTEGER,101)).rejects.toThrow('Invalid scoped')
    } finally {await pool.end()}
  })
  it('uses current scoped session titles while retaining exact identity for duplicate names',async()=>{
    const {pool,session}=await fixture()
    try {
      await observe(pool,session.id)
      expect((await listSupervisionAlerts(pool,scope)).items[0]?.sessionTitle).toBe('TEST alert session')
      expect(await renameSession(pool,session.id,'TEST unauthorized rename',{tenantId:'TEST foreign owner',projectId:null})).toBeUndefined()
      await renameSession(pool,session.id,'TEST latest name',scope)
      const duplicate=await createSession(pool,'TEST latest name',scope)
      await observe(pool,duplicate.id)
      const foreign=await createSession(pool,'TEST private foreign title',{tenantId:'TEST another tenant',projectId:null})
      await observe(pool,foreign.id)
      await projectNewEvents(pool)
      const page=await listSupervisionAlerts(pool,scope)
      expect(page.items.map(x=>x.sessionTitle)).toEqual(['TEST latest name','TEST latest name'])
      expect(new Set(page.items.map(x=>x.sessionId)).size).toBe(2)
      expect(JSON.stringify(page)).not.toMatch(/private foreign title|unauthorized rename/)
    }finally{await pool.end()}
  })
  it('delivers advisory findings as historical and only unchanged confirmed recovery as a current warning',async()=>{
    const {pool,session}=await fixture()
    try {
      await observe(pool,session.id)
      const input=await park(pool,session.id)
      let alerts=await listSupervisionAlerts(pool,scope)
      expect(alerts.items[0]).toMatchObject({kind:'closed-owner',state:'current-warning',threadStatus:'PAUSED'})
      expect(alerts.items[1]?.state).toBe('historical')
      await reserveExecutionIntent(pool,{...input,requestKey:'TEST successor admission'})
      alerts=await listSupervisionAlerts(pool,scope)
      expect(alerts.items[0]?.state).toBe('historical')
    } finally {await pool.end()}
  })
  it('never presents an older recovery notice as current after a later manual state decision',async()=>{
    const {pool,session}=await fixture()
    try {
      await park(pool,session.id)
      await appendEvent(pool,{idempotencyKey:randomUUID(),partition:`session:${session.id}`,type:'t.thread.state',payload:{threadKey:session.id,status:'PAUSED',acceptingSteer:false}})
      await projectNewEvents(pool)
      expect((await listSupervisionAlerts(pool,scope)).items[0]?.state).toBe('historical')
    } finally {await pool.end()}
  })
  it('attributes child notices to their scoped session and provides only scope-verified sector links',async()=>{
    const {pool}=await fixture()
    try {
      const sectorId='sec-'+randomUUID()
      await createSector(pool,{sectorId,name:'TEST alert sector',scope})
      const session=await createSession(pool,'TEST linked session',scope,sectorId),childId=randomUUID()
      await appendEvent(pool,{idempotencyKey:randomUUID(),partition:`session:${session.id}`,type:'t.subagent.launched',payload:{sessionId:session.id,childId,name:'TEST alert child',goal:'TEST goal'}})
      await appendEvent(pool,{idempotencyKey:randomUUID(),partition:`session:${session.id}`,type:'t.reconciliation.finding',payload:{threadKey:`agent:${childId}`,kind:'owner-unavailable',response:'observe'}})
      await projectNewEvents(pool)
      expect((await listSupervisionAlerts(pool,scope)).items[0]).toMatchObject({sessionId:session.id,threadKey:`agent:${childId}`,sectorId,state:'historical'})
      const mismatched=await createSession(pool,'TEST wrong sector binding',{...scope,projectId:'TEST other project'},sectorId)
      await observe(pool,mismatched.id)
      await projectNewEvents(pool)
      expect((await listSupervisionAlerts(pool,{...scope,projectId:'TEST other project'})).items[0]?.sectorId).toBeNull()
    }finally{await pool.end()}
  })
  it.each(['?limit=101','?beforeSeq=0','?unknown=1'])('validates the route query %s',async(query)=>{
    const {pool}=await fixture(),app=buildApp({pool,auth:true})
    try {expect((await app.inject({method:'GET',url:'/v1/alerts'+query,headers:{authorization:'Bearer TEST viewer key'}})).statusCode).toBe(400)}finally{await app.close();await pool.end()}
  })
  it('fails recoverably when projection has not caught up rather than presenting stale current status',async()=>{
    const {pool}=await fixture(),app=buildApp({pool,auth:true})
    const catchup=vi.spyOn(projector,'projectNewEvents').mockResolvedValue({applied:10000,caughtUp:false})
    try {
      const response=await app.inject({method:'GET',url:'/v1/alerts',headers:{authorization:'Bearer TEST viewer key'}})
      expect(response.statusCode).toBe(503);expect(response.json().error.code).toBe('overload')
    }finally{catchup.mockRestore();await app.close();await pool.end()}
  })
  it.each([{authorization:'Bearer TEST unknown'},{authorization:'Bearer TEST viewer key','x-tenant':'TEST forged tenant'}])('denies unknown or mismatched authority',async(headers)=>{
    const {pool}=await fixture(),app=buildApp({pool,auth:false})
    try {expect((await app.inject({method:'GET',url:'/v1/alerts',headers})).statusCode).toBe(403)}finally{await app.close();await pool.end()}
  })
})
