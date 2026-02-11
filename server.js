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
const ExcelJS = require('exceljs');
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
const INVOICE_DATA_KEY = process.env.INVOICE_DATA_KEY || '';
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
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
    path: '/',
    maxAge: ONE_DAY_MS
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
  invoiceDateEnc: String,
  invoiceNumberEnc: String,
  nifEnc: String,
  legalNameEnc: String,
  baseCategoryEnc: String,
  baseAmountEnc: String,
  vatRateEnc: String,
  vatDeductibleEnc: String,
  vatNonDeductibleEnc: String,
  totalAmountEnc: String,
  invoiceDateSort: Date,
  year: String,
  month: String,
  createdAt: { type: Date, default: Date.now }
});

const Invoice = mongoose.model('Invoice', invoiceSchema);

const monthlySummarySchema = new mongoose.Schema(
  {
    year: { type: String, required: true },
    month: { type: String, required: true },
    incomeCents: { type: Number, default: 0 },
    otherExpenseCents: { type: Number, default: 0 }
  },
  { timestamps: true }
);

monthlySummarySchema.index({ year: 1, month: 1 }, { unique: true });

const MonthlySummary = mongoose.model('MonthlySummary', monthlySummarySchema);

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

function getInvoiceKey() {
  return crypto.createHash('sha256').update(INVOICE_DATA_KEY).digest();
}

