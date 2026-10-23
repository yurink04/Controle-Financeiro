/* Testes de regressão: nenhuma chamada acessa planilhas ou credenciais reais. */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const fonte = nome => fs.readFileSync(path.resolve(__dirname,'..','..',nome), 'utf8');
const sha = s => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const tabelas = new Map();

class AbaSimulada {
    constructor(cabecalho, dados = []) {
        this.matriz = [cabecalho.slice(), ...dados.map(row => row.slice())];
        this.gravacoes = 0;
        this.limpezasIntegrais = 0;
        this.failNext = false;
    }
    getLastRow() {
        let ultima = this.matriz.length;
        while (ultima > 0 && !(this.matriz[ultima - 1] || []).some(x => x !== '' && x != null)) ultima--;
        return ultima;
    }
    getLastColumn() {
        let ultima = Math.max(...this.matriz.map(row => row.length), 0);
        while (ultima > 0 && !this.matriz.some(row => row[ultima - 1] !== '' && row[ultima - 1] != null)) ultima--;
        return ultima;
    }
    getRange(linha, coluna, altura = 1, largura = 1) {
        const aba = this;
        return {
            getValues: () => Array.from({length: altura}, (_, i) =>
                Array.from({length: largura}, (_, j) => aba.matriz[linha + i - 1]?.[coluna + j - 1] ?? '')),
            setValue(valor) { this.setValues([[valor]]); },
            clearContent() {
                for (let i = 0; i < altura; i++) for (let j = 0; j < largura; j++) {
                    if (!aba.matriz[linha + i - 1]) aba.matriz[linha + i - 1] = [];
                    aba.matriz[linha + i - 1][coluna + j - 1] = '';
                }
            },
            setValues(valores) {
                if (aba.failNext) { aba.failNext = false; throw new Error('Falha simulada do Sheets'); }
                aba.gravacoes++;
                valores.forEach((r, i) => r.forEach((valor, j) => {
                    if (!aba.matriz[linha + i - 1]) aba.matriz[linha + i - 1] = [];
                    aba.matriz[linha + i - 1][coluna + j - 1] = valor;
                }));
            }
        };
    }
    clearContents() { this.limpezasIntegrais++; this.matriz = []; }
    setFrozenRows() {}
}

const propriedades = new Map([['SENHA_MESTRA_API', 'token-teste'], ['SENHA_ADMIN', 'admin-teste']]);
const cache = new Map();
let locks = 0;
const contexto = {
    SpreadsheetApp: {flush() {}, getActiveSpreadsheet: () => ({
        getSheetByName: nome => tabelas.get(nome) || null,
        insertSheet: nome => { const aba = new AbaSimulada([]); tabelas.set(nome, aba); return aba; }
    })},
    PropertiesService: {getScriptProperties: () => ({
        getProperty: chave => propriedades.get(chave) ?? null,
        setProperty: (chave, v) => propriedades.set(chave, v),
        deleteProperty: chave => propriedades.delete(chave)
    })},
    CacheService: {getScriptCache: () => ({
        get: chave => cache.get(chave) ?? null,
        put: (chave, v) => cache.set(chave, v),
        remove: chave => cache.delete(chave)
    })},
    LockService: {getScriptLock: () => ({
        waitLock() {locks++;}, releaseLock() {if (locks > 0) locks--;}, hasLock() {return locks > 0;}
    })},
    ContentService: {MimeType: {JSON: 'json'}, createTextOutput: texto => ({
        texto, setMimeType() {return this;}
    })},
    Utilities: {
        getUuid: () => crypto.randomUUID(),
        DigestAlgorithm: {SHA_256: 'SHA_256'}, Charset: {UTF_8: 'utf8'},
        computeDigest: (alg, valor) => [...crypto.createHash('sha256').update(valor, 'utf8').digest()]
            .map(v => v > 127 ? v - 256 : v)
    },
    console
};
vm.createContext(contexto);
vm.runInContext(fonte('Code.gs'), contexto);
const post = (action, campos = {}) => JSON.parse(contexto.doPost({
    postData: {contents: JSON.stringify({action, token: 'token-teste', ...campos})}
}).texto);
const get = (action, campos = {}) => JSON.parse(contexto.doGet({parameter: {
    action, token: 'token-teste', ...campos
}}).texto);

const schema = contexto.SCHEMA;
const senhaOriginal = sha('MinhaSenha@123');
const admin = {id: 1, usuario: 'admin', nome: 'Administrador', pin: senhaOriginal, ativo: true,
    permissoes: {perfil: 'admin', paginas: {}, acoes: {usuarios: true}},
    preferenciasNotificacao: {ativo: true}};
