var ss = SpreadsheetApp.getActiveSpreadsheet();

var SENHA_MESTRA_API = PropertiesService.getScriptProperties().getProperty('SENHA_MESTRA_API');
var SENHA_ADMIN = PropertiesService.getScriptProperties().getProperty('SENHA_ADMIN');

if (!SENHA_MESTRA_API || !SENHA_ADMIN) {
  throw new Error("ATENÇÃO: Propriedades do script (SENHA_MESTRA_API e/ou SENHA_ADMIN) não configuradas no Apps Script.");
}

var SCHEMA = {
  usuarios: [
    'id', 'usuario', 'nome', 'pin', 'rendaFixa', 'parceiroId', 'ativo',
    'permissoes', 'preferenciasNotificacao', 'fotoPerfil', 'trocaSenhaObrigatoria',
    'configuracaoSalarial'
  ],

  categorias: ['id', 'nome', 'tipo', 'classificacao', 'criadopor'],

  cartoes: [
    'id', 'usuarioId', 'nome', 'limite', 'fechamento', 'vencimento',
    'isBeneficio', 'tipoCartao', 'ativo', 'createdAt', 'updatedAt'
  ],

  lancamentos: [
    'id', 'usuarioId', 'descricao', 'valor', 'tipo', 'categoriaId',
    'formaPagamento', 'cartaoId', 'vencimento', 'recorrencia',
    'parcelaAtual', 'totalParcelas', 'observacao', 'horaExtra', 'naturezaRenda',
    'servicoEssencial', 'pago', 'status', 'dataCompra', 'dataPagamento',
    'usuarioPagamentoId', 'financiamentoId', 'parcelamentoId', 'bemId', 'escopo',
    'faturaId',
    'createdAt', 'updatedAt'
  ],

  financiamentos: [
    'id', 'usuarioId', 'nome', 'tipoContrato', 'bemId', 'totalMeses', 'mesesPagos',
    'valorParcela', 'valorLiberado', 'categoriaId', 'categoriaEntradaId', 'dataLiberacao',
    'valorCompra', 'valorEntrada', 'valorFinanciado', 'primeiroVencimento',
    'escopoContrato', 'ativo', 'createdAt', 'updatedAt'
  ],

  bens: [
    'id', 'usuarioId', 'nome', 'tipo', 'valor', 'identificadorEspecifico',
    'statusBem', 'compartilhado', 'ativo', 'createdAt'
  ],

  notificacoes: [
    'id', 'usuarioDestinoId', 'remetenteId', 'tipo', 'titulo', 'mensagem',
    'lida', 'statusAprovacao', 'createdAt'
  ],

  logs: [
    'id', 'dataHora', 'dataHoraFormatada', 'usuario', 'usuarioId',
    'acao', 'detalhes', 'entidade', 'entidadeId'
  ],

  exclusao_movimento: [
    'id', 'dataHora', 'usuario', 'usuarioId', 'lancamentoId',
    'descricao', 'valor', 'motivo'
  ],

  edicao_movimento: [
    'id', 'dataHora', 'usuario', 'usuarioId', 'lancamentoId',
    'descricaoAntiga', 'descricaoNova', 'valorAntigo', 'valorNovo',
    'motivo'
  ],

  fatura_cartao: [
    'id', 'cartaoId', 'mesReferencia', 'valorTotal', 'valorPago',
    'status', 'dataVencimento', 'createdAt', 'updatedAt'
  ]
};

var CAMPOS_DATA = {
  vencimento: true,
  dataCompra: true,
  dataPagamento: true,
  dataLiberacao: true,
  primeiroVencimento: true,
  dataVencimento: true
};

var CAMPOS_JSON = {
  permissoes: true,
  preferenciasNotificacao: true,
  configuracaoSalarial: true
};

var CAMPOS_BOOLEAN = {
  ativo: true,
  isBeneficio: true,
  compartilhado: true,
  pago: true,
  lida: true,
  trocaSenhaObrigatoria: true
};

