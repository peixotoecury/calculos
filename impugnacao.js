/* Impugnação ou concordância · Plataforma de Cálculos Peixoto & Cury
 *
 * 1. lerCalculoPjeCalc(linhas): lê, sem IA, o "Resumo do Cálculo" de um PDF do PJe-Calc (cálculo do
 *    reclamante ou do perito): verbas (corrigido, juros, total), FGTS, líquido, bruto, contribuição social,
 *    honorários e total do reclamado. Cada linha de verba é conferida (corrigido + juros = total).
 * 2. comparar(caso, r, deles): nosso cálculo (motor) x o deles, verba a verba e nos totais.
 * 3. minutaDocx(...): impugnação (art. 879, § 2º, da CLT), manifestação ou concordância em Word, no papel
 *    timbrado e no texto do escritório, com vara, partes, valores e assinaturas preenchidos; o que falta sai em amarelo.
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

  // ---------- minuta em Word, no modelo do escritório ----------
  // Base: papel timbrado do P&C (site/modelos/modelo_base_pc.docx, o mesmo da Plataforma de Dados), com os
  // campos {{enderecamento}} {{processo}} {{qualificacao}} {{corpo}} {{data}} {{assinaturas}}.
  // Texto no formato da "Impugnação aos cálculos" que o escritório protocola (ex.: 1001177-32.2018.5.02.0434).
  const UF = { '01': 'RJ', '02': 'SP', '03': 'MG', '04': 'RS', '05': 'BA', '06': 'PE', '09': 'PR', '10': 'DF', '12': 'SC', '15': 'SP', '18': 'GO' };
  function varaDoCnj(cnj) {
    const m = String(cnj || '').match(/\.5\.(\d{2})\.(\d{4})$/);
    return m ? { vara: (global.VARAS_PC || {})[`5.${m[1]}.${m[2]}`] || '', uf: UF[m[1]] || '' } : { vara: '', uf: '' };
  }
  const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const extenso = d => { const m = String(d || '').match(/(\d{2})\/(\d{2})\/(\d{4})/); return m ? `${+m[1] === 1 ? '1º' : m[1]} de ${MESES[+m[2] - 1]} de ${m[3]}` : d; };
  const PECAS = { impugnacao: 'Impugnação aos cálculos', manifestacao: 'Manifestação sobre os cálculos', concordancia: 'Concordância com os cálculos' };

  // a peça é uma lista de blocos (p = parágrafo, h = título, tab = quadro); [entre colchetes] sai em amarelo
  function blocos(o) {
    const c = o.comparacao, t = o.r.totais, B = [], P = x => B.push({ t: 'p', txt: x }), H = x => B.push({ t: 'h', txt: x });
    const quem = o.parte === 'perito' ? 'pelo Sr. Perito' : o.parte === 'contadoria' ? 'pela Contadoria' : 'pelo Reclamante';
    const data = extenso(o.dataLiquidacao);
    const quadro = () => c && B.push({ t: 'tab', cab: ['Item', 'Cálculo apresentado', 'Cálculo da Reclamada', 'Diferença'],
      linhas: c.totais.map(x => [x.nome, brl(x.deles), brl(x.nosso), brl(x.dif)]) });
    const conclusao = ini => { H('CONCLUSÃO'); P(`${ini} a Reclamada apresenta seus cálculos no importe líquido de ${brl(t.liquido)} devido ao Reclamante e total da execução em ${brl(t.totalReclamado)}, atualizados para ${data}, conforme planilha anexa, requerendo sua homologação.`); };
    let acao;
    if (o.peca === 'concordancia') {
      acao = `manifestar CONCORDÂNCIA COM OS CÁLCULOS apresentados ${quem}, nos termos que seguem.`;
      P(`Conferidos os cálculos apresentados ${quem}, verifica-se que observam os parâmetros fixados no título executivo quanto às verbas deferidas, aos períodos, à correção monetária e aos juros, às contribuições previdenciárias, ao imposto de renda e ao FGTS.`);
      if (c && c.linhas.some(l => l.diverge && !l.aMaior)) P('Eventuais diferenças pontuais verificadas não prejudicam a Reclamada e não alteram a conclusão.');
      quadro();
      H('CONCLUSÃO');
      P(`Diante do exposto, a Reclamada manifesta sua concordância com os cálculos apresentados, no importe líquido de ${brl(o.deles && o.deles.liquido != null ? o.deles.liquido : t.liquido)} devido ao Reclamante, requerendo sua homologação.`);
    } else if (o.peca === 'impugnacao') {
      acao = `apresentar IMPUGNAÇÃO AOS CÁLCULOS apresentados ${quem}, nos termos que seguem.`;
      P(`Os cálculos apresentados ${quem} não refletem os parâmetros fixados no presente feito, apresentando diferenças relevantes em relação aos critérios determinados pelo Juízo.`);
      P('Diante disso, a Reclamada apresenta impugnação fundamentada, com a indicação dos itens e valores objeto da discordância, nos termos do art. 879, § 2º, da CLT, apresentando os valores corretos, de acordo com os limites da condenação.');
      c.linhas.filter(l => l.aMaior).forEach(l => {
        H('DO ITEM ' + l.nome.toUpperCase());
        P(l.soDeles ? `O cálculo apresentado inclui a verba "${l.nomeDeles}", no valor de ${brl(l.deles)}, que não integra a condenação.`
          : `O cálculo apresentado apura ${brl(l.deles)} a este título, enquanto o valor correto, nos termos do título executivo, é de ${brl(l.nosso)}, com diferença de ${brl(Math.abs(l.dif))} a maior.`);
        P((o.fundamentos || {})[l.nome] || '[Fundamento: indicar o critério da decisão (trecho e ID) e o erro do cálculo impugnado.]');
        P(l.soDeles ? 'Desta forma, a verba deve ser excluída da apuração.' : 'Desta forma, o cálculo deve ser retificado.');
      });
      H('QUADRO COMPARATIVO'); quadro();
      conclusao('Após tecidas as impugnações sobre os cálculos,');
    } else {
      acao = c ? `apresentar MANIFESTAÇÃO SOBRE OS CÁLCULOS apresentados ${quem}, bem como seus cálculos de liquidação, nos termos que seguem.`
               : 'apresentar seus CÁLCULOS DE LIQUIDAÇÃO, nos termos que seguem.';
      P('Em cumprimento ao r. despacho, a Reclamada apresenta seus cálculos de liquidação, elaborados nos estritos limites do título executivo, conforme planilha anexa.');
      B.push({ t: 'tab', cab: ['Verba', 'Valor corrigido', 'Juros', 'Total'], linhas: o.r.verbas.filter(v => v.ativa && v.compoePrincipal && (v.corrigido || v.juros))
        .map(v => [v.nome, brl(v.corrigido), brl(v.juros || 0), brl(r2(v.corrigido + (v.juros || 0)))]) });
      P('Os critérios de correção monetária, juros, contribuições previdenciárias, imposto de renda e FGTS observam o título executivo, conforme demonstrativo anexo.');
      if (c) {
        H('DOS CÁLCULOS APRESENTADOS ' + quem.toUpperCase());
        const div = c.linhas.filter(l => l.aMaior);
        P(div.length ? `Confrontados os cálculos, verifica-se que o cálculo apresentado ${quem} apura valores superiores aos devidos nos seguintes itens: ${div.map(l => `${l.nome} (${brl(l.dif)} a maior)`).join('; ')}. [Indicar o critério da decisão que justifica cada diferença.]`
          : 'Confrontados os cálculos, não se verificam valores apurados a maior em prejuízo da Reclamada.');
        quadro();
      }
      conclusao('Diante do exposto,');
    }
    return { acao, B };
  }

  async function minutaDocx(o) {
    const X = global.docx, V = 'Verdana';
    o.peca = o.peca || (o.concordancia ? 'concordancia' : 'impugnacao');
    const { acao, B } = blocos(o);
    const runs = (t, x) => String(t).split(/(\[[^\]]+\])/).filter(Boolean).map(s => new X.TextRun({ text: s, font: V, size: (x && x.size) || 21, bold: x && x.bold, highlight: /^\[/.test(s) ? 'yellow' : undefined }));
    const linha = { line: 340, lineRule: X.LineRuleType.EXACT };
    const SEM = { style: X.BorderStyle.NONE, size: 0, color: 'FFFFFF' }, FINA = { style: X.BorderStyle.SINGLE, size: 4, color: '999999' };
    const cel = (t, neg, dir, w) => new X.TableCell({ width: { size: w, type: X.WidthType.PERCENTAGE }, borders: { top: FINA, bottom: FINA, left: FINA, right: FINA },
      margins: { top: 40, bottom: 40, left: 80, right: 80 }, children: [new X.Paragraph({ alignment: dir ? X.AlignmentType.RIGHT : X.AlignmentType.LEFT, children: runs(t, { size: 17, bold: neg }) })] });
    const tabela = b => { const w = [40, 20, 20, 20]; return new X.Table({ width: { size: 100, type: X.WidthType.PERCENTAGE }, rows: [
      new X.TableRow({ tableHeader: true, children: b.cab.map((c, i) => cel(c, true, i > 0, w[i])) }),
      ...b.linhas.map(l => new X.TableRow({ children: l.map((c, i) => cel(c, false, i > 0, w[i])) }))] }); };
    const filhos = [];
    for (const b of B) {
      if (b.t === 'h') filhos.push(new X.Paragraph({ children: runs(b.txt, { bold: true }), spacing: { before: 240, after: 120, ...linha }, keepNext: true }));
      else if (b.t === 'tab') { filhos.push(tabela(b)); filhos.push(new X.Paragraph({ children: [], spacing: { after: 120 } })); }
      else filhos.push(new X.Paragraph({ children: runs(b.txt), alignment: X.AlignmentType.JUSTIFIED, indent: { firstLine: 2835 }, spacing: { after: 160, ...linha } }));
    }
    const auto = varaDoCnj(o.cnj);
    const varaTxt = (o.vara || auto.vara || '[__ª Vara do Trabalho de CIDADE]').toUpperCase();
    const ender = `EXCELENTÍSSIMO SENHOR DOUTOR JUIZ DO TRABALHO DA ${varaTxt}, ${o.uf || auto.uf || '[UF]'}`;
    const reclamada = (o.reclamado || '[NOME DA RECLAMADA]').toUpperCase(), parte = (o.reclamante || '[NOME DO(A) RECLAMANTE]').toUpperCase();
    const assin = [['ANTONIO CARLOS AGUIAR', 'OAB/SP Nº 105.726'],
      [o.advogado ? o.advogado.toUpperCase() : '[NOME DO ADVOGADO]', o.oab ? 'OAB/SP Nº ' + String(o.oab).replace(/^OAB\/?SP\s*(Nº)?\s*/i, '') : 'OAB/SP Nº [NÚMERO]']];
    const hoje = new Date().toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });
    const base = new Uint8Array(await (await fetch(o.urlBase || 'modelos/modelo_base_pc.docx')).arrayBuffer());
    const out = await X.patchDocument(base, { patches: {
      enderecamento: { type: X.PatchType.PARAGRAPH, children: runs(ender, { bold: true }) },
      processo: { type: X.PatchType.PARAGRAPH, children: runs(o.cnj || '[NÚMERO DO PROCESSO]') },
      qualificacao: { type: X.PatchType.PARAGRAPH, children: [new X.TextRun({ text: '\t', font: V, size: 21 }), ...runs(reclamada, { bold: true }),
        ...runs(', por seus advogados, já qualificada nos autos da Reclamação Trabalhista movida por '), ...runs(parte, { bold: true }), ...runs(', vem à presença de Vossa Excelência, ' + acao)] },
      corpo: { type: X.PatchType.DOCUMENT, children: filhos },
      data: { type: X.PatchType.PARAGRAPH, children: runs(hoje) },
      assinaturas: { type: X.PatchType.DOCUMENT, children: [new X.Table({ width: { size: 100, type: X.WidthType.PERCENTAGE }, columnWidths: [4600, 4600], borders: X.TableBorders.NONE,
        rows: [new X.TableRow({ children: assin.map(l => new X.TableCell({ width: { size: 50, type: X.WidthType.PERCENTAGE }, borders: { top: SEM, bottom: SEM, left: SEM, right: SEM },
          children: l.map(t => new X.Paragraph({ alignment: X.AlignmentType.CENTER, spacing: { after: 0 }, children: runs(t, { bold: true }) })) })) })] })] },
    } });
    return new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  }

  global.ImpugnacaoPC = { lerCalculoPjeCalc, comparar, minutaDocx, varaDoCnj, PECAS, versao: '0.2.0' };
})(typeof window !== 'undefined' ? window : globalThis);
