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

from modules.extractor   import extrair_texto, contar_paginas
from modules.calculator  import calcular_lista, totalizar, formatar_brl
from modules.excel_export import gerar_excel
from modules.pdf_report  import gerar_pdf
from modules.indices     import get_indices
from modules.ai_parser   import extrair_com_ia, resultado_para_verbas

# ---------------------------------------------------------------------------
# Página
# ---------------------------------------------------------------------------
st.set_page_config(page_title="Cálculos P&C", page_icon="⚖️", layout="wide")

# ---------------------------------------------------------------------------
# CSS
# ---------------------------------------------------------------------------
st.markdown("""
<style>
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@300;400;500;600;700&display=swap');
html,body,[class*="css"]{font-family:'IBM Plex Sans',sans-serif;}

section[data-testid="stSidebar"]{background:linear-gradient(160deg,#001e36 0%,#003B5C 100%);}
section[data-testid="stSidebar"] *{color:#fff!important;}
section[data-testid="stSidebar"] input,
section[data-testid="stSidebar"] .stSelectbox div{
  background:rgba(255,255,255,0.08)!important;
  border:1px solid rgba(0,169,224,0.3)!important;color:#fff!important;}

.header-pc{background:#fff;border-bottom:1px solid rgba(0,59,92,.14);
  box-shadow:0 2px 10px rgba(0,59,92,.08);padding:10px 20px;
  display:flex;align-items:center;gap:14px;margin-bottom:20px;border-radius:10px;}
.header-pc img{height:44px;background:#003B5C;border-radius:8px;padding:6px;}
.header-title{font-size:16px;font-weight:700;color:#003B5C;}
.header-sub{font-size:11px;color:#6B7F93;}

.tbl-wrap{overflow-x:auto;border-radius:10px;border:1px solid rgba(0,59,92,.12);}
.pc-table{width:100%;border-collapse:collapse;font-size:12px;min-width:900px;}
.pc-table thead tr{background:linear-gradient(135deg,#001e36,#003B5C);color:#fff;}
.pc-table thead th{padding:10px 12px;text-align:left;font-size:10px;
  text-transform:uppercase;letter-spacing:.5px;white-space:nowrap;}
.pc-table thead th.num{text-align:right;}
.pc-table tbody td{padding:9px 12px;border-bottom:1px solid rgba(0,59,92,.07);
  color:#17324D;vertical-align:middle;}
.pc-table tbody tr:hover td{background:rgba(0,169,224,.05);}
.pc-table tbody td.num{text-align:right;font-variant-numeric:tabular-nums;font-weight:600;}
.pc-table tr.total-row td{background:linear-gradient(135deg,#001e36,#003B5C)!important;
  color:#fff;font-weight:700;padding:11px 12px;}
.pc-table tr.total-row td.num{color:#00A9E0;font-size:14px;}
.pc-table tr.deduct td{background:#fff9f0!important;color:#92400e;}
.pc-table td.verba-col{font-weight:600;max-width:200px;}
.pc-table td.mem-col{font-size:10px;color:#94a3b8;max-width:180px;line-height:1.4;}

.prob-possivel{display:inline-block;background:#fef3c7;color:#92400e;
  font-size:10px;font-weight:700;padding:2px 8px;border-radius:20px;}
.prob-provavel{display:inline-block;background:#d1fae5;color:#065f46;
  font-size:10px;font-weight:700;padding:2px 8px;border-radius:20px;}
.prob-remoto{display:inline-block;background:#fee2e2;color:#991b1b;
  font-size:10px;font-weight:700;padding:2px 8px;border-radius:20px;}

.kpi-card{background:#fff;border-radius:10px;padding:14px;
  border-left:4px solid #00A9E0;box-shadow:0 1px 4px rgba(0,0,0,.06);}
.kpi-label{font-size:10px;font-weight:700;color:#6B7F93;text-transform:uppercase;letter-spacing:.6px;}
.kpi-value{font-size:20px;font-weight:800;color:#003B5C;margin-top:4px;}
.kpi-value.destaque{color:#00A9E0;}

.info-box{background:#f0f9ff;border-left:4px solid #00A9E0;
  padding:10px 14px;border-radius:0 8px 8px 0;font-size:12px;color:#0c4a6e;margin:8px 0;}
.warn-box{background:#fff7ed;border-left:4px solid #f59e0b;
  padding:10px 14px;border-radius:0 8px 8px 0;font-size:12px;color:#78350f;margin:8px 0;}
.obs-box{background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;
  padding:12px;margin-top:12px;}
.obs-title{font-size:11px;font-weight:700;color:#0369a1;text-transform:uppercase;
  letter-spacing:.4px;margin-bottom:4px;}

.stButton>button{background:#003B5C!important;color:#fff!important;
  border:none!important;font-weight:600!important;border-radius:8px!important;}
.stButton>button:hover{background:#00A9E0!important;}

.upload-tipo{display:flex;gap:10px;margin-bottom:16px;}
.tipo-btn{padding:8px 18px;border-radius:20px;border:2px solid #cbd5e1;
  background:#fff;color:#475569;font-size:12px;font-weight:600;cursor:pointer;transition:all .2s;}
.tipo-btn.ativo{border-color:#003B5C;background:#003B5C;color:#fff;}
</style>
""", unsafe_allow_html=True)

