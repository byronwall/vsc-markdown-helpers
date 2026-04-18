export const DEFAULT_PREVIEW_THEME_ID = "sage";
export const DEFAULT_PREVIEW_FONT_SCALE = 1;
export const PREVIEW_FONT_SCALE_MIN = 0.85;
export const PREVIEW_FONT_SCALE_MAX = 1.3;
export const PREVIEW_FONT_SCALE_STEP = 0.05;

export const PREVIEW_THEMES = [
  {
    id: "sage",
    label: "Sage",
    mode: "light",
    canvas: "#eef3f0",
    surface: "#fbfdfc",
    ink: "#183229",
    accent: "#1e6c53",
    accentWarm: "#5f8474",
    accentCool: "#3e62a7",
    danger: "#a53d2d",
  },
  {
    id: "parchment",
    label: "Parchment",
    mode: "light",
    canvas: "#f6efe2",
    surface: "#fffaf2",
    ink: "#33261b",
    accent: "#8e5a2b",
    accentWarm: "#c28a47",
    accentCool: "#4f7a8c",
    danger: "#a94435",
  },
  {
    id: "linen",
    label: "Linen",
    mode: "light",
    canvas: "#f3f0ea",
    surface: "#fdfbf7",
    ink: "#2d2924",
    accent: "#7b6a52",
    accentWarm: "#b68552",
    accentCool: "#56798a",
    danger: "#a24a3d",
  },
  {
    id: "terracotta",
    label: "Terracotta",
    mode: "light",
    canvas: "#f5eee9",
    surface: "#fffaf8",
    ink: "#342822",
    accent: "#9a5a3c",
    accentWarm: "#c78a5c",
    accentCool: "#6f7d93",
    danger: "#b13c34",
  },
  {
    id: "glacier",
    label: "Glacier",
    mode: "light",
    canvas: "#ecf4f7",
    surface: "#fbfdff",
    ink: "#17313f",
    accent: "#2e6f87",
    accentWarm: "#7d8fa8",
    accentCool: "#4a8ea8",
    danger: "#b2503a",
  },
  {
    id: "citrus",
    label: "Citrus",
    mode: "light",
    canvas: "#f7f3e6",
    surface: "#fffdf8",
    ink: "#30311f",
    accent: "#6a7b2a",
    accentWarm: "#b28c3e",
    accentCool: "#4d7b7f",
    danger: "#a54f2d",
  },
  {
    id: "harbor",
    label: "Harbor",
    mode: "light",
    canvas: "#edf1f4",
    surface: "#fbfcfd",
    ink: "#1d2b36",
    accent: "#365b7d",
    accentWarm: "#8a755d",
    accentCool: "#588ea8",
    danger: "#a2463b",
  },
  {
    id: "rosewood",
    label: "Rosewood",
    mode: "light",
    canvas: "#f7ece8",
    surface: "#fff9f6",
    ink: "#382320",
    accent: "#a14b43",
    accentWarm: "#ca7a53",
    accentCool: "#5d7e9d",
    danger: "#b13b34",
  },
  {
    id: "midnight",
    label: "Midnight",
    mode: "dark",
    canvas: "#111819",
    surface: "#172122",
    ink: "#dbe7df",
    accent: "#56a388",
    accentWarm: "#b98c61",
    accentCool: "#6d93dc",
    danger: "#de7b64",
  },
  {
    id: "graphite",
    label: "Graphite",
    mode: "dark",
    canvas: "#151617",
    surface: "#1d2124",
    ink: "#dde1e5",
    accent: "#6798d6",
    accentWarm: "#9c8b6d",
    accentCool: "#5cb4b4",
    danger: "#de715f",
  },
  {
    id: "ember",
    label: "Ember",
    mode: "dark",
    canvas: "#1a1513",
    surface: "#231c19",
    ink: "#e9ddd3",
    accent: "#b56f48",
    accentWarm: "#cd955d",
    accentCool: "#7f94b0",
    danger: "#de715f",
  },
  {
    id: "lagoon",
    label: "Lagoon",
    mode: "dark",
    canvas: "#0f1a1f",
    surface: "#142229",
    ink: "#dcebf0",
    accent: "#4698a6",
    accentWarm: "#b3885e",
    accentCool: "#69bcc5",
    danger: "#df7760",
  },
  {
    id: "forest-night",
    label: "Forest Night",
    mode: "dark",
    canvas: "#121814",
    surface: "#1a221d",
    ink: "#dbe7dc",
    accent: "#5f9a68",
    accentWarm: "#a18b5f",
    accentCool: "#678aad",
    danger: "#df7865",
  },
  {
    id: "oxblood",
    label: "Oxblood",
    mode: "dark",
    canvas: "#1c1315",
    surface: "#251a1c",
    ink: "#eadfe2",
    accent: "#a5515d",
    accentWarm: "#b58665",
    accentCool: "#6d8fc0",
    danger: "#df7580",
  },
  {
    id: "storm",
    label: "Storm",
    mode: "dark",
    canvas: "#12161d",
    surface: "#19212c",
    ink: "#dbe2ee",
    accent: "#5e86cc",
    accentWarm: "#a2855c",
    accentCool: "#67a8b3",
    danger: "#df7960",
  },
  {
    id: "charcoal-sun",
    label: "Charcoal Sun",
    mode: "dark",
    canvas: "#181713",
    surface: "#211f18",
    ink: "#e5dfd0",
    accent: "#93863f",
    accentWarm: "#b6844d",
    accentCool: "#688796",
    danger: "#df775d",
  },
];

const previewThemeMap = new Map(
  PREVIEW_THEMES.map((theme) => [theme.id, theme]),
);

export function clampPreviewFontScale(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_PREVIEW_FONT_SCALE;
  }

  return (
    Math.round(
      Math.min(
        PREVIEW_FONT_SCALE_MAX,
        Math.max(PREVIEW_FONT_SCALE_MIN, parsed),
      ) * 100,
    ) / 100
  );
}

export function getPreviewTheme(themeId) {
  return (
    previewThemeMap.get(themeId) ??
    previewThemeMap.get(DEFAULT_PREVIEW_THEME_ID)
  );
}

export function normalizePreviewAppearance(preferences = {}) {
  const theme = getPreviewTheme(preferences.themeId);
  return {
    themeId: theme.id,
    fontScale: clampPreviewFontScale(preferences.fontScale),
  };
}

export function applyPreviewAppearance(preferences = {}) {
  const normalized = normalizePreviewAppearance(preferences);
  const theme = getPreviewTheme(normalized.themeId);
  const root = document.documentElement;

  root.dataset.previewTheme = theme.id;
  root.dataset.previewThemeMode = theme.mode;
  root.style.setProperty("--theme-canvas", theme.canvas);
  root.style.setProperty("--theme-surface", theme.surface);
  root.style.setProperty("--theme-ink", theme.ink);
  root.style.setProperty("--theme-accent", theme.accent);
  root.style.setProperty("--theme-accent-warm", theme.accentWarm);
  root.style.setProperty("--theme-accent-cool", theme.accentCool);
  root.style.setProperty("--theme-danger", theme.danger);
  root.style.setProperty("--content-font-scale", String(normalized.fontScale));

  return normalized;
}
