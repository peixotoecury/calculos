"""
Exportacao Excel profissional para calculos trabalhistas.
Layout: 1 aba por peca + Comparativo + Metodologia.
"""
from __future__ import annotations
import io
import datetime
from openpyxl import Workbook
from openpyxl.styles import (
    Font, PatternFill, Alignment, Border, Side, numbers
)
from openpyxl.utils import get_column_letter

# ---------------------------------------------------------------------------
# Cores LAWgico
# ---------------------------------------------------------------------------
COR_AZUL_ESCURO  = "001E36"
COR_AZUL_MEDIO   = "003B5C"
COR_AZUL_CLARO   = "00A9E0"
COR_BRANCO       = "FFFFFF"
COR_CINZA_CLARO  = "F0F5F9"
COR_CINZA_LINHA  = "E2EAF0"
COR_VERDE        = "1A7A4A"
COR_VERMELHO     = "C0392B"
COR_AMARELO      = "FFF3CD"


def _fill(hex_color: str) -> PatternFill:
    return PatternFill("solid", fgColor=hex_color)


def _font(bold=False, color="000000", size=10, italic=False):
    return Font(name="Calibri", bold=bold, color=color, size=size, italic=italic)


def _border(style="thin"):
    s = Side(style=style, color="C8D8E4")
    return Border(left=s, right=s, top=s, bottom=s)


def _alinhar(horizontal="left", vertical="center", wrap=False):
    return Alignment(horizontal=horizontal, vertical=vertical, wrap_text=wrap)


def _fmt_brl(v: float) -> str:
    return f"R$ {v:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def _cabecalho_sheet(ws, processo: dict, titulo: str, subtitulo: str = ""):
    """Cabecalho padrao com identidade visual LAWgico."""
    ws.merge_cells("A1:I1")
    c = ws["A1"]
    c.value = "LAWgico  ·  Calculos Trabalhistas  ·  Peixoto & Cury Advogados"
    c.font = _font(bold=True, color=COR_BRANCO, size=12)
    c.fill = _fill(COR_AZUL_ESCURO)
    c.alignment = _alinhar("center")
    ws.row_dimensions[1].height = 24

    ws.merge_cells("A2:I2")
    c2 = ws["A2"]
    c2.value = titulo
    c2.font = _font(bold=True, color=COR_BRANCO, size=11)
    c2.fill = _fill(COR_AZUL_MEDIO)
    c2.alignment = _alinhar("center")
    ws.row_dimensions[2].height = 20

    if subtitulo:
        ws.merge_cells("A3:I3")
        c3 = ws["A3"]
        c3.value = subtitulo
        c3.font = _font(italic=True, color=COR_AZUL_CLARO, size=9)
        c3.fill = _fill(COR_AZUL_ESCURO)
        c3.alignment = _alinhar("center")
        ws.row_dimensions[3].height = 16

    # Linha de info do processo
    row_info = 4 if subtitulo else 3
    ws.merge_cells(f"A{row_info}:I{row_info}")
    info_txt = (
        f"Processo: {processo.get('numero','-')}  |  "
        f"Reclamante: {processo.get('reclamante','-')}  |  "
        f"Reclamada: {processo.get('reclamada','-')}  |  "
        f"Data Base: {processo.get('data_base','-')}  |  "
        f"Gerado em: {datetime.datetime.now().strftime('%d/%m/%Y %H:%M')}"
    )
    ci = ws[f"A{row_info}"]
    ci.value = info_txt
    ci.font = _font(size=8, color="7A9BB5")
    ci.fill = _fill("001829")
    ci.alignment = _alinhar("center")
    ws.row_dimensions[row_info].height = 14

    return row_info + 2  # proxima linha livre


def _cabecalho_tabela(ws, row: int, colunas: list[str]):
    """Linha de cabecalho de tabela com estilo."""
    for col_i, col_name in enumerate(colunas, start=1):
        c = ws.cell(row=row, column=col_i, value=col_name)
        c.font = _font(bold=True, color=COR_BRANCO, size=9)
        c.fill = _fill(COR_AZUL_MEDIO)
        c.alignment = _alinhar("center")
        c.border = _border()
    ws.row_dimensions[row].height = 18
    return row + 1


