"""
Sincronización completa: descarga datos de la API CABB y los guarda en SQLite.

Flujo:
  1. Registrar dispositivo → obtener key
  2. Buscar competiciones FEBAMBA (Superior / Formativas)
  3. Para cada competición → fases → grupos
  4. Para cada grupo → clasificación + partidos
  5. Para cada partido finalizado → estadísticas de jugadores
  6. Guardar todo en SQLite

IMPORTANTE: Las llamadas son secuenciales (key rotativa).
"""

import json
import logging
import sys
from pathlib import Path

# Agregar raíz del proyecto al path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from db.database import (
    get_db,
    init_db,
    log_sync,
    upsert_clasificacion,
    upsert_competicion,
    upsert_equipo,
    upsert_jugador,
    upsert_partido,
    upsert_stats_jugador,
)
from scraper.cabb_client import CABBClient

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


def sync_all(busqueda: str = "FEBAMBA", db_path: Path | None = None):
    """
    Sincronización completa de datos FEBAMBA.

    Args:
        busqueda: texto para buscar competiciones (default "FEBAMBA")
        db_path: ruta de la base de datos SQLite (default: estadisticas_febamba.db)
    """
    if db_path:
        from db.database import DB_FILE
        # Override default
        import db.database
        db.database.DB_FILE = db_path

    init_db()
    client = CABBClient()

    if not client.register_device():
        logger.error("No se pudo registrar dispositivo. Abortando.")
        return False

    logger.info("=== Iniciando sincronización ===")

    # Paso 1: Buscar competiciones
    # El JS usa buscar('Categoria', 'Buenos Aires') y el resultado viene en "categorias"
    logger.info("Buscando competiciones '%s'...", busqueda)
    result = client.buscar_categoria(busqueda)

    # Debug: mostrar estructura de respuesta
    if result:
        logger.info("Respuesta búsqueda - keys: %s", list(result.keys()))
        logger.info("Respuesta búsqueda - resultado: %s", result.get("resultado", "N/A"))

    competiciones = []
    if result:
        # La API devuelve las competiciones en "categorias" (confirmado por scraper_api.js)
        if "categorias" in result:
            competiciones = result["categorias"]
        elif result.get("resultado") == "correcto":
            datos = result.get("datos", [])
            if isinstance(datos, list):
                competiciones = datos
            elif isinstance(datos, dict):
                competiciones = datos.get("ListaCategorias", datos.get("Lista", [datos]))

    if not competiciones:
        # Fallback: buscar "Buenos Aires" como hace el JS
        logger.info("Buscando con 'Buenos Aires'...")
        result2 = client.buscar_categoria("Buenos Aires")
        if result2:
            logger.info("Respuesta Buenos Aires - keys: %s", list(result2.keys()))
            if "categorias" in result2:
                competiciones = result2["categorias"]
            elif result2.get("datos"):
                datos = result2["datos"]
                competiciones = datos if isinstance(datos, list) else [datos]

    if not competiciones:
        # Fallback: intentar con get_competiciones
        logger.info("Buscando competiciones con endpoint directo...")
        result = client.get_competiciones()
        if result:
            logger.info("Respuesta competiciones - keys: %s", list(result.keys()))
            if result.get("datos"):
                datos = result["datos"]
                competiciones = datos if isinstance(datos, list) else [datos]

    logger.info("Encontradas %d competiciones", len(competiciones))

    with get_db() as conn:
        total_partidos = 0
        total_stats = 0

        for comp_data in competiciones:
            comp_id = str(comp_data.get("IdCategoriaCompeticion",
                          comp_data.get("IdCompeticionCategoria",
                          comp_data.get("Id", ""))))
            comp_nombre = comp_data.get("NombreCompeticion",
                          comp_data.get("Nombre", "Sin nombre"))

            if not comp_id:
                continue

            logger.info("Competición: %s (ID=%s)", comp_nombre, comp_id)
            upsert_competicion(conn, comp_data, json.dumps(comp_data))

            # Paso 2: Obtener fases y grupos
            fases_result = client.get_fases_grupos(comp_id)
            if not fases_result or fases_result.get("resultado") == "error":
                logger.warning("  No se pudieron obtener fases para %s", comp_id)
                continue

            datos_fases = fases_result.get("datos", {})
            lista_fases = (
                datos_fases.get("ListaFases")
                or datos_fases.get("Fases")
                or ([datos_fases] if isinstance(datos_fases, dict) else [])
            )

            for fase in (lista_fases if isinstance(lista_fases, list) else [lista_fases]):
                fase_id = str(fase.get("IdFase", fase.get("Id", "")))
                fase_nombre = fase.get("Nombre", "")
                logger.info("  Fase: %s (ID=%s)", fase_nombre, fase_id)

                lista_grupos = (
                    fase.get("ListaGrupos")
                    or fase.get("Grupos")
                    or ([fase] if isinstance(fase, dict) else [])
                )

                for grupo in (lista_grupos if isinstance(lista_grupos, list) else [lista_grupos]):
                    grupo_id = str(grupo.get("IdGrupo", grupo.get("Id", "")))
                    grupo_nombre = grupo.get("Nombre", "")
                    logger.info("    Grupo: %s (ID=%s)", grupo_nombre, grupo_id)

                    # Paso 3: Clasificación (tabla de posiciones)
                    clas_result = client.get_clasificacion(comp_id, fase_id, grupo_id)
                    if clas_result and clas_result.get("resultado") == "correcto":
                        clas_datos = clas_result.get("datos", [])
                        lista_clas = (
                            clas_datos if isinstance(clas_datos, list)
                            else clas_datos.get("ListaClasificacion",
                                 clas_datos.get("Clasificacion", []))
                        )
                        for equipo_clas in (lista_clas if isinstance(lista_clas, list) else []):
                            upsert_clasificacion(conn, equipo_clas, comp_id, fase_id, grupo_id,
                                                 json.dumps(equipo_clas))
                            # También guardar el equipo
                            upsert_equipo(conn, equipo_clas, json.dumps(equipo_clas))
                        logger.info("      Clasificación: %d equipos", len(lista_clas) if isinstance(lista_clas, list) else 0)

                    # Paso 4: Partidos
                    partidos_result = client.get_partidos(comp_id, fase_id, grupo_id)
                    if not partidos_result or partidos_result.get("resultado") == "error":
                        continue

                    datos_partidos = partidos_result.get("datos", [])
                    lista_partidos = (
                        datos_partidos if isinstance(datos_partidos, list)
                        else datos_partidos.get("ListaPartidos",
                             datos_partidos.get("Partidos", []))
                    )

                    for partido_data in (lista_partidos if isinstance(lista_partidos, list) else []):
                        partido_id = str(partido_data.get("IdPartido",
                                         partido_data.get("Id", "")))
                        if not partido_id:
                            continue

                        upsert_partido(conn, partido_data, json.dumps(partido_data))
                        total_partidos += 1

                        # Paso 5: Stats de partidos finalizados
                        estado = (partido_data.get("Estado", "")
                                  or partido_data.get("estado", "")).lower()
                        if estado not in ("finalizado", "terminado"):
                            continue

                        stats_result = client.get_estadisticas_partido(partido_id)
                        if not stats_result or stats_result.get("resultado") == "error":
                            continue

                        datos_stats = stats_result.get("datos", {})

                        # Las stats vienen como listas de jugadores (local + visitante)
                        jugadores_stats = []
                        if isinstance(datos_stats, list):
                            jugadores_stats = datos_stats
                        elif isinstance(datos_stats, dict):
                            for key in ("JugadoresLocal", "JugadoresVisitante",
                                        "Local", "Visitante", "Jugadores",
                                        "ListaJugadores"):
                                val = datos_stats.get(key, [])
                                if isinstance(val, list):
                                    jugadores_stats.extend(val)

                        for jug_stat in jugadores_stats:
                            jug_id = str(jug_stat.get("IdJugador",
                                         jug_stat.get("Id", "")))
                            if not jug_id:
                                continue
                            upsert_jugador(conn, jug_stat, json.dumps(jug_stat))
                            upsert_stats_jugador(conn, jug_id, partido_id,
                                                 jug_stat, json.dumps(jug_stat))
                            total_stats += 1

                    logger.info("      Partidos: %d", len(lista_partidos) if isinstance(lista_partidos, list) else 0)

        log_sync(conn, "full_sync", f"busqueda={busqueda}", total_partidos)
        logger.info("=== Sincronización completada ===")
        logger.info("  Partidos: %d", total_partidos)
        logger.info("  Stats jugador: %d", total_stats)

    return True


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Sincronizar datos CABB/FEBAMBA")
    parser.add_argument("--busqueda", default="FEBAMBA", help="Texto de búsqueda (default: FEBAMBA)")
    parser.add_argument("--db", default=None, help="Ruta de la base de datos SQLite")
    args = parser.parse_args()

    db = Path(args.db) if args.db else None
    success = sync_all(busqueda=args.busqueda, db_path=db)
    sys.exit(0 if success else 1)
