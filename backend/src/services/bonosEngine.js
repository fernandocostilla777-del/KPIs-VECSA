/**
 * Motor de reglas del Sistema de Bonos 2026 (BMW).
 * Funciones puras: no lee archivos ni base de datos.
 * Porcentajes, umbrales y topes llegan en la configuración.
 */

function dinero(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.round(v * 100) / 100;
}

function alcance(real, objetivo) {
  const den = Number(objetivo);
  if (!Number.isFinite(den) || den <= 0) return 0;
  const num = Number(real);
  if (!Number.isFinite(num)) return 0;
  return num / den;
}

/**
 * % de unidades con antigüedad alta (≥120 días).
 * floor(((antiguos − bloqueo de suministro) / total) × 100), expresado de 0 a 1.
 */
function pctAntiguedadAlta({ unidades, antiguedadAlta, bloqueoSuministro } = {}) {
  const total = Number(unidades);
  if (!Number.isFinite(total) || total <= 0) return 0;
  const netos = Math.max(0, (Number(antiguedadAlta) || 0) - (Number(bloqueoSuministro) || 0));
  return Math.floor((netos / total) * 100) / 100;
}

function factorBanda(alcanceTrimestral, bandas) {
  const lista = Array.isArray(bandas) ? bandas : [];
  const orden = [...lista].sort((a, b) => Number(b.desde) - Number(a.desde));
  for (const banda of orden) {
    if (alcanceTrimestral + 1e-9 >= Number(banda.desde)) return Number(banda.factor) || 0;
  }
  return 0;
}

function clasificarAnticipo(alcanceMensual, volumenCfg) {
  const completo = Number(volumenCfg.umbralCompleto);
  const parcial = Number(volumenCfg.umbralParcial);
  if (alcanceMensual + 1e-9 >= completo) return 'completo';
  if (alcanceMensual + 1e-9 >= parcial) return 'parcial';
  return 'ninguno';
}

function montoAnticipo(clasificacion, volumenCfg) {
  const slice = Number(volumenCfg.maximoTrimestral) / 3;
  if (clasificacion === 'completo') return dinero(slice * (Number(volumenCfg.factorCompleto) || 0));
  if (clasificacion === 'parcial') return dinero(slice * (Number(volumenCfg.factorParcial) || 0));
  return 0;
}

function tipoLiquidacion(monto) {
  if (monto > 0.005) return 'pago';
  if (monto < -0.005) return 'debito';
  return 'sin_movimiento';
}

function calcularVolumen(input, volumenCfg) {
  const cfg = volumenCfg || {};
  const crudos = Array.isArray(input?.meses) ? input.meses.slice(0, 3) : [];
  while (crudos.length < 3) crudos.push({ retail: 0, objetivo: 0, cerrado: false });

  const meses = crudos.map((mes, index) => {
    const cerrado = mes.cerrado !== false;
    const alc = alcance(mes.retail, mes.objetivo);
    const clasificacion = clasificarAnticipo(alc, cfg);
    const esAnticipo = index < 2;
    const anticipo = esAnticipo && cerrado ? montoAnticipo(clasificacion, cfg) : 0;
    return {
      indice: index + 1,
      mes: mes.mes ?? null,
      etiqueta: mes.etiqueta || `Mes ${index + 1}`,
      retail: Number(mes.retail) || 0,
      objetivo: Number(mes.objetivo) || 0,
      cerrado,
      alcance: alc,
      clasificacion: esAnticipo ? clasificacion : 'liquidacion',
      anticipo,
    };
  });

  const retail = meses.reduce((s, m) => s + m.retail, 0);
  const objetivo = meses.reduce((s, m) => s + m.objetivo, 0);
  const alcanceTrimestral = alcance(retail, objetivo);
  const factor = factorBanda(alcanceTrimestral, cfg.bandas);

  const grupo = input?.grupo || {};
  const evaluaGrupo = grupo.objetivo != null && grupo.objetivo !== '';
  const alcanceGrupo = evaluaGrupo ? alcance(grupo.real, grupo.objetivo) : null;
  const grupoOk = !evaluaGrupo || alcanceGrupo + 1e-9 >= Number(cfg.alcanceGrupoMinimo);
  const factorGrupo = grupoOk ? 1 : (Number(cfg.factorSiGrupoNoAlcanza) || 0);

  const bonoTrimestral = dinero(Number(cfg.maximoTrimestral) * factor * factorGrupo);
  const anticipos = dinero(meses.reduce((s, m) => s + m.anticipo, 0));
  const pagoMes3 = dinero(bonoTrimestral - anticipos);
  const cerrados = meses.filter((m) => m.cerrado).length;

  return {
    meses,
    retail,
    objetivo,
    alcanceTrimestral,
    factor,
    grupo: evaluaGrupo ? {
      real: Number(grupo.real) || 0,
      objetivo: Number(grupo.objetivo) || 0,
      alcance: alcanceGrupo,
      cumple: grupoOk,
    } : null,
    bonoTrimestral,
    anticipos,
    pagoMes3,
    tipoMes3: tipoLiquidacion(pagoMes3),
    provisional: cerrados < 3,
  };
}

