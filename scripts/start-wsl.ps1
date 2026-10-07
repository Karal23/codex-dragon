param([string]$DataDir = (Join-Path $env:LOCALAPPDATA 'CodexDragon\data'))
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$electron = Join-Path $root 'desktop-runtime\windows\electron\electron.exe'
if (!(Test-Path -LiteralPath $electron)) { throw 'Windows runtime is missing. Run npm run build:windows in WSL first.' }
if (!(Test-Path -LiteralPath $DataDir)) { New-Item -ItemType Directory -Path $DataDir -Force | Out-Null }
$entry = Join-Path $root 'desktop\main.cjs'
# The collector is included in the installed app and runs through wsl.exe.
Start-Process -FilePath $electron -ArgumentList @(('"' + $entry + '"'), '--wsl', ('"--whale-data=' + $DataDir + '"')) -WorkingDirectory $root | Out-Null
