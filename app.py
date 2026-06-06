"""
Cálculos P&C — Plataforma de Cálculos Trabalhistas com IA
Peixoto & Cury Advogados · Controladoria Time B
"""
import datetime
import io
import os
import json

import pandas as pd
import streamlit as st

from modules.extractor  import extrair_texto, contar_paginas
from modules.calculator import calcular_lista, totalizar, formatar_brl
from modules.excel_export import gerar_excel
from modules.pdf_report   import gerar_pdf
from modules.indices      import get_indices
from modules.ai_parser    import extrair_com_ia, resultado_ia_para_verbas, _detectar_tipo

# ---------------------------------------------------------------------------
# Configuração da página
# ---------------------------------------------------------------------------
st.set_page_config(
    page_title="Cálculos P&C",
    page_icon="⚖️",
    layout="wide",
    initial_sidebar_state="expanded",
)

# ---------------------------------------------------------------------------
# CSS — Identidade Peixoto & Cury
# ---------------------------------------------------------------------------
st.markdown("""
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;900&display=swap');

html, body, [class*="css"] { font-family: 'Inter', sans-serif; }

/* Sidebar escura P&C */
section[data-testid="stSidebar"] {
    background: linear-gradient(160deg, #1a0a2e 0%, #2d1550 100%);
}
section[data-testid="stSidebar"] * { color: #fff !important; }
section[data-testid="stSidebar"] input,
section[data-testid="stSidebar"] .stSelectbox div {
    background: rgba(255,255,255,0.08) !important;
    border: 1px solid rgba(180,120,255,0.3) !important;
    color: #fff !important;
}

.sidebar-header {
    text-align: center;
    padding: 20px 0 24px 0;
    border-bottom: 1px solid rgba(180,120,255,0.2);
    margin-bottom: 20px;
}
.sidebar-logo {
    font-size: 28px; font-weight: 900; letter-spacing: -1px;
    color: #fff;
}
.sidebar-logo span { color: #b478ff; }
.sidebar-sub {
    font-size: 9px; color: rgba(255,255,255,0.5) !important;
    letter-spacing: 4px; font-weight: 300; margin-top: 6px;
    text-transform: uppercase;
}

.kpi-card {
    background: linear-gradient(135deg, #1a0a2e, #2d1550);
    border-radius: 10px; padding: 16px; text-align: center;
    border: 1px solid rgba(180,120,255,0.25); margin-bottom: 8px;
}
.kpi-label { font-size: 11px; color: rgba(255,255,255,0.6); letter-spacing: 1px; text-transform: uppercase; }
.kpi-value { font-size: 20px; font-weight: 700; color: #b478ff; margin-top: 4px; }

.badge-ia {
    display: inline-block; background: linear-gradient(90deg, #7c3aed, #b478ff);
    color: white; font-size: 10px; font-weight: 700; padding: 2px 10px;
    border-radius: 20px; letter-spacing: 1px; text-transform: uppercase;
    margin-left: 8px; vertical-align: middle;
}
.badge-ok {
    display: inline-block; background: #1a7a4a;
    color: white; font-size: 10px; font-weight: 700; padding: 2px 10px;
    border-radius: 20px; margin-left: 8px;
}
.badge-warn {
    display: inline-block; background: #b45309;
    color: white; font-size: 10px; font-weight: 700; padding: 2px 10px;
    border-radius: 20px; margin-left: 8px;
}

.stButton > button {
    background: linear-gradient(90deg, #7c3aed, #9d5cf6) !important;
    color: white !important; border: none !important;
    font-weight: 600 !important; border-radius: 8px !important;
    padding: 0.5rem 1.5rem !important;
}
.stButton > button:hover {
    background: linear-gradient(90deg, #6d28d9, #8b5cf6) !important;
    transform: translateY(-1px);
}

.info-box {
    background: #f5f3ff; border-left: 4px solid #7c3aed;
    padding: 12px 16px; border-radius: 0 8px 8px 0;
    font-size: 13px; color: #1a0a2e; margin: 8px 0;
}
.warn-box {
    background: #fff7ed; border-left: 4px solid #f59e0b;
    padding: 12px 16px; border-radius: 0 8px 8px 0;
    font-size: 13px; color: #78350f; margin: 8px 0;
}
</style>
""", unsafe_allow_html=True)

