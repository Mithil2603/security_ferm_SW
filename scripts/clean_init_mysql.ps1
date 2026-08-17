$InstallDir = "C:\MySQL8"
$dataDir = "$InstallDir\data"
$myIniPath = "$InstallDir\my.ini"
$env:PATH = "$InstallDir\bin;$env:PATH"

Write-Host "=== Clean MySQL 8.4 Initialization ===" -ForegroundColor Cyan

# Kill any running mysqld
Write-Host "Stopping any running MySQL..." -ForegroundColor Yellow
Get-Process -Name "mysqld" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 3

# Write clean my.ini (NO deprecated options, NO BOM)
$iniContent = "[mysqld]`nbasedir=C:/MySQL8`ndatadir=C:/MySQL8/data`nport=3306`ncharacter-set-server=utf8mb4`ncollation-server=utf8mb4_unicode_ci`nmax_connections=100`n`n[mysql]`ndefault-character-set=utf8mb4`n`n[client]`ndefault-character-set=utf8mb4`nport=3306"
$enc = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($myIniPath, $iniContent, $enc)
Write-Host "Clean my.ini written." -ForegroundColor Green

# WIPE the data dir completely and re-initialize
Write-Host "Wiping old data directory..." -ForegroundColor Yellow
if (Test-Path $dataDir) {
    Remove-Item $dataDir -Recurse -Force -ErrorAction SilentlyContinue
}
New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
Write-Host "Data directory cleared." -ForegroundColor Green

# Initialize fresh
Write-Host "Running --initialize-insecure (fresh init)..." -ForegroundColor Yellow
$initOut = & "$InstallDir\bin\mysqld.exe" "--defaults-file=$myIniPath" --initialize-insecure 2>&1
Write-Host "Init output: $initOut" -ForegroundColor Gray
Write-Host "Initialization complete." -ForegroundColor Green

# Start MySQL
Write-Host "Starting MySQL..." -ForegroundColor Yellow
Start-Process -FilePath "$InstallDir\bin\mysqld.exe" -ArgumentList "--defaults-file=$myIniPath" -WindowStyle Hidden -PassThru | Out-Null

# Wait for startup (MySQL needs 10-15s on first run)
Write-Host "Waiting 15 seconds for MySQL to fully start..." -ForegroundColor Yellow
Start-Sleep -Seconds 15

# Check process
$proc = Get-Process -Name "mysqld" -ErrorAction SilentlyContinue
if ($proc) {
    Write-Host "mysqld running! (PID: $($proc.Id))" -ForegroundColor Green
} else {
    Write-Host "ERROR: mysqld not running!" -ForegroundColor Red
    $errLog = Get-ChildItem $dataDir -Filter "*.err" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($errLog) { Get-Content $errLog.FullName -Tail 15 }
    exit 1
}

# Create the database
Write-Host "Creating database..." -ForegroundColor Yellow
$dbResult = & "$InstallDir\bin\mysql.exe" -u root --connect-timeout=15 -e "CREATE DATABASE IF NOT EXISTS security_firm_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;" 2>&1
Write-Host "DB creation result: $dbResult" -ForegroundColor Gray

# Verify
$dbList = & "$InstallDir\bin\mysql.exe" -u root --connect-timeout=10 -e "SHOW DATABASES;" 2>&1
Write-Host "Databases: $dbList"

Write-Host ""
Write-Host "=== MYSQL READY ===" -ForegroundColor Cyan
Write-Host "Host: localhost | Port: 3306 | User: root | Pass: (empty)" -ForegroundColor Green
Write-Host "Database: security_firm_db" -ForegroundColor Green