function respostaJson(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function tokenValido(token) {
  var tokenInformado = token == null ? '' : String(token).trim();
  var tokenConfigurado = String(SENHA_MESTRA_API || '').trim();
  return tokenInformado !== '' && tokenConfigurado !== '' && tokenInformado === tokenConfigurado;
}

// O token de integração identifica o aplicativo, NÃO um usuário autenticado.
// Sessões de curta duração impedem o uso da API apenas com a chave pública do JS.
var DURACAO_SESSAO_SEGUNDOS = 21600;

function criarSessaoUsuario(usuario) {
  var chave = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  CacheService.getScriptCache().put('sessao_' + chave, JSON.stringify({
    id: String(usuario.id), credencial: String(usuario.pin || usuario.senha || '')
  }), DURACAO_SESSAO_SEGUNDOS);
  return chave;
}

function autenticarSessao(chave) {
  var sessao = String(chave || '').trim();
  if (!/^[a-f0-9]{64}$/i.test(sessao)) return null;
  var cache = CacheService.getScriptCache();
  var registro = cache.get('sessao_' + sessao);
  if (!registro) return null;
  var dadosSessao;
  try { dadosSessao = JSON.parse(registro); } catch (_) { return null; }
  var usuario = lerAba('usuarios').find(function(u) { return String(u.id) === dadosSessao.id; });
  if (!usuario || usuario.ativo === false ||
      String(usuario.pin || usuario.senha || '') !== String(dadosSessao.credencial || '')) return null;
  cache.put('sessao_' + sessao, registro, DURACAO_SESSAO_SEGUNDOS);
  return usuario;
}

function acessoAdministrativo(usuario) {
  return usuario && (usuario.permissoes && (usuario.permissoes.perfil === 'admin' || usuario.permissoes.acoes && usuario.permissoes.acoes.usuarios === true));
}

function acessoAuditoria(usuario) {
  return acessoAdministrativo(usuario) || Boolean(usuario && usuario.permissoes && usuario.permissoes.acoes && usuario.permissoes.acoes.logs === true);
}

function acessoElevado(chave, usuario) {
  return acessoAdministrativo(usuario) && CacheService.getScriptCache().get('admin_' + chave) === '1';
}

function hashValido(hash) { return /^[a-f0-9]{64}$/i.test(String(hash || '')); }

function registroAlterado(original, proposto, campos) {
  return campos.some(function(campo) {
    return JSON.stringify(original && original[campo] == null ? null : original && original[campo]) !==
      JSON.stringify(proposto && proposto[campo] == null ? null : proposto && proposto[campo]);
  });
}

function conferirAlteracoesUsuarios(original, proposta, usuario, sessao, notificacoesAntigas, notificacoesNovas) {
  var identidade = String(usuario.id);
  var elevado = acessoElevado(sessao, usuario);
  var origPorId = {};
  original.forEach(function(u) { origPorId[String(u.id)] = u; });
  var novosIds = {};
  var camposPermitidos = ['nome', 'usuario', 'rendaFixa', 'configuracaoSalarial', 'preferenciasNotificacao', 'fotoPerfil', 'parceiroId', 'pin', 'trocaSenhaObrigatoria'];
  var pendentes = notificacoesAntigas.filter(function(n) {
    return n.tipo === 'solicitacao_parceiro' && n.statusAprovacao === 'pendente' && String(n.usuarioDestinoId) === identidade;
  });
  proposta.forEach(function(u) {
    var id = String(u.id);
    if (!id || novosIds[id]) throw new Error('Identificador de usuário inválido ou duplicado.');
    novosIds[id] = true;
    var velho = origPorId[id];
    if (!velho) {
      if (!elevado) throw new Error('Somente um administrador autorizado pode cadastrar usuários.');
      if (!hashValido(u.pin)) throw new Error('Uma senha inicial válida é obrigatória.');
      return;
    }
    var pinNovo = String(u.pin || '').trim();
    var pinAnterior = String(velho.pin || velho.senha || '').trim();
    if (pinNovo && pinNovo !== pinAnterior && !hashValido(pinNovo)) throw new Error('Formato de senha inválido.');
    if (!pinNovo) u.pin = pinAnterior; // O hash nunca é enviado na leitura da API.

    if (elevado) return;
    if (id === identidade) {
      if (u.configuracaoSalarial != null) {
        var conf = u.configuracaoSalarial;
        if (!conf || typeof conf !== 'object' || Array.isArray(conf) || JSON.stringify(conf).length > 12000) {
          throw new Error('Configuração salarial inválida.');
        }
        var deps = Number(conf.dependentes || 0);
        var custoVT = Number(conf.vtCustoMensal || 0);
        if (!Number.isInteger(deps) || deps < 0 || deps > 20 || !Number.isFinite(custoVT) || custoVT < 0 || custoVT > 1000000) {
          throw new Error('Dependentes ou vale-transporte inválidos.');
        }
        if (conf.descontos != null && (!Array.isArray(conf.descontos) || conf.descontos.length > 20)) {
          throw new Error('Quantidade de descontos adicionais inválida.');
        }
        (conf.descontos || []).forEach(function(d) {
          var v = Number(d && d.valor);
          if (!d || typeof d.nome !== 'string' || !d.nome.trim() || d.nome.length > 70 ||
              ['fixo','percentual'].indexOf(d.tipo) < 0 || !Number.isFinite(v) || v < 0 ||
              v > (d.tipo === 'percentual' ? 100 : 10000000)) {
            throw new Error('Desconto salarial inválido.');
          }
        });
      }
      var salarioBruto = u.rendaFixa == null || u.rendaFixa === '' ? 0 : Number(u.rendaFixa);
      if (!Number.isFinite(salarioBruto) || salarioBruto < 0 || salarioBruto > 10000000) {
        throw new Error('Salário bruto inválido.');
      }
      var proibidos = SCHEMA.usuarios.filter(function(campo) { return camposPermitidos.indexOf(campo) < 0; });
      if (registroAlterado(velho, u, proibidos)) throw new Error('Você não pode alterar suas próprias permissões ou estado da conta.');
      var parceiroAntes = String(velho.parceiroId || '');
      var parceiroDepois = String(u.parceiroId || '');
      if (parceiroDepois && parceiroAntes !== parceiroDepois) {
        var aprovou = pendentes.some(function(n) {
          return String(n.remetenteId) === parceiroDepois && notificacoesNovas.some(function(atualizada) {
            return String(atualizada.id) === String(n.id) && atualizada.statusAprovacao === 'aprovado';
          });
        });
        if (!aprovou) throw new Error('O vínculo com parceiro precisa ser aprovado pela outra conta.');
      }
      if (velho.trocaSenhaObrigatoria === true && u.trocaSenhaObrigatoria === false && u.pin === pinAnterior) {
        throw new Error('Troque a senha provisória antes de liberar a conta.');
      }
      return;
    }
    var somenteParceiro = !registroAlterado(velho, u, SCHEMA.usuarios.filter(function(campo) { return campo !== 'parceiroId'; }));
    var aceitouSolicitacao = pendentes.some(function(n) {
      return String(n.remetenteId) === id && notificacoesNovas.some(function(atualizada) {
        return String(atualizada.id) === String(n.id) && atualizada.statusAprovacao === 'aprovado';
      });
    });
    if (somenteParceiro && aceitouSolicitacao && String(u.parceiroId) === identidade) return;
    if (registroAlterado(velho, u, SCHEMA.usuarios)) throw new Error('Alterar outro usuário exige autorização administrativa.');
  });
  original.forEach(function(u) { if (!novosIds[String(u.id)] && !elevado) throw new Error('Remover usuários exige autorização administrativa.'); });
  var logins = {};
  proposta.forEach(function(u) {
    var login = String(u.usuario || u.nome || '').trim().toLowerCase();
    if (!login || logins[login]) throw new Error('Login vazio ou duplicado.');
    logins[login] = true;
  });
  if (!proposta.some(function(u) { return u.ativo !== false && u.permissoes && u.permissoes.perfil === 'admin'; })) {
    throw new Error('É obrigatório manter ao menos um administrador ativo.');
  }
}

function conferirAuditoria(original, proposta, usuario, elevado, colecao) {
  if (elevado) return;
  var antes = {};
  original.forEach(function(r) { antes[String(r.id)] = r; });
  var depois = {};
  proposta.forEach(function(r) {
    var id = String(r.id);
    if (!id || depois[id]) throw new Error('Registro de auditoria duplicado.');
    depois[id] = true;
    if (antes[id] && registroAlterado(antes[id], r, SCHEMA[colecao])) throw new Error('Registros de auditoria não podem ser alterados.');
    if (!antes[id] && String(r.usuarioId) !== String(usuario.id)) throw new Error('Auditoria de outro usuário não pode ser criada.');
  });
  original.forEach(function(r) {
    if (!depois[String(r.id)]) {
      if (String(r.usuarioId) === String(usuario.id)) throw new Error('Excluir auditoria exige autorização administrativa.');
      // Usuários comuns recebem apenas os próprios logs; preserve o histórico alheio.
      proposta.push(r);
    }
  });
}

function conferirNotificacoes(original, proposta, usuario, elevado) {
  if (elevado) return;
  var antes = {};
  original.forEach(function(n) { antes[String(n.id)] = n; });
  var depois = {};
  proposta.forEach(function(n) {
    var id = String(n.id);
    if (!id || depois[id]) throw new Error('Notificação duplicada.');
    depois[id] = true;
    if (antes[id] && registroAlterado(antes[id], n, SCHEMA.notificacoes) && String(antes[id].usuarioDestinoId) !== String(usuario.id)) {
      throw new Error('Não é permitido modificar notificações de outro usuário.');
    }
    if (!antes[id] && n.tipo !== 'alerta_vencimento' && String(n.remetenteId) !== String(usuario.id)) {
      throw new Error('Remetente da notificação inválido.');
    }
    if (!antes[id] && n.tipo === 'alerta_vencimento' && String(n.usuarioDestinoId) !== String(usuario.id)) {
      throw new Error('Lembrete de outro usuário inválido.');
    }
  });
  original.forEach(function(n) { if (!depois[String(n.id)] && String(n.usuarioDestinoId) !== String(usuario.id)) throw new Error('Não é permitido excluir notificações de outro usuário.'); });
}

function conferirAlteracoesFinanceiras(antes, depois, usuario) {
  if (usuario.permissoes && usuario.permissoes.perfil === 'admin') return;
  var acoes = usuario.permissoes && usuario.permissoes.acoes || {};
  var donosPermitidos = [String(usuario.id)];
  if (usuario.parceiroId != null && usuario.parceiroId !== '') donosPermitidos.push(String(usuario.parceiroId));
  var colecoes = ['lancamentos', 'cartoes', 'financiamentos', 'bens', 'fatura_cartao', 'categorias'];
  colecoes.forEach(function(nome) {
    var antigos = {};
    antes[nome].forEach(function(r) { antigos[String(r.id)] = r; });
    var novos = {};
    depois[nome].forEach(function(r) { novos[String(r.id)] = r; });
    var todosIds = {};
    Object.keys(antigos).concat(Object.keys(novos)).forEach(function(id) { todosIds[id] = true; });
    Object.keys(todosIds).forEach(function(id) {
      var velho = antigos[id];
      var novo = novos[id];
      var mudou = !velho || !novo || registroAlterado(velho, novo, SCHEMA[nome]);
      if (!mudou) return;
      if (!acoes.criarMovimento) throw new Error('Seu perfil não permite alterar informações financeiras.');
      if (!novo && !acoes.excluirMovimento) throw new Error('Seu perfil não permite excluir registros financeiros.');
      if (nome === 'categorias') return; // Catálogo compartilhado do sistema.
      var dono = novo && novo.usuarioId != null && novo.usuarioId !== '' ? novo.usuarioId : velho && velho.usuarioId;
      if (nome === 'fatura_cartao') {
        var cartaoId = novo && novo.cartaoId || velho && velho.cartaoId;
        var cartao = depois.cartoes.filter(function(c) { return String(c.id) === String(cartaoId); })[0] ||
          antes.cartoes.filter(function(c) { return String(c.id) === String(cartaoId); })[0];
        dono = cartao && cartao.usuarioId;
      }
      if (dono == null || donosPermitidos.indexOf(String(dono)) < 0) {
        throw new Error('Não é permitido alterar lançamentos de outra conta sem vínculo de parceiro.');
      }
    });
  });
}

var CHAVE_REVISAO_DADOS = 'DADOS_REVISAO';

function obterRevisaoDados() {
  var valor = PropertiesService.getScriptProperties().getProperty(CHAVE_REVISAO_DADOS);
  var revisao = Number(valor);
  return Number.isFinite(revisao) && revisao >= 0 ? revisao : 0;
}

function definirRevisaoDados(revisao) {
  PropertiesService.getScriptProperties().setProperty(CHAVE_REVISAO_DADOS, String(revisao));
}

function normalizarDataISO(val) {
  if (val === null || val === undefined || val === '') return '';

  if (val instanceof Date) {
    if (isNaN(val.getTime())) return '';
    return Utilities.formatDate(val, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }

  var texto = String(val).trim();
  if (!texto) return '';

  var partes = texto.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:$|[T\s])/);
  var ano, mes, dia;

  if (partes) {
    ano = Number(partes[1]); mes = Number(partes[2]); dia = Number(partes[3]);
  } else {
    partes = texto.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})(?:$|[\s,])/);
    if (!partes) return texto;
    dia = Number(partes[1]); mes = Number(partes[2]); ano = Number(partes[3]);
  }

  if (!ano || mes < 1 || mes > 12 || dia < 1 || dia > 31) return texto;
  var teste = new Date(ano, mes - 1, dia);
  if (teste.getFullYear() !== ano || teste.getMonth() !== mes - 1 || teste.getDate() !== dia) return texto;

  return String(ano).padStart(4, '0') + '-' + String(mes).padStart(2, '0') + '-' + String(dia).padStart(2, '0');
}

