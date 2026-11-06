# Music Studio folder helper — handles musicstudio-open:<url-encoded absolute folder path> links,
# so the app's 📂 buttons can open File Explorer (a web page can't launch programs itself).
# It only ever opens an EXISTING FOLDER in Explorer: anything else is ignored.
param([string]$Uri)
$ErrorActionPreference = 'Stop'
try {
  if ($Uri -notmatch '^musicstudio-open:') { exit 1 }
  $path = [Uri]::UnescapeDataString(($Uri -replace '^musicstudio-open:(//)?', '')).TrimEnd('/')
  $path = $path -replace '/', '\'
  # Absolute local or UNC path only; must be an existing directory.
  if ($path -notmatch '^([A-Za-z]:\\|\\\\[^\\]+\\)') { exit 1 }
  if (-not (Test-Path -LiteralPath $path -PathType Container)) { exit 1 }
  & explorer.exe (Resolve-Path -LiteralPath $path).ProviderPath
} catch { exit 1 }
