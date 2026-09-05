# Legacy 1200 planner

A design planner for a **Legacy Ornamental Mill Model 1200**. Place real router bits on a blank, see the remaining wood in 2D and 3D, and save the recipe as a file you can open later.

It is a planner, not a copy of the mill. There is no carriage animation and nothing to send to the machine yet. The app should stay usable without knowing how it is built.

## Using it

You need a modern browser. **Save** uses the browser's Save dialog so you can name the file and pick a folder (keep "Ask where to save each file" on in Chrome/Edge). A `.tmp` may flash in Downloads while that dialog is open; the real `.lomp` is the file you confirm.

1. Open **https://spindle-slayer.vercel.app** (Chrome or Edge). During development, `npm run dev` is http://localhost:5173/.
2. Set the blank: **round**, **square**, or **hex** (hex size is across the flats). Length and size are in inches.
3. Click a bit to add a cut. Drag it for a rough placement; type **From headstock** and **Diameter at tip** for the exact numbers. **Add bit** loads a DXF from disk into this browser (that is how a file in Downloads becomes a palette button on the live site). A dashed chip with × is one you added; × removes it from this browser after you remove any cuts that use it. Shipped bits stay.
4. Optional: check **Run / taper** and set the stop (end headstock and end diameter). Check **Spiral / pineapple** to gear rotation to travel (ratio, starts, start angle, turn direction). A top-mounted bit such as Magnate 7554 wraps a barley twist (defaults to both ways); a flute bit wraps a pineapple. Flute bits (green in the picker) use the same run fields as the bearing path; without spiral, set **Index (deg)** for how often the groove repeats around the piece.
5. Reorder cuts with ▲▼ or by dragging the number. Hide a cut with the eye icon under ×. Remove a cut with ×. Undo / Redo sit next to Remove cut.
6. **Save** opens the browser Save dialog. Name the file and pick a folder. **Open** defaults to `.lomp`; pick All files for an older `.json` or `.txt`.

**Trace** (header link) is a second page: click a photo silhouette, fit lines/arcs/splines, export a DXF. A **spindle** DXF loads with **Overlay DXF** in the planner 2D pane (reference only). A **bit** DXF loads with **Add bit**. Bit catalog photos are usually shank-left / tip-right: set **Tip is toward** to that side of the picture so the DXF matches the planner.

A refresh keeps your last session in the browser. Named designs live in files you Save, so you can have more than one.

The 2D view is the profile vs the centerline (length down, headstock at the top). Wheel zooms (left edge stays put), shift+wheel scrolls along the blank. Adding or selecting a bit does not change the zoom. The 3D view is the remaining wood after a full revolution (headstock at the top; drag up/down to flip). Spirals twist the 3D mesh along the wrap so it is not a stack of rings. Next to the stock fields, **3D** is a three-step quality slider: Fast (default), Better, Best. Best is slower.

## Backlog

### High

- Tracer later: each fitted curve is a bit cut from the side, so a segment should match a real bit half-profile (known radius/shape). Fit order is per cut, not a whole-trace toggle.
- Photo overlay of a raw picture behind 2D stock — secondary; perspective photos do not map 1:1 onto the blank.
- Flutes, spirals, and indexed repeats — **flutes and spiral/pineapple done** (checkbox under run / taper; ratio, starts, start angle, turn direction). Hollow spiral later.

### Medium

- Bit library management (favorites, hide bits).
- Friendly bit names (part of bit management; characters that cannot live in filenames).
- Photo scaler in the app, if overlay shows we need it.

### Low

- Auto-deploy from GitHub (`vercel git connect` after a GitHub login on the RedSquirrel Vercel team).
- Shop recipe / setup sheet to take to the mill.

### Deferred

- Taper as its own cut type. The current run/taper matches how you would do it on the mill and is good enough for now.

## Run it

Prerequisites: [Node.js](https://nodejs.org) (LTS).

```
npm install
npm run dev      # http://localhost:5173/
npm test         # unit tests
npm run test:e2e # Playwright checks
npm run build    # static site in dist/
```

`dist/` after a build is the whole app. Copy that folder and open `dist/index.html`. No server and no internet after that.

**Trace** (second page): http://localhost:5173/trace.html. Load a spindle DXF with **Overlay DXF**, or a bit DXF with **Add bit**.

Shipped bits on screen come from `bits/*.dxf` (inches, tip at 0,0). Add or remove a DXF there and reload (rebuild for a shipped `dist/`). Extra bits on the live site are **Add bit** in the browser.

## Other docs

| File | Who it is for |
|---|---|
| `requirements.md` | Working agreement (hard vs directional decisions) |
| `NEXT-SESSION.md` | Pickup note for the next coding session (often empty) |
| `docs/mechanics-notes.md` | How the mill works, and how this app models a blank |
| `docs/bit-catalog.md` | Magnate catalog excerpt (not the live bit list) |
| `.cursor/rules/` | Instructions for the coding agent |
