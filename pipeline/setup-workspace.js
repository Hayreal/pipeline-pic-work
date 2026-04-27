#!/usr/bin/env node
/**
 * Cross-platform pipeline workspace setup.
 *
 * Usage:
 *   node pipeline/setup-workspace.js
 */

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const https = require("https");
const { spawn } = require("child_process");

const UV_VERSION = "0.8.9";
const pipelineAssetsDir = path.resolve(__dirname);
const projectRoot = path.resolve(pipelineAssetsDir, "..");
const pipelineSourceDir = path.join(projectRoot, "look-image-utils-feat-look-pipeline");
const workspaceDir = path.join(projectRoot, "pipeline-workspace");
const workspaceProjectDir = path.join(workspaceDir, "look-image-utils-feat-look-pipeline");
const toolsDir = path.join(workspaceDir, "tools");

function getUvExecutableName() {
  return process.platform === "win32" ? "uv.exe" : "uv";
}

function getWorkspacePythonPath() {
  return process.platform === "win32"
    ? path.join(workspaceProjectDir, ".venv", "Scripts", "python.exe")
    : path.join(workspaceProjectDir, ".venv", "bin", "python");
}

function getUvDownloadUrl() {
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

async function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https
      .get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          https.get(res.headers.location, (res2) => {
            res2.pipe(file);
            file.on("finish", () => {
              file.close();
              resolve();
            });
          }).on("error", reject);
          return;
        }
        res.pipe(file);
        file.on("finish", () => {
          file.close();
          resolve();
        });
      })
      .on("error", reject);
  });
}

async function run(cmd, args, opts = {}) {
  console.log(`  > ${cmd} ${args.join(" ")}`);
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      shell: false,
      stdio: "inherit",
      windowsHide: process.platform === "win32",
      ...opts,
    });
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited with code ${code}`));
    });
    proc.on("error", reject);
  });
}

async function extractArchive(archivePath, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  await run("tar", ["-xf", archivePath, "-C", destDir]);
}

async function ensureExecutable(filePath) {
  if (process.platform !== "win32") {
    await fsp.chmod(filePath, 0o755);
  }
}

async function findUvOnPath() {
  const locator = process.platform === "win32" ? "where" : "which";
  const candidates = process.platform === "win32" ? ["uv", "uv.exe", "uv.cmd"] : ["uv"];

  return new Promise((resolve) => {
    const proc = spawn(locator, candidates, {
      shell: true,
      windowsHide: process.platform === "win32",
    });
    let out = "";
    proc.stdout.on("data", (chunk) => {
      out += chunk.toString("utf8");
    });
    proc.on("close", () => {
      const lines = out.trim().split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      resolve(lines[0] || null);
    });
    proc.on("error", () => resolve(null));
  });
}

function copyDirSync(src, dest, ignore = new Set()) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (ignore.has(entry.name)) continue;
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDirSync(srcPath, destPath, ignore);
    else fs.copyFileSync(srcPath, destPath);
  }
}

function findFileSync(dir, name) {
  if (!fs.existsSync(dir)) return null;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
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

async function resolveUvBinary() {
  const pathUv = await findUvOnPath();
  if (pathUv && fs.existsSync(pathUv)) {
    console.log(`  Found uv on PATH: ${pathUv}`);
    return pathUv;
  }

  const bundledUv = path.join(pipelineAssetsDir, getUvExecutableName());
  if (fs.existsSync(bundledUv)) {
    await ensureExecutable(bundledUv);
    console.log(`  Using bundled uv: ${bundledUv}`);
    return bundledUv;
  }

  const localUv = path.join(toolsDir, getUvExecutableName());
  if (fs.existsSync(localUv)) {
    await ensureExecutable(localUv);
    console.log(`  Using cached uv: ${localUv}`);
    return localUv;
  }

  console.log("  Downloading uv...");
  await fsp.mkdir(toolsDir, { recursive: true });
  const downloadUrl = getUvDownloadUrl();
  const archiveName = path.basename(new URL(downloadUrl).pathname);
  const archivePath = path.join(toolsDir, archiveName);
  const extractDir = path.join(toolsDir, "uv-temp-extract");
  await downloadFile(downloadUrl, archivePath);
  await extractArchive(archivePath, extractDir);
  await fsp.rm(archivePath, { force: true });
  const found = findFileSync(extractDir, getUvExecutableName());
  if (!found) {
    throw new Error(`${getUvExecutableName()} not found in downloaded archive`);
  }
  await fsp.copyFile(found, localUv);
  await ensureExecutable(localUv);
  await fsp.rm(extractDir, { recursive: true, force: true });
  console.log(`  uv downloaded: ${localUv}`);
  return localUv;
}

async function main() {
  console.log("=== Pipeline Workspace Setup ===\n");
  console.log(`Platform: ${process.platform} ${process.arch}`);

  await fsp.mkdir(workspaceDir, { recursive: true });
  console.log(`Workspace: ${workspaceDir}`);

  if (!fs.existsSync(pipelineSourceDir)) {
    throw new Error(`Pipeline source directory not found: ${pipelineSourceDir}`);
  }

  console.log("\nCopying Python project...");
  if (fs.existsSync(workspaceProjectDir)) {
    fs.rmSync(workspaceProjectDir, { recursive: true, force: true });
  }
  copyDirSync(
    pipelineSourceDir,
    workspaceProjectDir,
    new Set([".venv", "__pycache__", ".mypy_cache", "node_modules", ".git"]),
  );
  console.log("  Project copied.");

  const uvBinary = await resolveUvBinary();

  console.log("\nCreating virtual environment...");
  await run(uvBinary, ["venv", "--python", "3.12"], { cwd: workspaceProjectDir });
  console.log("  venv created.");

  console.log("\nInstalling dependencies (uv sync)...");
  await run(uvBinary, ["sync"], { cwd: workspaceProjectDir });
  console.log("  dependencies installed.");

  const pythonPath = getWorkspacePythonPath();
  fs.writeFileSync(
    path.join(workspaceDir, ".workspace-ready"),
    JSON.stringify({
      setupAt: new Date().toISOString(),
      uvPath: uvBinary,
      pythonPath,
      platform: process.platform,
      arch: process.arch,
    }) + "\n",
  );

  console.log("\n=== Setup complete ===");
  console.log(`uv: ${uvBinary}`);
  console.log(`python: ${pythonPath}`);
}

main().catch((err) => {
  console.error("Setup failed:", err.message);
  process.exit(1);
});
