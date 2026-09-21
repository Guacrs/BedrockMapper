/**
 * Persistent shared map markers (POIs), separate from live player markers.
 *
 * Visitors always see markers from GET /api/markers. Create / edit / delete
 * need MARKER_API_KEY, kept in sessionStorage when an admin unlocks the map.
 *
 * Note: this file avoids private class fields/methods (`#name`) — a specific
 * Safari parse failure — rather than targeting very old iOS generally.
 */

import { blockToLatLng, latLngToBlock } from './coords.js';

const API_KEY_STORAGE = 'bedrockMapMarkerKey';

/** @typedef {'base'|'village'|'portal'|'farm'|'shop'|'poi'|'warning'|'custom'} MarkerCategory */

/**
 * @typedef {object} MapMarker
 * @property {string} id
 * @property {string} name
 * @property {string} [description]
 * @property {number} x
 * @property {number} z
 * @property {MarkerCategory} category
 * @property {string} [color]
 * @property {string} createdAt
 * @property {string} updatedAt
 */

export const MARKER_CATEGORIES = [
  'base',
  'village',
  'portal',
  'farm',
  'shop',
  'poi',
  'warning',
  'custom',
];

/** Default icon colours when a marker has no override. */
export const CATEGORY_COLORS = {
  base: '#4c8bf5',
  village: '#e3b341',
  portal: '#a371f7',
  farm: '#7ee787',
  shop: '#f0883e',
  poi: '#79c0ff',
  warning: '#f85149',
  custom: '#c9d1d9',
};

/**
 * @param {MapMarker} marker
 * @returns {string}
 */
export function markerColor(marker) {
  return marker.color || CATEGORY_COLORS[marker.category] || CATEGORY_COLORS.custom;
}

export function getStoredMarkerKey() {
  try {
    return sessionStorage.getItem(API_KEY_STORAGE) || '';
  } catch (_error) {
    return '';
  }
}

export function setStoredMarkerKey(key) {
  try {
    if (key) sessionStorage.setItem(API_KEY_STORAGE, key);
    else sessionStorage.removeItem(API_KEY_STORAGE);
  } catch (_error) {
    /* private mode */
  }
}

/**
 * @param {string} method
 * @param {string} path
 * @param {object} [body]
 */
