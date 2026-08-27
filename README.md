# Legacy 1200 planner

A design planner for a **Legacy Ornamental Mill Model 1200**. Place real router bits on a blank, see the remaining wood in 2D and 3D, and save the recipe as a file you can open later.

It is a planner, not a copy of the mill. There is no carriage animation and nothing to send to the machine yet. The app should stay usable without knowing how it is built.

## Using it

You need a modern browser. **Save** uses the browser's Save dialog so you can name the file and pick a folder (keep "Ask where to save each file" on in Chrome/Edge). A `.tmp` may flash in Downloads while that dialog is open; the real `.lomp` is the file you confirm.

1. Open the app (`npm run dev` during development, or `dist/index.html` after a build).
2. Set the blank: **round**, **square**, or **hex** (hex size is across the flats). Length and size are in inches.
3. Click a bit to add a cut. Drag it for a rough placement; type **From headstock** and **Diameter at tip** for the exact numbers.
4. Optional: check **Run / taper** and set the stop (end headstock and end diameter).
5. Reorder cuts with ▲▼ or by dragging the number. Hide a cut with the eye icon under ×. Remove a cut with ×. Undo / Redo sit next to Remove cut.
6. **Save** opens the browser Save dialog. Name the file and pick a folder. **Open** defaults to `.lomp`; pick All files for an older `.json` or `.txt`.

A refresh keeps your last session in the browser. Named designs live in files you Save, so you can have more than one.

The 2D view is the profile vs the centerline (length down, headstock at the top). Wheel zooms (left edge stays put), shift+wheel scrolls along the blank. Adding or selecting a bit does not change the zoom. The 3D view is the remaining wood after a full revolution (headstock at the top; drag up/down to flip).

## Backlog

Not scheduled. Order these when we pick the next slice of work.

### Later

- Flutes, spirals, and indexed repeats.
- Photo overlay / tracing a picture.
- Friendly bit names (characters that cannot live in filenames).
- Taper as its own cut type (not only run-from-A-to-B on a bit).
- Bit library management (favorites, hide bits, names that are not filenames).
- Shop recipe / setup sheet to take to the mill.

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

Bits on screen come from `bits/*.dxf` (inches, tip at 0,0). Add or remove a DXF and reload (rebuild for a shipped `dist/`).

## Other docs

| File | Who it is for |
|---|---|
| `requirements.md` | Working agreement (hard vs directional decisions) |
| `NEXT-SESSION.md` | Pickup note for the next coding session (often empty) |
| `docs/mechanics-notes.md` | How the mill works, and how this app models a blank |
| `docs/bit-catalog.md` | Magnate catalog excerpt (not the live bit list) |
| `.cursor/rules/` | Instructions for the coding agent |
