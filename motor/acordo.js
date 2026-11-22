/* Discriminação de verbas de acordo · Plataforma de Cálculos Peixoto & Cury
 *
 * Reproduz o modelo do contador (conferido na discriminação do processo 1000177-13.2026.5.02.0435):
 *  1. Percentuais: cada verba pesa o que pesa no cálculo-base (verbas corrigidas, uma linha de juros de mora,
 *     FGTS e multa de 40%), ou percentuais informados.
 *  2. Bruto calculado de trás para frente: bruto = líquido + INSS do reclamante + IR.
 *  3. INSS só sobre as verbas salariais, base repartida igualmente nas competências do período
 *     (cada mês e o 13º de cada ano), tabela progressiva de cada competência; empresa, SAT e terceiros.
 *  4. Juros SELIC do INSS (regra do contador, escolhida pela usuária em 22/11/2026): soma da SELIC mensal do
 *     próprio mês da competência até o último mês publicado (selicAte), sem o 1% do mês do pagamento.
 *     Difere do PJe-Calc, que começa no vencimento e soma 1%.
 *  5. IR pelos rendimentos recebidos acumuladamente: base = salariais - INSS, dividida pelo nº de competências.
 *  6. FGTS para o eSocial: valor do FGTS repartido pelos meses do período; multa no último mês.
 *  7. Custo total = líquido + INSS do reclamante + INSS da empresa (empresa, SAT, terceiros) + SELIC + IR + honorários.
 */
