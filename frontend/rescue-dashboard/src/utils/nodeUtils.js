/**
 * nodeUtils.js — Centralized node ID normalization and display formatting.
 *
 * Ensures all node IDs strictly match backend standard ("NODE-01", "GATEWAY")
 * across all stores, hooks, UI controls, and maps.
 */

/**
 * Normalize any node ID into the standard "NODE-XX" or "GATEWAY" format.
 * Examples:
 *   "1" -> "NODE-01"
 *   "NODE-1" -> "NODE-01"
 *   "node-06" -> "NODE-06"
 *   "Node 6" -> "NODE-06"
 *   "GATEWAY" -> "GATEWAY"
 *
 * @param {string|number} id
 * @returns {string}
 */
export function normalizeNodeId(id) {
  if (id === null || id === undefined || id === '') return '';
  const str = String(id).trim();
  if (str.toUpperCase() === 'GATEWAY') return 'GATEWAY';

  const match = str.match(/(?:NODE[_-]|\s*)?(\d+)/i);
  if (match) {
    const num = parseInt(match[1], 10);
    return `NODE-${String(num).padStart(2, '0')}`;
  }
  return str.toUpperCase();
}

/**
 * Format a node ID for clean user-facing presentation (e.g. "Node 6").
 *
 * @param {string|number} id
 * @returns {string}
 */
export function formatNodeLabel(id) {
  if (!id) return '';
  if (String(id).toUpperCase() === 'GATEWAY') return 'Gateway';
  const match = String(id).match(/(?:NODE[_-]|\s*)?(\d+)/i);
  if (match) {
    return `Node ${parseInt(match[1], 10)}`;
  }
  return String(id);
}
