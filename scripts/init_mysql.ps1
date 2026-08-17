$InstallDir = "C:\MySQL8"
$dataDir = "$InstallDir\data"

# Fix my.ini — write WITHOUT BOM, pure ASCII
$baseDirFwd = $InstallDir.Replace('\', '/')
$dataDirFwd = $dataDir.Replace('\', '/')

$iniContent = "[mysqld]`nbasedir=$baseDirFwd`ndatadir=$dataDirFwd`nport=3306`ndefault-authentication-plugin=mysql_native_password`ncharacter-set-server=utf8mb4`ncollation-server=utf8mb4_unicode_ci`nmax_connections=100`n`n[mysql]`ndefault-character-set=utf8mb4`n`n[client]`ndefault-character-set=utf8mb4`nport=3306"
$myIniPath = "$InstallDir\my.ini"
$enc = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($myIniPath, $iniContent, $enc)
Write-Host "my.ini fixed (no BOM)." -ForegroundColor Green

# Kill any running mysqld first
Get-Process -Name "mysqld" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

# Initialize data dir if needed
if (-not (Test-Path "$dataDir\mysql")) {
    Write-Host "Initializing MySQL data directory..." -ForegroundColor Yellow
    & "$InstallDir\bin\mysqld.exe" --defaults-file="$myIniPath" --initialize-insecure 2>&1 | ForEach-Object { Write-Host "  $_" }
    Write-Host "Initialization done." -ForegroundColor Green
} else {
    Write-Host "Data directory already initialized." -ForegroundColor Green
}

# Start mysqld in background
Write-Host "Starting MySQL..." -ForegroundColor Yellow
Start-Process -FilePath "$InstallDir\bin\mysqld.exe" -ArgumentList "--defaults-file=$myIniPath" -WindowStyle Hidden -PassThru | Out-Null
Start-Sleep -Seconds 6

# Add to PATH
$env:PATH = "$InstallDir\bin;$env:PATH"

# Create database
Write-Host "Creating database..." -ForegroundColor Yellow
& "$InstallDir\bin\mysql.exe" -u root "--connect-timeout=10" -e "CREATE DATABASE IF NOT EXISTS security_firm_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;" 2>&1
Write-Host "Done! MySQL running on localhost:3306 (root, no password)" -ForegroundColor Cyan
Write-Host "Database: security_firm_db" -ForegroundColor Cyan
