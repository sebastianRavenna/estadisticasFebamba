"""
Configuración del scraper CABB/FEBAMBA.
Todos los valores descubiertos via reverse engineering del APK + mitmproxy.
"""

# URLs base
BASE_URL = "https://appaficioncabb.indalweb.net"
API_URL = f"{BASE_URL}/v2"

# Versión de la app CABB: 4.0.44 → parseInt("040044") = 40044
APP_VERSION = "40044"

# Headers que simula la app real
HEADERS = {
    "Content-Type": "application/x-www-form-urlencoded",
    "Accept": "application/json, text/plain, */*",
    "User-Agent": (
        "Mozilla/5.0 (Linux; Android 13) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Mobile Safari/537.36"
    ),
}

# Rate limiting (segundos entre llamadas)
DELAY_BETWEEN_CALLS = 1.5

# Archivo de sesión persistente
SESSION_FILE = ".session.json"

# Competiciones objetivo para FEBAMBA 2026
# Estos IDs se descubren dinámicamente buscando "FEBAMBA" o "Buenos Aires"
# en la API con buscarCategoria. Se actualizan en cada sync.
TARGET_DELEGACION_FEBAMBA = 1  # FEBAMBA = delegación 1 bajo CABB

# Endpoints de la API (todos usan POST con form-urlencoded)
ENDPOINTS = {
    "dispositivo": "dispositivo.ashx",           # URL base (no /v2)
    "delegaciones": "delegaciones.ashx",
    "categoria": "categoria.ashx",
    "partidos": "partidos.ashx",
    "partido": "partido.ashx",
    "estadisticas": "estadisticas.ashx",
    "jugadores": "jugadores.ashx",
    "equipo": "equipo.ashx",
    "club": "club.ashx",
    "busqueda": "busqueda.ashx",
    "comparativa": "comparativa.ashx",
    "tiro": "tiro.ashx",
    "mispartidos": "mispartidos.ashx",
    "envivo_estadisticas": "envivo/estadisticas.ashx",
    "descargar": "descargar.ashx",
}
