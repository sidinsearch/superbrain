#!/usr/bin/env pwsh
<#
.SYNOPSIS
    SuperBrain Instagram Analyzer - Startup Script
.DESCRIPTION
    Activates Python virtual environment and starts the API server
#>

Write-Host ""
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "     SuperBrain Instagram Analyzer v1.02" -ForegroundColor Cyan
Write-Host "        Starting Backend Services..." -ForegroundColor Cyan
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host ""

# Check if virtual environment exists
if (-not (Test-Path ".venv\Scripts\Activate.ps1")) {
    Write-Host "ERROR: Virtual environment not found!" -ForegroundColor Red
    Write-Host "   Please create it first: python -m venv .venv" -ForegroundColor Yellow
    exit 1
}

# Activate virtual environment
Write-Host "Activating virtual environment..." -ForegroundColor Yellow
& .\.venv\Scripts\Activate.ps1

Write-Host "OK: Virtual environment activated" -ForegroundColor Green

# Check Python version
Write-Host ""
Write-Host "Python version:" -ForegroundColor Yellow
python --version

# Check if required packages are installed
Write-Host ""
Write-Host "Checking dependencies..." -ForegroundColor Yellow
python -c "import fastapi, uvicorn, pymongo, ollama" 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "WARN: Some dependencies missing. Installing..." -ForegroundColor Yellow
    pip install -r backend/requirements_api.txt
}
Write-Host "OK: Dependencies installed" -ForegroundColor Green

# Check MongoDB connection
Write-Host ""
Write-Host "Checking MongoDB connection..." -ForegroundColor Yellow
if (-not (Test-Path "backend/.mongodb_config")) {
    Write-Host "WARN: MongoDB config not found. Database caching disabled." -ForegroundColor Yellow
} else {
    Write-Host "OK: MongoDB config found" -ForegroundColor Green
}

# Check Ollama service
Write-Host ""
Write-Host "Checking Ollama service..." -ForegroundColor Yellow
$ollamaCheck = Test-NetConnection -ComputerName localhost -Port 11434 -InformationLevel Quiet -WarningAction SilentlyContinue
if ($ollamaCheck) {
    Write-Host "OK: Ollama is running" -ForegroundColor Green
} else {
    Write-Host "WARN: Ollama not detected. Make sure it's running for AI analysis." -ForegroundColor Yellow
}

# Start API server
Write-Host ""
Write-Host "========================================================" -ForegroundColor Green
Write-Host "          Starting API Server..." -ForegroundColor Green
Write-Host "========================================================" -ForegroundColor Green
Write-Host ""
Write-Host "API Documentation: " -NoNewline
Write-Host "http://localhost:8000/docs" -ForegroundColor Cyan
Write-Host "Interactive Docs:  " -NoNewline
Write-Host "http://localhost:8000/redoc" -ForegroundColor Cyan
Write-Host "API Base URL:      " -NoNewline
Write-Host "http://localhost:8000" -ForegroundColor Cyan
Write-Host ""
Write-Host "Press CTRL+C to stop the server" -ForegroundColor Yellow
Write-Host ""

# Change to backend directory and start API
Set-Location backend
python api.py