# ---------------------------------------------------------------------------
# Estado
# ---------------------------------------------------------------------------
def _init():
    defs = {
        "tipo_peca": "inicial",
        "texto_principal": "",
        "texto_inicial": "",
        "resultado_ia": None,
        "verbas_calc": [],
        "calculado": False,
        "resultados": [],
        "totais": {},
        "processo": {},
    }
    for k, v in defs.items():
        if k not in st.session_state:
            st.session_state[k] = v
_init()

# ---------------------------------------------------------------------------
# API Key
# ---------------------------------------------------------------------------
_key = ""
try:
    _key = st.secrets["ANTHROPIC_API_KEY"]
except Exception:
    _key = os.environ.get("ANTHROPIC_API_KEY", "")
if _key:
    os.environ["ANTHROPIC_API_KEY"] = _key

# ---------------------------------------------------------------------------
# Sidebar
# ---------------------------------------------------------------------------
with st.sidebar:
    st.markdown("""
    <div style="text-align:center;padding:16px 0 20px 0;border-bottom:1px solid rgba(0,169,224,.2);margin-bottom:16px;">
      <div style="font-size:26px;font-weight:900;letter-spacing:-1px;">P&C</div>
      <div style="font-size:12px;font-weight:600;margin-top:2px;">Cálculos Trabalhistas</div>
      <div style="font-size:9px;color:rgba(255,255,255,.5);letter-spacing:3px;margin-top:4px;">PEIXOTO & CURY · IA</div>
    </div>
    """, unsafe_allow_html=True)

    if _key:
        st.markdown('<div style="font-size:11px;color:rgba(255,255,255,.6);">✅ IA configurada</div>',
                    unsafe_allow_html=True)
    else:
        api_key_manual = st.text_input("Chave Anthropic", type="password")
        if api_key_manual:
            os.environ["ANTHROPIC_API_KEY"] = api_key_manual
            _key = api_key_manual

    st.markdown("---")
    st.markdown("### ⚙️ Parâmetros")

    metodo = st.selectbox("Índice de correção",
        ["SELIC_ADC58", "IPCAE_1PCT", "SEM_CORRECAO"],
        format_func=lambda x: {
            "SELIC_ADC58": "IPCA-E + SELIC (ADC 58 ✓)",
            "IPCAE_1PCT":  "IPCA-E + 1% a.m.",
            "SEM_CORRECAO": "Sem correção",
        }[x])

    hoje = datetime.date.today()
    meses = [f"{m:02d}/{y}" for y in range(hoje.year, hoje.year-2, -1)
             for m in range(12, 0, -1)][:36]
    data_base = st.selectbox("Mês-base", meses, index=0)
    data_ajuizamento = st.text_input("Ajuizamento (MM/AAAA)", placeholder="ex: 03/2023")

    st.markdown("---")
    st.markdown('<div style="font-size:10px;color:rgba(255,255,255,.4);text-align:center;">v2.0 · Jun/2026<br>Motor ADC 58 / STF</div>',
                unsafe_allow_html=True)

# ---------------------------------------------------------------------------
# Header
# ---------------------------------------------------------------------------
st.markdown("""
<div class="header-pc">
  <img src="https://www.peixotoecury.com.br/assets/images/ui/logo-light.png" alt="P&C"/>
  <div>
    <div class="header-title">Cálculos P&amp;C <span style="background:#003B5C;color:#00A9E0;font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px;margin-left:6px;">IA</span></div>
    <div class="header-sub">Plataforma de Cálculos Trabalhistas · Peixoto &amp; Cury Advogados</div>
  </div>
</div>
""", unsafe_allow_html=True)

