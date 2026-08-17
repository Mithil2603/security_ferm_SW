$InstallDir = "C:\MySQL8"
$dataDir = "$InstallDir\data"
$myIniPath = "$InstallDir\my.ini"
$env:PATH = "$InstallDir\bin;$env:PATH"

# Fix my.ini - remove deprecated option for MySQL 8.4
$iniContent = "[mysqld]`nbasedir=C:/MySQL8`ndatadir=C:/MySQL8/data`nport=3306`ncharacter-set-server=utf8mb4`ncollation-server=utf8mb4_unicode_ci`nmax_connections=100`nmysql_native_password=ON`n`n[mysql]`ndefault-character-set=utf8mb4`n`n[client]`ndefault-character-set=utf8mb4`nport=3306"
$enc = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($myIniPath, $iniContent, $enc)
Write-Host "my.ini updated (removed deprecated option, added mysql_native_password=ON)" -ForegroundColor Green

# Kill any running mysqld
Get-Process -Name "mysqld" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

# Start MySQL
Write-Host "Starting MySQL 8.4..." -ForegroundColor Yellow
Start-Process -FilePath "$InstallDir\bin\mysqld.exe" -ArgumentList "--defaults-file=$myIniPath" -WindowStyle Hidden -PassThru | Out-Null
Write-Host "Waiting 12 seconds for MySQL to start..." -ForegroundColor Yellow
Start-Sleep -Seconds 12

# Check if running
$proc = Get-Process -Name "mysqld" -ErrorAction SilentlyContinue
if ($proc) {
    Write-Host "mysqld is running! (PID: $($proc.Id))" -ForegroundColor Green
} else {
    Write-Host "mysqld still not running. Checking log..." -ForegroundColor Red
    $errLog = Get-ChildItem $dataDir -Filter "*.err" | Select-Object -First 1
    if ($errLog) { Get-Content $errLog.FullName -Tail 10 }
    exit 1
}

# Create database
Write-Host "Creating database security_firm_db..." -ForegroundColor Yellow
$result = & "$InstallDir\bin\mysql.exe" -u root --connect-timeout=10 -e "CREATE DATABASE IF NOT EXISTS security_firm_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; SHOW DATABASES;" 2>&1
Write-Host $result

Write-Host ""
Write-Host "SUCCESS! MySQL 8.4 is running." -ForegroundColor Cyan
Write-Host "  Host:     localhost" -ForegroundColor White
Write-Host "  Port:     3306" -ForegroundColor White
Write-Host "  User:     root" -ForegroundColor White
Write-Host "  Password: (empty)" -ForegroundColor White
Write-Host "  Database: security_firm_db" -ForegroundColor White
