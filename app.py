"""
Cálculos P&C — Plataforma de Cálculos Trabalhistas com IA
Peixoto & Cury Advogados · Controladoria Time B
"""
import datetime
import os
import re

import pandas as pd
import streamlit as st

from modules.extractor         import extrair_texto, contar_paginas
from modules.calculator        import calcular_lista, totalizar, formatar_brl
from modules.excel_export      import gerar_excel
from modules.pdf_report        import gerar_pdf
from modules.ai_parser         import extrair_com_ia, resultado_para_verbas
from modules.calculos_encargos import calcular_encargos_completo

# ─────────────────────────────────────────────
# Página
# ─────────────────────────────────────────────
st.set_page_config(page_title="Cálculos P&C", page_icon="⚖️", layout="wide",
                   initial_sidebar_state="expanded")

# ─────────────────────────────────────────────
# CSS — Identidade P&C (igual aos demais sistemas)
# ─────────────────────────────────────────────
st.markdown("""
<style>
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@300;400;500;600;700&display=swap');
html,body,[class*="css"]{font-family:'IBM Plex Sans',system-ui,sans-serif!important;}

/* ── Sidebar ── */
section[data-testid="stSidebar"]{
  background:linear-gradient(180deg,#001e36 0%,#003B5C 100%)!important;
  border-right:1px solid rgba(0,169,224,.15);}
section[data-testid="stSidebar"] *{color:#fff!important;}
section[data-testid="stSidebar"] .stSelectbox>div>div,
section[data-testid="stSidebar"] input{
  background:rgba(255,255,255,.07)!important;
  border:1px solid rgba(0,169,224,.25)!important;color:#fff!important;}
section[data-testid="stSidebar"] label{color:rgba(255,255,255,.7)!important;
  font-size:10px!important;font-weight:700!important;text-transform:uppercase!important;letter-spacing:.6px!important;}

/* ── Header ── */
.pc-header{background:#fff;border-bottom:1px solid rgba(0,59,92,.14);
  box-shadow:0 2px 10px rgba(0,59,92,.08);padding:10px 20px;
  display:flex;align-items:center;gap:14px;margin-bottom:20px;border-radius:10px;}
.pc-header img{height:44px;background:#003B5C;border-radius:8px;padding:5px;}
.pc-header-title{font-size:16px;font-weight:700;color:#003B5C;}
.pc-header-sub{font-size:11px;color:#6B7F93;margin-top:2px;}
.badge-ia{background:#003B5C;color:#00A9E0;font-size:10px;font-weight:800;
  padding:2px 9px;border-radius:10px;margin-left:8px;letter-spacing:.5px;}

/* ── Cards ── */
.sk{background:#fff;border:1px solid rgba(0,59,92,.12);border-radius:10px;
  padding:14px 16px;border-left:4px solid #00A9E0;box-shadow:0 1px 4px rgba(0,59,92,.06);}
.sk .lbl{font-size:9px;text-transform:uppercase;letter-spacing:.6px;font-weight:700;color:#6B7F93;}
.sk .val{font-size:20px;font-weight:800;color:#003B5C;margin-top:4px;}
.sk .val.dest{color:#00A9E0;}
.sk .val.verde{color:#065f46;}
.sk .val.warn{color:#92400e;}
.sk .val.danger{color:#991b1b;}

/* ── Tabela ── */
.tbl-wrap{overflow-x:auto;border-radius:10px;border:1px solid rgba(0,59,92,.12);}
.pc-table{width:100%;border-collapse:collapse;font-size:12px;min-width:800px;}
.pc-table thead tr{background:linear-gradient(135deg,#001e36,#003B5C);color:#fff;}
.pc-table thead th{padding:10px 12px;text-align:left;font-size:10px;
  text-transform:uppercase;letter-spacing:.5px;white-space:nowrap;}
.pc-table thead th.r{text-align:right;}
.pc-table tbody td{padding:9px 12px;border-bottom:1px solid rgba(0,59,92,.07);
  color:#17324D;vertical-align:middle;}
.pc-table tbody tr:hover td{background:rgba(0,169,224,.05);}
.pc-table td.r{text-align:right;font-variant-numeric:tabular-nums;font-weight:600;}
.pc-table tr.total-row td{background:linear-gradient(135deg,#001e36,#003B5C)!important;
  color:#fff!important;font-weight:700;padding:11px 12px;}
.pc-table tr.total-row td.r{color:#00A9E0!important;font-size:13px;}
.pc-table tr.deduct td{background:#fff9f0!important;color:#92400e!important;}
.pc-table tr.acordo-row td{background:#f0fdf4!important;color:#065f46!important;}

/* ── Badges prob ── */
.prob-p{display:inline-block;background:#fef3c7;color:#92400e;
  font-size:10px;font-weight:700;padding:2px 8px;border-radius:20px;}
.prob-v{display:inline-block;background:#d1fae5;color:#065f46;
  font-size:10px;font-weight:700;padding:2px 8px;border-radius:20px;}
.prob-r{display:inline-block;background:#fee2e2;color:#991b1b;
  font-size:10px;font-weight:700;padding:2px 8px;border-radius:20px;}

/* ── Caixas info ── */
.info-box{background:#f0f9ff;border-left:4px solid #00A9E0;
  padding:10px 14px;border-radius:0 8px 8px 0;font-size:12px;color:#0c4a6e;margin:8px 0;}
.warn-box{background:#fff7ed;border-left:4px solid #f59e0b;
  padding:10px 14px;border-radius:0 8px 8px 0;font-size:12px;color:#78350f;margin:8px 0;}
.ok-box{background:#f0fdf4;border-left:4px solid #22c55e;
  padding:10px 14px;border-radius:0 8px 8px 0;font-size:12px;color:#14532d;margin:8px 0;}

/* ── Quadro financeiro ── */
.qf-table{width:100%;border-collapse:collapse;font-size:12px;border-radius:10px;overflow:hidden;
  border:1px solid rgba(0,59,92,.12);}
.qf-table th{background:#003B5C;color:#fff;padding:9px 14px;text-align:left;font-size:10px;
  text-transform:uppercase;letter-spacing:.5px;}
.qf-table td{padding:9px 14px;border-bottom:1px solid rgba(0,59,92,.07);color:#17324D;}
.qf-table td.r{text-align:right;font-weight:600;font-variant-numeric:tabular-nums;}
.qf-table tr.sub td{background:#f8fbfd;color:#6B7F93;font-size:11px;}
.qf-table tr.neg td{color:#92400e;}
.qf-table tr.neg td.r{color:#92400e;}
.qf-table tr.bold td{font-weight:700;background:#f0f8fc;}
.qf-table tr.total-f td{background:#001e36;color:#fff;font-weight:800;}
.qf-table tr.total-f td.r{color:#00A9E0;font-size:15px;}

/* ── Destaque total ── */
.total-destaque{background:linear-gradient(135deg,#001e36,#003B5C);border-radius:12px;
  padding:20px;text-align:center;margin-top:16px;}
.total-destaque .tl{color:rgba(255,255,255,.6);font-size:11px;font-weight:700;
  text-transform:uppercase;letter-spacing:1px;}
.total-destaque .tv{color:#00A9E0;font-size:30px;font-weight:900;margin-top:6px;}
.total-destaque .ts{color:rgba(255,255,255,.5);font-size:11px;margin-top:6px;}

/* ── Acordo ── */
.acordo-card{background:#fff;border:1px solid rgba(0,59,92,.12);border-radius:12px;
  padding:18px;box-shadow:0 2px 8px rgba(0,59,92,.08);margin-bottom:14px;}
.acordo-title{font-size:13px;font-weight:700;color:#003B5C;margin-bottom:12px;
  display:flex;align-items:center;gap:8px;text-transform:uppercase;letter-spacing:.3px;}
.type-sal{display:inline-block;background:#dbeafe;color:#1e40af;font-size:10px;
  font-weight:700;padding:2px 8px;border-radius:20px;}
.type-ind{display:inline-block;background:#fce7f3;color:#9d174d;font-size:10px;
  font-weight:700;padding:2px 8px;border-radius:20px;}

/* ── Botões ── */
.stButton>button{background:#003B5C!important;color:#fff!important;
  border:none!important;font-weight:600!important;border-radius:8px!important;
  font-family:'IBM Plex Sans',sans-serif!important;}
.stButton>button:hover{background:#00A9E0!important;}
div[data-testid="stHorizontalBlock"] .stButton>button{width:100%;}

/* Remove Streamlit branding */
#MainMenu,footer,header{visibility:hidden;}
</style>
""", unsafe_allow_html=True)

