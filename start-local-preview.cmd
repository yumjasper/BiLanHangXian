@echo off
chcp 65001 >nul
title 碧蓝航线动态立绘预览 - 本地服务

set "ROOT=%~dp0"
cd /d "%ROOT%"

set "PORT=13383"
set "URL=http://127.0.0.1:%PORT%/player/index.html"

echo.
echo   碧蓝航线动态立绘预览 - 婚礼白主题
echo   ====================================
echo   根目录 : %ROOT%
echo   端口   : %PORT%
echo   地址   : %URL%
echo.
echo   正在启动本地服务，浏览器将自动打开预览页面；
echo   若提示读取 index.json 失败，请先执行 python tools\build-player-data.py
echo.

where python >nul 2>nul
if errorlevel 1 goto NOPYTHON

start "" "%URL%"
python -m http.server %PORT% --directory "%ROOT%docs" --bind 127.0.0.1
goto END

:NOPYTHON
where node >nul 2>nul
if errorlevel 1 goto NOBOTH

echo   [!] 未检测到 python，改用 node 提供的静态服务。
start "" "%URL%"
npx --yes http-server "%ROOT%docs" -p %PORT% -a 127.0.0.1 -c-1
goto END

:NOBOTH
echo   [x] 未检测到 python 或 node。
echo       可以直接双击 docs\player\index.html（需已生成内联索引数据），
echo       或安装 Python 后重新运行本脚本。
pause

:END
pause