const { getPool, sql } = require('../db');
const incadeaDb = require('../incadea/db');
const { leerPrivado } = require('../incadea/privateStore');
const { tabla } = require('../incadea/queries');

async function requestIncadea() {
  const pool = incadeaDb.configurado() ? await incadeaDb.obtenerPool() : await getPool();
  return pool.request();
}

function empresaIncadea() {
  try {
    const mapeo = leerPrivado('incadea-mapeo', { opcional: true, porDefecto: null });
    const empresa = mapeo?.data?.empresa;
    if (empresa) return String(empresa).trim();
  } catch {
    /* usa el nombre confirmado en esta base */
  }
  return 'Vecsa Hidalgo';
}

function fechaCorta(value) {
  const fecha = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(fecha.getTime())) return '';
  const dia = String(fecha.getUTCDate()).padStart(2, '0');
  const mes = String(fecha.getUTCMonth() + 1).padStart(2, '0');
  return `${dia}/${mes}/${fecha.getUTCFullYear()}`;
}

function marcaDeGrupo(grupo) {
  const texto = String(grupo || '').trim().toUpperCase();
  if (texto.startsWith('VNB')) return 'BMW';
  if (texto.startsWith('VNM')) return 'MINI';
  if (texto.startsWith('VNT')) return 'MOTO';
  return '';
}

function marcaDe(codigo) {
  const marca = String(codigo || '').trim().toUpperCase();
  if (marca === 'BMW' || marca === 'BMWI') return 'bmw';
  if (marca === 'MINI') return 'mini';
  if (marca === 'MOTO' || marca === 'MOTORRAD') return 'moto';
  return 'otras';
}

function filaVenta(row) {
  const bucket = marcaDe(row.marca);
  const fecha = fechaCorta(row.fechaVenta);
  const vin = String(row.vin || '').trim();
  const factura = String(row.factura || '').trim();
  const modelo = String(row.modelo || row.modeloCodigo || '').trim();
  const vendedor = String(row.vendedor || row.vendedorCodigo || '').trim();
  return {
    VTE_FECHDOCTO: fecha,
    VTE_DOCTO: factura || vin,
    VTE_FACTURA: factura || null,
    VENDEDOR: vendedor || '—',
    VENDEDOR_CODIGO: String(row.vendedorCodigo || '').trim() || null,
    CLIENTE: String(row.cliente || '').trim() || '—',
    VTE_SERIE: vin,
    VEH_TIPOAUTO: modelo || '—',
    VEH_ANMODELO: row.anioModelo || '',
    COL_DESCRIPCION: String(row.grupo || '').trim(),
    CANAL_VENTA: bucket === 'mini' ? 'FLOTILLAS' : 'PISO',
    CANAL_LABEL: String(row.marca || '').trim() || 'OTRAS',
    TIPOVENTA: bucket === 'mini' ? 'FLOTILLA' : (bucket === 'bmw' ? 'BMW' : 'OTRAS'),
    IS_DEMO: Number(row.estatus) === 2 || /^VD/i.test(String(row.grupo || '')),
    MARCA_INCADEA: String(row.marca || '').trim(),
    FORMAPAGO_ORIGINAL: '',
  };
}

function filaMotorrad(row) {
  const venta = filaVenta(row);
  return {
    SOF_FechAct: venta.VTE_FECHDOCTO,
    FECHA_FACTURA: venta.VTE_FECHDOCTO,
    SOF_HoraAct: '',
    SOF_Factura: venta.VTE_DOCTO,
    SOF_VIN: venta.VTE_SERIE,
    PREVIAS: 0,
    SOF_Pedido: '',
    SOF_NoTransaccion: '',
    CLIENTE: venta.CLIENTE,
    SOF_Estatus: 'Venta',
    SOF_CveUSu: venta.VENDEDOR,
    VEH_TIPOAUTO: venta.VEH_TIPOAUTO,
  };
}

