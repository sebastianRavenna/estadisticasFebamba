/**
 * Fase APK - Extraer endpoints de la app móvil Afición CABB
 * La app puede usar endpoints distintos al portal web que sí estén funcionando
 *
 * Estrategia:
 * 1. Descargar la APK de "Afición CABB"
 * 2. Descomprimir y buscar JS/JSON con URLs hardcodeadas
 * 3. Probar cada endpoint encontrado
 */

const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');

const APK_DIR = path.join(__dirname, 'apk_extracted');

// ============================================================
// PASO 1: Descargar APK
// ============================================================
async function downloadAPK() {
  console.log('📱 PASO 1: Descargar APK de Afición CABB');
  console.log('='.repeat(60));

  // Intentar con apkeep
  try {
    console.log('Intentando con apkeep...');
    execSync('which apkeep || curl -Lo apkeep https://github.com/EFForg/apkeep/releases/latest/download/apkeep-x86_64-unknown-linux-gnu && chmod +x apkeep', {
      stdio: 'inherit', timeout: 30000
    });
    execSync('./apkeep -a com.indalweb.aficionCABB .', { stdio: 'inherit', timeout: 60000 });
    return true;
  } catch (e) {
    console.log('apkeep falló, intentando alternativas...');
  }

  // Alternativa: usar google play api informal
  const altUrls = [
    'https://d.apkpure.com/b/APK/com.indalweb.aficionCABB',
    'https://apkcombo.com/apk-downloader/?package=com.indalweb.aficionCABB',
  ];

  console.log('\n⚠️  Descarga automática falló.');
  console.log('Opciones manuales:');
  console.log('1. Descargar desde: https://apkpure.com/aficion-cabb/com.indalweb.aficionCABB');
  console.log('2. O desde: https://apkcombo.com/aficion-cabb/com.indalweb.aficionCABB/');
  console.log('3. Guardar el .apk en este directorio');
  console.log('4. Luego correr: node apk_recon.js --extract\n');

  return false;
}

// ============================================================
// PASO 2: Extraer y analizar APK
// ============================================================
async function extractAPK() {
  console.log('\n📦 PASO 2: Extraer y analizar APK');
  console.log('='.repeat(60));

  // Buscar el APK
  const apkFiles = fs.readdirSync('.').filter(f => f.endsWith('.apk'));
  if (apkFiles.length === 0) {
    // Buscar XAPKs también
    const xapkFiles = fs.readdirSync('.').filter(f => f.endsWith('.xapk'));
    if (xapkFiles.length > 0) {
      console.log(`Encontrado XAPK: ${xapkFiles[0]} — es un ZIP, extrayendo...`);
      execSync(`unzip -o "${xapkFiles[0]}" -d xapk_temp/`, { stdio: 'inherit' });
      // Dentro del XAPK hay APKs
      const innerApks = fs.readdirSync('xapk_temp').filter(f => f.endsWith('.apk'));
      if (innerApks.length > 0) {
        fs.copyFileSync(`xapk_temp/${innerApks[0]}`, 'aficion_cabb.apk');
        console.log(`Extraído: aficion_cabb.apk`);
      }
    } else {
      console.log('❌ No se encontró ningún APK. Descargalo primero.');
      return null;
    }
  }

  const apkFile = fs.readdirSync('.').filter(f => f.endsWith('.apk'))[0];
  if (!apkFile) { console.log('❌ No APK found'); return null; }

  console.log(`Extrayendo: ${apkFile}`);

  // Crear directorio y extraer
  if (!fs.existsSync(APK_DIR)) fs.mkdirSync(APK_DIR, { recursive: true });
  execSync(`unzip -o "${apkFile}" -d "${APK_DIR}"`, { stdio: 'inherit' });

  return APK_DIR;
}

