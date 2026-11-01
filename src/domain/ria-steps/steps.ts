import { createFirmDataStep, createBrochureStep, brochureStep, createOpsReadStep, createContactsStep, signalsStep } from "./handlers.js";
import type { StepHandlers } from "./runner.js";

/** Step handlers (Stage 5.8 B3-B7). Deep research stays the separate company-job path. */
export const RIA_STEP_HANDLERS: StepHandlers = {
  firm_data: createFirmDataStep(),
  brochure: brochureStep,
  ops_read: createOpsReadStep(),
  contacts: createContactsStep(),
  signals: signalsStep,
};

/** Rebuild structured research from recent stored SEC sources before fetching again. */
export function riaPipelineHandlers(): StepHandlers {
  return { ...RIA_STEP_HANDLERS, firm_data: createFirmDataStep(undefined, true), brochure: createBrochureStep(true) };
}