function entregasPorMes(filas, inicio, fin) {
  const counts = new Map();
  const cursor = new Date(inicio.getFullYear(), inicio.getMonth(), 1);
  const ultimo = new Date(fin.getFullYear(), fin.getMonth(), 1);
  while (cursor <= ultimo) {
    const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`;
    counts.set(key, 0);
    cursor.setMonth(cursor.getMonth() + 1);
  }
  for (const fila of filas) {
    const partes = String(fila.SOF_FechAct || '').split('/');
    if (partes.length !== 3) continue;
    const key = `${partes[2]}-${partes[1]}`;
    if (counts.has(key)) counts.set(key, counts.get(key) + 1);
  }
  return [...counts.entries()].map(([key, count]) => ({ key, label: key, count }));
}

function sqlMovimientosFactura(empresa) {
  const vehiculo = tabla(empresa, 'Vehicle');
  const factura = tabla(empresa, 'Sales Invoice Line');
  const facturaHdr = tabla(empresa, 'Sales Invoice Header');
  const credito = tabla(empresa, 'Sales Credit Memo Line');
  const cliente = tabla(empresa, 'Customer');
  const vendedor = tabla(empresa, 'Salesperson_Purchaser');
  return { vehiculo, factura, facturaHdr, credito, cliente, vendedor };
}

async function getIncadeaConteosPorMes({
  inicioActual,
  finActual,
  inicioAnterior,
  finAnterior,
} = {}) {
  const { factura, facturaHdr, credito, cliente } = sqlMovimientosFactura(empresaIncadea());
  const pool = await getPool();
  const result = await pool.request()
    .input('inicioActual', sql.Date, inicioActual)
    .input('finActual', sql.Date, finActual)
    .input('inicioAnterior', sql.Date, inicioAnterior)
    .input('finAnterior', sql.Date, finAnterior)
    .query(`
      WITH mov AS (
        SELECT
          LTRIM(RTRIM(l.[VIN])) AS vin,
          YEAR(l.[Posting Date]) AS anio,
          MONTH(l.[Posting Date]) AS mes,
          CASE
            WHEN l.[Gen_ Prod_ Posting Group] LIKE 'VNB%' THEN 'bmw'
            WHEN l.[Gen_ Prod_ Posting Group] LIKE 'VNM%' THEN 'mini'
            WHEN l.[Gen_ Prod_ Posting Group] LIKE 'VNT%' THEN 'moto'
            ELSE 'otras'
          END AS marca,
          l.[Quantity] AS qty
        FROM ${factura} l
        INNER JOIN ${facturaHdr} h ON h.[No_] = l.[Document No_]
        LEFT JOIN ${cliente} c ON c.[No_] = h.[Sell-to Customer No_]
        WHERE (
            (l.[Posting Date] >= @inicioActual AND l.[Posting Date] < DATEADD(day, 1, @finActual))
            OR (l.[Posting Date] >= @inicioAnterior AND l.[Posting Date] < DATEADD(day, 1, @finAnterior))
          )
          AND l.[Type] = 2
          AND l.[Item Type] = 2
          AND l.[Quantity] > 0
          AND LTRIM(RTRIM(ISNULL(l.[VIN], ''))) <> ''
          AND l.[Gen_ Prod_ Posting Group] LIKE 'VN%'
          AND ISNULL(h.[Customer Group Code], '') <> 'ICC'
          AND ISNULL(c.[Customer Posting Group], '') <> 'C-ICC'
        UNION ALL
        SELECT
          LTRIM(RTRIM(l.[VIN])) AS vin,
          YEAR(l.[Posting Date]) AS anio,
          MONTH(l.[Posting Date]) AS mes,
          CASE
            WHEN l.[Gen_ Prod_ Posting Group] LIKE 'VNB%' THEN 'bmw'
            WHEN l.[Gen_ Prod_ Posting Group] LIKE 'VNM%' THEN 'mini'
            WHEN l.[Gen_ Prod_ Posting Group] LIKE 'VNT%' THEN 'moto'
            ELSE 'otras'
          END AS marca,
          -l.[Quantity] AS qty
        FROM ${credito} l
        WHERE (
            (l.[Posting Date] >= @inicioActual AND l.[Posting Date] < DATEADD(day, 1, @finActual))
            OR (l.[Posting Date] >= @inicioAnterior AND l.[Posting Date] < DATEADD(day, 1, @finAnterior))
          )
          AND l.[Type] = 2
          AND l.[Item Type] = 2
          AND l.[Quantity] > 0
          AND LTRIM(RTRIM(ISNULL(l.[VIN], ''))) <> ''
          AND l.[Gen_ Prod_ Posting Group] LIKE 'VN%'
      )
      SELECT anio, mes, marca, COUNT(*) AS cnt
      FROM (
        SELECT vin, anio, mes, marca, SUM(qty) AS neto
        FROM mov
        GROUP BY vin, anio, mes, marca
      ) neto
      WHERE neto > 0
        AND marca IN ('bmw', 'mini', 'moto')
      GROUP BY anio, mes, marca
      ORDER BY anio, mes, marca
    `);
  return result.recordset || [];
}

function parseFechaVentas(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const texto = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto)) {
    throw new Error('Fecha invalida. Use formato YYYY-MM-DD.');
  }
  return new Date(`${texto}T12:00:00`);
}

function vinKey(vin) {
  return String(vin || '').trim().toUpperCase();
}

function acumularMovimientosVnPorVin(recordset) {
  const porVin = new Map();
  for (const row of recordset || []) {
    const vin = String(row.vin || '').trim();
    if (!vin) continue;
    let acc = porVin.get(vin);
    if (!acc) {
      acc = { neto: 0, row: null };
      porVin.set(vin, acc);
    }
    acc.neto += Number(row.signo) * Number(row.qty || 0);
    if (Number(row.signo) > 0 && (!acc.row || new Date(row.fechaVenta) >= new Date(acc.row.fechaVenta))) {
      acc.row = row;
    }
  }
  return porVin;
}

function incadeaVentasHabilitado() {
  if (incadeaDb.configurado()) return true;
  try {
    const mapeo = leerPrivado('incadea-mapeo', { opcional: true, porDefecto: null });
    return Boolean(mapeo?.data?.empresa);
  } catch {
    return false;
  }
}

async function sqlVentasVnPeriodo(dInicio, dFin) {
  const empresa = empresaIncadea();
  const { vehiculo, factura, facturaHdr, credito, cliente, vendedor } = sqlMovimientosFactura(empresa);
  const reqVentas = await requestIncadea();
  return reqVentas
    .input('fechaInicio', sql.Date, dInicio)
    .input('fechaFin', sql.Date, dFin)
    .query(`
      SELECT
        LTRIM(RTRIM(l.[VIN])) AS vin,
        l.[Document No_] AS factura,
        l.[Posting Date] AS fechaVenta,
        l.[Quantity] AS qty,
        CAST(1 AS int) AS signo,
        l.[Gen_ Prod_ Posting Group] AS grupo,
        v.[Model] AS modelo,
        v.[Model No_] AS modeloCodigo,
        v.[Model Year] AS anioModelo,
        v.[Make Code] AS marca,
        v.[Vehicle Status] AS estatus,
        LTRIM(RTRIM(ISNULL(h.[Salesperson Code], ISNULL(v.[Dealer Salesperson Code], '')))) AS vendedorCodigo,
        LTRIM(RTRIM(ISNULL(sp.[Name], ISNULL(h.[Salesperson Code], ISNULL(v.[Dealer Salesperson Code], ''))))) AS vendedor,
        h.[Sell-to Customer Name] AS cliente
      FROM ${factura} l
      INNER JOIN ${facturaHdr} h ON h.[No_] = l.[Document No_]
      LEFT JOIN ${cliente} c ON c.[No_] = h.[Sell-to Customer No_]
      LEFT JOIN ${vendedor} sp ON sp.[Code] = h.[Salesperson Code]
      LEFT JOIN ${vehiculo} v ON LTRIM(RTRIM(v.[VIN])) = LTRIM(RTRIM(l.[VIN]))
      WHERE l.[Posting Date] >= @fechaInicio
        AND l.[Posting Date] < DATEADD(day, 1, @fechaFin)
        AND l.[Type] = 2
        AND l.[Item Type] = 2
        AND l.[Quantity] > 0
        AND LTRIM(RTRIM(ISNULL(l.[VIN], ''))) <> ''
        AND l.[Gen_ Prod_ Posting Group] LIKE 'VN%'
        AND ISNULL(h.[Customer Group Code], '') <> 'ICC'
        AND ISNULL(c.[Customer Posting Group], '') <> 'C-ICC'
      UNION ALL
      SELECT
        LTRIM(RTRIM(l.[VIN])) AS vin,
        l.[Document No_] AS factura,
        l.[Posting Date] AS fechaVenta,
        l.[Quantity] AS qty,
        CAST(-1 AS int) AS signo,
        l.[Gen_ Prod_ Posting Group] AS grupo,
        NULL AS modelo,
        NULL AS modeloCodigo,
        NULL AS anioModelo,
        NULL AS marca,
        NULL AS estatus,
        NULL AS vendedorCodigo,
        NULL AS vendedor,
        NULL AS cliente
      FROM ${credito} l
      WHERE l.[Posting Date] >= @fechaInicio
        AND l.[Posting Date] < DATEADD(day, 1, @fechaFin)
        AND l.[Type] = 2
        AND l.[Item Type] = 2
        AND l.[Quantity] > 0
        AND LTRIM(RTRIM(ISNULL(l.[VIN], ''))) <> ''
        AND l.[Gen_ Prod_ Posting Group] LIKE 'VN%'
    `);
}

/**
 * VIN → asesor de la última factura VN neta del periodo (cabecera de factura Incadea).
 */
async function getIncadeaAsesorPorVin({ fechaInicio, fechaFin, inicio, fin } = {}) {
  const dInicio = inicio || parseFechaVentas(fechaInicio);
  const dFin = fin || parseFechaVentas(fechaFin);
  const result = await sqlVentasVnPeriodo(dInicio, dFin);
  const porVin = acumularMovimientosVnPorVin(result.recordset);
  const map = new Map();
  for (const [vin, acc] of porVin) {
    if (acc.neto <= 0 || !acc.row) continue;
    const codigo = String(acc.row.vendedorCodigo || '').trim();
    const nombre = String(acc.row.vendedor || '').trim();
    const etiqueta = nombre || codigo;
    if (!etiqueta) continue;
    map.set(vinKey(vin), { codigo: codigo || null, nombre: etiqueta });
  }
  return map;
}

async function getIncadeaVentasPeriodo({ fechaInicio, fechaFin, inicio, fin, incluirPorMes = false } = {}) {
  const dInicio = inicio || parseFechaVentas(fechaInicio);
  const dFin = fin || parseFechaVentas(fechaFin);
  const result = await sqlVentasVnPeriodo(dInicio, dFin);
  const porVin = acumularMovimientosVnPorVin(result.recordset);

  const bmw = [];
  const mini = [];
  const moto = [];
  let otras = 0;
  for (const acc of porVin.values()) {
    if (acc.neto <= 0 || !acc.row) continue;
    const bucket = marcaDe(acc.row.marca || marcaDeGrupo(acc.row.grupo));
    if (bucket === 'bmw') bmw.push(filaVenta(acc.row));
    else if (bucket === 'mini') mini.push(filaVenta(acc.row));
    else if (bucket === 'moto') moto.push(filaMotorrad(acc.row));
    else otras += 1;
  }

  return {
    fuente: 'incadea',
    conteos: {
      bmw: bmw.length,
      mini: mini.length,
      moto: moto.length,
      otras,
    },
    registros: [...bmw, ...mini],
    sofiaEntregas: {
      registrosEntrega: moto,
      entregasPorMes: incluirPorMes ? entregasPorMes(moto, dInicio, dFin) : null,
      totalNotificacionesEntrega: moto.length,
      totalEntregasSinPrevias: moto.length,
      totalEntregasConPrevias: 0,
    },
    entregasSofia: moto,
    filtros: { fechaInicio, fechaFin },
  };
}

function aplicarConteosIncadea(resumen, core) {
  if (core?.fuente !== 'incadea' || !core.conteos) return resumen;
  const { bmw, mini, moto, otras } = core.conteos;
  resumen.totalRetail = bmw;
  resumen.totalFlotillas = mini;
  resumen.totalNotificacionesEntrega = moto;
  resumen.totalVentas = bmw + mini + moto + otras;
  resumen.totalUnidadesFacturadasNoTimbradas = 0;
  resumen.numeradorCobertura = moto;
  resumen.fuente = 'incadea';
  const extra = otras ? ` ${otras} de otras marcas quedan fuera de las tres tarjetas.` : '';
  resumen.demosNota = `Fuente: Incadea, facturas de unidades nuevas. Neto de notas de crédito y sin intercompañía. BMW incluye BMW i.${extra}`;
  resumen.entregasSofiaEfectivas = core.sofiaEntregas?.registrosEntrega || [];
  return resumen;
}

function dinero(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

function texto(value) {
  const limpio = String(value || '').replace(/\s+/g, ' ').trim();
  return limpio || null;
}

/**
 * Tomas a cuenta desde la factura publicada (Posted Sales Trade-In).
 * El VIN de la línea es el usado tomado; Trade-In for VIN es la unidad nueva.
 * Una nota de crédito que aplica a esa factura anula la toma.
 * Reventa = factura posterior del usado (grupo VU), neta de su propia nota de crédito.
 */
async function getIncadeaTomasRegistros({ inicio, fin }) {
  const empresa = empresaIncadea();
  const toma = tabla(empresa, 'Posted Sales Trade-In');
  const factura = tabla(empresa, 'Sales Invoice Header');
  const facturaLin = tabla(empresa, 'Sales Invoice Line');
  const credito = tabla(empresa, 'Sales Credit Memo Header');
  const creditoLin = tabla(empresa, 'Sales Credit Memo Line');
  const vehiculo = tabla(empresa, 'Vehicle');
  const vendedor = tabla(empresa, 'Salesperson_Purchaser');
  const reqTomas = await requestIncadea();
  const result = await reqTomas
    .input('fechaInicio', sql.Date, inicio)
    .input('fechaFin', sql.Date, fin)
    .query(`
      SELECT
        t.[Document No_] AS facturaNuevo,
        CONVERT(varchar(10), h.[Posting Date], 23) AS fechaToma,
        LTRIM(RTRIM(t.[VIN])) AS vinToma,
        LTRIM(RTRIM(ISNULL(t.[Description], ''))) AS modeloToma,
        LTRIM(RTRIM(ISNULL(CONVERT(varchar(10), usado.[Model Year]), ''))) AS anModeloToma,
        LTRIM(RTRIM(t.[Trade-In for VIN])) AS serieNuevo,
        LTRIM(RTRIM(ISNULL(nuevo.[Model], ''))) AS modeloNuevo,
        LTRIM(RTRIM(ISNULL(CONVERT(varchar(10), nuevo.[Model Year]), ''))) AS anModeloNuevo,
        t.[Unit Cost] AS importe,
        LTRIM(RTRIM(ISNULL(h.[Sell-to Customer Name], ''))) AS cliente,
        LTRIM(RTRIM(ISNULL(sp.[Name], h.[Salesperson Code]))) AS vendedor,
        LTRIM(RTRIM(ISNULL(h.[Salesperson Code], ''))) AS usuarioToma,
        LTRIM(RTRIM(ISNULL(lin.[Order No_], ''))) AS pedidoNuevo,
        venta.doc AS pedidoUsn,
        venta.fecha AS fechaVentaUsado,
        venta.amount AS montoVentaUsado,
        venta.cliente AS clienteUsado,
        venta.vendedor AS vendedorUsado
      FROM ${toma} t
      INNER JOIN ${factura} h ON h.[No_] = t.[Document No_]
      LEFT JOIN ${vendedor} sp ON sp.[Code] = h.[Salesperson Code]
      LEFT JOIN ${vehiculo} nuevo ON nuevo.[VIN] = t.[Trade-In for VIN]
      LEFT JOIN ${vehiculo} usado ON usado.[VIN] = t.[VIN]
      LEFT JOIN ${facturaLin} lin
        ON lin.[Document No_] = t.[Document No_]
       AND lin.[Line No_] = t.[Document Line No_]
      OUTER APPLY (
        SELECT TOP 1
          sl.[Document No_] AS doc,
          CONVERT(varchar(10), sh.[Posting Date], 23) AS fecha,
          sl.[Amount] AS amount,
          LTRIM(RTRIM(ISNULL(sh.[Sell-to Customer Name], ''))) AS cliente,
          LTRIM(RTRIM(ISNULL(sp2.[Name], sh.[Salesperson Code]))) AS vendedor
        FROM ${facturaLin} sl
        INNER JOIN ${factura} sh ON sh.[No_] = sl.[Document No_]
        LEFT JOIN ${vendedor} sp2 ON sp2.[Code] = sh.[Salesperson Code]
        WHERE LTRIM(RTRIM(sl.[VIN])) = LTRIM(RTRIM(t.[VIN]))
          AND sl.[Type] = 2
          AND sl.[Item Type] = 2
          AND sl.[Quantity] > 0
          AND sh.[Posting Date] >= h.[Posting Date]
          AND sl.[Document No_] <> t.[Document No_]
          AND sl.[Gen_ Prod_ Posting Group] LIKE 'VU%'
          AND NOT EXISTS (
            SELECT 1
            FROM ${creditoLin} cl
            INNER JOIN ${credito} ch ON ch.[No_] = cl.[Document No_]
            WHERE LTRIM(RTRIM(cl.[VIN])) = LTRIM(RTRIM(sl.[VIN]))
              AND ch.[Applies-to Doc_ No_] = sl.[Document No_]
              AND cl.[Quantity] > 0
          )
        ORDER BY sh.[Posting Date], sl.[Document No_]
      ) venta
      WHERE t.[Document Type] = 2
        AND LTRIM(RTRIM(ISNULL(t.[VIN], ''))) <> ''
        AND h.[Posting Date] >= @fechaInicio
        AND h.[Posting Date] <= @fechaFin
        AND NOT EXISTS (
          SELECT 1
          FROM ${toma} c
          INNER JOIN ${credito} ch ON ch.[No_] = c.[Document No_]
          WHERE c.[Document Type] = 3
            AND ch.[Applies-to Doc_ No_] = t.[Document No_]
            AND LTRIM(RTRIM(c.[VIN])) = LTRIM(RTRIM(t.[VIN]))
        )
    `);

  const seen = new Set();
  const registros = [];
  for (const row of result.recordset || []) {
    const vinToma = String(row.vinToma || '').trim();
    const key = `${row.facturaNuevo}|${vinToma.toUpperCase()}`;
    if (!vinToma || seen.has(key)) continue;
    seen.add(key);
    const fechaToma = row.fechaToma || null;
    const fechaVentaUsado = row.fechaVentaUsado || null;
    const vendido = Boolean(row.pedidoUsn);
    const tomaMes = String(fechaToma || '').slice(0, 7);
    const ventaMes = String(fechaVentaUsado || '').slice(0, 7);
    const importe = dinero(row.importe);
    registros.push({
      idPedido: texto(row.pedidoNuevo) || texto(row.facturaNuevo),
      vinToma,
      fechaToma,
      usuarioToma: texto(row.usuarioToma),
      serieNuevo: String(row.serieNuevo || '').trim(),
      facturaNuevo: texto(row.facturaNuevo),
      fechaFactura: fechaToma,
      cliente: texto(row.cliente),
      vendedor: texto(row.vendedor),
      modeloToma: texto(row.modeloToma),
      anModeloToma: texto(row.anModeloToma),
      modeloNuevo: texto(row.modeloNuevo),
      anModeloNuevo: texto(row.anModeloNuevo),
      importeAdquisicion: importe,
      importeVehiculo: importe,
      vendido,
      enInventario: !vendido,
      vendidoMismoMes: Boolean(vendido && tomaMes && tomaMes === ventaMes),
      pedidoUsn: texto(row.pedidoUsn),
      fechaVentaUsado,
      montoVentaUsado: dinero(row.montoVentaUsado),
      clienteUsado: texto(row.clienteUsado),
      vendedorUsado: texto(row.vendedorUsado),
    });
  }
  return registros;
}

module.exports = {
  getIncadeaVentasPeriodo,
  getIncadeaConteosPorMes,
  getIncadeaTomasRegistros,
  getIncadeaAsesorPorVin,
  incadeaVentasHabilitado,
  aplicarConteosIncadea,
  marcaDe,
};