# ─────────────────────────────────────────────
# Estado
# ─────────────────────────────────────────────
def _init():
    for k, v in {
        "tipo_peca": "inicial", "resultado_ia": None,
        "verbas_calc": [], "calculado": False,
        "resultados": [], "totais": {}, "encargos": {}, "processo": {},
    }.items():
        if k not in st.session_state:
            st.session_state[k] = v
_init()

# ─────────────────────────────────────────────
# API Key
# ─────────────────────────────────────────────
_key = ""
try:
    _key = st.secrets["ANTHROPIC_API_KEY"]
except Exception:
    _key = os.environ.get("ANTHROPIC_API_KEY", "")
if _key:
    os.environ["ANTHROPIC_API_KEY"] = _key

# ─────────────────────────────────────────────
# Sidebar
# ─────────────────────────────────────────────
with st.sidebar:
    st.markdown("""
    <div style="text-align:center;padding:18px 0 20px 0;
      border-bottom:1px solid rgba(0,169,224,.2);margin-bottom:18px;">
      <img src="https://www.peixotoecury.com.br/assets/images/ui/logo-light.png"
        style="height:48px;background:#003B5C;border-radius:8px;padding:6px;" />
      <div style="font-size:11px;font-weight:600;color:#90c8e0;margin-top:8px;">
        Cálculos Trabalhistas · IA</div>
    </div>
    """, unsafe_allow_html=True)

    if _key:
        st.markdown('<div style="font-size:11px;color:#10b981;">✅ IA configurada</div>',
                    unsafe_allow_html=True)
    else:
        api_key_manual = st.text_input("Chave Anthropic", type="password")
        if api_key_manual:
            os.environ["ANTHROPIC_API_KEY"] = api_key_manual
            _key = api_key_manual

    st.markdown("---")
    st.markdown("**PARÂMETROS**")

    metodo = st.selectbox("Índice de correção",
        ["SELIC_ADC58", "IPCAE_1PCT", "TR_1PCT", "SEM_CORRECAO"],
        format_func=lambda x: {
            "SELIC_ADC58":  "IPCA-E + SELIC (ADC 58 ✓)",
            "IPCAE_1PCT":   "IPCA-E + 1% ao mês",
            "TR_1PCT":      "TR + 1% ao mês",
            "SEM_CORRECAO": "Sem correção",
        }[x])

    hoje = datetime.date.today()
    meses = [f"{m:02d}/{y}" for y in range(hoje.year, hoje.year-3, -1)
             for m in range(12, 0, -1)][:48]
    data_ajuizamento = st.text_input("Data ajuizamento (MM/AAAA)", placeholder="03/2023")
    data_base = st.selectbox("Mês-base do cálculo", meses, index=0)

    st.markdown("---")
    st.markdown("**ENCARGOS**")
    perc_hon = st.slider("Honorários (%)", 0, 30, 10, 1)
    aliq_sat = st.selectbox("SAT", [1, 2, 3], index=2,
        format_func=lambda x: f"{x}% — {'Leve' if x==1 else 'Médio' if x==2 else 'Grave'}")

    st.markdown("---")
    st.markdown(
        '<div style="font-size:10px;color:rgba(255,255,255,.35);text-align:center;">'
        'v2.0 · Jun/2026<br>Motor ADC 58 / STF · CPC 25</div>',
        unsafe_allow_html=True)

