/**
 * Live player markers.
 *
 * Positions come from GET /api/players, which reports whatever the BDS addon
 * last sent. Markers are keyed so a moving player keeps its marker, a player who
 * joins gets one and a player who leaves loses it. Positions are converted with
 * the same block -> Leaflet mapping the terrain tiles use.
 */

import { blockToLatLng } from './coords.js';

/**
 * One player as reported by GET /api/players.
 *
 * @typedef {object} PlayerReport
 * @property {string} name
 * @property {string} [id]
 * @property {number} x
 * @property {number} y
 * @property {number} z
 * @property {string} dimension
 */

/**
 * @typedef {object} PlayerSnapshot
 * @property {PlayerReport[]} players
 * @property {string | null} updatedAt
 * @property {boolean} stale
 */

/**
 * `minecraft:overworld` and `overworld` are the same dimension.
 *
 * @param {string | undefined} dimension
 * @returns {string}
 */
export function normaliseDimension(dimension) {
  const value = String(dimension ?? '').trim().toLowerCase();
  return value.startsWith('minecraft:') ? value.slice('minecraft:'.length) : value;
}

/**
 * Stable marker identity. The Script API's numeric player id survives a name
 * change, so it wins; the name is the fallback when a report omits the id.
 *
 * @param {PlayerReport} player
 * @returns {string}
 */
export function playerKey(player) {
  return player.id ? `id:${player.id}` : `name:${player.name}`;
}

/**
 * Players to draw on the map of one dimension.
 *
 * @param {PlayerReport[] | undefined} players
 * @param {string} dimension
 * @returns {PlayerReport[]}
 */
export function visiblePlayers(players, dimension) {
  const wanted = normaliseDimension(dimension);
  return (players ?? []).filter((player) => normaliseDimension(player.dimension) === wanted);
}

/**
 * Lines shown when a marker is clicked.
 *
 * @param {PlayerReport} player
 * @returns {string[]}
 */
export function playerDetails(player) {
  const round = (value) => (Math.round(value * 10) / 10).toString();
  return [
    player.name,
    `X ${round(player.x)}`,
    `Y ${round(player.y)}`,
    `Z ${round(player.z)}`,
    `dimension ${normaliseDimension(player.dimension)}`,
  ];
}

/**
 * One-line summary for the status bar.
 *
 * @param {PlayerSnapshot | null} snapshot
 * @param {string} dimension
 * @returns {string}
 */
export function playerStatus(snapshot, dimension) {
  if (!snapshot || snapshot.stale) {
    const seen = snapshot?.updatedAt ? ` (last update ${new Date(snapshot.updatedAt).toLocaleTimeString()})` : '';
    return `player data unavailable${seen}`;
  }
  const here = visiblePlayers(snapshot.players, dimension);
  const elsewhere = (snapshot.players?.length ?? 0) - here.length;
  if (!here.length) return `no players in the ${dimension}${elsewhere ? ` (${elsewhere} elsewhere)` : ''}`;
  return `${here.length} player${here.length === 1 ? '' : 's'}: ${here
    .map((player) => player.name)
    .join(', ')}${elsewhere ? ` (${elsewhere} elsewhere)` : ''}`;
}

/**
 * Builds popup content as DOM, so a player name can never inject markup.
 *
 * @param {PlayerReport} player
 */
function detailsElement(player) {
  const element = document.createElement('div');
  element.className = 'player-popup';
  for (const [index, line] of playerDetails(player).entries()) {
    const row = document.createElement('div');
    if (index === 0) row.className = 'player-popup-name';
    row.textContent = line;
    element.append(row);
  }
  return element;
}

export class PlayerLayer {
  #map;
  #dimension;
  #layer;
  #markers = new Map();

  constructor(map, dimension) {
    this.#map = map;
    this.#dimension = dimension;
    this.#layer = L.layerGroup().addTo(map);
  }

  get size() {
    return this.#markers.size;
  }

  /** Marker keys currently on the map, for debugging and tests. */
  keys() {
    return [...this.#markers.keys()];
  }

  /**
   * Applies a snapshot from GET /api/players: moves markers that moved, adds
   * markers for players who joined, removes markers for players who left, and
   * clears everything when the data is stale.
   *
   * @param {PlayerSnapshot | null} snapshot
   * @returns {PlayerReport[]} the players now shown
   */
  update(snapshot) {
    const players = snapshot && !snapshot.stale ? visiblePlayers(snapshot.players, this.#dimension) : [];
    const seen = new Set();

    for (const player of players) {
      const key = playerKey(player);
      seen.add(key);
      const position = blockToLatLng(player.x, player.z);
      let marker = this.#markers.get(key);

      if (!marker) {
        marker = L.circleMarker(position, {
          radius: 5,
          color: '#0d1117',
          weight: 2,
          fillColor: '#f0883e',
          fillOpacity: 1,
        });
        marker.bindTooltip(player.name, { direction: 'top', offset: L.point(0, -6) });
        marker.bindPopup(detailsElement(player));
        marker.addTo(this.#layer);
        this.#markers.set(key, marker);
      } else {
        marker.setLatLng(position);
        marker.setTooltipContent(player.name);
        // Rebuilding the content keeps an open popup live as the player moves.
        marker.setPopupContent(detailsElement(player));
      }
    }

    for (const [key, marker] of this.#markers) {
      if (seen.has(key)) continue;
      this.#layer.removeLayer(marker);
      this.#markers.delete(key);
    }

    return players;
  }
}
