/**
 * Run async work over a list with a fixed concurrency cap.
 *
 * Used where unbounded Promise.all would decode hundreds of LevelDB chunks at
 * once and blow the Node heap on large cold-cache worlds.
 */
export async function mapPool<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!items.length) return [];
  const limit = Math.max(1, Math.min(concurrency, items.length));
  const results = new Array<R>(items.length);
  let next = 0;

  await Promise.all(
    Array.from({ length: limit }, async () => {
      for (;;) {
        const index = next++;
        if (index >= items.length) return;
        results[index] = await fn(items[index]!, index);
      }
    }),
  );

  return results;
}

/**
 * Caps how many callers can run a critical section at once.
 * Waiters are released one at a time as slots free.
 */
export class Semaphore {
  #available: number;
  readonly #waiters: Array<() => void> = [];

  constructor(permits: number) {
    this.#available = Math.max(1, permits);
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.#acquire();
    try {
      return await fn();
    } finally {
      this.#release();
    }
  }

  #acquire(): Promise<void> {
    if (this.#available > 0) {
      this.#available--;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => this.#waiters.push(resolve));
  }

  #release(): void {
    const next = this.#waiters.shift();
    if (next) next();
    else this.#available++;
  }
}
