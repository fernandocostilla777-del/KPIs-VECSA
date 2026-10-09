const fs = require('fs');
const path = require('path');
const { query } = require('../db');
const db = require('../incadea/db');
const queries = require('../incadea/queries');
const { leerPrivado } = require('../incadea/privateStore');
const { fechaNav, marcaDeGrupo } = require('../incadea/transform');
const { forecastSales } = require('./forecastModel');

/**
 * Mapeo de campos del spreadsheet / Colab vs SQL Server (GMOFARRIL).
 * Fuente spreadsheet: hoja de ventas detalladas.
 * Fuentes SQL: ADE_VTAFI + SER_VEHICULO + PER_PERSONAS + BI_AN_VENTAS.
 */
const FIELD_MAPPING = [
  { sheet: 'FECHA DE VENTA', sql: 'ADE_VTAFI.VTE_FECHDOCTO / BI_AN_VENTAS.fecha_factura', source: 'sql', usedInModel: true },
  { sheet: 'CARLINE', sql: 'BI_AN_VENTAS.Carline / SER_VEHICULO.VEH_TIPOAUTO', source: 'sql', usedInModel: true },
  { sheet: 'TIPO DE VENTA / TIPO VENTA', sql: 'ADE_VTAFI.VTE_FORMAPAGO / BI_AN_VENTAS.Est_Tipo_venta', source: 'sql', usedInModel: true },
  { sheet: 'NUMERO DE PEDIDO', sql: 'BI_AN_VENTAS.pedido', source: 'sql', usedInModel: false },
  { sheet: 'CATALOGO', sql: 'SER_VEHICULO.VEH_CATALOGO / BI_AN_VENTAS.Catalogo', source: 'sql', usedInModel: false },
  { sheet: 'MODELO / AÑO', sql: 'SER_VEHICULO.VEH_ANMODELO / BI_AN_VENTAS.Año_modelo', source: 'sql', usedInModel: true },
  { sheet: 'COLOR EXTERIOR', sql: 'UNI_CATACOLOR.COL_DESCRIPCION', source: 'sql', usedInModel: false },
  { sheet: 'NUMERO DE SERIE', sql: 'ADE_VTAFI.VTE_SERIE / BI_AN_VENTAS.Num_serie', source: 'sql', usedInModel: false },
  { sheet: 'NUMERO DE FACTURA', sql: 'ADE_VTAFI.VTE_DOCTO / BI_AN_VENTAS.factura', source: 'sql', usedInModel: false },
  { sheet: 'NOMBRE DEL CLIENTE', sql: 'PER_PERSONAS (cliente) / BI_AN_VENTAS.Cliente', source: 'sql', usedInModel: false },
  { sheet: 'ESTADO', sql: 'PNC_PARAMETR / BI_AN_VENTAS.Estado', source: 'sql', usedInModel: true },
  { sheet: 'NOMBRE DEL VENDEDOR', sql: 'PER_PERSONAS (vendedor) / BI_AN_VENTAS.Ejecutivo_cuenta', source: 'sql', usedInModel: false },
  { sheet: 'VENTA TOTAL / VENTA SUBTOTAL', sql: 'BI_AN_VENTAS.Venta', source: 'sql', usedInModel: false },
  { sheet: 'COSTO / COSTO NETO', sql: 'BI_AN_VENTAS.Costo / CostoBPRO', source: 'sql', usedInModel: false },
  { sheet: 'BONIFICACIONES', sql: 'BI_AN_VENTAS.Bonificaciones', source: 'sql', usedInModel: false },
  { sheet: 'DIAS INVENTARIO', sql: 'BI_AN_VENTAS.Dias_en_inventario', source: 'sql', usedInModel: false },
  { sheet: 'MARCA', sql: 'BI_AN_VENTAS.Marca', source: 'sql', usedInModel: true },
  { sheet: 'DESCRIPCION UNIDAD', sql: 'SER_VEHICULO.VEH_TIPOAUTO / BI_AN_VENTAS.Modelo', source: 'sql', usedInModel: true },
  { sheet: 'REPUVE', sql: 'SER_VEHICULO.VEH_REPUVE', source: 'sql', usedInModel: false },
  { sheet: 'SEXO', sql: 'PER_PERSONAS.PER_SEXO', source: 'sql', usedInModel: false },
  { sheet: 'CORREO / TELÉFONO / DIRECCIÓN', sql: 'PER_PERSONAS (parcial)', source: 'sql', usedInModel: false },
  { sheet: 'MONTO_FINANCIAR / ENGANCHE / TASA / PLAZO / MENSUALIDAD', sql: 'No disponible en tablas operativas actuales', source: 'sheet-only', usedInModel: false },
  { sheet: 'GAP / GTIA EXT / ON STAR / PAQUETE', sql: 'No disponible en tablas operativas actuales', source: 'sheet-only', usedInModel: false },
  { sheet: 'ID SOFIA', sql: 'Tablas SOFIA (entregas)', source: 'sql-partial', usedInModel: false },
];

