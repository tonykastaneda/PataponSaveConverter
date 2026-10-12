param(
    [Parameter(Mandatory = $true)] [string]$ReplaySavePath,
    [Parameter(Mandatory = $true)] [string]$PspTemplateFolder,
    [Parameter(Mandatory = $true)] [string]$OutputFolder
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$toolDir = $PSScriptRoot
$codec = Join-Path $toolDir 'ReplaySave.ps1'
$mapper = Join-Path $toolDir 'make_p1_psp_candidate.py'
$pspTool = Join-Path $toolDir 'psp-save-reference\psp-save.exe'
$replay = [IO.Path]::GetFullPath($ReplaySavePath)
$template = [IO.Path]::GetFullPath($PspTemplateFolder)
$output = [IO.Path]::GetFullPath($OutputFolder)
$slot = [IO.Path]::GetFileName($output.TrimEnd('\', '/'))

if ($slot -notmatch '^UCUS98711_DATA[0-9][0-9]$') {
    throw 'Output folder must be a USA Patapon 1 slot such as UCUS98711_DATA02.'
}
if ([IO.Directory]::Exists($output) -or [IO.File]::Exists($output)) {
    throw "Output already exists: $output"
}
if (-not [IO.File]::Exists($replay)) { throw "Replay save not found: $replay" }
foreach ($name in @('SECURE.BIN', 'PARAM.SFO', 'ICON0.PNG')) {
    if (-not [IO.File]::Exists((Join-Path $template $name))) {
        throw "PSP template is missing $name"
    }
}
if (-not [IO.File]::Exists($pspTool)) {
    throw "Build psp-save.exe first, following README.md: $pspTool"
}

$prefix = Join-Path ([IO.Path]::GetTempPath()) ('patapon-p1-' + [guid]::NewGuid().ToString('N'))
$keyFile = "$prefix.key"
$replayJson = "$prefix.replay.json"
$pspPlain = "$prefix.psp.bin"
$candidatePlain = "$prefix.candidate.bin"
$candidateSecure = "$prefix.SECURE.BIN"
$candidateSfoInput = "$prefix.input.PARAM.SFO"
$candidateSfo = "$prefix.PARAM.SFO"
$roundtrip = "$prefix.roundtrip.bin"
$tempFiles = @($keyFile, $replayJson, $pspPlain, $candidatePlain,
    $candidateSecure, $candidateSfoInput, $candidateSfo, $roundtrip)

try {
    [IO.File]::WriteAllBytes($keyFile, [Convert]::FromHexString('01AF6F00020070D52E2412C7E1FF83BA'))
    & $codec -Mode Export -InputPath $replay -OutputPath $replayJson
    & $pspTool -d $keyFile 5 (Join-Path $template 'SECURE.BIN') $pspPlain
    if ($LASTEXITCODE -ne 0) { throw 'PSP template decryption failed.' }
    & python $mapper $pspPlain $replayJson $candidatePlain
    if ($LASTEXITCODE -ne 0) { throw 'Patapon 1 field mapping failed.' }

    $sfoBytes = [IO.File]::ReadAllBytes((Join-Path $template 'PARAM.SFO'))
    $sfoText = [Text.Encoding]::Latin1.GetString($sfoBytes)
    $oldSlot = [IO.Path]::GetFileName($template.TrimEnd('\', '/'))
    if ($oldSlot -notmatch '^UCUS98711_DATA[0-9][0-9]$') {
        throw 'PSP template folder is not a USA Patapon 1 save slot.'
    }
    if ($sfoText.Split([string[]]@($oldSlot), [StringSplitOptions]::None).Count -ne 2) {
        throw 'Could not uniquely locate PSP save directory in PARAM.SFO.'
    }
    $sfoText = $sfoText.Replace($oldSlot, $slot)
    [IO.File]::WriteAllBytes($candidateSfoInput, [Text.Encoding]::Latin1.GetBytes($sfoText))

    & $pspTool -e $keyFile 5 $candidatePlain $candidateSecure SECURE.BIN $candidateSfoInput $candidateSfo
    if ($LASTEXITCODE -ne 0) { throw 'PSP candidate encryption failed.' }
    & $pspTool -d $keyFile 5 $candidateSecure $roundtrip
    if ($LASTEXITCODE -ne 0) { throw 'PSP candidate roundtrip failed.' }
    $plainHash = (Get-FileHash -LiteralPath $candidatePlain -Algorithm SHA256).Hash
    $roundtripHash = (Get-FileHash -LiteralPath $roundtrip -Algorithm SHA256).Hash
    if ($plainHash -ne $roundtripHash) { throw 'Encrypted PSP save did not decrypt to identical data.' }

    [IO.Directory]::CreateDirectory($output) | Out-Null
    Copy-Item -LiteralPath (Join-Path $template 'ICON0.PNG') -Destination (Join-Path $output 'ICON0.PNG')
    Copy-Item -LiteralPath $candidateSecure -Destination (Join-Path $output 'SECURE.BIN')
    Copy-Item -LiteralPath $candidateSfo -Destination (Join-Path $output 'PARAM.SFO')
    Write-Output "Created Patapon 1 PSP save: $output"
    Write-Output 'Mapped units, inventory, base values, talk buffers, and strings.'
    Write-Output 'The conversion retains unmapped fields from the PSP template.'
} finally {
    foreach ($file in $tempFiles) {
        if ([IO.File]::Exists($file)) { Remove-Item -LiteralPath $file -Force }
    }
}
