import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  window: {
    minimize: () => ipcRenderer.invoke("window:minimize"),
    maximize: () => ipcRenderer.invoke("window:maximize"),
    close: () => ipcRenderer.invoke("window:close"),
    isMaximized: () => ipcRenderer.invoke("window:is-maximized"),
  },
  platform: {
    get: () => ipcRenderer.invoke("platform:get"),
  },
  file: {
    select: (options?: Record<string, unknown>) =>
      ipcRenderer.invoke("file:select", options),
    read: (filePath: string) => ipcRenderer.invoke("file:read", filePath),
    readText: (filePath: string) => ipcRenderer.invoke("file:readText", filePath),
    readAsDataURL: (filePath: string) => ipcRenderer.invoke("file:read-as-data-url", filePath),
    readJson: (filePath: string) => ipcRenderer.invoke("file:read-json", filePath),
    save: (data: {
      content: Buffer | string;
      fileName: string;
      defaultPath?: string;
    }) => ipcRenderer.invoke("file:save", data),
    saveCopy: (data: {
      sourcePath: string;
      fileName: string;
      defaultPath?: string;
    }) => ipcRenderer.invoke("file:save-copy", data),
    copy: (data: {
      sourcePath: string;
      destinationPath: string;
    }) => ipcRenderer.invoke("file:copy", data),
    exists: (targetPath: string) => ipcRenderer.invoke("file:exists", targetPath),
    saveFolder: () => ipcRenderer.invoke("file:save-folder"),
    listDir: (targetPath: string) => ipcRenderer.invoke("file:list-dir", targetPath),
  },
  path: {
    join: (...parts: string[]) => ipcRenderer.invoke("path:join", ...parts),
  },
  shell: {
    openExternal: (url: string) => ipcRenderer.invoke("shell:open-external", url),
  },
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
    }) =>
      ipcRenderer.invoke("script:run", args),
    refineRun: (args: {
      runId: string;
      command: "refine-pass" | "face-edit" | "detail-edit";
      extraArgs?: string[];
    }) =>
      ipcRenderer.invoke("script:refine-run", args),
  },
  pipeline: {
    getStatus: () => ipcRenderer.invoke("pipeline:status"),
    init: () => ipcRenderer.invoke("pipeline:init"),
    onProgress: (callback: (data: { progress: number }) => void) => {
      ipcRenderer.on("pipeline:progress", (_event, data) => callback(data));
    },
    onStep: (callback: (data: { step: string }) => void) => {
      ipcRenderer.on("pipeline:step", (_event, data) => callback(data));
    },
    onInit: (callback: (data: { step: string; error?: string }) => void) => {
      ipcRenderer.on("pipeline:init", (_event, data) => callback(data));
    },
    removeProgressListener: (callback: (data: { progress: number }) => void) => {
      ipcRenderer.removeListener("pipeline:progress", callback as any);
    },
    removeStepListener: (callback: (data: { step: string }) => void) => {
      ipcRenderer.removeListener("pipeline:step", callback as any);
    },
    removeInitListener: (callback: (data: { step: string; error?: string }) => void) => {
      ipcRenderer.removeListener("pipeline:init", callback as any);
    },
  },
});
