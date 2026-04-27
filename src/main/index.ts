import { app, BrowserWindow, ipcMain, dialog, shell } from "electron";
import path from "path";
import fs from "fs/promises";
import fsSync from "fs";
import { spawn } from "child_process";
import https from "https";

const isDev = !!process.env.VITE_DEV_SERVER_URL || !app.isPackaged;
const runtimeRoot = path.join(
  process.env.LOCALAPPDATA ?? app.getPath("appData"),
  "ai-image-workbench",
);
const userDataPath = path.join(runtimeRoot, "user-data");
const sessionDataPath = path.join(runtimeRoot, "session-data");
const diskCachePath = path.join(runtimeRoot, "cache");

// ── Bundled pipeline paths ──────────────────────────────────

/** Where the Python source project lives (the look_pipeline package plus pyproject.toml). */
const pipelineSourceDir = isDev
  ? path.resolve(__dirname, "../../look-image-utils-feat-look-pipeline")
  : path.join(process.resourcesPath, "look-image-utils-feat-look-pipeline");

const workspaceDir = path.join(runtimeRoot, "pipeline-workspace");
const workspaceProjectDir = path.join(workspaceDir, "look-image-utils-feat-look-pipeline");

/** Bundled helper assets packaged with the Electron app. */
const bundledPipelineAssetsDir = isDev
  ? path.resolve(__dirname, "../../pipeline")
  : path.join(process.resourcesPath, "pipeline");

/** Writable tool cache used by the desktop app at runtime. */
const pipelineToolsDir = path.join(runtimeRoot, "tools");

function getWorkspacePythonPath(): string {
  return process.platform === "win32"
    ? path.join(workspaceProjectDir, ".venv", "Scripts", "python.exe")
    : path.join(workspaceProjectDir, ".venv", "bin", "python");
}

let mainWindow: BrowserWindow | null = null;

app.setPath("userData", userDataPath);
app.setPath("sessionData", sessionDataPath);
app.commandLine.appendSwitch("disk-cache-dir", diskCachePath);
app.commandLine.appendSwitch("disable-gpu-shader-disk-cache");
if (isDev) {
  app.commandLine.appendSwitch("disable-http-cache");
}

function getRendererHtmlPath() {
  return path.join(__dirname, "../../dist/index.html");
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    frame: false,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
    backgroundColor: "#1A1A1A",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(getRendererHtmlPath());
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  await Promise.all([
    fs.mkdir(userDataPath, { recursive: true }),
    fs.mkdir(sessionDataPath, { recursive: true }),
    fs.mkdir(diskCachePath, { recursive: true }),
  ]);
  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// ── Workspace helpers ───────────────────────────────────────

async function dirExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/** Copy a directory recursively (sync, used during workspace init). */
function copyDirSync(src: string, dest: string, ignore: Set<string>) {
  fsSync.mkdirSync(dest, { recursive: true });
  for (const entry of fsSync.readdirSync(src, { withFileTypes: true })) {
    if (ignore.has(entry.name)) continue;
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath, ignore);
    } else {
      fsSync.copyFileSync(srcPath, destPath);
    }
  }
}

/** Download a file from URL to local path. */
function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fsSync.createWriteStream(dest);
    https
      .get(url, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          https.get(res.headers.location, (res2) => {
            res2.pipe(file);
            file.on("finish", () => { file.close(); resolve(); });
          }).on("error", reject);
          return;
        }
        res.pipe(file);
        file.on("finish", () => { file.close(); resolve(); });
      })
      .on("error", reject);
  });
}

