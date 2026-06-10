"""
Extrator de peças trabalhistas usando Claude API.
Quatro fluxos: inicial, cálculo liquidado, laudo pericial, sentença.
"""
from __future__ import annotations
import json
import re
import os

try:
    import anthropic
    ANTHROPIC_OK = True
except ImportError:
    ANTHROPIC_OK = False

# ──────────────────────────────────────────────────────────────────────────────
# SYSTEM PROMPT — regras que valem para todos os fluxos
# ──────────────────────────────────────────────────────────────────────────────
PROMPT_SISTEMA = """Você é um sistema especializado em extrair e calcular verbas trabalhistas
de documentos jurídicos brasileiros. Seu papel é ler o documento fornecido e retornar
os dados estruturados com precisão — sem inventar, sem omitir.

REGRAS GERAIS:
1. Extraia EXATAMENTE o que consta no documento. Não invente valores.
2. Para cada verba informe: nome exato, competência (mês/ano de origem), valor histórico,
   probabilidade de êxito (Provável/Possível/Remoto) e memória de cálculo.
3. INSS e IR: valores NEGATIVOS (são deduções do reclamante).
4. FGTS 8% + Multa 40%: positivos, são obrigações do empregador.
5. Competência = mês em que o débito nasceu (não a data do documento):
   - Saldo salário → mês da demissão
   - 13º → dezembro (ou mês da demissão se proporcional)
   - Férias → mês de início das férias ou da demissão
   - Adicionais → último mês do período apurado
   - Reflexos → mês do fato gerador (ex: férias sobre HE → mês das férias)
6. Se nada faltar, retorne "dados_faltantes": [].
7. Responda EXCLUSIVAMENTE com JSON válido, sem texto antes ou depois.

REGRAS DE CÁLCULO — ADICIONAIS:
A) INSALUBRIDADE:
   Base = SALÁRIO MÍNIMO FEDERAL do mês (nunca o salário do empregado).
   Graus: mínimo 10%, médio 20%, máximo 40%.
   SM de referência: 2018=R$954, 2019=R$998, 2020=R$1.045 (fev→R$1.045, jan/2020=R$1.039),
   2021=R$1.100, 2022=R$1.212, 2023=R$1.320, jan/2024=R$1.412, jan/2025=R$1.518.
   valor_hist = Σ (SM_mês × grau%) para cada mês do período.
   Reflexos: listar como verbas SEPARADAS (13º sobre insalubridade, férias+1/3 sobre insalubridade).

B) PERICULOSIDADE:
   Base = SALÁRIO BASE do empregado (nunca o salário mínimo). Percentual fixo: 30%.
   valor_hist = Σ (salário_mês × 0,30) para cada mês do período.
   Reflexos: listar como verbas SEPARADAS.

C) HORAS EXTRAS:
   Divisor: 220h (44h/sem), 180h (30h/sem) ou conforme especificado.
   Valor-hora = salário ÷ divisor. Adicional: 50% normais, 100% domingos/feriados.
   Calcule o total de horas do período × valor-hora com adicional.

D) PENSÃO MENSAL ART. 950 CC:
   NÃO inclua na lista "verbas" — preencha o campo "pensao_950" separado.
   O motor Python calculará automaticamente vencidas e vincendas.
   Exceção: se a sentença fixou valor exato (ex: "R$ 35.000") sem remeter à liquidação,
   coloque em "verbas" com esse valor fixo E pensao_950.ativo = false."""

# ──────────────────────────────────────────────────────────────────────────────
# Bloco JSON de pensao_950 — reutilizado em todos os prompts
# ──────────────────────────────────────────────────────────────────────────────
_PENSAO_950_JSON = """,
  "pensao_950": {{
    "ativo": true_ou_false,
    "salario_base": número_ou_null,
    "percentual_incapacidade": número_ou_null,
    "data_inicio": "MM/YYYY ou null",
    "data_nascimento": "MM/YYYY ou null",
    "expectativa_vida_anos": número_ou_null,
    "redutor": número_ou_0,
    "forma_pagamento": "parcela_unica ou mensal",
    "base_inclui_13": true_ou_false,
    "base_inclui_ferias": true_ou_false,
    "base_inclui_fgts": true_ou_false
  }}"""

