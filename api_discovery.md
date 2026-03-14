# CABB App API Discovery — Análisis Completo

> Última actualización: deobfuscación exhaustiva del APK con extracción del array de strings rotado.

## App Details
- Package: `com.indalweb.aficionCABB`
- Type: Cordova/Ionic WebView app (Angular 13+)
- Backend: ASP.NET 4.7 (.NET Framework 4.0.30319)
- Server: `appaficioncabb.indalweb.net` (IP: 82.223.195.157)
- SSL: RapidSSL TLS RSA CA G1, wildcard `*.indalweb.net`

## Base URLs
- Static (auth): `https://appaficioncabb.indalweb.net/`  → `urlServidor`
- Dynamic (data): `https://appaficioncabb.indalweb.net/v2/` → `urlServidorDinamica`
  (actualizada con el campo `ruta` de cada respuesta exitosa)

---

## Flujo de Autenticación (deobfuscado de `main.b3d70c09e1bc11b9.js`)

### Paso 0 — Inicialización
El app configura las URLs al arrancar:
```javascript
config.urlServidor = "https://appaficioncabb.indalweb.net/"
config.urlServidorDinamica = "https://appaficioncabb.indalweb.net/v2/"
config.plataforma = "android"  // o "ios"
config.tipoDispositivo = "android"
config.versionAPPNumerico = 40044  // versión "4.0.44" → parseInt("040044") = 40044
```

### Paso 1 — Registro de dispositivo nuevo (`accion=registrar`)

**Cuándo:** `localStorage.getItem('idDispositivo')` es null/vacío (primera vez)

```
POST https://appaficioncabb.indalweb.net/dispositivo.ashx
Content-Type: application/x-www-form-urlencoded

accion=registrar
uid={device.uuid}           ← Android ID: string hex de 16 chars (Cordova device plugin)
plataforma=android          ← o "ios"
tipo_dispositivo=android    ← igual que plataforma
version=40044               ← versionAPPNumerico como string
```

**Respuesta exitosa:**
```json
{
  "resultado": "correcto",
  "id_dispositivo": "<base64url_largo>",
  "key": "<token_sesion_largo>",
  "ruta": "https://appaficioncabb.indalweb.net/",
  "error": "",
  "publicidad": "{ ... }",
  "perfil": { ... },
  "Suscripcion": false,
  "Segmentacion": false,
  ...
}
```

**Nota:** Si el `uid` ya estaba registrado, el server reutiliza el dispositivo y devuelve el mismo `id_dispositivo`.

### Paso 2 — Acceso con dispositivo existente (`accion=acceso`)

**Cuándo:** `localStorage.getItem('idDispositivo')` existe (ejecuciones subsiguientes)
Función `GuardarKey()` en el JS del APK.

```
POST https://appaficioncabb.indalweb.net/dispositivo.ashx
Content-Type: application/x-www-form-urlencoded

accion=acceso
uid={device.uuid}
plataforma=android
tipo_dispositivo=android
id_dispositivo={id_dispositivo_guardado}
token_push={firebase_token_o_vacio}  ← puede ser ""
version=40044
```

**Respuesta exitosa:** igual que `registrar`, con una nueva `key`.

### UltimaActualizacion() — aplicar respuesta exitosa

El app ejecuta esto con CADA respuesta que tenga `resultado: "correcto"`:

```javascript
// Fuente: función UltimaActualizacion() del APK
if (response.key)
  sessionStorage.setItem('key', response.key)          // KEY: en sessionStorage (volátil!)

sessionStorage.setItem('ultimaLlamadaKey',
  (Date.now() + config.tiempoValidezKey).toString())   // timestamp de expiración

if (response.ruta)
  config.urlServidorDinamica = response.ruta + 'v2/'   // actualizar URL dinámica

if (response.id_dispositivo)
  localStorage.setItem('idDispositivo', response.id_dispositivo) // persistente
```

**IMPORTANTE:** La `key` vive en `sessionStorage` (no `localStorage`). Expira después de `tiempoValidezKey` ms.
La key se ROTA con cada respuesta exitosa del servidor.

---

## Endpoints de Datos — Formato de Request

### HTTP Headers (app real)

```
Content-Type: application/x-www-form-urlencoded
Accept: application/json, text/plain, */*
```

No hay headers custom de auth. Las credenciales van en el **body** como form params.

### Parámetros comunes en requests autenticados

```
id_dispositivo = localStorage.getItem('idDispositivo')
key            = sessionStorage.getItem('key')
```

### GetJSON() — función core de HTTP del APK

```javascript
// Fuente: método GetJSON() deobfuscado
GetJSON(url, params, isPost) {
  return isPost
    ? this.http.post(url, params.toString(), { headers: {'Content-Type': 'application/x-www-form-urlencoded'} })
    : this.http.get(url);
  // después de hacer la llamada, llama a ComprobarRenovacionKey()
}
```

---

## Endpoints Documentados

### `dispositivo.ashx` — Autenticación
- `accion=registrar` — registrar dispositivo nuevo
- `accion=acceso` — refrescar key con dispositivo existente

