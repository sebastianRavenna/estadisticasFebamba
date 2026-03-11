/**
 * Scraper para la API de Indalweb/GesDeportiva - CABB/FEBAMBA
 * Usa la API directa descubierta desde el APK de la app CABB
 *
 * Flujo de autenticación (deobfuscado del APK main.b3d70c09e1bc11b9.js):
 *
 *   1. Dispositivo nuevo (sin id_dispositivo almacenado):
 *      POST dispositivo.ashx → accion=registrar, uid, plataforma, tipo_dispositivo, version
 *      → El servidor responde con id_dispositivo (asignado por servidor) + key
 *
 *   2. Dispositivo existente (tiene id_dispositivo):
 *      POST dispositivo.ashx → accion=acceso, uid, plataforma, tipo_dispositivo,
 *                               id_dispositivo, token_push, version
 *      → El servidor responde con key actualizada
 *
 * Content-Type: application/x-www-form-urlencoded;charset=UTF-8
 * El body se envía como params.toString() via Angular HttpClient.post()
 *
 * Uso: node scraper_api.js
 * Genera archivos JSON en data/
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ============================================================
// Configuración
// ============================================================
const BASE_URL_STATIC = 'https://appaficioncabb.indalweb.net';
let BASE_URL_DYNAMIC = 'https://appaficioncabb.indalweb.net/v2';
const DATA_DIR = path.join(__dirname, 'data');
const SESSION_FILE = path.join(__dirname, 'data', '.session.json');
const DELAY_MS = 1500;

// Versión de la app: 4.0.44 → split('.') → pad each to 2 digits → '040044' → parseInt = 40044
const APP_VERSION = '40044';

/**
 * Genera un uid simulando el formato de Android ID (Cordova device.uuid).
 * Android ID es un string hexadecimal de 16 caracteres.
 */
function generateAndroidId() {
  return crypto.randomBytes(8).toString('hex');
}

let SESSION = {
  id_dispositivo: '',
  key: '',
  uid: '',
  ruta: '',
};

// ============================================================
// Utilidades
// ============================================================
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function saveData(filename, data) {
  const filepath = path.join(DATA_DIR, filename);
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2), 'utf8');
  console.log(`  Guardado: ${filepath}`);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function loadSession() {
  try {
    if (fs.existsSync(SESSION_FILE)) {
      SESSION = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
      console.log(`  Sesión cargada: id_dispositivo=${SESSION.id_dispositivo}, key=${SESSION.key ? '***' : 'vacía'}`);
      return true;
    }
  } catch { /* ignorar */ }
  return false;
}

function saveSession() {
  ensureDataDir();
  fs.writeFileSync(SESSION_FILE, JSON.stringify(SESSION, null, 2), 'utf8');
  console.log(`  Sesión guardada`);
}

/**
 * Hacer una llamada POST con application/x-www-form-urlencoded;charset=UTF-8
 * Replica exactamente el método GetJSON del APK (Angular HttpClient.post)
 */
async function postAPI(url, params) {
  const body = new URLSearchParams(params).toString();
  console.log(`  POST ${url}`);
  console.log(`  Body: ${body.substring(0, 200)}${body.length > 200 ? '...' : ''}`);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      'Accept': 'application/json, text/plain, */*',
      'User-Agent': 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
      'Origin': 'https://appaficioncabb.indalweb.net',
    },
    body: body,
  });

  if (!response.ok) {
    console.error(`  Error HTTP ${response.status}: ${response.statusText}`);
    const text = await response.text().catch(() => '');
    if (text) console.error(`  Response body: ${text.substring(0, 300)}`);
    return null;
  }

  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    console.log(`  Respuesta no-JSON (${text.length} chars): ${text.substring(0, 200)}`);
    return { _raw: text };
  }
}

