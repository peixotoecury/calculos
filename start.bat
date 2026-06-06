@echo off
title Calculos P&C — Peixoto & Cury
cd /d "%~dp0"
echo.
echo  ================================================
echo   Calculos P^&C — Peixoto ^& Cury Advogados
echo   Plataforma de Calculos Trabalhistas com IA
echo  ================================================
echo.
echo  Iniciando... aguarde...
echo.
"C:\Users\ach\AppData\Local\Programs\Python\Python312\python.exe" -m streamlit run app.py --server.port 8503 --server.headless false --browser.gatherUsageStats false
pause
