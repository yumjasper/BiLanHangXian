@echo off
chcp 936 >nul
title 碧蓝航线动态立绘预览 - 一键启动

set "ROOT=%~dp0"
cd /d "%ROOT%"

set "PORT=13383"
set "URL=http://127.0.0.1:%PORT%/player/index.html"

echo.
echo   碧蓝航线动态立绘预览 - 一键启动
echo   ================================
echo   根目录 : %ROOT%
echo   端口   : %PORT%
echo   地址   : %URL%
echo.
echo   正在启动本地静态服务，浏览器将自动打开预览页。
echo   关闭本窗口即可停止服务。
echo.

powershell -NoProfile -Command "$c=New-Object Net.Sockets.TcpClient; try{$c.Connect('127.0.0.1',%PORT%); exit 0}catch{exit 1}" >nul 2>&1
if not errorlevel 1 goto ALREADY

where python >nul 2>nul
if errorlevel 1 goto TRYNODE

start "" "%URL%"
python -m http.server %PORT% --directory "%ROOT%docs" --bind 127.0.0.1
goto END

:ALREADY
echo   [i] 端口 %PORT% 已在运行，直接打开预览页。
start "" "%URL%"
goto END

:TRYNODE
where node >nul 2>nul
if errorlevel 1 goto NOBOTH

echo   [!] 未检测到 python，改用 node 静态服务。
start "" "%URL%"
npx --yes http-server "%ROOT%docs" -p %PORT% -a 127.0.0.1 -c-1
goto END

:NOBOTH
echo   [x] 未检测到 python 或 node，无法启动本地服务。
echo.
echo       也可以直接双击 docs\player\index.html 打开，
echo       但部分浏览器在 file:// 协议下会因 CORS 拒绝读取
echo       .skel / .atlas / .png 资源，导致立绘无法渲染。
echo       建议安装 Python 后重新运行本脚本。

:END
pause
