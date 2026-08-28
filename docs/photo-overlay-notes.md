# Photo overlay prep notes

How we turned a phone photo into a file the 2D view can place behind the stock. The app is not meant to crop or scale; this is the outside-the-app work (or a future “scale this image…” prompt).

## Target file

A local crop `reference/leg-overlay-3.5x29.5.png` was used while proving the overlay idea. It is not in the repo.

- Whole image = stock rectangle: **3.5″ wide × 29.5″ tall**, headstock at the **top**.
- 100 pixels per inch (350 × 2950). DPI is set in the PNG.
- Built by `scripts/prep-overlay-photo.py` from `reference/leg-reference-photo.jpeg`.

## What this photo actually is

Andrew’s source is the kind of picture we will get: a standing spindle, phone, workshop background.

| Fact | What it does to overlay |
|---|---|
| 479 × 1747 JPEG, ~144 dpi as stored | Pixels are **not** inches. Stored dpi is meaningless. |
| Square pommel is **corner-on** (two faces, near edge in the middle) | 2D stock is **face-on** (3.5″ across flats). The pommel will not look like the 2D rectangle. |
| Camera looks slightly **down**; top face of the pommel is visible | Top looks larger than the foot. Length along the photo is not a uniform inch scale. We did **not** keystone-correct. |
| Top of the pommel is slightly clipped in the original | Overlay top is the first oak pixels, not a true headstock plane. |
| Foot sits on a wooden floor | Cropped at the contact shadow so the floor is out. |
| Axis is the near corner, x ≈ 241 in the source | Turned sections are centered on that line; it is already close to vertical. No rotation. |

Physical size (3.5″ square, 29.5″ long) is what we mapped. We did **not** set image width from the visible pommel (across corners ≈ 3.5√2). That would squash the turned profile when the app fits the file to 3.5″ stock.

Scale used: crop top-of-pommel → sole of foot, then set **width** so the crop aspect is 3.5∶29.5, centered on the axis. Square corners stick out of that strip in the photo, so they are clipped. That matches face-on 3.5″ stock.

## Steps that mattered

1. Ignore EXIF/dpi on the phone JPEG.
2. Find top of wood, sole of foot, and the vertical axis (here: the pommel’s near corner).
3. Crop to that length and to 3.5∶29.5 about the axis. Do not stretch independently of that rectangle.
4. Resize to a round px/inch and write DPI. Soft; source is small.
5. Leave workshop bokeh in the side margins (foot is narrower than 3.5″). Opacity in the app will have to live with that until we matte.

## Future prompt (not in-app)

Something like: *“Scale and crop this photo so the spindle is 3.5″ wide and 29.5″ long, headstock at the top, image rectangle = the blank. Corner-on square stock: use length for scale, clip to across-flats width, do not treat the diagonal of the pommel as 3.5″.”*

A later in-app scaler (medium) would still need: rotate to vertical, pick top/foot, and the across-flats vs across-corners choice. Perspective un-warp is the part this photo actually wants and that we skipped.

## Traced DXF overlay (in the planner)

The 2D planner overlay is not this PNG. Trace a silhouette on `/trace.html`, Save DXF, then **Overlay DXF** in the planner 2D pane. That file is already in inches with headstock at 0; Fade controls how strong it is. It does not cut wood.
