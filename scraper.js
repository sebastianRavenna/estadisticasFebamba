/**
 * Scraper para Gesdeportiva - Portal de Competiciones CABB/FEBAMBA
 * Extrae: clasificaciones, equipos, jugadores, partidos desde HTML server-rendered
 *
 * Uso: node scraper.js
 * Genera: data/competitions.json, data/teams.json, data/players.json, data/matches.json
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://competicionescabb.gesdeportiva.es';
const DATA_DIR = path.join(__dirname, 'data');

// IDs conocidos de FEBAMBA (delegacion=1)
const KNOWN_GROUPS = [8459]; // Agregar más IDs de grupo acá
const KNOWN_COMPETITIONS = [1623]; // Agregar más IDs de competicion acá

// Crear directorio de datos
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function saveData(filename, data) {
  const filepath = path.join(DATA_DIR, filename);
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
  console.log(`  ✅ Guardado: ${filepath} (${JSON.stringify(data).length} bytes)`);
}

async function scrapeClassification(page, grupoId) {
  console.log(`\n📊 Scrapeando clasificación grupo=${grupoId}...`);
  await page.goto(`${BASE_URL}/competicion.aspx?grupo=${grupoId}`, {
    waitUntil: 'networkidle', timeout: 30000
  });
  await page.waitForTimeout(3000);

  const data = await page.evaluate(() => {
    const result = {
      title: '',
      standings: [],
      matchdays: [],
      teams: [],
      links: []
    };

    // Título de la competición
    const titleEl = document.querySelector('h1, h2, .titulo, .nombre-competicion, #titulo');
    result.title = titleEl ? titleEl.textContent.trim() : document.title;

    // Buscar tablas de clasificación
    const tables = document.querySelectorAll('table');
    tables.forEach((table, tableIdx) => {
      const headers = [];
      const rows = [];

      // Extraer headers
      table.querySelectorAll('thead th, thead td, tr:first-child th, tr:first-child td').forEach(th => {
        headers.push(th.textContent.trim());
      });

      // Extraer filas
      const dataRows = table.querySelectorAll('tbody tr, tr');
      dataRows.forEach((tr, rowIdx) => {
        if (rowIdx === 0 && headers.length > 0) return; // Skip header row
        const cells = [];
        const links = [];
        tr.querySelectorAll('td, th').forEach(td => {
          cells.push(td.textContent.trim());
          const link = td.querySelector('a[href]');
          if (link) {
            links.push({ text: link.textContent.trim(), href: link.href });
          }
        });
        if (cells.length > 0 && cells.some(c => c.length > 0)) {
          rows.push({ cells, links });
        }
      });

      if (rows.length > 0) {
        // Detectar si es tabla de clasificación (tiene columnas PJ, PG, PP, PF, PC, etc.)
        const headerText = headers.join(' ').toLowerCase();
        const isStandings = headerText.includes('pj') || headerText.includes('pg') ||
                           headerText.includes('pts') || headerText.includes('puntos') ||
                           headerText.includes('equipo') || headerText.includes('pos');

        result.standings.push({
          tableIndex: tableIdx,
          isStandings,
          headers,
          rows: rows.map(r => r.cells),
          teamLinks: rows.flatMap(r => r.links)
        });
      }
    });

    // Extraer todos los links a equipos
    document.querySelectorAll('a[href*="equipo.aspx"]').forEach(a => {
      result.teams.push({
        name: a.textContent.trim(),
        url: a.href
      });
    });

    // Extraer todos los links a partidos
    document.querySelectorAll('a[href*="partido"], a[href*="acta"]').forEach(a => {
      result.links.push({
        text: a.textContent.trim(),
        href: a.href,
        type: 'match'
      });
    });

    // Extraer links genéricos útiles
    document.querySelectorAll('a[href]').forEach(a => {
      const href = a.href;
      if (href.includes('competicion') || href.includes('grupo') ||
          href.includes('clasificacion') || href.includes('calendario') ||
          href.includes('jornada')) {
        result.links.push({
          text: a.textContent.trim(),
          href,
          type: 'navigation'
        });
      }
    });

    return result;
  });

  return data;
}

async function scrapeTeam(page, teamUrl, teamName) {
  console.log(`\n🏀 Scrapeando equipo: ${teamName}...`);
  await page.goto(teamUrl, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);

  const data = await page.evaluate(() => {
    const result = {
      name: '',
      logo: '',
      players: [],
      matches: [],
      stats: [],
      tables: []
    };

    // Nombre del equipo
    const nameEl = document.querySelector('h1, h2, .nombre-equipo, .titulo');
    result.name = nameEl ? nameEl.textContent.trim() : '';

    // Logo
    const logoEl = document.querySelector('img[src*="escudo"], img[src*="logo"]');
    result.logo = logoEl ? logoEl.src : '';

    // Extraer TODAS las tablas
    const tables = document.querySelectorAll('table');
    tables.forEach((table, tableIdx) => {
      const headers = [];
      const rows = [];

      table.querySelectorAll('thead th, thead td, tr:first-child th, tr:first-child td').forEach(th => {
        headers.push(th.textContent.trim());
      });

      const dataRows = table.querySelectorAll('tbody tr, tr');
      dataRows.forEach((tr, rowIdx) => {
        if (rowIdx === 0 && headers.length > 0) return;
        const cells = [];
        const links = [];
        tr.querySelectorAll('td, th').forEach(td => {
          cells.push(td.textContent.trim());
          const link = td.querySelector('a[href]');
          if (link) links.push({ text: link.textContent.trim(), href: link.href });
        });
        if (cells.length > 0 && cells.some(c => c.length > 0)) {
          rows.push({ cells, links });
        }
      });

      if (rows.length > 0) {
        const headerText = headers.join(' ').toLowerCase();

        // Detectar tipo de tabla
        let type = 'unknown';
        if (headerText.includes('jugador') || headerText.includes('dorsal') || headerText.includes('nombre')) {
          type = 'roster';
        } else if (headerText.includes('pts') || headerText.includes('reb') || headerText.includes('asi') || headerText.includes('min')) {
          type = 'stats';
        } else if (headerText.includes('fecha') || headerText.includes('rival') || headerText.includes('resultado')) {
          type = 'matches';
        } else if (headerText.includes('pj') || headerText.includes('pg')) {
          type = 'standings';
        }

        result.tables.push({
          tableIndex: tableIdx,
          type,
          headers,
          rows: rows.map(r => r.cells),
          links: rows.flatMap(r => r.links)
        });
      }
    });

    // Buscar links a jugadores
    document.querySelectorAll('a[href*="jugador"]').forEach(a => {
      result.players.push({
        name: a.textContent.trim(),
        url: a.href
      });
    });

    return result;
  });

  data.sourceUrl = teamUrl;
  data.teamName = teamName;
  return data;
}

async function scrapeAllTabs(page, baseUrl) {
  // Muchas páginas de gesdeportiva tienen tabs (clasificación, calendario, estadísticas)
  // Intentar hacer click en cada tab para obtener más datos
  console.log('  🔄 Buscando tabs adicionales...');

  const tabs = await page.$$('.tab, .nav-tab, [role="tab"], .pestana, a[href*="#"], .tabs a, ul.nav li a');
  const tabData = [];

  for (let i = 0; i < tabs.length; i++) {
    try {
      const tabText = await tabs[i].textContent();
      console.log(`    Tab ${i + 1}: "${tabText.trim()}"`);
      await tabs[i].click();
      await page.waitForTimeout(2000);

      // Extraer datos después del click
      const content = await page.evaluate(() => {
        const tables = [];
        document.querySelectorAll('table').forEach(table => {
          const headers = [];
          const rows = [];
          table.querySelectorAll('thead th, tr:first-child th, tr:first-child td').forEach(th => {
            headers.push(th.textContent.trim());
          });
          table.querySelectorAll('tbody tr, tr:not(:first-child)').forEach(tr => {
            const cells = [];
            tr.querySelectorAll('td').forEach(td => cells.push(td.textContent.trim()));
            if (cells.length > 0) rows.push(cells);
          });
          if (rows.length > 0) tables.push({ headers, rows });
        });
        return tables;
      });

      tabData.push({ tab: tabText.trim(), tables: content });
    } catch (e) {
      // Tab might not be clickable
    }
  }

  return tabData;
}

async function main() {
  console.log('🏀 FEBAMBA Scraper - Gesdeportiva Competiciones');
  console.log('='.repeat(60));

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  const allData = {
    timestamp: new Date().toISOString(),
    competitions: [],
    teams: [],
    rawTables: []
  };

  // ===== 1. Scrape clasificaciones =====
  for (const grupoId of KNOWN_GROUPS) {
    try {
      const classData = await scrapeClassification(page, grupoId);

      // Intentar scrape de tabs adicionales
      const tabData = await scrapeAllTabs(page, `${BASE_URL}/competicion.aspx?grupo=${grupoId}`);

      allData.competitions.push({
        grupoId,
        ...classData,
        additionalTabs: tabData
      });

      // Screenshot
      await page.screenshot({ path: `data/competition_${grupoId}.png`, fullPage: true });

      // Extraer URLs de equipos para scraping posterior
      const teamUrls = classData.teams.filter(t => t.url && t.name);
      console.log(`  Equipos encontrados: ${teamUrls.length}`);

      // ===== 2. Scrape cada equipo =====
      for (const team of teamUrls) {
        try {
          const teamData = await scrapeTeam(page, team.url, team.name);

          // Intentar tabs del equipo
          const teamTabData = await scrapeAllTabs(page, team.url);
          teamData.additionalTabs = teamTabData;

          allData.teams.push(teamData);

          // Screenshot del equipo
          const safeTeamName = team.name.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30);
          await page.screenshot({ path: `data/team_${safeTeamName}.png`, fullPage: true });
        } catch (e) {
          console.log(`  ❌ Error scrapeando equipo ${team.name}: ${e.message}`);
        }
      }
    } catch (e) {
      console.log(`  ❌ Error scrapeando grupo ${grupoId}: ${e.message}`);
    }
  }

  // ===== 3. Intentar navegar al index para descubrir más competiciones =====
  console.log('\n🔍 Buscando más competiciones en el index...');
  try {
    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000);

    const indexLinks = await page.evaluate(() => {
      const links = [];
      document.querySelectorAll('a[href*="competicion"], a[href*="grupo"]').forEach(a => {
        links.push({ text: a.textContent.trim(), href: a.href });
      });
      return links;
    });

    console.log(`  Links a competiciones en index: ${indexLinks.length}`);
    allData.discoveredCompetitions = indexLinks;

    await page.screenshot({ path: 'data/index.png', fullPage: true });
  } catch (e) {
    console.log(`  ❌ Error en index: ${e.message}`);
  }

  // ===== 4. Guardar todo =====
  saveData('scraped_data.json', allData);

  // Guardar resumen
  const summary = {
    timestamp: allData.timestamp,
    competitionsScraped: allData.competitions.length,
    teamsScraped: allData.teams.length,
    totalTables: allData.competitions.reduce((sum, c) => sum + c.standings.length, 0) +
                 allData.teams.reduce((sum, t) => sum + t.tables.length, 0),
    teams: allData.teams.map(t => t.teamName || t.name),
    competitionTitles: allData.competitions.map(c => c.title)
  };
  saveData('scrape_summary.json', summary);

  console.log('\n' + '='.repeat(60));
  console.log('📊 RESUMEN DEL SCRAPING');
  console.log('='.repeat(60));
  console.log(`  Competiciones: ${summary.competitionsScraped}`);
  console.log(`  Equipos: ${summary.teamsScraped}`);
  console.log(`  Tablas extraídas: ${summary.totalTables}`);
  console.log(`  Equipos: ${summary.teams.join(', ')}`);

  await browser.close();
  console.log('\n✅ Scraping completo. Revisá la carpeta data/');
}

main().catch(console.error);
