@echo off
echo =====================================
echo Installing Packages
echo =====================================
echo.

echo [1/2] Installing Frontend packages...
cd /d "%~dp0"
call npm install
if errorlevel 1 (
    echo ERROR: Frontend installation failed!
    pause
    exit
)

echo.
echo [2/2] Installing Backend packages...
cd backend
call npm install
if errorlevel 1 (
    echo ERROR: Backend installation failed!
    pause
    exit
)

echo.
echo =====================================
echo SUCCESS! Installation complete.
echo =====================================
echo.
pause
