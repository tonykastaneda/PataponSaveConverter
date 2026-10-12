param(
    [Parameter(Mandatory = $true)] [ValidateSet('Export', 'Import')] [string]$Mode,
    [Parameter(Mandatory = $true)] [string]$InputPath,
    [Parameter(Mandatory = $true)] [string]$OutputPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# PC Replay save envelope. These constants are unrelated to PSP save encryption.
$key = [Text.Encoding]::ASCII.GetBytes('H2AYuFL!VGW~tQU2')
$iv = [Text.Encoding]::ASCII.GetBytes('Q4TmjuN,9sFcZjkJ')
$utf8 = [Text.UTF8Encoding]::new($false, $true)
$inputFile = [IO.Path]::GetFullPath($InputPath)
$outputFile = [IO.Path]::GetFullPath($OutputPath)
if (-not [IO.File]::Exists($inputFile)) { throw "Input file does not exist: $inputFile" }
if ([string]::Equals($inputFile, $outputFile, [StringComparison]::OrdinalIgnoreCase)) { throw 'Input and output must be different files.' }
if ([IO.File]::Exists($outputFile)) { throw "Output already exists: $outputFile" }

$aes = [Security.Cryptography.Aes]::Create()
try {
    $aes.Key = $key
    $aes.IV = $iv
    $aes.Mode = [Security.Cryptography.CipherMode]::CBC
    $aes.Padding = [Security.Cryptography.PaddingMode]::PKCS7
    if ($Mode -eq 'Export') {
        $ciphertext = [Convert]::FromBase64String([IO.File]::ReadAllText($inputFile).Trim())
        if ($ciphertext.Length -eq 0 -or $ciphertext.Length % 16 -ne 0) { throw 'The PC save payload is not a valid AES block sequence.' }
        $plain = $aes.CreateDecryptor().TransformFinalBlock($ciphertext, 0, $ciphertext.Length)
        $document = [Text.Json.JsonDocument]::Parse($utf8.GetString($plain))
        try {
            if ($document.RootElement.ValueKind -ne [Text.Json.JsonValueKind]::Object) { throw 'The decrypted save is not a JSON object.' }
        } finally { $document.Dispose() }
        [IO.File]::WriteAllBytes($outputFile, $plain)
    } else {
        $plain = [IO.File]::ReadAllBytes($inputFile)
        $document = [Text.Json.JsonDocument]::Parse($utf8.GetString($plain))
        try {
            if ($document.RootElement.ValueKind -ne [Text.Json.JsonValueKind]::Object) { throw 'The JSON input must be an object.' }
        } finally { $document.Dispose() }
        $ciphertext = $aes.CreateEncryptor().TransformFinalBlock($plain, 0, $plain.Length)
        [IO.File]::WriteAllText($outputFile, [Convert]::ToBase64String($ciphertext), [Text.Encoding]::ASCII)
    }
    Write-Output "Wrote $outputFile"
} finally { $aes.Dispose() }