function formatarDataParaPlanilha(val) {
  return normalizarDataISO(val);
}

function doGet(e) {
  try {
    e = e || { parameter: {} };

    var token = e.parameter && e.parameter.token;
    var action = e.parameter && e.parameter.action;

    if (!tokenValido(token)) {
      return respostaJson({
        status: 'erro',
        mensagem: 'Acesso não autorizado'
      });
    }

    if (action === 'statusCadastro') {
      return respostaJson({ status: 'sucesso', primeiroCadastroDisponivel: lerAba('usuarios').length === 0 });
    }

    if (action === 'obterDados') {
      var usuarioLeitura = autenticarSessao(e.parameter.sessao);
      if (!usuarioLeitura) return respostaJson({ status: 'erro', mensagem: 'Sessão expirada. Entre novamente.' });
      var leituraLock = LockService.getScriptLock();
      leituraLock.waitLock(15000);
      try {
        return retornarDadosCompletos(usuarioLeitura);
      } finally {
        leituraLock.releaseLock();
      }
    }

    if (action === 'revisao') {
      if (!autenticarSessao(e.parameter.sessao)) return respostaJson({ status: 'erro', mensagem: 'Sessão expirada. Entre novamente.' });
      return respostaJson({
        status: 'sucesso',
        _revision: obterRevisaoDados()
      });
    }

    if (action === 'ping') {
      return respostaJson({
        status: 'sucesso',
        mensagem: 'API online',
        dataHora: new Date().toISOString()
      });
    }

    return respostaJson({
      status: 'erro',
      mensagem: 'Ação inválida'
    });
  } catch (err) {
    return respostaJson({
      status: 'erro',
      mensagem: String(err)
    });
  }
}

