import {
  createContext,
  useContext,
  useEffect,
  useMemo,
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
  token?: {
    colorBgLayout?: string;
    colorBgContainer?: string;
    colorText?: string;
    colorTextSecondary?: string;
    colorBorder?: string;
    colorBorderSecondary?: string;
    borderRadius?: number;
  };
}

export const THEME: ThemePreset = {
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

interface ThemeContextValue {
  themeId: ThemeId;
  preset: ThemePreset;
  mode: ColorMode;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const preset = THEME;

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = preset.mode;
    root.dataset.themeId = preset.id;
    root.style.colorScheme = preset.mode;
    root.style.setProperty("--app-bg", preset.token?.colorBgLayout ?? "#f5f5f5");
    root.style.setProperty("--app-primary", preset.colorPrimary);
    root.style.setProperty("--app-paper", preset.token?.colorBgContainer ?? "#ffffff");
    root.style.setProperty("--app-ink", preset.token?.colorText ?? "#111111");
  }, [preset]);

  const value = useMemo(
    () => ({
      themeId: preset.id,
      preset,
      mode: preset.mode,
    }),
    [preset],
  );

  return (
    <ThemeContext.Provider value={value}>
      <ConfigProvider
        theme={{
          algorithm: antdTheme.defaultAlgorithm,
          token: {
            borderRadius: preset.token?.borderRadius ?? 14,
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
