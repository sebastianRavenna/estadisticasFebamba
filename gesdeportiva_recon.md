# Gesdeportiva API Recon — Script para Claude Code

## Objetivo
Descubrir todos los endpoints, estructuras de datos y parámetros que usa
la app CABB / portal Gesdeportiva, para luego construir un dashboard de analytics.

## Instrucciones para Claude Code

Ejecutá este plan en orden. Usá bash, Node.js o Python según convenga en cada paso.

---

## FASE 1A — Reconocimiento del portal web (estadisticascabb.gesdeportiva.es)

### Paso 1: Instalar dependencias
```bash
npm init -y
npm install playwright
npx playwright install chromium
```

### Paso 2: Script de intercepción de red
Crear el archivo `recon_web.js` con el siguiente contenido:

```javascript
const { chromium } = require('playwright');
const fs = require('fs');

const TARGET_URL = 'https://estadisticascabb.gesdeportiva.es/';

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
    if (!url.match(/\.(css|js|png|jpg|woff|ico|svg)(\?|$)/)) {
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

  // Navegar al sitio
  console.log('Navegando al portal...');
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
  
  console.log('\n=== LINKS ENCONTRADOS EN LA PÁGINA ===');
  links.forEach(l => console.log(`  "${l.text}" => ${l.href}`));

  // Si hay menú de torneos/competencias, hacer click para disparar más llamadas API
  const menuItems = await page.$$('nav a, .menu a, [class*="nav"] a, [class*="menu"] a');
  console.log(`\nEncontrados ${menuItems.length} items de menú`);
  
  for (let i = 0; i < Math.min(menuItems.length, 5); i++) {
    try {
      await menuItems[i].click();
      await page.waitForTimeout(2000);
      console.log(`Click en item de menú ${i+1}`);
    } catch (e) { /* ignorar */ }
  }

  await page.waitForTimeout(3000);

  // Guardar todo lo capturado
  const report = {
    timestamp: new Date().toISOString(),
    targetUrl: TARGET_URL,
    totalCallsCapturadas: apiCalls.length,
    links,
    apiCalls: apiCalls.sort((a, b) => a.url.localeCompare(b.url))
  };

  fs.writeFileSync('recon_report.json', JSON.stringify(report, null, 2));
  console.log(`\n✅ Reporte guardado en recon_report.json`);
  console.log(`Total de llamadas capturadas: ${apiCalls.length}`);

  // Resumen por dominio/path base
  console.log('\n=== RESUMEN DE ENDPOINTS ÚNICOS ===');
  const uniquePaths = [...new Set(apiCalls.map(c => {
    try {
      const u = new URL(c.url);
      return `${u.hostname}${u.pathname}`;
    } catch { return c.url; }
  }))].sort();
  uniquePaths.forEach(p => console.log(`  ${p}`));

  await browser.close();
}

recon().catch(console.error);
```

### Paso 3: Ejecutar y analizar
```bash
node recon_web.js
```

Luego pedirle a Claude Code:
> "Analizá el archivo recon_report.json y listá todos los endpoints de API únicos, 
> sus parámetros, y la estructura de datos de cada respuesta JSON"

---

## FASE 1B — Análisis de la APK (endpoints hardcodeados)

### Paso 1: Descargar la APK
Usando apkeep (herramienta de descarga de APKs desde Google Play):
```bash
# Instalar apkeep
curl -Lo apkeep https://github.com/EFForg/apkeep/releases/latest/download/apkeep-x86_64-unknown-linux-gnu
chmod +x apkeep

# Descargar la APK (no requiere login para apps gratuitas)
./apkeep -a com.indalweb.aficionCABB .
```

Si no funciona, alternativa manual:
```bash
# Usar apktool para decodificar una APK descargada manualmente
apt-get install -y apktool 2>/dev/null || pip install androguard --break-system-packages
```

### Paso 2: Extraer strings con URLs y endpoints
```bash
# Después de tener la APK, extraer todas las URLs
unzip -o com.indalweb.aficionCABB.apk -d apk_extracted/

# Buscar URLs en todos los archivos
grep -r "gesdeportiva\|indalweb\|https://" apk_extracted/ --include="*.js" --include="*.json" --include="*.xml" -h | \
  grep -oP 'https?://[^\s"'"'"'<>{}]+' | \
  sort -u > urls_encontradas.txt

cat urls_encontradas.txt
```

### Paso 3: Con androguard (más profundo)
```python
# recon_apk.py
from androguard.misc import AnalyzeAPK
import re, json

apk_path = "com.indalweb.aficionCABB.apk"  # ajustar path
a, d, dx = AnalyzeAPK(apk_path)

print("=== APP INFO ===")
print(f"Package: {a.get_package()}")
print(f"Version: {a.get_androidversion_name()}")
print(f"Main Activity: {a.get_main_activity()}")

# Extraer todas las strings que parezcan URLs o endpoints
all_strings = []
for dex in d:
    for cls in dex.get_classes():
        for method in cls.get_methods():
            try:
                code = method.get_source()
                if code:
                    urls = re.findall(r'https?://[^\s"\'<>{}\\]+', code)
                    paths = re.findall(r'/api/[^\s"\'<>{}\\]+', code)
                    all_strings.extend(urls + paths)
            except:
                pass

unique_strings = list(set(all_strings))
unique_strings.sort()

with open('apk_strings.json', 'w') as f:
    json.dump(unique_strings, f, indent=2)

print(f"\n✅ {len(unique_strings)} strings únicas guardadas en apk_strings.json")
for s in unique_strings:
    print(f"  {s}")
```

```bash
python3 recon_apk.py
```

---

## FASE 1C — Análisis manual rápido (si las anteriores fallan)

Si la app usa React Native o Ionic (probable para una app híbrida de Indalweb), 
los assets JS estarán dentro de la APK y son legibles:

```bash
# Buscar archivos JS dentro de la APK
find apk_extracted/ -name "*.js" | head -20

# Buscar endpoints en el JS principal
grep -oP '"(/[a-zA-Z0-9/_-]+)"' apk_extracted/assets/www/js/*.js 2>/dev/null | \
  grep -v '\.(css|js|png|jpg|html)' | \
  sort -u

# Buscar base URL de la API
grep -oP 'baseURL["\s:=]+["\x27][^"'\'']+' apk_extracted/assets/www/js/*.js 2>/dev/null
```

---

## FASE 2 — Una vez que tenés los endpoints

Con el reporte generado, pedirle a Claude Code:

> "Con esta lista de endpoints de Gesdeportiva API:
> [pegar lista]
> 
> Construí un script Node.js/Python que:
> 1. Consulte todos los endpoints disponibles para la federación FEBAMBA
> 2. Guarde los datos en un archivo JSON local con estructura normalizada
> 3. Identifique qué datos hay disponibles: jugadores, equipos, partidos, estadísticas, torneos
> 
> Luego construí un dashboard React con:
> - Vista de torneo actual con tabla de posiciones
> - Estadísticas por jugador (puntos, rebotes, asistencias, etc.) con gráficos
> - Comparación entre jugadores (radar chart)
> - Histórico de rendimiento por partido
> - Ranking de líderes estadísticos
> - Filtros por temporada, categoría, equipo"

---

## Notas importantes

- La app es de **Indalweb** (España) pero los datos son de CABB/FEBAMBA (Argentina)
- El portal web es `estadisticascabb.gesdeportiva.es` — público, sin login para datos generales
- Probable stack: Ionic/Angular o React Native para la app móvil
- La API probablemente devuelve JSON con auth via token en headers
- Si hay auth, puede ser un token público embebido en la app (común en apps de este tipo)
