/**
 * One model-entry shape for the whole pipeline.
 *
 * Providers, the P2P wire, and the OpenAI surface all speak
 * `ModelEntry = { id, name, created? }` where `created` is Unix seconds.
 */
/** @typedef {{ id: string, name: string, created?: number }} ModelEntry */

/**
 * Coerce a provider timestamp (ISO string or epoch, seconds or milliseconds)
 * into Unix seconds. Returns `undefined` when the value is unusable, so callers
 * omit the field and downstream consumers keep their own fallback.
 * @param {unknown} value
 * @returns {number|undefined}
 */
function toUnixSeconds(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.floor(value > 1e12 ? value / 1000 : value);
  if (typeof value === 'string' && value) {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return Math.floor(parsed / 1000);
  }
  return undefined;
}

export { toUnixSeconds };