# ──────────────────────────────────────────────────────────────────────────────
# FLUXO 1 — PETIÇÃO INICIAL
# ──────────────────────────────────────────────────────────────────────────────
PROMPT_INICIAL = """Analise esta PETIÇÃO INICIAL trabalhista e estime as verbas pleiteadas.

TEXTO DA PEÇA:
{texto}

DATA-BASE DO CÁLCULO: {data_base}

REGRAS:
1. Todas as verbas = "Possível" (sem decisão judicial ainda — CPC 25).
2. Se a petição tiver valor explícito por verba → use esse valor como valor_hist.
3. Se tiver valor da causa mas sem discriminação por verba → distribua proporcionalmente
   entre as verbas identificadas. Total deve aproximar o valor da causa.
4. Se houver dados suficientes (salário, período, jornada), CALCULE a estimativa.
5. Aplique as regras de cálculo de insalubridade, periculosidade e horas extras do sistema.

Retorne APENAS este JSON:
{{
  "tipo_peca": "inicial",
  "reclamante": "nome",
  "reclamado": "nome da empresa",
  "numero_processo": "número CNJ ou null",
  "admissao": "MM/YYYY ou null",
  "demissao": "MM/YYYY ou null",
  "salario_base": número_ou_null,
  "valor_da_causa": número_ou_null,
  "verbas": [
    {{
      "verba": "nome exato da verba",
      "competencia": "MM/YYYY",
      "valor_hist": número,
      "prob": "Possível",
      "memoria": "fórmula ou fonte do valor",
      "obs": "observação relevante"
    }}
  ],
  "observacoes_gerais": "alertas e inconsistências",
  "dados_faltantes": ["dados essenciais ausentes — vazio se nada faltar"]{pensao_950}
}}""".format(pensao_950=_PENSAO_950_JSON, texto="{texto}", data_base="{data_base}")

# ──────────────────────────────────────────────────────────────────────────────
# FLUXO 2 — CÁLCULO LIQUIDADO (PJCalc ou outro)
# ──────────────────────────────────────────────────────────────────────────────
PROMPT_CALCULO = """Analise este CÁLCULO TRABALHISTA LIQUIDADO e extraia cada verba para reatualização.

TEXTO DO CÁLCULO:
{texto}

DATA-BASE SOLICITADA: {data_base}

REGRAS CRÍTICAS:
1. Este é um cálculo já feito por perito/contador. EXTRAIA — não recalcule.
2. Para cada verba: nome, competência (origem), valor_hist = valor BRUTO HISTÓRICO.
   Se o PDF tiver coluna "Bruto Devido" ou "Histórico" → use esse valor.
   Se só tiver o total corrigido → use-o como valor_hist (o sistema recorrigirá).
3. Competência = mês de origem da verba (ver regras gerais do sistema).
4. Se uma verba tem múltiplos períodos → some os históricos, use o mês MAIS RECENTE.
5. Inclua TUDO: verbas principais, reflexos, FGTS, multa 40%, honorários.
6. Todas as verbas de cálculo liquidado = prob "Provável".
7. Em "observacoes_gerais": informe a data-base original do cálculo e o total original.
8. Se identificar pensão art. 950 com parâmetros calculáveis, preencha pensao_950.

Retorne APENAS este JSON:
{{
  "tipo_peca": "calculo",
  "reclamante": "nome",
  "reclamado": "nome da empresa",
  "numero_processo": "número CNJ ou null",
  "admissao": "MM/YYYY ou null",
  "demissao": "MM/YYYY ou null",
  "salario_base": número_ou_null,
  "data_base_original": "MM/YYYY ou null",
  "total_original": número_ou_null,
  "verbas": [
    {{
      "verba": "nome exato da verba",
      "competencia": "MM/YYYY",
      "valor_hist": número,
      "prob": "Provável",
      "memoria": "extraído do cálculo — coluna bruto/histórico",
      "obs": "observação se houver"
    }}
  ],
  "observacoes_gerais": "data-base original, total original, diferenças notadas",
  "dados_faltantes": []{pensao_950}
}}""".format(pensao_950=_PENSAO_950_JSON, texto="{texto}", data_base="{data_base}")