/**
 * Procesa la respuesta del servidor (replica UltimaActualizacion del APK).
 * Extrae key, id_dispositivo y ruta de la respuesta.
 *
 * La respuesta real incluye:
 *   - resultado: "correcto"
 *   - id_dispositivo: string (server-assigned, base64-like)
 *   - key: string (session token)
 *   - ruta: "https://appaficioncabb.indalweb.net/" (base URL)
 *   - publicidad, perfil, Segmentacion, etc.
 */
function processAuthResponse(data) {
  if (data.resultado !== 'correcto') return false;

  if (data.key) {
    SESSION.key = data.key;
  }
  if (data.id_dispositivo) {
    SESSION.id_dispositivo = data.id_dispositivo;
  }
  // El servidor devuelve "ruta" (no "urlServidorDinamica")
  // La app construye urlServidorDinamica = ruta + 'v2/'
  if (data.ruta) {
    SESSION.ruta = data.ruta;
    const base = data.ruta.endsWith('/') ? data.ruta : data.ruta + '/';
    BASE_URL_DYNAMIC = base + 'v2';
    console.log(`  URL dinámica: ${BASE_URL_DYNAMIC}`);
  }
  return true;
}

/**
 * Fase 1: Registrar dispositivo nuevo (accion=registrar).
 * Se usa cuando NO hay id_dispositivo almacenado.
 * El servidor asigna un id_dispositivo y devuelve una key.
 *
 * Deobfuscado de función 0xedf en main.b3d70c09e1bc11b9.js:
 *   url = urlServidor + 'dispositivo.ashx'
 *   params = { accion:'registrar', uid:device.uuid, plataforma, tipo_dispositivo, version }
 *   // NO envía id_dispositivo ni token_push
 */
async function registerNewDevice() {
  console.log('  Registrando dispositivo nuevo (accion=registrar)...');

  const url = `${BASE_URL_STATIC}/dispositivo.ashx`;
  const params = {
    accion: 'registrar',
    uid: SESSION.uid,
    plataforma: 'android',
    tipo_dispositivo: 'android',
    version: APP_VERSION,
  };

  const data = await postAPI(url, params);
  if (data) {
    saveData('debug_registro.json', data);
    if (processAuthResponse(data)) {
      console.log(`  Dispositivo registrado! id=${SESSION.id_dispositivo}, key=${SESSION.key ? 'OK' : 'vacía'}`);
      if (data.error === 'uuid ya registrado') {
        console.log('  (uuid ya existía en el servidor, reutilizando)');
      }
      saveSession();
      return true;
    }
    console.log(`  Registro falló: resultado=${data.resultado}, error=${data.error || 'ninguno'}`);
  }
  return false;
}

/**
 * Fase 2: Acceso con dispositivo existente (accion=acceso).
 * Se usa cuando YA hay id_dispositivo almacenado pero la key expiró.
 *
 * Deobfuscado de función 0x836 (GuardarKey) en main.b3d70c09e1bc11b9.js:
 *   url = urlServidor + 'dispositivo.ashx'
 *   params = { accion:'acceso', uid:device.uuid, plataforma, tipo_dispositivo,
 *              id_dispositivo, token_push, version }
 */
async function accessExistingDevice() {
  console.log('  Accediendo con dispositivo existente (accion=acceso)...');

  const url = `${BASE_URL_STATIC}/dispositivo.ashx`;
  const params = {
    accion: 'acceso',
    uid: SESSION.uid,
    plataforma: 'android',
    tipo_dispositivo: 'android',
    id_dispositivo: SESSION.id_dispositivo,
    token_push: '',
    version: APP_VERSION,
  };

  const data = await postAPI(url, params);
  if (data) {
    saveData('debug_acceso.json', data);
    if (processAuthResponse(data)) {
      console.log(`  Acceso exitoso! key=${SESSION.key ? 'OK' : 'vacía'}`);
      saveSession();
      return true;
    }
    console.log(`  Acceso falló: resultado=${data.resultado}, error=${data.error || 'ninguno'}`);
  }
  return false;
}

