/**
 * Print the PR28 model-resolution report for the constructed fixture layout.
 *
 *   npm run report-model-fixture
 *   npm run report-model-fixture -- --assert
 *   npm run report-model-fixture -- --json
 */

import { parseArgs } from 'node:util';
import {
  assertFixtureExpectations,
  formatModelFixtureReport,
  reportModelFixture,
} from '../renderer/3d/fixture/report-model-fixture.ts';

const { values } = parseArgs({
  options: {
    assert: { type: 'boolean', default: false },
    json: { type: 'boolean', default: false },
  },
});

const lines = reportModelFixture();

if (values.json) {
  console.log(JSON.stringify(lines, null, 2));
} else {
  console.log(formatModelFixtureReport(lines));
}

if (values.assert) {
  const failures = assertFixtureExpectations(lines);
  if (failures.length) {
    console.error(`\n${failures.length} expectation failure(s):`);
    for (const f of failures) console.error(`  ${f.id}: ${f.message}`);
    process.exit(1);
  }
  console.error(`\nOK — ${lines.length} cells, all expectations passed.`);
}
