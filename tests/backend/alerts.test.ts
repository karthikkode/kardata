import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { describe,expect,it,vi } from 'vitest'
import { buildApp } from '../../backend/src/app.js'
import { hashKey } from '../../backend/src/auth/keys.js'
import { appendEvent,createSector,createSession,raiseAlert,registerApiKey,resolveAlert } from '../../backend/src/db/index.js'
import { listSupervisionAlerts } from '../../backend/src/db/alerts.js'
import { projectNewEvents } from '../../backend/src/projector.js'
import * as projector from '../../backend/src/projector.js'
import { ensureTestDb,TEST_DATABASE_URL } from './db-helper.js'

const scope={tenantId:'TEST alerts owner',projectId:null}
async function fixture() {
  const pool=new Pool({connectionString:await ensureTestDb('kardata_test_alerts')})
  const session=await createSession(pool,'TEST alert session',scope)
  await registerApiKey(pool,{keyId:'TEST viewer',keyHash:hashKey('TEST viewer key'),scope,role:'viewer'})
  await projectNewEvents(pool)
  return {pool,session}
}

describe.skipIf(!TEST_DATABASE_URL)('scoped table-backed supervision delivery [F:db.alerts.raiseAlert] [F:db.alerts.resolveAlert] [F:db.alerts.listSupervisionAlerts] [F:http.listSupervisionAlerts] [F:db.index.appendEvent] [F:db.index.createSector] [F:db.index.createSession] [F:db.index.registerApiKey] [F:db.keys.registerApiKey] [F:db.sectors.createSector] [F:db.events.appendEvent] [F:db.sessions.createSession] [F:db.alerts.SupervisionAlert] [F:db.events.DURABLE_STREAM_LOCK_SQL] [F:db.index.Db] [F:db.workspace.WorkspaceError] [F:db.workspace.requireSector] [F:db.index.raiseAlert] [F:db.index.resolveAlert]',()=>{
  it('requires a validated key even in open app mode and inherits request correlation',async()=>{
    const {pool,session}=await fixture(),app=buildApp({pool,auth:false})
    try {
      await raiseAlert(pool,{kind:'missing-heartbeat',severity:'high',subject:'TEST heartbeat flatline',threadKey:session.id})
      const denied=await app.inject({method:'GET',url:'/v1/alerts'})
      expect(denied.statusCode).toBe(403)
      const ok=await app.inject({method:'GET',url:'/v1/alerts',headers:{authorization:'Bearer TEST viewer key'}})
      expect(ok.statusCode).toBe(200);expect(ok.headers['traceparent']).toBeTruthy()
      expect(ok.json().data.items).toHaveLength(1)
      expect(Object.keys(ok.json().data.items[0]).sort()).toEqual(['at','kind','resolvedAt','sectorId','seq','sessionId','severity','state','subject','threadKey'])
    } finally {await app.close();await pool.end()}
  })
  it('excludes foreign tenants, projects, deleted sessions and misattributed threads',async()=>{
    const {pool,session}=await fixture()
    try {
      const other=await createSession(pool,'TEST foreign',{tenantId:'TEST another tenant',projectId:null})
      const project=await createSession(pool,'TEST project',{...scope,projectId:'TEST P'})
      const deleted=await createSession(pool,'TEST deleted',scope)
      await projectNewEvents(pool)
      await raiseAlert(pool,{kind:'stalled-progress',severity:'warning',subject:'TEST own',threadKey:session.id})
      await raiseAlert(pool,{kind:'stalled-progress',severity:'warning',subject:'TEST foreign',threadKey:other.id})
      await raiseAlert(pool,{kind:'stalled-progress',severity:'warning',subject:'TEST project',threadKey:project.id})
      await raiseAlert(pool,{kind:'stalled-progress',severity:'warning',subject:'TEST deleted',threadKey:deleted.id})
      await appendEvent(pool,{idempotencyKey:randomUUID(),partition:`session:${deleted.id}`,type:'t.session.deleted',payload:{sessionId:deleted.id}})
      expect((await listSupervisionAlerts(pool,scope)).items.map(x=>x.sessionId).sort()).toEqual([session.id,project.id].sort())
      expect((await listSupervisionAlerts(pool,{...scope,projectId:'TEST P'})).items.map(x=>x.sessionId)).toEqual([project.id])
    } finally {await pool.end()}
  })
  it('paginates descending without duplicates while new alerts arrive and rejects invalid limits',async()=>{
    const {pool,session}=await fixture()
    try {
      for(let i=0;i<5;i++)await raiseAlert(pool,{kind:'queue-starvation',severity:'warning',subject:`TEST starved ${i}`,threadKey:session.id})
      const first=await listSupervisionAlerts(pool,scope,Number.MAX_SAFE_INTEGER,2)
      await raiseAlert(pool,{kind:'queue-starvation',severity:'warning',subject:'TEST starved 5',threadKey:session.id})
      const second=await listSupervisionAlerts(pool,scope,first.nextBeforeSeq!,2)
      const last=await listSupervisionAlerts(pool,scope,second.nextBeforeSeq!,2)
      expect([...first.items,...second.items,...last.items]).toHaveLength(5)
      expect(new Set([...first.items,...second.items,...last.items].map(x=>x.seq)).size).toBe(5)
      expect(last.nextBeforeSeq).toBeNull()
      await expect(listSupervisionAlerts(pool,scope,0,20)).rejects.toThrow('Invalid scoped')
      await expect(listSupervisionAlerts(pool,scope,Number.MAX_SAFE_INTEGER,101)).rejects.toThrow('Invalid scoped')
    } finally {await pool.end()}
  })
  it('dedupes identical unresolved alerts and resolves explicitly',async()=>{
    const {pool,session}=await fixture()
    try {
      const first=await raiseAlert(pool,{kind:'loop-detected',severity:'high',subject:'TEST loop',threadKey:session.id})
      expect(first.duplicate).toBe(false)
      const repeat=await raiseAlert(pool,{kind:'loop-detected',severity:'high',subject:'TEST loop',threadKey:session.id})
      expect(repeat).toEqual({id:first.id,duplicate:true})
      expect((await listSupervisionAlerts(pool,scope)).items[0]).toMatchObject({seq:first.id,state:'current-warning',resolvedAt:null})
      expect(await resolveAlert(pool,first.id)).toBe(true)
      expect(await resolveAlert(pool,first.id)).toBe(false)
      expect((await listSupervisionAlerts(pool,scope)).items[0]).toMatchObject({seq:first.id,state:'historical'})
      const after=await raiseAlert(pool,{kind:'loop-detected',severity:'high',subject:'TEST loop',threadKey:session.id})
      expect(after.duplicate).toBe(false)
      expect(after.id).not.toBe(first.id)
      await expect(raiseAlert(pool,{kind:'x',severity:'high',subject:'TEST nowhere'})).rejects.toThrow()
      await expect(resolveAlert(pool,0)).rejects.toThrow()
    } finally {await pool.end()}
  })
  it('attributes child notices to their scoped session and scope-checks sector alerts',async()=>{
    const {pool}=await fixture()
    try {
      const sectorId='sec-'+randomUUID()
      await createSector(pool,{sectorId,name:'TEST alert sector',scope})
      const session=await createSession(pool,'TEST linked session',scope,sectorId),childId=randomUUID()
      await appendEvent(pool,{idempotencyKey:randomUUID(),partition:`session:${session.id}`,type:'t.subagent.launched',payload:{sessionId:session.id,childId,name:'TEST alert child',goal:'TEST goal'}})
      await projectNewEvents(pool)
      await raiseAlert(pool,{kind:'orphan-child',severity:'high',subject:'TEST child cancelled',threadKey:`agent:${childId}`})
      await raiseAlert(pool,{kind:'queue-starvation',severity:'warning',subject:'TEST sector queue',sectorId})
      const page=await listSupervisionAlerts(pool,scope)
      expect(page.items.find(x=>x.threadKey===`agent:${childId}`)).toMatchObject({sessionId:session.id,state:'current-warning'})
      expect(page.items.find(x=>x.sectorId===sectorId)).toMatchObject({sectorId,sessionId:null})
      expect((await listSupervisionAlerts(pool,{...scope,projectId:'TEST other project'})).items).toHaveLength(0)
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
