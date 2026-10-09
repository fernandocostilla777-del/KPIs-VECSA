const express = require('express');
const bonos = require('../services/bonosService');
const incadea = require('../services/bonosIncadea');

const router = express.Router();

function send(res, next, fn) {
  try {
    res.json(fn());
  } catch (err) {
    if (err?.status) return res.status(err.status).json({ error: err.message });
    return next(err);
  }
}

async function sendAsync(res, next, fn) {
  try {
    res.json(await fn());
  } catch (err) {
    if (err?.status) return res.status(err.status).json({ error: err.message });
    return next(err);
  }
}

router.get('/config', (_req, res, next) => {
  send(res, next, () => bonos.getConfig());
});

router.get('/anual', (_req, res, next) => {
  send(res, next, () => bonos.getAnual());
});

router.get('/resumen', (req, res, next) => {
  send(res, next, () => bonos.getResumen(req.query.trimestre));
});

router.get('/escenarios', (_req, res, next) => {
  send(res, next, () => bonos.getEscenarios());
});

router.post('/simular', (req, res, next) => {
  send(res, next, () => bonos.simular(req.body || {}));
});

router.get('/incadea/estado', (_req, res, next) => {
  send(res, next, () => incadea.getEstado());
});

router.get('/incadea/resumen', (req, res, next) => {
  sendAsync(res, next, () => incadea.getResumenIncadea(req.query.trimestre));
});

router.get('/incadea/validacion/estatus', (req, res, next) => {
  sendAsync(res, next, () => incadea.getValidacionEstatus());
});

router.get('/incadea/inventario', (req, res, next) => {
  sendAsync(res, next, () => incadea.getGestionInventario({ mes: req.query.mes || '' }));
});

module.exports = router;
