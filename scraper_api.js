/**
 * Scraper para la API de Indalweb/GesDeportiva - CABB/FEBAMBA
 * Usa la API directa descubierta desde el APK de la app CABB
 *
 * IMPORTANTE: La API usa POST con Content-Type: application/x-www-form-urlencoded
 * (descubierto deofuscando el método GetJSON del APK)
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
const BASE_URL = 'https://appaficioncabb.indalweb.net/v2';
const DATA_DIR = path.join(__dirname, 'data');
const SESSION_FILE = path.join(__dirname, 'data', '.session.json');
const DELAY_MS = 1500;

// Versión de la app: 4.0.44 → versionAPPNumerico = 040044 → parseInt = 40044
const APP_VERSION = '40044';

let SESSION = {
  id_dispositivo: '', // Se genera como base64(random 64 bytes) al estilo real
  key: '',
  uid: '',
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
 * Hacer una llamada POST con application/x-www-form-urlencoded
 * Así es como la app real hace las llamadas (método GetJSON deofuscado)
 */
async function postAPI(url, params) {
  const body = new URLSearchParams(params).toString();
  console.log(`  POST ${url}`);
  console.log(`  Body: ${body.substring(0, 200)}${body.length > 200 ? '...' : ''}`);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json, text/plain, */*',
      'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36',
    },
    body: body,
  });

  if (!response.ok) {
    console.error(`  Error HTTP ${response.status}: ${response.statusText}`);
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
 * Paso 0: Registrar dispositivo y obtener id_dispositivo + key
 */
async function registerDevice() {
  console.log('\n--- Registrando dispositivo ---');

  if (loadSession() && SESSION.id_dispositivo && SESSION.key) {
    console.log('  Usando sesión previa');
    return true;
  }

  if (!SESSION.uid) SESSION.uid = crypto.randomUUID().replace(/-/g, '').substring(0, 16);
  if (!SESSION.id_dispositivo) {
    // Generar id_dispositivo como base64 de 64 bytes random (formato real de la app)
    const randomBytes = crypto.randomBytes(64);
    SESSION.id_dispositivo = randomBytes.toString('base64');
  }
  console.log(`  id_dispositivo: ${SESSION.id_dispositivo}`);
  console.log(`  uid: ${SESSION.uid}`);

  // Llamar a dispositivo.ashx con POST (como lo hace la app real)
  const url = `${BASE_URL_STATIC}/dispositivo.ashx`;
  const params = {
    accion: 'acceso',
    uid: SESSION.uid,
    plataforma: 'android',
    tipo_dispositivo: 'mobile',  // mitmproxy: "mobile" no "android"
    id_dispositivo: SESSION.id_dispositivo,
    token_push: '',
    version: APP_VERSION,
  };

  try {
    const data = await postAPI(url, params);
    if (data) {
      saveData('debug_registro.json', data);

      if (data.resultado === 'correcto' || data.key) {
        SESSION.key = data.key || '';
        if (data.id_dispositivo) SESSION.id_dispositivo = data.id_dispositivo;
        saveSession();
        console.log(`  Dispositivo registrado! id=${SESSION.id_dispositivo}, key=${SESSION.key ? 'OK' : 'vacía'}`);
        return true;
      }
      console.log(`  Resultado: ${data.resultado || 'desconocido'}, error: ${data.error || 'ninguno'}`);
    }
  } catch (err) {
    console.error(`  Error de red: ${err.message}`);
  }

  console.log('  No se obtuvo key, intentando sin key...');
  return SESSION.id_dispositivo ? true : false;
}

/**
 * Llamada genérica a la API usando POST
 */
async function apiCall(endpoint, params = {}, baseUrl = BASE_URL) {
  const url = `${baseUrl}/${endpoint}`;

  // Agregar parámetros de sesión
  if (SESSION.id_dispositivo) {
    params.id_dispositivo = params.id_dispositivo || SESSION.id_dispositivo;
  }
  if (SESSION.key) {
    params.key = params.key || SESSION.key;
  }

  try {
    const data = await postAPI(url, params);

    // CRÍTICO: Key rotativa - cada response trae una nueva key
    if (data && data.key) {
      SESSION.key = data.key;
      saveSession();
    }

    if (data && data.resultado === 'error' && data.error === 'Sesión caducada') {
      console.log('  Sesión caducada, re-registrando...');
      SESSION.key = '';
      await registerDevice();
      return apiCall(endpoint, params, baseUrl);
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

// ============================================================
// Flujo principal
// ============================================================
async function main() {
  console.log('===========================================');
  console.log(' Scraper API CABB/FEBAMBA - Indalweb');
  console.log('===========================================');
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Data dir: ${DATA_DIR}`);
  console.log(`Método: POST (application/x-www-form-urlencoded)`);

  ensureDataDir();

  // Paso 0: Registrar dispositivo
  await registerDevice();
  await sleep(DELAY_MS);

  // Paso 1: Obtener delegaciones
  console.log('\n--- Obteniendo delegaciones ---');
  let delegaciones = await apiCall('delegaciones.ashx', { accion: 'delegaciones' });
  if (!delegaciones || delegaciones.resultado === 'error') {
    delegaciones = await apiCall('delegaciones.ashx', { accion: 'delegaciones' }, BASE_URL_STATIC);
  }
  if (delegaciones) saveData('delegaciones.json', delegaciones);
  await sleep(DELAY_MS);

  // Paso 2: Obtener competiciones
  const competiciones = await getCompeticiones();
  await sleep(DELAY_MS);

  if (!competiciones || competiciones.resultado === 'error') {
    console.log('\nProbando variantes de endpoints...');

    const probes = [
      ['categoria.ashx', { accion: 'competiciones' }, BASE_URL],
      ['categoria.ashx', { accion: 'competiciones' }, BASE_URL_STATIC],
      ['categoria.ashx', { accion: 'categorias' }, BASE_URL],
    ];

    for (const [endpoint, params, base] of probes) {
      console.log(`\nProbando ${base}/${endpoint}?accion=${params.accion}...`);
      const result = await apiCall(endpoint, params, base);
      if (result) {
        saveData(`probe_${params.accion}_${base === BASE_URL ? 'v2' : 'static'}.json`, result);
        if (result.resultado === 'correcto') {
          console.log('  Encontrado endpoint funcional!');
        }
      }
      await sleep(DELAY_MS);
    }
  }

  // Paso 3: Si tenemos competiciones, obtener fases/grupos
  if (competiciones && Array.isArray(competiciones.datos)) {
    const febambaComps = competiciones.datos.filter(c =>
      c.NombreDelegacion?.includes('Buenos Aires') ||
      c.NombreCompeticion?.includes('FEBAMBA') ||
      c.Delegacion?.includes('Buenos Aires')
    );

    const targetComps = febambaComps.length > 0 ? febambaComps : competiciones.datos.slice(0, 3);

    for (const comp of targetComps) {
      const compId = comp.IdCategoriaCompeticion || comp.Id || comp.id;
      if (!compId) continue;

      console.log(`\nCompeticion: ${comp.NombreCompeticion || comp.Nombre || JSON.stringify(comp)}`);

      const fasesGrupos = await getFasesGrupos(compId);
      await sleep(DELAY_MS);

      if (fasesGrupos && fasesGrupos.datos) {
        saveData(`fases_grupos_${compId}.json`, fasesGrupos);

        const fases = fasesGrupos.datos.ListaFases || fasesGrupos.datos.Fases || [fasesGrupos.datos];
        for (const fase of (Array.isArray(fases) ? fases : [fases])) {
          const faseId = fase.IdFase || fase.Id;
          const grupos = fase.ListaGrupos || fase.Grupos || [fase];

          for (const grupo of (Array.isArray(grupos) ? grupos : [grupos])) {
            const grupoId = grupo.IdGrupo || grupo.Id;

            const clasificacion = await getClasificacion(compId, faseId, grupoId);
            if (clasificacion) saveData(`clasificacion_${compId}_${faseId}_${grupoId}.json`, clasificacion);
            await sleep(DELAY_MS);

            const partidos = await getPartidos(compId, faseId, grupoId);
            if (partidos) saveData(`partidos_${compId}_${faseId}_${grupoId}.json`, partidos);
            await sleep(DELAY_MS);

            if (partidos && partidos.datos) {
              const listaPartidos = Array.isArray(partidos.datos) ? partidos.datos : partidos.datos.ListaPartidos || [];
              const partidosConStats = listaPartidos
                .filter(p => p.Estado === 'Finalizado' || p.Terminado || p.estado === 'finalizado')
                .slice(0, 3);

              for (const partido of partidosConStats) {
                const partidoId = partido.IdPartido || partido.Id || partido.id;
                if (!partidoId) continue;

                const stats = await getEstadisticasPartido(partidoId);
                if (stats) saveData(`stats_partido_${partidoId}.json`, stats);
                await sleep(DELAY_MS);
              }
            }
          }
        }
      }
    }
  }

  // Paso 4: Búsquedas
  console.log('\n--- Búsquedas ---');

  const busquedaFebamba = await buscar('Categoria', 'FEBAMBA');
  if (busquedaFebamba) saveData('busqueda_febamba.json', busquedaFebamba);
  await sleep(DELAY_MS);

  const busquedaBA = await buscar('Categoria', 'Buenos Aires');
  if (busquedaBA) saveData('busqueda_buenos_aires.json', busquedaBA);

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
