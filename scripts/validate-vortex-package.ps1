[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$PackageRoot,
    [string]$ArchivePath = ""
)

$ErrorActionPreference = "Stop"
$root = (Resolve-Path -LiteralPath $PackageRoot).Path

$required = @(
    "info.json",
    "index.js",
    "gameart.png",
    "native\mod-compressor-helper.exe",
    "README.md",
    "CHANGELOG.md",
    "LICENSE-GPL-3.0.txt"
)

$missing = @(
    $required |
        ForEach-Object { Join-Path $root $_ } |
        Where-Object { -not (Test-Path -LiteralPath $_ -PathType Leaf) }
)
if ($missing.Count -gt 0) {
    throw ("Vortex package is incomplete; missing: " + ($missing -join ", "))
}

$forbidden = @("source", "plugins", ".git", "node_modules")
foreach ($name in $forbidden) {
    $path = Join-Path $root $name
    if (Test-Path -LiteralPath $path) {
        throw "Vortex runtime package contains forbidden path: $name"
    }
}

$infoPath = Join-Path $root "info.json"
$info = Get-Content -Raw -LiteralPath $infoPath | ConvertFrom-Json
if ([string]::IsNullOrWhiteSpace([string]$info.name) -or
    [string]::IsNullOrWhiteSpace([string]$info.author) -or
    [string]::IsNullOrWhiteSpace([string]$info.version) -or
    [string]::IsNullOrWhiteSpace([string]$info.description)) {
    throw "info.json must contain name, author, version, and description"
}
if ([string]$info.version -notmatch "^\d+\.\d+\.\d+$") {
    throw "info.json version is not a stable SemVer value: $($info.version)"
}

$gameArtPath = Join-Path $root "gameart.png"
Add-Type -AssemblyName System.Drawing
$gameArt = [System.Drawing.Image]::FromFile($gameArtPath)
try {
    if ($gameArt.Width -ne 640 -or $gameArt.Height -ne 360) {
        throw "gameart.png must be exactly 640x360 pixels; found $($gameArt.Width)x$($gameArt.Height)"
    }
    if ($gameArt.RawFormat.Guid -ne [System.Drawing.Imaging.ImageFormat]::Png.Guid) {
        throw "gameart.png must be a PNG image"
    }
} finally {
    $gameArt.Dispose()
}
if ((Get-Item -LiteralPath $gameArtPath).Length -ge 1MB) {
    throw "gameart.png must be smaller than 1 MB"
}

$indexText = Get-Content -Raw -LiteralPath (Join-Path $root "index.js")
$nativeHelperPattern = 'native["'']\s*,\s*["'']mod-compressor-helper\.exe'
if ($indexText -notmatch "module\.exports" -or
    $indexText -notmatch "vortex-api" -or
    ($indexText -notmatch "native[\\/]mod-compressor-helper\.exe" -and
     $indexText -notmatch $nativeHelperPattern)) {
    throw "index.js does not look like the bundled Vortex entry point"
}

if ($ArchivePath) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archivePathResolved = (Resolve-Path -LiteralPath $ArchivePath).Path
    $archive = [System.IO.Compression.ZipFile]::OpenRead($archivePathResolved)
    try {
        $entries = @($archive.Entries | ForEach-Object { $_.FullName.Replace("\", "/") })
        foreach ($name in $entries) {
            if ($name.StartsWith("/") -or $name -match "^[A-Za-z]:" -or
                $name -match "(^|/)\.\.(/|$)") {
                throw "Unsafe archive path: $name"
            }
            if ($name -match "(^|/)(source|plugins|node_modules|\.git)(/|$)") {
                throw "Archive contains a development or MO2 path: $name"
            }
            if ($name -match "\.(zip|7z|rar)$") {
                throw "Archive contains a nested archive: $name"
            }
        }

        foreach ($name in $required) {
            $entry = $name.Replace("\", "/")
            if (-not ($entries -contains $entry)) {
                throw "Archive is missing required Vortex entry: $entry"
            }
        }

        $topLevel = @(
            $entries |
                Where-Object { $_ -and -not $_.EndsWith("/") } |
                ForEach-Object { ($_ -split "/")[0] } |
                Sort-Object -Unique
        )
        foreach ($name in $topLevel) {
            if ($name -in @("source", "plugins", "node_modules", ".git")) {
                throw "Archive has an unexpected top-level directory: $name"
            }
        }
    } finally {
        $archive.Dispose()
    }
}

Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $root "index.js"), (Join-Path $root "native\mod-compressor-helper.exe") |
    Select-Object Algorithm, Hash, Path
Write-Output "Vortex package layout, metadata, and archive checks passed."