# ---------------------------------------------------------------------------
# Estado da sessão
# ---------------------------------------------------------------------------
def _init_state():
    defaults = {
        "resultado_ia": None,
        "verbas_editadas": [],
        "calculado": False,
        "resultados_calc": [],
        "totais": {},
        "processo": {},
        "texto_peca": "",
    }
    for k, v in defaults.items():
        if k not in st.session_state:
            st.session_state[k] = v

_init_state()

# ---------------------------------------------------------------------------
# Sidebar
# ---------------------------------------------------------------------------
with st.sidebar:
    st.markdown("""
    <div class="sidebar-header">
        <div class="sidebar-logo">P<span>&</span>C</div>
        <div style="font-size:13px;font-weight:600;margin-top:4px;">Cálculos Trabalhistas</div>
        <div class="sidebar-sub">Peixoto &amp; Cury · IA</div>
    </div>
    """, unsafe_allow_html=True)

    st.markdown("### ⚙️ Configurações")

    # API Key — lê do Streamlit Secrets (deploy) ou env local
    _secret_key = ""
    try:
        _secret_key = st.secrets["ANTHROPIC_API_KEY"]
    except Exception:
        _secret_key = os.environ.get("ANTHROPIC_API_KEY", "")

    # Em produção (Streamlit Cloud) esconde o campo — chave já está nos Secrets
    if _secret_key:
        os.environ["ANTHROPIC_API_KEY"] = _secret_key
        api_key = _secret_key
        st.markdown('<div style="font-size:11px;color:rgba(255,255,255,0.5);">✅ Chave configurada via Secrets</div>',
                    unsafe_allow_html=True)
    else:
        api_key = st.text_input(
            "Chave Anthropic (Claude)",
            type="password",
            help="Obtida em console.anthropic.com"
        )
        if api_key:
            os.environ["ANTHROPIC_API_KEY"] = api_key

    st.markdown("---")

    # Configurações de cálculo
    st.markdown("### 📐 Parâmetros de Cálculo")

    metodo = st.selectbox(
        "Índice de atualização",
        ["SELIC_ADC58", "IPCAE_1PCT", "SEM_CORRECAO"],
        format_func=lambda x: {
            "SELIC_ADC58": "IPCA-E + SELIC (pós-ADC 58 ✓)",
            "IPCAE_1PCT":  "IPCA-E + 1% a.m. (pré-ADC 58)",
            "SEM_CORRECAO": "Sem correção (valor histórico)",
        }[x],
    )

    hoje = datetime.date.today()
    data_base_input = st.selectbox(
        "Mês-base do cálculo",
        options=[f"{m:02d}/{y}" for y in range(hoje.year, hoje.year - 2, -1)
                 for m in range(12, 0, -1)][:36],
        index=0,
    )

    st.markdown("---")
    st.markdown("""
    <div style="font-size:10px;color:rgba(255,255,255,0.4);text-align:center;padding-top:8px;">
    v1.0 · Junho/2026<br>
    Motor: SELIC ADC58 / STF<br>
    Tabelas BCB atualizadas
    </div>
    """, unsafe_allow_html=True)

# ---------------------------------------------------------------------------
# Header principal
# ---------------------------------------------------------------------------
col_t1, col_t2 = st.columns([3, 1])
with col_t1:
    st.markdown("""
    <h1 style="margin:0;font-size:28px;font-weight:900;color:#1a0a2e;">
        Cálculos P&C
        <span class="badge-ia">IA</span>
    </h1>
    <p style="margin:4px 0 24px 0;color:#6b7280;font-size:14px;">
        Plataforma de Cálculos Trabalhistas · Peixoto &amp; Cury Advogados
    </p>
    """, unsafe_allow_html=True)

# ---------------------------------------------------------------------------
# Tabs principais
# ---------------------------------------------------------------------------
tab_upload, tab_manual, tab_resultado, tab_ajuda = st.tabs([
    "📄 Upload da Peça", "✏️ Entrada Manual", "📊 Resultado", "❓ Ajuda"
])

