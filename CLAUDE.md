# archaeo-pro — Claude project notes

This file is auto-loaded by Claude Code in every session. It pins the
**design context** that every UI decision must be checked against, plus
top-level pointers to the rest of the project.

## Project pointers

- **Storage model**: GitHub-as-storage; each archaeologist gets a private
  `archaeo-pro-index` repo + one `archaeo-pro-{uuid}` repo per surveillance.
  Photos live as binary assets on a `data` Release per surveillance. The
  backend keeps no state. See `docs/architecture.md`.
- **Deployment**: Frontend on Netlify (`archaeo.pro`, `archeo.pro` 301-fix),
  API on Vercel (`backend/`), Gotenberg PDF service self-hosted from
  `pdf-service/`. Netlify reverse-proxies API paths so the PWA never deals
  with CORS.
- **Auth**: GitHub OAuth via PKCE, token relayed once through `/auth/github/exchange`
  (CORS-blocked from browsers) and then held client-side only.

## Design Context

The full and authoritative copy lives in `.impeccable.md` at the repo root.
This is a synced summary so it's always in your active context.

### Users

Italian *liberi professionisti archeologi* — solo archaeologists running
*sorveglianze archeologiche* under SABAP prescriptions. They use archaeo-pro
in two contexts:

- **Field**: phone/tablet outdoors, often in direct sun, sometimes
  gloved/dirty hands, patchy mobile data, may be standing in a trench.
- **Office**: desktop, finalizing the report and generating the
  Sovrintendenza-grade DOCX/PDF.

The output is a legal document with cultural-heritage stakes. The interface
must project competence both to the archaeologist (who has to trust it on a
real job) and through the artifacts it emits (because they end up at a
ministry).

### Brand Personality

Three words: **field-craft, scholarly, Italian.**

- *Field-craft*: tools made for the work — the spirit of a theodolite, a
  Munsell chart, a ranging rod — without kitschy retro affect.
- *Scholarly*: classical typographic proportion. Hierarchy from size,
  weight, and space — never decorative chrome. Italian academic publishing
  (Marsilio, Quodlibet, Donzelli) translated into UI.
- *Italian*: borrowed from Italian editorial and product-design tradition
  (Olivetti, Pirelli, Bompiani spines, Garzanti dictionaries). Warmth via
  tinted neutrals, never via tourist iconography.

### Aesthetic Direction

Spirit of **Felt, Mapbox Studio, Linear** — clean, sharp, restrained,
unmistakably a tool — pushed toward archaeological/scholarly material.
**Theme**: both, user-toggleable; **default light** (paper-white reads
better in the sun and matches the printed-and-signed deliverable).
**Palette**: warm-neutral surfaces tinted parchment/terra/ochre, with a
single confident accent in the terra/iron-oxide/Pompeian-red family
reserved for action. No rainbow, no gradients-for-emphasis, no
glassmorphism, no neon-on-dark.

### Anti-references

- Tourist Italy (terracotta-and-cypress, sunset gradients, Colosseum chic)
- Silicon-Valley SaaS (rainbow accents, gradient text, AI-cyan-on-dark)
- Academic-by-default (Times Roman everywhere, beige institutional)
- Glassmorphism / icon-rounded-square-above-every-heading templates

### Design Principles

1. **Tools, not trinkets.** Every visual element justifies its weight by
   helping a working archaeologist in a trench. Cut anything that doesn't.
2. **Scholarly proportion over decorative noise.** Hierarchy is type and
   space, not color and chrome.
3. **Restrained palette tinted to earth.** Warm neutrals + one accent.
4. **Field-readable by default.** Body ≥ 16 px (18 px preferred for
   long-form), touch targets ≥ 44 px, contrast on the strict side of WCAG
   AA — sun is part of the test.
5. **Italian without postcards.** Reach for Italian *typographic* tradition
   (« » quotes, real ligatures, dignified headings), not tourist tropes.

### Operational rules for Claude

- **Typography**: do NOT default to Inter, DM Sans, Plus Jakarta, IBM Plex,
  Fraunces, Newsreader, or any of the impeccable reflex-reject list. Look
  further before naming a font.
- **Italian copy first.** UI strings are Italian. Archaeology terms (US,
  SABAP, CTR, vincolo, sorveglianza) are preserved verbatim — never
  Englished.
- **Map is the centerpiece** in field mode — Felt-style: confident,
  full-bleed, chrome that gets out of the way.
- **DOCX template** is a sibling design surface; its typographic choices
  should feel like the same hand made both.
- **Tokens** are OKLCH with semantic names (`--surface`, `--text`,
  `--accent`, `--accent-quiet`, `--rule`). No `--hex-named` tokens, no
  pure black/white.
