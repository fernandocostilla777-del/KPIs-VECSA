const { query } = require('../db');
const { loadVentasNuevosFinancial } = require('./ventasNuevosFinanciero');
const { loadSalesExecutiveAnalytics } = require('./salesExecutiveAnalytics');
const { getVentas } = require('./ventas');
const { getInventory, getVendidosAnalisis } = require('./inventoryService');
const { getPuntoEquilibrio } = require('./breakEvenService');
const { getResumen: getBonosResumen } = require('./bonosService');
const { getGestionInventario } = require('./bonosIncadea');

function buildSerDateClause(fechaInicio, fechaFin) {
  if (!fechaInicio || !fechaFin) return { clause: '', params: {} };
  return {
    clause: `AND CONVERT(DATE, o.ORE_FECHAORD, 103) >= @fechaInicio AND CONVERT(DATE, o.ORE_FECHAORD, 103) <= @fechaFin`,
    params: { fechaInicio, fechaFin },
  };
}

function classifyServiceBucket(clasific) {
  const c = String(clasific || '').trim().toUpperCase();
  if (c === 'RE') return 'refacciones';
  if (c.startsWith('MO')) return 'manoObra';
  return 'otros';
}

function pct(part, total) {
  return total > 0 ? Math.round((part / total) * 1000) / 10 : 0;
}

function trimestreEnCurso() {
  return Math.floor(new Date().getMonth() / 3) + 1;
}

function mesActualIso() {
  const now = new Date();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  return `${now.getFullYear()}-${m}`;
}

async function seguro(advertencias, etiqueta, fn, porDefecto = null) {
  try {
    return await fn();
  } catch (err) {
    console.warn(`[overview] ${etiqueta}:`, err.message);
    advertencias.push(etiqueta);
    return porDefecto;
  }
}

async function loadServiceFinancial({ fechaInicio, fechaFin }) {
  const { clause, params } = buildSerDateClause(fechaInicio, fechaFin);

  const [orders] = await query(`
    SELECT
      COUNT(*) AS ingresadas,
      SUM(CASE WHEN o.ORE_STATUS = 'I' THEN 1 ELSE 0 END) AS facturadas
    FROM SER_ORDEN o
    WHERE o.ORE_FECHAORD IS NOT NULL
      AND LTRIM(RTRIM(o.ORE_FECHAORD)) <> ''
      ${clause}
  `, params);

  const detailRows = await query(`
    SELECT
      ISNULL(LTRIM(RTRIM(d.ORD_CLASIFIC)), '') AS clasific,
      SUM(ISNULL(d.ORD_SUBTOTAL, 0)) AS subtotal,
      SUM(ISNULL(d.ORD_IVATOT, 0)) AS iva
    FROM SER_ORDEN o
    INNER JOIN SER_ORDENDET d ON d.ORD_IDORDEN = o.ORE_IDORDEN
    WHERE o.ORE_STATUS = 'I'
      AND o.ORE_FECHAORD IS NOT NULL
      AND LTRIM(RTRIM(o.ORE_FECHAORD)) <> ''
      ${clause}
    GROUP BY d.ORD_CLASIFIC
  `, params);

  const buckets = { manoObra: 0, refacciones: 0, otros: 0 };
  for (const row of detailRows) {
    const amount = Number(row.subtotal || 0) + Number(row.iva || 0);
    buckets[classifyServiceBucket(row.clasific)] += amount;
  }

  const importeFacturado = buckets.manoObra + buckets.refacciones + buckets.otros;
  const facturadas = Number(orders.facturadas || 0);

  return {
    ingresadas: Number(orders.ingresadas || 0),
    facturadas,
    importeFacturado,
    manoObra: buckets.manoObra,
    refacciones: buckets.refacciones,
    otros: buckets.otros,
    pctFacturado: pct(facturadas, Number(orders.ingresadas || 0)),
    ticketFacturado: facturadas ? importeFacturado / facturadas : 0,
  };
}

function loadBonosOverview() {
  const trimestre = trimestreEnCurso();
  try {
    const raw = getBonosResumen(trimestre);
    const v = raw.resumen?.volumen || {};
    return {
      disponible: true,
      trimestre,
      etiqueta: raw.resumen?.etiqueta || `T${trimestre}`,
      anio: raw.anio,
      datosEjemplo: !!raw.datosEjemplo,
      retail: Number(v.retail ?? 0),
      objetivo: Number(v.objetivo ?? 0),
      alcanceTrimestral: v.alcanceTrimestral,
      bonoEstimado: v.bonoTrimestral,
      anticipos: v.anticipos,
      meses: Array.isArray(v.meses) ? v.meses : [],
      provisional: !!v.provisional,
    };
  } catch (err) {
    return {
      disponible: false,
      trimestre,
      motivo: err.status === 404
        ? `No hay captura para el trimestre ${trimestre}.`
        : (err.message || 'Bonos no disponibles'),
    };
  }
}