# ─────────────────────────────────────────────
# Header
# ─────────────────────────────────────────────
st.markdown("""
<div class="pc-header">
  <img src="https://www.peixotoecury.com.br/assets/images/ui/logo-light.png"/>
  <div>
    <div class="pc-header-title">
      Cálculos P&amp;C <span class="badge-ia">IA</span>
    </div>
    <div class="pc-header-sub">
      Plataforma de Cálculos Trabalhistas · Peixoto &amp; Cury Advogados
    </div>
  </div>
</div>
""", unsafe_allow_html=True)

# ─────────────────────────────────────────────
# Tabs
# ─────────────────────────────────────────────
tab_up, tab_res, tab_acordo, tab_help = st.tabs([
    "📄 Documento & Análise",
    "📊 Resultado & Cálculo",
    "🤝 Acordo",
    "❓ Ajuda",
])

# ══════════════════════════════════════════════
# TAB 1 — UPLOAD & ANÁLISE
# ══════════════════════════════════════════════
with tab_up:
    # Seletor de tipo
    c1, c2, c3, _ = st.columns([1, 1, 1, 2])
    tipo = st.session_state["tipo_peca"]
    with c1:
        if st.button("📝 Inicial", use_container_width=True,
                     type="primary" if tipo=="inicial" else "secondary"):
            st.session_state["tipo_peca"] = "inicial"; st.rerun()
    with c2:
        if st.button("⚖️ Sentença", use_container_width=True,
                     type="primary" if tipo=="sentenca" else "secondary"):
            st.session_state["tipo_peca"] = "sentenca"; st.rerun()
    with c3:
        if st.button("📋 Laudo", use_container_width=True,
                     type="primary" if tipo=="laudo" else "secondary"):
            st.session_state["tipo_peca"] = "laudo"; st.rerun()

    tipo = st.session_state["tipo_peca"]
    st.markdown("---")

    # Upload principal
    labels = {"inicial":"📝 Petição Inicial (PDF ou TXT)",
               "sentenca":"⚖️ Sentença (PDF ou TXT)",
               "laudo":"📋 Laudo Pericial (PDF ou TXT)"}
    col_a, col_b = st.columns([2, 1])
    with col_a:
        arq_principal = st.file_uploader(labels[tipo], type=["pdf","txt"], key="up_p")
    with col_b:
        txt_colado = st.text_area("Ou cole o texto aqui", height=120, key="txt_p",
                                   placeholder="Cole o texto da peça...")

    # Upload inicial (para sentença/laudo)
    arq_inicial = None
    txt_inicial = ""
    if tipo in ("sentenca","laudo"):
        st.markdown("---")
        st.markdown("**📎 Petição Inicial** — necessária para análise completa")
        col_c, col_d = st.columns([2, 1])
        with col_c:
            arq_inicial = st.file_uploader("Inicial (PDF ou TXT)", type=["pdf","txt"], key="up_i")
        with col_d:
            txt_inicial = st.text_area("Ou cole o texto da inicial", height=100,
                                        key="txt_i", placeholder="Texto da inicial...")

    st.markdown("---")
    col_btn, col_msg = st.columns([1, 3])
    with col_btn:
        analisar = st.button("🤖 Analisar com IA", use_container_width=True, disabled=not _key)
    with col_msg:
        if not _key:
            st.markdown('<div class="warn-box">⚠️ Configure a chave Anthropic na barra lateral.</div>',
                        unsafe_allow_html=True)

    if analisar:
        def _ler(arq):
            if arq is None: return ""
            b = arq.read()
            return extrair_texto(b) if arq.name.lower().endswith(".pdf") \
                   else b.decode("utf-8", errors="replace")

        with st.spinner("Lendo o documento..."):
            txt_p = _ler(arq_principal) or txt_colado
            txt_i = _ler(arq_inicial) or txt_inicial

        if not txt_p.strip():
            st.error("Nenhum texto encontrado."); st.stop()

        with st.spinner("O contador sênior está analisando... ⚖️"):
            try:
                resultado = extrair_com_ia(
                    texto_principal=txt_p, tipo_peca=tipo,
                    data_base=data_base, data_ajuizamento=data_ajuizamento,
                    texto_inicial=txt_i, api_key=_key,
                )
                verbas = resultado_para_verbas(resultado, data_base)
                st.session_state["resultado_ia"] = resultado
                st.session_state["verbas_calc"] = verbas

                def _meses(adm, dem):
                    try:
                        def _ym(s):
                            m = re.search(r"(\d{1,2})[/\-](\d{4})", str(s or ""))
                            if m: return int(m.group(2))*12+int(m.group(1))
                        a,d = _ym(adm),_ym(dem)
                        if a and d and d>a: return d-a
                    except: pass
                    return 12

                n_meses = _meses(resultado.get("admissao",""), resultado.get("demissao",""))
                resultados = calcular_lista(verbas, data_base=data_base, metodo=metodo)
                for i,r in enumerate(resultados):
                    r["prob"]    = verbas[i].get("prob","Possível")
                    r["memoria"] = verbas[i].get("memoria","")

                encargos = calcular_encargos_completo(
                    resultados, n_meses=n_meses,
                    perc_honorarios=perc_hon/100, aliq_sat=aliq_sat/100,
                )

                st.session_state.update({
                    "resultados": resultados,
                    "totais": totalizar(resultados),
                    "encargos": encargos,
                    "calculado": True,
                    "processo": {
                        "reclamante": resultado.get("reclamante",""),
                        "reclamado":  resultado.get("reclamado",""),
                        "numero_processo": resultado.get("numero_processo",""),
                        "tipo_peca": tipo,
                        "admissao":  resultado.get("admissao",""),
                        "demissao":  resultado.get("demissao",""),
                        "salario_base": resultado.get("salario_base",""),
                        "valor_da_causa": resultado.get("valor_da_causa",""),
                        "data_base": data_base, "metodo": metodo, "n_meses": n_meses,
                    },
                })

                n_v = len([v for v in verbas if float(v.get("valor_hist",0) or 0) > 0])
                st.success(f"✅ {n_v} verbas com valor identificadas. Acesse **Resultado & Cálculo**.")
                if resultado.get("observacoes_gerais"):
                    st.markdown(f'<div class="info-box">💡 <b>Contador Sênior:</b> '
                                f'{resultado["observacoes_gerais"]}</div>',
                                unsafe_allow_html=True)
            except Exception as e:
                st.error(f"Erro: {e}")

