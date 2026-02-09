# Gestor de facturas (PDF / imágenes)

Pequeña aplicación en Node.js que permite subir PDFs e imágenes mediante drag-and-drop. Los archivos se almacenan en carpetas por `uploads/YYYY/MM` según la fecha (si la imagen tiene EXIF se intenta usar su fecha, si no se usa la fecha de subida).

## Requisitos previos

**Node.js 16+ y npm** (necesario instalar antes)

### ¿Cómo instalar Node.js? (Windows)

1. Descarga desde: https://nodejs.org/ (versión **LTS**)
2. Abre el archivo `.exe` e instala (siguiente, siguiente, siguiente)
3. Reinicia el ordenador

## Ejecución

### Opción 1: Rápida (Recomendado para Windows)

**Doble clic** en `start.vbs` → La app se abre automáticamente en http://localhost:3000

### Opción 2: Manual desde terminal

```bash
npm install
npm start
# Luego abre http://localhost:3000
```

Uso:
- Arrastra imágenes o PDFs a la zona indicada o haz click para seleccionar.
- Los archivos se guardan en `uploads/<año>/<mes>`.
- El endpoint `GET /list` devuelve la estructura actual en JSON.

Almacenamiento y acceso
- Los archivos subidos se almacenan dentro del propio proyecto en la carpeta `uploads` siguiendo la estructura `uploads/YYYY/MM`.
- Esa carpeta se sirve públicamente cuando ejecutas el servidor: un archivo guardado en `uploads/2026/02/1612345678900_factura.pdf` será accesible en `http://localhost:3000/uploads/2026/02/1612345678900_factura.pdf`.
- Ten en cuenta que esto usa el almacenamiento local del equipo (gratis, para uso personal). Si quieres disponibilidad remota o respaldo, conecta un servicio de almacenamiento (S3, Google Drive, etc.).

Posibles mejoras:
- Extraer fecha de metadatos de PDFs.
- Añadir autenticación y base de datos para meta-información.
