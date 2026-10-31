import { createFirmDataStep, brochureStep, createOpsReadStep, createContactsStep, signalsStep } from "./handlers.js";
import type { StepHandlers } from "./runner.js";

/** Step handlers (Stage 5.8 B3-B7). Deep research stays the separate company-job path. */
export const RIA_STEP_HANDLERS: StepHandlers = {
  firm_data: createFirmDataStep(),
  brochure: brochureStep,
  ops_read: createOpsReadStep(),
  contacts: createContactsStep(),
  signals: signalsStep,
};
