const { spawn } = require("node:child_process");
const path = require("node:path");

const env = {
  ...process.env,
  ELECTRON_BUILDER_BINARIES_MIRROR:
    process.env.ELECTRON_BUILDER_BINARIES_MIRROR ||
    "https://npmmirror.com/mirrors/electron-builder-binaries/",
  ELECTRON_MIRROR:
    process.env.ELECTRON_MIRROR ||
    "https://npmmirror.com/mirrors/electron/",
};

const builderBin =
  process.platform === "win32"
    ? path.join(__dirname, "..", "node_modules", ".bin", "electron-builder.cmd")
    : path.join(__dirname, "..", "node_modules", ".bin", "electron-builder");

const child = spawn(builderBin, ["--mac"], {
  stdio: "inherit",
  env,
  shell: process.platform === "win32",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});

child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});
