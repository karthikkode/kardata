/** Shared RIA budgets: concurrent MCP calls cannot multiply the AI limit. */
export class Slots {
  private active = 0;
  private waiting: (() => void)[] = [];
  constructor(readonly limit: number) {}
  snapshot() { return { limit: this.limit, active: this.active, waiting: this.waiting.length }; }
  async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) await new Promise<void>((resolve) => this.waiting.push(resolve));
    else this.active += 1;
    try { return await work(); }
    finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.active -= 1;
    }
  }
}
export const MAX_RIA_AI = 64;
export const riaAiSlots = new Slots(MAX_RIA_AI);
export const riaCollectSlots = new Slots(8);
