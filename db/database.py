"""
Base de datos SQLite para estadísticas CABB/FEBAMBA.
Esquema derivado de las respuestas de la API de Indalweb.
"""

import logging
import sqlite3
from contextlib import contextmanager
from pathlib import Path

logger = logging.getLogger(__name__)

DB_FILE = Path("estadisticas_febamba.db")


@contextmanager
def get_db(db_path: Path = DB_FILE):
    """Context manager para conexión SQLite."""
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db(db_path: Path = DB_FILE):
    """Crear todas las tablas si no existen."""
    with get_db(db_path) as conn:
        conn.executescript(SCHEMA)
    logger.info("Base de datos inicializada: %s", db_path)


SCHEMA = """
-- Delegaciones / Federaciones
CREATE TABLE IF NOT EXISTS delegaciones (
    id_delegacion   TEXT PRIMARY KEY,
    nombre          TEXT NOT NULL,
    raw_json        TEXT
);

-- Competiciones (torneos)
CREATE TABLE IF NOT EXISTS competiciones (
    id_categoria_competicion TEXT PRIMARY KEY,
    nombre                   TEXT,
    temporada                TEXT,
    id_delegacion            TEXT,
    categoria                TEXT,
    raw_json                 TEXT,
    FOREIGN KEY (id_delegacion) REFERENCES delegaciones(id_delegacion)
);

-- Fases dentro de una competición
CREATE TABLE IF NOT EXISTS fases (
    id_fase                  TEXT PRIMARY KEY,
    id_categoria_competicion TEXT NOT NULL,
    nombre                   TEXT,
    raw_json                 TEXT,
    FOREIGN KEY (id_categoria_competicion) REFERENCES competiciones(id_categoria_competicion)
);

-- Grupos/zonas dentro de una fase
CREATE TABLE IF NOT EXISTS grupos (
    id_grupo    TEXT PRIMARY KEY,
    id_fase     TEXT NOT NULL,
    nombre      TEXT,
    raw_json    TEXT,
    FOREIGN KEY (id_fase) REFERENCES fases(id_fase)
);

-- Clubes
CREATE TABLE IF NOT EXISTS clubes (
    id_club     TEXT PRIMARY KEY,
    nombre      TEXT NOT NULL,
    raw_json    TEXT
);

-- Equipos
CREATE TABLE IF NOT EXISTS equipos (
    id_equipo                TEXT PRIMARY KEY,
    nombre                   TEXT NOT NULL,
    id_club                  TEXT,
    id_categoria_competicion TEXT,
    id_grupo                 TEXT,
    raw_json                 TEXT,
    FOREIGN KEY (id_club) REFERENCES clubes(id_club),
    FOREIGN KEY (id_categoria_competicion) REFERENCES competiciones(id_categoria_competicion),
    FOREIGN KEY (id_grupo) REFERENCES grupos(id_grupo)
);

-- Jugadores
CREATE TABLE IF NOT EXISTS jugadores (
    id_jugador               TEXT PRIMARY KEY,
    nombre                   TEXT NOT NULL,
    dorsal                   TEXT,
    posicion                 TEXT,
    id_equipo                TEXT,
    id_categoria_competicion TEXT,
    raw_json                 TEXT,
    FOREIGN KEY (id_equipo) REFERENCES equipos(id_equipo)
);

-- Partidos
CREATE TABLE IF NOT EXISTS partidos (
    id_partido               TEXT PRIMARY KEY,
    id_categoria_competicion TEXT,
    id_fase                  TEXT,
    id_grupo                 TEXT,
    jornada                  TEXT,
    fecha                    TEXT,
    estado                   TEXT,
    id_equipo_local          TEXT,
    nombre_local             TEXT,
    puntos_local             INTEGER,
    id_equipo_visitante      TEXT,
    nombre_visitante         TEXT,
    puntos_visitante         INTEGER,
    raw_json                 TEXT,
    FOREIGN KEY (id_categoria_competicion) REFERENCES competiciones(id_categoria_competicion),
    FOREIGN KEY (id_equipo_local) REFERENCES equipos(id_equipo),
    FOREIGN KEY (id_equipo_visitante) REFERENCES equipos(id_equipo)
);

-- Estadísticas de jugador por partido
CREATE TABLE IF NOT EXISTS stats_jugador_partido (
    id_jugador  TEXT NOT NULL,
    id_partido  TEXT NOT NULL,
    id_equipo   TEXT,
    minutos     TEXT,
    puntos      INTEGER DEFAULT 0,
    rebotes     INTEGER DEFAULT 0,
    reb_of      INTEGER DEFAULT 0,
    reb_def     INTEGER DEFAULT 0,
    asistencias INTEGER DEFAULT 0,
    robos       INTEGER DEFAULT 0,
    tapones     INTEGER DEFAULT 0,
    perdidas    INTEGER DEFAULT 0,
    faltas      INTEGER DEFAULT 0,
    tl_convertidos  INTEGER DEFAULT 0,
    tl_intentados   INTEGER DEFAULT 0,
    t2_convertidos  INTEGER DEFAULT 0,
    t2_intentados   INTEGER DEFAULT 0,
    t3_convertidos  INTEGER DEFAULT 0,
    t3_intentados   INTEGER DEFAULT 0,
    valoracion  INTEGER DEFAULT 0,
    raw_json    TEXT,
    PRIMARY KEY (id_jugador, id_partido),
    FOREIGN KEY (id_jugador) REFERENCES jugadores(id_jugador),
    FOREIGN KEY (id_partido) REFERENCES partidos(id_partido)
);

-- Clasificación / Tabla de posiciones
CREATE TABLE IF NOT EXISTS clasificacion (
    id_equipo                TEXT NOT NULL,
    id_categoria_competicion TEXT NOT NULL,
    id_fase                  TEXT,
    id_grupo                 TEXT,
    posicion                 INTEGER,
    partidos_jugados         INTEGER DEFAULT 0,
    partidos_ganados         INTEGER DEFAULT 0,
    partidos_perdidos        INTEGER DEFAULT 0,
    puntos_favor             INTEGER DEFAULT 0,
    puntos_contra            INTEGER DEFAULT 0,
    diferencia               INTEGER DEFAULT 0,
    puntos_clasificacion     INTEGER DEFAULT 0,
    raw_json                 TEXT,
    PRIMARY KEY (id_equipo, id_categoria_competicion, id_grupo),
    FOREIGN KEY (id_equipo) REFERENCES equipos(id_equipo),
    FOREIGN KEY (id_categoria_competicion) REFERENCES competiciones(id_categoria_competicion)
);

-- Metadata de sincronización
CREATE TABLE IF NOT EXISTS sync_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp   TEXT NOT NULL DEFAULT (datetime('now')),
    tipo        TEXT NOT NULL,
    detalle     TEXT,
    registros   INTEGER DEFAULT 0
);
"""