def _linha_dados(ws, row: int, valores: list, destaque: bool = False):
    """Linha de dados com zebra."""
    fill_c = _fill(COR_CINZA_CLARO) if row % 2 == 0 else _fill(COR_BRANCO)
    if destaque:
        fill_c = _fill(COR_AMARELO)

    for col_i, val in enumerate(valores, start=1):
        c = ws.cell(row=row, column=col_i, value=val)
        c.fill = fill_c
        c.border = _border()
        c.font = _font(size=9, bold=destaque)
        # Alinhamento por tipo
        if isinstance(val, float):
            c.alignment = _alinhar("right")
            c.number_format = '#,##0.00'
        elif isinstance(val, str) and val.startswith("R$"):
            c.alignment = _alinhar("right")
        else:
            c.alignment = _alinhar("left")


def _linha_total(ws, row: int, valores: list):
    """Linha de total com destaque."""
    for col_i, val in enumerate(valores, start=1):
        c = ws.cell(row=row, column=col_i, value=val)
        c.fill = _fill(COR_AZUL_ESCURO)
        c.font = _font(bold=True, color=COR_BRANCO, size=9)
        c.border = _border()
        c.alignment = _alinhar("right" if isinstance(val, float) else "left")
        if isinstance(val, float):
            c.number_format = '#,##0.00'
    ws.row_dimensions[row].height = 16


def _ajustar_colunas(ws, larguras: list[int]):
    for i, w in enumerate(larguras, start=1):
        ws.column_dimensions[get_column_letter(i)].width = w


# ---------------------------------------------------------------------------
# Abas de verbas
# ---------------------------------------------------------------------------
COLS_PECA = [
    "#", "Verba", "Competencia", "Valor Historico (R$)",
    "Corr. Monetaria (R$)", "Juros Morat. (R$)",
    "Atualizacao SELIC (R$)", "Total Atualizado (R$)", "Obs."
]
LARG_PECA = [4, 30, 12, 18, 18, 16, 18, 18, 25]


def _aba_peca(wb: Workbook, nome_aba: str, titulo: str, processo: dict,
              resultados: list[dict], metodo_desc: str = ""):
    ws = wb.create_sheet(nome_aba)
    ws.sheet_view.showGridLines = False

    row = _cabecalho_sheet(ws, processo, titulo, metodo_desc)
    row = _cabecalho_tabela(ws, row, COLS_PECA)

    total_hist = total_cm = total_juros = total_selic = total_geral = 0.0

    for r in resultados:
        deferido = str(r.get("deferido", "-"))
        obs = r.get("obs", "")
        if deferido == "Nao":
            obs = "INDEFERIDO"

        vals = [
            r.get("seq", "-"),
            r.get("verba", ""),
            r.get("competencia", ""),
            r.get("valor_hist", 0.0),
            r.get("cm", 0.0),
            r.get("juros", 0.0),
            r.get("selic_pos", 0.0),
            r.get("total", 0.0),
            obs,
        ]
        destaque = (deferido == "Nao")
        _linha_dados(ws, row, vals, destaque)
        row += 1

        total_hist  += r.get("valor_hist", 0.0)
        total_cm    += r.get("cm", 0.0)
        total_juros += r.get("juros", 0.0)
        total_selic += r.get("selic_pos", 0.0)
        total_geral += r.get("total", 0.0)

    # Linha de total
    _linha_total(ws, row, [
        "", "TOTAL GERAL", "",
        round(total_hist, 2),
        round(total_cm, 2),
        round(total_juros, 2),
        round(total_selic, 2),
        round(total_geral, 2),
        ""
    ])

    _ajustar_colunas(ws, LARG_PECA)
    ws.freeze_panes = "A6"
    return ws


