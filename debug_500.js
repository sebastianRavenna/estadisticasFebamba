/**
 * debug_500.js — Diagnóstico del HTTP 500 en endpoints /v2/ de CABB API
 *
 * Propósito: Aislar la causa del HTTP 500 en endpoints autenticados.
 * Hipótesis confirmada: el 500 ocurre con credenciales EXPIRADAS/INVÁLIDAS.
 * Con credenciales FRESCAS (recién obtenidas por accion=registrar), los
 * endpoints /v2/ deberían responder con HTTP 200.
 *
 * Uso:
 *   node debug_500.js
 *
 * Requisito: acceso de red a appaficioncabb.indalweb.net
 */

const BASE = 'https://appaficioncabb.indalweb.net';
const BASE_V2 = BASE + '/v2';

// UID fresco: en la app real es el Android ID (16 chars hex).
// Usamos un valor único para este diagnóstico.
const FRESH_UID = 'dbg' + Date.now().toString(16).slice(-13);

const HEADERS = {
  'Content-Type': 'application/x-www-form-urlencoded',
  'Accept': 'application/json, text/plain, */*',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function post(url, params) {
  const body = new URLSearchParams(params).toString();
  console.log(`  → POST ${url}`);
  console.log(`    body: ${body}`);
  const resp = await fetch(url, { method: 'POST', headers: HEADERS, body });
  const status = resp.status;
  let data;
  try { data = await resp.json(); } catch (_) { data = { _raw: await resp.text() }; }
  console.log(`  ← HTTP ${status}  resultado=${data.resultado || '?'}  error="${data.error || ''}"  key="${(data.key || '').slice(0, 20)}..."  id="${(data.id_dispositivo || '').slice(0, 20)}..."`);
  return { status, data };
}

async function get(url, params) {
  const qs = new URLSearchParams(params).toString();
  const full = `${url}?${qs}`;
  console.log(`  → GET ${full}`);
  const resp = await fetch(full, { headers: { 'Accept': 'application/json, text/plain, */*' } });
  const status = resp.status;
  let data;
  try { data = await resp.json(); } catch (_) { data = { _raw: await resp.text() }; }
  console.log(`  ← HTTP ${status}  resultado=${data.resultado || '?'}  error="${data.error || ''}"`);
  return { status, data };
}

function section(title) {
  console.log('\n' + '='.repeat(70));
  console.log('  ' + title);
  console.log('='.repeat(70));
}

// ---------------------------------------------------------------------------
// Fase 1: Registrar dispositivo nuevo → obtener id_dispositivo + key frescos
// ---------------------------------------------------------------------------

async function registrarDispositivo() {
  section('FASE 1 — Registrar dispositivo nuevo (accion=registrar)');
  console.log(`  uid fresco: ${FRESH_UID}`);

  const { status, data } = await post(`${BASE}/dispositivo.ashx`, {
    accion: 'registrar',
    uid: FRESH_UID,
    plataforma: 'android',
    tipo_dispositivo: 'android',
    version: '40044',
  });

  if (status !== 200 || data.resultado !== 'correcto') {
    console.error('  ✗ FALLO en registro. Abortando diagnóstico.');
    process.exit(1);
  }

  console.log('  ✓ Registro exitoso');
  return { id_dispositivo: data.id_dispositivo, key: data.key, ruta: data.ruta };
}

// ---------------------------------------------------------------------------
// Fase 2: Verificar que accion=acceso también funciona con el id recién creado
// ---------------------------------------------------------------------------

async function refrescarKey(id_dispositivo, uid) {
  section('FASE 2 — Refrescar key (accion=acceso)');

  const { status, data } = await post(`${BASE}/dispositivo.ashx`, {
    accion: 'acceso',
    uid,
    plataforma: 'android',
    tipo_dispositivo: 'android',
    id_dispositivo,
    token_push: '',
    version: '40044',
  });

  if (status !== 200 || data.resultado !== 'correcto') {
    console.error('  ✗ FALLO en acceso. Usando key del registro.');
    return null;
  }

  console.log('  ✓ Key refrescada');
  return data.key;
}

// ---------------------------------------------------------------------------
// Fase 3: Probar endpoints /v2/ con credenciales FRESCAS
// ---------------------------------------------------------------------------

async function probarEndpointsConCredenciales(id_dispositivo, key, baseV2) {
  section('FASE 3 — Endpoints /v2/ CON credenciales frescas');
  console.log('  Hipótesis: con key válida, NO debe haber HTTP 500.\n');

  const credenciales = { id_dispositivo, key };

  const casos = [
    {
      nombre: '3a. envivo/estadisticas.ashx (probe — siempre funciona)',
      url: `${BASE}/envivo/estadisticas.ashx`,
      params: { accion: 'estadisticas', id: '999999', ...credenciales },
    },
    {
      nombre: '3b. busqueda.ashx — buscarCategoria (con skip=0)',
      url: `${baseV2}/busqueda.ashx`,
      params: { accion: 'buscarCategoria', texto: 'FEBAMBA', skip: '0', ...credenciales },
    },
    {
      nombre: '3c. busqueda.ashx — buscarClub (con skip=0)',
      url: `${baseV2}/busqueda.ashx`,
      params: { accion: 'buscarClub', texto: 'FEBAMBA', skip: '0', ...credenciales },
    },
    {
      nombre: '3d. categoria.ashx — competiciones',
      url: `${baseV2}/categoria.ashx`,
      params: { accion: 'competiciones', ...credenciales },
    },
    {
      nombre: '3e. club.ashx — clubes',
      url: `${baseV2}/club.ashx`,
      params: { accion: 'clubes', ...credenciales },
    },
    {
      nombre: '3f. equipo.ashx — equipos',
      url: `${baseV2}/equipo.ashx`,
      params: { accion: 'equipos', ...credenciales },
    },
    {
      nombre: '3g. delegaciones.ashx (urlServidor, sin /v2/)',
      url: `${BASE}/delegaciones.ashx`,
      params: { accion: 'delegaciones', ...credenciales },
    },
  ];

  const resultados = [];
  for (const caso of casos) {
    console.log(`\n  [${caso.nombre}]`);
    const r = await post(caso.url, caso.params);
    resultados.push({ nombre: caso.nombre, status: r.status, resultado: r.data.resultado, error: r.data.error });
  }

  return resultados;
}

// ---------------------------------------------------------------------------
// Fase 4: Probar los MISMOS endpoints SIN credenciales (baseline)
// ---------------------------------------------------------------------------

async function probarEndpointsSinCredenciales(baseV2) {
  section('FASE 4 — Endpoints /v2/ SIN credenciales (baseline)');
  console.log('  Esperado: HTTP 200 con resultado=error "Faltan parámetros".\n');

  const casos = [
    {
      nombre: '4a. busqueda.ashx — buscarCategoria SIN creds',
      url: `${baseV2}/busqueda.ashx`,
      params: { accion: 'buscarCategoria', texto: 'FEBAMBA', skip: '0' },
    },
    {
      nombre: '4b. categoria.ashx — competiciones SIN creds',
      url: `${baseV2}/categoria.ashx`,
      params: { accion: 'competiciones' },
    },
  ];

  const resultados = [];
  for (const caso of casos) {
    console.log(`\n  [${caso.nombre}]`);
    const r = await post(caso.url, caso.params);
    resultados.push({ nombre: caso.nombre, status: r.status, resultado: r.data.resultado, error: r.data.error });
  }

  return resultados;
}

// ---------------------------------------------------------------------------
// Fase 5: Probar con credenciales INVÁLIDAS (simular key expirada)
// ---------------------------------------------------------------------------

async function probarEndpointsCredencialesInvalidas(id_dispositivo, baseV2) {
  section('FASE 5 — Endpoints /v2/ con key INVÁLIDA (simular expiración)');
  console.log('  Hipótesis: key falsa → HTTP 500 (bug ASP.NET).\n');

  const credInvalidas = {
    id_dispositivo,
    key: 'esta_key_es_invalida_y_expiro_hace_mucho_tiempo',
  };

  const casos = [
    {
      nombre: '5a. busqueda.ashx — buscarCategoria con key INVÁLIDA',
      url: `${baseV2}/busqueda.ashx`,
      params: { accion: 'buscarCategoria', texto: 'FEBAMBA', skip: '0', ...credInvalidas },
    },
    {
      nombre: '5b. categoria.ashx — competiciones con key INVÁLIDA',
      url: `${baseV2}/categoria.ashx`,
      params: { accion: 'competiciones', ...credInvalidas },
    },
  ];

  const resultados = [];
  for (const caso of casos) {
    console.log(`\n  [${caso.nombre}]`);
    const r = await post(caso.url, caso.params);
    resultados.push({ nombre: caso.nombre, status: r.status, resultado: r.data.resultado });
  }

  return resultados;
}

// ---------------------------------------------------------------------------
// Resumen final
// ---------------------------------------------------------------------------

function imprimirResumen(fase3, fase4, fase5) {
  section('RESUMEN');

  console.log('\n  Fase 3 — Con credenciales FRESCAS:');
  for (const r of fase3) {
    const icon = r.status === 200 ? '✓' : '✗';
    console.log(`    ${icon} [HTTP ${r.status}] ${r.nombre} → resultado=${r.resultado}`);
  }

  console.log('\n  Fase 4 — SIN credenciales (baseline):');
  for (const r of fase4) {
    const icon = r.status === 200 ? '✓' : '✗';
    console.log(`    ${icon} [HTTP ${r.status}] ${r.nombre} → resultado=${r.resultado}, error=${r.error}`);
  }

  console.log('\n  Fase 5 — Con key INVÁLIDA (simular expiración):');
  for (const r of fase5) {
    const icon = r.status === 500 ? '⚠ (500 confirmado)' : (r.status === 200 ? '✓' : '?');
    console.log(`    ${icon} [HTTP ${r.status}] ${r.nombre}`);
  }

  const hay500ConFrescas = fase3.some(r => r.status === 500);
  const hay500ConInvalidas = fase5.some(r => r.status === 500);

  console.log('\n  DIAGNÓSTICO:');
  if (!hay500ConFrescas && hay500ConInvalidas) {
    console.log('  ✓ HIPÓTESIS CONFIRMADA: el HTTP 500 ocurre SOLO con credenciales expiradas/inválidas.');
    console.log('    Los endpoints /v2/ funcionan correctamente con keys frescas.');
    console.log('    Solución: siempre llamar accion=acceso antes de cada sesión de requests.');
  } else if (hay500ConFrescas) {
    console.log('  ✗ ANOMALÍA: hay HTTP 500 incluso con credenciales frescas.');
    console.log('    Puede haber otro factor: User-Agent, parámetros faltantes, o cambio en el servidor.');
  } else if (!hay500ConInvalidas) {
    console.log('  ? INESPERADO: credenciales inválidas NO causaron HTTP 500.');
    console.log('    El servidor puede haber cambiado su manejo de errores.');
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('CABB API — Diagnóstico HTTP 500');
  console.log(`uid: ${FRESH_UID}`);
  console.log(`timestamp: ${new Date().toISOString()}`);

  // Fase 1: registro
  const { id_dispositivo, key: keyRegistro, ruta } = await registrarDispositivo();
  const baseV2 = (ruta || BASE + '/').replace(/\/$/, '') + '/v2';
  console.log(`\n  baseV2 dinámico: ${baseV2}`);

  // Fase 2: acceso (refrescar key)
  const keyFresca = await refrescarKey(id_dispositivo, FRESH_UID) || keyRegistro;

  // Fase 3, 4, 5
  const r3 = await probarEndpointsConCredenciales(id_dispositivo, keyFresca, baseV2);
  const r4 = await probarEndpointsSinCredenciales(baseV2);
  const r5 = await probarEndpointsCredencialesInvalidas(id_dispositivo, baseV2);

  imprimirResumen(r3, r4, r5);
}

main().catch(err => {
  console.error('\nError fatal:', err);
  process.exit(1);
});
