import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  PlayerStore,
  PlayerValidationError,
  normaliseDimension,
  parsePlayerUpdate,
} from '../server/players/store.ts';
import { blockToLatLng, latLngToBlock } from '../web/coords.js';
import {
  playerDetails,
  playerKey,
  playerStatus,
  visiblePlayers,
  normaliseDimension as normaliseDimensionBrowser,
} from '../web/players.js';

const alex = { name: 'Alex', x: 12.5, y: 68, z: -34.25, dimension: 'minecraft:overworld' };

describe('player update validation', () => {
  it('accepts a well formed update and normalises the dimension', () => {
    const players = parsePlayerUpdate({ players: [alex] });
    assert.deepEqual(players, [{ name: 'Alex', x: 12.5, y: 68, z: -34.25, dimension: 'overworld' }]);
  });

  it('keeps a stable id when the report has one', () => {
    const [player] = parsePlayerUpdate({ players: [{ ...alex, id: '-4294967295' }] });
    assert.equal(player!.id, '-4294967295');
  });

  it('drops fields it does not know about', () => {
    const [player] = parsePlayerUpdate({
      players: [{ ...alex, health: 20, inventory: ['diamond'], ip: '10.0.0.1' }],
    });
    assert.deepEqual(Object.keys(player!).sort(), ['dimension', 'name', 'x', 'y', 'z']);
  });

  it('accepts an empty list', () => {
    assert.deepEqual(parsePlayerUpdate({ players: [] }), []);
  });

  it('rejects malformed payloads', () => {
    const cases: [string, unknown][] = [
      ['not an object', 'players'],
      ['array at the top level', [alex]],
      ['missing players', { player: alex }],
      ['players not an array', { players: { alex } }],
      ['entry not an object', { players: ['Alex'] }],
      ['missing name', { players: [{ x: 1, y: 2, z: 3, dimension: 'overworld' }] }],
      ['empty name', { players: [{ ...alex, name: '   ' }] }],
      ['name not a string', { players: [{ ...alex, name: 42 }] }],
      ['missing coordinate', { players: [{ name: 'Alex', x: 1, z: 3, dimension: 'overworld' }] }],
      ['coordinate not a number', { players: [{ ...alex, x: '12' }] }],
      ['NaN coordinate', { players: [{ ...alex, y: Number.NaN }] }],
      ['infinite coordinate', { players: [{ ...alex, z: Number.POSITIVE_INFINITY }] }],
      ['absurd coordinate', { players: [{ ...alex, x: 1e12 }] }],
      ['missing dimension', { players: [{ name: 'Alex', x: 1, y: 2, z: 3 }] }],
      ['id not a string', { players: [{ ...alex, id: 7 }] }],
      ['too many players', { players: Array.from({ length: 201 }, () => alex) }],
      ['name too long', { players: [{ ...alex, name: 'x'.repeat(65) }] }],
    ];
    for (const [label, body] of cases) {
      assert.throws(() => parsePlayerUpdate(body), PlayerValidationError, `should reject ${label}`);
    }
  });

  it('normalises dimension names the Script API uses', () => {
    assert.equal(normaliseDimension('minecraft:overworld'), 'overworld');
    assert.equal(normaliseDimension('Overworld'), 'overworld');
    assert.equal(normaliseDimension('minecraft:the_nether'), 'the_nether');
  });
});

describe('player store', () => {
  /** Store with a clock the test controls, so staleness is not time dependent. */
  function storeAt(start: number, timeout = 10000) {
    let now = start;
    const store = new PlayerStore(timeout, () => now);
    return { store, advance: (ms: number) => (now += ms) };
  }

  it('starts empty and stale, with no updatedAt', () => {
    const { store } = storeAt(1000);
    const snapshot = store.snapshot();
    assert.deepEqual(snapshot.players, []);
    assert.equal(snapshot.updatedAt, null);
    assert.equal(snapshot.stale, true);
    assert.equal(snapshot.ageMs, null);
  });

  it('reports the latest update', () => {
    const { store } = storeAt(Date.parse('2026-09-17T20:00:00.000Z'));
    store.replace(parsePlayerUpdate({ players: [alex] }));
    const snapshot = store.snapshot();
    assert.equal(snapshot.players.length, 1);
    assert.equal(snapshot.stale, false);
    assert.equal(snapshot.updatedAt, '2026-09-17T20:00:00.000Z');
    assert.equal(snapshot.ageMs, 0);
  });

  it('replaces rather than merges, so players who left disappear', () => {
    const { store } = storeAt(1000);
    store.replace(parsePlayerUpdate({ players: [alex, { ...alex, name: 'Steve' }] }));
    assert.deepEqual(
      store.snapshot().players.map((player) => player.name),
      ['Alex', 'Steve'],
    );

    store.replace(parsePlayerUpdate({ players: [{ ...alex, name: 'Steve', x: 99 }] }));
    const players = store.snapshot().players;
    assert.deepEqual(
      players.map((player) => player.name),
      ['Steve'],
    );
    assert.equal(players[0]!.x, 99);

    store.replace(parsePlayerUpdate({ players: [] }));
    assert.deepEqual(store.snapshot().players, []);
    assert.equal(store.snapshot().stale, false, 'nobody online is not the same as stale data');
  });

  it('goes stale after the timeout and reports no players', () => {
    const { store, advance } = storeAt(Date.parse('2026-09-17T20:00:00.000Z'), 10000);
    store.replace(parsePlayerUpdate({ players: [alex] }));

    advance(9999);
    assert.equal(store.isStale(), false);
    assert.equal(store.snapshot().players.length, 1);

    advance(2);
    assert.equal(store.isStale(), true);
    const snapshot = store.snapshot();
    assert.deepEqual(snapshot.players, [], 'stale data must not keep showing players');
    assert.equal(snapshot.stale, true);
    assert.equal(snapshot.updatedAt, '2026-09-17T20:00:00.000Z', 'still says when it went quiet');
    assert.equal(snapshot.ageMs, 10001);
  });

  it('comes back when updates resume', () => {
    const { store, advance } = storeAt(1000, 5000);
    store.replace(parsePlayerUpdate({ players: [alex] }));
    advance(6000);
    assert.equal(store.snapshot().stale, true);
    store.replace(parsePlayerUpdate({ players: [alex] }));
    assert.equal(store.snapshot().stale, false);
    assert.equal(store.snapshot().players.length, 1);
  });

  it('filters by dimension when asked', () => {
    const { store } = storeAt(1000);
    store.replace(
      parsePlayerUpdate({
        players: [
          alex,
          { ...alex, name: 'Steve', dimension: 'minecraft:nether' },
          { ...alex, name: 'Zuri', dimension: 'minecraft:the_end' },
        ],
      }),
    );

    assert.deepEqual(
      store.snapshot('overworld').players.map((player) => player.name),
      ['Alex'],
    );
    assert.deepEqual(
      store.snapshot('minecraft:overworld').players.map((player) => player.name),
      ['Alex'],
      'a namespaced filter means the same dimension',
    );
    assert.deepEqual(
      store.snapshot('nether').players.map((player) => player.name),
      ['Steve'],
    );
    assert.equal(store.snapshot().players.length, 3, 'unfiltered keeps every dimension');
    assert.deepEqual(
      store.snapshot().players.map((player) => player.dimension),
      ['overworld', 'nether', 'the_end'],
      'the dimension stays in the data either way',
    );
  });
});

