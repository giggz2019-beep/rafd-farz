# UI UX Pro Max — vendored skills

Source: https://github.com/nextlevelbuilder/ui-ux-pro-max-skill
Version: 2.13.0
Upstream commit: 8a1a6d857332da32252d77365da90c3f6293b47b (2026-08-19)
License: MIT — Copyright (c) 2024 Next Level Builder

Copied verbatim from the upstream repo's `.claude/skills/` directory. Seven skills:

| Skill | Purpose |
|---|---|
| `ui-ux-pro-max` | Core design-intelligence engine. Searchable local CSV database: 79 UI styles, 192 color palettes + product reasoning profiles, 74 font pairings, 119 UX guidelines, 105 icons, 17 GSAP presets, 25 chart types, 22 stacks. |
| `ui-styling` | shadcn/ui + Tailwind component and theming patterns, plus canvas-based visual design (bundles 81 OFL fonts). |
| `design-system` | Three-layer design tokens (primitive → semantic → component), component specs, token validators. |
| `design` | Umbrella design skill (logo, corporate identity, banners, icons, social images). |
| `brand` | Brand voice, visual identity, messaging frameworks. |
| `banner-design` | Banner layouts sized for social / ads / web hero / print. |
| `slides` | Strategic HTML presentations with Chart.js. |

## Requirements

Python 3.x (standard library only — the scripts install nothing and make no
network calls). Verified working on Python 3.11.

## Usage

The core engine is a CLI over local CSV data:

```bash
cd .claude/skills/ui-ux-pro-max

# Search one domain: style | color | chart | landing | product | ux |
#                    typography | icons | gsap | react | web | google-fonts
python3 scripts/search.py "glassmorphism" -d style -n 3

# Stack-specific guidance (html-tailwind is the stack this site uses)
python3 scripts/search.py "form validation" --stack html-tailwind

# Generate a full design system recommendation
python3 scripts/search.py "AI hiring platform" --design-system -p "Project Name"
```

## Notes

- Claude Code ships a built-in skill also named `design`, which takes
  precedence over the vendored one. Invoke the vendored capabilities through
  `ui-ux-pro-max`, `ui-styling`, `design-system`, `brand`, `banner-design`,
  or `slides` instead.
- Upstream also publishes an installer (`npm i -g ui-ux-pro-max-cli`,
  `uipro init --ai claude`). These files were vendored directly instead, so
  the skills are pinned in git and need no install step. To update, re-copy
  `.claude/skills/` from a newer upstream tag and bump the version above.
