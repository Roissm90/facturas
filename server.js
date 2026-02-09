const express = require('express');
const multer = require('multer');
const exifParser = require('exif-parser');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Servir archivos subidos públicamente desde /uploads
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
// Asegurar existencia de la carpeta uploads
fs.mkdirSync(path.join(__dirname, 'uploads'), { recursive: true });

// Use memory storage so we can inspect the buffer for EXIF and then write to disk.
const upload = multer({ storage: multer.memoryStorage() });

function getDateFromBuffer(file) {
  try {
    const parser = exifParser.create(file.buffer);
    const result = parser.parse();
    if (result && result.tags && result.tags.DateTimeOriginal) {
      return new Date(result.tags.DateTimeOriginal * 1000);
    }
  } catch (e) {
    // ignore
  }
  return null;
}

app.post('/upload', upload.array('files'), async (req, res) => {
  if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'No files uploaded' });

  const saved = [];

  // Si el cliente envía una fecha (YYYY-MM), usarla para organizar
  let clientYear = null;
  let clientMonth = null;
  if (req.body && req.body.invoiceDate) {
    const parts = String(req.body.invoiceDate).split('-');
    if (parts.length >= 2) {
      clientYear = parts[0];
      clientMonth = parts[1].padStart(2, '0');
    }
  }

  for (const file of req.files) {
    // prioridad: fecha enviada por cliente -> EXIF -> ahora
    let date = null;
    if (clientYear && clientMonth) {
      date = new Date(Number(clientYear), Number(clientMonth) - 1, 1);
    } else {
      date = getDateFromBuffer(file) || new Date();
    }

    const year = date.getFullYear().toString();
    const month = String(date.getMonth() + 1).padStart(2, '0');

    const destDir = path.join(__dirname, 'uploads', year, month);
    fs.mkdirSync(destDir, { recursive: true });

    // sanitize original name
    const name = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    // Si el archivo ya existe, añadir un sufijo para evitar conflictos
    let filename = name;
    let counter = 1;
    while (fs.existsSync(path.join(destDir, filename))) {
      const parts = name.split('.');
      const ext = parts.length > 1 ? '.' + parts.pop() : '';
      const base = parts.join('.');
      filename = `${base}_${counter}${ext}`;
      counter++;
    }
    const fullPath = path.join(destDir, filename);

    fs.writeFileSync(fullPath, file.buffer);

    saved.push({
      originalName: file.originalname,
      path: path.relative(__dirname, fullPath).replace(/\\/g, '/'),
      year,
      month
    });
  }

  res.json({ saved });
});

// Endpoint para borrar archivo por path relativo (p.ej. uploads/2026/04/file.pdf)
app.post('/delete', (req, res) => {
  try {
    const rel = req.body && req.body.path;
    if (!rel || typeof rel !== 'string') return res.status(400).json({ success: false, error: 'path missing' });
    // prevenir traversal: debe empezar por uploads/
    const clean = path.normalize(rel);
    if (!clean.startsWith('uploads' + path.sep) && !clean.startsWith('uploads/')) {
      return res.status(400).json({ success: false, error: 'invalid path' });
    }
    const full = path.join(__dirname, clean);
    if (!fs.existsSync(full)) return res.status(404).json({ success: false, error: 'not found' });
    fs.unlinkSync(full);
    // eliminar directorios vacíos hacia arriba hasta 'uploads'
    try {
      let dir = path.dirname(full);
      const uploadsDir = path.join(__dirname, 'uploads');
      while (dir.startsWith(uploadsDir) && dir !== uploadsDir) {
        const items = fs.readdirSync(dir);
        if (items.length === 0) {
          fs.rmdirSync(dir);
          dir = path.dirname(dir);
        } else break;
      }
    } catch (e) {
      console.error('cleanup dirs error', e);
    }
    return res.json({ success: true, deleted: path.basename(full) });
  } catch (e) {
    console.error('delete error', e);
    return res.status(500).json({ success: false, error: 'internal' });
  }
});

app.get('/list', (req, res) => {
  const base = path.join(__dirname, 'uploads');
  const tree = {};
  if (!fs.existsSync(base)) return res.json({ tree });
  // Si se proporcionan year y month como query, devolver solo ese mes
  const qYear = req.query.year;
  const qMonth = req.query.month;

  const years = fs.readdirSync(base, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name);
  for (const y of years) {
    const yearPath = path.join(base, y);
    tree[y] = {};
    const months = fs.readdirSync(yearPath, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name);
    for (const m of months) {
      if (qYear && qMonth) {
        if (y !== String(qYear) || m !== String(qMonth).padStart(2, '0')) continue;
      }
      const monthPath = path.join(yearPath, m);
      const files = fs.readdirSync(monthPath).map(f => ({ name: f, path: path.join('uploads', y, m, f).replace(/\\/g, '/') }));
      tree[y][m] = files;
    }
    // si se filtró y este año quedó vacío, eliminar la key
    if (qYear && Object.keys(tree[y]).length === 0) delete tree[y];
  }

  res.json({ tree });
});

app.listen(PORT, () => console.log(`Servidor escuchando en http://localhost:${PORT}`));