# ---------------------------------------------------------------------------
# Tabs
# ---------------------------------------------------------------------------
tab_upload, tab_resultado, tab_ajuda = st.tabs(["📄 Documento & Análise", "📊 Resultado", "❓ Ajuda"])

# ============================================================
# TAB 1 — UPLOAD & ANÁLISE
# ============================================================
with tab_upload:

    # Seletor de tipo de peça
    col_t1, col_t2, col_t3, col_t4 = st.columns(4)
    tipo_atual = st.session_state["tipo_peca"]

    def set_tipo(t):
        st.session_state["tipo_peca"] = t

    with col_t1:
        if st.button("📝 Petição Inicial", use_container_width=True,
                     type="primary" if tipo_atual=="inicial" else "secondary"):
            set_tipo("inicial"); st.rerun()
    with col_t2:
        if st.button("⚖️ Sentença", use_container_width=True,
                     type="primary" if tipo_atual=="sentenca" else "secondary"):
            set_tipo("sentenca"); st.rerun()
    with col_t3:
        if st.button("📋 Laudo Pericial", use_container_width=True,
                     type="primary" if tipo_atual=="laudo" else "secondary"):
            set_tipo("laudo"); st.rerun()

    tipo = st.session_state["tipo_peca"]
    st.markdown("---")

    # Upload da peça principal
    label_principal = {
        "inicial": "📝 Petição Inicial (PDF ou TXT)",
        "sentenca": "⚖️ Sentença (PDF ou TXT)",
        "laudo": "📋 Laudo Pericial (PDF ou TXT)",
    }[tipo]

    col_up1, col_up2 = st.columns([2, 1])
    with col_up1:
        arquivo_principal = st.file_uploader(label_principal, type=["pdf","txt"], key="up_principal")
    with col_up2:
        texto_colado = st.text_area("Ou cole o texto aqui", height=120, key="txt_colado",
                                    placeholder="Cole o texto da peça...")

    # Upload da inicial (obrigatório para sentença e laudo)
    arquivo_inicial = None
    texto_inicial_colado = ""
    if tipo in ("sentenca", "laudo"):
        st.markdown("---")
        st.markdown("**📎 Petição Inicial** (necessária para análise completa)")
        col_ini1, col_ini2 = st.columns([2, 1])
        with col_ini1:
            arquivo_inicial = st.file_uploader("Inicial (PDF ou TXT)", type=["pdf","txt"], key="up_inicial")
        with col_ini2:
            texto_inicial_colado = st.text_area("Ou cole o texto da inicial", height=100,
                                                key="txt_inicial", placeholder="Texto da inicial...")

    st.markdown("---")

    col_btn, col_info = st.columns([1, 3])
    with col_btn:
        analisar = st.button("🤖 Analisar com IA", use_container_width=True,
                             disabled=not _key)
    with col_info:
        if not _key:
            st.markdown('<div class="warn-box">⚠️ Configure a chave Anthropic na barra lateral.</div>',
                        unsafe_allow_html=True)

    if analisar:
        # Extrai texto
        def ler_arquivo(arq):
            if arq is None:
                return ""
            b = arq.read()
            if arq.name.lower().endswith(".pdf"):
                return extrair_texto(b)
            return b.decode("utf-8", errors="replace")

        with st.spinner("Lendo o documento..."):
            texto_principal = ler_arquivo(arquivo_principal) or texto_colado
            texto_inicial = ler_arquivo(arquivo_inicial) or texto_inicial_colado

        if not texto_principal.strip():
            st.error("Nenhum texto encontrado. Faça upload ou cole o texto.")
            st.stop()

        with st.spinner(f"O contador sênior está analisando a {tipo}... ⚖️"):
            try:
                resultado = extrair_com_ia(
                    texto_principal=texto_principal,
                    tipo_peca=tipo,
                    data_base=data_base,
                    data_ajuizamento=data_ajuizamento,
                    texto_inicial=texto_inicial,
                    api_key=_key,
                )
                verbas = resultado_para_verbas(resultado, data_base)

                st.session_state["resultado_ia"] = resultado
                st.session_state["verbas_calc"] = verbas
                st.session_state["calculado"] = False
                st.session_state["processo"] = {
                    "reclamante": resultado.get("reclamante", ""),
                    "reclamado":  resultado.get("reclamado", ""),
                    "numero_processo": resultado.get("numero_processo", ""),
                    "tipo_peca": tipo,
                    "admissao": resultado.get("admissao", ""),
                    "demissao": resultado.get("demissao", ""),
                    "salario_base": resultado.get("salario_base", ""),
                    "data_base": data_base,
                    "metodo": metodo,
                }

                st.success(f"✅ {len(verbas)} verbas identificadas. Acesse a aba **Resultado**.")

                if resultado.get("observacoes_gerais"):
                    st.markdown(f'<div class="obs-box"><div class="obs-title">Contador Sênior</div>'
                                f'{resultado["observacoes_gerais"]}</div>', unsafe_allow_html=True)

                # Calcula automaticamente
                resultados = calcular_lista(verbas, data_base=data_base, metodo=metodo)
                # Preserva prob e memoria
                for i, r in enumerate(resultados):
                    r["prob"] = verbas[i].get("prob", "Possível")
                    r["memoria"] = verbas[i].get("memoria", "")
                st.session_state["resultados"] = resultados
                st.session_state["totais"] = totalizar(resultados)
                st.session_state["calculado"] = True

            except Exception as e:
                st.error(f"Erro na análise: {e}")

