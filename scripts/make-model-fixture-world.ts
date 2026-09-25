/**
 * Builds a constructed (synthetic) Bedrock LevelDB world for PR28 model validation.
 *
 * Not a BDS-generated save — hand-written SubChunkPrefix NBT for decode round-trips.
 *
 *   npm run make-model-fixture-world
 */
import { writeModelFixtureWorld, DEFAULT_FIXTURE_WORLD_ROOT } from '../server/renderer/3d/fixture/write-fixture-world.ts';
import { FIXTURE_PLATFORM_Y } from '../server/renderer/3d/fixture/model-fixture-layout.ts';

async function main(): Promise<void> {
  const result = await writeModelFixtureWorld(DEFAULT_FIXTURE_WORLD_ROOT);
  console.log(`Wrote model fixture world at ${result.worldPath}`);
  console.log(
    `chunks=${result.chunks} subchunks=${result.subchunks} cells=${result.cells} platformY=${FIXTURE_PLATFORM_Y}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