# ------------------------------------------------------------------
# Funciones de inserción / upsert
# ------------------------------------------------------------------

def upsert_delegacion(conn: sqlite3.Connection, id_del: str, nombre: str, raw: str):
    conn.execute(
        "INSERT OR REPLACE INTO delegaciones (id_delegacion, nombre, raw_json) VALUES (?, ?, ?)",
        (id_del, nombre, raw),
    )


def upsert_competicion(conn: sqlite3.Connection, data: dict, raw: str):
    conn.execute(
        """INSERT OR REPLACE INTO competiciones
        (id_categoria_competicion, nombre, temporada, id_delegacion, categoria, raw_json)
        VALUES (?, ?, ?, ?, ?, ?)""",
        (
            str(data.get("IdCategoriaCompeticion", data.get("Id", ""))),
            data.get("NombreCompeticion", data.get("Nombre", "")),
            data.get("Temporada", ""),
            str(data.get("IdDelegacion", "")),
            data.get("NombreCategoria", data.get("Categoria", "")),
            raw,
        ),
    )


def upsert_equipo(conn: sqlite3.Connection, data: dict, raw: str):
    conn.execute(
        """INSERT OR REPLACE INTO equipos
        (id_equipo, nombre, id_club, id_categoria_competicion, id_grupo, raw_json)
        VALUES (?, ?, ?, ?, ?, ?)""",
        (
            str(data.get("IdEquipo", data.get("Id", ""))),
            data.get("NombreEquipo", data.get("Nombre", "")),
            str(data.get("IdClub", "")),
            str(data.get("IdCategoriaCompeticion", "")),
            str(data.get("IdGrupo", "")),
            raw,
        ),
    )