# ══════════════════════════════════════════════
# TAB 2 — RESULTADO & CÁLCULO
# ══════════════════════════════════════════════
with tab_res:
    if not st.session_state["calculado"]:
        st.markdown('<div class="info-box">ℹ️ Faça o upload e análise na aba <b>Documento & Análise</b>.</div>',
                    unsafe_allow_html=True)
    else:
        res  = st.session_state["resultados"]
        tot  = st.session_state["totais"]
        enc  = st.session_state["encargos"]
        proc = st.session_state["processo"]
        tipo_r = proc.get("tipo_peca","")

        # ── Dados do processo ──
        st.markdown("### Dados do Processo")
        kpis_proc = [
            ("Reclamante", proc.get("reclamante","—")),
            ("Reclamado",  proc.get("reclamado","—")),
            ("Processo",   proc.get("numero_processo","—")),
            ("Admissão",   proc.get("admissao","—")),
            ("Demissão",   proc.get("demissao","—")),
            ("Salário Base", formatar_brl(float(proc.get("salario_base") or 0))
             if proc.get("salario_base") else "—"),
        ]
        cols_p = st.columns(6)
        for i,(l,v) in enumerate(kpis_proc):
            cols_p[i].markdown(
                f'<div class="sk"><div class="lbl">{l}</div>'
                f'<div class="val" style="font-size:12px;">{v}</div></div>',
                unsafe_allow_html=True)

        # Info base
        if tipo_r == "inicial":
            vdc = proc.get("valor_da_causa")
            msg_vdc = f" &nbsp;|&nbsp; 💼 <b>Valor da Causa:</b> {formatar_brl(float(vdc))}" if vdc else ""
            st.markdown(
                f'<div class="warn-box">📌 <b>Petição Inicial — CPC 25:</b> '
                f'Todas as verbas são <b>Possível</b> (sem decisão judicial ainda). '
                f'O cálculo representa o risco máximo.{msg_vdc}</div>',
                unsafe_allow_html=True)
        st.markdown(
            f'<div class="info-box">📅 <b>Data-base:</b> {proc.get("data_base")} &nbsp;|&nbsp; '
            f'📐 {proc.get("metodo")} &nbsp;|&nbsp; ⚖️ ADC 58 STF</div>',
            unsafe_allow_html=True)

        # ── KPIs financeiros ──
        st.markdown("### Resumo Financeiro")
        kf = st.columns(5)
        kfin = [
            ("Principal Histórico", formatar_brl(tot.get("valor_hist",0)), ""),
            ("Correção Monetária",  formatar_brl(tot.get("cm",0)), ""),
            ("Juros",               formatar_brl(tot.get("juros",0)+tot.get("selic_pos",0)), ""),
            ("Total Atualizado",    formatar_brl(tot.get("total",0)), " dest"),
            ("Total a Pagar\n(Reclamado)", formatar_brl(enc.get("total_reclamado",0)), " dest"),
        ]
        for i,(l,v,cls) in enumerate(kfin):
            kf[i].markdown(
                f'<div class="sk"><div class="lbl">{l}</div>'
                f'<div class="val{cls}">{v}</div></div>',
                unsafe_allow_html=True)

        # ── Provisão CPC 25 ──
        st.markdown("---")
        st.markdown("### Provisão por Risco — CPC 25")
        prov = {"Provável":0,"Possível":0,"Remoto":0}
        for r in res:
            p = r.get("prob","Possível")
            if p in prov: prov[p] += r.get("total",0)

        cpc_cols = st.columns(3)
        cpc_cfg = {
            "Provável": ("verde","Provisionar no Passivo","CPC 25 — obrigatório"),
            "Possível": ("warn","Nota Explicativa","CPC 25 — sem provisão"),
            "Remoto":   ("danger","Sem ação contábil","CPC 25 — não divulga"),
        }
        for i,(prob,val) in enumerate(prov.items()):
            cls,acao,desc = cpc_cfg[prob]
            cpc_cols[i].markdown(
                f'<div class="sk" style="border-left-color:'
                f'{"#065f46" if cls=="verde" else "#92400e" if cls=="warn" else "#991b1b"};">'
                f'<div class="lbl">{prob}</div>'
                f'<div class="val {cls}">{formatar_brl(val)}</div>'
                f'<div style="font-size:10px;margin-top:4px;font-weight:600;color:'
                f'{"#065f46" if cls=="verde" else "#92400e" if cls=="warn" else "#991b1b"}">'
                f'{acao}</div>'
                f'<div style="font-size:9px;opacity:.7;color:{"#065f46" if cls=="verde" else "#92400e" if cls=="warn" else "#991b1b"}">'
                f'{desc}</div></div>',
                unsafe_allow_html=True)

        # ── Memória de cálculo ──
        st.markdown("---")
        st.markdown("### Memória de Cálculo — Por Verba")
        BADGE = {
            "Provável":'<span class="prob-v">Provável</span>',
            "Possível":'<span class="prob-p">Possível</span>',
            "Remoto":  '<span class="prob-r">Remoto</span>',
        }
        linhas = ""
        for r in res:
            h = r.get("valor_hist",0); neg = h<0
            cm = r.get("cm",0); j = r.get("juros",0)+r.get("selic_pos",0)
            tot_v = r.get("total",0)
            prob = r.get("prob","Possível")
            mem  = r.get("memoria","")
            comp = r.get("competencia","")
            cls  = 'class="deduct"' if neg else ""
            linhas += f"""<tr {cls}>
              <td style="font-weight:600;max-width:180px">{r.get("verba","")}</td>
              <td style="color:#6B7F93;font-size:11px">{comp}</td>
              <td class="r">{formatar_brl(h)}</td>
              <td class="r">{"—" if neg else formatar_brl(cm)}</td>
              <td class="r">{"—" if neg else formatar_brl(j)}</td>
              <td class="r" style="font-weight:800;color:{"#991b1b" if neg else "#003B5C"}">{formatar_brl(tot_v)}</td>
              <td style="font-size:10px;color:#94a3b8;max-width:200px;line-height:1.4">{mem[:120]}</td>
              <td>{BADGE.get(prob,BADGE["Possível"])}</td>
            </tr>"""
        linhas += f"""<tr class="total-row">
          <td colspan="2"><b>TOTAL</b></td>
          <td class="r">{formatar_brl(tot.get("valor_hist",0))}</td>
          <td class="r">{formatar_brl(tot.get("cm",0))}</td>
          <td class="r">{formatar_brl(tot.get("juros",0)+tot.get("selic_pos",0))}</td>
          <td class="r">{formatar_brl(tot.get("total",0))}</td>
          <td></td><td></td></tr>"""

        st.markdown(f"""<div class="tbl-wrap"><table class="pc-table">
          <thead><tr>
            <th>Verba / Pedido</th><th>Competência</th>
            <th class="r">Principal</th><th class="r">Correção</th>
            <th class="r">Juros</th><th class="r">Total Atualizado</th>
            <th>Memória</th><th>Prob.</th>
          </tr></thead>
          <tbody>{linhas}</tbody></table></div>""", unsafe_allow_html=True)

        # ── Quadros financeiros completos ──
        if enc:
            st.markdown("---")
            titulo_q = {
                "inicial": "📑 Cálculo Puro — Risco Máximo (se todos os pedidos forem deferidos)",
                "sentenca":"📑 Liquidação de Sentença",
                "laudo":   "📑 Cálculo com Base no Laudo Pericial",
            }.get(tipo_r,"📑 Quadro Financeiro Completo")
            st.markdown(f"### {titulo_q}")

            col_q1, col_q2 = st.columns(2)
            with col_q1:
                st.markdown("**Créditos e Descontos do Reclamante**")
                st.markdown(f"""<table class="qf-table">
                  <tr><th>Descrição</th><th>Valor</th></tr>
                  <tr><td>Verbas (total atualizado)</td><td class="r">{formatar_brl(enc['total_verbas'])}</td></tr>
                  <tr class="sub"><td>&nbsp;&nbsp;+ FGTS 8%</td><td class="r">{formatar_brl(enc['fgts_devido'])}</td></tr>
                  <tr class="bold"><td>Bruto Devido ao Reclamante</td><td class="r">{formatar_brl(enc['bruto'])}</td></tr>
                  <tr class="neg"><td>(−) Depósito FGTS</td><td class="r">({formatar_brl(enc['fgts_devido'])})</td></tr>
                  <tr class="neg"><td>(−) INSS Segurado</td><td class="r">({formatar_brl(enc['inss_segurado'])})</td></tr>
                  <tr class="neg"><td>(−) IR (RRA)</td><td class="r">({formatar_brl(enc['ir_devido'])})</td></tr>
                  <tr class="total-f"><td><b>Líquido ao Reclamante</b></td>
                    <td class="r"><b>{formatar_brl(enc['liquido_reclamante'])}</b></td></tr>
                </table>""", unsafe_allow_html=True)

            with col_q2:
                st.markdown("**Débitos do Reclamado por Credor**")
                st.markdown(f"""<table class="qf-table">
                  <tr><th>Descrição</th><th>Valor</th></tr>
                  <tr><td>Líquido ao Reclamante</td><td class="r">{formatar_brl(enc['liquido_reclamante'])}</td></tr>
                  <tr><td>Depósito FGTS</td><td class="r">{formatar_brl(enc['fgts_devido'])}</td></tr>
                  <tr><td>Multa FGTS 40%</td><td class="r">{formatar_brl(enc['multa_fgts_40'])}</td></tr>
                  <tr><td>INSS Empresa (20%)</td><td class="r">{formatar_brl(enc['inss_empresa'])}</td></tr>
                  <tr><td>SAT ({aliq_sat}%)</td><td class="r">{formatar_brl(enc['sat'])}</td></tr>
                  <tr><td>Honorários Advocatícios ({perc_hon}%)</td><td class="r">{formatar_brl(enc['honorarios'])}</td></tr>
                  <tr class="total-f"><td><b>Total Devido pelo Reclamado</b></td>
                    <td class="r" style="font-size:15px;color:#00A9E0"><b>{formatar_brl(enc['total_reclamado'])}</b></td></tr>
                </table>""", unsafe_allow_html=True)

            st.markdown(f"""<div class="total-destaque">
              <div class="tl">PROVISÃO TOTAL — VALOR A PAGAR PELO RECLAMADO</div>
              <div class="tv">{formatar_brl(enc['total_reclamado'])}</div>
              <div class="ts">Líquido ao Reclamante: {formatar_brl(enc['liquido_reclamante'])}
                &nbsp;|&nbsp; Encargos: {formatar_brl(enc['total_reclamado']-enc['liquido_reclamante'])}</div>
            </div>""", unsafe_allow_html=True)

        # ── Downloads ──
        st.markdown("---")
        st.markdown("### Exportar")
        dc1, dc2 = st.columns(2)
        tipo_r2 = proc.get("tipo_peca","inicial")
        r_ini = res if tipo_r2=="inicial" else []
        r_lau = res if tipo_r2=="laudo"   else []
        r_sen = res if tipo_r2 in ("sentenca","acordao") else []
        nome_arq = proc.get("reclamante","processo").replace(" ","_")
        with dc1:
            try:
                xls = gerar_excel(proc, r_ini, r_lau, r_sen, metodo)
                st.download_button("📊 Baixar Excel", data=xls,
                    file_name=f"CalcPC_{nome_arq}.xlsx",
                    mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    use_container_width=True)
            except Exception as e:
                st.error(f"Excel: {e}")
        with dc2:
            try:
                pdf = gerar_pdf(proc, r_ini, r_lau, r_sen, metodo)
                st.download_button("📄 Baixar PDF", data=pdf,
                    file_name=f"CalcPC_{nome_arq}.pdf",
                    mime="application/pdf", use_container_width=True)
            except Exception as e:
                st.error(f"PDF: {e}")