function doPost(e) {
  var lock = LockService.getScriptLock();

  try {
    if (!e || !e.postData || e.postData.contents == null) {
      return respostaJson({
        status: 'erro',
        mensagem: 'Corpo da requisição ausente'
      });
    }

    var data = JSON.parse(e.postData.contents);
    var token = data.token;
    var action = data.action;

    if (!tokenValido(token)) {
      return respostaJson({
        status: 'erro',
        mensagem: 'Acesso não autorizado'
      });
    }

    // Consultas protegidas via POST evitam colocar o identificador da sessão na URL.
    if (action === 'obterDados' || action === 'revisao') {
      var usuarioConsulta = autenticarSessao(data.sessao);
      if (!usuarioConsulta) return respostaJson({ status: 'erro', mensagem: 'Sessão expirada. Entre novamente.' });
      if (action === 'revisao') return respostaJson({ status: 'sucesso', _revision: obterRevisaoDados() });
      lock.waitLock(15000);
      try { return retornarDadosCompletos(usuarioConsulta); }
      finally { lock.releaseLock(); }
    }

    if (action === 'registrarPrimeiroUsuario') {
      lock.waitLock(15000);
      try {
        if (lerAba('usuarios').length > 0) {
          return respostaJson({ status: 'erro', mensagem: 'O sistema já possui usuários. Solicite o cadastro a um administrador.' });
        }
        if (String(data.senhaAdmin || '') !== String(SENHA_ADMIN)) {
          return respostaJson({ status: 'erro', mensagem: 'Senha administrativa de configuração incorreta.' });
        }
        var loginInicial = String(data.usuario || '').trim();
        var nomeInicial = String(data.nome || '').trim();
        if (!loginInicial || !nomeInicial || loginInicial.length > 80 || nomeInicial.length > 100 || !hashValido(data.senhaHash)) {
          return respostaJson({ status: 'erro', mensagem: 'Cadastro inicial inválido.' });
        }
        var novoUsuario = {
          id: 1, usuario: loginInicial, nome: nomeInicial, pin: String(data.senhaHash), ativo: true,
          trocaSenhaObrigatoria: false,
          permissoes: {
            perfil: 'admin',
            paginas: { dashboard: true, relatorios: true, lancamentos: true, cartoes: true, categorias: true, configuracoes: true },
            acoes: { criarMovimento: true, excluirMovimento: true, financiamentos: true, lotes: true, usuarios: true, logs: true }
          },
          preferenciasNotificacao: { ativo: true, diasAntecedencia: 3 }
        };
        escreverAba('usuarios', [novoUsuario], SCHEMA.usuarios);
        definirRevisaoDados(obterRevisaoDados() + 1);
        return respostaJson({ status: 'sucesso', mensagem: 'Primeiro usuário cadastrado.' });
      } finally {
        lock.releaseLock();
      }
    }

    if (action === 'verificarAdmin') {
      var adminSolicitante = autenticarSessao(data.sessao);
      if (!adminSolicitante || !acessoAuditoria(adminSolicitante)) {
        return respostaJson({ status: 'erro', mensagem: 'Sessão ou permissão administrativa inválida.' });
      }
      var senhaInformada = data.senha == null ? '' : String(data.senha).trim();
      var senhaConfigurada = String(SENHA_ADMIN || '').trim();
      var autorizado = senhaInformada !== '' && senhaConfigurada !== '' && senhaInformada === senhaConfigurada;
      if (autorizado) CacheService.getScriptCache().put('admin_' + data.sessao, '1', 300);
      return respostaJson({
        status: 'sucesso',
        autorizado: autorizado
      });
    }

    if (action === 'verificarCredenciaisLogin') {
      var usuarioLogin = data.usuario ? String(data.usuario).trim() : '';
      var senhaHash = data.senhaHash ? String(data.senhaHash).trim() : '';

      var usuarios = lerAba('usuarios');
      var usuarioEncontrado = null;

      for (var i = 0; i < usuarios.length; i++) {
        var u = usuarios[i];
        var nomeUser = String(u.usuario || '').trim().toLowerCase();
        var nomeCompleto = String(u.nome || '').trim().toLowerCase();
        var busca = usuarioLogin.toLowerCase();

        if (nomeUser === busca || nomeCompleto === busca) {
          usuarioEncontrado = u;
          break;
        }
      }

      if (!usuarioEncontrado) {
        return respostaJson({ status: 'erro', mensagem: 'Usuário não encontrado.' });
      }

      if (usuarioEncontrado.ativo === false || usuarioEncontrado.ativo === 'FALSE') {
        return respostaJson({ status: 'erro', mensagem: 'Este usuário está desativado.' });
      }

      // [FIX #2] Retorno mínimo — apenas primeiro nome, sem PII.
      if (senhaHash === 'CHECK_APENAS_USUARIO') {
        return respostaJson({
          status: 'sucesso',
          usuario: {
            id: usuarioEncontrado.id,
            nome: String(usuarioEncontrado.nome || '').split(' ')[0],
            usuario: usuarioEncontrado.usuario
          }
        });
      }

      var cacheLogin = CacheService.getScriptCache();
      var chaveTentativas = 'tentativas_' + String(usuarioEncontrado.id);
      var tentativas = Number(cacheLogin.get(chaveTentativas) || 0);
      if (tentativas >= 6) return respostaJson({ status: 'erro', mensagem: 'Muitas tentativas. Aguarde 15 minutos.' });

      var senhaCadastrada = String(usuarioEncontrado.pin || usuarioEncontrado.senha || '').trim();

      // [FIX #1] Usuário sem senha NÃO pode entrar — exige redefinição.
      if (senhaCadastrada === '') {
        return respostaJson({
          status: 'erro',
          mensagem: 'Este usuário ainda não possui palavra-passe cadastrada. Peça ao administrador para redefinir o acesso.'
        });
      }

      if (senhaCadastrada !== senhaHash) {
        cacheLogin.put(chaveTentativas, String(tentativas + 1), 900);
        return respostaJson({ status: 'erro', mensagem: 'Palavra-passe incorreta.' });
      }

      cacheLogin.remove(chaveTentativas);

      return respostaJson({
        status: 'sucesso',
        primeiroAcesso: false,
        sessao: criarSessaoUsuario(usuarioEncontrado),
        trocaSenhaObrigatoria: usuarioEncontrado.trocaSenhaObrigatoria === true,
        usuario: {
          id: usuarioEncontrado.id,
          nome: usuarioEncontrado.nome,
          usuario: usuarioEncontrado.usuario,
          fotoPerfil: usuarioEncontrado.fotoPerfil || '',
          permissoes: usuarioEncontrado.permissoes || {}
        }
      });
    }

    if (action !== 'salvarDados') {
      return respostaJson({
        status: 'erro',
        mensagem: 'Ação inválida'
      });
    }

    if (!data.dados || typeof data.dados !== 'object' || Array.isArray(data.dados)) {
      return respostaJson({
        status: 'erro',
        mensagem: 'Objeto de dados inválido'
      });
    }

    var estruturaValida = Object.keys(SCHEMA).every(function(nomeAba) {
      return Array.isArray(data.dados[nomeAba]);
    });
    if (!estruturaValida) {
      return respostaJson({
        status: 'erro',
        mensagem: 'Estrutura incompleta: todas as coleções devem ser arrays antes de salvar.'
      });
    }

    var registrosValidos = Object.keys(SCHEMA).every(function(nomeAba) {
      return data.dados[nomeAba].every(function(registro) {
        return registro !== null && typeof registro === 'object' && !Array.isArray(registro);
      });
    });
    if (!registrosValidos) {
      return respostaJson({
        status: 'erro',
        mensagem: 'Estrutura inválida: cada registro deve ser um objeto.'
      });
    }

    var usuarioAtual = autenticarSessao(data.sessao);
    if (!usuarioAtual) return respostaJson({ status: 'erro', mensagem: 'Sessão expirada. Entre novamente.' });

    lock.waitLock(15000);

    try {
      var revisaoServidor = obterRevisaoDados();
      var revisaoCliente = Number(data.dados._revision);
      if (!Number.isFinite(revisaoCliente)) revisaoCliente = 0;

      if (revisaoCliente !== revisaoServidor) {
        return respostaJson({
          status: 'conflito',
          mensagem: 'Os dados do servidor foram alterados por outro utilizador. Atualize os dados antes de salvar novamente.',
          _revision: revisaoServidor
        });
      }

      var novaRevisao = revisaoServidor + 1;
      data.dados._revision = novaRevisao;

      var dadosAnteriores = {};
      Object.keys(SCHEMA).forEach(function(nomeAba) {
        dadosAnteriores[nomeAba] = lerAba(nomeAba);
      });

      var privilegiado = acessoElevado(data.sessao, usuarioAtual);
      conferirAlteracoesUsuarios(dadosAnteriores.usuarios, data.dados.usuarios, usuarioAtual, data.sessao,
        dadosAnteriores.notificacoes, data.dados.notificacoes);
      conferirNotificacoes(dadosAnteriores.notificacoes, data.dados.notificacoes, usuarioAtual, privilegiado);
      conferirAlteracoesFinanceiras(dadosAnteriores, data.dados, usuarioAtual);
      ['logs', 'exclusao_movimento', 'edicao_movimento'].forEach(function(nome) {
        conferirAuditoria(dadosAnteriores[nome], data.dados[nome], usuarioAtual, privilegiado, nome);
      });

      try {
        atualizarTabelas(data.dados);
        SpreadsheetApp.flush();
        definirRevisaoDados(novaRevisao);
      } catch (erroGravacao) {
        var erroRollback = null;
        try {
          atualizarTabelas(dadosAnteriores);
          SpreadsheetApp.flush();
          definirRevisaoDados(revisaoServidor);
        } catch (erroRestauracao) {
          erroRollback = String(erroRestauracao);
        }
        throw new Error(
          'Falha ao gravar os dados.' +
          (erroRollback ? ' A restauração automática também falhou: ' + erroRollback : ' O estado anterior foi restaurado quando possível.') +
          ' Detalhe: ' + String(erroGravacao)
        );
      }

      var usuarioAtualizado = data.dados.usuarios.filter(function(u) { return String(u.id) === String(usuarioAtual.id); })[0];
      if (usuarioAtualizado && String(usuarioAtualizado.pin || '') !== String(usuarioAtual.pin || '')) {
        CacheService.getScriptCache().put('sessao_' + data.sessao, JSON.stringify({
          id: String(usuarioAtualizado.id), credencial: String(usuarioAtualizado.pin)
        }), DURACAO_SESSAO_SEGUNDOS);
      }

      return respostaJson({
        status: 'sucesso',
        mensagem: 'Dados salvos com sucesso',
        _revision: novaRevisao,
        dataHora: new Date().toISOString()
      });
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    try {
      lock.releaseLock();
    } catch (_) {}

    return respostaJson({
      status: 'erro',
      mensagem: String(err)
    });
  }
}

function retornarDadosCompletos(usuario) {
  var dados = {
    _revision: obterRevisaoDados(),
    usuarios: lerAba('usuarios'),
    categorias: lerAba('categorias'),
    cartoes: lerAba('cartoes'),
    lancamentos: lerAba('lancamentos'),
    financiamentos: lerAba('financiamentos'),
    bens: lerAba('bens'),
    notificacoes: lerAba('notificacoes'),
    logs: lerAba('logs'),
    exclusao_movimento: lerAba('exclusao_movimento'),
    edicao_movimento: lerAba('edicao_movimento'),
    fatura_cartao: lerAba('fatura_cartao')
  };

  // Nem mesmo o administrador recebe hashes de senha em respostas de leitura.
  dados.usuarios.forEach(function(u) { delete u.pin; delete u.senha; });
  // Registros financeiros continuam compartilhados, conforme o modelo atual do aplicativo.
  if (!acessoAuditoria(usuario)) {
    dados.logs = dados.logs.filter(function(r) { return String(r.usuarioId) === String(usuario.id); });
    dados.exclusao_movimento = dados.exclusao_movimento.filter(function(r) { return String(r.usuarioId) === String(usuario.id); });
    dados.edicao_movimento = dados.edicao_movimento.filter(function(r) { return String(r.usuarioId) === String(usuario.id); });
  }

  return respostaJson(dados);
}

// Execute instalarGatilhoAlertas() UMA vez no editor do Apps Script.
// O usuário vê os lembretes no sino do aplicativo; nenhum e-mail é disparado.
function instalarGatilhoAlertas() {
  var existe = ScriptApp.getProjectTriggers().some(function(gatilho) {
    return gatilho.getHandlerFunction() === 'processarAlertasVencimento';
  });
  if (!existe) ScriptApp.newTrigger('processarAlertasVencimento').timeBased().atHour(8).everyDays(1).create();
}

function processarAlertasVencimento() {
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var usuarios = lerAba('usuarios');
    var lancamentos = lerAba('lancamentos');
    var notificacoes = lerAba('notificacoes');
    var ids = {};
    notificacoes.forEach(function(n) { ids[String(n.id)] = true; });
    var hoje = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
    var hojeUTC = Date.parse(hoje + 'T00:00:00Z');
    var adicionadas = 0;
    usuarios.forEach(function(u) {
      if (u.ativo === false || !u.id) return;
      var preferencias = u.preferenciasNotificacao || {};
      if (preferencias.ativo === false) return;
      var dias = Math.max(1, Math.min(15, Number(preferencias.diasAntecedencia) || 3));
      lancamentos.forEach(function(l) {
        if (String(l.usuarioId) !== String(u.id) || !/^sa[ií]da$/i.test(String(l.tipo || ''))) return;
        if (l.pago === true || /^pago$/i.test(String(l.status || ''))) return;
        var vencimento = normalizarDataISO(l.vencimento);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(vencimento)) return;
        var distancia = Math.round((Date.parse(vencimento + 'T00:00:00Z') - hojeUTC) / 86400000);
        if (distancia < 0 || distancia > dias) return;
        var id = 'alerta_vencimento_' + u.id + '_' + String(l.id).replace(/[^a-zA-Z0-9_-]/g, '_') + '_' + vencimento.replace(/-/g, '');
        if (ids[id]) return;
        ids[id] = true;
        var valor = Number(l.valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
        notificacoes.push({
          id: id, usuarioDestinoId: u.id, remetenteId: u.id,
          tipo: 'alerta_vencimento', titulo: distancia === 0 ? 'Conta vence hoje' : 'Conta próxima do vencimento',
          mensagem: String(l.descricao || 'Conta').slice(0, 120) + ' · ' + valor + ' · ' +
            vencimento.slice(8, 10) + '/' + vencimento.slice(5, 7) + '/' + vencimento.slice(0, 4),
          lida: false, statusAprovacao: '', createdAt: new Date().toISOString()
        });
        adicionadas++;
      });
    });
    if (adicionadas) {
      escreverAba('notificacoes', notificacoes, SCHEMA.notificacoes);
      definirRevisaoDados(obterRevisaoDados() + 1);
    }
    return adicionadas;
  } finally {
    lock.releaseLock();
  }
}

