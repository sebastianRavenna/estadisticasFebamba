/**
 * Scraper para la API de Indalweb/GesDeportiva - CABB/FEBAMBA
 * Usa la API directa descubierta desde el APK de la app CABB
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
const DELAY_MS = 1500; // Pausa entre requests para no sobrecargar

// Sesión (se llena después de registrar dispositivo)
// id_dispositivo obtenido de la app CABB real instalada en el celular
let SESSION = {
  id_dispositivo: '07f2c40994f8705d',
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
 * Paso 0: Registrar dispositivo y obtener id_dispositivo + key
 * Simula lo que hace la app al abrirse por primera vez
 */
async function registerDevice() {
  console.log('\n--- Registrando dispositivo ---');

  // Intentar cargar sesión previa con key válida
  if (loadSession() && SESSION.id_dispositivo && SESSION.key) {
    console.log('  Usando sesión previa');
    return true;
  }

  // Usar el id_dispositivo real del celular
  if (!SESSION.uid) SESSION.uid = crypto.randomUUID();
  console.log(`  id_dispositivo: ${SESSION.id_dispositivo}`);

  // Llamar a dispositivo.ashx con accion=acceso
  // Parámetros decodificados del APK ofuscado:
  //   accion, uid, plataforma, tipo_dispositivo, id_dispositivo, token_push, version
  const url = new URL(`${BASE_URL_STATIC}/dispositivo.ashx`);
  url.searchParams.set('accion', 'acceso');
  url.searchParams.set('uid', SESSION.uid);
  url.searchParams.set('plataforma', 'android');
  url.searchParams.set('tipo_dispositivo', 'android');
  url.searchParams.set('id_dispositivo', SESSION.id_dispositivo);
  url.searchParams.set('token_push', '');
  url.searchParams.set('version', '40044');

  console.log(`  GET ${url.pathname}?${url.searchParams.toString()}`);

  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Accept': 'application/json, text/plain, */*',
        'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36',
      },
    });

    const text = await response.text();
    console.log(`  Respuesta registro (${response.status}): ${text.substring(0, 800)}`);

    try {
      const data = JSON.parse(text);
      if (data.resultado === 'ok' || data.key) {
        SESSION.key = data.key || '';
        if (data.id_dispositivo) SESSION.id_dispositivo = data.id_dispositivo;
        saveSession();
        console.log(`  Dispositivo registrado: id=${SESSION.id_dispositivo}, key=${SESSION.key ? 'OK' : 'vacía'}`);
        return true;
      }
      console.log(`  Resultado: ${data.resultado || 'desconocido'}, error: ${data.error || 'ninguno'}`);
      // Guardar la respuesta completa para debug
      saveData('debug_registro.json', data);
    } catch {
      console.log(`  Respuesta no-JSON`);
    }
  } catch (err) {
    console.error(`  Error de red: ${err.message}`);
  }

  // Si no obtuvimos key, seguir intentando con los endpoints sin key
  // Algunos endpoints pueden funcionar solo con id_dispositivo
  console.log('  No se obtuvo key, intentando sin key...');
  return SESSION.id_dispositivo ? true : false;
}

async function apiCall(endpoint, params = {}, baseUrl = BASE_URL) {
  const url = new URL(`${baseUrl}/${endpoint}`);

  // Agregar parámetros de sesión
  if (SESSION.id_dispositivo) {
    params.id_dispositivo = params.id_dispositivo || SESSION.id_dispositivo;
  }
  if (SESSION.key) {
    params.key = params.key || SESSION.key;
  }

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }

  console.log(`  GET ${url.pathname}?${url.searchParams.toString()}`);

  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Accept': 'application/json, text/plain, */*',
        'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36',
      },
    });

    if (!response.ok) {
      console.error(`  Error HTTP ${response.status}: ${response.statusText}`);
      return null;
    }

    const text = await response.text();

    // Intentar parsear como JSON
    try {
      const data = JSON.parse(text);
      // Si la sesión expiró, intentar re-registrar
      if (data.resultado === 'error' && data.error === 'Sesión caducada') {
        console.log('  Sesión caducada, re-registrando...');
        SESSION.id_dispositivo = '';
        SESSION.key = '';
        await registerDevice();
        // Reintentar la llamada
        return apiCall(endpoint, params, baseUrl);
      }
      return data;
    } catch {
      console.log(`  Respuesta no-JSON (${text.length} chars): ${text.substring(0, 200)}`);
      return { _raw: text };
    }
  } catch (err) {
    console.error(`  Error de red: ${err.message}`);
    return null;
  }
}

