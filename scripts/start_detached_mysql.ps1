$InstallDir = "C:\MySQL8"
$myIniPath = "$InstallDir\my.ini"
$env:PATH = "$InstallDir\bin;$env:PATH"

# Kill any zombie mysqld
Get-Process -Name "mysqld" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

# Start mysqld as a completely detached process using cmd /c start
Write-Host "Starting MySQL as detached background service..." -ForegroundColor Yellow
$startInfo = New-Object System.Diagnostics.ProcessStartInfo
$startInfo.FileName = "$InstallDir\bin\mysqld.exe"
$startInfo.Arguments = "--defaults-file=`"$myIniPath`""
$startInfo.UseShellExecute = $true
$startInfo.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
$startInfo.CreateNoWindow = $false
$proc = [System.Diagnostics.Process]::Start($startInfo)
Write-Host "mysqld started with PID: $($proc.Id)" -ForegroundColor Green

Write-Host "Waiting 15 seconds..." -ForegroundColor Yellow
Start-Sleep -Seconds 15

# Verify it's still running
$check = Get-Process -Name "mysqld" -ErrorAction SilentlyContinue
if ($check) {
    Write-Host "mysqld still running! PID: $($check.Id)" -ForegroundColor Green
} else {
    Write-Host "mysqld died! Check error log:" -ForegroundColor Red
    Get-Content "$InstallDir\data\*.err" -Tail 10
    exit 1
}

# Test connection
Write-Host "Testing connection..." -ForegroundColor Yellow
$result = & "$InstallDir\bin\mysql.exe" -u root -h 127.0.0.1 -P 3306 --connect-timeout=10 -e "SHOW DATABASES;" 2>&1
Write-Host "Result: $result" -ForegroundColor Cyan

if ($result -like "*security_firm_db*") {
    Write-Host "MySQL is READY and database exists!" -ForegroundColor Green
} else {
    # Try creating db
    & "$InstallDir\bin\mysql.exe" -u root -h 127.0.0.1 -P 3306 --connect-timeout=10 -e "CREATE DATABASE IF NOT EXISTS security_firm_db CHARACTER SET utf8mb4;" 2>&1
}
