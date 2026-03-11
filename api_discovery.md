# CABB App API Discovery

## App Details
- Package: `com.indalweb.aficionCABB`
- Type: Cordova/Ionic WebView app
- Backend: ASP.NET 4.7 (.NET Framework 4.0.30319)
- Server: `appaficioncabb.indalweb.net` (IP: 82.223.195.157)
- SSL: RapidSSL TLS RSA CA G1, wildcard `*.indalweb.net`

## Base URLs
- Static: `https://appaficioncabb.indalweb.net/`
- Dynamic (API): `https://appaficioncabb.indalweb.net/v2/`

## Endpoints (.ashx)

| Endpoint | Description |
|---|---|
| `categoria.ashx` | Categories/competitions |
| `partidos.ashx` | Match listings |
| `partido.ashx` | Match detail |
| `estadisticas.ashx` | Statistics |
| `jugadores.ashx` | Player listings |
| `jugador.ashx` | Player detail |
| `equipo.ashx` | Team detail |
| `club.ashx` | Club info |
| `comparativa.ashx` | Player comparisons |
| `tiro.ashx` | Shot data |
| `delegaciones.ashx` | Federations/delegations |
| `busqueda.ashx` | Search |
| `envivo/estadisticas.ashx` | Live stats |
| `descargar.ashx` | Download stats (tipo=estadisticas&id=) |
| `registro.ashx` | Registration |
| `autenticar.ashx` | Authentication |
| `dispositivo.ashx` | Device registration |
| `misequipos.ashx` | My teams |
| `misjugadores.ashx` | My players |
| `mispartidos.ashx` | My matches |
| `misdatos.ashx` | My data |
| `imagenes.ashx` | Images |
| `videos.ashx` | Videos |
| `entrenador.ashx` | Coach data |

## Action Parameters (accion values)

### categoria.ashx
- `competiciones` - List competitions
- `clasificacion` - Standings
- `jornadas` - Match days
- `fasesGrupos` - Phases and groups
- `fasesGruposCompeticion` - Phases/groups per competition
- `fasesGruposEquipo` - Phases/groups per team
- `fasesGruposCompeticionEstadisticasEquipoJugador` - Stats phases

### partidos.ashx
- `partidos` - Match list
- `proximos` - Upcoming matches
- `partidosClub` - Club matches
- `partidosFavoritos` - Favorite matches
- `partidosProximos` - Upcoming matches

### partido.ashx
- `partido` - Match detail
- `partidoEnVivo` - Live match

### estadisticas.ashx
- `estadisticas` - General stats
- `estadisticasEquipo` - Team stats
- `estadisticasJugador` - Player stats
- `estadisticasequipolocal` - Home team stats
- `estadisticasequipovisitante` - Away team stats

### jugadores.ashx
- `jugadores` - Player list
- `jugadoreslocales` - Home players
- `jugadoresvisitantes` - Away players
- `jugadoresenpistalocal` - On-court home players
- `jugadoresenpistavisitante` - On-court away players

### equipo.ashx
- `equipo` - Team detail
- `equipos` - Team list
- `equiposClub` - Club teams
- `equiposGrupo` - Group teams
- `equiposJugador` - Player teams

### club.ashx
- `club` - Club detail
- `clubes` - Club list

### busqueda.ashx
- `buscarCategoria` - Search categories
- `buscarClub` - Search clubs
- `buscarEquipo` - Search teams
- `buscarJugador` - Search players
- `buscarPartido` - Search matches

## Authentication Flow (deobfuscated from APK)

### dispositivo.ashx - Device Authentication

The app uses a two-phase device authentication, both via `dispositivo.ashx`:

**Phase 1: New Device Registration** (`accion=registrar`)
- Used when `localStorage.getItem('idDispositivo')` is null/empty
- Called from function `0xedf` in `main.b3d70c09e1bc11b9.js`
- POST to `urlServidor + 'dispositivo.ashx'`
- Parameters:
  - `accion`: `registrar`
  - `uid`: `device.uuid` (Cordova Device plugin = Android ID, 16-char hex)
  - `plataforma`: `android`
  - `tipo_dispositivo`: `android`
  - `version`: `versionAPPNumerico` (e.g., `40044` from version `4.0.44`)
  - Does NOT send `id_dispositivo` or `token_push`
- Response: `{ resultado: 'correcto', id_dispositivo: '...', key: '...', ... }`
- If `uuid ya registrado` → server reuses existing device, still returns `id_dispositivo` + `key`

**Phase 2: Existing Device Access** (`accion=acceso`)
- Used when `localStorage.getItem('idDispositivo')` exists (subsequent app launches)
- Called from function `0x836` (`GuardarKey`) in `main.b3d70c09e1bc11b9.js`
- POST to `urlServidor + 'dispositivo.ashx'`
- Parameters:
  - `accion`: `acceso`
  - `uid`: `device.uuid`
  - `plataforma`: `android`
  - `tipo_dispositivo`: `android`
  - `id_dispositivo`: stored value from Phase 1
  - `token_push`: Firebase push token (can be empty)
  - `version`: `versionAPPNumerico`
- Response: `{ resultado: 'correcto', key: '...', ... }`

### Response Handling (`UltimaActualizacion` function)
- `response.key` → stored in `sessionStorage.setItem('key', ...)`
- `response.id_dispositivo` → stored in `localStorage.setItem('idDispositivo', ...)`
- `response.urlServidorDinamica` → updates the dynamic API URL for data endpoints

### registro.ashx - User Registration (separate from device)
- Used for user profile registration (email, sexo, provincia, etc.)
- Not required for data access

### HTTP Headers
- `Content-Type`: `application/x-www-form-urlencoded;charset=UTF-8`
- Body: `URLSearchParams.toString()` (via Angular `HttpClient.post()`)

### Version Calculation
- App version string (e.g., `4.0.44`) → `split('.')` → pad each to 2 digits → concat → `parseInt`
- `4.0.44` → `['4','0','44']` → `'040044'` → `parseInt('040044')` → `40044`

## Common Parameters
- `accion` - Action to perform
- `id_dispositivo` - Device ID (from localStorage, server-assigned)
- `key` - Session key (from sessionStorage, refreshed on each `acceso`)
- `id_categoria_competicion` - Competition category ID
- `id_fase` - Phase ID
- `id_grupo` - Group ID
- `id_partido` - Match ID
- `id_jugador` - Player ID
- `id_equipo` - Team ID
- `id_temporada` - Season ID
- `id_club` - Club ID
- `id_componente_club` - Club component ID
- `id_calendario` - Calendar ID
- `id_ronda` - Round ID
- `tipo` - Type
- `tipo_acta` - Record type
- `tipo_fase` - Phase type

## Known Stats Categories (from JS)
- `EquiposPuntos` - Team points
- `EquiposRebotes` - Team rebounds
- `EquiposCanastasDos` - Team 2-point baskets
- `EquiposCanastasTres` - Team 3-point baskets
- `EquiposTirosLibres` - Team free throws
- `EquiposAsistencia` - Team assists
- `EquiposRecuperaciones` - Team steals
- `EquiposTapones` - Team blocks
- `EquiposValoracion` - Team rating
- `MediaPuntos` - Points average