# ============================================================
# TAB 1 — UPLOAD DA PEÇA
# ============================================================
with tab_upload:
    st.markdown("### Envie o laudo ou sentença")

    col_up1, col_up2 = st.columns([2, 1])
    with col_up1:
        arquivo = st.file_uploader(
            "Arquivo PDF ou texto",
            type=["pdf", "txt"],
            help="Laudo pericial, sentença ou acórdão em PDF ou TXT"
        )
    with col_up2:
        tipo_forcado = st.selectbox(
            "Tipo de peça",
            ["auto", "laudo", "sentenca", "acordao", "inicial"],
            format_func=lambda x: {
                "auto": "🔍 Detectar automaticamente",
                "laudo": "📋 Laudo Pericial",
                "sentenca": "⚖️ Sentença",
                "acordao": "🏛️ Acórdão",
                "inicial": "📝 Petição Inicial",
            }[x]
        )

    if arquivo:
        with st.spinner("Extraindo texto..."):
            conteudo = arquivo.read()
            if arquivo.type == "application/pdf":
                try:
                    texto = extrair_texto(conteudo)
                    n_pags = contar_paginas(conteudo)
                    st.markdown(f'<div class="info-box">✅ PDF lido — <b>{n_pags} páginas</b>, '
                                f'<b>{len(texto):,} caracteres</b> extraídos.</div>', unsafe_allow_html=True)
                except Exception as e:
                    st.error(f"Erro ao ler PDF: {e}")
                    texto = ""
            else:
                texto = conteudo.decode("utf-8", errors="replace")
                st.markdown(f'<div class="info-box">✅ Texto carregado — <b>{len(texto):,} caracteres</b>.</div>',
                            unsafe_allow_html=True)

        if texto:
            st.session_state["texto_peca"] = texto
            tipo_detectado = _detectar_tipo(texto) if tipo_forcado == "auto" else tipo_forcado

            with st.expander("🔍 Pré-visualização do texto extraído"):
                st.text_area("Texto", texto[:3000] + ("\n\n[...]" if len(texto) > 3000 else ""),
                             height=200, disabled=True)

            st.markdown("---")
            st.markdown("### 🤖 Análise com IA")

            if not api_key:
                st.markdown('<div class="warn-box">⚠️ Configure a <b>Chave Anthropic</b> na barra lateral para usar a análise com IA.</div>',
                            unsafe_allow_html=True)
            else:
                col_b1, col_b2 = st.columns([1, 3])
                with col_b1:
                    analisar = st.button("🤖 Analisar com IA", use_container_width=True)

                if analisar:
                    with st.spinner("O contador sênior está lendo a peça... ⚖️"):
                        try:
                            resultado = extrair_com_ia(texto, tipo_peca=tipo_detectado, api_key=api_key)
                            st.session_state["resultado_ia"] = resultado
                            st.session_state["verbas_editadas"] = resultado_ia_para_verbas(resultado)
                            st.session_state["calculado"] = False

                            # Dados do processo
                            st.session_state["processo"] = {
                                "reclamante": resultado.get("reclamante", ""),
                                "reclamado": resultado.get("reclamado", ""),
                                "numero_processo": resultado.get("numero_processo", ""),
                                "tipo_peca": resultado.get("tipo_peca", tipo_detectado),
                                "periodo_admissao": resultado.get("periodo_contratual", {}).get("admissao", ""),
                                "periodo_demissao": resultado.get("periodo_contratual", {}).get("demissao", ""),
                            }
                        except Exception as e:
                            st.error(f"Erro na análise: {e}")

                if st.session_state["resultado_ia"]:
                    r = st.session_state["resultado_ia"]
                    st.success(f"✅ Extração concluída — **{len(st.session_state['verbas_editadas'])} verbas** identificadas.")

                    # KPIs
                    k1, k2, k3, k4 = st.columns(4)
                    with k1:
                        st.markdown(f'<div class="kpi-card"><div class="kpi-label">Reclamante</div>'
                                    f'<div class="kpi-value" style="font-size:14px;">{r.get("reclamante","—")}</div></div>',
                                    unsafe_allow_html=True)
                    with k2:
                        st.markdown(f'<div class="kpi-card"><div class="kpi-label">Reclamado</div>'
                                    f'<div class="kpi-value" style="font-size:14px;">{r.get("reclamado","—")}</div></div>',
                                    unsafe_allow_html=True)
                    with k3:
                        total_hist = sum(v.get("valor_hist", 0) for v in r.get("verbas", []))
                        st.markdown(f'<div class="kpi-card"><div class="kpi-label">Total Histórico</div>'
                                    f'<div class="kpi-value">{formatar_brl(total_hist)}</div></div>',
                                    unsafe_allow_html=True)
                    with k4:
                        st.markdown(f'<div class="kpi-card"><div class="kpi-label">Tipo</div>'
                                    f'<div class="kpi-value" style="font-size:14px;">{r.get("tipo_peca","—").upper()}</div></div>',
                                    unsafe_allow_html=True)

                    if r.get("observacoes_gerais"):
                        st.markdown(f'<div class="info-box">💡 <b>Contador Sênior:</b> {r["observacoes_gerais"]}</div>',
                                    unsafe_allow_html=True)

                    st.markdown("➡️ **Acesse a aba _Resultado_** para calcular e gerar os documentos.")