function lerAba(nomeAba) {
  var sheet = ss.getSheetByName(nomeAba);
  if (!sheet) return [];

  var lastRow = sheet.getLastRow();
  var lastColumn = sheet.getLastColumn();
  if (lastRow < 2 || lastColumn < 1) return [];

  var rows = sheet.getRange(1, 1, lastRow, lastColumn).getValues();
  var headers = rows[0].map(function(header) {
    return String(header || '').trim();
  });

  var result = [];

  for (var i = 1; i < rows.length; i++) {
    var row = rows[i];
    var possuiConteudo = row.some(function(val) {
      return val !== '' && val !== null;
    });

    if (!possuiConteudo) continue;

    var obj = {};
    for (var j = 0; j < headers.length; j++) {
      var header = headers[j];
      if (!header) continue;

      var val = row[j];
      obj[header] = normalizarValorLido(header, val);
    }

    // Histórico legado sem ID: preserve um identificador estável até a próxima gravação.
    if (!obj.id && ['logs', 'exclusao_movimento', 'edicao_movimento'].indexOf(nomeAba) >= 0) {
      obj.id = 'legacy_' + nomeAba + '_' + i;
    }

    result.push(obj);
  }

  return result;
}

function normalizarValorLido(header, val) {
  if (val === null || val === '') return CAMPOS_JSON[header] ? {} : '';

  if (val instanceof Date) {
    if (CAMPOS_DATA[header]) {
      return Utilities.formatDate(
        val,
        Session.getScriptTimeZone(),
        'yyyy-MM-dd'
      );
    }

    if (header === 'dataHora' || header === 'createdAt' || header === 'updatedAt') {
      return val.toISOString();
    }
  }

  if (typeof val === 'string') {
    var texto = val.trim();

    if (CAMPOS_DATA[header]) {
      return normalizarDataISO(texto);
    }

    if (CAMPOS_JSON[header]) {
      try {
        return JSON.parse(texto);
      } catch (_) {
        return header === 'preferenciasNotificacao' ? {} : {};
      }
    }

    if (CAMPOS_BOOLEAN[header]) {
      if (texto.toUpperCase() === 'TRUE') return true;
      if (texto.toUpperCase() === 'FALSE') return false;
    }
    return val;
  }

  return val;
}

