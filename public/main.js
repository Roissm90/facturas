const drop = document.getElementById('drop-zone');
const input = document.getElementById('file-input');
const preview = document.getElementById('preview');
const uploadBtn = document.getElementById('upload-btn');
const result = document.getElementById('result');
const resultIncome = document.getElementById('resultIncome');
const incomeTitle = document.getElementById('income-title');
const OTHER_EXPENSE_MIN_CENTS = 80000;

// Nombres de meses en español (índice 0 = enero)
const monthNames = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

// Referencias al modal de renombrado
const renameModal = document.getElementById('rename-modal');
const modalList = document.getElementById('modal-list');
const modalCancel = document.getElementById('modal-cancel');
const modalConfirm = document.getElementById('modal-confirm');
const modalError = document.getElementById('modal-error');

// Referencias al modal de edicion
const editModal = document.getElementById('edit-modal');
const editModalList = document.getElementById('edit-modal-list');
const editModalCancel = document.getElementById('edit-modal-cancel');
const editModalConfirm = document.getElementById('edit-modal-confirm');
const editModalError = document.getElementById('edit-modal-error');

// Estado de filtrado
let selectedYear = null;
let selectedMonth = null;
let allTree = {}; // árbol completo de archivos
let incomeRequestId = 0;
let editInvoice = null;

// Referencias modal de borrado
const deleteModal = document.getElementById('delete-modal');
const deleteModalMessage = document.getElementById('delete-modal-message');
const deleteModalConfirm = document.getElementById('delete-modal-confirm');
const deleteModalCancel = document.getElementById('delete-modal-cancel');
let pendingDeletePath = null;

// Modal descarga completada
const downloadModal = document.getElementById('download-modal');
const downloadModalMessage = document.getElementById('download-modal-message');
const downloadModalConfirm = document.getElementById('download-modal-confirm');
const downloadModalCancel = document.getElementById('download-modal-cancel');
let pendingDeleteYear = null;
const baseCategoryOptions = [
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
// Función auxiliar para extraer extensión y nombre base
function getFileExtension(filename) {
  const idx = filename.lastIndexOf('.');
  if (idx === -1) return { baseName: filename, extension: '' };
  return { baseName: filename.substring(0, idx), extension: filename.substring(idx) };
}

// filesToUpload: array de objetos { file, originalName, baseName, extension, name (nombre base editable) }
let filesToUpload = [];

function getTodayDateString() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function setUploadButtonLabel(isLoading) {
  if (!uploadBtn) return;
  if (isLoading) {
    uploadBtn.innerText = 'Subiendo...';
  } else {
    uploadBtn.innerHTML = '<i data-feather="upload"></i> <span class="text">Subir archivos</span>';
    if (window.feather && typeof window.feather.replace === 'function') {
      try { window.feather.replace(); } catch (e) { /* ignore */ }
    }
  }
}

function renderPreview() {
  preview.innerHTML = '';
  filesToUpload.forEach((f, i) => {
    const el = document.createElement('div');
    el.className = 'preview-item';

    const left = document.createElement('div');
    left.className = 'preview-item__name-section';

    const nameInput = document.createElement('input');
    nameInput.className = 'rename-input';
    nameInput.value = f.name || f.baseName;
    nameInput.placeholder = 'Nombre (sin extensión)';
    nameInput.oninput = (e) => { f.name = e.target.value; };

    const ext = document.createElement('div');
    ext.className = 'preview-item__extension';
    ext.innerText = f.extension || '';

    const orig = document.createElement('div');
    orig.className = 'original-name';
    orig.title = f.originalName;
    orig.innerText = f.originalName;

    left.appendChild(nameInput);
    left.appendChild(ext);
    left.appendChild(orig);

    const btn = document.createElement('button');
    btn.className = 'preview-item__remove-btn';
    btn.innerText = 'Quitar';
    btn.onclick = () => { filesToUpload.splice(i,1); renderPreview(); };

    el.appendChild(left);
    el.appendChild(btn);
    preview.appendChild(el);
  });
  uploadBtn.disabled = filesToUpload.length === 0;
  if (filesToUpload.length > 0) setUploadButtonLabel(false);
}

drop.addEventListener('click', () => input.click());

drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('dragover'); });
drop.addEventListener('dragleave', () => drop.classList.remove('dragover'));
drop.addEventListener('drop', (e) => {
  e.preventDefault(); drop.classList.remove('dragover');
  const dropped = Array.from(e.dataTransfer.files);
  const wrapped = dropped.map(f => {
    const { baseName, extension } = getFileExtension(f.name);
    return {
      file: f,
      originalName: f.name,
      baseName,
      extension,
      name: baseName,
      invoiceDate: getTodayDateString(),
      invoiceNumber: '',
      nif: '',
      razonSocial: '',
      baseCategory: '',
      baseAmount: '',
      vatRate: '',
      vatDeductible: '',
      vatNonDeductible: '',
      totalAmount: '',
      isFuel: false
    };
  });
  filesToUpload.push(...wrapped);
  renderPreview();
});

input.addEventListener('change', (e) => {
  const added = Array.from(e.target.files).map(f => {
    const { baseName, extension } = getFileExtension(f.name);
    return {
      file: f,
      originalName: f.name,
      baseName,
      extension,
      name: baseName,
      invoiceDate: getTodayDateString(),
      invoiceNumber: '',
      nif: '',
      razonSocial: '',
      baseCategory: '',
      baseAmount: '',
      vatRate: '',
      vatDeductible: '',
      vatNonDeductible: '',
      totalAmount: '',
      isFuel: false
    };
  });
  filesToUpload.push(...added);
  input.value = '';
  renderPreview();
});

