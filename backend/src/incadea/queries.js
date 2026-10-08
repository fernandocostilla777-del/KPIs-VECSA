/**
 * Consultas de solo lectura contra Incadea (Dynamics NAV).
 * El prefijo de empresa se valida y se coloca entre corchetes: [Empresa$Tabla].
 */

function rechazar(mensaje) {
  const err = new Error(mensaje);
  err.status = 400;
  throw err;
}

function identificador(valor, etiqueta) {
  const texto = String(valor || '').trim();
  if (!/^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9][A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9 ._-]{0,80}$/.test(texto)) {
    rechazar(`${etiqueta} inválido.`);
  }
  return texto;
}

function tabla(empresa, nombreTabla) {
  const emp = identificador(empresa, 'Prefijo de empresa');
  const tab = identificador(nombreTabla, 'Tabla');
  return `[${emp}$${tab}]`;
}

function col(nombre) {
  return `[${identificador(nombre, 'Columna')}]`;
}

function columnas(mapeo) {
  const c = mapeo?.columnas || {};
  return {
    vin: col(c.vin || 'VIN'),
    numero: col(c.numero || 'No_'),
    modeloCodigo: col(c.modeloCodigo || 'Model No_'),
    modelo: col(c.modelo || 'Model'),
    grupo: col(c.grupo || 'Inventory Posting Group'),
    estatus: col(c.estatus || 'Vehicle Status'),
    entryType: col(c.entryType || 'Entry Type'),
    fecha: col(c.fecha || 'Posting Date'),
    costo: col(c.costo || 'Total Cost'),
    ventaVigente: col(c.ventaVigente || 'Current Sales Ledger Entry'),
    vehiculoNo: col(c.vehiculoNo || 'Vehicle No_'),
  };
}

function objetos(mapeo) {
  const tablas = mapeo?.tablas || {};
  return {
    vehiculo: tabla(mapeo.empresa, tablas.vehiculo || 'Vehicle'),
    movimiento: tabla(mapeo.empresa, tablas.movimiento || 'Vehicle Ledger Entry'),
    c: columnas(mapeo),
  };
}

function retailVentas(mapeo, { desde, hasta } = {}) {
  const { vehiculo, movimiento, c } = objetos(mapeo);
  const entryVenta = Number(mapeo?.entryType?.venta);
  const vigente = Number(mapeo?.ventaVigenteValor);
  return {
    nombre: 'retailVentas',
    text: `
      SELECT
        v.${c.vin} AS vin,
        v.${c.modeloCodigo} AS modeloCodigo,
        v.${c.modelo} AS modelo,
        v.${c.grupo} AS grupo,
        v.${c.estatus} AS estatus,
        e.${c.fecha} AS fecha,
        e.${c.costo} AS costo
      FROM ${movimiento} e
      INNER JOIN ${vehiculo} v ON v.${c.numero} = e.${c.vehiculoNo}
      WHERE e.${c.entryType} = @entryVenta
        AND e.${c.ventaVigente} = @vigente
        AND e.${c.fecha} >= @desde
        AND e.${c.fecha} < @hasta
    `.replace(/\s+/g, ' ').trim(),
    params: { entryVenta, vigente, desde, hasta },
  };
}

function inventarioAlCorte(mapeo) {
  const { vehiculo, movimiento, c } = objetos(mapeo);
  const entryCompra = Number(mapeo?.entryType?.compra);
  const estatusVendido = Number(mapeo?.estatus?.vendido);
  return {
    nombre: 'inventarioAlCorte',
    text: `
      SELECT
        v.${c.vin} AS vin,
        v.${c.modeloCodigo} AS modeloCodigo,
        v.${c.modelo} AS modelo,
        v.${c.grupo} AS grupo,
        v.${c.estatus} AS estatus,
        compra.fechaCompra AS fechaCompra,
        compra.costo AS costo
      FROM ${vehiculo} v
      OUTER APPLY (
        SELECT TOP 1 e.${c.fecha} AS fechaCompra, e.${c.costo} AS costo
        FROM ${movimiento} e
        WHERE e.${c.vehiculoNo} = v.${c.numero}
          AND e.${c.entryType} = @entryCompra
        ORDER BY e.${c.fecha} DESC
      ) compra
      WHERE v.${c.estatus} <> @estatusVendido
    `.replace(/\s+/g, ' ').trim(),
    params: { entryCompra, estatusVendido },
  };
}

function demoActivos(mapeo) {
  const { vehiculo, c } = objetos(mapeo);
  const estatusDemo = Number(mapeo?.estatus?.demo);
  return {
    nombre: 'demoActivos',
    text: `
      SELECT
        v.${c.vin} AS vin,
        v.${c.grupo} AS grupo,
        v.${c.estatus} AS estatus,
        v.${c.modelo} AS modelo
      FROM ${vehiculo} v
      WHERE v.${c.estatus} = @estatusDemo
         OR v.${c.grupo} LIKE @patronDemo
    `.replace(/\s+/g, ' ').trim(),
    params: { estatusDemo, patronDemo: 'VD%' },
  };
}

function validacionEstatusYGrupos(mapeo) {
  const { vehiculo, c } = objetos(mapeo);
  return {
    nombre: 'validacionEstatusYGrupos',
    text: `
      SELECT
        v.${c.estatus} AS estatus,
        v.${c.grupo} AS grupo,
        COUNT(*) AS unidades
      FROM ${vehiculo} v
      GROUP BY v.${c.estatus}, v.${c.grupo}
    `.replace(/\s+/g, ' ').trim(),
    params: {},
  };
}

module.exports = {
  identificador,
  tabla,
  retailVentas,
  inventarioAlCorte,
  demoActivos,
  validacionEstatusYGrupos,
};
