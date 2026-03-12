/**
 * Build script: convierte los archivos scrapeados en un JSON unificado
 * para el dashboard estático (GitHub Pages).
 *
 * Lee los archivos individuales de data/ y la BD local (data/db.json)
 * y genera data/dashboard_data.json con todas las competiciones,
 * fases/grupos, clasificaciones, calendarios y estadísticas.
 *
 * Uso: node build_data.js
 * Se corre después de scraper_api.js
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const OUTPUT_FILE = path.join(DATA_DIR, 'dashboard_data.json');

// Filtros (mismos que en scraper_api.js)
const EXCLUDED_COMPETITIONS = ['FLEX', 'MASTER', 'LA PLATA'];
const EXCLUDED_PHASES = ['PRE LIGAMETROPOLITANA'];

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

  // Load DB for stats (box scores from envivo/estadisticas.ashx)
  const db = readJSON(DB_FILE) || { matchStats: {} };
  const matchStatsCount = Object.keys(db.matchStats || {}).length;
  console.log(`BD local: ${matchStatsCount} partidos con box score\n`);

  // Filter to FEBAMBA competitions, excluding unwanted ones
  const allComps = busqueda.categorias.filter(c => {
    const isFebamba = c.NombreDelegacion?.includes('METROPOLITANA') || c.NombreDelegacion?.includes('BUENOS AIRES');
    if (!isFebamba) return false;
    const isExcluded = EXCLUDED_COMPETITIONS.some(excl =>
      c.NombreCompeticion?.toUpperCase().includes(excl.toUpperCase())
    );
    return !isExcluded;
  });

  console.log(`Found ${allComps.length} competitions (after filtering)\n`);

  const output = {
    meta: {
      source: 'CABB/FEBAMBA - API Indalweb',
      generated: new Date().toISOString(),
      statsCount: matchStatsCount,
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
      const faseName = fase.NombreFase || '';

      // Filter excluded phases
      const isExcludedPhase = EXCLUDED_PHASES.some(excl =>
        faseName.toUpperCase().includes(excl.toUpperCase())
      );
      if (isExcludedPhase) {
        console.log(`  [SKIP] ${comp.NombreCompeticion} - Fase excluida: ${faseName}`);
        continue;
      }

      const grupos = fase.Grupos || [];
      for (const grupo of grupos) {
        const faseTag = (fase.NombreFase || '').replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30);
        const grupoTag = (grupo.NombreGrupo || '').replace(/[^a-zA-Z0-9]/g, '_').substring(0, 20);
        const fileTag = `${compIdSafe}_${faseTag}_${grupoTag}`;
        const dbKey = `${compIdSafe}_${faseTag}_${grupoTag}`;

        const faseData = {
          faseName: fase.NombreFase,
          grupoName: grupo.NombreGrupo,
          tipoFase: fase.TipoFase,
          faseTag,
          grupoTag,
          standings: [],
          matches: [],
          schedule: [],
          matchStats: [],
          topPlayers: null,
          teamStats: [],
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

        // 6. Match stats from DB (box scores from envivo/estadisticas.ashx)
        // Response format: { resultado, partido: {...}, estadisticas: { equipolocal, equipovisitante,
        //   estadisticasequipolocal: [{nombre, puntos, tiro2p, canasta2p, ...}],
        //   estadisticasequipovisitante: [...] }, _meta: {...} }
        const playerAccum = {}; // Accumulate player stats across matches for top players
        if (db.matchStats) {
          for (const [matchId, stats] of Object.entries(db.matchStats)) {
            if (stats._meta &&
                stats._meta.compId === compId &&
                stats._meta.faseName === fase.NombreFase &&
                stats._meta.grupoName === grupo.NombreGrupo) {
              const { _meta } = stats;
              const est = stats.estadisticas || {};

              // Build compact box score for dashboard
              const boxScore = {
                matchId,
                home: _meta.home || est.equipolocal || '',
                away: _meta.away || est.equipovisitante || '',
                date: _meta.date,
                scoreHome: stats.partido?.tanteo_local,
                scoreAway: stats.partido?.tanteo_visitante,
                periods: stats.partido?.periodos || [],
                homePlayers: (est.estadisticasequipolocal || []).map(p => ({
                  name: p.nombre || '',
                  dorsal: p.dorsal || '',
                  starter: p.quintetotitular || false,
                  pts: p.puntos || 0,
                  t2: `${p.canasta2p || 0}/${p.tiro2p || 0}`,
                  t3: `${p.canasta3p || 0}/${p.tiro3p || 0}`,
                  tl: `${p.canasta1p || 0}/${p.tiro1p || 0}`,
                  reb: p.rebotes || 0,
                  rebO: p.reboteofensivo || 0,
                  rebD: p.rebotedefensivo || 0,
                  ast: p.asistencias || 0,
                  per: p.perdidas || 0,
                  rec: p.recuperaciones || 0,
                  tap: p.taponescometidos || 0,
                  fp: p.faltascometidas || 0,
                  val: p.valoracion || 0,
                  min: p.tiempo_jugado || '',
                })),
                awayPlayers: (est.estadisticasequipovisitante || []).map(p => ({
                  name: p.nombre || '',
                  dorsal: p.dorsal || '',
                  starter: p.quintetotitular || false,
                  pts: p.puntos || 0,
                  t2: `${p.canasta2p || 0}/${p.tiro2p || 0}`,
                  t3: `${p.canasta3p || 0}/${p.tiro3p || 0}`,
                  tl: `${p.canasta1p || 0}/${p.tiro1p || 0}`,
                  reb: p.rebotes || 0,
                  rebO: p.reboteofensivo || 0,
                  rebD: p.rebotedefensivo || 0,
                  ast: p.asistencias || 0,
                  per: p.perdidas || 0,
                  rec: p.recuperaciones || 0,
                  tap: p.taponescometidos || 0,
                  fp: p.faltascometidas || 0,
                  val: p.valoracion || 0,
                  min: p.tiempo_jugado || '',
                })),
              };
              faseData.matchStats.push(boxScore);

              // Accumulate player stats for top players computation
              const allPlayers = [
                ...(est.estadisticasequipolocal || []).map(p => ({ ...p, equipo: est.equipolocal || _meta.home })),
                ...(est.estadisticasequipovisitante || []).map(p => ({ ...p, equipo: est.equipovisitante || _meta.away })),
              ];
              for (const p of allPlayers) {
                const key = p.componente_id || p.nombre;
                if (!key) continue;
                if (!playerAccum[key]) {
                  playerAccum[key] = {
                    name: p.nombre, equipo: p.equipo, pj: 0,
                    pts: 0, reb: 0, ast: 0, val: 0, per: 0, rec: 0, tap: 0,
                    t2m: 0, t2i: 0, t3m: 0, t3i: 0, tlm: 0, tli: 0,
                  };
                }
                const a = playerAccum[key];
                a.pj++;
                a.pts += p.puntos || 0;
                a.reb += p.rebotes || 0;
                a.ast += p.asistencias || 0;
                a.val += p.valoracion || 0;
                a.per += p.perdidas || 0;
                a.rec += p.recuperaciones || 0;
                a.tap += p.taponescometidos || 0;
                a.t2m += p.canasta2p || 0;
                a.t2i += p.tiro2p || 0;
                a.t3m += p.canasta3p || 0;
                a.t3i += p.tiro3p || 0;
                a.tlm += p.canasta1p || 0;
                a.tli += p.tiro1p || 0;
              }
            }
          }
        }

        // 7. Compute top players from accumulated box scores
        const playerList = Object.values(playerAccum).filter(p => p.pj > 0);
        if (playerList.length > 0) {
          faseData.topPlayers = {
            puntos: [...playerList].sort((a, b) => b.pts / b.pj - a.pts / a.pj).slice(0, 15)
              .map(p => ({ name: p.name, team: p.equipo, pj: p.pj, total: p.pts, avg: +(p.pts / p.pj).toFixed(1) })),
            rebotes: [...playerList].sort((a, b) => b.reb / b.pj - a.reb / a.pj).slice(0, 15)
              .map(p => ({ name: p.name, team: p.equipo, pj: p.pj, total: p.reb, avg: +(p.reb / p.pj).toFixed(1) })),
            asistencias: [...playerList].sort((a, b) => b.ast / b.pj - a.ast / a.pj).slice(0, 15)
              .map(p => ({ name: p.name, team: p.equipo, pj: p.pj, total: p.ast, avg: +(p.ast / p.pj).toFixed(1) })),
            valoracion: [...playerList].sort((a, b) => b.val / b.pj - a.val / a.pj).slice(0, 15)
              .map(p => ({ name: p.name, team: p.equipo, pj: p.pj, total: p.val, avg: +(p.val / p.pj).toFixed(1) })),
          };

          // Compute team stats from accumulated player data
          const teamAccum = {};
          for (const p of playerList) {
            if (!teamAccum[p.equipo]) {
              teamAccum[p.equipo] = { team: p.equipo, pj: 0, pts: 0, reb: 0, ast: 0, val: 0 };
            }
            const t = teamAccum[p.equipo];
            t.pts += p.pts;
            t.reb += p.reb;
            t.ast += p.ast;
            t.val += p.val;
            t.pj = Math.max(t.pj, p.pj); // Approximate: use max games any player played
          }
          faseData.teamStats = Object.values(teamAccum).map(t => ({
            team: t.team,
            pj: t.pj,
            ptsTotal: t.pts, ptsAvg: t.pj ? +(t.pts / t.pj).toFixed(1) : 0,
            rebTotal: t.reb, rebAvg: t.pj ? +(t.reb / t.pj).toFixed(1) : 0,
            astTotal: t.ast, astAvg: t.pj ? +(t.ast / t.pj).toFixed(1) : 0,
            valTotal: t.val, valAvg: t.pj ? +(t.val / t.pj).toFixed(1) : 0,
          }));
        }

        faseData.hasData = faseData.standings.length > 0 || faseData.matches.length > 0 || faseData.schedule.length > 0;
        faseData.hasStats = faseData.matchStats.length > 0 || faseData.topPlayers !== null || faseData.teamStats.length > 0;
        compData.fases.push(faseData);
      }
    }

    output.competitions.push(compData);
    const fasesWithData = compData.fases.filter(f => f.hasData).length;
    const fasesWithStats = compData.fases.filter(f => f.hasStats).length;
    console.log(`  ${comp.NombreCompeticion} - ${comp.NombreCategoria}: ${compData.fases.length} grupos (${fasesWithData} con datos, ${fasesWithStats} con stats)`);
  }

  // Write output
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2), 'utf8');
  const size = (fs.statSync(OUTPUT_FILE).size / 1024).toFixed(1);
  console.log(`\nGenerated: ${OUTPUT_FILE} (${size} KB)`);
  console.log(`Competitions: ${output.competitions.length}`);
  console.log(`Total fases/grupos: ${output.competitions.reduce((s, c) => s + c.fases.length, 0)}`);
}

buildDashboardData();