### `busqueda.ashx` — Búsqueda

Usa `urlServidorDinamica` (`/v2/busqueda.ashx`).

**buscarCategoria** (BuscarCategorias):
```
accion=buscarCategoria
id_dispositivo={id}
key={key}
texto={texto_busqueda}
skip={offset_paginacion}   ← 0 para primer página, n para paginar
```

**buscarClub** (BuscarClubes):
```
accion=buscarClub
id_dispositivo={id}
key={key}
texto={texto_busqueda}
skip={offset}
```

**buscarJugador** (BuscarJugadores):
```
accion=buscarJugador
id_dispositivo={id}
key={key}
nombre={nombre}
texto={apellidos}
skip={offset}
```

**buscarEquipo** (BuscarEquipos):
```
accion=buscarEquipo
id_dispositivo={id}
key={key}
texto={texto_busqueda}
skip={offset}
```

**buscarPartido** (BuscarPartidos):
```
accion=buscarPartido
id_dispositivo={id}
key={key}
texto={texto_busqueda}
skip={offset}
```

### `categoria.ashx` — Categorías y Competiciones

Usa `urlServidorDinamica` (`/v2/categoria.ashx`).

| accion | Descripción | Params adicionales |
|--------|-------------|-------------------|
| `competiciones` | Lista competiciones | (ninguno) |
| `fasesGrupos` | Fases y grupos de una competición | `id_categoria_competicion` |
| `fasesGruposCompeticion` | Fases/grupos por competición | `id_categoria_competicion` |
| `fasesGruposEquipo` | Fases/grupos por equipo | múltiples |
| `clasificacion` | Tabla de posiciones | `id_grupo`, `tipo_fase`, `jornada`, `ventana` |
| `Jornadas` | Jornadas de una fase | `id_fase`, `id_grupo`, `id_ronda` |
| `horariosJornadas` | Horarios por jornada | `id_fase`, `id_grupo` |
| `estadisticasEquipo` | Stats de equipo en competición | ver nota |
| `mejoresJugadores` | Top jugadores | ⚠️ puede dar 500 |
| `fasesGruposCompeticionEstadisticasEquipoJugador` | Stats jugadores por fase | múltiples |

### `equipo.ashx` — Equipos

Usa `urlServidorDinamica`.

| accion | Descripción |
|--------|-------------|
| `equipo` | Detalle de equipo |
| `equipos` | Lista equipos |
| `equiposClub` | Equipos de un club |
| `equiposGrupo` | Equipos de un grupo |
| `equiposJugador` | Equipos de un jugador |

### `delegaciones.ashx` — Delegaciones/Federaciones

Usa `urlServidor` (`/delegaciones.ashx`, sin `/v2/`).

**CargarComboDelegacionesGesdeportiva:**
```
id_dispositivo={id}
key={key}
```
(sin parámetro `accion`)

**Función getDelegaciones en scraper:**
```
accion=delegaciones
id_dispositivo={id}
key={key}
```

### `equipos-jugadores.ashx` — Combos Gesdeportiva

Usa `urlServidor` (`/equipos-jugadores.ashx`, sin `/v2/`).

**CargarComboCABB:**
```
accion=competiciones
delegacion={id_federacion}
id_dispositivo={id}
key={key}
```

### `partidos.ashx` — Partidos
| accion | Descripción |
|--------|-------------|
| `partidos` | Lista de partidos |
| `proximos` | Próximos partidos |
| `partidosClub` | Partidos de un club |
| `partidosFavoritos` | Partidos favoritos |

### `partido.ashx` — Partido
| accion | Descripción |
|--------|-------------|
| `partido` | Detalle de partido |
| `partidoEnVivo` | Partido en vivo |

### `envivo/estadisticas.ashx` — Estadísticas en Vivo (también funciona post-partido)
```
accion=estadisticas
id={id_partido}
id_dispositivo={id}
key={key}
```
**✅ Funciona bien como probe de sesión** — devuelve JSON incluso si el partido no existe.

### `estadisticas.ashx` — Estadísticas (v2)
| accion | Descripción |
|--------|-------------|
| `estadisticas` | Stats generales |
| `estadisticasEquipo` | Stats de equipo |
| `estadisticasJugador` | Stats de jugador |
| `estadisticasequipolocal` | Stats equipo local |
| `estadisticasequipovisitante` | Stats equipo visitante |

### `jugadores.ashx` — Jugadores
| accion | Descripción |
|--------|-------------|
| `jugadores` | Lista jugadores |
| `jugadoreslocales` | Jugadores locales |
| `jugadoresvisitantes` | Jugadores visitantes |
| `jugadoresenpistalocal` | Jugadores en pista locales |
| `jugadoresenpistavisitante` | Jugadores en pista visitantes |

### `jugador.ashx` — Jugador
Detalle de jugador individual.

### `club.ashx` — Club
| accion | Descripción |
|--------|-------------|
| `club` | Detalle del club |
| `clubes` | Lista de clubes |

### `misequipos.ashx`, `misjugadores.ashx`, `mispartidos.ashx`, `misdatos.ashx`
Endpoints personalizados (requieren usuario logueado, no anónimo).

