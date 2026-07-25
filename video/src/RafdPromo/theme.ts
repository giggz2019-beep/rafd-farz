// Brand tokens mirrored from the site's style.css :root
export const COLORS = {
  primary: "#0A1628",
  primaryLight: "#123554",
  accent: "#0B5D3B",
  accentLight: "#16A870",
  gold: "#C9A24B",
  goldLight: "#E9CD8A",
  white: "#ffffff",
  muted: "#94a3b8",
} as const;

// Loaded via @font-face (base64-embedded) in index.css. No network access
// at render time, so this can't load Google-hosted IBM Plex Sans Arabic —
// the same locally bundled family is used for body text too.
export const FONT_HEADING = "ThmanyahSans";
export const FONT_BODY = "'ThmanyahSans', Tahoma, sans-serif";
