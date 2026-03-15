"""
Dashboard de estadísticas de básquet FEBAMBA.
Streamlit + Plotly + SQLite.

Uso: streamlit run dashboard/app.py
"""

import sqlite3
from pathlib import Path

import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
import streamlit as st

DB_PATH = Path("estadisticas_febamba.db")

st.set_page_config(
    page_title="Estadísticas FEBAMBA",
    page_icon="🏀",
    layout="wide",
)


# ------------------------------------------------------------------
# Conexión DB
# ------------------------------------------------------------------

@st.cache_resource
def get_connection():
    if not DB_PATH.exists():
        st.error(f"Base de datos no encontrada: {DB_PATH}")
        st.info("Ejecutá primero: python scraper/sync.py")
        st.stop()
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def query_df(sql: str, params: tuple = ()) -> pd.DataFrame:
    conn = get_connection()
    return pd.read_sql_query(sql, conn, params=params)


# ------------------------------------------------------------------
# Sidebar: filtros
# ------------------------------------------------------------------

st.sidebar.title("FEBAMBA Stats")
st.sidebar.markdown("---")

# Competiciones disponibles
comps_df = query_df("SELECT id_categoria_competicion, nombre, temporada FROM competiciones ORDER BY nombre")

if comps_df.empty:
    st.warning("No hay competiciones en la base de datos. Ejecutá sync.py primero.")
    st.stop()

comp_opciones = {row["nombre"]: row["id_categoria_competicion"] for _, row in comps_df.iterrows()}
comp_sel = st.sidebar.selectbox("Competición", list(comp_opciones.keys()))
comp_id = comp_opciones[comp_sel]

# Grupos
grupos_df = query_df(
    """SELECT DISTINCT g.id_grupo, g.nombre
       FROM grupos g
       JOIN fases f ON g.id_fase = f.id_fase
       WHERE f.id_categoria_competicion = ?
       ORDER BY g.nombre""",
    (comp_id,),
)

grupo_id = None
if not grupos_df.empty:
    grupo_opciones = {"Todos": None}
    grupo_opciones.update({row["nombre"]: row["id_grupo"] for _, row in grupos_df.iterrows()})
    grupo_sel = st.sidebar.selectbox("Zona/Grupo", list(grupo_opciones.keys()))
    grupo_id = grupo_opciones[grupo_sel]

vista = st.sidebar.radio("Vista", ["Posiciones", "Partidos", "Jugadores", "Líderes", "Comparar"])

st.sidebar.markdown("---")
st.sidebar.caption("Datos: API CABB/Indalweb")

# ------------------------------------------------------------------
# Vista: Posiciones
# ------------------------------------------------------------------

if vista == "Posiciones":
    st.header(f"Tabla de Posiciones - {comp_sel}")

    where = "WHERE c.id_categoria_competicion = ?"
    params = [comp_id]
    if grupo_id:
        where += " AND c.id_grupo = ?"
        params.append(grupo_id)

    df = query_df(
        f"""SELECT c.posicion AS Pos, e.nombre AS Equipo,
                   c.partidos_jugados AS PJ, c.partidos_ganados AS PG,
                   c.partidos_perdidos AS PP, c.puntos_favor AS PF,
                   c.puntos_contra AS PC, c.diferencia AS DIF,
                   c.puntos_clasificacion AS PTS
            FROM clasificacion c
            JOIN equipos e ON c.id_equipo = e.id_equipo
            {where}
            ORDER BY c.posicion ASC""",
        tuple(params),
    )

    if df.empty:
        st.info("No hay datos de clasificación.")
    else:
        st.dataframe(df, use_container_width=True, hide_index=True)

        # Gráfico PF vs PC
        if len(df) > 1:
            fig = px.bar(
                df, x="Equipo", y=["PF", "PC"],
                barmode="group",
                title="Puntos a Favor vs En Contra",
                color_discrete_map={"PF": "#2ecc71", "PC": "#e74c3c"},
            )
            fig.update_layout(yaxis_title="Puntos", xaxis_title="")
            st.plotly_chart(fig, use_container_width=True)

# ------------------------------------------------------------------
# Vista: Partidos
# ------------------------------------------------------------------

