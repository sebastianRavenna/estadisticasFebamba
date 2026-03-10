const { chromium } = require('playwright');
const fs = require('fs');

const TARGETS = [
  'https://estadisticascabb.gesdeportiva.es/',
  'https://competicionescabb.gesdeportiva.es/',
  'https://competicionescabb.gesdeportiva.es/competicion.aspx?grupo=8459',
  'https://competicionescabb.gesdeportiva.es/equipo.aspx?origen=competicion&equipo=73276&grupoEquipo=29628&delegacion=1&competicion=1623',
];

async function recon() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  const allRequests = [];
  const jsFiles = [];
  const apiCalls = [];

  // Capturar TODAS las llamadas (incluyendo JS para analizar bundles)
  page.on('request', request => {
    const url = request.url();
    const method = request.method();
    const headers = request.headers();

    allRequests.push({
      url,
      method,
      contentType: headers['content-type'] || '',
      timestamp: new Date().toISOString()
    });
  });

  page.on('response', async response => {
    const url = response.url();
    const status = response.status();
    const contentType = response.headers()['content-type'] || '';

    // Capturar responses JSON (son las API calls)
    if (contentType.includes('json') || contentType.includes('xml')) {
      try {
        const body = await response.text();
        let parsed = null;
        try { parsed = JSON.parse(body); } catch {}
        apiCalls.push({
          url, status, contentType, method: 'GET',
          body: parsed || body.substring(0, 3000),
          timestamp: new Date().toISOString()
        });
        console.log(`[API] ${status} ${url}`);
      } catch {}
    }

    // Capturar archivos JS para analizar endpoints hardcodeados
    if (url.endsWith('.js') || contentType.includes('javascript')) {
      try {
        const body = await response.text();
        jsFiles.push({ url, size: body.length, content: body });
        console.log(`[JS] ${url} (${(body.length / 1024).toFixed(0)}KB)`);
      } catch {}
    }
  });

  const allLinks = [];
  const screenshots = [];

  // ========== Navegar a cada target ==========
  for (let i = 0; i < TARGETS.length; i++) {
    const target = TARGETS[i];
    console.log(`\n${'='.repeat(60)}`);
    console.log(`NAVEGANDO [${i + 1}/${TARGETS.length}]: ${target}`);
    console.log('='.repeat(60));

    try {
      await page.goto(target, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(5000); // esperar mas para SPAs lentas

      const screenshotPath = `screenshot_${i + 1}.png`;
      await page.screenshot({ path: screenshotPath, fullPage: true });
      screenshots.push(screenshotPath);
      console.log(`Screenshot: ${screenshotPath}`);

      // Extraer links
      const links = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('a[href]'))
          .map(a => ({ text: a.textContent.trim(), href: a.href }))
          .filter(l => l.href && l.text.length > 0);
      });
      console.log(`Links encontrados: ${links.length}`);
      links.forEach(l => {
        if (!allLinks.find(x => x.href === l.href)) {
          allLinks.push({ ...l, foundOn: target });
        }
      });

      // Extraer el HTML para analisis
      const html = await page.content();
      const htmlPath = `page_${i + 1}.html`;
      fs.writeFileSync(htmlPath, html);
      console.log(`HTML guardado: ${htmlPath}`);

      // Intentar hacer click en links internos para disparar mas API calls
      const navLinks = await page.$$('a[href*="competicion"], a[href*="equipo"], a[href*="partido"], a[href*="jugador"], a[href*="clasificacion"], a[href*="calendario"], nav a, .menu a');
      console.log(`Links de navegacion encontrados: ${navLinks.length}`);

      for (let j = 0; j < Math.min(navLinks.length, 5); j++) {
        try {
          const href = await navLinks[j].getAttribute('href');
          console.log(`  Click [${j + 1}]: ${href}`);
          await navLinks[j].click();
          await page.waitForTimeout(3000);
        } catch {}
      }
    } catch (e) {
      console.log(`ERROR: ${e.message}`);
    }
  }

  // ========== Analizar JS bundles buscando endpoints ==========
  console.log(`\n${'='.repeat(60)}`);
  console.log('ANALIZANDO JS BUNDLES');
  console.log('='.repeat(60));

  const jsAnalysis = [];
  for (const js of jsFiles) {
    const findings = {
      file: js.url,
      sizeKB: (js.size / 1024).toFixed(0),
      apiUrls: [],
      baseUrls: [],
      envConfig: [],
      httpEndpoints: [],
      interestingStrings: []
    };

    // Buscar URLs de API
    const urlMatches = js.content.match(/["'`](https?:\/\/[^"'`\s]{10,})["'`]/g) || [];
    findings.apiUrls = [...new Set(urlMatches.map(m => m.slice(1, -1)))];

    // Buscar baseUrl, apiUrl, etc
    const baseMatches = js.content.match(/(?:baseUrl|apiUrl|API_URL|BASE_URL|apiBase|serverUrl|endpoint|serviceUrl|urlBase|host)\s*[:=]\s*["'`]([^"'`]+)["'`]/gi) || [];
    findings.baseUrls = [...new Set(baseMatches)];

    // Buscar patrones de endpoints HTTP (get/post/put/delete + ruta)
    const httpMatches = js.content.match(/(?:\.get|\.post|\.put|\.delete|\.patch|\.request)\s*\(\s*["'`]([^"'`]+)["'`]/g) || [];
    findings.httpEndpoints = [...new Set(httpMatches)];

    // Buscar strings que parezcan rutas de API
    const pathMatches = js.content.match(/["'`](\/api\/[^"'`\s]+)["'`]/g) || [];
    const restMatches = js.content.match(/["'`](\/rest\/[^"'`\s]+)["'`]/g) || [];
    const wsMatches = js.content.match(/["'`](\/ws\/[^"'`\s]+)["'`]/g) || [];
    const serviceMatches = js.content.match(/["'`](\/services\/[^"'`\s]+)["'`]/g) || [];
    findings.interestingStrings = [...new Set([...pathMatches || [], ...restMatches || [], ...wsMatches || [], ...serviceMatches || []])];

    // Buscar environment config
    const envMatches = js.content.match(/environment\s*[:=]\s*\{[^}]{0,500}\}/g) || [];
    findings.envConfig = envMatches;

    // Buscar nombres de entidad (competicion, partido, equipo, etc)
    const entityMatches = js.content.match(/["'`](competicion|partido|equipo|jugador|estadistica|clasificacion|jornada|temporada|delegacion|categoria|grupo|calendario|acta|arbitro)[es]*["'`]/gi) || [];
    findings.entities = [...new Set(entityMatches.map(m => m.slice(1, -1).toLowerCase()))];

    if (findings.apiUrls.length || findings.baseUrls.length || findings.httpEndpoints.length || findings.interestingStrings.length || findings.envConfig.length) {
      jsAnalysis.push(findings);
      console.log(`\n📦 ${js.url} (${findings.sizeKB}KB):`);
      if (findings.apiUrls.length) console.log(`  URLs: ${JSON.stringify(findings.apiUrls.slice(0, 10))}`);
      if (findings.baseUrls.length) console.log(`  Base URLs: ${JSON.stringify(findings.baseUrls)}`);
      if (findings.httpEndpoints.length) console.log(`  HTTP calls: ${JSON.stringify(findings.httpEndpoints.slice(0, 20))}`);
      if (findings.interestingStrings.length) console.log(`  API paths: ${JSON.stringify(findings.interestingStrings)}`);
      if (findings.envConfig.length) console.log(`  Env config: ${JSON.stringify(findings.envConfig)}`);
      if (findings.entities && findings.entities.length) console.log(`  Entities: ${JSON.stringify(findings.entities)}`);
    }
  }

  // ========== Generar reporte ==========
  const report = {
    timestamp: new Date().toISOString(),
    targets: TARGETS,
    summary: {
      totalRequests: allRequests.length,
      totalApiCalls: apiCalls.length,
      totalJsFiles: jsFiles.length,
      totalLinks: allLinks.length,
      screenshots,
    },
    apiCalls,
    jsAnalysis,
    links: allLinks,
    allRequestUrls: [...new Set(allRequests.map(r => r.url))].sort(),
  };

  fs.writeFileSync('recon_report.json', JSON.stringify(report, null, 2));
  console.log(`\n✅ Reporte guardado: recon_report.json`);
  console.log(`   Requests totales: ${allRequests.length}`);
  console.log(`   API calls con body: ${apiCalls.length}`);
  console.log(`   JS files analizados: ${jsFiles.length}`);
  console.log(`   Links encontrados: ${allLinks.length}`);

  // Resumen de dominios
  const domains = [...new Set(allRequests.map(r => {
    try { return new URL(r.url).hostname; } catch { return 'unknown'; }
  }))].sort();
  console.log(`\nDominios contactados:`);
  domains.forEach(d => console.log(`  - ${d}`));

  await browser.close();
}

recon().catch(console.error);
