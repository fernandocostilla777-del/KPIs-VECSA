const { leerPrivado } = require('../incadea/privateStore');
const db = require('../incadea/db');
const queries = require('../incadea/queries');
const {
  agruparRetail,
  resumirInventario,
  contarBev,
  clasificarUnidad,
} = require('../incadea/transform');
const engine = require('./bonosEngine');
const { parseTrimestre } = require('./bonosService');

const ARCHIVOS = [
  'bonos-2026',
  'bonos-captura-2026',
  'bonos-objetivos-2026',
  'incadea-mapeo',
  'unidades-especiales',
];

function rangoTrimestre(anio, trimestre) {
  const inicioMes = (trimestre - 1) * 3;
  const desde = new Date(Date.UTC(anio, inicioMes, 1));
  const hasta = new Date(Date.UTC(anio, inicioMes + 3, 1));
  const fin = new Date(Date.UTC(anio, inicioMes + 3, 0));
  return { desde, hasta, fin };
}

function iso(fecha) {
  return fecha.toISOString().slice(0, 10);
}

function corteDe(fin, hoy) {
  const actual = hoy ? new Date(hoy) : new Date();
  return actual.getTime() < fin.getTime() ? actual : fin;
}

function leerInsumos(insumos) {
  const tomar = (clave, nombre, opciones) => {
    if (insumos && Object.prototype.hasOwnProperty.call(insumos, clave)) return insumos[clave];
    return leerPrivado(nombre, opciones);
  };
  return {
    config: tomar('config', 'bonos-2026'),
    captura: tomar('captura', 'bonos-captura-2026'),
    objetivos: tomar('objetivos', 'bonos-objetivos-2026'),
    mapeo: tomar('mapeo', 'incadea-mapeo'),
    especiales: tomar('especiales', 'unidades-especiales', { opcional: true, porDefecto: {} }),
  };
}

function getEstado() {
  const archivos = {};
  for (const nombre of ARCHIVOS) {
    const leido = leerPrivado(nombre, { opcional: true, porDefecto: null });
    archivos[nombre] = {
      presente: !leido.ausente,
      datosEjemplo: Boolean(leido.datosEjemplo),
      archivo: leido.archivo,
    };
  }
  return {
    configurado: db.configurado(),
    consultaBd: false,
    archivos,
  };
}

async function getValidacionEstatus(queryFn = db.consultar) {
  if (!db.configurado() && queryFn === db.consultar) {
    const err = new Error('La conexión Incadea no está configurada.');
    err.status = 503;
    throw err;
  }
  const mapeo = leerPrivado('incadea-mapeo');
  const consulta = queries.validacionEstatusYGrupos(mapeo.data);
  const filas = await queryFn(consulta);
  return {
    datosEjemplo: mapeo.datosEjemplo,
    filas: filas || [],
  };
}

