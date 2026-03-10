/**
 * Scraper para la API de Indalweb/GesDeportiva - CABB/FEBAMBA
 * Usa la API directa descubierta desde el APK de la app CABB
 *
 * Uso: node scraper_api.js
 * Genera archivos JSON en data/
 */

const fs = require('fs');
const path = require('path');

// ============================================================
// Configuración
// ============================================================
const BASE_URL = 'https://appaficioncabb.indalweb.net/v2';
const DATA_DIR = path.join(__dirname, 'data');
const DELAY_MS = 1500; // Pausa entre requests para no sobrecargar

// ID de dispositivo ficticio (la API lo requiere)
const DEVICE_ID = 'scraper_febamba_' + Date.now();

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

async function apiCall(endpoint, params = {}) {
  const url = new URL(`${BASE_URL}/${endpoint}`);

  // Agregar parámetros comunes
  params.id_dispositivo = params.id_dispositivo || DEVICE_ID;

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
      return JSON.parse(text);
    } catch {
      // Si no es JSON, devolver el texto
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

  // Paso 1: Obtener delegaciones
  const delegaciones = await getDelegaciones();
  await sleep(DELAY_MS);

  // Paso 2: Obtener competiciones
  const competiciones = await getCompeticiones();
  await sleep(DELAY_MS);

  if (!competiciones || competiciones.resultado === 'error') {
    console.log('\nLa API requiere parámetros adicionales. Probando variantes...');

    // Intentar con diferentes acciones
    for (const accion of ['competiciones', 'categorias', 'temporadas']) {
      console.log(`\nProbando accion=${accion}...`);
      const result = await apiCall('categoria.ashx', { accion });
      if (result && result.resultado !== 'error') {
        saveData(`probe_${accion}.json`, result);
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