# ============================================================
# TAB 2 — ENTRADA MANUAL
# ============================================================
with tab_manual:
    st.markdown("### Edição das Verbas")

    if not st.session_state["verbas_editadas"]:
        st.markdown('<div class="info-box">ℹ️ Faça o upload e análise de uma peça na aba anterior, '
                    'ou adicione verbas manualmente abaixo.</div>', unsafe_allow_html=True)

    # Dados do processo
    with st.expander("📋 Dados do Processo", expanded=True):
        c1, c2, c3 = st.columns(3)
        proc = st.session_state["processo"]
        with c1:
            proc["reclamante"] = st.text_input("Reclamante", value=proc.get("reclamante", ""))
            proc["reclamado"] = st.text_input("Reclamado", value=proc.get("reclamado", ""))
        with c2:
            proc["numero_processo"] = st.text_input("Nº Processo (CNJ)", value=proc.get("numero_processo", ""))
            proc["tipo_peca"] = st.selectbox("Tipo de Peça",
                ["laudo", "sentenca", "acordao", "inicial"],
                index=["laudo", "sentenca", "acordao", "inicial"].index(
                    proc.get("tipo_peca", "laudo")) if proc.get("tipo_peca") in
                    ["laudo", "sentenca", "acordao", "inicial"] else 0
            )
        with c3:
            proc["periodo_admissao"] = st.text_input("Admissão (MM/AAAA)", value=proc.get("periodo_admissao", ""))
            proc["periodo_demissao"] = st.text_input("Demissão (MM/AAAA)", value=proc.get("periodo_demissao", ""))
        st.session_state["processo"] = proc

    # Tabela de verbas editável
    st.markdown("### Verbas a Calcular")

    VERBAS_OPCOES = [
        "Horas Extras", "Adicional Noturno", "FGTS + Multa 40%", "Férias + 1/3",
        "13º Salário", "Aviso Prévio", "Intervalo Intrajornada", "Danos Morais",
        "Danos Materiais", "Adicional de Insalubridade", "Adicional de Periculosidade",
        "Diferenças Salariais", "Multa Art. 477", "Multa Art. 467", "Vale Transporte",
        "Vale Alimentação", "Reflexos em DSR", "Horas In Itinere", "Comissões",
        "PLR / Participação nos Lucros", "Salários Atrasados", "Rescisão Indireta",
        "Acúmulo de Função", "Indenização por Dispensa", "Honorários Periciais",
        "TR (Taxa Referencial)", "Auxílio Home Office",
        "Adicional de Sobreaviso", "Equiparação Salarial",
        "Outra Verba",
    ]

    verbas = st.session_state["verbas_editadas"]

    # Botão para adicionar nova verba
    if st.button("➕ Adicionar verba"):
        verbas.append({
            "verba": "Nova Verba",
            "valor_hist": 0.0,
            "competencia": "01/2020",
            "deferido": "-",
            "obs": "",
        })
        st.session_state["verbas_editadas"] = verbas
        st.rerun()

    if verbas:
        df_edit = pd.DataFrame(verbas)
        df_resultado = st.data_editor(
            df_edit,
            use_container_width=True,
            num_rows="dynamic",
            column_config={
                "verba": st.column_config.SelectboxColumn(
                    "Verba", options=VERBAS_OPCOES, width="medium"
                ),
                "valor_hist": st.column_config.NumberColumn(
                    "Valor Histórico (R$)", min_value=0.0, format="R$ %.2f", width="medium"
                ),
                "competencia": st.column_config.TextColumn(
                    "Competência (MM/AAAA)", width="small"
                ),
                "deferido": st.column_config.SelectboxColumn(
                    "Deferido?", options=["Sim", "Não", "-"], width="small"
                ),
                "obs": st.column_config.TextColumn("Observação", width="large"),
            },
            hide_index=True,
            key="editor_verbas"
        )
        st.session_state["verbas_editadas"] = df_resultado.to_dict("records")

    col_calc1, col_calc2 = st.columns([1, 4])
    with col_calc1:
        if st.button("⚡ Calcular", use_container_width=True):
            if not st.session_state["verbas_editadas"]:
                st.warning("Adicione verbas antes de calcular.")
            else:
                with st.spinner("Calculando..."):
                    resultados = calcular_lista(
                        st.session_state["verbas_editadas"],
                        data_base=data_base_input,
                        metodo=metodo,
                    )
                    st.session_state["resultados_calc"] = resultados
                    st.session_state["totais"] = totalizar(resultados)
                    st.session_state["calculado"] = True
                st.success("✅ Cálculo concluído! Acesse a aba **Resultado**.")

