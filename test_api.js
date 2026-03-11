async function test() {
  const base = 'https://appaficioncabb.indalweb.net';
  const id = '07f2c40994f8705d';
  
  const tests = [
    // Test 1: fresh registration sin id
    `${base}/dispositivo.ashx?accion=acceso&uid=test123&plataforma=android&tipo_dispositivo=android&id_dispositivo=&token_push=&version=40044`,
    // Test 2: con tipoDispositivo en vez de tipo_dispositivo
    `${base}/dispositivo.ashx?accion=acceso&uid=test123&plataforma=android&tipoDispositivo=android&id_dispositivo=&token_push=&version=40044`,
    // Test 3: con tu id_dispositivo real
    `${base}/dispositivo.ashx?accion=acceso&uid=test123&plataforma=android&tipo_dispositivo=android&id_dispositivo=${id}&token_push=&version=40044`,
    // Test 4: sin version
    `${base}/dispositivo.ashx?accion=acceso&uid=test123&plataforma=android&tipo_dispositivo=android&id_dispositivo=${id}&token_push=`,
    // Test 5: delegaciones directo con id
    `${base}/delegaciones.ashx?accion=delegaciones&id_dispositivo=${id}&key=`,
    // Test 6: delegaciones con mas params
    `${base}/delegaciones.ashx?accion=delegaciones&id_dispositivo=${id}&key=&plataforma=android&version=40044`,
  ];
  
  for (let i = 0; i < tests.length; i++) {
    const url = new URL(tests[i]);
    console.log(`\nTest ${i+1}: ${url.pathname}?${url.searchParams.toString()}`);
    try {
      const r = await fetch(tests[i], {
        headers: { 'Accept': 'application/json, text/plain, */*' }
      });
      const d = JSON.parse(await r.text());
      console.log(`  resultado: ${d.resultado}, error: ${d.error || '-'}, key: "${d.key || ''}", id_dispositivo: "${d.id_dispositivo || ''}"`);
      if (d.delegaciones) console.log(`  delegaciones: ${d.delegaciones.length} items`);
    } catch(e) { console.log(`  Error: ${e.message}`); }
  }
}
test();
