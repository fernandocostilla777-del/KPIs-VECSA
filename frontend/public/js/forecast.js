(function () {
  'use strict';

  let forecastChart;
  let tipoChart;
  let modeloChart;

  const { fmt, api, showLoading, setText, chartOptions, chartColors, chartPalette } = Dashboard;

  function sourceBadge(source) {
    const map = {
      sql: 'badge-running',
      'sql-partial': 'badge-maintenance',
      'sheet-only': 'badge-alert',
    };
    const labels = {
      sql: 'SQL',
      'sql-partial': 'SQL parcial',
      'sheet-only': 'Solo sheet',
    };
    return `<span class="badge-tipo ${map[source] || 'badge-stable'}">${labels[source] || source}</span>`;
  }

  function destroyChart(chart) {
    if (chart) chart.destroy();
  }

  function mapeBadge(mape) {
    if (mape === null || mape === undefined || Number.isNaN(Number(mape))) {
      return { label: 'Sin dato de precisión', className: 'badge-stable' };
    }
    const n = Number(mape);
    if (n <= 15) return { label: 'Bueno (≤15%)', className: 'badge-running' };
    if (n <= 25) return { label: 'Aceptable (≤25%)', className: 'badge-maintenance' };
    return { label: 'Revisar (>25%)', className: 'badge-alert' };
  }

  function setSidebarStatus(text, type = '') {
    const status = document.getElementById('statusBadge');
    if (!status) return;
    status.textContent = text;
    status.className = 'sidebar-status-line';
    if (type === 'loading') status.classList.add('status-loading');
    else if (type === 'error') status.classList.add('status-error');
  }

  async function loadForecast() {
    const horizon = document.getElementById('horizonSelect').value || '6';
    setSidebarStatus('Consultando...', 'loading');
    showLoading(true);

    try {
      const data = await api(`/forecast?horizon=${horizon}`);
      const k = data.kpis || {};
      const metrics = data.metrics || {};
      const historyRows = Array.isArray(data.history) ? data.history : [];
      const forecastRows = Array.isArray(data.forecast) ? data.forecast : [];
      const breakdown = data.breakdown || { byTipo: [], byModelo: [] };

      setText('kpiLast', fmt.number(k.lastMonthUnits));
      setText('kpiLastLabel', k.lastMonthLabel || 'Unidades vendidas');
      setText('kpiNext', fmt.number(k.nextMonthUnits));
      setText('kpiNextLabel', k.nextMonthLabel || 'Pronóstico');
      setText('kpiHorizon', fmt.number(k.horizonTotal));
      setText('kpiHorizonLabel', `${k.horizonMonths} meses proyectados`);
      setText('kpiMape', k.mape !== null ? `${k.mape}%` : '—');
      const quality = mapeBadge(k.mape);
      const badgeEl = document.getElementById('kpiMapeBadge');
      if (badgeEl) {
        badgeEl.innerHTML = `<span class="badge-tipo ${quality.className}">${quality.label}</span>`;
      }
      setText(
        'kpiVar',
        k.variationPct !== null
          ? `${k.variationPct >= 0 ? '+' : ''}${k.variationPct}% vs prom. 12m`
          : 'vs promedio 12 meses'
      );
      if (k.incompleteMonth) {
        setText('kpiLastLabel', `${k.lastMonthLabel} · excluye ${k.incompleteMonth}`);
      }
      setText('lastUpdated', `Actualizado: ${new Date().toLocaleTimeString('es-MX')}`);
      const fuenteLabel = {
        incadea: 'Incadea · ventas retail facturadas (BMW / MINI / Motorrad)',
        sql: 'SQL legacy (ADE_VTAFI) · ventas facturadas',
        spreadsheet: 'Hoja histórica · forecast-source.csv',
      };
      setText('dataSource', fuenteLabel[data.dataSource] || data.dataSource || '—');

      if (window.KpiInsights?.apply) {
        window.KpiInsights.apply('forecast', {
          horizon,
          dataSource: data.dataSource,
          kpis: {
            lastMonthUnits: k.lastMonthUnits,
            nextMonthUnits: k.nextMonthUnits,
            horizonTotal: k.horizonTotal,
            horizonMonths: k.horizonMonths,
            mape: k.mape,
            variationPct: k.variationPct,
            incompleteMonth: k.incompleteMonth,
          },
        });
      }

      const tableEl = document.getElementById('forecastTable');
      if (tableEl) {
        tableEl.innerHTML = forecastRows.length
          ? forecastRows.map((r) => `
        <tr>
          <td><strong>${r.label}</strong></td>
          <td>${fmt.number(r.units)}</td>
          <td style="color:#64748b">${fmt.number(r.low)}</td>
          <td style="color:#64748b">${fmt.number(r.high)}</td>
        </tr>
      `).join('')
          : '<tr><td colspan="4">Sin pronóstico para este horizonte.</td></tr>';
      }

      const notesEl = document.getElementById('notesList');
      if (notesEl) {
        notesEl.innerHTML = (data.notes || [])
          .map((n) => `<li>${n}</li>`)
          .join('') || '<li>Sin notas adicionales.</li>';
      }

      const mappingEl = document.getElementById('mappingTable');
      if (mappingEl) {
        mappingEl.innerHTML = (data.fieldMapping || []).map((f) => `
        <tr>
          <td>${f.sheet}</td>
          <td style="color:#64748b">${f.sql}</td>
          <td>${sourceBadge(f.source)}</td>
          <td>${f.usedInModel ? '<span class="badge-tipo badge-running">Sí</span>' : '<span class="badge-tipo badge-stable">No</span>'}</td>
        </tr>
      `).join('');
      }

      // Chart: un solo año de histórico (últimos 12 meses) + horizonte de pronóstico
      const chartHistory = historyRows.slice(-12);
      const histLabels = chartHistory.map((r) => r.label);
      const histUnits = chartHistory.map((r) => r.units);
      const fitted = chartHistory.map((r) => r.fitted);
      const forecastLabels = forecastRows.map((r) => r.label);
      const allLabels = [...histLabels, ...forecastLabels];

      const histSeries = [...histUnits, ...forecastRows.map(() => null)];
      const forecastSeries = [
        ...histUnits.map((_, i) => (i === histUnits.length - 1 ? histUnits[i] : null)),
        ...forecastRows.map((r) => r.units),
      ];
      const lowSeries = [
        ...histUnits.map(() => null),
        ...forecastRows.map((r) => r.low),
      ];
      const highSeries = [
        ...histUnits.map(() => null),
        ...forecastRows.map((r) => r.high),
      ];
      const fittedSeries = [...fitted, ...data.forecast.map(() => null)];

      const histFrom = chartHistory[0]?.label || '';
      const histTo = chartHistory[chartHistory.length - 1]?.label || '';
      setText(
        'modelName',
        `${data.model?.name || 'Modelo de predicción'} · Histórico ${histFrom}${histFrom && histTo ? ' – ' : ''}${histTo} (12 meses)`
      );

      const chartCanvas = document.getElementById('forecastChart');
      destroyChart(forecastChart);
      if (chartCanvas && allLabels.length) forecastChart = new Chart(chartCanvas, {
        type: 'line',
        data: {
          labels: allLabels,
          datasets: [
            {
              label: 'Real',
              data: histSeries,
              borderColor: chartColors.primary,
              backgroundColor: 'rgba(37,99,235,0.08)',
              fill: false,
              tension: 0.25,
              borderWidth: 2.5,
              pointRadius: 2,
              spanGaps: false,
            },
            {
              label: 'Ajuste modelo',
              data: fittedSeries,
              borderColor: chartColors.slate,
              borderDash: [4, 4],
              fill: false,
              tension: 0.25,
              borderWidth: 1.5,
              pointRadius: 0,
              spanGaps: false,
            },
            {
              label: 'Pronóstico',
              data: forecastSeries,
              borderColor: chartColors.violet,
              backgroundColor: 'rgba(139,92,246,0.12)',
              fill: false,
              tension: 0.25,
              borderWidth: 2.5,
              pointRadius: 3,
              spanGaps: false,
            },
            {
              label: 'Rango bajo',
              data: lowSeries,
              borderColor: 'rgba(148,163,184,0.5)',
              borderDash: [2, 2],
              fill: false,
              pointRadius: 0,
              borderWidth: 1,
              spanGaps: false,
            },
            {
              label: 'Rango alto',
              data: highSeries,
              borderColor: 'rgba(148,163,184,0.5)',
              borderDash: [2, 2],
              fill: '-1',
              backgroundColor: 'rgba(139,92,246,0.08)',
              pointRadius: 0,
              borderWidth: 1,
              spanGaps: false,
            },
          ],
        },
        options: chartOptions({ plugins: { legend: { position: 'bottom' } } }),
      });

      const byTipo = Array.isArray(breakdown.byTipo) ? breakdown.byTipo : [];
      const byModelo = Array.isArray(breakdown.byModelo) ? breakdown.byModelo : [];

      destroyChart(tipoChart);
      const tipoCanvas = document.getElementById('tipoChart');
      if (tipoCanvas && byTipo.length) {
        tipoChart = new Chart(tipoCanvas, {
          type: 'doughnut',
          data: {
            labels: byTipo.map((r) => r.label),
            datasets: [{
              data: byTipo.map((r) => r.units),
              backgroundColor: chartPalette,
              borderWidth: 0,
            }],
          },
          options: chartOptions({ plugins: { legend: { position: 'bottom', labels: { boxWidth: 10 } } } }),
        });
      }

      destroyChart(modeloChart);
      const modeloCanvas = document.getElementById('modeloChart');
      if (modeloCanvas && byModelo.length) {
        modeloChart = new Chart(modeloCanvas, {
          type: 'bar',
          data: {
            labels: byModelo.map((r) => r.label),
            datasets: [{
              label: 'Unidades',
              data: byModelo.map((r) => r.units),
              backgroundColor: chartColors.secondary,
              borderRadius: 8,
            }],
          },
          options: chartOptions({
            indexAxis: 'y',
            plugins: { legend: { display: false } },
          }),
        });
      }

      const trainSize = metrics.trainSize ?? historyRows.length;
      const fuenteStatus = {
        incadea: `Incadea · ${trainSize} meses`,
        sql: `SQL operativo · ${trainSize} meses`,
        spreadsheet: `Hoja histórica · ${trainSize} meses`,
      };
      setSidebarStatus(fuenteStatus[data.dataSource] || `Fuente: ${data.dataSource || '—'} · ${trainSize} meses`);
    } catch (err) {
      setSidebarStatus(err.message || 'Error al cargar pronóstico', 'error');
    } finally {
      showLoading(false);
    }
  }

  document.getElementById('btnConsultar').addEventListener('click', loadForecast);
  document.getElementById('horizonSelect').addEventListener('change', loadForecast);
  loadForecast();
})();
