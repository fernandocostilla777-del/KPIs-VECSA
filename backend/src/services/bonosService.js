const { leerPrivado } = require('../incadea/privateStore');
const engine = require('./bonosEngine');

function cargarFuentes() {
  const config = leerPrivado('bonos-2026');
  const captura = leerPrivado('bonos-captura-2026');
  return {
    config: config.data,
    captura: captura.data,
    datosEjemplo: config.datosEjemplo || captura.datosEjemplo,
    archivos: {
      config: config.archivo,
      captura: captura.archivo,
    },
  };
}

function configPublica(config) {
  const { notaInterna, ...resto } = config || {};
  return resto;
}

function parseTrimestre(raw) {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 4) {
    const err = new Error('Trimestre inválido. Use un valor de 1 a 4.');
    err.status = 400;
    throw err;
  }
  return n;
}

function capturaDe(fuentes, trimestre) {
  const bolsa = fuentes.captura?.trimestres || {};
  return bolsa[String(trimestre)] || bolsa[trimestre] || null;
}

function resumir(calc) {
  return {
    trimestre: calc.trimestre,
    etiqueta: calc.etiqueta,
    capturado: true,
    provisional: calc.provisional,
    volumen: calc.volumen.bonoTrimestral,
    orientacion: calc.orientacion.total,
    calidad: calc.calidad.total,
    penalizaciones: calc.penalizaciones.total,
    topes: calc.topes.total,
    neto: calc.neto.neto,
    tipoMes3: calc.volumen.tipoMes3,
  };
}

function getConfig() {
  const fuentes = cargarFuentes();
  return {
    anio: fuentes.config.anio,
    marca: fuentes.config.marca,
    datosEjemplo: fuentes.datosEjemplo,
    config: configPublica(fuentes.config),
  };
}

function getAnual() {
  const fuentes = cargarFuentes();
  const trimestres = [1, 2, 3, 4].map((trimestre) => {
    const cap = capturaDe(fuentes, trimestre);
    if (!cap) return { trimestre, etiqueta: `T${trimestre}`, capturado: false };
    return resumir(engine.calcularTrimestre(cap, fuentes.config));
  });
  const capturados = trimestres.filter((t) => t.capturado);
  return {
    anio: fuentes.captura.anio || fuentes.config.anio,
    marca: fuentes.config.marca,
    datosEjemplo: fuentes.datosEjemplo,
    trimestres,
    totales: {
      neto: engine.dinero(capturados.reduce((s, t) => s + t.neto, 0)),
      volumen: engine.dinero(capturados.reduce((s, t) => s + t.volumen, 0)),
      trimestresCapturados: capturados.length,
    },
  };
}

function getResumen(trimestreRaw) {
  const trimestre = parseTrimestre(trimestreRaw);
  const fuentes = cargarFuentes();
  const cap = capturaDe(fuentes, trimestre);
  if (!cap) {
    const err = new Error(`No hay captura para el trimestre ${trimestre}.`);
    err.status = 404;
    throw err;
  }
  return {
    anio: fuentes.captura.anio || fuentes.config.anio,
    marca: fuentes.config.marca,
    datosEjemplo: fuentes.datosEjemplo,
    resumen: engine.calcularTrimestre(cap, fuentes.config),
  };
}

function getEscenarios() {
  const fuentes = cargarFuentes();
  return {
    anio: fuentes.config.anio,
    datosEjemplo: fuentes.datosEjemplo,
    escenarios: engine.evaluarEscenarios(fuentes.config),
  };
}

function simular(body) {
  const meses = body?.meses;
  if (!Array.isArray(meses) || meses.length !== 3) {
    const err = new Error('Se requieren los 3 meses del trimestre, cada uno con retail y objetivo.');
    err.status = 400;
    throw err;
  }
  const fuentes = cargarFuentes();
  return {
    datosEjemplo: fuentes.datosEjemplo,
    volumen: engine.calcularVolumen({
      meses,
      grupo: body.grupo || null,
    }, fuentes.config.volumen),
  };
}

module.exports = {
  parseTrimestre,
  getConfig,
  getAnual,
  getResumen,
  getEscenarios,
  simular,
};
