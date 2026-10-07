param(
  [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'CodexDragon'),
  [string]$DataDir = '', [string]$SourceRoot = (Split-Path $PSScriptRoot -Parent),
  [string]$Archive = '', [string]$Sha256 = '', [string]$ExpectedVersion = '',
  [int]$ParentPid = 0, [string]$ReadyFile = '', [switch]$NoStart, [switch]$NoShortcut
)
$ErrorActionPreference = 'Stop'
if (!$DataDir) { $DataDir = Join-Path $InstallRoot 'data' }
$appDir = Join-Path $InstallRoot 'app'
$previous = Join-Path $InstallRoot 'previous'
$stage = Join-Path $InstallRoot ('stage-' + [Guid]::NewGuid().ToString('N'))
$marker = Join-Path $InstallRoot 'dragon-installation.json'
$movedOld = $false; $activated = $false
New-Item -ItemType Directory -Path $InstallRoot -Force | Out-Null
function Read-Json([string]$File) { Get-Content -LiteralPath $File -Raw -Encoding UTF8 | ConvertFrom-Json }
function Request-Dragon([string]$Directory, [string]$Route, [string]$Method = 'GET') {
  $file = Join-Path $Directory 'runtime.json'
  if (!(Test-Path -LiteralPath $file)) { return $null }
  $info = Read-Json $file
  $pipe = New-Object System.IO.Pipes.NamedPipeClientStream('.', $info.pipe.Substring('\\.\pipe\'.Length), [System.IO.Pipes.PipeDirection]::InOut)
  try {
    $pipe.Connect(1500)
    $writer = New-Object System.IO.StreamWriter($pipe, (New-Object System.Text.UTF8Encoding($false)))
    $writer.AutoFlush = $true
    $reader = New-Object System.IO.StreamReader($pipe)
    $writer.WriteLine((@{token=$info.token;route=$Route;method=$Method} | ConvertTo-Json -Compress))
    $read = $reader.ReadLineAsync()
    if (!$read.Wait(5000)) { throw 'Dragon did not answer.' }
    return ($read.Result | ConvertFrom-Json).payload
  } finally { $pipe.Dispose() }
}
function Stop-Dragon([string]$Directory) {
  $file = Join-Path $Directory 'runtime.json'
  if (!(Test-Path -LiteralPath $file)) { return }
  $info = Read-Json $file
  $running = Get-Process -Id $info.pid -ErrorAction SilentlyContinue
  if (!$running) { return }
  Request-Dragon $Directory '/api/stop' 'POST' | Out-Null
  if (!$running.WaitForExit(12000)) { throw 'Dragon is still running; close it and retry.' }
}
function Start-Dragon {
  $exe = Join-Path $appDir 'desktop-runtime\windows\electron\electron.exe'
  $entry = Join-Path $appDir 'desktop\main.cjs'
  Start-Process -FilePath $exe -ArgumentList @(('"' + $entry + '"'), '--wsl', ('"--whale-data=' + $DataDir + '"')) -WorkingDirectory $appDir | Out-Null
}
try {
  if ((Test-Path -LiteralPath $appDir) -and !(Test-Path -LiteralPath $marker)) { throw 'Destination is not a managed Dragon installation.' }
  if ((Test-Path -LiteralPath $marker) -and (Read-Json $marker).id -ne 'codex-dragon') { throw 'Invalid installation identity.' }
  $previousMarker = if (Test-Path -LiteralPath $marker) { Read-Json $marker } else { $null }
  if ((Test-Path -LiteralPath $marker) -and (Read-Json $marker).shortcut -eq $false) { $NoShortcut = $true }
  New-Item -ItemType Directory -Path $stage | Out-Null
  if ($Archive) {
    if (!$Sha256 -or (Get-FileHash -LiteralPath $Archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Sha256.ToLowerInvariant()) { throw 'Update archive checksum mismatch.' }
    # Validate every ZIP entry before extraction; packages contain regular files only.
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [IO.Compression.ZipFile]::OpenRead($Archive)
    try { foreach ($entry in $zip.Entries) {
      $destination = [IO.Path]::GetFullPath((Join-Path $stage $entry.FullName))
      if (!$destination.StartsWith($stage + '\', [StringComparison]::OrdinalIgnoreCase) -or $entry.FullName.Contains(':')) { throw 'Invalid package path.' }
    } } finally { $zip.Dispose() }
    Expand-Archive -LiteralPath $Archive -DestinationPath $stage
  } else {
    Get-ChildItem -LiteralPath $SourceRoot -Force | Copy-Item -Destination $stage -Recurse -Force
  }
  $product = Read-Json (Join-Path $stage 'dragon.json')
  if ($product.id -ne 'codex-dragon' -or $product.version -notmatch '^\d+\.\d+\.\d+$' -or ($ExpectedVersion -and $product.version -ne $ExpectedVersion)) { throw 'Invalid Dragon package version.' }
  foreach ($file in @('desktop\main.cjs', 'runtime\wsl-agent.mjs', 'desktop-runtime\windows\electron\electron.exe', 'assets\codex-dragon.png')) {
    if (!(Test-Path -LiteralPath (Join-Path $stage $file))) { throw "Package is incomplete: $file" }
  }
  if ($ReadyFile) { @{ready=$true;pid=$PID} | ConvertTo-Json | Set-Content -LiteralPath $ReadyFile -Encoding UTF8 }
  if ($ParentPid) {
    $parent = Get-Process -Id $ParentPid -ErrorAction SilentlyContinue
    if ($parent -and !$parent.WaitForExit(20000)) { throw 'Dragon did not exit for the update.' }
  } else { Stop-Dragon $DataDir }
  $legacyData = Join-Path $env:LOCALAPPDATA 'CodexWslWhale\data'
  if (!(Test-Path -LiteralPath $DataDir) -and (Test-Path -LiteralPath $legacyData) -and $InstallRoot -eq (Join-Path $env:LOCALAPPDATA 'CodexDragon')) {
    Stop-Dragon $legacyData
    Copy-Item -LiteralPath $legacyData -Destination $DataDir -Recurse
    foreach ($name in @('runtime.json', 'service.lock')) { Remove-Item -LiteralPath (Join-Path $DataDir $name) -Force -ErrorAction SilentlyContinue }
  }
  New-Item -ItemType Directory -Path $DataDir -Force | Out-Null
  if (Test-Path -LiteralPath $previous) { Remove-Item -LiteralPath $previous -Recurse -Force }
  if (Test-Path -LiteralPath $appDir) { Move-Item -LiteralPath $appDir -Destination $previous; $movedOld = $true }
  Move-Item -LiteralPath $stage -Destination $appDir; $activated = $true
  # The WSL helper is part of the installed package, independent of the source checkout.
  $connectionFile = Join-Path $DataDir 'wsl-connection.json'
  if (Test-Path -LiteralPath $connectionFile) {
    $connection = Read-Json $connectionFile
    $agentPath = & wsl.exe --distribution $connection.distribution --user $connection.user --exec wslpath -u (Join-Path $appDir 'runtime\wsl-agent.mjs')
    if ($LASTEXITCODE -eq 0 -and $agentPath) { $connection.agentPath = ($agentPath | Select-Object -Last 1).Trim(); $connection | ConvertTo-Json | Set-Content -LiteralPath $connectionFile -Encoding UTF8 }
  }
  @{id='codex-dragon';version=$product.version;installedAt=(Get-Date).ToString('o');shortcut=(!$NoShortcut)} | ConvertTo-Json | Set-Content -LiteralPath $marker -Encoding UTF8
  New-Item -ItemType Directory -Path (Join-Path $InstallRoot 'updates') -Force | Out-Null
  if (!$NoShortcut) {
    $desktop = [Environment]::GetFolderPath('Desktop')
    $wsh = New-Object -ComObject WScript.Shell
    $shortcut = $wsh.CreateShortcut((Join-Path $desktop 'Codex 龙娘.lnk'))
    $shortcut.TargetPath = Join-Path $appDir 'Start-Dragon.cmd'; $shortcut.WorkingDirectory = $appDir; $shortcut.WindowStyle = 7
    $shortcut.Description = 'Codex 龙娘 · WSL 桌面伙伴'; $shortcut.IconLocation = (Join-Path $appDir 'desktop-runtime\windows\electron\electron.exe') + ',0'; $shortcut.Save()
    $oldLink = Join-Path $desktop 'Codex WSL 小鲸鱼.lnk'
    if (Test-Path -LiteralPath $oldLink) {
      $oldTarget = $wsh.CreateShortcut($oldLink).TargetPath
      if ($oldTarget.StartsWith((Join-Path $env:LOCALAPPDATA 'CodexWslWhale\'), [StringComparison]::OrdinalIgnoreCase)) { Remove-Item -LiteralPath $oldLink -Force }
    }
  }
  if (!$NoStart) {
    Start-Dragon
    $ready = $false
    for ($i = 0; $i -lt 40; $i++) {
      Start-Sleep -Milliseconds 750
      try { $state = Request-Dragon $DataDir '/api/status'; if ($state.ok -and $state.rendererReady) { $ready = $true; break } } catch {}
    }
    if (!$ready) { throw 'Updated Dragon did not become ready; restoring the previous installation.' }
  }
  @{ok=$true;version=$product.version;at=(Get-Date).ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $DataDir 'last-update.json') -Encoding UTF8
  Write-Output ('Codex Dragon ' + $product.version + ' installed successfully.')
} catch {
  $failure = $_.Exception.Message; $restored = $false
  if ($movedOld) {
    try { Stop-Dragon $DataDir; if (Test-Path -LiteralPath $appDir) { Remove-Item -LiteralPath $appDir -Recurse -Force }; Move-Item -LiteralPath $previous -Destination $appDir
      $oldProduct = Read-Json (Join-Path $appDir 'dragon.json')
      $previousMarker | ConvertTo-Json | Set-Content -LiteralPath $marker -Encoding UTF8
      $restored = $true
    } catch { $failure += ' Rollback needs manual recovery from the previous directory.' }
  }
  if (Test-Path -LiteralPath $DataDir) { @{ok=$false;error=$failure;version=$ExpectedVersion;sha256=$Sha256;at=(Get-Date).ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $DataDir 'last-update.json') -Encoding UTF8 }
  if ($restored -and !$NoStart) { Start-Dragon }
  Write-Error $failure
  exit 1
} finally { if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force } }
