/**
 * Pestañas de Pronóstico — debe cargarse antes de los módulos de presupuesto/simulador.
 */
(function () {
  'use strict';

  function setTitle(text) {
    if (window.Dashboard?.setText) window.Dashboard.setText('forecastTopTitle', text);
    else {
      const el = document.getElementById('forecastTopTitle');
      if (el) el.textContent = text;
    }
  }

  const TAB_TITLES = {
    ventas: 'Pronóstico de Ventas',
    presupuesto12m: 'Presupuesto próximos 12 meses',
    simulador: 'Simulador de presupuesto',
    presupuesto: 'Seguimiento PPTO 2026',
  };
  const TABS = Object.keys(TAB_TITLES);

  function currentTabFromUrl() {
    const params = new URLSearchParams(location.search);
    const fromQuery = params.get('tab');
    const fromHash = location.hash.replace('#', '');
    const tab = fromQuery || fromHash;
    return TABS.includes(tab) ? tab : 'ventas';
  }

  function switchTab(tab, { updateUrl = true } = {}) {
    const target = TABS.includes(tab) ? tab : 'ventas';
    document.querySelectorAll('#forecastTabs .contabilidad-tab').forEach((el) => {
      el.classList.toggle('active', el.dataset.tab === target);
    });
    document.querySelectorAll('.forecast-panel').forEach((panel) => {
      panel.classList.toggle('hidden', panel.dataset.panel !== target);
    });
    setTitle(TAB_TITLES[target]);
    document.getElementById('forecastVentasControls')?.classList.toggle('hidden', target !== 'ventas');
    document.body.dataset.forecastTab = target;

    if (updateUrl) {
      const url = new URL(location.href);
      if (target !== 'ventas') url.searchParams.set('tab', target);
      else url.searchParams.delete('tab');
      url.hash = '';
      history.replaceState(null, '', url);
    }

    document.dispatchEvent(new CustomEvent('forecast:tab', { detail: { tab: target } }));
  }

  const nav = document.getElementById('forecastTabs');
  if (!nav) return;

  nav.addEventListener('click', (e) => {
    const tabBtn = e.target.closest('.contabilidad-tab');
    if (!tabBtn || !nav.contains(tabBtn)) return;
    switchTab(tabBtn.dataset.tab);
  });

  switchTab(currentTabFromUrl(), { updateUrl: false });

  window.ForecastTabs = { switchTab, TABS };
})();
