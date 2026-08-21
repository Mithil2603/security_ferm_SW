@echo off
:: Batch file to open Port 3000 in Windows Firewall
echo ===================================================
echo Opening Port 3000 in Windows Firewall...
echo ===================================================

netsh advfirewall firewall delete rule name="Security Firm Management Port 3000" >nul 2>&1
netsh advfirewall firewall add rule name="Security Firm Management Port 3000" dir=in action=allow protocol=TCP localport=3000 profile=any

if %ERRORLEVEL% EQU 0 (
    echo.
    echo [SUCCESS] Port 3000 is now open in Windows Firewall!
    echo Devices on your Wi-Fi can now connect to http://192.168.29.19:3000
    echo.
) else (
    echo.
    echo [ERROR] Failed to add firewall rule. Please right-click this file and select "Run as administrator".
    echo.
)

pause