function atualizarTabelas(dadosObj) {
  Object.keys(SCHEMA).forEach(function(nomeAba) {
    if (dadosObj[nomeAba] !== undefined) {
      escreverAba(nomeAba, dadosObj[nomeAba], SCHEMA[nomeAba]);
    }
  });
}

function escreverAba(nomeAba, dadosArray, headers) {
  var sheet = ss.getSheetByName(nomeAba);

  if (!sheet) {
    sheet = ss.insertSheet(nomeAba);
  }

  sheet.clearContents();

  var lista = Array.isArray(dadosArray) ? dadosArray : [];
  var matrizParaGravar = [headers];

  if (lista.length > 0) {
    for (var i = 0; i < lista.length; i++) {
      var registro = lista[i] || {};
      var rowData = [];

      for (var j = 0; j < headers.length; j++) {
        var campo = headers[j];
        var val = registro[campo];

        if (val === undefined || val === null) {
          val = '';
        }

        if (CAMPOS_DATA[campo] && val) {
          val = formatarDataParaPlanilha(val);
        }

        if (typeof val === 'object' && !(val instanceof Date)) {
          val = JSON.stringify(val);
        }

        rowData.push(val);
      }

      matrizParaGravar.push(rowData);
    }
  }

  sheet
    .getRange(1, 1, matrizParaGravar.length, headers.length)
    .setValues(matrizParaGravar);

  sheet.setFrozenRows(1);
}
