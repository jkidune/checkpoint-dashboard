# Checkpoint production brand assets

These files are copied into the application and are safe to serve from `/brand/`.
The original design folder is development input only and is not required at build
or runtime.

## Asset map

- `logo/checkpoint-logo.svg` — full-color logo for light surfaces
- `logo/checkpoint-logo-dark.svg` — white logo for dark surfaces
- `logo/checkpoint-icon.svg` — full-color standalone mark
- `logo/checkpoint-icon-dark.svg` — white standalone mark
- `logo/checkpoint-outline-logo.svg` — supplied outline lockup
- `favicon/` — SVG favicon, 16 px and 32 px browser icons, Apple touch icon,
  and 192 px/512 px PWA icons
- `backgrounds/` — four supplied abstract PNG backgrounds
- `social/checkpoint-og.png` — 1200 × 630 Open Graph and social preview

Prefer the SVG files for interface logos and icons. Use the PNG backgrounds only
as decorative imagery and keep meaningful text in HTML.
