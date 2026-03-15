"""
Cliente HTTP para la API de CABB/Indalweb/GesDeportiva.

Hallazgos clave (reverse engineering APK + mitmproxy):
- TODA llamada es POST con Content-Type: application/x-www-form-urlencoded
- La key es ROTATIVA: cada response devuelve una nueva key para el próximo request
- tipo_dispositivo debe ser "mobile" (no "android")
- id_dispositivo es base64(random 64 bytes) generado al "instalar" la app
- No se pueden hacer llamadas en paralelo (key secuencial)
"""

import base64
import json
import logging
import os
import time
import uuid
from pathlib import Path

import requests

from .config import (
    API_URL,
    APP_VERSION,
    BASE_URL,
    DELAY_BETWEEN_CALLS,
    ENDPOINTS,
    HEADERS,
    SESSION_FILE,
)

logger = logging.getLogger(__name__)


class CABBClient:
    """Cliente para la API CABB con autenticación por dispositivo y key rotativa."""

    def __init__(self, session_file: str = SESSION_FILE):
        self.session_file = Path(session_file)
        self.id_dispositivo: str = ""
        self.key: str = ""
        self.uid: str = ""
        self._last_call_time: float = 0
        self._load_session()

    # ------------------------------------------------------------------
    # Sesión
    # ------------------------------------------------------------------

    def _load_session(self):
        """Cargar sesión previa desde disco."""
        try:
            if self.session_file.exists():
                data = json.loads(self.session_file.read_text())
                self.id_dispositivo = data.get("id_dispositivo", "")
                self.key = data.get("key", "")
                self.uid = data.get("uid", "")
                logger.info("Sesión cargada (key=%s)", "OK" if self.key else "vacía")
        except (json.JSONDecodeError, OSError) as e:
            logger.warning("No se pudo cargar sesión: %s", e)

    def _save_session(self):
        """Persistir sesión a disco."""
        self.session_file.parent.mkdir(parents=True, exist_ok=True)
        self.session_file.write_text(json.dumps({
            "id_dispositivo": self.id_dispositivo,
            "key": self.key,
            "uid": self.uid,
        }, indent=2))

    # ------------------------------------------------------------------
    # Registro de dispositivo
    # ------------------------------------------------------------------

    def register_device(self) -> bool:
        """
        Registrar dispositivo en la API y obtener key inicial.

        Parámetros descubiertos con mitmproxy:
        - accion: "acceso"
        - plataforma: "android"
        - tipo_dispositivo: "mobile" (NO "android")
        - id_dispositivo: base64 de 64 bytes random
        - token_push: vacío
        - version: "40044"
        """
        # Siempre renovar la key al inicio (key rotativa, la cacheada puede estar vieja)
        if self.key and self.id_dispositivo:
            logger.info("Sesión cacheada encontrada, renovando key via acceso...")
            # No retornar, seguir abajo para renovar

        if not self.uid:
            # uid capturado con mitmproxy del emulador real
            self.uid = "006c2e08cd134ffd"

        if not self.id_dispositivo:
            # id_dispositivo capturado con mitmproxy (asignado por el servidor)
            self.id_dispositivo = "9oHkyymjanyD2IGeKO-Iv8v76lE6baoDF6FDGUHZSk3P-Py4yrPIcCtoNw9Cssq-OzRGAW2dmKY0amLORzroSw=="

        logger.info("Registrando dispositivo uid=%s", self.uid)

        params = {
            "accion": "acceso",
            "uid": self.uid,
            "plataforma": "android",
            "tipo_dispositivo": "mobile",
            "id_dispositivo": self.id_dispositivo,
            "token_push": "",
            "version": APP_VERSION,
        }

        try:
            resp = requests.post(
                f"{BASE_URL}/{ENDPOINTS['dispositivo']}",
                data=params,
                headers=HEADERS,
                timeout=60,
            )
            resp.raise_for_status()
            result = resp.json()

            if result.get("resultado") == "correcto" or result.get("key"):
                self.key = result.get("key", "")
                if result.get("id_dispositivo"):
                    self.id_dispositivo = result["id_dispositivo"]
                self._save_session()
                logger.info("Dispositivo registrado OK")
                return True

            logger.error("Registro fallido: %s", result)
            return False

        except requests.RequestException as e:
            logger.error("Error de red en registro: %s", e)
            return False

    # ------------------------------------------------------------------
    # Llamada genérica a la API
    # ------------------------------------------------------------------

    def _rate_limit(self):
        """Esperar entre llamadas para no saturar la API."""
        elapsed = time.time() - self._last_call_time
        if elapsed < DELAY_BETWEEN_CALLS:
            time.sleep(DELAY_BETWEEN_CALLS - elapsed)
        self._last_call_time = time.time()

    def api_call(self, endpoint: str, params: dict, use_base_url: bool = False) -> dict | None:
        """
        Llamada POST a la API con key rotativa.

        IMPORTANTE: Cada response incluye una nueva key que reemplaza la anterior.
        Las llamadas DEBEN ser secuenciales (no paralelas).

        Args:
            endpoint: nombre del endpoint (ej: "categoria.ashx")
            params: parámetros de la llamada (accion, ids, etc.)
            use_base_url: True para usar BASE_URL en vez de API_URL (/v2)
        """
        if not self.key:
            if not self.register_device():
                return None

        self._rate_limit()

        base = BASE_URL if use_base_url else API_URL
        url = f"{base}/{endpoint}"

        # Inyectar credenciales de sesión
        params = {**params, "id_dispositivo": self.id_dispositivo, "key": self.key}

        logger.debug("POST %s params=%s", url, {k: v for k, v in params.items() if k != "key"})

        try:
            resp = requests.post(url, data=params, headers=HEADERS, timeout=30)
            resp.raise_for_status()
            result = resp.json()

            # CRÍTICO: Key rotativa - actualizar con cada response
            if result.get("key"):
                self.key = result["key"]
                self._save_session()

            # Log errores para debug
            if result.get("resultado") == "error":
                error_msg = result.get("error", "")
                logger.warning("API error en %s: '%s' (keys: %s)", endpoint, error_msg, list(result.keys()))

            # Sesión expirada → re-registrar y reintentar
            # Detectar: "Sesión caducada", "Faltan parámetros", o error vacío (key inválida)
            if result.get("resultado") == "error":
                error_msg = result.get("error", "")
                is_session_error = error_msg in (
                    "Sesión caducada", "Sesion caducada",
                )
                if is_session_error and not getattr(self, "_retrying", False):
                    logger.warning("Sesión inválida ('%s'), re-registrando...", error_msg)
                    self.key = ""
                    self._retrying = True
                    if self.register_device():
                        result = self.api_call(endpoint, params, use_base_url)
                        self._retrying = False
                        return result
                    self._retrying = False
                    return None

            return result

        except requests.RequestException as e:
            logger.error("Error de red: %s %s", url, e)
            return None

    # ------------------------------------------------------------------
    # Métodos de alto nivel
    # ------------------------------------------------------------------

    def get_delegaciones(self) -> dict | None:
        return self.api_call(ENDPOINTS["delegaciones"], {"accion": "delegaciones"})

    def get_competiciones(self, **extra) -> dict | None:
        return self.api_call(ENDPOINTS["categoria"], {"accion": "competiciones", **extra})

    def buscar_categoria(self, texto: str, skip: int = 0) -> dict | None:
        return self.api_call(ENDPOINTS["busqueda"], {
            "accion": "buscarCategoria", "texto": texto, "skip": str(skip),
        })

    def get_fases_grupos(self, id_categoria_competicion: str) -> dict | None:
        return self.api_call(ENDPOINTS["categoria"], {
            "accion": "fasesGrupos",
            "id_categoria_competicion": id_categoria_competicion,
        })

    def get_clasificacion(self, id_cat_comp: str, id_fase: str, id_grupo: str) -> dict | None:
        return self.api_call(ENDPOINTS["categoria"], {
            "accion": "clasificacion",
            "id_categoria_competicion": id_cat_comp,
            "id_fase": id_fase,
            "id_grupo": id_grupo,
        })

    def get_jornadas(self, id_cat_comp: str, id_fase: str, id_grupo: str,
                     id_ronda: str = "", fecha_inicial: str = "", fecha_final: str = "") -> dict | None:
        params = {
            "accion": "Jornadas",
            "id_categoria_competicion": id_cat_comp,
            "id_fase": id_fase,
            "id_grupo": id_grupo,
        }
        if id_ronda:
            params["id_ronda"] = id_ronda
        if fecha_inicial:
            params["fecha_inicial"] = fecha_inicial
        if fecha_final:
            params["fecha_final"] = fecha_final
        return self.api_call(ENDPOINTS["categoria"], params)

    def get_partidos(self, id_cat_comp: str, id_fase: str, id_grupo: str) -> dict | None:
        return self.api_call(ENDPOINTS["partidos"], {
            "accion": "partidos",
            "id_categoria_competicion": id_cat_comp,
            "id_fase": id_fase,
            "id_grupo": id_grupo,
        })

    def get_partido(self, id_partido: str) -> dict | None:
        return self.api_call(ENDPOINTS["partido"], {
            "accion": "partido",
            "id_partido": id_partido,
        })

    def get_estadisticas_partido(self, id_partido: str) -> dict | None:
        return self.api_call(ENDPOINTS["estadisticas"], {
            "accion": "estadisticas",
            "id_partido": id_partido,
        })

    def get_estadisticas_equipo(self, id_equipo: str, id_cat_comp: str,
                                 id_fase: str, id_grupo: str) -> dict | None:
        return self.api_call(ENDPOINTS["estadisticas"], {
            "accion": "estadisticasEquipo",
            "id_equipo": id_equipo,
            "id_categoria_competicion": id_cat_comp,
            "id_fase": id_fase,
            "id_grupo": id_grupo,
        })

    def get_estadisticas_jugador(self, id_jugador: str, id_cat_comp: str,
                                  id_fase: str, id_grupo: str) -> dict | None:
        return self.api_call(ENDPOINTS["estadisticas"], {
            "accion": "estadisticasJugador",
            "id_jugador": id_jugador,
            "id_categoria_competicion": id_cat_comp,
            "id_fase": id_fase,
            "id_grupo": id_grupo,
        })

    def get_jugadores(self, id_equipo: str, id_cat_comp: str) -> dict | None:
        return self.api_call(ENDPOINTS["jugadores"], {
            "accion": "jugadores",
            "id_equipo": id_equipo,
            "id_categoria_competicion": id_cat_comp,
        })

    def get_equipo(self, id_equipo: str) -> dict | None:
        return self.api_call(ENDPOINTS["equipo"], {
            "accion": "equipo",
            "id_equipo": id_equipo,
        })

    def buscar(self, tipo: str, texto: str, skip: int = 0) -> dict | None:
        """Buscar por tipo: Categoria, Club, Equipo, Jugador, Partido."""
        return self.api_call(ENDPOINTS["busqueda"], {
            "accion": f"buscar{tipo}",
            "texto": texto,
            "skip": str(skip),
        })


def decode_cabb_hex_id(hex_string: str) -> str:
    """
    Decodifica IDs hex UTF-16LE de la API CABB.

    La API usa internamente IDs codificados como hex de UTF-16LE.
    Ejemplo:
        "470042007700710076002B00..." → "GBwqv+A993..."

    Args:
        hex_string: String hexadecimal a decodificar
    Returns:
        String decodificado (generalmente un valor base64)
    """
    raw_bytes = bytes.fromhex(hex_string)
    return raw_bytes.decode("utf-16-le")
