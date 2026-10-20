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
assert.equal(paginas.length, 16, 'Esperadas 16 páginas do projeto');
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

for (let i = 0; i < 6; i++) post('verificarCredenciaisLogin', { usuario: 'usuaria', senhaHash: sha('Incorreta') });
assert.match(post('verificarCredenciaisLogin', { usuario: 'usuaria', senhaHash: sha('OutraProvisoria@8') }).mensagem, /Muitas tentativas/);

console.log('OK: HTML e JS válidos; sessões, login, autorização, senhas, registros e lembretes testados.');