# ──────────────────────────────────────────────────────────────────────────────
# FLUXO 3 — LAUDO PERICIAL (médico, técnico, ergonômico)
# ──────────────────────────────────────────────────────────────────────────────
PROMPT_LAUDO = """Analise este LAUDO PERICIAL TRABALHISTA e a inicial fornecida.
Elabore o cálculo das verbas que o laudo CONFIRMA ou APURA.

TIPO DE LAUDO: pode ser médico (incapacidade), técnico (insalubridade/periculosidade)
ou ergonômico. Identifique o tipo e aplique as regras corretas.

{texto_inicial_bloco}

TEXTO DO LAUDO:
{texto_laudo}

DATA-BASE DO CÁLCULO: {data_base}
DATA DE AJUIZAMENTO: {data_ajuizamento}

REGRAS:
1. Laudo FAVORÁVEL ao reclamante (confirma pedidos) → verbas = "Provável".
2. Laudo DESFAVORÁVEL ao reclamante (nega pedidos) → verbas negadas = "Remoto".
   Verbas não abordadas pelo laudo → mantém da inicial como "Possível".
3. Para laudo MÉDICO: se confirmar incapacidade → preencher pensao_950 com os dados.
   % de incapacidade, data da alta ou ajuizamento, nascimento do reclamante.
4. Para laudo TÉCNICO de insalubridade: identificar grau (mínimo/médio/máximo = 10/20/40%),
   período e calcular com salário mínimo mensal (ver regras do sistema).
5. Para laudo TÉCNICO de periculosidade: confirmar 30% sobre salário, calcular período.
6. Use os dados da INICIAL (salário, período, jornada) para calcular os valores.
7. Verbas não calculáveis por falta de dados → valor_hist = 0 e explique em obs.

Retorne APENAS este JSON:
{{
  "tipo_peca": "laudo",
  "tipo_laudo": "medico|tecnico_insalubridade|tecnico_periculosidade|ergonomico|misto",
  "reclamante": "nome",
  "reclamado": "nome da empresa",
  "numero_processo": "número CNJ ou null",
  "admissao": "MM/YYYY ou null",
  "demissao": "MM/YYYY ou null",
  "salario_base": número_ou_null,
  "conclusao_laudo": "resumo da conclusão pericial em 1-2 frases",
  "verbas": [
    {{
      "verba": "nome da verba",
      "competencia": "MM/YYYY",
      "valor_hist": número,
      "prob": "Provável|Possível|Remoto",
      "deferido": true_ou_false_ou_null,
      "memoria": "como calculado com base no laudo",
      "obs": "observação"
    }}
  ],
  "observacoes_gerais": "alertas e pontos de atenção",
  "dados_faltantes": ["dados essenciais ausentes — vazio se nada faltar"]{pensao_950}
}}""".format(
    pensao_950=_PENSAO_950_JSON,
    texto_inicial_bloco="{texto_inicial_bloco}",
    texto_laudo="{texto_laudo}",
    data_base="{data_base}",
    data_ajuizamento="{data_ajuizamento}",
)

# ──────────────────────────────────────────────────────────────────────────────
# FLUXO 4 — SENTENÇA
# ──────────────────────────────────────────────────────────────────────────────
PROMPT_SENTENCA = """Analise esta SENTENÇA TRABALHISTA (e a inicial se fornecida).
Elabore a liquidação com todas as verbas DEFERIDAS e INDEFERIDAS.

REGRAS DE PROBABILIDADE (CPC 25):
- DEFERIDO na sentença → "Provável"
- INDEFERIDO na sentença → "Remoto"
- Em recurso / parcialmente deferido → "Possível"

{texto_inicial_bloco}

TEXTO DA SENTENÇA:
{texto_sentenca}

DATA-BASE DO CÁLCULO: {data_base}
DATA DE AJUIZAMENTO: {data_ajuizamento}

REGRAS:
1. Para cada verba deferida: calcule o valor histórico usando os dados do processo.
2. Aplique as regras específicas de insalubridade, periculosidade e horas extras.
3. Se a sentença mandar calcular em liquidação → estime com os dados disponíveis
   e anote em "memoria" que é estimativa pendente de liquidação.
4. Verbas indeferidas: inclua com valor_hist = 0 e prob = "Remoto" (controle de risco).
5. Se houver pensão art. 950 deferida → preencher pensao_950 com os parâmetros da sentença.

Retorne APENAS este JSON:
{{
  "tipo_peca": "sentenca",
  "reclamante": "nome",
  "reclamado": "nome da empresa",
  "numero_processo": "número CNJ ou null",
  "admissao": "MM/YYYY ou null",
  "demissao": "MM/YYYY ou null",
  "salario_base": número_ou_null,
  "verbas": [
    {{
      "verba": "nome da verba",
      "competencia": "MM/YYYY",
      "valor_hist": número,
      "prob": "Provável|Possível|Remoto",
      "deferido": true_ou_false_ou_null,
      "memoria": "como foi calculado ou extraído",
      "obs": "observação se houver"
    }}
  ],
  "observacoes_gerais": "alertas",
  "dados_faltantes": ["dados essenciais ausentes — vazio se nada faltar"]{pensao_950}
}}""".format(
    pensao_950=_PENSAO_950_JSON,
    texto_inicial_bloco="{texto_inicial_bloco}",
    texto_sentenca="{texto_sentenca}",
    data_base="{data_base}",
    data_ajuizamento="{data_ajuizamento}",
)


