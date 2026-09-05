// @ts-check
// Save / open a tracing session (image + marks + fitted segs).

export const TRACE_KIND = 'legacy-1200-trace';
export const TRACE_VERSION = 1;

/**
 * @typedef {import('./coords.js').Pixel} Pixel
 * @typedef {import('./fit.js').Seg} Seg
 */

/**
 * @typedef {{
 *   kind: string,
 *   version: number,
 *   imageName: string,
 *   imageData: string,
 *   mode: string,
 *   knownInches: number,
 *   axisIsLength: boolean,
 *   knownRadii: string,
 *   photoOpacity?: number,
 *   tipToward?: 'auto' | 'left' | 'right' | 'top' | 'bottom',
 *   ends: Pixel[],
 *   scaleA: Pixel | null,
 *   scaleB: Pixel | null,
 *   trace: Pixel[],
 *   tool: string,
 *   segs: Seg[],
 * }} TraceSession
 */

/**
 * @param {Omit<TraceSession, 'kind' | 'version'>} state
 */
export function serializeSession(state) {
  /** @type {TraceSession} */
  const data = {
    kind: TRACE_KIND,
    version: TRACE_VERSION,
    ...state,
  };
  return JSON.stringify(data, null, 2);
}

/** @param {string} text */
export function parseSession(text) {
  const data = JSON.parse(text);
  if (!data || data.kind !== TRACE_KIND) {
    throw new Error('Not a Spindle Slayer trace session file.');
  }
  return /** @type {TraceSession} */ (data);
}
