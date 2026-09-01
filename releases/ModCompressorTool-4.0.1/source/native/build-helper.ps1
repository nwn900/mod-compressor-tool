[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$manifestPath = Join-Path $PSScriptRoot "mod-compressor-helper\Cargo.toml"
$builtPath = Join-Path $PSScriptRoot "mod-compressor-helper\target\release\mod-compressor-helper.exe"
$packagePath = Join-Path $PSScriptRoot "mod-compressor-helper.exe"

$cargoCommand = Get-Command cargo -ErrorAction SilentlyContinue
if (-not $cargoCommand) {
    throw "Rust/Cargo is required. Install the stable Windows Rust toolchain, then rerun this script."
}

& $cargoCommand.Source build --release --locked --manifest-path $manifestPath
if ($LASTEXITCODE -ne 0) {
    throw "Cargo failed with exit code $LASTEXITCODE."
}
if (-not (Test-Path -LiteralPath $builtPath -PathType Leaf)) {
    throw "Cargo reported success but did not produce $builtPath"
}

Copy-Item -LiteralPath $builtPath -Destination $packagePath -Force
$hash = Get-FileHash -Algorithm SHA256 -LiteralPath $packagePath
Write-Output ("Built {0} ({1})" -f $packagePath, $hash.Hash)