function linha(nome, registro) {
    return schema[nome].map(campo => {
        const val = registro[campo] ?? '';
        return val && typeof val === 'object' ? JSON.stringify(val) : val;
    });
}
Object.keys(schema).forEach(nome => tabelas.set(nome, new AbaSimulada(schema[nome],
    nome === 'usuarios' ? [linha(nome, admin)] : [])));
const abaUsuarios = tabelas.get('usuarios');
const abaCategorias = tabelas.get('categorias');
const valorPin = () => abaUsuarios.matriz[1][schema.usuarios.indexOf('pin')];

assert.equal(get('statusCadastro').versaoSincronizacao, '2026-10-20-pin-protegido');
const entrada = post('verificarCredenciaisLogin', {usuario: 'admin', senhaHash: senhaOriginal});
assert.equal(entrada.status, 'sucesso');
const sessao = entrada.sessao;
const leitura = () => post('obterDados', {sessao});
const salvar = dados => post('salvarDados', {sessao, dados});
let dados = leitura();
assert.equal(dados.usuarios[0].pin, undefined, 'API não devolve hash ao navegador');

// Cadastro de gasto: a aba usuarios não pode ser reescrita, nem um instante.
dados.categorias.push({id: 'cat1', nome: 'Transporte', tipo: 'saida', classificacao: 'variavel'});
let resposta = salvar(dados);
assert.equal(resposta.status, 'sucesso', resposta.mensagem);
assert.equal(abaUsuarios.gravacoes, 0, 'Alteração financeira não regrava usuários');
assert.equal(abaCategorias.gravacoes, 1, 'Apenas a coleção modificada deve ser gravada');
assert.equal(valorPin(), senhaOriginal);
assert.equal([...tabelas.values()].reduce((total, aba) => total + aba.limpezasIntegrais, 0), 0,
    'Nenhuma sincronização deve limpar integralmente uma aba');

// Edição de perfil (nome), sem alteração de PIN: preserva o hash original.
dados = leitura();
dados.usuarios[0].nome = 'Admin Editado';
resposta = salvar(dados);
assert.equal(resposta.status, 'sucesso', resposta.mensagem);
assert.equal(abaUsuarios.gravacoes, 1, 'Edição do perfil pode gravar usuarios');
assert.equal(valorPin(), senhaOriginal, 'Edição sem senha mantém PIN anterior');

// Até um payload com pin vazio deve preservar a credencial armazenada.
dados = leitura();
dados.usuarios[0].pin = '';
dados.categorias.push({id: 'cat2', nome: 'Ganho Uber', tipo: 'entrada'});
resposta = salvar(dados);
assert.equal(resposta.status, 'sucesso', resposta.mensagem);
assert.equal(abaUsuarios.gravacoes, 1);
assert.equal(valorPin(), senhaOriginal);

// Alteração intencional de credencial continua funcionando (hash SHA-256).
dados = leitura();
const senhaNova = sha('NovaSenha@2026');
dados.usuarios[0].pin = senhaNova;
resposta = salvar(dados);
assert.equal(resposta.status, 'sucesso', resposta.mensagem);
assert.equal(valorPin(), senhaNova);
assert.equal(post('verificarCredenciaisLogin', {
    usuario: 'admin', senhaHash: senhaNova
}).status, 'sucesso');

// Redução de linhas limpa só a sobra, sem limpar a aba inteira.
dados = leitura();
dados.categorias = dados.categorias.filter(c => c.id !== 'cat2');
resposta = salvar(dados);
assert.equal(resposta.status, 'sucesso', resposta.mensagem);
assert.equal(abaCategorias.getLastRow(), 2, 'A linha excedente deve ser removida');
assert.equal(valorPin(), senhaNova);
assert.equal(abaCategorias.limpezasIntegrais, 0);

// Erro de escrita: restauração mantém PIN; falha não apaga outras abas.
dados = leitura();
dados.categorias[0].nome = 'Transporte alterado';
abaCategorias.failNext = true;
resposta = salvar(dados);
assert.equal(resposta.status, 'erro', 'Uma falha simulada deve ser informada');
assert.equal(valorPin(), senhaNova);
assert.equal(abaUsuarios.gravacoes, 2, 'Rollback de categoria não regrava usuários');
assert.equal(locks, 0, 'Todos os bloqueios liberados');

console.log('OK: sync por coleção, PIN preservado, edição intencional de senha e recuperação de erro.');
