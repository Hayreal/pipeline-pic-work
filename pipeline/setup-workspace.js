#!/usr/bin/env node
/**
 * Setup pipeline workspace: downloads uv, copies Python project, creates venv.
 *
 * Usage:
 *   node pipeline/setup-workspace.js
 */

const fs = require("fs");
const path = require("path");
const https = require("https");
const { spawn } = require("child_process");

const pipelineDir = path.resolve(__dirname);
const uvExe = path.join(pipelineDir, "uv.exe");
const workspaceDir = path.resolve(pipelineDir, "..", "pipeline-workspace");
const workspaceProjectDir = path.join(workspaceDir, "look-image-utils-feat-look-pipeline");

const UV_DOWNLOAD_URL =
  "https://github.com/astral-sh/uv/releases/download/0.8.9/uv-x86_64-pc-windows-msvc.zip";

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

async function extractZip(zipPath, destDir) {
  // Use built-in PowerShell Expand-Archive (no npm dependency needed)
  const { execSync } = require("child_process");
  fs.mkdirSync(destDir, { recursive: true });
  execSync(
    `powershell -Command "Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${destDir}' -Force"`,
  );
}

async function run(cmd, args, opts) {
  console.log(`  > ${cmd} ${args.join(" ")}`);
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { shell: true, stdio: "inherit", ...opts });
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited with code ${code}`));
    });
    proc.on("error", reject);
  });
}

async function main() {
  console.log("=== Pipeline Workspace Setup ===\n");

  // 1. Create workspace directory
  fs.mkdirSync(workspaceDir, { recursive: true });
  console.log(`Workspace: ${workspaceDir}`);

  // 2. Copy Python project to workspace
  console.log("\nCopying Python project...");
  const srcProject = pipelineDir;
  const destProject = workspaceProjectDir;
  if (fs.existsSync(destProject)) {
    fs.rmSync(destProject, { recursive: true, force: true });
  }
  copyDirSync(srcProject, destProject, [".venv", "__pycache__", ".mypy_cache", "node_modules"]);
  console.log("  Project copied.");

  // 3. Download uv if not present in pipeline dir
  if (!fs.existsSync(uvExe)) {
    console.log("\nDownloading uv...");
    const zipPath = path.join(pipelineDir, "uv-temp.zip");
    await downloadFile(UV_DOWNLOAD_URL, zipPath);
    const extractDir = path.join(pipelineDir, "uv-temp");
    await extractZip(zipPath, extractDir);
    fs.rmSync(zipPath);
    // Find uv.exe in the extracted directory
    const files = findFiles(extractDir, "uv.exe");
    if (files.length === 0) throw new Error("uv.exe not found in downloaded zip");
    fs.copyFileSync(files[0], uvExe);
    fs.rmSync(extractDir, { recursive: true, force: true });
    console.log("  uv downloaded.");
  } else {
    console.log("\nuv already exists.");
  }

  // 4. Create venv in workspace
  console.log("\nCreating virtual environment...");
  await run(uvExe, ["venv", "--python", "3.12"], { cwd: workspaceDir });
  console.log("  venv created.");

  // 5. Sync dependencies
  console.log("\nInstalling dependencies (uv sync)...");
  await run(uvExe, ["sync"], { cwd: workspaceProjectDir });
  console.log("  dependencies installed.");

  // 6. Write workspace marker for the Electron app to detect
  fs.writeFileSync(
    path.join(workspaceDir, ".workspace-ready"),
    JSON.stringify({ setupAt: new Date().toISOString(), uvPath: uvExe }) + "\n",
  );

  console.log("\n=== Setup complete! ===");
  console.log(`Workspace: ${workspaceDir}`);
  console.log(`uv: ${uvExe}`);
}

function copyDirSync(src, dest, ignore = []) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (ignore.includes(entry.name)) continue;
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath, ignore);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function findFiles(dir, name) {
  let results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) results = results.concat(findFiles(fullPath, name));
    else if (entry.name === name) results.push(fullPath);
  }
  return results;
}

main().catch((err) => {
  console.error("Setup failed:", err.message);
  process.exit(1);
});
