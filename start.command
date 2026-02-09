#!/bin/bash

# Cambiar al directorio del proyecto
cd "$(dirname "$0")"

# Iniciar el servidor en segundo plano
npm start > /tmp/facturas.log 2>&1 &

# Esperar a que el servidor esté listo
sleep 2

# Abrir la URL en el navegador
open "http://localhost:3000"

# Cerrar la ventana de Terminal
sleep 1
osascript << EOF
tell application "Terminal"
    close (every window whose name contains "start.command")
end tell
EOF