// ============================================================
// Funciones de scraping
// ============================================================

/**
 * 1. Obtener lista de delegaciones (federaciones provinciales)
 */
async function getDelegaciones() {
  console.log('\n--- Obteniendo delegaciones ---');
  const data = await apiCall('delegaciones.ashx', { accion: 'delegaciones' });
  if (data) saveData('delegaciones.json', data);
  return data;
}

/**
 * 2. Obtener competiciones/categorías
 */
async function getCompeticiones(params = {}) {
  console.log('\n--- Obteniendo competiciones ---');
  const data = await apiCall('categoria.ashx', {
    accion: 'competiciones',
    ...params,
  });
  if (data) saveData('competiciones.json', data);
  return data;
}

/**
 * 3. Obtener fases y grupos de una competición
 */
async function getFasesGrupos(idCategoriaCompeticion) {
  console.log(`\n--- Obteniendo fases/grupos para competicion ${idCategoriaCompeticion} ---`);
  const data = await apiCall('categoria.ashx', {
    accion: 'fasesGruposCompeticion',
    id_categoria_competicion: idCategoriaCompeticion,
  });
  return data;
}

/**
 * 4. Obtener clasificación (tabla de posiciones)
 */
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

/**
 * 5. Obtener jornadas/fechas
 */
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

/**
 * 6. Obtener lista de partidos
 */
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

/**
 * 7. Obtener detalle de un partido
 */
async function getPartido(idPartido) {
  console.log(`\n--- Obteniendo partido ${idPartido} ---`);
  const data = await apiCall('partido.ashx', {
    accion: 'partido',
    id_partido: idPartido,
  });
  return data;
}

/**
 * 8. Obtener estadísticas de un partido
 */
async function getEstadisticasPartido(idPartido) {
  console.log(`\n--- Obteniendo estadísticas partido ${idPartido} ---`);
  const data = await apiCall('estadisticas.ashx', {
    accion: 'estadisticas',
    id_partido: idPartido,
  });
  return data;
}

/**
 * 9. Obtener estadísticas de equipo en una competición
 */
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

/**
 * 10. Obtener estadísticas de un jugador
 */
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

/**
 * 11. Obtener detalle de equipo
 */
async function getEquipo(idEquipo) {
  console.log(`\n--- Obteniendo equipo ${idEquipo} ---`);
  const data = await apiCall('equipo.ashx', {
    accion: 'equipo',
    id_equipo: idEquipo,
  });
  return data;
}

/**
 * 12. Obtener jugadores de un equipo
 */
async function getJugadores(idEquipo, idCategoriaCompeticion) {
  console.log(`\n--- Obteniendo jugadores equipo ${idEquipo} ---`);
  const data = await apiCall('jugadores.ashx', {
    accion: 'jugadores',
    id_equipo: idEquipo,
    id_categoria_competicion: idCategoriaCompeticion,
  });
  return data;
}

/**
 * 13. Buscar
 */
