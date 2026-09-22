/**
 * Guards against applying a mesh that finished loading after a live refresh
 * invalidated the request. Used by TerrainViewer3D._loadChunk.
 *
 * @param {number} requestEpoch Epoch captured when the fetch started
 * @param {number} currentEpoch Viewer's current `_meshEpoch`
 * @param {boolean} [disposed]
 * @returns {boolean}
 */
export function isMeshResponseCurrent(requestEpoch, currentEpoch, disposed = false) {
  return !disposed && requestEpoch === currentEpoch;
}
