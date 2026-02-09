#!/bin/bash

# Cambiar al directorio del proyecto
cd "$(dirname "$0")"

# Iniciar el servidor en segundo plano
npm start &
SERVER_PID=$!

# Esperar a que el servidor esté listo
sleep 2

# Abrir la URL en el navegador
open "http://localhost:3000"

# Mantener el script activo
wait $SERVER_PID