function encryptText(value) {
  if (!value) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getInvoiceKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

function decryptText(value) {
  if (!value) return '';
  const parts = String(value).split(':');
  if (parts.length !== 3) return '';
  const [ivB64, tagB64, dataB64] = parts;
  try {
    const iv = Buffer.from(ivB64, 'base64');
    const tag = Buffer.from(tagB64, 'base64');
    const data = Buffer.from(dataB64, 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', getInvoiceKey(), iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
    return decrypted.toString('utf8');
  } catch (e) {
    return '';
  }
}

function parseDateInput(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function parseDateFlexible(value) {
  if (!value) return null;
  const iso = parseDateInput(value);
  if (iso) return iso;
  const str = String(value);
  const matchLong = str.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (matchLong) {
    const day = Number(matchLong[1]);
    const month = Number(matchLong[2]) - 1;
    const year = Number(matchLong[3]);
    const parsed = new Date(year, month, day);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  const matchShort = str.match(/^(\d{2})\/(\d{2})\/(\d{2})$/);
  if (matchShort) {
    const day = Number(matchShort[1]);
    const month = Number(matchShort[2]) - 1;
    const year = 2000 + Number(matchShort[3]);
    const parsed = new Date(year, month, day);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return null;
}

function buildSortKey(dateValue) {
  if (!dateValue) return 0;
  const parsed = new Date(dateValue);
  if (Number.isNaN(parsed.getTime())) return 0;
  const y = parsed.getFullYear();
  const m = String(parsed.getMonth() + 1).padStart(2, '0');
  const d = String(parsed.getDate()).padStart(2, '0');
  return Number(`${y}${m}${d}`);
}

function formatDateDDMMYYYY(value) {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  const d = String(parsed.getDate()).padStart(2, '0');
  const m = String(parsed.getMonth() + 1).padStart(2, '0');
  const y = parsed.getFullYear();
  return `${d}/${m}/${y}`;
}

function formatDateYYYYMMDD(value) {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  const d = String(parsed.getDate()).padStart(2, '0');
  const m = String(parsed.getMonth() + 1).padStart(2, '0');
  const y = parsed.getFullYear();
  return `${y}-${m}-${d}`;
}

function sanitizeFilename(name) {
  return String(name || '').replace(/[^a-zA-Z0-9._-]/g, '_');
}

function parseAmountToCents(value) {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  const cleaned = trimmed.replace(/[^0-9,.-]/g, '');
  if (!cleaned) return null;

  const hasComma = cleaned.includes(',');
  const hasDot = cleaned.includes('.');
  let normalized = cleaned;

  if (hasComma && hasDot) {
    const lastComma = cleaned.lastIndexOf(',');
    const lastDot = cleaned.lastIndexOf('.');
    if (lastComma > lastDot) {
      normalized = cleaned.replace(/\./g, '').replace(',', '.');
    } else {
      normalized = cleaned.replace(/,/g, '');
    }
  } else if (hasComma) {
    normalized = cleaned.replace(',', '.');
  }

  const num = Number.parseFloat(normalized);
  if (Number.isNaN(num)) return null;
  return Math.round(num * 100);
}

function formatCentsToAmount(cents) {
  const value = (cents || 0) / 100;
  return value.toFixed(2).replace('.', ',');
}

function parseCentsInput(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.round(value);
  }
  return parseAmountToCents(value);
}

app.post('/upload', upload.array('files'), async (req, res) => {
  if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'No files uploaded' });

  try {
    const saved = [];
    let metaList = [];
    if (req.body && req.body.meta) {
      try {
        metaList = JSON.parse(req.body.meta);
      } catch (e) {
        metaList = [];
      }
    }

    for (let i = 0; i < req.files.length; i++) {
      const file = req.files[i];
      const meta = metaList[i] || {};
      const invoiceDateRaw = meta.invoiceDate ? String(meta.invoiceDate) : '';
      const invoiceDateParsed = parseDateInput(invoiceDateRaw);

      // prioridad: fecha enviada por cliente -> EXIF -> ahora
      let date = null;
      if (invoiceDateParsed) {
        date = invoiceDateParsed;
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
        invoiceDateEnc: encryptText(invoiceDateRaw),
        invoiceNumberEnc: encryptText(meta.invoiceNumber),
        nifEnc: encryptText(meta.nif),
        legalNameEnc: encryptText(meta.razonSocial),
        baseCategoryEnc: encryptText(meta.baseCategory),
        baseAmountEnc: encryptText(meta.baseAmount),
        vatRateEnc: encryptText(meta.vatRate),
        vatDeductibleEnc: encryptText(meta.vatDeductible),
        vatNonDeductibleEnc: encryptText(meta.vatNonDeductible),
        totalAmountEnc: encryptText(meta.totalAmount),
        invoiceDateSort: date,
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

app.get('/invoice/:id', async (req, res) => {
  try {
    console.log('Fetching invoice with ID:', req.params.id);
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      console.log('Invalid ObjectId format');
      return res.status(400).json({ error: 'invalid id format' });
    }

    const doc = await Invoice.findById(req.params.id).lean();
    if (!doc) {
      console.log('Invoice not found');
      return res.status(404).json({ error: 'not found' });
    }

    const rawDate = decryptText(doc.invoiceDateEnc);
    const parsedDate = parseDateInput(rawDate) || parseDateFlexible(rawDate) || doc.invoiceDateSort || null;
    const invoiceDate = parsedDate ? formatDateYYYYMMDD(parsedDate) : '';

    console.log('Invoice found, returning data');
    return res.json({
      id: String(doc._id),
      storedName: doc.storedName || '',
      invoiceDate,
      invoiceNumber: decryptText(doc.invoiceNumberEnc),
      nif: decryptText(doc.nifEnc),
      legalName: decryptText(doc.legalNameEnc),
      baseCategory: decryptText(doc.baseCategoryEnc),
      baseAmount: decryptText(doc.baseAmountEnc),
      vatRate: decryptText(doc.vatRateEnc),
      vatDeductible: decryptText(doc.vatDeductibleEnc),
      vatNonDeductible: decryptText(doc.vatNonDeductibleEnc),
      totalAmount: decryptText(doc.totalAmountEnc)
    });
  } catch (e) {
    console.error('invoice fetch error', e);
    return res.status(500).json({ error: 'internal' });
  }
});

app.post('/invoice/:id', async (req, res) => {
  try {
    const doc = await Invoice.findById(req.params.id);
    if (!doc) return res.status(404).json({ success: false, error: 'not found' });

    const storedName = req.body && req.body.storedName ? sanitizeFilename(req.body.storedName) : doc.storedName;
    const invoiceDateRaw = req.body && req.body.invoiceDate ? String(req.body.invoiceDate) : '';
    const invoiceNumber = req.body && req.body.invoiceNumber ? String(req.body.invoiceNumber) : '';
    const nif = req.body && req.body.nif ? String(req.body.nif) : '';
    const legalName = req.body && req.body.legalName ? String(req.body.legalName) : '';
    const baseCategory = req.body && req.body.baseCategory ? String(req.body.baseCategory) : '';
    const baseAmount = req.body && req.body.baseAmount ? String(req.body.baseAmount) : '';
    const vatRate = req.body && req.body.vatRate ? String(req.body.vatRate) : '';
    const vatDeductible = req.body && req.body.vatDeductible ? String(req.body.vatDeductible) : '';
    const vatNonDeductible = req.body && req.body.vatNonDeductible ? String(req.body.vatNonDeductible) : '';
    const totalAmount = req.body && req.body.totalAmount ? String(req.body.totalAmount) : '';

    doc.storedName = storedName;
    doc.invoiceDateEnc = encryptText(invoiceDateRaw);
    doc.invoiceNumberEnc = encryptText(invoiceNumber);
    doc.nifEnc = encryptText(nif);
    doc.legalNameEnc = encryptText(legalName);
    doc.baseCategoryEnc = encryptText(baseCategory);
    doc.baseAmountEnc = encryptText(baseAmount);
    doc.vatRateEnc = encryptText(vatRate);
    doc.vatDeductibleEnc = encryptText(vatDeductible);
    doc.vatNonDeductibleEnc = encryptText(vatNonDeductible);
    doc.totalAmountEnc = encryptText(totalAmount);

    const parsedDate = parseDateInput(invoiceDateRaw) || parseDateFlexible(invoiceDateRaw);
    if (parsedDate) {
      doc.invoiceDateSort = parsedDate;
      doc.year = String(parsedDate.getFullYear());
      doc.month = String(parsedDate.getMonth() + 1).padStart(2, '0');
    }

    await doc.save();
    return res.json({ success: true });
  } catch (e) {
    console.error('invoice update error', e);
    return res.status(500).json({ success: false, error: 'internal' });
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

const baseCategoryHeaders = [
  'Compras',
  'Transportes y fletes',
  'Agentes mediadores',
  'Sueldos y salarios',
  'Seg. Social y autonomos',
  'Trabajos realizados por otras empresas',
  'Energía y agua de instalaciones',
  'Alquileres de locales',
  'Canon explotaciones',
  'Gastos financieros',
  'Primas seguros, bienes o productos',
  'Tributos no estatales',
  'Reparaciones y conservación',
  'Otros gastos'
];

const baseCategoryKeyMap = Object.fromEntries(
  baseCategoryHeaders.map((header, index) => [header, `cat_${index}`])
);

function buildInvoiceRows(docs) {
  return docs.map((doc) => {
    const decryptedDate = decryptText(doc.invoiceDateEnc);
    const parsedDate = parseDateFlexible(decryptedDate) || doc.invoiceDateSort || doc.createdAt || null;
    const sortKey = buildSortKey(parsedDate);
    const displayDate = parsedDate ? formatDateDDMMYYYY(parsedDate) : formatDateDDMMYYYY(decryptedDate);
    const categoryColumns = Object.fromEntries(
      baseCategoryHeaders.map((header) => [baseCategoryKeyMap[header], ''])
    );
    const selectedCategory = decryptText(doc.baseCategoryEnc);
    const categoryKey = baseCategoryKeyMap[selectedCategory];
    if (categoryKey && Object.prototype.hasOwnProperty.call(categoryColumns, categoryKey)) {
      categoryColumns[categoryKey] = decryptText(doc.baseAmountEnc);
    }

    const storedName = doc.storedName || '';
    const conceptName = storedName.replace(/\.[^/.]+$/, '').replace(/_/g, ' ');

    return {
      sortKey,
      row: {
        order: '',
        date: displayDate,
        invoiceNumber: decryptText(doc.invoiceNumberEnc),
        concept: conceptName,
        nif: decryptText(doc.nifEnc),
        legalName: decryptText(doc.legalNameEnc),
        ...categoryColumns,
        vatRate: decryptText(doc.vatRateEnc),
        vatDeductible: decryptText(doc.vatDeductibleEnc),
        vatNonDeductible: decryptText(doc.vatNonDeductibleEnc),
        totalAmount: decryptText(doc.totalAmountEnc)
      }
    };
  });
}

async function buildExcelBuffer(rows, sheetName) {
  const workbook = new ExcelJS.Workbook();
  const columns = [
    { header: 'Nº Orden', key: 'order' },
    { header: 'Fecha', key: 'date' },
    { header: 'Nº Factura', key: 'invoiceNumber' },
    { header: 'Concepto', key: 'concept' },
    { header: 'NIF', key: 'nif' },
    { header: 'Razón Social', key: 'legalName' },
    ...baseCategoryHeaders.map((header) => ({ header, key: baseCategoryKeyMap[header] })),
    { header: 'Tipo', key: 'vatRate' },
    { header: 'IVA deducible', key: 'vatDeductible' },
    { header: 'IVA no deducible', key: 'vatNonDeductible' },
    { header: 'Importe total', key: 'totalAmount' }
  ];
  const headers = columns.map((column) => column.header);
  const worksheet = workbook.addWorksheet(sheetName || 'Facturas');
  worksheet.properties.defaultRowHeight = 42;

  worksheet.columns = columns;
  rows.forEach((row) => worksheet.addRow(row));

  const totals = rows.reduce(
    (acc, row) => {
      for (const category of baseCategoryHeaders) {
        acc.category[category] += parseAmountToCents(row[baseCategoryKeyMap[category]]) || 0;
      }
      const ded = parseAmountToCents(row.vatDeductible) || 0;
      const nonDed = parseAmountToCents(row.vatNonDeductible) || 0;
      const total = parseAmountToCents(row.totalAmount) || 0;
      return {
        category: acc.category,
        ded: acc.ded + ded,
        nonDed: acc.nonDed + nonDed,
        total: acc.total + total
      };
    },
    {
      category: Object.fromEntries(baseCategoryHeaders.map((header) => [header, 0])),
      ded: 0,
      nonDed: 0,
      total: 0
    }
  );

  const totalRowData = Object.fromEntries(columns.map((column) => [column.key, '']));
  totalRowData.order = 'Totales';
  for (const category of baseCategoryHeaders) {
    totalRowData[baseCategoryKeyMap[category]] = formatCentsToAmount(totals.category[category]);
  }
  totalRowData.vatDeductible = formatCentsToAmount(totals.ded);
  totalRowData.vatNonDeductible = formatCentsToAmount(totals.nonDed);
  totalRowData.totalAmount = formatCentsToAmount(totals.total);
  const totalRow = worksheet.addRow(totalRowData);

  const headerRow = worksheet.getRow(1);
  headerRow.eachCell((cell) => {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF000000' }
    };
    cell.font = { color: { argb: 'FFFFFFFF' }, bold: true };
  });

  totalRow.eachCell((cell) => {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF3E9600' }
    };
    cell.font = { color: { argb: 'FFFFFFFF' }, bold: true };
  });

  const maxLengths = headers.map((header) => String(header).length);
  worksheet.eachRow((row) => {
    row.height = 32;
    row.eachCell((cell, colNumber) => {
      const value = cell.value === null || cell.value === undefined ? '' : String(cell.value);
      if (value.length > maxLengths[colNumber - 1]) {
        maxLengths[colNumber - 1] = value.length;
      }
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
    });
  });

  worksheet.columns.forEach((column, index) => {
    column.width = maxLengths[index] + 2;
  });

  return workbook.xlsx.writeBuffer();
}

app.get('/export/year/:year', async (req, res) => {
  try {
    const year = String(req.params.year);
    const docs = await Invoice.find({ year }).lean();
    const rows = buildInvoiceRows(docs)
      .sort((a, b) => a.sortKey - b.sortKey)
      .map((item, index) => ({
        ...item.row,
        order: String(index + 1)
      }));
    const buffer = await buildExcelBuffer(rows, `Facturas ${year}`);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="facturas_${year}.xlsx"`);
    res.setHeader('Cache-Control', 'no-store');
    return res.end(buffer);
  } catch (e) {
    console.error('export year error', e);
    return res.status(500).send('internal');
  }
});

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

app.get('/income/year/:year', async (req, res) => {
  try {
    const year = String(req.params.year);
    const months = Object.fromEntries(
      Array.from({ length: 12 }, (_, i) => {
        const key = String(i + 1).padStart(2, '0');
        return [key, { expensesCents: 0, incomeCents: 0, otherExpenseCents: null }];
      })
    );

    const invoices = await Invoice.find({ year }).lean();
    for (const doc of invoices) {
      const month = String(doc.month || '').padStart(2, '0');
      if (!months[month]) continue;
      const totalText = decryptText(doc.totalAmountEnc);
      const cents = parseAmountToCents(totalText) || 0;
      months[month].expensesCents += cents;
    }

    const summaries = await MonthlySummary.find({ year }).lean();
    for (const summary of summaries) {
      const month = String(summary.month || '').padStart(2, '0');
      if (!months[month]) continue;
      months[month].incomeCents = summary.incomeCents || 0;
      months[month].otherExpenseCents = summary.otherExpenseCents || 0;
    }

    return res.json({ year, months });
  } catch (e) {
    console.error('income year error', e);
    return res.status(500).json({ error: 'income failed' });
  }
});

app.post('/income/month', async (req, res) => {
  try {
    const year = req.body && req.body.year ? String(req.body.year) : '';
    const monthRaw = req.body && req.body.month ? String(req.body.month) : '';
    if (!year || !monthRaw) {
      return res.status(400).json({ success: false, error: 'year or month missing' });
    }
    const month = monthRaw.padStart(2, '0');

    const update = {};
    if (Object.prototype.hasOwnProperty.call(req.body, 'incomeCents') || Object.prototype.hasOwnProperty.call(req.body, 'income')) {
      const incomeValue = Object.prototype.hasOwnProperty.call(req.body, 'incomeCents') ? req.body.incomeCents : req.body.income;
      const cents = parseCentsInput(incomeValue);
      update.incomeCents = cents === null ? 0 : cents;
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'otherExpenseCents') || Object.prototype.hasOwnProperty.call(req.body, 'otherExpense')) {
      const otherValue = Object.prototype.hasOwnProperty.call(req.body, 'otherExpenseCents') ? req.body.otherExpenseCents : req.body.otherExpense;
      const cents = parseCentsInput(otherValue);
      update.otherExpenseCents = cents === null ? 0 : cents;
    }

    if (Object.keys(update).length === 0) {
      return res.status(400).json({ success: false, error: 'no fields to update' });
    }

    const doc = await MonthlySummary.findOneAndUpdate(
      { year, month },
      { $set: update },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();

    return res.json({
      success: true,
      data: {
        year: doc.year,
        month: doc.month,
        incomeCents: doc.incomeCents || 0,
        otherExpenseCents: doc.otherExpenseCents || 0
      }
    });
  } catch (e) {
    console.error('income month error', e);
    return res.status(500).json({ success: false, error: 'income save failed' });
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
  if (!INVOICE_DATA_KEY) throw new Error('Missing INVOICE_DATA_KEY');
  await mongoose.connect(process.env.MONGODB_URI);
  app.listen(PORT, () => console.log(`Servidor escuchando en http://localhost:${PORT}`));
}

start().catch((e) => {
  console.error('Startup error', e);
  process.exit(1);
});
