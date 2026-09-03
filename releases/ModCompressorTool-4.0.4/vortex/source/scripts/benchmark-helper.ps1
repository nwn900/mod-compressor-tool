param(
  [int]$Files = 500,
  [int]$KiBPerFile = 512,
  [string[]]$Algorithms = @('xpress4k', 'xpress8k', 'xpress16k', 'lzx')
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$helper = Join-Path $root 'native\mod-compressor-helper.exe'
if (-not (Test-Path -LiteralPath $helper -PathType Leaf)) {
  throw "Helper not found. Run npm run build:helper first: $helper"
}

function Escape-JsonPath([string]$Path) {
  return $Path -replace '\\', '\\'
}

function Invoke-HelperJson([string]$Payload) {
  return ($Payload | & $helper) | ConvertFrom-Json
}

$benchRoot = Join-Path $env:TEMP ('mod-compressor-helper-bench-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $benchRoot | Out-Null

try {
  $rows = @()
  foreach ($algo in $Algorithms) {
    $native = Join-Path $benchRoot "native-$algo"
    $compact = Join-Path $benchRoot "compact-$algo"
    New-Item -ItemType Directory -Force -Path $native, $compact | Out-Null

    $bytes = New-Object byte[] ($KiBPerFile * 1024)
    for ($i = 0; $i -lt $Files; $i++) {
      [System.IO.File]::WriteAllBytes((Join-Path $native "file$i.dds"), $bytes)
      [System.IO.File]::WriteAllBytes((Join-Path $compact "file$i.dds"), $bytes)
    }

    $nativePath = Escape-JsonPath $native
    $nativeCompress = Measure-Command {
      Invoke-HelperJson "{`"command`":`"compress`",`"algorithm`":`"$algo`",`"threads`":0,`"paths`":[`"$nativePath`"]}" | Out-Null
    }
    $compactCompress = Measure-Command {
      & compact.exe /c /i /q "/exe:$algo" "/s:$compact" | Out-Null
    }
    $nativeMeasure = Invoke-HelperJson "{`"command`":`"measure`",`"paths`":[`"$nativePath`"]}"
    $nativeDecompress = Measure-Command {
      Invoke-HelperJson "{`"command`":`"decompress`",`"threads`":0,`"paths`":[`"$nativePath`"]}" | Out-Null
    }
    $compactDecompress = Measure-Command {
      foreach ($candidate in @('xpress4k', 'xpress8k', 'xpress16k', 'lzx')) {
        & compact.exe /u /i "/exe:$candidate" "/s:$compact" | Out-Null
      }
      & compact.exe /u /i /q "/s:$compact" | Out-Null
    }

    $rows += [pscustomobject]@{
      Algorithm = $algo
      Files = $Files
      MiB = [math]::Round(($Files * $KiBPerFile) / 1024, 2)
      NativeCompressSec = [math]::Round($nativeCompress.TotalSeconds, 3)
      CompactCompressSec = [math]::Round($compactCompress.TotalSeconds, 3)
      CompressSpeedup = [math]::Round($compactCompress.TotalSeconds / [math]::Max($nativeCompress.TotalSeconds, 0.001), 2)
      NativeDecompressSec = [math]::Round($nativeDecompress.TotalSeconds, 3)
      OldFivePassDecompressSec = [math]::Round($compactDecompress.TotalSeconds, 3)
      DecompressSpeedup = [math]::Round($compactDecompress.TotalSeconds / [math]::Max($nativeDecompress.TotalSeconds, 0.001), 2)
      MeasuredAlgorithm = $nativeMeasure.stats.algorithm
      MeasuredRatio = [math]::Round([double]$nativeMeasure.stats.ratio, 2)
    }
  }

  $rows | Format-Table -AutoSize | Out-String -Width 240
} finally {
  Remove-Item -LiteralPath $benchRoot -Recurse -Force -ErrorAction SilentlyContinue
}
