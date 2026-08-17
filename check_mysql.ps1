Get-Command mysql -ErrorAction SilentlyContinue
Get-Service -Name "*mysql*" -ErrorAction SilentlyContinue | Select-Object Name, Status, StartType
winget --version 2>&1
choco --version 2>&1
