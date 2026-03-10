/**
 * Captura el trafico de red de la app Aficion CABB
 *
 * OPCIÓN 1 (recomendada): Usar Android Emulator + Playwright
 * OPCIÓN 2: Extraer la APK y buscar endpoints en los JS internos
 * OPCIÓN 3: Proxy HTTP (mitmproxy) - requiere instalar cert en el celular
 *
 * Este script implementa la OPCIÓN 2: analizar los archivos de la APK
 *
 * === INSTRUCCIONES ===
 *
 * 1. Descargar la APK desde:
 *    - https://apkpure.com/es/aficion-cabb/com.indalweb.aficionCABB
 *    - O: https://apkcombo.com/es/aficion-cabb/com.indalweb.aficionCABB/
 *    - Guardar el .apk (o .xapk) en este directorio
 *
 * 2. Correr: node capture_app_traffic.js
 *
 * 3. El script va a:
 *    - Extraer el APK (es un ZIP)
 *    - Buscar en assets/www/ los archivos JS (Ionic/Cordova app)
 *    - Encontrar los endpoints de API hardcodeados
 *    - Probar cada uno
 *
 * === ALTERNATIVA CON CHARLES/MITMPROXY ===
 *
 * Si preferís capturar tráfico real del celular:
 *
 * 1. Instalar mitmproxy: pip install mitmproxy
 * 2. Correr: mitmproxy --mode regular --listen-port 8888
 * 3. En el celular:
 *    - WiFi > Proxy manual > IP de tu PC : 8888
 *    - Navegar a mitm.it e instalar certificado
 * 4. Abrir la app CABB y navegar
 * 5. En mitmproxy ver todas las llamadas API
 *
 * Para que sea más fácil, este script arranca un proxy simple
 * que logea todo el tráfico HTTP/HTTPS.
 */

const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');

const APK_DIR = path.join(__dirname, 'apk_extracted');

