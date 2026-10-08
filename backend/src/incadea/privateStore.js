const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '../../data/private');

function nombreBase(nombre) {
  return String(nombre || '')
    .trim()
    .replace(/\.example\.json$/i, '')
    .replace(/\.json$/i, '');
}

/**
 * Lee un JSON de backend/data/private.
 * Si no existe el archivo real, usa el .example.json y marca datosEjemplo.
 */
function leerPrivado(nombre, { opcional = false, porDefecto = null } = {}) {
  const base = nombreBase(nombre);
  const real = path.join(DIR, `${base}.json`);
  const ejemplo = path.join(DIR, `${base}.example.json`);

  if (fs.existsSync(real)) {
    return {
      data: JSON.parse(fs.readFileSync(real, 'utf8')),
      datosEjemplo: false,
      archivo: `${base}.json`,
      ausente: false,
    };
  }
  if (fs.existsSync(ejemplo)) {
    return {
      data: JSON.parse(fs.readFileSync(ejemplo, 'utf8')),
      datosEjemplo: true,
      archivo: `${base}.example.json`,
      ausente: false,
    };
  }
  if (opcional) {
    return { data: porDefecto, datosEjemplo: true, archivo: null, ausente: true };
  }
  const err = new Error(`No existe ${base}.json ni su plantilla de ejemplo.`);
  err.status = 500;
  throw err;
}

module.exports = { leerPrivado, DIR };
