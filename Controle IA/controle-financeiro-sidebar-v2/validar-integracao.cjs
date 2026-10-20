/* Verificações locais de sintaxe e autorização do Code.gs, sem acessar dados reais. */
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');

const pasta = __dirname;
function fonte(nome) { return fs.readFileSync(path.join(pasta, nome), 'utf8'); }

['script.js', 'Code.gs'].forEach(nome => new vm.Script(fonte(nome), { filename: nome }));
const paginas = fs.readdirSync(pasta).filter(nome => nome.endsWith('.html')).sort();
assert.equal(paginas.length, 17, 'Esperadas 17 páginas do projeto, incluindo o histórico de rendimentos');
for (const nome of paginas) {
  const html = fonte(nome);
  for (const [indice, match] of [...html.matchAll(/<script\b(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi)].entries()) {
    new vm.Script(match[1], { filename: `${nome} #script ${indice + 1}` });
  }
  assert.match(html, /href="style\.css"/);
  assert.doesNotMatch(html, /<style\b/i, `CSS inline em ${nome}`);
  const htmlEstatico = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  const ids = [...htmlEstatico.matchAll(/\bid\s*=\s*["']([^"']+)["']/g)].map(m => m[1]);
  assert.equal(new Set(ids).size, ids.length, `IDs de elementos repetidos em ${nome}`);
  for (const href of html.matchAll(/\bhref\s*=\s*["']([^"'?#]+\.html)(?:[?#][^"']*)?["']/gi)) {
    const destino = href[1].split('/').pop();
    assert.ok(paginas.includes(destino), `Página não encontrada em ${nome}: ${href[1]}`);
  }
}
assert.match(fonte('style.css'), /account-hero/);
assert.match(fonte('style.css'), /login-story/);
assert.match(fonte('style.css'), /IDENTIDADE UNIFICADA/);
const estiloSidebar = fonte('style.css');
const scriptSidebar = fonte('script.js');
assert.match(estiloSidebar, /\.app-sidebar\s*\{[^}]*background:/s, 'Sidebar precisa ter fundo próprio');
assert.match(estiloSidebar, /body\.sidebar-open \.app-sidebar\s*\{[^}]*visibility: visible/s, 'Abertura do sidebar');
assert.match(estiloSidebar, /\.app-sidebar \[hidden\]\s*\{[^}]*display: none !important/s, 'Itens sem permissão devem continuar ocultos');
const inicioIlha = scriptSidebar.indexOf('<div class="app-top-island">');
const botaoNaIlha = scriptSidebar.indexOf('id="btnSidebarToggle"', inicioIlha);
assert.ok(inicioIlha >= 0 && botaoNaIlha > inicioIlha, 'Botão do sidebar dentro da ilha');
assert.match(scriptSidebar, /function definirSidebarAberto\(aberto\)/, 'Controle unificado do sidebar');
assert.match(scriptSidebar, /function alternarSubmenuSidebar\(\)/, 'Submenu expansível');
assert.match(scriptSidebar, /function destacarPaginaSidebar\(\)/, 'Página ativa no sidebar');
assert.match(fonte('Code.gs'), /'configuracaoSalarial'/, 'Configuração da folha precisa ser sincronizada');
assert.match(fonte('Code.gs'), /'naturezaRenda'/, 'Classificação dos recebimentos precisa ser sincronizada');
assert.match(fonte('lancamentos.html'), /id="naturezaRendaLancamento"/, 'Lançamento deve permitir classificar o recebimento');
assert.match(fonte('editar-lancamento.html'), /id="editNaturezaRenda"/, 'Edição deve preservar a classificação');
assert.match(fonte('rendimentos.html'), /id="historicoSalarioMensal"/, 'Histórico consolidado deve estar presente');

// Funções financeiras puras, isoladas da interface e sem dados reais.
const fonteFrontend = fonte('script.js');
const inicioCalculo = fonteFrontend.indexOf('const REFERENCIA_CALCULO_SALARIAL');
const fimCalculo = fonteFrontend.indexOf('// 3. UTILITÁRIOS DE DATA E PARCELAMENTO');
assert.ok(inicioCalculo >= 0 && fimCalculo > inicioCalculo, 'Núcleo de rendimentos encontrado');
const inicioParte = fonteFrontend.lastIndexOf('// ============================================================================', fimCalculo - 5);
const salarioCtx = { console, Date, Math, Number, Intl,
  gerarId: () => 'id_teste',
  normalizarTexto: texto => String(texto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()
};
vm.createContext(salarioCtx);
vm.runInContext(fonteFrontend.slice(inicioCalculo, inicioParte), salarioCtx);
function calculo(codigo) { return vm.runInContext(codigo, salarioCtx); }
const inss3000 = calculo('calcularINSSSalario2026(3000)');
assert.equal(inss3000.faixas.length, 3);
assert.ok(Math.abs(inss3000.valor - 248.60) <= 0.02, 'INSS progressivo sobre R$ 3.000');
const inssAlta = calculo('calcularINSSSalario2026(10000)');
assert.equal(inssAlta.base, 8475.55, 'INSS limitado ao teto');
assert.equal(calculo('calcularIRRFSalario2026(4000, 400).valor'), 0, 'Redução integral do IRRF para salário elegível');
assert.equal(calculo('calcularSalarioLiquido(4000, {vtAtivo:true}).valeTransporte'), 240, 'Vale-transporte limitado a 6%');
assert.equal(calculo('calcularSalarioLiquido(4000, {vtAtivo:true,vtCustoMensal:140}).valeTransporte'), 140, 'VT usa custo real menor');
assert.equal(calculo('calcularSalarioLiquido(4000, {descontos:[{nome:"Academia", tipo:"fixo", valor:80},{nome:"Refeição",tipo:"percentual",valor:2}]}).outrosDescontos'), 160);
const dRenda = {
  categorias:[{id:1,nome:'Salário'},{id:2,nome:'Renda Extra'},{id:3,nome:'Empréstimos'}], financiamentos:[],
  lancamentos: [
    {id:1,usuarioId:1,tipo:'entrada',categoriaId:1,descricao:'Adiantamento de salário',valor:500,vencimento:'2026-10-05',pago:true},
    {id:2,usuarioId:1,tipo:'entrada',categoriaId:1,descricao:'Folha outubro',valor:1500,horaExtra:200,naturezaRenda:'folha',vencimento:'2026-10-20',pago:true},
    {id:3,usuarioId:1,tipo:'entrada',categoriaId:2,descricao:'Uber',valor:600,vencimento:'2026-09-25',pago:true},
    {id:4,usuarioId:1,tipo:'entrada',categoriaId:3,descricao:'Empréstimo',valor:9000,vencimento:'2026-10-21',pago:true},
    {id:5,usuarioId:1,tipo:'entrada',categoriaId:2,descricao:'Receita não recebida',valor:200,vencimento:'2026-10-25',pago:false},
    {id:6,usuarioId:2,tipo:'entrada',categoriaId:2,descricao:'De outro usuário',valor:1000,vencimento:'2026-10-20',pago:true},
    {id:7,usuarioId:1,tipo:'entrada',categoriaId:2,descricao:'Transferência entre contas',valor:300,naturezaRenda:'nao_renda',vencimento:'2026-10-10',pago:true}
  ]
};
salarioCtx.dRenda = dRenda;
const historicoRenda = calculo('consolidarRendimentosUsuario(dRenda, 1, new Date(2026,9,20))');
assert.equal(historicoRenda.totalFolha, 1500);
assert.equal(historicoRenda.totalAdiantamentos, 500);
assert.equal(historicoRenda.totalHorasExtras, 200, 'Hora extra é informativa, incluída na folha');
assert.equal(historicoRenda.meses.find(m => m.mes === '2026-10').total, 2000, 'Adiantamento mais folha, sem duplicar hora extra');
assert.equal(historicoRenda.mediaVariavel, 100, 'Média variável inclui meses zerados');
assert.equal(historicoRenda.registros.length, 3, 'Empréstimos, pendências e outros usuários excluídos');

const planilhas = new Map();
const memoriaCache = new Map();
const propriedades = new Map([['SENHA_MESTRA_API', 'chave-de-teste'], ['SENHA_ADMIN', 'admin-de-teste']]);
const gatilhos = [];
class Planilha {
  constructor() { this.linhas = []; }
  getLastRow() { return this.linhas.length; }
  getLastColumn() { return this.linhas[0]?.length || 0; }
  setFrozenRows() {}
  clearContents() { this.linhas = []; }
  getRange(linha, coluna, quantidade, largura) {
    return {
      getValues: () => Array.from({ length: quantidade }, (_, i) =>
        Array.from({ length: largura }, (_, j) => this.linhas[linha - 1 + i]?.[coluna - 1 + j] ?? '')),
      setValues: matriz => {
        matriz.forEach((valores, i) => { this.linhas[linha - 1 + i] = valores.slice(); });
      }
    };
  }
}
const ambiente = {
  SpreadsheetApp: {
    getActiveSpreadsheet: () => ({
      getSheetByName: nome => planilhas.get(nome) || null,
      insertSheet: nome => { const folha = new Planilha(); planilhas.set(nome, folha); return folha; }
    }),
    flush: () => {}
  },
  PropertiesService: { getScriptProperties: () => ({
    getProperty: k => propriedades.get(k) ?? null,
    setProperty: (k, v) => propriedades.set(k, v)
  }) },
  CacheService: { getScriptCache: () => ({
    get: k => memoriaCache.get(k) ?? null,
    put: (k, v) => memoriaCache.set(k, v),
    remove: k => memoriaCache.delete(k)
  }) },
  LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput: texto => ({
    texto, setMimeType() { return this; }
  }) },
  Utilities: {
    getUuid: () => crypto.randomUUID(),
    formatDate: d => new Date(d).toISOString().slice(0, 10)
  },
  Session: { getScriptTimeZone: () => 'America/Sao_Paulo' },
  ScriptApp: {
    getProjectTriggers: () => gatilhos,
    newTrigger: nome => ({ timeBased: () => ({ atHour: () => ({ everyDays: () => ({
      create: () => gatilhos.push({ getHandlerFunction: () => nome })
    }) }) }) })
  },
  console
};
vm.createContext(ambiente);
vm.runInContext(fonte('Code.gs'), ambiente);

function get(action, extras = {}) {
  return JSON.parse(ambiente.doGet({ parameter: { action, token: 'chave-de-teste', ...extras } }).texto);
}
function post(action, extras = {}) {
  return JSON.parse(ambiente.doPost({ postData: { contents: JSON.stringify({ action, token: 'chave-de-teste', ...extras }) } }).texto);
}
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
function sucesso(res, mensagem) { assert.equal(res.status, 'sucesso', `${mensagem}: ${res.mensagem}`); }

sucesso(get('statusCadastro'), 'Status inicial');
assert.equal(get('statusCadastro').primeiroCadastroDisponivel, true);
assert.equal(post('registrarPrimeiroUsuario', { usuario: 'admin', nome: 'Admin', senhaHash: sha('Teste@123'), senhaAdmin: 'errada' }).status, 'erro');
sucesso(post('registrarPrimeiroUsuario', { usuario: 'admin', nome: 'Admin', senhaHash: sha('Teste@123'), senhaAdmin: 'admin-de-teste' }), 'Cadastro inicial');
assert.equal(get('statusCadastro').primeiroCadastroDisponivel, false);
assert.equal(get('obterDados').status, 'erro', 'Leitura sem sessão bloqueada');
assert.equal(get('revisao').status, 'erro', 'Revisão sem sessão bloqueada');
assert.equal(post('salvarDados', { dados: {} }).status, 'erro');

const login = post('verificarCredenciaisLogin', { usuario: 'admin', senhaHash: sha('Teste@123') });
sucesso(login, 'Login');
assert.match(login.sessao, /^[a-f\d]{64}$/i);
const sessaoAdmin = login.sessao;
const dados = get('obterDados', { sessao: sessaoAdmin });
assert.ok(!('pin' in dados.usuarios[0]), 'O servidor não deve vazar hashes dos usuários');
const inicial = { ...dados, usuarios: [{ ...dados.usuarios[0], nome: 'Admin Atualizado' }] };
sucesso(post('salvarDados', { sessao: sessaoAdmin, dados: inicial }), 'Atualização do próprio perfil');
const perfilComDescontos = get('obterDados', { sessao: sessaoAdmin });
perfilComDescontos.usuarios[0].rendaFixa = 4000;
perfilComDescontos.usuarios[0].configuracaoSalarial = {vtAtivo:true, vtCustoMensal:190, irrfAtivo:true, dependentes:0,
  descontos:[{id:'academia',nome:'Academia',tipo:'fixo',valor:80}]};
sucesso(post('salvarDados', { sessao: sessaoAdmin, dados: perfilComDescontos }), 'Salvar configuração salarial própria');
assert.equal(get('obterDados', { sessao: sessaoAdmin }).usuarios[0].configuracaoSalarial.descontos[0].valor, 80,
  'Descontos personalizados devem sobreviver ao ciclo planilha/API');

const semElevacao = get('obterDados', { sessao: sessaoAdmin });
semElevacao.usuarios.push({ id: 2, nome: 'Usuária', usuario: 'usuaria', pin: sha('Temporaria@1'), ativo: true,
  trocaSenhaObrigatoria: true, permissoes: { perfil: 'usuario', acoes: { criarMovimento: false }, paginas: {} } });
assert.equal(post('salvarDados', { sessao: sessaoAdmin, dados: semElevacao }).status, 'erro', 'Cadastro exige segundo fator');
sucesso(post('verificarAdmin', { sessao: sessaoAdmin, senha: 'admin-de-teste' }), 'Autorização administrativa');
sucesso(post('salvarDados', { sessao: sessaoAdmin, dados: semElevacao }), 'Cadastro com autorização');

const loginNovo = post('verificarCredenciaisLogin', { usuario: 'usuaria', senhaHash: sha('Temporaria@1') });
sucesso(loginNovo, 'Login com senha provisória');
assert.equal(loginNovo.trocaSenhaObrigatoria, true);
const sessaoUsuario = loginNovo.sessao;
assert.equal(post('verificarAdmin', { sessao: sessaoUsuario, senha: 'admin-de-teste' }).status, 'erro', 'Senha administrativa não basta sem permissão');
const soLeitura = get('obterDados', { sessao: sessaoUsuario });
soLeitura.usuarios[0].permissoes = { perfil: 'admin' };
assert.equal(post('salvarDados', { sessao: sessaoUsuario, dados: soLeitura }).status, 'erro', 'Elevação indevida de privilégios');

const troca = get('obterDados', { sessao: sessaoUsuario });
troca.usuarios[1].pin = sha('SenhaNova@4');
troca.usuarios[1].trocaSenhaObrigatoria = false;
sucesso(post('salvarDados', { sessao: sessaoUsuario, dados: troca }), 'Troca de senha própria');
assert.equal(post('verificarCredenciaisLogin', { usuario: 'usuaria', senhaHash: sha('Temporaria@1') }).status, 'erro');
sucesso(post('verificarCredenciaisLogin', { usuario: 'usuaria', senhaHash: sha('SenhaNova@4') }), 'Nova senha');

// Aprovação de vínculo: só a destinatária pode confirmar a solicitação.
const convite = get('obterDados', { sessao: sessaoAdmin });
convite.notificacoes.push({ id: 'solicitacao_1', usuarioDestinoId: 2, remetenteId: 1, tipo: 'solicitacao_parceiro', titulo: 'Convite',
  mensagem: 'Aprovar?', lida: false, statusAprovacao: 'pendente', createdAt: new Date().toISOString() });
sucesso(post('salvarDados', { sessao: sessaoAdmin, dados: convite }), 'Solicitação de parceiro');
const aceite = get('obterDados', { sessao: sessaoUsuario });
aceite.notificacoes[0].statusAprovacao = 'aprovado';
aceite.usuarios[0].parceiroId = 2;
aceite.usuarios[1].parceiroId = 1;
aceite.notificacoes.push({ id: 'resposta_1', usuarioDestinoId: 1, remetenteId: 2, tipo: 'resposta_parceiro', titulo: 'Aceito',
  mensagem: 'Parceria aceita', lida: false, statusAprovacao: 'aprovado', createdAt: new Date().toISOString() });
sucesso(post('salvarDados', { sessao: sessaoUsuario, dados: aceite }), 'Aceite de parceria');

const impedido = get('obterDados', { sessao: sessaoUsuario });
impedido.lancamentos.push({ id: 'l-um', usuarioId: 2, tipo: 'saida', descricao: 'Compra', valor: 40, vencimento: '2026-10-19', pago: false });
assert.equal(post('salvarDados', { sessao: sessaoUsuario, dados: impedido }).status, 'erro', 'Conta de leitura não grava lançamentos');

const lembrete = get('obterDados', { sessao: sessaoAdmin });
const hoje = new Date().toISOString().slice(0, 10);
lembrete.lancamentos.push({ id: 'l-do-dia', usuarioId: 1, tipo: 'saida', descricao: 'Conta agendada', valor: 40, vencimento: hoje, pago: false });
sucesso(post('salvarDados', { sessao: sessaoAdmin, dados: lembrete }), 'Preparação de vencimento');
ambiente.instalarGatilhoAlertas();
ambiente.instalarGatilhoAlertas();
assert.equal(gatilhos.length, 1, 'Instalação não deve duplicar gatilho');
assert.equal(ambiente.processarAlertasVencimento(), 1, 'Um lembrete deve ser criado');
assert.equal(ambiente.processarAlertasVencimento(), 0, 'Lembrete repetido deve ser ignorado');
assert.ok(get('obterDados', { sessao: sessaoAdmin }).notificacoes.some(n => n.tipo === 'alerta_vencimento'));

const reset = get('obterDados', { sessao: sessaoAdmin });
reset.usuarios[1].pin = sha('OutraProvisoria@8');
reset.usuarios[1].trocaSenhaObrigatoria = true;
sucesso(post('salvarDados', { sessao: sessaoAdmin, dados: reset }), 'Reset administrativo de senha');
assert.equal(get('obterDados', { sessao: sessaoUsuario }).status, 'erro', 'Reset de senha revoga sessão antiga');

const recebimento = get('obterDados', { sessao: sessaoAdmin });
recebimento.lancamentos.push({ id:'salario_1', usuarioId:1, tipo:'entrada', categoriaId:'',
  descricao:'Folha de pagamento', naturezaRenda:'folha', horaExtra:250, valor:3200,
  pago:true, status:'pago', vencimento:'2026-10-20' });
sucesso(post('salvarDados', { sessao: sessaoAdmin, dados: recebimento }), 'Persistência da folha');
assert.equal(get('obterDados', { sessao: sessaoAdmin }).lancamentos.find(l => l.id === 'salario_1').naturezaRenda,
  'folha', 'Classificação da renda deve sobreviver ao ciclo planilha/API');

for (let i = 0; i < 6; i++) post('verificarCredenciaisLogin', { usuario: 'usuaria', senhaHash: sha('Incorreta') });
assert.match(post('verificarCredenciaisLogin', { usuario: 'usuaria', senhaHash: sha('OutraProvisoria@8') }).mensagem, /Muitas tentativas/);

console.log('OK: 17 páginas, JS, salário 2026, descontos, adiantamentos, renda variável, gravação, sessões e permissões testados.');