elif vista == "Partidos":
    st.header(f"Partidos - {comp_sel}")

    where = "WHERE p.id_categoria_competicion = ?"
    params = [comp_id]
    if grupo_id:
        where += " AND p.id_grupo = ?"
        params.append(grupo_id)

    df = query_df(
        f"""SELECT p.jornada AS Fecha, p.nombre_local AS Local,
                   p.puntos_local AS PL, p.puntos_visitante AS PV,
                   p.nombre_visitante AS Visitante, p.estado AS Estado
            FROM partidos p
            {where}
            ORDER BY p.fecha DESC, p.jornada DESC""",
        tuple(params),
    )

    if df.empty:
        st.info("No hay partidos cargados.")
    else:
        # Filtrar por estado
        estados = ["Todos"] + sorted(df["Estado"].dropna().unique().tolist())
        estado_sel = st.selectbox("Estado", estados)
        if estado_sel != "Todos":
            df = df[df["Estado"] == estado_sel]

        st.dataframe(df, use_container_width=True, hide_index=True)

# ------------------------------------------------------------------
# Vista: Jugadores
# ------------------------------------------------------------------

elif vista == "Jugadores":
    st.header(f"Estadísticas de Jugadores - {comp_sel}")

    # Equipos de esta competición
    equipos_df = query_df(
        "SELECT id_equipo, nombre FROM equipos WHERE id_categoria_competicion = ? ORDER BY nombre",
        (comp_id,),
    )

    equipo_id = None
    if not equipos_df.empty:
        eq_opciones = {"Todos": None}
        eq_opciones.update({row["nombre"]: row["id_equipo"] for _, row in equipos_df.iterrows()})
        eq_sel = st.selectbox("Equipo", list(eq_opciones.keys()))
        equipo_id = eq_opciones[eq_sel]

    where = """WHERE p.id_categoria_competicion = ?"""
    params = [comp_id]
    if equipo_id:
        where += " AND s.id_equipo = ?"
        params.append(equipo_id)

    df = query_df(
        f"""SELECT j.nombre AS Jugador, e.nombre AS Equipo,
                   COUNT(s.id_partido) AS PJ,
                   ROUND(AVG(s.puntos), 1) AS PPG,
                   ROUND(AVG(s.rebotes), 1) AS RPG,
                   ROUND(AVG(s.asistencias), 1) AS APG,
                   ROUND(AVG(s.robos), 1) AS SPG,
                   ROUND(AVG(s.tapones), 1) AS BPG,
                   SUM(s.puntos) AS PTS_TOT,
                   SUM(s.rebotes) AS REB_TOT,
                   SUM(s.asistencias) AS AST_TOT,
                   CASE WHEN SUM(s.tl_intentados) > 0
                        THEN ROUND(100.0 * SUM(s.tl_convertidos) / SUM(s.tl_intentados), 1)
                        ELSE 0 END AS "TL%",
                   CASE WHEN SUM(s.t2_intentados) > 0
                        THEN ROUND(100.0 * SUM(s.t2_convertidos) / SUM(s.t2_intentados), 1)
                        ELSE 0 END AS "T2%",
                   CASE WHEN SUM(s.t3_intentados) > 0
                        THEN ROUND(100.0 * SUM(s.t3_convertidos) / SUM(s.t3_intentados), 1)
                        ELSE 0 END AS "T3%"
            FROM stats_jugador_partido s
            JOIN jugadores j ON s.id_jugador = j.id_jugador
            JOIN partidos p ON s.id_partido = p.id_partido
            LEFT JOIN equipos e ON s.id_equipo = e.id_equipo
            {where}
            GROUP BY s.id_jugador
            HAVING PJ >= 1
            ORDER BY PPG DESC""",
        tuple(params),
    )

    if df.empty:
        st.info("No hay estadísticas de jugadores.")
    else:
        st.dataframe(df, use_container_width=True, hide_index=True)

# ------------------------------------------------------------------
# Vista: Líderes estadísticos
# ------------------------------------------------------------------