# ──────────────────────────────────────────────────────────────────────────────
# Função principal
# ──────────────────────────────────────────────────────────────────────────────
def extrair_com_ia(
    texto_principal: str,
    tipo_peca: str,
    data_base: str,
    data_ajuizamento: str = "",
    texto_inicial: str = "",
    api_key: str = None,
) -> dict:
    if not ANTHROPIC_OK:
        raise ImportError("anthropic não instalado. Execute: pip install anthropic")

    key = api_key or os.environ.get("ANTHROPIC_API_KEY", "")
    if not key:
        raise ValueError("ANTHROPIC_API_KEY não configurada.")

    def truncar(t, max_chars=60_000):
        return t[:max_chars] if len(t) > max_chars else t

    texto_inicial_bloco = ""
    if texto_inicial:
        texto_inicial_bloco = (
            f"TEXTO DA INICIAL (para contexto):\n{truncar(texto_inicial, 20_000)}\n"
        )

    if tipo_peca == "inicial":
        prompt = PROMPT_INICIAL.format(
            texto=truncar(texto_principal),
            data_base=data_base,
        )
    elif tipo_peca == "calculo":
        prompt = PROMPT_CALCULO.format(
            texto=truncar(texto_principal),
            data_base=data_base,
        )
    elif tipo_peca == "sentenca":
        prompt = PROMPT_SENTENCA.format(
            texto_inicial_bloco=texto_inicial_bloco,
            texto_sentenca=truncar(texto_principal),
            data_base=data_base,
            data_ajuizamento=data_ajuizamento or "não informado",
        )
    else:  # laudo
        prompt = PROMPT_LAUDO.format(
            texto_inicial_bloco=texto_inicial_bloco,
            texto_laudo=truncar(texto_principal),
            data_base=data_base,
            data_ajuizamento=data_ajuizamento or "não informado",
        )

    client = anthropic.Anthropic(api_key=key)
    response = client.messages.create(
        model="claude-opus-4-8",
        max_tokens=8096,
        thinking={"type": "adaptive"},
        system=PROMPT_SISTEMA,
        messages=[{"role": "user", "content": prompt}],
    )

    # Busca bloco de texto explicitamente (ignora blocos thinking)
    text_blocks = [b for b in response.content if getattr(b, "type", "") == "text"]
    if not text_blocks:
        raise ValueError("Resposta da IA não contém bloco de texto.")
    raw = text_blocks[-1].text.strip()
    return _parse_json(raw)


def _parse_json(raw: str) -> dict:
    raw = re.sub(r"```json\s*", "", raw)
    raw = re.sub(r"```\s*", "", raw).strip()
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        # Tenta extrair o maior objeto JSON do texto
        m = re.search(r"\{[\s\S]+\}", raw)
        if m:
            try:
                return json.loads(m.group(0))
            except json.JSONDecodeError:
                pass
        raise ValueError(f"Não foi possível interpretar resposta da IA. Trecho inicial: {raw[:200]}")


def resultado_para_verbas(resultado: dict, data_base: str) -> list[dict]:
    verbas = []
    for v in resultado.get("verbas", []):
        val = float(v.get("valor_hist", 0) or 0)
        if val == 0:
            continue
        verbas.append({
            "verba":      v.get("verba", ""),
            "competencia": v.get("competencia") or data_base,
            "valor_hist": val,
            "prob":       v.get("prob", "Possível"),
            "deferido":   v.get("deferido"),
            "memoria":    v.get("memoria", ""),
            "obs":        v.get("obs", ""),
        })

    # Para inicial: complementa com "Outros" se total < valor da causa
    valor_causa = float(resultado.get("valor_da_causa") or 0)
    tipo = resultado.get("tipo_peca", "")
    if tipo == "inicial" and valor_causa > 0:
        total_verbas = sum(v["valor_hist"] for v in verbas)
        diff = round(valor_causa - total_verbas, 2)
        if diff > valor_causa * 0.01:
            verbas.append({
                "verba": "Outros (a discriminar)",
                "competencia": data_base,
                "valor_hist": diff,
                "prob": "Possível",
                "deferido": None,
                "memoria": (
                    f"Diferença entre valor da causa (R$ {valor_causa:,.2f}) "
                    f"e verbas identificadas"
                ),
                "obs": "Verbas sem valor discriminado na petição — ajustar manualmente",
            })

    return verbas
