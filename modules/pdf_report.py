"""
Relatorio PDF profissional para calculos trabalhistas.
Usa reportlab para gerar documento com capa, tabelas e metodologia.
"""
from __future__ import annotations
import io
import datetime

from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.units import cm, mm
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT, TA_JUSTIFY
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    HRFlowable, PageBreak, KeepTogether
)
from reportlab.platypus.flowables import BalancedColumns

# ---------------------------------------------------------------------------
# Cores
# ---------------------------------------------------------------------------
AZUL_ESCURO = colors.HexColor("#001E36")
AZUL_MEDIO  = colors.HexColor("#003B5C")
AZUL_CLARO  = colors.HexColor("#00A9E0")
CINZA_CLARO = colors.HexColor("#F0F5F9")
CINZA_LINHA = colors.HexColor("#E2EAF0")
BRANCO      = colors.white
VERMELHO    = colors.HexColor("#C0392B")
VERDE       = colors.HexColor("#1A7A4A")

PAGE_W, PAGE_H = A4
MARGIN = 2 * cm


def _styles():
    ss = getSampleStyleSheet()
    styles = {
        "titulo": ParagraphStyle("titulo", fontName="Helvetica-Bold", fontSize=20,
                                  textColor=BRANCO, alignment=TA_CENTER, leading=26),
        "subtitulo": ParagraphStyle("subtitulo", fontName="Helvetica", fontSize=11,
                                     textColor=AZUL_CLARO, alignment=TA_CENTER, leading=16),
        "secao": ParagraphStyle("secao", fontName="Helvetica-Bold", fontSize=10,
                                 textColor=BRANCO, alignment=TA_LEFT, leading=14,
                                 spaceAfter=0),
        "corpo": ParagraphStyle("corpo", fontName="Helvetica", fontSize=9,
                                 textColor=AZUL_ESCURO, alignment=TA_JUSTIFY,
                                 leading=13, spaceAfter=4),
        "label": ParagraphStyle("label", fontName="Helvetica-Bold", fontSize=8,
                                 textColor=AZUL_MEDIO, leading=11),
        "valor": ParagraphStyle("valor", fontName="Helvetica", fontSize=8,
                                 textColor=colors.black, leading=11),
        "rodape": ParagraphStyle("rodape", fontName="Helvetica", fontSize=7,
                                  textColor=colors.grey, alignment=TA_CENTER),
        "aviso": ParagraphStyle("aviso", fontName="Helvetica-Oblique", fontSize=7.5,
                                 textColor=VERMELHO, alignment=TA_LEFT,
                                 leading=11, spaceAfter=6),
    }
    return styles


def _fmt_brl(v) -> str:
    try:
        return f"R$ {float(v):,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    except Exception:
        return str(v)


def _cabecalho_pagina(canvas, doc):
    canvas.saveState()
    # Faixa topo
    canvas.setFillColor(AZUL_ESCURO)
    canvas.rect(0, PAGE_H - 1.5*cm, PAGE_W, 1.5*cm, fill=1, stroke=0)
    canvas.setFont("Helvetica-Bold", 10)
    canvas.setFillColor(BRANCO)
    canvas.drawCentredString(PAGE_W/2, PAGE_H - 1.0*cm, "LAWgico  ·  Calculos Trabalhistas  ·  Peixoto & Cury Advogados")
    # Rodape
    canvas.setFillColor(AZUL_ESCURO)
    canvas.rect(0, 0, PAGE_W, 1.2*cm, fill=1, stroke=0)
    canvas.setFont("Helvetica", 7)
    canvas.setFillColor(colors.HexColor("#7A9BB5"))
    canvas.drawString(MARGIN, 0.45*cm,
        f"Gerado em {datetime.datetime.now().strftime('%d/%m/%Y %H:%M')} | Uso interno — dados sujeitos a revisao pericial")
    canvas.drawRightString(PAGE_W - MARGIN, 0.45*cm, f"Pagina {doc.page}")
    canvas.restoreState()


