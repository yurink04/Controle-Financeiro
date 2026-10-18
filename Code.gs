var ss = SpreadsheetApp.getActiveSpreadsheet();

var SENHA_MESTRA_API = PropertiesService.getScriptProperties().getProperty('SENHA_MESTRA_API');
var SENHA_ADMIN = PropertiesService.getScriptProperties().getProperty('SENHA_ADMIN');

if (!SENHA_MESTRA_API || !SENHA_ADMIN) {
  throw new Error("ATENÇÃO: Propriedades do script (SENHA_MESTRA_API e/ou SENHA_ADMIN) não configuradas no Apps Script.");
}

var SCHEMA = {
  usuarios: [
    'id', 'usuario', 'nome', 'pin', 'rendaFixa', 'parceiroId', 'ativo',
    'permissoes', 'preferenciasNotificacao', 'fotoPerfil'
  ],

  categorias: ['id', 'nome', 'tipo', 'classificacao', 'criadopor'],

  cartoes: [
    'id', 'usuarioId', 'nome', 'limite', 'fechamento', 'vencimento',
    'isBeneficio', 'tipoCartao', 'ativo', 'createdAt', 'updatedAt'
  ],

  lancamentos: [
    'id', 'usuarioId', 'descricao', 'valor', 'tipo', 'categoriaId',
    'formaPagamento', 'cartaoId', 'vencimento', 'recorrencia',
    'parcelaAtual', 'totalParcelas', 'observacao', 'horaExtra',
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
  preferenciasNotificacao: true
};

var CAMPOS_BOOLEAN = {
  ativo: true,
  isBeneficio: true,
  compartilhado: true,
  pago: true,
  lida: true
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

    if (action === 'obterDados') {
      var leituraLock = LockService.getScriptLock();
      leituraLock.waitLock(15000);
      try {
        return retornarDadosCompletos();
      } finally {
        leituraLock.releaseLock();
      }
    }

    if (action === 'revisao') {
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

    if (action === 'verificarAdmin') {
      var senhaInformada = data.senha == null ? '' : String(data.senha).trim();
      var senhaConfigurada = String(SENHA_ADMIN || '').trim();
      var autorizado = senhaInformada !== '' && senhaConfigurada !== '' && senhaInformada === senhaConfigurada;
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

      var senhaCadastrada = String(usuarioEncontrado.pin || usuarioEncontrado.senha || '').trim();

      // [FIX #1] Usuário sem senha NÃO pode entrar — exige redefinição.
      if (senhaCadastrada === '') {
        return respostaJson({
          status: 'erro',
          mensagem: 'Este usuário ainda não possui palavra-passe cadastrada. Peça ao administrador para redefinir o acesso.'
        });
      }

      if (senhaCadastrada !== senhaHash) {
        return respostaJson({ status: 'erro', mensagem: 'Palavra-passe incorreta.' });
      }

      return respostaJson({
        status: 'sucesso',
        primeiroAcesso: false,
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

function retornarDadosCompletos() {
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

  return respostaJson(dados);
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