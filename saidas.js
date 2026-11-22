/* Saídas · Plataforma de Cálculos Peixoto & Cury
 *
 * relatorioHtml(caso, r, pd): demonstrativo A4 no padrão P&C (navy/cyan, logo no canto superior direito),
 *   aberto numa janela de impressão para "Salvar como PDF".
 * planilha(caso, r): pasta de trabalho (SheetJS) com fórmulas: diferença, correção, juros, FGTS e totais
 *   são contas do Excel sobre os mesmos números do motor, para o advogado conferir linha a linha.
 *
 * r = MotorPC.calcular(caso, TABELAS); pd = MotorPC.posicaoNaDistribuicao(caso, TABELAS) (opcional).
 */
(function (global) {
  'use strict';
  const dt = s => s ? String(s).slice(0, 10).split('-').reverse().join('/') : '';
  const num = (v, d = 2) => v == null || isNaN(v) ? '' : (+v).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
  const brl = v => 'R$ ' + num(v || 0);
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const mesAno = c => `${c.slice(5, 7)}/${c.slice(0, 4)}`;
  const r2 = v => Math.round((v + Math.sign(v) * 1e-9) * 100) / 100;
  const NOMES_INDICE = { IPCAE: 'IPCA-E', IPCA: 'IPCA', TR: 'TR', INPC: 'INPC', SEM_CORRECAO: 'sem correção' };
  const TIPO = { Calculada: 'verba principal', Reflexo: 'reflexo', Informada: 'valor informado' };
  const diaAntes = s => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); };
  const ativasDe = r => r.verbas.filter(v => v.ativa && v.ocorrencias.some(o => o.devido || o.pago));

  function indiceTexto(at) {
    return at.combinarIndice && at.aPartirOutroIndice
      ? `${NOMES_INDICE[at.indice] || at.indice} até ${dt(diaAntes(at.aPartirOutroIndice))} e ${NOMES_INDICE[at.outroIndice] || at.outroIndice} a partir de ${dt(at.aPartirOutroIndice)}`
      : (NOMES_INDICE[at.indice] || at.indice);
  }

  // ---------------- PDF (relatório para impressão) ----------------
  function relatorioHtml(caso, r, pd, base) {
    const p = caso.parametros, ct = p.contrato, t = r.totais, fg = r.fgts, pr = caso.processo || {};
    const ativas = ativasDe(r);
    const honor = r.honorarios.filter(h => h.devedor !== 'RECLAMANTE');
    const nomeH = s => s.charAt(0) + s.slice(1).toLowerCase();
    const tab = (cab, linhas, cls) => `<table class="${cls || ''}"><thead><tr>${cab.map(c => `<th>${c}</th>`).join('')}</tr></thead><tbody>${linhas}</tbody></table>`;
    const linha = (rot, v, cls) => `<tr class="${cls || ''}"><td>${rot}</td><td class="n">${v}</td></tr>`;
    const fgCorr = fg ? fg.corrigido + (fg.multa ? fg.multa.corrigido : 0) : 0;
    const pdOk = pd && !(pd.total < 0 || pd.posterior > Math.abs(pd.total));

    const demonstrativos = ativas.map(v => `
      <section class="verba"><h3>${esc(v.nome)} <small>${TIPO[v.tipo] || ''} · ${v.ocorrencias.length} ocorrência(s)</small></h3>
      ${tab(['Período', 'Base', 'Mult.', 'Divisor', 'Qtd.', 'Devido', 'Pago', 'Índice', 'Corrigido', 'Juros'],
        v.ocorrencias.map(o => `<tr><td>${dt(o.ini)}${o.fim && o.fim !== o.ini ? ' a ' + dt(o.fim) : ''}</td><td class="n">${num(o.base)}</td><td class="n">${num(o.mult, 4)}</td>
          <td class="n">${num(o.divisor, 0)}</td><td class="n">${num(o.qtd, o.qtd % 1 ? 2 : 0)}</td><td class="n">${num(o.devido)}</td><td class="n">${num(o.pago)}</td>
          <td class="n">${num(o.indice, 7)}</td><td class="n">${num(o.corrigido)}</td><td class="n">${num(o.juros || 0)}</td></tr>`).join('')
        + `<tr class="tot"><td colspan="5">Total</td><td class="n">${num(v.devido)}</td><td class="n">${num(v.pago)}</td><td></td><td class="n">${num(v.corrigido)}</td><td class="n">${num(v.juros || 0)}</td></tr>`, 'mini')}
      </section>`).join('');

    return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Cálculo ${esc(pr.cnj || '')}</title>
<style>
@page { size: A4; margin: 16mm 14mm 18mm; @bottom-left { content: "Cálculo elaborado pelo Peixoto & Cury"; font: 8pt Arial, sans-serif; color: #5d6b7a; }
  @bottom-right { content: "Página " counter(page) " de " counter(pages); font: 8pt Arial, sans-serif; color: #5d6b7a; } }
* { box-sizing: border-box; }
body { font: 9.5pt/1.35 Arial, Helvetica, sans-serif; color: #0E2841; margin: 0; }
.topo { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #0E2841; padding-bottom: 8px; margin-bottom: 4px; }
.topo h1 { font-size: 16pt; margin: 0 0 4px; }
.topo .proc { font-size: 9.5pt; color: #334; }
.topo img { height: 44px; }
.faixa { height: 3px; background: #009DDC; margin-bottom: 14px; }
h2 { font-size: 11.5pt; margin: 18px 0 6px; padding-bottom: 3px; border-bottom: 1px solid #c9d5e0; break-after: avoid; }
h3 { font-size: 10pt; margin: 12px 0 4px; break-after: avoid; }
h3 small, h2 small { font-weight: normal; color: #5d6b7a; font-size: 8.5pt; }
table { width: 100%; border-collapse: collapse; margin: 2px 0 6px; }
th { background: #0E2841; color: #fff; font-weight: 600; text-align: left; padding: 4px 5px; font-size: 8.5pt; }
td { padding: 3px 5px; border-bottom: 1px solid #e3e9ef; vertical-align: top; }
.mini td, .mini th { font-size: 7.8pt; padding: 2px 4px; }
.n { text-align: right; white-space: nowrap; }
tr.tot td { font-weight: 700; border-top: 1.5px solid #0E2841; border-bottom: none; }
tr.sub td { font-weight: 700; }
tr { break-inside: avoid; }
.duas { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.par td:first-child { color: #5d6b7a; width: 26%; }
.par td.n { text-align: left; white-space: normal; }
.nota { font-size: 8pt; color: #5d6b7a; margin: 4px 0; }
section.verba { break-inside: auto; }
.quebra { break-before: page; }
</style></head><body>
<div class="topo"><div><h1>Demonstrativo de cálculo</h1>
  <div class="proc"><b>${esc(pr.reclamante || '')}</b>${pr.reclamado ? ' x ' + esc(pr.reclamado) : ''}<br>Processo ${esc(pr.cnj || '')} · liquidação em ${dt(ct.liquidacao)}</div></div>
  <img src="${base || ''}img/logo_pc.png" alt="Peixoto &amp; Cury"></div>
<div class="faixa"></div>

<div class="duas">
  <div><h2>Crédito do reclamante</h2><table><tbody>
    ${linha('Verbas corrigidas', brl(t.corrigido))}${linha('Juros sobre as verbas', brl(t.jurosVerbas))}
    ${fg ? linha('FGTS e multa (corrigidos, com juros)', brl(t.fgts)) : ''}
    ${linha('Bruto devido ao reclamante', brl(t.bruto), 'sub')}
    ${t.depositoFgts ? linha('FGTS a depositar na conta vinculada', '(' + brl(t.depositoFgts) + ')') : ''}
    ${linha('Contribuição previdenciária do reclamante', '(' + brl(t.deducaoInss) + ')')}
    ${linha('Imposto de renda', '(' + brl(t.impostoRenda) + ')')}
    ${linha('Líquido devido ao reclamante', brl(t.liquido), 'tot')}</tbody></table></div>
  <div><h2>Débitos do reclamado</h2><table><tbody>
    ${linha('Líquido devido ao reclamante', brl(t.liquido))}
    ${t.depositoFgts ? linha('Depósito de FGTS', brl(t.depositoFgts)) : ''}
    ${linha('INSS do reclamante (com juros SELIC)', brl(t.inssReclamante))}
    ${linha('INSS do reclamado, empresa e SAT (com juros SELIC)', brl(t.inssReclamado))}
    ${t.impostoRenda ? linha('Imposto de renda retido', brl(t.impostoRenda)) : ''}
    ${honor.map(h => linha(`${esc(nomeH(h.descricao))}${h.aliquota ? ` (${num(h.aliquota, 0)}% sobre ${brl(h.base)})` : ''}`, brl(h.valor))).join('')}
    ${t.custas ? linha('Custas judiciais', brl(t.custas)) : ''}
    ${linha('Total devido pelo reclamado', brl(t.totalReclamado), 'tot')}</tbody></table></div>
</div>

<h2>Parâmetros do cálculo</h2>
<table class="par"><tbody>
  ${linha('Admissão e demissão', `${dt(ct.admissao)} a ${dt(ct.demissao)}`)}
  ${linha('Aviso prévio', `${r.diasAviso} dias${ct.projetaAviso ? ` (projeção até ${dt(r.fimProjetado)})` : ''}`)}
  ${linha('Ajuizamento (data da distribuição)', dt(ct.ajuizamento))}${linha('Liquidação', dt(ct.liquidacao))}
  ${linha('Correção monetária', indiceTexto(p.atualizacao))}
  ${linha('Juros de mora', 'TRD simples até a véspera do ajuizamento e taxa legal a partir dele (ADC 58 e Lei 14.905/2024), sobre as verbas corrigidas deduzida a contribuição do reclamante')}
  ${linha('Férias', p.ferias.map(f => `${f.relativa} ${String(f.situacao || '').toLowerCase()}`).join(' · ') || 'nenhuma informada')}
  ${linha('Faltas', p.faltas.length ? p.faltas.map(f => `${dt(f.ini)} a ${dt(f.fim)}${f.justificada ? ' (justificada)' : ''}`).join(' · ') : 'nenhuma')}
</tbody></table>

<h2>Resumo das verbas</h2>
${tab(['Verba', 'Diferença', 'Corrigido', 'Juros', 'Total'],
  ativas.map(v => `<tr><td>${esc(v.nome)}</td><td class="n">${num(v.devido - v.pago)}</td><td class="n">${num(v.corrigido)}</td><td class="n">${num(v.juros || 0)}</td><td class="n">${num(v.corrigido + (v.juros || 0))}</td></tr>`).join('')
  + (fg ? `<tr><td>FGTS 8%</td><td></td><td class="n">${num(fg.corrigido)}</td><td class="n">${num(fg.juros)}</td><td class="n">${num(fg.corrigido + fg.juros)}</td></tr>` : '')
  + (fg && fg.multa ? `<tr><td>Multa de ${fg.multa.pct}% sobre o FGTS</td><td></td><td class="n">${num(fg.multa.corrigido)}</td><td class="n">${num(fg.multa.juros)}</td><td class="n">${num(fg.multa.corrigido + fg.multa.juros)}</td></tr>` : '')
  + `<tr class="tot"><td>Bruto devido ao reclamante</td><td></td><td class="n">${num(t.corrigido + fgCorr)}</td><td class="n">${num(t.bruto - t.corrigido - fgCorr)}</td><td class="n">${num(t.bruto)}</td></tr>`)}

${pdOk ? `<h2>Valor na data da distribuição <small>${dt(pd.data)} · corrigido até o ajuizamento, com os juros da fase pré-judicial</small></h2>
<table><tbody>${linha('Verbas corrigidas', brl(pd.corrigido))}${linha('Juros pré-judiciais (TRD)', brl(pd.juros))}${pd.fgts ? linha('FGTS e multa', brl(pd.fgts)) : ''}
${linha('Valor bruto na distribuição', brl(pd.total), 'tot')}</tbody></table>
${pd.posterior ? `<p class="nota">Parcelas que vencem a partir do ajuizamento, fora deste total: ${brl(pd.posterior)} (valor nominal).</p>` : ''}` : ''}

<h2 class="quebra">Demonstrativo das verbas <small>mês a mês</small></h2>
${demonstrativos}

<h2>Juros de mora <small>por data de vencimento</small></h2>
${tab(['Vencimento', 'Verbas corrigidas', 'INSS reclamante', 'Capital', 'Taxa', 'Juros'],
  r.juros.map(j => `<tr><td>${dt(j.venc)}</td><td class="n">${num(j.totalVerbas)}</td><td class="n">${num(j.contribuicao)}</td><td class="n">${num(j.capital)}</td><td class="n">${num(j.taxa, 4)}%</td><td class="n">${num(j.juros)}</td></tr>`).join('')
  + `<tr class="tot"><td colspan="5">Total</td><td class="n">${num(t.jurosVerbas)}</td></tr>`, 'mini')}

${fg ? `<h2>FGTS <small>${fg.linhas.length} competência(s)${fg.multa ? `; multa de ${fg.multa.pct}% sobre ${brl(fg.multa.base)}` : ''}</small></h2>
${tab(['Competência', 'Base', 'Devido', 'Índice', 'Corrigido', 'Juros'],
  fg.linhas.map(l => `<tr><td>${mesAno(l.comp)}</td><td class="n">${num(l.base)}</td><td class="n">${num(l.devido)}</td><td class="n">${num(l.indice, 7)}</td><td class="n">${num(l.corrigido)}</td><td class="n">${num(l.juros)}</td></tr>`).join('')
  + `<tr class="tot"><td colspan="4">Total</td><td class="n">${num(fg.corrigido)}</td><td class="n">${num(fg.juros)}</td></tr>`, 'mini')}` : ''}

<h2>Contribuição previdenciária <small>por competência, com juros SELIC</small></h2>
${tab(['Competência', 'Base', 'Alíq. segurado', 'Segurado', 'Empresa', 'SAT', 'Taxa SELIC', 'Juros'],
  r.inss.map(l => `<tr><td>${mesAno(l.comp)}${l.eh13 ? ' 13º' : ''}</td><td class="n">${num(l.base)}</td><td class="n">${num(l.aliquotaSegurado)}%</td><td class="n">${num(l.segurado)}</td><td class="n">${num(l.empresa)}</td><td class="n">${num(l.sat)}</td><td class="n">${num(l.taxaSelic)}%</td><td class="n">${num(l.juros_segurado + l.juros_empresa + l.juros_sat + l.juros_terceiros)}</td></tr>`).join(''), 'mini')}

<h2>Imposto de renda <small>rendimentos recebidos acumuladamente; juros de mora não tributados</small></h2>
${tab(['Período', 'Rendimentos', 'Meses', 'INSS', 'Desc. simplificado', 'Base', 'Imposto'],
  (r.irpf.blocos || []).map(b => `<tr><td>${b.bloco}</td><td class="n">${num(b.verbas)}</td><td class="n">${b.meses}</td><td class="n">${num(b.contribuicao)}</td><td class="n">${num(b.simplificado)}</td><td class="n">${num(b.base)}</td><td class="n">${num(b.imposto)}</td></tr>`).join('') || '<tr><td colspan="7">Não apurado neste cálculo</td></tr>', 'mini')}

<p class="nota" style="margin-top:14px">Tabelas de índices, juros, contribuição previdenciária e imposto de renda do PJe-Calc (TRT da 2ª Região). Emitido em ${new Date().toLocaleDateString('pt-BR')}.</p>
</body></html>`;
  }

  function abrirPdf(caso, r, pd) {
    const base = location.href.replace(/[^/]*$/, '');
    const w = window.open('', '_blank');
    if (!w) { alert('O navegador bloqueou a janela do relatório. Libere pop-ups para esta página.'); return; }
    w.document.write(relatorioHtml(caso, r, pd, base)); w.document.close();
    w.onload = () => setTimeout(() => w.print(), 300);
  }

  // ---------------- Excel (com fórmulas) ----------------
  function planilha(caso, r) {
    const X = global.XLSX, p = caso.parametros, ct = p.contrato, t = r.totais, fg = r.fgts, pr = caso.processo || {};
    const serial = s => { if (!s) return ''; const [a, m, d] = s.slice(0, 10).split('-').map(Number); return (Date.UTC(a, m - 1, d) - Date.UTC(1899, 11, 30)) / 864e5; };
    const D = s => s ? { t: 'n', v: serial(s), z: 'dd/mm/yyyy' } : { t: 's', v: '' };
    const N = (v, z) => ({ t: 'n', v: +v || 0, z: z || '#,##0.00' });
    const F = (f, z) => ({ t: 'n', f, z: z || '#,##0.00' });
    const S = v => ({ t: 's', v: String(v ?? '') });
    const folha = (linhas, larg) => { const ws = X.utils.aoa_to_sheet([[]]); X.utils.sheet_add_aoa(ws, linhas, { origin: 'A1' }); ws['!cols'] = larg.map(w => ({ wch: w })); return ws; };
    const ativas = ativasDe(r);

    // Demonstrativo: devido é fórmula quando a conta base x mult x qtd / divisor reproduz o motor
    const dem = [['Nº', 'Verba', 'Início', 'Fim', 'Base', 'Mult.', 'Divisor', 'Qtd.', 'Devido', 'Pago', 'Diferença', 'Índice', 'Corrigido', 'Juros'].map(S)];
    ativas.forEach((v, iv) => v.ocorrencias.forEach(o => {
      const L = dem.length + 1;
      const conta = o.divisor && o.base != null && o.mult != null && o.qtd != null && Math.abs(r2(o.base * o.mult * o.qtd / o.divisor) - o.devido) < 0.005;
      dem.push([N(iv + 1, '0'), S(v.nome), D(o.ini), D(o.fim || o.ini), N(o.base), N(o.mult, '0.0000'), N(o.divisor, '0.##'), N(o.qtd, '0.00'),
        conta ? F(`ROUND(E${L}*F${L}*H${L}/G${L},2)`) : N(o.devido), N(o.pago), F(`ROUND(I${L}-J${L},2)`), N(o.indice, '0.0000000'), F(`ROUND(K${L}*L${L},2)`), N(o.juros || 0)]);
    }));
    const nDem = dem.length;

    // Verbas: somas do demonstrativo
    const ver = [['Nº', 'Verba', 'Tipo', 'Compõe o principal', 'Diferença', 'Corrigido', 'Juros', 'Total'].map(S)];
    ativas.forEach((v, iv) => {
      const L = ver.length + 1, k = `Demonstrativo!$A$2:$A$${nDem}`;
      ver.push([N(iv + 1, '0'), S(v.nome), S(TIPO[v.tipo] || v.tipo), S(v.compoePrincipal ? 'sim' : 'não'),
        F(`SUMIFS(Demonstrativo!$K$2:$K$${nDem},${k},A${L})`), F(`SUMIFS(Demonstrativo!$M$2:$M$${nDem},${k},A${L})`),
        F(`SUMIFS(Demonstrativo!$N$2:$N$${nDem},${k},A${L})`), F(`F${L}+G${L}`)]);
    });
    const nVer = ver.length;
    ver.push([S(''), S('Total que compõe o principal'), S(''), S(''), F(`SUMIFS(E2:E${nVer},D2:D${nVer},"sim")`), F(`SUMIFS(F2:F${nVer},D2:D${nVer},"sim")`), F(`SUMIFS(G2:G${nVer},D2:D${nVer},"sim")`), F(`SUMIFS(H2:H${nVer},D2:D${nVer},"sim")`)]);
    const totVer = nVer + 1;

    // Juros por vencimento
    const jur = [['Vencimento', 'Verbas corrigidas', 'INSS reclamante', 'Capital', 'Taxa (%)', 'Juros'].map(S)];
    r.juros.forEach(j => { const L = jur.length + 1; jur.push([D(j.venc), N(j.totalVerbas), N(j.contribuicao), F(`ROUND(B${L}-C${L},2)`), N(j.taxa, '0.0000'), F(`ROUND(D${L}*E${L}/100,2)`)]); });
    const nJur = jur.length; jur.push([S('Total'), F(`SUM(B2:B${nJur})`), F(`SUM(C2:C${nJur})`), F(`SUM(D2:D${nJur})`), S(''), F(`SUM(F2:F${nJur})`)]);
    const totJur = nJur + 1;

    // FGTS
    let totFgts = null;
    const fgt = [['Competência', 'Base', 'Alíquota (%)', 'Devido', 'Índice', 'Corrigido', 'Juros', 'Total'].map(S)];
    if (fg) {
      const aliq = (p.encargos && p.encargos.fgts && p.encargos.fgts.aliquota) || 8;
      fg.linhas.forEach(l => { const L = fgt.length + 1; fgt.push([S(mesAno(l.comp)), N(l.base), N(aliq, '0.##'), N(l.devido), N(l.indice, '0.0000000'), F(`ROUND(B${L}*C${L}/100*E${L},2)`), N(l.juros), F(`F${L}+G${L}`)]); });
      const nF = fgt.length;
      if (fg.multa) fgt.push([S(`Multa de ${fg.multa.pct}%`), N(fg.multa.base), N(fg.multa.pct, '0.##'), S(''), S(''), N(fg.multa.corrigido), N(fg.multa.juros), F(`F${nF + 1}+G${nF + 1}`)]);
      const nF2 = fgt.length;
      fgt.push([S('Total'), S(''), S(''), S(''), S(''), F(`SUM(F2:F${nF2})`), F(`SUM(G2:G${nF2})`), F(`SUM(H2:H${nF2})`)]);
      totFgts = nF2 + 1;
    }

    // INSS
    const ins = [['Competência', '13º', 'Base', 'Alíq. segurado (%)', 'Segurado', 'Empresa', 'SAT', 'Terceiros', 'Taxa SELIC (%)', 'Juros segurado', 'Juros empresa', 'Juros SAT', 'Juros terceiros'].map(S)];
    r.inss.forEach(l => ins.push([S(mesAno(l.comp)), S(l.eh13 ? 'sim' : ''), N(l.base), N(l.aliquotaSegurado), N(l.segurado), N(l.empresa), N(l.sat), N(l.terceiros || 0), N(l.taxaSelic, '0.00'),
      N(l.juros_segurado), N(l.juros_empresa), N(l.juros_sat), N(l.juros_terceiros || 0)]));
    const nIns = ins.length;
    ins.push([S('Total'), S(''), S(''), S(''), ...['E', 'F', 'G', 'H'].map(c => F(`SUM(${c}2:${c}${nIns})`)), S(''), ...['J', 'K', 'L', 'M'].map(c => F(`SUM(${c}2:${c}${nIns})`))]);
    const totIns = nIns + 1;

    // IR
    const irr = [['Período', 'Rendimentos', 'Meses', 'INSS', 'Desc. simplificado', 'Base', 'Imposto'].map(S)];
    (r.irpf.blocos || []).forEach(b => irr.push([S(b.bloco), N(b.verbas), N(b.meses, '0'), N(b.contribuicao), N(b.simplificado), N(b.base), N(b.imposto)]));
    const nIr = irr.length; irr.push([S('Total'), S(''), S(''), S(''), S(''), S(''), F(nIr > 1 ? `SUM(G2:G${nIr})` : '0')]);
    const totIr = nIr + 1;

    // Resumo: tudo por fórmula a partir das abas
    const fgCompoe = fg && fg.compoePrincipal;
    const honorRecte = r2(r.honorarios.filter(h => h.devedor === 'RECLAMANTE').reduce((s, h) => s + h.valor, 0));
    // honorários calculados: base por fórmula sobre o resumo (bruto, menos INSS do reclamante, menos IR)
    const baseH = { BRUTO: 'B13', BRUTO_MENOS_CONTRIBUICAO_SOCIAL: '(B13+B15)', LIQUIDO: '(B13+B15+B16)' };
    const honorRecdo = r.honorarios.map((h, i) => Object.assign({}, h, { baseTipo: ((p.encargos.honorarios || [])[i] || {}).base }))
      .filter(h => h.devedor !== 'RECLAMANTE');
    const res = [
      [S('Demonstrativo de cálculo'), S('')],
      [S('Processo'), S(pr.cnj || '')], [S('Reclamante'), S(pr.reclamante || '')], [S('Reclamado'), S(pr.reclamado || '')],
      [S('Ajuizamento (data da distribuição)'), D(ct.ajuizamento)], [S('Liquidação'), D(ct.liquidacao)], [S('Correção'), S(indiceTexto(p.atualizacao))], [S(''), S('')],
      [S('CRÉDITO DO RECLAMANTE'), S('')],
      [S('Verbas corrigidas'), F(`Verbas!F${totVer}`)],                                  // 10
      [S('Juros sobre as verbas'), F(`Juros!F${totJur}`)],                               // 11
      [S('FGTS e multa (corrigidos, com juros)'), fgCompoe ? F(`FGTS!H${totFgts}`) : N(0)], // 12
      [S('Bruto devido ao reclamante'), F('ROUND(B10+B11+B12,2)')],                       // 13
      [S('FGTS a depositar na conta vinculada'), fg && fg.destino === 'DEPOSITAR' && fgCompoe ? F('-B12') : N(0)], // 14
      [S('Contribuição previdenciária do reclamante'), F(`-INSS!E${totIns}`)],            // 15
      [S('Imposto de renda'), F(`-IR!G${totIr}`)],                                        // 16
      [S('Honorários devidos pelo reclamante'), N(-honorRecte)],                          // 17
      [S('Líquido devido ao reclamante'), F('ROUND(SUM(B13:B17),2)')],                    // 18
      [S(''), S('')],
      [S('DÉBITOS DO RECLAMADO'), S('')],
      [S('Líquido devido ao reclamante'), F('B18')],                                      // 21
      [S('Depósito de FGTS'), F('-B14')],                                                 // 22
      [S('INSS do reclamante (com juros SELIC)'), F(`INSS!E${totIns}+INSS!J${totIns}`)],  // 23
      [S('INSS do reclamado, empresa, SAT e terceiros (com juros SELIC)'), F(`INSS!F${totIns}+INSS!G${totIns}+INSS!H${totIns}+INSS!K${totIns}+INSS!L${totIns}+INSS!M${totIns}`)], // 24
      [S('Imposto de renda retido'), F(`IR!G${totIr}`)],                                  // 25
    ];
    honorRecdo.forEach(h => res.push([S(`${h.descricao}${h.aliquota ? ` (${num(h.aliquota, 0)}% sobre ${brl(h.base)})` : ''}`),
      h.aliquota && baseH[h.baseTipo] ? F(`ROUND(ROUND(${baseH[h.baseTipo]},2)*${h.aliquota}/100,2)`) : N(h.valor)]));
    res.push([S('Custas judiciais'), N(t.custas || 0)]);
    const ult = res.length;
    res.push([S('Total devido pelo reclamado'), F(`ROUND(SUM(B21:B${ult}),2)`)]);
    // valor na data da distribuição (ajuizamento): correção até lá e só os juros pré-judiciais (TRD)
    const pd = global.MotorPC && global.MotorPC.posicaoNaDistribuicao ? global.MotorPC.posicaoNaDistribuicao(caso, global.TABELAS) : null;
    if (pd) {
      const i0 = res.length + 3;
      res.push([S(''), S('')], [S(`VALOR NA DATA DA DISTRIBUIÇÃO (${dt(pd.data)})`), S('')],
        [S('Verbas corrigidas até o ajuizamento'), N(pd.corrigido)],
        [S('Juros pré-judiciais (TRD)'), N(pd.juros)],
        [S('FGTS e multa'), N(pd.fgts)],
        [S('Valor bruto na distribuição'), F(`ROUND(B${i0}+B${i0 + 1}+B${i0 + 2},2)`)]);
      if (pd.posterior) res.push([S('Parcelas que vencem a partir do ajuizamento (valor nominal, fora do total)'), N(pd.posterior)]);
    }
    res.push([S(''), S('')], [S('Cálculo elaborado pelo Peixoto & Cury. Os valores do demonstrativo vêm do motor da plataforma; diferença, correção, juros, FGTS e totais são fórmulas.'), S('')]);

    const wb = X.utils.book_new();
    X.utils.book_append_sheet(wb, folha(res, [62, 22]), 'Resumo');
    X.utils.book_append_sheet(wb, folha(ver, [5, 60, 16, 10, 14, 14, 14, 14]), 'Verbas');
    X.utils.book_append_sheet(wb, folha(dem, [5, 50, 11, 11, 12, 9, 8, 9, 12, 12, 12, 12, 12, 11]), 'Demonstrativo');
    X.utils.book_append_sheet(wb, folha(jur, [12, 16, 15, 14, 10, 13]), 'Juros');
    if (fg) X.utils.book_append_sheet(wb, folha(fgt, [14, 12, 11, 11, 12, 12, 11, 12]), 'FGTS');
    X.utils.book_append_sheet(wb, folha(ins, [12, 5, 12, 10, 11, 11, 10, 10, 10, 11, 11, 10, 10]), 'INSS');
    X.utils.book_append_sheet(wb, folha(irr, [18, 13, 7, 12, 14, 13, 12]), 'IR');
    return wb;
  }

  function baixarExcel(caso, r) {
    const nome = `Cálculo ${(caso.processo && caso.processo.cnj) || 'processo'}.xlsx`.replace(/[\\/:*?"<>|]/g, '-');
    global.XLSX.writeFile(planilha(caso, r), nome);
  }

  // ---------------- PDF da discriminação de acordo ----------------
  function acordoHtml(caso, a, base) {
    const pr = caso.processo || {}, html = relatorioHtml(caso, { verbas: [], totais: {}, honorarios: [], juros: [], inss: [], irpf: {}, fgts: null }, null, base);
    const estilo = html.slice(html.indexOf('<style>'), html.indexOf('</style>') + 8);
    const linha = (rot, v, cls) => `<tr class="${cls || ''}"><td>${rot}</td><td class="n">${v}</td></tr>`;
    return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Acordo ${esc(pr.cnj || '')}</title>${estilo}</head><body>
<div class="topo"><div><h1>Discriminação das verbas do acordo</h1>
  <div class="proc"><b>${esc(pr.reclamante || '')}</b>${pr.reclamado ? ' x ' + esc(pr.reclamado) : ''}<br>Processo ${esc(pr.cnj || '')}</div></div>
  <img src="${base || ''}img/logo_pc.png" alt="Peixoto &amp; Cury"></div><div class="faixa"></div>
<h2>Quadro resumo</h2><table><tbody>
  ${linha('Valor das parcelas do acordo sem FGTS e multa de 40%', brl(a.bruto - a.valorFgts - a.valorMulta - a.inssReclamante - a.ir))}
  ${linha('FGTS do acordo', brl(a.valorFgts))}${linha('Multa de 40% do FGTS', brl(a.valorMulta))}
  ${linha('Valor líquido do acordo', brl(a.liquidoConferido), 'sub')}
  ${linha('INSS do reclamante', brl(a.inssReclamante))}${linha('INSS da reclamada (empresa, SAT e terceiros)', brl(a.inssEmpresa))}
  ${linha('Juros SELIC do INSS', brl(a.selic))}${linha('Imposto de renda', brl(a.ir))}${linha('Honorários advocatícios', brl(a.honorarios))}
  ${linha('Custo total do acordo', brl(a.custoTotal), 'tot')}</tbody></table>
<h2>Discriminação das verbas</h2>
<table><thead><tr><th>Verba</th><th>Natureza</th><th class="n">%</th><th class="n">Valor</th></tr></thead><tbody>
  ${a.linhas.map(l => `<tr><td>${esc(l.nome)}</td><td>${l.natureza === 'salarial' ? 'Salarial' : 'Indenizatória'}</td><td class="n">${num(l.pct * 100)}%</td><td class="n">${num(l.valor)}</td></tr>`).join('')}
  <tr class="sub"><td colspan="3">Valor bruto</td><td class="n">${num(a.bruto)}</td></tr>
  <tr><td colspan="3">(-) INSS do reclamante</td><td class="n">${num(a.inssReclamante)}</td></tr><tr><td colspan="3">(-) Imposto de renda</td><td class="n">${num(a.ir)}</td></tr>
  <tr class="tot"><td colspan="3">Valor líquido</td><td class="n">${num(a.liquidoConferido)}</td></tr></tbody></table>
<p class="nota">Base do INSS: ${brl(a.baseInss)} (verbas salariais), repartida em ${a.competencias} competências. Base do IR: ${brl(a.baseIr)}, ${a.competencias} meses (rendimentos recebidos acumuladamente), ${brl(a.irMensal)} por mês. ${esc(a.regraSelic)}.</p>
<h2 class="quebra">Contribuição previdenciária por competência</h2>
<table class="mini"><thead><tr><th>Competência</th><th class="n">Base</th><th class="n">Empregado</th><th class="n">Empresa</th><th class="n">SAT</th><th class="n">Terceiros</th><th class="n">SELIC</th><th class="n">Juros empregado</th><th class="n">Juros patronal</th></tr></thead><tbody>
  ${a.inss.map(l => `<tr><td>${mesAno(l.comp)}${l.eh13 ? ' 13º' : ''}</td><td class="n">${num(l.base)}</td><td class="n">${num(l.empregado)}</td><td class="n">${num(l.empresa)}</td><td class="n">${num(l.sat)}</td><td class="n">${num(l.terceiros)}</td><td class="n">${num(l.taxaSelic)}%</td><td class="n">${num(l.jurosEmpregado)}</td><td class="n">${num(l.jurosPatronal)}</td></tr>`).join('')}
  <tr class="tot"><td>Total</td><td class="n">${num(a.baseInss)}</td><td class="n">${num(a.inssReclamante)}</td><td colspan="3" class="n">${num(a.inssEmpresa)}</td><td></td><td colspan="2" class="n">${num(a.selic)}</td></tr></tbody></table>
<h2>FGTS para pagamento via eSocial</h2>
<table class="mini"><thead><tr><th>Competência</th><th class="n">Salário de contribuição</th><th class="n">FGTS 8%</th><th class="n">Multa de 40%</th></tr></thead><tbody>
  ${a.fgts.map(l => `<tr><td>${mesAno(l.comp)}</td><td class="n">${num(l.base)}</td><td class="n">${num(l.fgts)}</td><td class="n">${l.multa ? num(l.multa) : ''}</td></tr>`).join('')}
  <tr class="tot"><td colspan="2">Total</td><td class="n">${num(a.valorFgts)}</td><td class="n">${num(a.valorMulta)}</td></tr></tbody></table>
<p class="nota" style="margin-top:14px">Emitido em ${new Date().toLocaleDateString('pt-BR')}.</p></body></html>`;
  }
  function abrirPdfAcordo(caso, a) {
    const w = window.open('', '_blank');
    if (!w) { alert('O navegador bloqueou a janela do relatório. Libere pop-ups para esta página.'); return; }
    w.document.write(acordoHtml(caso, a, location.href.replace(/[^/]*$/, ''))); w.document.close();
    w.onload = () => setTimeout(() => w.print(), 300);
  }

  global.SaidasPC = { relatorioHtml, abrirPdf, planilha, baixarExcel, acordoHtml, abrirPdfAcordo, versao: '0.2.0' };
})(typeof window !== 'undefined' ? window : globalThis);