async function markerFetch(method, path, body) {
  /** @type {Record<string, string>} */
  const headers = {};
  const key = getStoredMarkerKey();
  if (key) headers['x-api-key'] = key;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch (_error) {
    parsed = { error: text || `HTTP ${response.status}` };
  }
  if (!response.ok) {
    const message = parsed?.error || `HTTP ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return parsed;
}

/**
 * Leaflet layer for shared markers.
 */
export class MarkerLayer {
  /**
   * @param {any} map
   */
  constructor(map) {
    this.map = map;
    this.group = L.layerGroup().addTo(map);
    /** @type {Map<string, any>} */
    this.markers = new Map();
    this._bindMapEvents();
  }

  _bindMapEvents() {
    // Right-click add is admin-only. Unauthenticated visitors get no prompt —
    // unlock via the "Edit markers" control or window.__setMapMarkerKey.
    this.map.on('contextmenu', (event) => {
      if (!getStoredMarkerKey()) return;
      L.DomEvent.preventDefault(event);
      const { x, z } = latLngToBlock(event.latlng);
      openMarkerForm({ x, z }, async (fields) => {
        await markerFetch('POST', '/api/markers', fields);
        await this.reload();
      });
    });
  }

  async reload() {
    const data = await fetch('/api/markers').then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    });
    this.render(data.markers ?? []);
  }

  /**
   * @param {MapMarker[]} list
   */
  render(list) {
    const seen = new Set();
    for (const marker of list) {
      seen.add(marker.id);
      const existing = this.markers.get(marker.id);
      if (existing) {
        existing.setLatLng(blockToLatLng(marker.x, marker.z));
        existing.setStyle({ color: markerColor(marker), fillColor: markerColor(marker) });
        existing.setPopupContent(this._popupHtml(marker));
        existing._mapMarker = marker;
      } else {
        const circle = L.circleMarker(blockToLatLng(marker.x, marker.z), {
          radius: 7,
          color: markerColor(marker),
          fillColor: markerColor(marker),
          fillOpacity: 0.9,
          weight: 2,
        });
        circle._mapMarker = marker;
        circle.bindPopup(() => this._popupHtml(circle._mapMarker), { maxWidth: 280 });
        circle.on('popupopen', () => this._wirePopupActions(circle));
        circle.addTo(this.group);
        this.markers.set(marker.id, circle);
      }
    }
    for (const [id, circle] of this.markers) {
      if (seen.has(id)) continue;
      this.group.removeLayer(circle);
      this.markers.delete(id);
    }
  }

  /**
   * @param {MapMarker} marker
   */
  _popupHtml(marker) {
    const admin = Boolean(getStoredMarkerKey());
    const description = marker.description
      ? `<div class="marker-popup-desc">${escapeHtml(marker.description)}</div>`
      : '';
    const actions = admin
      ? `<div class="marker-popup-actions">
          <button type="button" data-marker-edit="${escapeHtml(marker.id)}">Edit</button>
          <button type="button" data-marker-delete="${escapeHtml(marker.id)}">Delete</button>
        </div>`
      : '';
    return `<div class="marker-popup">
      <div class="marker-popup-name">${escapeHtml(marker.name)}</div>
      <div class="marker-popup-meta">${escapeHtml(marker.category)} · X ${marker.x}, Z ${marker.z}</div>
      ${description}
      ${actions}
    </div>`;
  }

  /**
   * @param {any} circle
   */
  _wirePopupActions(circle) {
    const root = circle.getPopup()?.getElement();
    if (!root) return;
    const marker = circle._mapMarker;
    root.querySelector('[data-marker-edit]')?.addEventListener('click', () => {
      circle.closePopup();
      openMarkerForm(marker, async (fields) => {
        await markerFetch('PATCH', `/api/markers/${encodeURIComponent(marker.id)}`, fields);
        await this.reload();
      });
    });
    root.querySelector('[data-marker-delete]')?.addEventListener('click', async () => {
      if (!confirm(`Delete marker "${marker.name}"?`)) return;
      try {
        await markerFetch('DELETE', `/api/markers/${encodeURIComponent(marker.id)}`);
        await this.reload();
      } catch (error) {
        alert(error.message || String(error));
      }
    });
  }
}

/**
 * @param {Partial<MapMarker> & { x: number, z: number }} initial
 * @param {(fields: object) => Promise<void>} onSave
 */
export function openMarkerForm(initial, onSave) {
  closeMarkerForm();
  const overlay = document.createElement('div');
  overlay.id = 'marker-form-overlay';
  overlay.innerHTML = `
    <form class="marker-form" autocomplete="off">
      <h2>${initial.id ? 'Edit marker' : 'Add marker'}</h2>
      <label>Name <input name="name" required maxlength="64" value="${escapeAttr(initial.name || '')}" /></label>
      <label>Description <textarea name="description" maxlength="500" rows="3">${escapeHtml(initial.description || '')}</textarea></label>
      <label>Category
        <select name="category">
          ${MARKER_CATEGORIES.map(
            (category) =>
              `<option value="${category}" ${category === (initial.category || 'poi') ? 'selected' : ''}>${category}</option>`,
          ).join('')}
        </select>
      </label>
      <label>Color <input name="color" type="text" placeholder="#RRGGBB" pattern="#[0-9A-Fa-f]{6}" value="${escapeAttr(initial.color || '')}" /></label>
      <div class="marker-form-coords">X ${initial.x}, Z ${initial.z}</div>
      <div class="marker-form-actions">
        <button type="button" data-cancel>Cancel</button>
        <button type="submit">Save</button>
      </div>
      <div class="marker-form-error" hidden></div>
    </form>`;
  document.body.appendChild(overlay);

  const form = overlay.querySelector('form');
  const errorEl = overlay.querySelector('.marker-form-error');
  overlay.querySelector('[data-cancel]')?.addEventListener('click', closeMarkerForm);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) closeMarkerForm();
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const colorRaw = String(data.get('color') || '').trim();
    const description = String(data.get('description') || '').trim();
    /** @type {Record<string, unknown>} */
    const fields = {
      name: String(data.get('name') || '').trim(),
      category: String(data.get('category') || 'poi'),
      x: initial.x,
      z: initial.z,
    };
    if (initial.id) {
      fields.description = description || null;
      fields.color = colorRaw || null;
    } else {
      if (description) fields.description = description;
      if (colorRaw) fields.color = colorRaw;
    }

    try {
      errorEl.hidden = true;
      await onSave(fields);
      closeMarkerForm();
    } catch (error) {
      errorEl.textContent = error.message || String(error);
      errorEl.hidden = false;
    }
  });
}

export function closeMarkerForm() {
  document.getElementById('marker-form-overlay')?.remove();
}

export function promptForMarkerKey() {
  const current = getStoredMarkerKey();
  const next = window.prompt(
    'Enter MARKER_API_KEY to add or edit markers (stored in this browser tab only). Leave blank to clear.',
    current,
  );
  if (next === null) return getStoredMarkerKey();
  setStoredMarkerKey(next.trim());
  return getStoredMarkerKey();
}

function escapeHtml(value) {
  return String(value)
    .split('&')
    .join('&amp;')
    .split('<')
    .join('&lt;')
    .split('>')
    .join('&gt;')
    .split('"')
    .join('&quot;');
}

function escapeAttr(value) {
  return escapeHtml(value).split("'").join('&#39;');
}