// Abrir modal para confirmar/renombrar antes de subir
uploadBtn.addEventListener('click', () => {
  if (!renameModal || !modalList) {
    // fallback: si no existe modal, enviar directamente
    modalConfirmUpload();
    return;
  }
  setModalError('');
  modalList.innerHTML = '';
  filesToUpload.forEach((fObj, i) => {
    const row = document.createElement('div');
    row.className = 'file-row';

    const orig = document.createElement('div');
    orig.className = 'original-name';
    orig.innerText = fObj.originalName;

    const renameField = document.createElement('div');
    renameField.className = 'rename-field';
    const renameLabel = document.createElement('label');
    renameLabel.innerText = 'Concepto';
    const inp = document.createElement('input');
    inp.className = 'rename-input';
    inp.value = fObj.name || fObj.baseName;
    inp.placeholder = 'Nombre (sin extensión)';
    inp.oninput = (e) => { fObj.name = e.target.value; };
    renameField.appendChild(renameLabel);
    renameField.appendChild(inp);

    const ext = document.createElement('div');
    ext.className = 'file-row__extension';
    ext.innerText = fObj.extension || '';

    const fields = document.createElement('div');
    fields.className = 'invoice-fields';

    const dateField = document.createElement('div');
    dateField.className = 'invoice-field';
    const dateLabel = document.createElement('label');
    dateLabel.innerText = 'Fecha factura';
    const dateInput = document.createElement('input');
    dateInput.type = 'date';
    dateInput.value = fObj.invoiceDate || '';
    dateInput.required = true;
    dateInput.oninput = (e) => { fObj.invoiceDate = e.target.value; };
    dateField.appendChild(dateLabel);
    dateField.appendChild(dateInput);

    const numberField = document.createElement('div');
    numberField.className = 'invoice-field';
    const numberLabel = document.createElement('label');
    numberLabel.innerText = 'Nº factura';
    const numberInput = document.createElement('input');
    numberInput.type = 'text';
    numberInput.value = fObj.invoiceNumber || '';
    numberInput.placeholder = 'Ej: F-2026-001';
    numberInput.required = true;
    numberInput.oninput = (e) => { fObj.invoiceNumber = e.target.value; };
    numberField.appendChild(numberLabel);
    numberField.appendChild(numberInput);

    const nifField = document.createElement('div');
    nifField.className = 'invoice-field';
    const nifLabel = document.createElement('label');
    nifLabel.innerText = 'NIF';
    const nifInput = document.createElement('input');
    nifInput.type = 'text';
    nifInput.value = fObj.nif || '';
    nifInput.placeholder = 'Ej: B12345678';
    nifInput.required = true;
    nifInput.oninput = (e) => { fObj.nif = e.target.value; };
    nifField.appendChild(nifLabel);
    nifField.appendChild(nifInput);

    const legalNameField = document.createElement('div');
    legalNameField.className = 'invoice-field';
    const legalNameLabel = document.createElement('label');
    legalNameLabel.innerText = 'Razón Social';
    const legalNameInput = document.createElement('input');
    legalNameInput.type = 'text';
    legalNameInput.value = fObj.razonSocial || '';
    legalNameInput.placeholder = 'Ej: Empresa Ejemplo';
    legalNameInput.required = true;
    legalNameInput.oninput = (e) => { fObj.razonSocial = e.target.value; };
    legalNameField.appendChild(legalNameLabel);
    legalNameField.appendChild(legalNameInput);

    const baseField = document.createElement('div');
    baseField.className = 'invoice-field';
    const baseLabel = document.createElement('label');
    baseLabel.innerText = 'Base imponible';
    const baseSelect = document.createElement('select');
    baseSelect.value = fObj.baseCategory || '';
    baseSelect.required = true;
    const baseSelectPlaceholder = document.createElement('option');
    baseSelectPlaceholder.value = '';
    baseSelectPlaceholder.innerText = 'Selecciona categoria';
    baseSelect.appendChild(baseSelectPlaceholder);
    baseCategoryOptions.forEach((optionLabel) => {
      const option = document.createElement('option');
      option.value = optionLabel;
      option.innerText = optionLabel;
      baseSelect.appendChild(option);
    });
    baseSelect.oninput = (e) => { fObj.baseCategory = e.target.value; };
    const baseInput = document.createElement('input');
    baseInput.type = 'text';
    baseInput.value = fObj.baseAmount || '';
    baseInput.placeholder = 'Ej: 1200,50';
    baseInput.required = true;
    baseInput.oninput = (e) => { fObj.baseAmount = e.target.value; };
    baseField.appendChild(baseLabel);
    baseField.appendChild(baseSelect);
    baseField.appendChild(baseInput);

    const vatField = document.createElement('div');
    vatField.className = 'invoice-field';
    const vatLabel = document.createElement('label');
    vatLabel.innerText = 'Tipo IVA';
    const vatInput = document.createElement('input');
    vatInput.type = 'text';
    vatInput.inputMode = 'decimal';
    vatInput.value = fObj.vatRate || '';
    vatInput.placeholder = 'Ej: 21';
    vatInput.required = true;
    vatInput.oninput = (e) => { fObj.vatRate = e.target.value; };
    vatField.appendChild(vatLabel);
    vatField.appendChild(vatInput);

    const dedField = document.createElement('div');
    dedField.className = 'invoice-field';
    const dedLabel = document.createElement('label');
    dedLabel.innerText = 'IVA deducible';
    const dedInput = document.createElement('input');
    dedInput.type = 'text';
    dedInput.value = fObj.vatDeductible || '';
    dedInput.placeholder = 'Opcional';
    dedInput.oninput = (e) => { fObj.vatDeductible = e.target.value; };
    dedField.appendChild(dedLabel);
    dedField.appendChild(dedInput);

    const nonDedField = document.createElement('div');
    nonDedField.className = 'invoice-field';
    const nonDedLabel = document.createElement('label');
    nonDedLabel.innerText = 'IVA no deducible';
    const nonDedInput = document.createElement('input');
    nonDedInput.type = 'text';
    nonDedInput.value = fObj.vatNonDeductible || '';
    nonDedInput.placeholder = 'Opcional';
    nonDedInput.oninput = (e) => { fObj.vatNonDeductible = e.target.value; };
    nonDedField.appendChild(nonDedLabel);
    nonDedField.appendChild(nonDedInput);

    const totalField = document.createElement('div');
    totalField.className = 'invoice-field';
    const totalLabel = document.createElement('label');
    totalLabel.innerText = 'Importe total';
    const totalInput = document.createElement('input');
    totalInput.type = 'text';
    totalInput.value = fObj.totalAmount || '';
    totalInput.placeholder = 'Ej: 1452,61';
    totalInput.required = true;
    totalInput.oninput = (e) => { fObj.totalAmount = e.target.value; };
    totalField.appendChild(totalLabel);
    totalField.appendChild(totalInput);

    const fuelField = document.createElement('div');
    fuelField.className = 'invoice-field invoice-field--checkbox';
    const fuelLabel = document.createElement('label');
    fuelLabel.innerText = 'Combustible';
    const fuelInput = document.createElement('input');
    fuelInput.type = 'checkbox';
    fuelInput.checked = Boolean(fObj.isFuel);
    fuelInput.onchange = (e) => { fObj.isFuel = e.target.checked; };
    fuelField.appendChild(fuelLabel);
    fuelField.appendChild(fuelInput);

    fields.appendChild(dateField);
    fields.appendChild(numberField);
    fields.appendChild(nifField);
    fields.appendChild(legalNameField);
    fields.appendChild(baseField);
    fields.appendChild(vatField);
    fields.appendChild(dedField);
    fields.appendChild(nonDedField);
    fields.appendChild(totalField);
    fields.appendChild(fuelField);

    row.appendChild(orig);
    row.appendChild(renameField);
    row.appendChild(ext);
    row.appendChild(fields);
    modalList.appendChild(row);
  });
  renameModal.style.display = 'flex';
});

// Cancelar modal
if (modalCancel) modalCancel.addEventListener('click', () => {
  setModalError('');
  renameModal.style.display = 'none';
});

// Confirmar y subir
if (modalConfirm) modalConfirm.addEventListener('click', async () => {
  const ok = await modalConfirmUpload();
  if (ok) {
    renameModal.style.display = 'none';
    setModalError('');
  }
});

