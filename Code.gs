var ss = SpreadsheetApp.getActiveSpreadsheet();

var SENHA_MESTRA_API = PropertiesService.getScriptProperties().getProperty('SENHA_MESTRA_API');
var SENHA_ADMIN = PropertiesService.getScriptProperties().getProperty('SENHA_ADMIN');

if (!SENHA_MESTRA_API || !SENHA_ADMIN) {
  throw new Error("ATENÇÃO: Propriedades do script (SENHA_MESTRA_API e/ou SENHA_ADMIN) não configuradas no Apps Script.");
}

var SCHEMA = {
  usuarios: [
    'id', 'usuario', 'nome', 'pin', 'rendaFixa', 'parceiroId', 'ativo',
    'permissoes', 'preferenciasNotificacao'
  ],

  categorias: ['id', 'nome', 'tipo', 'classificacao', 'criadopor'],

  cartoes: [
    'id', 'usuarioId', 'nome', 'limite', 'fechamento', 'vencimento',
    'isBeneficio', 'ativo', 'createdAt', 'updatedAt'
  ],

  lancamentos: [
    'id', 'usuarioId', 'descricao', 'valor', 'tipo', 'categoriaId',
    'formaPagamento', 'cartaoId', 'vencimento', 'recorrencia',
    'parcelaAtual', 'totalParcelas', 'observacao', 'horaExtra',
    'servicoEssencial', 'pago', 'status', 'dataCompra', 'dataPagamento',
    'usuarioPagamentoId', 'financiamentoId', 'parcelamentoId', 'bemId', 'escopo',
    'createdAt', 'updatedAt'
  ],

  financiamentos: [
    'id', 'usuarioId', 'nome', 'bemId', 'totalMeses', 'mesesPagos',
    'valorParcela', 'categoriaId', 'primeiroVencimento', 'ativo',
    'createdAt', 'updatedAt'
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
    'dataHora', 'usuario', 'usuarioId', 'lancamentoId',
    'descricao', 'valor', 'motivo'
  ],

  edicao_movimento: [
    'dataHora', 'usuario', 'usuarioId', 'lancamentoId',
    'descricaoAntiga', 'descricaoNova', 'valorAntigo', 'valorNovo',
    'motivo'
  ]
};

var CAMPOS_DATA = {
  vencimento: true,
  dataCompra: true,
  dataPagamento: true,
  primeiroVencimento: true
};

function respostaJson(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function tokenValido(token) {
  return token && String(token) === String(SENHA_MESTRA_API);
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

function formatarDataParaPlanilha(val) {
  if (!val) return '';
  let str = String(val).trim();
  if (str.includes('T')) {
    str = str.split('T')[0];
  }
  return str;
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
      return retornarDadosCompletos();
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
      var senhaInformada = data.senha == null ? '' : String(data.senha);
      var autorizado = senhaInformada !== '' && senhaInformada === String(SENHA_ADMIN);
      return respostaJson({
        status: 'sucesso',
        autorizado: autorizado
      });
    }

    if (action !== 'salvarDados') {
      return respostaJson({
        status: 'erro',
        mensagem: 'Ação inválida'
      });
    }

    if (!data.dados || typeof data.dados !== 'object') {
      return respostaJson({
        status: 'erro',
        mensagem: 'Objeto de dados inválido'
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
      atualizarTabelas(data.dados);
      definirRevisaoDados(novaRevisao);
      SpreadsheetApp.flush();

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
    edicao_movimento: lerAba('edicao_movimento')
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
  if (val === null || val === '') return '';

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
    if (texto === 'TRUE') return true;
    if (texto === 'FALSE') return false;
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