# ---------------------------------------------------------------------------
# Aba Comparativo
# ---------------------------------------------------------------------------
def _aba_comparativo(wb: Workbook, processo: dict,
                     res_inicial: list[dict], res_laudo: list[dict],
                     res_sentenca: list[dict]):
    ws = wb.create_sheet("Comparativo")
    ws.sheet_view.showGridLines = False

    row = _cabecalho_sheet(ws, processo, "COMPARATIVO - Inicial x Laudo x Sentenca")

    cols = ["Verba", "Inicial (R$)", "Laudo (R$)", "Sentenca (R$)", "Dif. Inicial-Laudo (R$)", "Dif. Laudo-Sentenca (R$)"]
    larg = [32, 18, 18, 18, 20, 20]
    row = _cabecalho_tabela(ws, row, cols)
    _ajustar_colunas(ws, larg)

    # Coleta todas as verbas
    todas_verbas: set[str] = set()
    for lista in (res_inicial, res_laudo, res_sentenca):
        for r in lista:
            todas_verbas.add(r.get("verba", ""))

    def total_por_verba(lista, verba):
        return sum(r.get("total", 0.0) for r in lista if r.get("verba") == verba)

    ti = tl = ts = 0.0
    for verba in sorted(todas_verbas):
        v_i = total_por_verba(res_inicial, verba)
        v_l = total_por_verba(res_laudo, verba)
        v_s = total_por_verba(res_sentenca, verba)
        d_il = v_l - v_i
        d_ls = v_s - v_l
        vals = [verba, v_i or None, v_l or None, v_s or None, d_il or None, d_ls or None]
        _linha_dados(ws, row, vals)
        # Colore diferencas
        if d_il > 0:
            ws.cell(row, 5).font = _font(color=COR_VERMELHO, bold=True, size=9)
        if d_il < 0:
            ws.cell(row, 5).font = _font(color=COR_VERDE, bold=True, size=9)
        ti += v_i; tl += v_l; ts += v_s
        row += 1

    _linha_total(ws, row, [
        "TOTAL",
        round(ti, 2), round(tl, 2), round(ts, 2),
        round(tl - ti, 2), round(ts - tl, 2)
    ])

    ws.freeze_panes = "A6"


