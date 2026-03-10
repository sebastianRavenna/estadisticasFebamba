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

## Common Parameters
- `accion` - Action to perform
- `id_dispositivo` - Device ID (from localStorage)
- `key` - Session key (from sessionStorage)
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
