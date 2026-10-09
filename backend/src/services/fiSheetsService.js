const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const DEFAULT_SHEET_ID = '1DuNXTQg8x9GDgKMcYIR3z4hWKbKo8krO0Yazzh1AaKo';
const DEFAULT_GID = '229454080';
const CACHE_FILE = path.join(__dirname, '../../data/fi-pagos-cache.json');
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos de caché en memoria

let memoryCache = null;
let lastFetchTime = 0;

function parseMoney(val) {
  if (val == null || val === '') return 0;
  if (typeof val === 'number') return Number.isFinite(val) ? val : 0;
  const clean = String(val).replace(/[$,\s]/g, '').replace(/[()]/g, (ch) => (ch === '(' ? '-' : ''));
  const n = parseFloat(clean);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function normalizeVin(val) {
  const v = String(val || '').trim().toUpperCase().replace(/\s+/g, '');
  return v.length >= 5 ? v : '';
}

function parseCsv(text) {
  const rows = [];
  let currentRow = [];
  let currentVal = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (i + 1 < text.length && text[i + 1] === '"') {
          currentVal += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        currentVal += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ',') {
        currentRow.push(currentVal.trim());
        currentVal = '';
      } else if (c === '\n' || c === '\r') {
        if (c === '\r' && i + 1 < text.length && text[i + 1] === '\n') i++;
        currentRow.push(currentVal.trim());
        if (currentRow.some((col) => col.length > 0)) {
          rows.push(currentRow);
        }
        currentRow = [];
        currentVal = '';
      } else {
        currentVal += c;
      }
    }
  }
  if (currentVal.length > 0 || currentRow.length > 0) {
    currentRow.push(currentVal.trim());
    if (currentRow.some((col) => col.length > 0)) rows.push(currentRow);
  }
  return rows;
}

function downloadHttp(url, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('http://') ? http : https;
    const req = client.get(url, { timeout: 30000 }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        if (redirectsLeft <= 0) return reject(new Error('Demasiados redirects al descargar Google Sheet'));
        return downloadHttp(res.headers.location, redirectsLeft - 1).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`Error descargando Google Sheet: HTTP ${res.statusCode}`));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout al descargar Google Sheet'));
    });
  });
}

function buildMapFromRows(rows) {
  const map = new Map();
  if (!Array.isArray(rows) || rows.length < 2) return map;

  // Fila 0 = encabezados. Se recorren filas de datos
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    // Columna H (índice 7) = Número de serie (VIN)
    const vin = normalizeVin(r[7]);
    // Columna L (índice 11) = Total pagado
    const monto = parseMoney(r[11]);
    if (!vin || !monto) continue;

    const contrato = String(r[0] || '').trim();
    const modelo = String(r[6] || '').trim();
    const plan = String(r[8] || '').trim() || 'Financiamiento F&I';
    const comisionDealer = parseMoney(r[9]);
    const vaComision = parseMoney(r[10]);

    let entry = map.get(vin);
    if (!entry) {
      entry = {
        monto: 0,
        count: 0,
        fuente: 'BMW FS F&I',
        byConcepto: [],
      };
      map.set(vin, entry);
    }

    entry.monto = Math.round((entry.monto + monto) * 100) / 100;
    entry.count += 1;
    entry.byConcepto.push({
      concepto: plan,
      monto,
      contrato: contrato || null,
      modelo: modelo || null,
      comisionDealer: comisionDealer || 0,
      vaComision: vaComision || 0,
    });
  }

  return map;
}

async function loadIngresosFiMap() {
  const now = Date.now();
  if (memoryCache && now - lastFetchTime < CACHE_TTL_MS) {
    return memoryCache;
  }

  const sheetId = process.env.FI_SHEET_ID || DEFAULT_SHEET_ID;
  const gid = process.env.FI_SHEET_GID || DEFAULT_GID;
  const csvUrl = process.env.FI_SHEET_URL
    || `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;

  try {
    const csvText = await downloadHttp(csvUrl);
    const rows = parseCsv(csvText);
    const map = buildMapFromRows(rows);

    memoryCache = map;
    lastFetchTime = now;

    // Guardar copia local en disco
    try {
      const serializable = Object.fromEntries(map.entries());
      fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
      fs.writeFileSync(CACHE_FILE, JSON.stringify(serializable, null, 2), 'utf8');
    } catch {
      /* ignore write error */
    }

    return map;
  } catch (err) {
    console.warn('[fiSheetsService] No se pudo descargar la hoja de F&I de Google Sheets:', err.message);

    // Si falló la descarga, intentar leer del archivo en disco
    if (fs.existsSync(CACHE_FILE)) {
      try {
        const raw = fs.readFileSync(CACHE_FILE, 'utf8');
        const obj = JSON.parse(raw);
        const diskMap = new Map(Object.entries(obj));
        memoryCache = diskMap;
        lastFetchTime = now;
        return diskMap;
      } catch {
        /* ignore parse error */
      }
    }

    return memoryCache || new Map();
  }
}

module.exports = {
  loadIngresosFiMap,
  parseMoney,
  normalizeVin,
};