elif vista == "Líderes":
    st.header(f"Líderes Estadísticos - {comp_sel}")

    categorias = {
        "Puntos por partido": ("AVG(s.puntos)", "PPG"),
        "Rebotes por partido": ("AVG(s.rebotes)", "RPG"),
        "Asistencias por partido": ("AVG(s.asistencias)", "APG"),
        "Robos por partido": ("AVG(s.robos)", "SPG"),
        "Tapones por partido": ("AVG(s.tapones)", "BPG"),
    }

    cols = st.columns(2)
    for idx, (cat_name, (agg, alias)) in enumerate(categorias.items()):
        with cols[idx % 2]:
            st.subheader(cat_name)

            df = query_df(
                f"""SELECT j.nombre AS Jugador, e.nombre AS Equipo,
                           COUNT(s.id_partido) AS PJ,
                           ROUND({agg}, 1) AS {alias}
                    FROM stats_jugador_partido s
                    JOIN jugadores j ON s.id_jugador = j.id_jugador
                    JOIN partidos p ON s.id_partido = p.id_partido
                    LEFT JOIN equipos e ON s.id_equipo = e.id_equipo
                    WHERE p.id_categoria_competicion = ?
                    GROUP BY s.id_jugador
                    HAVING PJ >= 2
                    ORDER BY {alias} DESC
                    LIMIT 10""",
                (comp_id,),
            )

            if not df.empty:
                fig = px.bar(
                    df, x=alias, y="Jugador", orientation="h",
                    color=alias, color_continuous_scale="Viridis",
                    text=alias,
                )
                fig.update_layout(
                    height=350, showlegend=False,
                    yaxis={"autorange": "reversed"},
                    coloraxis_showscale=False,
                )
                st.plotly_chart(fig, use_container_width=True)
            else:
                st.caption("Sin datos suficientes")

# ------------------------------------------------------------------
# Vista: Comparar jugadores
# ------------------------------------------------------------------

elif vista == "Comparar":
    st.header(f"Comparar Jugadores - {comp_sel}")

    jugadores_df = query_df(
        """SELECT DISTINCT j.id_jugador, j.nombre, e.nombre AS equipo
           FROM jugadores j
           JOIN stats_jugador_partido s ON j.id_jugador = s.id_jugador
           JOIN partidos p ON s.id_partido = p.id_partido
           LEFT JOIN equipos e ON j.id_equipo = e.id_equipo
           WHERE p.id_categoria_competicion = ?
           ORDER BY j.nombre""",
        (comp_id,),
    )

    if jugadores_df.empty:
        st.info("No hay jugadores con estadísticas.")
    else:
        opciones = {f"{row['nombre']} ({row['equipo']})": row["id_jugador"]
                    for _, row in jugadores_df.iterrows()}
        sel = st.multiselect("Seleccionar jugadores (2-4)", list(opciones.keys()), max_selections=4)

        if len(sel) >= 2:
            ids = [opciones[s] for s in sel]
            placeholders = ",".join(["?"] * len(ids))

            df = query_df(
                f"""SELECT j.nombre AS Jugador,
                           ROUND(AVG(s.puntos), 1) AS Puntos,
                           ROUND(AVG(s.rebotes), 1) AS Rebotes,
                           ROUND(AVG(s.asistencias), 1) AS Asistencias,
                           ROUND(AVG(s.robos), 1) AS Robos,
                           ROUND(AVG(s.tapones), 1) AS Tapones
                    FROM stats_jugador_partido s
                    JOIN jugadores j ON s.id_jugador = j.id_jugador
                    JOIN partidos p ON s.id_partido = p.id_partido
                    WHERE p.id_categoria_competicion = ?
                      AND s.id_jugador IN ({placeholders})
                    GROUP BY s.id_jugador""",
                (comp_id, *ids),
            )

            if not df.empty:
                # Radar chart
                categories = ["Puntos", "Rebotes", "Asistencias", "Robos", "Tapones"]
                fig = go.Figure()

                for _, row in df.iterrows():
                    values = [row[c] for c in categories]
                    values.append(values[0])  # cerrar el polígono
                    fig.add_trace(go.Scatterpolar(
                        r=values,
                        theta=categories + [categories[0]],
                        fill="toself",
                        name=row["Jugador"],
                    ))

                fig.update_layout(
                    polar={"radialaxis": {"visible": True}},
                    showlegend=True,
                    height=500,
                )
                st.plotly_chart(fig, use_container_width=True)

                # Tabla comparativa
                st.dataframe(df, use_container_width=True, hide_index=True)
        else:
            st.caption("Seleccioná al menos 2 jugadores para comparar.")
