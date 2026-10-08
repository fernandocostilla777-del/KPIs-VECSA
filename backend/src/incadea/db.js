/**
 * Conexión de solo lectura a Incadea (SQL Server).
 * mssql se carga solo cuando hay una consulta y la conexión está configurada.
 */

function configurado() {
  return Boolean(
    process.env.INCADEA_DB_HOST
    && process.env.INCADEA_DB_NAME
    && process.env.INCADEA_DB_USER,
  );
}

function esSoloLectura(text) {
  const sql = String(text || '').trim().replace(/^\uFEFF/, '');
  if (!/^(select|with)\b/i.test(sql)) return false;
  const cuerpo = sql.replace(/;[\s]*$/, '');
  if (cuerpo.includes(';')) return false;
  if (/\b(insert|update|delete|drop|alter|exec|execute|merge|truncate|grant|revoke)\b/i.test(cuerpo)) {
    return false;
  }
  return true;
}

let poolPromise = null;

function configConexion() {
  return {
    server: process.env.INCADEA_DB_HOST,
    port: parseInt(process.env.INCADEA_DB_PORT || '1433', 10),
    database: process.env.INCADEA_DB_NAME,
    user: process.env.INCADEA_DB_USER,
    password: process.env.INCADEA_DB_PASSWORD || '',
    options: {
      encrypt: false,
      trustServerCertificate: true,
      connectTimeout: 30000,
      requestTimeout: 120000,
      readOnlyIntent: true,
    },
    pool: { max: 4, min: 0, idleTimeoutMillis: 30000 },
  };
}

async function obtenerPool() {
  if (!poolPromise) {
    const sql = require('mssql');
    poolPromise = sql.connect(configConexion()).catch((err) => {
      poolPromise = null;
      throw err;
    });
  }
  return poolPromise;
}

async function consultar({ text, params } = {}) {
  if (!esSoloLectura(text)) {
    const err = new Error('Incadea solo acepta consultas de lectura (SELECT o WITH).');
    err.status = 400;
    throw err;
  }
  if (!configurado()) {
    const err = new Error('La conexión Incadea no está configurada.');
    err.status = 503;
    throw err;
  }
  const pool = await obtenerPool();
  const request = pool.request();
  for (const [key, value] of Object.entries(params || {})) {
    request.input(key, value);
  }
  const result = await request.query(text);
  return result.recordset;
}

module.exports = {
  configurado,
  esSoloLectura,
  consultar,
};