def _tabela_peca(st, nome_peca: str, resultados: list[dict]) -> list:
    """Cria flowables para a tabela de uma peca."""
    elements = []
    s = _styles()

    # Cabecalho da secao
    tab_hdr = Table(
        [[Paragraph(f"  {nome_peca.upper()}", s["secao"])]],
        colWidths=[PAGE_W - 2*MARGIN],
    )
    tab_hdr.setStyle(TableStyle([
        ("BACKGROUND", (0,0), (-1,-1), AZUL_MEDIO),
        ("TOPPADDING", (0,0), (-1,-1), 6),
        ("BOTTOMPADDING", (0,0), (-1,-1), 6),
    ]))
    elements.append(tab_hdr)
    elements.append(Spacer(1, 3*mm))

    # Cabecalho da tabela
    cols_hdr = ["#", "Verba", "Compet.", "Historico", "CM", "Juros", "SELIC", "Total"]
    col_w = [0.6*cm, 5.5*cm, 1.5*cm, 2.3*cm, 2.0*cm, 1.8*cm, 2.0*cm, 2.3*cm]

    data = [cols_hdr]
    tot_hist = tot_cm = tot_juros = tot_selic = tot_total = 0.0

    for r in resultados:
        ind = "✗" if r.get("deferido") == "Nao" else str(r.get("seq", ""))
        row_data = [
            ind,
            r.get("verba", ""),
            r.get("competencia", ""),
            _fmt_brl(r.get("valor_hist", 0)),
            _fmt_brl(r.get("cm", 0)),
            _fmt_brl(r.get("juros", 0)),
            _fmt_brl(r.get("selic_pos", 0)),
            _fmt_brl(r.get("total", 0)),
        ]
        data.append(row_data)
        tot_hist  += r.get("valor_hist", 0)
        tot_cm    += r.get("cm", 0)
        tot_juros += r.get("juros", 0)
        tot_selic += r.get("selic_pos", 0)
        tot_total += r.get("total", 0)

    # Linha de total
    data.append([
        "", "TOTAL GERAL", "",
        _fmt_brl(tot_hist), _fmt_brl(tot_cm),
        _fmt_brl(tot_juros), _fmt_brl(tot_selic),
        _fmt_brl(tot_total),
    ])

    style_tabela = TableStyle([
        # Cabecalho
        ("BACKGROUND",   (0, 0), (-1, 0), AZUL_MEDIO),
        ("TEXTCOLOR",    (0, 0), (-1, 0), BRANCO),
        ("FONTNAME",     (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE",     (0, 0), (-1, 0), 7.5),
        ("ALIGN",        (0, 0), (-1, 0), "CENTER"),
        ("TOPPADDING",   (0, 0), (-1, 0), 5),
        ("BOTTOMPADDING",(0, 0), (-1, 0), 5),
        # Dados
        ("FONTNAME",     (0, 1), (-1, -2), "Helvetica"),
        ("FONTSIZE",     (0, 1), (-1, -2), 7.5),
        ("TOPPADDING",   (0, 1), (-1, -2), 3),
        ("BOTTOMPADDING",(0, 1), (-1, -2), 3),
        ("ALIGN",        (3, 1), (-1, -1), "RIGHT"),
        ("ALIGN",        (0, 1), (2, -1), "CENTER"),
        # Zebra
        ("ROWBACKGROUNDS",(0, 1), (-1, -2), [BRANCO, CINZA_CLARO]),
        # Total
        ("BACKGROUND",   (0, -1), (-1, -1), AZUL_ESCURO),
        ("TEXTCOLOR",    (0, -1), (-1, -1), BRANCO),
        ("FONTNAME",     (0, -1), (-1, -1), "Helvetica-Bold"),
        ("FONTSIZE",     (0, -1), (-1, -1), 8),
        # Grade
        ("GRID",         (0, 0), (-1, -1), 0.3, CINZA_LINHA),
        ("LINEABOVE",    (0, 0), (-1, 0), 1, AZUL_MEDIO),
        ("LINEBELOW",    (0, -1), (-1, -1), 1, AZUL_ESCURO),
    ])

    t = Table(data, colWidths=col_w, repeatRows=1)
    t.setStyle(style_tabela)
    elements.append(t)
    elements.append(Spacer(1, 5*mm))
    return elements


def gerar_pdf(
    processo: dict,
    res_inicial: list[dict],
    res_laudo: list[dict],
    res_sentenca: list[dict],
    metodo: str = "SELIC_ADC58",
) -> bytes:
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        leftMargin=MARGIN, rightMargin=MARGIN,
        topMargin=2.0*cm, bottomMargin=1.8*cm,
        title="LAWgico Calculos Trabalhistas",
        author="Peixoto & Cury Advogados",
    )

    s = _styles()
    elements = []

    # ---- CAPA ---------------------------------------------------------------
    elements.append(Spacer(1, 2*cm))
    capa = Table([
        [Paragraph("LAWgico", ParagraphStyle("capa_law", fontName="Helvetica-Bold",
                    fontSize=36, textColor=BRANCO, alignment=TA_CENTER))],
        [Paragraph("Calculos Trabalhistas", ParagraphStyle("capa_sub", fontName="Helvetica",
                    fontSize=16, textColor=AZUL_CLARO, alignment=TA_CENTER))],
        [Spacer(1, 0.5*cm)],
        [Paragraph(f"Processo: {processo.get('numero','-')}",
                    ParagraphStyle("capa_num", fontName="Helvetica-Bold", fontSize=11,
                                   textColor=BRANCO, alignment=TA_CENTER))],
        [Paragraph(f"Reclamante: {processo.get('reclamante','-')}",
                    ParagraphStyle("capa_info", fontName="Helvetica", fontSize=10,
                                   textColor=colors.HexColor("#7A9BB5"), alignment=TA_CENTER))],
        [Paragraph(f"Reclamada: {processo.get('reclamada','-')}",
                    ParagraphStyle("capa_info2", fontName="Helvetica", fontSize=10,
                                   textColor=colors.HexColor("#7A9BB5"), alignment=TA_CENTER))],
        [Paragraph(f"Data Base: {processo.get('data_base','-')}",
                    ParagraphStyle("capa_dt", fontName="Helvetica-Bold", fontSize=10,
                                   textColor=AZUL_CLARO, alignment=TA_CENTER))],
        [Spacer(1, 0.5*cm)],
        [Paragraph(f"Gerado em {datetime.datetime.now().strftime('%d/%m/%Y as %H:%M')}",
                    ParagraphStyle("capa_data", fontName="Helvetica", fontSize=8,
                                   textColor=colors.HexColor("#7A9BB5"), alignment=TA_CENTER))],
        [Paragraph("Peixoto &amp; Cury Advogados | Uso interno — perspectiva da Reclamada",
                    ParagraphStyle("capa_firma", fontName="Helvetica-Oblique", fontSize=8,
                                   textColor=colors.HexColor("#7A9BB5"), alignment=TA_CENTER))],
    ],
        colWidths=[PAGE_W - 2*MARGIN]
    )
    capa.setStyle(TableStyle([
        ("BACKGROUND",  (0, 0), (-1, -1), AZUL_ESCURO),
        ("TOPPADDING",  (0, 0), (-1, -1), 10),
        ("BOTTOMPADDING",(0,0), (-1, -1), 10),
        ("ROUNDEDCORNERS", (0, 0), (-1, -1), 8),
    ]))
    elements.append(capa)
    elements.append(PageBreak())

    # ---- AVISO --------------------------------------------------------------
    elements.append(Paragraph(
        "AVISO: Este relatorio foi elaborado sob a perspectiva da Reclamada (empresa) para fins "
        "de estrategia processual e negociacao. Os valores podem diferir dos calculos periciais "
        "oficiais. Nao substitui parecer juridico ou laudo pericial.",
        s["aviso"]
    ))
    elements.append(HRFlowable(color=CINZA_LINHA, thickness=0.5))
    elements.append(Spacer(1, 4*mm))

    # ---- METODOLOGIA --------------------------------------------------------
    tab_met = Table([
        [Paragraph("  METODOLOGIA APLICADA", s["secao"])],
    ], colWidths=[PAGE_W - 2*MARGIN])
    tab_met.setStyle(TableStyle([
        ("BACKGROUND", (0,0), (-1,-1), AZUL_MEDIO),
        ("TOPPADDING", (0,0), (-1,-1), 6),
        ("BOTTOMPADDING",(0,0),(-1,-1),6),
    ]))
    elements.append(tab_met)
    elements.append(Spacer(1, 3*mm))

    metodo_desc = {
        "SELIC_ADC58":  "ADC 58 STF (18/11/2021): IPCA-E + 1% a.m. simples ate out/2021 | SELIC acumulada de nov/2021 ate data base.",
        "IPCAE_1PCT":   "IPCA-E + 1% ao mes simples sobre valor historico — todo o periodo.",
        "SEM_CORRECAO": "Sem aplicacao de correcao monetaria ou juros.",
    }.get(metodo, metodo)

    elements.append(Paragraph(metodo_desc, s["corpo"]))
    elements.append(Spacer(1, 5*mm))

    # ---- TABELAS DE PECAS ---------------------------------------------------
    if res_inicial:
        elements.extend(_tabela_peca(s, "Peticao Inicial — Valores Pleiteados", res_inicial))
    if res_laudo:
        elements.extend(_tabela_peca(s, "Laudo Pericial — Apuracao do Perito", res_laudo))
    if res_sentenca:
        elements.extend(_tabela_peca(s, "Sentenca — Valores Deferidos/Indeferidos", res_sentenca))

    # ---- COMPARATIVO --------------------------------------------------------
    if (res_inicial and res_laudo) or (res_laudo and res_sentenca):
        elements.append(Spacer(1, 4*mm))
        tab_comp_hdr = Table(
            [[Paragraph("  RESUMO COMPARATIVO", s["secao"])]],
            colWidths=[PAGE_W - 2*MARGIN]
        )
        tab_comp_hdr.setStyle(TableStyle([
            ("BACKGROUND",(0,0),(-1,-1), AZUL_MEDIO),
            ("TOPPADDING",(0,0),(-1,-1), 6),
            ("BOTTOMPADDING",(0,0),(-1,-1), 6),
        ]))
        elements.append(tab_comp_hdr)
        elements.append(Spacer(1, 3*mm))

        def total_lista(lst):
            return sum(r.get("total", 0) for r in lst)

        comp_data = [
            ["Peca", "Total Atualizado (R$)"],
        ]
        if res_inicial:
            comp_data.append(["Peticao Inicial", _fmt_brl(total_lista(res_inicial))])
        if res_laudo:
            comp_data.append(["Laudo Pericial", _fmt_brl(total_lista(res_laudo))])
        if res_sentenca:
            comp_data.append(["Sentenca", _fmt_brl(total_lista(res_sentenca))])

        tab_comp = Table(comp_data, colWidths=[10*cm, 6*cm])
        tab_comp.setStyle(TableStyle([
            ("BACKGROUND",  (0,0),(-1,0), AZUL_MEDIO),
            ("TEXTCOLOR",   (0,0),(-1,0), BRANCO),
            ("FONTNAME",    (0,0),(-1,0), "Helvetica-Bold"),
            ("FONTSIZE",    (0,0),(-1,-1), 9),
            ("ALIGN",       (1,0),(-1,-1), "RIGHT"),
            ("ROWBACKGROUNDS",(0,1),(-1,-1), [BRANCO, CINZA_CLARO]),
            ("GRID",        (0,0),(-1,-1), 0.3, CINZA_LINHA),
        ]))
        elements.append(tab_comp)

    doc.build(elements, onFirstPage=_cabecalho_pagina, onLaterPages=_cabecalho_pagina)
    buf.seek(0)
    return buf.read()
