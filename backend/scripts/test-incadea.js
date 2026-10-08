/**
 * Pruebas de la capa Incadea con filas simuladas. No abre la base de datos.
 */
const fs = require('fs');
const path = require('path');
const { fechaNav, marcaDeGrupo, clasificarUnidad, agruparRetail, resumirInventario, contarBev } = require('../src/incadea/transform');
const queries = require('../src/incadea/queries');
const { esSoloLectura } = require('../src/incadea/db');
const { getResumenIncadea, getEstado } = require('../src/services/bonosIncadea');

const dir = path.join(__dirname, '../data/private');
const mapeo = JSON.parse(fs.readFileSync(path.join(dir, 'incadea-mapeo.example.json'), 'utf8'));
const config = JSON.parse(fs.readFileSync(path.join(dir, 'bonos-2026.example.json'), 'utf8'));
const objetivos = JSON.parse(fs.readFileSync(path.join(dir, 'bonos-objetivos-2026.example.json'), 'utf8'));
const captura = JSON.parse(fs.readFileSync(path.join(dir, 'bonos-captura-2026.example.json'), 'utf8'));
const especiales = JSON.parse(fs.readFileSync(path.join(dir, 'unidades-especiales.example.json'), 'utf8'));

let passed = 0;
const failures = [];

function test(nombre, fn) {
  try {
    const out = fn();
    if (out && typeof out.then === 'function') {
      throw new Error('la prueba devolvió una promesa; usa testAsync');
    }
    passed += 1;
    console.log(`✓ ${passed}. ${nombre}`);
  } catch (err) {
    failures.push({ nombre, error: err.message });
    console.log(`✗ ${nombre}: ${err.message}`);
  }
}

async function testAsync(nombre, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`✓ ${passed}. ${nombre}`);
  } catch (err) {
    failures.push({ nombre, error: err.message });
    console.log(`✗ ${nombre}: ${err.message}`);
  }
}

function eq(actual, esperado, etiqueta) {
  if (actual !== esperado) {
    throw new Error(`${etiqueta || 'valor'}: se obtuvo ${JSON.stringify(actual)}, se esperaba ${JSON.stringify(esperado)}`);
  }
}

test('fechaNav trata 1753-01-01 como fecha vacía', () => {
  eq(fechaNav('1753-01-01'), null);
  eq(fechaNav(''), null);
});

test('fechaNav conserva una fecha real de venta', () => {
  const fecha = fechaNav('2026-09-15');
  eq(fecha.getUTCFullYear(), 2026);
  eq(fecha.getUTCMonth(), 8);
});

test('la tercera letra del grupo identifica BMW, MINI o Motorrad', () => {
  eq(marcaDeGrupo('VNB'), 'BMW');
  eq(marcaDeGrupo('VDM'), 'MINI');
  eq(marcaDeGrupo('VUT'), 'Motorrad');
  eq(marcaDeGrupo('VU'), null);
});

test('la lista manual por VIN gana al grupo de inventario', () => {
  const tipo = clasificarUnidad({
    vin: especiales.loaner[0],
    grupo: 'VNB',
    estatus: 0,
    especiales,
    mapeo,
  });
  eq(tipo, 'loaner');
});

test('un grupo VD se clasifica como demo antes que el estatus', () => {
  eq(clasificarUnidad({ vin: 'OTRO', grupo: 'VDB01', estatus: 0, especiales, mapeo }), 'demo');
});

test('sin grupo especial, el estatus usado clasifica seminuevo', () => {
  eq(clasificarUnidad({ vin: 'OTRO', grupo: 'XXX', estatus: mapeo.estatus.usado, especiales, mapeo }), 'seminuevo');
});

test('si no hay VIN, grupo ni estatus reconocible, la unidad es nueva', () => {
  eq(clasificarUnidad({ vin: '', grupo: 'AAA', estatus: 99, especiales, mapeo }), 'nuevo');
});

test('el retail se agrupa por mes y omite la fecha vacía de NAV', () => {
  const retail = agruparRetail([
    { fecha: '2026-07-02' },
    { fecha: '2026-07-20' },
    { fecha: '1753-01-01' },
    { fecha: '2026-09-01' },
  ]);
  eq(retail.porMes[7], 2);
  eq(retail.porMes[9], 1);
  eq(retail.ignoradas, 1);
  eq(retail.unidades, 3);
});

test('el inventario omite unidades sin fecha de compra válida', () => {
  const resumen = resumirInventario([
    { vin: 'A', fechaCompra: '1753-01-01' },
    { vin: 'B', fechaCompra: null },
    { vin: 'C', fechaCompra: '2026-09-01' },
  ], { corte: '2026-09-30', diasMinimos: 120 });
  eq(resumen.omitidas, 2);
  eq(resumen.total, 1);
  eq(resumen.antiguos, 0);
});

test('la antigüedad usa floor(((antiguos − bloqueo) / total) × 100)', () => {
  const resumen = resumirInventario([
    { vin: 'VIEJO', fechaCompra: '2026-01-01' },
    { vin: especiales.bloqueoSuministro[0], fechaCompra: '2026-01-02' },
    { vin: 'NUEVO', fechaCompra: '2026-09-01' },
    { vin: 'SINFECHA', fechaCompra: '1753-01-01' },
  ], { corte: '2026-09-30', diasMinimos: 120, bloqueos: especiales.bloqueoSuministro });
  eq(resumen.total, 3);
  eq(resumen.antiguos, 2);
  eq(resumen.bloqueo, 1);
  eq(resumen.omitidas, 1);
  eq(resumen.pct, Math.floor(((2 - 1) / 3) * 100) / 100);
});

