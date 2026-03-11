/**
 * Build script: convierte los archivos scrapeados en un JSON unificado
 * para el dashboard estático (GitHub Pages).
 *
 * Lee los archivos individuales de data/ y genera data/dashboard_data.json
 * con todas las competiciones, fases/grupos, clasificaciones y calendarios.
 *
 * Uso: node build_data.js
 * Se corre después de scraper_api.js
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const OUTPUT_FILE = path.join(DATA_DIR, 'dashboard_data.json');

function parseCabbDate(dateStr) {
  if (!dateStr) return null;
  const m = dateStr.match(/\/Date\((\d+)\)\//);
  if (!m) return dateStr;
  return new Date(parseInt(m[1])).toISOString().split('T')[0];
}

function parseCabbDateTime(dateStr) {
  if (!dateStr) return null;
  const m = dateStr.match(/\/Date\((\d+)\)\//);
  if (!m) return dateStr;
  return new Date(parseInt(m[1])).toISOString();
}

function readJSON(filepath) {
  try {
    return JSON.parse(fs.readFileSync(filepath, 'utf8'));
  } catch { return null; }
}

function buildDashboardData() {
  console.log('Building dashboard data...\n');

  // 1. Read competitions from search results
  const busqueda = readJSON(path.join(DATA_DIR, 'busqueda_buenos_aires.json'));
  if (!busqueda || !busqueda.categorias) {
    console.error('No busqueda_buenos_aires.json found. Run scraper first.');
    process.exit(1);
  }

  const allComps = busqueda.categorias.filter(c =>
    c.NombreDelegacion?.includes('METROPOLITANA') || c.NombreDelegacion?.includes('BUENOS AIRES')
  );

  console.log(`Found ${allComps.length} competitions\n`);

  const output = {
    meta: {
      source: 'CABB/FEBAMBA - API Indalweb',
      generated: new Date().toISOString(),
    },
    competitions: [],
  };

  for (const comp of allComps) {
    const compId = comp.IdCompeticionCategoria;
    const compIdSafe = String(compId).replace(/[^a-zA-Z0-9]/g, '_');

    const compData = {
      id: compId,
      name: comp.NombreCompeticion,
      category: comp.NombreCategoria,
      delegacion: comp.NombreDelegacion,
      season: '2026',
      fases: [],
    };

    // 2. Read fases/grupos
    const fgFile = path.join(DATA_DIR, `fases_grupos_${compIdSafe}.json`);
    const fg = readJSON(fgFile);
    if (!fg || !fg.listaFasesGrupo || fg.listaFasesGrupo.length === 0) {
      output.competitions.push(compData);
      continue;
    }

    for (const fase of fg.listaFasesGrupo) {
      const grupos = fase.Grupos || [];
      for (const grupo of grupos) {
        const faseTag = (fase.NombreFase || '').replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30);
        const grupoTag = (grupo.NombreGrupo || '').replace(/[^a-zA-Z0-9]/g, '_').substring(0, 20);
        const fileTag = `${compIdSafe}_${faseTag}_${grupoTag}`;

        const faseData = {
          faseName: fase.NombreFase,
          grupoName: grupo.NombreGrupo,
          tipoFase: fase.TipoFase,
          faseTag,
          grupoTag,
          standings: [],
          matches: [],
          schedule: [],
        };

        // 3. Read clasificacion → standings
        const clasif = readJSON(path.join(DATA_DIR, `clasificacion_${fileTag}.json`));
        if (clasif && clasif.resultado === 'correcto') {
          const lista = clasif.clasificacion || clasif.ListaClasificacion || clasif.datos || [];
          if (Array.isArray(lista)) {
            faseData.standings = lista.map((eq, idx) => ({
              pos: eq.Posicion || idx + 1,
              team: eq.NombreEquipo || eq.Equipo || '?',
              teamId: eq.IdEquipo || '',
              pj: eq.PartidosJugados || 0,
              pg: eq.PartidosGanados || 0,
              pp: eq.PartidosPerdidos || 0,
              pf: eq.PuntosFavor || 0,
              pc: eq.PuntosContra || 0,
              dif: (eq.PuntosFavor || 0) - (eq.PuntosContra || 0),
              pts: eq.Puntos || 0,
            }));
          }
        }

        // 4. Read horarios → matches with full details (from horariosJornadas)
        const horarios = readJSON(path.join(DATA_DIR, `horarios_${fileTag}.json`));
        if (horarios && horarios.partidos && Array.isArray(horarios.partidos)) {
          for (const p of horarios.partidos) {
            faseData.matches.push({
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

        // 5. Read jornadas → schedule (matchday dates)
        const jorn = readJSON(path.join(DATA_DIR, `jornadas_${fileTag}.json`));
        if (jorn) {
          const listaJ = jorn.ListaJornadas || jorn.listaJornadas || [];
          for (const j of listaJ) {
            faseData.schedule.push({
              matchday: j.NumeroJornada || 0,
              date: parseCabbDate(j.FechaJornada),
            });
          }
        }

        faseData.hasData = faseData.standings.length > 0 || faseData.matches.length > 0 || faseData.schedule.length > 0;
        compData.fases.push(faseData);
      }
    }

    output.competitions.push(compData);
    const fasesWithData = compData.fases.filter(f => f.hasData).length;
    console.log(`  ${comp.NombreCompeticion} - ${comp.NombreCategoria}: ${compData.fases.length} grupos (${fasesWithData} con datos)`);
  }

  // Write output
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2), 'utf8');
  const size = (fs.statSync(OUTPUT_FILE).size / 1024).toFixed(1);
  console.log(`\nGenerated: ${OUTPUT_FILE} (${size} KB)`);
  console.log(`Competitions: ${output.competitions.length}`);
  console.log(`Total fases/grupos: ${output.competitions.reduce((s, c) => s + c.fases.length, 0)}`);
}

buildDashboardData();
