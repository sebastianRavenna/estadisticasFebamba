/**
 * Recon API Probe - Script alternativo sin Playwright
 *
 * Este script prueba endpoints comunes de la API de Gesdeportiva
 * usando fetch nativo de Node.js (v18+). No necesita browser.
 *
 * Uso: node recon_api_probe.js
 */

const fs = require('fs');
const https = require('https');

// ======================== CONFIGURACION ========================

// Dominios conocidos de Gesdeportiva para CABB/FEBAMBA
const DOMAINS = [
  'estadisticascabb.gesdeportiva.es',
  'competicionescabb.gesdeportiva.es',
  // Posibles subdominios FEBAMBA (a probar)
  'estadisticasfebamba.gesdeportiva.es',
  'competicionesfebamba.gesdeportiva.es',
  'febamba.gesdeportiva.es',
  // API dedicada (posible)
  'api.gesdeportiva.es',
  'apicabb.gesdeportiva.es',
  // CABB custom domain
  'gesdeportiva.cabb.com.ar',
];

// Endpoints comunes en SPAs de gestion deportiva (Angular/Ionic)
const API_PATHS = [
  // Raiz y configuracion
  '/',
  '/api/',
  '/api/v1/',
  '/api/v2/',
  '/rest/',
  '/ws/',
  '/services/',
  '/robots.txt',
  '/assets/config.json',
  '/assets/environment.json',
  '/config.json',

  // Competiciones / Torneos
  '/api/competiciones',
  '/api/competicion',
  '/api/torneos',
  '/api/temporadas',
  '/api/categorias',
  '/api/fases',
  '/api/grupos',
  '/api/jornadas',

  // Equipos
  '/api/equipos',
  '/api/clubs',
  '/api/delegaciones',

  // Jugadores
  '/api/jugadores',
  '/api/personas',
  '/api/fichas',
  '/api/licencias',

  // Partidos
  '/api/partidos',
  '/api/encuentros',
  '/api/resultados',
  '/api/proximos-partidos',
  '/api/calendario',

  // Estadisticas
  '/api/estadisticas',
  '/api/stats',
  '/api/clasificacion',
  '/api/posiciones',
  '/api/ranking',
  '/api/lideres',

  // Acta digital / Live
  '/api/acta',
  '/api/live',
  '/api/envivo',
  '/api/playbyplay',

  // Patrones ASP.NET (por el portal de competiciones)
  '/competicion.aspx',
  '/equipo.aspx',
  '/partido.aspx',
  '/jugador.aspx',
  '/clasificacion.aspx',
  '/calendario.aspx',

  // Patrones REST con IDs de prueba
  '/api/competiciones/1',
  '/api/competiciones/1623',  // ID encontrado en URLs indexadas
  '/api/grupos/8459',         // ID encontrado en URLs indexadas
  '/api/equipos/73276',       // ID encontrado en URLs indexadas
  '/api/partidos/292664',     // ID encontrado en URLs indexadas
  '/api/partidos/143121',     // ID encontrado en URLs indexadas
  '/api/delegaciones/1',      // FEBAMBA podria ser delegacion 1

  // Patrones comunes de Angular/Ionic apps
  '/ngsw.json',               // Angular Service Worker manifest
  '/manifest.json',
  '/index.html',
];

// Headers comunes para simular la app/browser
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'es-AR,es;q=0.9,en;q=0.8',
  'Origin': 'https://estadisticascabb.gesdeportiva.es',
  'Referer': 'https://estadisticascabb.gesdeportiva.es/',
};

// ======================== FUNCIONES ========================

async function fetchUrl(url, timeout = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      headers: HEADERS,
      signal: controller.signal,
      redirect: 'follow',
    });

    const contentType = response.headers.get('content-type') || '';
    let body = null;

    if (contentType.includes('json') || contentType.includes('text')) {
      const text = await response.text();
      try {
        body = JSON.parse(text);
      } catch {
        body = text.substring(0, 2000);
      }
    }

    return {
      url,
      status: response.status,
      contentType,
      redirected: response.redirected,
      finalUrl: response.url,
      headers: Object.fromEntries(response.headers.entries()),
      body,
    };
  } catch (error) {
    return {
      url,
      error: error.message || error.code || 'Unknown error',
    };
  } finally {
    clearTimeout(timer);
  }
}

async function probeDomain(domain) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`PROBANDO DOMINIO: ${domain}`);
  console.log('='.repeat(60));

  const results = [];

  // Primero probar si el dominio responde
  const rootResult = await fetchUrl(`https://${domain}/`);
  if (rootResult.error) {
    console.log(`  ❌ Dominio no accesible: ${rootResult.error}`);
    return { domain, accessible: false, error: rootResult.error, endpoints: [] };
  }

  console.log(`  ✅ Dominio accesible (${rootResult.status})`);
  results.push(rootResult);

  // Probar todos los endpoints
  for (const path of API_PATHS) {
    if (path === '/') continue; // Ya probamos la raiz
    const url = `https://${domain}${path}`;
    process.stdout.write(`  Probando ${path}... `);

    const result = await fetchUrl(url);

    if (result.error) {
      console.log(`❌ ${result.error}`);
    } else if (result.status === 200) {
      console.log(`✅ ${result.status} (${result.contentType})`);
      results.push(result);
    } else if (result.status === 401 || result.status === 403) {
      console.log(`🔒 ${result.status} (requiere auth)`);
      results.push(result);
    } else if (result.status === 301 || result.status === 302) {
      console.log(`↪️  ${result.status} -> ${result.finalUrl}`);
      results.push(result);
    } else {
      console.log(`⚠️  ${result.status}`);
      if (result.status !== 404) results.push(result);
    }
  }

  return {
    domain,
    accessible: true,
    rootStatus: rootResult.status,
    endpoints: results,
  };
}

