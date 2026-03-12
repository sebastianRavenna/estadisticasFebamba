/**
 * Quick scrape: just get horariosJornadas for SUPERIOR 2026, all grupos
 * Excluye fases de PRE LIGAMETROPOLITANA
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const BASE_URL_STATIC = 'https://appaficioncabb.indalweb.net';
let BASE_URL_DYNAMIC = 'https://appaficioncabb.indalweb.net/v2';
const APP_VERSION = '40044';
let SESSION = { id_dispositivo: '', key: '', uid: '' };
const DATA_DIR = path.join(__dirname, 'data');

// Fases a excluir
const EXCLUDED_PHASES = ['PRE LIGAMETROPOLITANA'];

async function postAPI(url, params) {
  const body = new URLSearchParams(params).toString();
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      'Accept': 'application/json, text/plain, */*',
      'User-Agent': 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36',
      'Origin': 'https://appaficioncabb.indalweb.net',
    },
    body: body,
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { return null; }
  if (data && data.resultado === 'correcto') {
    if (data.key) SESSION.key = data.key;
    if (data.id_dispositivo && data.id_dispositivo !== '') SESSION.id_dispositivo = data.id_dispositivo;
    if (data.ruta) BASE_URL_DYNAMIC = data.ruta + 'v2';
  }
  return data;
}

async function apiCall(endpoint, params = {}) {
  if (SESSION.id_dispositivo) params.id_dispositivo = params.id_dispositivo || SESSION.id_dispositivo;
  if (SESSION.key) params.key = params.key || SESSION.key;
  return postAPI(BASE_URL_DYNAMIC + '/' + endpoint, params);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function saveData(filename, data) {
  fs.writeFileSync(path.join(DATA_DIR, filename), JSON.stringify(data, null, 2), 'utf8');
}

async function main() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  SESSION.uid = crypto.randomBytes(8).toString('hex');
  await postAPI(BASE_URL_STATIC + '/dispositivo.ashx', {
    accion: 'registrar', uid: SESSION.uid, plataforma: 'android',
    tipo_dispositivo: 'android', version: APP_VERSION,
  });
  console.log('Auth OK');
  await sleep(500);

  // Search for competitions
  const busq = await apiCall('busqueda.ashx', { accion: 'buscarCategoria', texto: 'Buenos Aires' });
  if (!busq || !busq.categorias) { console.log('Search failed'); return; }
  saveData('busqueda_buenos_aires.json', busq);

  // Find SUPERIOR 2026 (not FLEX SUPERIOR)
  const comp = busq.categorias.find(c =>
    c.NombreCompeticion && c.NombreCompeticion.includes('SUPERIOR') &&
    !c.NombreCompeticion.includes('FLEX') &&
    c.NombreDelegacion && c.NombreDelegacion.includes('METROPOLITANA')
  );
  if (!comp) { console.log('SUPERIOR not found'); return; }
  console.log('Comp:', comp.NombreCompeticion, '| Id:', comp.IdCompeticionCategoria);
  await sleep(500);

  // Get fases/grupos
  const fg = await apiCall('categoria.ashx', { accion: 'fasesGrupos', id_categoria_competicion: comp.Id });
  if (!fg || !fg.listaFasesGrupo) { console.log('fasesGrupos failed'); return; }
  const compIdSafe = String(comp.IdCompeticionCategoria);
  saveData(`fases_grupos_${compIdSafe}.json`, fg);
  console.log('Fases:', fg.listaFasesGrupo.length);
  await sleep(500);

  // For each fase/grupo, get horariosJornadas + jornadas (skip excluded phases)
  for (const fase of fg.listaFasesGrupo) {
    const faseName = fase.NombreFase || '';
    const isExcluded = EXCLUDED_PHASES.some(excl => faseName.toUpperCase().includes(excl.toUpperCase()));
    if (isExcluded) {
      console.log(`\n[SKIP] Fase excluida: ${faseName}`);
      continue;
    }
    const grupos = fase.Grupos || [];
    for (const grupo of grupos) {
      const faseTag = (fase.NombreFase || '').replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30);
      const grupoTag = (grupo.NombreGrupo || '').replace(/[^a-zA-Z0-9]/g, '_').substring(0, 20);
      const fileTag = `${compIdSafe}_${faseTag}_${grupoTag}`;

      console.log(`\n${fase.NombreFase} / ${grupo.NombreGrupo}`);

      // horariosJornadas
      const horarios = await apiCall('categoria.ashx', {
        accion: 'horariosJornadas',
        id_fase: fase.IdFase,
        id_grupo: grupo.IdGrupo,
      });
      if (horarios && horarios.resultado === 'correcto') {
        saveData(`horarios_${fileTag}.json`, horarios);
        const numP = horarios.partidos ? horarios.partidos.length : 0;
        console.log(`  Horarios: ${numP} partidos`);
      } else {
        console.log(`  Horarios: error`, horarios?.error);
      }
      await sleep(1000);

      // Jornadas
      const jorn = await apiCall('categoria.ashx', {
        accion: 'Jornadas',
        id_fase: fase.IdFase,
        id_grupo: grupo.IdGrupo,
        id_ronda: '',
      });
      if (jorn && jorn.resultado === 'correcto') {
        saveData(`jornadas_${fileTag}.json`, jorn);
        const numJ = jorn.ListaJornadas ? jorn.ListaJornadas.length : 0;
        console.log(`  Jornadas: ${numJ}`);
      }
      await sleep(1000);

      // Clasificacion (may fail, that's ok)
      const clasif = await apiCall('categoria.ashx', {
        accion: 'clasificacion',
        id_grupo: grupo.IdGrupo,
        tipo_fase: fase.TipoFase,
        jornada: '',
        ventana: '',
      });
      if (clasif && clasif.resultado === 'correcto') {
        saveData(`clasificacion_${fileTag}.json`, clasif);
        console.log(`  Clasificacion: OK`);
      } else {
        console.log(`  Clasificacion: ${clasif?.error || 'error'} (expected if no matches played)`);
      }
      await sleep(1000);
    }
  }

  console.log('\n=== DONE ===');
}

main().catch(console.error);