function runCommand(command: string, args: string[], options: { cwd?: string } = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      windowsHide: process.platform === "win32",
      shell: false,
    });

    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} failed with code ${code}`));
    });
    child.on("error", reject);
  });
}

/** Extract an archive using the system tar/bsdtar command. */
async function extractArchive(zipPath: string, destDir: string): Promise<void> {
  await fs.mkdir(destDir, { recursive: true });
  await runCommand("tar", ["-xf", zipPath, "-C", destDir]);
}

/** Find a file by name recursively (sync). */
function findFileSync(dir: string, name: string): string | null {
  if (!fsSync.existsSync(dir)) return null;
  for (const entry of fsSync.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findFileSync(fullPath, name);
      if (found) return found;
    } else if (entry.name === name) {
      return fullPath;
    }
  }
  return null;
}

const UV_VERSION = "0.8.9";

function getUvExecutableName(): string {
  return process.platform === "win32" ? "uv.exe" : "uv";
}

function getBundledUvPath(): string {
  return path.join(bundledPipelineAssetsDir, getUvExecutableName());
}

function getDownloadedUvPath(): string {
  return path.join(pipelineToolsDir, getUvExecutableName());
}

function getUvDownloadUrl(): string {
  if (process.platform === "win32") {
    if (process.arch !== "x64") {
      throw new Error(`Unsupported Windows architecture: ${process.arch}`);
    }
    return `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/uv-x86_64-pc-windows-msvc.zip`;
  }

  if (process.platform === "darwin") {
    if (process.arch === "arm64") {
      return `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/uv-aarch64-apple-darwin.tar.gz`;
    }
    if (process.arch === "x64") {
      return `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/uv-x86_64-apple-darwin.tar.gz`;
    }
    throw new Error(`Unsupported macOS architecture: ${process.arch}`);
  }

  throw new Error(`Unsupported platform: ${process.platform}`);
}

async function ensureExecutable(filePath: string): Promise<void> {
  if (process.platform !== "win32") {
    await fs.chmod(filePath, 0o755);
  }
}

/** Try to find uv on PATH. */
async function findUvOnPath(): Promise<string | null> {
  return new Promise((resolve) => {
    const locator = process.platform === "win32" ? "where" : "which";
    const candidates = process.platform === "win32" ? ["uv", "uv.exe", "uv.cmd"] : ["uv"];
    const p = spawn(locator, candidates, { shell: true, windowsHide: process.platform === "win32" });
    let out = "";
    p.stdout.on("data", (d: Buffer) => { out += d.toString("utf-8"); });
    p.on("close", () => {
      const lines = out.trim().split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      resolve(lines[0] || null);
    });
    p.on("error", () => resolve(null));
    setTimeout(() => { p.kill(); resolve(null); }, 5000);
  });
}

/**
 * Initialize the workspace: copy Python project, find uv, create venv, run uv sync.
 * Called once on first launch. Sends progress events to renderer.
 */
async function initWorkspace(): Promise<{ success: boolean; error?: string }> {
  try {
    await fs.mkdir(workspaceDir, { recursive: true });

    // 1. Copy Python project from source to workspace
    if (mainWindow) mainWindow.webContents.send("pipeline:init", { step: "Copying Python project..." });
    if (await dirExists(workspaceProjectDir)) {
      await fs.rm(workspaceProjectDir, { recursive: true, force: true });
    }
    const ignoreDirs = new Set([".venv", "__pycache__", ".mypy_cache", "node_modules", ".git"]);
    copyDirSync(pipelineSourceDir, workspaceProjectDir, ignoreDirs);

    // 2. Find uv: check PATH first, then bundled location, then download
    let uvExe: string | null = null;

    // 2a. Try PATH
    const pathUv = await findUvOnPath();
    if (pathUv && fsSync.existsSync(pathUv)) {
      uvExe = pathUv;
      if (mainWindow) mainWindow.webContents.send("pipeline:init", { step: `Found uv on PATH: ${pathUv}` });
    }

    // 2b. Try bundled uv in packaged resources or the dev tools directory
    if (!uvExe) {
      const bundledUv = getBundledUvPath();
      if (fsSync.existsSync(bundledUv)) {
        await ensureExecutable(bundledUv);
        uvExe = bundledUv;
        if (mainWindow) mainWindow.webContents.send("pipeline:init", { step: "Using bundled uv." });
      }
    }

    // 2c. Download from GitHub as last resort
    if (!uvExe) {
      if (mainWindow) mainWindow.webContents.send("pipeline:init", { step: "Downloading uv from GitHub..." });
      const localUv = getDownloadedUvPath();
      try {
        await fs.mkdir(pipelineToolsDir, { recursive: true });
        const downloadUrl = getUvDownloadUrl();
        const archiveName = path.basename(new URL(downloadUrl).pathname);
        const zipPath = path.join(pipelineToolsDir, archiveName);
        const extractDir = path.join(pipelineToolsDir, "uv-temp-extract");
        await downloadFile(downloadUrl, zipPath);
        await extractArchive(zipPath, extractDir);
        await fs.rm(zipPath, { force: true });
        const found = findFileSync(extractDir, getUvExecutableName());
        if (!found) throw new Error(`${getUvExecutableName()} not found in downloaded archive`);
        await fs.copyFile(found, localUv);
        await ensureExecutable(localUv);
        await fs.rm(extractDir, { recursive: true, force: true });
        uvExe = localUv;
      } catch (downloadErr) {
        throw new Error(
          `Could not download uv. Please install uv manually (https://github.com/astral-sh/uv) and set it on PATH, or place ${getUvExecutableName()} in: ${pipelineToolsDir}`,
        );
      }
    }

    if (!uvExe) throw new Error("uv executable not found");

    // 3. Create venv inside the project directory (where pyproject.toml lives)
    if (mainWindow) mainWindow.webContents.send("pipeline:init", { step: "Creating virtual environment..." });
    await new Promise<void>((resolve, reject) => {
      const p = spawn(uvExe!, ["venv", "--python", "3.12"], {
        cwd: workspaceProjectDir,
        windowsHide: process.platform === "win32",
      });
      p.on("close", (code) => { if (code === 0) resolve(); else reject(new Error(`uv venv failed: ${code}`)); });
      p.on("error", reject);
    });

    // 4. Install dependencies
    if (mainWindow) mainWindow.webContents.send("pipeline:init", { step: "Installing dependencies (uv sync)..." });
    await new Promise<void>((resolve, reject) => {
      const p = spawn(uvExe!, ["sync"], {
        cwd: workspaceProjectDir,
        windowsHide: process.platform === "win32",
      });
      p.on("close", (code) => { if (code === 0) resolve(); else reject(new Error(`uv sync failed: ${code}`)); });
      p.on("error", reject);
    });

    // 5. Write marker file
    await fs.writeFile(
      path.join(workspaceDir, ".workspace-ready"),
      JSON.stringify({ setupAt: new Date().toISOString(), uvPath: uvExe, platform: process.platform, arch: process.arch }) + "\n",
    );

    if (mainWindow) mainWindow.webContents.send("pipeline:init", { step: "Pipeline ready." });
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error during workspace init";
    if (mainWindow) mainWindow.webContents.send("pipeline:init", { step: `Error: ${message}`, error: message });
    return { success: false, error: message };
  }
}

