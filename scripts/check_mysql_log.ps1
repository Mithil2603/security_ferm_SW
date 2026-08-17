$InstallDir = "C:\MySQL8"
$dataDir = "$InstallDir\data"

# Check for error log
$errLog = Get-ChildItem "$dataDir" -Filter "*.err" -ErrorAction SilentlyContinue | Select-Object -First 1
if ($errLog) {
    Write-Host "=== MySQL Error Log ===" -ForegroundColor Yellow
    Get-Content $errLog.FullName -Tail 30
} else {
    Write-Host "No .err log found in $dataDir" -ForegroundColor Red
    Get-ChildItem $dataDir -ErrorAction SilentlyContinue | Select-Object Name
}
