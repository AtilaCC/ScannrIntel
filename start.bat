@echo off
echo ================================
echo   CryptoIntel - Iniciando...
echo ================================

REM Verifica se Docker está rodando
docker info >nul 2>&1
if errorlevel 1 (
    echo ERRO: Docker nao esta rodando. Abra o Docker Desktop primeiro.
    pause
    exit /b 1
)

REM Copia .env.example se .env nao existir
if not exist .env (
    copy .env.example .env
    echo Arquivo .env criado. Edite com suas chaves antes de continuar.
    notepad .env
    pause
)

echo Iniciando todos os servicos...
docker compose up --build -d

echo.
echo ================================
echo  Sistema iniciado com sucesso!
echo  Acesse: http://localhost:3000
echo ================================
pause