// ============================================================
// PASO 3: Buscar endpoints en los archivos extraídos
// ============================================================
async function findEndpoints(extractDir) {
  console.log('\n🔍 PASO 3: Buscar endpoints y configuración');
  console.log('='.repeat(60));

  const findings = {
    urls: [],
    apiEndpoints: [],
    configs: [],
    interestingFiles: []
  };

  // Patrones a buscar
  const urlPattern = /https?:\/\/[^\s"'<>{}\\)]+gesdeportiva[^\s"'<>{}\\)]*/g;
  const apiPattern = /https?:\/\/[^\s"'<>{}\\)]+\/api\/[^\s"'<>{}\\)]*/g;
  const baseUrlPattern = /(?:baseUrl|apiUrl|API_URL|BASE_URL|serverUrl|urlBase|apiBase|endpoint|host)\s*[:=]\s*["'`]([^"'`]+)["'`]/gi;
  const genericUrlPattern = /https?:\/\/[^\s"'<>{}\\)]{10,}/g;

  function searchFile(filepath) {
    try {
      const content = fs.readFileSync(filepath, 'utf-8');

      // URLs de gesdeportiva
      const urls = content.match(urlPattern) || [];
      urls.forEach(u => {
        if (!findings.urls.includes(u)) findings.urls.push(u);
      });

      // Endpoints de API
      const apis = content.match(apiPattern) || [];
      apis.forEach(u => {
        if (!findings.apiEndpoints.includes(u)) findings.apiEndpoints.push(u);
      });

      // BaseURL configs
      let match;
      while ((match = baseUrlPattern.exec(content)) !== null) {
        findings.configs.push({ file: filepath, match: match[0], value: match[1] });
      }

      // Si tiene URLs interesantes, guardar el archivo
      if (urls.length > 0 || apis.length > 0) {
        findings.interestingFiles.push({
          file: filepath,
          urlCount: urls.length,
          apiCount: apis.length,
          sample: (urls.concat(apis)).slice(0, 5)
        });
      }

      return urls.length + apis.length;
    } catch {
      return 0; // Binary file o error
    }
  }

  // Buscar en todo el directorio extraído
  function walkDir(dir) {
    let total = 0;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          // Buscar en subdirectorios (especialmente assets/www para Ionic/Cordova)
          total += walkDir(fullPath);
        } else {
          const ext = path.extname(entry.name).toLowerCase();
          // Buscar en archivos de texto y JS
          if (['.js', '.json', '.xml', '.html', '.ts', '.properties', '.cfg', '.txt', '.yml', '.yaml', '.env', '.config'].includes(ext)
              || entry.name === 'strings.xml'
              || entry.name.startsWith('index')) {
            const found = searchFile(fullPath);
            if (found > 0) {
              console.log(`  📄 ${fullPath} — ${found} URLs encontradas`);
            }
            total += found;
          }
        }
      }
    } catch {}
    return total;
  }

  const totalFound = walkDir(extractDir);
  console.log(`\nTotal URLs encontradas: ${totalFound}`);

  // Buscar también en archivos .dex (strings del bytecode)
  console.log('\n🔍 Buscando strings en archivos DEX...');
  try {
    const dexFiles = fs.readdirSync(extractDir).filter(f => f.endsWith('.dex'));
    for (const dex of dexFiles) {
      const dexPath = path.join(extractDir, dex);
      try {
        // strings del binario
        const strings = execSync(`strings "${dexPath}" | grep -i "gesdeportiva\\|api\\|estadistica\\|competicion\\|indalweb" | sort -u`, {
          encoding: 'utf-8', timeout: 30000
        });
        if (strings.trim()) {
          console.log(`  DEX ${dex}:`);
          strings.split('\n').filter(s => s.trim()).forEach(s => {
            console.log(`    ${s}`);
            if (s.includes('http')) findings.urls.push(s.trim());
          });
        }
      } catch {}
    }
  } catch {}

  // Deduplicar
  findings.urls = [...new Set(findings.urls)].sort();
  findings.apiEndpoints = [...new Set(findings.apiEndpoints)].sort();

  return findings;
}

// ============================================================
// PASO 4: Probar los endpoints encontrados
// ============================================================
async function testEndpoints(endpoints) {
  console.log('\n🧪 PASO 4: Probar endpoints encontrados');
  console.log('='.repeat(60));

  const results = [];

  for (const url of endpoints) {
    try {
      console.log(`  Testing: ${url}`);
      const resp = await fetch(url, {
        headers: {
          'User-Agent': 'AficionCABB/1.0 (Android)',
          'Accept': 'application/json, text/plain, */*'
        },
        signal: AbortSignal.timeout(10000)
      });

      const contentType = resp.headers.get('content-type') || '';
      let body = null;
      try {
        body = await resp.text();
        if (body.length > 2000) body = body.substring(0, 2000) + '...';
      } catch {}

      const result = {
        url,
        status: resp.status,
        contentType,
        bodyPreview: body,
        isJson: contentType.includes('json'),
        isWorking: resp.status === 200
      };

      results.push(result);
      const emoji = result.isWorking ? '✅' : '❌';
      console.log(`    ${emoji} ${resp.status} ${contentType}`);
      if (result.isJson && body) {
        console.log(`    Response: ${body.substring(0, 200)}`);
      }
    } catch (e) {
      results.push({ url, error: e.message, isWorking: false });
      console.log(`    ❌ Error: ${e.message}`);
    }
  }

  return results;
}

// ============================================================
// PASO 5: Probar endpoints hipotéticos de la API
// ============================================================
async function probeHypotheticalEndpoints() {
  console.log('\n🎯 PASO 5: Probar endpoints hipotéticos');
  console.log('='.repeat(60));

  // Basados en patrones de Gesdeportiva y la app
  const candidates = [
    // API del portal de estadísticas
    'https://estadisticascabb.gesdeportiva.es/api/delegaciones',
    'https://estadisticascabb.gesdeportiva.es/api/competiciones',
    'https://estadisticascabb.gesdeportiva.es/api/temporadas',
    'https://estadisticascabb.gesdeportiva.es/api/proximos-partidos',
    'https://estadisticascabb.gesdeportiva.es/api/categorias',

    // Variantes con subdominios
    'https://apicabb.gesdeportiva.es/',
    'https://apicabb.gesdeportiva.es/api/v1/delegaciones',
    'https://api.gesdeportiva.es/cabb/',
    'https://api.gesdeportiva.es/api/v1/delegaciones',

    // Variantes FEBAMBA específicas
    'https://estadisticasfebamba.gesdeportiva.es/',
    'https://competicionesfebamba.gesdeportiva.es/',
    'https://apifebamba.gesdeportiva.es/',

    // Posibles paths del portal de estadísticas (Angular routes)
    'https://estadisticascabb.gesdeportiva.es/es/',
    'https://estadisticascabb.gesdeportiva.es/assets/config.json',
    'https://estadisticascabb.gesdeportiva.es/assets/i18n/es.json',
    'https://estadisticascabb.gesdeportiva.es/assets/environment.json',
    'https://estadisticascabb.gesdeportiva.es/main.js',
    'https://estadisticascabb.gesdeportiva.es/ngsw.json',
    'https://estadisticascabb.gesdeportiva.es/manifest.json',
    'https://estadisticascabb.gesdeportiva.es/manifest.webmanifest',

    // WS / REST patterns
    'https://competicionescabb.gesdeportiva.es/api/',
    'https://competicionescabb.gesdeportiva.es/rest/',
    'https://competicionescabb.gesdeportiva.es/services/',
    'https://competicionescabb.gesdeportiva.es/ws/',

    // Portal CABB custom domain
    'https://gesdeportiva.cabb.com.ar/',
    'https://gesdeportiva.cabb.com.ar/api/',
    'https://gesdeportiva.cabb.com.ar/clubes/',
  ];

  return await testEndpoints(candidates);
}

// ============================================================
// MAIN
// ============================================================
async function main() {
  const args = process.argv.slice(2);
  const skipDownload = args.includes('--extract') || args.includes('--probe-only');
  const probeOnly = args.includes('--probe-only');

  const report = {
    timestamp: new Date().toISOString(),
    apkFindings: null,
    endpointTests: null,
    hypotheticalTests: null,
    workingEndpoints: []
  };

  if (!probeOnly) {
    // Descargar APK si no existe
    const apkExists = fs.readdirSync('.').some(f => f.endsWith('.apk') || f.endsWith('.xapk'));
    if (!apkExists && !skipDownload) {
      await downloadAPK();
    }

    // Extraer y analizar
    const extractDir = await extractAPK();
    if (extractDir) {
      report.apkFindings = await findEndpoints(extractDir);

      console.log('\n' + '='.repeat(60));
      console.log('📊 RESUMEN DE HALLAZGOS EN LA APK');
      console.log('='.repeat(60));
      console.log(`  URLs de Gesdeportiva: ${report.apkFindings.urls.length}`);
      report.apkFindings.urls.forEach(u => console.log(`    ${u}`));
      console.log(`  Endpoints de API: ${report.apkFindings.apiEndpoints.length}`);
      report.apkFindings.apiEndpoints.forEach(u => console.log(`    ${u}`));
      console.log(`  Configuraciones: ${report.apkFindings.configs.length}`);
      report.apkFindings.configs.forEach(c => console.log(`    ${c.match}`));

      // Probar las URLs encontradas
      const allUrls = [...report.apkFindings.urls, ...report.apkFindings.apiEndpoints];
      if (allUrls.length > 0) {
        report.endpointTests = await testEndpoints(allUrls);
      }
    }
  }

  // Siempre probar endpoints hipotéticos
  report.hypotheticalTests = await probeHypotheticalEndpoints();

  // Resumen final
  const allTests = [...(report.endpointTests || []), ...(report.hypotheticalTests || [])];
  report.workingEndpoints = allTests.filter(t => t.isWorking);

  console.log('\n' + '='.repeat(60));
  console.log('🏆 ENDPOINTS QUE FUNCIONAN');
  console.log('='.repeat(60));

  if (report.workingEndpoints.length === 0) {
    console.log('  Ningún endpoint respondió correctamente 😞');
    console.log('  Esto confirma que el backend de CABB/Gesdeportiva está completamente caído');
  } else {
    report.workingEndpoints.forEach(e => {
      console.log(`  ✅ ${e.url}`);
      console.log(`     Status: ${e.status} | Type: ${e.contentType}`);
      if (e.bodyPreview) console.log(`     Preview: ${e.bodyPreview.substring(0, 150)}`);
    });
  }

  fs.writeFileSync('apk_recon_report.json', JSON.stringify(report, null, 2));
  console.log(`\n✅ Reporte completo guardado en apk_recon_report.json`);
}

main().catch(console.error);
