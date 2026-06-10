"""
Calculador de pensão por incapacidade laboral — Art. 950 CC.
Suporta parcela única (parágrafo único) com redutor e pagamento mensal.
Distingue parcelas vencidas (já devidas) e vincendas (futuras).
"""
from __future__ import annotations
import datetime

# Esperança de vida ao nascer — IBGE tábua de mortalidade (ano da tabela publicada)
IBGE_EXPECTATIVA = {
    2026: 76.2,
    2025: 76.2,
    2024: 75.5,   # IBGE 2023, conforme sentença Marcos Vinicius vs Bridgestone
    2023: 76.0,   # IBGE 2022, conforme sentença Adriano vs Bridgestone
    2022: 76.0,
    2021: 76.0,
    2020: 75.9,
    2019: 76.6,
    2018: 76.3,
    2017: 75.8,
    2016: 75.7,
    2015: 75.5,
}


def expectativa_ibge(ano: int) -> float:
    """Retorna a esperança de vida ao nascer (IBGE) para o ano dado."""
    if ano in IBGE_EXPECTATIVA:
        return IBGE_EXPECTATIVA[ano]
    chave = max((k for k in IBGE_EXPECTATIVA if k <= ano), default=max(IBGE_EXPECTATIVA))
    return IBGE_EXPECTATIVA[chave]


def _parse_date(s) -> datetime.date | None:
    """Aceita 'MM/YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD' ou datetime.date."""
    if s is None:
        return None
    if isinstance(s, datetime.date):
        return s
    s = str(s).strip()
    for fmt in ("%d/%m/%Y", "%m/%Y", "%Y-%m-%d"):
        try:
            d = datetime.datetime.strptime(s, fmt).date()
            return d.replace(day=1) if fmt == "%m/%Y" else d
        except ValueError:
            pass
    return None


def _meses_entre(d1: datetime.date, d2: datetime.date) -> int:
    """Meses completos de d1 até d2 (resultado >= 0)."""
    return max(0, (d2.year - d1.year) * 12 + (d2.month - d1.month))


def _adicionar_meses(d: datetime.date, meses: int) -> datetime.date:
    ano = d.year + (d.month + meses - 1) // 12
    mes = (d.month + meses - 1) % 12 + 1
    try:
        return d.replace(year=ano, month=mes)
    except ValueError:
        return d.replace(year=ano, month=mes, day=28)


def calcular_pensao_950(
    salario_base: float,
    percentual_incapacidade: float,
    data_inicio: str | datetime.date,
    data_nascimento: str | datetime.date,
    expectativa_vida_anos: float | None = None,
    ano_ibge: int | None = None,
    redutor: float = 0.0,
    forma_pagamento: str = "parcela_unica",
    data_base: str | datetime.date | None = None,
) -> dict:
    """
    Calcula pensão mensal por incapacidade laboral (art. 950 CC).

    Parâmetros:
        salario_base              Salário base de cálculo (remuneração mensal conforme sentença)
        percentual_incapacidade   Percentual de redução da capacidade (ex: 33.85 para 33,85%)
        data_inicio               Marco inicial da pensão (ajuizamento ou alta previdenciária)
        data_nascimento           Nascimento do reclamante
        expectativa_vida_anos     Expectativa total de vida em anos (ex: 76, 75.5)
                                  Se None, usa tabela IBGE conforme ano
        ano_ibge                  Ano da tabela IBGE a usar (usa ano atual se None)
        redutor                   Desconto para antecipação em parcela única (ex: 30 para 30%)
        forma_pagamento           "parcela_unica" ou "mensal"
        data_base                 Data de referência para cálculo de vencidas/vincendas
                                  (padrão: hoje)

    Retorna dict com:
        pensao_mensal             Valor da prestação mensal
        data_inicio               Data de início formatada
        data_limite               Data limite da pensão (nascimento + expectativa)
        expectativa_vida_anos     Expectativa utilizada
        meses_totais              Total de meses da pensão
        meses_vencidos            Meses já devidos (data_inicio → data_base)
        meses_vincendos           Meses futuros (data_base → data_limite)
        total_vencido_bruto       Vencidas sem redutor
        total_vincendo_bruto      Vincendas sem redutor
        total_bruto               Total sem redutor (= mensal × meses_totais)
        redutor_pct               Percentual do redutor
        total_com_redutor         Total com redutor aplicado (valor da parcela única)
        valor_causa_292           Art. 292 §2º CPC: vencidas + 12 vincendas
        forma_pagamento           "parcela_unica" ou "mensal"
    """
    di = _parse_date(data_inicio)
    dn = _parse_date(data_nascimento)
    hoje = _parse_date(data_base) or datetime.date.today()

    if not di:
        raise ValueError(f"data_inicio inválida: {data_inicio!r}")
    if not dn:
        raise ValueError(f"data_nascimento inválida: {data_nascimento!r}")
    if salario_base <= 0:
        raise ValueError("salario_base deve ser maior que zero")
    if not (0 < percentual_incapacidade <= 100):
        raise ValueError("percentual_incapacidade deve estar entre 0 e 100")

    # Expectativa de vida
    if expectativa_vida_anos is None:
        expectativa_vida_anos = expectativa_ibge(ano_ibge or hoje.year)

    # Data limite: nascimento + expectativa (anos + fração em meses)
    anos_int = int(expectativa_vida_anos)
    meses_frac = round((expectativa_vida_anos - anos_int) * 12)
    data_limite = _adicionar_meses(
        _adicionar_meses(dn, anos_int * 12),
        meses_frac
    )

    if di >= data_limite:
        raise ValueError(
            f"data_inicio ({di.strftime('%d/%m/%Y')}) é posterior à data_limite "
            f"({data_limite.strftime('%d/%m/%Y')}). Verifique a expectativa de vida."
        )

    # Contagem de meses
    meses_totais   = _meses_entre(di, data_limite)
    ref_venc       = min(hoje, data_limite)
    meses_vencidos = _meses_entre(di, ref_venc)
    meses_vincendos = max(0, meses_totais - meses_vencidos)

    # Pensão mensal
    pensao_mensal = round(salario_base * percentual_incapacidade / 100, 2)

    # Totais
    total_vencido_bruto  = round(pensao_mensal * meses_vencidos, 2)
    total_vincendo_bruto = round(pensao_mensal * meses_vincendos, 2)
    total_bruto          = round(pensao_mensal * meses_totais, 2)
    total_com_redutor    = round(total_bruto * (1 - redutor / 100), 2)

    # Art. 292 §2º CPC — valor da causa estimado
    valor_causa_292 = round(pensao_mensal * (meses_vencidos + 12), 2)

    return {
        "pensao_mensal":           pensao_mensal,
        "salario_base":            salario_base,
        "percentual_incapacidade": percentual_incapacidade,
        "data_inicio":             di.strftime("%d/%m/%Y"),
        "data_limite":             data_limite.strftime("%d/%m/%Y"),
        "expectativa_vida_anos":   expectativa_vida_anos,
        "meses_totais":            meses_totais,
        "meses_vencidos":          meses_vencidos,
        "meses_vincendos":         meses_vincendos,
        "total_vencido_bruto":     total_vencido_bruto,
        "total_vincendo_bruto":    total_vincendo_bruto,
        "total_bruto":             total_bruto,
        "redutor_pct":             redutor,
        "total_com_redutor":       total_com_redutor,
        "valor_causa_292":         valor_causa_292,
        "forma_pagamento":         forma_pagamento,
    }