async function modalConfirmUpload() {
  const fd = new FormData();
  if (!validateInvoiceMeta()) return false;
  const meta = filesToUpload.map((fObj) => ({
    invoiceDate: fObj.invoiceDate || '',
    invoiceNumber: fObj.invoiceNumber || '',
    nif: fObj.nif || '',
    razonSocial: fObj.razonSocial || '',
    baseCategory: fObj.baseCategory || '',
    baseAmount: fObj.baseAmount || '',
    vatRate: fObj.vatRate || '',
    vatDeductible: fObj.vatDeductible || '',
    vatNonDeductible: fObj.vatNonDeductible || '',
    totalAmount: fObj.totalAmount || '',
    isFuel: Boolean(fObj.isFuel)
  }));
  fd.append('meta', JSON.stringify(meta));
  // Reconstruir nombre con extensión original preservada
  filesToUpload.forEach(fObj => {
    const finalName = (fObj.name || fObj.baseName) + fObj.extension;
    fd.append('files', fObj.file, finalName);
  });
  uploadBtn.disabled = true;
  setUploadButtonLabel(true);
  setModalError('');
  try {
    const resp = await fetch('/upload', { method: 'POST', body: fd });
    let data = null;
    try {
      data = await resp.json();
    } catch (e) {
      data = null;
    }

    if (!resp.ok) {
      const msg = data && data.error ? data.error : 'Error al subir las facturas';
      setModalError(msg);
      return false;
    }

    if (data && data.error) {
      setModalError(data.error);
      return false;
    }

    result.innerText = JSON.stringify(data, null, 2);
    filesToUpload = [];
    renderPreview();
    // Recargar lista de archivos
    fetchList();
    return true;
  } catch (e) {
    setModalError('Error al subir las facturas');
    return false;
  } finally {
    uploadBtn.disabled = filesToUpload.length === 0;
    setUploadButtonLabel(false);
  }
}

function validateInvoiceMeta() {
  for (const fObj of filesToUpload) {
    const nameHint = fObj.name || fObj.baseName || fObj.originalName || 'archivo';
    if (!fObj.invoiceDate) {
      setModalError(`Falta la fecha de factura en "${nameHint}"`);
      return false;
    }
    if (!fObj.invoiceNumber) {
      setModalError(`Falta el nº de factura en "${nameHint}"`);
      return false;
    }
    if (!fObj.nif) {
      setModalError(`Falta el NIF en "${nameHint}"`);
      return false;
    }
    if (!isValidNif(fObj.nif)) {
      setModalError(`El NIF solo puede contener letras y numeros en "${nameHint}"`);
      return false;
    }
    if (!fObj.razonSocial) {
      setModalError(`Falta la razon social en "${nameHint}"`);
      return false;
    }
    if (!isValidLegalName(fObj.razonSocial)) {
      setModalError(`La razon social solo puede contener letras en "${nameHint}"`);
      return false;
    }
    if (!fObj.baseCategory) {
      setModalError(`Falta la categoria de base imponible en "${nameHint}"`);
      return false;
    }
    if (!fObj.baseAmount) {
      setModalError(`Falta la base imponible en "${nameHint}"`);
      return false;
    }
    if (!fObj.vatRate) {
      setModalError(`Falta el tipo de IVA en "${nameHint}"`);
      return false;
    }
    if (!fObj.totalAmount) {
      setModalError(`Falta el importe total en "${nameHint}"`);
      return false;
    }

    const baseCents = parseAmountToCents(fObj.baseAmount);
    const dedCents = parseAmountToCents(fObj.vatDeductible || '0') || 0;
    const nonDedCents = parseAmountToCents(fObj.vatNonDeductible || '0') || 0;
    const totalCents = parseAmountToCents(fObj.totalAmount);

    if (baseCents === null || totalCents === null || dedCents === null || nonDedCents === null) {
      setModalError(`Formato numerico invalido en importes de "${nameHint}"`);
      return false;
    }

    const sumCents = baseCents + dedCents + nonDedCents;
    if (sumCents !== totalCents) {
      setModalError(`La suma de base + IVA deducible + IVA no deducible debe igualar el total en "${nameHint}"`);
      return false;
    }
  }
  return true;
}

function setModalError(message) {
  if (!modalError) {
    if (message) showToast(message);
    return;
  }
  if (!message) {
    modalError.innerText = '';
    modalError.style.display = 'none';
    return;
  }
  modalError.innerText = message;
  modalError.style.display = 'block';
}

function setEditModalError(message) {
  if (!editModalError) {
    if (message) showToast(message);
    return;
  }
  if (!message) {
    editModalError.innerText = '';
    editModalError.style.display = 'none';
    return;
  }
  editModalError.innerText = message;
  editModalError.style.display = 'block';
}

function validateEditMeta(data) {
  const nameHint = data && data.storedName ? data.storedName : 'factura';
  if (!data.invoiceDate) {
    setEditModalError(`Falta la fecha de factura en "${nameHint}"`);
    return false;
  }
  if (!data.invoiceNumber) {
    setEditModalError(`Falta el nº de factura en "${nameHint}"`);
    return false;
  }
  if (!data.nif) {
    setEditModalError(`Falta el NIF en "${nameHint}"`);
    return false;
  }
  if (!isValidNif(data.nif)) {
    setEditModalError(`El NIF solo puede contener letras y numeros en "${nameHint}"`);
    return false;
  }
  if (!data.razonSocial) {
    setEditModalError(`Falta la razon social en "${nameHint}"`);
    return false;
  }
  if (!isValidLegalName(data.razonSocial)) {
    setEditModalError(`La razon social solo puede contener letras en "${nameHint}"`);
    return false;
  }
  if (!data.baseCategory) {
    setEditModalError(`Falta la categoria de base imponible en "${nameHint}"`);
    return false;
  }
  if (!data.baseAmount) {
    setEditModalError(`Falta la base imponible en "${nameHint}"`);
    return false;
  }
  if (!data.vatRate) {
    setEditModalError(`Falta el tipo de IVA en "${nameHint}"`);
    return false;
  }
  if (!data.totalAmount) {
    setEditModalError(`Falta el importe total en "${nameHint}"`);
    return false;
  }

  const baseCents = parseAmountToCents(data.baseAmount);
  const dedCents = parseAmountToCents(data.vatDeductible || '0') || 0;
  const nonDedCents = parseAmountToCents(data.vatNonDeductible || '0') || 0;
  const totalCents = parseAmountToCents(data.totalAmount);

  if (baseCents === null || totalCents === null || dedCents === null || nonDedCents === null) {
    setEditModalError(`Formato numerico invalido en importes de "${nameHint}"`);
    return false;
  }

  const sumCents = baseCents + dedCents + nonDedCents;
  if (sumCents !== totalCents) {
    setEditModalError(`La suma de base + IVA deducible + IVA no deducible debe igualar el total en "${nameHint}"`);
    return false;
  }

  return true;
}

