// Bounded FIFO queues. T3.4. Per-thread message queues are built on this:
// when full, enqueue rejects with a reason and keeps the caller's text.
// Nothing is ever silently dropped, and nothing grows unbounded.
export type EnqueueResult = { ok: true } | { ok: false; reason: string }

export class BoundedQueue<T> {
  private readonly items: T[] = []

  constructor(readonly capacity: number) {}

  get size(): number {
    return this.items.length
  }

  enqueue(item: T): EnqueueResult {
    if (this.items.length >= this.capacity) {
      return { ok: false, reason: `queue full at capacity ${this.capacity}` }
    }
    this.items.push(item)
    return { ok: true }
  }

  dequeue(): T | undefined {
    return this.items.shift()
  }

  drain(): T[] {
    return this.items.splice(0, this.items.length)
  }
}
