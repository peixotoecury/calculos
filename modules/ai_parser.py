"""
Parser inteligente de peças trabalhistas usando Claude API.
Age como contador sênior — elabora o cálculo completo por verba.
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

PROMPT_SISTEMA = """Você é um contador sênior com 20 anos de experiência em perícias contábeis
e liquidações de sentença trabalhista no Brasil. Você elabora cálculos completos como um
expert judicial faria — não apenas extrai valores, mas CALCULA cada verba do zero quando
necessário, aplica reflexos, deduções e classifica o risco processual.

Regras obrigatórias:
1. Para INICIAL: leia os pedidos e estime os valores pleiteados. Classifique o risco de cada
   verba como Possível (risco alto para o réu), Provável (mais que 50% de chance) ou Remoto.
2. Para SENTENÇA (precisa da inicial): identifique exatamente o que foi DEFERIDO e INDEFERIDO.
   Use os valores da sentença. Deferido = Provável. Indeferido = Remoto. Em recurso = Possível.
3. Para LAUDO PERICIAL (precisa da inicial): use os valores apurados pelo perito.
   Verbas do perito favoráveis ao reclamante = Provável.
4. Calcule CM e juros APENAS com os campos fornecidos (competencia e data_base).
   O motor de cálculo externo fará a matemática — você fornece os dados corretos.
5. Para cada verba informe a competência (mês/ano de origem do débito).
6. INSS e IR: valores NEGATIVOS (são deduções do reclamante).
7. FGTS + multa 40%: obrigação do empregador, valor POSITIVO.
8. Nunca invente valores. Se não encontrar, coloque 0.
9. Em observacoes_gerais: aponte inconsistências, pedidos sem valor, alertas jurídicos.
10. DADOS FALTANTES: se algum dado essencial não constar nos documentos, preencha o campo
    "dados_faltantes" com lista de strings descrevendo o que falta. Exemplos:
    - "Salário base não informado — necessário para calcular horas extras, divisor e reflexos"
    - "Data de admissão não encontrada — necessária para calcular prescrição e períodos"
    - "Holerites não anexados — necessários para apurar valores pagos e deduções"
    Se nada faltar, retorne "dados_faltantes": [].

Responda EXCLUSIVAMENTE com JSON válido, sem texto antes ou depois."""

PROMPT_INICIAL = """Analise esta PETIÇÃO INICIAL trabalhista e elabore a tabela completa de verbas pleiteadas.

TEXTO DA PEÇA:
{texto}

DATA-BASE DO CÁLCULO: {data_base}

REGRAS CRÍTICAS PARA INICIAL:
1. TODAS as verbas devem ter prob = "Possível" — fase inicial, sem decisão (CPC 25)
2. Extraia CADA verba individualmente com seu valor pleiteado
3. Se a petição tem valor explícito por verba → use esse valor
4. Se a petição tem VALOR DA CAUSA mas NÃO discrimina por verba:
   - Use o valor da causa como valor_hist da primeira verba (ou distribua entre as verbas)
   - NÃO deixe todas as verbas com R$ 0 — o total deve se aproximar do valor da causa
5. Se há cálculo implícito na petição (ex: "55 horas × R$ 13,18 × 111 dias"), CALCULE e use o resultado
6. Para verbas sem valor algum mas com dados suficientes (salário, período, jornada), estime
7. O TOTAL de valor_hist de todas as verbas DEVE ser próximo ao valor da causa declarado
8. Se não conseguir estimar uma verba, coloque valor_hist = 0 e explique em obs
9. Competência = mês de encerramento do período de apuração da verba

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
      "verba": "nome exato da verba conforme petição",
      "competencia": "MM/YYYY",
      "valor_hist": número,
      "prob": "Possível",
      "memoria": "fórmula ou fonte do valor — ex: 2h extras × R$ 13,18 × 111 dias × fator 1,5",
      "obs": "observação relevante"
    }}
  ],
  "observacoes_gerais": "total valor causa, verbas sem valor discriminado, alertas",
  "dados_faltantes": ["lista de dados essenciais ausentes — vazio se nada faltar"]
}}"""

PROMPT_SENTENCA = """Analise esta SENTENÇA TRABALHISTA (e a inicial se fornecida) e elabore
o cálculo de liquidação com todas as verbas deferidas e indeferidas.