# ══════════════════════════════════════════════
# TAB 3 — ACORDO
# ══════════════════════════════════════════════
with tab_acordo:
    if not st.session_state["calculado"]:
        st.markdown('<div class="info-box">ℹ️ Faça o upload e análise primeiro na aba <b>Documento & Análise</b>.</div>',
                    unsafe_allow_html=True)
    else:
        enc  = st.session_state["encargos"]
        res  = st.session_state["resultados"]
        proc = st.session_state["processo"]
        tot  = st.session_state["totais"]

        total_reclamado = enc.get("total_reclamado", 0)
        total_atualizado = tot.get("total", 0)

        st.markdown("### 🤝 Simulador de Acordo")
        st.markdown(f"""<div class="info-box">
          💡 O acordo encerra o processo sem trânsito em julgado.
          A empresa paga menos encargos quando o valor é parcialmente <b>indenizatório</b>
          (sem FGTS, sem INSS, sem IR). Use esta aba para encontrar o valor ideal.
        </div>""", unsafe_allow_html=True)

        st.markdown("---")
        col_ac1, col_ac2 = st.columns([1, 1])

        with col_ac1:
            st.markdown("#### Valor do Acordo")
            modo_acordo = st.radio("Definir por:", ["Valor fixo (R$)", "Percentual do cálculo (%)"],
                                    horizontal=True, key="modo_ac")
            if modo_acordo == "Valor fixo (R$)":
                valor_acordo_input = st.number_input(
                    "Valor total do acordo (R$)", min_value=0.0,
                    value=float(round(total_atualizado * 0.6, 2)),
                    step=1000.0, format="%.2f", key="vac")
                valor_acordo = valor_acordo_input
            else:
                pct_acordo = st.slider("% do valor atualizado", 10, 100, 60, 5, key="pac")
                valor_acordo = round(total_atualizado * pct_acordo / 100, 2)
                st.markdown(f'<div class="ok-box">Valor: <b>{formatar_brl(valor_acordo)}</b> '
                            f'({pct_acordo}% de {formatar_brl(total_atualizado)})</div>',
                            unsafe_allow_html=True)

        with col_ac2:
            st.markdown("#### Composição do Acordo")
            st.markdown("Defina quanto é salarial vs. indenizatório:")
            pct_sal = st.slider("Parcela salarial (%)", 0, 100, 40, 5, key="psal")
            pct_ind = 100 - pct_sal

            val_sal = round(valor_acordo * pct_sal / 100, 2)
            val_ind = round(valor_acordo * pct_ind / 100, 2)

            st.markdown(f"""
            <div style="display:flex;gap:10px;margin-top:8px;">
              <div class="sk" style="flex:1;border-left-color:#1e40af;">
                <div class="lbl">Salarial</div>
                <div class="val" style="font-size:14px;color:#1e40af;">{formatar_brl(val_sal)}</div>
                <div style="font-size:10px;color:#6B7F93;">FGTS + INSS + IR incidem</div>
              </div>
              <div class="sk" style="flex:1;border-left-color:#9d174d;">
                <div class="lbl">Indenizatório</div>
                <div class="val" style="font-size:14px;color:#9d174d;">{formatar_brl(val_ind)}</div>
                <div style="font-size:10px;color:#6B7F93;">Sem FGTS, sem INSS, sem IR</div>
              </div>
            </div>""", unsafe_allow_html=True)

        # ── Cálculo do acordo ──
        st.markdown("---")
        st.markdown("#### Resultado do Acordo")

        n_meses = proc.get("n_meses", 12)

        # Encargos sobre parcela salarial do acordo
        fgts_ac       = round(val_sal * 0.08, 2)
        multa_fgts_ac = round(fgts_ac * 0.40, 2)
        inss_seg_ac   = round(min(val_sal / n_meses, 8157.41) * 0.14 * n_meses, 2)  # estimativa simplificada
        inss_emp_ac   = round(val_sal * 0.20, 2)
        sat_ac        = round(val_sal * aliq_sat / 100, 2)
        hon_ac        = round(valor_acordo * perc_hon / 100, 2)
        ir_ac         = 0.0  # acordos costumam ter IR zero ou mínimo

        bruto_ac      = round(valor_acordo + fgts_ac, 2)
        descontos_ac  = round(fgts_ac + inss_seg_ac + ir_ac, 2)
        liquido_ac    = round(bruto_ac - descontos_ac, 2)
        total_paga_ac = round(liquido_ac + fgts_ac + multa_fgts_ac + inss_emp_ac + sat_ac + hon_ac, 2)

        economia = round(total_reclamado - total_paga_ac, 2)
        pct_econ = round(economia / total_reclamado * 100, 1) if total_reclamado > 0 else 0

        col_r1, col_r2 = st.columns(2)
        with col_r1:
            st.markdown("**O Reclamante recebe:**")
            st.markdown(f"""<table class="qf-table">
              <tr><th>Descrição</th><th>Valor</th></tr>
              <tr><td>Valor do Acordo</td><td class="r">{formatar_brl(valor_acordo)}</td></tr>
              <tr class="sub"><td>&nbsp;&nbsp;Parcela Salarial</td><td class="r">{formatar_brl(val_sal)}</td></tr>
              <tr class="sub"><td>&nbsp;&nbsp;Parcela Indenizatória</td><td class="r">{formatar_brl(val_ind)}</td></tr>
              <tr><td>+ FGTS 8% (salarial)</td><td class="r">{formatar_brl(fgts_ac)}</td></tr>
              <tr class="bold"><td>Bruto</td><td class="r">{formatar_brl(bruto_ac)}</td></tr>
              <tr class="neg"><td>(−) Depósito FGTS</td><td class="r">({formatar_brl(fgts_ac)})</td></tr>
              <tr class="neg"><td>(−) INSS Segurado (estimado)</td><td class="r">({formatar_brl(inss_seg_ac)})</td></tr>
              <tr class="neg"><td>(−) IR</td><td class="r">({formatar_brl(ir_ac)})</td></tr>
              <tr class="total-f"><td><b>Líquido ao Reclamante</b></td>
                <td class="r"><b>{formatar_brl(liquido_ac)}</b></td></tr>
            </table>""", unsafe_allow_html=True)

        with col_r2:
            st.markdown("**A Empresa paga:**")
            st.markdown(f"""<table class="qf-table">
              <tr><th>Descrição</th><th>Valor</th></tr>
              <tr><td>Líquido ao Reclamante</td><td class="r">{formatar_brl(liquido_ac)}</td></tr>
              <tr><td>Depósito FGTS</td><td class="r">{formatar_brl(fgts_ac)}</td></tr>
              <tr><td>Multa FGTS 40%</td><td class="r">{formatar_brl(multa_fgts_ac)}</td></tr>
              <tr><td>INSS Empresa 20% (salarial)</td><td class="r">{formatar_brl(inss_emp_ac)}</td></tr>
              <tr><td>SAT {aliq_sat}% (salarial)</td><td class="r">{formatar_brl(sat_ac)}</td></tr>
              <tr><td>Honorários {perc_hon}%</td><td class="r">{formatar_brl(hon_ac)}</td></tr>
              <tr class="total-f"><td><b>Total a Pagar no Acordo</b></td>
                <td class="r" style="color:#00A9E0;font-size:15px"><b>{formatar_brl(total_paga_ac)}</b></td></tr>
            </table>""", unsafe_allow_html=True)

        # Comparativo
        st.markdown("---")
        st.markdown("#### Comparativo: Acordo × Condenação Integral")
        col_cmp = st.columns(3)
        col_cmp[0].markdown(
            f'<div class="sk" style="border-left-color:#991b1b;">'
            f'<div class="lbl">Condenação Integral</div>'
            f'<div class="val danger">{formatar_brl(total_reclamado)}</div>'
            f'<div style="font-size:10px;color:#6B7F93;">Se perder tudo na fase de execução</div>'
            f'</div>', unsafe_allow_html=True)
        col_cmp[1].markdown(
            f'<div class="sk" style="border-left-color:#003B5C;">'
            f'<div class="lbl">Acordo Proposto</div>'
            f'<div class="val dest">{formatar_brl(total_paga_ac)}</div>'
            f'<div style="font-size:10px;color:#6B7F93;">{formatar_brl(valor_acordo)} líquido + encargos</div>'
            f'</div>', unsafe_allow_html=True)
        col_cmp[2].markdown(
            f'<div class="sk" style="border-left-color:#065f46;">'
            f'<div class="lbl">Economia com o Acordo</div>'
            f'<div class="val verde">{formatar_brl(economia)}</div>'
            f'<div style="font-size:10px;color:#065f46;font-weight:700;">{pct_econ}% de redução de custo</div>'
            f'</div>', unsafe_allow_html=True)

        if economia > 0:
            st.markdown(f'<div class="ok-box">✅ O acordo representa uma economia de '
                        f'<b>{formatar_brl(economia)} ({pct_econ}%)</b> em relação à condenação integral. '
                        f'Quanto maior a parcela <b>indenizatória</b>, menor o custo total para a empresa.</div>',
                        unsafe_allow_html=True)
        else:
            st.markdown('<div class="warn-box">⚠️ O custo do acordo está próximo ou acima da condenação integral. '
                        'Considere reduzir o valor ou aumentar a parcela indenizatória.</div>',
                        unsafe_allow_html=True)

