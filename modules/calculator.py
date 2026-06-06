"""
Motor de calculo trabalhista pos-ADC 58 (STF, 18/11/2021).

Regras aplicadas:
  - Fase 1 (competencia ate out/2021): IPCA-E + juros 1% a.m. simples sobre valor historico
  - Fase 2 (nov/2021 em diante):   SELIC acumulada (engloba CM e juros)

Metodo alternativo configuravel:
  - 'SELIC_ADC58'  : regra pos-ADC58 descrita acima (padrao)
  - 'IPCAE_1PCT'   : IPCA-E + 1% a.m. para todo o periodo (pre-ADC58)
  - 'SEM_CORRECAO' : retorna apenas valor historico
"""
from __future__ import annotations
import datetime
from .indices import get_indices, get_fator_acumulado, contar_meses, _ym

# Corte ADC 58 STF - novembro/2021
ADC58_YM = "2021-11"


def _ym_from_str(s: str) -> str:
    """Aceita 'MM/YYYY' ou 'YYYY-MM' e retorna 'YYYY-MM'."""
    s = str(s).strip()
    if "/" in s and len(s) == 7:            # MM/YYYY
        m, y = s.split("/")
        return f"{y}-{m.zfill(2)}"
    if "-" in s and len(s) == 7:            # YYYY-MM
        return s
    if "/" in s and len(s) >= 8:            # DD/MM/YYYY
        parts = s.split("/")
        return f"{parts[2]}-{parts[1].zfill(2)}"
    return s[:7]


def calcular_verba(
    valor_hist: float,
    competencia: str,          # 'MM/YYYY' ou 'YYYY-MM'
    data_base: str,            # 'MM/YYYY' ou 'YYYY-MM' (mes do calculo)
    metodo: str = "SELIC_ADC58",
    ipca_e: dict = None,
    selic: dict = None,
) -> dict:
    """
    Calcula correcao monetaria e juros de uma verba trabalhista.

    Retorna dict com:
      valor_hist, cm, juros, selic_pos, total, fator_cm, fator_selic,
      n_meses_fase1, n_meses_fase2, metodo_desc
    """
    if ipca_e is None or selic is None:
        ipca_e, selic, _ = get_indices()

    ym_comp = _ym_from_str(competencia)
    ym_base = _ym_from_str(data_base)

    if metodo == "SEM_CORRECAO":
        return {
            "valor_hist": valor_hist,
            "cm": 0.0,
            "juros": 0.0,
            "selic_pos": 0.0,
            "total": valor_hist,
            "fator_cm": 1.0,
            "fator_selic": 1.0,
            "n_meses_fase1": 0,
            "n_meses_fase2": 0,
            "metodo_desc": "Sem correcao",
        }

    if metodo == "IPCAE_1PCT":
        # IPCA-E + 1% a.m. simples para todo o periodo
        n = contar_meses(ym_comp, ym_base)
        fator_cm = get_fator_acumulado(ipca_e, ym_comp, ym_base)
        cm = valor_hist * (fator_cm - 1)
        juros = valor_hist * 0.01 * n
        total = valor_hist + cm + juros
        return {
            "valor_hist": valor_hist,
            "cm": cm,
            "juros": juros,
            "selic_pos": 0.0,
            "total": total,
            "fator_cm": fator_cm,
            "fator_selic": 1.0,
            "n_meses_fase1": n,
            "n_meses_fase2": 0,
            "metodo_desc": "IPCA-E + 1% a.m. simples",
        }

    # ---- Metodo padrao: SELIC_ADC58 ----------------------------------------
    # Fase 1: competencia -> out/2021 (se aplicavel)
    cm = 0.0
    juros = 0.0
    fator_cm = 1.0
    n_fase1 = 0

    if ym_comp <= ADC58_YM:
        ym_fim_f1 = min(ym_base, ADC58_YM)  # ate out/2021 ou data_base se anterior
        # Correcao IPCA-E
        fator_cm = get_fator_acumulado(ipca_e, ym_comp, ym_fim_f1)
        cm = valor_hist * (fator_cm - 1)
        # Juros simples: 1% sobre valor HISTORICO (nao sobre corrigido)
        n_fase1 = contar_meses(ym_comp, ym_fim_f1)
        juros = valor_hist * 0.01 * n_fase1

    # Valor ao final da fase 1
    valor_f1 = valor_hist + cm + juros

    # Fase 2: nov/2021 -> data_base (se aplicavel)
    selic_pos = 0.0
    fator_selic = 1.0
    n_fase2 = 0

    ym_inicio_f2 = ADC58_YM  # nov/2021
    if ym_base > ADC58_YM:
        # Se competencia e posterior ao ADC58, fase 2 comeca na propria competencia
        ym_inicio_f2 = max(ym_comp, ADC58_YM)
        fator_selic = get_fator_acumulado(selic, ym_inicio_f2, ym_base)
        n_fase2 = contar_meses(ym_inicio_f2, ym_base)
        if ym_comp > ADC58_YM:
            # Completamente na fase 2 - nao houve fase 1
            selic_pos = valor_hist * (fator_selic - 1)
            total = valor_hist * fator_selic
        else:
            # Misto: aplica SELIC sobre o resultado da fase 1
            total = valor_f1 * fator_selic
            selic_pos = total - valor_f1
    else:
        total = valor_f1

    return {
        "valor_hist": round(valor_hist, 2),
        "cm": round(cm, 2),
        "juros": round(juros, 2),
        "selic_pos": round(selic_pos, 2),
        "total": round(total, 2),
        "fator_cm": round(fator_cm, 6),
        "fator_selic": round(fator_selic, 6),
        "n_meses_fase1": n_fase1,
        "n_meses_fase2": n_fase2,
        "metodo_desc": "IPCA-E + 1% a.m. (pre-ADC58) | SELIC acumulada (pos-ADC58)",
    }