# ============================================================
# TAB 2 — RESULTADO
# ============================================================
with tab_resultado:
    if not st.session_state["calculado"]:
        st.markdown('<div class="info-box">ℹ️ Faça o upload e análise na aba <b>Documento & Análise</b>.</div>',
                    unsafe_allow_html=True)
    else:
        resultados = st.session_state["resultados"]
        totais     = st.session_state["totais"]
        proc       = st.session_state["processo"]

        # KPIs do processo
        st.markdown("### Dados do Processo")
        kc = st.columns(5)
        kpis = [
            ("Reclamante", proc.get("reclamante","—")),
            ("Reclamado",  proc.get("reclamado","—")),
            ("Processo",   proc.get("numero_processo","—")),
            ("Admissão",   proc.get("admissao","—")),
            ("Demissão",   proc.get("demissao","—")),
        ]
        for i, (lbl, val) in enumerate(kpis):
            kc[i].markdown(f'<div class="kpi-card"><div class="kpi-label">{lbl}</div>'
                           f'<div class="kpi-value" style="font-size:13px;">{val}</div></div>',
                           unsafe_allow_html=True)

        st.markdown("---")

        # KPIs financeiros
        st.markdown("### Resumo Financeiro")
        fc = st.columns(4)
        financeiros = [
            ("Principal", formatar_brl(totais.get("valor_hist",0)), False),
            ("Correção Monetária", formatar_brl(totais.get("cm",0)), False),
            ("Juros", formatar_brl(totais.get("juros",0)+totais.get("selic_pos",0)), False),
            ("TOTAL ATUALIZADO", formatar_brl(totais.get("total",0)), True),
        ]
        for i, (lbl, val, dest) in enumerate(financeiros):
            fc[i].markdown(f'<div class="kpi-card"><div class="kpi-label">{lbl}</div>'
                           f'<div class="kpi-value {"destaque" if dest else ""}">{val}</div></div>',
                           unsafe_allow_html=True)

        # Totais por probabilidade
        st.markdown("---")
        st.markdown("### Provisão por Risco")
        prov = {"Provável": 0, "Possível": 0, "Remoto": 0}
        for r in resultados:
            p = r.get("prob", "Possível")
            if p in prov:
                prov[p] += r.get("total", 0)

        pc = st.columns(3)
        estilos = {"Provável": ("#d1fae5","#065f46"), "Possível": ("#fef3c7","#92400e"), "Remoto": ("#fee2e2","#991b1b")}
        for i, (prob, val) in enumerate(prov.items()):
            bg, fg = estilos[prob]
            pc[i].markdown(f'<div class="kpi-card" style="border-left-color:{fg};background:{bg};">'
                           f'<div class="kpi-label" style="color:{fg};">{prob}</div>'
                           f'<div class="kpi-value" style="color:{fg};">{formatar_brl(val)}</div></div>',
                           unsafe_allow_html=True)

        st.markdown("---")

        # Tabela principal
        st.markdown("### Memória de Cálculo — Por Verba")
        st.markdown(f'<div class="info-box">📐 <b>Índice:</b> {proc.get("metodo","—")} &nbsp;|&nbsp; '
                    f'📅 <b>Data-base:</b> {proc.get("data_base","—")} &nbsp;|&nbsp; '
                    f'⚖️ IPCA-E + 1% a.m. (pré-nov/2021) | SELIC acumulada (pós-nov/2021) — ADC 58 STF</div>',
                    unsafe_allow_html=True)

        PROB_BADGE = {
            "Provável": '<span class="prob-provavel">Provável</span>',
            "Possível": '<span class="prob-possivel">Possível</span>',
            "Remoto":   '<span class="prob-remoto">Remoto</span>',
        }

        linhas = ""
        for r in resultados:
            hist  = r.get("valor_hist", 0)
            neg   = hist < 0
            cm    = r.get("cm", 0)
            juros = r.get("juros", 0) + r.get("selic_pos", 0)
            total = r.get("total", 0)
            prob  = r.get("prob", "Possível")
            mem   = r.get("memoria", "")
            comp  = r.get("competencia", "")
            cls_row = 'class="deduct"' if neg else ""
            badge = PROB_BADGE.get(prob, PROB_BADGE["Possível"])

            linhas += f"""
            <tr {cls_row}>
              <td class="verba-col">{r.get("verba","")}</td>
              <td>{comp}</td>
              <td class="num">{formatar_brl(hist)}</td>
              <td class="num">{"—" if neg else formatar_brl(cm)}</td>
              <td class="num">{"—" if neg else formatar_brl(juros)}</td>
              <td class="num" style="font-weight:800;color:{"#ef4444" if neg else "#003B5C"}">
                {formatar_brl(total)}</td>
              <td class="mem-col">{mem}</td>
              <td>{badge}</td>
            </tr>"""

        # Linha de total
        linhas += f"""
        <tr class="total-row">
          <td colspan="2"><strong>TOTAL</strong></td>
          <td class="num">{formatar_brl(totais.get("valor_hist",0))}</td>
          <td class="num">{formatar_brl(totais.get("cm",0))}</td>
          <td class="num">{formatar_brl(totais.get("juros",0)+totais.get("selic_pos",0))}</td>
          <td class="num">{formatar_brl(totais.get("total",0))}</td>
          <td></td><td></td>
        </tr>"""

        st.markdown(f"""
        <div class="tbl-wrap">
          <table class="pc-table">
            <thead>
              <tr>
                <th>Verba / Pedido</th>
                <th>Competência</th>
                <th class="num">Principal (R$)</th>
                <th class="num">Correção (R$)</th>
                <th class="num">Juros (R$)</th>
                <th class="num">Total Atualizado</th>
                <th>Memória de Cálculo</th>
                <th>Prob.</th>
              </tr>
            </thead>
            <tbody>{linhas}</tbody>
          </table>
        </div>
        """, unsafe_allow_html=True)

        # Downloads
        st.markdown("---")
        st.markdown("### 📥 Exportar")
        dc1, dc2 = st.columns(2)
        proc_info = {**proc, "data_base": proc.get("data_base", data_base),
                     "metodo": proc.get("metodo", metodo)}
        with dc1:
            try:
                xls = gerar_excel(resultados, totais, proc_info)
                nome = f"CalcPC_{proc.get('reclamante','processo').replace(' ','_')}_{data_base.replace('/','-')}.xlsx"
                st.download_button("📊 Baixar Excel", data=xls, file_name=nome,
                                   mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                                   use_container_width=True)
            except Exception as e:
                st.error(f"Erro Excel: {e}")
        with dc2:
            try:
                pdf = gerar_pdf(resultados, totais, proc_info)
                nome = f"CalcPC_{proc.get('reclamante','processo').replace(' ','_')}_{data_base.replace('/','-')}.pdf"
                st.download_button("📄 Baixar PDF", data=pdf, file_name=nome,
                                   mime="application/pdf", use_container_width=True)
            except Exception as e:
                st.error(f"Erro PDF: {e}")

# ============================================================
# TAB 3 — AJUDA
# ============================================================
with tab_ajuda:
    st.markdown("""
## Cálculos P&C — Como usar

### Tipos de peça

| Peça | O que a IA faz |
|------|---------------|
| **Inicial** | Lê os pedidos → monta verbas com valor pleiteado + risco |
| **Sentença** | Lê inicial + sentença → verbas deferidas/indeferidas → calcula CM + juros |
| **Laudo** | Lê inicial + laudo → usa valores do perito → calcula CM + juros |

### Probabilidade por verba
- **Provável** — deferido na sentença / apurado pelo perito (> 50%)
- **Possível** — em recurso / pleiteado sem decisão
- **Remoto** — indeferido na sentença

### Índice de correção (ADC 58 STF)
| Fase | Período | Índice |
|------|---------|--------|
| 1 | Competência → out/2021 | IPCA-E + 1% a.m. simples |
| 2 | nov/2021 → data-base | SELIC acumulada (BCB) |

### Dúvidas
Controladoria Time B · Peixoto & Cury Advogados
    """)
