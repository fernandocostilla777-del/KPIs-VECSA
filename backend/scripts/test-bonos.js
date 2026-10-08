/**
 * Pruebas del motor de bonos.
 * Las expectativas salen de la configuración de ejemplo, no de porcentajes fijos en el código.
 */
const fs = require('fs');
const path = require('path');
const engine = require('../src/services/bonosEngine');

const cfg = JSON.parse(fs.readFileSync(
  path.join(__dirname, '../data/private/bonos-2026.example.json'),
  'utf8',
));
const captura = JSON.parse(fs.readFileSync(
  path.join(__dirname, '../data/private/bonos-captura-2026.example.json'),
  'utf8',
));

let passed = 0;
const failures = [];

function test(nombre, fn) {
  try {
    fn();
    passed += 1;
    console.log(`✓ ${passed}. ${nombre}`);
  } catch (err) {
    failures.push({ nombre, error: err.message });
    console.log(`✗ ${nombre}: ${err.message}`);
  }
}

function eq(actual, esperado, etiqueta) {
  if (actual !== esperado) {
    throw new Error(`${etiqueta || 'valor'}: se obtuvo ${actual}, se esperaba ${esperado}`);
  }
}

function cerca(actual, esperado, etiqueta) {
  if (Math.abs(Number(actual) - Number(esperado)) > 0.02) {
    throw new Error(`${etiqueta || 'valor'}: se obtuvo ${actual}, se esperaba ${esperado}`);
  }
}

const v = cfg.volumen;
const slice = v.maximoTrimestral / 3;

function anticipoEsperado(alcanceMensual) {
  if (alcanceMensual + 1e-9 >= v.umbralCompleto) return engine.dinero(slice * v.factorCompleto);
  if (alcanceMensual + 1e-9 >= v.umbralParcial) return engine.dinero(slice * v.factorParcial);
  return 0;
}

function factorEsperado(alcanceTrimestral) {
  const orden = [...v.bandas].sort((a, b) => b.desde - a.desde);
  const banda = orden.find((b) => alcanceTrimestral + 1e-9 >= b.desde);
  return banda ? banda.factor : 0;
}

test('el alcance es real entre objetivo', () => {
  eq(engine.alcance(42, 40), 42 / 40);
});

test('el alcance es 0 si el objetivo no es positivo', () => {
  eq(engine.alcance(10, 0), 0);
});

test('el anticipo mensual sigue los umbrales de la configuración', () => {
  eq(engine.clasificarAnticipo(v.umbralCompleto, v), 'completo');
  eq(engine.montoAnticipo('completo', v), anticipoEsperado(v.umbralCompleto));
  const medio = (v.umbralCompleto + v.umbralParcial) / 2;
  eq(engine.clasificarAnticipo(medio, v), 'parcial');
  eq(engine.montoAnticipo('parcial', v), anticipoEsperado(medio));
  eq(engine.clasificarAnticipo(v.umbralParcial - 0.01, v), 'ninguno');
  eq(engine.montoAnticipo('ninguno', v), 0);
});

test('solo los meses 1 y 2 pagan anticipo', () => {
  const calc = engine.calcularVolumen({
    meses: [
      { retail: 100, objetivo: 100, cerrado: true },
      { retail: 100, objetivo: 100, cerrado: true },
      { retail: 100, objetivo: 100, cerrado: true },
    ],
    grupo: { real: 1, objetivo: 1 },
  }, v);
  eq(calc.meses[0].anticipo, anticipoEsperado(1));
  eq(calc.meses[1].anticipo, anticipoEsperado(1));
  eq(calc.meses[2].anticipo, 0);
  eq(calc.meses[2].clasificacion, 'liquidacion');
});

test('el bono trimestral usa la banda que corresponde al alcance', () => {
  const meses = [
    { retail: 100, objetivo: 100, cerrado: true },
    { retail: 100, objetivo: 100, cerrado: true },
    { retail: 100, objetivo: 100, cerrado: true },
  ];
  const calc = engine.calcularVolumen({ meses, grupo: { real: 1, objetivo: 1 } }, v);
  const alc = 1;
  cerca(calc.bonoTrimestral, engine.dinero(v.maximoTrimestral * factorEsperado(alc)));
});

test('sin alcance de grupo el bono se multiplica por el factor configurado', () => {
  const calc = engine.calcularVolumen({
    meses: [
      { retail: 100, objetivo: 100, cerrado: true },
      { retail: 100, objetivo: 100, cerrado: true },
      { retail: 100, objetivo: 100, cerrado: true },
    ],
    grupo: { real: v.alcanceGrupoMinimo * 100 - 1, objetivo: 100 },
  }, v);
  eq(calc.grupo.cumple, false);
  const factor = factorEsperado(1) * v.factorSiGrupoNoAlcanza;
  cerca(calc.bonoTrimestral, engine.dinero(v.maximoTrimestral * factor));
});

