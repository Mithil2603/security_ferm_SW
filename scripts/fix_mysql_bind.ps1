$InstallDir = "C:\MySQL8"
$myIniPath = "$InstallDir\my.ini"

# Write my.ini that binds on all interfaces (0.0.0.0) so both IPv4 and IPv6 work
$iniContent = "[mysqld]`nbasedir=C:/MySQL8`ndatadir=C:/MySQL8/data`nport=3306`nbind-address=0.0.0.0`ncharacter-set-server=utf8mb4`ncollation-server=utf8mb4_unicode_ci`nmax_connections=100`n`n[mysql]`ndefault-character-set=utf8mb4`n`n[client]`ndefault-character-set=utf8mb4`nport=3306"
$enc = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($myIniPath, $iniContent, $enc)
Write-Host "my.ini updated with bind-address=0.0.0.0" -ForegroundColor Green

# Restart mysqld
Write-Host "Restarting MySQL..." -ForegroundColor Yellow
Get-Process -Name "mysqld" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 3

$env:PATH = "C:\MySQL8\bin;$env:PATH"
Start-Process -FilePath "$InstallDir\bin\mysqld.exe" -ArgumentList "--defaults-file=$myIniPath" -WindowStyle Hidden -PassThru | Out-Null
Write-Host "Waiting 12 seconds..." -ForegroundColor Yellow
Start-Sleep -Seconds 12

# Check port
$portCheck = netstat -an | Select-String ":3306"
Write-Host "Port 3306 status:" -ForegroundColor Cyan
$portCheck | ForEach-Object { Write-Host $_ }

# Try connecting
$result = & "$InstallDir\bin\mysql.exe" -u root -h 127.0.0.1 --connect-timeout=10 -e "SHOW DATABASES;" 2>&1
Write-Host "MySQL connection test: $result" -ForegroundColor Cyan
