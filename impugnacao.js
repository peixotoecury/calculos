/* Impugnação ou concordância · Plataforma de Cálculos Peixoto & Cury
 *
 * 1. lerCalculoPjeCalc(linhas): lê, sem IA, o "Resumo do Cálculo" de um PDF do PJe-Calc (cálculo do
 *    reclamante ou do perito): verbas (corrigido, juros, total), FGTS, líquido, bruto, contribuição social,
 *    honorários e total do reclamado. Cada linha de verba é conferida (corrigido + juros = total).
 * 2. comparar(caso, r, deles): nosso cálculo (motor) x o deles, verba a verba e nos totais.
 * 3. minutaDocx(...): minuta em Word (impugnação, art. 879, § 2º, da CLT, ou concordância), com os campos
 *    que dependem do processo marcados em amarelo para o advogado preencher.
 */
(function (global) {
  'use strict';
  const DIN = /\d{1,3}(?:\.\d{3})*,\d{2}/g;
  const valor = s => +String(s).replace(/\./g, '').replace(',', '.');
  const r2 = v => Math.round((v + Math.sign(v) * 1e-9) * 100) / 100;
  const norm = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9%]+/g, ' ').trim();
  const brl = v => (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  function lerCalculoPjeCalc(linhas) {
    const out = { verbas: [], fgts: [], honorarios: [], avisos: [] };
    const txt = linhas.join('\n');
    const pega = (re) => { const m = txt.match(re); return m ? valor(m[1]) : null; };
    // rótulo e valor na mesma linha (o mais comum); valor antes do rótulo só como alternativa
    out.liquido = pega(/L[íiÍI]quido Devido ao Reclamante[ \t]+([\d.]+,\d{2})/i) ?? pega(/([\d.]+,\d{2})[ \t]*L[íi]quido Devido ao Reclamante/i);
    out.bruto = pega(/Bruto Devido ao Reclamante[ \t]+([\d.]+,\d{2})/i) ?? pega(/([\d.]+,\d{2})[ \t]*Bruto Devido ao Reclamante/i);
    out.totalReclamado = pega(/Total Devido pelo Reclamado[ \t]+([\d.]+,\d{2})/i) ?? pega(/([\d.]+,\d{2})[ \t]*Total Devido pelo Reclamado/i);
    out.contribuicaoSocial = pega(/CONTRIBUI[ÇC][ÃA]O SOCIAL SOBRE SAL[ÁA]RIOS DEVIDOS[ 	]+([\d.]+,\d{2})/i);
    out.depositoFgts = pega(/DEP[ÓO]SITO FGTS[ 	]+([\d.]+,\d{2})/);
    out.deducaoInss = pega(/DEDU[ÇC][ÃA]O DE CONTRIBUI[ÇC][ÃA]O SOCIAL\s*\(?([\d.]+,\d{2})/i);
    out.irpf = pega(/IRPF DEVIDO PELO RECLAMANTE\s+([\d.]+,\d{2})/);
    for (const m of txt.matchAll(/HONOR[ÁA]RIOS L[ÍI]QUIDOS PARA (.+?)\s+([\d.]+,\d{2})/g)) out.honorarios.push({ credor: m[1].trim(), valor: valor(m[2]) });
    out.data = (txt.match(/Data Liquida[çc][ãa]o:?\s*(\d{2}\/\d{2}\/\d{4})/) || txt.match(/(\d{2}\/\d{2}\/\d{4})\s*\n?\s*Data Liquida/) || [])[1] || null;
    out.cnj = (txt.match(/\d{7}-\d{2}\.\d{4}\.5\.\d{2}\.\d{4}/) || [])[0] || null;
    // verbas do "Resumo do Cálculo": nome + três valores (corrigido, juros e total em qualquer ordem)
    const ini = linhas.findIndex(l => /Resumo do C[áa]lculo/i.test(l));
    for (const l of linhas.slice(ini < 0 ? 0 : ini + 1)) {
      if (/Percentual de Parcelas|Descri[çc][ãa]o de Cr[ée]ditos/i.test(l)) break;
      const nums = l.match(DIN) || [];
      if (nums.length < 3) continue;
      const nome = l.slice(0, l.search(DIN)).trim().replace(/\s+/g, ' ');
      if (!nome || /^Total$/i.test(nome) || /Descri[çc][ãa]o/i.test(nome)) continue;
      const v = nums.slice(-3).map(valor);
      // o total é o que vale a soma dos outros dois; dos outros, o maior é o corrigido
      let k = [0, 1, 2].find(i => Math.abs(v[i] - (v.reduce((a, b) => a + b, 0) - v[i])) <= 0.02);
      if (k == null) { out.avisos.push(`Linha não conferiu (corrigido + juros ≠ total): ${l}`); continue; }
      const resto = v.filter((_, i) => i !== k).sort((a, b) => b - a);
      const item = { nome, corrigido: resto[0], juros: resto[1], total: v[k] };
      if (/^MULTA SOBRE FGTS|^FGTS/i.test(norm(nome))) out.fgts.push(item); else out.verbas.push(item);
    }
    return out;
  }

  function semelhanca(a, b) {
    const A = new Set(norm(a).split(' ')), B = new Set(norm(b).split(' '));
    const i = [...A].filter(x => B.has(x)).length;
    return i / Math.max(A.size, B.size);
  }

  function comparar(caso, r, deles, tolerancia) {
    const tol = tolerancia ?? 1;
    const nossas = r.verbas.filter(v => v.ativa && v.compoePrincipal && (v.corrigido || v.juros)).map(v => ({ nome: v.nome, total: r2(v.corrigido + (v.juros || 0)) }));
    if (r.fgts) {
      nossas.push({ nome: 'FGTS 8%', total: r2(r.fgts.corrigido + r.fgts.juros), fgts: true });
      if (r.fgts.multa) nossas.push({ nome: `MULTA SOBRE FGTS ${r.fgts.multa.pct}%`, total: r2(r.fgts.multa.corrigido + r.fgts.multa.juros), fgts: true });
    }
    const delas = [...deles.verbas, ...deles.fgts].map(v => Object.assign({ usado: false }, v));
    const linhas = [];
    for (const n of nossas) {
      let d = delas.find(x => !x.usado && norm(x.nome) === norm(n.nome));
      if (!d) { const c = delas.filter(x => !x.usado).map(x => [x, semelhanca(x.nome, n.nome)]).sort((a, b) => b[1] - a[1])[0]; if (c && c[1] >= 0.6) d = c[0]; }
      if (d) d.usado = true;
      linhas.push({ nome: n.nome, nomeDeles: d ? d.nome : null, nosso: n.total, deles: d ? d.total : 0, dif: r2((d ? d.total : 0) - n.total) });
    }
    for (const d of delas.filter(x => !x.usado && x.total)) linhas.push({ nome: d.nome, nomeDeles: d.nome, nosso: 0, deles: d.total, dif: d.total, soDeles: true });
    // pela reclamada só se impugna o que foi apurado a maior; o apurado a menor fica só como informação
    for (const l of linhas) { l.diverge = Math.abs(l.dif) > tol; l.aMaior = l.dif > tol; }
    const t = r.totais, hon = r.honorarios.filter(h => h.devedor !== 'RECLAMANTE' && /ADVOCAT/i.test(h.tipo || h.descricao || '')).reduce((s, h) => s + h.valor, 0);
    const honDeles = deles.honorarios.filter(h => /PATRONO|ADVOG/i.test(h.credor)).reduce((s, h) => s + h.valor, 0);
    const totais = [
      ['Bruto devido ao reclamante', t.bruto, deles.bruto],
      ['Líquido devido ao reclamante', t.liquido, deles.liquido],
      ['Contribuição previdenciária (reclamante e reclamada)', r2(t.inssReclamante + t.inssReclamado), deles.contribuicaoSocial],
      ['Depósito de FGTS', t.depositoFgts, deles.depositoFgts],
      ['Honorários advocatícios', r2(hon), deles.honorarios.length ? r2(honDeles) : null],
      ['Total devido pela reclamada', t.totalReclamado, deles.totalReclamado],
    ].filter(x => x[2] != null).map(([nome, nosso, d]) => ({ nome, nosso, deles: d, dif: r2(d - nosso), diverge: Math.abs(d - nosso) > tol, aMaior: d - nosso > tol }));
    const difLiquido = deles.liquido != null ? r2(deles.liquido - t.liquido) : null;
    return { linhas, totais, difLiquido, concorda: totais.every(x => !x.aMaior) && linhas.every(l => !l.aMaior) };
  }

  // ---------- minuta em Word ----------
  async function minutaDocx(o) {
    const D = global.docx;
    const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, AlignmentType, HeadingLevel, BorderStyle } = D;
    const T = (t, x) => new TextRun(Object.assign({ text: t, font: 'Arial', size: 24 }, x || {}));
    const CAMPO = t => T(t, { highlight: 'yellow' });
    const P = (runs, x) => new Paragraph(Object.assign({ children: Array.isArray(runs) ? runs : [T(runs)], alignment: AlignmentType.JUSTIFIED, spacing: { after: 200, line: 360 } }, x || {}));
    const cel = (t, neg, dir) => new TableCell({ width: { size: 25, type: WidthType.PERCENTAGE }, children: [new Paragraph({ alignment: dir ? AlignmentType.RIGHT : AlignmentType.LEFT, children: [T(t, { size: 20, bold: !!neg })] })] });
    const tabela = (cab, linhas) => new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [
      new TableRow({ tableHeader: true, children: cab.map((c, i) => cel(c, true, i > 0)) }),
      ...linhas.map(l => new TableRow({ children: l.map((c, i) => cel(c, false, i > 0)) }))] });
    const c = o.comparacao, parte = o.parte === 'perito' ? 'pelo Sr. Perito' : 'pelo Reclamante';
    const divergentes = c.linhas.filter(l => l.aMaior);
    const corpo = [
      P([T('EXCELENTÍSSIMO(A) SENHOR(A) DOUTOR(A) JUIZ(A) DA ', { bold: true }), CAMPO('[Nª] VARA DO TRABALHO DE [CIDADE]'), T('', { bold: true })], { alignment: AlignmentType.LEFT }),
      P(''), P([T('Processo nº ' + (o.cnj || '')), T('', {})]),
      P([T('Reclamante: '), T(o.reclamante || '', { bold: true })]), P([T('Reclamada: '), T(o.reclamado || '', { bold: true })]), P(''),
      P([T((o.reclamado || 'A RECLAMADA').toUpperCase(), { bold: true }), T(', por seus advogados, nos autos da reclamação trabalhista em epígrafe, vem, respeitosamente, à presença de Vossa Excelência, '),
        T(o.concordancia ? 'manifestar CONCORDÂNCIA com os cálculos de liquidação apresentados ' + parte : 'apresentar IMPUGNAÇÃO AOS CÁLCULOS DE LIQUIDAÇÃO apresentados ' + parte + ', com fundamento no art. 879, § 2º, da CLT', { bold: true }),
        T(', pelas razões a seguir expostas.')]),
    ];
    if (o.concordancia) {
      corpo.push(P(`Conferidos os cálculos, verbas, critérios de correção monetária e juros, contribuições previdenciárias, imposto de renda e FGTS, a Reclamada constatou que estão de acordo com o título executivo, apurando o valor líquido de ${brl(o.r.totais.liquido)} devido ao Reclamante, atualizado até ${o.dataLiquidacao}.`));
      corpo.push(P('Diante do exposto, requer a homologação dos cálculos apresentados.'));
    } else {
      corpo.push(new Paragraph({ children: [T('I. DOS ITENS E VALORES IMPUGNADOS', { bold: true })], spacing: { before: 200, after: 200 } }));
      corpo.push(P(`Nos termos do art. 879, § 2º, da CLT, a Reclamada indica a seguir, de forma fundamentada, os itens e valores objeto da discordância. Os valores correspondem ao total de cada verba (principal corrigido e juros), atualizados até ${o.dataLiquidacao}.`));
      divergentes.forEach((l, i) => {
        corpo.push(new Paragraph({ children: [T(`${i + 1}. ${l.nome}`, { bold: true })], spacing: { before: 160, after: 120 } }));
        const base = l.soDeles ? `O cálculo apresentado inclui a verba "${l.nomeDeles}", no valor de ${brl(l.deles)}, que não integra a condenação.`
          : l.nosso && !l.deles ? `O cálculo apresentado não apura a verba, devida no valor de ${brl(l.nosso)}.`
          : `O cálculo apresentado apura ${brl(l.deles)}, enquanto o valor correto, nos termos da decisão, é de ${brl(l.nosso)}, com diferença de ${brl(Math.abs(l.dif))} ${l.dif > 0 ? 'a maior' : 'a menor'}.`;
        corpo.push(P([T(base + ' '), CAMPO(o.fundamentos[l.nome] || '[Fundamento: indicar o critério da decisão (trecho e página) e o erro do cálculo impugnado.]')]));
      });
      corpo.push(new Paragraph({ children: [T('II. QUADRO COMPARATIVO', { bold: true })], spacing: { before: 240, after: 200 } }));
      corpo.push(tabela(['Item', 'Cálculo impugnado', 'Cálculo da Reclamada', 'Diferença'], c.totais.map(x => [x.nome, brl(x.deles), brl(x.nosso), brl(x.dif)])));
      corpo.push(P(''));
      corpo.push(new Paragraph({ children: [T('III. DOS PEDIDOS', { bold: true })], spacing: { before: 240, after: 200 } }));
      corpo.push(P(`Diante do exposto, requer o acolhimento da presente impugnação, com a retificação dos cálculos nos itens apontados e a homologação do cálculo da Reclamada, que apura o valor líquido de ${brl(o.r.totais.liquido)} devido ao Reclamante e o total de ${brl(o.r.totais.totalReclamado)} devido pela Reclamada, atualizados até ${o.dataLiquidacao}, conforme planilha anexa.`));
    }
    corpo.push(P('Termos em que, pede deferimento.'), P([CAMPO('[Cidade]'), T(', '), CAMPO('[data]'), T('.')]), P(''),
      P([CAMPO('[Nome do advogado]')], { alignment: AlignmentType.CENTER }), P([CAMPO('[OAB/SP nº]')], { alignment: AlignmentType.CENTER }));
    const doc = new Document({ creator: 'Peixoto & Cury Advogados', title: (o.concordancia ? 'Concordância' : 'Impugnação') + ' aos cálculos ' + (o.cnj || ''),
      sections: [{ properties: { page: { margin: { top: 1418, bottom: 1134, left: 1701, right: 1134 } } }, children: corpo }] });
    return Packer.toBlob(doc);
  }

  global.ImpugnacaoPC = { lerCalculoPjeCalc, comparar, minutaDocx, versao: '0.1.0' };
})(typeof window !== 'undefined' ? window : globalThis);
