require('dotenv').config();
const express = require('express');
const multer = require('multer');
const exifParser = require('exif-parser');
const path = require('path');
const cors = require('cors');
const mongoose = require('mongoose');
const crypto = require('crypto');
const cloudinary = require('cloudinary').v2;
const archiver = require('archiver');
const https = require('https');
const http = require('http');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// Public assets needed for the login page.
app.use('/assets', express.static(path.join(__dirname, 'public', 'assets')));
app.get('/styles.css', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'styles.css'));
});
app.get('/styles.css.map', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'styles.css.map'));
});

const AUTH_COOKIE = 'facturas_auth';
const APP_PASSWORD = process.env.APP_PASSWORD || '';
const AUTH_TOKEN = APP_PASSWORD
  ? crypto.createHash('sha256').update(APP_PASSWORD).digest('hex')
  : null;

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  header.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    out[key] = value;
  });
  return out;
}

function isAuthed(req) {
  if (!AUTH_TOKEN) return true;
  const cookies = parseCookies(req.headers.cookie);
  return cookies[AUTH_COOKIE] === AUTH_TOKEN;
}

if (AUTH_TOKEN) {
  app.use((req, res, next) => {
    if (req.path === '/login' || req.path === '/logout') return next();
    const ext = path.extname(req.path || '').toLowerCase();
    if (ext && ['.css', '.js', '.map', '.png', '.jpg', '.jpeg', '.svg', '.ico', '.webp', '.woff', '.woff2', '.ttf', '.eot'].includes(ext)) {
      return next();
    }
    if (isAuthed(req)) return next();
    if (req.method === 'GET' || req.method === 'HEAD') return res.redirect('/login');
    return res.status(401).json({ error: 'unauthorized' });
  });
}

app.get('/login', (req, res) => {
  if (isAuthed(req)) return res.redirect('/');
  return res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/login', (req, res) => {
  if (!AUTH_TOKEN) return res.redirect('/');
  const password = String((req.body && req.body.password) || '');
  const token = crypto.createHash('sha256').update(password).digest('hex');
  if (token !== AUTH_TOKEN) return res.status(401).send('Invalid password');
  res.cookie(AUTH_COOKIE, AUTH_TOKEN, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/'
  });
  return res.redirect('/');
});

app.get('/logout', (req, res) => {
  res.clearCookie(AUTH_COOKIE, { path: '/' });
  return res.redirect('/login');
});

app.use(express.static(path.join(__dirname, 'public')));

// Use memory storage so we can inspect the buffer for EXIF and then upload to Cloudinary.
const upload = multer({ storage: multer.memoryStorage() });

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const invoiceSchema = new mongoose.Schema({
  originalName: String,
  storedName: String,
  url: String,
  publicId: String,
  resourceType: String,
  accessMode: String,
  version: Number,
  year: String,
  month: String,
  createdAt: { type: Date, default: Date.now }
});

const Invoice = mongoose.model('Invoice', invoiceSchema);

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

function uploadBufferToCloudinary(file, folder, publicId, resourceType) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        resource_type: resourceType || 'auto',
        folder,
        public_id: publicId,
        overwrite: false
      },
      (err, result) => {
        if (err) return reject(err);
        return resolve(result);
      }
    );
    stream.end(file.buffer);
  });
}

app.post('/upload', upload.array('files'), async (req, res) => {
  if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'No files uploaded' });

  try {
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

      const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
      const ext = path.extname(safeName).replace('.', '').toLowerCase();
      const base = safeName.replace(/\.[^/.]+$/, '');
      const uniqueSuffix = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      const publicId = `${base}_${uniqueSuffix}`;
      const folder = `facturas/${year}/${month}`;
      const resourceType = ext === 'pdf' ? 'raw' : 'auto';

      const uploadResult = await uploadBufferToCloudinary(file, folder, publicId, resourceType);

      const doc = await Invoice.create({
        originalName: file.originalname,
        storedName: safeName,
        url: uploadResult.secure_url,
        publicId: uploadResult.public_id,
        resourceType: uploadResult.resource_type,
        accessMode: uploadResult.access_mode,
        version: uploadResult.version,
        year,
        month
      });

      saved.push({
        id: doc._id,
        name: doc.storedName,
        url: doc.url,
        year,
        month
      });
    }

    res.json({ saved });
  } catch (e) {
    console.error('upload error', e);
    res.status(500).json({ error: 'upload failed' });
  }
});

// Endpoint para borrar archivo por path relativo (p.ej. uploads/2026/04/file.pdf)
app.post('/delete', async (req, res) => {
  try {
    const id = req.body && req.body.id;
    if (!id || typeof id !== 'string') return res.status(400).json({ success: false, error: 'id missing' });

    const doc = await Invoice.findById(id);
    if (!doc) return res.status(404).json({ success: false, error: 'not found' });

    await cloudinary.uploader.destroy(doc.publicId, { resource_type: doc.resourceType || 'raw' });
    await doc.deleteOne();
    return res.json({ success: true, deleted: doc.storedName });
  } catch (e) {
    console.error('delete error', e);
    return res.status(500).json({ success: false, error: 'internal' });
  }
});

