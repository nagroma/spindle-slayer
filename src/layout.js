// @ts-check
// Horizontal pane splitters. Widths are pixels; saved by the app.

/**
 * @typedef {{ cuts: number, side: number, three: number }} PaneWidths
 */

const MIN = { cuts: 160, side: 220, three: 220 };

/**
 * @param {{
 *   workspace: HTMLElement,
 *   cuts: HTMLElement,
 *   side: HTMLElement,
 *   three: HTMLElement,
 *   splitCuts: HTMLElement,
 *   splitSide: HTMLElement,
 *   initial?: PaneWidths | null,
 *   onChange?: (widths: PaneWidths) => void,
 * }} opts
 */
export function bindSplitters(opts) {
  const { workspace, cuts, side, three, splitCuts, splitSide, onChange } = opts;

  /** @returns {PaneWidths} */
  function measure() {
    return {
      cuts: cuts.getBoundingClientRect().width,
      side: side.getBoundingClientRect().width,
      three: three.getBoundingClientRect().width,
    };
  }

  /** @param {PaneWidths} w */
  function apply(w) {
    const gutter = 12;
    const work = Math.max(1, workspace.clientWidth - gutter);
    let c = Math.max(MIN.cuts, w.cuts);
    let s = Math.max(MIN.side, w.side);
    let t = Math.max(MIN.three, w.three);
    const sum = c + s + t;
    if (sum > 0 && Math.abs(sum - work) > 2) {
      const k = work / sum;
      c = Math.max(MIN.cuts, c * k);
      s = Math.max(MIN.side, s * k);
      t = Math.max(MIN.three, work - c - s);
    }
    cuts.style.flex = `0 0 ${Math.round(c)}px`;
    side.style.flex = `0 0 ${Math.round(s)}px`;
    three.style.flex = `0 0 ${Math.round(t)}px`;
  }

  function emit() {
    onChange?.(measure());
  }

  /**
   * @param {HTMLElement} handle
   * @param {HTMLElement} left
   * @param {HTMLElement} right
   * @param {number} minL
   * @param {number} minR
   */
  function drag(handle, left, right, minL, minR) {
    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const left0 = left.getBoundingClientRect().width;
      const right0 = right.getBoundingClientRect().width;
      const x0 = e.clientX;
      handle.classList.add('dragging');
      handle.setPointerCapture(e.pointerId);

      const onMove = (ev) => {
        const dx = ev.clientX - x0;
        let l = left0 + dx;
        let r = right0 - dx;
        if (l < minL) {
          r -= minL - l;
          l = minL;
        }
        if (r < minR) {
          l -= minR - r;
          r = minR;
        }
        left.style.flex = `0 0 ${Math.round(l)}px`;
        right.style.flex = `0 0 ${Math.round(r)}px`;
      };
      const onUp = () => {
        handle.classList.remove('dragging');
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onUp);
        handle.removeEventListener('pointercancel', onUp);
        emit();
      };
      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp);
      handle.addEventListener('pointercancel', onUp);
      e.preventDefault();
    });
  }

  drag(splitCuts, cuts, side, MIN.cuts, MIN.side);
  drag(splitSide, side, three, MIN.side, MIN.three);

  const start = opts.initial ?? { cuts: 220, side: 420, three: 560 };
  const kick = () => apply(measure().cuts > 1 ? measure() : start);
  apply(start);
  requestAnimationFrame(kick);

  window.addEventListener('resize', () => {
    apply(measure());
    emit();
  });

  return { apply, measure };
}
