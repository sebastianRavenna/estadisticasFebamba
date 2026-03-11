async function test() {
  const url = 'https://appaficioncabb.indalweb.net/dispositivo.ashx';
  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded',
    'Accept': 'application/json, text/plain, */*',
  };

  const tests = [
    // Test 1: uid = id_dispositivo (mismo valor)
    { accion:'acceso', uid:'07f2c40994f8705d', plataforma:'android', tipo_dispositivo:'android', id_dispositivo:'07f2c40994f8705d', token_push:'', version:'40044' },
    // Test 2: sin uid
    { accion:'acceso', plataforma:'android', tipo_dispositivo:'android', id_dispositivo:'07f2c40994f8705d', token_push:'', version:'40044' },
    // Test 3: id_dispositivo vacío (nuevo registro)
    { accion:'acceso', uid:'07f2c40994f8705d', plataforma:'android', tipo_dispositivo:'android', id_dispositivo:'', token_push:'', version:'40044' },
    // Test 4: id_dispositivo default de la app (0123456789)
    { accion:'acceso', uid:'test', plataforma:'android', tipo_dispositivo:'android', id_dispositivo:'0123456789', token_push:'', version:'40044' },
    // Test 5: plataforma=web
    { accion:'acceso', uid:'test123', plataforma:'web', tipo_dispositivo:'web', id_dispositivo:'0123456789', token_push:'', version:'40044' },
    // Test 6: version como string "4.0.44"
    { accion:'acceso', uid:'07f2c40994f8705d', plataforma:'android', tipo_dispositivo:'android', id_dispositivo:'07f2c40994f8705d', token_push:'', version:'4.0.44' },
  ];

  for (let i = 0; i < tests.length; i++) {
    const body = new URLSearchParams(tests[i]).toString();
    console.log(`\nTest ${i+1}: ${body}`);
    try {
      const r = await fetch(url, { method:'POST', headers, body });
      const d = await r.json();
      console.log(`  resultado: ${d.resultado}, error: "${d.error||''}", key: "${d.key||''}", id: "${d.id_dispositivo||''}"`);
    } catch(e) { console.log(`  Error: ${e.message}`); }
  }
}
test();
