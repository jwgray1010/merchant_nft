"use client";

import { createContext, type CSSProperties, type ReactNode, useContext } from "react";
import type { TownThemeRecord } from "./themeTypes";

type TownThemeContextValue = {
  town: TownThemeRecord;
};

const TownThemeContext = createContext<TownThemeContextValue | null>(null);

type ThemeStyle = CSSProperties & Record<`--${string}`, string>;

type TownThemeProviderProps = {
  town: TownThemeRecord;
  children: ReactNode;
};

export function TownThemeProvider({ town, children }: TownThemeProviderProps) {
  const style: ThemeStyle = {
    "--accent": town.theme.accent,
    "--bg": town.theme.bg,
    "--surface": town.theme.surface,
    "--text": town.theme.text,
    "--muted": town.theme.muted,
    "--border": town.theme.border,
  };

  return (
    <TownThemeContext.Provider value={{ town }}>
      <div style={style} className="min-h-screen bg-[var(--bg)] text-[var(--text)]">
        {children}
      </div>
    </TownThemeContext.Provider>
  );
}

export function useTownTheme(): TownThemeContextValue {
  const value = useContext(TownThemeContext);
  if (!value) {
    throw new Error("useTownTheme must be used inside TownThemeProvider.");
  }
  return value;
}