async function main() {
  console.log('📱 Extracción de endpoints de Afición CABB');
  console.log('='.repeat(60));

  // Buscar APK/XAPK
  const files = fs.readdirSync('.');
  const apkFile = files.find(f => f.endsWith('.apk'));
  const xapkFile = files.find(f => f.endsWith('.xapk'));

  if (!apkFile && !xapkFile) {
    console.log('❌ No se encontró ningún APK o XAPK en el directorio actual.');
    console.log('\nDescargalo de:');
    console.log('  https://apkpure.com/es/aficion-cabb/com.indalweb.aficionCABB');
    console.log('  https://apkcombo.com/es/aficion-cabb/com.indalweb.aficionCABB/');
    console.log('\nGuardá el archivo .apk o .xapk acá y volvé a correr este script.');
    return;
  }

  // Si es XAPK, extraer primero
  let targetApk = apkFile;
  if (!targetApk && xapkFile) {
    console.log(`📦 Extrayendo XAPK: ${xapkFile}`);
    const xapkDir = path.join(__dirname, 'xapk_temp');
    if (!fs.existsSync(xapkDir)) fs.mkdirSync(xapkDir);
    execSync(`unzip -o "${xapkFile}" -d xapk_temp/`, { stdio: 'inherit' });

    // Buscar el APK base dentro del XAPK
    const innerFiles = fs.readdirSync('xapk_temp');
    targetApk = innerFiles.find(f => f.endsWith('.apk'));
    if (targetApk) {
      targetApk = path.join('xapk_temp', targetApk);
    } else {
      console.log('  Archivos en XAPK:', innerFiles);
      // A veces la estructura es diferente
      const baseApk = innerFiles.find(f => f === 'base.apk' || f.includes('base'));
      targetApk = baseApk ? path.join('xapk_temp', baseApk) : null;
    }

    if (!targetApk) {
      console.log('❌ No se encontró APK dentro del XAPK');
      return;
    }
    console.log(`  APK encontrado: ${targetApk}`);
  }

  // Extraer APK
  console.log(`\n📦 Extrayendo APK: ${targetApk}`);
  if (!fs.existsSync(APK_DIR)) fs.mkdirSync(APK_DIR, { recursive: true });
  execSync(`unzip -o "${targetApk}" -d "${APK_DIR}"`, { stdio: 'pipe' });

  // Listar estructura
  console.log('\n📁 Estructura de la APK:');
  const listResult = spawnSync('find', [APK_DIR, '-maxdepth', '3', '-type', 'f'], { encoding: 'utf-8' });
  const allFiles = listResult.stdout.split('\n').filter(Boolean);

  // Mostrar directorios principales
  const dirs = [...new Set(allFiles.map(f => path.dirname(f).replace(APK_DIR + '/', '').split('/')[0]))];
  console.log('  Directorios:', dirs.join(', '));

  // Buscar archivos JS (Ionic/Cordova)
  const jsFiles = allFiles.filter(f => f.endsWith('.js'));
  const jsonFiles = allFiles.filter(f => f.endsWith('.json'));
  const xmlFiles = allFiles.filter(f => f.endsWith('.xml') && !f.includes('res/'));
  const htmlFiles = allFiles.filter(f => f.endsWith('.html'));

  console.log(`\n  JS files: ${jsFiles.length}`);
  console.log(`  JSON files: ${jsonFiles.length}`);
  console.log(`  XML files (no res): ${xmlFiles.length}`);
  console.log(`  HTML files: ${htmlFiles.length}`);

  // ===== Buscar URLs en TODOS los archivos de texto =====
  console.log('\n🔍 Buscando URLs y endpoints...');
  console.log('='.repeat(60));

  const findings = {
    urls: new Set(),
    apiPaths: new Set(),
    baseUrls: new Set(),
    configs: [],
    fileDetails: []
  };

  const textFiles = [...jsFiles, ...jsonFiles, ...xmlFiles, ...htmlFiles];

  for (const file of textFiles) {
    try {
      const content = fs.readFileSync(file, 'utf-8');

      // URLs completas
      const urls = content.match(/https?:\/\/[^\s"'`<>{}\\)]+/g) || [];
      urls.forEach(u => {
        // Filtrar assets genéricos
        if (!u.match(/\.(png|jpg|gif|svg|ico|woff|ttf|eot|map)(\?|$)/)) {
          findings.urls.add(u);
        }
      });

      // API paths
      const apiPaths = content.match(/["'`](\/api\/[^"'`\s]+)["'`]/g) || [];
      apiPaths.forEach(p => findings.apiPaths.add(p.replace(/["'`]/g, '')));

      // REST paths
      const restPaths = content.match(/["'`](\/rest\/[^"'`\s]+)["'`]/g) || [];
      restPaths.forEach(p => findings.apiPaths.add(p.replace(/["'`]/g, '')));

      // WS paths
      const wsPaths = content.match(/["'`](\/ws\/[^"'`\s]+)["'`]/g) || [];
      wsPaths.forEach(p => findings.apiPaths.add(p.replace(/["'`]/g, '')));

      // Base URL configs
      const baseMatches = content.match(/(?:baseUrl|apiUrl|API_URL|BASE_URL|serverUrl|urlBase|apiBase|endpoint|servidor|host|backend|urlServidor)\s*[:=]\s*["'`]([^"'`]+)["'`]/gi) || [];
      baseMatches.forEach(m => findings.baseUrls.add(m));

      // Environment/config objects
      const envMatches = content.match(/environment\s*[:=]\s*\{[^}]{0,1000}\}/g) || [];
      envMatches.forEach(m => findings.configs.push({ file, config: m }));

      // Production config
      const prodMatches = content.match(/production\s*[:=]\s*\{[^}]{0,1000}\}/g) || [];
      prodMatches.forEach(m => findings.configs.push({ file, config: m }));

      // Si encontró algo, guardar detalle
      if (urls.length > 0 || apiPaths.length > 0 || baseMatches.length > 0) {
        findings.fileDetails.push({
          file: file.replace(APK_DIR + '/', ''),
          size: (content.length / 1024).toFixed(0) + 'KB',
          urls: urls.length,
          apiPaths: apiPaths.length,
          baseUrls: baseMatches.length
        });
      }
    } catch {} // Skip binary files
  }

  // ===== Buscar strings en DEX files =====
  console.log('\n🔍 Buscando en archivos DEX (bytecode Java/Kotlin)...');
  const dexFiles = allFiles.filter(f => f.endsWith('.dex'));
  for (const dex of dexFiles) {
    try {
      const result = spawnSync('strings', [dex], { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 });
      const lines = result.stdout.split('\n');
      lines.forEach(line => {
        if (line.match(/https?:\/\/.*gesdeportiva/)) findings.urls.add(line.trim());
        if (line.match(/https?:\/\/.*indalweb/)) findings.urls.add(line.trim());
        if (line.match(/https?:\/\/.*cabb/)) findings.urls.add(line.trim());
        if (line.match(/\/api\//)) findings.apiPaths.add(line.trim());
      });
      console.log(`  ${path.basename(dex)}: ${lines.length} strings analizadas`);
    } catch (e) {
      console.log(`  Error en ${dex}: ${e.message}`);
    }
  }

  // ===== RESULTADOS =====
  console.log('\n' + '='.repeat(60));
  console.log('📊 RESULTADOS');
  console.log('='.repeat(60));

  console.log(`\n🌐 URLs encontradas (${findings.urls.size}):`);
  const urlList = [...findings.urls].sort();
  urlList.forEach(u => console.log(`  ${u}`));

  console.log(`\n📡 API Paths (${findings.apiPaths.size}):`);
  [...findings.apiPaths].sort().forEach(p => console.log(`  ${p}`));

  console.log(`\n⚙️  Base URL configs (${findings.baseUrls.size}):`);
  [...findings.baseUrls].forEach(b => console.log(`  ${b}`));

  console.log(`\n🔧 Environment configs (${findings.configs.length}):`);
  findings.configs.forEach(c => {
    console.log(`  File: ${c.file.replace(APK_DIR + '/', '')}`);
    console.log(`  ${c.config.substring(0, 300)}`);
  });

  console.log(`\n📄 Archivos con hallazgos:`);
  findings.fileDetails
    .sort((a, b) => b.urls - a.urls)
    .slice(0, 15)
    .forEach(f => console.log(`  ${f.file} (${f.size}) - ${f.urls} URLs, ${f.apiPaths} paths`));

  // ===== Probar endpoints que parecen API =====
  const apiUrls = urlList.filter(u =>
    u.includes('api') || u.includes('rest') || u.includes('ws') ||
    u.includes('gesdeportiva') || u.includes('indalweb') || u.includes('cabb')
  );

  if (apiUrls.length > 0) {
    console.log('\n\n🧪 PROBANDO ENDPOINTS...');
    console.log('='.repeat(60));

    for (const url of apiUrls.slice(0, 30)) {
      try {
        const resp = await fetch(url, {
          headers: {
            'User-Agent': 'AficionCABB/3.0 (Android; Build/1)',
            'Accept': 'application/json, text/plain, */*'
          },
          signal: AbortSignal.timeout(10000),
          redirect: 'follow'
        });
        const ct = resp.headers.get('content-type') || '';
        let body = '';
        try { body = (await resp.text()).substring(0, 500); } catch {}

        const icon = resp.status === 200 ? '✅' : '❌';
        console.log(`${icon} [${resp.status}] ${url}`);
        if (resp.status === 200) {
          console.log(`   Content-Type: ${ct}`);
          console.log(`   Body: ${body.substring(0, 200)}`);
        }
      } catch (e) {
        console.log(`⏱️  TIMEOUT ${url}`);
      }
    }
  }

  // Guardar reporte
  const report = {
    timestamp: new Date().toISOString(),
    apkFile: targetApk,
    totalFilesInApk: allFiles.length,
    jsFiles: jsFiles.length,
    urls: [...findings.urls],
    apiPaths: [...findings.apiPaths],
    baseUrls: [...findings.baseUrls],
    configs: findings.configs,
    fileDetails: findings.fileDetails
  };

  fs.writeFileSync('apk_endpoints.json', JSON.stringify(report, null, 2));
  console.log('\n✅ Reporte guardado en apk_endpoints.json');
  console.log('\nPasame el contenido de apk_endpoints.json para analizar los endpoints.');
}

main().catch(console.error);
