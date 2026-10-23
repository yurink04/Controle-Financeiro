/* Testa diagnósticos de revisão e erro sem executar qualquer requisição real. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const codigo = fs.readFileSync(path.resolve(__dirname, '..', 'conexao_sheets.js'), 'utf8');
const login = fs.readFileSync(path.resolve(__dirname, '..', 'page', 'index.js'), 'utf8');
assert.match(login, /executarPostAPI\('statusCadastro', \{\}, 18000\)/);
assert.doesNotMatch(login, /\?action=statusCadastro&token=/, 'Token não deve aparecer em URL de GET');
const diagnosticoInicio = codigo.indexOf('// Diagnóstico sem armazenar sessão');
const diagnosticoFim = codigo.indexOf('function ehModoTesteAtivo(', diagnosticoInicio);
const revInicio = codigo.indexOf('async function consultarRevisaoServidor()');
const revFim = codigo.indexOf('async function verificarAtualizacaoServidor(', revInicio);
const uiInicio = codigo.indexOf('function atualizarIndicadorSyncUI(');
const uiFim = codigo.indexOf('// Migrações de esquema', uiInicio);
assert.ok(diagnosticoInicio > -1 && diagnosticoFim > diagnosticoInicio);
assert.ok(revInicio > -1 && revFim > revInicio && uiInicio > -1 && uiFim > uiInicio);
const memoria = new Map();
const icone = {src: ''};
const titulo = {textContent: ''};
const indicador = {dataset: {}, title: '', setAttribute() {}, querySelector(sel) { return sel === 'img' ? icone : titulo; }};
const ctx = {
  TOKEN_API:'chave-secreta-de-teste',
  sessionStorage:{setItem:(ch,v)=>memoria.set(ch,v),getItem:ch=>memoria.get(ch)||null,removeItem:ch=>memoria.delete(ch)},
  document:{getElementById:()=>indicador},
  executarPostAPI:async()=>({status:'erro',mensagem:'Acesso não autorizado'}),
  obterSessaoAPI:()=> 'sessao-de-teste',
  Date,
  console
};
vm.createContext(ctx);
vm.runInContext(codigo.slice(diagnosticoInicio, diagnosticoFim) + '\n' + codigo.slice(revInicio,revFim) + '\n' + codigo.slice(uiInicio,uiFim),ctx);
(async()=>{
  await assert.rejects(ctx.consultarRevisaoServidor(),/Acesso não autorizado/);
  const falha = ctx.registrarFalhaSincronizacao('consulta', new Error('token de teste: chave-secreta-de-teste'));
  assert.ok(!falha.mensagem.includes('chave-secreta-de-teste'),'Não registrar token na mensagem');
  ctx.atualizarIndicadorSyncUI('error');
  assert.match(indicador.title,/consulta/);
  assert.equal(indicador.dataset.syncState,'error');
  assert.equal(titulo.textContent,'Erro');
  const gravado=JSON.parse(memoria.get('financeiroDiagnosticoSincronizacao'));
  assert.equal(gravado.origem,'consulta');
  assert.ok(!JSON.stringify(gravado).includes('sessao-de-teste'));
  ctx.executarPostAPI = async()=>({status:'sucesso',_revision:8});
  assert.equal(await ctx.consultarRevisaoServidor(),8);
  ctx.executarPostAPI = async()=>({status:'sucesso',_revision:'invalida'});
  await assert.rejects(ctx.consultarRevisaoServidor(), /revisão inválida/);
  ctx.atualizarIndicadorSyncUI('success');
  assert.ok(!memoria.has('financeiroDiagnosticoSincronizacao'));
  console.log('PASSOU: erros explícitos, token ocultado, diagnóstico sem dados financeiros e limpeza após sucesso.');
})().catch(e=>{console.error(e);process.exitCode=1});