/**
 * Flujo completo de autenticación (replica el flujo del APK):
 *   1. Si hay sesión guardada con id_dispositivo + key → usar directamente
 *   2. Si hay sesión con id_dispositivo pero sin key → accion=acceso
 *   3. Si no hay id_dispositivo → accion=registrar (dispositivo nuevo)
 */
async function registerDevice() {
  console.log('\n--- Autenticación de dispositivo ---');

  const hasSession = loadSession();

  if (hasSession && SESSION.ruta) {
    const base = SESSION.ruta.endsWith('/') ? SESSION.ruta : SESSION.ruta + '/';
    BASE_URL_DYNAMIC = base + 'v2';
  }

  // Caso 1: Sesión completa existente
  if (hasSession && SESSION.id_dispositivo && SESSION.key) {
    console.log('  Usando sesión previa (id_dispositivo + key presentes)');
    return true;
  }

  // Generar uid si no existe (simula Cordova device.uuid = Android ID)
  if (!SESSION.uid) {
    SESSION.uid = generateAndroidId();
    console.log(`  Nuevo uid generado: ${SESSION.uid}`);
  }

  // Caso 2: Tiene id_dispositivo pero no key → acceso para refrescar key
  if (hasSession && SESSION.id_dispositivo && !SESSION.key) {
    console.log('  id_dispositivo existe pero key expirada, intentando acceso...');
    try {
      if (await accessExistingDevice()) return true;
    } catch (err) {
      console.error(`  Error en acceso: ${err.message}`);
    }
    // Si falla acceso, intentar registrar de nuevo
    console.log('  Acceso falló, intentando registro nuevo...');
  }

  // Caso 3: No hay id_dispositivo → registrar dispositivo nuevo
  try {
    if (await registerNewDevice()) return true;
  } catch (err) {
    console.error(`  Error en registro: ${err.message}`);
  }

  console.log('  Autenticación falló. Continuando sin key (algunos endpoints pueden funcionar)...');
  return false;
}

/**
 * Llamada genérica a la API usando POST.
 * Usa urlServidorDinamica (BASE_URL_DYNAMIC) para endpoints de datos,
 * como hace la app real tras recibir la URL dinámica del servidor.
 */
async function apiCall(endpoint, params = {}, baseUrl = null) {
  if (!baseUrl) baseUrl = BASE_URL_DYNAMIC;
  const url = `${baseUrl}/${endpoint}`;

  // Agregar parámetros de sesión (como hace la app: localStorage.getItem('idDispositivo'), sessionStorage.getItem('key'))
  if (SESSION.id_dispositivo) {
    params.id_dispositivo = params.id_dispositivo || SESSION.id_dispositivo;
  }
  if (SESSION.key) {
    params.key = params.key || SESSION.key;
  }

  try {
    const data = await postAPI(url, params);

    if (data && data.resultado === 'error' && data.error === 'Sesión caducada') {
      console.log('  Sesión caducada, renovando key...');
      SESSION.key = '';
      if (SESSION.id_dispositivo) {
        await accessExistingDevice();
      } else {
        await registerNewDevice();
      }
      // Reintentar con la nueva key
      params.key = SESSION.key;
      params.id_dispositivo = SESSION.id_dispositivo;
      return postAPI(url, params);
    }

    return data;
  } catch (err) {
    console.error(`  Error de red: ${err.message}`);
    return null;
  }
}

// ============================================================
// Funciones de scraping
// ============================================================

async function getDelegaciones() {
  console.log('\n--- Obteniendo delegaciones ---');
  const data = await apiCall('delegaciones.ashx', { accion: 'delegaciones' });
  if (data) saveData('delegaciones.json', data);
  return data;
}

async function getCompeticiones(params = {}) {
  console.log('\n--- Obteniendo competiciones ---');
  const data = await apiCall('categoria.ashx', {
    accion: 'competiciones',
    ...params,
  });
  if (data) saveData('competiciones.json', data);
  return data;
}

async function getFasesGrupos(idCategoriaCompeticion) {
  console.log(`\n--- Obteniendo fases/grupos para competicion ${idCategoriaCompeticion} ---`);
  const data = await apiCall('categoria.ashx', {
    accion: 'fasesGruposCompeticion',
    id_categoria_competicion: idCategoriaCompeticion,
  });
  return data;
}

