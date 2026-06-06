# Cálculos P&C

Plataforma de Cálculos Trabalhistas com IA — Peixoto & Cury Advogados

## O que faz

1. Recebe laudos periciais e sentenças trabalhistas em PDF
2. Usa Claude (Anthropic) para extrair verbas, valores e períodos automaticamente
3. Aplica correção monetária conforme ADC 58 STF (IPCA-E + SELIC)
4. Gera memória de cálculo em Excel e relatório em PDF

## Rodar localmente

```bash
pip install -r requirements.txt
streamlit run app.py
```

Ou execute `start.bat`.

## Configuração

Configure a variável de ambiente `ANTHROPIC_API_KEY` ou insira a chave direto na barra lateral.

Para o Streamlit Cloud, adicione em **Settings → Secrets**:
```toml
ANTHROPIC_API_KEY = "sk-ant-..."
```

## Índices de correção

| Fase | Período | Índice |
|------|---------|--------|
| 1 | Competência → out/2021 | IPCA-E + 1% a.m. simples |
| 2 | nov/2021 → data-base | SELIC acumulada (BCB) |

Fundamento: ADC 58 STF (18/11/2021) + Tema 1.191 TST

## Estrutura

```
Cálculos P&C/
├── app.py                  # App Streamlit principal
├── modules/
│   ├── ai_parser.py        # Extração IA com Claude
│   ├── calculator.py       # Motor de cálculo (SELIC/IPCA-E)
│   ├── indices.py          # Tabelas BCB + fallback embutido
│   ├── extractor.py        # Extração de texto de PDFs
│   ├── excel_export.py     # Geração de Excel
│   └── pdf_report.py       # Geração de PDF
├── requirements.txt
└── start.bat
```