app.post('/delete/year', async (req, res) => {
  try {
    const year = req.body && req.body.year;
    if (!year || typeof year !== 'string') {
      return res.status(400).json({ success: false, error: 'year missing' });
    }

    const docs = await Invoice.find({ year }).lean();
    let deletedCount = 0;
    let failedCount = 0;

    for (const doc of docs) {
      try {
        await cloudinary.uploader.destroy(doc.publicId, { resource_type: doc.resourceType || 'raw' });
        await Invoice.deleteOne({ _id: doc._id });
        deletedCount++;
      } catch (e) {
        console.error('delete year item error', e);
        failedCount++;
      }
    }

    return res.json({ success: true, deletedCount, failedCount });
  } catch (e) {
    console.error('delete year error', e);
    return res.status(500).json({ success: false, error: 'internal' });
  }
});

app.get('/file/:id', async (req, res) => {
  try {
    const doc = await Invoice.findById(req.params.id).lean();
    if (!doc) return res.status(404).send('not found');

    const ext = path.extname(doc.storedName || '').replace('.', '').toLowerCase();
    const inferredType = ext === 'pdf' ? 'raw' : 'image';
    const publicUrl = doc.url || cloudinary.url(doc.publicId, {
      resource_type: doc.resourceType || inferredType,
      type: 'upload',
      secure: true,
      format: ext || undefined,
      version: doc.version || undefined
    });
    if (ext === 'pdf') return res.redirect(`/view/${doc._id}`);
    return res.redirect(publicUrl);
  } catch (e) {
    console.error('file error', e);
    return res.status(500).send('internal');
  }
});

app.get('/view/:id', async (req, res) => {
  try {
    const doc = await Invoice.findById(req.params.id).lean();
    if (!doc) return res.status(404).send('not found');

    const ext = path.extname(doc.storedName || '').replace('.', '').toLowerCase();
    const inferredType = ext === 'pdf' ? 'raw' : 'image';
    const publicUrl = doc.url || cloudinary.url(doc.publicId, {
      resource_type: doc.resourceType || inferredType,
      type: 'upload',
      secure: true,
      format: ext || undefined,
      version: doc.version || undefined
    });

    const client = publicUrl.startsWith('https:') ? https : http;
    client.get(publicUrl, (r) => {
      if (r.statusCode && r.statusCode >= 400) {
        res.status(r.statusCode).send('upstream error');
        r.resume();
        return;
      }
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'inline');
      r.pipe(res);
    }).on('error', (err) => {
      console.error('proxy error', err);
      res.status(500).send('internal');
    });
  } catch (e) {
    console.error('view error', e);
    return res.status(500).send('internal');
  }
});

function streamFromUrl(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https:') ? https : http;
    client
      .get(url, (r) => {
        if (r.statusCode && r.statusCode >= 400) {
          r.resume();
          return reject(new Error(`upstream status ${r.statusCode}`));
        }
        return resolve(r);
      })
      .on('error', reject);
  });
}

app.get('/download/year/:year', async (req, res) => {
  try {
    const year = String(req.params.year);
    const docs = await Invoice.find({ year }).sort({ month: 1, storedName: 1 }).lean();

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="facturas_${year}.zip"`);

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', (err) => {
      console.error('zip error', err);
      res.status(500).end();
    });
    archive.pipe(res);

    for (const doc of docs) {
      const month = doc.month || '00';
      const name = doc.storedName || `file_${doc._id}`;
      const safeName = name.replace(/[\\/:*?"<>|]+/g, '_');
      const ext = path.extname(safeName).replace('.', '').toLowerCase();
      const inferredType = ext === 'pdf' ? 'raw' : 'image';
      const publicUrl = doc.url || cloudinary.url(doc.publicId, {
        resource_type: doc.resourceType || inferredType,
        type: 'upload',
        secure: true,
        format: ext || undefined,
        version: doc.version || undefined
      });

      try {
        const stream = await streamFromUrl(publicUrl);
        archive.append(stream, { name: `${year}/${month}/${safeName}` });
      } catch (e) {
        console.error('zip file error', e);
      }
    }

    await archive.finalize();
  } catch (e) {
    console.error('download year error', e);
    return res.status(500).send('internal');
  }
});

app.get('/list', async (req, res) => {
  try {
    const tree = {};
    const qYear = req.query.year;
    const qMonth = req.query.month;
    const filter = {};
    if (qYear) filter.year = String(qYear);
    if (qMonth) filter.month = String(qMonth).padStart(2, '0');

    const docs = await Invoice.find(filter).sort({ createdAt: -1 }).lean();
    for (const doc of docs) {
      const y = doc.year;
      const m = doc.month;
      if (!tree[y]) tree[y] = {};
      if (!tree[y][m]) tree[y][m] = [];
      tree[y][m].push({
        id: String(doc._id),
        name: doc.storedName
      });
    }

    res.json({ tree });
  } catch (e) {
    console.error('list error', e);
    res.status(500).json({ error: 'list failed' });
  }
});
async function start() {
  if (!process.env.MONGODB_URI) throw new Error('Missing MONGODB_URI');
  if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
    throw new Error('Missing Cloudinary env vars');
  }
  await mongoose.connect(process.env.MONGODB_URI);
  app.listen(PORT, () => console.log(`Servidor escuchando en http://localhost:${PORT}`));
}

start().catch((e) => {
  console.error('Startup error', e);
  process.exit(1);
});