async function getClasificacion(idCategoriaCompeticion, idFase, idGrupo) {
  console.log(`\n--- Obteniendo clasificación (comp=${idCategoriaCompeticion}, fase=${idFase}, grupo=${idGrupo}) ---`);
  const data = await apiCall('categoria.ashx', {
    accion: 'clasificacion',
    id_categoria_competicion: idCategoriaCompeticion,
    id_fase: idFase,
    id_grupo: idGrupo,
  });
  return data;
}

async function getJornadas(idCategoriaCompeticion, idFase, idGrupo) {
  console.log(`\n--- Obteniendo jornadas (comp=${idCategoriaCompeticion}, fase=${idFase}, grupo=${idGrupo}) ---`);
  const data = await apiCall('categoria.ashx', {
    accion: 'jornadas',
    id_categoria_competicion: idCategoriaCompeticion,
    id_fase: idFase,
    id_grupo: idGrupo,
  });
  return data;
}

async function getPartidos(idCategoriaCompeticion, idFase, idGrupo) {
  console.log(`\n--- Obteniendo partidos ---`);
  const data = await apiCall('partidos.ashx', {
    accion: 'partidos',
    id_categoria_competicion: idCategoriaCompeticion,
    id_fase: idFase,
    id_grupo: idGrupo,
  });
  return data;
}

async function getPartido(idPartido) {
  console.log(`\n--- Obteniendo partido ${idPartido} ---`);
  const data = await apiCall('partido.ashx', {
    accion: 'partido',
    id_partido: idPartido,
  });
  return data;
}

async function getEstadisticasPartido(idPartido) {
  console.log(`\n--- Obteniendo estadísticas partido ${idPartido} ---`);
  const data = await apiCall('estadisticas.ashx', {
    accion: 'estadisticas',
    id_partido: idPartido,
  });
  return data;
}

async function getEstadisticasEquipo(idEquipo, idCategoriaCompeticion, idFase, idGrupo) {
  console.log(`\n--- Obteniendo estadísticas equipo ${idEquipo} ---`);
  const data = await apiCall('estadisticas.ashx', {
    accion: 'estadisticasEquipo',
    id_equipo: idEquipo,
    id_categoria_competicion: idCategoriaCompeticion,
    id_fase: idFase,
    id_grupo: idGrupo,
  });
  return data;
}

async function getEstadisticasJugador(idJugador, idCategoriaCompeticion, idFase, idGrupo) {
  console.log(`\n--- Obteniendo estadísticas jugador ${idJugador} ---`);
  const data = await apiCall('estadisticas.ashx', {
    accion: 'estadisticasJugador',
    id_jugador: idJugador,
    id_categoria_competicion: idCategoriaCompeticion,
    id_fase: idFase,
    id_grupo: idGrupo,
  });
  return data;
}

async function getEquipo(idEquipo) {
  console.log(`\n--- Obteniendo equipo ${idEquipo} ---`);
  const data = await apiCall('equipo.ashx', {
    accion: 'equipo',
    id_equipo: idEquipo,
  });
  return data;
}

async function getJugadores(idEquipo, idCategoriaCompeticion) {
  console.log(`\n--- Obteniendo jugadores equipo ${idEquipo} ---`);
  const data = await apiCall('jugadores.ashx', {
    accion: 'jugadores',
    id_equipo: idEquipo,
    id_categoria_competicion: idCategoriaCompeticion,
  });
  return data;
}

async function buscar(tipo, texto) {
  console.log(`\n--- Buscando ${tipo}: "${texto}" ---`);
  const data = await apiCall('busqueda.ashx', {
    accion: `buscar${tipo.charAt(0).toUpperCase() + tipo.slice(1)}`,
    texto: texto,
  });
  return data;
}

/**
 * Procesa una competición: obtiene fases/grupos, clasificación, partidos y estadísticas.
 */
