// Diagnóstico somente leitura: GET statusCadastro e POST revisao sem sessão.
// Nunca envia login, PIN, sessão real ou dados financeiros; não mostra o token.
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');

const fonte = fs.readFileSync(path.join(__dirname, 'script.js'), 'utf8');
function constante(nome) {
    const m = fonte.match(new RegExp('const ' + nome + '\\s*=\\s*["\']([^"\']+)["\']'));
    if (!m) throw new Error(`Não encontrei ${nome} no script.js.`);
    return m[1];
}

const url = new URL(constante('API_URL'));
url.searchParams.set('action', 'statusCadastro');
url.searchParams.set('token', constante('TOKEN_API'));

try {
    const resposta = execFileSync('curl', [
        '--location', '--silent', '--show-error', '--max-time', '25', url.toString()
    ], {encoding: 'utf8', timeout: 30000});
    const dados = JSON.parse(resposta);
    console.log('Serviço:', dados.status === 'sucesso' ? 'respondeu corretamente' : 'recusou o diagnóstico');
    console.log('Versão de acesso:', dados.versaoAcesso || 'não informada pela implantação ativa');
    console.log('Proteção de sincronização:', dados.versaoSincronizacao || 'ainda não publicada nesta implantação');
    console.log('Cadastro inicial:', dados.status === 'sucesso'
        ? (dados.primeiroCadastroDisponivel === true ? 'disponível' : 'já existe usuário') : 'não verificado');
    if (dados.status !== 'sucesso') console.log('Ação recomendada: conferir as Script Properties e a implantação /exec.');

    // Valida também o endpoint de POST usado pela sincronização, mas envia
    // uma sessão propositalmente vazia: a resposta esperada é de autenticação.
    const post = execFileSync('curl', [
        '--location', '--silent', '--show-error', '--max-time', '25',
        '--header', 'Content-Type: text/plain;charset=utf-8',
        '--data', JSON.stringify({action: 'revisao', token: constante('TOKEN_API'), sessao: ''}),
        constante('API_URL')
    ], {encoding: 'utf8', timeout: 30000});
    const retornoPost = JSON.parse(post);
    const autorizacaoExigida = retornoPost.status === 'erro' && /sess[aã]o expirada/i.test(retornoPost.mensagem || '');
    console.log('POST de sincronização:', autorizacaoExigida
        ? 'endpoint acessível; autenticação exigida corretamente'
        : 'resposta inesperada, confira implantação e permissões');
} catch (erro) {
    console.error('Não foi possível obter uma resposta JSON da API. Confira conexão, URL e implantação.');
    process.exitCode = 1;
}
