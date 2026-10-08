/**
 * ETL: hoja "Trafico piso" del Google Sheet → crm_trafico_piso.
 * Columna T (Reconciliación): FRESH UP | CITA | SNV | CITA-SNV | BE BACK...
 * Uso: node backend/scripts/etl-crm-trafico-piso.js [ruta.xlsx]
 */
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const Database = require('better-sqlite3');

const DEFAULT_XLSX = path.join(__dirname, '../data/leads-source.xlsx');
const DB_PATH = path.join(__dirname, '../data/crm-ciclos.db');

function clean(value) {
  if (value == null) return null;
  const text = String(value).replace(/\s+/g, ' ').trim();
  return text || null;
}

function serialToIso(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  if (Number.isFinite(number) && number > 20000 && number < 60000) {
    return new Date(Date.UTC(1899, 11, 30) + number * 86400000).toISOString().slice(0, 10);
  }
  const text = String(value).trim();
  const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (match) return `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  return null;
}

function excelTime(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  if (Number.isFinite(number) && number >= 0 && number < 1) {
    const minutes = Math.round(number * 24 * 60) % (24 * 60);
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  }
  const text = clean(value);
  // Filas desalineadas a veces meten etiquetas en la columna de hora
  if (!text || /^(BE BACK|SNV|CITA|FRESH|SEMINUEVOS)/i.test(text)) return null;
  return text;
}

function normHeader(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function findSheet(workbook) {
  const names = workbook.SheetNames.map((name) => ({
    name,
    n: String(name || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase(),
  }));
  return (
    names.find((s) => s.n.includes('trafico') && s.n.includes('piso'))
    || names.find((s) => s.n.includes('afluencia'))
  )?.name;
}

function headerIndex(header) {
  const idx = {};
  (header || []).forEach((cell, i) => {
    const key = normHeader(cell);
    if (key && idx[key] == null) idx[key] = i;
  });
  return idx;
}

function cell(idx, row, ...names) {
  for (const name of names) {
    const at = idx[name];
    if (at != null) return row[at];
  }
  return null;
}

function esSi(value) {
  const s = normHeader(value);
  return s === 'SI' || s === 'S';
}

function run() {
  const xlsxPath = process.argv[2] || DEFAULT_XLSX;
  if (!fs.existsSync(xlsxPath)) throw new Error(`No existe el archivo: ${xlsxPath}`);

  const workbook = XLSX.readFile(xlsxPath);
  const sheetName = findSheet(workbook);
  if (!sheetName) throw new Error('No se encontró la hoja "Trafico piso"');
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: null });
  const headers = headerIndex(rows[0]);
  const layoutNuevo = headers['TIPO DE CITA'] != null;

  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.exec(`
    DROP TABLE IF EXISTS crm_trafico_piso;
    CREATE TABLE crm_trafico_piso (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fuerza TEXT,
      centro_trabajo TEXT,
      mes_registro TEXT,
      fecha TEXT,
      hora_ingreso TEXT,
      asesor TEXT,
      cliente TEXT,
      genero TEXT,
      edad TEXT,
      telefono TEXT,
      correo TEXT,
      auto_interes TEXT,
      color TEXT,
      version TEXT,
      forma_contacto TEXT,
      medio TEXT,
      submedio TEXT,
      comentarios TEXT,
      fuente TEXT,
      reconciliacion TEXT,
      pase_fi TEXT,
      tipo_plan TEXT,
      prueba_manejo_flag TEXT,
      solicitud_flag TEXT,
      id_crm TEXT,
      folio_ficha TEXT,
      hostess TEXT,
      vin_venta TEXT,
      observaciones TEXT
    );
  `);

  const insert = db.prepare(`
    INSERT INTO crm_trafico_piso (
      fuerza, centro_trabajo, mes_registro, fecha, hora_ingreso, asesor, cliente,
      genero, edad, telefono, correo, auto_interes, color, version, forma_contacto,
      medio, submedio, comentarios, fuente, reconciliacion, pase_fi, tipo_plan,
      prueba_manejo_flag, solicitud_flag, id_crm, folio_ficha, hostess, vin_venta, observaciones
    ) VALUES (${new Array(29).fill('?').join(',')})
  `);

  const data = [];
  let skipped = 0;
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every((value) => value == null || String(value).trim() === '')) continue;

    const fecha = serialToIso(layoutNuevo ? cell(headers, row, 'FECHA') : row[3]);
    const cliente = clean(layoutNuevo ? cell(headers, row, 'NOMBRE DEL CLIENTE *', 'NOMBRE DEL CLIENTE', 'CLIENTE') : row[6]);
    const reconciliacion = clean(layoutNuevo ? cell(headers, row, 'TIPO DE CITA') : row[19]);
    const tipoVenta = layoutNuevo ? clean(cell(headers, row, 'TIPO DE VENTA')) : null;
    const ventaSi = layoutNuevo && esSi(cell(headers, row, 'VENTA'));
    // Requiere fecha o al menos tipo de reconciliación + cliente/asesor
    if (!fecha && !reconciliacion) {
      skipped += 1;
      continue;
    }

    const campos = layoutNuevo
      ? [
        clean(cell(headers, row, 'FUERZA DE VENTAS')),
        clean(cell(headers, row, 'MARCA')),
        clean(cell(headers, row, 'MES')),
        fecha,
        excelTime(cell(headers, row, 'HORA DE INGRESO A PISO')),
        clean(cell(headers, row, 'ASESOR')),
        cliente,
        clean(cell(headers, row, 'GENERO')),
        clean(cell(headers, row, 'EDAD')),
        clean(cell(headers, row, 'TELEFONO')),
        clean(cell(headers, row, 'CORREO')),
        clean(cell(headers, row, 'AUTO DE INTERES')),
        clean(cell(headers, row, 'COLOR')),
        clean(cell(headers, row, 'VERSION')),
        clean(cell(headers, row, 'FORMA DE CONTACTO')),
        clean(cell(headers, row, 'MEDIO DE CONTACTO')),
        clean(cell(headers, row, 'SUBMEDIO DE CONTACTO')),
        tipoVenta,
        'Afluencia',
        reconciliacion,
        null,
        clean(cell(headers, row, 'TIPO DE PLAN')),
        esSi(cell(headers, row, 'PRUEBA DE MANEJO')) ? 'SI' : clean(cell(headers, row, 'PRUEBA DE MANEJO')),
        esSi(cell(headers, row, 'SOLICITUD')) ? 'SI' : clean(cell(headers, row, 'SOLICITUD')),
        clean(cell(headers, row, 'ID DE CRM')),
        clean(cell(headers, row, 'FOLIO DE TARJETA')),
        clean(cell(headers, row, 'HOSTES QUE REGISTRO', 'HOSTESS QUE REGISTRO')),
        null,
        ventaSi ? 'VENTA' : null,
      ]
      : [
        clean(row[0]),
        clean(row[1]),
        clean(row[2]),
        fecha,
        excelTime(row[4]),
        clean(row[5]),
        cliente,
        clean(row[7]),
        clean(row[8]),
        clean(row[9]),
        clean(row[10]),
        clean(row[11]),
        clean(row[12]),
        clean(row[13]),
        clean(row[14]),
        clean(row[15]),
        clean(row[16]),
        clean(row[17]),
        clean(row[18]),
        reconciliacion,
        clean(row[20]),
        clean(row[22]),
        clean(row[25]),
        clean(row[26]),
        clean(row[27]),
        clean(row[28]),
        clean(row[29]),
        clean(row[32])?.toUpperCase() || null,
        clean(row[35]),
      ];
    data.push(campos);
  }

  db.transaction((records) => records.forEach((record) => insert.run(record)))(data);
  db.exec(`
    CREATE INDEX idx_trafico_fecha ON crm_trafico_piso (fecha);
    CREATE INDEX idx_trafico_recon ON crm_trafico_piso (reconciliacion);
    CREATE INDEX idx_trafico_centro ON crm_trafico_piso (centro_trabajo);
    CREATE INDEX idx_trafico_fuerza ON crm_trafico_piso (fuerza);
    CREATE INDEX idx_trafico_idcrm ON crm_trafico_piso (id_crm);
  `);

  const byRecon = db.prepare(`
    SELECT UPPER(COALESCE(reconciliacion,'(vacío)')) AS tipo, COUNT(*) AS n
    FROM crm_trafico_piso
    GROUP BY 1
    ORDER BY n DESC
    LIMIT 12
  `).all();

  console.log(`Hoja "${sheetName}": ${data.length} filas cargadas (${skipped} omitidas)`);
  console.table({ total: data.length, skipped });
  console.table(byRecon);

  db.close();
}

run();
