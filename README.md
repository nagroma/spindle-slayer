# Legacy 1200 planner

A design planner for a **Legacy Ornamental Mill Model 1200**. Place real router bits on a blank, see the remaining wood in 2D and 3D, and save the recipe as a file you can open later.

It is a planner, not a copy of the mill. There is no carriage animation and nothing to send to the machine yet. The app should stay usable without knowing how it is built.

## Using it

You need a modern browser. **Save** uses the browser's Save dialog so you can name the file and pick a folder (keep "Ask where to save each file" on in Chrome/Edge). A `.tmp` may flash in Downloads while that dialog is open; the real `.lomp` is the file you confirm.

1. Open **https://spindle-slayer.vercel.app** (Chrome or Edge). During development, `npm run dev` is http://localhost:5173/.
2. Set the blank: **round**, **square**, or **hex** (hex size is across the flats). Length and size are in inches.
3. Click a bit to add a cut. Drag it for a rough placement; type **From headstock** and **Diameter at tip** for the exact numbers.
4. Optional: check **Run / taper** and set the stop (end headstock and end diameter).
5. Reorder cuts with ▲▼ or by dragging the number. Hide a cut with the eye icon under ×. Remove a cut with ×. Undo / Redo sit next to Remove cut.
6. **Save** opens the browser Save dialog. Name the file and pick a folder. **Open** defaults to `.lomp`; pick All files for an older `.json` or `.txt`.

**Trace** (header link) is a second page: click a photo silhouette, fit lines/arcs/splines, export a DXF. In the planner 2D pane, **Overlay DXF** loads that file as a target outline behind the remaining wood. Fade it with the slider when you do not want it in the way.

A refresh keeps your last session in the browser. Named designs live in files you Save, so you can have more than one.

The 2D view is the profile vs the centerline (length down, headstock at the top). Wheel zooms (left edge stays put), shift+wheel scrolls along the blank. Adding or selecting a bit does not change the zoom. The 3D view is the remaining wood after a full revolution (headstock at the top; drag up/down to flip).

## Backlog

### High

- Tracer later: each fitted curve is a bit cut from the side, so a segment should match a real bit half-profile (known radius/shape). Fit order is per cut, not a whole-trace toggle.
- Photo overlay of a raw picture behind 2D stock — secondary; perspective photos do not map 1:1 onto the blank.
- Flutes, spirals, and indexed repeats.
- 2D left-pin zoom: keep using it; still needs a keep-or-revert decision.

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

**Trace** (second page): http://localhost:5173/trace.html. Load the exported DXF in the planner with **Overlay DXF**.

Bits on screen come from `bits/*.dxf` (inches, tip at 0,0). Add or remove a DXF and reload (rebuild for a shipped `dist/`).

## Other docs

| File | Who it is for |
|---|---|
| `requirements.md` | Working agreement (hard vs directional decisions) |
| `NEXT-SESSION.md` | Pickup note for the next coding session (often empty) |
| `docs/mechanics-notes.md` | How the mill works, and how this app models a blank |
| `docs/bit-catalog.md` | Magnate catalog excerpt (not the live bit list) |
| `.cursor/rules/` | Instructions for the coding agent |
