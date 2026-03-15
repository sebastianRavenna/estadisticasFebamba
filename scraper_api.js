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

// Proxy HTTP (opcional): set PROXY_URL env var para rutear requests
// Ejemplo: PROXY_URL=http://user:pass@host:port node scraper_api.js
// Si no se setea, se conecta directo.
let fetchWithProxy = fetch;
if (process.env.PROXY_URL) {
  const { HttpsProxyAgent } = require('https-proxy-agent');
  const agent = new HttpsProxyAgent(process.env.PROXY_URL);
  fetchWithProxy = (url, opts = {}) => fetch(url, { ...opts, dispatcher: agent });
  console.log(`[PROXY] Usando proxy: ${process.env.PROXY_URL}`);
}

// ============================================================
// Configuración
// ============================================================
const BASE_URL_STATIC = 'https://appaficioncabb.indalweb.net';
let BASE_URL_DYNAMIC = 'https://appaficioncabb.indalweb.net/v2';
const DATA_DIR = path.join(__dirname, 'data');
const SESSION_FILE = path.join(__dirname, 'data', '.session.json');
const DB_FILE = path.join(__dirname, 'data', 'db.json');
const DELAY_MS = 1500;

// Versión de la app: 4.0.44 → split('.') → pad each to 2 digits → '040044' → parseInt = 40044
const APP_VERSION = '40044';

// ============================================================
// Filtros de competencias y fases (WHITELIST)
// ============================================================
// Solo scrapear estas competencias (coincidencia parcial en NombreCompeticion)
const INCLUDED_COMPETITIONS = ['SUPERIOR 2026', 'FORMATIVAS 2026'];

// Solo scrapear estas combinaciones fase+grupo (coincidencia parcial en cada campo)
// Para SUPERIOR 2026: RECLASIFICACION SUPERIOR / SUR 2
// Para FORMATIVAS 2026 (todas las categorías): TORNEO RECLASIFICATORIO / SUR 2B
const INCLUDED_PHASE_GROUPS = [
  { fase: 'RECLASIFICACION SUPERIOR', grupo: 'SUR 2' },
  { fase: 'TORNEO RECLASIFICATORIO',  grupo: 'SUR 2B' },
];

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

// ============================================================
// Base de datos local incremental
// ============================================================
let DB = {
  meta: { lastUpdate: null },
  matchStats: {},   // keyed by IdPartido (hex string)
  teamStats: {},    // keyed by "compId_faseTag_grupoTag_equipoId"
  topPlayers: {},   // keyed by "compId_faseTag_grupoTag"
};

function loadDB() {
  try {
    if (fs.existsSync(DB_FILE)) {
      DB = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      const matchCount = Object.keys(DB.matchStats || {}).length;
      console.log(`  BD local cargada: ${matchCount} partidos en cache`);
      return true;
    }
  } catch { /* ignorar */ }
  console.log('  BD local no encontrada, se creará una nueva');
  return false;
}

function saveDB() {
  DB.meta.lastUpdate = new Date().toISOString();
  fs.writeFileSync(DB_FILE, JSON.stringify(DB, null, 2), 'utf8');
  console.log(`  BD local guardada: ${Object.keys(DB.matchStats).length} partidos`);
}

// Cookie jar simple: almacena cookies del servidor (ASP.NET Session, etc.)
// El WebView de Cordova maneja cookies automáticamente; Node fetch no.
// categoria.ashx y otros endpoints /v2/ requieren la cookie de sesión ASP.NET.
const cookieJar = new Map(); // domain → Map(name → {value, ...})

function storeCookies(url, response) {
  const domain = new URL(url).hostname;
  if (!cookieJar.has(domain)) cookieJar.set(domain, new Map());
  const jar = cookieJar.get(domain);
  const setCookieHeaders = response.headers.getSetCookie
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean);
  for (const header of setCookieHeaders) {
    const [nameVal] = header.split(';');
    const eqIdx = nameVal.indexOf('=');
    if (eqIdx < 0) continue;
    const name = nameVal.slice(0, eqIdx).trim();
    const value = nameVal.slice(eqIdx + 1).trim();
    if (name) jar.set(name, value);
  }
}

