"""
Motor de encargos trabalhistas completo.
FGTS, Multa 40%, INSS Segurado, INSS Empresa, SAT, Honorários, IR (RRA).
"""
from __future__ import annotations

# ---------------------------------------------------------------------------
# Tabelas vigentes 2025/2026
# ---------------------------------------------------------------------------

# INSS Segurado — tabela progressiva 2025 (alíquotas efetivas)
INSS_FAIXAS_2025 = [
    (1518.00,  0.075),
    (2793.88,  0.090),
    (4190.83,  0.120),
    (8157.41,  0.140),
]
INSS_TETO_2025 = 8157.41

# IR — tabela progressiva mensal 2025
IR_FAIXAS_2025 = [
    (2259.20,  0.000, 0.00),
    (2826.65,  0.075, 169.44),
    (3751.05,  0.150, 381.44),
    (4664.68,  0.225, 662.77),
    (float('inf'), 0.275, 896.00),
]

# Verbas que têm incidência de FGTS
VERBAS_COM_FGTS = {
    "horas extras", "adicional noturno", "adicional de insalubridade",
    "adicional de periculosidade", "adicional de insalubridade 20%",
    "adicional de insalubridade 40%", "saldo salário", "saldo de salário",
    "aviso prévio", "férias", "férias + 1/3", "férias proporcionais",
    "férias indenizadas", "13º salário", "13o salário", "décimo terceiro",
    "dsr", "reflexos em dsr", "diferenças salariais", "equiparação salarial",
    "comissões", "plr", "participação nos lucros", "gratificação",
    "intervalo intrajornada", "horas in itinere", "acúmulo de função",
    "adicional de transferência", "salários atrasados", "rescisão indireta",
    "multa art. 477", "vale transporte", "vale alimentação",
}

# Verbas que NÃO têm FGTS nem INSS (indenizatórias)
VERBAS_INDENIZATORIAS = {
    "danos morais", "dano moral", "indenização por dano moral",
    "danos materiais", "dano material", "indenização por dano material",
    "pensão vitalícia", "indenização", "indenização por dispensa",
    "multa art. 467", "honorários periciais", "seguro desemprego",
}


def _verba_tem_fgts(nome_verba: str) -> bool:
    v = nome_verba.lower().strip()
    for k in VERBAS_COM_FGTS:
        if k in v:
            return True
    for k in VERBAS_INDENIZATORIAS:
        if k in v:
            return False
    # padrão conservador: se contém palavras de verba salarial, tem FGTS
    return any(p in v for p in ["hora", "salári", "fgts", "adicional", "férias",
                                  "aviso", "13", "dsr", "reflexo", "comiss"])


def _verba_tem_inss(nome_verba: str) -> bool:
    v = nome_verba.lower().strip()
    for k in VERBAS_INDENIZATORIAS:
        if k in v:
            return False
    return True


def calcular_inss_segurado(base: float, ano: int = 2025) -> float:
    """
    INSS segurado pela tabela progressiva 2025.
    Limita ao teto de R$ 8.157,41.
    """
    if base <= 0:
        return 0.0
    base = min(base, INSS_TETO_2025)
    inss = 0.0
    anterior = 0.0
    for teto, aliq in INSS_FAIXAS_2025:
        if base <= teto:
            inss += (base - anterior) * aliq
            break
        inss += (teto - anterior) * aliq
        anterior = teto
    return round(inss, 2)


def calcular_ir_rra(base_verbas: float, n_meses: int) -> float:
    """
    Imposto de Renda pelo método RRA (Rendimentos Recebidos Acumuladamente).
    Art. 12-A da Lei 7.713/1988 — tabela progressiva acumulada.
    base_verbas: total de verbas tributáveis (já descontado INSS)
    n_meses: número de meses do período
    """
    if base_verbas <= 0 or n_meses <= 0:
        return 0.0

    media = base_verbas / max(n_meses, 1)

    # Aplica tabela na média mensal
    ir_mensal = 0.0
    for limite, aliq, deducao in IR_FAIXAS_2025:
        if media <= limite:
            ir_mensal = media * aliq - deducao
            break

    ir_mensal = max(ir_mensal, 0.0)
    ir_total = ir_mensal * n_meses
    return round(ir_total, 2)


