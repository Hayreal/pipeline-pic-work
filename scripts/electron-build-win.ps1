$ErrorActionPreference = "Stop"

$env:ELECTRON_BUILDER_BINARIES_MIRROR = "https://npmmirror.com/mirrors/electron-builder-binaries/"
$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"

function Invoke-ElectronBuilder {
  & "$PSScriptRoot\..\node_modules\.bin\electron-builder.cmd" --win
}

function Repair-NsisCache {
  $cacheRoot = Join-Path $env:LOCALAPPDATA "electron-builder\Cache\nsis"

  if (-not (Test-Path $cacheRoot)) {
    return
  }

  Get-ChildItem $cacheRoot -Filter *.7z | Sort-Object LastWriteTime -Descending | ForEach-Object {
    $archive = $_.FullName
    $targetDir = [System.IO.Path]::Combine($_.DirectoryName, $_.BaseName)

    if (Test-Path $targetDir) {
      Remove-Item -Recurse -Force $targetDir
    }

    New-Item -ItemType Directory -Path $targetDir | Out-Null
    tar -xf $archive -C $targetDir
  }
}

try {
  Invoke-ElectronBuilder
}
catch {
  Write-Host "electron-builder failed once, repairing NSIS cache with bsdtar and retrying..."
  Repair-NsisCache
  Invoke-ElectronBuilder
}
