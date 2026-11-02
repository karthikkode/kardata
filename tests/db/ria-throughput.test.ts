import { randomUUID, createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import type { DbHandle } from "../../src/db/client.js";
import { companies, sectorCompanies, researchRuns, sources, riaStepRuns, documents } from "../../src/db/schema.js";
import { createSector } from "../../src/domain/sectors.js";
import { runRiaStep, setRiaStepPaused, type StepHandlers } from "../../src/domain/ria-steps/runner.js";
import { runRiaPipeline } from "../../src/domain/ria-steps/pipeline.js";
import { storedOrFetch } from "../../src/domain/ria-steps/stored-source.js";
import { quotaBreakerGet } from "../../src/domain/quota/breaker.js";
import { saveDocument } from "../../src/domain/research/documents.js";
import { createOpsReadStep } from "../../src/domain/ria-steps/handlers.js";
import { storeBlob } from "../../src/domain/research/sources.js";
import { ensureMigrated, getTestDb, resetTestDb } from "../db.js";
import { sendText, startFakeSite, type FakeSite } from "../collect/fake-site.js";

let handle: DbHandle;
let site: FakeSite | undefined;
beforeAll(async () => { handle = getTestDb(); await ensureMigrated(handle); });
beforeEach(async () => { await resetTestDb(handle); });
afterEach(async () => { await site?.close(); site = undefined; });
afterAll(async () => { await handle.close(); });
function deferred() { let resolve!: () => void; const promise = new Promise<void>((r) => { resolve = r; }); return { promise, resolve }; }
async function setup(n: number) {
  const { sector } = await createSector(handle.db, { name: "Throughput fixture" });
  const ids = Array.from({ length: n }, () => randomUUID());
  await handle.db.insert(companies).values(ids.map((id, n) => ({ id, name: `Synthetic Firm ${n}`, source: "manual" as const })));
  await handle.db.insert(sectorCompanies).values(ids.map((companyId) => ({ companyId, sectorId: sector.id, addedVia: "manual" as const, eligibility: "eligible" as const })));
  return { sectorId: sector.id, ids };
}

it("shares exactly 64 AI slots across concurrent steps and rechecks pause after waiting", async () => {
  const f = await setup(64); const full = deferred(); const release = deferred();
  let active = 0; let peak = 0; let secondCalls = 0;
  const first = runRiaStep(handle.db, { sectorId: f.sectorId, step: "ops_read", companyIds: f.ids, concurrency: 64 }, { ops_read: async () => {
    active += 1; peak = Math.max(peak, active); if (active === 64) full.resolve();
    await release.promise; active -= 1; return { status: "done" };
  } });
  await full.promise;
  const second = runRiaStep(handle.db, { sectorId: f.sectorId, step: "contacts", companyIds: f.ids, concurrency: 64 }, { contacts: async () => { secondCalls += 1; return { status: "done" }; } });
  await setRiaStepPaused(handle.db, true); release.resolve();
  const [a,b] = await Promise.all([first, second]);
  expect(peak).toBe(64); expect(a.done).toBe(64); expect(secondCalls).toBe(0); expect(b.stopped).toBe("pause");
});

it("coalesces overlapping calls and duplicate ids without repeating a handler", async () => {
  const f = await setup(1); const entered = deferred(); const release = deferred(); let calls = 0;
  const handlers: StepHandlers = { ops_read: async () => { calls += 1; entered.resolve(); await release.promise; return { status: "done" }; } };
  const args = { sectorId: f.sectorId, step: "ops_read" as const, companyIds: [f.ids[0]!,f.ids[0]!] };
  const first = runRiaStep(handle.db, args, handlers); await entered.promise;
  const second = runRiaStep(handle.db, args, handlers); release.resolve();
  const values = await Promise.all([first,second]);
  expect(calls).toBe(1); expect(values.reduce((n,r) => n+r.skippedInFlight,0)).toBe(1);
});

it("stops pending work on real provider exhaustion rather than failing the whole queue", async () => {
  const f = await setup(3); let calls = 0;
  const result = await runRiaStep(handle.db, { sectorId:f.sectorId,step:"ops_read",companyIds:f.ids,concurrency:1 }, { ops_read: async () => {
    calls += 1; throw new Error("Subscription quota exhausted; resets at 2026-11-03T00:00:00Z");
  } });
  expect(calls).toBe(1); expect(result.stopped).toBe("quota"); expect(result.failed).toBe(1);
  expect(await quotaBreakerGet(handle.db)).toMatchObject({ tripped:true,resumeAt:"2026-11-03T00:00:00.000Z" });
});

it("replenishes rolling company workers while a slow firm remains active, and signals follow both reads", async () => {
  const f = await setup(3); const slowStarted=deferred(); const release=deferred(); const thirdStarted=deferred();
  const finished=new Set<string>(); let signals=0;
  const handlers:StepHandlers={
    firm_data:async()=>({status:"done"}),brochure:async()=>({status:"done"}),
    ops_read:async(_db,_s,id)=>{ if(id===f.ids[0]){slowStarted.resolve();await release.promise;} if(id===f.ids[2])thirdStarted.resolve();finished.add(id+":ops");return{status:"done"}; },
    contacts:async(_db,_s,id)=>{finished.add(id+":contacts");return{status:"done"};},
    signals:async(_db,_s,id)=>{expect(finished.has(id+":ops")).toBe(true);expect(finished.has(id+":contacts")).toBe(true);signals+=1;return{status:"done"};},
  };
  const running=runRiaPipeline(handle.db,{sectorId:f.sectorId,companyIds:f.ids,concurrency:2},handlers);
  await slowStarted.promise; await thirdStarted.promise;
  expect(finished.has(f.ids[0]+":ops")).toBe(false);
  await expect(runRiaPipeline(handle.db,{sectorId:f.sectorId,companyIds:[f.ids[0]!]},handlers)).rejects.toThrow(/already/);
  release.resolve();const result=await running;
  expect(result).toMatchObject({completed:3,failed:0,stopped:null});expect(signals).toBe(3);
});

it("reuses same-company recent stored input with original provenance; stale and other-company data are fetched normally", async () => {
  const f=await setup(2);const runId=randomUUID();
  await handle.db.insert(researchRuns).values({id:runId,companyId:f.ids[0]!,kind:"manual",status:"succeeded"});
  site=await startFakeSite();let hits=0;
  site.routes.set("/robots.txt",(_q,r)=>sendText(r,"User-agent: *\nDisallow:",200,"text/plain"));
  site.routes.set("/filing",(_q,r)=>{hits+=1;sendText(r,"live filing",200,"text/plain");});
  const sha=await storeBlob(handle.db,"text/plain",Buffer.from("stored filing"));const id=randomUUID();
  const url=site.baseUrl+"/filing";
  await handle.db.insert(sources).values({id,companyId:f.ids[0]!,runId,url,finalUrl:url,collector:"sec_firm",status:"ok",blobSha256:sha});
  const request={companyId:f.ids[0]!,runId,collector:"sec_firm",url,privateHostAllowlist:["127.0.0.1"]};
  const cached=await storedOrFetch(handle.db,request);expect(cached.text).toBe("stored filing");expect(cached.source.id).toBe(id);expect(hits).toBe(0);
  await storedOrFetch(handle.db,{...request,companyId:f.ids[1]!});expect(hits).toBe(1);
  await handle.db.update(sources).set({fetchedAt:new Date(Date.now()-49*3600000)}).where(eq(sources.id,id));
  expect((await storedOrFetch(handle.db,request)).text).toBe("live filing");expect(hits).toBe(2);
});


it("reuses completed identical model input but invalidates it when another supplied brochure item changes", async () => {
  const f=await setup(1);const companyId=f.ids[0]!;const runId=randomUUID();const sourceId=randomUUID();
  await handle.db.insert(researchRuns).values({id:runId,companyId,kind:"manual",status:"succeeded"});
  await handle.db.insert(sources).values({id:sourceId,companyId,runId,url:"https://fixture.test/brochure",finalUrl:"https://fixture.test/brochure",collector:"ria_brochure",status:"ok"});
  await saveDocument(handle.db,{companyId,runId,path:"financials/brochure-item-5.md",title:"Fees",contentMd:"Our fee is 1% annually, deducted from each investment account with authorization.",sourceIds:[sourceId],createdBy:"test"});
  let calls=0;
  const ops_read=createOpsReadStep(async()=>{calls+=1;return{json:{fee_schedule:"1% annually",quotes:[{field:"fee_schedule",quote:"Our fee is 1% annually"}]},usage:undefined};});
  const args={sectorId:f.sectorId,step:"ops_read" as const,companyIds:[companyId]};
  expect((await runRiaStep(handle.db,args,{ops_read})).done).toBe(1);
  const [before]=await handle.db.select().from(riaStepRuns).where(eq(riaStepRuns.companyId,companyId));
  expect((await runRiaStep(handle.db,args,{ops_read})).skippedDone).toBe(1);expect(calls).toBe(1);
  const [after]=await handle.db.select().from(riaStepRuns).where(eq(riaStepRuns.companyId,companyId));
  expect(after?.updatedAt).toEqual(before?.updatedAt);
  const [item5]=await handle.db.select().from(documents).where(eq(documents.companyId,companyId));
  const legacyHash=createHash("sha256").update((item5?.contentMd ?? "").slice(0,5000)).digest("hex").slice(0,16);
  await handle.db.update(riaStepRuns).set({inputHash:legacyHash}).where(eq(riaStepRuns.companyId,companyId));
  expect((await runRiaStep(handle.db,args,{ops_read})).skippedDone).toBe(1);expect(calls).toBe(1);
  await saveDocument(handle.db,{companyId,runId,path:"financials/brochure-item-4.md",title:"Services",contentMd:"We now offer additional financial planning services alongside investment management.",sourceIds:[sourceId],createdBy:"test"});
  expect((await runRiaStep(handle.db,args,{ops_read})).done).toBe(1);expect(calls).toBe(2);
});


it("recovers a transient step failure once and reports terminal outcomes honestly", async () => {
  const f=await setup(1);let calls=0;
  const handlers:StepHandlers={firm_data:async()=>{calls+=1;if(calls===1)throw new Error("temporary transport failure");return{status:"done"};},brochure:async()=>({status:"done"}),ops_read:async()=>({status:"done"}),contacts:async()=>({status:"done"}),signals:async()=>({status:"done"})};
  const result=await runRiaPipeline(handle.db,{sectorId:f.sectorId,companyIds:f.ids},handlers);
  expect(result).toMatchObject({completed:1,failed:0,retries:1});expect(result.steps.firm_data).toMatchObject({done:1,failed:0});expect(calls).toBe(2);
});


it("does not mistake an overlapping failed read for completed work", async () => {
  const f=await setup(1);const entered=deferred();const release=deferred();let calls=0;
  const args={sectorId:f.sectorId,step:"ops_read" as const,companyIds:f.ids};
  const handlers:StepHandlers={ops_read:async()=>{calls+=1;entered.resolve();await release.promise;throw new Error("synthetic failure");}};
  const first=runRiaStep(handle.db,args,handlers);await entered.promise;
  const second=runRiaStep(handle.db,args,handlers);release.resolve();
  const result=await Promise.all([first,second]);expect(calls).toBe(1);expect(result.map((r)=>r.failed)).toEqual([1,1]);
});
