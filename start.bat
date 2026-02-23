@echo off
REM SuperBrain Instagram Analyzer - Windows Startup Script

echo.
echo ========================================================
echo       SuperBrain Instagram Analyzer v1.02
echo          Starting Backend Services...
echo ========================================================
echo.

REM Check if virtual environment exists
if not exist ".venv\Scripts\activate.bat" (
    echo [ERROR] Virtual environment not found!
    echo Please create it first: python -m venv .venv
    exit /b 1
)

REM Activate virtual environment
echo [*] Activating virtual environment...
call .venv\Scripts\activate.bat

echo [OK] Virtual environment activated
echo.

REM Check Python version
echo [*] Python version:
python --version
echo.

REM Check dependencies
echo [*] Checking dependencies...
python -c "import fastapi, uvicorn, pymongo, ollama" 2>nul
if errorlevel 1 (
    echo [WARN] Some dependencies missing. Installing...
    pip install -r backend\requirements_api.txt
)
echo [OK] Dependencies OK
echo.

REM Check MongoDB connection
echo [*] Checking MongoDB connection...
if not exist "backend\.mongodb_config" (
    echo [WARN] MongoDB config not found. Database caching disabled.
) else (
    echo [OK] MongoDB config found
)
echo.

REM Start API server
echo ========================================================
echo            Starting API Server...
echo ========================================================
echo.
echo API Documentation: http://localhost:5000/docs
echo Interactive Docs:  http://localhost:5000/redoc
echo API Base URL:      http://localhost:5000
echo.
echo Press CTRL+C to stop the server
echo.

REM Change to backend directory and start API
cd backend
python -u api.py

REM If server stops, pause to see error message
if errorlevel 1 (
    echo.
    echo [ERROR] Server stopped with error!
    pause
) else (
    echo.
    echo [INFO] Server stopped normally
    pause
)