async function ensureWorkspaceReady(): Promise<{ ready: boolean; error?: string }> {
  const markerPath = path.join(workspaceDir, ".workspace-ready");
  try {
    await fs.access(markerPath);
    return { ready: true };
  } catch {
    return { ready: false };
  }
}

/** Spawn the pipeline using the bundled workspace venv. */
function spawnPipeline(
  args: string[],
  env: Record<string, string>,
): ReturnType<typeof spawn> {
  const pythonPath = getWorkspacePythonPath();
  return spawn(pythonPath, args, {
    cwd: workspaceProjectDir,
    env,
    windowsHide: process.platform === "win32",
  });
}

// ── IPC Handlers ────────────────────────────────────────────

ipcMain.handle("window:minimize", () => {
  mainWindow?.minimize();
});

ipcMain.handle("window:maximize", () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});

ipcMain.handle("window:close", () => {
  mainWindow?.close();
});

ipcMain.handle("window:is-maximized", () => {
  return mainWindow?.isMaximized() ?? false;
});

ipcMain.handle("platform:get", () => {
  return process.platform;
});

ipcMain.handle("file:select", async (_, options) => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ["openFile", "multiSelections"],
    filters: [
      { name: "Images", extensions: ["jpg", "jpeg", "png", "webp"] },
      { name: "All Files", extensions: ["*"] },
    ],
    ...options,
  });
  return result;
});

ipcMain.handle("file:read", async (_, filePath: string) => {
  const buffer = await fs.readFile(filePath);
  return `data:image/jpeg;base64,${buffer.toString("base64")}`;
});

ipcMain.handle("file:readText", async (_, filePath: string) => {
  return await fs.readFile(filePath, "utf-8");
});

