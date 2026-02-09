# Setup: MongoDB Atlas + Cloudinary (100% Gratuito)

## 1. MongoDB Atlas (Base de Datos en Nube)

### Paso 1: Crear cuenta
1. Ve a https://www.mongodb.com/cloud/atlas
2. Click en "Try Free"
3. Crea cuenta con email/contraseña

### Paso 2: Crear Cluster
1. En el dashboard, click en "Create"
2. Selecciona "M0 Free" (gratuito)
3. Proveedor: AWS, Región: Elige la más cercana
4. Nombre: `facturas-cluster`
5. Click "Create Cluster"

### Paso 3: Crear Usuario de BD
1. Ve a "Database Access"
2. Click "Add New Database User"
3. Username: `facturas-admin` (o lo que quieras)
4. Password: Genera un pwd seguro (cópialo!)
5. Click "Add User"

### Paso 4: Configurar IP Whitelist
1. Ve a "Network Access"
2. Click "Add IP Address"
3. Selecciona "Allow Access from Anywhere" (0.0.0.0/0)
4. Click "Confirm"

### Paso 5: Obtener Connection String
1. Vuelve a "Clusters"
2. Click "Connect" en tu cluster
3. Selecciona "Drivers" → "Node.js"
4. Copia la connection string que aparece
5. Reemplaza `<username>` y `<password>` con tus credenciales

**Ejemplo:**
```
mongodb+srv://facturas-admin:tu_password_aqui@facturas-cluster.xxxxx.mongodb.net/facturas?retryWrites=true&w=majority
```

---

## 2. Cloudinary (Almacenamiento de Archivos)

### Paso 1: Crear cuenta
1. Ve a https://cloudinary.com
2. Click "Sign Up Free"
3. Completa con email/contraseña

### Paso 2: Obtener Credenciales
1. En el dashboard, ve a "Settings" → "Account"
2. Verás tu **Cloud Name**
3. Ve a "Settings" → "API Keys"
4. Ahí está tu **API Key** y **API Secret**

**Nota:** Nunca compartas el API Secret en repositorios públicos

---

## 3. Configurar variables de entorno

Crea un archivo `.env` en la raíz del proyecto:

```
MONGODB_URI=mongodb+srv://facturas-admin:tu_password@facturas-cluster.xxxxx.mongodb.net/facturas?retryWrites=true&w=majority
CLOUDINARY_CLOUD_NAME=tu_cloud_name
CLOUDINARY_API_KEY=tu_api_key
CLOUDINARY_API_SECRET=tu_api_secret
PORT=3000
```

---

## Límites Gratuitos (Más que suficiente):

✅ **MongoDB Atlas:**
- 512MB de almacenamiento (para metadatos, no hay problema)
- Shared cluster
- 3 nodos (redundancia automática)

✅ **Cloudinary:**
- 25GB de almacenamiento
- 25 millones de transformaciones de imágenes al mes
- Soporte para todos los formatos

Para una empresa con 100+ facturas/mes = perfectamente viable.

---

## Siguientes pasos:
1. Crea las cuentas siguiendo estos pasos
2. Copias tus credenciales en el archivo `.env`
3. Instala las dependencias nuevas: `npm install`
4. El servidor.js estará listo para usar MongoDB + Cloudinary
