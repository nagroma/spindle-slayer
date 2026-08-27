# Router bit reference data

Source: Magnate’s “Router Bits For Legacy Ornamental Milling Machinery”
catalog —
https://www.magnate.net/v/vspfiles/assets/images/custom/catalogs/Router%20Bits%20-%20Legacy%202024.pdf

**This file is a catalog excerpt, not the live library.** Bits that appear in the planner come from `bits/*.dxf`. Add or remove a DXF there (reload / rebuild) to change what is on screen. Display name today is the filename without `.dxf`.

The tables below are Magnate tool numbers and sizes, kept so we can name bits properly later and so we know what the PDF lists as Legacy-related. Compound (two-radii-in-one-plunge) bits are skipped here.

Fields: `tool` = catalog tool number, `kind` = bead (convex) or cove (concave), `R` = radius in inches the bit cuts.

## Astragal / roundover — Plunge Flat Roundover

“Used with the Legacy ornamental machines, these bits make transitions from flat surfaces to beads on round or flat stock, i.e. astragal on columns or table legs.”

| Tool | R |
|---|---|
| 1273 | 3/16" (0.1875) |
| 1274 | 1/4" (0.25) |
| 1278 | 1/2" (0.5) |

## Ball — Plunge Roundover with Radius

“Can be also used for the Legacy Ornamental Mill. Great for milling 2" and 3" diameter balls on posts or large beads on column bases.”

| Tool | R | Ball dia |
|---|---|---|
| 7592 | 1.0" | 2.0" |
| 7593 | 1.5" | 3.0" |

## Small decorative bead/ball — Double Bead Point Plunge

“The above illustration depicts a wood column milled by the Legacy Ornamental Milling machines.”

| Tool | R |
|---|---|
| 3481 | 5/16" (0.3125) |
| 3482 | 5/8" (0.625) |

## Template follower — Pattern Extended Shank

“Originally designed for the Legacy Ornamental Milling machine, this bit allows you to follow a template when milling a contoured profile. It works on turnings up to 10", and square or flat stock up to 5" thick.”

| Tool | Notes |
|---|---|
| 7621 | Bearing-guided, follows a physical template. Used for continuous curved-taper sections, not a fixed profile shape. |

## Core box — round-nose, for flute/spiral work (side-riding, horizontal mount)

“For use in decorative fluting and sign making... can be used with the Legacy Ornamental Mill to cut indexed flutes and coves on spindle or parallel stock.”

| Tool | Cutting dia | R |
|---|---|---|
| 802 | 3/8" | 0.1875 |
| 805 | 3/4" | 0.375 |
| 808 | 2" | 1.0 |

## Fluting Extended Shank — round-nose, bearing-guided (BR-05)

“Designed for Legacy. These bits are for milling fluted columns and spindles up to 8" in diameter. Extended shaft allows for milling on the side of a larger diameter while following a curved profile.”

| Tool | R |
|---|---|
| 6051 | 1/8" (0.125) |
| 6054 | 3/16" (0.1875) |
| 6058 | 3/8" (0.375) |

## Reeding Extended Shank — round-nose, 5" shank

“Designed for the Legacy Ornamental machines... used to mill spiral or index flutes on contoured spindles i.e. pineapple pattern on a finial.”

| Tool | R |
|---|---|
| 7691 | 3/16" (0.1875) |
| 7697 | 1/2" (0.5) |

## Side V-Grooving — 90° included angle, bearing-guided (BR-05)

“Designed for the Legacy. These bits are for milling v style flutes on spindles up to 8" in diameter.”

| Tool | Overall dia |
|---|---|
| 771 | 7/8" |
| 775 | 1-5/8" |

## V-Grooving & Carving, 3-flute

Bird Mouth / V-Grooving & Carving families: “allowing for deep cut profiles such as turnings, fluting, and spirals on the Legacy Ornamental Mill.”

| Tool | Degree |
|---|---|
| 767 | 45° |
| 761 | 60° |
| 706 | 90° |

## Not in this excerpt

- **Compound bead+cove bits** (Cove & Bead Plunge 3641/3642, Large Cove Classic Plunge 3941/3942) — one DXF can already hold a compound profile if we add the file; this table still skips them as catalog examples.
- **Classic Plunge Cutting coves (3931–3935)** — catalog caption has no Legacy mill tie.
- Everything else in the PDF (dovetail bits, collet reducers, generic dado/spiral bits, corner rounding, thread cutting, bowl/tray, brick and rope molding, barley twist, etc.) — general router-table bits, or not needed as an example yet.
