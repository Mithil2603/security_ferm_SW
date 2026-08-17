$InstallDir = "C:\MySQL8"
$env:PATH = "$InstallDir\bin;$env:PATH"

Write-Host "Waiting 10s for MySQL to fully start..." -ForegroundColor Yellow
Start-Sleep -Seconds 10

# Check if mysqld is running
$proc = Get-Process -Name "mysqld" -ErrorAction SilentlyContinue
if ($proc) {
    Write-Host "mysqld process running (PID: $($proc.Id))" -ForegroundColor Green
} else {
    Write-Host "mysqld not running! Starting now..." -ForegroundColor Red
    $myIniPath = "$InstallDir\my.ini"
    Start-Process -FilePath "$InstallDir\bin\mysqld.exe" -ArgumentList "--defaults-file=$myIniPath" -WindowStyle Hidden -PassThru | Out-Null
    Start-Sleep -Seconds 10
}

# Create database
Write-Host "Connecting to MySQL and creating database..." -ForegroundColor Yellow
$mysqlExe = "$InstallDir\bin\mysql.exe"
$output = & $mysqlExe -u root --connect-timeout=15 -e "CREATE DATABASE IF NOT EXISTS security_firm_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; SHOW DATABASES;" 2>&1
Write-Host $output

Write-Host ""
Write-Host "MySQL is ready!" -ForegroundColor Cyan
Write-Host "Host: localhost | Port: 3306 | User: root | Password: (empty)" -ForegroundColor White
Write-Host "Database: security_firm_db" -ForegroundColor White