const SHEET_PATH = path.join(__dirname, '../../data/forecast-source.csv');

function parseSheetMonthly() {
  if (!fs.existsSync(SHEET_PATH)) return [];
  const text = fs.readFileSync(SHEET_PATH, 'utf8');
  const lines = text.split(/\r?\n/).filter(Boolean);
  const map = new Map();

  for (let i = 1; i < lines.length; i++) {
    const match = lines[i].match(/^"?(\d{1,2}\/\d{1,2}\/\d{4})"?/);
    if (!match) continue;
    const [day, month, year] = match[1].split('/').map(Number);
    if (!year || !month) continue;
    const key = `${year}-${String(month).padStart(2, '0')}`;
    map.set(key, (map.get(key) || 0) + 1);
  }

  return [...map.entries()]
    .map(([key, units]) => {
      const [yr, mo] = key.split('-').map(Number);
      return { yr, mo, units, key };
    })
    .sort((a, b) => (a.yr - b.yr) || (a.mo - b.mo));
}

function aggregateMonthlyFromVentas(rows) {
  const map = new Map();
  for (const row of rows || []) {
    const fecha = fechaNav(row.fecha);
    if (!fecha) continue;
    const yr = fecha.getUTCFullYear();
    const mo = fecha.getUTCMonth() + 1;
    const key = `${yr}-${String(mo).padStart(2, '0')}`;
    map.set(key, (map.get(key) || 0) + 1);
  }
  return [...map.entries()]
    .map(([key, units]) => {
      const [yr, mo] = key.split('-').map(Number);
      return { yr, mo, units, key };
    })
    .sort((a, b) => (a.yr - b.yr) || (a.mo - b.mo));
}

function breakdownFromVentasRows(rows, { monthsBack = 12 } = {}) {
  const corte = new Date();
  corte.setUTCDate(1);
  corte.setUTCMonth(corte.getUTCMonth() - monthsBack);
  const byTipo = new Map();
  const byModelo = new Map();
  for (const row of rows || []) {
    const fecha = fechaNav(row.fecha);
    if (!fecha || fecha < corte) continue;
    const marca = marcaDeGrupo(row.grupo) || 'Otro';
    byTipo.set(marca, (byTipo.get(marca) || 0) + 1);
    const modelo = String(row.modelo || row.modeloCodigo || 'Sin modelo').trim().slice(0, 28) || 'Sin modelo';
    byModelo.set(modelo, (byModelo.get(modelo) || 0) + 1);
  }
  const top = (map) => [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([label, units]) => ({ label, units }));
  return { byTipo: top(byTipo), byModelo: top(byModelo) };
}

async function loadMonthlyFromIncadea() {
  if (!db.configurado()) return { history: [], rows: [] };
  const mapeo = leerPrivado('incadea-mapeo', { opcional: true, porDefecto: {} });
  const ahora = new Date();
  const desde = new Date(Date.UTC(ahora.getUTCFullYear() - 4, ahora.getUTCMonth(), 1));
  const hasta = new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth() + 1, 1));
  const iso = (d) => d.toISOString().slice(0, 10);
  const rows = await db.consultar(queries.retailVentas(mapeo.data || {}, {
    desde: iso(desde),
    hasta: iso(hasta),
  }));
  return {
    history: aggregateMonthlyFromVentas(rows),
    rows: rows || [],
  };
}

