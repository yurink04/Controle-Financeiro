/* Testes de contrato / autorização do backend. Não executa rede nem escreve no Google Sheets. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const code = fs.readFileSync(path.resolve(__dirname, '..', '..', 'Code.gs'),'utf8');
const sheet = {getSheetByName:()=>null};
const context = {
  console, Number, JSON, Math, Date, Object, Array, String, RegExp,
  SpreadsheetApp:{getActiveSpreadsheet:()=>sheet},
  PropertiesService:{getScriptProperties:()=>({getProperty(k){return k==='SENHA_MESTRA_API'?'token-teste':'admin-teste';}})},
  CacheService:{getScriptCache:()=>({get:()=>null})},
  LockService:{getScriptLock:()=>({hasLock:()=>false,waitLock(){},releaseLock(){}})},
  ContentService:{MimeType:{JSON:'json'},createTextOutput(value){return {value,setMimeType(){return this;}}}}
};
vm.createContext(context);vm.runInContext(code,context,{filename:'Code.gs',timeout:5000});
const run=(snippet)=>vm.runInContext(snippet,context);
const SCHEMA=run('SCHEMA');
const collections=Object.keys(SCHEMA);
const frontend=fs.readFileSync(path.resolve(__dirname,'..','conexao_sheets.js'),'utf8');
const names=[...frontend.match(/const COLECOES_DADOS = \[([^\]]+)\]/)[1].matchAll(/'([^']+)'/g)].map(m=>m[1]);
assert.deepEqual(names,collections,'Frontend e backend usam a mesma lista e ordem de coleções');
assert.ok(SCHEMA.lancamentos.includes('financiamentoId'));
assert.ok(SCHEMA.lancamentos.includes('naturezaRenda'));
assert.ok(SCHEMA.usuarios.includes('configuracaoSalarial'));
assert.ok(SCHEMA.lancamentos.includes('parcelamentoId'));
assert.ok(SCHEMA.cartoes.includes('isBeneficio'));
assert.equal(run('typeof doPost'),'function');
assert.equal(run('typeof retornarDadosCompletos'),'function');
const usuario={id:1, parceiroId:2, permissoes:{perfil:'supervisor',acoes:{criarMovimento:true,excluirMovimento:true}}};
const parceiro={id:2,parceiroId:1,permissoes:{perfil:'supervisor',acoes:{criarMovimento:true,excluirMovimento:true}}};
const empty=()=>Object.fromEntries(collections.map(n=>[n,[]]));
const base=empty();base.usuarios=[usuario,parceiro];
const diff=(alterar)=>{let a=structuredClone(base);let b=structuredClone(base);alterar(a,b);return [a,b];};
function verificarFinanceiro(mutacao,esperaErro){
 const [a,b]=diff(mutacao);
 const erro=(()=>{try{context.conferirAlteracoesFinanceiras(a,b,usuario);return null;}catch(e){return e;}})();
 if(esperaErro) assert.ok(erro,`Deveria bloquear: ${esperaErro}`);
 else assert.equal(erro,null,erro?.message);
}
verificarFinanceiro((a,b)=>b.cartoes.push({id:'c1',usuarioId:1,nome:'Cartão próprio'}),false);
verificarFinanceiro((a,b)=>b.cartoes.push({id:'c2',usuarioId:2,nome:'Cartão do parceiro'}),'criar cartão para parceiro');
verificarFinanceiro((a,b)=>{a.cartoes.push({id:'c',usuarioId:2,nome:'Outro'});b.cartoes.push({id:'c',usuarioId:1,nome:'Outro'});},'troca de dono');
verificarFinanceiro((a,b)=>{a.lancamentos.push({id:'l',usuarioId:2,escopo:'individual',valor:10});b.lancamentos.push({id:'l',usuarioId:2,escopo:'casal',valor:20});},'privacidade de lançamento anterior individual');
verificarFinanceiro((a,b)=>{a.lancamentos.push({id:'l',usuarioId:2,escopo:'casal',valor:10});b.lancamentos.push({id:'l',usuarioId:2,escopo:'casal',valor:20});},false);
verificarFinanceiro((a,b)=>b.categorias.push({id:4,nome:'Fraude',tipo:'saida',criadopor:2}),'forjar categoria de parceiro');
verificarFinanceiro((a,b)=>b.categorias.push({id:4,nome:'Minha',tipo:'saida',criadopor:1}),false);
verificarFinanceiro((a,b)=>b.financiamentos.push({id:4,nome:'Plano',usuarioId:2}),'forjar financiamento do parceiro');
verificarFinanceiro((a,b)=>b.bens.push({id:4,nome:'Bem',usuarioId:2}),'forjar bem do parceiro');
verificarFinanceiro((a,b)=>{b.cartoes.push({id:'c2',usuarioId:2});b.fatura_cartao.push({id:'f1',cartaoId:'c2'});},'criar cartão do parceiro');
verificarFinanceiro((a,b)=>{a.cartoes.push({id:'c2',usuarioId:2});b.cartoes.push({id:'c2',usuarioId:2});b.fatura_cartao.push({id:'f1',cartaoId:'c2'});},false);
const n={id:'n1',usuarioDestinoId:1,remetenteId:2,tipo:'solicitacao_parceiro',statusAprovacao:'pendente',lida:false,mensagem:'Olá'};
function verificarNotif(antigo,novo,esperaErro){
 let erro=null;try{context.conferirNotificacoes(antigo,novo,usuario,false);}catch(e){erro=e;}
 if(esperaErro)assert.ok(erro,`Deveria bloquear: ${esperaErro}`);
 else assert.equal(erro,null,erro?.message);
}
verificarNotif([n],[{...n,lida:true}],false);
verificarNotif([n],[{...n,statusAprovacao:'aprovado'}],false);
verificarNotif([n],[{...n,statusAprovacao:'negado'}],false);
verificarNotif([n],[{...n,statusAprovacao:'qualquer-coisa'}],'status desconhecido');
verificarNotif([n],[{...n,mensagem:'Alterado'}],'alterar conteúdo');
verificarNotif([n],[{...n,remetenteId:3}],'forjar remetente');
verificarNotif([{...n,usuarioDestinoId:2}],[{...n,usuarioDestinoId:2,lida:true}],'ler notificação alheia');
const resposta=JSON.parse(context.doPost({postData:{contents:JSON.stringify({token:'token-teste',action:'statusCadastro'})}}).value);
assert.equal(resposta.status,'sucesso','POST statusCadastro deve funcionar');
assert.equal(resposta.primeiroCadastroDisponivel,true);
const duplicate=empty();duplicate.usuarios=[{id:'1'},{id:'1'}];
const testDuplicate=JSON.parse(context.doPost({postData:{contents:JSON.stringify({token:'token-teste',action:'salvarDados',dados:duplicate})}}).value);
assert.equal(testDuplicate.status,'erro');
assert.match(testDuplicate.mensagem,/duplicados/);
console.log(`PASSOU: ${collections.length} coleções do frontend/Code.gs; 18 verificações de autorização e contratos; identificadores duplicados bloqueados; statusCadastro via POST.`);
