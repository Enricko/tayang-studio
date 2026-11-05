# Installs Tayang Studio, the latest release, on Windows. In PowerShell:
#
#   irm https://raw.githubusercontent.com/Maru-Yasa/tayang-studio/main/install.ps1 | iex
#
# Options (environment variables, set before running):
#   $env:TAYANG_VERSION = '0.0.2'   install this version instead of the latest
#   $env:TAYANG_NO_LAUNCH = '1'     don't open Tayang when done
#
# It installs for the current user (no admin needed), with Start menu and desktop shortcuts, and
# fetches WebView2 if Windows doesn't have it. Installed copies update themselves.

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue' # Invoke-WebRequest is many times slower with the progress bar.

function Install-Tayang {
  $repo = 'Maru-Yasa/tayang-studio'
  $base = if ($env:TAYANG_DOWNLOAD_BASE) { $env:TAYANG_DOWNLOAD_BASE } else { "https://github.com/$repo/releases" }
  $app = 'Tayang Studio'

  # Windows PowerShell 5.1 may still default to TLS 1.0, which GitHub refuses.
  try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch {}

  if (-not [Environment]::Is64BitOperatingSystem) { throw 'Tayang needs 64-bit Windows.' }
  if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') {
    Write-Host 'This is an ARM PC: Tayang runs as an x64 app through Windows emulation.'
  }

  $version = "$env:TAYANG_VERSION".Trim().TrimStart('v')
  if (-not $version) {
    try { $latest = Invoke-RestMethod -UseBasicParsing -Uri "$base/latest/download/latest.json" }
    catch { throw "Couldn't find the latest release at $base. $_" }
    $version = "$($latest.version)".TrimStart('v')
    if (-not $version) { throw 'The latest release has no version.' }
  }

  # GitHub swaps the space in "Tayang Studio" for a dot in asset names.
  $file = "Tayang.Studio_${version}_x64-setup.exe"
  $tmp = Join-Path ([IO.Path]::GetTempPath()) ("tayang-" + [Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $tmp | Out-Null
  try {
    $setup = Join-Path $tmp $file
    Write-Host "Downloading $app $version for Windows..."
    try { Invoke-WebRequest -UseBasicParsing -Uri "$base/download/v$version/$file" -OutFile $setup }
    catch { throw "Couldn't download $file. $_" }

    Write-Host 'Installing...'
    # /S: the installer's silent mode; it installs for this user and closes a running Tayang first.
    $p = Start-Process -FilePath $setup -ArgumentList '/S' -Wait -PassThru
    if ($p.ExitCode -ne 0) { throw "The installer stopped with code $($p.ExitCode)." }
  }
  finally {
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
  }

  $dir = Join-Path $env:LOCALAPPDATA $app
  $exe = Get-ChildItem -Path $dir -Filter '*.exe' -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -notmatch '^uninstall' } | Select-Object -First 1
  Write-Host "Installed $app $version. Open it from the Start menu."
  if ($exe -and -not $env:TAYANG_NO_LAUNCH) { Start-Process -FilePath $exe.FullName }
}

try { Install-Tayang }
catch {
  Write-Host "Tayang install failed: $_" -ForegroundColor Red
  # A function, not exit: `irm ... | iex` runs in the user's own PowerShell window.
}