ipcMain.handle("file:read-as-data-url", async (_, filePath: string) => {
  const buffer = await fs.readFile(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const mime = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
  return `data:${mime};base64,${buffer.toString("base64")}`;
});

ipcMain.handle("file:save", async (_, data: { content: Buffer | string; fileName: string; defaultPath?: string }) => {
  const result = await dialog.showSaveDialog(mainWindow!, {
    defaultPath: data.defaultPath ?? data.fileName,
    filters: [
      { name: "All Files", extensions: ["*"] },
    ],
  });
  if (!result.canceled && result.filePath) {
    await fs.writeFile(result.filePath, data.content);
    return result.filePath;
  }
  return null;
});

ipcMain.handle("file:save-copy", async (_, data: { sourcePath: string; fileName: string; defaultPath?: string }) => {
  const result = await dialog.showSaveDialog(mainWindow!, {
    defaultPath: data.defaultPath ?? data.fileName,
    filters: [
      { name: "All Files", extensions: ["*"] },
    ],
  });
  if (!result.canceled && result.filePath) {
    await fs.copyFile(data.sourcePath, result.filePath);
    return result.filePath;
  }
  return null;
});

ipcMain.handle("file:copy", async (_, data: { sourcePath: string; destinationPath: string }) => {
  await fs.mkdir(path.dirname(data.destinationPath), { recursive: true });
  await fs.copyFile(data.sourcePath, data.destinationPath);
  return data.destinationPath;
});

ipcMain.handle("file:exists", async (_, targetPath: string) => {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
});

ipcMain.handle("file:save-folder", async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ["openDirectory", "createDirectory"],
  });
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

ipcMain.handle("shell:open-external", async (_, url: string) => {
  return shell.openExternal(url);
});

ipcMain.handle("file:read-json", async (_, targetPath: string) => {
  const content = await fs.readFile(targetPath, "utf-8");
  return JSON.parse(content);
});

ipcMain.handle("file:list-dir", async (_, targetPath: string) => {
  try {
    const entries = await fs.readdir(targetPath, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile())
      .map((e) => e.name);
  } catch {
    return [];
  }
});

ipcMain.handle("path:join", (_, ...parts: string[]) => {
  return path.join(...parts);
});

ipcMain.handle("pipeline:status", async () => {
  const status = await ensureWorkspaceReady();
  return status;
});

ipcMain.handle("pipeline:init", async () => {
  return await initWorkspace();
});

ipcMain.handle("pipeline:workspaceDir", async () => {
  return workspaceDir;
});

// ── Pipeline execution ──────────────────────────────────────

interface RefineRunArgs {
  runId: string;
  command: "refine-pass" | "face-edit" | "detail-edit";
  extraArgs?: string[];
}

ipcMain.handle("script:refine-run", async (_, args: RefineRunArgs) => {
  return new Promise<{ success: boolean; output: string; error: string }>(async (resolve) => {
    const { runId, command, extraArgs = [] } = args;

    const workspaceOk = await ensureWorkspaceReady();
    if (!workspaceOk.ready) {
      resolve({
        success: false,
        output: "",
        error: "Pipeline workspace not ready. Please wait for initialization or restart the app.",
      });
      return;
    }

    const spawnArgs = ["-m", "look_pipeline", command, "--run-id", runId, ...extraArgs];
    const env: Record<string, string> = {
      ...process.env,
      LOOK_WORKSPACE_ROOT: workspaceDir,
    };

    if (mainWindow) {
      mainWindow.webContents.send("pipeline:step", { step: `Starting ${command}...` });
      mainWindow.webContents.send("pipeline:progress", { progress: 0 });
    }

    let output = "";
    let error = "";

    const proc = spawnPipeline(spawnArgs, env);

    proc.stdout.on("data", (data: Buffer) => {
      const text = data.toString("utf-8");
      output += text;
      if (mainWindow) {
        mainWindow.webContents.send("pipeline:step", { step: text.trim() });
      }
    });

    proc.stderr.on("data", (data: Buffer) => {
      const text = data.toString("utf-8");
      error += text;
      if (mainWindow) {
        mainWindow.webContents.send("pipeline:step", { step: text.trim() });
      }
    });

    proc.on("close", (code) => {
      if (mainWindow) {
        mainWindow.webContents.send("pipeline:progress", { progress: code === 0 ? 100 : -1 });
      }
      resolve({ success: code === 0, output: output.trim(), error: error.trim() });
    });

    proc.on("error", (err) => {
      if (mainWindow) {
        mainWindow.webContents.send("pipeline:progress", { progress: -1 });
      }
      resolve({ success: false, output: "", error: err.message });
    });
  });
});

interface ScriptRunArgs {
  geminiApiKey: string;
  geminiBaseUrl: string;
  genModel2A: string;
  genImageSize: string;
  genImageAspectRatio: string;
  fixture: Record<string, unknown>;
  outputDir: string;
  through?: "draft" | "full";
  extraPrompt?: string;
}

