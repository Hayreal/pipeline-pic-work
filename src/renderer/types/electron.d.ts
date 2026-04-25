interface ElectronAPI {
  window: {
    minimize: () => Promise<void>;
    maximize: () => Promise<void>;
    close: () => Promise<void>;
    isMaximized: () => Promise<boolean>;
  };
  platform: {
    get: () => Promise<NodeJS.Platform>;
  };
  file: {
    select: (options?: Record<string, unknown>) => Promise<{ canceled: boolean; filePaths: string[] }>;
    read: (filePath: string) => Promise<string>;
    readText: (filePath: string) => Promise<string>;
    readAsDataURL: (filePath: string) => Promise<string>;
    readJson: (filePath: string) => Promise<unknown>;
    save: (data: { content: Buffer | string; fileName: string; defaultPath?: string }) => Promise<string | null>;
    saveCopy: (data: { sourcePath: string; fileName: string; defaultPath?: string }) => Promise<string | null>;
    copy: (data: { sourcePath: string; destinationPath: string }) => Promise<string>;
    exists: (targetPath: string) => Promise<boolean>;
    saveFolder: () => Promise<string | null>;
    listDir: (targetPath: string) => Promise<string[]>;
  };
  path: {
    join: (...parts: string[]) => Promise<string>;
  };
  shell: {
    openExternal: (url: string) => Promise<void>;
  };
  script: {
    run: (args: {
      geminiApiKey: string;
      geminiBaseUrl: string;
      genModel2A: string;
      genImageSize: string;
      genImageAspectRatio: string;
      fixture: Record<string, unknown>;
      outputDir: string;
      through?: "draft" | "full";
      extraPrompt?: string;
    }) => Promise<{ success: boolean; output: string; error: string; runDir?: string }>;
    refineRun: (args: {
      runId: string;
      command: "refine-pass" | "face-edit" | "detail-edit";
      extraArgs?: string[];
    }) => Promise<{ success: boolean; output: string; error: string }>;
  };
  pipeline: {
    getStatus: () => Promise<{ ready: boolean }>;
    init: () => Promise<{ success: boolean; error?: string }>;
    onProgress: (callback: (data: { progress: number }) => void) => void;
    onStep: (callback: (data: { step: string }) => void) => void;
    onInit: (callback: (data: { step: string; error?: string }) => void) => void;
    removeProgressListener: (callback: (data: { progress: number }) => void) => void;
    removeStepListener: (callback: (data: { step: string }) => void) => void;
    removeInitListener: (callback: (data: { step: string; error?: string }) => void) => void;
  };
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