function porcion(cumpleFlags, peso, maximo) {
  if (!cumpleFlags.length) return 0;
  const ok = cumpleFlags.filter(Boolean).length;
  return dinero((ok / cumpleFlags.length) * Number(peso) * Number(maximo));
}

function calcularOrientacion(input, orientacionCfg) {
  const cfg = orientacionCfg || {};
  const maximo = Number(cfg.maximo) || 0;
  const src = input || {};

  const mkt = src.mercadotecnia || {};
  const mktCfg = cfg.mercadotecnia || {};
  const certificado = mkt.responsableCertificado === true;
  const mercadotecnia = certificado
    ? porcion([
      alcance(mkt.usoFondo, 1) + 1e-9 >= Number(mktCfg.umbralUsoFondo),
      mkt.activacionEstrategica === true,
      mkt.plan === true,
    ], mktCfg.peso, maximo)
    : 0;

  const vocSrc = src.voc || {};
  const vocCfg = cfg.voc || {};
  const incidencias = Number(vocSrc.incidencias) || 0;
  const vocCancelado = incidencias >= Number(vocCfg.incidenciasCancelan);
  const voc = vocCancelado
    ? 0
    : porcion([
      vocSrc.cxa === true,
      vocSrc.customerBoard === true,
      vocSrc.calidadDatos === true,
    ], vocCfg.peso, maximo);

  const rs = src.retailStandards || {};
  const rsCfg = cfg.retailStandards || {};
  const retailStandards = porcion([
    rs.objetivos === true,
    rs.remodelacion === true,
  ], rsCfg.peso, maximo);

  const ent = src.entrenamiento || {};
  const entCfg = cfg.entrenamiento || {};
  const precondiciones = ent.tmsi === true && ent.dms === true;
  const entrenamiento = precondiciones
    ? porcion([
      ent.ictXev === true,
      ent.ictTecnicoSenior === true,
      ent.lanzamientoProducto === true,
    ], entCfg.peso, maximo)
    : 0;

  const componentes = [
    {
      id: 'mercadotecnia',
      etiqueta: 'Mercadotecnia',
      monto: mercadotecnia,
      detalle: certificado ? 'Responsable certificado' : 'Sin responsable certificado',
    },
    {
      id: 'voc',
      etiqueta: 'Voice of the Customer',
      monto: voc,
      detalle: vocCancelado
        ? `${incidencias} incidencias: bono VoC cancelado`
        : `${incidencias} ${incidencias === 1 ? 'incidencia' : 'incidencias'}`,
      cancelado: vocCancelado,
    },
    {
      id: 'retailStandards',
      etiqueta: 'Retail Standards 2023+',
      monto: retailStandards,
      detalle: 'Objetivos y remodelación',
    },
    {
      id: 'entrenamiento',
      etiqueta: 'Entrenamiento',
      monto: entrenamiento,
      detalle: precondiciones ? 'TMSi y DMS cumplidos' : 'Faltan precondiciones TMSi/DMS',
    },
  ];

  return {
    total: dinero(componentes.reduce((s, c) => s + c.monto, 0)),
    componentes,
  };
}

function mesCumpleInventario(mes, cfg) {
  const pct = pctAntiguedadAlta(mes);
  const edadOk = pct <= Number(cfg.umbralAntiguedad);
  const exigeVdc = Number(mes.mes) >= Number(cfg.mesInicioVdc);
  const vdcOk = !exigeVdc || Number(mes.patioVdc) >= Number(cfg.unidadesVdcMinimas);
  return { pct, edadOk, exigeVdc, vdcOk, cumple: edadOk && vdcOk };
}

function calcularCalidad(input, calidadCfg) {
  const cfg = calidadCfg || {};
  const maximo = Number(cfg.maximo) || 0;
  const src = input || {};
  const bevCfg = cfg.bev || {};
  const bevSrc = src.bev || {};
  const alcanceBev = alcance(bevSrc.real, bevSrc.objetivo);
  const bevOk = alcanceBev + 1e-9 >= Number(bevCfg.umbral);
  const bev = bevOk ? dinero(Number(bevCfg.peso) * maximo) : 0;

  const invCfg = cfg.inventarios || {};
  const meses = Array.isArray(src.inventarios) ? src.inventarios : [];
  const detalleMeses = meses.map((mes) => ({
    mes: mes.mes ?? null,
    etiqueta: mes.etiqueta || '',
    ...mesCumpleInventario(mes, invCfg),
  }));
  const cumplen = detalleMeses.filter((m) => m.cumple).length;
  const fraccion = detalleMeses.length ? cumplen / detalleMeses.length : 0;
  const inventarios = dinero(fraccion * Number(invCfg.peso) * maximo);

  return {
    total: dinero(bev + inventarios),
    bev: {
      monto: bev,
      alcance: alcanceBev,
      cumple: bevOk,
      real: Number(bevSrc.real) || 0,
      objetivo: Number(bevSrc.objetivo) || 0,
    },
    inventarios: {
      monto: inventarios,
      meses: detalleMeses,
      cumplen,
      evaluados: detalleMeses.length,
    },
  };
}

