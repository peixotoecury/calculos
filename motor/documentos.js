/* Leitura de documentos do contrato · Plataforma de Cálculos Peixoto & Cury
 *
 * Holerites em PDF com texto, lidos por regra (sem IA): cada valor vem do texto da página, com
 * arquivo e página de origem. Layouts reconhecidos:
 *  - Bridgestone "Demonstrativo de Pagamento" (ADP): "SALÁRIO ... 17,44/HOR AGO/2024" e rubricas
 *    "0010 Salário Base | 102,67 | 1.790,56 |".
 * Página que não é de layout conhecido fica em `naoLidas` (vai para leitura com IA ou digitação).
 *
 * Regra do salário base (conferida nos PJC do contador: Alisson, Marcos, Vinicius): salário contratual
 * do mês = valor/hora × 220 (mesmo com carga de 180) ou o valor mensal, e não a rubrica paga no mês.
 */
(function (global) {
  'use strict';
  const MES = { JAN: '01', FEV: '02', MAR: '03', ABR: '04', MAI: '05', JUN: '06', JUL: '07', AGO: '08', SET: '09', OUT: '10', NOV: '11', DEZ: '12' };
  const valor = s => s ? +s.replace(/\./g, '').replace(',', '.') : 0;
  const r2 = v => Math.round(v * 100 + 1e-7) / 100;

  // paginas: [{ arquivo, pagina, texto }]
  function lerHolerites(paginas, opcoes) {
    const horasMes = (opcoes && opcoes.horasMes) || 220;
    const meses = {}, naoLidas = [], avisos = [];
    for (const pg of paginas) {
      const t = pg.texto || '';
      if (/C\s*O\s*M\s*P\s*R\s*O\s*V\s*A\s*N\s*T\s*E\s+D\s*E\s+P\s*A\s*G\s*A\s*M\s*E\s*N\s*T\s*O/.test(t) && lerCbc(pg, meses, avisos)) continue;
      if (/FICHA\s+FINANCEIRA\s+INDIVIDUAL/i.test(t) && lerFichaSap(pg, meses)) continue;
      if (/Ficha\s+Financeira/i.test(t) && /Ano\s+Compet[êe]ncia/i.test(t) && lerFichaAnual(pg, meses)) continue;
      const cab = t.match(/([\d.]+,\d{2})\s*\/\s*(HOR|M[ÊE]S)\s+([A-Z]{3})\/(\d{4})/i);
      if (!/Demonstrativo de Pagamento/i.test(t) || !cab || !MES[cab[3].toUpperCase()]) { naoLidas.push(pg); continue; }
      const m = `${cab[4]}-${MES[cab[3].toUpperCase()]}`;
      const sal = valor(cab[1]), porHora = /^HOR/i.test(cab[2]);
      const mes = meses[m] || (meses[m] = { salario: null, salarioHora: null, rubricas: {}, origem: [] });
      const salMes = porHora ? r2(sal * horasMes) : sal;
      if (mes.salario != null && Math.abs(mes.salario - salMes) > 0.005) avisos.push(`${m}: dois salários diferentes nos holerites (${mes.salario} e ${salMes}); ficou o maior.`);
      mes.salario = Math.max(mes.salario || 0, salMes); if (porHora) mes.salarioHora = sal;
      mes.origem.push(`${pg.arquivo || ''} p. ${pg.pagina}`);
      // rubricas até a seção BASE/OUTROS (bases de INSS/IR não são pagamento)
      const corpo = t.split(/BASE\/OUTROS/i)[0];
      for (const ln of corpo.split(/\n/)) {
        const x = ln.match(/^\s*(\d{4})\s+(.+?)\s*\|\s*([\d.,]*)\s*\|\s*([\d.,]*)\s*\|\s*([\d.,]*)/);
        if (!x) continue;
        const nome = `${x[1]} ${x[2].trim().replace(/\s+/g, ' ')}`, rb = mes.rubricas[nome] || (mes.rubricas[nome] = { qtd: 0, vencimento: 0, desconto: 0, paginas: [] });
        rb.qtd = r2(rb.qtd + valor(x[3])); rb.vencimento = r2(rb.vencimento + valor(x[4])); rb.desconto = r2(rb.desconto + valor(x[5]));
        rb.paginas.push(pg.pagina);
      }
    }
    return { meses, naoLidas, avisos };
  }

  // CBC "Comprovante de Pagamento" (SAP): "Referência ... Salário Mensal" e rubricas em colunas
  // (Rubrica, Qtde., Descrição, Diferença, Proventos, Descontos). Provento ou desconto pela coluna:
  // a posição do valor no texto é comparada com a do cabeçalho "Descontos" (Danilo, Eraldo).
  const MESES_EXT = { janeiro: '01', fevereiro: '02', 'março': '03', marco: '03', abril: '04', maio: '05', junho: '06', julho: '07', agosto: '08', setembro: '09', outubro: '10', novembro: '11', dezembro: '12' };
  function lerCbc(pg, meses, avisos) {
    const linhas = pg.texto.split(/\n/);
    // espaços variam conforme o extrator (pypdf ou pdf.js): "Salário  Mensal"
    const iRef = linhas.findIndex(l => /Refer[êe]ncia/.test(l) && /Sal[áa]rio\s+Mensal/.test(l));
    if (iRef < 0) return false;
    const ref = (linhas[iRef + 1] || '').match(/(janeiro|fevereiro|mar[çc]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s+(\d{4})\s+([\d.]+,\d{2})/i);
    if (!ref) return false;
    const m = `${ref[2]}-${MESES_EXT[ref[1].toLowerCase()]}`, sal = valor(ref[3]);
    const mes = meses[m] || (meses[m] = { salario: null, salarioHora: null, rubricas: {}, origem: [] });
    if (mes.salario != null && Math.abs(mes.salario - sal) > 0.005) avisos.push(`${m}: dois salários diferentes nos holerites (${mes.salario} e ${sal}); ficou o maior.`);
    mes.salario = Math.max(mes.salario || 0, sal);
    mes.origem.push(`${pg.arquivo || ''} p. ${pg.pagina}`);
    const iCab = linhas.findIndex(l => /Rubrica/.test(l) && /Descontos/.test(l));
    if (iCab < 0) return true;
    const colDesc = linhas[iCab].indexOf('Descontos'), colProv = linhas[iCab].indexOf('Proventos');
    for (const ln of linhas.slice(iCab + 1)) {
      const x = ln.match(/^\s*(\S{4})\s+([\d.]+,\d{2})\s+(.+?)\s{2,}([\d.]+,\d{2})\s*$/);
      if (!x) continue;
      const pos = ln.lastIndexOf(x[4]) + x[4].length;           // fim do valor (colunas alinhadas à direita)
      const ehDesc = colDesc > 0 && pos > colDesc + 2 - 1 && pos > (colProv + 'Proventos'.length + 4);
      const nome = `${x[1]} ${x[3].trim().replace(/\s+/g, ' ')}`, rb = mes.rubricas[nome] || (mes.rubricas[nome] = { qtd: 0, vencimento: 0, desconto: 0, paginas: [] });
      rb.qtd = r2(rb.qtd + valor(x[2]));
      if (ehDesc) rb.desconto = r2(rb.desconto + valor(x[4])); else rb.vencimento = r2(rb.vencimento + valor(x[4]));
      rb.paginas.push(pg.pagina);
    }
    return true;
  }

  const novoMes = (meses, m) => meses[m] || (meses[m] = { salario: null, salarioHora: null, rubricas: {}, origem: [] });
  const somaRubrica = (mes, nome, qtd, venc, desc, pagina) => {
    const rb = mes.rubricas[nome] || (mes.rubricas[nome] = { qtd: 0, vencimento: 0, desconto: 0, paginas: [] });
    rb.qtd = r2(rb.qtd + qtd); rb.vencimento = r2(rb.vencimento + venc); rb.desconto = r2(rb.desconto + desc);
    if (!rb.paginas.includes(pagina)) rb.paginas.push(pagina);
  };

  // Ficha Financeira Individual (SAP/Crystal, um mês por página): "Referência: OUTUBRO/2013", tipo de
  // processamento (Folha, Férias, 13º...) e o salário em "Salario Base p/ Calculo" (Damasio). As rubricas
  // não separam provento e desconto no texto: entram como vencimento só as de processamento Folha com
  // nome de adicional ou hora (o que o cálculo usa), e o resto fica de fora.
  function lerFichaSap(pg, meses) {
    const t = pg.texto, ref = t.match(/Refer[êe]ncia:\s*([A-ZÇÃ]+)\/(\d{4})/i);
    if (!ref || !MESES_EXT[ref[1].toLowerCase()]) return false;
    const m = `${ref[2]}-${MESES_EXT[ref[1].toLowerCase()]}`, mes = novoMes(meses, m);
    const folha = /Tipo\s+Processamento:\s*\d+\s+\d+\s+Folha/i.test(t);
    const sal = t.match(/Salario\s+Base\s+p\/\s*Calculo\s+([\d.]+,\d{2})/i);
    if (sal && folha) { mes.salario = Math.max(mes.salario || 0, valor(sal[1])); mes.origem.push(`${pg.arquivo || ''} p. ${pg.pagina}`); }
    if (!folha) return true;
    for (const ln of t.split(/\n/)) {
      const x = ln.match(/^\s*(\d{6})\s+(.+?)\s{2,}([\d.]+,\d{2})(?:\s+([\d.]+,\d{2}))?\s*$/);
      if (!x || !/adic|noturn|extra|insalub|periculos|dsr/i.test(x[2])) continue;
      const qtd = x[4] ? valor(x[3]) : 0, v = valor(x[4] || x[3]);
      somaRubrica(mes, `${x[1]} ${x[2].replace(/\*+/g, '').trim().replace(/\s+/g, ' ')}`, qtd, v, 0, pg.pagina);
    }
    return true;
  }

  // Ficha Financeira anual da Bridgestone (meses em colunas, "Ano Competência : 2020", classe PGTO/DESC).
  // Cada valor vai para o mês cuja coluna termina mais perto do fim do número. Não traz salário contratual.
  const MES_COL = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  function lerFichaAnual(pg, meses) {
    const linhas = pg.texto.split(/\n/), ano = (pg.texto.match(/Ano\s+Compet[êe]ncia\s*:\s*(\d{4})/i) || [])[1];
    const iCab = linhas.findIndex(l => /C[óo]digo/.test(l) && /Denomina/.test(l));
    if (!ano || iCab < 0) return false;
    const cab = linhas[iCab], cols = [];
    for (const [i, nm] of MES_COL.entries()) {
      const p = cab.search(new RegExp(nm.replace('ç', '[çc]'), 'i'));
      if (p >= 0) cols.push({ mes: `${ano}-${String(i + 1).padStart(2, '0')}`, fim: p + nm.length });
    }
    if (!cols.length) return false;
    for (const ln of linhas.slice(iCab + 1)) {
      const x = ln.match(/^\s*(\d{4})\s+(.+?)\s+(PGTO|DESC)\s/);
      if (!x) continue;
      const re = /[\d.]+,\d{2}/g; let mm;
      while ((mm = re.exec(ln))) {
        if (mm.index < x.index + x[0].length - 1) continue;
        const fim = mm.index + mm[0].length;
        const c = cols.reduce((a, b) => Math.abs(b.fim - fim) < Math.abs(a.fim - fim) ? b : a);
        const mes = novoMes(meses, c.mes);
        if (!mes.origem.includes(`${pg.arquivo || ''} p. ${pg.pagina}`)) mes.origem.push(`${pg.arquivo || ''} p. ${pg.pagina}`);
        somaRubrica(mes, `${x[1]} ${x[2].trim().replace(/\s+/g, ' ')}`, 0, x[3] === 'PGTO' ? valor(mm[0]) : 0, x[3] === 'DESC' ? valor(mm[0]) : 0, pg.pagina);
      }
    }
    return true;
  }

  // históricos no formato do motor: salário base e, quando pedido, rubricas pagas por nome (regex)
  function historicos(lido, pedidos) {
    const out = {}, ms = Object.keys(lido.meses).sort();
    out.salario = { nome: 'SALÁRIO BASE', valores: {} };
    for (const m of ms) if (lido.meses[m].salario) out.salario.valores[m] = lido.meses[m].salario;
    for (const [id, nome, re] of pedidos || []) {
      const h = { nome, valores: {} };
      for (const m of ms) {
        let s = 0; for (const [k, rb] of Object.entries(lido.meses[m].rubricas)) if (re.test(k)) s += rb.vencimento;
        h.valores[m] = r2(s);
      }
      if (Object.values(h.valores).some(v => v)) out[id] = h;
    }
    return out;
  }

  global.DocumentosPC = { lerHolerites, historicos, versao: '0.1.0' };
})(typeof window !== 'undefined' ? window : globalThis);