describe('browser coordinate conversion', () => {
  it('maps blocks to Leaflet the same way the terrain tiles do', () => {
    assert.deepEqual(blockToLatLng(0, 0), [0, 0]);
    assert.deepEqual(blockToLatLng(1234.5, -543.2), [-543.2, 1234.5], 'lat = Z, lng = X');
    assert.deepEqual(blockToLatLng(-32, -48), [-48, -32]);
  });

  it('round-trips through Leaflet coordinates, including negatives', () => {
    for (const [x, z] of [
      [0, 0],
      [-1, -1],
      [-32, -48],
      [815, 335],
      [288, -16],
    ] as const) {
      const [lat, lng] = blockToLatLng(x, z);
      assert.deepEqual(latLngToBlock({ lat, lng }), { x, z });
    }
  });

  it('keeps fractional player positions on the block they stand on', () => {
    const [lat, lng] = blockToLatLng(12.9, -34.1);
    assert.deepEqual(latLngToBlock({ lat, lng }), { x: 12, z: -35 });
  });
});

describe('browser player markers', () => {
  const overworld = { name: 'Alex', id: '1', x: 10, y: 68, z: -20, dimension: 'overworld' };
  const nether = { name: 'Steve', id: '2', x: 5, y: 40, z: 5, dimension: 'minecraft:nether' };
  const end = { name: 'Zuri', id: '3', x: 0, y: 60, z: 0, dimension: 'the_end' };

  it('shows only players in the mapped dimension', () => {
    assert.deepEqual(
      visiblePlayers([overworld, nether, end], 'overworld').map((player) => player.name),
      ['Alex'],
    );
    assert.deepEqual(visiblePlayers([nether, end], 'overworld'), []);
    assert.deepEqual(visiblePlayers(undefined, 'overworld'), []);
    assert.equal(normaliseDimensionBrowser('minecraft:overworld'), 'overworld');
  });

  it('keys markers by the stable id when there is one, otherwise the name', () => {
    assert.equal(playerKey(overworld), 'id:1');
    assert.equal(playerKey({ name: 'Alex', x: 0, y: 0, z: 0, dimension: 'overworld' }), 'name:Alex');
    assert.notEqual(
      playerKey({ ...overworld, id: 'Alex' }),
      playerKey({ ...overworld, id: undefined, name: 'Alex' }),
      'an id must not collide with a name',
    );
    assert.equal(
      playerKey({ ...overworld, x: 999 }),
      playerKey(overworld),
      'a player who moved keeps the same marker key',
    );
    assert.notEqual(playerKey(overworld), playerKey(nether));
  });

  it('shows name and coordinates including Y in the details', () => {
    assert.deepEqual(playerDetails({ ...overworld, x: 1234.55, y: 68, z: -543.21 }), [
      'Alex',
      'X 1234.6',
      'Y 68',
      'Z -543.2',
      'dimension overworld',
    ]);
  });

  it('summarises the player status for the bar', () => {
    assert.match(playerStatus(null, 'overworld'), /unavailable/);
    assert.match(playerStatus({ players: [], updatedAt: null, stale: true }, 'overworld'), /unavailable/);
    assert.match(
      playerStatus({ players: [], updatedAt: '2026-09-17T20:00:00.000Z', stale: false }, 'overworld'),
      /no players in the overworld/,
    );
    assert.match(
      playerStatus({ players: [overworld], updatedAt: '2026-09-17T20:00:00.000Z', stale: false }, 'overworld'),
      /1 player: Alex/,
    );
    const both = playerStatus(
      { players: [overworld, nether], updatedAt: '2026-09-17T20:00:00.000Z', stale: false },
      'overworld',
    );
    assert.match(both, /1 player: Alex/);
    assert.match(both, /1 elsewhere/);
  });
});