def upsert_jugador(conn: sqlite3.Connection, data: dict, raw: str):
    conn.execute(
        """INSERT OR REPLACE INTO jugadores
        (id_jugador, nombre, dorsal, posicion, id_equipo, id_categoria_competicion, raw_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (
            str(data.get("IdJugador", data.get("Id", ""))),
            data.get("Nombre", ""),
            str(data.get("Dorsal", "")),
            data.get("Posicion", ""),
            str(data.get("IdEquipo", "")),
            str(data.get("IdCategoriaCompeticion", "")),
            raw,
        ),
    )


def upsert_partido(conn: sqlite3.Connection, data: dict, raw: str):
    conn.execute(
        """INSERT OR REPLACE INTO partidos
        (id_partido, id_categoria_competicion, id_fase, id_grupo, jornada, fecha, estado,
         id_equipo_local, nombre_local, puntos_local,
         id_equipo_visitante, nombre_visitante, puntos_visitante, raw_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            str(data.get("IdPartido", data.get("Id", ""))),
            str(data.get("IdCategoriaCompeticion", "")),
            str(data.get("IdFase", "")),
            str(data.get("IdGrupo", "")),
            str(data.get("Jornada", "")),
            data.get("Fecha", ""),
            data.get("Estado", ""),
            str(data.get("IdEquipoLocal", "")),
            data.get("NombreLocal", data.get("EquipoLocal", "")),
            data.get("PuntosLocal", 0),
            str(data.get("IdEquipoVisitante", "")),
            data.get("NombreVisitante", data.get("EquipoVisitante", "")),
            data.get("PuntosVisitante", 0),
            raw,
        ),
    )


def upsert_stats_jugador(conn: sqlite3.Connection, id_jugador: str,
                          id_partido: str, data: dict, raw: str):
    conn.execute(
        """INSERT OR REPLACE INTO stats_jugador_partido
        (id_jugador, id_partido, id_equipo, minutos, puntos, rebotes, reb_of, reb_def,
         asistencias, robos, tapones, perdidas, faltas,
         tl_convertidos, tl_intentados, t2_convertidos, t2_intentados,
         t3_convertidos, t3_intentados, valoracion, raw_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            id_jugador,
            id_partido,
            str(data.get("IdEquipo", "")),
            data.get("Minutos", ""),
            data.get("Puntos", 0),
            data.get("Rebotes", 0),
            data.get("RebotesOfensivos", data.get("RO", 0)),
            data.get("RebotesDefensivos", data.get("RD", 0)),
            data.get("Asistencias", 0),
            data.get("Robos", 0),
            data.get("Tapones", 0),
            data.get("Perdidas", 0),
            data.get("FaltasPersonales", data.get("Faltas", 0)),
            data.get("TirosLibresConvertidos", data.get("TLC", 0)),
            data.get("TirosLibresIntentados", data.get("TLI", 0)),
            data.get("TirosDosConvertidos", data.get("T2C", 0)),
            data.get("TirosDosIntentados", data.get("T2I", 0)),
            data.get("TirosTresConvertidos", data.get("T3C", 0)),
            data.get("TirosTresIntentados", data.get("T3I", 0)),
            data.get("Valoracion", 0),
            raw,
        ),
    )


def upsert_clasificacion(conn: sqlite3.Connection, data: dict,
                          id_cat_comp: str, id_fase: str, id_grupo: str, raw: str):
    conn.execute(
        """INSERT OR REPLACE INTO clasificacion
        (id_equipo, id_categoria_competicion, id_fase, id_grupo, posicion,
         partidos_jugados, partidos_ganados, partidos_perdidos,
         puntos_favor, puntos_contra, diferencia, puntos_clasificacion, raw_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            str(data.get("IdEquipo", data.get("Id", ""))),
            id_cat_comp,
            id_fase,
            id_grupo,
            data.get("Posicion", 0),
            data.get("PartidosJugados", data.get("PJ", 0)),
            data.get("PartidosGanados", data.get("PG", 0)),
            data.get("PartidosPerdidos", data.get("PP", 0)),
            data.get("PuntosFavor", data.get("PF", 0)),
            data.get("PuntosContra", data.get("PC", 0)),
            data.get("Diferencia", data.get("DIF", 0)),
            data.get("Puntos", data.get("PTS", 0)),
            raw,
        ),
    )


def log_sync(conn: sqlite3.Connection, tipo: str, detalle: str, registros: int = 0):
    conn.execute(
        "INSERT INTO sync_log (tipo, detalle, registros) VALUES (?, ?, ?)",
        (tipo, detalle, registros),
    )
