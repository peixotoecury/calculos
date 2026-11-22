/* Montador · Plataforma de Cálculos Peixoto & Cury
 *
 * Transforma a leitura APROVADA (parâmetros da decisão, revisados pelo advogado) e os dados do contrato
 * (datas, férias, faltas, salários, cartão de ponto) no caso que o motor calcula.
 *
 * Regras:
 *  - Só entra verba aprovada (aprovado !== false). O que não tiver receita aqui vira pendência, nunca chute.
 *  - Padrões de encargos vêm dos cálculos do contador (mesmos em todos os casos de teste) e podem ser
 *    trocados por cliente em CLIENTES.
 *  - Cada escolha que não veio da decisão fica registrada em `premissas`, para aparecer na tela.
 */
(function (global) {
  'use strict';

  // padrões por cliente (empresa 20%, SAT/RAT 3%, terceiros 0: conferidos nos PJC do contador)
  const CLIENTES = {
    padrao: { inss: { aliquotaEmpresa: 20, aliquotaRat: 3, aliquotaTerceiros: 0 }, cargaHoraria: 220 },
  };

  // pontos facultativos que o PJe-Calc marca por padrão (Carnaval, Sexta-feira Santa, Corpus Christi),
  // pelos identificadores da tabela de feriados oficial; usados como repouso no RSR
  const PONTOS_PADRAO = ['40675cd3-c285-477a-821f-8337feaf04a7', '09368bb6-d8dc-4e3a-ae3c-2d4d4521e552', 'ab7eff16-19bd-4dac-893b-b12f8fb805e1'];
  const INCIDE_SALARIAL = { inss: true, irpf: true, fgts: true };
  const INCIDE_NADA = { inss: false, irpf: false, fgts: false };
  const ehData = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '');

  // configuração do cartão igual à que o contador usa nos PJC de teste (tolerância de 10 min por dia,
  // hora noturna urbana com redução ficta, feriados considerados, domingo sem jornada)
  function configCartao(j, ini, fim) {
    const h = n => `${String(Math.floor(n)).padStart(2, '0')}:${String(Math.round((n % 1) * 60)).padStart(2, '0')}`;
    const d = j.diaria ? h(j.diaria) : '00:00';
    return { dataInicial: ini, dataFinal: fim,
      formaDeApuracaoCartao: !j.diaria ? 'NAO_APURAR_HORAS_EXTRAS' : (j.semanal ? 'HORAS_EXTRAS_PELO_CRITERIO_MAIS_FAVORAVEL' : 'HORAS_EXTRAS_EXCEDENTES_DA_JORNADA_DIARIA'),
      valorJornadaDiariaSegundaFeira: d, valorJornadaDiariaTercaFeira: d, valorJornadaDiariaQuartaFeira: d, valorJornadaDiariaQuintaFeira: d,
      valorJornadaDiariaSextaFeira: d, valorJornadaDiariaSab: j.sabado != null ? h(j.sabado) : d, valorJornadaDiariaDom: '00:00',
      qtJornadaSemanal: String(j.semanal || 0), toleranciaPorDia: '00:10', considerarFeriados: 'true', considerarReducaoFictaDaHoraNoturna: 'true',
      horarioNoturnoApuracaroCartao: 'ATIVIDADE_URBANA', horarioProrrogadoSumula60: j.sumula60 ? 'true' : 'false',
      intervaloDescontoTotal: j.intervalo ? h(j.intervalo) : null,
      extraDescansoSeparado: j.domingoSeparado ? 'true' : 'false', extraFeriadoSeparado: j.domingoSeparado ? 'true' : 'false' };
  }

  // Jornada das horas extras tirada da decisão: "excedentes da 6ª diária e da 36ª semanal" = 6 h de segunda
  // a sábado, 36 h na semana, critério mais favorável (Alisson). Só sugestão: o advogado confere na tela.
  const NUM = { quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, doze: 12 };
  function jornadaDaDecisao(leitura) {
    for (const v of (leitura && leitura.verbas_deferidas) || []) {
      if (v.tipo !== 'horas_extras' || v.aprovado === false) continue;
      const t = `${v.descricao} ${v.quantidade} ${v.trecho}`.toLowerCase().replace(/\b(quatro|cinco|seis|sete|oito|nove|dez|doze)\b/g, w => NUM[w]);
      const dia = t.match(/(\d{1,2})\s*[ªaº°o]?\s*(?:hora\s*)?di[áa]ria|(\d{1,2})\s*horas?\s*di[áa]rias|exced\w*\s+(?:a\s+|as\s+|à\s+)?(\d{1,2})\s*[ªaº]?\s*(?:hora|h\b)/);
      const sem = t.match(/(\d{2})\s*[ªaº°]?\s*(?:hora\s*)?semana|(\d{2})\s*horas?\s*semana/);
      const diaria = dia ? +(dia[1] || dia[2] || dia[3]) : null, semanal = sem ? +(sem[1] || sem[2]) : null;
      if (diaria || semanal) return { diaria, semanal, sumula60: /s[úu]mula\s*60/.test(`${v.descricao} ${v.quantidade}`.toLowerCase()), trecho: v.trecho || '' };
    }
    return { diaria: null, semanal: null, sumula60: false, trecho: '' };
  }

  function montar(leitura, dados, opcoes) {
    opcoes = opcoes || {};
    const premissas = [], pendencias = [];
    const cli = Object.assign({}, CLIENTES.padrao, CLIENTES[opcoes.cliente] || {});
    const ct = Object.assign({
      cargaHoraria: cli.cargaHoraria, sabadoDiaUtil: true, projetaAviso: true, apuracaoAviso: 'APURACAO_CALCULADA',
      feriadoEstadual: true, feriadoMunicipal: true, indicesAcumulados: 'MES_SUBSEQUENTE_AO_VENCIMENTO', diaFechamentoMes: 31,
    }, dados.contrato || {});
    if (!ct.pontosFacultativos || !ct.pontosFacultativos.length) {
      ct.pontosFacultativos = PONTOS_PADRAO;
      premissas.push('RSR: Carnaval, Sexta-feira Santa e Corpus Christi contados como feriado (padrão do PJe-Calc).');
    }
    const lc = leitura.contrato || {};
    for (const k of ['admissao', 'demissao', 'ajuizamento']) {
      if (!ct[k] && ehData(lc[k])) { ct[k] = lc[k]; premissas.push(`${k}: ${lc[k]} (lida na decisão)`); }
      if (!ct[k]) pendencias.push(`Informar a data de ${k}.`);
    }
    if (!ct.liquidacao) pendencias.push('Informar a data da liquidação.');

    const verbas = [];
    let seq = 0;
    const novoId = () => 'v' + (++seq);
    const base = (o) => Object.assign({
      tipo: 'Calculada', caracteristica: 'COMUM', ocorrencia: 'MENSAL', ini: ct.admissao, fim: ct.demissao, ativa: true, ordem: seq,
      proporcional: false, excluiFerias: false, excluiFaltaJust: false, excluiFaltaNaoJust: false, incide: INCIDE_SALARIAL,
      gerarPrincipal: 'DIFERENCA', compoePrincipal: 'SIM', jurosDoAjuizamento: 'OCORRENCIAS_VENCIDAS', reflexo: null,
      informados: [], lancamentos: {}, esperado: [],
    }, o);
    const formula = (o) => Object.assign({ baseTabelada: null, proporcionalBase: false, baseVerbas: [], historicos: [], historicosBase: [],
      historicosPago: [], cartoesQtd: [], cartoesDivisor: [], mult: 1, divisorTipo: 'OUTRO_VALOR', divisor: 1, qtdTipo: 'INFORMADA', qtd: 1,
      pagoTipo: 'INFORMADO', pago: 0 }, o);

    // reflexos a partir da lista de reflexos da decisão
    function reflexos(v, principal, comportamento) {
      const lista = (v.reflexos || []).map(s => s.toLowerCase());
      const tem = re => lista.some(s => re.test(s));
      const comp = comportamento || 'VALOR_MENSAL';
      // o reflexo segue o período da verba principal (Alisson: 13º de 2022 com 9 avos, a partir de 04/2022)
      const r = (nome, o) => verbas.push(base(Object.assign({ id: novoId(), tipo: 'Reflexo', nome: `${nome} SOBRE ${principal.nome}`, ini: principal.ini, fim: principal.fim,
        reflexo: { comportamento: comp, periodoMedia: o.periodo || 'ANO_CIVIL', fracao: o.fracao || (comp === 'MEDIA_PELA_QUANTIDADE' ? 'MANTER' : 'INTEGRALIZAR') } }, o.verba,
        { formula: formula(Object.assign({ baseVerbas: [principal.id] }, o.formula)) })));
      if (tem(/dsr|repouso|rsr/)) verbas.push(base({ id: novoId(), tipo: 'Reflexo', nome: `REPOUSO SEMANAL REMUNERADO E FERIADO SOBRE ${principal.nome}`, ini: principal.ini, fim: principal.fim,
        reflexo: { comportamento: 'VALOR_MENSAL', periodoMedia: 'ANO_CIVIL', fracao: 'MANTER' },     // RSR é sempre pelo valor do mês
        formula: formula({ baseVerbas: [principal.id], divisorTipo: 'DIAS_UTEIS', divisor: null, qtdTipo: 'IMPORTADA_DO_CALENDARIO', qtd: null }) }));
      if (tem(/13/)) r('13º SALÁRIO', { verba: { caracteristica: 'DECIMO_TERCEIRO_SALARIO', ocorrencia: 'DEZEMBRO' },
        formula: { divisor: 12, qtdTipo: 'AVOS', qtd: null } });
      if (tem(/f[ée]rias/)) r('FÉRIAS + 1/3', { verba: { caracteristica: 'FERIAS', ocorrencia: 'PERIODO_AQUISITIVO' }, periodo: 'PERIODO_AQUISITIVO',
        formula: { mult: 4 / 3, divisor: 12, qtdTipo: 'AVOS', qtd: null } });
      if (tem(/aviso/)) r('AVISO PRÉVIO', { verba: { caracteristica: 'AVISO_PREVIO', ocorrencia: 'DESLIGAMENTO', incide: { inss: false, irpf: false, fgts: true } },
        periodo: 'ULTIMOS_DOZE_MESES_DO_CONTRATO', formula: { divisor: 30, qtdTipo: 'APURADA', qtd: null } });
      if (tem(/477/)) r('MULTA DO ARTIGO 477 DA CLT', { verba: { ocorrencia: 'DESLIGAMENTO', incide: INCIDE_NADA }, formula: { divisor: 1, qtd: 1 } });
      const outros = lista.filter(s => !/dsr|repouso|rsr|13|f[ée]rias|aviso|477|fgts/.test(s));
      if (outros.length) pendencias.push(`${principal.nome}: reflexos que dependem de valores pagos nos holerites ainda não montados (${outros.join('; ')}).`);
      return tem(/fgts/);
    }

    let fgts = false;
    const historicoBase = (dados.historicoSalarioBase || null);

    // colunas do cartão de ponto: usa as do processo se houver; senão cria as que o motor sabe apurar das batidas
    const cartoes = Object.assign({}, dados.cartoes || {});
    function coluna(re, nome) {
      const id = Object.keys(cartoes).find(k => re.test(cartoes[k].nome || ''));
      if (id) return id;
      cartoes['col_' + nome] = { nome, valores: {} };
      return 'col_' + nome;
    }

    // cartão de ponto da tela: batidas dia a dia + jornada (da decisão ou corrigida pelo advogado)
    let apuracoes = dados.apuracoesCartao || [];
    if (!apuracoes.length && dados.batidas && Object.keys(dados.batidas).length) {
      const j = dados.jornada || jornadaDaDecisao(leitura), ds = Object.keys(dados.batidas).sort();
      apuracoes = [{ config: configCartao(j, ds[0], ds[ds.length - 1]), batidas: dados.batidas }];
      premissas.push(`Cartão de ponto: ${ds.length} dia(s) de ${ds[0].split('-').reverse().join('/')} a ${ds[ds.length - 1].split('-').reverse().join('/')}`
        + (j.diaria ? `; jornada de ${j.diaria}h por dia${j.semanal ? ` e ${j.semanal}h por semana, critério mais favorável` : ''}` : '; sem jornada informada (só dias e horas trabalhadas)')
        + `; tolerância de 10 min por dia; hora noturna reduzida${j.sumula60 ? '; Súmula 60, II' : ''}${j.domingoSeparado ? '; domingos e feriados trabalhados fora das extras (apurados em separado)' : ''}${j.intervalo ? `; intervalo de ${j.intervalo}h descontado do total nos dias com uma só entrada e saída` : ''}.`);
    }

    // Horas extras e tempo à disposição. Base: salário do histórico, com os adicionais deferidos e os pagos
    // (noturno etc.) quando a decisão manda pela globalidade; divisor: o da decisão ou a carga horária;
    // multiplicador: 1 + adicional (ou só o adicional, quando a decisão defere apenas ele). Quantidade:
    // minutos fixos por dia trabalhado ou as extras apuradas no cartão. Devolve as verbas principais criadas.
    function horasExtras(v, ini, fim) {
      const nomeV = v.descricao || v.tipo;
      const texto = `${v.descricao} ${v.base_de_calculo} ${v.quantidade} ${v.trecho}`.toLowerCase();
      const textoBase = `${v.descricao} ${v.base_de_calculo}`.toLowerCase();   // só a base (o trecho fala de "repousos remunerados")
      if (!historicoBase) { pendencias.push(`${nomeV}: falta o histórico do salário base (holerites ou ficha financeira).`); return []; }
      if (!apuracoes.length) {
        pendencias.push(`${nomeV}: faltam os cartões de ponto (batidas) para apurar a quantidade.`); return [];
      }
      const pct = v.percentual || 0;
      if (!pct) { pendencias.push(`${nomeV}: a decisão não fixou o adicional; informe o percentual.`); return []; }
      const soAdicional = /adicional de \d+\s?% sobre o tempo|apenas o adicional|somente o adicional/.test(texto) && !/hora cheia|acrescid/.test(texto);
      const divDecisao = +((texto.match(/divisor\s*(?:de\s*)?(\d{2,3})/) || [])[1] || 0);
      const div = divDecisao || ct.cargaHoraria;
      if (divDecisao && divDecisao !== ct.cargaHoraria) premissas.push(`Horas extras: divisor ${divDecisao} da decisão, diferente da carga horária do contrato (${ct.cargaHoraria}).`);
      premissas.push(`${v.tipo === 'tempo_a_disposicao' ? 'Tempo à disposição' : 'Horas extras'}: ${soAdicional ? `só o adicional de ${pct}% (a hora já foi paga)` : `hora + adicional de ${pct}%`}, divisor ${div}${divDecisao ? ' (da decisão)' : ' (carga horária)'}.`);
      const baseVerbas = [], historicosBase = [historicoBase];
      if (/globalidade|adicionais|habituais|s[úu]mula 264|oj 47|s[úu]mula 132/.test(textoBase)) {
        for (const x of verbas) if (x.tipo === 'Calculada' && /ADICIONAL DE (INSALUBRIDADE|PERICULOSIDADE)/.test(x.nome)) baseVerbas.push(x.id);
        const hs = dados.historicos || {};
        for (const k of Object.keys(hs)) if (k !== historicoBase && /ADICIONAL|ADC\.?\s/i.test(hs[k].nome || '') && /noturno|insalub|periculos/i.test(hs[k].nome || '')
          && texto.includes((hs[k].nome.match(/noturno|insalub|periculos/i) || [''])[0].toLowerCase())) historicosBase.push(k);
        premissas.push(`Horas extras: base pela globalidade salarial (${[...baseVerbas.map(id => verbas.find(x => x.id === id).nome), ...historicosBase.slice(1).map(k => hs[k].nome)].join('; ') || 'nenhum adicional encontrado além do salário'}).`);
      }
      if (/dedu[çc][ãa]o das horas extras|horas extras j[áa] (quitadas|pagas)/.test(texto))
        pendencias.push(`${nomeV}: a decisão autoriza deduzir as horas extras já pagas; lance os valores dos holerites como lançamento manual (ou confirme que não houve pagamento).`);
      const comum = { baseTabelada: 'HISTORICO_SALARIAL', historicosBase, baseVerbas, divisorTipo: 'OUTRO_VALOR', divisor: div };
      const criar = (nome, mult, F) => {
        const pr = base({ id: novoId(), nome, ini, fim, excluiFerias: true, excluiFaltaJust: true, excluiFaltaNaoJust: true,
          formula: formula(Object.assign({}, comum, { mult }, F)) });
        verbas.push(pr); return pr;
      };
      const min = (texto.match(/(\d{1,3})\s*min(?:utos)?\s*(?:por|ao|\/)\s*dia/) || [])[1];
      if (min) {
        const fator = +min / 60, dobra = /dobrad|em dobro|100\s?%/.test(texto) && /domingos?|feriados?|repousos?/.test(texto);
        const dias = coluna(/^dias/i, 'Dias Trabalhados'), dr = dobra ? coluna(/feriados?\s+e\s+repousos?\s+trab/i, 'Feriados e Repousos Trabalhados') : null;
        premissas.push(`Quantidade: ${min} minutos por dia efetivamente trabalhado (dias apurados no cartão)${dobra ? '; domingos e feriados trabalhados em verba própria com adicional de 100%' : ''}.`);
        const out = [criar(`HORAS EXTRAS ${pct}% - ${min} MIN. AO DIA`, soAdicional ? pct / 100 : 1 + pct / 100,
          { qtdTipo: 'IMPORTADA_DO_CARTAO', cartoesQtd: [dias], cartoesQtdMenos: dr ? [dr] : [], qtdFator: fator, qtd: null })];
        if (dr) out.push(criar(`HORAS EXTRAS 100% - ${min} MIN. AO DIA`, 2, { qtdTipo: 'IMPORTADA_DO_CARTAO', cartoesQtd: [dr], qtdFator: fator, qtd: null }));
        const ap0 = apuracoes.map(a => a.config && a.config.dataInicial).filter(Boolean).sort()[0];
        if (ap0 && ini && ap0 > ini) pendencias.push(`${nomeV}: o cartão começa em ${ap0.split('-').reverse().join('/')}, depois do início do período (${ini.split('-').reverse().join('/')}); informe a quantidade dos meses sem cartão (o contador costuma usar a média).`);
        return out;
      }
      if (apuracoes.every(a => a.config.formaDeApuracaoCartao === 'NAO_APURAR_HORAS_EXTRAS')) {
        pendencias.push(`${nomeV}: informe a jornada (horas por dia e por semana) para apurar as extras no cartão.`); return [];
      }
      premissas.push('Quantidade: horas extras apuradas no cartão de ponto, pela jornada e critério configurados.');
      return [criar(`HORAS EXTRAS ${pct}%`, soAdicional ? pct / 100 : 1 + pct / 100,
        { qtdTipo: 'IMPORTADA_DO_CARTAO', cartoesQtd: [coluna(/^hs\.?\s*ext|^horas extras/i, 'Hs EXT')], qtd: null })];
    }
    for (const v of leitura.verbas_deferidas || []) {
      if (v.aprovado === false) { premissas.push(`${v.tipo}: não aprovado pelo advogado, fora do cálculo.`); continue; }
      const ini = ehData(v.periodo_inicio) ? v.periodo_inicio : ct.admissao, fim = ehData(v.periodo_fim) ? v.periodo_fim : ct.demissao;
      const pct = v.percentual || 0;
      if (v.tipo === 'insalubridade' || v.tipo === 'periculosidade') {
        const sm = v.tipo === 'insalubridade' && !/sal[áa]rio base|remunera/i.test(v.base_de_calculo || '');
        if (sm) premissas.push(`${v.tipo}: base salário mínimo${/m[íi]nimo/i.test(v.base_de_calculo || '') ? '' : ' (padrão da Súmula Vinculante 4; a decisão não disse a base)'}.`);
        if (!sm && !historicoBase) { pendencias.push(`${v.tipo}: falta o histórico do salário base (holerites ou ficha financeira).`); continue; }
        const nome = `ADICIONAL DE ${v.tipo === 'insalubridade' ? 'INSALUBRIDADE' : 'PERICULOSIDADE'} ${pct}%`;
        const pr = base({ id: novoId(), nome, ini, fim, proporcional: true, excluiFerias: true, excluiFaltaNaoJust: true,
          formula: formula(sm ? { baseTabelada: 'SALARIO_MINIMO', proporcionalBase: true, mult: pct / 100 }
                              : { baseTabelada: 'HISTORICO_SALARIAL', historicosBase: [historicoBase], mult: pct / 100 }) });
        verbas.push(pr);
        fgts = reflexos(v, pr) || fgts;
      } else if (v.tipo === 'horas_extras' || v.tipo === 'tempo_a_disposicao') {
        for (const pr of horasExtras(v, ini, fim)) fgts = reflexos(v, pr, 'MEDIA_PELA_QUANTIDADE') || fgts;
      } else if (v.tipo === 'dano_moral') {
        if (!v.valor_fixo) { pendencias.push('Dano moral: informar o valor arbitrado.'); continue; }
        const data = dados.dataArbitramento || dados.dataDecisao;
        if (!data) { pendencias.push('Dano moral: informar a data do arbitramento (data da decisão).'); continue; }
        verbas.push(base({ id: novoId(), tipo: 'Informada', nome: 'INDENIZAÇÃO POR DANO MORAL', ini: data, fim: data, incide: INCIDE_NADA,
          jurosDoAjuizamento: 'OCORRENCIAS_VENCIDAS_E_VINCENDAS', formula: {},
          informados: [{ ini: data, fim: data, devido: v.valor_fixo, pago: 0, devidoIntegral: v.valor_fixo, valor: 'INFORMADO' }] }));
        premissas.push('Dano moral: correção desde o arbitramento e juros desde o ajuizamento (Súmula 439 do TST).');
      } else {
        pendencias.push(`${v.descricao || v.tipo}: receita de cálculo ainda não implementada no montador.`);
      }
    }

    // mês do período da verba sem salário no histórico daria base zero sem aviso: vira pendência
    const proxMes = m => { const [a, b] = m.split('-').map(Number); return b === 12 ? `${a + 1}-01` : `${a}-${String(b + 1).padStart(2, '0')}`; };
    const faltando = {};
    for (const v of verbas) for (const hb of ((v.formula || {}).historicosBase || []).slice(0, 1)) {
      const vals = ((dados.historicos || {})[hb] || {}).valores || {};
      if (!v.ini || !v.fim) continue;
      for (let m = v.ini.slice(0, 7), k = 0; m <= v.fim.slice(0, 7) && k < 600; m = proxMes(m), k++) if (!vals[m]) (faltando[hb] || (faltando[hb] = new Set())).add(m);
    }
    for (const [hb, ms] of Object.entries(faltando)) {
      const l = [...ms].sort(), fmt = m => `${m.slice(5)}/${m.slice(0, 4)}`;
      pendencias.push(`${((dados.historicos || {})[hb] || {}).nome || 'Salário'}: sem valor em ${l.length} mês(es) do período das verbas (${l.slice(0, 6).map(fmt).join(', ')}${l.length > 6 ? '…' : ''}). Anexe os holerites desses meses ou informe a faixa salarial.`);
    }

    // lançamentos manuais: valores tirados dos documentos (holerites) ou informados pelo advogado,
    // como reflexos sobre verbas pagas e deduções de valores já recebidos (acordo, ação coletiva)
    for (const l of dados.lancamentos || []) {
      const oc = (l.ocorrencias || []).filter(o => o.devido || o.pago);
      if (!oc.length) continue;
      verbas.push(base({ id: novoId(), tipo: 'Informada', nome: l.nome, ini: oc[0].ini, fim: oc[oc.length - 1].fim || oc[oc.length - 1].ini,
        ocorrencia: l.ocorrencia || 'MENSAL', incide: l.incide || INCIDE_SALARIAL, formula: {},
        informados: oc.map(o => ({ ini: o.ini, fim: o.fim || o.ini, devido: o.devido || 0, pago: o.pago || 0,
          devidoIntegral: o.devidoIntegral ?? o.devido ?? 0, pagoIntegral: o.pagoIntegral ?? o.pago ?? 0, valor: 'INFORMADO' })) }));
      premissas.push(`${l.nome}: lançamento manual (${oc.length} ocorrência(s)${l.origem ? ', ' + l.origem : ''}).`);
    }
    // pendência de reflexo sobre verba paga resolvida por lançamento manual correspondente
    const nomesLanc = (dados.lancamentos || []).map(l => (l.nome || '').toLowerCase()).join(' ');
    for (let i = pendencias.length - 1; i >= 0; i--) {
      if (/valores pagos nos holerites/.test(pendencias[i]) && /noturno/.test(nomesLanc) && /extra/.test(nomesLanc)) pendencias.splice(i, 1);
    }

    // atualização: IPCA-E até a troca e IPCA depois; juros TRD na fase pré-judicial e taxa legal depois
    const at = leitura.atualizacao || {}, txt = `${at.correcao || ''} ${at.trecho || ''}`.toLowerCase();
    let troca = ct.ajuizamento;
    if (ct.ajuizamento && ct.ajuizamento > '2024-08-30' && !/pr[ée].?judicial[^.]*ipca-?e|ipca-?e[^.]*pr[ée].?judicial/.test(txt)) {
      troca = '2024-08-30';
      premissas.push('Correção: IPCA a partir de 30/08/2024 (Lei 14.905/2024), porque a decisão não manda IPCA-E na fase pré-judicial.');
    } else if (troca) premissas.push(`Correção: IPCA-E até a véspera do ajuizamento e IPCA a partir de ${troca}.`);
    const atualizacao = { indice: 'IPCAE', outroIndice: 'IPCA', combinarIndice: true, aPartirOutroIndice: troca, ignorarNegativa: true,
      juros: 'TRD_SIMPLES', jurosPreJudicial: true, combinarJuros: true, baseJuros: 'VERBA_INSS' };
    if (!at.correcao) pendencias.push('A decisão não definiu correção e juros: confirme o critério (ADC 58 e Lei 14.905/2024).');

    // honorários e custas
    const honorarios = [];
    for (const h of leitura.honorarios || []) {
      if (h.tipo === 'periciais') {
        if (h.valor) honorarios.push({ descricao: 'HONORÁRIOS PERICIAIS', tipo: 'PERICIAIS_OUTROS', devedor: h.devedor === 'reclamante' ? 'RECLAMANTE' : 'RECLAMADO',
          credor: 'PERITO', tipoValor: 'INFORMADO', valor: h.valor, aliquota: null, base: null });
        continue;
      }
      if (h.devedor === 'reclamante') { premissas.push('Honorários devidos pelo reclamante: fora do cálculo (conferir se a exigibilidade está suspensa).'); continue; }
      if (!h.percentual) continue;
      const b = /dedu|menos|l[íi]quid|contribui/i.test(h.base || '') ? 'BRUTO_MENOS_CONTRIBUICAO_SOCIAL' : 'BRUTO';
      honorarios.push({ descricao: 'HONORÁRIOS ADVOCATÍCIOS', tipo: 'ADVOCATICIOS', devedor: 'RECLAMADO', credor: 'PATRONO DO RECLAMANTE',
        tipoValor: 'CALCULADO', valor: null, aliquota: h.percentual, base: b });
      premissas.push(`Honorários advocatícios: ${h.percentual}% sobre ${b === 'BRUTO' ? 'o bruto' : 'o bruto menos a contribuição do reclamante'}.`);
    }
    const custas = leitura.custas && leitura.custas.valor ? { reclamado: 'INFORMADA', valorReclamado: leitura.custas.valor } : { reclamado: 'NAO_SE_APLICA' };

    const encargos = {
      fgts: fgts ? { ini: ct.admissao, fim: ct.demissao, destino: 'DEPOSITAR', aliquota: 8, multa: true, multaPct: 40, excluirAvisoDaMulta: true, compoePrincipal: 'SIM' } : null,
      inss: Object.assign({ apurarSegurado: true, cobrarDoReclamante: true }, cli.inss),
      irpf: { apurar: true, dependentes: 0, deduzirInss: true, deduzirHonorarios: true },
      honorarios, custas,
    };
    if (fgts) premissas.push('FGTS 8% com multa de 40%, depositado na conta vinculada.');

    const caso = {
      processo: dados.processo || {},
      parametros: { contrato: ct, ferias: dados.ferias || [], faltas: dados.faltas || [], historicos: dados.historicos || {},
        cartoes, apuracoesCartao: apuracoes, verbas, atualizacao, encargos },
      esperado: {},
    };
    return { caso, premissas, pendencias };
  }

  global.MontarPC = { montar, jornadaDaDecisao, CLIENTES, versao: '0.2.0' };
})(typeof window !== 'undefined' ? window : globalThis);
