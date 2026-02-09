const drop = document.getElementById('drop-zone');
const input = document.getElementById('file-input');
const preview = document.getElementById('preview');
const uploadBtn = document.getElementById('upload-btn');
const result = document.getElementById('result');
const invoiceDate = document.getElementById('invoice-date');

// Nombres de meses en español (índice 0 = enero)
const monthNames = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

// Referencias al modal de renombrado
const renameModal = document.getElementById('rename-modal');
const modalList = document.getElementById('modal-list');
const modalCancel = document.getElementById('modal-cancel');
const modalConfirm = document.getElementById('modal-confirm');

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
// Función auxiliar para extraer extensión y nombre base
function getFileExtension(filename) {
  const idx = filename.lastIndexOf('.');
  if (idx === -1) return { baseName: filename, extension: '' };
  return { baseName: filename.substring(0, idx), extension: filename.substring(idx) };
}

// filesToUpload: array de objetos { file, originalName, baseName, extension, name (nombre base editable) }
let filesToUpload = [];

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
}

drop.addEventListener('click', () => input.click());

drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('dragover'); });
drop.addEventListener('dragleave', () => drop.classList.remove('dragover'));
drop.addEventListener('drop', (e) => {
  e.preventDefault(); drop.classList.remove('dragover');
  const dropped = Array.from(e.dataTransfer.files);
  const wrapped = dropped.map(f => {
    const { baseName, extension } = getFileExtension(f.name);
    return { file: f, originalName: f.name, baseName, extension, name: baseName };
  });
  filesToUpload.push(...wrapped);
  renderPreview();
});

input.addEventListener('change', (e) => {
  const added = Array.from(e.target.files).map(f => {
    const { baseName, extension } = getFileExtension(f.name);
    return { file: f, originalName: f.name, baseName, extension, name: baseName };
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
  modalList.innerHTML = '';
  filesToUpload.forEach((fObj, i) => {
    const row = document.createElement('div');
    row.className = 'file-row';

    const orig = document.createElement('div');
    orig.className = 'original-name';
    orig.innerText = fObj.originalName;

    const inp = document.createElement('input');
    inp.className = 'rename-input';
    inp.value = fObj.name || fObj.baseName;
    inp.placeholder = 'Nombre (sin extensión)';
    inp.oninput = (e) => { fObj.name = e.target.value; };

    const ext = document.createElement('div');
    ext.className = 'file-row__extension';
    ext.innerText = fObj.extension || '';

    row.appendChild(orig);
    row.appendChild(inp);
    row.appendChild(ext);
    modalList.appendChild(row);
  });
  renameModal.style.display = 'flex';
});

// Cancelar modal
if (modalCancel) modalCancel.addEventListener('click', () => { renameModal.style.display = 'none'; });

// Confirmar y subir
if (modalConfirm) modalConfirm.addEventListener('click', () => {
  renameModal.style.display = 'none';
  modalConfirmUpload();
});

async function modalConfirmUpload() {
  const fd = new FormData();
  if (invoiceDate && invoiceDate.value) {
    fd.append('invoiceDate', invoiceDate.value); // formato YYYY-MM
  }
  // Reconstruir nombre con extensión original preservada
  filesToUpload.forEach(fObj => {
    const finalName = (fObj.name || fObj.baseName) + fObj.extension;
    fd.append('files', fObj.file, finalName);
  });
  uploadBtn.disabled = true;
  uploadBtn.innerText = 'Subiendo...';
  try {
    const resp = await fetch('/upload', { method: 'POST', body: fd });
    const data = await resp.json();
    result.innerText = JSON.stringify(data, null, 2);
    filesToUpload = [];
    renderPreview();
    // Recargar lista de archivos
    fetchList();
  } catch (e) {
    result.innerText = 'Error al subir: ' + e.message;
  } finally {
    uploadBtn.disabled = false;
    uploadBtn.innerText = 'Subir archivos';
  }
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

// Inicializar input fecha al mes actual y cargar lista de ese mes
function setInvoiceDateToNow() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  if (invoiceDate) invoiceDate.value = `${y}-${m}`;
}

if (invoiceDate) {
  setInvoiceDateToNow();
  // Change en invoice date solo para futuros uploads, no para filtrado
}

// Cargar lista inicial
fetchList();
