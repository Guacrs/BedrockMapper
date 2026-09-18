/**
 * Unobtrusive status lines for the map HUD.
 *
 * The map does not have a dashboard. These two sentences are the whole of it:
 * whether the terrain is current, and whether player reports are arriving.
 */

/**
 * @typedef {object} StatusLine
 * @property {string} text
 * @property {'ok' | 'warn' | 'error'} kind
 */

/**
 * @param {number} ms
 * @returns {string}
 */
export function formatAge(ms) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return `${hours}h ago`;
}

/**
 * @param {string | null | undefined} iso
 * @param {number} [now]
 * @returns {string | null}
 */
export function ageOf(iso, now = Date.now()) {
  if (!iso) return null;
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return null;
  return formatAge(now - at);
}

/**
 * @param {{
 *   terrainUpdatedAt?: string | null,
 *   lastWorldRefresh?: string | null,
 *   lastRefresh?: { at?: string, error?: string | null } | null,
 *   refreshError?: string | null,
 *   consecutiveRefreshFailures?: number,
 * } | null} state
 * @param {{ unreachable?: boolean, tileErrors?: number }} [flags]
 * @param {number} [now]
 * @returns {StatusLine}
 */
export function terrainStatus(state, flags = {}, now = Date.now()) {
  if (flags.unreachable) {
    return { text: 'Terrain: map server unreachable', kind: 'error' };
  }
  if ((flags.tileErrors ?? 0) > 0) {
    return { text: 'Terrain: some tiles failed to load', kind: 'warn' };
  }
  const refreshError = state?.refreshError ?? state?.lastRefresh?.error ?? null;
  if (refreshError || (state?.consecutiveRefreshFailures ?? 0) > 0) {
    const when = ageOf(state?.terrainUpdatedAt ?? state?.lastWorldRefresh ?? state?.lastRefresh?.at, now);
    return {
      text: when ? `Terrain: refresh failed — last good map ${when}` : 'Terrain: refresh failed — last good map still showing',
      kind: 'error',
    };
  }
  const stamp = state?.terrainUpdatedAt ?? state?.lastWorldRefresh ?? state?.lastRefresh?.at ?? null;
  const when = ageOf(stamp, now);
  if (!when) return { text: 'Terrain: current', kind: 'ok' };
  return { text: `Terrain: updated ${when}`, kind: 'ok' };
}

/**
 * @param {{ stale?: boolean, updatedAt?: string | null, players?: unknown[] } | null} snapshot
 * @returns {StatusLine}
 */
export function trackingStatus(snapshot) {
  if (!snapshot || snapshot.updatedAt == null) {
    return { text: 'Players: waiting', kind: 'warn' };
  }
  if (snapshot.stale) return { text: 'Players: stale', kind: 'error' };
  return { text: 'Players: live', kind: 'ok' };
}
