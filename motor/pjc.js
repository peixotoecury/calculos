/* Exportação para o PJe-Calc (.PJC) · Plataforma de Cálculos Peixoto & Cury
 *
 * PjcPC.xml(caso, r) monta o XML do PJC a partir dos parâmetros do caso e do resultado do motor;
 * PjcPC.arquivo(caso, r) devolve {nome, blob} (zip com um .PJC dentro, como o PJe-Calc exporta).
 *
 * Regras conferidas no PJe-Calc Cidadão 2.16 local (ferramentas/bancada_pjc.py):
 *  - O PJe-Calc refaz sozinho, ao liquidar, juros, FGTS, INSS e IR; as ocorrências das verbas, não: vão no
 *    arquivo com os valores do motor (sem elas o cálculo sai zerado; sem a "ocorrência original", não importa).
 *  - Referências (<internalRef>) só valem para objeto já escrito antes no arquivo: cada objeto sai completo
 *    na primeira vez em que aparece e por referência nas seguintes (função obj).
 *  - Datas em milissegundos, sempre 03:00 UTC (meia-noite de Brasília, como o PJe-Calc grava).
 *  - O esqueleto (parâmetros globais) vem de motor/pjc_modelo.js (ferramentas/gerar_modelo_pjc.py).
 */
(function (global) {
  'use strict';
  const ms = d => (d ? String(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10) || 1, 3)) : 'null');
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/[^\x20-\x7e]/g, c => `&#${c.charCodeAt(0)};`);
  const txt = v => (v == null || v === '' ? 'null' : esc(v));
  const num = (v, casas) => (v == null || v === '' || isNaN(v) ? 'null' : Number(v).toFixed(casas == null ? 10 : casas));
  const bool = v => (v ? 'true' : 'false');
  const el = (t, v) => `<${t}>${v}</${t}>`;
  const lista = itens => `<List>${itens.join('')}</List>`;
  const addDias = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const addAno = (d, n) => `${+d.slice(0, 4) + n}${d.slice(4)}`;
  // CNPJ (público) dos clientes do piloto, pelo nome da reclamada
  const CNPJ = { 'BRIDGESTONE': '57497539000115' };

  function xml(caso, r) {
    const M = global.PJC_MODELO;
    if (!M) throw new Error('Modelo do PJC não carregado (motor/pjc_modelo.js).');
    const p = caso.parametros, ct = p.contrato, at = p.atualizacao || {}, enc = p.encargos || {};
    let seq = 100000;
    const novo = () => String(seq++);
    const CALC = '994';                                   // id do <Calculo> no esqueleto
    const refCalc = `<calculo><Calculo><internalRef>${CALC}</internalRef></Calculo></calculo>`;
    const vistos = new Set();
    // objeto completo na primeira vez, referência nas demais (o corpo é montado depois de marcar como visto)
    function obj(tipo, id, corpo) {
      const k = tipo + ':' + id;
      if (vistos.has(k)) return `<${tipo}><internalRef>${id}</internalRef></${tipo}>`;
      vistos.add(k);
      return `<${tipo}>${corpo()}</${tipo}>`;
    }
    const ref = (tipo, id) => `<${tipo}><internalRef>${id}</internalRef></${tipo}>`;

    const porId = Object.fromEntries(p.verbas.map(v => [v.id, v]));
    const resultado = Object.fromEntries((r.verbas || []).map(v => [v.id, v]));
    const idV = {}, idF = {};
    p.verbas.forEach(v => { idV[v.id] = novo(); idF[v.id] = novo(); });

    // ---------- histórico salarial e cartão de ponto mensal ----------
    const idH = {}, idC = {};
    const historico = hid => {
      const h = (p.historicos || {})[hid]; if (!h) return null;
      const id = idH[hid] = idH[hid] || novo();
      return obj('HistoricoSalarial', id, () => el('id', id) + el('versao', '0') + el('nome', txt(h.nome)) + el('tipoVariacaoParcela', 'FIXA')
        + el('incidenciaFGTS', 'false') + el('aplicarProporcionalidadeFGTS', 'false') + el('incidenciaINSS', 'false') + el('aplicarProporcionalidadeINSS', 'false')
        + refCalc + el('ocorrencias', lista(Object.keys(h.valores).sort().map(m => '<OcorrenciaDoHistoricoSalarial>' + el('id', novo()) + el('versao', '0')
          + el('dataOcorrencia', ms(m + '-01')) + el('valor', num(h.valores[m] || 0, 2)) + el('recolhidoFGTS', 'false') + el('recolhidoINSS', 'false')
          + el('incidenciaFGTS', 'false') + el('incidenciaINSS', 'false') + el('historicoSalarial', ref('HistoricoSalarial', id)) + '</OcorrenciaDoHistoricoSalarial>'))));
    };
    const cartao = cid => {
      const c = (p.cartoes || {})[cid]; if (!c) return null;
      const id = idC[cid] = idC[cid] || novo();
      return obj('CartaoDePonto', id, () => el('id', id) + el('nome', txt(c.nome)) + el('versao', '0') + refCalc
        + el('ocorrencias', lista(Object.keys(c.valores).sort().map(m => '<OcorrenciaDoCartaoDePonto>' + el('id', novo()) + el('dataOcorrencia', ms(m + '-01'))
          + el('valor', num(c.valores[m] || 0, 4)) + el('versao', '0') + el('cartaoDePonto', ref('CartaoDePonto', id)) + '</OcorrenciaDoCartaoDePonto>'))));
    };

    // ---------- verbas ----------
    function assunto(v) {
      const A = M.assuntos, P = v.pjc || {};
      return P.assunto || A[v.nome] || A['#' + (v.descricao || '')] || (v.tipo === 'Reflexo' ? '2666' : '1666');
    }
    // a quantidade do montador com fator ou colunas a subtrair não existe no PJe-Calc: vai como informada,
    // mês a mês, nas ocorrências
    const qtdEspecial = F => F.qtdTipo === 'IMPORTADA_DO_CARTAO' && (F.qtdFator != null || (F.cartoesQtdMenos || []).length);

    function formula(v) {
      const F = v.formula || {}, P = v.pjc || {}, fid = idF[v.id];
      const tipo = v.tipo === 'Calculada' ? 'FormulaCalculada' : v.tipo === 'Reflexo' ? 'FormulaReflexo' : 'FormulaInformada';
      const valorPago = () => '<valorPago><ValorPago>' + el('id', novo()) + el('tipo', F.pagoTipo || 'INFORMADO')
        + el('valorInformado', F.pagoTipo === 'CALCULADO' ? 'null' : num(F.pago || 0)) + el('quantidade', num(F.pagoQtd, 4))
        + el('aplicarProporcionalidade', bool(F.pagoProporcional)) + el('baseTabelada', txt(F.pagoBaseTabelada === 'null' ? null : F.pagoBaseTabelada)) + '</ValorPago></valorPago>';
      return obj(tipo, fid, () => {
        if (tipo === 'FormulaInformada') {
          const o = ((resultado[v.id] || {}).ocorrencias || [])[0] || {};
          return el('id', fid) + el('versao', '0') + `<constante><Constante>${el('valor', num(o.devido || 0))}</Constante></constante>`
            + el('verbaDeCalculo', ref('Informada', idV[v.id])) + valorPago();
        }
        const itens = (F.baseVerbas || []).filter(id => porId[id]).map((id, i) => '<ItemBaseVerba>' + el('id', novo())
          + el('integralizar', (P.integralizar || [])[i] || 'NAO') + el('verbaDeCalculo', verba(porId[id])) + el('formula', ref(tipo, fid)) + '</ItemBaseVerba>');
        const qt = qtdEspecial(F) ? 'INFORMADA' : (F.qtdTipo || 'INFORMADA');
        const divTipo = F.divisorTipo || 'OUTRO_VALOR';
        return el('dobra', bool(P.dobra)) + el('id', fid) + el('versao', '0')
          + (tipo === 'FormulaCalculada' ? `<baseTabelada><BaseTabelada>${el('tipo', txt(F.baseTabelada === 'null' ? null : F.baseTabelada))}${el('aplicarProporcionalidade', bool(F.proporcionalBase))}</BaseTabelada></baseTabelada>` : '')
          + `<baseVerba><BaseVerba><itens>${lista(itens)}</itens></BaseVerba></baseVerba>`
          + '<divisor><Divisor>' + el('id', novo()) + el('tipo', divTipo) + el('outroValor', divTipo === 'OUTRO_VALOR' ? num(F.divisor == null ? 1 : F.divisor) : 'null') + '</Divisor></divisor>'
          + `<multiplicador><Multiplicador>${el('outroValor', num(F.mult == null ? 1 : F.mult))}</Multiplicador></multiplicador>`
          + '<quantidade><Quantidade>' + el('id', novo()) + el('tipo', qt) + el('valorInformado', qt === 'INFORMADA' ? num(F.qtd == null ? 1 : F.qtd) : 'null')
          + el('tipoImportadadoDoCartaoDePonto', 'null') + el('tipoImportadaCalendarioEnum', qt === 'IMPORTADA_DO_CALENDARIO' ? (P.calendario || 'REPOUSOS_FERIADOS') : 'null')
          + el('aplicarProporcionalidade', bool(F.qtdProporcional)) + '</Quantidade></quantidade>'
          + el('verbaDeCalculo', ref(v.tipo, idV[v.id])) + valorPago();
      });
    }

    function ocorrencias(v) {
      const rv = resultado[v.id]; if (!rv) return '';
      const fimAq = ini => addDias(addAno(ini, 1), -1);
      const compoe = v.compoePrincipal === 'NAO' ? 'NAO' : 'SIM', informada = v.tipo === 'Informada';
      return rv.ocorrencias.map(o => {
        const inf = informada || o.origem === 'informado';
        // mês desativado pelo advogado (lançamento "ativo: false"): vai desativado, senão o PJe-Calc recalcula o mês
        // (Leandro: aviso prévio de R$ 14.514,50 virava R$ 84.184,10 com os meses fora do período reativados)
        const ativo = rv.ocorrencias.filter(x => x.ini === o.ini).length > 1 || ((v.lancamentos || {})[o.ini] || {}).ativo !== false;
        // quantidade digitada no mês (lançamento): o PJe-Calc refaz a base do reflexo e mantém a quantidade gravada,
        // então vai a quantidade digitada, não a que o motor usou para chegar no mesmo valor
        // (Alisson: 13º de 2022 com 12 avos digitados; o motor chegava ao mesmo devido com 9 avos e base maior)
        const lq = ((v.lancamentos || {})[o.ini] || {}).qtd;
        // lançamentos são por data: com duas ocorrências na mesma data (férias vencidas e proporcionais na demissão,
        // Reinaldo) não dá para saber de qual é, então fica a do motor
        const unica = rv.ocorrencias.filter(x => x.ini === o.ini).length === 1;
        const qtd = !informada && unica && lq != null && v.tipo === 'Reflexo' ? lq : o.qtd;
        const qInt = o.base ? (o.qtd || 0) * (o.baseIntegral == null ? o.base : o.baseIntegral) / o.base : (o.qtd || 0);
        const aq = o.aquisitivoIni && v.ocorrencia === 'PERIODO_AQUISITIVO';
        const campos = (original) => el('id', novo()) + el('versao', '0') + el('dataInicial', ms(o.ini)) + el('dataFinal', ms(o.fim || o.ini))
          + el('divisor', informada ? 'null' : num(o.divisor)) + el('multiplicador', informada ? 'null' : num(o.mult, 8)) + el('quantidade', informada ? 'null' : num(qtd))
          + el('quantidadeIntegral', num(informada ? 0 : qInt, 4)) + el('dobra', 'false')
          + el('devido', original && !inf ? 'null' : num(o.devido || 0, 2)) + el('devidoIntegral', original && !inf ? 'null' : num(o.devidoIntegral == null ? o.devido || 0 : o.devidoIntegral, 2))
          + el('pago', num(o.pago || 0, 2)) + el('pagoIntegral', num(o.pagoIntegral || 0, 2)) + el('ativo', bool(ativo))
          + (original ? el('ocorrenciaOriginal', 'null') : '')
          + el('valor', inf ? 'INFORMADO' : 'CALCULADO') + el('comporPrincipal', compoe)
          + el('base', informada ? 'null' : num(o.base, 2)) + el('baseIntegral', informada ? 'null' : num(o.baseIntegral == null ? o.base : o.baseIntegral, 2))
          + el('dataInicialPeriodoAquisitivo', aq ? ms(o.aquisitivoIni) : 'null') + el('dataFinalPeriodoAquisitivo', aq ? ms(fimAq(o.aquisitivoIni)) : 'null')
          + el('feriasIndenizadas', bool(aq && o.feriasGozadas === false)) + el('feriasComAbono', bool(aq && o.feriasGozadas && o.parteSalarial != null && o.parteSalarial < 1))
          + el('indiceAcumulado', original ? 'null' : num(o.indice, 16)) + el('caracteristica', v.caracteristica || 'COMUM')
          + el('ocorrenciaDePagamento', v.ocorrencia || 'MENSAL') + el('verbaDeCalculo', ref(v.tipo, idV[v.id]));
        return `<OcorrenciaDeVerba>${campos(false)}<ocorrenciaOriginal><OcorrenciaDeVerba>${campos(true)}</OcorrenciaDeVerba></ocorrenciaOriginal></OcorrenciaDeVerba>`;
      }).join('');
    }

    function vinculos(v) {
      const F = v.formula || {}, eu = ref(v.tipo, idV[v.id]);
      const hist = (ids, tipo, prop) => lista((ids || []).map(historico_ref => {
        const h = historico(historico_ref); if (!h) return '';
        return '<HistoricoSalarialDaVerba>' + el('id', novo()) + el('tipoVinculoHistorico', tipo) + el('aplicarProporcionalidade', bool(prop))
          + el('verbaDeCalculo', eu) + el('historicoSalarial', h) + '</HistoricoSalarialDaVerba>';
      }));
      const cart = (ids, tipo) => lista((ids || []).map(cid => {
        const c = cartao(cid); if (!c) return '';
        return '<CartaoDePontoDaVerba>' + el('id', novo()) + el('tipoVinculoCartao', tipo) + el('verbaDeCalculo', eu) + el('cartaoDePonto', c) + '</CartaoDePontoDaVerba>';
      }));
      const baseHist = F.baseTabelada === 'HISTORICO_SALARIAL' ? F.historicosBase : [];
      const pagoHist = F.pagoTipo === 'CALCULADO' && F.pagoBaseTabelada === 'HISTORICO_SALARIAL' ? F.historicosPago : [];
      const qtdCart = F.qtdTipo === 'IMPORTADA_DO_CARTAO' && !qtdEspecial(F) ? F.cartoesQtd : [];
      const divCart = F.divisorTipo === 'IMPORTADO_DO_CARTAO' ? F.cartoesDivisor : [];
      // proporcionalidade da base do histórico: fica no vínculo (no motor, verba proporcional ou base proporcional)
      const propHist = F.histBaseProporcional != null ? F.histBaseProporcional : !!(v.proporcional || F.proporcionalBase);
      return el('historicosDaVerbaDoValorDevido', hist(baseHist, 'BASE', propHist))
        + el('historicosDaVerbaDoValorPago', hist(pagoHist, 'VALOR_PAGO', F.pagoProporcional))
        + el('cartoesDePontoDaVerbaQuantidade', cart(qtdCart, 'QUANTIDADE')) + el('cartoesDePontoDaVerbaDivisor', cart(divCart, 'DIVISOR'))
        + el('valesTransportesDoValorDevido', '<List></List>') + el('valesTransportesDoValorPago', '<List></List>');
    }

    function verba(v) {
      const P = v.pjc || {}, id = idV[v.id];
      return obj(v.tipo, id, () => (v.tipo === 'Reflexo'
          ? el('comportamentoDoReflexo', txt((v.reflexo || {}).comportamento)) + el('periodoMediaReflexo', txt((v.reflexo || {}).periodoMedia))
            + el('tratamentoDaFracaoDeMesDoReflexo', txt((v.reflexo || {}).fracao || 'MANTER')) : '')
        + el('id', id) + el('versao', '0') + el('nome', txt(v.nome)) + el('descricao', txt(v.descricao || v.nome))
        + el('tipoVariacaoParcela', P.tipoVariacaoParcela || 'FIXA')
        + el('incidenciaINSS', bool((v.incide || {}).inss)) + el('incidenciaIRPF', bool((v.incide || {}).irpf)) + el('incidenciaFGTS', bool((v.incide || {}).fgts))
        + el('incidenciaPrevidenciaPrivada', 'false') + el('incidenciaPensaoAlimenticia', 'false')
        + el('caracteristica', v.caracteristica || 'COMUM') + el('ocorrenciaDePagamento', v.ocorrencia || 'MENSAL')
        + el('jurosDoAjuizamento', v.jurosDoAjuizamento || 'OCORRENCIAS_VENCIDAS') + el('gerarPrincipal', v.gerarPrincipal || 'DIFERENCA')
        + el('periodoInicial', ms(v.ini || ct.admissao)) + el('periodoFinal', ms(v.fim || ct.demissao))
        + el('zeraValorNegativo', bool(P.zeraValorNegativo)) + el('comentarios', esc(P.comentarios || '')) + el('gerarReflexo', P.gerarReflexo || 'DIFERENCA')
        + el('aplicarProporcionalidade', bool(v.proporcional)) + el('ativo', bool(v.ativa !== false))
        + el('comporPrincipal', v.compoePrincipal === 'NAO' ? 'NAO' : 'SIM') + el('verbaAlterada', 'false')
        + el('salarioCategoriaValorDevido', 'null') + el('salarioCategoriaValorPago', 'null')
        + el('excluirFaltaJustificada', bool(v.excluiFaltaJust)) + el('excluirFaltaNaoJustificada', bool(v.excluiFaltaNaoJust))
        + el('excluirFeriasGozadas', bool(v.excluiFerias)) + el('ordem', v.ordem || 0) + refCalc
        + `<assuntoCnj><AssuntoCnj><externalRef>${assunto(v)}</externalRef></AssuntoCnj></assuntoCnj>`
        + el('formula', formula(v)) + el('ocorrencias', lista([ocorrencias(v)])) + vinculos(v));
    }

    const VERBAS = p.verbas.map(verba).join('');
    // históricos e cartões que nenhuma verba usa também vão (o advogado pode querer usar no PJe-Calc)
    const HIST = Object.keys(p.historicos || {}).map(historico).join('');
    const CART = Object.keys(p.cartoes || {}).map(cartao).join('');

    // ---------- férias, faltas, honorários, feriados facultativos ----------
    const FERIAS = (p.ferias || []).map(f => {
      const fimAq = f.aquisitivoFim || addDias(addAno(f.aquisitivoIni, 1), -1), conc = addDias(fimAq, 1);
      const g = i => f.gozos && f.gozos[i] ? f.gozos[i] : [null, null];
      return '<Ferias>' + el('id', novo()) + el('versao', '0') + el('relativa', txt(f.relativa || `${f.aquisitivoIni.slice(0, 4)}/${fimAq.slice(0, 4)}`))
        + el('dataInicialDoPeriodoAquisitivo', ms(f.aquisitivoIni)) + el('dataFinalDoPeriodoAquisitivo', ms(fimAq))
        + el('dataInicialDoPeriodoConcessivo', ms(conc)) + el('dataFinalDoPeriodoConcessivo', ms(addDias(addAno(conc, 1), -1)))
        + el('prazo', f.prazo == null ? 30 : f.prazo) + el('situacao', f.situacao || 'GOZADAS') + el('dobraGeral', bool(f.dobra))
        + el('abono', bool(f.abono)) + el('quantidadeDiasAbono', f.diasAbono || 10)
        + [0, 1, 2].map(i => el(`dataInicialDoPeriodoDeGozo${i + 1}`, ms(g(i)[0])) + el(`dataFinalDoPeriodoDeGozo${i + 1}`, ms(g(i)[1])) + el(`dobraDoPeriodoDeGozo${i + 1}`, 'false')).join('')
        + refCalc + '</Ferias>';
    }).join('');
    const FALTAS = (p.faltas || []).map(f => '<Falta>' + el('id', novo()) + el('versao', '0') + el('dataInicioPeriodoFalta', ms(f.ini))
      + el('dataTerminoPeriodoFalta', ms(f.fim || f.ini)) + el('faltaJustificada', bool(f.justificada)) + el('justificativaDaFalta', esc(f.motivo || ''))
      + el('reiniciarFerias', 'false') + refCalc + '</Falta>').join('');
    const HON = (enc.honorarios || []).map(h => '<Honorario>' + el('id', novo()) + el('versao', '0') + el('descricao', txt(h.descricao))
      + el('tipoHonorario', h.tipo || 'ADVOCATICIOS') + el('tipoDeDevedor', h.devedor || 'RECLAMADO') + el('nomeCredor', txt(h.credor || h.descricao))
      + el('tipoDocumentoFiscalCredor', 'null') + el('numeroDocumentoFiscalCredor', 'null') + el('apurarIRRF', 'false') + el('tipoImpostoRenda', 'null')
      + el('tipoValor', h.tipoValor || (h.valor != null ? 'INFORMADO' : 'CALCULADO')) + el('valor', h.valor != null ? num(h.valor) : 'null')
      + el('valorJurosCalcExterno', 'null') + el('dataVencimento', ms(h.vencimento)) + el('tipoDeIndiceDeCorrecao', 'UTILIZAR_INDICE_TRABALHISTA')
      + el('outroIndiceDeCorrecao', 'null') + el('aplicarJuros', 'false') + el('dataApartirDeAplicarJuros', 'null')
      + el('aliquota', h.aliquota != null ? num(h.aliquota, 2) : 'null') + el('baseParaApuracao', txt(h.base))
      + el('baseHonorario', 'null') + el('indiceCorrecaoHonorario', 'null') + el('taxaJurosHonorario', 'null')
      + el('valorInicialFaixaIrpf', 'null') + el('valorFinalFaixaIrpf', 'null') + el('valorAliquotaIrpf', 'null') + el('valorDeducaoIrpf', 'null')
      + el('valorImpostoRenda', '0') + el('apurarIRPFSobreJuros', 'false')
      + el('tipoCobrancaReclamante', h.devedor === 'RECLAMANTE' ? 'COBRAR' : 'DESCONTAR_CREDITO') + el('origemRegistro', 'CALCULO')
      + el('dataEvento', 'null') + el('folhaDoEvento', 'null') + refCalc + el('verbasSelecionadas', '<List></List>')
      + el('valorDescontoSimplificadoIrpf', '607.20') + el('valorTetoFaixaIsencaoIrpf', 'null') + el('valorTetoFaixaReducaoIrpf', 'null')
      + el('valorParcelaFaixaReducaoIrpf', 'null') + '</Honorario>').join('');
    const PONTOS = (ct.pontosFacultativos || []).filter(Boolean).map(u => '<ItemPontoFacultativo>' + el('id', novo())
      + `<pontoFacultativo><Feriado><externalRef>${esc(u)}</externalRef></Feriado></pontoFacultativo>` + refCalc + '</ItemPontoFacultativo>').join('');

    // ---------- correção e juros: combinações (ex.: IPCA a partir do ajuizamento; taxa legal depois) ----------
    const refPar = '<parametrosDeAtualizacao><ParametrosDeAtualizacao><internalRef>994</internalRef></ParametrosDeAtualizacao></parametrosDeAtualizacao>';
    const combI = at.combinacoesIndice || (at.combinarIndice && at.aPartirOutroIndice ? [{ indice: at.outroIndice || 'IPCA', aPartir: at.aPartirOutroIndice }] : []);
    const combJ = at.combinacoesJuros || (at.combinarJuros !== false ? [{ juros: 'TAXA_LEGAL', aPartir: at.aPartirOutroIndice || ct.ajuizamento }] : []);
    const COMB_I = combI.map(c => '<CombinacaoDeIndice>' + el('id', novo()) + el('versao', '0') + el('outroIndiceTrabalhista', c.indice)
      + el('apartirDeOutroIndice', ms(c.aPartir)) + refPar + '</CombinacaoDeIndice>').join('');
    const COMB_J = combJ.map(c => '<CombinacaoDeJuros>' + el('id', novo()) + el('versao', '0') + el('outroJuros', c.juros)
      + el('apartirDeOutroJuros', ms(c.aPartir)) + refPar + '</CombinacaoDeJuros>').join('');

    // ---------- processo ----------
    // CPF e CNPJ: só se informados (o PJe-Calc importa e liquida sem eles, mas só grava o resumo para o PJe com eles)
    const so = v => String(v || '').replace(/\D/g, '');
    const cpf = so((caso.processo || {}).cpf).length === 11 ? so(caso.processo.cpf) : 'null';
    const cnpj = so((caso.processo || {}).cnpj).length === 14 ? so(caso.processo.cnpj)
      : (Object.entries(CNPJ).find(([k]) => new RegExp(k, 'i').test((caso.processo || {}).reclamado || '')) || [, 'null'])[1];
    const n = String((caso.processo || {}).cnj || '').match(/^(\d{7})-(\d{2})\.(\d{4})\.(\d)\.(\d{2})\.(\d{4})$/);
    const PROC = '<processo><Processo>' + el('id', CALC) + el('versao', '0') + el('valorDaCausa', 'null') + el('dataAutuacao', 'null') + refCalc
      + (n ? `<identificador><IdentificadorDoProcesso>${el('numero', +n[1])}${el('ano', n[3])}${el('justica', n[4])}${el('regiao', +n[5])}${el('vara', +n[6])}${el('digito', +n[2])}</IdentificadorDoProcesso></identificador>`
           : el('identificador', 'null'))
      + `<reclamante><Reclamante>${el('tipoDocumentoPrevidenciario', 'null')}${el('numeroDocumentoPrevidenciario', 'null')}${el('nome', txt((caso.processo || {}).reclamante))}${el('tipoDocumentoFiscal', 'CPF')}${el('numeroDocumentoFiscal', cpf)}</Reclamante></reclamante>`
      + `<reclamado><Reclamado>${el('nome', txt((caso.processo || {}).reclamado))}${el('tipoDocumentoFiscal', 'CNPJ')}${el('numeroDocumentoFiscal', cnpj)}</Reclamado></reclamado>`
      + '<advogadosReclamante><List></List></advogadosReclamante><advogadosReclamado><List></List></advogadosReclamado></Processo></processo>';

    let x = M.xml;
    const troca = { PROCESSO: PROC, MUNICIPIO: `<municipio><Municipio><externalRef>${esc(ct.municipio || '7057')}</externalRef></Municipio></municipio>`,
      VERBAS, HISTORICOS: HIST, CARTOES: CART, FERIAS, FALTAS, HONORARIOS: HON, PONTOS, COMB_INDICES: COMB_I, COMB_JUROS: COMB_J,
      COMENTARIOS: esc('Exportado pela Plataforma de Cálculos Peixoto & Cury em ' + new Date().toLocaleDateString('pt-BR') + '.') };
    x = x.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in troca ? troca[k] : m));

    // ---------- campos do cálculo e dos blocos globais ----------
    // troca o primeiro <campo> depois do começo do bloco (o cabeçalho do <Calculo> vem antes de tudo)
    function campo(bloco, nome, valor) {
      if (valor === undefined) return;
      const ini = bloco ? x.indexOf(`<${bloco}>`) : 0;
      if (ini < 0) return;
      const re = new RegExp(`<${nome}>[^<]*</${nome}>`), pos = x.slice(ini).search(re);
      if (pos < 0) return;
      x = x.slice(0, ini) + x.slice(ini).replace(re, el(nome, valor));
    }
    const C = (k, v) => campo(null, k, v);
    C('dataCriacao', ms(new Date().toISOString().slice(0, 10)));
    C('dataAdmissao', ms(ct.admissao)); C('dataDemissao', ms(ct.demissao)); C('dataAjuizamento', ms(ct.ajuizamento));
    C('valorUltimaRemuneracao', num(ct.ultimaRemuneracao, 2)); C('valorMaiorRemuneracao', num(ct.maiorRemuneracao, 2));
    C('dataInicioCalculo', ms(ct.inicioCalculo)); C('dataTerminoCalculo', ms(ct.fimCalculo));
    C('valorCargaHorariaPadrao', num(ct.cargaHoraria || 220, 4)); C('sabadoDiaUtil', bool(ct.sabadoDiaUtil !== false));
    C('projetaAvisoIndenizado', bool(ct.projetaAviso)); C('consideraFeriadoEstadual', bool(ct.feriadoEstadual !== false));
    C('consideraFeriadoMunicipal', bool(ct.feriadoMunicipal !== false)); C('dataDeLiquidacao', ms(ct.liquidacao));
    C('indicesAcumulados', ct.indicesAcumulados || 'MES_SUBSEQUENTE_AO_VENCIMENTO');
    C('apuracaoPrazoDoAvisoPrevio', ct.apuracaoAviso || 'APURACAO_CALCULADA'); C('prazoAvisoInformado', ct.prazoAviso == null ? 'null' : String(ct.prazoAviso));
    C('diaFechamentoMes', String(ct.diaFechamentoMes || 31));

    const A = (k, v) => campo('parametrosDeAtualizacao', k, v);
    A('indiceTrabalhista', at.indice || 'IPCAE'); A('outroIndiceTrabalhista', txt(combI.length ? combI[0].indice : at.outroIndice));
    A('combinarOutroIndice', bool(combI.length)); A('apartirDeOutroIndice', combI.length ? ms(combI[0].aPartir) : 'null');
    A('ignorarTaxaNegativa', bool(at.ignorarNegativa !== false)); A('juros', at.juros || 'TRD_SIMPLES');
    A('aplicarJurosFasePreJudicial', bool(at.jurosPreJudicial !== false)); A('combinarOutroJuros', bool(combJ.length));
    A('baseDeJurosDasVerbas', at.baseJuros || 'VERBA_INSS');

    const fg = enc.fgts;
    if (fg) {
      const G = (k, v) => campo('fgts', k, v);
      G('periodoInicial', ms(fg.ini || ct.admissao)); G('periodoFinal', ms(fg.fim || ct.demissao)); G('destinoDoFgts', fg.destino || 'DEPOSITAR');
      G('aliquota', fg.aliquota === 2 ? 'DOIS_POR_CENTO' : 'OITO_POR_CENTO'); G('multa', bool(fg.multa));
      G('multaDoFgts', fg.multaPct === 20 ? 'VINTE_POR_CENTO' : 'QUARENTA_POR_CENTO'); G('excluirAvisoDaMulta', bool(fg.excluirAvisoDaMulta !== false));
      G('comporPrincipal', fg.compoePrincipal || 'SIM'); G('incidenciaDoFgts', fg.incidencia || 'SOBRE_O_TOTAL_DEVIDO');
    }
    const is = enc.inss;
    if (is) {
      const I = (k, v) => campo('inss', k, v);
      I('aliquotaEmpresaFixa', num(is.aliquotaEmpresa == null ? 20 : is.aliquotaEmpresa, 4)); I('aliquotaRATFixa', num(is.aliquotaRat == null ? 3 : is.aliquotaRat, 4));
      I('aliquotaTerceirosFixa', num(is.aliquotaTerceiros || 0, 4));
      I('apurarInssSegurado', bool(is.apurarSegurado !== false)); I('cobrarInssDoReclamante', bool(is.cobrarDoReclamante !== false));
    }
    // períodos que o PJe-Calc guarda nos blocos de INSS e IR (padrão dos 14 PJC do piloto): salários devidos = da
    // primeira à última verba; salários pagos = contrato; IR = anos anteriores até 31/12 do ano anterior à
    // liquidação (ou a demissão, se antes) e ano do recebimento a partir de 01/01 do ano da liquidação.
    // Sem isso fica a data do esqueleto e o PJe-Calc recusa ("Data Final deve ser menor que Data de Demissão").
    {
      const ativas = p.verbas.filter(v => v.ativa !== false);
      const iniV = ativas.map(v => v.ini || ct.admissao).sort()[0] || ct.admissao;
      const fimV = [ct.demissao, ...ativas.map(v => v.fim || ct.demissao)].sort().pop();
      campo('inssSobreSalariosDevidos', 'dataInicioPeriodo', ms(iniV)); campo('inssSobreSalariosDevidos', 'dataTerminoPeriodo', ms(fimV));
      campo('inssSobreSalariosPagos', 'dataInicioPeriodo', ms(ct.admissao)); campo('inssSobreSalariosPagos', 'dataTerminoPeriodo', ms(ct.demissao));
      const anoLiq = (ct.liquidacao || new Date().toISOString()).slice(0, 4), jan = `${anoLiq}-01-01`, dez = `${+anoLiq - 1}-12-31`;
      const anteriores = iniV < jan;
      campo('irpf', 'dataInicioAnosAnteriores', anteriores ? ms(iniV) : 'null');
      campo('irpf', 'dataFimAnosAnteriores', anteriores ? ms(ct.demissao && ct.demissao < dez ? ct.demissao : dez) : 'null');
      campo('irpf', 'dataInicioAnoRecebimento', ms(jan));
      campo('irpf', 'dataFimAnoRecebimento', ct.demissao && ct.demissao >= jan ? ms(ct.demissao) : 'null');
    }
    const ir = enc.irpf;
    if (ir) {
      const R = (k, v) => campo('irpf', k, v);
      R('apurarImpostoRenda', bool(ir.apurar !== false)); R('possuiDependentes', bool(ir.dependentes > 0)); R('quantidadeDependentes', String(ir.dependentes || 0));
      R('deduzirContribuicaoSocialDevidaPeloReclamante', bool(ir.deduzirInss !== false)); R('deduzirHonorariosDevidosPeloReclamante', bool(ir.deduzirHonorarios !== false));
    }
    const cu = enc.custas || { reclamado: 'NAO_SE_APLICA', reclamante: 'NAO_SE_APLICA' };
    {
      const K = (k, v) => campo('custasJudiciais', k, v);
      K('baseParaCustasCalculadas', cu.base || 'BRUTO_DEVIDO_AO_RECLAMANTE_MAIS_DEBITOS_RECLAMADO');
      K('tipoDeCustasDeConhecimentoDoReclamante', cu.reclamante || 'NAO_SE_APLICA'); K('valorDeConhecimentoDoReclamante', num(cu.valorReclamante));
      K('tipoDeCustasDeConhecimentoDoReclamado', cu.reclamado || 'NAO_SE_APLICA'); K('valorConhecimentoDoReclamado', num(cu.valorReclamado));
      K('dataVencimentoConhecimentoDoReclamado', ms(cu.vencReclamado || (cu.reclamado === 'INFORMADA' ? ct.liquidacao : null)));
    }
    const sobra = x.match(/\{\{\w+\}\}/);
    if (sobra) throw new Error('Campo do modelo sem preencher: ' + sobra[0]);
    return x;
  }

  // nome no padrão do PJe-Calc: PROCESSO_<número>_CALCULO_<id>_DATA_<ddmmaaaa>_HORA_<hhmmss>.PJC
  function nomeArquivo(caso) {
    const d = new Date(), z = v => String(v).padStart(2, '0');
    const num = String((caso.processo || {}).cnj || '').replace(/\D/g, '') || '0';
    return `PROCESSO_${num}_CALCULO_994_DATA_${z(d.getDate())}${z(d.getMonth() + 1)}${d.getFullYear()}_HORA_${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}.PJC`;
  }

  async function arquivo(caso, r) {
    if (!global.JSZip) throw new Error('Biblioteca de zip não carregada.');
    const z = new global.JSZip(), nome = nomeArquivo(caso);
    // o XML é só ASCII (o resto vai como &#NNN;), então serve como ISO-8859-1
    z.file(nome, xml(caso, r));
    const blob = await z.generateAsync({ type: 'blob', compression: 'DEFLATE', mimeType: 'application/octet-stream' });
    return { nome, blob };
  }

  global.PjcPC = { xml, arquivo, nomeArquivo, versao: '0.1.0' };
})(typeof window !== 'undefined' ? window : globalThis);