async function scrapeCompeticion(comp) {
  const compId = comp.IdCompeticionCategoria || comp.IdCategoriaCompeticion || comp.Id;
  const compName = `${comp.NombreCompeticion} - ${comp.NombreCategoria}`;
  const compIdSafe = String(compId).replace(/[^a-zA-Z0-9]/g, '_');

  console.log(`\n========================================`);
  console.log(`  Competición: ${compName} (id=${compId})`);
  console.log(`========================================`);

  // 1. Obtener fases y grupos
  const fasesGrupos = await getFasesGrupos(compId);
  await sleep(DELAY_MS);

  if (!fasesGrupos) {
    console.log('  No se pudieron obtener fases/grupos');
    return null;
  }

  saveData(`fases_grupos_${compIdSafe}.json`, fasesGrupos);

  // Extraer la lista de fases del response (puede venir en distintos formatos)
  const datos = fasesGrupos.datos || fasesGrupos;
  const fases = datos.ListaFases || datos.Fases || (datos.IdFase ? [datos] : []);

  if (!fases.length) {
    console.log('  No se encontraron fases. Estructura:', JSON.stringify(datos).substring(0, 300));
    return fasesGrupos;
  }

  const results = { competicion: compName, compId, fases: [] };

  for (const fase of (Array.isArray(fases) ? fases : [fases])) {
    const faseId = fase.IdFase || fase.Id;
    const faseName = fase.NombreFase || fase.Nombre || `Fase ${faseId}`;
    const grupos = fase.ListaGrupos || fase.Grupos || (fase.IdGrupo ? [fase] : []);

    console.log(`\n  Fase: ${faseName} (id=${faseId})`);

    for (const grupo of (Array.isArray(grupos) ? grupos : [grupos])) {
      const grupoId = grupo.IdGrupo || grupo.Id;
      const grupoName = grupo.NombreGrupo || grupo.Nombre || `Grupo ${grupoId}`;

      console.log(`    Grupo: ${grupoName} (id=${grupoId})`);

      // 2. Clasificación (standings)
      const clasificacion = await getClasificacion(compId, faseId, grupoId);
      if (clasificacion && clasificacion.resultado !== 'error') {
        saveData(`clasificacion_${compIdSafe}_${faseId}_${grupoId}.json`, clasificacion);
      }
      await sleep(DELAY_MS);

      // 3. Partidos
      const partidos = await getPartidos(compId, faseId, grupoId);
      if (partidos && partidos.resultado !== 'error') {
        saveData(`partidos_${compIdSafe}_${faseId}_${grupoId}.json`, partidos);
      }
      await sleep(DELAY_MS);

      // 4. Estadísticas de partidos finalizados (limitar a 5)
      if (partidos) {
        const listaPartidos = extractPartidos(partidos);
        const finalizados = listaPartidos
          .filter(p => p.Estado === 'Finalizado' || p.Terminado || p.estado === 'finalizado')
          .slice(0, 5);

        console.log(`    Partidos finalizados: ${finalizados.length} de ${listaPartidos.length} total`);

        for (const partido of finalizados) {
          const partidoId = partido.IdPartido || partido.Id || partido.id;
          if (!partidoId) continue;

          const stats = await getEstadisticasPartido(partidoId);
          if (stats && stats.resultado !== 'error') {
            saveData(`stats_partido_${partidoId}.json`, stats);
          }
          await sleep(DELAY_MS);
        }
      }

      results.fases.push({ faseId, faseName, grupoId, grupoName, clasificacion, partidos });
    }
  }

  return results;
}

/**
 * Extrae la lista de partidos de una respuesta, manejando distintos formatos.
 */
function extractPartidos(response) {
  if (!response) return [];
  const datos = response.datos || response;
  if (Array.isArray(datos)) return datos;
  if (datos.ListaPartidos) return datos.ListaPartidos;
  if (datos.partidos) return datos.partidos;
  return [];
}

