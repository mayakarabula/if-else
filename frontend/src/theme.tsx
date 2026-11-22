import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { ConfigProvider, theme as antdTheme } from "antd";

export type ColorMode = "light" | "dark";

export type ThemeId = "kimbia";

export interface ThemePreset {
  id: ThemeId;
  label: string;
  description: string;
  mode: ColorMode;
  colorPrimary: string;
  swatch: string;
  token: {
    colorBgLayout: string;
    colorBgContainer: string;
    colorText: string;
    colorTextSecondary: string;
    colorBorder: string;
    colorBorderSecondary: string;
    borderRadius: number;
  };
}

const STORAGE_KEY = "if-else.color-mode";

/** Quiet parchment — warm cream + umber ink. */
export const THEME_LIGHT: ThemePreset = {
  id: "kimbia",
  label: "Kimbia",
  description: "Quiet parchment",
  mode: "light",
  colorPrimary: "#a07a3a",
  swatch: "#e4dccf",
  token: {
    colorBgLayout: "#e4dccf",
    colorBgContainer: "#efe9df",
    colorText: "#2a261f",
    colorTextSecondary: "#6a5c48",
    colorBorder: "#2a261f33",
    colorBorderSecondary: "#2a261f1f",
    borderRadius: 14,
  },
};

/** Same family after dusk — espresso ink, warm paper, soft gold. */
export const THEME_DARK: ThemePreset = {
  id: "kimbia",
  label: "Kimbia Night",
  description: "Espresso parchment",
  mode: "dark",
  colorPrimary: "#c4a05a",
  swatch: "#1c1914",
  token: {
    colorBgLayout: "#16130f",
    colorBgContainer: "#221e18",
    colorText: "#ebe4d6",
    colorTextSecondary: "#a89a82",
    colorBorder: "#ebe4d633",
    colorBorderSecondary: "#ebe4d61f",
    borderRadius: 14,
  },
};

export const THEME = THEME_LIGHT;

function readStoredMode(): ColorMode | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === "light" || raw === "dark") return raw;
  } catch {
    // ignore
  }
  return null;
}

function preferSystemDark() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function resolveInitialMode(): ColorMode {
  return readStoredMode() ?? (preferSystemDark() ? "dark" : "light");
}

interface ThemeContextValue {
  themeId: ThemeId;
  preset: ThemePreset;
  mode: ColorMode;
  setMode: (mode: ColorMode) => void;
  toggleMode: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ColorMode>(() => resolveInitialMode());
  const preset = mode === "dark" ? THEME_DARK : THEME_LIGHT;

  const setMode = useCallback((next: ColorMode) => {
    setModeState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore
    }
  }, []);

  const toggleMode = useCallback(() => {
    setMode(mode === "dark" ? "light" : "dark");
  }, [mode, setMode]);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = preset.mode;
    root.dataset.themeId = preset.id;
    root.style.colorScheme = preset.mode;
    root.style.setProperty("--app-bg", preset.token.colorBgLayout);
    root.style.setProperty("--app-primary", preset.colorPrimary);
    root.style.setProperty("--app-paper", preset.token.colorBgContainer);
    root.style.setProperty("--app-ink", preset.token.colorText);
    root.style.setProperty("--app-ink-muted", preset.token.colorTextSecondary);
    root.style.setProperty("--app-border", preset.token.colorBorder);
    root.style.setProperty("--app-border-soft", preset.token.colorBorderSecondary);
  }, [preset]);

  const value = useMemo(
    () => ({
      themeId: preset.id,
      preset,
      mode,
      setMode,
      toggleMode,
    }),
    [preset, mode, setMode, toggleMode],
  );

  return (
    <ThemeContext.Provider value={value}>
      <ConfigProvider
        theme={{
          algorithm: mode === "dark" ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
          token: {
            colorPrimary: preset.colorPrimary,
            ...preset.token,
          },
        }}
      >
        {children}
      </ConfigProvider>
    </ThemeContext.Provider>
  );
}

export function useThemeMode() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useThemeMode must be used within ThemeProvider");
  }
  return context;
}