REGRAS DE PROBABILIDADE (CPC 25):
- DEFERIDO na sentença = "Provável" (condenação já existe, > 50% de perda)
- INDEFERIDO na sentença = "Remoto" (< 25%, empresa tem decisão favorável)
- Em recurso / parcialmente deferido = "Possível" (25-50%)
- Se não há informação sobre o deferimento = "Possível"

{texto_inicial_bloco}

TEXTO DA SENTENÇA:
{texto_sentenca}

DATA-BASE DO CÁLCULO: {data_base}
DATA DE AJUIZAMENTO: {data_ajuizamento}

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
      "prob": "Possível|Provável|Remoto",
      "deferido": true_ou_false_ou_null,
      "memoria": "como foi calculado ou extraído",
      "obs": "observação se houver"
    }}
  ],
  "observacoes_gerais": "alertas do contador",
  "dados_faltantes": ["lista de dados essenciais ausentes — vazio se nada faltar"]
}}"""

PROMPT_LAUDO = """Analise este LAUDO PERICIAL TRABALHISTA (e a inicial se fornecida) e elabore
o cálculo com todas as verbas apuradas pelo perito.

{texto_inicial_bloco}

TEXTO DO LAUDO:
{texto_laudo}

DATA-BASE DO CÁLCULO: {data_base}
DATA DE AJUIZAMENTO: {data_ajuizamento}

Retorne APENAS este JSON:
{{
  "tipo_peca": "laudo",
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
      "prob": "Possível|Provável|Remoto",
      "deferido": true_ou_false_ou_null,
      "memoria": "como foi calculado ou extraído",
      "obs": "observação se houver"
    }}
  ],
  "observacoes_gerais": "alertas do contador",
  "dados_faltantes": ["lista de dados essenciais ausentes — vazio se nada faltar"]
}}"""


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

    # Trunca textos longos
    def truncar(t, max_chars=60_000):
        return t[:max_chars] if len(t) > max_chars else t

    texto_inicial_bloco = ""
    if texto_inicial:
        texto_inicial_bloco = f"TEXTO DA INICIAL (para contexto):\n{truncar(texto_inicial, 20_000)}\n"

    if tipo_peca == "inicial":
        prompt = PROMPT_INICIAL.format(
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
        model="claude-sonnet-4-6",
        max_tokens=8096,
        system=PROMPT_SISTEMA,
        messages=[{"role": "user", "content": prompt}],
    )

    raw = response.content[0].text.strip()
    return _parse_json(raw)


def _parse_json(raw: str) -> dict:
    raw = re.sub(r"```json\s*", "", raw)
    raw = re.sub(r"```\s*", "", raw).strip()
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        m = re.search(r"\{[\s\S]+\}", raw)
        if m:
            return json.loads(m.group(0))
        raise ValueError(f"JSON inválido:\n{raw[:500]}")


def resultado_para_verbas(resultado: dict, data_base: str) -> list[dict]:
    verbas = []
    for v in resultado.get("verbas", []):
        val = float(v.get("valor_hist", 0) or 0)
        # Ignora verbas com valor zero — serão absorvidas em "Outros" se necessário
        if val == 0:
            continue
        verbas.append({
            "verba": v.get("verba", ""),
            "competencia": v.get("competencia") or data_base,
            "valor_hist": val,
            "prob": v.get("prob", "Possível"),
            "deferido": v.get("deferido"),
            "memoria": v.get("memoria", ""),
            "obs": v.get("obs", ""),
        })

    # Se o tipo for inicial e há valor da causa declarado,
    # verifica se o total das verbas identificadas é menor.
    # A diferença entra como "Outros (a discriminar)".
    valor_causa = float(resultado.get("valor_da_causa") or 0)
    tipo = resultado.get("tipo_peca", "")
    if tipo == "inicial" and valor_causa > 0:
        total_verbas = sum(v["valor_hist"] for v in verbas)
        diff = round(valor_causa - total_verbas, 2)
        # Adiciona "Outros" se a diferença for > 1% do valor da causa
        if diff > valor_causa * 0.01:
            verbas.append({
                "verba": "Outros (a discriminar)",
                "competencia": data_base,
                "valor_hist": diff,
                "prob": "Possível",
                "deferido": None,
                "memoria": f"Diferença entre valor da causa (R$ {valor_causa:,.2f}) e verbas identificadas",
                "obs": "Verbas sem valor discriminado na petição — ajustar manualmente",
            })

    return verbas
