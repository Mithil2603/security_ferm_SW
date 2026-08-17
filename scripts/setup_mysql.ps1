param([string]$InstallDir = "C:\MySQL8")
$ErrorActionPreference = "Stop"
Write-Host "=== MySQL 8.4 Portable Setup ===" -ForegroundColor Cyan

$mysqlSvc = Get-Service -Name "MySQL*" -ErrorAction SilentlyContinue
if ($mysqlSvc) {
    Write-Host "MySQL service already running: $($mysqlSvc.Name)" -ForegroundColor Green
    exit 0
}

if (Test-Path "$InstallDir\bin\mysql.exe") {
    Write-Host "MySQL already extracted at $InstallDir" -ForegroundColor Green
} else {
    $zipUrl = "https://cdn.mysql.com/Downloads/MySQL-8.4/mysql-8.4.9-winx64.zip"
    $zipPath = "$env:TEMP\mysql-8.4.9-winx64.zip"
    if (-not (Test-Path $zipPath)) {
        Write-Host "Downloading MySQL 8.4 ZIP (~270MB)..." -ForegroundColor Yellow
        $ProgressPreference = 'SilentlyContinue'
        Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath -UseBasicParsing
        Write-Host "Download complete." -ForegroundColor Green
    } else {
        Write-Host "ZIP already in temp folder." -ForegroundColor Green
    }

    Write-Host "Extracting to $InstallDir ..." -ForegroundColor Yellow
    if (-not (Test-Path $InstallDir)) { New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
    foreach ($entry in $zip.Entries) {
        $rel = $entry.FullName -replace '^[^/\\]+[/\\]', ''
        if ($rel -eq '') { continue }
        $dest = Join-Path $InstallDir $rel
        if ($entry.FullName.EndsWith('/') -or $entry.FullName.EndsWith('\')) {
            if (-not (Test-Path $dest)) { New-Item -ItemType Directory -Path $dest -Force | Out-Null }
        } else {
            $dir = Split-Path $dest -Parent
            if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
            [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $dest, $true)
        }
    }
    $zip.Dispose()
    Write-Host "Extraction complete." -ForegroundColor Green
}

$dataDir = "$InstallDir\data"
$baseDirFwd = $InstallDir.Replace('\', '/')
$dataDirFwd = $dataDir.Replace('\', '/')

$myIniPath = "$InstallDir\my.ini"
if (-not (Test-Path $myIniPath)) {
    $iniLines = @(
        "[mysqld]",
        "basedir=$baseDirFwd",
        "datadir=$dataDirFwd",
        "port=3306",
        "default-authentication-plugin=mysql_native_password",
        "character-set-server=utf8mb4",
        "collation-server=utf8mb4_unicode_ci",
        "max_connections=100",
        "",
        "[mysql]",
        "default-character-set=utf8mb4",
        "",
        "[client]",
        "default-character-set=utf8mb4",
        "port=3306"
    )
    $iniLines | Set-Content -Path $myIniPath -Encoding UTF8
    Write-Host "my.ini created." -ForegroundColor Green
}

if (-not (Test-Path "$dataDir\mysql")) {
    Write-Host "Initializing MySQL data directory (first time)..." -ForegroundColor Yellow
    $initArgs = "--initialize-insecure", "--datadir=$dataDir", "--basedir=$InstallDir"
    & "$InstallDir\bin\mysqld.exe" @initArgs 2>&1 | ForEach-Object { Write-Host "  $_" }
    Write-Host "Data directory initialized." -ForegroundColor Green
}

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if ($isAdmin) {
    Write-Host "Installing MySQL Windows service (MySQL84)..." -ForegroundColor Yellow
    $svcCheck = Get-Service -Name "MySQL84" -ErrorAction SilentlyContinue
    if (-not $svcCheck) {
        & "$InstallDir\bin\mysqld.exe" --install MySQL84 "--defaults-file=$myIniPath" 2>&1
    }
    Start-Service MySQL84 -ErrorAction SilentlyContinue
    Write-Host "MySQL84 service started." -ForegroundColor Green
} else {
    Write-Host "Starting MySQL in background (no service - not admin)..." -ForegroundColor Yellow
    $proc = Get-Process -Name "mysqld" -ErrorAction SilentlyContinue
    if (-not $proc) {
        Start-Process -FilePath "$InstallDir\bin\mysqld.exe" -ArgumentList "--defaults-file=$myIniPath" -WindowStyle Hidden -PassThru | Out-Null
        Start-Sleep -Seconds 6
    }
    Write-Host "MySQL started (background process)." -ForegroundColor Yellow
}

$env:PATH = "$InstallDir\bin;$env:PATH"
Start-Sleep -Seconds 3

Write-Host "Creating database security_firm_db..." -ForegroundColor Yellow
$mysqlExe = "$InstallDir\bin\mysql.exe"
& $mysqlExe -u root "--connect-timeout=10" -e "CREATE DATABASE IF NOT EXISTS security_firm_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;" 2>&1
Write-Host "Database ready." -ForegroundColor Green

Write-Host ""
Write-Host "=== MySQL Setup COMPLETE ===" -ForegroundColor Cyan
Write-Host "Host:     localhost" -ForegroundColor White
Write-Host "Port:     3306" -ForegroundColor White
Write-Host "User:     root" -ForegroundColor White
Write-Host "Password: (none / empty)" -ForegroundColor White
Write-Host "Database: security_firm_db" -ForegroundColor White
Write-Host "Binaries: $InstallDir\bin" -ForegroundColor White