test('el mes 3 paga la diferencia entre el bono trimestral y los anticipos', () => {
  const calc = engine.calcularVolumen({
    meses: [
      { retail: 110, objetivo: 100, cerrado: true },
      { retail: 110, objetivo: 100, cerrado: true },
      { retail: 110, objetivo: 100, cerrado: true },
    ],
    grupo: { real: 100, objetivo: 100 },
  }, v);
  cerca(calc.pagoMes3, engine.dinero(calc.bonoTrimestral - calc.anticipos));
  eq(calc.tipoMes3, 'pago');
});

test('el mes 3 queda en débito cuando los anticipos superan el bono definitivo', () => {
  const calc = engine.calcularVolumen({
    meses: [
      { retail: 100, objetivo: 100, cerrado: true },
      { retail: 100, objetivo: 100, cerrado: true },
      { retail: 1, objetivo: 100, cerrado: true },
    ],
    grupo: { real: 100, objetivo: 100 },
  }, v);
  if (!(calc.pagoMes3 < 0)) throw new Error(`se esperaba débito y el mes 3 fue ${calc.pagoMes3}`);
  eq(calc.tipoMes3, 'debito');
});

test('el trimestre es provisional si no tiene los 3 meses cerrados', () => {
  const calc = engine.calcularVolumen({
    meses: [
      { retail: 100, objetivo: 100, cerrado: true },
      { retail: 100, objetivo: 100, cerrado: true },
      { retail: 0, objetivo: 100, cerrado: false },
    ],
  }, v);
  eq(calc.provisional, true);
});

test('el trimestre deja de ser provisional con 3 meses cerrados', () => {
  const calc = engine.calcularVolumen({
    meses: [
      { retail: 100, objetivo: 100, cerrado: true },
      { retail: 100, objetivo: 100, cerrado: true },
      { retail: 100, objetivo: 100, cerrado: true },
    ],
  }, v);
  eq(calc.provisional, false);
});

test('mercadotecnia exige responsable certificado', () => {
  const base = {
    responsableCertificado: false,
    usoFondo: 1,
    activacionEstrategica: true,
    plan: true,
  };
  const sin = engine.calcularOrientacion({ mercadotecnia: base }, cfg.orientacion);
  eq(sin.componentes.find((c) => c.id === 'mercadotecnia').monto, 0);
  const con = engine.calcularOrientacion({
    mercadotecnia: { ...base, responsableCertificado: true },
  }, cfg.orientacion);
  const peso = cfg.orientacion.mercadotecnia.peso;
  cerca(con.componentes.find((c) => c.id === 'mercadotecnia').monto, engine.dinero(peso * cfg.orientacion.maximo));
});

test('dos o más incidencias cancelan el bono VoC del trimestre', () => {
  const voc = {
    cxa: true,
    customerBoard: true,
    calidadDatos: true,
    incidencias: cfg.orientacion.voc.incidenciasCancelan,
  };
  const calc = engine.calcularOrientacion({ voc }, cfg.orientacion);
  eq(calc.componentes.find((c) => c.id === 'voc').monto, 0);
  eq(calc.componentes.find((c) => c.id === 'voc').cancelado, true);
});

test('VoC se paga si las incidencias quedan bajo el umbral y se cumplen CXA, Board y calidad', () => {
  const calc = engine.calcularOrientacion({
    voc: { cxa: true, customerBoard: true, calidadDatos: true, incidencias: cfg.orientacion.voc.incidenciasCancelan - 1 },
  }, cfg.orientacion);
  cerca(
    calc.componentes.find((c) => c.id === 'voc').monto,
    engine.dinero(cfg.orientacion.voc.peso * cfg.orientacion.maximo),
  );
});

test('entrenamiento exige las precondiciones TMSi y DMS', () => {
  const completo = {
    tmsi: false,
    dms: true,
    ictXev: true,
    ictTecnicoSenior: true,
    lanzamientoProducto: true,
  };
  const calc = engine.calcularOrientacion({ entrenamiento: completo }, cfg.orientacion);
  eq(calc.componentes.find((c) => c.id === 'entrenamiento').monto, 0);
});

test('Retail Standards paga en proporción a objetivos y remodelación', () => {
  const calc = engine.calcularOrientacion({
    retailStandards: { objetivos: true, remodelacion: false },
  }, cfg.orientacion);
  cerca(
    calc.componentes.find((c) => c.id === 'retailStandards').monto,
    engine.dinero(0.5 * cfg.orientacion.retailStandards.peso * cfg.orientacion.maximo),
  );
});

test('BEV se otorga al alcanzar el umbral configurado', () => {
  const umbral = cfg.calidad.bev.umbral;
  const bajo = engine.calcularCalidad({ bev: { real: umbral * 10 - 0.1, objetivo: 10 } }, cfg.calidad);
  eq(bajo.bev.monto, 0);
  const alto = engine.calcularCalidad({ bev: { real: umbral * 10, objetivo: 10 } }, cfg.calidad);
  cerca(alto.bev.monto, engine.dinero(cfg.calidad.bev.peso * cfg.calidad.maximo));
});

test('la antigüedad alta redondea hacia abajo y descuenta el bloqueo de suministro', () => {
  const pct = engine.pctAntiguedadAlta({ unidades: 40, antiguedadAlta: 8, bloqueoSuministro: 5 });
  eq(pct, Math.floor(((8 - 5) / 40) * 100) / 100);
});

