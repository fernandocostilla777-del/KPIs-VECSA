(function () {
  const money = (n) => (window.fmt ? fmt.money(n) : Number(n || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' }));
  const pct = (n) => `${((Number(n) || 0) * 100).toFixed(1)}%`;

  const TIPO = {
    pago: 'Pago',
    debito: 'Débito',
    sin_movimiento: 'Sin movimiento',
    completo: 'Completo',
    parcial: 'Parcial',
    ninguno: 'Ninguno',
    liquidacion: 'Liquidación',
  };

  const ARCHIVO_ETIQUETAS = {
    'bonos-2026': 'Reglas y topes 2026',
    'bonos-captura-2026': 'Captura trimestral',
    'bonos-objetivos-2026': 'Carta de objetivos',
    'incadea-mapeo': 'Mapeo Incadea',
    'unidades-especiales': 'Unidades especiales',
  };

  function esc(v) {
    return String(v ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function pill(tipo) {
    const clase = tipo === 'pago' || tipo === 'completo' ? 'bonos-pill--pago'
      : tipo === 'debito' || tipo === 'ninguno' ? 'bonos-pill--debito'
        : 'bonos-pill--cero';
    return `<span class="bonos-pill ${clase}">${esc(TIPO[tipo] || tipo || '—')}</span>`;
  }

  function filaVacia(cols, texto) {
    return `<tr><td colspan="${cols}">${esc(texto)}</td></tr>`;
  }

  let anual = null;
  let estadoIncadea = null;
  let fuenteTrimestre = 'captura';

  function pintarTotalesAnio() {
    const wrap = document.getElementById('bonosTotalesAnio');
    const intro = document.getElementById('bonosResumenIntro');
    const titulo = document.getElementById('bonosMarcaTitulo');
    if (!anual || !wrap) return;
    titulo.textContent = `Sistema de Bonos ${anual.anio || 2026} · ${anual.marca || 'BMW'}`;
    const t = anual.totales || {};
    intro.textContent = `${t.trimestresCapturados || 0} trimestre(s) con captura · neto acumulado ${money(t.neto)} · volumen acumulado ${money(t.volumen)}`;
    wrap.innerHTML = [
      ['Neto acumulado', t.neto, 'kpi-card--amber'],
      ['Volumen acumulado', t.volumen, 'kpi-card--blue'],
      ['Trimestres capturados', t.trimestresCapturados, 'kpi-card--slate', true],
    ].map(([tituloKpi, valor, clase, esNumero]) => `
      <div class="kpi-card ${clase}">
        <div class="kpi-card-head"><span class="kpi-title">${esc(tituloKpi)}</span></div>
        <div class="kpi-value">${esNumero ? esc(valor) : money(valor)}</div>
        <div class="kpi-accent"></div>
      </div>`).join('');
  }

  function pintarEstado(estado) {
    estadoIncadea = estado;
    const resumen = document.getElementById('bonosEstadoResumen');
    const lista = document.getElementById('bonosEstadoLista');
    if (!resumen || !lista) return;

    const inc = estado?.configurado
      ? '<span class="ok">Incadea conectada</span> — el retail del trimestre puede calcularse desde facturación.'
      : '<span class="warn">Incadea sin configurar</span> — se usan retail y objetivos de la captura manual.';
    resumen.innerHTML = inc;

    const archivos = estado?.archivos || {};
    lista.innerHTML = Object.entries(ARCHIVO_ETIQUETAS).map(([clave, etiqueta]) => {
      const meta = archivos[clave];
      if (!meta) return `<li class="muted">${esc(etiqueta)}: no registrado</li>`;
      if (meta.presente) {
        const ej = meta.datosEjemplo ? ' · plantilla de ejemplo' : ' · archivo real';
        return `<li><span class="ok">✓</span> ${esc(etiqueta)}${esc(ej)}</li>`;
      }
      return `<li><span class="warn">○</span> ${esc(etiqueta)}: pendiente</li>`;
    }).join('');
  }

  function pintarAdvertencias(data) {
    const panel = document.getElementById('bonosAdvertencias');
    const ul = document.getElementById('bonosAdvertenciasLista');
    const diag = document.getElementById('bonosDiagnostico');
    const items = Array.isArray(data?.advertencias) ? data.advertencias : [];
    const hay = items.length > 0 || data?.diagnostico;
    panel?.classList.toggle('hidden', !hay);
    if (ul) ul.innerHTML = items.map((t) => `<li>${esc(t)}</li>`).join('');
    if (diag && data?.diagnostico) {
      const d = data.diagnostico;
      const partes = [];
      if (d.retail != null) partes.push(`Retail Incadea: ${d.retail} unidades`);
      if (d.inventario?.total != null) partes.push(`Inventario al corte: ${d.inventario.total} u. (${d.inventario.antiguos || 0} antigüedad alta)`);
      if (d.demos != null) partes.push(`Demos activos: ${d.demos}`);
      diag.textContent = partes.join(' · ');
      diag.classList.toggle('hidden', !partes.length);
    } else {
      diag?.classList.add('hidden');
    }
  }

  function pintarAnio() {
    const body = document.getElementById('tablaAnio');
    document.getElementById('tituloAnio').textContent = `Resumen ${anual.anio || ''}`;
    document.getElementById('subtituloAnio').textContent = anual.marca
      ? `${anual.marca} · ${anual.totales.trimestresCapturados} trimestre(s) capturado(s) · neto ${money(anual.totales.neto)}`
      : '';
    body.innerHTML = (anual.trimestres || []).map((t) => {
      if (!t.capturado) {
        return `<tr><td>${esc(t.etiqueta || `T${t.trimestre}`)}</td><td>Sin captura</td><td colspan="5"></td></tr>`;
      }
      const estado = t.provisional ? '<span class="bonos-pill bonos-pill--info">Provisional</span>' : 'Cerrado';
      return `<tr>
        <td>${esc(t.etiqueta || `T${t.trimestre}`)}</td>
        <td>${estado}</td>
        <td class="cell-money">${money(t.volumen)}</td>
        <td class="cell-money">${money(t.orientacion)}</td>
        <td class="cell-money">${money(t.calidad)}</td>
        <td class="cell-money">${money(t.penalizaciones)}</td>
        <td class="cell-money">${money(t.neto)}</td>
      </tr>`;
    }).join('');
    pintarTotalesAnio();
  }

  function pintarDetalle(data) {
    const r = data.resumen;
    const aviso = document.getElementById('avisoEjemplo');
    aviso.classList.toggle('hidden', !data.datosEjemplo);

    const fuenteTxt = fuenteTrimestre === 'incadea'
      ? 'Retail desde Incadea · orientación/calidad/penalizaciones desde captura'
      : 'Captura manual en backend/data/private/';
    document.getElementById('volumenMeta').dataset.fuente = fuenteTxt;

    document.getElementById('tarjetasTrimestre').innerHTML = [
      ['Volumen', r.volumen.bonoTrimestral, 'kpi-card--blue'],
      ['Orientación', r.orientacion.total, 'kpi-card--violet'],
      ['Calidad', r.calidad.total, 'kpi-card--green'],
      ['Penalizaciones', r.penalizaciones.total, 'kpi-card--rose'],
      ['Neto', r.neto.neto, 'kpi-card--amber'],
    ].map(([titulo, valor, clase]) => `
      <div class="kpi-card ${clase}">
        <div class="kpi-card-head"><span class="kpi-title">${titulo}</span></div>
        <div class="kpi-value">${money(valor)}</div>
        <p class="kpi-subtitle">${r.provisional ? 'Trimestre provisional' : r.etiqueta || ''}${fuenteTrimestre === 'incadea' ? ' · Incadea' : ''}</p>
        <div class="kpi-accent"></div>
      </div>`).join('');

    const vol = r.volumen;
    const grupo = vol.grupo
      ? `Grupo ${pct(vol.grupo.alcance)} ${vol.grupo.cumple ? '(cumple)' : '(no cumple)'}`
      : 'Sin condición de grupo';
    document.getElementById('volumenMeta').textContent =
      `Alcance trimestral ${pct(vol.alcanceTrimestral)} · bono ${money(vol.bonoTrimestral)} · mes 3 ${money(vol.pagoMes3)} · ${grupo} · ${fuenteTxt}`;

    document.getElementById('tablaVolumen').innerHTML = vol.meses.map((m) => `
      <tr>
        <td>${esc(m.etiqueta)}${m.cerrado ? '' : ' · abierto'}</td>
        <td class="cell-num">${esc(m.retail)}</td>
        <td class="cell-num">${esc(m.objetivo)}</td>
        <td class="cell-num">${pct(m.alcance)}</td>
        <td>${pill(m.clasificacion)}</td>
        <td class="cell-money">${money(m.anticipo)}</td>
      </tr>`).join('') + `
      <tr>
        <td>Trimestre</td>
        <td class="cell-num">${esc(vol.retail)}</td>
        <td class="cell-num">${esc(vol.objetivo)}</td>
        <td class="cell-num">${pct(vol.alcanceTrimestral)}</td>
        <td>${pill(vol.tipoMes3)}</td>
        <td class="cell-money">${money(vol.pagoMes3)}</td>
      </tr>`;

    document.getElementById('tablaOrientacion').innerHTML = r.orientacion.componentes.map((c) => `
      <tr><td>${esc(c.etiqueta)}</td><td>${esc(c.detalle)}</td><td class="cell-money">${money(c.monto)}</td></tr>
    `).join('') || filaVacia(3, 'Sin componentes');

    const cal = r.calidad;
    const invFilas = (cal.inventarios.meses || []).map((m) => `
      <tr>
        <td>Inventario ${esc(m.etiqueta || m.mes)}</td>
        <td>${pct(m.pct)} antigüedad${m.exigeVdc ? ' · VDC' : ''} · ${m.cumple ? 'cumple' : 'no cumple'}</td>
        <td></td>
      </tr>`).join('');
    document.getElementById('calidadMeta').textContent =
      `BEV ${pct(cal.bev.alcance)} · inventarios ${cal.inventarios.cumplen}/${cal.inventarios.evaluados} meses`;
    document.getElementById('tablaCalidad').innerHTML = `
      <tr><td>BEV</td><td>${cal.bev.cumple ? 'Alcanza el objetivo' : 'Por debajo del objetivo'} · ${esc(cal.bev.real)} / ${esc(cal.bev.objetivo)}</td><td class="cell-money">${money(cal.bev.monto)}</td></tr>
      ${invFilas}
      <tr><td>Gestión de inventarios</td><td>${cal.inventarios.cumplen} de ${cal.inventarios.evaluados} meses</td><td class="cell-money">${money(cal.inventarios.monto)}</td></tr>`;

    document.getElementById('penalizacionMeta').textContent = r.penalizaciones.aplicacionMensual
      ? 'Se aplican por cada mes incumplido.'
      : 'Se aplican una vez por trimestre.';
    document.getElementById('tablaPenalizaciones').innerHTML = r.penalizaciones.detalles.map((d) => `
      <tr><td>${esc(d.etiqueta)}</td><td>${d.cumple ? 'Cumple' : `Incumple × ${d.veces}`}</td><td class="cell-money">${money(d.monto)}</td></tr>
    `).join('') || filaVacia(3, 'Sin penalizaciones');

    document.getElementById('tablaTopes').innerHTML = r.topes.detalles.map((d) => `
      <tr>
        <td>${esc(d.etiqueta)}</td>
        <td class="cell-money">${money(d.solicitado)}</td>
        <td class="cell-money">${money(d.tope)}</td>
        <td class="cell-money">${money(d.aplicado)}</td>
      </tr>`).join('');

    pintarAdvertencias(data);
  }

  function pintarEscenarios(data) {
    const body = document.getElementById('tablaEscenarios');
    const rows = data.escenarios || [];
    body.innerHTML = rows.length ? rows.map((e) => `
      <tr>
        <td>${esc(e.nombre)}</td>
        <td class="cell-num">${pct(e.alcanceTrimestral)}</td>
        <td class="cell-money">${money(e.anticipos)}</td>
        <td class="cell-money">${money(e.bonoTrimestral)}</td>
        <td class="cell-money">${money(e.pagoMes3)}</td>
        <td>${pill(e.tipoMes3)}</td>
      </tr>`).join('') : filaVacia(6, 'Sin escenarios');
  }

  function llenarSelector() {
    const sel = document.getElementById('trimestreSelect');
    const capturados = (anual.trimestres || []).filter((t) => t.capturado);
    const opciones = capturados.length ? capturados : [{ trimestre: 1, etiqueta: 'T1' }];
    sel.innerHTML = opciones.map((t) => `<option value="${t.trimestre}">${esc(t.etiqueta || `T${t.trimestre}`)}</option>`).join('');
    const preferido = capturados[capturados.length - 1];
    if (preferido) sel.value = String(preferido.trimestre);
  }

  async function cargarTrimestre(trimestre) {
    fuenteTrimestre = 'captura';
    let data;
    const usarIncadea = estadoIncadea?.configurado
      && estadoIncadea?.archivos?.['bonos-objetivos-2026']?.presente;
    if (usarIncadea) {
      try {
        data = await api(`/bonos/incadea/resumen?trimestre=${encodeURIComponent(trimestre)}`);
        fuenteTrimestre = 'incadea';
      } catch {
        data = await api(`/bonos/resumen?trimestre=${encodeURIComponent(trimestre)}`);
      }
    } else {
      data = await api(`/bonos/resumen?trimestre=${encodeURIComponent(trimestre)}`);
    }
    pintarDetalle(data);
  }

  async function recargar() {
    showLoading(true);
    try {
      const [anio, escenarios, estado] = await Promise.all([
        api('/bonos/anual'),
        api('/bonos/escenarios'),
        api('/bonos/incadea/estado').catch(() => ({ configurado: false, archivos: {} })),
      ]);
      anual = anio;
      pintarEstado(estado);
      document.getElementById('avisoEjemplo').classList.toggle('hidden', !anio.datosEjemplo);
      pintarAnio();
      pintarEscenarios(escenarios);
      llenarSelector();
      const sel = document.getElementById('trimestreSelect');
      if (sel.value) await cargarTrimestre(sel.value);
    } catch (err) {
      document.getElementById('tablaAnio').innerHTML = filaVacia(7, err.message || 'No se pudo cargar');
      document.getElementById('bonosEstadoResumen').textContent = err.message || 'Error al cargar bonos';
    } finally {
      showLoading(false);
    }
  }

  document.getElementById('trimestreSelect').addEventListener('change', (ev) => {
    cargarTrimestre(ev.target.value).catch((err) => {
      document.getElementById('volumenMeta').textContent = err.message;
    });
  });
  document.getElementById('btnRecargar').addEventListener('click', recargar);

  document.getElementById('formSimulador').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = ev.target;
    const out = document.getElementById('simResultado');
    out.textContent = 'Calculando…';
    try {
      const data = await api('/bonos/simular', {
        method: 'POST',
        body: JSON.stringify({
          meses: [1, 2, 3].map((n) => ({
            etiqueta: `Mes ${n}`,
            retail: Number(f[`r${n}`].value),
            objetivo: Number(f[`o${n}`].value),
            cerrado: true,
          })),
          grupo: { real: Number(f.gr.value), objetivo: Number(f.go.value) },
        }),
      });
      const vol = data.volumen;
      out.textContent = `Alcance ${pct(vol.alcanceTrimestral)} · anticipos ${money(vol.anticipos)} · bono ${money(vol.bonoTrimestral)} · mes 3 ${money(vol.pagoMes3)} (${TIPO[vol.tipoMes3] || vol.tipoMes3})${vol.provisional ? ' · provisional' : ''}`;
    } catch (err) {
      out.textContent = err.message;
    }
  });

  recargar();
})();