### `envivo/comparativa.ashx`, `envivo/mejores-jugadores.ashx`, `envivo/mapa-de-tiro.ashx`
Endpoints para partido en vivo.

### `autenticar.ashx` — Autenticación de usuario
Para login con email/password (opcional, no requerido para datos públicos).

### `registro.ashx` — Registro de usuario
Para crear cuenta de usuario (opcional).

### `imagenes.ashx?tipo=...&id=`
Imágenes de equipos, jugadores, etc.

---

## Causa Raíz del HTTP 500

**Comportamiento observado:**
- Request SIN credenciales → HTTP 200 con `{"resultado":"error","error":"Faltan parámetros"}`
- Request CON credenciales VÁLIDAS → HTTP 200 con datos + nueva `key`
- Request CON credenciales EXPIRADAS/INVÁLIDAS → **HTTP 500 Internal Server Error**

**Explicación:** El servidor ASP.NET intenta buscar la sesión en su DB cuando recibe `id_dispositivo`+`key`. Si la key expiró o es inválida, el lookup devuelve null y el código del servidor lanza una excepción no manejada, causando HTTP 500.

**Solución:** Renovar la key antes de cada sesión de requests:
1. Llamar `accion=acceso` con el `id_dispositivo` guardado
2. Usar la `key` fresca inmediatamente
3. Actualizar la `key` con cada respuesta exitosa del servidor (UltimaActualizacion pattern)

---

## Parámetros Comunes

| Parámetro | Descripción |
|-----------|-------------|
| `accion` | Acción a ejecutar |
| `id_dispositivo` | Device ID (asignado por servidor, base64url) |
| `key` | Token de sesión (rotado en cada respuesta) |
| `id_categoria_competicion` | ID de categoría-competición |
| `id_fase` | ID de fase |
| `id_grupo` | ID de grupo |
| `id_partido` | ID de partido |
| `id_jugador` | ID de jugador |
| `id_equipo` | ID de equipo |
| `id_temporada` | ID de temporada |
| `id_club` | ID de club |
| `id_componente_club` | Componente del club |
| `id_calendario` | ID de calendario |
| `id_ronda` | ID de ronda |
| `tipo` | Tipo |
| `tipo_acta` | Tipo de acta |
| `tipo_fase` | Tipo de fase |
| `skip` | Offset de paginación (0-based) |
| `texto` | Texto de búsqueda |
| `delegacion` | ID/nombre de delegación |

---

## Versión de la App

```javascript
// Deobfuscado de versionAPPToNumber()
version_string.split('.')
  .map(v => v.padStart(2, '0'))
  .join('')          // "4.0.44" → "040044"
  |> parseInt(...)   // → 40044
```

---

## Arquitectura del APK

- **Framework:** Ionic (Angular) empaquetado con Cordova
- **Archivo principal:** `assets/www/main.b3d70c09e1bc11b9.js` (1.6 MB, obfuscado)
- **Obfuscación:** `javascript-obfuscator` con array de strings rotado
- **Decoder:** función `a79_0x5651()` que mapea índices hex al array `a79_0x4754()`
- **HTTP client:** Angular `HttpClient` (`this.http.post()`)
- **URLSearchParams alias:** `_0x47a646['LE']` = `URLSearchParams`
- **HttpHeaders alias:** `_0x47a646['WM']` = `HttpHeaders`
- **Config global:** `_0x170506['h']` = objeto `AppConfig`

---

## Estadísticas por Tipo (Strings deobfuscados del APK)

### Estadísticas de Equipo
- `EquiposPuntos` — Puntos totales
- `EquiposRebotes` — Rebotes totales
- `EquiposCanastasDos` — Canastas de 2 puntos
- `EquiposCanastasTres` — Canastas de 3 puntos
- `EquiposTirosLibres` — Tiros libres
- `EquiposAsistencia` — Asistencias
- `EquiposRecuperaciones` — Recuperaciones (steals)
- `EquiposTapones` — Tapones (blocks)
- `EquiposValoracion` — Valoración (PIR)

### Estadísticas de Jugador (por partidos)
- `MediaPuntos`, `PorcentajeTirosLibresJugador`
- `TirosCampoAnotadosJugador`, `TirosTripleTotalMediaJugador`
- `RecuperacionesMediaJugador`, `RebotesMediaJugador`
- `FaltasCometidasTotalesJugador`, `FaltaRecibidaMedia`
- `PartidosJugados`, `PartidosGanados`
- `Perdidas` (turnovers)
- `RebotesOfensivos`
- `PorcentajeTirosLibres`

---

## URLs del Sistema

```
App CABB:          https://appaficioncabb.indalweb.net/
API v2:            https://appaficioncabb.indalweb.net/v2/
Anuncios:          https://servidordeanuncios.indalweb.net/
Aviso legal:       https://www.gesdeportiva.es/avisos-legales-app-aficion/cab/
App iOS:           https://itunes.apple.com/es/app/cabb/id1549823920
App Android:       https://play.google.com/store/apps/details?id=com.indalweb.aficionCABB
```
