/* Testes locais da autenticação, migração de PIN antigo e recuperação manual.
   Não conectam ao Google Sheets nem usam credenciais reais. */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const fonte = nome => fs.readFileSync(path.resolve(__dirname, '..', '..', nome === 'script.js' ? 'js/script.js' : nome), 'utf8');
new vm.Script(fonte('Code.gs'), {filename: 'Code.gs'});
new vm.Script(fonte('script.js'), {filename: 'script.js'});
if (fs.existsSync(path.join(__dirname, 'index.html'))) {
    for (const match of fonte('index.html').matchAll(/<script\b(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi)) {
        new vm.Script(match[1], {filename: 'index.html (inline)'});
    }
}

const senhaSHA = valor => crypto.createHash('sha256').update(valor, 'utf8').digest('hex');
const propriedades = new Map([['SENHA_MESTRA_API', 'token-teste'], ['SENHA_ADMIN', 'admin-teste']]);
const cache = new Map();
const celulas = [[
    'id', 'usuario', 'nome', 'pin', 'ativo', 'permissoes', 'observacao'
], [1, 'novo', 'Conta Nova', senhaSHA('Nova@1234'), true, '{}', 'Preservar linha'],
    [2, 'antigo', 'Conta Antiga', 'Antiga@1234', true, '{}', 'Não alterar'],
    [3, 'sem', 'Conta Sem Senha', '', true, '{}', 'Preservar sem senha']];
let locksAbertos = 0;

const sheet = {
    getLastRow: () => celulas.length,
    getLastColumn: () => celulas[0].length,
    getRange(linha, coluna, altura = 1, largura = 1) {
        return {
            getValues: () => Array.from({length: altura}, (_, i) =>
                Array.from({length: largura}, (_, j) => celulas[linha - 1 + i]?.[coluna - 1 + j] ?? '')),
            setValue(valor) {celulas[linha - 1][coluna - 1] = valor;},
            clearContent() {celulas[linha - 1][coluna - 1] = '';},
            setValues(linhas) {
                linhas.forEach((linhaVal, i) => {celulas[linha - 1 + i] = linhaVal.slice();});
            }
        };
    }
};
const contexto = {
    SpreadsheetApp: {getActiveSpreadsheet: () => ({getSheetByName: nome => nome === 'usuarios' ? sheet : null})},
    PropertiesService: {getScriptProperties: () => ({
        getProperty: k => propriedades.get(k) ?? null,
        setProperty: (k, v) => propriedades.set(k, v),
        deleteProperty: k => propriedades.delete(k)
    })},
    CacheService: {getScriptCache: () => ({
        get: k => cache.get(k) ?? null,
        put: (k, v) => cache.set(k, v),
        remove: k => cache.delete(k)
    })},
    LockService: {getScriptLock: () => ({
        waitLock() {locksAbertos++;},
        releaseLock() {if (locksAbertos > 0) locksAbertos--;},
        hasLock() {return locksAbertos > 0;}
    })},
    ContentService: {MimeType: {JSON: 'json'}, createTextOutput: texto => ({
        texto, setMimeType() {return this;}
    })},
    Utilities: {
        getUuid: () => crypto.randomUUID(),
        DigestAlgorithm: {SHA_256: 'SHA_256'}, Charset: {UTF_8: 'utf8'},
        computeDigest: (algoritmo, valor) => [...crypto.createHash('sha256').update(valor, 'utf8').digest()]
            .map(v => v > 127 ? v - 256 : v)
    },
    console
};
vm.createContext(contexto);
vm.runInContext(fonte('Code.gs'), contexto);
const post = (action, dados = {}) => JSON.parse(contexto.doPost({
    postData: {contents: JSON.stringify({action, token: 'token-teste', ...dados})}
}).texto);
const get = (action, dados = {}) => JSON.parse(contexto.doGet({parameter: {
    action, token: 'token-teste', ...dados
}}).texto);

assert.equal(get('statusCadastro').versaoAcesso, '2026-10-20-r2');
assert.equal(get('statusCadastro').primeiroCadastroDisponivel, false);
assert.equal(post('verificarCredenciaisLogin', {
    usuario: 'novo', senhaHash: 'CHECK_APENAS_USUARIO'
}).usuario.nome, 'Conta');

let resposta = post('verificarCredenciaisLogin', {usuario: 'novo', senhaHash: senhaSHA('Nova@1234')});
assert.equal(resposta.status, 'sucesso', 'Usuário com hash SHA-256 atual entra normalmente');
assert.match(resposta.sessao, /^[a-f0-9]{64}$/i);
assert.equal(celulas[1][3], senhaSHA('Nova@1234'), 'Senha atual não deve ser alterada');

resposta = post('verificarCredenciaisLogin', {usuario: 'antigo', senhaHash: senhaSHA('Antiga@1234')});
assert.equal(resposta.status, 'sucesso', 'PIN legado válido permite login');
assert.equal(celulas[2][3], senhaSHA('Antiga@1234'), 'PIN legado foi migrado para SHA-256');
assert.equal(celulas[2][6], 'Não alterar', 'Outras células não foram regravadas');
assert.equal(celulas[1][6], 'Preservar linha', 'Outras contas não foram modificadas');
assert.ok(Array.isArray(get('obterDados', {sessao: resposta.sessao}).usuarios),
    'Sessão migrada permanece válida');

resposta = post('verificarCredenciaisLogin', {usuario: 'novo', senhaHash: senhaSHA('Errada@123')});
assert.equal(resposta.codigo, 'SENHA_INCORRETA');
assert.equal(cache.get('tentativas_1'), '1');
assert.equal(post('verificarCredenciaisLogin', {usuario: 'sem', senhaHash: senhaSHA('Algo@1234')}).codigo,
    'SENHA_NAO_CONFIGURADA', 'Conta sem credencial precisa indicar recuperação');

assert.throws(() => contexto.recuperarAcessoPeloEditor(), /propriedades de recuperação/);
propriedades.set('RECUPERACAO_LOGIN', 'novo');
propriedades.set('RECUPERACAO_NOVA_SENHA', 'Recuperada@987');
propriedades.set('RECUPERACAO_CONFIRMAR', 'SIM');
assert.match(contexto.recuperarAcessoPeloEditor(), /redefinida com sucesso/);
assert.equal(celulas[1][3], senhaSHA('Recuperada@987'));
assert.equal(propriedades.has('RECUPERACAO_NOVA_SENHA'), false, 'Senha temporária removida');
assert.equal(cache.has('tentativas_1'), false, 'Bloqueio de tentativas removido após recuperação');
assert.equal(post('verificarCredenciaisLogin', {
    usuario: 'novo', senhaHash: senhaSHA('Recuperada@987')
}).status, 'sucesso');

// Migração de planilha ainda mais antiga, com coluna `senha`, mas sem `pin`.
celulas[0][3] = 'senha';
celulas[2][3] = 'SenhaLegada@876';
const legadoComColunaAntiga = post('verificarCredenciaisLogin', {
    usuario: 'antigo', senhaHash: senhaSHA('SenhaLegada@876')
});
assert.equal(legadoComColunaAntiga.status, 'sucesso');
assert.equal(celulas[0][7], 'pin', 'Coluna pin criada para formato antigo');
assert.equal(celulas[2][7], senhaSHA('SenhaLegada@876'));
assert.equal(celulas[2][3], '', 'Credencial em texto simples foi removida da coluna senha');

assert.equal(locksAbertos, 0, 'Todos os bloqueios liberados');
if (fs.existsSync(path.join(__dirname, 'index.html'))) {
    assert.doesNotMatch(fonte('index.html'), /CHECK_APENAS_USUARIO'[\s\S]*?Não foi possível entrar\. Confira sua senha\./,
        'Página não deve mascarar erros de autenticação');
    assert.equal((fonte('js/page/index.js').match(/action=statusCadastro/g) || []).length, 1,
        'Pré-verificação deve usar apenas uma consulta');

    const inline = fonte('js/page/index.js');
    const pagina = {document: {addEventListener() {}}, window: {}, console};
    vm.createContext(pagina);
    vm.runInContext(inline, pagina);
    assert.match(pagina.mensagemFalhaLogin({codigo: 'SENHA_INCORRETA'}), /senha digitada não corresponde/);
    assert.match(pagina.mensagemFalhaLogin({codigo: 'SENHA_NAO_CONFIGURADA'}), /recuperar o acesso/);
    assert.match(pagina.mensagemFalhaLogin({codigo: 'BLOQUEIO_TEMPORARIO'}), /15 minutos/);
    assert.match(pagina.mensagemFalhaLogin({status: 'sucesso'}), /resposta de autenticação está incompleta/);
}
console.log('OK: login com hash atual, migração segura de PIN legado, erro claro, recuperação e sessão.');