function parseSheetBreakdown() {
  if (!fs.existsSync(SHEET_PATH)) return { byTipo: [], byModelo: [] };
  const text = fs.readFileSync(SHEET_PATH, 'utf8');
  const lines = text.split(/\r?\n/).filter(Boolean);
  const corte = new Date();
  corte.setUTCDate(1);
  corte.setUTCMonth(corte.getUTCMonth() - 12);
  const byTipo = new Map();
  const byModelo = new Map();
  for (let i = 1; i < lines.length; i++) {
    const m = lines[i].match(/^"?(\d{1,2}\/\d{1,2}\/\d{4})"?,"?([^"]*?)"?,"?([^"]*?)"?/);
    if (!m) continue;
    const parts = m[1].split('/');
    const fecha = new Date(Date.UTC(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0])));
    if (fecha < corte) continue;
    const carline = (m[2] || 'Sin carline').trim() || 'Sin carline';
    let tipo = (m[3] || 'Otros').trim() || 'Otros';
    if (/GMF|CREDITO|CRÉDITO/i.test(tipo)) tipo = 'GMF';
    else if (/CONTADO/i.test(tipo)) tipo = 'CONTADO';
    else if (/FLOT/i.test(tipo)) tipo = 'FLOTILLA';
    byModelo.set(carline, (byModelo.get(carline) || 0) + 1);
    byTipo.set(tipo, (byTipo.get(tipo) || 0) + 1);
  }
  const top = (map) => [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([label, units]) => ({ label, units }));
  return { byTipo: top(byTipo), byModelo: top(byModelo) };
}

function elegirHistorial(fuentes) {
  const orden = [
    { key: 'incadea', min: 6, label: 'incadea' },
    { key: 'sql', min: 6, label: 'sql' },
    { key: 'sheet', min: 3, label: 'spreadsheet' },
  ];
  for (const opt of orden) {
    const hist = fuentes[opt.key] || [];
    if (hist.length >= opt.min) return { history: hist, dataSource: opt.label };
  }
  const fallback = fuentes.sheet?.length ? fuentes.sheet : (fuentes.incadea?.length ? fuentes.incadea : fuentes.sql);
  if (fallback?.length) {
    return {
      history: fallback,
      dataSource: fuentes.sheet?.length === fallback.length ? 'spreadsheet' : (fuentes.incadea?.length === fallback.length ? 'incadea' : 'sql'),
    };
  }
  return { history: [], dataSource: 'none' };
}

async function loadMonthlyFromSql() {
  const rows = await query(`
    SELECT
      YEAR(CONVERT(DATE, ADE_VTAFI.VTE_FECHDOCTO, 103)) AS yr,
      MONTH(CONVERT(DATE, ADE_VTAFI.VTE_FECHDOCTO, 103)) AS mo,
      COUNT(*) AS units
    FROM ADE_VTAFI
    INNER JOIN SER_VEHICULO
      ON SER_VEHICULO.VEH_NUMSERIE = ADE_VTAFI.VTE_SERIE
      AND SER_VEHICULO.VEH_NOINVENTA > 0
    WHERE ADE_VTAFI.VTE_TIPODOCTO = 'A'
      AND ADE_VTAFI.VTE_STATUS = 'I'
      AND SER_VEHICULO.VEH_SITUACION = 'VEN'
      AND ADE_VTAFI.VTE_FORMAPAGO NOT IN ('VENTAMRS', 'VTACON')
    GROUP BY
      YEAR(CONVERT(DATE, ADE_VTAFI.VTE_FECHDOCTO, 103)),
      MONTH(CONVERT(DATE, ADE_VTAFI.VTE_FECHDOCTO, 103))
    ORDER BY yr, mo
  `);

  return rows.map((r) => ({
    yr: Number(r.yr),
    mo: Number(r.mo),
    units: Number(r.units) || 0,
    key: `${r.yr}-${String(r.mo).padStart(2, '0')}`,
  }));
}