function getCookieHeader(url) {
  const domain = new URL(url).hostname;
  const jar = cookieJar.get(domain);
  if (!jar || jar.size === 0) return '';
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

/**
 * Hacer una llamada POST con application/x-www-form-urlencoded;charset=UTF-8
 * Replica exactamente el método GetJSON del APK (Angular HttpClient.post)
 *
 * IMPORTANTE: Después de cada respuesta exitosa, actualiza SESSION.key
 * replicando la función UltimaActualizacion() del APK, que guarda la nueva
 * key en sessionStorage con cada respuesta del servidor.
 */
async function postAPI(url, params) {
  const body = new URLSearchParams(params).toString();
  console.log(`  POST ${url}`);
  console.log(`  Body: ${body.substring(0, 200)}${body.length > 200 ? '...' : ''}`);

  const cookieHeader = getCookieHeader(url);
  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded',
    'Accept': 'application/json, text/plain, */*',
    'User-Agent': 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  };
  if (cookieHeader) headers['Cookie'] = cookieHeader;

  const response = await fetchWithProxy(url, {
    method: 'POST',
    headers,
    body: body,
  });

  // Capturar cookies del servidor (ASP.NET Session, etc.)
  storeCookies(url, response);

  if (!response.ok) {
    console.error(`  Error HTTP ${response.status}: ${response.statusText}`);
    const text = await response.text().catch(() => '');
    if (text) console.error(`  Response body: ${text.substring(0, 300)}`);
    return null;
  }

  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    console.log(`  Respuesta no-JSON (${text.length} chars): ${text.substring(0, 200)}`);
    return { _raw: text };
  }

  // Replicar UltimaActualizacion() del APK:
  // La app actualiza key, id_dispositivo y ruta con CADA respuesta exitosa
  if (data && data.resultado === 'correcto') {
    if (data.key) {
      SESSION.key = data.key;
    }
    if (data.id_dispositivo && data.id_dispositivo !== '') {
      SESSION.id_dispositivo = data.id_dispositivo;
    }
    if (data.ruta) {
      SESSION.ruta = data.ruta;
      const base = data.ruta.endsWith('/') ? data.ruta : data.ruta + '/';
      BASE_URL_DYNAMIC = base + 'v2';
    }
  }

  return data;
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

  // Intentar primero con android; si falla (500), intentar con ios
  // NOTA: el servidor actualmente da 500 para android pero acepta ios
  for (const plat of ['android', 'ios']) {
    const params = {
      accion: 'registrar',
      uid: SESSION.uid,
      plataforma: plat,
      tipo_dispositivo: plat,
      version: APP_VERSION,
    };

    const data = await postAPI(url, params);
    if (data) {
      if (plat === 'android') saveData('debug_registro.json', data);
      if (processAuthResponse(data)) {
        SESSION.plataforma = plat;
        console.log(`  Dispositivo registrado (${plat})! id=${SESSION.id_dispositivo}, key=${SESSION.key ? 'OK' : 'vacía'}`);
        if (data.error === 'uuid ya registrado') {
          console.log('  (uuid ya existía en el servidor, reutilizando)');
        }
        saveSession();
        return true;
      }
      console.log(`  Registro ${plat} falló: resultado=${data.resultado}, error=${data.error || 'ninguno'}`);
    } else {
      console.log(`  Registro ${plat} falló (sin respuesta JSON, posible 500)`);
    }
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
  const plat = SESSION.plataforma || 'android';
  const params = {
    accion: 'acceso',
    uid: SESSION.uid,
    plataforma: plat,
    tipo_dispositivo: plat,
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

  // Generar uid si no existe (simula Cordova device.uuid = Android ID)
  if (!SESSION.uid) {
    SESSION.uid = generateAndroidId();
    console.log(`  Nuevo uid generado: ${SESSION.uid}`);
  }

  // Si tenemos id_dispositivo, SIEMPRE renovar la key via accion=acceso.
  // NOTA: envivo/estadisticas.ashx devuelve JSON con cualquier key (válida o no),
  // por eso NO se usa como probe. La única forma confiable de saber si la key
  // funciona es intentar una llamada real a categoria.ashx o busqueda.ashx,
  // que sí retornan 500 con keys expiradas. Lo más simple: siempre refrescar.
  if (SESSION.id_dispositivo) {
    console.log('  Renovando key via accion=acceso (siempre al inicio)...');
    try {
      if (await accessExistingDevice()) {
        console.log('  Key renovada OK');
        return true;
      }
      console.log('  accion=acceso falló, intentando registrar dispositivo nuevo...');
    } catch (err) {
      console.error(`  Error en acceso: ${err.message}`);
    }
  }

  // No hay id_dispositivo o acceso falló → registrar dispositivo nuevo
  try {
    if (await registerNewDevice()) {
      return true;
    }
  } catch (err) {
    console.error(`  Error en registro: ${err.message}`);
  }

  console.error('\n  ======================================================');
  console.error('  ERROR: No se pudo obtener una key válida.');
  console.error('  ======================================================');
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

    // Detect expired/invalid session: session errors OR "Faltan parámetros" (invalid key)
    // "Error en la consulta" is a server-side data error, NOT a session error
    const sessionExpired = data && data.resultado === 'error' &&
      (data.error === 'Sesión caducada' || data.error === 'Sesion caducada' ||
       data.error === 'Faltan parámetros' || data.error === 'Faltan parametros');

    if (sessionExpired) {
      console.log(`  Sesión inválida (${data.error}), renovando key...`);
      SESSION.key = '';
      if (SESSION.id_dispositivo) {
        await accessExistingDevice();
      } else {
        await registerNewDevice();
      }
      if (!SESSION.key) {
        console.error('  ERROR: No se pudo renovar la key.');
        console.error('  Necesitas extraer credenciales del celular.');
        console.error('  Correr: node extract_phone_key.js');
        return null;
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
    accion: 'fasesGrupos',
    id_categoria_competicion: idCategoriaCompeticion,
  });
  return data;
}

async function getClasificacion(idGrupo, tipoFase, jornada, ventana) {
  console.log(`\n--- Obteniendo clasificación (grupo=${idGrupo}, tipo_fase=${tipoFase}) ---`);
  const data = await apiCall('categoria.ashx', {
    accion: 'clasificacion',
    id_grupo: idGrupo || '',
    tipo_fase: tipoFase || '',
    jornada: jornada || '',
    ventana: ventana || '',
  });
  return data;
}

async function getJornadas(idFase, idGrupo, idRonda) {
  console.log(`\n--- Obteniendo Jornadas (fase=${idFase}, grupo=${idGrupo}, ronda=${idRonda}) ---`);
  const data = await apiCall('categoria.ashx', {
    accion: 'Jornadas',
    id_fase: idFase || '',
    id_grupo: idGrupo || '',
    id_ronda: idRonda || '',
  });
  return data;
}

async function getHorariosJornadas(idFase, idGrupo) {
  console.log(`\n--- Obteniendo horariosJornadas (fase=${idFase}, grupo=${idGrupo}) ---`);
  const data = await apiCall('categoria.ashx', {
    accion: 'horariosJornadas',
    id_fase: idFase || '',
    id_grupo: idGrupo || '',
  });
  return data;
}

/**
 * Decodifica un Id hex-encoded UTF-16LE al string original.
 * Ej: "5A002B004C00..." → "Z+LhPoi5BzD6ntZ1qSj+oQ=="
 * El APK almacena los IDs como strings decodificados y los manda tal cual al servidor.
 * envivo/estadisticas.ashx espera el valor decodificado (500 si se manda el hex crudo).
 * categoria.ashx y otros endpoints sí aceptan el hex crudo.
 */
function decodeHexUTF16LE(hex) {
  let result = '';
  for (let i = 0; i + 3 < hex.length; i += 4) {
    const lo = parseInt(hex.slice(i, i + 2), 16);
    const hi = parseInt(hex.slice(i + 2, i + 4), 16);
    result += String.fromCharCode((hi << 8) | lo);
  }
  return result;
}

async function getEstadisticasPartido(idPartido) {
  console.log(`  Obteniendo box score partido ${idPartido.substring(0, 20)}...`);
  // NOTA: el APK usa 'id_partido' con el valor DECODIFICADO del hex UTF-16LE
  // Deobfuscado de PevCargarEstadisticas en main.b3d70c09e1bc11b9.js:
  //   params = { id_dispositivo, key, id_partido: partido.IdPartido.toString() }
  // partido.IdPartido en el app ya viene decodificado; nosotros lo tenemos en hex.
  const idDecodificado = decodeHexUTF16LE(idPartido);
  const data = await apiCall('envivo/estadisticas.ashx', {
    id_partido: idDecodificado,
  });
  return data;
}

// NOTA: equipo.ashx, jugadores.ashx, estadisticas.ashx, partido.ashx → retornan 404
// NOTA: categoria.ashx mejoresJugadores → retorna 500 (bug del servidor)
// NOTA: categoria.ashx estadisticasEquipo → retorna error "Faltan parámetros"
// Los top players y stats por equipo se computan desde los box scores en build_data.js

async function buscar(tipo, texto) {
  console.log(`\n--- Buscando ${tipo}: "${texto}" ---`);
  const data = await apiCall('busqueda.ashx', {
    accion: `buscar${tipo.charAt(0).toUpperCase() + tipo.slice(1)}`,
    texto: texto,
    skip: 0,
  });
  return data;
}

/**
 * NOTA: Los IDs de la API (id_categoria_competicion, IdFase, IdGrupo, etc.)
 * son strings hex-encoded UTF-16LE (ej: "66006D007A00...").
 * Estos IDs deben enviarse TAL CUAL a la API, sin decodificar.
 * La función decodeHexId anterior los decodificaba a base64, lo cual era incorrecto
 * y causaba que fasesGrupos devolviera datos vacíos.
 */

/**
 * Procesa una competición: obtiene fases/grupos, clasificación, partidos y estadísticas.
 */
async function scrapeCompeticion(comp) {
  // La API requiere el Id hex-encoded RAW, NO decodificado ni el numérico
  const compId = comp.Id; // hex-encoded UTF-16LE string - enviar TAL CUAL
  const compIdNumeric = comp.IdCompeticionCategoria; // numeric, for filenames only
  const compName = `${comp.NombreCompeticion} - ${comp.NombreCategoria}`;
  const compIdSafe = String(compIdNumeric).replace(/[^a-zA-Z0-9]/g, '_');

  console.log(`  Id hex: ${compId?.substring(0, 40)}...`);

  console.log(`\n========================================`);
  console.log(`  Competición: ${compName} (id=${compIdNumeric})`);
  console.log(`========================================`);

  // 1. Obtener fases y grupos (enviar hex Id raw, NO decodificado)
  let fasesGrupos = await getFasesGrupos(compId);
  await sleep(DELAY_MS);

  if (!fasesGrupos) {
    // Fallback: leer caché si el endpoint falla (bug del servidor)
    try {
      fasesGrupos = JSON.parse(fs.readFileSync(path.join(DATA_DIR, `fases_grupos_${compIdSafe}.json`), 'utf8'));
      console.log(`  Usando caché: fases_grupos_${compIdSafe}.json`);
    } catch {}
  }

  if (!fasesGrupos) {
    console.log('  No se pudieron obtener fases/grupos');
    return null;
  }

  saveData(`fases_grupos_${compIdSafe}.json`, fasesGrupos);

  // La respuesta de fasesGrupos tiene: { faseActual, grupoActual, listaFasesGrupo: [...] }
  // Cada elemento de listaFasesGrupo tiene:
  //   { IdFase (hex), NombreFase, TipoFase, Grupos: [{IdGrupo (hex), NombreGrupo}], Rondas: [] }
  // NOTA: Los IdFase, IdGrupo son hex-encoded como el Id de competición
  const listaFases = fasesGrupos.listaFasesGrupo || [];
  const faseActual = fasesGrupos.faseActual;
  const grupoActual = fasesGrupos.grupoActual;
  const rondaActual = fasesGrupos.rondaActual || '';

  // Construir lista de combinaciones fase/grupo a scrapear
  const fasesGruposToScrape = [];

  if (listaFases.length > 0) {
    // Hay fases/grupos explícitos
    for (const fase of listaFases) {
      const faseId = fase.IdFase || fase.Id;
      const faseName = fase.NombreFase || fase.Nombre || `Fase ${faseId}`;

      // Filtrar por whitelist de fases
      const phaseMatch = INCLUDED_PHASE_GROUPS.find(pg =>
        faseName.toUpperCase().includes(pg.fase.toUpperCase())
      );
      if (!phaseMatch) {
        console.log(`  [SKIP] Fase no incluida: ${faseName}`);
        continue;
      }

      // TipoFase viene dentro de cada fase (ej: "LIGA"), no en el top-level
      const tipoFase = fase.TipoFase || fase.tipoFase || '';
      const grupos = fase.Grupos || fase.ListaGrupos || [];
      if (grupos.length > 0) {
        for (const grupo of grupos) {
          const grupoName = grupo.NombreGrupo || grupo.Nombre || 'Default';
          // Filtrar por whitelist de grupos
          if (!grupoName.toUpperCase().includes(phaseMatch.grupo.toUpperCase())) {
            console.log(`  [SKIP] Grupo no incluido: ${faseName} / ${grupoName}`);
            continue;
          }
          fasesGruposToScrape.push({
            faseId, faseName, tipoFase,
            grupoId: grupo.IdGrupo || grupo.Id,
            grupoName,
          });
        }
      } else {
        // Fase sin grupos explícitos - incluir si la fase pasó el filtro
        fasesGruposToScrape.push({ faseId, faseName, tipoFase, grupoId: '', grupoName: 'Único' });
      }
    }
  } else if (faseActual) {
    // No hay lista pero hay faseActual/grupoActual del servidor
    fasesGruposToScrape.push({
      faseId: faseActual, faseName: `Fase ${faseActual}`,
      tipoFase: fasesGrupos.tipoFase || '',
      grupoId: grupoActual || '', grupoName: grupoActual ? `Grupo ${grupoActual}` : 'Único',
    });
  } else {
    // Sin fases ni grupos - intentar con valores vacíos
    console.log('  Sin fases/grupos configurados, intentando con params vacíos...');
    fasesGruposToScrape.push({ faseId: '', faseName: 'Default', tipoFase: '', grupoId: '', grupoName: 'Default' });
  }

  console.log(`  Combinaciones fase/grupo a scrapear: ${fasesGruposToScrape.length}`);

  const results = { competicion: compName, compId: compIdNumeric, fases: [] };

  let fgIdx = 0;
  for (const { faseId, faseName, tipoFase, grupoId, grupoName } of fasesGruposToScrape) {
      fgIdx++;
      // Usar nombre legible para archivos (los hex ids son demasiado largos)
      const faseTag = faseName.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30);
      const grupoTag = grupoName.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 20);
      const fileTag = `${compIdSafe}_${faseTag}_${grupoTag}`;

      console.log(`\n  [${fgIdx}/${fasesGruposToScrape.length}] Fase: ${faseName}`);
      console.log(`    Grupo: ${grupoName} (tipo_fase=${tipoFase})`);

      // 2. horariosJornadas - gets ALL matches with full details (teams, dates, venues)
      // Requires id_fase + id_grupo (discovered from APK string table)
      let horarios = await getHorariosJornadas(faseId, grupoId);
      if (horarios && horarios.resultado !== 'error') {
        saveData(`horarios_${fileTag}.json`, horarios);
        const numPartidos = horarios.partidos ? horarios.partidos.length : 0;
        console.log(`    Horarios OK: ${numPartidos} partidos`);
      } else {
        // Fallback: usar caché
        try {
          horarios = JSON.parse(fs.readFileSync(path.join(DATA_DIR, `horarios_${fileTag}.json`), 'utf8'));
          console.log(`    Horarios: usando caché (${horarios.partidos?.length || 0} partidos)`);
        } catch { horarios = null; }
        if (!horarios) console.log(`    Horarios: sin datos o error`, horarios ? JSON.stringify(horarios).substring(0, 200) : 'null');
      }
      await sleep(DELAY_MS);

      // 3. Jornadas (list of matchday dates/IDs)
      let jornadas = await getJornadas(faseId, grupoId, rondaActual);
      if (jornadas && jornadas.resultado !== 'error') {
        saveData(`jornadas_${fileTag}.json`, jornadas);
        console.log(`    Jornadas OK: resultado=${jornadas.resultado}`);
      } else {
        // Fallback: usar caché
        try {
          jornadas = JSON.parse(fs.readFileSync(path.join(DATA_DIR, `jornadas_${fileTag}.json`), 'utf8'));
          console.log(`    Jornadas: usando caché`);
        } catch { jornadas = null; }
        if (!jornadas) console.log(`    Jornadas: sin datos o error`, jornadas ? JSON.stringify(jornadas).substring(0, 200) : 'null');
      }
      await sleep(DELAY_MS);

      // 4. Clasificación (standings) - may be empty until matches are played
      let clasificacion = await getClasificacion(grupoId, tipoFase, '', '');
      if (clasificacion && clasificacion.resultado !== 'error') {
        saveData(`clasificacion_${fileTag}.json`, clasificacion);
        console.log(`    Clasificación OK: resultado=${clasificacion.resultado}`);
      } else {
        // Fallback: usar caché
        try {
          clasificacion = JSON.parse(fs.readFileSync(path.join(DATA_DIR, `clasificacion_${fileTag}.json`), 'utf8'));
          console.log(`    Clasificación: usando caché`);
        } catch { clasificacion = null; }
        if (!clasificacion) console.log(`    Clasificación: sin datos o error (normal if season not started)`);
      }
      await sleep(DELAY_MS);

      // 5. Estadísticas individuales de partidos (incremental)
      // Usa envivo/estadisticas.ashx que retorna box scores completos.
      // NOTA: cuando categoria.ashx falla (500), los horarios vienen del caché
      // y pueden tener Estado="No comenzado" aunque el partido ya se jugó.
      // Por eso intentamos TODOS los partidos del horario: los no jugados
      // retornarán estadisticas vacías y los jugados tendrán datos reales.
      const todosDesdeHorarios = (horarios && horarios.partidos || []);
      const todosDesdeJornadas = jornadas ? extractPartidos(jornadas) : [];

      // Combinar y deduplicar por IdPartido
      const allFinalizados = new Map();
      for (const p of [...todosDesdeHorarios, ...todosDesdeJornadas]) {
        const pid = p.IdPartido || p.Id || p.id;
        if (pid) allFinalizados.set(pid, p);
      }

      const totalFinalizados = allFinalizados.size;
      let nuevos = 0;
      let skipped = 0;

      for (const [partidoId, partido] of allFinalizados) {
        // Chequear si ya está en la BD local → skip
        if (DB.matchStats[partidoId]) {
          skipped++;
          continue;
        }

        nuevos++;
        const stats = await getEstadisticasPartido(partidoId);
        // Solo guardar si el partido tiene datos reales de jugadores
        // (los partidos no jugados devuelven estadisticasequipolocal vacío o error)
        const tieneJugadores = stats && stats.estadisticas &&
          Object.keys(stats.estadisticas.estadisticasequipolocal || {}).length > 0;
        if (tieneJugadores) {
          // Guardar en BD con metadata del partido
          DB.matchStats[partidoId] = {
            ...stats,
            _meta: {
              compId: compIdNumeric,
              compName,
              faseName,
              grupoName,
              home: partido.NombreEquipoLocal || partido.EquipoLocal || '',
              away: partido.NombreEquipoVisitante || partido.EquipoVisitante || '',
              date: partido.Fecha || '',
              scrapedAt: new Date().toISOString(),
            },
          };
        }
        await sleep(DELAY_MS);
      }

      const conStats = Object.values(DB.matchStats).filter(m => m._meta?.faseName === faseName && m._meta?.grupoName === grupoName).length;
      console.log(`    Partidos procesados: ${allFinalizados.size} total, ${nuevos} nuevos consultados, ${skipped} ya en BD, ${conStats} con stats`);

      // NOTA: mejoresJugadores y estadisticasEquipo vía API no funcionan
      // (500 y "Faltan parámetros" respectivamente).
      // Los top players y stats por equipo se computan desde los box scores en build_data.js

      // Guardar BD periódicamente (cada fase/grupo)
      saveDB();

      results.fases.push({ faseId, faseName, tipoFase, grupoId, grupoName, clasificacion, jornadas });
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
  // Jornadas response: extract partidos from all jornadas
  if (datos.ListaJornadas) {
    const allPartidos = [];
    for (const jornada of datos.ListaJornadas) {
      const partidos = jornada.ListaPartidos || jornada.Partidos || [];
      allPartidos.push(...partidos);
    }
    return allPartidos;
  }
  if (datos.listaJornadas) {
    const allPartidos = [];
    for (const jornada of datos.listaJornadas) {
      const partidos = jornada.listaPartidos || jornada.partidos || [];
      allPartidos.push(...partidos);
    }
    return allPartidos;
  }
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
  loadDB();

  // Paso 0: Registrar dispositivo
  const authOk = await registerDevice();
  if (!authOk) {
    console.error('\nAbortando: sin credenciales válidas. Correr: node extract_phone_key.js');
    process.exit(1);
  }
  console.log(`  URL dinámica activa: ${BASE_URL_DYNAMIC}`);
  await sleep(DELAY_MS);

  // Paso 1: Buscar competiciones de FEBAMBA via búsqueda
  // (categoria.ashx con accion=competiciones requiere parámetros adicionales,
  //  pero busqueda.ashx funciona directamente y devuelve las competiciones en "categorias")
  console.log('\n--- Buscando competiciones FEBAMBA ---');
  let busquedaBA = await buscar('Categoria', 'Buenos Aires');
  if (busquedaBA) {
    saveData('busqueda_buenos_aires.json', busquedaBA);
  } else {
    // Fallback: usar caché si busqueda.ashx no responde (server bug)
    let cached = null;
    try { cached = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'busqueda_buenos_aires.json'), 'utf8')); } catch {};
    if (cached) {
      console.log('  busqueda.ashx falló — usando caché de busqueda_buenos_aires.json');
      busquedaBA = cached;
    }
  }
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

  // Mostrar las competiciones encontradas y aplicar filtros
  console.log('\n  Competiciones encontradas:');
  for (const comp of febambaComps) {
    const included = INCLUDED_COMPETITIONS.some(inc =>
      comp.NombreCompeticion?.toUpperCase().includes(inc.toUpperCase())
    );
    const marker = included ? '[OK]' : '[SKIP]';
    console.log(`  ${marker} [${comp.IdCompeticionCategoria}] ${comp.NombreCompeticion} / ${comp.NombreCategoria}`);
  }

  // Paso 2: Filtrar por whitelist y scrapear solo las competencias incluidas
  const targetComps = febambaComps.filter(c =>
    INCLUDED_COMPETITIONS.some(inc =>
      c.NombreCompeticion?.toUpperCase().includes(inc.toUpperCase())
    )
  );

  console.log(`\n--- Scrapeando ${targetComps.length} competiciones (excluidas: ${febambaComps.length - targetComps.length}) ---`);

  // Limpiar cache de las competencias a scrapear para forzar re-consulta completa
  const targetCompNames = targetComps.map(c => `${c.NombreCompeticion} - ${c.NombreCategoria}`);
  const antesDeEliminar = Object.keys(DB.matchStats).length;
  for (const [partidoId, match] of Object.entries(DB.matchStats)) {
    if (targetCompNames.includes(match._meta?.compName)) {
      delete DB.matchStats[partidoId];
    }
  }
  const eliminados = antesDeEliminar - Object.keys(DB.matchStats).length;
  if (eliminados > 0) {
    console.log(`  Cache limpiado: ${eliminados} partidos eliminados de las competencias a scrapear`);
  }

  for (const comp of targetComps) {
    try {
      await scrapeCompeticion(comp);
    } catch (err) {
      console.error(`  Error scrapeando ${comp.NombreCompeticion}: ${err.message}`);
    }
    await sleep(DELAY_MS);
  }

  // Guardar BD final
  saveDB();

  // Paso 3: Resumen
  console.log('\n===========================================');
  console.log(' Scraping completado!');
  console.log('===========================================');
  console.log(`Archivos guardados en: ${DATA_DIR}/`);
  console.log(`BD local: ${Object.keys(DB.matchStats || {}).length} partidos con box score`);

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