def calcular_encargos_completo(
    verbas_calculadas: list[dict],
    n_meses: int = 1,
    perc_honorarios: float = 0.10,
    aliq_sat: float = 0.03,
) -> dict:
    """
    Calcula todos os encargos sobre a lista de verbas já atualizadas.

    verbas_calculadas: saída de calcular_lista() com campo 'total' e 'verba'
    n_meses: meses do período contratual (para IR RRA)
    perc_honorarios: percentual de honorários (padrão 10%)
    aliq_sat: alíquota SAT (1%, 2% ou 3%, padrão 3%)

    Retorna dict com todo o quadro financeiro.
    """
    total_verbas = 0.0
    total_fgts_base = 0.0
    total_inss_base = 0.0

    verbas_detalhe = []
    for v in verbas_calculadas:
        nome = v.get("verba", "")
        total_v = float(v.get("total", 0) or 0)
        hist_v  = float(v.get("valor_hist", 0) or 0)

        if total_v <= 0 or hist_v < 0:  # ignora deduções
            continue

        tem_fgts = _verba_tem_fgts(nome)
        tem_inss = _verba_tem_inss(nome)

        total_verbas += total_v
        if tem_fgts:
            total_fgts_base += total_v
        if tem_inss:
            total_inss_base += total_v

        verbas_detalhe.append({
            "verba": nome,
            "total": total_v,
            "tem_fgts": tem_fgts,
            "tem_inss": tem_inss,
        })

    # FGTS 8%
    fgts_devido = round(total_fgts_base * 0.08, 2)
    multa_fgts_40 = round(fgts_devido * 0.40, 2)
    total_fgts = round(fgts_devido + multa_fgts_40, 2)

    # Bruto devido ao reclamante
    bruto = round(total_verbas + fgts_devido, 2)

    # INSS Segurado (desconto do reclamante)
    inss_segurado = calcular_inss_segurado(total_inss_base / max(n_meses, 1)) * n_meses
    inss_segurado = round(inss_segurado, 2)

    # IR RRA
    base_ir = max(total_inss_base - inss_segurado, 0)
    ir_devido = calcular_ir_rra(base_ir, n_meses)

    # Líquido ao reclamante
    liquido_reclamante = round(bruto - fgts_devido - inss_segurado - ir_devido, 2)

    # INSS Empresa (20%) + SAT
    inss_empresa = round(total_inss_base * 0.20, 2)
    sat = round(total_inss_base * aliq_sat, 2)
    total_inss_empresa = round(inss_empresa + sat, 2)

    # Honorários
    honorarios = round(bruto * perc_honorarios, 2)

    # Total devido pelo reclamado
    total_reclamado = round(
        liquido_reclamante + fgts_devido + multa_fgts_40 +
        total_inss_empresa + honorarios, 2
    )

    return {
        # Verbas
        "total_verbas": total_verbas,
        "fgts_devido": fgts_devido,
        "multa_fgts_40": multa_fgts_40,
        "total_fgts": total_fgts,
        "bruto": bruto,

        # Descontos do reclamante
        "inss_segurado": inss_segurado,
        "ir_devido": ir_devido,
        "liquido_reclamante": liquido_reclamante,

        # Encargos do reclamado
        "inss_empresa": inss_empresa,
        "sat": sat,
        "total_inss_empresa": total_inss_empresa,
        "honorarios": honorarios,
        "perc_honorarios": perc_honorarios,

        # Total final
        "total_reclamado": total_reclamado,

        # Bases auxiliares
        "base_fgts": total_fgts_base,
        "base_inss": total_inss_base,
        "n_meses": n_meses,
    }
