"""
Indices de correcao monetaria e juros - BCB SGS API com fallback embutido.
Series:
  10764 = IPCA-E variacao mensal (%)
  4390  = SELIC acumulada mensal (%)
"""
import json
import os
import datetime
from pathlib import Path

try:
    import requests
    REQUESTS_OK = True
except ImportError:
    REQUESTS_OK = False

# ---------------------------------------------------------------------------
# Tabelas de fallback (embutidas) -- atualize conforme IBGE/BCB
# ---------------------------------------------------------------------------
IPCA_E_FALLBACK = {
    "2014-01":0.68,"2014-02":0.69,"2014-03":0.92,"2014-04":0.72,"2014-05":0.46,
    "2014-06":0.40,"2014-07":0.19,"2014-08":0.25,"2014-09":0.44,"2014-10":0.44,
    "2014-11":0.41,"2014-12":0.78,
    "2015-01":1.52,"2015-02":1.22,"2015-03":1.32,"2015-04":0.94,"2015-05":0.60,
    "2015-06":0.69,"2015-07":0.58,"2015-08":0.44,"2015-09":0.54,"2015-10":0.82,
    "2015-11":1.30,"2015-12":0.96,
    "2016-01":1.27,"2016-02":0.90,"2016-03":0.42,"2016-04":0.88,"2016-05":0.78,
    "2016-06":0.39,"2016-07":0.52,"2016-08":0.44,"2016-09":0.31,"2016-10":0.19,
    "2016-11":0.14,"2016-12":0.21,
    "2017-01":0.61,"2017-02":0.27,"2017-03":0.14,"2017-04":0.22,"2017-05":0.11,
    "2017-06":0.04,"2017-07":0.01,"2017-08":0.19,"2017-09":0.22,"2017-10":0.23,
    "2017-11":0.55,"2017-12":0.91,
    "2018-01":0.72,"2018-02":0.37,"2018-03":0.09,"2018-04":0.22,"2018-05":0.40,
    "2018-06":1.21,"2018-07":0.91,"2018-08":-0.01,"2018-09":0.44,"2018-10":0.44,
    "2018-11":0.16,"2018-12":-0.14,
    "2019-01":0.34,"2019-02":0.51,"2019-03":0.75,"2019-04":0.60,"2019-05":0.35,
    "2019-06":0.01,"2019-07":0.14,"2019-08":0.11,"2019-09":0.19,"2019-10":0.25,
    "2019-11":0.45,"2019-12":1.22,
    "2020-01":0.66,"2020-02":0.26,"2020-03":0.07,"2020-04":-0.31,"2020-05":-0.41,
    "2020-06":0.02,"2020-07":0.36,"2020-08":0.28,"2020-09":0.44,"2020-10":0.88,
    "2020-11":0.88,"2020-12":1.35,
    "2021-01":0.84,"2021-02":0.97,"2021-03":0.93,"2021-04":0.31,"2021-05":0.44,
    "2021-06":0.53,"2021-07":0.72,"2021-08":0.89,"2021-09":1.17,"2021-10":1.20,
    "2021-11":0.95,"2021-12":0.87,
    "2022-01":0.54,"2022-02":1.01,"2022-03":1.62,"2022-04":1.06,"2022-05":0.47,
    "2022-06":0.42,"2022-07":0.01,"2022-08":-0.58,"2022-09":-0.29,"2022-10":0.16,
    "2022-11":0.42,"2022-12":0.54,
    "2023-01":0.53,"2023-02":0.84,"2023-03":0.71,"2023-04":0.61,"2023-05":0.23,
    "2023-06":-0.08,"2023-07":0.07,"2023-08":0.28,"2023-09":0.26,"2023-10":0.24,
    "2023-11":0.33,"2023-12":0.71,
    "2024-01":0.42,"2024-02":0.83,"2024-03":0.41,"2024-04":0.38,"2024-05":0.44,
    "2024-06":0.46,"2024-07":0.30,"2024-08":0.44,"2024-09":0.44,"2024-10":0.53,
    "2024-11":0.44,"2024-12":0.48,
    "2025-01":0.42,"2025-02":0.54,"2025-03":0.50,"2025-04":0.43,"2025-05":0.43,
    "2025-06":0.30,"2025-07":0.30,"2025-08":0.30,"2025-09":0.30,"2025-10":0.30,
    "2025-11":0.30,"2025-12":0.30,
    "2026-01":0.40,"2026-02":0.38,"2026-03":0.39,"2026-04":0.37,"2026-05":0.35,
}