test('el patio VDC se exige desde el mes configurado', () => {
  const inv = cfg.calidad.inventarios;
  const antes = engine.calcularCalidad({
    inventarios: [{
      mes: inv.mesInicioVdc - 1,
      unidades: 100,
      antiguedadAlta: 0,
      bloqueoSuministro: 0,
      patioVdc: 0,
    }],
  }, cfg.calidad);
  eq(antes.inventarios.meses[0].cumple, true);
  const desde = engine.calcularCalidad({
    inventarios: [{
      mes: inv.mesInicioVdc,
      unidades: 100,
      antiguedadAlta: 0,
      bloqueoSuministro: 0,
      patioVdc: inv.unidadesVdcMinimas - 1,
    }],
  }, cfg.calidad);
  eq(desde.inventarios.meses[0].cumple, false);
});

test('con aplicacionMensual en falso cada penalización se cobra una vez en el trimestre', () => {
  const concepto = cfg.penalizaciones.conceptos[0];
  const calc = engine.calcularPenalizaciones({
    [concepto.id]: { cumple: false, mesesIncumplidos: 3 },
  }, cfg.penalizaciones);
  eq(cfg.penalizaciones.aplicacionMensual, false);
  eq(calc.detalles.find((d) => d.id === concepto.id).monto, engine.dinero(concepto.monto));
});

test('con aplicacionMensual en verdadero la penalización se multiplica por los meses incumplidos', () => {
  const concepto = cfg.penalizaciones.conceptos[1];
  const meses = 2;
  const calc = engine.calcularPenalizaciones({
    [concepto.id]: { cumple: false, mesesIncumplidos: meses },
  }, { ...cfg.penalizaciones, aplicacionMensual: true });
  eq(calc.detalles.find((d) => d.id === concepto.id).monto, engine.dinero(concepto.monto * meses));
});

test('los topes recortan Demo, Loaner, Top Management y Tactic', () => {
  const pedido = {
    demo: cfg.topes.demo + 1000,
    loaner: cfg.topes.loaner,
    topManagement: cfg.topes.topManagement + 5000,
    tactic: cfg.topes.tactic + 1,
  };
  const calc = engine.aplicarTopes(pedido, cfg.topes);
  eq(calc.detalles.find((d) => d.id === 'demo').aplicado, cfg.topes.demo);
  eq(calc.detalles.find((d) => d.id === 'loaner').aplicado, cfg.topes.loaner);
  eq(calc.total, engine.dinero(cfg.topes.demo + cfg.topes.loaner + cfg.topes.topManagement + cfg.topes.tactic));
});

test('el neto no baja de 0 ni supera el máximo, y los escenarios salen de la configuración', () => {
  const sobre = engine.calcularNeto({
    volumen: cfg.maximoTotal,
    orientacion: cfg.maximoTotal,
    calidad: 0,
    topes: 0,
    penalizaciones: 0,
  }, cfg.maximoTotal);
  eq(sobre.neto, cfg.maximoTotal);
  eq(sobre.topado, true);

  const bajo = engine.calcularNeto({
    volumen: 1000,
    orientacion: 0,
    calidad: 0,
    topes: 0,
    penalizaciones: 5000,
  }, cfg.maximoTotal);
  eq(bajo.neto, 0);
  eq(bajo.enCero, true);

  const escenarios = engine.evaluarEscenarios(cfg);
  escenarios.forEach((esc, i) => {
    const src = cfg.escenarios[i];
    const retail = src.meses.reduce((s, m) => s + m.retail, 0);
    const objetivo = src.meses.reduce((s, m) => s + m.objetivo, 0);
    const alc = retail / objetivo;
    const grupoOk = src.grupo.real / src.grupo.objetivo + 1e-9 >= v.alcanceGrupoMinimo;
    const bono = engine.dinero(v.maximoTrimestral * factorEsperado(alc) * (grupoOk ? 1 : v.factorSiGrupoNoAlcanza));
    const anticipos = engine.dinero(anticipoEsperado(src.meses[0].retail / src.meses[0].objetivo)
      + anticipoEsperado(src.meses[1].retail / src.meses[1].objetivo));
    cerca(esc.bonoTrimestral, bono, esc.nombre);
    cerca(esc.pagoMes3, engine.dinero(bono - anticipos), esc.nombre);
  });

  const q3 = engine.calcularTrimestre(captura.trimestres['3'], cfg);
  const esperado = engine.calcularNeto({
    volumen: q3.volumen.bonoTrimestral,
    orientacion: q3.orientacion.total,
    calidad: q3.calidad.total,
    topes: q3.topes.total,
    penalizaciones: q3.penalizaciones.total,
  }, cfg.maximoTotal);
  eq(q3.neto.neto, esperado.neto);
  eq(q3.provisional, false);
});

console.log('');
if (failures.length) {
  console.log(`${passed} pruebas correctas, ${failures.length} fallaron.`);
  process.exit(1);
}
console.log(`${passed} pruebas correctas.`);
