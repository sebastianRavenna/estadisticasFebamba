const { chromium } = require('playwright');
const fs = require('fs');

// FEBAMBA usa el portal de CABB (Confederación Argentina de Básquetbol)
// ya que FEBAMBA es una federación asociada dentro de CABB.
const TARGET_URL = 'https://estadisticascabb.gesdeportiva.es/';

// URLs adicionales para explorar
const EXTRA_URLS = [
  'https://estadisticascabb.gesdeportiva.es/proximos-partidos',
  'https://competicionescabb.gesdeportiva.es/',
];

async function recon() {
  const browser = await chromium.launch({ headless: false }); // headless:false para ver qué pasa
  const context = await browser.newContext();
  const page = await context.newPage();

  const apiCalls = [];

  // Interceptar TODAS las llamadas de red
  page.on('request', request => {
    const url = request.url();
    const method = request.method();
    const headers = request.headers();
    const postData = request.postData();

    // Guardar solo llamadas que parezcan API (JSON, no assets)
    if (!url.match(/\.(css|js|png|jpg|woff|ico|svg|gif|ttf|eot|map)(\?|$)/)) {
      const call = {
        url,
        method,
        postData: postData || null,
        headers: {
          'content-type': headers['content-type'],
          'authorization': headers['authorization'],
          'x-api-key': headers['x-api-key'],
          // Capturar cualquier header de auth custom
          ...Object.fromEntries(
            Object.entries(headers).filter(([k]) =>
              k.includes('auth') || k.includes('token') || k.includes('key') || k.includes('session')
            )
          )
        },
        timestamp: new Date().toISOString()
      };
      apiCalls.push(call);
      console.log(`[REQUEST] ${method} ${url}`);
    }
  });

  page.on('response', async response => {
    const url = response.url();
    const status = response.status();
    const contentType = response.headers()['content-type'] || '';

    if (contentType.includes('json') || contentType.includes('text/plain')) {
      try {
        const body = await response.text();
        const existing = apiCalls.find(c => c.url === url);
        if (existing) {
          existing.responseStatus = status;
          existing.responseContentType = contentType;
          try {
            existing.responseSample = JSON.parse(body);
          } catch {
            existing.responseSample = body.substring(0, 500);
          }
        }
        console.log(`[RESPONSE] ${status} ${url} (${contentType})`);
      } catch (e) {
        // ignorar errores de lectura
      }
    }
  });

  // ========== Navegar al sitio principal ==========
  console.log('Navegando al portal principal...');
  await page.goto(TARGET_URL, { waitUntil: 'networkidle', timeout: 30000 });

  // Esperar a que cargue todo
  await page.waitForTimeout(3000);

  // Tomar screenshot para ver el estado inicial
  await page.screenshot({ path: 'screenshot_inicio.png', fullPage: true });
  console.log('Screenshot guardado: screenshot_inicio.png');

  // Intentar navegar a secciones: buscar links de torneos, equipos, jugadores
  const links = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('a[href]'))
      .map(a => ({ text: a.textContent.trim(), href: a.href }))
      .filter(l => l.href && !l.href.includes('#') && l.text.length > 0)
      .slice(0, 50);
  });

  console.log('\n=== LINKS ENCONTRADOS EN LA PAGINA ===');
  links.forEach(l => console.log(`  "${l.text}" => ${l.href}`));

  // Si hay menu de torneos/competencias, hacer click para disparar mas llamadas API
  const menuItems = await page.$$('nav a, .menu a, [class*="nav"] a, [class*="menu"] a, ion-item a, ion-button, .toolbar a');
  console.log(`\nEncontrados ${menuItems.length} items de menu`);

  for (let i = 0; i < Math.min(menuItems.length, 10); i++) {
    try {
      await menuItems[i].click();
      await page.waitForTimeout(2000);
      console.log(`Click en item de menu ${i + 1}`);
    } catch (e) { /* ignorar */ }
  }

  await page.waitForTimeout(3000);
  await page.screenshot({ path: 'screenshot_after_nav.png', fullPage: true });

  // ========== Explorar URLs adicionales ==========
  for (const extraUrl of EXTRA_URLS) {
    try {
      console.log(`\nNavegando a: ${extraUrl}`);
      await page.goto(extraUrl, { waitUntil: 'networkidle', timeout: 20000 });
      await page.waitForTimeout(3000);

      const extraLinks = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('a[href]'))
          .map(a => ({ text: a.textContent.trim(), href: a.href }))
          .filter(l => l.href && !l.href.includes('#') && l.text.length > 0)
          .slice(0, 30);
      });
      extraLinks.forEach(l => {
        if (!links.find(existing => existing.href === l.href)) {
          links.push(l);
        }
      });
    } catch (e) {
      console.log(`  Error navegando a ${extraUrl}: ${e.message}`);
    }
  }

  // ========== Extraer info del JS (environment/config) ==========
  console.log('\n=== BUSCANDO CONFIGURACION EN JS ===');
  const jsConfig = await page.evaluate(() => {
    // Buscar variables globales de configuracion
    const config = {};
    if (window.__ENV) config.__ENV = window.__ENV;
    if (window.__CONFIG) config.__CONFIG = window.__CONFIG;
    if (window.environment) config.environment = window.environment;
    if (window.apiUrl) config.apiUrl = window.apiUrl;
    if (window.API_URL) config.API_URL = window.API_URL;
    if (window.BASE_URL) config.BASE_URL = window.BASE_URL;

    // Buscar meta tags con info
    const metas = Array.from(document.querySelectorAll('meta'))
      .map(m => ({ name: m.name || m.getAttribute('property'), content: m.content }))
      .filter(m => m.name && m.content);

    // Buscar scripts inline que contengan URLs de API
    const scripts = Array.from(document.querySelectorAll('script:not([src])'))
      .map(s => s.textContent)
      .filter(t => t.includes('api') || t.includes('http') || t.includes('endpoint'))
      .map(t => t.substring(0, 1000));

    return { config, metas, inlineScripts: scripts };
  });

  console.log('Config encontrada:', JSON.stringify(jsConfig, null, 2));

  // ========== Guardar todo lo capturado ==========
  const report = {
    timestamp: new Date().toISOString(),
    targetUrl: TARGET_URL,
    totalCallsCapturadas: apiCalls.length,
    links,
    jsConfig,
    apiCalls: apiCalls.sort((a, b) => a.url.localeCompare(b.url))
  };

  fs.writeFileSync('recon_report.json', JSON.stringify(report, null, 2));
  console.log(`\n✅ Reporte guardado en recon_report.json`);
  console.log(`Total de llamadas capturadas: ${apiCalls.length}`);

  // Resumen por dominio/path base
  console.log('\n=== RESUMEN DE ENDPOINTS UNICOS ===');
  const uniquePaths = [...new Set(apiCalls.map(c => {
    try {
      const u = new URL(c.url);
      return `${u.hostname}${u.pathname}`;
    } catch { return c.url; }
  }))].sort();
  uniquePaths.forEach(p => console.log(`  ${p}`));

  // Resumen de dominios
  console.log('\n=== DOMINIOS CONTACTADOS ===');
  const domains = [...new Set(apiCalls.map(c => {
    try { return new URL(c.url).hostname; } catch { return 'unknown'; }
  }))].sort();
  domains.forEach(d => console.log(`  ${d}`));

  await browser.close();
}

recon().catch(console.error);