ipcMain.handle("script:run", async (_, args: ScriptRunArgs) => {
  return new Promise<{ success: boolean; output: string; error: string; runDir?: string }>(async (resolve) => {
    const {
      geminiApiKey,
      geminiBaseUrl,
      genModel2A,
      genImageSize,
      genImageAspectRatio,
      fixture,
      outputDir,
      through = "draft",
      extraPrompt,
    } = args;

    const workspaceOk = await ensureWorkspaceReady();
    if (!workspaceOk.ready) {
      resolve({
        success: false,
        output: "",
        error: "Pipeline workspace not ready. Please wait for initialization or restart the app.",
      });
      return;
    }

    // Normalize all paths in fixture to POSIX forward slashes
    const normalizeFixturePaths = (obj: unknown): unknown => {
      if (typeof obj === "string") return obj.replace(/\\/g, "/");
      if (Array.isArray(obj)) return obj.map(normalizeFixturePaths);
      if (obj && typeof obj === "object") {
        const result: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
          result[k] = normalizeFixturePaths(v);
        }
        return result;
      }
      return obj;
    };
    const normalizedFixture = normalizeFixturePaths(fixture) as Record<string, unknown>;

    // Write fixture.json to workspace (not user output dir)
    const fixturePath = path.join(workspaceDir, "fixture.json");
    try {
      await fs.writeFile(fixturePath, JSON.stringify(normalizedFixture, null, 2), "utf-8");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to write fixture.json";
      resolve({ success: false, output: "", error: message });
      return;
    }

    // Write .env to workspace for the pipeline to load
    const envContent = [
      `GEMINI_API_KEY=${geminiApiKey}`,
      genImageSize ? `GEN_IMAGE_SIZE=${genImageSize}` : "",
      genImageAspectRatio ? `GEN_IMAGE_ASPECT_RATIO=${genImageAspectRatio}` : "",
      genModel2A ? `GEN_MODEL_2A=${genModel2A}` : "",
      geminiBaseUrl ? `GEMINI_BASE_URL=${geminiBaseUrl}` : "",
      `LOOK_WORKSPACE_ROOT=${workspaceDir}`,
    ].filter(Boolean).join("\n");
    await fs.writeFile(path.join(workspaceDir, ".env"), envContent + "\n");

    const env: Record<string, string> = {
      ...process.env,
      GEMINI_API_KEY: geminiApiKey,
      GEN_IMAGE_SIZE: genImageSize,
      GEN_IMAGE_ASPECT_RATIO: genImageAspectRatio,
      LOOK_WORKSPACE_ROOT: workspaceDir,
    };
    if (geminiBaseUrl) env.GEMINI_BASE_URL = geminiBaseUrl;
    if (genModel2A) env.GEN_MODEL_2A = genModel2A;

    const spawnArgs = [
      "-m",
      "look_pipeline",
      "run",
      "--through",
      through,
      "--fixture",
      fixturePath.replace(/\\/g, "/"),
    ];
    if (extraPrompt?.trim()) {
      spawnArgs.push("--extra-prompt", extraPrompt.trim());
    }

    let output = "";
    let error = "";

    const proc = spawnPipeline(spawnArgs, env);

    proc.stdout.on("data", (data: Buffer) => {
      const text = data.toString("utf-8");
      output += text;
      if (mainWindow) {
        mainWindow.webContents.send("pipeline:step", { step: text.trim() });
        const progressMatch = text.match(/progress[:\s]*(\d+)%/i);
        if (progressMatch) {
          mainWindow.webContents.send("pipeline:progress", { progress: parseInt(progressMatch[1], 10) });
        }
      }
    });

    proc.stderr.on("data", (data: Buffer) => {
      const text = data.toString("utf-8");
      error += text;
      if (mainWindow) {
        mainWindow.webContents.send("pipeline:step", { step: text.trim() });
      }
    });

    proc.on("close", (code) => {
      if (mainWindow) {
        mainWindow.webContents.send("pipeline:progress", { progress: code === 0 ? 100 : -1 });
      }
      resolve({
        success: code === 0,
        output: output.trim(),
        error: error.trim(),
        runDir: path.join(workspaceDir, "runs", (fixture.run_id as string) ?? ""),
      });
    });

    proc.on("error", (err) => {
      resolve({ success: false, output: "", error: err.message });
    });
  });
});