SELIC_FALLBACK = {
    "2021-11":0.609,"2021-12":0.770,
    "2022-01":0.731,"2022-02":0.822,"2022-03":0.921,"2022-04":0.833,
    "2022-05":1.025,"2022-06":1.169,"2022-07":1.175,"2022-08":1.175,
    "2022-09":1.057,"2022-10":1.057,"2022-11":1.048,"2022-12":1.124,
    "2023-01":1.124,"2023-02":0.939,"2023-03":1.020,"2023-04":0.829,
    "2023-05":0.842,"2023-06":0.835,"2023-07":0.829,"2023-08":0.869,
    "2023-09":0.935,"2023-10":0.880,"2023-11":0.910,"2023-12":0.919,
    "2024-01":0.972,"2024-02":0.801,"2024-03":0.901,"2024-04":0.883,
    "2024-05":0.864,"2024-06":0.905,"2024-07":0.893,"2024-08":1.015,
    "2024-09":1.052,"2024-10":1.075,"2024-11":1.096,"2024-12":1.194,
    "2025-01":1.166,"2025-02":1.147,"2025-03":1.165,"2025-04":1.132,
    "2025-05":1.118,"2025-06":1.100,"2025-07":1.100,"2025-08":1.088,
    "2025-09":1.075,"2025-10":1.063,"2025-11":1.063,"2025-12":1.063,
    "2026-01":1.113,"2026-02":1.100,"2026-03":1.100,"2026-04":1.088,
    "2026-05":1.075,
}

CACHE_DIR = Path(__file__).parent.parent / "cache"
CACHE_FILE = CACHE_DIR / "indices_bcb.json"
CACHE_MAX_AGE_DAYS = 1


def _ym(dt) -> str:
    """date -> 'YYYY-MM' key"""
    if isinstance(dt, str):
        return dt[:7]
    return f"{dt.year:04d}-{dt.month:02d}"


def _load_cache() -> dict:
    if CACHE_FILE.exists():
        try:
            data = json.loads(CACHE_FILE.read_text(encoding="utf-8"))
            cached_at = datetime.datetime.fromisoformat(data.get("cached_at", "2000-01-01"))
            age = (datetime.datetime.now() - cached_at).days
            if age <= CACHE_MAX_AGE_DAYS:
                return data
        except Exception:
            pass
    return {}


def _save_cache(data: dict):
    CACHE_DIR.mkdir(exist_ok=True)
    data["cached_at"] = datetime.datetime.now().isoformat()
    CACHE_FILE.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")


def _fetch_bcb(serie: int) -> dict:
    """Fetch monthly series from BCB SGS and return {YYYY-MM: value}"""
    url = f"https://api.bcb.gov.br/dados/serie/bcdata.sgs.{serie}/dados?formato=json&dataInicial=01/01/2014"
    r = requests.get(url, timeout=15)
    r.raise_for_status()
    result = {}
    for item in r.json():
        try:
            dt = datetime.datetime.strptime(item["data"], "%d/%m/%Y")
            key = _ym(dt)
            result[key] = float(item["valor"].replace(",", "."))
        except Exception:
            continue
    return result


def get_indices(force_refresh: bool = False) -> tuple[dict, dict, bool]:
    """
    Returns (ipca_e: dict, selic: dict, from_api: bool).
    ipca_e and selic are {YYYY-MM: rate_percent}.
    """
    if not force_refresh:
        cached = _load_cache()
        if cached.get("ipca_e") and cached.get("selic"):
            return cached["ipca_e"], cached["selic"], True

    if REQUESTS_OK:
        try:
            ipca_e = _fetch_bcb(10764)
            selic = _fetch_bcb(4390)
            _save_cache({"ipca_e": ipca_e, "selic": selic})
            return ipca_e, selic, True
        except Exception:
            pass

    return IPCA_E_FALLBACK.copy(), SELIC_FALLBACK.copy(), False


def get_fator_acumulado(tabela: dict, ym_inicio: str, ym_fim: str) -> float:
    """
    Fator acumulado (multiplicador) de ym_inicio ate ym_fim inclusive.
    Ex: get_fator_acumulado(ipca_e, '2020-01', '2021-06')
    """
    from datetime import date
    yi, mi = int(ym_inicio[:4]), int(ym_inicio[5:7])
    yf, mf = int(ym_fim[:4]), int(ym_fim[5:7])

    fator = 1.0
    y, m = yi, mi
    while (y, m) <= (yf, mf):
        key = f"{y:04d}-{m:02d}"
        taxa = tabela.get(key, 0.0)
        fator *= (1 + taxa / 100)
        m += 1
        if m > 12:
            m = 1
            y += 1
    return fator


def contar_meses(ym_inicio: str, ym_fim: str) -> int:
    """Numero de meses de ym_inicio ate ym_fim inclusive."""
    yi, mi = int(ym_inicio[:4]), int(ym_inicio[5:7])
    yf, mf = int(ym_fim[:4]), int(ym_fim[5:7])
    return (yf - yi) * 12 + (mf - mi) + 1