// ======================== MAIN ========================

async function main() {
  console.log('🔍 Gesdeportiva API Probe - Reconocimiento de Endpoints');
  console.log(`Fecha: ${new Date().toISOString()}`);
  console.log(`Dominios a probar: ${DOMAINS.length}`);
  console.log(`Paths a probar por dominio: ${API_PATHS.length}`);
  console.log('');

  const allResults = [];

  for (const domain of DOMAINS) {
    const result = await probeDomain(domain);
    allResults.push(result);
  }

  // ========== Analizar HTML del portal principal ==========
  console.log('\n' + '='.repeat(60));
  console.log('ANALIZANDO HTML DEL PORTAL PRINCIPAL');
  console.log('='.repeat(60));

  const mainPage = await fetchUrl('https://estadisticascabb.gesdeportiva.es/', 15000);
  let htmlAnalysis = null;

  if (mainPage.body && typeof mainPage.body === 'string') {
    const html = mainPage.body;

    // Extraer script tags
    const scriptSrcs = [...html.matchAll(/<script[^>]*src=["']([^"']+)["']/gi)]
      .map(m => m[1]);

    // Extraer URLs en el HTML
    const urls = [...html.matchAll(/https?:\/\/[^\s"'<>]+/gi)]
      .map(m => m[0]);

    // Extraer meta tags
    const metas = [...html.matchAll(/<meta[^>]*(?:name|property)=["']([^"']+)["'][^>]*content=["']([^"']+)["']/gi)]
      .map(m => ({ name: m[1], content: m[2] }));

    htmlAnalysis = { scriptSrcs, urls: [...new Set(urls)], metas };

    console.log(`  Scripts encontrados: ${scriptSrcs.length}`);
    scriptSrcs.forEach(s => console.log(`    📜 ${s}`));

    console.log(`  URLs encontradas: ${urls.length}`);
    [...new Set(urls)].forEach(u => console.log(`    🔗 ${u}`));

    // Intentar descargar y analizar los JS principales
    for (const src of scriptSrcs) {
      const jsUrl = src.startsWith('http') ? src : `https://estadisticascabb.gesdeportiva.es${src}`;
      console.log(`\n  Descargando JS: ${jsUrl}`);
      const jsResult = await fetchUrl(jsUrl, 15000);
      if (jsResult.body && typeof jsResult.body === 'string') {
        // Buscar URLs/endpoints dentro del JS
        const apiUrls = [...jsResult.body.matchAll(/["']((?:https?:\/\/|\/api\/|\/rest\/|\/services\/|\/ws\/)[^\s"']+)["']/g)]
          .map(m => m[1]);
        const baseUrls = [...jsResult.body.matchAll(/(?:baseUrl|apiUrl|API_URL|BASE_URL|endpoint|serviceUrl)\s*[:=]\s*["']([^"']+)["']/gi)]
          .map(m => m[1]);
        const envConfig = [...jsResult.body.matchAll(/environment\s*[:=]\s*\{[^}]+\}/g)]
          .map(m => m[0]);

        if (apiUrls.length > 0 || baseUrls.length > 0 || envConfig.length > 0) {
          console.log(`    ✅ Encontrados en ${src}:`);
          if (apiUrls.length) console.log(`      API URLs: ${JSON.stringify([...new Set(apiUrls)])}`);
          if (baseUrls.length) console.log(`      Base URLs: ${JSON.stringify(baseUrls)}`);
          if (envConfig.length) console.log(`      Env Config: ${envConfig.join('\n')}`);

          if (!htmlAnalysis.jsEndpoints) htmlAnalysis.jsEndpoints = [];
          htmlAnalysis.jsEndpoints.push({
            file: src,
            apiUrls: [...new Set(apiUrls)],
            baseUrls,
            envConfig,
          });
        }
      }
    }
  }

  // ========== Generar reporte ==========
  const report = {
    timestamp: new Date().toISOString(),
    summary: {
      totalDomainsTested: DOMAINS.length,
      accessibleDomains: allResults.filter(r => r.accessible).length,
      totalEndpointsFound: allResults.reduce((sum, r) => sum + r.endpoints.length, 0),
    },
    htmlAnalysis,
    domains: allResults,
  };

  // Resumen
  console.log('\n' + '='.repeat(60));
  console.log('RESUMEN');
  console.log('='.repeat(60));
  console.log(`Dominios probados: ${report.summary.totalDomainsTested}`);
  console.log(`Dominios accesibles: ${report.summary.accessibleDomains}`);
  console.log(`Endpoints encontrados: ${report.summary.totalEndpointsFound}`);

  // Endpoints con status 200
  const successEndpoints = allResults
    .flatMap(r => r.endpoints)
    .filter(e => e.status === 200);
  console.log(`\nEndpoints con respuesta exitosa (200):`);
  successEndpoints.forEach(e => console.log(`  ✅ ${e.url} (${e.contentType})`));

  // Endpoints con auth
  const authEndpoints = allResults
    .flatMap(r => r.endpoints)
    .filter(e => e.status === 401 || e.status === 403);
  console.log(`\nEndpoints que requieren auth (401/403):`);
  authEndpoints.forEach(e => console.log(`  🔒 ${e.url}`));

  // Guardar
  fs.writeFileSync('recon_report.json', JSON.stringify(report, null, 2));
  console.log(`\n✅ Reporte guardado en recon_report.json`);
}

main().catch(console.error);