async function buscar(tipo, texto) {
  console.log(`\n--- Buscando ${tipo}: "${texto}" ---`);
  const endpoint = 'busqueda.ashx';
  const data = await apiCall(endpoint, {
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

  ensureDataDir();

  // Paso 0: Registrar dispositivo
  const registered = await registerDevice();
  await sleep(DELAY_MS);

  // Paso 1: Obtener delegaciones (probar con y sin /v2/)
  console.log('\n--- Obteniendo delegaciones ---');
  let delegaciones = await apiCall('delegaciones.ashx', { accion: 'delegaciones' });
  if (!delegaciones || delegaciones.resultado === 'error') {
    // Probar sin /v2/
    delegaciones = await apiCall('delegaciones.ashx', { accion: 'delegaciones' }, BASE_URL_STATIC);
  }
  if (delegaciones) saveData('delegaciones.json', delegaciones);
  await sleep(DELAY_MS);

  // Paso 2: Obtener competiciones
  const competiciones = await getCompeticiones();
  await sleep(DELAY_MS);

  if (!competiciones || competiciones.resultado === 'error') {
    console.log('\nProbando variantes de endpoints...');

    // Probar diferentes endpoints y acciones
    const probes = [
      ['categoria.ashx', { accion: 'competiciones' }, BASE_URL],
      ['categoria.ashx', { accion: 'competiciones' }, BASE_URL_STATIC],
      ['categoria.ashx', { accion: 'categorias' }, BASE_URL],
      ['categoria.ashx', { accion: 'categorias' }, BASE_URL_STATIC],
    ];

    for (const [endpoint, params, base] of probes) {
      console.log(`\nProbando ${base}/${endpoint}?accion=${params.accion}...`);
      const result = await apiCall(endpoint, params, base);
      if (result) {
        saveData(`probe_${params.accion}_${base === BASE_URL ? 'v2' : 'static'}.json`, result);
        if (result.resultado === 'ok' || result.resultado !== 'error') {
          console.log('  Encontrado endpoint funcional!');
        }
      }
      await sleep(DELAY_MS);
    }
  }

  // Paso 3: Si tenemos competiciones, obtener fases/grupos de la primera
  if (competiciones && Array.isArray(competiciones.datos)) {
    // Buscar competiciones de FEBAMBA
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

      // Obtener fases y grupos
      const fasesGrupos = await getFasesGrupos(compId);
      await sleep(DELAY_MS);

      if (fasesGrupos && fasesGrupos.datos) {
        saveData(`fases_grupos_${compId}.json`, fasesGrupos);

        // Para cada fase/grupo, obtener clasificación y partidos
        const fases = fasesGrupos.datos.ListaFases || fasesGrupos.datos.Fases || [fasesGrupos.datos];
        for (const fase of (Array.isArray(fases) ? fases : [fases])) {
          const faseId = fase.IdFase || fase.Id;
          const grupos = fase.ListaGrupos || fase.Grupos || [fase];

          for (const grupo of (Array.isArray(grupos) ? grupos : [grupos])) {
            const grupoId = grupo.IdGrupo || grupo.Id;

            // Clasificación
            const clasificacion = await getClasificacion(compId, faseId, grupoId);
            if (clasificacion) saveData(`clasificacion_${compId}_${faseId}_${grupoId}.json`, clasificacion);
            await sleep(DELAY_MS);

            // Partidos
            const partidos = await getPartidos(compId, faseId, grupoId);
            if (partidos) saveData(`partidos_${compId}_${faseId}_${grupoId}.json`, partidos);
            await sleep(DELAY_MS);

            // Para los primeros 3 partidos, obtener estadísticas
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

  // Paso 4: Probe adicional - intentar obtener datos sin IDs específicos
  console.log('\n--- Probe adicional ---');

  // Próximos partidos
  const proximos = await apiCall('partidos.ashx', { accion: 'proximos' });
  if (proximos) saveData('proximos_partidos.json', proximos);
  await sleep(DELAY_MS);

  // Buscar FEBAMBA
  const busquedaFebamba = await buscar('Categoria', 'FEBAMBA');
  if (busquedaFebamba) saveData('busqueda_febamba.json', busquedaFebamba);
  await sleep(DELAY_MS);

  // Buscar Buenos Aires
  const busquedaBA = await buscar('Categoria', 'Buenos Aires');
  if (busquedaBA) saveData('busqueda_buenos_aires.json', busquedaBA);

  console.log('\n===========================================');
  console.log(' Scraping completado!');
  console.log('===========================================');
  console.log(`Archivos guardados en: ${DATA_DIR}/`);

  // Listar archivos generados
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