def _parse_valor_flex(v) -> float:
    """Converte valor para float de forma robusta (float/int direto ou string BR)."""
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).replace("R$", "").strip()
    # Formato BR com separador de milhar: "15.000,00" -> remove ponto, troca virgula
    if "," in s:
        s = s.replace(".", "").replace(",", ".")
    else:
        # Apenas ponto decimal: "15000.50" ou sem decimais
        s = s.replace(",", "")
    try:
        return float(s)
    except Exception:
        return 0.0


def calcular_lista(verbas: list[dict], data_base: str, metodo: str = "SELIC_ADC58") -> list[dict]:
    """
    Calcula uma lista de verbas.
    Cada verba deve ter: 'verba', 'valor_hist', 'competencia'.
    Retorna lista com todos os campos de calculo adicionados.
    """
    ipca_e, selic, _ = get_indices()
    resultados = []
    for i, v in enumerate(verbas):
        val = _parse_valor_flex(v.get("valor_hist", 0))
        comp = str(v.get("competencia", "01/2020"))
        resultado = calcular_verba(val, comp, data_base, metodo, ipca_e, selic)
        row = {**v, **resultado, "seq": i + 1}
        resultados.append(row)
    return resultados


def totalizar(resultados: list[dict]) -> dict:
    """Soma todos os campos numericos da lista."""
    totais = {
        "verba": "TOTAL GERAL",
        "valor_hist": 0.0,
        "cm": 0.0,
        "juros": 0.0,
        "selic_pos": 0.0,
        "total": 0.0,
    }
    for r in resultados:
        for campo in ("valor_hist", "cm", "juros", "selic_pos", "total"):
            totais[campo] += r.get(campo, 0.0)
    for campo in ("valor_hist", "cm", "juros", "selic_pos", "total"):
        totais[campo] = round(totais[campo], 2)
    return totais


def formatar_brl(v: float) -> str:
    """Formata valor em R$ brasileiro."""
    try:
        return f"R$ {v:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    except Exception:
        return str(v)
