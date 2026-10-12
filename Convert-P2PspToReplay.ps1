param(
    [Parameter(Mandatory = $true)] [string]$PspSaveFolder,
    [Parameter(Mandatory = $true)] [string]$ReplayTemplateSavePath,
    [Parameter(Mandatory = $true)] [string]$OutputSavePath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$toolDir = $PSScriptRoot
$codec = Join-Path $toolDir 'ReplaySave.ps1'
$mapper = Join-Path $toolDir 'make_p2_candidate.py'
$pspTool = Join-Path $toolDir 'psp-save-reference\psp-save.exe'
$pspFolder = [IO.Path]::GetFullPath($PspSaveFolder)
$template = [IO.Path]::GetFullPath($ReplayTemplateSavePath)
$output = [IO.Path]::GetFullPath($OutputSavePath)

if ([IO.File]::Exists($output) -or [IO.Directory]::Exists($output)) {
    throw "Output already exists: $output"
}
if (-not [IO.Directory]::Exists([IO.Path]::GetDirectoryName($output))) {
    throw 'Output parent directory does not exist.'
}
if (-not [IO.File]::Exists((Join-Path $pspFolder 'SECURE.BIN'))) {
    throw 'PSP save folder is missing SECURE.BIN.'
}
if (-not [IO.File]::Exists($template)) { throw "Replay P2 template not found: $template" }
if (-not [IO.File]::Exists($pspTool)) {
    throw "Build psp-save.exe first, following README.md: $pspTool"
}

$prefix = Join-Path ([IO.Path]::GetTempPath()) ('patapon-p2-' + [guid]::NewGuid().ToString('N'))
$keyFile = "$prefix.key"
$pspPlain = "$prefix.psp.bin"
$templateJson = "$prefix.template.json"
$candidateJson = "$prefix.candidate.json"
$candidateSave = "$prefix.candidate.sav"
$roundtripJson = "$prefix.roundtrip.json"
$tempFiles = @($keyFile, $pspPlain, $templateJson, $candidateJson,
    $candidateSave, $roundtripJson)

try {
    [IO.File]::WriteAllBytes($keyFile, [Convert]::FromHexString('AF9F013D31FBD15B62ED4A53EAFBC49A'))
    & $pspTool -d $keyFile 5 (Join-Path $pspFolder 'SECURE.BIN') $pspPlain
    if ($LASTEXITCODE -ne 0) { throw 'PSP save decryption failed.' }
    & $codec -Mode Export -InputPath $template -OutputPath $templateJson
    & python $mapper $pspPlain $templateJson $candidateJson
    if ($LASTEXITCODE -ne 0) { throw 'Patapon 2 field mapping failed.' }
    & $codec -Mode Import -InputPath $candidateJson -OutputPath $candidateSave
    & $codec -Mode Export -InputPath $candidateSave -OutputPath $roundtripJson
    $jsonHash = (Get-FileHash -LiteralPath $candidateJson -Algorithm SHA256).Hash
    $roundtripHash = (Get-FileHash -LiteralPath $roundtripJson -Algorithm SHA256).Hash
    if ($jsonHash -ne $roundtripHash) { throw 'Replay save did not decrypt to identical JSON.' }
    Copy-Item -LiteralPath $candidateSave -Destination $output
    Write-Output "Created Patapon 2 Replay save: $output"
    Write-Output 'Mapped units, inventory, base values, talk buffers, and strings.'
    Write-Output 'The conversion retains unmapped fields from the Replay template.'
} finally {
    foreach ($file in $tempFiles) {
        if ([IO.File]::Exists($file)) { Remove-Item -LiteralPath $file -Force }
    }
}
