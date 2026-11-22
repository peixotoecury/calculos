/* Central · Plataforma de Cálculos Peixoto & Cury
 * Acesso ao Supabase "Valores" com login (Supabase Auth). A chave publicável abaixo não dá acesso a nada
 * sem login: todas as tabelas têm RLS por equipe e o bucket de documentos é privado
 * (supabase/01_central_calculos.sql).
 */
(function (global) {
  'use strict';
  const URL_SB = 'https://sydamnqagkdmczmgkvso.supabase.co';
  const CHAVE = 'sb_publishable_kA_IDYtEdATSygg7EajrdQ_cEi4d57N';
  const BUCKET = 'calculos-documentos';
  const sb = global.supabase.createClient(URL_SB, CHAVE, { auth: { persistSession: true, storageKey: 'pc-calculos-auth' } });

  const TIPOS = { inicial: 'Cálculo pela inicial', liquidacao: 'Liquidação', impugnacao: 'Impugnação', concordancia: 'Concordância',
                  provisao: 'Provisão', acordo: 'Acordo', outro: 'Outro' };
  const STATUS = { rascunho: 'Rascunho', em_revisao: 'Em revisão', revisado: 'Revisado', devolvido: 'Devolvido para ajuste',
                   entregue: 'Entregue', arquivado: 'Arquivado' };
  const CHECKLIST = [
    'Decisão conferida: verbas, períodos e critérios batem com a sentença, o acórdão e os embargos',
    'Datas conferidas: admissão, demissão, ajuizamento e liquidação',
    'Salários e históricos conferidos com holerites ou ficha financeira',
    'Cartão de ponto e jornada conferidos (quando houver horas extras)',
    'Todas as verbas e reflexos deferidos estão no cálculo, e nada além deles',
    'Correção e juros conforme a decisão (ADC 58 e Lei 14.905/2024)',
    'INSS, imposto de renda e FGTS conferidos',
    'Honorários e custas conferidos',
    'Pendências da montagem resolvidas ou justificadas',
    'Comparado com o cálculo da parte contrária ou do perito, quando houver',
  ];

  const erro = r => { if (r.error) throw new Error(traduz(r.error.message)); return r.data; };
  function traduz(m) {
    if (/Invalid login credentials/i.test(m)) return 'E-mail ou senha incorretos.';
    if (/Email not confirmed/i.test(m)) return 'E-mail ainda não confirmado: abra o link que chegou no seu e-mail.';
    if (/already registered/i.test(m)) return 'Esse e-mail já tem login. Use "Entrar" com a sua senha (é a mesma das outras ferramentas LAWgico).';
    if (/Password should be at least/i.test(m)) return 'A senha precisa ter pelo menos 6 caracteres.';
    return m;
  }

  let perfil = null;
  async function eu() {
    const { data } = await sb.auth.getUser();
    if (!data || !data.user) return null;
    if (perfil && perfil.user_id === data.user.id) return perfil;
    const p = erro(await sb.from('calc_usuarios').select('*').eq('user_id', data.user.id).maybeSingle());
    perfil = p ? Object.assign({ email: data.user.email }, p) : { user_id: data.user.id, email: data.user.email, semCadastro: true };
    return perfil;
  }
  async function entrar(email, senha) { erro(await sb.auth.signInWithPassword({ email, password: senha })); perfil = null; return eu(); }
  async function sair() { await sb.auth.signOut(); perfil = null; }
  async function trocarSenha(nova) { erro(await sb.auth.updateUser({ password: nova })); }
  // envia o link de nova senha; o link volta para esta mesma página (precisa estar nas Redirect URLs do Supabase)
  async function esqueciSenha(email) {
    erro(await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname }));
  }

  async function listar(f) {
    f = f || {};
    let q = sb.from('calc_calculos').select('*').order('atualizado_em', { ascending: false }).limit(f.limite || 300);
    if (f.status) q = q.eq('status', f.status); else q = q.neq('status', 'arquivado');
    if (f.tipo) q = q.eq('tipo', f.tipo);
    if (f.cliente) q = q.ilike('cliente', `%${f.cliente}%`);
    if (f.busca) q = q.or(`cnj.ilike.%${f.busca}%,reclamante.ilike.%${f.busca}%`);
    return erro(await q);
  }
  async function calculo(id) { return erro(await sb.from('calc_calculos').select('*').eq('id', id).single()); }
  async function versao(id, numero) {
    let q = sb.from('calc_versoes').select('*').eq('calculo_id', id);
    q = numero ? q.eq('numero', numero) : q.order('numero', { ascending: false }).limit(1);
    const r = erro(await q); return r[0] || null;
  }
  async function versoes(id) { return erro(await sb.from('calc_versoes').select('numero, criado_por_nome, criado_em, totais, observacao').eq('calculo_id', id).order('numero', { ascending: false })); }
  async function revisoes(id) { return erro(await sb.from('calc_revisoes').select('*').eq('calculo_id', id).order('criado_em', { ascending: false })); }
  // últimas movimentações de todos os cálculos que a pessoa pode ver (a RLS filtra pela equipe)
  async function eventosRecentes(limite) {
    return erro(await sb.from('calc_eventos').select('*, calc_calculos(cnj, reclamante, cliente)').order('criado_em', { ascending: false }).limit(limite || 12));
  }
  async function eventos(id) { return erro(await sb.from('calc_eventos').select('*').eq('calculo_id', id).order('criado_em', { ascending: false })); }
  async function documentos(id) { return erro(await sb.from('calc_documentos').select('*').eq('calculo_id', id).order('criado_em')); }

  // grava cálculo e versão numa só operação no banco (calc_salvar); devolve {id, versao}
  async function salvar(p) { return erro(await sb.rpc('calc_salvar', { p })); }
  async function revisar(id, versaoN, checklist, resultado, comentario) {
    erro(await sb.rpc('calc_revisar', { p_calculo: id, p_versao: versaoN, p_checklist: checklist, p_resultado: resultado, p_comentario: comentario || null }));
  }
  async function status(id, novo, detalhe) { erro(await sb.rpc('calc_status', { p_calculo: id, p_status: novo, p_detalhe: detalhe || null })); }

  // documento: primeiro o arquivo no bucket, depois o registro; se o registro falhar, o arquivo é removido
  async function enviarDocumento(id, arquivo, tipo, paginas) {
    const limpo = arquivo.name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.\-]+/g, '_');
    const caminho = `${id}/${Date.now()}_${limpo}`;
    erro(await sb.storage.from(BUCKET).upload(caminho, arquivo, { contentType: arquivo.type || 'application/pdf', upsert: false }));
    const r = await sb.from('calc_documentos').insert({ calculo_id: id, nome: arquivo.name, tipo: tipo || null, storage_path: caminho, paginas: paginas || null, tamanho: arquivo.size });
    if (r.error) { await sb.storage.from(BUCKET).remove([caminho]); throw new Error(r.error.message); }
    return caminho;
  }
  async function linkDocumento(caminho) { return erro(await sb.storage.from(BUCKET).createSignedUrl(caminho, 600)).signedUrl; }

  // leitura com IA pelo servidor (Edge Function calc-ler; a chave da API fica no Supabase)
  async function lerIA(corpo) {
    const { data, error } = await sb.functions.invoke('calc-ler', { body: corpo });
    if (error) {
      let msg = error.message;
      try { const j = await error.context.json(); if (j && j.erro) msg = j.erro; } catch (e) {}
      throw new Error(msg);
    }
    return data;
  }

  // acesso criado pela própria central (supabase/02_acesso_pela_central.sql)
  async function criarLogin(nome, email, senha) {
    if (!/@peixotoecury\.com\.br$/i.test(email)) throw new Error('Use o seu e-mail @peixotoecury.com.br.');
    const r = erro(await sb.auth.signUp({ email, password: senha, options: { data: { nome } } }));
    if (!r.session) return 'confirmar_email';
    perfil = null;
    return pedirAcesso(nome);
  }
  async function pedirAcesso(nome) { const r = erro(await sb.rpc('calc_pedir_acesso', { p_nome: nome })); perfil = null; return r; }
  async function meuPedido() {
    const { data } = await sb.auth.getUser(); if (!data || !data.user) return null;
    return erro(await sb.from('calc_pedidos_acesso').select('*').eq('user_id', data.user.id).maybeSingle());
  }
  async function pedidos() { return erro(await sb.from('calc_pedidos_acesso').select('*').eq('situacao', 'pendente').order('criado_em')); }
  async function usuarios() { return erro(await sb.from('calc_usuarios').select('*').order('nome')); }
  async function decidirAcesso(userId, aprovar, equipe, papel) {
    erro(await sb.rpc('calc_decidir_acesso', { p_user: userId, p_aprovar: aprovar, p_equipe: equipe, p_papel: papel }));
  }
  async function ajustarUsuario(userId, equipe, papel, ativo) {
    erro(await sb.rpc('calc_ajustar_usuario', { p_user: userId, p_equipe: equipe, p_papel: papel, p_ativo: ativo }));
  }

  global.CentralPC = { sb, eu, entrar, sair, trocarSenha, esqueciSenha, lerIA, eventosRecentes, criarLogin, pedirAcesso, meuPedido, pedidos, usuarios, decidirAcesso, ajustarUsuario, listar, calculo, versao, versoes, revisoes, eventos, documentos,
                       salvar, revisar, status, enviarDocumento, linkDocumento, TIPOS, STATUS, CHECKLIST };
})(window);
