[CmdletBinding()]
param(
    [string]$Root = (Split-Path -Parent $PSScriptRoot),
    [string]$ArchivePath = ""
)

$ErrorActionPreference = "Stop"
$pluginRoot = Join-Path $Root "plugins"
if (-not (Test-Path -LiteralPath (Join-Path $pluginRoot "mod_compressor_tool.py") -PathType Leaf)) {
    # Development checkouts put the plugin files at the supplied root;
    # release archives put them under the MO2-standard plugins directory.
    $pluginRoot = $Root
}

$required = @(
    (Join-Path $pluginRoot "mod_compressor_tool.py"),
    (Join-Path $pluginRoot "native\mod-compressor-helper.exe")
)

# A source checkout includes the lockfile next to the helper source.  A
# release package may carry that source under `source`; runtime files do not
# need a second lockfile inside the MO2 plugin directory.
$lockCandidates = @(
    (Join-Path $Root "native\mod-compressor-helper\Cargo.lock"),
    (Join-Path $Root "source\native\mod-compressor-helper\Cargo.lock"),
    (Join-Path $pluginRoot "native\mod-compressor-helper\Cargo.lock")
)
$lockPath = $lockCandidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
if ($lockPath) {
    $required += $lockPath
}

$missing = @($required | Where-Object { -not (Test-Path -LiteralPath $_ -PathType Leaf) })
if ($missing.Count -gt 0) {
    throw ("Package is incomplete; missing: " + ($missing -join ", "))
}

if ($ArchivePath) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [System.IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $ArchivePath))
    try {
        $entryNames = @()
        foreach ($entry in $archive.Entries) {
            $name = $entry.FullName.Replace("\\", "/")
            $entryNames += $name
            if ($name.StartsWith("/") -or $name -match "^[A-Za-z]:" -or $name -match "(^|/)\.\.(/|$)") {
                throw "Unsafe archive path: $name"
            }
        }
        $expectedPrefix = if ([IO.Path]::GetFileName($pluginRoot) -eq "plugins") { "plugins/" } else { "" }
        $expectedEntries = @(
            ($expectedPrefix + "mod_compressor_tool.py"),
            ($expectedPrefix + "native/mod-compressor-helper.exe")
        )
        foreach ($expected in $expectedEntries) {
            if (-not ($entryNames -contains $expected)) {
                throw "Archive is missing required MO2 plugin entry: $expected"
            }
        }
    } finally {
        $archive.Dispose()
    }
}

Get-FileHash -Algorithm SHA256 -LiteralPath $required[0], $required[1] |
    Select-Object Algorithm, Hash, Path
Write-Output "Package layout and archive path checks passed."