const TOPE_IDS = [
  { id: 'demo', etiqueta: 'Demo' },
  { id: 'loaner', etiqueta: 'Loaner' },
  { id: 'topManagement', etiqueta: 'Top Management' },
  { id: 'tactic', etiqueta: 'Tactic' },
];

function aplicarTopes(montos, topesCfg) {
  const topes = topesCfg || {};
  const src = montos || {};
  const detalles = TOPE_IDS.map(({ id, etiqueta }) => {
    const solicitado = dinero(Math.max(0, Number(src[id]) || 0));
    const tope = dinero(Number(topes[id]) || 0);
    const aplicado = dinero(Math.min(solicitado, tope));
    return { id, etiqueta, solicitado, tope, aplicado, recortado: solicitado > tope };
  });
  return {
    total: dinero(detalles.reduce((s, d) => s + d.aplicado, 0)),
    detalles,
  };
}

function calcularPenalizaciones(input, penalizacionesCfg) {
  const cfg = penalizacionesCfg || {};
  const src = input || {};
  const mensual = cfg.aplicacionMensual === true;
  const detalles = (cfg.conceptos || []).map((concepto) => {
    const dato = src[concepto.id] || {};
    const cumple = dato.cumple !== false;
    let veces = 0;
    if (!cumple) {
      veces = mensual ? Math.max(1, Number(dato.mesesIncumplidos) || 1) : 1;
    }
    return {
      id: concepto.id,
      etiqueta: concepto.etiqueta || concepto.id,
      cumple,
      veces,
      monto: dinero(veces * (Number(concepto.monto) || 0)),
    };
  });
  return {
    aplicacionMensual: mensual,
    total: dinero(detalles.reduce((s, d) => s + d.monto, 0)),
    detalles,
  };
}

function calcularNeto(partes, maximoTotal) {
  const volumen = dinero(partes.volumen);
  const orientacion = dinero(partes.orientacion);
  const calidad = dinero(partes.calidad);
  const topes = dinero(partes.topes);
  const penalizaciones = dinero(partes.penalizaciones);
  const bruto = dinero(volumen + orientacion + calidad + topes);
  const antesTope = dinero(bruto - penalizaciones);
  const techo = Number(maximoTotal);
  const neto = dinero(Math.min(Number.isFinite(techo) ? techo : antesTope, Math.max(0, antesTope)));
  return {
    volumen,
    orientacion,
    calidad,
    topes,
    penalizaciones,
    bruto,
    neto,
    topado: antesTope > techo,
    enCero: antesTope < 0,
  };
}

function calcularTrimestre(captura, config) {
  const cfg = config || {};
  const src = captura || {};
  const volumen = calcularVolumen(src, cfg.volumen);
  const orientacion = calcularOrientacion(src.orientacion, cfg.orientacion);
  const calidad = calcularCalidad(src.calidad, cfg.calidad);
  const topes = aplicarTopes(src.topes, cfg.topes);
  const penalizaciones = calcularPenalizaciones(src.penalizaciones, cfg.penalizaciones);
  const neto = calcularNeto({
    volumen: volumen.bonoTrimestral,
    orientacion: orientacion.total,
    calidad: calidad.total,
    topes: topes.total,
    penalizaciones: penalizaciones.total,
  }, cfg.maximoTotal);

  return {
    trimestre: src.trimestre ?? null,
    etiqueta: src.etiqueta || (src.trimestre ? `T${src.trimestre}` : ''),
    provisional: volumen.provisional,
    volumen,
    orientacion,
    calidad,
    topes,
    penalizaciones,
    neto,
  };
}

function evaluarEscenarios(config) {
  const lista = Array.isArray(config?.escenarios) ? config.escenarios : [];
  return lista.map((escenario, index) => {
    const volumen = calcularVolumen(escenario, config.volumen);
    return {
      id: escenario.id ?? index + 1,
      nombre: escenario.nombre || `Escenario ${index + 1}`,
      alcanceTrimestral: volumen.alcanceTrimestral,
      anticipos: volumen.anticipos,
      bonoTrimestral: volumen.bonoTrimestral,
      pagoMes3: volumen.pagoMes3,
      tipoMes3: volumen.tipoMes3,
      grupoCumple: volumen.grupo ? volumen.grupo.cumple : null,
      meses: volumen.meses,
    };
  });
}

module.exports = {
  dinero,
  alcance,
  pctAntiguedadAlta,
  factorBanda,
  clasificarAnticipo,
  montoAnticipo,
  tipoLiquidacion,
  calcularVolumen,
  calcularOrientacion,
  calcularCalidad,
  aplicarTopes,
  calcularPenalizaciones,
  calcularNeto,
  calcularTrimestre,
  evaluarEscenarios,
};
