Set objShell = CreateObject("WScript.Shell")
strPath = objShell.CurrentDirectory

' Ejecutar npm start sin mostrar ventana (0 = oculto, 1 = visible)
objShell.Run "cmd /c cd /d """ & strPath & """ && npm start", 0, False
WScript.Sleep 3000
objShell.Run "http://localhost:3000"