async function loadBreakdownFromSql() {
  const byTipo = await query(`
    SELECT TOP 8
      CASE ADE_VTAFI.VTE_FORMAPAGO
        WHEN 'CRE' THEN 'GMF'
        WHEN 'ZACCRE' THEN 'GMF'
        WHEN 'CHCRE' THEN 'GMF'
        WHEN 'FORCRE' THEN 'GMF'
        WHEN 'CASACRE' THEN 'GMF'
        WHEN 'SUAGMF' THEN 'GMF'
        WHEN 'PLNCON' THEN 'CONTADO'
        WHEN 'CON' THEN 'CONTADO'
        WHEN 'CASACON' THEN 'CONTADO'
        WHEN 'CHCON' THEN 'CONTADO'
        WHEN 'FORCON' THEN 'CONTADO'
        WHEN 'ZACCON' THEN 'CONTADO'
        WHEN 'FLOT' THEN 'FLOTILLA'
        WHEN 'FLOTGMF' THEN 'FLOTILLA'
        ELSE ADE_VTAFI.VTE_FORMAPAGO
      END AS label,
      COUNT(*) AS units
    FROM ADE_VTAFI
    INNER JOIN SER_VEHICULO
      ON SER_VEHICULO.VEH_NUMSERIE = ADE_VTAFI.VTE_SERIE
      AND SER_VEHICULO.VEH_NOINVENTA > 0
    WHERE ADE_VTAFI.VTE_TIPODOCTO = 'A'
      AND ADE_VTAFI.VTE_STATUS = 'I'
      AND SER_VEHICULO.VEH_SITUACION = 'VEN'
      AND ADE_VTAFI.VTE_FORMAPAGO NOT IN ('VENTAMRS', 'VTACON')
      AND CONVERT(DATE, ADE_VTAFI.VTE_FECHDOCTO, 103) >= DATEADD(month, -12, GETDATE())
    GROUP BY
      CASE ADE_VTAFI.VTE_FORMAPAGO
        WHEN 'CRE' THEN 'GMF'
        WHEN 'ZACCRE' THEN 'GMF'
        WHEN 'CHCRE' THEN 'GMF'
        WHEN 'FORCRE' THEN 'GMF'
        WHEN 'CASACRE' THEN 'GMF'
        WHEN 'SUAGMF' THEN 'GMF'
        WHEN 'PLNCON' THEN 'CONTADO'
        WHEN 'CON' THEN 'CONTADO'
        WHEN 'CASACON' THEN 'CONTADO'
        WHEN 'CHCON' THEN 'CONTADO'
        WHEN 'FORCON' THEN 'CONTADO'
        WHEN 'ZACCON' THEN 'CONTADO'
        WHEN 'FLOT' THEN 'FLOTILLA'
        WHEN 'FLOTGMF' THEN 'FLOTILLA'
        ELSE ADE_VTAFI.VTE_FORMAPAGO
      END
    ORDER BY units DESC
  `);

  const byModelo = await query(`
    SELECT TOP 8
      ISNULL(SER_VEHICULO.VEH_TIPOAUTO, 'Sin modelo') AS label,
      COUNT(*) AS units
    FROM ADE_VTAFI
    INNER JOIN SER_VEHICULO
      ON SER_VEHICULO.VEH_NUMSERIE = ADE_VTAFI.VTE_SERIE
      AND SER_VEHICULO.VEH_NOINVENTA > 0
    WHERE ADE_VTAFI.VTE_TIPODOCTO = 'A'
      AND ADE_VTAFI.VTE_STATUS = 'I'
      AND SER_VEHICULO.VEH_SITUACION = 'VEN'
      AND ADE_VTAFI.VTE_FORMAPAGO NOT IN ('VENTAMRS', 'VTACON')
      AND CONVERT(DATE, ADE_VTAFI.VTE_FECHDOCTO, 103) >= DATEADD(month, -12, GETDATE())
    GROUP BY SER_VEHICULO.VEH_TIPOAUTO
    ORDER BY units DESC
  `);

  return {
    byTipo: byTipo.map((r) => ({ label: String(r.label || '').trim(), units: Number(r.units) || 0 })),
    byModelo: byModelo.map((r) => ({ label: String(r.label || '').trim().slice(0, 28), units: Number(r.units) || 0 })),
  };
}