# ============================================================
# TAB 3 — RESULTADO
# ============================================================
with tab_resultado:
    if not st.session_state["calculado"]:
        st.markdown('<div class="info-box">ℹ️ Execute o cálculo na aba <b>Entrada Manual</b> '
                    '(ou faça o upload + análise na aba <b>Upload da Peça</b>).</div>',
                    unsafe_allow_html=True)
    else:
        resultados = st.session_state["resultados_calc"]
        totais = st.session_state["totais"]
        proc = st.session_state["processo"]

        # KPIs de resultado
        st.markdown("### 📊 Resumo do Cálculo")
        k1, k2, k3, k4, k5 = st.columns(5)
        with k1:
            st.markdown(f'<div class="kpi-card"><div class="kpi-label">Valor Histórico</div>'
                        f'<div class="kpi-value">{formatar_brl(totais.get("valor_hist",0))}</div></div>',
                        unsafe_allow_html=True)
        with k2:
            st.markdown(f'<div class="kpi-card"><div class="kpi-label">Correção Monetária</div>'
                        f'<div class="kpi-value">{formatar_brl(totais.get("cm",0))}</div></div>',
                        unsafe_allow_html=True)
        with k3:
            st.markdown(f'<div class="kpi-card"><div class="kpi-label">Juros (Fase 1)</div>'
                        f'<div class="kpi-value">{formatar_brl(totais.get("juros",0))}</div></div>',
                        unsafe_allow_html=True)
        with k4:
            st.markdown(f'<div class="kpi-card"><div class="kpi-label">SELIC (Fase 2)</div>'
                        f'<div class="kpi-value">{formatar_brl(totais.get("selic_pos",0))}</div></div>',
                        unsafe_allow_html=True)
        with k5:
            st.markdown(f'<div class="kpi-card"><div class="kpi-label" style="color:#b478ff;">TOTAL ATUALIZADO</div>'
                        f'<div class="kpi-value" style="font-size:18px;">{formatar_brl(totais.get("total",0))}</div></div>',
                        unsafe_allow_html=True)

        # Tabela detalhada
        st.markdown("### 📋 Memória de Cálculo")
        df = pd.DataFrame(resultados)
        colunas_exibir = ["seq", "verba", "competencia", "deferido",
                          "valor_hist", "cm", "juros", "selic_pos", "total"]
        colunas_presentes = [c for c in colunas_exibir if c in df.columns]
        df_exib = df[colunas_presentes].copy()

        for col in ["valor_hist", "cm", "juros", "selic_pos", "total"]:
            if col in df_exib.columns:
                df_exib[col] = df_exib[col].apply(lambda x: formatar_brl(float(x or 0)))

        st.dataframe(
            df_exib,
            use_container_width=True,
            hide_index=True,
            column_config={
                "seq": st.column_config.NumberColumn("#", width="small"),
                "verba": st.column_config.TextColumn("Verba", width="medium"),
                "competencia": st.column_config.TextColumn("Competência", width="small"),
                "deferido": st.column_config.TextColumn("Status", width="small"),
                "valor_hist": st.column_config.TextColumn("Valor Histórico", width="medium"),
                "cm": st.column_config.TextColumn("Correção Mont.", width="medium"),
                "juros": st.column_config.TextColumn("Juros 1% a.m.", width="medium"),
                "selic_pos": st.column_config.TextColumn("SELIC Pós-ADC58", width="medium"),
                "total": st.column_config.TextColumn("Total Atualizado", width="medium"),
            }
        )

        st.markdown(f"""
        <div class="info-box">
        📐 <b>Método:</b> {metodo} &nbsp;|&nbsp;
        📅 <b>Data-base:</b> {data_base_input} &nbsp;|&nbsp;
        ⚖️ <b>Fundamento:</b> ADC 58 STF (18/11/2021) — IPCA-E + 1% a.m. (pré-nov/2021) | SELIC acumulada (pós-nov/2021)
        </div>
        """, unsafe_allow_html=True)

        # Downloads
        st.markdown("### 📥 Exportar")
        col_dl1, col_dl2 = st.columns(2)

        processo_info = {
            "reclamante": proc.get("reclamante", ""),
            "reclamado": proc.get("reclamado", ""),
            "numero_processo": proc.get("numero_processo", ""),
            "tipo_peca": proc.get("tipo_peca", ""),
            "data_base": data_base_input,
            "metodo": metodo,
            "periodo_admissao": proc.get("periodo_admissao", ""),
            "periodo_demissao": proc.get("periodo_demissao", ""),
        }

        with col_dl1:
            try:
                excel_bytes = gerar_excel(resultados, totais, processo_info)
                nome_excel = f"Calculo_PC_{proc.get('reclamante','processo').replace(' ','_')}_{data_base_input.replace('/','-')}.xlsx"
                st.download_button(
                    "📊 Baixar Excel (.xlsx)",
                    data=excel_bytes,
                    file_name=nome_excel,
                    mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    use_container_width=True,
                )
            except Exception as e:
                st.error(f"Erro ao gerar Excel: {e}")

        with col_dl2:
            try:
                pdf_bytes = gerar_pdf(resultados, totais, processo_info)
                nome_pdf = f"Calculo_PC_{proc.get('reclamante','processo').replace(' ','_')}_{data_base_input.replace('/','-')}.pdf"
                st.download_button(
                    "📄 Baixar PDF",
                    data=pdf_bytes,
                    file_name=nome_pdf,
                    mime="application/pdf",
                    use_container_width=True,
                )
            except Exception as e:
                st.error(f"Erro ao gerar PDF: {e}")

