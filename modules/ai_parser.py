"""
Parser inteligente de peças trabalhistas usando Claude API.
Substitui o parser regex com extração semântica completa.
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

# ---------------------------------------------------------------------------
# Schema esperado do modelo
# ---------------------------------------------------------------------------
SCHEMA_EXTRACAO = {
    "reclamante": "string — nome do reclamante",
    "reclamado": "string — nome do reclamado/empresa",
    "numero_processo": "string — número CNJ ex: 1234567-89.2023.5.02.0001",
    "tipo_peca": "string — 'laudo', 'sentenca', 'acordao' ou 'inicial'",
    "periodo_contratual": {
        "admissao": "string MM/YYYY",
        "demissao": "string MM/YYYY ou 'em curso'"
    },
    "data_base_calculo": "string MM/YYYY — mês de referência para atualização",
    "indice_determinado": "string — 'SELIC_ADC58' | 'IPCAE_1PCT' | 'SEM_CORRECAO' | 'NAO_INFORMADO'",
    "verbas": [
        {
            "verba": "string — nome canônico da verba",
            "valor_hist": "number — valor histórico em reais (float)",
            "competencia": "string MM/YYYY — competência de origem",
            "deferido": "boolean | null — true=deferido, false=indeferido, null=sem info",
            "obs": "string — observação relevante (ex: 'com reflexos em DSR', 'período: jan/2019-mar/2022')"
        }
    ],
    "total_condenacao": "number | null — valor total se explícito na peça",
    "honorarios_sucumbencia": "number | null",
    "observacoes_gerais": "string — pontos de atenção do contador sênior"
}

PROMPT_SISTEMA = """Você é um contador sênior especialista em processos trabalhistas brasileiros,
com 20 anos de experiência em perícias contábeis e liquidações de sentença.

Sua tarefa é extrair e estruturar com precisão todas as informações de cálculo de uma peça
processual trabalhista (laudo pericial, sentença ou acórdão).

Regras:
1. Identifique TODAS as verbas mencionadas — deferidas, indeferidas e em apuração
2. Para cada verba, extraia o valor histórico (antes de correção monetária)
3. Identifique o período/competência de cada verba (quando o débito foi gerado)
4. Se a peça mencionar o índice de correção, informe em indice_determinado
5. Se não houver valor para uma verba (apenas menção ao direito), coloque valor_hist = 0
6. Em observacoes_gerais, aponte inconsistências, alertas e pontos de atenção jurídica

Responda EXCLUSIVAMENTE com o JSON estruturado, sem texto antes ou depois.
"""

PROMPT_USUARIO = """Analise a seguinte peça processual e retorne o JSON de extração:

TIPO DE PEÇA: {tipo_peca}

TEXTO DA PEÇA:
{texto}

Retorne APENAS o JSON seguindo exatamente este schema:
{schema}
"""


def extrair_com_ia(
    texto: str,
    tipo_peca: str = "auto",
    api_key: str = None,
) -> dict:
    """
    Extrai verbas e dados processuais usando Claude API.

    Args:
        texto: texto completo da peça
        tipo_peca: 'laudo', 'sentenca', 'acordao', 'inicial' ou 'auto'
        api_key: chave Anthropic (usa ANTHROPIC_API_KEY do env se None)

    Returns:
        dict com schema de extração
    """
    if not ANTHROPIC_OK:
        raise ImportError("anthropic não instalado. Execute: pip install anthropic")

    key = api_key or os.environ.get("ANTHROPIC_API_KEY", "")
    if not key:
        raise ValueError("ANTHROPIC_API_KEY não configurada.")

    if tipo_peca == "auto":
        tipo_peca = _detectar_tipo(texto)

    # Trunca texto para não exceder contexto (máx ~100k chars)
    texto_truncado = texto[:100_000] if len(texto) > 100_000 else texto

    client = anthropic.Anthropic(api_key=key)

    prompt = PROMPT_USUARIO.format(
        tipo_peca=tipo_peca.upper(),
        texto=texto_truncado,
        schema=json.dumps(SCHEMA_EXTRACAO, ensure_ascii=False, indent=2)
    )

    response = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=4096,
        messages=[
            {"role": "user", "content": prompt}
        ],
        system=PROMPT_SISTEMA,
    )

    raw = response.content[0].text.strip()
    return _parse_json_resposta(raw)


def _detectar_tipo(texto: str) -> str:
    """Detecta tipo da peça por heurística simples."""
    t = texto.lower()[:3000]
    if re.search(r"laudo\s+pericial|perito|perícia|sr\.\s+perito", t):
        return "laudo"
    if re.search(r"acórdão|turma\s+do\s+trt|região|recurso\s+ordinário", t):
        return "acordao"
    if re.search(r"sentença|juiz\(a\)|mm\.\s+juiz|dispositivo|decido|julgo", t):
        return "sentenca"
    return "inicial"


def _parse_json_resposta(raw: str) -> dict:
    """Extrai e parseia JSON da resposta do modelo."""
    # Remove markdown code blocks se presentes
    raw = re.sub(r"```json\s*", "", raw)
    raw = re.sub(r"```\s*", "", raw)
    raw = raw.strip()

    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        # Tenta extrair JSON com regex
        m = re.search(r"\{[\s\S]+\}", raw)
        if m:
            return json.loads(m.group(0))
        raise ValueError(f"Modelo não retornou JSON válido:\n{raw[:500]}")


def resultado_ia_para_verbas(resultado: dict) -> list[dict]:
    """
    Converte resultado da extração IA para lista de dicts compatível
    com o motor de cálculo (calcular_lista).
    """
    verbas = []
    for v in resultado.get("verbas", []):
        val = float(v.get("valor_hist", 0) or 0)
        if val <= 0:
            continue
        verbas.append({
            "verba": v.get("verba", "Verba sem nome"),
            "valor_hist": val,
            "competencia": v.get("competencia") or resultado.get("data_base_calculo") or "01/2020",
            "deferido": "Sim" if v.get("deferido") is True else
                        "Não" if v.get("deferido") is False else "-",
            "obs": v.get("obs", ""),
        })
    return verbas
