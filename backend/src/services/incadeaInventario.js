const { getPool, sql } = require('../db');
const { leerPrivado } = require('../incadea/privateStore');
const { tabla } = require('../incadea/queries');

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

function marcaVisible(codigo) {
  const marca = String(codigo || '').trim().toUpperCase();
  if (marca === 'BMW' || marca === 'BMWI') return 'BMW';
  if (marca === 'MINI') return 'MINI';
  if (marca === 'MOTO' || marca === 'MOTORRAD') return 'Motorrad';
  return marca || 'Sin marca';
}

/**
 * Stock de autos nuevos en Incadea, con las columnas que espera el inventario.
 * Estatus 0 = físico, 2 = demo, 5 = evento/tránsito. Seminuevos (VU) no entran.
 */
async function getIncadeaInventarioNuevos() {
  const vehiculo = tabla(empresaIncadea(), 'Vehicle');
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT
      v.[Model] AS modelo,
      v.[Make Code] AS marca,
      v.[Model No_] AS catalogo,
      v.[Model Year] AS anio,
      v.[VIN] AS vin,
      v.[Location Code] AS ubicacion,
      v.[Inventory Posting Group] AS grupo,
      CASE
        WHEN v.[Vehicle Status] = 2 OR v.[Inventory Posting Group] LIKE 'VD%' THEN 'DEMO'
        WHEN v.[Vehicle Status] = 5 THEN 'TRAN'
        ELSE 'FIS'
      END AS situacion,
      CASE
        WHEN v.[Purchase Receipt Date] > '19900101' THEN v.[Purchase Receipt Date]
        WHEN v.[Purchase Invoice Date] > '19900101' THEN v.[Purchase Invoice Date]
        ELSE NULL
      END AS fechaIngreso,
      CASE
        WHEN ISNULL(v.[Unit List Price], 0) > 0 THEN v.[Unit List Price]
        WHEN ISNULL(v.[Unit Price], 0) > 0 THEN v.[Unit Price]
        ELSE 0
      END AS precio,
      CASE
        WHEN ISNULL(v.[Unit Cost], 0) > 0 THEN v.[Unit Cost]
        WHEN ISNULL(v.[Last Direct Cost], 0) > 0 THEN v.[Last Direct Cost]
        WHEN ISNULL(v.[Average Cost], 0) > 0 THEN v.[Average Cost]
        ELSE 0
      END AS costo
    FROM ${vehiculo} v
    WHERE v.[Vehicle Status] IN (0, 2, 5)
      AND (
        v.[Inventory Posting Group] LIKE 'VN%'
        OR v.[Inventory Posting Group] LIKE 'VD%'
      )
  `);

  return (result.recordset || []).map((row) => ({
    VEH_TIPOAUTO: String(row.modelo || '').trim(),
    UNC_FAMILIA: marcaVisible(row.marca),
    VEH_NOINVENTA: 1,
    VEH_CATALOGO: String(row.catalogo || '').trim(),
    VEH_ANMODELO: row.anio == null ? '' : String(row.anio).trim(),
    VEH_NUMSERIE: String(row.vin || '').trim(),
    VEH_NOMOTOR: '',
    VEH_COLOEXTE: '',
    COL_DESCRIPCION: '',
    VEH_COLOINTE: '',
    COLINTE: '',
    VEH_OBSERVACION: String(row.grupo || '').trim(),
    VEH_FECREMISION: row.fechaIngreso,
    VEH_UBICACION: String(row.ubicacion || '').trim(),
    VEH_SITUACION: row.situacion,
    VEH_FECHSEP: '',
    VEH_PERAPAR: '',
    VEH_CVEUSU: '',
    IMPORTE_REMISION: 0,
    GASTOS_REMISION: 0,
    PREVIAS: 0,
    PREVIAS_DETALLE: '',
    PRECIO_LISTA: Number(row.precio) || 0,
    VEH_VENTA: Number(row.precio) || 0,
    VEH_COSTO1: Number(row.costo) || 0,
    VEH_REBATE: 0,
    VEH_MISELANEOS: 0,
  }));
}

function dinero(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.round(x * 100) / 100;
}

function isoFecha(value) {
  const fecha = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(fecha.getTime()) || fecha.getUTCFullYear() < 1990) return null;
  return fecha.toISOString().slice(0, 10);
}

const VIN_EN_TEXTO = /[A-HJ-NPR-Z0-9]{17}/g;

/**
 * Apoyo táctico de la cuenta 41210030, solo cuando el movimiento nombra un VIN.
 * En NAV el abono viene negativo; aquí queda en positivo, a favor de la unidad.
 */
async function apoyosTacticosPorVin(pool, empresa) {
  const mayor = tabla(empresa, 'G_L Entry');
  const factura = tabla(empresa, 'Sales Invoice Line');
  const credito = tabla(empresa, 'Sales Credit Memo Line');
  const result = await pool.request().query(`
    SELECT
      [Description] AS descripcion,
      [Document No_] AS doc,
      [Amount] AS importe
    FROM ${mayor}
    WHERE [G_L Account No_] = '41210030'
  `);
  const map = new Map();
  const docsMayor = new Set();
  for (const row of result.recordset || []) {
    const vins = [...new Set(String(row.descripcion || '').toUpperCase().match(VIN_EN_TEXTO) || [])];
    if (vins.length !== 1) continue;
    const vin = vins[0];
    let acc = map.get(vin);
    if (!acc) {
      acc = { importe: 0, docs: [] };
      map.set(vin, acc);
    }
    acc.importe += Number(row.importe || 0) * -1;
    const doc = String(row.doc || '').trim();
    if (doc && !acc.docs.includes(doc)) acc.docs.push(doc);
    if (doc) docsMayor.add(doc);
  }

  const lineas = await pool.request().query(`
    SELECT LTRIM(RTRIM([VIN])) AS vin, [Document No_] AS doc, [Amount] AS importe, CAST(1 AS int) AS signo
    FROM ${factura}
    WHERE [Type] = 1 AND [No_] = '41210030' AND LTRIM(RTRIM(ISNULL([VIN], ''))) <> ''
    UNION ALL
    SELECT LTRIM(RTRIM([VIN])), [Document No_], [Amount], CAST(-1 AS int)
    FROM ${credito}
    WHERE [Type] = 1 AND [No_] = '41210030' AND LTRIM(RTRIM(ISNULL([VIN], ''))) <> ''
  `);
  for (const row of lineas.recordset || []) {
    const doc = String(row.doc || '').trim();
    if (doc && docsMayor.has(doc)) continue;
    const vin = String(row.vin || '').trim().toUpperCase();
    if (!vin) continue;
    let acc = map.get(vin);
    if (!acc) {
      acc = { importe: 0, docs: [] };
      map.set(vin, acc);
    }
    acc.importe += Number(row.importe || 0) * Number(row.signo || 0);
    if (doc && !acc.docs.includes(doc)) acc.docs.push(doc);
  }
  for (const acc of map.values()) acc.importe = dinero(acc.importe);
  return map;
}

function clasificarTipoVenta(bonosDetalle) {
  const marcas = new Set();
  for (const item of bonosDetalle || []) {
    const texto = String(item.tipo || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase();
    if (texto.includes('DEMO')) marcas.add('Demo');
    else if (texto.includes('TACTIC')) marcas.add('Táctico');
    else if (texto.includes('CORPORATIV')) marcas.add('Corporativo');
    else if (texto.includes('CASH')) marcas.add('Cashback');
    else if (/RETAIL|REGULARIDAD|VOLUMEN|GAMA|RIDER|VOC|CRM|BEV/.test(texto)) marcas.add('Retail');
  }
  const orden = ['Demo', 'Táctico', 'Corporativo', 'Cashback', 'Retail'];
  const lista = orden.filter((nombre) => marcas.has(nombre));
  if (lista.length === 1 && lista[0] === 'Cashback') return [];
  return lista;
}

function tipoDeBono(nombreCuenta, descripcion) {
  const texto = String(descripcion || '').toUpperCase();
  if (texto.includes('CASHBACK')) return 'Bono cashback';
  if (texto.includes('CORPORATIV')) return 'Corporativo';
  if (texto.includes('DESC DEMO') || texto.includes('DESCUENTO DEMO')) return 'Descuento demo';
  if (texto.includes('BONO DEMO') || texto.includes(' DEMO')) return 'Bono demo';
  const nombre = String(nombreCuenta || '').trim();
  return nombre || 'Bono';
}

/**
 * Bonos 41210001–41210036 ligados al VIN, sin el apoyo táctico 41210030.
 * La línea manda cuando ya trae el VIN; el mayor solo entra si el texto lo nombra
 * y la línea de ese documento no lo traía.
 */
async function bonosPorVin(pool, empresa) {
  const factura = tabla(empresa, 'Sales Invoice Line');
  const credito = tabla(empresa, 'Sales Credit Memo Line');
  const mayor = tabla(empresa, 'G_L Entry');
  const cuenta = tabla(empresa, 'G_L Account');
  const lineas = await pool.request().query(`
    SELECT
      LTRIM(RTRIM(l.[VIN])) AS vin,
      l.[No_] AS cuenta,
      a.[Name] AS nombre,
      l.[Document No_] AS doc,
      l.[Amount] AS importe,
      l.[Description] AS descripcion,
      CAST(1 AS int) AS signo
    FROM ${factura} l
    LEFT JOIN ${cuenta} a ON a.[No_] = l.[No_]
    WHERE l.[Type] = 1
      AND l.[No_] BETWEEN '41210001' AND '41210036'
      AND l.[No_] <> '41210030'
      AND LTRIM(RTRIM(ISNULL(l.[VIN], ''))) <> ''
    UNION ALL
    SELECT
      LTRIM(RTRIM(l.[VIN])),
      l.[No_],
      a.[Name],
      l.[Document No_],
      l.[Amount],
      l.[Description],
      CAST(-1 AS int)
    FROM ${credito} l
    LEFT JOIN ${cuenta} a ON a.[No_] = l.[No_]
    WHERE l.[Type] = 1
      AND l.[No_] BETWEEN '41210001' AND '41210036'
      AND l.[No_] <> '41210030'
      AND LTRIM(RTRIM(ISNULL(l.[VIN], ''))) <> ''
  `);
  const gl = await pool.request().query(`
    SELECT
      g.[G_L Account No_] AS cuenta,
      a.[Name] AS nombre,
      g.[Document No_] AS doc,
      g.[Description] AS descripcion,
      g.[Amount] AS importe
    FROM ${mayor} g
    LEFT JOIN ${cuenta} a ON a.[No_] = g.[G_L Account No_]
    WHERE g.[G_L Account No_] BETWEEN '41210001' AND '41210036'
      AND g.[G_L Account No_] <> '41210030'
  `);

  const map = new Map();
  const cubiertos = new Set();
  function sumar(vin, tipo, importe) {
    const monto = dinero(importe);
    const serie = String(vin || '').trim().toUpperCase();
    if (!serie || !monto) return;
    let tipos = map.get(serie);
    if (!tipos) {
      tipos = new Map();
      map.set(serie, tipos);
    }
    tipos.set(tipo, dinero((tipos.get(tipo) || 0) + monto));
  }

  for (const row of lineas.recordset || []) {
    const vin = String(row.vin || '').trim().toUpperCase();
    const doc = String(row.doc || '').trim();
    if (doc) cubiertos.add(`${doc}|${row.cuenta}|${vin}`);
    sumar(vin, tipoDeBono(row.nombre, row.descripcion), Number(row.importe || 0) * Number(row.signo || 0));
  }
  for (const row of gl.recordset || []) {
    const vins = [...new Set(String(row.descripcion || '').toUpperCase().match(VIN_EN_TEXTO) || [])];
    if (vins.length !== 1) continue;
    const vin = vins[0];
    const doc = String(row.doc || '').trim();
    if (cubiertos.has(`${doc}|${row.cuenta}|${vin}`)) continue;
    cubiertos.add(`${doc}|${row.cuenta}|${vin}`);
    sumar(vin, tipoDeBono(row.nombre, row.descripcion), Number(row.importe || 0) * -1);
  }
  return map;
}

function esNotaVecsa(descripcion) {
  return String(descripcion || '').toUpperCase().includes('VECSA');
}

function esNotaSobreprecio(descripcion) {
  return String(descripcion || '').toUpperCase().includes('SOBREPRECIO');
}

/** Notas CNCP aplicadas a la factura del VIN. No entran al total de bonos. */
async function notasClientePorVin(pool, empresa) {
  const credito = tabla(empresa, 'Sales Credit Memo Line');
  const creditoHdr = tabla(empresa, 'Sales Credit Memo Header');
  const factura = tabla(empresa, 'Sales Invoice Line');
  const result = await pool.request().query(`
    SELECT
      LTRIM(RTRIM(v.[VIN])) AS vin,
      h.[Applies-to Doc_ No_] AS factura,
      h.[No_] AS nota,
      l.[Line No_] AS linea,
      l.[Description] AS descripcion,
      l.[Amount] AS importe
    FROM ${creditoHdr} h
    INNER JOIN ${credito} l ON l.[Document No_] = h.[No_]
    INNER JOIN ${factura} v
      ON v.[Document No_] = h.[Applies-to Doc_ No_]
      AND v.[Type] = 2
      AND v.[Quantity] > 0
      AND LTRIM(RTRIM(ISNULL(v.[VIN], ''))) <> ''
    WHERE h.[No_] LIKE 'CNCP%'
      AND l.[Type] = 1
      AND (
        UPPER(l.[Description]) LIKE '%SOBREPRECIO%'
        OR UPPER(l.[Description]) LIKE '%VECSA%'
      )
  `);
  const map = new Map();
  for (const row of result.recordset || []) {
    const vin = String(row.vin || '').trim().toUpperCase();
    const texto = String(row.descripcion || '').trim();
    if (!vin || !texto) continue;
    const tipo = esNotaSobreprecio(texto)
      ? 'NC sobreprecio'
      : (esNotaVecsa(texto) ? 'NC VECSA' : '');
    if (!tipo) continue;
    let acc = map.get(vin);
    if (!acc) {
      acc = [];
      map.set(vin, acc);
    }
    const clave = `${String(row.nota || '').trim()}|${row.linea}|${texto}`;
    if (acc.some((item) => item.clave === clave)) continue;
    acc.push({
      clave,
      tipo,
      importe: dinero(row.importe),
      doc: String(row.nota || '').trim(),
      factura: String(row.factura || '').trim(),
      texto,
    });
  }
  return map;
}

function gastoDelCierre(fechaGasto, fechaVenta) {
  const gasto = isoFecha(fechaGasto);
  const venta = isoFecha(fechaVenta);
  if (!gasto || !venta) return true;
  const limite = new Date(`${venta}T12:00:00`);
  limite.setDate(limite.getDate() + 45);
  return new Date(`${gasto}T12:00:00`) <= limite;
}

/** Cargos internos DINT del VIN: refacciones/accesorios a costo y mano de obra asignada. */
async function gastosPorVin(pool, empresa) {
  const servicio = tabla(empresa, 'Service Ledger Entry');
  const mayor = tabla(empresa, 'G_L Entry');
  const cuenta = tabla(empresa, 'G_L Account');
  const piezas = await pool.request().query(`
    SELECT
      LTRIM(RTRIM(s.[VIN])) AS vin,
      s.[Document No_] AS doc,
      MIN(s.[Posting Date]) AS fecha,
      s.[Description] AS descripcion,
      SUM(s.[Total Cost]) AS importe
    FROM ${servicio} s
    WHERE s.[Document No_] LIKE 'DINT%'
      AND s.[Type] = 1
      AND LTRIM(RTRIM(ISNULL(s.[VIN], ''))) <> ''
      AND s.[Total Cost] <> 0
    GROUP BY LTRIM(RTRIM(s.[VIN])), s.[Document No_], s.[Description]
  `);
  const mano = await pool.request().query(`
    SELECT
      d.vin,
      g.[Document No_] AS doc,
      d.fecha,
      d.labor,
      d.recurso,
      SUM(-g.[Amount]) AS importe
    FROM ${mayor} g
    INNER JOIN ${cuenta} a ON a.[No_] = g.[G_L Account No_]
    INNER JOIN (
      SELECT
        LTRIM(RTRIM(s.[VIN])) AS vin,
        s.[Document No_] AS doc,
        MIN(s.[Posting Date]) AS fecha,
        MAX(CASE WHEN s.[Type] = 4 THEN NULLIF(LTRIM(RTRIM(s.[Description])), '') END) AS labor,
        MAX(CASE WHEN s.[Type] = 2 THEN NULLIF(LTRIM(RTRIM(s.[Description])), '') END) AS recurso
      FROM ${servicio} s
      WHERE s.[Document No_] LIKE 'DINT%'
        AND LTRIM(RTRIM(ISNULL(s.[VIN], ''))) <> ''
      GROUP BY LTRIM(RTRIM(s.[VIN])), s.[Document No_]
    ) d ON d.doc = g.[Document No_]
    WHERE a.[Name] LIKE '%Mano de Obra%'
    GROUP BY d.vin, g.[Document No_], d.fecha, d.labor, d.recurso
  `);
  const map = new Map();
  const agregar = (vin, item) => {
    const clave = String(vin || '').trim().toUpperCase();
    const importe = dinero(item.importe);
    if (!clave || !importe) return;
    let acc = map.get(clave);
    if (!acc) {
      acc = [];
      map.set(clave, acc);
    }
    acc.push({ ...item, importe });
  };
  for (const row of piezas.recordset || []) {
    agregar(row.vin, {
      label: String(row.descripcion || '').trim() || 'Refacción',
      importe: row.importe,
      doc: String(row.doc || '').trim(),
      fecha: row.fecha,
    });
  }
  for (const row of mano.recordset || []) {
    agregar(row.vin, {
      label: String(row.labor || row.recurso || 'Mano de obra').trim(),
      importe: row.importe,
      doc: String(row.doc || '').trim(),
      fecha: row.fecha,
    });
  }
  return map;
}

function diasEntre(desde, hasta) {
  const a = isoFecha(desde);
  const b = isoFecha(hasta);
  if (!a || !b) return null;
  const ini = new Date(`${a}T12:00:00`);
  const fin = new Date(`${b}T12:00:00`);
  return Math.max(0, Math.round((fin - ini) / 86400000));
}

function carlineDe(grupo, marca) {
  const texto = String(grupo || '').trim().toUpperCase();
  const sufijo = texto.split('-')[1] || '';
  const serie = {
    S1: 'Serie 1', S2: 'Serie 2', S3: 'Serie 3', S4: 'Serie 4',
    S5: 'Serie 5', S7: 'Serie 7', S8: 'Serie 8',
    IX1: 'iX1', IX3: 'iX3', I4: 'i4', I5: 'i5', I7: 'i7',
  };
  if (texto.startsWith('VNB')) return serie[sufijo] || sufijo || 'BMW';
  if (texto.startsWith('VNM')) return 'MINI';
  if (texto.startsWith('VNT')) return 'Motorrad';
  return marcaVisible(marca);
}

function marcaDe(grupo, marca) {
  const visible = marcaVisible(marca);
  if (visible && visible !== 'Sin marca') return visible;
  const texto = String(grupo || '').trim().toUpperCase();
  if (texto.startsWith('VNB')) return 'BMW';
  if (texto.startsWith('VNM')) return 'MINI';
  if (texto.startsWith('VNT')) return 'Motorrad';
  return 'Sin marca';
}

/**
 * Cierre de unidades nuevas facturadas. Precio y costo salen de la línea
 * de factura. No inventa comisión, previa ni plan piso.
 */
async function getIncadeaCierreVendidos({ fechaInicio, fechaFin } = {}) {
  const empresa = empresaIncadea();
  const factura = tabla(empresa, 'Sales Invoice Line');
  const facturaHdr = tabla(empresa, 'Sales Invoice Header');
  const credito = tabla(empresa, 'Sales Credit Memo Line');
  const cliente = tabla(empresa, 'Customer');
  const vehiculo = tabla(empresa, 'Vehicle');
  const pool = await getPool();
  const result = await pool.request()
    .input('fechaInicio', sql.Date, new Date(`${fechaInicio}T12:00:00`))
    .input('fechaFin', sql.Date, new Date(`${fechaFin}T12:00:00`))
    .query(`
      SELECT
        LTRIM(RTRIM(l.[VIN])) AS vin,
        l.[Document No_] AS factura,
        l.[Posting Date] AS fechaVenta,
        l.[Quantity] AS qty,
        CAST(1 AS int) AS signo,
        l.[Amount] AS importe,
        l.[Unit Cost] AS costo,
        l.[Gen_ Prod_ Posting Group] AS grupo,
        v.[Model] AS modelo,
        v.[Make Code] AS marca,
        v.[Model No_] AS catalogo,
        v.[Dealer Salesperson Code] AS vendedorVeh,
        h.[Salesperson Code] AS vendedorFactura,
        h.[Sell-to Customer Name] AS cliente,
        CASE
          WHEN v.[Purchase Receipt Date] > '19900101' THEN v.[Purchase Receipt Date]
          WHEN v.[Purchase Invoice Date] > '19900101' THEN v.[Purchase Invoice Date]
          ELSE NULL
        END AS fechaIngreso
      FROM ${factura} l
      INNER JOIN ${facturaHdr} h ON h.[No_] = l.[Document No_]
      LEFT JOIN ${cliente} c ON c.[No_] = h.[Sell-to Customer No_]
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
        0 AS importe,
        0 AS costo,
        l.[Gen_ Prod_ Posting Group] AS grupo,
        NULL, NULL, NULL, NULL, NULL, NULL, NULL
      FROM ${credito} l
      WHERE l.[Posting Date] >= @fechaInicio
        AND l.[Posting Date] < DATEADD(day, 1, @fechaFin)
        AND l.[Type] = 2
        AND l.[Item Type] = 2
        AND l.[Quantity] > 0
        AND LTRIM(RTRIM(ISNULL(l.[VIN], ''))) <> ''
        AND l.[Gen_ Prod_ Posting Group] LIKE 'VN%'
    `);

  const porVin = new Map();
  for (const row of result.recordset || []) {
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

  const apoyos = await apoyosTacticosPorVin(pool, empresa);
  const bonos = await bonosPorVin(pool, empresa);
  const notasCliente = await notasClientePorVin(pool, empresa);
  const gastos = await gastosPorVin(pool, empresa);
  const table = [];
  for (const acc of porVin.values()) {
    if (acc.neto <= 0 || !acc.row) continue;
    const row = acc.row;
    const subtotal = dinero(row.importe);
    const costo = Number(row.costo) > 0 ? dinero(row.costo) : null;
    const vinClave = String(row.vin || '').trim().toUpperCase();
    const apoyo = apoyos.get(vinClave);
    const apoyoImporte = apoyo?.importe || 0;
    const bonosDetalle = [...(bonos.get(vinClave) || new Map()).entries()]
      .map(([tipo, importe]) => ({ tipo, importe: dinero(importe) }))
      .filter((item) => item.importe);
    if (apoyoImporte) {
      bonosDetalle.unshift({
        tipo: 'Bono táctico',
        importe: apoyoImporte,
        doc: apoyo?.docs?.length ? apoyo.docs.join(', ') : null,
      });
    }
    const bonosImporte = dinero(bonosDetalle.reduce((s, item) => s + item.importe, 0));
    const tiposVenta = clasificarTipoVenta(bonosDetalle);
    const tipoVenta = tiposVenta.length ? tiposVenta.join(' · ') : 'Menudeo';
    const facturaVin = String(row.factura || '').trim();
    const notasVin = (notasCliente.get(vinClave) || [])
      .filter((item) => !item.factura || item.factura === facturaVin);
    const notasVecsa = notasVin.filter((item) => item.tipo === 'NC VECSA');
    const notaCreditoSinIva = dinero(notasVecsa.reduce((s, item) => s + Number(item.importe || 0), 0));
    const notaCargoFolio = [...new Set(notasVecsa.map((item) => item.doc).filter(Boolean))].join(', ') || null;
    const utilidadBase = costo != null && subtotal > 0 ? dinero(subtotal - costo) : null;
    const utilidad = utilidadBase == null ? null : dinero(utilidadBase + bonosImporte);
    const gastosVin = (gastos.get(vinClave) || [])
      .filter((item) => gastoDelCierre(item.fecha, row.fechaVenta));
    const gastosImporte = dinero(gastosVin.reduce((s, item) => s + Number(item.importe || 0), 0));
    const utilidadNeta = utilidad == null ? null : dinero(utilidad - gastosImporte);
    const dias = diasEntre(row.fechaIngreso, row.fechaVenta);
    const vendedor = String(row.vendedorFactura || row.vendedorVeh || '').trim() || null;
    table.push({
      carline: carlineDe(row.grupo, row.marca),
      marca: marcaDe(row.grupo, row.marca),
      version: String(row.modelo || '').trim() || 'Sin versión',
      paquete: null,
      catalogo: String(row.catalogo || '').trim() || null,
      vin: String(row.vin || '').trim() || null,
      apoyoTactico: apoyoImporte,
      apoyoTacticoDoc: apoyo?.docs?.length ? apoyo.docs.join(', ') : null,
      bonos: bonosImporte,
      bonosDetalle,
      notasCliente: notasVin.map(({ clave, ...item }) => item),
      factura: String(row.factura || '').trim() || null,
      fechaVenta: isoFecha(row.fechaVenta),
      fechaRemision: isoFecha(row.fechaIngreso),
      daysInStock: dias,
      importeRemision: 0,
      precio: subtotal || null,
      isan: 0,
      costo,
      bonificacion: 0,
      notaCargo: 0,
      notaCargoSinIva: notaCreditoSinIva,
      notaCargoFolio,
      utilidadPromedio: utilidad,
      unidadesVendidas: 1,
      vendedorId: vendedor,
      vendedor,
      cliente: String(row.cliente || '').replace(/\s+/g, ' ').trim() || null,
      formaPago: null,
      tipoVenta,
      isFlotilla: tiposVenta.includes('Corporativo'),
      isDemo: tiposVenta.includes('Demo') || String(row.grupo || '').toUpperCase().startsWith('VD'),
      demoHint: tiposVenta.includes('Demo') ? 'Clasificada por bono demo o descuento demo' : null,
      observacion: String(row.grupo || '').trim() || null,
      ubicacion: null,
      comisionEv: 0,
      comisionEvBase: null,
      comisionEvPct: null,
      comisionEvPctVehiculo: null,
      comisionEvPctLeasing: null,
      comisionEvUnidadesPrev: null,
      comisionEvArrendamiento: false,
      comisionEvMesPrev: null,
      costoPrevia: 0,
      costoMercadotecnia: 0,
      costoPublicidad: 0,
      gasolinaLitros: 0,
      gasolinaPrecioLitro: 0,
      costoGasolina: 0,
      costoEntrega: 0,
      gastos: gastosImporte,
      gastosAdicionales: gastosImporte,
      gastosDetalle: gastosVin.map(({ label, importe, doc }) => ({ label, importe, doc })),
      planPisoAcumulado: 0,
      generaInteres: false,
      ingresoFinanciamiento: null,
      ingresoFinanciamientoCount: 0,
      ingresoFinanciamientoFuente: null,
      ingresoFinanciamientoDetalle: [],
      utilidadNeta,
      daysChargeable: 0,
      previas: 0,
      previasDetalle: [],
    });
  }

  table.sort((a, b) => String(b.fechaVenta || '').localeCompare(String(a.fechaVenta || '')));
  const carlineFilters = [...table.reduce((map, row) => {
    const label = row.carline || 'Sin familia';
    map.set(label, (map.get(label) || 0) + 1);
    return map;
  }, new Map()).entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'es'));

  const sumar = (key) => dinero(table.reduce((s, r) => s + Number(r[key] || 0), 0));
  return {
    fechaInicio,
    fechaFin,
    fuente: 'incadea',
    vendidosTable: table,
    carlineFilters,
    comisionEvMesPrev: null,
    summary: {
      unidades: table.length,
      utilidad: sumar('utilidadPromedio'),
      comisionEv: 0,
      extras: sumar('gastosAdicionales'),
      planPiso: 0,
      ingresoFinanciamiento: 0,
      conIngresoFinanciamiento: 0,
      utilidadNeta: sumar('utilidadNeta'),
      conPlanPiso: 0,
      conNotaCargo: 0,
      conArrendamiento: 0,
    },
  };
}

module.exports = {
  getIncadeaInventarioNuevos,
  getIncadeaCierreVendidos,
};