# ============================================================
# TAB 4 — AJUDA
# ============================================================
with tab_ajuda:
    st.markdown("""
    ## Cálculos P&C — Guia de Uso

    ### Fluxo principal
    1. **Upload da Peça** → envie o PDF do laudo ou sentença
    2. Clique em **Analisar com IA** — o modelo extrai as verbas automaticamente
    3. **Entrada Manual** → revise e ajuste os valores se necessário
    4. Clique em **Calcular** → a plataforma aplica a correção monetária
    5. **Resultado** → visualize e baixe o Excel e o PDF

    ### Índices de correção (pós-ADC 58 / STF)
    | Fase | Período | Correção | Juros |
    |------|---------|----------|-------|
    | 1 | Competência → out/2021 | IPCA-E acumulado | 1% a.m. simples sobre valor histórico |
    | 2 | nov/2021 → data-base | SELIC acumulada | (embutida na SELIC) |

    > **Fundamento:** ADC 58 (STF, 18/11/2021) + Tema 1.191 (TST)

    ### Configurar a chave de IA
    1. Acesse [console.anthropic.com](https://console.anthropic.com)
    2. Crie uma API Key
    3. Cole na barra lateral em **Chave Anthropic (Claude)**

    ### Tipos de peça suportados
    - **Laudo Pericial** — extrai verbas do quadro-resumo e cálculos do perito
    - **Sentença** — extrai verbas deferidas/indeferidas do dispositivo
    - **Acórdão** — mesmo fluxo da sentença
    - **Petição Inicial** — extrai pedidos com valores

    ### Dúvidas
    Controladoria Time B · Peixoto & Cury Advogados
    """)
