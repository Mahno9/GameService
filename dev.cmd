@echo off
chcp 65001 >nul

:: Load root .env (dev settings)
for /f "usebackq tokens=1,* delims==" %%a in (".env") do set %%a=%%b

:: Load CLOUDFLARE_TUNNEL_TOKEN from docker/.env
for /f "usebackq tokens=1,* delims==" %%a in ("docker\.env") do (
  if "%%a"=="CLOUDFLARE_TUNNEL_TOKEN" set CLOUDFLARE_TUNNEL_TOKEN=%%b
)

echo Starting GameService dev...
start "GameService Server" cmd /k "npm run dev:server"
start "GameService Player" cmd /k "npm run dev:player"
start "GameService Admin"  cmd /k "npm run dev:admin -- --host"
start "Cloudflared"        cmd /k "cloudflared tunnel --no-autoupdate run --token %CLOUDFLARE_TUNNEL_TOKEN%"
echo.
echo Server:   http://localhost:%PORT%
echo Player:   http://localhost:5173
echo Admin UI: http://localhost:5174
