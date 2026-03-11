/**
 * Server para Dashboard FEBAMBA - Estadísticas de Básquet
 *
 * Sirve el dashboard y provee APIs para obtener datos scrapeados.
 * Usa solo módulos built-in de Node.js (http, fs, path).
 *
 * Uso: node server.js [port]
 * Default: http://localhost:3000
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const PORT = parseInt(process.env.PORT) || parseInt(process.argv[2]) || 3000;
const ROOT_DIR = __dirname;
const DATA_DIR = path.join(ROOT_DIR, 'data');

// MIME types
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// ============================================================
// Data conversion: raw CABB API → dashboard format
// ============================================================

/**
 * Parse CABB date format "/Date(1773532800000)/" → ISO string
 */
function parseCabbDate(dateStr) {
  if (!dateStr) return null;
  const m = dateStr.match(/\/Date\((\d+)\)\//);
  if (!m) return dateStr;
  return new Date(parseInt(m[1])).toISOString().split('T')[0];
}

/**
 * List available competitions from scraped data files
 */
function listCompetitions() {
  const busquedaFile = path.join(DATA_DIR, 'busqueda_buenos_aires.json');
  if (!fs.existsSync(busquedaFile)) return [];

  const busqueda = JSON.parse(fs.readFileSync(busquedaFile, 'utf8'));
  const categorias = busqueda.categorias || [];
  return categorias
    .filter(c => c.NombreDelegacion?.includes('METROPOLITANA') || c.NombreDelegacion?.includes('BUENOS AIRES'))
    .map(c => ({
      id: c.IdCompeticionCategoria,
      name: c.NombreCompeticion,
      category: c.NombreCategoria,
      delegacion: c.NombreDelegacion,
      hasData: fs.existsSync(path.join(DATA_DIR, `fases_grupos_${c.IdCompeticionCategoria}.json`)),
    }));
}

/**
 * List available fases/grupos for a competition
 */
function listFasesGrupos(compId) {
  const file = path.join(DATA_DIR, `fases_grupos_${compId}.json`);
  if (!fs.existsSync(file)) return [];

  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const fases = data.listaFasesGrupo || [];
  const result = [];

  for (const fase of fases) {
    const grupos = fase.Grupos || [];
    for (const grupo of grupos) {
      const faseTag = (fase.NombreFase || '').replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30);
      const grupoTag = (grupo.NombreGrupo || '').replace(/[^a-zA-Z0-9]/g, '_').substring(0, 20);
      const fileTag = `${compId}_${faseTag}_${grupoTag}`;

      result.push({
        faseId: fase.IdFase,
        faseName: fase.NombreFase,
        tipoFase: fase.TipoFase,
        grupoId: grupo.IdGrupo,
        grupoName: grupo.NombreGrupo,
        fileTag,
        hasClasificacion: fs.existsSync(path.join(DATA_DIR, `clasificacion_${fileTag}.json`)),
        hasJornadas: fs.existsSync(path.join(DATA_DIR, `jornadas_${fileTag}.json`)),
        hasHorarios: fs.existsSync(path.join(DATA_DIR, `horarios_${fileTag}.json`)),
      });
    }
  }

  return result;
}

/**
 * Build dashboard-format data for a specific competition + fase/grupo
 */
