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
  }

  function pintarDetalle(data) {
    const r = data.resumen;
    const aviso = document.getElementById('avisoEjemplo');
    aviso.classList.toggle('hidden', !data.datosEjemplo);

    document.getElementById('tarjetasTrimestre').innerHTML = [
      ['Volumen', r.volumen.bonoTrimestral, 'kpi-card--blue'],
      ['Orientación', r.orientacion.total, 'kpi-card--violet'],
      ['Calidad', r.calidad.total, 'kpi-card--green'],
      ['Neto', r.neto.neto, 'kpi-card--amber'],
    ].map(([titulo, valor, clase]) => `
      <div class="kpi-card ${clase}">
        <div class="kpi-card-head"><span class="kpi-title">${titulo}</span></div>
        <div class="kpi-value">${money(valor)}</div>
        <p class="kpi-subtitle">${r.provisional ? 'Trimestre provisional' : r.etiqueta || ''}</p>
        <div class="kpi-accent"></div>
      </div>`).join('');

    const vol = r.volumen;
    const grupo = vol.grupo
      ? `Grupo ${pct(vol.grupo.alcance)} ${vol.grupo.cumple ? '(cumple)' : '(no cumple)'}`
      : 'Sin condición de grupo';
    document.getElementById('volumenMeta').textContent =
      `Alcance trimestral ${pct(vol.alcanceTrimestral)} · bono ${money(vol.bonoTrimestral)} · mes 3 ${money(vol.pagoMes3)} · ${grupo}`;

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
    const data = await api(`/bonos/resumen?trimestre=${encodeURIComponent(trimestre)}`);
    pintarDetalle(data);
  }

  async function recargar() {
    showLoading(true);
    try {
      const [anio, escenarios] = await Promise.all([
        api('/bonos/anual'),
        api('/bonos/escenarios'),
      ]);
      anual = anio;
      document.getElementById('avisoEjemplo').classList.toggle('hidden', !anio.datosEjemplo);
      pintarAnio();
      pintarEscenarios(escenarios);
      llenarSelector();
      const sel = document.getElementById('trimestreSelect');
      if (sel.value) await cargarTrimestre(sel.value);
    } catch (err) {
      document.getElementById('tablaAnio').innerHTML = filaVacia(7, err.message || 'No se pudo cargar');
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