test('contarBev usa el patrón del mapeo y, si no hay patrón, no inventa un conteo', () => {
  const rows = [{ modelo: 'iX3' }, { modelo: 'X5' }, { modeloCodigo: 'i4' }];
  eq(contarBev(rows, ''), null);
  eq(contarBev(rows, '^i'), 2);
});

test('el prefijo de empresa rechaza un valor que no es un identificador', () => {
  let fallo = false;
  try {
    queries.retailVentas({ ...mapeo, empresa: 'Vecsa]; DROP TABLE x' }, { desde: '2026-07-01', hasta: '2026-10-01' });
  } catch (err) {
    fallo = err.status === 400;
  }
  eq(fallo, true);
});

test('las consultas son SELECT y llevan la empresa entre corchetes', () => {
  const venta = queries.retailVentas(mapeo, { desde: '2026-07-01', hasta: '2026-10-01' });
  const inventario = queries.inventarioAlCorte(mapeo);
  const demos = queries.demoActivos(mapeo);
  const validacion = queries.validacionEstatusYGrupos(mapeo);
  for (const q of [venta, inventario, demos, validacion]) {
    if (!/^SELECT\b/i.test(q.text)) throw new Error(`${q.nombre} no empieza con SELECT`);
    if (!q.text.includes('[Vecsa Hidalgo$')) throw new Error(`${q.nombre} no encierra la empresa`);
  }
  eq(venta.text.includes('[Vecsa Hidalgo$Vehicle Ledger Entry]'), true);
});

test('una consulta que no es de lectura se rechaza antes de tocar la base', () => {
  eq(esSoloLectura('UPDATE Vehicle SET [VIN] = 1'), false);
  eq(esSoloLectura('SELECT 1; DELETE FROM Vehicle'), false);
  eq(esSoloLectura('SELECT [VIN] FROM [Vecsa Hidalgo$Vehicle]'), true);
  eq(esSoloLectura('WITH x AS (SELECT 1 AS n) SELECT n FROM x'), true);
});

function envolver(data) {
  return { data, datosEjemplo: true, archivo: 'ejemplo', ausente: false };
}

testAsync('el resumen combina filas simuladas, objetivos y captura, y avisa las aproximaciones', async () => {
  const resultado = await getResumenIncadea(3, {
    hoy: '2026-09-30',
    insumos: {
      config: envolver(config),
      captura: envolver((() => {
        const copia = JSON.parse(JSON.stringify(captura));
        delete copia.trimestres['3'].calidad.inventarios;
        return copia;
      })()),
      objetivos: envolver(objetivos),
      mapeo: envolver(mapeo),
      especiales: envolver(especiales),
    },
    queryFn: async (q) => {
      if (q.nombre === 'retailVentas') {
        return [
          { fecha: '2026-07-10', modelo: 'X1', vin: 'R1' },
          { fecha: '2026-08-10', modelo: 'X3', vin: 'R2' },
          { fecha: '2026-09-10', modelo: 'iX1', vin: 'R3' },
          { fecha: '1753-01-01', modelo: 'X5', vin: 'R4' },
        ];
      }
      if (q.nombre === 'inventarioAlCorte') {
        return [
          { vin: 'VIEJO', fechaCompra: '2026-01-01', grupo: 'VNB', estatus: 0, modelo: 'X5' },
          { vin: especiales.bloqueoSuministro[0], fechaCompra: '2026-01-15', grupo: 'VNB', estatus: 0, modelo: 'X3' },
          { vin: especiales.loaner[0], fechaCompra: '2026-08-01', grupo: 'VNB', estatus: 0, modelo: 'X1' },
          { vin: 'SIN', fechaCompra: '1753-01-01', grupo: 'VDB', estatus: 2, modelo: 'X1' },
        ];
      }
      if (q.nombre === 'demoActivos') return [{ vin: 'D1', grupo: 'VDB', estatus: 2 }];
      return [];
    },
  });
  eq(resultado.datosEjemplo, true);
  eq(typeof resultado.montoEstimado, 'number');
  eq(resultado.montoEstimado >= 0, true);
  eq(resultado.resumen.volumen.meses.length, 3);
  eq(resultado.resumen.volumen.meses[0].retail, 1);
  eq(resultado.diagnostico.inventario.omitidas, 1);
  eq(resultado.diagnostico.clasificacion.loaner, 1);
  const texto = resultado.advertencias.join(' ');
  if (!texto.includes('costo_compra')) throw new Error('falta la advertencia de base de pago');
  if (!texto.includes('DCS')) throw new Error('falta la advertencia de fecha DCS');
  if (!texto.includes('VDC')) throw new Error('falta la advertencia de patio VDC');
  if (!texto.includes('captura manual')) throw new Error('falta la advertencia de BEV manual');
});

test('el estado informa archivos privados y no consulta la base', () => {
  const estado = getEstado();
  eq(estado.consultaBd, false);
  eq(typeof estado.configurado, 'boolean');
  eq(estado.archivos['incadea-mapeo'].presente, true);
  eq(estado.archivos['unidades-especiales'].datosEjemplo, true);
});

Promise.resolve().then(async () => {
  await new Promise((resolve) => setImmediate(resolve));
}).then(() => {
  console.log('');
  if (failures.length) {
    console.log(`${passed} pruebas correctas, ${failures.length} fallaron.`);
    process.exit(1);
  }
  console.log(`${passed} pruebas correctas.`);
});