(function (global) {
  'use strict';
  const r2 = v => Math.round((v + Math.sign(v) * 1e-9) * 100) / 100;
  const proxMes = m => { const [a, b] = m.split('-').map(Number); return b === 12 ? `${a + 1}-01` : `${a}-${String(b + 1).padStart(2, '0')}`; };

  // percentuais a partir de um resultado do motor (MotorPC.calcular): natureza pela incidência de INSS da verba
  function percentuaisDoCalculo(caso, r) {
    const itens = [];
    for (const v of r.verbas.filter(v => v.ativa && v.compoePrincipal && v.corrigido)) {
      const pv = caso.parametros.verbas.find(x => x.id === v.id) || {};
      itens.push({ nome: v.nome, natureza: pv.incide && pv.incide.inss ? 'salarial' : 'indenizatoria', valor: v.corrigido });
    }
    if (r.fgts) {
      itens.push({ nome: 'FGTS 8%', natureza: 'indenizatoria', valor: r.fgts.corrigido + r.fgts.juros, fgts: 'fgts' });
      if (r.fgts.multa) itens.push({ nome: `Multa de ${r.fgts.multa.pct}% do FGTS`, natureza: 'indenizatoria', valor: r.fgts.multa.corrigido + r.fgts.multa.juros, fgts: 'multa' });
    }
    if (r.totais.jurosVerbas) itens.push({ nome: 'Juros de mora', natureza: 'indenizatoria', valor: r.totais.jurosVerbas });
    const tot = itens.reduce((s, x) => s + x.valor, 0);
    return itens.filter(x => x.valor > 0).map(x => Object.assign(x, { pct: x.valor / tot }));
  }

  function competencias(ini, fim) {
    const out = []; let m = ini.slice(0, 7);
    for (let k = 0; m <= fim.slice(0, 7) && k < 600; m = proxMes(m), k++) {
      out.push({ comp: m, eh13: false });
      if (m.endsWith('-12')) out.push({ comp: m, eh13: true });
    }
    return out;
  }

  // SELIC mensal "do próprio mês": a tabela do PJe-Calc guarda a taxa com o mês de referência (ref)
  function selicContador(T, comp, ate) {
    let s = 0;
    for (const [, [taxa, ref]] of Object.entries(T.selicInss)) if (ref >= comp && ref <= ate) s += taxa;
    return Math.round(s * 100) / 100;
  }

  function irRra(T, base, n, pagamento) {
    const k = pagamento.slice(0, 7);
    const tab = T.irpf[k] || T.irpf[Object.keys(T.irpf).filter(x => x <= k).sort().pop()];
    let imposto = 0;
    for (const [fim, aliq, ded] of tab.faixas) if (fim == null || base <= fim * n) { imposto = base * aliq / 100 - ded * n; break; }
    imposto = Math.max(0, imposto);
    if (pagamento >= '2026-01-01') {      // Lei 15.270/2025 (mesma regra do motor)
      const isen = (tab.tetoIsencao || 5000) * n, red = (tab.tetoReducao || 7350) * n;
      if (base <= isen) imposto = 0;
      else if (base <= red) imposto = Math.max(0, imposto - Math.max(0, 978.62 * n - 0.133145 * base));
    }
    return r2(imposto);
  }

  /* p = { liquido, itens: [{nome, natureza, pct, fgts?}], periodo: {ini, fim}, pagamento (AAAA-MM-DD),
           selicAte (AAAA-MM, último mês de SELIC publicado), honorariosPct (sobre o líquido),
           aliquotas: {empresa: 20, sat: 3, terceiros: 0}, apurarIr: true } */
  function calcular(T, p) {
    const al = Object.assign({ empresa: 20, sat: 3, terceiros: 0 }, p.aliquotas || {});
    const comps = competencias(p.periodo.ini, p.periodo.fim), n = comps.length;
    const somaPct = p.itens.reduce((s, x) => s + x.pct, 0);
    const itens = p.itens.map(x => Object.assign({}, x, { pct: x.pct / somaPct }));
    const pSal = itens.filter(x => x.natureza === 'salarial').reduce((s, x) => s + x.pct, 0);
    // a tabela de cada competência dá a alíquota da parcela mensal; o total sai sem arredondar mês a mês
    // (contador: 7,5% x 40.536,38 = 3.040,23, e não 64 x 47,50)
    const inssDe = baseTotal => comps.reduce((s, c) => s + global.MotorPC.inssSegurado(T, c.comp, baseTotal / n), 0);
    // bruto de trás para frente: bruto = líquido + INSS do reclamante + IR (ponto fixo; converge em poucas voltas)
    let bruto = p.liquido;
    for (let i = 0; i < 50; i++) {
      const bs = r2(bruto * pSal), inss = r2(inssDe(bs)), ir = p.apurarIr === false ? 0 : irRra(T, r2(bs - inss), n, p.pagamento);
      const novo = r2(p.liquido + inss + ir);
      if (Math.abs(novo - bruto) < 0.005) { bruto = novo; break; }
      bruto = novo;
    }
    // valor de cada verba; o centavo de arredondamento vai para a maior
    const linhas = itens.map(x => Object.assign(x, { valor: r2(bruto * x.pct) }));
    const dif = r2(bruto - linhas.reduce((s, x) => s + x.valor, 0));
    if (dif) { const mx = linhas.reduce((a, b) => b.valor > a.valor ? b : a); mx.valor = r2(mx.valor + dif); }
    const baseInss = r2(linhas.filter(x => x.natureza === 'salarial').reduce((s, x) => s + x.valor, 0));
    const bm = r2(baseInss / n);
    const inss = comps.map(c => {
      const empregado = r2(global.MotorPC.inssSegurado(T, c.comp, bm));
      const empresa = r2(bm * al.empresa / 100), sat = r2(bm * al.sat / 100), terceiros = r2(bm * al.terceiros / 100);
      const taxa = selicContador(T, c.comp, p.selicAte);
      return { comp: c.comp, eh13: c.eh13, base: bm, empregado, empresa, sat, terceiros, taxaSelic: taxa,
               jurosEmpregado: r2(empregado * taxa / 100), jurosPatronal: r2((empresa + sat + terceiros) * taxa / 100) };
    });
    // totais sobre a base total, sem arredondar por competência (como o contador)
    const inssReclamante = r2(inssDe(baseInss));
    const inssEmpresa = r2(baseInss * (al.empresa + al.sat + al.terceiros) / 100);
    const selic = r2(comps.reduce((s, c) => {
      const t = selicContador(T, c.comp, p.selicAte);
      return s + (global.MotorPC.inssSegurado(T, c.comp, baseInss / n) + baseInss / n * (al.empresa + al.sat + al.terceiros) / 100) * t / 100;
    }, 0));
    const baseIr = r2(baseInss - inssReclamante), ir = p.apurarIr === false ? 0 : irRra(T, baseIr, n, p.pagamento);
    // FGTS para o eSocial: mês a mês (sem as linhas de 13º), multa no último mês
    const mesesF = comps.filter(c => !c.eh13).map(c => c.comp);
    const vF = r2(linhas.filter(x => x.fgts === 'fgts').reduce((s, x) => s + x.valor, 0));
    const vM = r2(linhas.filter(x => x.fgts === 'multa').reduce((s, x) => s + x.valor, 0));
    const fgtsMes = mesesF.length ? r2(vF / mesesF.length) : 0;
    const fgts = mesesF.map((m, i) => ({ comp: m, base: r2(fgtsMes / 0.08), fgts: fgtsMes, multa: i === mesesF.length - 1 ? vM : 0 }));
    const honorarios = r2(p.liquido * (p.honorariosPct || 0) / 100);
    const liquidoConf = r2(bruto - inssReclamante - ir);
    return {
      bruto, liquido: p.liquido, liquidoConferido: liquidoConf, linhas, competencias: n, baseInss, inss, inssReclamante, inssEmpresa,
      selic, baseIr, ir, irMensal: r2(baseIr / n), fgts, valorFgts: vF, valorMulta: vM, honorarios,
      custoTotal: r2(p.liquido + inssReclamante + inssEmpresa + selic + ir + honorarios),
      regraSelic: `SELIC mensal do mês da competência até ${p.selicAte.slice(5)}/${p.selicAte.slice(0, 4)}, sem o 1% do mês do pagamento (modelo do contador)`,
    };
  }

  global.AcordoPC = { calcular, percentuaisDoCalculo, competencias, selicContador, versao: '0.1.0' };
})(typeof window !== 'undefined' ? window : globalThis);
