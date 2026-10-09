# Builds Telnyx Edge for Windows into dist\:
#   TelnyxEdge-<version>-win-<arch>-Setup.exe   per-user installer (no admin needed)
#   TelnyxEdge-<version>-win-<arch>.zip         portable folder
# The app is self-contained: it bundles .NET and Node.js, so the PC needs nothing
# installed (WebView2 comes with Windows 11).
#
#   pwsh windows/build.ps1 -Arch x64
#   pwsh windows/build.ps1 -Arch arm64 -NodeVersion v24.21.0
#   pwsh windows/build.ps1 -Arch x64 -SmokeTest     also start the built app's server and check it
param(
  [ValidateSet('x64', 'arm64')] [string] $Arch = 'x64',
  [string] $NodeVersion = 'v24.21.0',
  [switch] $SmokeTest
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$root = Split-Path $PSScriptRoot -Parent
$version = (Get-Content "$root\package.json" -Raw | ConvertFrom-Json).version
$dist = Join-Path $root 'dist'
$work = Join-Path $dist ".build-win-$Arch"
$cache = Join-Path $dist '.cache'
$app = Join-Path $work 'Telnyx Edge'
$name = "TelnyxEdge-$version-win-$Arch"

Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $app, $cache, "$app\node", "$app\server" | Out-Null

Write-Host "* app ($Arch)"
dotnet publish "$PSScriptRoot\TelnyxEdge.csproj" -c Release -r "win-$Arch" -o "$work\publish" -p:Version=$version -p:DebugType=none -nologo
if ($LASTEXITCODE) { throw 'dotnet publish failed' }
Copy-Item "$work\publish\TelnyxEdge.exe" $app

Write-Host "* Node.js $NodeVersion"
$nodeName = "node-$NodeVersion-win-$Arch"
$zip = Join-Path $cache "$nodeName.zip"
$sums = Join-Path $cache "SHASUMS256-$NodeVersion.txt"
Invoke-WebRequest "https://nodejs.org/dist/$NodeVersion/SHASUMS256.txt" -OutFile $sums
if (-not (Test-Path $zip)) { Invoke-WebRequest "https://nodejs.org/dist/$NodeVersion/$nodeName.zip" -OutFile $zip }
# Verify the download against the release's published checksums.
$expected = (Select-String -Path $sums -Pattern " $nodeName\.zip$").Line.Split(' ')[0]
$actual = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
if ($expected -ne $actual) { Remove-Item $zip; throw "Checksum mismatch for $nodeName.zip" }
Expand-Archive $zip -DestinationPath $work -Force
Copy-Item "$work\$nodeName\node.exe", "$work\$nodeName\LICENSE" "$app\node\"

Write-Host '* server files'
Copy-Item "$root\server.js", "$root\package.json" "$app\server\"
Copy-Item "$root\lib", "$root\public" "$app\server\" -Recurse

New-Item -ItemType Directory -Force $dist | Out-Null
Write-Host '* portable zip'
Remove-Item "$dist\$name.zip" -ErrorAction SilentlyContinue
Compress-Archive -Path $app -DestinationPath "$dist\$name.zip"

Write-Host '* installer'
$iscc = @(
  (Get-Command iscc -ErrorAction SilentlyContinue)?.Source,
  "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
  "$env:ProgramFiles\Inno Setup 6\ISCC.exe",
  "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe"
) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if ($iscc) {
  & $iscc /Q "/DAppVersion=$version" "/DArch=$Arch" "/DSourceDir=$app" "/DOutputDir=$dist" "/DOutputName=$name-Setup" "$PSScriptRoot\installer.iss"
  if ($LASTEXITCODE) { throw 'Inno Setup failed' }
} else {
  Write-Warning 'Inno Setup 6 not found (winget install JRSoftware.InnoSetup); skipping the installer.'
}

if ($SmokeTest) {
  Write-Host '* smoke test'
  $data = Join-Path $work 'smoke-data'
  $env:EDGE_CP_DATA_DIR = $data
  $env:EDGE_CP_CREDENTIAL_PREFIX = 'TelnyxEdgeSmokeTest'
  $p = Start-Process "$app\TelnyxEdge.exe" -ArgumentList '--smoke-test' -Wait -PassThru
  Remove-Item Env:EDGE_CP_DATA_DIR, Env:EDGE_CP_CREDENTIAL_PREFIX
  Get-Content "$data\logs\app.log"
  if ($p.ExitCode -ne 0) { throw "Smoke test failed (exit code $($p.ExitCode))" }
}

Write-Host "Built $dist\$name.zip"
if ($iscc) { Write-Host "Built $dist\$name-Setup.exe" }