// ============================================================
// Flujo principal
// ============================================================
async function main() {
  console.log('===========================================');
  console.log(' Scraper API CABB/FEBAMBA - Indalweb');
  console.log('===========================================');
  console.log(`Base URL estática: ${BASE_URL_STATIC}`);
  console.log(`Data dir: ${DATA_DIR}`);
  console.log(`Método: POST (application/x-www-form-urlencoded;charset=UTF-8)`);

  ensureDataDir();

  // Paso 0: Registrar dispositivo
  await registerDevice();
  console.log(`  URL dinámica activa: ${BASE_URL_DYNAMIC}`);
  await sleep(DELAY_MS);

  // Paso 1: Buscar competiciones de FEBAMBA via búsqueda
  // (categoria.ashx con accion=competiciones requiere parámetros adicionales,
  //  pero busqueda.ashx funciona directamente y devuelve las competiciones en "categorias")
  console.log('\n--- Buscando competiciones FEBAMBA ---');
  const busquedaBA = await buscar('Categoria', 'Buenos Aires');
  if (busquedaBA) saveData('busqueda_buenos_aires.json', busquedaBA);
  await sleep(DELAY_MS);

  // Extraer competiciones de FEBAMBA del resultado de búsqueda
  const categorias = busquedaBA?.categorias || [];
  const febambaComps = categorias.filter(c =>
    c.NombreDelegacion?.includes('METROPOLITANA') ||
    c.NombreDelegacion?.includes('BUENOS AIRES')
  );

  console.log(`  Encontradas ${categorias.length} competiciones total`);
  console.log(`  FEBAMBA/Buenos Aires: ${febambaComps.length}`);

  if (febambaComps.length === 0) {
    console.log('  No se encontraron competiciones de FEBAMBA/Buenos Aires');
    if (categorias.length > 0) {
      console.log('  Delegaciones encontradas:');
      const delegaciones = [...new Set(categorias.map(c => c.NombreDelegacion))];
      delegaciones.forEach(d => console.log(`    - ${d}`));
    }
  }

  // Mostrar las competiciones encontradas
  for (const comp of febambaComps) {
    console.log(`  - [${comp.IdCompeticionCategoria}] ${comp.NombreCompeticion} / ${comp.NombreCategoria}`);
  }

  // Paso 2: Scrapear competiciones principales de FEBAMBA
  // Priorizar: SUPERIOR 2026 (primera división), FORMATIVAS 2026
  const priorityOrder = ['SUPERIOR', 'FLEX SUPERIOR', 'FORMATIVAS', 'FLEX FORMATIVAS', 'MASTER'];
  const sortedComps = [...febambaComps].sort((a, b) => {
    const aIdx = priorityOrder.findIndex(p => a.NombreCompeticion?.includes(p));
    const bIdx = priorityOrder.findIndex(p => b.NombreCompeticion?.includes(p));
    return (aIdx === -1 ? 999 : aIdx) - (bIdx === -1 ? 999 : bIdx);
  });

  // Scrapear las primeras 5 competiciones (para no sobrecargar)
  const maxComps = 5;
  const targetComps = sortedComps.slice(0, maxComps);

  console.log(`\n--- Scrapeando ${targetComps.length} competiciones ---`);

  for (const comp of targetComps) {
    try {
      await scrapeCompeticion(comp);
    } catch (err) {
      console.error(`  Error scrapeando ${comp.NombreCompeticion}: ${err.message}`);
    }
    await sleep(DELAY_MS);
  }

  // Paso 3: Resumen
  console.log('\n===========================================');
  console.log(' Scraping completado!');
  console.log('===========================================');
  console.log(`Archivos guardados en: ${DATA_DIR}/`);

  const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json'));
  console.log(`Total archivos: ${files.length}`);
  files.forEach(f => {
    const size = fs.statSync(path.join(DATA_DIR, f)).size;
    console.log(`  ${f} (${(size / 1024).toFixed(1)} KB)`);
  });
}

main().catch(err => {
  console.error('Error fatal:', err);
  process.exit(1);
});
