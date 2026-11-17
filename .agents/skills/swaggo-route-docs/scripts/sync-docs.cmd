@echo off
setlocal
pushd "%~dp0..\..\..\..\backend"
if errorlevel 1 exit /b 1

call go generate ./cmd/server
if errorlevel 1 goto finish

call generate-redoc.cmd

:finish
set "sync_docs_exit=%errorlevel%"
popd
exit /b %sync_docs_exit%
