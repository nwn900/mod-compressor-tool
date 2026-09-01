[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$manifestPath = Join-Path $PSScriptRoot "mod-compressor-helper\Cargo.toml"
$builtPath = Join-Path $PSScriptRoot "mod-compressor-helper\target\release\mod-compressor-helper.exe"
$packagePath = Join-Path $PSScriptRoot "mod-compressor-helper.exe"

$cargoCommand = Get-Command cargo -ErrorAction SilentlyContinue
$cargoPath = if ($cargoCommand) {
    $cargoCommand.Source
}
else {
    $userCargo = Join-Path $env:USERPROFILE ".cargo\bin\cargo.exe"
    if (Test-Path -LiteralPath $userCargo -PathType Leaf) {
        $userCargo
    }
}
if (-not $cargoPath) {
    throw "Rust/Cargo is required. Install the stable Windows Rust toolchain, then rerun this script."
}

# The helper embeds a small VERSIONINFO resource.  Keep the build reproducible
# on machines where the Windows SDK resource compiler is installed but is not
# on PATH; callers can still override it with RC=... when needed.
$rcPath = $env:RC
if ($rcPath) {
    if (-not (Test-Path -LiteralPath $rcPath -PathType Leaf)) {
        throw "RC points to a missing Windows resource compiler: $rcPath"
    }
}
else {
    $rcCommand = Get-Command rc.exe -ErrorAction SilentlyContinue
    if ($rcCommand) {
        $rcPath = $rcCommand.Source
    }
    else {
        $kitsRoot = Join-Path ${env:ProgramFiles(x86)} "Windows Kits\10\bin"
        $rcPath = Get-ChildItem -LiteralPath $kitsRoot -Directory -ErrorAction SilentlyContinue |
            Sort-Object Name -Descending |
            ForEach-Object {
                $candidate = Join-Path $_.FullName "x64\rc.exe"
                if (Test-Path -LiteralPath $candidate -PathType Leaf) {
                    $candidate
                }
            } |
            Select-Object -First 1
    }
    if (-not $rcPath) {
        throw "Windows SDK rc.exe is required to embed version metadata. Install the Windows SDK or set RC to rc.exe."
    }
    $env:RC = $rcPath
}

& $cargoPath build --release --locked --manifest-path $manifestPath
if ($LASTEXITCODE -ne 0) {
    throw "Cargo failed with exit code $LASTEXITCODE."
}
if (-not (Test-Path -LiteralPath $builtPath -PathType Leaf)) {
    throw "Cargo reported success but did not produce $builtPath"
}

Copy-Item -LiteralPath $builtPath -Destination $packagePath -Force
$hash = Get-FileHash -Algorithm SHA256 -LiteralPath $packagePath
Write-Output ("Built {0} ({1})" -f $packagePath, $hash.Hash)
