# Volo Index — Logo Assets ("Lift")

The Volo Index mark is **Lift**: three concentric arcs rising from a single point —
representing tiers of mastery and upward growth. The graded clay tones mirror the
four-tier scoring scale (Foundational → Developing → Proficient → Expert).

## Brand colors
| Token            | Hex       | Use                          |
|------------------|-----------|------------------------------|
| Outer arc (tan)  | `#e0d4c0` | lightest tier                |
| Mid arc (amber)  | `#cd8a4f` | mid tier                     |
| Inner arc (clay) | `#b0542c` | primary accent / inner tier  |
| Inner deep       | `#8c4022` | hover / pressed accent       |
| Ink              | `#22201b` | wordmark on light            |
| Paper            | `#f4efe5` | background                   |

On **dark backgrounds** use the `-dark` files (arcs brightened to `#efe2cd` / `#d99a5f` / `#c66236`).

## Files
| File                          | What it is                                  |
|-------------------------------|---------------------------------------------|
| `volo-mark.svg`               | mark only, transparent (light backgrounds)  |
| `volo-mark-dark.svg`          | mark only, transparent (dark backgrounds)   |
| `volo-lockup.svg`             | mark + "Volo Index" wordmark (light)        |
| `volo-lockup-dark.svg`        | mark + wordmark (dark)                       |
| `volo-icon.svg`               | square app icon on cream, rounded corners   |
| `favicon-32.png` / `-64.png`  | favicons                                     |
| `apple-touch-icon-180.png`    | iOS home-screen icon                         |
| `icon-512.png`                | PWA / store icon                             |
| `volo-mark-512.png` / `-dark` | raster mark, transparent                     |

## The wordmark
The wordmark is set in **Spectral SemiBold (600)**, letter-spacing −0.01em.
The lockup SVGs reference Spectral by name, so they render correctly wherever the
font is loaded (the site already loads it from Google Fonts). For a fully
font-independent file, open a lockup SVG in a vector editor and "convert text to
outlines", or use the live HTML lockup in the site header.

## Favicon (already wired into the site)
The site's `<head>` includes an inline SVG favicon, so no extra files are required
for the favicon to work. To also serve PNG/Apple icons, add:

```html
<link rel="icon" type="image/svg+xml" href="assets/volo-icon.svg">
<link rel="icon" type="image/png" sizes="32x32" href="assets/favicon-32.png">
<link rel="apple-touch-icon" sizes="180x180" href="assets/apple-touch-icon-180.png">
```

## Clear space & minimum size
Keep clear space around the mark equal to the radius of the inner arc.
Minimum legible size: 20px tall for the mark, 110px wide for the full lockup.