function buildMarcas(vr = {}) {
  const pm = vr.porMarca || {};
  const bmw = Number(pm.bmw ?? vr.totalRetail ?? 0);
  const mini = Number(pm.mini ?? vr.totalFlotillas ?? 0);
  const motorrad = Number(pm.motorrad ?? vr.totalNotificacionesEntrega ?? 0);
  const otras = Number(pm.otras ?? 0);
  const total = Number(pm.total ?? (bmw + mini + motorrad + otras));
  return { bmw, mini, motorrad, otras, total };
}

async function getOverview({ fechaInicio, fechaFin } = {}) {
  const advertencias = [];

  const [
    ventasLive,
    service,
    salesAnalytics,
    ventasOps,
    inventoryOps,
    puntoEquilibrio,
    gestionInv,
  ] = await Promise.all([
    seguro(advertencias, 'Ventas financieras', () => loadVentasNuevosFinancial({ fechaInicio, fechaFin }), {
      summary: {},
      topModels: [],
      byEstado: [],
      monthlyTrend: [],
      dailyBreakdown: [],
    }),
    seguro(advertencias, 'Postventa (SER_ORDEN)', () => loadServiceFinancial({ fechaInicio, fechaFin }), {
      ingresadas: 0,
      facturadas: 0,
      importeFacturado: 0,
      manoObra: 0,
      refacciones: 0,
      otros: 0,
      pctFacturado: 0,
      ticketFacturado: 0,
    }),
    seguro(advertencias, 'Analytics comercial', () => loadSalesExecutiveAnalytics({ fechaInicio, fechaFin }), null),
    seguro(advertencias, 'Operaciones de venta', () => getVentas({ fechaInicio, fechaFin }), null),
    seguro(advertencias, 'Inventario', () => getInventory({ planPisoPeriod: 'all' }), null),
    seguro(advertencias, 'Punto de equilibrio', () => getPuntoEquilibrio({ fechaInicio, fechaFin }), null),
    seguro(advertencias, 'Gestión de inventarios', () => getGestionInventario({ mes: mesActualIso() }), null),
  ]);

  const s = ventasLive?.summary || {};
  const vr = ventasOps?.resumen || {};
  const inv = inventoryOps?.summary || {};
  const marcas = buildMarcas(vr);
  const bonos = loadBonosOverview();

  const stockMap = {};
  if (Array.isArray(inventoryOps?.inventoryTable)) {
    for (const row of inventoryOps.inventoryTable) {
      const model = row.tipoAuto || row.model || 'Sin modelo';
      stockMap[model] = (stockMap[model] || 0) + 1;
    }
  }

  const topWithStock = (ventasLive?.topModels || []).map((m) => ({
    ...m,
    brand: '',
    stock: stockMap[m.model] || 0,
    status: (stockMap[m.model] || 0) < 50 ? 'Stock bajo' : (m.unitsSold > 100 ? 'Alta demanda' : 'Estable'),
  }));

  const totalEstadoUnits = (ventasLive?.byEstado || []).reduce((sum, r) => sum + r.units, 0) || 1;

  const sales = {
    units: s.units,
    revenue: s.ventaSubtotal,
    revenueTotal: s.ventaTotal,
    revenueIva: s.ventaIva,
    revenueIsan: s.ventaIsan,
    utility: s.utilidad,
    cost: s.costoNeto,
    costoMiCosto: s.costoMiCosto,
    bonificacion: s.bonificacion,
    participacion: s.participacion,
    costoIva: s.costoIva,
    gastos: s.gastos,
    conCosto: s.conCosto,
    sinCosto: s.sinCosto,
    marginPct: s.marginPct,
    retailUnits: marcas.total || s.retailUnits || 0,
    flotillaUnits: 0,
    ticketPromedio: s.ticketPromedio,
  };

  const especiales = inv.especialesConteo || {};
  const gestion = gestionInv
    ? {
      mes: gestionInv.mes,
      pct: gestionInv.pct,
      pctEntero: gestionInv.pctEntero,
      total: gestionInv.total,
      antiguos: gestionInv.antiguos,
      bloqueo: gestionInv.bloqueo,
      objetivoEtiqueta: gestionInv.objetivoEtiqueta,
      patioVdc: gestionInv.patioVdc,
      patioEtiqueta: gestionInv.patioEtiqueta,
      cumple: gestionInv.cumple,
      datosEjemplo: gestionInv.datosEjemplo,
    }
    : null;

  const inventory = {
    totalUnits: Number(inv.totalUnits ?? 0),
    availableUnits: Number(inv.available ?? 0),
    availableLibres: Number(inv.availableLibres ?? 0),
    availableApartadas: Number(inv.availableApartadas ?? 0),
    demos: Number(inv.demos ?? 0),
    avgDaysDemo: Number(inv.avgDaysDemo ?? 0),
    demosConPruebas: Number(inv.demosConPruebas ?? 0),
    demosPruebasTotal: Number(inv.demosPruebasTotal ?? 0),
    lineaCreditoUnits: Number(inv.lineaCreditoUnits ?? inv.ageingAlertsCount ?? 0),
    ageingAlertsCount: Number(inv.ageingAlertsCount ?? inv.urgentAlerts ?? 0),
    avgDaysAvailable: Number(inv.avgDaysAvailable ?? 0),
    inventoryCost: Number(inv.inventoryCost ?? 0),
    inventoryValue: Number(inv.inventoryValue ?? inv.inventoryCost ?? 0),
    avgDaysInventory: Number(inv.avgDaysAvailable ?? 0),
    especiales,
    gestion,
  };

  const operaciones = {
    unidadesVendidas: Number(vr.totalVentas ?? marcas.total ?? sales.units ?? 0),
    retail: Number(marcas.total ?? vr.totalVentas ?? sales.units ?? 0),
    flotillas: 0,
  };

  let cierre = {
    unidades: 0,
    utilidadBruta: 0,
    utilidadNeta: 0,
    ingresoFi: 0,
    conIngresoFi: 0,
    planPiso: 0,
    comisionEv: 0,
    extras: 0,
  };
  try {
    const vendidos = await getVendidosAnalisis({ fechaInicio, fechaFin });
    const vs = vendidos?.summary || {};
    cierre = {
      unidades: Number(vs.unidades || 0),
      utilidadBruta: Number(vs.utilidad || 0),
      utilidadNeta: Number(vs.utilidadNeta || 0),
      ingresoFi: Number(vs.ingresoFinanciamiento || 0),
      conIngresoFi: Number(vs.conIngresoFinanciamiento || 0),
      planPiso: Number(vs.planPiso || 0),
      comisionEv: Number(vs.comisionEv || 0),
      extras: Number(vs.extras || 0),
    };
  } catch (err) {
    console.warn('[overview] cierre vendidos:', err.message);
    advertencias.push('Cierre de unidades vendidas');
  }

  const consolidated = {
    ingresoTotal: Number(sales.revenue || 0) + Number(service?.importeFacturado || 0),
    utilidadVentas: sales.utility,
    facturacionServicio: service?.importeFacturado,
    valorInventario: inventory.inventoryValue,
  };

  return {
    filtros: { fechaInicio, fechaFin },
    advertencias,
    marcas,
    bonos,
    financial: { sales, inventory, service, consolidated },
    operaciones,
    cierre,
    salesAnalytics,
    puntoEquilibrio,
    kpis: {
      totalUnits: sales.units,
      totalRevenue: sales.revenue,
      totalUtility: sales.utility,
      marginPct: sales.marginPct,
      avgDaysInventory: inventory.avgDaysInventory,
      availableUnits: inventory.availableUnits,
      totalInventory: inventory.totalUnits,
      demos: inventory.demos,
      lineaCreditoUnits: inventory.lineaCreditoUnits,
      ageingAlertsCount: inventory.ageingAlertsCount,
      serviceRevenue: service?.importeFacturado,
      serviceOrders: service?.facturadas,
      retailUnits: operaciones.retail,
      flotillaUnits: 0,
      utilidadNetaCierre: cierre.utilidadNeta,
    },
    monthlyTrend: ventasLive?.monthlyTrend || [],
    dailyBreakdown: ventasLive?.dailyBreakdown || [],
    topModels: topWithStock,
    byEstado: (ventasLive?.byEstado || []).map((r) => ({
      ...r,
      share: Math.round((r.units / totalEstadoUnits) * 1000) / 10,
    })),
  };
}

module.exports = { getOverview };
