/* Motor de cálculo trabalhista · Plataforma de Cálculos Peixoto & Cury
 *
 * Recebe um caso (parâmetros) e as tabelas oficiais (window.TABELAS, exportadas do PJe-Calc)
 * e devolve as ocorrências mês a mês de cada verba, corrigidas.
 * Regras conferidas contra os PJC do contador pela bancada (ferramentas/bancada_motor.py).
 *
 * Fase 1: verbas calculadas (base salário mínimo ou outras verbas), proporcionalidade,
 * reflexos em RSR, 13º, férias + 1/3, aviso prévio e multa do art. 477, valores informados,
 * correção monetária (índice trabalhista + combinação a partir de uma data).
 * Ainda não: juros, INSS, IR, FGTS, honorários, cartão de ponto, histórico salarial.
 */
(function (global) {
  'use strict';

  // ---------- números e datas ----------
  const r2 = v => Math.sign(v) * Math.round(Math.abs(v) * 100 + 1e-6) / 100;
  const D = s => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
  const S = d => d.toISOString().slice(0, 10);
  const addDias = (s, n) => { const d = D(s); d.setUTCDate(d.getUTCDate() + n); return S(d); };
  const ym = s => s.slice(0, 7);
  const addMes = (m, k) => { let [y, mm] = m.split('-').map(Number); mm += k; y += Math.floor((mm - 1) / 12); mm = ((mm - 1) % 12 + 12) % 12 + 1; return `${y}-${String(mm).padStart(2, '0')}`; };
  const fimMes = m => S(new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)));
  const diasNoMes = m => +fimMes(m).slice(8);
  const addAno = (d, n) => `${+d.slice(0, 4) + n}${d.slice(4)}`;
  const diasEntre = (a, b) => Math.round((D(b) - D(a)) / 864e5) + 1;   // inclusivo
  const max = (a, b) => (a > b ? a : b), min = (a, b) => (a < b ? a : b);
  const cada = function* (a, b) { for (let s = a; s <= b; s = addDias(s, 1)) yield s; };
  const quatroTercos = m => (Math.abs(m - 4 / 3) < 1e-3 ? 4 / 3 : m);

  // ---------- calendário ----------
  function pascoa(y) { // algoritmo de Meeus
    const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4,
      f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30,
      i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451),
      mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
    return `${y}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
  }
  const MOVEIS = { 'CARNAVAL': -47, 'SEGUNDA-FEIRA DE CARNAVAL': -48, 'SEXTA-FEIRA SANTA': -2, 'CORPUS CHRISTI': 60 };

  function calendario(T, ct, locais) {
    // locais: true/false para estaduais e municipais, ou {estadual, municipal}
    const est = typeof locais === 'object' && locais ? locais.estadual : (locais ?? OPCOES.feriadosLocais);
    const mun = typeof locais === 'object' && locais ? locais.municipal : (locais ?? OPCOES.feriadosLocais);
    const uf = (T.municipios[ct.municipio] || [])[1];
    const pontos = new Set(ct.pontosFacultativos || []);
    const cache = {};
    function doAno(y) {
      if (cache[y]) return cache[y];
      const set = new Set(), p = pascoa(y);
      for (const f of T.feriados) {
        let dia;
        if (f.movel) { if (!(f.nome in MOVEIS)) continue; dia = addDias(p, MOVEIS[f.nome]); }
        else if (f.dia) dia = `${y}-${f.dia}`; else continue;
        if (f.vigIni && dia < f.vigIni) continue;
        if (f.vigFim && dia > f.vigFim) continue;
        const pontoOk = f.tipo === 'F' || pontos.has(f.uid);
        if (!pontoOk) continue;
        const abr = f.abrangencia;
        const ok = abr === 'F' || (abr === 'E' && ct.feriadoEstadual && f.uf === uf && est)
          || (abr === 'M' && ct.feriadoMunicipal && f.municipio === ct.municipio && mun);
        if (ok) set.add(dia);
      }
      return (cache[y] = set);
    }
    const ehFeriado = s => doAno(+s.slice(0, 4)).has(s);
    const dow = s => D(s).getUTCDay(); // 0 = domingo
    return {
      ehFeriado,
      repousos(a, b) { let n = 0; for (const s of cada(a, b)) if (dow(s) === 0 || ehFeriado(s)) n++; return n; },
      uteis(a, b) {
        let n = 0;
        for (const s of cada(a, b)) { const w = dow(s); if (w === 0 || ehFeriado(s)) continue; if (w === 6 && !ct.sabadoDiaUtil) continue; n++; }
        return n;
      },
    };
  }

  // ---------- contrato ----------
  function diasAviso(ct) {
    if (ct.apuracaoAviso === 'APURACAO_INFORMADA' && ct.prazoAviso) return ct.prazoAviso;
    let anos = 0; const [ay, am, ad] = ct.admissao.split('-').map(Number);
    while (S(new Date(Date.UTC(ay + anos + 1, am - 1, ad))) <= ct.demissao) anos++;
    return Math.min(90, 30 + 3 * anos);
  }

  // dias que não contam na proporcionalidade (férias gozadas, faltas)
  function diasExcluidos(p, v) {
    const set = new Set();
    if (v.excluiFerias) for (const f of p.ferias) for (const [a, b] of f.gozos || []) for (const s of cada(a, b)) set.add(s);
    for (const f of p.faltas) {
      if ((f.justificada && v.excluiFaltaJust) || (!f.justificada && v.excluiFaltaNaoJust)) for (const s of cada(f.ini, f.fim)) set.add(s);
    }
    return set;
  }

  // avos: meses com 15 dias ou mais dentro de [a, b], contados mês civil a mês civil
  function avosCivis(a, b) {
    let n = 0;
    for (let m = ym(a); m <= ym(b); m = addMes(m, 1)) {
      const i = max(a, `${m}-01`), f = min(b, fimMes(m));
      if (diasEntre(i, f) >= 15) n++;
    }
    return n;
  }
  // avos do período aquisitivo: meses cheios a partir do início + fração >= 15 dias
  function avosAquisitivo(ini, fim) {
    let n = 0, cur = ini;
    for (;;) {
      const [y, m, d] = cur.split('-').map(Number);
      const prox = S(new Date(Date.UTC(y, m, d)));       // mesmo dia do mês seguinte
      if (addDias(prox, -1) <= fim) { n++; cur = prox; if (n >= 12) break; } else break;
    }
    if (n < 12 && cur <= fim && diasEntre(cur, fim) >= 15) n++;
    return n;
  }

  // ---------- correção monetária ----------
  // mesmoMes: a correção começa no próprio mês do vencimento (modo "mês do vencimento", ou parcelas
  // não mensais no modo "mês subsequente e mês do vencimento"); senão, no mês seguinte (Súmula 381 TST)
  function fatorCorrecao(T, at, liquidacao, vencimento, ateInclusao, mesmoMes) {
    const taxa = (nome, m) => {
      if (!nome || nome === 'SEM_CORRECAO') return 0;
      const t = (T[{ IPCAE: 'ipcae', IPCA: 'ipca', TR: 'tr', INPC: 'inpc' }[nome]] || {})[m];
      if (!t) return 0;
      if (ateInclusao && t[1] && t[1] > ateInclusao) return 0;   // tabela "como estava" numa data
      return at.ignorarNegativa ? Math.max(t[0], 0) : t[0];
    };
    const aPartir = at.combinarIndice && at.aPartirOutroIndice ? at.aPartirOutroIndice : null;
    const troca = aPartir ? ym(aPartir) : null;
    let f = 1;
    for (let m = mesmoMes ? ym(vencimento) : addMes(ym(vencimento), 1); m < ym(liquidacao); m = addMes(m, 1)) {
      if (OPCOES.indiceAte && m > OPCOES.indiceAte) break;     // tabela com índices só até esse mês
      if (troca && m === troca && +aPartir.slice(8) > 1) {
        // mês da troca (ajuizamento no meio do mês): índice antigo até a véspera, novo depois, pelos dias
        const n = diasNoMes(m), d1 = +aPartir.slice(8) - 1;
        f *= Math.pow(1 + taxa(at.indice, m) / 100, d1 / n) * Math.pow(1 + taxa(at.outroIndice, m) / 100, (n - d1) / n);
        continue;
      }
      const nome = troca && m >= troca ? at.outroIndice : at.indice;
      f *= 1 + taxa(nome, m) / 100;
    }
    return f;
  }

  // ---------- verbas ----------
  function calcular(caso, T, opcoes) {
    Object.assign(OPCOES, opcoes || {});
    const p = caso.parametros, ct = p.contrato;
    const cal = calendario(T, ct);
    const aviso = diasAviso(ct);
    const fimProjetado = ct.projetaAviso ? addDias(ct.demissao, aviso) : ct.demissao;
    const porId = Object.fromEntries(p.verbas.map(v => [v.id, v]));
    const zera = v => !!(v && v.pjc && v.pjc.zeraValorNegativo);
    const res = {};                       // id -> {verba, ocorrencias}
    const avisos = [];

    function informado(v, ini) { return (v.informados || []).find(o => o.ini === ini); }
    // histórico salarial e cartão de ponto mensal: valor do mês (histórico sem o mês: último valor anterior)
    function historico(id, m) {
      const h = (p.historicos || {})[id]; if (!h) return 0;
      if (m in h.valores) return h.valores[m] || 0;
      const ant = Object.keys(h.valores).filter(k => k <= m).sort().pop();
      return ant ? h.valores[ant] || 0 : 0;
    }
    // colunas do cartão: apuradas pelo motor a partir das batidas, quando houver; senão, as informadas
    const doCartao = OPCOES.cartaoDasBatidas !== false && (p.apuracoesCartao || []).length ? colunasDoCartao(caso, T) : {};
    function cartao(id, m) { const c = doCartao[id] || (p.cartoes || {})[id]; return c ? c.valores[m] || 0 : 0; }
    function maiorHistorico() { let mx = 0; for (const h of Object.values(p.historicos || {})) for (const x of Object.values(h.valores)) mx = Math.max(mx, x || 0); return mx; }

    function calculada(v) {
      const F = v.formula, excl = diasExcluidos(p, v), oc = [];
      const exclFerias = new Set(); if (v.excluiFerias) for (const f of p.ferias) for (const [a1, b1] of f.gozos || []) for (const s of cada(a1, b1)) exclFerias.add(s);
      // o período é o da verba: reintegração, estabilidade e pensão correm depois da demissão
      const a = max(v.ini, ct.admissao), b = v.fim || ct.demissao;
      for (let m = ym(a); m <= ym(b); m = addMes(m, 1)) {
        const ini = max(a, `${m}-01`), fim = min(b, fimMes(m));
        let baseTab = 0;
        if (F.baseTabelada === 'SALARIO_MINIMO') baseTab = T.salarioMinimo[m] || 0;
        else if (F.baseTabelada === 'HISTORICO_SALARIAL') baseTab = (F.historicosBase || []).reduce((s, id) => s + historico(id, m), 0);
        else if (F.baseTabelada === 'MAIOR_REMUNERACAO') baseTab = ct.maiorRemuneracao || maiorHistorico();
        else if (F.baseTabelada && F.baseTabelada !== 'null') avisos.push(`${v.nome}: base ${F.baseTabelada} ainda não suportada`);
        // outras verbas que compõem a base (ex.: hora extra sobre salário + adicionais): valor devido do mês
        let baseVer = 0;
        // verba que serve de base: "integralizar" do item no PJe-Calc decide entre o mês cheio e o valor proporcional
        // (Flávio: REF. INSAL. EM ADICIONAL NOTURNO com integralizar NÃO usa a insalubridade proporcional do mês)
        (F.baseVerbas || []).forEach((id, i) => { const o = (res[id] || exec(id)).ocorrencias.find(x => ym(x.ini) === m); if (!o) return;
          const integ = ((v.pjc || {}).integralizar || [])[i]; baseVer += integ === 'NAO' ? o.devido : (o.devidoIntegral ?? o.devido); });
        const lanc = (v.lancamentos || {})[ini] || {};
        let dias = 0; for (const s of cada(ini, fim)) if (!excl.has(s)) dias++;
        // mês cheio com exclusão: férias contam em dias corridos e faltas em dias do mês comercial (30):
        // dias = min(dias do mês − férias, 30) − faltas. Fabio 07/2020 (falta 01 a 05) = 25; Fabio 03/2020
        // (férias 01 a 18) = 13; Alisson 12/2022 (férias 22 a 31) = 21. Mês parcial: dias corridos
        if (ini === `${m}-01` && fim === fimMes(m) && dias < diasNoMes(m)) {
          // cada período conta os seus dias, mesmo sobrepostos (o PJe-Calc soma período a período): Anderson 03/2020,
          // dois gozos que se sobrepõem em 01 a 03/03 = 13 dias de férias, 18 trabalhados; 03/2024, 8 de férias e 19 de
          // falta sobrepostos = 4 dias
          const dentro = (a1, b1) => { const i = max(a1, ini), f2 = min(b1, fim); return i <= f2 ? diasEntre(i, f2) : 0; };
          let fer = 0, fal = 0;
          if (v.excluiFerias) for (const f of p.ferias) for (const [a1, b1] of f.gozos || []) fer += dentro(a1, b1);
          for (const f of p.faltas) if ((f.justificada && v.excluiFaltaJust) || (!f.justificada && v.excluiFaltaNaoJust)) fal += dentro(f.ini, f.fim || f.ini);
          dias = Math.max(0, Math.min(diasNoMes(m) - fer, 30) - fal);
        }
        const fator = Math.min(1, dias / Math.min(diasNoMes(m), 30));
        const proporcional = v.proporcional || F.proporcionalBase;
        const baseInt = r2(baseTab + baseVer);
        const base = r2((proporcional ? r2(baseTab * fator) : baseTab) + baseVer);
        // DIAS_UTEIS também em verba calculada (Marcos: RSR sobre horas extras = horas do mês / dias úteis × repousos)
        const div = F.divisorTipo === 'CARGA_HORARIA' ? ct.cargaHoraria : F.divisorTipo === 'DIAS_UTEIS' ? cal.uteis(ini, fim)
          : F.divisorTipo === 'IMPORTADO_DO_CARTAO' ? (F.cartoesDivisor || []).reduce((s, id) => s + cartao(id, m), 0) : (F.divisor || 1);
        let qtd = F.qtd ?? 1;
        // quantidade do cartão. Montador: fator e colunas a subtrair (Marcos: 30 min por dia =
        // (Dias Trabalhados − Feriados e Repousos Trabalhados) × 0,5, como o contador digitou)
        if (F.qtdTipo === 'IMPORTADA_DO_CARTAO') {
          qtd = (F.cartoesQtd || []).reduce((s, id) => s + cartao(id, m), 0) - (F.cartoesQtdMenos || []).reduce((s, id) => s + cartao(id, m), 0);
          if (F.qtdFator != null) qtd = Math.round(qtd * F.qtdFator * 100) / 100;
        }
        else if (F.qtdTipo === 'IMPORTADA_DO_CALENDARIO') qtd = cal.repousos(ini, fim);
        else if (F.qtdTipo === 'INFORMADA' && lanc.qtd != null) qtd = lanc.qtd;      // quantidade digitada no mês
        else if (F.qtdTipo && F.qtdTipo !== 'INFORMADA') avisos.push(`${v.nome}: quantidade ${F.qtdTipo} ainda não suportada`);
        const mult = F.mult ?? 1;
        let devido = r2(base * mult * qtd / (div || 1)), devidoIntegral = r2(baseInt * mult * qtd / (div || 1)), pago = 0, origem = 'calculado';
        // valor pago calculado a partir de um histórico (ex.: adicional noturno pago no holerite)
        if (F.pagoTipo === 'CALCULADO' && F.pagoBaseTabelada === 'HISTORICO_SALARIAL') {
          const hp = (F.historicosPago || []).reduce((s, id) => s + historico(id, m), 0);
          pago = r2((F.pagoProporcional ? hp * fator : hp) * (F.pagoQtd ?? 1));
        } else if (F.pagoTipo === 'INFORMADO') pago = lanc.pago ?? F.pago ?? 0;     // valor pago digitado no mês
        if (lanc.ativo === false) { devido = 0; devidoIntegral = 0; pago = 0; }     // mês desativado
        const inf = informado(v, ini);
        if (inf) { devido = inf.devido ?? devido; pago = inf.pago ?? 0; devidoIntegral = inf.devidoIntegral ?? devidoIntegral; origem = 'informado'; }
        oc.push({ ini, fim, vencimento: fim, base, baseIntegral: baseInt, mult, divisor: div, qtd, devido, devidoIntegral, pago, pagoIntegral: 0, origem });
      }
      return oc;
    }

    // valor mensal das verbas-base no mês m (integral ou como está, conforme o reflexo)
    function valorBase(v, m) {
      let tot = 0;
      for (const id of v.formula.baseVerbas || []) {
        const o = (res[id] || exec(id)).ocorrencias.find(x => ym(x.ini) === m);
        if (!o) continue;
        const d = v.reflexo.fracao === 'INTEGRALIZAR' ? o.devidoIntegral - (o.pagoIntegral || 0) : o.devido - o.pago;
        tot += zera(porId[id]) ? Math.max(0, d) : d;
      }
      return r2(tot);
    }

    // Reflexo pela média: média, no período, da quantidade de diferença de cada mês
    // (horas devidas menos valor pago / valor da hora do mês), vezes o valor da hora do mês de referência.
    // Média pelo valor: média das diferenças em reais. Conferido no 13º (Vinicius, centavos de diferença).
    function valorMedia(v, ref, de, ate) {
      let tot = 0;
      for (const id of v.formula.baseVerbas || []) {
        const oc = (res[id] || exec(id)).ocorrencias.filter(o => ym(o.ini) >= ym(de) && ym(o.ini) <= ym(ate));
        if (!oc.length) continue;
        const ultimo = oc.find(o => ym(o.ini) === ym(ref)) || oc[oc.length - 1];
        const z = zera(porId[id]);
        // 13º pela média (ano civil): soma do ano dividida por 12, não pelo número de meses com valor; com fração
        // "integralizar", o mês cheio (Marcos 2022: 4 meses × 1.090,32 / 12 = 363,44; 2021: 7.426,32 / 12 = 618,86)
        const n = v.reflexo.periodoMedia === 'ANO_CIVIL' && v.reflexo.comportamento === 'MEDIA_PELO_VALOR' ? 12 : oc.length;
        const integral = v.reflexo.fracao === 'INTEGRALIZAR';
        if (v.reflexo.comportamento === 'MEDIA_PELO_VALOR') { tot += oc.reduce((s, o) => { const d = integral ? (o.devidoIntegral ?? o.devido) - (o.pagoIntegral ?? o.pago) : o.devido - o.pago; return s + (z ? Math.max(0, d) : d); }, 0) / n; continue; }
        const unit = o => (o.base || 0) * (o.mult ?? 1) / (o.divisor || 1);
        const qd = oc.map(o => { const q = Math.round(((o.qtd || 0) - (unit(o) ? o.pago / unit(o) : 0)) * 1e4) / 1e4; return z ? Math.max(0, q) : q; });
        tot += qd.reduce((s, x) => s + x, 0) / n * unit(ultimo);
      }
      return Math.max(0, r2(tot));        // média negativa (pago acima do devido) não gera reflexo
    }
    // Média das férias (período aquisitivo), regra do contador conferida em 49 de 69 reflexos (Anderson,
    // Alisson, Vinícius, Marcos): entram os meses com 15 dias ou mais dentro do aquisitivo; a soma é dividida
    // pelo número desses meses (os avos, mesmo sem ocorrência antes do início da verba); o valor da hora é
    // o do mês do gozo; média negativa fica negativa (Vinícius 07/2024: -0,46)
    function valorMediaAquisitivo(v, ref, de, ate) {
      const meses = [];
      for (let m = ym(de); m <= ym(ate); m = addMes(m, 1)) if (diasEntre(max(de, `${m}-01`), min(ate, fimMes(m))) >= 15) meses.push(m);
      if (!meses.length) return 0;
      let tot = 0;
      for (const id of v.formula.baseVerbas || []) {
        const todas = (res[id] || exec(id)).ocorrencias;
        const oc = todas.filter(o => meses.includes(ym(o.ini)));
        const z = zera(porId[id]);
        if (v.reflexo.comportamento === 'MEDIA_PELO_VALOR') { tot += oc.reduce((s, o) => s + (z ? Math.max(0, o.devido - o.pago) : o.devido - o.pago), 0) / meses.length; continue; }
        const unit = o => (o.base || 0) * (o.mult ?? 1) / (o.divisor || 1);
        const ant = todas.filter(o => ym(o.ini) <= ym(ref) && unit(o));
        const hora = todas.find(o => ym(o.ini) === ym(ref) && unit(o)) || ant[ant.length - 1] || oc[oc.length - 1];
        if (!hora) continue;
        const soma = oc.reduce((s, o) => { const q = Math.round(((o.qtd || 0) - (unit(o) ? o.pago / unit(o) : 0)) * 1e4) / 1e4; return s + (z ? Math.max(0, q) : q); }, 0);
        tot += soma / meses.length * unit(hora);
      }
      return r2(tot);
    }
    function baseReflexo(v, m, de, ate) {
      if (v.ocorrencia === 'PERIODO_AQUISITIVO' && v.reflexo.comportamento && v.reflexo.comportamento.startsWith('MEDIA')) return valorMediaAquisitivo(v, `${m}-01`, de, ate);
      if (v.reflexo.comportamento && v.reflexo.comportamento.startsWith('MEDIA')) return valorMedia(v, `${m}-01`, de, ate);
      return valorBase(v, m);
    }

    function reflexo(v) {
      const F = v.formula, oc = [], mult = quatroTercos(F.mult ?? 1);
      // vencimento: fim do mês nas parcelas mensais; data da ocorrência nas demais (13º, férias, rescisão)
      const push = (ini, fim, base, div, qtd, extra) => oc.push(Object.assign({ ini, fim, vencimento: v.ocorrencia === 'MENSAL' ? fim : ini, base, mult, divisor: div, qtd, devido: div ? r2(base * mult * qtd / div) : 0, pago: 0, origem: 'calculado' }, extra || {}));
      const a = max(v.ini, ct.admissao), b = v.ocorrencia === 'MENSAL' ? (v.fim || ct.demissao) : min(v.fim, ct.demissao);
      if (!['VALOR_MENSAL', 'MEDIA_PELA_QUANTIDADE', 'MEDIA_PELO_VALOR'].includes(v.reflexo.comportamento)) avisos.push(`${v.nome}: comportamento ${v.reflexo.comportamento} ainda não suportado`);

      if (v.ocorrencia === 'MENSAL') {
        for (let m = ym(a); m <= ym(b); m = addMes(m, 1)) {
          const ini = max(a, `${m}-01`), fim = min(b, fimMes(m));
          const div = F.divisorTipo === 'DIAS_UTEIS' ? cal.uteis(ini, fim) : (F.divisor || 1);
          const qtd = F.qtdTipo === 'IMPORTADA_DO_CALENDARIO' ? cal.repousos(ini, fim) : (F.qtd ?? 1);
          push(ini, fim, valorBase(v, m), div, qtd);
        }
      } else if (v.ocorrencia === 'DEZEMBRO') {            // 13º salário
        // a verba vai até a demissão, mas os avos contam a projeção do aviso indenizado
        const fimRef = v.fim >= ct.demissao ? fimProjetado : v.fim;
        for (let y = +a.slice(0, 4); y <= +ct.demissao.slice(0, 4); y++) {
          const ultimo = y === +ct.demissao.slice(0, 4);
          const pi = max(a, `${y}-01-01`), pf = min(fimRef, `${y}-12-31`);
          if (pi > pf) continue;
          const data = ultimo ? ct.demissao : `${y}-12-20`;
          push(data, data, baseReflexo(v, ultimo ? ym(ct.demissao) : `${y}-12`, pi, min(pf, data)), F.divisor || 12, avosCivis(pi, pf));
        }
      } else if (v.ocorrencia === 'PERIODO_AQUISITIVO') {   // férias + 1/3
        const lista = Object.fromEntries(p.ferias.map(f => [f.aquisitivoIni, f]));
        for (let ini = ct.admissao; ini <= fimProjetado; ) {
          const [y, m, d] = ini.split('-').map(Number);
          const fimAq = addDias(S(new Date(Date.UTC(y + 1, m - 1, d))), -1);
          const f = lista[ini], completo = fimAq <= fimProjetado;
          const avos = completo ? 12 : avosAquisitivo(ini, fimProjetado);
          if (avos > 0 && f && (f.situacao === 'GOZADAS' || f.situacao === 'GOZADAS_PARCIALMENTE') && f.gozos.length) {
            // férias gozadas (regra do contador, conferida no Anderson, Vinícius e Reinaldo):
            //  - cada período de gozo é uma ocorrência e a fração dos dias vai na BASE: valor × dias/30
            //    (com abono, dias/(30 − abono)); o PJe-Calc recalcula devido = base × mult × avos / 12
            //  - o corte é pela data do gozo, não pelo período aquisitivo: aquisitivo anterior ao início da verba
            //    entra se o gozo foi depois (Anderson: aquisitivo 2018/2019 gozado em 2020)
            //  - dobra (art. 137 da CLT) só quando marcada no período (gozosDobra) ou nas férias (dobra): o contador
            //    dobrou no Anderson e não no Marcos, ambos com gozo fora do concessivo; a decisão é que manda
            const parteSalarial = f.abono && f.prazo ? (f.prazo - (f.diasAbono || 0)) / f.prazo : 1;
            const prazoGozo = 30 - (f.abono ? f.diasAbono || 0 : 0);
            for (const [k, [gi, gf]] of f.gozos.entries()) {
              if ((v.ini && gi < v.ini) || gi > (v.fim || fimProjetado)) continue;
              const valor = baseReflexo(v, ym(gi), ini, min(fimAq, gi));
              const dobra = !!(f.dobra || (f.gozosDobra || [])[k]);
              // período com dobra que atravessa o fim do concessivo: os dias até o fim do concessivo são normais e
              // os seguintes viram outra ocorrência, em dobro (Alisson: gozo de 15/07 a 13/08/2024, concessivo até
              // 08/08/2024, dobra só de 09 a 13/08)
              const fimConc = addDias(addAno(addDias(fimAq, 1), 1), -1);
              // o PJe-Calc sempre divide o gozo no fim do concessivo; a dobra só vale para a 2ª parte, e só se marcada
              // (Marcos: 02 a 13/01/2024 vira 02-07 e 08-13, sem dobra)
              const partes = gf <= fimConc || gi > fimConc ? [[gi, gf, dobra && gi > fimConc]]
                : [[gi, fimConc, false], [addDias(fimConc, 1), gf, dobra]];
              for (const [a1, b1, dob] of partes) {
                push(a1, b1, r2(valor * diasEntre(a1, b1) / prazoGozo), F.divisor || 12, avos, { aquisitivoIni: ini, feriasGozadas: true, parteSalarial, dobra: dob });
                const o = oc[oc.length - 1]; if (dob) o.devido = r2(o.base * o.mult * o.qtd / o.divisor * 2);
              }
            }
            // parcialmente gozadas: o saldo de dias é indenizado na demissão (Marcos 2025/2026: 14 dias gozados,
            // 16 indenizados = valor × 16/30)
            if (f.situacao === 'GOZADAS_PARCIALMENTE') {
              const gozados = f.gozos.reduce((t, [a1, b1]) => t + diasEntre(a1, b1), 0), saldo = Math.max(0, prazoGozo - gozados);
              if (saldo) push(ct.demissao, ct.demissao, r2(baseReflexo(v, ym(ct.demissao), ini, min(fimAq, ct.demissao)) * saldo / prazoGozo), F.divisor || 12, avos, { aquisitivoIni: ini, feriasGozadas: false, parteSalarial: 0 });
            }
          } else if (avos > 0 && (!v.ini || fimAq >= v.ini) && !(f && f.situacao === 'PERDIDAS')) {
            // férias indenizadas ou proporcionais na rescisão: natureza indenizatória. Duração pelo art. 130 da CLT
            // (faltas injustificadas no aquisitivo) quando o período não tem registro de férias, como o PJe-Calc faz
            // (Vinícius: 10 faltas injustificadas em 2023/2024 = 24 dias, base × 24/30)
            let prazo = f && f.prazo ? f.prazo : 30;
            if (!f) {
              let n = 0;
              for (const x of p.faltas) if (!x.justificada) { const i = max(x.ini, ini), j = min(x.fim || x.ini, min(fimAq, ct.demissao)); if (i <= j) n += diasEntre(i, j); }
              prazo = n <= 5 ? 30 : n <= 14 ? 24 : n <= 23 ? 18 : n <= 32 ? 12 : 0;
            }
            push(ct.demissao, ct.demissao, r2(baseReflexo(v, ym(ct.demissao), ini, min(fimAq, ct.demissao)) * prazo / 30), F.divisor || 12, avos, { aquisitivoIni: ini, feriasGozadas: false, parteSalarial: 0 });
          }
          ini = addDias(fimAq, 1);
        }
      } else if (v.ocorrencia === 'DESLIGAMENTO') {         // aviso prévio, multa 477
        const qtd = v.caracteristica === 'AVISO_PREVIO' ? aviso : (F.qtd ?? 1);
        // média dos últimos 12 meses do contrato
        const de = `${addMes(ym(ct.demissao), -11)}-01`;
        push(ct.demissao, ct.demissao, baseReflexo(v, ym(ct.demissao), de, ct.demissao), F.divisor || 1, qtd);
      } else avisos.push(`${v.nome}: ocorrência ${v.ocorrencia} ainda não suportada`);
      return oc;
    }

    function exec(id) {
      if (res[id]) return res[id];
      const v = porId[id];
      res[id] = { verba: v, ocorrencias: [] };      // evita laço em referências circulares
      let oc = [];
      if (v.tipo === 'Calculada') oc = calculada(v);
      else if (v.tipo === 'Reflexo') {
        oc = reflexo(v);
        // valores digitados no PJe-Calc também valem no reflexo (Damásio: 13º e aviso sobre adicional noturno);
        // duas ocorrências na mesma data (férias na demissão) se separam pelo período aquisitivo
        for (const o of oc) {
          const inf = (v.informados || []).find(x => x.ini === o.ini && (!x.aquisitivoIni || !o.aquisitivoIni || x.aquisitivoIni === o.aquisitivoIni));
          if (inf) { o.devido = inf.devido ?? o.devido; o.pago = inf.pago ?? 0; o.devidoIntegral = inf.devidoIntegral ?? o.devido; o.origem = 'informado'; }
        }
      }
      // verba informada (valores digitados mês a mês): vencimento no fim do período da parcela mensal
      else oc = (v.informados || []).map(o => ({ ini: o.ini, fim: o.fim, vencimento: v.ocorrencia === 'MENSAL' ? (o.fim || o.ini) : o.ini,
        devido: o.devido || 0, pago: o.pago || 0, devidoIntegral: o.devidoIntegral ?? o.devido ?? 0, pagoIntegral: o.pagoIntegral ?? o.pago ?? 0, origem: 'informado' }));
      res[id].ocorrencias = oc;
      return res[id];
    }

    p.verbas.forEach(v => exec(v.id));

    // correção
    const liq = ct.liquidacao;
    let totDevido = 0, totPago = 0, totCorrigido = 0;
    const verbas = p.verbas.map(v => {
      const r = res[v.id];
      let sd = 0, sp = 0, sc = 0;
      for (const o of r.ocorrencias) {
        const modo = ct.indicesAcumulados;
        const mesmoMes = modo === 'MES_DO_VENCIMENTO' || (modo === 'MES_SUBSEQUENTE_E_MES_DO_VENCIMENTO' && v.ocorrencia !== 'MENSAL');
        o.indice = fatorCorrecao(T, p.atualizacao, liq, o.vencimento, OPCOES.tabelasAte, mesmoMes);
        // "zerar valor negativo" do PJe-Calc: mês com pago acima do devido não abate dos outros (Damásio)
        o.diferenca = r2(zera(v) ? Math.max(0, o.devido - o.pago) : o.devido - o.pago);
        o.corrigido = r2(o.diferenca * o.indice);
        sd += o.devido; sp += o.pago; sc += o.corrigido;
      }
      const conta = v.ativa && v.compoePrincipal !== 'NAO';
      if (conta) { totDevido += sd; totPago += sp; totCorrigido += sc; }
      return { id: v.id, nome: v.nome, tipo: v.tipo, ativa: v.ativa, compoePrincipal: conta, ocorrencias: r.ocorrencias,
               verba: v, devido: r2(sd), pago: r2(sp), corrigido: r2(sc) };
    });
    const out = { diasAviso: aviso, fimProjetado, verbas, avisos,
                  totais: { devido: r2(totDevido), pago: r2(totPago), corrigido: r2(totCorrigido) } };
    encargos(out, caso, T);
    out.avisos.push(...avisosJuros); avisosJuros.clear();
    out.avisos = [...new Set(out.avisos)];
    out.verbas.forEach(v => delete v.verba);
    return out;
  }

  // ---------- cartão de ponto ----------
  // Apura, dia a dia, as batidas (entrada/saída) segundo a configuração do PJe-Calc:
  // hora noturna urbana (22h às 5h) com redução ficta de 52min30s, jornada por dia da semana,
  // tolerância diária (art. 58, §1º, CLT), domingo e feriado com jornada zero e, no critério mais
  // favorável, comparação semanal (segunda a domingo) entre extras diárias e excesso da jornada semanal.
  const DIAS_CFG = ['Dom', 'SegundaFeira', 'TercaFeira', 'QuartaFeira', 'QuintaFeira', 'SextaFeira', 'Sab'];
  const hm = s => { const [h, m] = String(s || '00:00').split(':').map(Number); return h * 60 + m; };
  const r2h = v => Math.round(v * 100 + 1e-7) / 100;

  function apurarCartao(ap, cal) {
    const cfg = ap.config, jorn = DIAS_CFG.map(d => hm(cfg['valorJornadaDiaria' + d]));
    const tolDia = hm(cfg.toleranciaPorDia), ficta = cfg.considerarReducaoFictaDaHoraNoturna === 'true';
    const rural = cfg.horarioNoturnoApuracaroCartao && cfg.horarioNoturnoApuracaroCartao !== 'ATIVIDADE_URBANA';
    const [nIni, nFim] = rural ? [21 * 60, 5 * 60] : [22 * 60, 5 * 60];
    const fator = ficta && !rural ? 60 / 52.5 : 1;
    const forma = cfg.formaDeApuracaoCartao || 'HORAS_EXTRAS_EXCEDENTES_DA_JORNADA_DIARIA';
    const semanal = parseFloat(cfg.qtJornadaSemanal || 0) * 60;
    const sumula60 = cfg.horarioProrrogadoSumula60 === 'true';
    const feriado = d => cfg.considerarFeriados === 'true' && cal.ehFeriado(d);
    const dias = {};
    for (const [dia, pares] of Object.entries(ap.batidas || {})) {
      let tot = 0, noc = 0, prorrog = 0, base = null;
      // Súmula 60, II, TST: jornada cumprida no período noturno inteiro (início até as 22h e fim depois
      // das 5h) e prorrogada: as horas depois das 5h também são noturnas
      const ini0 = hm(pares[0][0]);
      for (const [e, s] of pares) {
        let a = hm(e), b = hm(s);
        if (base == null) base = a; else if (a < base) a += 1440;
        if (b <= a % 1440 && b < a) b += 1440 * Math.ceil((a - b) / 1440); if (b <= a) b += 1440;
        tot += b - a;
        for (let t = a; t < b; t++) { const m = t % 1440; if (m >= nIni || m < nFim) noc++; else if (sumula60 && ini0 >= 12 * 60 && ini0 <= nIni && t >= 1440 + nFim) prorrog++; }
      }
      // intervalo que não está nas marcações (dia com uma só entrada e saída): sai do total, sem tirar
      // horas noturnas (como na apuração do cartão do Damasio: 21:30 às 06:20 = 7h noturnas + prorrogação − 1h)
      const iv = pares.length === 1 && cfg.intervaloDescontoTotal ? Math.min(hm(cfg.intervaloDescontoTotal), tot) : 0;
      const trab = tot - iv + (noc + prorrog) * (fator - 1);
      const diurnas = tot - noc - prorrog - iv;
      const w = D(dia).getUTCDay();
      const ehFer = feriado(dia), ehDom = w === 0, trabalhou = tot > 0;
      const separado = (ehDom && cfg.extraDescansoSeparado === 'true') || (ehFer && cfg.extraFeriadoSeparado === 'true');
      const jd = ehFer ? 0 : jorn[w];
      const exc = trab - jd;
      dias[dia] = { horasTrabalhadas: trab / 60, horasNoturnas: (noc + prorrog) * fator / 60,
                    horasExtrasDiaria: forma === 'NAO_APURAR_HORAS_EXTRAS' || separado ? 0 : (exc > tolDia ? exc / 60 : 0), horasExtrasSemanal: 0,
                    horasDomingo: separado && ehDom ? trab / 60 : 0, horasFeriado: separado && ehFer && !ehDom ? trab / 60 : 0,
                    // noturnas para o total do mês: trabalhadas menos diurnas, já arredondadas (como o PJe-Calc soma)
                    // (com a Súmula 60 inclui a prorrogação; sem ela, só as noturnas)
                    noturnasMes: sumula60 ? r2h(trab / 60) - r2h(diurnas / 60) : r2h((noc + prorrog) * fator / 60),
                    qtRepousoTrabalhado: trabalhou && ehDom ? 1 : 0, qtFeriadoTrabalhado: trabalhou && ehFer ? 1 : 0,
                    qtFeriadoRepousoTrabalhado: trabalhou && (ehDom || ehFer) ? 1 : 0, dias: trabalhou ? 1 : 0 };
    }
    if (forma === 'HORAS_EXTRAS_PELO_CRITERIO_MAIS_FAVORAVEL' && semanal) {
      const semanas = {};
      for (const dia of Object.keys(dias)) {                 // semana de segunda a domingo
        const w = D(dia).getUTCDay(), dom = addDias(dia, w === 0 ? 0 : 7 - w);
        (semanas[dom] || (semanas[dom] = [])).push(dia);
      }
      for (const [dom, ds] of Object.entries(semanas)) {
        const diaria = ds.reduce((s, d) => s + r2h(dias[d].horasExtrasDiaria), 0);
        // feriado na semana reduz a jornada semanal pela jornada daquele dia
        let jSem = semanal;
        // (feriado no sábado não reduz: Vinicius, semana de 15 a 21/11/2021)
        for (let k = 6; k >= 0; k--) { const d = addDias(dom, -k), w = D(d).getUTCDay(); if (feriado(d) && w !== 6) jSem -= jorn[w]; }
        const exc = ds.reduce((s, d) => s + r2h(dias[d].horasTrabalhadas), 0) - jSem / 60;
        if (exc > diaria + 1e-9) {
          ds.forEach(d => { dias[d].horasExtrasDiaria = 0; });
          (dias[dom] || (dias[dom] = { horasTrabalhadas: 0, horasNoturnas: 0, horasExtrasDiaria: 0, horasExtrasSemanal: 0 })).horasExtrasSemanal = exc;
        }
      }
    }
    for (const d of Object.values(dias)) for (const k in d) d[k] = r2h(d[k]);
    return dias;
  }

  // ---------- juros de mora ----------
  // Taxa acumulada (em %) de uma parcela vencida em `venc`: TR diária (TRD, juros simples) do dia
  // seguinte ao vencimento até a véspera do ajuizamento e taxa legal diária (art. 406 do CC) do
  // ajuizamento até a liquidação. Regra conferida contra o PJe-Calc (ADC 58 e Lei 14.905/2024).
  //
  // Combinação de juros (Correção, Juros e Multa > combinar com outro juros a partir de): o juros
  // padrão (TRD) corre até a véspera da 1ª combinação e cada combinação vale da sua data até a
  // próxima (ou a liquidação). A data nem sempre é o ajuizamento: Eraldo e Leandro têm taxa legal
  // a partir de 30/08/2024 com ajuizamento em 2026. Regras de cada juros (conferidas no PJe-Calc):
  //  - TAXA_LEGAL: soma da taxa legal diária.
  //  - SELIC (André, Vinícius): tabela mensal da SELIC Fazenda; 1º mês pró-rata pelos dias
  //    (do dia de início ao fim do mês), meses cheios até 2 meses antes da liquidação e 1% no mês
  //    anterior à liquidação.
  //  - SELIC_FAZENDA (Damásio, EC 113/2021): mesma tabela, 1º mês pró-rata e meses cheios até o mês
  //    anterior à liquidação.
  function taxaJuros(T, ct, at, venc) {
    let t = 0;
    const ini = addDias(venc, 1), aj = ct.ajuizamento, liq = ct.liquidacao, ate = OPCOES.tabelasAte;
    const val = x => (x == null ? 0 : Array.isArray(x) ? (ate && x[1] && x[1] > ate ? 0 : x[0]) : x);
    const combos = (at.combinacoesJuros || []).filter(c => c.juros && c.aPartir).sort((a, b) => (a.aPartir < b.aPartir ? -1 : 1));
    const lista = combos.length ? combos : [{ juros: OPCOES.semTaxaLegal ? null : 'TAXA_LEGAL', aPartir: aj }];
    if (at.jurosPreJudicial !== false) for (let s = ini; s < lista[0].aPartir; s = addDias(s, 1)) t += val(T.trDiaria[s]);
    lista.forEach((c, i) => {
      const de = max(c.aPartir, ini), ate_ = i + 1 < lista.length ? addDias(lista[i + 1].aPartir, -1) : liq;
      if (de > ate_) return;
      if (c.juros === 'TAXA_LEGAL') { for (let s = de; s <= ate_; s = addDias(s, 1)) t += val(T.taxaLegalDiaria[s]); return; }
      if (c.juros === 'SELIC' || c.juros === 'SELIC_FAZENDA') {
        // parcela já vencida no início da combinação: pró-rata do mês de início. Parcela que vence depois:
        // SELIC a partir do mês seguinte ao vencimento, sem pró-rata (André: vencimento 26/06 só corre de julho)
        const tab = T.selicFazenda || {}, ultimo = c.juros === 'SELIC' ? addMes(ym(ate_), -2) : addMes(ym(ate_), -1);
        if (ym(de) >= ym(ate_)) return;                       // começa no mês da liquidação: sem juros
        let m0 = ym(de);
        if (ini <= c.aPartir) {
          const dm = diasNoMes(m0);
          if (m0 <= ultimo) t += val(tab[m0]) * (dm - +de.slice(8, 10) + 1) / dm;
        } else m0 = addMes(ym(venc), 0);
        for (let m = addMes(m0, 1); m <= ultimo; m = addMes(m, 1)) t += val(tab[m]);
        if (c.juros === 'SELIC') t += 1;
        return;
      }
      if (c.juros) avisosJuros.add(`Juros ${c.juros} ainda não suportados: conferir no PJe-Calc`);
    });
    return t;
  }
  const avisosJuros = new Set();

  // SELIC do INSS (art. 43 da Lei 8.212/91): soma das taxas mensais a partir da competência
  // (13º de dezembro: a partir do mês anterior), publicadas até o mês anterior à liquidação, mais 1%.
  function taxaSelicInss(T, comp, eh13, liq) {
    let t = 0; const ini = eh13 && comp.endsWith('-12') ? addMes(comp, -1) : comp;
    // tabela "como estava" numa data: a SELIC de referência M só existe a partir do mês M
    let lim = addMes(ym(liq), -1);
    if (OPCOES.tabelasAte) lim = min(lim, addMes(ym(OPCOES.tabelasAte), -1));
    for (const [c, [taxa, ref]] of Object.entries(T.selicInss)) if (c >= ini && ref <= lim) t += taxa;
    return t + 1;
  }
  const trunc2 = v => Math.sign(v) * Math.floor(Math.abs(v) * 100 + 1e-6) / 100;
  // arredondamento bancário (meio centavo vai para o par), usado pelo PJe-Calc nas contribuições
  const r2par = v => {
    const x = Math.abs(v) * 100, b = Math.floor(x), f = x - b;
    const n = Math.abs(f - 0.5) < 1e-7 ? (b % 2 === 0 ? b : b + 1) : Math.round(x);
    return Math.sign(v) * n / 100;
  };

  // contribuição do segurado: progressiva a partir de 03/2020; antes, alíquota da faixa sobre o total
  function inssSegurado(T, comp, base) {
    const tab = T.inss[comp] || T.inss[Object.keys(T.inss).filter(k => k <= comp).sort().pop()];
    if (!tab || base <= 0) return 0;
    if (comp >= '2020-03') {
      let v = 0, ant = 0;
      for (const [fim, aliq] of tab.faixas) { const topo = fim == null ? Infinity : fim; if (base > ant) v += (Math.min(base, topo) - ant) * aliq / 100; ant = topo; }
      return Math.min(v, tab.teto || Infinity);
    }
    const fx = tab.faixas.find(([fim]) => fim == null || base <= fim) || tab.faixas[tab.faixas.length - 1];
    return Math.min(base * fx[1] / 100, tab.teto || Infinity);
  }

  // fração de cada ocorrência que entra na base do tributo (férias indenizadas não incidem)
  function fatorIncide(v, o, tributo) {
    if (!v.incide || !v.incide[tributo]) return 0;
    if (o.parteSalarial != null) return o.parteSalarial;
    return 1;
  }

  // ---------- encargos: juros, FGTS, INSS, IR, honorários, custas ----------
  function encargos(out, caso, T) {
    const p = caso.parametros, ct = p.contrato, at = p.atualizacao, E = p.encargos || {};
    const liq = ct.liquidacao;
    const ativas = out.verbas.filter(v => v.compoePrincipal);
    const eh13 = v => v.verba.caracteristica === 'DECIMO_TERCEIRO_SALARIO';

    // Início dos juros: o vencimento; nas verbas "vencidas e vincendas" (ex.: dano moral, Súmula 439 TST),
    // parcela que vence depois do ajuizamento tem juros desde o ajuizamento.
    const inicioJuros = (v, o) => v.verba.jurosDoAjuizamento === 'OCORRENCIAS_VENCIDAS_E_VINCENDAS' && o.vencimento > ct.ajuizamento ? ct.ajuizamento : o.vencimento;
    const chaveJuros = (v, o) => inicioJuros(v, o) + '#' + o.vencimento;
    // INSS por competência (normal e 13º separados)
    const comps = {};   // chave comp|13 -> {comp, eh13, base, grupos: {venc: base}}
    for (const v of ativas) for (const o of v.ocorrencias) {
      const f = fatorIncide(v.verba, o, 'inss'); if (!f) continue;
      const comp = ym(o.vencimento), k = comp + '|' + (eh13(v) ? 1 : 0), b = r2(o.diferenca * f);
      const c = comps[k] || (comps[k] = { comp, eh13: eh13(v), base: 0, grupos: {} });
      const k2 = chaveJuros(v, o); c.base += b; c.grupos[k2] = (c.grupos[k2] || 0) + b;
    }
    const I = Object.assign({ aliquotaEmpresa: 20, aliquotaRat: 0, aliquotaTerceiros: 0, apurarSegurado: true }, E.inss || {});
    if (I.aliquotaEmpresa == null) { I.aliquotaEmpresa = 0; out.avisos.push('INSS da empresa: alíquota por atividade/período ainda não suportada'); }
    I.aliquotaRat = I.aliquotaRat || 0; I.aliquotaTerceiros = I.aliquotaTerceiros || 0;
    const inss = [];
    const csPorVenc = {};
    for (const c of Object.values(comps).sort((a, b) => (a.comp + a.eh13).localeCompare(b.comp + b.eh13))) {
      c.base = r2(c.base);
      const segurado = I.apurarSegurado ? inssSegurado(T, c.comp, c.base) : 0;
      const aliqEf = c.base ? segurado / c.base : 0;
      const taxa = taxaSelicInss(T, c.comp, c.eh13, liq);
      const linha = { comp: c.comp, eh13: c.eh13, base: c.base, aliquotaSegurado: aliqEf * 100, segurado: r2par(segurado),
        empresa: r2par(c.base * I.aliquotaEmpresa / 100), sat: r2par(c.base * (I.aliquotaRat || 0) / 100),
        terceiros: r2par(c.base * (I.aliquotaTerceiros || 0) / 100), taxaSelic: taxa };
      for (const k of ['segurado', 'empresa', 'sat', 'terceiros']) linha['juros_' + k] = trunc2(linha[k] * taxa / 100);
      inss.push(linha);
      // rateio da contribuição do segurado entre as datas de vencimento da competência
      // (a primeira data fica com a diferença de arredondamento, como no PJe-Calc)
      const datas = Object.keys(c.grupos).sort();
      let resto = linha.segurado;
      for (const d of datas.slice(1)) { const x = r2(c.grupos[d] * aliqEf); csPorVenc[d] = (csPorVenc[d] || 0) + x; resto -= x; }
      csPorVenc[datas[0]] = (csPorVenc[datas[0]] || 0) + r2(resto);
    }

    // juros sobre as verbas, por data de vencimento, depois de deduzir o INSS do segurado
    const grupos = {};
    for (const v of ativas) for (const o of v.ocorrencias) {
      if (!o.corrigido) continue;
      const k = chaveJuros(v, o);
      (grupos[k] || (grupos[k] = { chave: k, venc: inicioJuros(v, o), total: 0, itens: [] })).total += o.corrigido;
      o.baseInssJuros = r2(o.diferenca * fatorIncide(v.verba, o, 'inss'));
      grupos[k].itens.push(o);
    }
    const juros = Object.values(grupos).sort((a, b) => a.chave.localeCompare(b.chave)).map(g => {
      g.total = r2(g.total);
      const cs = at.baseJuros === 'VERBAS' ? 0 : r2(csPorVenc[g.chave] || 0);
      const taxa = taxaJuros(T, ct, at, g.venc), capital = r2(g.total - cs), j = r2(capital * taxa / 100);
      // rateio dos juros entre as verbas do grupo (demonstrativo por verba): o INSS do segurado sai só
      // das verbas com incidência, proporcional à base de cada uma, como no resumo do PJe-Calc
      const somaBase = g.itens.reduce((s, o) => s + o.baseInssJuros, 0);
      for (const o of g.itens) o.juros = r2((o.corrigido - (somaBase ? cs * o.baseInssJuros / somaBase : 0)) * taxa / 100);
      return { venc: g.venc, totalVerbas: g.total, contribuicao: cs, capital, taxa, juros: j };
    });
    for (const v of out.verbas) v.juros = r2(v.ocorrencias.reduce((s, o) => s + (o.juros || 0), 0));
    const jurosVerbas = r2(juros.reduce((s, x) => s + x.juros, 0));

    // FGTS: 8% por competência, corrigido e com juros; multa de 40% na rescisão
    const F = E.fgts;
    let fgts = null;
    if (F) {
      const base = {}, semAviso = {};
      for (const v of ativas) for (const o of v.ocorrencias) {
        const f = fatorIncide(v.verba, o, 'fgts'); if (!f) continue;
        // só as competências dentro do período do FGTS configurado no cálculo
        if ((F.ini && ym(o.vencimento) < ym(F.ini)) || (F.fim && ym(o.vencimento) > ym(F.fim))) continue;
        const comp = ym(o.vencimento), b = r2(o.diferenca * f);
        base[comp] = (base[comp] || 0) + b;
        if (v.verba.caracteristica !== 'AVISO_PREVIO') semAviso[comp] = (semAviso[comp] || 0) + b;
      }
      const idxDemissao = ct.demissao ? fatorCorrecao(T, at, liq, ct.demissao, OPCOES.tabelasAte) : 1;
      const linhas = Object.keys(base).sort().map(comp => {
        const b = r2(base[comp]), dev = r2par(b * F.aliquota / 100), venc = fimMes(comp);
        // a correção incide sobre o FGTS sem arredondar (base x alíquota x índice), como no PJe-Calc
        const indice = fatorCorrecao(T, at, liq, venc, OPCOES.tabelasAte), corr = r2(b * F.aliquota / 100 * indice);
        // base da multa: FGTS da competência corrigido até a demissão (sem o aviso, se assim configurado)
        const bm = F.excluirAvisoDaMulta ? r2(semAviso[comp] || 0) : b;
        const indiceMulta = indice / idxDemissao;
        return { comp, base: b, devido: dev, indice, corrigido: corr, juros: r2(corr * taxaJuros(T, ct, at, venc) / 100),
                 baseMulta: r2(bm * F.aliquota / 100) * indiceMulta, indiceMulta };   // soma sem arredondar a linha
      });
      let multa = null;
      if (F.multa && ct.demissao) {
        const b = r2(linhas.reduce((s, l) => s + l.baseMulta, 0));
        const dev = r2(b * F.multaPct / 100), venc = fimMes(ym(ct.demissao));
        const corr = r2(dev * idxDemissao);
        multa = { base: b, pct: F.multaPct, devido: dev, indice: idxDemissao, corrigido: corr, juros: r2(corr * taxaJuros(T, ct, at, venc) / 100) };
      }
      const soma = k => r2(linhas.reduce((s, l) => s + l[k], 0));
      fgts = { linhas, multa, corrigido: soma('corrigido'), juros: soma('juros'),
               total: r2(soma('corrigido') + soma('juros') + (multa ? multa.corrigido + multa.juros : 0)),
               destino: F.destino, compoePrincipal: F.compoePrincipal !== 'NAO' };
    }

    // totais do reclamante
    const corrigidoVerbas = r2(ativas.reduce((s, v) => s + v.corrigido, 0));
    const brutoVerbas = r2(corrigidoVerbas + jurosVerbas);
    const fgtsNoBruto = fgts && fgts.compoePrincipal ? fgts.total : 0;
    const bruto = r2(brutoVerbas + fgtsNoBruto);
    const deducaoInss = I.cobrarDoReclamante === false ? 0 : r2(inss.reduce((s, l) => s + l.segurado, 0));
    const depositoFgts = fgts && fgts.destino === 'DEPOSITAR' ? fgtsNoBruto : 0;

    // imposto de renda (RRA, art. 12-A da Lei 7.713/88): anos anteriores pela tabela acumulada
    const irpf = impostoRenda(T, ct, E.irpf, ativas, inss);

    // honorários e custas
    const honorarios = (E.honorarios || []).map(h => {
      let valor = h.valor || 0, base = null;
      if (h.tipoValor === 'CALCULADO') {
        base = { BRUTO_MENOS_CONTRIBUICAO_SOCIAL: bruto - deducaoInss, BRUTO: bruto, LIQUIDO: bruto - deducaoInss - irpf.total }[h.base];
        if (base == null) { base = bruto - deducaoInss; out.avisos.push(`Honorários: base ${h.base} ainda não suportada (usei bruto menos INSS)`); }
        base = r2(base); valor = r2(base * (h.aliquota || 0) / 100);
      }
      return { descricao: h.descricao, credor: h.credor, devedor: h.devedor, tipo: h.tipo, base, aliquota: h.aliquota, valor };
    });
    const honorReclamante = r2(honorarios.filter(h => h.devedor === 'RECLAMANTE').reduce((s, h) => s + h.valor, 0));
    const C = E.custas || {};
    let custas = C.reclamado === 'INFORMADA' ? (C.valorReclamado || 0) : 0;
    if (C.reclamado && !['INFORMADA', 'NAO_SE_APLICA', 'CALCULADA_2_POR_CENTO'].includes(C.reclamado)) out.avisos.push(`Custas ${C.reclamado} ainda não calculadas`);

    const liquido = r2(bruto - depositoFgts - deducaoInss - irpf.total - honorReclamante);
    const somaI = k => r2(inss.reduce((s, l) => s + l[k] + l['juros_' + k], 0));
    const inssReclamante = somaI('segurado'), inssReclamado = r2(somaI('empresa') + somaI('sat') + somaI('terceiros'));
    const honorReclamado = r2(honorarios.filter(h => h.devedor !== 'RECLAMANTE').reduce((s, h) => s + h.valor, 0));
    // custas de 2% (art. 789 da CLT): base = tudo que a reclamada paga, menos as próprias custas (bruto devido ao
    // reclamante + débitos da reclamada); mínimo R$ 10,64 e máximo de 4 tetos do RGPS, como no PJe-Calc
    // (Flávio: 7.195,22 + 843,66 + 653,36 + 2.003,71 + 1.269,58 + 4.805,00 = 16.770,53 → 335,41)
    if (C.reclamado === 'CALCULADA_2_POR_CENTO') {
      const baseCustas = r2(liquido + depositoFgts + inssReclamante + inssReclamado + irpf.total + honorReclamado);
      custas = r2(Math.min(Math.max(baseCustas * 0.02, 10.64), 33902.20));
    }
    Object.assign(out, { juros, inss, fgts, irpf, honorarios });
    Object.assign(out.totais, {
      jurosVerbas, brutoVerbas, bruto, depositoFgts, deducaoInss, liquido,
      fgts: fgts ? fgts.total : 0, inssReclamante, inssReclamado, impostoRenda: irpf.total,
      honorarios: honorReclamado, custas,
      totalReclamado: r2(liquido + depositoFgts + inssReclamante + inssReclamado + irpf.total + honorReclamado + custas),
    });
  }

  // Imposto de renda sobre rendimentos recebidos acumuladamente.
  // Anos anteriores ao da liquidação: tabela progressiva × número de meses (tributação exclusiva).
  // Ano da liquidação: tabela mensal. Juros de mora não são tributados. Tabela do mês da liquidação.
  // Redução da Lei 15.270/2025 a partir de 2026 (isenção até R$ 5.000 e redução até R$ 7.350 por mês).
  function impostoRenda(T, ct, R, ativas, inss) {
    const res = { total: 0, blocos: [], conferir: true };
    if (!R || !R.apurar) return res;
    const liq = ct.liquidacao, anoLiq = liq.slice(0, 4);
    const tab = T.irpf[ym(liq)] || T.irpf[Object.keys(T.irpf).filter(k => k <= ym(liq)).sort().pop()];
    const blocos = { ant: { verbas: 0, meses: new Set(), cs: 0 }, atual: { verbas: 0, meses: new Set(), cs: 0 } };
    for (const v of ativas) for (const o of v.ocorrencias) {
      const f = fatorIncide(v.verba, o, 'irpf'); if (!f || !o.corrigido) continue;
      const b = o.vencimento.slice(0, 4) < anoLiq ? blocos.ant : blocos.atual;
      b.verbas += r2(o.corrigido * f);
      b.meses.add(ym(o.vencimento) + (v.verba.caracteristica === 'DECIMO_TERCEIRO_SALARIO' ? '13' : ''));
    }
    for (const l of inss) (l.comp.slice(0, 4) < anoLiq ? blocos.ant : blocos.atual).cs += R.deduzirInss ? l.segurado : 0;
    const faixa1 = tab.faixas[0][0];
    for (const [nome, b] of Object.entries(blocos)) {
      if (b.verbas <= 0) continue;
      const n = nome === 'ant' ? b.meses.size : 1;
      const simplificado = r2(faixa1 * 0.25 * n);
      const legais = b.cs + (R.dependentes || 0) * (tab.dependente || 0) * n;
      const base = Math.max(0, r2(b.verbas - Math.max(legais, simplificado)));
      let imposto = 0;
      for (const [fim, aliq, ded] of tab.faixas) if (fim == null || base <= fim * n) { imposto = base * aliq / 100 - ded * n; break; }
      imposto = Math.max(0, imposto);
      if (liq >= '2026-01-01') {      // Lei 15.270/2025
        const isen = (tab.tetoIsencao || 5000) * n, red = (tab.tetoReducao || 7350) * n;
        if (b.verbas <= isen) imposto = 0;
        else if (b.verbas <= red) imposto = Math.max(0, imposto - Math.max(0, 978.62 * n - 0.133145 * b.verbas));
      }
      res.blocos.push({ bloco: nome === 'ant' ? 'anos anteriores' : 'ano da liquidação', verbas: r2(b.verbas), meses: n,
        contribuicao: r2(b.cs), simplificado, base, imposto: r2(imposto) });
      res.total += r2(imposto);
    }
    res.total = r2(res.total);
    return res;
  }

  // feriadosLocais: feriado estadual e municipal entram no RSR (decisão da Carol em 23/11/2026, como manda a
  // lei e como o contador fez em Damásio, Marcos, Danilo e Flávio; em Reinaldo e Anderson ele não contou)
  // (Reinaldo: 09/07 e 20/11 em Santo André ficaram de fora). Padrão = igual ao contador.
  const OPCOES = { feriadosLocais: true, tabelasAte: null, indiceAte: null, cartaoDasBatidas: true };
  function apurarCartoes(caso, T) {
    // no cartão o PJe-Calc considera os feriados estaduais (09/07) e municipais (20/11 e 08/04 em Santo André)
    const cal = calendario(T, caso.parametros.contrato, { estadual: true, municipal: true }), out = {};
    for (const ap of caso.parametros.apuracoesCartao || []) Object.assign(out, apurarCartao(ap, cal));
    return out;
  }

  // Totais mensais do cartão (mês de fechamento conforme o dia de fechamento do cálculo) e
  // as colunas do cartão mensal que as verbas usam como quantidade, identificadas pelo nome.
  const COLUNAS = [
    [/ext.*(repous|descans).*feriad|ext.*feriad.*repous/i, d => d.horasDomingo + d.horasFeriado],
    [/ext.*feriad/i, d => d.horasFeriado], [/ext.*(repous|descans|doming)/i, d => d.horasDomingo],
    [/feriados?\s+e\s+repousos?\s+trab/i, d => d.qtFeriadoRepousoTrabalhado],
    [/feriados?\s+trab/i, d => d.qtFeriadoTrabalhado], [/repousos?\s+trab/i, d => d.qtRepousoTrabalhado],
    [/ext/i, d => d.horasExtrasDiaria + d.horasExtrasSemanal], [/notur/i, d => d.noturnasMes],
    [/dias/i, d => d.dias], [/trab/i, d => d.horasTrabalhadas],
  ];
  function totaisMensais(caso, T) {
    const dias = apurarCartoes(caso, T), fech = caso.parametros.contrato.diaFechamentoMes || 31, out = {};
    for (const [dia, d] of Object.entries(dias)) {
      const m = +dia.slice(8) > fech ? addMes(ym(dia), 1) : ym(dia);
      const t = out[m] || (out[m] = {});
      for (const [k, v] of Object.entries(d)) t[k] = (t[k] || 0) + v;
    }
    for (const t of Object.values(out)) for (const k in t) t[k] = r2h(t[k]);
    return out;
  }
  function colunasDoCartao(caso, T) {
    const tot = totaisMensais(caso, T), res = {};
    for (const [id, c] of Object.entries(caso.parametros.cartoes || {})) {
      const regra = COLUNAS.find(([re]) => re.test(c.nome));
      if (!regra) continue;
      const valores = {};
      for (const m of new Set([...Object.keys(c.valores), ...Object.keys(tot)])) valores[m] = tot[m] ? r2h(regra[1](tot[m])) : 0;
      res[id] = { nome: c.nome, valores };
    }
    return res;
  }
  // Valor na data da distribuição: o mesmo cálculo com a liquidação no dia do ajuizamento, correção até lá
  // e juros só da fase pré-judicial (TRD). Parcelas que vencem a partir do ajuizamento (dano moral arbitrado
  // na sentença, parcelas vincendas) não existiam na distribuição: ficam à parte, pelo valor nominal.
  function posicaoNaDistribuicao(caso, T, opcoes) {
    const aj = caso.parametros.contrato.ajuizamento;
    if (!aj) return null;
    const c2 = JSON.parse(JSON.stringify(caso));
    c2.parametros.contrato.liquidacao = aj;
    const ant = OPCOES.semTaxaLegal; let r;
    try { r = calcular(c2, T, Object.assign({}, opcoes || {}, { semTaxaLegal: true })); } finally { OPCOES.semTaxaLegal = ant; }
    const verbas = r.verbas.filter(v => v.ativa && v.compoePrincipal).map(v => {
      let corrigido = 0, posterior = 0;
      for (const o of v.ocorrencias) if (o.vencimento < aj) corrigido += o.corrigido; else posterior += o.diferenca;
      return { id: v.id, nome: v.nome, corrigido: r2(corrigido), posterior: r2(posterior) };
    }).filter(v => v.corrigido || v.posterior);
    const juros = r2((r.juros || []).filter(j => j.venc < aj).reduce((s, j) => s + j.juros, 0));
    let fgts = 0;
    if (r.fgts) {
      fgts = r.fgts.linhas.filter(l => l.comp < ym(aj)).reduce((s, l) => s + l.corrigido + (l.juros || 0), 0);
      if (r.fgts.multa && caso.parametros.contrato.demissao < aj) fgts += r.fgts.multa.corrigido + (r.fgts.multa.juros || 0);
    }
    const corrigido = r2(verbas.reduce((s, v) => s + v.corrigido, 0)), posterior = r2(verbas.reduce((s, v) => s + v.posterior, 0));
    return { data: aj, verbas, corrigido, juros, fgts: r2(fgts), total: r2(corrigido + juros + fgts), posterior };
  }
  global.MotorPC = { calcular, posicaoNaDistribuicao, inssSegurado, apurarCartoes, totaisMensais, colunasDoCartao, pascoa, fatorCorrecao, OPCOES, versao: '0.3.0' };
})(typeof window !== 'undefined' ? window : globalThis);
