/* Testes offline do fluxo completo de reenvio: nenhum dado real é enviado. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const origem = fs.readFileSync(path.join(__dirname, 'script.js'), 'utf8');
const inicioMescla = origem.indexOf('function serializarEstavel(');
const fimMescla = origem.indexOf('function marcarConflitoSincronizacao(', inicioMescla);
const clonarFonte = origem.match(/^const clonarDados = .*;$/m)?.[0];
const inicioFluxo = origem.indexOf('async function forcarEnvioComBackup(');
const fimFluxo = origem.indexOf('function atualizarIndicadorSyncUI(', inicioFluxo);
assert.ok(inicioMescla > 0 && fimMescla > inicioMescla && clonarFonte);
assert.ok(inicioFluxo > 0 && fimFluxo > inicioFluxo);

const colecoes = ['usuarios', 'categorias', 'cartoes', 'lancamentos', 'financiamentos',
    'bens', 'notificacoes', 'logs', 'exclusao_movimento', 'edicao_movimento', 'fatura_cartao'];
const ctxMescla = {COLECOES_DADOS: colecoes};
vm.createContext(ctxMescla);
vm.runInContext(clonarFonte + '\n' + origem.slice(inicioMescla, fimMescla), ctxMescla);
const copia = valor => JSON.parse(JSON.stringify(valor));

function snapshot() {
    const dados = Object.fromEntries(colecoes.map(c => [c, []]));
    dados.usuarios = [
        {id: 1, usuario: 'yuri', nome: 'Yuri', ativo: true, permissoes: {perfil: 'usuario'}},
        {id: 2, usuario: 'maria', nome: 'Maria', ativo: true, permissoes: {perfil: 'usuario'}}
    ];
    dados.categorias = [{id: 10, nome: 'Transporte', tipo: 'saida'}];
    dados._revision = 8;
    return dados;
}

function ambiente(base, local, remoto, {resultadoPost, durantePost} = {}) {
    const dadosIniciais = {
        DB: JSON.stringify(local), BASE: base ? JSON.stringify(base) : null,
        usuarioLogado: '1', DONO: '1', syncPendente: 'true'
    };
    const kv = new Map(Object.entries(dadosIniciais).filter(([,v]) => v !== null));
    const mensagens = [], posts = [], backups = [], estados = [];
    let recarregamentos = 0;
    const localStorage = {
        getItem: chave => kv.get(chave) ?? null,
        setItem: (chave, valor) => kv.set(chave, String(valor)),
        removeItem: chave => kv.delete(chave)
    };
    const ctx = {
        localStorage, syncInFlight: false, reenvioEmAndamento: false, syncTimer: null,
        syncPendingData: copia(local), syncFalhasConsecutivas: 0, memoriaSistema: copia(local),
        DB_KEY: 'DB', SYNC_BASELINE_KEY: 'BASE', SYNC_CONFLICT_KEY: 'CONFLITO',
        CHAVE_DONO_PENDENCIAS: 'DONO', COLECOES_DADOS: colecoes,
        clearTimeout: () => {}, setTimeout: () => 1,
        Blob, URL: {createObjectURL: () => 'blob:teste', revokeObjectURL: () => {}},
        document: {
            createElement: () => ({click: () => backups.push(copia(local)), href: '', download: ''}),
            body: {appendChild: () => {}, removeChild: () => {}}
        },
        mostrarLoading: () => {}, esconderLoading: () => {},
        mostrarAlertaModal: async mensagem => mensagens.push(mensagem),
        atualizarIndicadorSyncUI: estado => estados.push(estado),
        agendarSincronizacaoSilenciosa: () => {},
        marcarConflitoSincronizacao: (dados, conflitos, mensagem) => {
            kv.set('CONFLITO', JSON.stringify({conflitos, mensagem}));
        },
        lerJSONLocal: (chave, padrao) => {
            try {return kv.has(chave) ? JSON.parse(kv.get(chave)) : padrao;}
            catch {return padrao;}
        },
        buscarDadosServidor: async () => copia(remoto),
        migrarDados: dados => ({dados}), clonarDados: valor => valor === undefined ? undefined : copia(valor),
        prepararReenvioSeguro: (...args) => ctxMescla.prepararReenvioSeguro(...args),
        obterSessaoAPI: () => 'sessao-valida',
        executarPostAPI: async (acao, {dados}) => {
            posts.push({acao, dados: copia(dados)});
            if (durantePost) durantePost(localStorage);
            return resultadoPost || {status: 'sucesso', _revision: 9};
        },
        gravarSnapshotLocal: (dados, definirBase) => {
            kv.set('DB', JSON.stringify(dados));
            if (definirBase) kv.set('BASE', JSON.stringify(dados));
        },
        location: {reload: () => {recarregamentos++;}}
    };
    vm.createContext(ctx);
    vm.runInContext(origem.slice(inicioFluxo, fimFluxo), ctx);
    return {ctx, kv, posts, backups, mensagens, estados, recarregamentos: () => recarregamentos};
}

(async () => {
    const base = snapshot(), local = copia(base), remoto = copia(base);
    local.categorias.push({id: 11, nome: 'Ganhos Uber', tipo: 'entrada'});
    local.usuarios[1].nome = 'Perfil errado no cache';
    remoto.usuarios[1].nome = 'Perfil correto no Sheets';
    remoto._revision = 9;
    const sucesso = ambiente(base, local, remoto);
    await sucesso.ctx.forcarEnvioComBackup();
    assert.equal(sucesso.backups.length, 1, 'Sempre deve gerar backup local antes de enviar');
    assert.equal(sucesso.posts.length, 1, 'Um único POST seguro');
    assert.equal(sucesso.posts[0].dados.usuarios[1].nome, 'Perfil correto no Sheets');
    assert.equal(sucesso.posts[0].dados.categorias.length, 2, 'Preserva lançamento local');
    assert.equal(sucesso.posts[0].dados._revision, 9);
    assert.equal(sucesso.kv.has('syncPendente'), false);
    assert.equal(sucesso.recarregamentos(), 1);

    const semBase = ambiente(null, local, remoto);
    await semBase.ctx.forcarEnvioComBackup();
    assert.equal(semBase.backups.length, 1);
    assert.equal(semBase.posts.length, 0, 'Sem base, não há envio inseguro');
    assert.match(semBase.mensagens.at(-1), /snapshot-base completo/);

    const localComConflito = copia(local), remotoComConflito = copia(remoto);
    localComConflito.categorias[0].nome = 'Transporte corrigido no navegador';
    remotoComConflito.categorias[0].nome = 'Transporte corrigido no Sheets';
    const conflito = ambiente(base, localComConflito, remotoComConflito);
    await conflito.ctx.forcarEnvioComBackup();
    assert.equal(conflito.posts.length, 0, 'Conflitos impedem POST');
    assert.equal(conflito.kv.has('CONFLITO'), true, 'Conflito registrado para revisão');
    assert.deepEqual(JSON.parse(conflito.kv.get('DB')), localComConflito, 'Dados locais íntegros');

    const novaAlteracao = {id: 12, nome: 'Recebimento recente', tipo: 'entrada'};
    const edicaoEmCurso = ambiente(base, local, remoto, {
        durantePost: armazenamento => {
            const atual = JSON.parse(armazenamento.getItem('DB'));
            atual.categorias.push(novaAlteracao);
            armazenamento.setItem('DB', JSON.stringify(atual));
        }
    });
    await edicaoEmCurso.ctx.forcarEnvioComBackup();
    assert.equal(edicaoEmCurso.kv.get('syncPendente'), 'true', 'Nova edição fica pendente');
    assert.equal(JSON.parse(edicaoEmCurso.kv.get('DB')).categorias.at(-1).id, 12);
    assert.equal(edicaoEmCurso.recarregamentos(), 0, 'Não recarrega quando houve edição nova');

    console.log('OK: fluxo completo de reenvio, backup, bloqueios, preservação de dados e edição concorrente.');
})().catch(erro => {console.error(erro); process.exitCode = 1;});
