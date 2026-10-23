/* Testes puros de rede e mesclagem. Não realiza requisições externas. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const script = fs.readFileSync(path.resolve(__dirname, '..', 'conexao_sheets.js'), 'utf8');
const core = fs.readFileSync(path.resolve(__dirname, '..', 'script.js'), 'utf8');
const inicioAPI = script.indexOf('async function executarPostAPI(');
const fimAPI = script.indexOf('const SCHEMA_VERSION', inicioAPI);
assert.ok(inicioAPI > 0 && fimAPI > inicioAPI, 'Cliente da API encontrado');

let ultimoPedido;
const ctxAPI = {
    API_URL: 'https://script.google.com/macros/s/simulado/exec',
    TOKEN_API: 'token-simulado',
    conferirSessaoRespostaAPI: dados => dados,
    AbortController, setTimeout, clearTimeout,
    fetch: async (url, opcoes) => {
        ultimoPedido = {url, opcoes};
        return {ok: true, text: async () => JSON.stringify({status: 'sucesso', _revision: 9})};
    }
};
vm.createContext(ctxAPI);
vm.runInContext(script.slice(inicioAPI, fimAPI), ctxAPI);

const inicioMescla = script.indexOf('function serializarEstavel(');
const fimMescla = script.indexOf('function marcarConflitoSincronizacao(', inicioMescla);
const clonarFonte = core.match(/^const clonarDados = .*;$/m)?.[0];
assert.ok(inicioMescla > 0 && fimMescla > inicioMescla && clonarFonte, 'Núcleo de mesclagem encontrado');
const colecoes = ['usuarios', 'categorias', 'cartoes', 'lancamentos', 'financiamentos', 'bens',
    'notificacoes', 'logs', 'exclusao_movimento', 'edicao_movimento', 'fatura_cartao'];
const ctxMescla = {COLECOES_DADOS: colecoes};
vm.createContext(ctxMescla);
vm.runInContext(clonarFonte + '\n' + script.slice(inicioMescla, fimMescla), ctxMescla);
const mesclar = (base, local, remoto) => ctxMescla.mesclarSnapshotsTresVias(base, local, remoto);
const conciliarReenvio = (base, local, remoto, usuarioId) =>
    ctxMescla.prepararReenvioSeguro(base, local, remoto, usuarioId);
const base = Object.fromEntries(colecoes.map(c => [c, []]));
base.categorias = [{id: 'cat1', nome: 'Transporte'}];
base._revision = 1;

(async () => {
    const sucesso = await vm.runInContext('executarPostAPI("revisao", {sessao: "teste"}, 1000)', ctxAPI);
    assert.equal(sucesso._revision, 9);
    assert.equal(ultimoPedido.opcoes.headers['Content-Type'], 'text/plain;charset=utf-8');
    assert.equal(JSON.parse(ultimoPedido.opcoes.body).action, 'revisao');
    assert.equal(JSON.parse(ultimoPedido.opcoes.body).sessao, 'teste');

    ctxAPI.fetch = async () => ({ok: true, text: async () => '<html>Login Google</html>'});
    await assert.rejects(vm.runInContext('executarPostAPI("revisao", {}, 1000)', ctxAPI), /não retornou JSON/);

    ctxAPI.fetch = (_url, opcoes) => new Promise((_resolve, reject) => {
        opcoes.signal.addEventListener('abort', () => {
            const erro = new Error('abortado'); erro.name = 'AbortError'; reject(erro);
        });
    });
    await assert.rejects(vm.runInContext('executarPostAPI("revisao", {}, 5)', ctxAPI), /Tempo limite/);

    const remotoExcluiu = JSON.parse(JSON.stringify(base));
    remotoExcluiu.categorias = [];
    remotoExcluiu._revision = 2;
    const mesclaRemota = mesclar(base, JSON.parse(JSON.stringify(base)), remotoExcluiu);
    assert.equal(mesclaRemota.conflitos.length, 0);
    assert.equal(mesclaRemota.dados.categorias.length, 0,
        'Exclusão remota deve ser aceita sem erro de JSON.parse(undefined)');

    const localExcluiu = JSON.parse(JSON.stringify(base));
    localExcluiu.categorias = [];
    const mesclaLocal = mesclar(base, localExcluiu, JSON.parse(JSON.stringify(base)));
    assert.equal(mesclaLocal.conflitos.length, 0);
    assert.equal(mesclaLocal.dados.categorias.length, 0, 'Exclusão local deve ser mantida');

    const baseReal = JSON.parse(JSON.stringify(base));
    baseReal.usuarios = [
        {id: 1, usuario: 'yuri', nome: 'Yuri', ativo: true, permissoes: {perfil: 'usuario'}},
        {id: 2, usuario: 'maria', nome: 'Maria', ativo: true, permissoes: {perfil: 'usuario'}}
    ];
    const localReal = JSON.parse(JSON.stringify(baseReal));
    localReal.usuarios[0].nome = 'Yuri atualizado';
    localReal.usuarios[0].ativo = false;
    localReal.usuarios[0].permissoes.perfil = 'admin';
    localReal.usuarios[0].pin = 'PIN guardado somente no navegador';
    localReal.usuarios[1].nome = 'Maria alterada indevidamente';
    localReal.usuarios.push({id: 88, usuario: 'invasor', nome: 'Novo usuário'});
    localReal.categorias.push({id: 'local', nome: 'Uber'});
    const remotoReal = JSON.parse(JSON.stringify(baseReal));
    remotoReal._revision = 5;
    remotoReal.usuarios[1].nome = 'Maria atualizada no Sheets';
    remotoReal.usuarios.push({id: 3, usuario: 'nova', nome: 'Nova conta', ativo: true});
    remotoReal.categorias.push({id: 'remoto', nome: 'Alimentação'});
    const entradasAntes = JSON.stringify([baseReal, localReal, remotoReal]);
    const conciliado = conciliarReenvio(baseReal, localReal, remotoReal, '1');
    assert.equal(conciliado.conflitos.length, 0, 'Perfis de terceiros não causam conflitos falsos');
    const perfis = conciliado.dados.usuarios;
    assert.equal(perfis.length, 3, 'Usuário extra somente local não é criado');
    assert.equal(perfis.find(u => u.id === 1).nome, 'Yuri atualizado');
    assert.equal(perfis.find(u => u.id === 1).ativo, true, 'Estado do usuário preservado do servidor');
    assert.equal(perfis.find(u => u.id === 1).permissoes.perfil, 'usuario', 'Permissões preservadas');
    assert.equal(perfis.find(u => u.id === 1).pin, undefined, 'PIN não é transferido pela sincronização');
    assert.equal(perfis.find(u => u.id === 2).nome, 'Maria atualizada no Sheets');
    assert.equal(perfis.find(u => u.id === 3).nome, 'Nova conta');
    assert.equal(conciliado.dados.categorias.length, 3, 'Une categorias locais e remotas sem perdas');
    assert.equal(conciliado.dados._revision, 5, 'Revisão do servidor permanece autoritativa');
    assert.equal(JSON.stringify([baseReal, localReal, remotoReal]), entradasAntes,
        'A mesclagem não modifica cópias originais');

    const localConflito = JSON.parse(JSON.stringify(baseReal));
    const remotoConflito = JSON.parse(JSON.stringify(baseReal));
    localConflito.categorias[0].nome = 'Uber local';
    remotoConflito.categorias[0].nome = 'Uber servidor';
    const conflitante = conciliarReenvio(baseReal, localConflito, remotoConflito, 1);
    assert.ok(conflitante.conflitos.some(c => c.includes('categorias')),
        'Edições concorrentes no mesmo registro exigem revisão manual');
    assert.throws(() => conciliarReenvio(null, localReal, remotoReal, 1), /histórico de sincronização/);
    assert.throws(() => conciliarReenvio(baseReal, localReal, remotoReal, 999), /conta não consta/);

    console.log('OK: API JSON, timeout, exclusões, reenvio seguro, perfis protegidos e conflitos.');
})().catch(erro => {console.error(erro); process.exitCode = 1;});