async function getResumenIncadea(trimestreRaw, { queryFn = db.consultar, hoy, insumos } = {}) {
  const trimestre = parseTrimestre(trimestreRaw);
  const fuentes = leerInsumos(insumos);
  const datosEjemplo = [fuentes.config, fuentes.captura, fuentes.objetivos, fuentes.mapeo, fuentes.especiales]
    .some((f) => f.datosEjemplo);
  const mapeo = fuentes.mapeo.data || {};
  const anio = fuentes.objetivos.data?.anio || fuentes.config.data?.anio;
  const carta = fuentes.objetivos.data?.trimestres?.[String(trimestre)];
  if (!carta) {
    const err = new Error(`No hay carta de objetivos para el trimestre ${trimestre}.`);
    err.status = 404;
    throw err;
  }

  const { desde, hasta, fin } = rangoTrimestre(anio, trimestre);
  const corte = corteDe(fin, hoy);
  const retailRows = await queryFn(queries.retailVentas(mapeo, { desde: iso(desde), hasta: iso(hasta) }));
  const inventarioRows = await queryFn(queries.inventarioAlCorte(mapeo));
  const demoRows = await queryFn(queries.demoActivos(mapeo));

  const retail = agruparRetail(retailRows);
  const especiales = fuentes.especiales.data || {};
  const inventario = resumirInventario(inventarioRows, {
    corte,
    diasMinimos: mapeo.antiguedadDias || 120,
    bloqueos: especiales.bloqueoSuministro || [],
  });
  const bevContados = contarBev(
    [...(retailRows || []), ...(inventarioRows || [])],
    mapeo.bev?.regexModelo,
  );

  const capturaTrimestre = fuentes.captura.data?.trimestres?.[String(trimestre)] || {};
  const mesesCarta = Array.isArray(carta.meses) ? carta.meses : [];
  const meses = mesesCarta.map((mes) => ({
    mes: mes.mes,
    etiqueta: mes.etiqueta,
    objetivo: Number(mes.objetivo) || 0,
    retail: retail.porMes[mes.mes] || 0,
    cerrado: mes.cerrado != null ? mes.cerrado !== false : true,
  }));

  const inventarioCaptura = Array.isArray(capturaTrimestre.calidad?.inventarios)
    ? capturaTrimestre.calidad.inventarios
    : [];
  const inventarios = meses.map((mes) => {
    const manual = inventarioCaptura.find((item) => Number(item.mes) === Number(mes.mes)) || {};
    const patio = manual.patioVdc != null ? Number(manual.patioVdc) : 0;
    return {
      mes: mes.mes,
      etiqueta: mes.etiqueta,
      unidades: inventario.total,
      antiguedadAlta: inventario.antiguos,
      bloqueoSuministro: inventario.bloqueo,
      patioVdc: patio,
    };
  });

  const bevManual = capturaTrimestre.calidad?.bev || {};
  const bev = bevContados == null
    ? { real: Number(bevManual.real) || 0, objetivo: Number(carta.bev?.objetivo) || Number(bevManual.objetivo) || 0 }
    : { real: bevContados, objetivo: Number(carta.bev?.objetivo) || 0 };

  const grupoCaptura = capturaTrimestre.grupo || {};
  const armado = {
    trimestre,
    etiqueta: capturaTrimestre.etiqueta || `T${trimestre}`,
    meses,
    grupo: {
      real: grupoCaptura.real != null ? grupoCaptura.real : retail.unidades,
      objetivo: carta.grupo?.objetivo ?? grupoCaptura.objetivo,
    },
    orientacion: capturaTrimestre.orientacion || {},
    calidad: { bev, inventarios },
    topes: capturaTrimestre.topes || {},
    penalizaciones: capturaTrimestre.penalizaciones || {},
  };

  const resumen = engine.calcularTrimestre(armado, fuentes.config.data);
  const advertencias = [
    'Base de pago aproximada con el campo costo_compra; calibrar contra una factura de BMW.',
    'Retail por fecha de venta en Incadea, no por fecha de reporte en DCS.',
  ];
  if (inventario.omitidas > 0) {
    advertencias.push('Unidades de inventario sin fecha de compra válida no entran al cálculo.');
  }
  const sinVdc = inventarios.some((mes) => mes.patioVdc === 0);
  if (sinVdc) advertencias.push('Falta capturar unidades con ≥90 días en VDC (se asume 0).');
  if (bevContados == null) advertencias.push('Sin patrón BEV en el mapeo, se usa la captura manual.');
  if (datosEjemplo) advertencias.push('Se están usando plantillas de ejemplo.');
  if (grupoCaptura.real == null) {
    advertencias.push('El alcance de grupo usa el retail de la concesionaria porque la captura no trae el real de grupo.');
  }

  const clasificacion = {};
  for (const row of inventarioRows || []) {
    const tipo = clasificarUnidad({
      vin: row.vin,
      grupo: row.grupo,
      estatus: row.estatus,
      especiales,
      mapeo,
    });
    clasificacion[tipo] = (clasificacion[tipo] || 0) + 1;
  }

  return {
    trimestre,
    anio,
    datosEjemplo,
    advertencias,
    montoEstimado: resumen.neto.neto,
    resumen,
    diagnostico: {
      retail: retail.unidades,
      fechasIgnoradas: retail.ignoradas,
      inventario,
      demos: (demoRows || []).length,
      clasificacion,
      basePago: mapeo.basePago || 'costo_compra',
    },
  };
}

module.exports = {
  getEstado,
  getValidacionEstatus,
  getResumenIncadea,
};
