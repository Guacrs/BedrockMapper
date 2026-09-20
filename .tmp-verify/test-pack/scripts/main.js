/**
 * Test-only pack: drives a simulated player from the BDS console so player
 * tracking can be exercised end to end without a Minecraft client.
 *
 *   scriptevent bmap:join            spawn a simulated player on the surface
 *   scriptevent bmap:patrol          walk it in a circle
 *   scriptevent bmap:stop            stop walking
 *   scriptevent bmap:tp 450 200      teleport it to that X/Z
 *   scriptevent bmap:nether          send it to the Nether
 *   scriptevent bmap:overworld       bring it back
 *   scriptevent bmap:where           log its position
 *   scriptevent bmap:leave           remove it (a disconnect)
 */

import { system, world } from '@minecraft/server';
import * as gametest from '@minecraft/server-gametest';

console.log(`[bmap-test] gametest exports: ${Object.keys(gametest).sort().join(', ')}`);
const { spawnSimulatedPlayer } = gametest;
const removeSimulatedPlayer =
  gametest.removeSimulatedPlayer ?? ((player) => player.remove());

const NAME = 'TestPilot';
const CENTRE = { x: 392, z: 144 };

let simulated;
let patrol;
let angle = 0;
const crewMembers = [];

function overworld() {
  return world.getDimension('minecraft:overworld');
}

/** A standing position on top of the terrain at the given X/Z. */
function surfaceAt(x, z) {
  const dimension = overworld();
  const top = dimension.getTopmostBlock({ x, z });
  return { x, y: (top?.location.y ?? 70) + 1, z };
}

function join() {
  if (simulated) {
    console.warn(`[bmap-test] ${NAME} is already online`);
    return;
  }
  const location = surfaceAt(CENTRE.x, CENTRE.z);
  simulated = spawnSimulatedPlayer({ dimension: overworld(), ...location }, NAME);
  console.log(`[bmap-test] spawned ${NAME} at ${location.x},${location.y},${location.z}`);
}

/** Three players at once, one of them in the Nether. */
function crew() {
  const spots = [
    { name: 'Ada', dx: -70, dz: -40 },
    { name: 'Bo', dx: 60, dz: 50 },
    { name: 'Cy', dx: 10, dz: -80 },
  ];
  for (const spot of spots) {
    if (crewMembers.some((member) => member.name === spot.name)) continue;
    const location = surfaceAt(CENTRE.x + spot.dx, CENTRE.z + spot.dz);
    crewMembers.push(spawnSimulatedPlayer({ dimension: overworld(), ...location }, spot.name));
    console.log(`[bmap-test] spawned ${spot.name} at ${location.x},${location.y},${location.z}`);
  }
  const last = crewMembers[crewMembers.length - 1];
  if (last) {
    last.teleport({ x: 20, y: 40, z: 20 }, { dimension: world.getDimension('minecraft:nether') });
    console.log(`[bmap-test] sent ${last.name} to the nether`);
  }
}

function crewLeave() {
  for (const member of crewMembers) removeSimulatedPlayer(member);
  console.log(`[bmap-test] removed ${crewMembers.length} crew member(s)`);
  crewMembers.length = 0;
}

function leave() {
  if (!simulated) {
    console.warn('[bmap-test] nobody to remove');
    return;
  }
  stopPatrol();
  removeSimulatedPlayer(simulated);
  simulated = undefined;
  console.log(`[bmap-test] removed ${NAME}`);
}

function stopPatrol() {
  if (patrol !== undefined) {
    system.clearRun(patrol);
    patrol = undefined;
  }
}

/** Teleports along a circle every few ticks, which reads as smooth walking. */
function startPatrol() {
  if (!simulated) return;
  stopPatrol();
  patrol = system.runInterval(() => {
    if (!simulated) return;
    angle += 0.06;
    const x = CENTRE.x + Math.cos(angle) * 90;
    const z = CENTRE.z + Math.sin(angle) * 90;
    const location = surfaceAt(Math.round(x), Math.round(z));
    simulated.teleport(location, { dimension: overworld() });
  }, 4);
  console.log(`[bmap-test] ${NAME} is patrolling`);
}

system.afterEvents.scriptEventReceive.subscribe((event) => {
  const [namespace, name] = event.id.split(':');
  if (namespace !== 'bmap') return;

  try {
    switch (name) {
      case 'join':
        join();
        break;
      case 'leave':
        leave();
        break;
      case 'crew':
        crew();
        break;
      case 'crewleave':
        crewLeave();
        break;
      case 'patrol':
        startPatrol();
        break;
      case 'stop':
        stopPatrol();
        console.log(`[bmap-test] ${NAME} stopped`);
        break;
      case 'tp': {
        const [x, z] = event.message.trim().split(/\s+/).map(Number);
        if (!simulated || !Number.isFinite(x) || !Number.isFinite(z)) {
          console.warn('[bmap-test] usage: scriptevent bmap:tp <x> <z> (with a player online)');
          break;
        }
        stopPatrol();
        const location = surfaceAt(x, z);
        simulated.teleport(location, { dimension: overworld() });
        console.log(`[bmap-test] teleported to ${location.x},${location.y},${location.z}`);
        break;
      }
      case 'nether':
        if (!simulated) break;
        stopPatrol();
        simulated.teleport({ x: 40, y: 40, z: 40 }, { dimension: world.getDimension('minecraft:nether') });
        console.log('[bmap-test] sent to the nether');
        break;
      case 'overworld':
        if (!simulated) break;
        simulated.teleport(surfaceAt(CENTRE.x, CENTRE.z), { dimension: overworld() });
        console.log('[bmap-test] back in the overworld');
        break;
      case 'where': {
        const players = world
          .getAllPlayers()
          .map(
            (player) =>
              `${player.name} ${player.location.x.toFixed(2)},${player.location.y.toFixed(2)},` +
              `${player.location.z.toFixed(2)} ${player.dimension.id}`,
          );
        console.log(`[bmap-test] online: ${players.join(' | ') || '(nobody)'}`);
        break;
      }
      default:
        console.warn(`[bmap-test] unknown event ${event.id}`);
    }
  } catch (error) {
    console.error(`[bmap-test] ${name} failed: ${error}`);
  }
});

console.log('[bmap-test] simulated player controls ready (scriptevent bmap:join)');
