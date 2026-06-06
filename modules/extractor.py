"""
Extracao de texto de PDFs usando pdfplumber.
Suporta PDFs digitais (texto selecionavel).
"""
from __future__ import annotations
import io
import re

try:
    import pdfplumber
    PDFPLUMBER_OK = True
except ImportError:
    PDFPLUMBER_OK = False


def extrair_texto(pdf_bytes: bytes) -> str:
    """Extrai todo o texto de um PDF em bytes. Retorna string."""
    if not PDFPLUMBER_OK:
        raise ImportError("pdfplumber nao instalado. Execute: pip install pdfplumber")

    texto_completo = []
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for i, page in enumerate(pdf.pages):
            # Tenta extrair texto normal
            txt = page.extract_text(x_tolerance=2, y_tolerance=2)
            if txt:
                texto_completo.append(f"[--- Pagina {i+1} ---]\n{txt}")
            # Tenta tambem extrair tabelas como texto
            tables = page.extract_tables()
            for table in tables:
                for row in table:
                    if row:
                        linha = " | ".join(str(c) if c else "" for c in row)
                        if linha.strip():
                            texto_completo.append(linha)

    return "\n".join(texto_completo)


def extrair_paginas(pdf_bytes: bytes) -> list[str]:
    """Retorna lista com o texto de cada pagina."""
    if not PDFPLUMBER_OK:
        raise ImportError("pdfplumber nao instalado.")

    paginas = []
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for page in pdf.pages:
            txt = page.extract_text(x_tolerance=2, y_tolerance=2) or ""
            paginas.append(txt)
    return paginas


def extrair_tabelas_bruto(pdf_bytes: bytes) -> list[list[list]]:
    """Extrai todas as tabelas do PDF como listas de listas."""
    if not PDFPLUMBER_OK:
        return []
    todas = []
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for page in pdf.pages:
            tables = page.extract_tables()
            for t in tables:
                if t:
                    todas.append(t)
    return todas


def contar_paginas(pdf_bytes: bytes) -> int:
    """Conta o numero de paginas do PDF."""
    if not PDFPLUMBER_OK:
        return 0
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        return len(pdf.pages)


def limpar_texto(texto: str) -> str:
    """Normaliza espacos e quebras de linha do texto extraido."""
    # Junta linhas quebradas em frases
    texto = re.sub(r"(?<!\n)\n(?!\n)", " ", texto)
    # Remove espacos multiplos
    texto = re.sub(r" {2,}", " ", texto)
    # Normaliza paragrafos
    texto = re.sub(r"\n{3,}", "\n\n", texto)
    return texto.strip()
