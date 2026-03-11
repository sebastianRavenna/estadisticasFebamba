/**
 * Playwright Web Portal API Interceptor
 *
 * Opens https://estadisticascabb.gesdeportiva.es/ in a real browser,
 * navigates through competitions/matches/stats, and captures all API
 * requests made by the SPA. This avoids the mobile app's device authentication.
 *
 * Usage: node intercept_web_portal.js
 *
 * Prerequisites: npx playwright install chromium
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const CAPTURED_DIR = path.join(DATA_DIR, 'captured_api');
const PORTAL_URL = 'https://estadisticascabb.gesdeportiva.es';
const DELAY_MS = 2000;

// Track all intercepted API calls
const apiCalls = [];

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function sanitizeFilename(url) {
  return url
    .replace(/https?:\/\//, '')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .substring(0, 120);
}

async function main() {
  console.log('===========================================');
  console.log(' CABB/FEBAMBA Web Portal API Interceptor');
  console.log('===========================================');
  console.log(`Portal: ${PORTAL_URL}`);
  console.log(`Output: ${CAPTURED_DIR}`);
  console.log();

  ensureDir(DATA_DIR);
  ensureDir(CAPTURED_DIR);

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
  });

  const page = await context.newPage();

  // ---- Intercept all network requests ----
  page.on('response', async (response) => {
    const url = response.url();
    const status = response.status();
    const contentType = response.headers()['content-type'] || '';

    // Capture JSON/API responses
    if (contentType.includes('json') || url.includes('.ashx') || url.includes('/api/') || url.includes('/v2/')) {
      try {
        const body = await response.text();
        const entry = {
          url,
          method: response.request().method(),
          status,
          contentType,
          postData: response.request().postData() || null,
          headers: response.request().headers(),
          timestamp: new Date().toISOString(),
          bodyLength: body.length,
        };

        // Try to parse as JSON
        try {
          entry.data = JSON.parse(body);
        } catch {
          entry.rawBody = body.substring(0, 5000);
        }

        apiCalls.push(entry);
        console.log(`  [API] ${response.request().method()} ${url.substring(0, 100)} → ${status} (${body.length} bytes)`);

        // Save individual response
        const filename = `${apiCalls.length.toString().padStart(3, '0')}_${sanitizeFilename(url)}.json`;
        fs.writeFileSync(
          path.join(CAPTURED_DIR, filename),
          JSON.stringify(entry, null, 2),
          'utf8'
        );
      } catch (err) {
        // Response body may not be available for some responses
      }
    }
  });

  // ---- Navigate the portal ----
  try {
    console.log('\n--- Step 1: Loading main page ---');
    await page.goto(PORTAL_URL, { waitUntil: 'networkidle', timeout: 30000 });
    console.log(`  Page loaded: ${page.url()}`);
    await sleep(DELAY_MS);

    // Take a screenshot for debugging
    await page.screenshot({ path: path.join(DATA_DIR, 'portal_main.png') });
    console.log('  Screenshot saved: portal_main.png');

    // ---- Explore the page structure ----
    console.log('\n--- Step 2: Analyzing page structure ---');
    const pageInfo = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a[href]'))
        .map(a => ({ text: a.textContent?.trim(), href: a.href }))
        .filter(l => l.text && l.href);
      const buttons = Array.from(document.querySelectorAll('button, [role="button"], .btn'))
        .map(b => ({ text: b.textContent?.trim(), class: b.className }))
        .filter(b => b.text);
      const selects = Array.from(document.querySelectorAll('select'))
        .map(s => ({
          id: s.id,
          name: s.name,
          options: Array.from(s.options).map(o => ({ value: o.value, text: o.textContent?.trim() }))
        }));
      return { title: document.title, links: links.slice(0, 50), buttons: buttons.slice(0, 20), selects };
    });
    console.log(`  Title: ${pageInfo.title}`);
    console.log(`  Links found: ${pageInfo.links.length}`);
    console.log(`  Buttons found: ${pageInfo.buttons.length}`);
    console.log(`  Selects found: ${pageInfo.selects.length}`);
    fs.writeFileSync(
      path.join(DATA_DIR, 'portal_structure.json'),
      JSON.stringify(pageInfo, null, 2),
      'utf8'
    );

    // ---- Try to navigate to upcoming matches ----
    console.log('\n--- Step 3: Navigating to proximos-partidos ---');
    await page.goto(`${PORTAL_URL}/proximos-partidos`, { waitUntil: 'networkidle', timeout: 30000 });
    await sleep(DELAY_MS);
    await page.screenshot({ path: path.join(DATA_DIR, 'portal_proximos.png') });
    console.log('  proximos-partidos loaded');

    // ---- Try common SPA routes ----
    const routes = [
      '/clasificacion',
      '/competiciones',
      '/estadisticas',
      '/equipos',
      '/partidos',
    ];

    for (const route of routes) {
      console.log(`\n--- Trying route: ${route} ---`);
      try {
        await page.goto(`${PORTAL_URL}${route}`, { waitUntil: 'networkidle', timeout: 15000 });
        await sleep(DELAY_MS);

        const routeInfo = await page.evaluate(() => ({
          url: window.location.href,
          title: document.title,
          bodyText: document.body?.innerText?.substring(0, 500),
        }));
        console.log(`  URL: ${routeInfo.url}`);
        console.log(`  Content preview: ${routeInfo.bodyText?.substring(0, 100)}`);
      } catch (err) {
        console.log(`  Route ${route} failed: ${err.message.substring(0, 100)}`);
      }
    }

    // ---- Click through navigation elements on main page ----
    console.log('\n--- Step 4: Exploring interactive elements ---');
    await page.goto(PORTAL_URL, { waitUntil: 'networkidle', timeout: 30000 });
    await sleep(DELAY_MS);

    // Click on any visible competition/category links
    const clickableElements = await page.$$('a[href*="competicion"], a[href*="categoria"], a[href*="partido"], [class*="competition"], [class*="match"]');
    console.log(`  Clickable competition elements: ${clickableElements.length}`);

    for (let i = 0; i < Math.min(clickableElements.length, 5); i++) {
      try {
        const el = clickableElements[i];
        const text = await el.textContent();
        console.log(`  Clicking: "${text?.trim().substring(0, 50)}"`);
        await el.click();
        await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        await sleep(DELAY_MS);
      } catch (err) {
        console.log(`  Click failed: ${err.message.substring(0, 80)}`);
      }
    }

    // ---- Check for XHR/Fetch patterns in page source ----
    console.log('\n--- Step 5: Extracting API patterns from page source ---');
    const apiPatterns = await page.evaluate(() => {
      const scripts = Array.from(document.querySelectorAll('script[src]'))
        .map(s => s.src);

      // Check for common API base URLs in inline scripts
      const inlineScripts = Array.from(document.querySelectorAll('script:not([src])'))
        .map(s => s.textContent)
        .join('\n');

      const urlPatterns = [];
      const urlRegex = /https?:\/\/[^\s'"]+(?:api|ashx|json|v2|datos|estadisticas)[^\s'"]*/gi;
      let match;
      while ((match = urlRegex.exec(inlineScripts)) !== null) {
        urlPatterns.push(match[0]);
      }

      // Also check for fetch/XMLHttpRequest patterns
      const fetchPatterns = inlineScripts.match(/fetch\s*\(\s*['"][^'"]+['"]/g) || [];
      const xhrPatterns = inlineScripts.match(/\.open\s*\(\s*['"][^'"]+['"]\s*,\s*['"][^'"]+['"]/g) || [];

      return {
        externalScripts: scripts,
        apiUrls: [...new Set(urlPatterns)],
        fetchCalls: fetchPatterns.slice(0, 20),
        xhrCalls: xhrPatterns.slice(0, 20),
      };
    });
    console.log(`  External scripts: ${apiPatterns.externalScripts.length}`);
    console.log(`  API URLs found: ${apiPatterns.apiUrls.length}`);
    apiPatterns.apiUrls.forEach(u => console.log(`    ${u}`));
    apiPatterns.fetchCalls.forEach(f => console.log(`    fetch: ${f}`));
    fs.writeFileSync(
      path.join(DATA_DIR, 'portal_api_patterns.json'),
      JSON.stringify(apiPatterns, null, 2),
      'utf8'
    );

    // ---- Also try to read the main JS bundle for API endpoints ----
    console.log('\n--- Step 6: Analyzing JS bundles ---');
    for (const scriptUrl of apiPatterns.externalScripts.slice(0, 5)) {
      if (scriptUrl.includes('chunk') || scriptUrl.includes('main') || scriptUrl.includes('app')) {
        console.log(`  Fetching: ${scriptUrl.substring(0, 80)}`);
        try {
          const scriptResp = await page.evaluate(async (url) => {
            const resp = await fetch(url);
            const text = await resp.text();
            return text.substring(0, 50000); // First 50KB
          }, scriptUrl);

          // Extract API endpoints from script
          const endpoints = [];
          const endpointRegex = /['"`]((?:https?:\/\/[^'"`]+)?(?:\/api\/|\.ashx|\/v\d\/)[^'"`]*)['"` ]/gi;
          let m;
          while ((m = endpointRegex.exec(scriptResp)) !== null) {
            endpoints.push(m[1]);
          }

          // Also look for base URL patterns
          const baseUrls = [];
          const baseRegex = /(?:baseUrl|apiUrl|API_URL|endpoint|BASE)\s*[:=]\s*['"`]([^'"`]+)['"` ]/gi;
          while ((m = baseRegex.exec(scriptResp)) !== null) {
            baseUrls.push(m[1]);
          }

          if (endpoints.length || baseUrls.length) {
            console.log(`    Found ${endpoints.length} endpoints, ${baseUrls.length} base URLs`);
            endpoints.forEach(e => console.log(`      endpoint: ${e}`));
            baseUrls.forEach(b => console.log(`      base: ${b}`));
          }
        } catch (err) {
          console.log(`    Error: ${err.message.substring(0, 80)}`);
        }
      }
    }

  } catch (err) {
    console.error(`\nNavigation error: ${err.message}`);
  }

  // ---- Save summary ----
  console.log('\n===========================================');
  console.log(' Summary');
  console.log('===========================================');
  console.log(`Total API calls intercepted: ${apiCalls.length}`);

  const summary = {
    timestamp: new Date().toISOString(),
    portalUrl: PORTAL_URL,
    totalApiCalls: apiCalls.length,
    uniqueEndpoints: [...new Set(apiCalls.map(c => new URL(c.url).pathname))],
    calls: apiCalls.map(c => ({
      method: c.method,
      url: c.url,
      status: c.status,
      postData: c.postData,
      bodyLength: c.bodyLength,
    })),
  };

  fs.writeFileSync(
    path.join(DATA_DIR, 'intercepted_api_summary.json'),
    JSON.stringify(summary, null, 2),
    'utf8'
  );

  console.log(`\nUnique endpoints:`);
  summary.uniqueEndpoints.forEach(e => console.log(`  ${e}`));

  console.log(`\nFiles saved to: ${CAPTURED_DIR}/`);
  if (fs.existsSync(CAPTURED_DIR)) {
    const files = fs.readdirSync(CAPTURED_DIR);
    console.log(`Total captured files: ${files.length}`);
  }

  await browser.close();
  console.log('\nDone!');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
