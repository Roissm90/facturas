const drop = document.getElementById('drop-zone');
const input = document.getElementById('file-input');
const preview = document.getElementById('preview');
const uploadBtn = document.getElementById('upload-btn');
const result = document.getElementById('result');

// Nombres de meses en español (índice 0 = enero)
const monthNames = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

// Referencias al modal de renombrado
const renameModal = document.getElementById('rename-modal');
const modalList = document.getElementById('modal-list');
const modalCancel = document.getElementById('modal-cancel');
const modalConfirm = document.getElementById('modal-confirm');
const modalError = document.getElementById('modal-error');

// Referencias a modales de filtrado
const yearModal = document.getElementById('year-modal');
const yearModalList = document.getElementById('year-modal-list');
const yearModalClose = document.getElementById('year-modal-close');
const monthModal = document.getElementById('month-modal');
const monthModalList = document.getElementById('month-modal-list');
const monthModalClose = document.getElementById('month-modal-close');

// Estado de filtrado
let selectedYear = null;
let selectedMonth = null;
let allTree = {}; // árbol completo de archivos

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
      totalAmount: ''
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
      totalAmount: ''
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

    fields.appendChild(dateField);
    fields.appendChild(numberField);
    fields.appendChild(nifField);
    fields.appendChild(legalNameField);
    fields.appendChild(baseField);
    fields.appendChild(vatField);
    fields.appendChild(dedField);
    fields.appendChild(nonDedField);
    fields.appendChild(totalField);

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
    totalAmount: fObj.totalAmount || ''
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
