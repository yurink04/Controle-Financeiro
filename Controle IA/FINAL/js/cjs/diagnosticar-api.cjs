/*
  Diagnóstico remoto somente leitura. Execute explicitamente com --online.
  Não envia informações de usuários ou dados financeiros nem altera planilhas.
  Sem --online, não faz requisições de rede.
*/
'use strict';
const fs = require('node:fs');
const path = require('node:path');
if (!process.argv.includes('--online')) {
  console.log('Diagnóstico remoto NÃO executado. Use: node js/cjs/diagnosticar-api.cjs --online');
  process.exit(0);
}
const fonte = fs.readFileSync(path.resolve(__dirname, '..', 'conexao_sheets.js'), 'utf8');
const constante = nome => {
  const trecho = fonte.match(new RegExp(`const ${nome}\\s*=\\s*["']([^"']+)["']`));
  if (!trecho) throw new Error(`Configuração ${nome} não encontrada.`);
  return trecho[1];
};
const api = constante('API_URL');
const token = constante('TOKEN_API');
(async () => {
  const url = new URL(api);
  url.searchParams.set('action','statusCadastro');
  url.searchParams.set('token',token);
  const req = async (url, options) => {
    const resposta = await fetch(url, {...options, signal: AbortSignal.timeout(25000), cache:'no-store'});
    if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
    const dados = await resposta.json();
    if (!dados || typeof dados !== 'object') throw new Error('JSON inesperado');
    return dados;
  };
  const get = await req(url);
  console.log('Status GET:', get.status === 'sucesso' ? 'resposta válida' : 'resposta de erro');
  console.log('Versão acesso:', get.versaoAcesso || '(não informada)');
  console.log('Versão sincronização:', get.versaoSincronizacao || '(não informada)');
  const post = await req(api, {method:'POST', headers:{'Content-Type':'text/plain;charset=utf-8'},
    body: JSON.stringify({action:'revisao', token, sessao:''})});
  console.log('POST revisao sem sessão:', post.status === 'erro' ? 'acesso recusado como esperado' : 'verificar autenticação');
})().catch(e => {
  console.error('Falha ao verificar endpoint:', e.message || String(e));
  process.exitCode=1;
});