async function fetchInvoiceDetails(id) {
  if (!id) return null;
  try {
    // console.log('Fetching invoice details for ID:', id);
    const resp = await fetch(`/invoice/${id}`);
    // console.log('Response status:', resp.status);
    if (!resp.ok) {
      const errorData = await resp.json().catch(() => ({}));
      console.error('Failed to fetch invoice:', resp.status, errorData);
      throw new Error('invoice fetch failed');
    }
    const data = await resp.json();
    // console.log('Invoice data received:', data);
    return data;
  } catch (e) {
    console.error('fetchInvoiceDetails error:', e);
    return null;
  }
}

async function updateInvoice(id, payload) {
  if (!id) return false;
  try {
    const resp = await fetch(`/invoice/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!resp.ok) throw new Error('invoice update failed');
    return true;
  } catch (e) {
    console.error(e);
    return false;
  }
}

function buildEditModal(invoice) {
  if (!editModalList) return;
  editModalList.innerHTML = '';

  const row = document.createElement('div');
  row.className = 'file-row';

  const renameField = document.createElement('div');
  renameField.className = 'rename-field';
  const renameLabel = document.createElement('label');
  renameLabel.innerText = 'Concepto';
  const nameInput = document.createElement('input');
  nameInput.className = 'rename-input';
  nameInput.value = invoice.baseName || '';
  nameInput.placeholder = 'Nombre (sin extensión)';
  nameInput.oninput = (e) => { invoice.baseName = e.target.value; };
  renameField.appendChild(renameLabel);
  renameField.appendChild(nameInput);

  const ext = document.createElement('div');
  ext.className = 'file-row__extension';
  ext.innerText = invoice.extension || '';

  const fields = document.createElement('div');
  fields.className = 'invoice-fields';

  const dateField = document.createElement('div');
  dateField.className = 'invoice-field';
  const dateLabel = document.createElement('label');
  dateLabel.innerText = 'Fecha factura';
  const dateInput = document.createElement('input');
  dateInput.type = 'date';
  dateInput.value = invoice.invoiceDate || '';
  dateInput.required = true;
  dateInput.oninput = (e) => { invoice.invoiceDate = e.target.value; };
  dateField.appendChild(dateLabel);
  dateField.appendChild(dateInput);

  const numberField = document.createElement('div');
  numberField.className = 'invoice-field';
  const numberLabel = document.createElement('label');
  numberLabel.innerText = 'Nº factura';
  const numberInput = document.createElement('input');
  numberInput.type = 'text';
  numberInput.value = invoice.invoiceNumber || '';
  numberInput.placeholder = 'Ej: F-2026-001';
  numberInput.required = true;
  numberInput.oninput = (e) => { invoice.invoiceNumber = e.target.value; };
  numberField.appendChild(numberLabel);
  numberField.appendChild(numberInput);

  const nifField = document.createElement('div');
  nifField.className = 'invoice-field';
  const nifLabel = document.createElement('label');
  nifLabel.innerText = 'NIF';
  const nifInput = document.createElement('input');
  nifInput.type = 'text';
  nifInput.value = invoice.nif || '';
  nifInput.placeholder = 'Ej: B12345678';
  nifInput.required = true;
  nifInput.oninput = (e) => { invoice.nif = e.target.value; };
  nifField.appendChild(nifLabel);
  nifField.appendChild(nifInput);

  const legalNameField = document.createElement('div');
  legalNameField.className = 'invoice-field';
  const legalNameLabel = document.createElement('label');
  legalNameLabel.innerText = 'Razón Social';
  const legalNameInput = document.createElement('input');
  legalNameInput.type = 'text';
  legalNameInput.value = invoice.razonSocial || '';
  legalNameInput.placeholder = 'Ej: Empresa Ejemplo';
  legalNameInput.required = true;
  legalNameInput.oninput = (e) => { invoice.razonSocial = e.target.value; };
  legalNameField.appendChild(legalNameLabel);
  legalNameField.appendChild(legalNameInput);

  const baseField = document.createElement('div');
  baseField.className = 'invoice-field';
  const baseLabel = document.createElement('label');
  baseLabel.innerText = 'Base imponible';
  const baseSelect = document.createElement('select');
  baseSelect.value = invoice.baseCategory || '';
  baseSelect.required = true;
  const baseSelectPlaceholder = document.createElement('option');
  baseSelectPlaceholder.value = '';
  baseSelectPlaceholder.innerText = 'Selecciona categoria';
  baseSelect.appendChild(baseSelectPlaceholder);
  baseCategoryOptions.forEach((optionLabel) => {
    const option = document.createElement('option');
    option.value = optionLabel;
    option.innerText = optionLabel;
    baseSelect.appendChild(option);
  });
  baseSelect.value = invoice.baseCategory || '';
  baseSelect.oninput = (e) => { invoice.baseCategory = e.target.value; };
  const baseInput = document.createElement('input');
  baseInput.type = 'text';
  baseInput.value = invoice.baseAmount || '';
  baseInput.placeholder = 'Ej: 1200,50';
  baseInput.required = true;
  baseInput.oninput = (e) => { invoice.baseAmount = e.target.value; };
  baseField.appendChild(baseLabel);
  baseField.appendChild(baseSelect);
  baseField.appendChild(baseInput);

  const vatField = document.createElement('div');
  vatField.className = 'invoice-field';
  const vatLabel = document.createElement('label');
  vatLabel.innerText = 'Tipo IVA';
  const vatInput = document.createElement('input');
  vatInput.type = 'text';
  vatInput.inputMode = 'decimal';
  vatInput.value = invoice.vatRate || '';
  vatInput.placeholder = 'Ej: 21';
  vatInput.required = true;
  vatInput.oninput = (e) => { invoice.vatRate = e.target.value; };
  vatField.appendChild(vatLabel);
  vatField.appendChild(vatInput);

  const dedField = document.createElement('div');
  dedField.className = 'invoice-field';
  const dedLabel = document.createElement('label');
  dedLabel.innerText = 'IVA deducible';
  const dedInput = document.createElement('input');
  dedInput.type = 'text';
  dedInput.value = invoice.vatDeductible || '';
  dedInput.placeholder = 'Opcional';
  dedInput.oninput = (e) => { invoice.vatDeductible = e.target.value; };
  dedField.appendChild(dedLabel);
  dedField.appendChild(dedInput);

  const nonDedField = document.createElement('div');
  nonDedField.className = 'invoice-field';
  const nonDedLabel = document.createElement('label');
  nonDedLabel.innerText = 'IVA no deducible';
  const nonDedInput = document.createElement('input');
  nonDedInput.type = 'text';
  nonDedInput.value = invoice.vatNonDeductible || '';
  nonDedInput.placeholder = 'Opcional';
  nonDedInput.oninput = (e) => { invoice.vatNonDeductible = e.target.value; };
  nonDedField.appendChild(nonDedLabel);
  nonDedField.appendChild(nonDedInput);

  const totalField = document.createElement('div');
  totalField.className = 'invoice-field';
  const totalLabel = document.createElement('label');
  totalLabel.innerText = 'Importe total';
  const totalInput = document.createElement('input');
  totalInput.type = 'text';
  totalInput.value = invoice.totalAmount || '';
  totalInput.placeholder = 'Ej: 1452,61';
  totalInput.required = true;
  totalInput.oninput = (e) => { invoice.totalAmount = e.target.value; };
  totalField.appendChild(totalLabel);
  totalField.appendChild(totalInput);

  fields.appendChild(dateField);
  fields.appendChild(numberField);
  fields.appendChild(nifField);
  fields.appendChild(legalNameField);
  fields.appendChild(baseField);
  fields.appendChild(vatField);
  fields.appendChild(dedField);
  fields.appendChild(nonDedField);
  fields.appendChild(totalField);

  row.appendChild(renameField);
  row.appendChild(ext);
  row.appendChild(fields);
  editModalList.appendChild(row);
}

async function openEditModal(id) {
  setEditModalError('');
  const invoice = await fetchInvoiceDetails(id);
  if (!invoice) {
    showToast('No se pudo cargar la factura');
    return;
  }
  const storedName = invoice.storedName || '';
  const { baseName, extension } = getFileExtension(storedName);
  editInvoice = {
    id: invoice.id,
    storedName,
    baseName,
    extension,
    invoiceDate: invoice.invoiceDate || '',
    invoiceNumber: invoice.invoiceNumber || '',
    nif: invoice.nif || '',
    razonSocial: invoice.legalName || '',
    baseCategory: invoice.baseCategory || '',
    baseAmount: invoice.baseAmount || '',
    vatRate: invoice.vatRate || '',
    vatDeductible: invoice.vatDeductible || '',
    vatNonDeductible: invoice.vatNonDeductible || '',
    totalAmount: invoice.totalAmount || ''
  };
  buildEditModal(editInvoice);
  if (editModal) editModal.style.display = 'flex';
}

function isValidNif(value) {
  return /^[A-Za-z0-9]+$/.test(String(value).trim());
}

function isValidLegalName(value) {
  return /^[A-Za-zÁÉÍÓÚÑÜáéíóúñü\s]+$/.test(String(value).trim());
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

async function fetchIncomeYear(year) {
  if (!year) return null;
  try {
    const resp = await fetch(`/income/year/${year}`);
    if (!resp.ok) throw new Error('income year failed');
    return await resp.json();
  } catch (e) {
    console.error(e);
    return null;
  }
}

async function saveMonthlyIncome(year, month, payload) {
  if (!year || !month) return false;
  try {
    const resp = await fetch('/income/month', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ year, month, ...payload })
    });
    if (!resp.ok) throw new Error('income save failed');
    return true;
  } catch (e) {
    console.error(e);
    return false;
  }
}

async function saveYearMoney(year, payload) {
  if (!year) return false;
  try {
    const resp = await fetch('/income/year', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ year, ...payload })
    });
    if (!resp.ok) throw new Error('income year save failed');
    return true;
  } catch (e) {
    console.error(e);
    return false;
  }
}

function createEditableAmountCell(initialCents, onCommit) {
  const cell = document.createElement('div');
  cell.className = 'income-cell income-cell--editable';
  cell.title = 'Click para editar';
  cell.innerText = formatCentsToAmount(initialCents || 0);

  const startEdit = () => {
    if (cell.classList.contains('is-editing')) return;
    cell.classList.add('is-editing');
    const input = document.createElement('input');
    input.type = 'text';
    input.inputMode = 'decimal';
    input.placeholder = '0,00';
    input.value = initialCents ? formatCentsToAmount(initialCents) : '';
    cell.innerHTML = '';
    cell.appendChild(input);
    input.focus();
    input.select();
    //debugger;

    const cancel = () => {
      cell.classList.remove('is-editing');
      cell.innerHTML = '';
      cell.innerText = formatCentsToAmount(initialCents || 0);
    };

    const commit = async () => {
      const nextCents = parseAmountToCents(input.value);
      const normalized = nextCents === null ? 0 : nextCents;
      cell.classList.remove('is-editing');
      cell.innerHTML = '';
      cell.innerText = formatCentsToAmount(normalized);
      const ok = await onCommit(normalized, cancel);
      if (ok) {
        initialCents = normalized;
      }
    };

    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        commit();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        cancel();
      }
    });

    input.addEventListener('blur', commit);
  };

  cell.addEventListener('click', startEdit);
  return cell;
}

function buildIncomeTable(year, data) {
  const months = data && data.months ? data.months : {};
  const yearSummary = data && data.yearSummary ? data.yearSummary : {};
  const container = document.createElement('div');
  container.className = 'income-table';
  const totals = {
    expensesCents: 0,
    incomeCents: 0,
    otherExpenseCents: 0,
    diffCents: 0
  };

  const header = document.createElement('div');
  header.className = 'income-row income-row--header';
  ['Mes', 'Gastos', 'Ingresos', 'Otros gastos', 'Diferencia'].forEach((label) => {
    const cell = document.createElement('div');
    cell.className = 'income-cell';
    cell.innerText = label;
    header.appendChild(cell);
  });
  container.appendChild(header);

  const rows = [];

  const recalcTotals = () => {
    totals.expensesCents = 0;
    totals.incomeCents = 0;
    totals.otherExpenseCents = 0;
    totals.diffCents = 0;

    rows.forEach(({ rowData, diffCell }) => {
      totals.expensesCents += rowData.expensesCents || 0;
      totals.incomeCents += rowData.incomeCents || 0;
      totals.otherExpenseCents += rowData.otherExpenseCents || 0;
      const diff = (rowData.incomeCents || 0) - ((rowData.expensesCents || 0) + (rowData.otherExpenseCents || 0));
      totals.diffCents += diff;
      diffCell.innerText = formatCentsToAmount(diff);
      diffCell.classList.toggle('is-negative', diff < 0);
    });

    totalExpenses.innerText = formatCentsToAmount(totals.expensesCents);
    totalIncome.innerText = formatCentsToAmount(totals.incomeCents);
    totalOther.innerText = formatCentsToAmount(totals.otherExpenseCents);
    totalDiff.innerText = formatCentsToAmount(totals.diffCents);
    totalDiff.classList.toggle('is-negative', totals.diffCents < 0);
  };

  monthNames.forEach((monthLabel, index) => {
    const monthKey = String(index + 1).padStart(2, '0');
    const rowData = months[monthKey] || {
      expensesCents: 0,
      incomeCents: 0,
      otherExpenseCents: null
    };

    if (rowData.otherExpenseCents === null || rowData.otherExpenseCents === undefined || rowData.otherExpenseCents < OTHER_EXPENSE_MIN_CENTS) {
      rowData.otherExpenseCents = OTHER_EXPENSE_MIN_CENTS;
    }

    const row = document.createElement('div');
    row.className = 'income-row';

    const labelCell = document.createElement('div');
    labelCell.className = 'income-cell income-cell--label';
    labelCell.setAttribute('data-label', 'Mes');
    labelCell.innerText = monthLabel;
    row.appendChild(labelCell);

    const expensesCell = document.createElement('div');
    expensesCell.className = 'income-cell income-cell--muted';
    expensesCell.setAttribute('data-label', 'Gastos');
    expensesCell.innerText = formatCentsToAmount(rowData.expensesCents || 0);
    row.appendChild(expensesCell);

    const diffCell = document.createElement('div');
    diffCell.className = 'income-cell income-cell--diff';
    diffCell.setAttribute('data-label', 'Diferencia');

    const incomeCell = createEditableAmountCell(rowData.incomeCents || 0, async (nextCents, cancelEdit) => {
      const prev = rowData.incomeCents || 0;
      rowData.incomeCents = nextCents;
      recalcTotals();
      const ok = await saveMonthlyIncome(year, monthKey, { incomeCents: nextCents });
      if (!ok) {
        rowData.incomeCents = prev;
        recalcTotals();
        cancelEdit();
        showToast('No se pudieron guardar los ingresos');
        return false;
      }
      return true;
    });

    const otherCell = createEditableAmountCell(rowData.otherExpenseCents || 0, async (nextCents, cancelEdit) => {
      const prev = rowData.otherExpenseCents || 0;
      const normalized = Math.max(nextCents, OTHER_EXPENSE_MIN_CENTS);
      rowData.otherExpenseCents = normalized;
      recalcTotals();
      const ok = await saveMonthlyIncome(year, monthKey, { otherExpenseCents: normalized });
      if (!ok) {
        rowData.otherExpenseCents = prev;
        recalcTotals();
        cancelEdit();
        showToast('No se pudieron guardar otros gastos');
        return false;
      }
      return true;
    });

    incomeCell.setAttribute('data-label', 'Ingresos');
    otherCell.setAttribute('data-label', 'Otros gastos');
    row.appendChild(incomeCell);
    row.appendChild(otherCell);
    row.appendChild(diffCell);
    container.appendChild(row);
    rows.push({ rowData, diffCell });
  });

  const totalsRow = document.createElement('div');
  totalsRow.className = 'income-row income-row--total';

  const totalLabel = document.createElement('div');
  totalLabel.className = 'income-cell income-cell--label';
  totalLabel.setAttribute('data-label', 'Totales');
  totalLabel.innerText = 'Totales';
  totalsRow.appendChild(totalLabel);

  const totalExpenses = document.createElement('div');
  totalExpenses.className = 'income-cell income-cell--muted';
  totalExpenses.setAttribute('data-label', 'Gastos');
  totalsRow.appendChild(totalExpenses);

  const totalIncome = document.createElement('div');
  totalIncome.className = 'income-cell';
  totalIncome.setAttribute('data-label', 'Ingresos');
  totalsRow.appendChild(totalIncome);

  const totalOther = document.createElement('div');
  totalOther.className = 'income-cell';
  totalOther.setAttribute('data-label', 'Otros gastos');
  totalsRow.appendChild(totalOther);

  const totalDiff = document.createElement('div');
  totalDiff.className = 'income-cell income-cell--diff';
  totalDiff.setAttribute('data-label', 'Diferencia');
  totalsRow.appendChild(totalDiff);

  container.appendChild(totalsRow);

  const yearMoney = {
    initialMoneyCents: yearSummary.initialMoneyCents || 0,
    finalMoneyCents: yearSummary.finalMoneyCents || 0,
    diffMoneyCents: yearSummary.diffMoneyCents || 0
  };

  const yearHeader = document.createElement('div');
  yearHeader.className = 'income-row income-row--summary-header';
  ['Saldo año', 'Inicio', 'Final', 'Diferencia'].forEach((label) => {
    const cell = document.createElement('div');
    cell.className = 'income-cell';
    cell.innerText = label;
    yearHeader.appendChild(cell);
  });
  container.appendChild(yearHeader);

  const yearRow = document.createElement('div');
  yearRow.className = 'income-row income-row--summary';

  const yearLabel = document.createElement('div');
  yearLabel.className = 'income-cell income-cell--label';
  yearLabel.setAttribute('data-label', 'Saldo año');
  yearLabel.innerText = 'Saldo año';
  yearRow.appendChild(yearLabel);

  const yearInitialCell = createEditableAmountCell(yearMoney.initialMoneyCents, async (nextCents, cancelEdit) => {
    const prev = yearMoney.initialMoneyCents;
    yearMoney.initialMoneyCents = nextCents;
    updateYearDiffCell();
    const ok = await saveYearMoney(year, {
      initialMoneyCents: yearMoney.initialMoneyCents,
      finalMoneyCents: yearMoney.finalMoneyCents
    });
    if (!ok) {
      yearMoney.initialMoneyCents = prev;
      updateYearDiffCell();
      cancelEdit();
      showToast('No se pudo guardar el saldo inicial');
      return false;
    }
    return true;
  });
  yearInitialCell.setAttribute('data-label', 'Inicio');
  yearRow.appendChild(yearInitialCell);

  const yearFinalCell = createEditableAmountCell(yearMoney.finalMoneyCents, async (nextCents, cancelEdit) => {
    const prev = yearMoney.finalMoneyCents;
    yearMoney.finalMoneyCents = nextCents;
    updateYearDiffCell();
    const ok = await saveYearMoney(year, {
      initialMoneyCents: yearMoney.initialMoneyCents,
      finalMoneyCents: yearMoney.finalMoneyCents
    });
    if (!ok) {
      yearMoney.finalMoneyCents = prev;
      updateYearDiffCell();
      cancelEdit();
      showToast('No se pudo guardar el saldo final');
      return false;
    }
    return true;
  });
  yearFinalCell.setAttribute('data-label', 'Final');
  yearRow.appendChild(yearFinalCell);

  const yearDiffCell = document.createElement('div');
  yearDiffCell.className = 'income-cell income-cell--diff';
  yearDiffCell.setAttribute('data-label', 'Diferencia');
  yearRow.appendChild(yearDiffCell);

  function updateYearDiffCell() {
    const diff = yearMoney.finalMoneyCents - yearMoney.initialMoneyCents;
    yearMoney.diffMoneyCents = diff;
    yearDiffCell.innerText = formatCentsToAmount(diff);
    yearDiffCell.classList.toggle('is-negative', diff < 0);
  }

  updateYearDiffCell();
  container.appendChild(yearRow);
  recalcTotals();

  return container;
}

async function renderIncomePanel() {
  if (!resultIncome) return;
  resultIncome.innerHTML = '';

  if (!selectedYear) {
    if (incomeTitle) incomeTitle.style.display = 'block';
    const msg = document.createElement('p');
    msg.className = 'no-data';
    msg.innerText = 'Selecciona un año para ver ingresos y gastos.';
    resultIncome.appendChild(msg);
    return;
  }

  if (selectedMonth) {
    if (incomeTitle) incomeTitle.style.display = 'none';
    return;
  }

  if (incomeTitle) incomeTitle.style.display = 'block';

  const loading = document.createElement('p');
  loading.className = 'loading';
  loading.innerText = 'Cargando resumen anual...';
  resultIncome.appendChild(loading);

  const requestId = ++incomeRequestId;
  const data = await fetchIncomeYear(selectedYear);
  if (requestId !== incomeRequestId) return;

  resultIncome.innerHTML = '';
  if (!data || !data.months) {
    const msg = document.createElement('p');
    msg.className = 'no-data';
    msg.innerText = 'No se pudo cargar el resumen anual.';
    resultIncome.appendChild(msg);
    return;
  }

  resultIncome.appendChild(buildIncomeTable(selectedYear, data));
}

async function fetchList() {
  // Siempre cargar el árbol completo
  try {
    const r = await fetch('/list');
    const j = await r.json();
    allTree = j.tree || {};
    renderList();
  } catch (e) {
    console.error(e);
  }
}

// Poblar selects de año/mes según la estructura devuelta por /list
// populateDateSelectors ya no es necesaria - la lógica de filtrado está en renderList
async function populateDateSelectors() {
  return Promise.resolve();
}

function renderList() {
  const el = document.createElement('div');
  el.className = 'files-container';

  // Si no hay año seleccionado, mostrar años con click
  if (!selectedYear) {
    const yearsDiv = document.createElement('div');
    yearsDiv.className = 'years-list';
    
    const years = Object.keys(allTree);
    if (years.length === 0) {
      const noData = document.createElement('p');
      noData.className = 'no-data';
      noData.innerText = 'No hay facturas almacenadas';
      yearsDiv.appendChild(noData);
    } else {
      years.sort().reverse().forEach(y => {
        const yDiv = document.createElement('div');
        yDiv.className = 'year-item';
        yDiv.innerText = y;
        yDiv.onclick = () => {
          selectedYear = y;
          renderList();
        };
        yearsDiv.appendChild(yDiv);
      });
    }
    el.appendChild(yearsDiv);
  }
  
  // Si hay año seleccionado pero no mes, mostrar meses disponibles
  else if (!selectedMonth) {
    const backDiv = document.createElement('div');
    backDiv.className = 'filter-back';
    backDiv.innerText = '← ' + selectedYear;
    backDiv.onclick = () => {
      selectedYear = null;
      selectedMonth = null;
      renderList();
    };
    el.appendChild(backDiv);

    const downloadYearBtn = document.createElement('button');
    downloadYearBtn.className = 'download-year-btn';
    downloadYearBtn.innerText = 'Descargar año';
    downloadYearBtn.onclick = async () => {
      await downloadYearZip(downloadYearBtn, selectedYear);
    };
    el.appendChild(downloadYearBtn);

    const exportYearBtn = document.createElement('button');
    exportYearBtn.className = 'download-excel-btn';
    exportYearBtn.innerText = 'Exportar Excel';
    exportYearBtn.onclick = async () => {
      await downloadExcel(exportYearBtn, `/export/year/${selectedYear}`, `facturas_${selectedYear}.xlsx`);
    };
    el.appendChild(exportYearBtn);

    const monthsDiv = document.createElement('div');
    monthsDiv.className = 'months-list';

    // Mostrar siempre los 12 meses (incluir meses sin facturas)
    // Usamos claves de mes con dos dígitos ('01'..'12') para coincidir con la estructura del servidor
    const monthIndexes = Array.from({ length: 12 }, (_, i) => i + 1);
    monthIndexes.forEach(m => {
      const monthKey = String(m).padStart(2, '0');
      const filesInMonth = allTree[selectedYear]?.[monthKey] || [];
      const mDiv = document.createElement('div');
      mDiv.className = 'month-item' + (filesInMonth.length === 0 ? ' month-empty' : '');
      // Span para el nombre del mes
      const nameSpan = document.createElement('span');
      nameSpan.className = 'month-name';
      nameSpan.textContent = monthNames[m - 1];
      mDiv.appendChild(nameSpan);
      // Span para el contador o texto vacío
      const countSpan = document.createElement('span');
      countSpan.className = 'month-count' + (filesInMonth.length === 0 ? ' month-empty' : '');
      if (filesInMonth.length === 0) {
        countSpan.innerText = '(vacío)';
      } else {
        const n = filesInMonth.length;
        const palabra = n === 1 ? 'factura' : 'facturas';
        countSpan.innerText = `${n} ${palabra}`;
      }
      mDiv.appendChild(countSpan);
      mDiv.onclick = () => {
        selectedMonth = monthKey;
        renderList();
      };
      monthsDiv.appendChild(mDiv);
    });
    el.appendChild(monthsDiv);
  }
  
  // Si hay año y mes seleccionados, mostrar archivos
  else {
    const backDiv = document.createElement('div');
    backDiv.className = 'filter-back';
    const mi = Number(selectedMonth);
    const monthName = monthNames[mi - 1] || selectedMonth;
    backDiv.innerText = '← ' + monthName + ' ' + selectedYear;
    backDiv.onclick = () => {
      selectedMonth = null;
      renderList();
    };
    el.appendChild(backDiv);

    const filesDiv = document.createElement('div');
    filesDiv.className = 'files-list-container';

    const files = allTree[selectedYear]?.[selectedMonth] || [];
    if (files.length === 0) {
      const noData = document.createElement('p');
      noData.className = 'no-data';
      noData.innerText = 'No hay facturas en este mes';
      filesDiv.appendChild(noData);
    } else {
      const ul = document.createElement('ul');
      ul.className = 'files-list__items';
      files.forEach(f => {
        const li = document.createElement('li');
        li.className = 'file-item';
        const a = document.createElement('a');
        a.className = 'file-link';
        a.href = `/file/${f.id}`;
        a.innerText = f.name;
        a.target = '_blank';
        li.appendChild(a);
        // boton editar
        const editBtn = document.createElement('button');
        editBtn.className = 'file-item__edit-btn';
        editBtn.type = 'button';
        editBtn.title = 'Editar factura';
        editBtn.innerHTML = '<i data-feather="edit-2"></i>';
        editBtn.addEventListener('click', () => {
          openEditModal(f.id);
        });
        li.appendChild(editBtn);
        // botón borrar junto al enlace
        const delBtn = document.createElement('button');
        delBtn.className = 'file-item__delete-btn';
        delBtn.type = 'button';
        delBtn.title = 'Borrar archivo';
        // usar icono Feather en lugar de texto
        delBtn.innerHTML = '<i data-feather="trash-2"></i>';
        // mostrar modal al clicar
        delBtn.addEventListener('click', () => {
          pendingDeletePath = f.id;
          if (deleteModalMessage) deleteModalMessage.innerText = `¿Borrar "${f.name}"?`;
          if (deleteModal) deleteModal.style.display = 'flex';
        });
        li.appendChild(delBtn);
        ul.appendChild(li);
      });
      filesDiv.appendChild(ul);
    }
    el.appendChild(filesDiv);
  }

  const container = document.getElementById('result');
  container.innerHTML = '';
  container.appendChild(el);
  renderIncomePanel();
  // reemplazar iconos Feather si está disponible
  if (window.feather && typeof window.feather.replace === 'function') {
    try { window.feather.replace(); } catch (e) { /* ignore */ }
  }
}

async function downloadYearZip(btn, year) {
  if (!year) return;
  const originalText = btn.innerText;
  btn.disabled = true;
  btn.innerText = 'Descargando...';

  try {
    const resp = await fetch(`/download/year/${year}`);
    if (!resp.ok) throw new Error('No se pudo descargar');
    const blob = await resp.blob();
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `facturas_${year}.zip`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);

    pendingDeleteYear = year;
    if (downloadModalMessage) {
      downloadModalMessage.innerText = `¿Quieres borrar las facturas del año ${year} para liberar espacio?`;
    }
    if (downloadModal) downloadModal.style.display = 'flex';
  } catch (e) {
    showToast('Error al descargar el año');
  } finally {
    btn.disabled = false;
    btn.innerText = originalText;
  }
}

async function downloadExcel(btn, url, filename) {
  if (!url) return;
  const originalText = btn.innerText;
  btn.disabled = true;
  btn.innerText = 'Preparando Excel...';

  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error('No se pudo exportar');
    const blob = await resp.blob();
    const linkUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = linkUrl;
    link.download = filename || 'facturas.xlsx';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(linkUrl);
  } catch (e) {
    showToast('Error al exportar Excel');
  } finally {
    btn.disabled = false;
    btn.innerText = originalText;
  }
}

  // manejadores modal borrado
  if (deleteModalCancel) deleteModalCancel.addEventListener('click', () => { if (deleteModal) deleteModal.style.display = 'none'; pendingDeletePath = null; });
  if (deleteModalConfirm) deleteModalConfirm.addEventListener('click', async () => {
    if (!pendingDeletePath) return;
    try {
      const resp = await fetch('/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: pendingDeletePath }) });
      const j = await resp.json();
      if (j && j.success) {
        // mostrar toast con nombre borrado
        const deletedName = (j.deleted) ? j.deleted : pendingDeletePath;
        showToast(`Archivo borrado: ${deletedName}`);
        fetchList();
      } else {
        console.error('No se pudo borrar', j);
      }
    } catch (e) {
      console.error('Error borrando', e);
    } finally {
      if (deleteModal) deleteModal.style.display = 'none';
      pendingDeletePath = null;
    }
  });

  if (downloadModalCancel) downloadModalCancel.addEventListener('click', () => {
    if (downloadModal) downloadModal.style.display = 'none';
    pendingDeleteYear = null;
  });

  if (downloadModalConfirm) downloadModalConfirm.addEventListener('click', async () => {
    if (!pendingDeleteYear) return;
    try {
      const resp = await fetch('/delete/year', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year: pendingDeleteYear })
      });
      const j = await resp.json();
      if (j && j.success) {
        showToast(`Año ${pendingDeleteYear} borrado: ${j.deletedCount}`);
        selectedYear = null;
        selectedMonth = null;
        fetchList();
      } else {
        showToast('No se pudo borrar el año');
      }
    } catch (e) {
      showToast('Error borrando el año');
    } finally {
      if (downloadModal) downloadModal.style.display = 'none';
      pendingDeleteYear = null;
    }
  });

  if (editModalCancel) editModalCancel.addEventListener('click', () => {
    if (editModal) editModal.style.display = 'none';
    setEditModalError('');
    editInvoice = null;
  });

  if (editModalConfirm) editModalConfirm.addEventListener('click', async () => {
    if (!editInvoice) return;
    setEditModalError('');
    const baseName = (editInvoice.baseName || '').trim();
    if (!baseName) {
      setEditModalError('Falta el concepto de la factura');
      return;
    }

    const payload = {
      storedName: `${baseName}${editInvoice.extension || ''}`,
      invoiceDate: editInvoice.invoiceDate || '',
      invoiceNumber: editInvoice.invoiceNumber || '',
      nif: editInvoice.nif || '',
      legalName: editInvoice.razonSocial || '',
      baseCategory: editInvoice.baseCategory || '',
      baseAmount: editInvoice.baseAmount || '',
      vatRate: editInvoice.vatRate || '',
      vatDeductible: editInvoice.vatDeductible || '',
      vatNonDeductible: editInvoice.vatNonDeductible || '',
      totalAmount: editInvoice.totalAmount || ''
    };

    if (!validateEditMeta({ ...editInvoice, storedName: payload.storedName })) return;

    const ok = await updateInvoice(editInvoice.id, payload);
    if (!ok) {
      setEditModalError('No se pudo guardar la factura');
      return;
    }

    if (editModal) editModal.style.display = 'none';
    editInvoice = null;
    fetchList();
  });

// Toast helper
function showToast(msg, timeout = 3000) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.innerText = msg;
  document.body.appendChild(t);
  setTimeout(() => {
    t.style.opacity = '0';
    setTimeout(() => t.remove(), 400);
  }, timeout);
}

// Cargar lista inicial
fetchList();
setUploadButtonLabel(false);

function toggleIncomeRow($row) {
  const cellsToToggle = $row.find('.income-cell').not('.income-cell--label');

  if ($row.hasClass('is-expanded')) {
    // Si ya está desplegada, cerrarla
    cellsToToggle.slideUp(300, function() {
      jQuery(this).css('display', '');
    });
    $row.removeClass('is-expanded');
    return;
  }

  // Cerrar todas las demás filas primero
  jQuery('.income-row.is-expanded').each(function() {
    const otherCells = jQuery(this).find('.income-cell').not('.income-cell--label');
    otherCells.slideUp(300, function() {
      jQuery(this).css('display', '');
    });
    jQuery(this).removeClass('is-expanded');
  });

  // Abrir la actual
  cellsToToggle.each(function() {
    jQuery(this).css('display', 'flex').hide().slideDown(300);
  });
  $row.addClass('is-expanded');
}

jQuery(document).on('click', '.income-cell[data-label="Mes"]', function() {
  if (window.innerWidth >= 768) {
    return;
  }
  //console.log('Row clicked:', this);
  const $row = jQuery(this).closest('.income-row');
  toggleIncomeRow($row);
});

jQuery(document).on('click', '.income-cell--label', function() {
  if (window.innerWidth >= 768) {
    return;
  }
  const label = jQuery(this).attr('data-label');
  if (label !== 'Totales' && label !== 'Saldo año') {
    return;
  }
  const $row = jQuery(this).closest('.income-row');
  toggleIncomeRow($row);
});

function resetIncomeRowsOnDesktop() {
  if (window.innerWidth < 768) {
    return;
  }
  jQuery('.income-row.is-expanded').each(function() {
    const $row = jQuery(this);
    const $cells = $row.find('.income-cell').not('.income-cell--label');
    $cells.stop(true, true).css('display', '');
    $row.removeClass('is-expanded');
  });
}

window.addEventListener('resize', resetIncomeRowsOnDesktop);
resetIncomeRowsOnDesktop();