# ---------------------------------------------------------------------------
# Aba Metodologia
# ---------------------------------------------------------------------------
def _aba_metodologia(wb: Workbook, processo: dict, metodo: str):
    ws = wb.create_sheet("Metodologia")
    ws.sheet_view.showGridLines = False

    row = _cabecalho_sheet(ws, processo, "METODOLOGIA E CRITERIOS DE CALCULO")
    ws.column_dimensions["A"].width = 20
    ws.column_dimensions["B"].width = 70
    ws.merge_cells(f"A{row}:B{row}")

    def secao(titulo, row):
        ws.merge_cells(f"A{row}:B{row}")
        c = ws.cell(row=row, column=1, value=titulo)
        c.font = _font(bold=True, color=COR_BRANCO, size=10)
        c.fill = _fill(COR_AZUL_MEDIO)
        c.alignment = _alinhar("left")
        ws.row_dimensions[row].height = 18
        return row + 1

    def info(label, valor, row):
        ws.cell(row=row, column=1, value=label).font = _font(bold=True, size=9, color=COR_AZUL_ESCURO)
        ws.cell(row=row, column=1).fill = _fill(COR_CINZA_CLARO)
        ws.cell(row=row, column=2, value=valor).font = _font(size=9)
        ws.cell(row=row, column=2).alignment = _alinhar(wrap=True)
        ws.row_dimensions[row].height = 30
        return row + 1

    row = secao("IDENTIFICACAO DO PROCESSO", row)
    row = info("Numero",      processo.get("numero", "-"), row)
    row = info("Reclamante",  processo.get("reclamante", "-"), row)
    row = info("Reclamada",   processo.get("reclamada", "-"), row)
    row = info("Vara/TRT",    processo.get("vara", "-"), row)
    row = info("Data Base",   processo.get("data_base", "-"), row)
    row += 1

    row = secao("LEGISLACAO E JURISPRUDENCIA APLICADA", row)
    row = info("ADC 58 STF",  "Julgada em 18/11/2021. Fixou o IPCA-E (judicial) ate out/2021 e a SELIC de nov/2021 em diante como unico indice de correcao monetaria e juros na Justica do Trabalho.", row)
    row = info("Art. 879 CLT","Base legal para atualizacao de creditos trabalhistas.", row)
    row = info("TST - Instrucao Normativa 41/2018", "Regras de transicao para contratos pre e pos-reforma trabalhista.", row)
    row += 1

    row = secao("INDICES APLICADOS", row)
    if metodo == "SELIC_ADC58":
        row = info("Fase 1 - Correcao", "IPCA-E (variacao mensal, IBGE/BCB serie 10764) - Competencia ate outubro/2021", row)
        row = info("Fase 1 - Juros",    "1% ao mes simples sobre o valor HISTORICO - nao composto e nao sobre corrigido", row)
        row = info("Fase 2 - SELIC",    "Taxa SELIC acumulada mensal (BCB serie 4390) - novembro/2021 ate data base. Engloba correcao e juros.", row)
        row = info("Corte ADC 58",      "Novembro/2021 (novembro inclusive para SELIC)", row)
    elif metodo == "IPCAE_1PCT":
        row = info("Correcao Monetaria", "IPCA-E (variacao mensal, IBGE/BCB serie 10764) - Competencia ate data base", row)
        row = info("Juros de Mora",      "1% ao mes simples sobre o valor historico", row)
    else:
        row = info("Indice", "Sem correcao aplicada", row)
    row += 1

    row = secao("FORMULA DE CALCULO - FASE 1 (pre-ADC58)", row)
    row = info("Correcao CM",  "Valor_Hist x (Fator_IPCA_E - 1)", row)
    row = info("Juros",        "Valor_Hist x 0,01 x N_meses", row)
    row = info("Subtotal F1",  "Valor_Hist + CM + Juros", row)
    row += 1

    row = secao("FORMULA DE CALCULO - FASE 2 (pos-ADC58)", row)
    row = info("SELIC",        "Subtotal_F1 x (Fator_SELIC - 1)", row)
    row = info("Total Final",  "Subtotal_F1 x Fator_SELIC", row)
    row += 1

    row = secao("FONTE DOS INDICES", row)
    row = info("IPCA-E",  "IBGE via BCB SGS serie 10764 | api.bcb.gov.br", row)
    row = info("SELIC",   "Banco Central do Brasil SGS serie 4390 | api.bcb.gov.br", row)
    row = info("Tabela",  "Valores embutidos ate mai/2026 com atualizacao automatica via API", row)
    row += 1

    row = secao("OBSERVACOES", row)
    row = info("Responsabilidade", "Os calculos apresentados sao estimativas pela Reclamada para fins de estrategia processual. Nao substituem o laudo pericial oficial.", row)
    row = info("Auditoria",        "Todos os fatores e meses utilizados sao rastreados nas colunas de calculo.", row)


# ---------------------------------------------------------------------------
# Funcao principal
# ---------------------------------------------------------------------------
def gerar_excel(
    processo: dict,
    res_inicial: list[dict],
    res_laudo: list[dict],
    res_sentenca: list[dict],
    metodo: str = "SELIC_ADC58",
) -> bytes:
    """Gera o workbook Excel e retorna os bytes."""
    wb = Workbook()
    # Remove aba padrao
    if "Sheet" in wb.sheetnames:
        del wb["Sheet"]

    metodo_desc = {
        "SELIC_ADC58":   "IPCA-E + 1% a.m. (pre-ADC58) | SELIC acumulada (pos-ADC58) — ADC 58 STF 18/11/2021",
        "IPCAE_1PCT":    "IPCA-E + 1% a.m. simples — todo o periodo",
        "SEM_CORRECAO":  "Sem correcao monetaria",
    }.get(metodo, metodo)

    if res_inicial:
        _aba_peca(wb, "Inicial", "PETICAO INICIAL — Valores Pleiteados", processo, res_inicial, metodo_desc)
    if res_laudo:
        _aba_peca(wb, "Laudo Pericial", "LAUDO PERICIAL — Apuracao do Perito", processo, res_laudo, metodo_desc)
    if res_sentenca:
        _aba_peca(wb, "Sentenca", "SENTENCA — Valores Deferidos", processo, res_sentenca, metodo_desc)

    if res_inicial or res_laudo or res_sentenca:
        _aba_comparativo(wb, processo, res_inicial or [], res_laudo or [], res_sentenca or [])

    _aba_metodologia(wb, processo, metodo)

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf.read()
