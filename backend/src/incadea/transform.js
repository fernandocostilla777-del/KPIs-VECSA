/**
 * Transformaciones puras de filas Incadea. No consultan la base.
 */

const MARCAS = { B: 'BMW', M: 'MINI', T: 'Motorrad' };

function fechaNav(value) {
  if (value == null || value === '') return null;
  const fecha = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(fecha.getTime())) return null;
  const anio = fecha.getUTCFullYear();
  const mes = fecha.getUTCMonth();
  const dia = fecha.getUTCDate();
  if (anio === 1753 && mes === 0 && dia === 1) return null;
  return fecha;
}

function marcaDeGrupo(grupo, mapa = MARCAS) {
  const texto = String(grupo || '');
  if (texto.length < 3) return null;
  return mapa[texto[2].toUpperCase()] || null;
}

function vinsDe(lista) {
  return new Set((Array.isArray(lista) ? lista : []).map((v) => String(v || '').trim().toUpperCase()).filter(Boolean));
}

/**
 * Prioridad: lista manual por VIN → grupo de inventario → estatus → nuevo.
 */
function clasificarUnidad({ vin, grupo, estatus, especiales, mapeo } = {}) {
  const clave = String(vin || '').trim().toUpperCase();
  const manual = especiales || {};
  const orden = [
    ['loaner', 'loaner'],
    ['topManagement', 'top'],
    ['tactic', 'tactic'],
    ['empleado', 'empleado'],
    ['flotilla', 'flotilla'],
    ['demo', 'demo'],
  ];
  for (const [campo, tipo] of orden) {
    if (clave && vinsDe(manual[campo]).has(clave)) return tipo;
  }

  const textoGrupo = String(grupo || '');
  const patrones = mapeo?.grupos || {};
  if (patrones.demo && new RegExp(patrones.demo, 'i').test(textoGrupo)) return 'demo';
  if (patrones.usado && new RegExp(patrones.usado, 'i').test(textoGrupo)) return 'seminuevo';

  const codigo = Number(estatus);
  const catalogo = mapeo?.estatus || {};
  if (codigo === Number(catalogo.demo)) return 'demo';
  if (codigo === Number(catalogo.usado)) return 'seminuevo';
  return 'nuevo';
}

function agruparRetail(rows) {
  const porMes = {};
  let ignoradas = 0;
  let unidades = 0;
  for (const row of rows || []) {
    const fecha = fechaNav(row.fecha);
    if (!fecha) {
      ignoradas += 1;
      continue;
    }
    const mes = fecha.getUTCMonth() + 1;
    porMes[mes] = (porMes[mes] || 0) + 1;
    unidades += 1;
  }
  return { porMes, ignoradas, unidades };
}

function diasEntre(desde, hasta) {
  const a = Date.UTC(desde.getUTCFullYear(), desde.getUTCMonth(), desde.getUTCDate());
  const b = Date.UTC(hasta.getUTCFullYear(), hasta.getUTCMonth(), hasta.getUTCDate());
  return Math.floor((b - a) / 86400000);
}

function resumirInventario(rows, { corte, diasMinimos = 120, bloqueos = [] } = {}) {
  const hasta = corte instanceof Date ? corte : new Date(corte || Date.now());
  const bloqueadas = vinsDe(bloqueos);
  let total = 0;
  let antiguos = 0;
  let bloqueo = 0;
  let omitidas = 0;

  for (const row of rows || []) {
    const fecha = fechaNav(row.fechaCompra);
    if (!fecha) {
      omitidas += 1;
      continue;
    }
    total += 1;
    const edad = diasEntre(fecha, hasta);
    if (edad >= Number(diasMinimos)) {
      antiguos += 1;
      const vin = String(row.vin || '').trim().toUpperCase();
      if (vin && bloqueadas.has(vin)) bloqueo += 1;
    }
  }

  const pct = total > 0 ? Math.floor(((antiguos - bloqueo) / total) * 100) / 100 : 0;
  return { total, antiguos, bloqueo, omitidas, pct };
}

function contarBev(rows, regexModelo) {
  const patron = String(regexModelo || '').trim();
  if (!patron) return null;
  let re;
  try {
    re = new RegExp(patron, 'i');
  } catch {
    return null;
  }
  return (rows || []).filter((row) => re.test(String(row.modelo || '')) || re.test(String(row.modeloCodigo || ''))).length;
}

module.exports = {
  MARCAS,
  fechaNav,
  marcaDeGrupo,
  clasificarUnidad,
  agruparRetail,
  resumirInventario,
  contarBev,
};
