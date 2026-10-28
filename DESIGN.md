# DESIGN.md

<!-- Written and maintained by Claude using the design-languages skill.
     It records how the named references were translated for THIS project so later work stays consistent. -->

**Catalogue version:** 1.0
**References:** Neo-Brutalism (structure, shape, surface) + Indian truck art (colour mood and joy)
**Preset:** none
**Medium:** web app (phones, tablets, classroom smart boards and projectors)
**Audience and job:** Teachers in Basti pick a school once, then find and play a video for a class in a few taps; children watch it on a shared screen.

## Resolved decisions

| Layer | Decision |
|---|---|
| Structure | Single column, max 1600px; sticky marigold header; card grid `auto-fill minmax(15rem, 1fr)` (2 columns on phones); video rows in a 1–3 column grid |
| Typography | Baloo 2 700/800 for headings, chips, card titles / Mukta 400/700 for text; fallbacks Nirmala UI, Noto Sans Devanagari, system-ui. Root size `clamp(15px, 0.6vw + 12px, 22px)` so smart boards scale up. Tabular figures for counts |
| Colour | cream `#fff4dc` page, ink `#111`, marigold `#ffc21a` header and active text, magenta `#e5197d` primary action, card fills cycle `#ffd23f` `#ff9ccd` `#85e39a` `#95cdff`; "played" = mint `#85e39a` on ink |
| Surface | Flat fills, no gradients or blur; depth only from hard offset shadows |
| Shape | 3px ink borders on everything interactive (2px on small inner items); radius 10px controls, 14px cards, 6px thumbnails |
| Density | Regular to airy; 0.6–1.1rem gaps; tap targets at least 2.75rem |
| Components | Buttons and chips: border + `3px 3px 0` / `5px 5px 0` ink shadow, lift on hover, press-in on tap. Active chip/selection = ink fill with marigold text. Pills for stats and "✓ played" badges |
| Icons | Unicode glyphs only (▶ ⏮ ⏭ ✕ ✓ ←), no icon font, to keep the page light |
| Charts | n/a on the teacher page (the officer dashboard is the Google Sheet) |
| Imagery | YouTube thumbnails, framed with an ink border; no other illustration |
| Motion | State changes only: 120ms lift/press; off under `prefers-reduced-motion` |

## Project rules

- Black text on every fill must stay WCAG AA; new fills go through the same check.
- No brand marks of TicTacLearn or YouTube in the chrome; the play-mark is our own.
- Keep the page under ~35 KB of our own code; fonts are the only third-party download.
- Hindi first for every teacher-facing string.

## Token source

`web/style.css` (`:root` custom properties)

## Change log

- 2026-10-28: created from Neo-Brutalism + Indian truck art, chosen over a Government + Swiss and a Material 3 Expressive direction.
