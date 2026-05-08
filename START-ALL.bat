@echo off
echo =====================================
echo Starting Servers
echo =====================================
echo.

cd /d "%~dp0"

if not exist "node_modules" (
    echo ERROR: Packages not installed!
    echo Please run INSTALL.bat first.
    pause
    exit
)

if not exist "backend\node_modules" (
    echo ERROR: Backend packages not installed!
    echo Please run INSTALL.bat first.
    pause
    exit
)

echo Starting Backend server...
start "Backend Server" cmd /k "cd /d %~dp0backend && npm start"

echo.
echo Waiting 5 seconds...
timeout /t 5 >nul

echo Starting Frontend server...
start "Frontend Server" cmd /k "cd /d %~dp0 && npm start"

echo.
echo =====================================
echo Servers started!
echo =====================================
echo.
echo Backend:  http://localhost:5000
echo Frontend: http://localhost:3000
echo.
echo Browser will open automatically.
echo.
pause