async function getForecast({ horizon = 6 } = {}) {
  const months = Math.min(12, Math.max(3, parseInt(horizon, 10) || 6));
  let breakdown = { byTipo: [], byModelo: [] };
  let sqlError = null;
  let incadeaError = null;
  let incadeaRows = [];

  const sheetHistory = parseSheetMonthly();
  let sqlHistory = [];
  let incadeaHistory = [];

  try {
    const inc = await loadMonthlyFromIncadea();
    incadeaHistory = inc.history;
    incadeaRows = inc.rows;
  } catch (err) {
    incadeaError = err.message;
  }

  try {
    sqlHistory = await loadMonthlyFromSql();
  } catch (err) {
    sqlError = err.message;
  }

  let { history, dataSource } = elegirHistorial({
    incadea: incadeaHistory,
    sql: sqlHistory,
    sheet: sheetHistory,
  });

  if (!history.length) {
    throw new Error(
      incadeaError || sqlError
        ? `Sin historial de ventas. ${[incadeaError && `Incadea: ${incadeaError}`, sqlError && `SQL: ${sqlError}`].filter(Boolean).join(' · ')}`
        : 'Sin historial de ventas en Incadea, SQL ni en forecast-source.csv.'
    );
  }

  if (dataSource === 'incadea' && incadeaRows.length) {
    breakdown = breakdownFromVentasRows(incadeaRows);
  } else if (dataSource === 'sql') {
    try {
      breakdown = await loadBreakdownFromSql();
    } catch {
      breakdown = parseSheetBreakdown();
    }
  } else {
    breakdown = parseSheetBreakdown();
  }

  let result;
  try {
    result = forecastSales(history, months);
  } catch (err) {
    if (sheetHistory.length && dataSource !== 'spreadsheet') {
      result = forecastSales(sheetHistory, months);
      history = sheetHistory;
      dataSource = 'spreadsheet';
      breakdown = parseSheetBreakdown();
    } else {
      throw err;
    }
  }

  const lastActual = result.lastCompleteMonth || history[history.length - 1];
  const nextForecast = result.forecast[0];
  const totalForecast = result.forecast.reduce((s, r) => s + r.units, 0);
  const completeHistory = result.incompleteMonth
    ? history.slice(0, -1)
    : history;
  const avgHistory = completeHistory.slice(-12).reduce((s, r) => s + r.units, 0)
    / Math.min(12, completeHistory.length || 1);
  const variation = avgHistory > 0 && nextForecast
    ? Math.round(((nextForecast.units - avgHistory) / avgHistory) * 1000) / 10
    : null;

  return {
    dataSource,
    sqlError,
    fieldMapping: FIELD_MAPPING,
    kpis: {
      lastMonthUnits: lastActual?.units ?? 0,
      lastMonthLabel: lastActual?.label || result.lastCompleteMonth?.label || '',
      nextMonthUnits: nextForecast?.units ?? 0,
      nextMonthLabel: nextForecast?.label || '',
      horizonTotal: totalForecast,
      horizonMonths: months,
      avgLast12: Math.round(avgHistory),
      variationPct: variation,
      mape: result.metrics.mape,
      incompleteMonth: result.incompleteMonth
        ? `${result.incompleteMonth.label} (${result.incompleteMonth.units} uds parciales)`
        : null,
    },
    ...result,
    breakdown,
    notes: [
      dataSource === 'incadea'
        ? 'Historial mensual desde Incadea (ventas retail facturadas, últimos 48 meses).'
        : dataSource === 'spreadsheet'
          ? 'Historial desde backend/data/forecast-source.csv (respaldo o transición de marca).'
          : 'Historial desde SQL legacy (ADE_VTAFI + SER_VEHICULO).',
      'Si la regresión OLS no converge, se usa media estacional por mes calendario.',
      'El mix por marca/modelo usa la misma fuente que alimenta el pronóstico cuando Incadea está disponible.',
      incadeaError && dataSource !== 'incadea' ? `Incadea no usada: ${incadeaError}` : null,
      sqlError && dataSource !== 'sql' ? `SQL legacy no usado: ${sqlError}` : null,
    ].filter(Boolean),
  };
}

module.exports = { getForecast, FIELD_MAPPING };
