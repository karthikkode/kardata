import {continueAsNew,log,proxyActivities,sleep} from '@temporalio/workflow'
import type * as activities from '../activities/file-admission.js'
const admission=proxyActivities<typeof activities>({startToCloseTimeout:'90s',scheduleToCloseTimeout:'5m',heartbeatTimeout:'15s',retry:{maximumAttempts:3,initialInterval:'2s',maximumInterval:'10s'}})
/** New maintenance type: existing supervision histories remain unchanged. */
export async function fileAdmissionReconciliation(input:{cursor?:string}={}):Promise<never>{
 let cursor=input.cursor??''
 for(let page=0;page<100;page++){
  try{const result=await admission.fileAdmissionPageActivity(cursor);cursor=result.cursor}
  catch{log.warn('file.admission.page_failed',{cursor,code:'file_admission_unavailable'})}
  await sleep('30s')
 }
 return continueAsNew<typeof fileAdmissionReconciliation>({cursor})
}
