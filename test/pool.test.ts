import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Semaphore, mapPool } from '../server/util/pool.ts';

describe('mapPool', () => {
  it('preserves order and respects concurrency', async () => {
    let running = 0;
    let peak = 0;
    const started: number[] = [];

    const results = await mapPool([1, 2, 3, 4, 5, 6], 2, async (value) => {
      started.push(value);
      running++;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running--;
      return value * 10;
    });

    assert.deepEqual(results, [10, 20, 30, 40, 50, 60]);
    assert.equal(peak, 2);
    assert.deepEqual(started, [1, 2, 3, 4, 5, 6]);
  });

  it('returns an empty array for an empty input', async () => {
    assert.deepEqual(await mapPool([], 4, async () => 1), []);
  });
});

describe('Semaphore', () => {
  it('never runs more than the permit count at once', async () => {
    const sem = new Semaphore(2);
    let running = 0;
    let peak = 0;

    await Promise.all(
      Array.from({ length: 8 }, async () => {
        await sem.run(async () => {
          running++;
          peak = Math.max(peak, running);
          await new Promise((resolve) => setTimeout(resolve, 5));
          running--;
        });
      }),
    );

    assert.equal(peak, 2);
    assert.equal(running, 0);
  });
});
