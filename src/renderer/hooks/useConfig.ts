import { useState, useCallback } from "react";

const STORAGE_KEY = "ai-image-workbench-config";

export interface AppConfig {
  geminiApiKey: string;
  geminiBaseUrl: string;
  genModel2A: string;
  genImageSize: string;
  genImageAspectRatio: string;
}

const defaults: AppConfig = {
  geminiApiKey: "",
  geminiBaseUrl: "",
  genModel2A: "gemini-3.1-flash-image-preview",
  genImageSize: "4K",
  genImageAspectRatio: "2:3",
};

export function useConfig() {
  const [config, setConfig] = useState<AppConfig>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return { ...defaults, ...JSON.parse(raw) };
    } catch {
      // ignore
    }
    return { ...defaults };
  });

  const update = useCallback((patch: Partial<AppConfig>) => {
    setConfig((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  const isConfigured = useCallback((): boolean => {
    return config.geminiApiKey.trim().length > 0;
  }, [config]);

  return { config, update, isConfigured };
}