# ══════════════════════════════════════════════
# TAB 4 — AJUDA
# ══════════════════════════════════════════════
with tab_help:
    st.markdown("""
## Cálculos P&C — Guia Completo

### Tipos de Peça

| Peça | O que a IA faz |
|------|---------------|
| **Inicial** | Lê pedidos → extrai verbas com valores → tudo **Possível** |
| **Sentença** | Lê inicial + sentença → deferido = **Provável** / indeferido = **Remoto** |
| **Laudo** | Lê inicial + laudo → valores do perito → **Provável** quando favorável |

---

### Classificação de Risco — CPC 25

| Classificação | Probabilidade | Tratamento Contábil |
|---|---|---|
| **Provável** | > 50% | **Provisionar no Passivo** — registrar como despesa obrigatoriamente |
| **Possível** | 25% a 50% | **Divulgar em Nota Explicativa** — não provisiona, mas informa |
| **Remoto** | < 25% | **Sem ação** — nem provisão nem nota explicativa |

**Regra prática:**
- Inicial sem decisão → tudo **Possível**
- Sentença desfavorável → verbas deferidas = **Provável**
- Sentença favorável → **Remoto**
- Em recurso → mantém classificação anterior ou **Possível**

---

### Correção Monetária — ADC 58 (STF 18/11/2021)

| Fase | Período | Correção | Juros |
|------|---------|----------|-------|
| 1 | Competência → out/2021 | IPCA-E acumulado | 1% ao mês simples sobre valor histórico |
| 2 | nov/2021 → data-base | SELIC acumulada (BCB) | Embutida na SELIC |

---

### Encargos Calculados

| Encargo | Base de Cálculo | Responsável |
|---------|----------------|-------------|
| FGTS 8% | Verbas com incidência | Recolher em conta vinculada |
| Multa FGTS 40% | Total FGTS devido | Empregador |
| INSS Segurado | Tabela progressiva 2025 (até R$ 8.157,41) | Desconto do reclamante |
| INSS Empresa 20% | Verbas salariais | Empregador |
| SAT (1-3%) | Verbas salariais | Empregador |
| IR (RRA) | Art. 12-A Lei 7.713/88 | Desconto do reclamante |
| Honorários | % sobre bruto (configurável) | Empregador |

---

### Aba Acordo

Use para simular o custo real de um acordo:
- **Verbas Salariais**: incidem FGTS, INSS, IR → custo maior para a empresa
- **Verbas Indenizatórias**: sem FGTS, sem INSS, sem IR → custo menor
- Quanto maior a proporção indenizatória, menor o custo total do acordo

---

*Controladoria Time B · Peixoto & Cury Advogados*
    """)