function buildDashboardData(compId, faseTag, grupoTag) {
  const fileTag = `${compId}_${faseTag}_${grupoTag}`;
  const comps = listCompetitions();
  const comp = comps.find(c => String(c.id) === String(compId)) || {};

  const result = {
    meta: {
      source: 'CABB/FEBAMBA - API Indalweb',
      generated: new Date().toISOString().split('T')[0],
      compId,
      faseTag,
      grupoTag,
    },
    competition: {
      id: comp.id || compId,
      name: comp.name || 'Competición',
      category: comp.category || '',
      season: '2026',
      delegacion: comp.delegacion || 'FEBAMBA',
    },
    standings: [],
    players: [],
    matches: [],
    schedule: [],
    teamColors: {},
  };

  // 1. Load clasificacion → standings
  const clasifFile = path.join(DATA_DIR, `clasificacion_${fileTag}.json`);
  if (fs.existsSync(clasifFile)) {
    const clasif = JSON.parse(fs.readFileSync(clasifFile, 'utf8'));
    if (clasif.resultado === 'correcto') {
      const lista = clasif.clasificacion || clasif.ListaClasificacion || clasif.datos || [];
      if (Array.isArray(lista)) {
        result.standings = lista.map((eq, idx) => ({
          pos: eq.Posicion || eq.posicion || idx + 1,
          team: eq.NombreEquipo || eq.Equipo || eq.nombreEquipo || '?',
          teamId: eq.IdEquipo || eq.idEquipo || '',
          pj: eq.PartidosJugados || eq.partidosJugados || 0,
          pg: eq.PartidosGanados || eq.partidosGanados || 0,
          pp: eq.PartidosPerdidos || eq.partidosPerdidos || 0,
          pf: eq.PuntosFavor || eq.puntosFavor || 0,
          pc: eq.PuntosContra || eq.puntosContra || 0,
          dif: (eq.PuntosFavor || 0) - (eq.PuntosContra || 0),
          pts: eq.Puntos || eq.puntos || 0,
          streak: '',
        }));
      }
    }
  }

  // 2. Load horarios → matches with full details (from horariosJornadas)
  const horariosFile = path.join(DATA_DIR, `horarios_${fileTag}.json`);
  if (fs.existsSync(horariosFile)) {
    const horarios = JSON.parse(fs.readFileSync(horariosFile, 'utf8'));
    if (horarios.partidos && Array.isArray(horarios.partidos)) {
      for (const p of horarios.partidos) {
        result.matches.push({
          id: p.IdPartido || '',
          matchday: p.NumeroJornada || 0,
          date: p.Fecha || '',
          time: p.Hora || '',
          home: p.NombreEquipoLocal || '?',
          homeClub: p.NombreClubLocal || '',
          away: p.NombreEquipoVisitante || '?',
          awayClub: p.NombreClubVisitante || '',
          homeScore: p.Resultados?.ResultadoLocal || null,
          awayScore: p.Resultados?.ResultadoVisitante || null,
          periodScores: p.Resultados?.ResultadosPeriodo || [],
          status: p.Estado || 'programado',
          venue: p.CampoJuego || '',
          address: p.DireccionCampo || '',
          hasVideo: p.Video || false,
          tipoActa: p.TipoActa || '',
        });
      }
    }
  }

  // 3. Load jornadas → schedule (matchday dates)
  const jornadasFile = path.join(DATA_DIR, `jornadas_${fileTag}.json`);
  if (fs.existsSync(jornadasFile)) {
    const jorn = JSON.parse(fs.readFileSync(jornadasFile, 'utf8'));
    const listaJ = jorn.ListaJornadas || jorn.listaJornadas || [];
    for (const j of listaJ) {
      result.schedule.push({
        matchday: j.NumeroJornada || j.numeroJornada || 0,
        date: parseCabbDate(j.FechaJornada || j.fechaJornada),
        idJornada: j.IdJornada || j.idJornada,
      });
    }
  }

  // 4. Fase/grupo metadata
  const fg = listFasesGrupos(compId);
  const currentFG = fg.find(f => {
    const ft = (f.faseName || '').replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30);
    const gt = (f.grupoName || '').replace(/[^a-zA-Z0-9]/g, '_').substring(0, 20);
    return ft === faseTag && gt === grupoTag;
  });

  if (currentFG) {
    result.competition.fase = currentFG.faseName;
    result.competition.grupo = currentFG.grupoName;
    result.competition.tipoFase = currentFG.tipoFase;
  }

  return result;
}

/**
 * Build aggregated dashboard data for a full competition (all fases/grupos combined)
 */
function buildFullCompetitionData(compId) {
  const fg = listFasesGrupos(compId);
  if (fg.length === 0) {
    // No fases/grupos - return basic structure
    const comps = listCompetitions();
    const comp = comps.find(c => String(c.id) === String(compId)) || {};
    return {
      meta: { source: 'CABB/FEBAMBA - API Indalweb', generated: new Date().toISOString().split('T')[0] },
      competition: { id: compId, name: comp.name || '', category: comp.category || '', season: '2026', delegacion: comp.delegacion || '' },
      standings: [], players: [], matches: [], schedule: [],
      fases: [],
      teamColors: {},
    };
  }

  // Use the first fase/grupo as default view
  const first = fg[0];
  const faseTag = (first.faseName || '').replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30);
  const grupoTag = (first.grupoName || '').replace(/[^a-zA-Z0-9]/g, '_').substring(0, 20);

  const data = buildDashboardData(compId, faseTag, grupoTag);

  // Add list of all available fases/grupos for navigation
  data.fases = fg.map(f => ({
    faseName: f.faseName,
    grupoName: f.grupoName,
    tipoFase: f.tipoFase,
    hasClasificacion: f.hasClasificacion,
    hasJornadas: f.hasJornadas,
    faseTag: (f.faseName || '').replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30),
    grupoTag: (f.grupoName || '').replace(/[^a-zA-Z0-9]/g, '_').substring(0, 20),
  }));

  return data;
}

