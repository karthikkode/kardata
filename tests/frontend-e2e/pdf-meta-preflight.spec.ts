// Opt-in actual Meta + retained production-stack UI journey. No route mocks or data mutations.
import {expect,test} from '@playwright/test'
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {z} from 'zod'

test.use({video:'on',trace:'on',actionTimeout:10000})
test('real mixed PDF reaches Meta through UI, indexes every record and downloads exact original',async({page},info)=>{
 const url=process.env.KARDATA_PDF_META_PREFLIGHT_URL
 const path=process.env.KARDATA_PDF_META_PREFLIGHT_FILE
 test.skip(!url||!path||process.env.KARDATA_PDF_META_PREFLIGHT_RECOVERY_ONLY==='1','requires explicit owned app URL and labeled synthetic PDF path; never runs against default/shared app')
 test.setTimeout(360000)
 const original=await readFile(path!)
 const filename=path!.split('/').at(-1)!
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message))
 const fileEvent=z.object({id:z.string(),processing:z.object({state:z.string()}).optional()}).passthrough()
 const progress:Array<{at:string;status:number;items:Array<z.infer<typeof fileEvent>>}>=[]
 page.on('response',response=>{if(new URL(response.url()).pathname.endsWith('/files'))void response.json().then(body=>{progress.push({at:new Date().toISOString(),status:response.status(),items:z.array(fileEvent).parse(body.data)})}).catch(()=>undefined)})
 await page.setViewportSize({width:1440,height:1000})
 await page.goto(url!)
 const files=page.getByRole('region',{name:'Sector files',exact:true})
 await expect(files.getByRole('button',{name:'Upload file',exact:true})).toBeVisible()
 const accepted=page.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname.endsWith('/documents'))
 const chooser=page.waitForEvent('filechooser')
 await files.getByRole('button',{name:'Upload file',exact:true}).click()
 await(await chooser).setFiles(path!)
 const response=await accepted
 expect(response.status()).toBe(201)
 const record=(await response.json()).data
 expect(record.processing.jobId).toMatch(/^fjob-/)
 await mkdir(info.outputDir,{recursive:true})
 await writeFile(info.outputPath('accepted.json'),JSON.stringify({at:new Date().toISOString(),fileId:record.id,jobId:record.processing.jobId,filename,originalSha256:createHash('sha256').update(original).digest('hex'),originalBytes:original.length,synthetic:true,provider:'Meta actual execution must be proved by durable receipts'},null,2))
 await expect(files.getByRole('button',{name:filename,exact:true})).toBeVisible()
 await page.screenshot({path:info.outputPath('pdf-processing.png'),animations:'disabled'})
 // Waiting on actual durable library data, not an elapsed timer or a streamed text fragment.
 await expect.poll(()=>{const state=progress.flatMap(frame=>frame.items).findLast(entry=>entry.id===record.id)?.processing?.state;if(['failed','uncertain','paused'].includes(state??''))throw new Error('Actual PDF processing parked: '+state);return state},{timeout:300000,intervals:[1000,2000,5000]}).toBe('complete')
 await files.getByRole('button',{name:filename,exact:true}).click()
 const preview=page.getByRole('dialog',{name:'File preview',exact:true})
 await expect(preview.getByText(/TEST page 1 before image/).first()).toBeVisible()
 await expect(preview.getByText(/TEST page 2 after image/).first()).toBeVisible()
 await expect(preview.getByText(/AI-derived visual analysis \(uncertain\)/).first()).toBeVisible()
 await expect(preview.getByText(/Page visual overview/).first()).toBeVisible()
 await page.screenshot({path:info.outputPath('pdf-native-and-meta.png'),animations:'disabled',fullPage:true})
 const downloading=page.waitForEvent('download')
 await preview.getByRole('button',{name:'Download original file',exact:true}).click()
 const download=await downloading
 expect(await readFile((await download.path())!)).toEqual(original)
 expect(download.suggestedFilename()).toBe(filename)
 await writeFile(info.outputPath('ui-observations.json'),JSON.stringify({url,record,progress,pageErrors:errors,downloadSha256:createHash('sha256').update(await readFile((await download.path())!)).digest('hex'),noRouteInterception:true,noCompanyCreation:true,noResearchStart:true},null,2))
 expect(errors).toEqual([])
})

test('provider-denied retained PDF exposes failure and exact original download through UI',async({page},info)=>{
 const url=process.env.KARDATA_PDF_META_PREFLIGHT_URL,path=process.env.KARDATA_PDF_META_PREFLIGHT_FILE
 test.skip(!url||!path||process.env.KARDATA_PDF_META_PREFLIGHT_RECOVERY_ONLY!=='1','explicit owned retained provider-denial journey only')
 await page.setViewportSize({width:1440,height:1000});await page.goto(url!)
 const filename=path!.split('/').at(-1)!,files=page.getByRole('region',{name:'Sector files',exact:true})
 await expect(files.getByRole('button',{name:filename,exact:true})).toBeVisible()
 await expect(files.getByText(/Review file retry/, {exact:true})).toBeVisible()
 await page.screenshot({path:info.outputPath('pdf-provider-denied.png'),animations:'disabled'})
 await files.getByRole('button',{name:filename,exact:true}).click()
 const preview=page.getByRole('dialog',{name:'File preview',exact:true})
 const downloading=page.waitForEvent('download');await preview.getByRole('button',{name:'Download original file',exact:true}).click()
 const download=await downloading,original=await readFile(path!)
 expect(await readFile((await download.path())!)).toEqual(original)
 await page.screenshot({path:info.outputPath('pdf-denied-original-retained.png'),animations:'disabled'})
 await writeFile(info.outputPath('denied-original-proof.json'),JSON.stringify({filename,originalBytes:original.length,originalSha256:createHash('sha256').update(original).digest('hex'),originalDownloadExact:true,metaGenerationVerified:false,noUploadOrRetry:true},null,2))
})