// ============================================================
// HTTP Server
// ============================================================

let scrapeProcess = null;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // ---- API Routes ----

  // GET /api/competitions - List available competitions
  if (pathname === '/api/competitions') {
    const comps = listCompetitions();
    sendJSON(res, { competitions: comps });
    return;
  }

  // GET /api/fases?comp=5074 - List fases/grupos for a competition
  if (pathname === '/api/fases') {
    const compId = url.searchParams.get('comp');
    if (!compId) return sendJSON(res, { error: 'Missing comp parameter' }, 400);
    const fases = listFasesGrupos(compId);
    sendJSON(res, { fases });
    return;
  }

  // GET /api/data?comp=5074 - Get dashboard data for default fase/grupo
  // GET /api/data?comp=5074&fase=RECLASIFICACION_SUPERIOR&grupo=NORTE_1
  if (pathname === '/api/data') {
    const compId = url.searchParams.get('comp');
    const fase = url.searchParams.get('fase');
    const grupo = url.searchParams.get('grupo');

    if (!compId) {
      // No comp specified - try to return first available
      const comps = listCompetitions().filter(c => c.hasData);
      if (comps.length === 0) {
        return sendJSON(res, { error: 'No scraped data available. Run /api/scrape first.' }, 404);
      }
      const data = buildFullCompetitionData(comps[0].id);
      return sendJSON(res, data);
    }

    if (fase && grupo) {
      const data = buildDashboardData(compId, fase, grupo);
      return sendJSON(res, data);
    }

    const data = buildFullCompetitionData(compId);
    return sendJSON(res, data);
  }

  // POST /api/scrape - Trigger scraper
  if (pathname === '/api/scrape' && req.method === 'POST') {
    if (scrapeProcess) {
      return sendJSON(res, { status: 'already_running', message: 'Scraper is already running' });
    }

    console.log('[Server] Starting scraper...');
    scrapeProcess = execFile('node', [path.join(ROOT_DIR, 'scraper_api.js')], {
      cwd: ROOT_DIR,
      timeout: 300000, // 5 min max
    }, (error, stdout, stderr) => {
      scrapeProcess = null;
      if (error) {
        console.error('[Server] Scraper error:', error.message);
      } else {
        console.log('[Server] Scraper completed successfully');
      }
      if (stderr) console.error('[Server] Scraper stderr:', stderr);
    });

    scrapeProcess.stdout?.on('data', (data) => {
      process.stdout.write(`[Scraper] ${data}`);
    });

    return sendJSON(res, { status: 'started', message: 'Scraper started in background' });
  }

  // GET /api/scrape/status - Check scraper status
  if (pathname === '/api/scrape/status') {
    return sendJSON(res, { running: !!scrapeProcess });
  }

  // GET /api/raw/:filename - Get raw scraped JSON file
  if (pathname.startsWith('/api/raw/')) {
    const filename = pathname.replace('/api/raw/', '');
    // Security: only allow .json files from data dir
    if (!filename.endsWith('.json') || filename.includes('..') || filename.includes('/')) {
      return sendJSON(res, { error: 'Invalid filename' }, 400);
    }
    const filepath = path.join(DATA_DIR, filename);
    if (!fs.existsSync(filepath)) {
      return sendJSON(res, { error: 'File not found' }, 404);
    }
    const data = JSON.parse(fs.readFileSync(filepath, 'utf8'));
    return sendJSON(res, data);
  }

  // ---- Static Files ----

  // Default: serve dashboard.html for root
  let filePath;
  if (pathname === '/' || pathname === '/index.html') {
    filePath = path.join(ROOT_DIR, 'dashboard.html');
  } else {
    // Serve files relative to root dir
    filePath = path.join(ROOT_DIR, pathname);
  }

  // Security: prevent path traversal
  if (!filePath.startsWith(ROOT_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  // Serve static file
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath);
    const contentType = MIME[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }
});

function sendJSON(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data, null, 2));
}

server.listen(PORT, () => {
  console.log(`
  ╔═══════════════════════════════════════════════╗
  ║  FEBAMBA Dashboard Server                     ║
  ║  http://localhost:${PORT}                       ║
  ╠═══════════════════════════════════════════════╣
  ║  Dashboard:    http://localhost:${PORT}/          ║
  ║  API Data:     http://localhost:${PORT}/api/data  ║
  ║  Competitions: http://localhost:${PORT}/api/competitions ║
  ║  Scrape:       POST /api/scrape               ║
  ╚═══════════════════════════════════════════════╝
  `);
});
