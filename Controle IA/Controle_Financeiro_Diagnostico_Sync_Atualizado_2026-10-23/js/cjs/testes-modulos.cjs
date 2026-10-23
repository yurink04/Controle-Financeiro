/* Testes offline de integração dos três scripts, sem dependências externas. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const raiz = path.resolve(__dirname, '..', '..');
const storage = () => { const m=new Map(); return {getItem:k=>m.has(k)?m.get(k):null, setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k),clear:()=>m.clear()}; };
const localStorage=storage(), sessionStorage=storage();
const noop=()=>{};
const doc={body:{classList:{contains:()=>false}},getElementById:()=>null,querySelector:()=>null,querySelectorAll:()=>[],addEventListener:noop,createElement:()=>({innerHTML:'',set textContent(v){this.innerHTML=String(v??'')}}),hidden:false};
const context={
 addEventListener:noop, console, localStorage, sessionStorage, document:doc, navigator:{onLine:true},
 setTimeout:()=>1,clearTimeout:noop,setInterval:()=>1,clearInterval:noop,
 TextEncoder,AbortController,URL,Date,Math,Intl,Number,JSON,RegExp,Map,Set,Promise,
 location:{pathname:'/index.html'},fetch:async()=>{throw new Error('fetch mock não configurado');}
};
context.window=context;
const sandbox=vm.createContext(context);
for(const arq of ['script.js','calculos_trabalhistas.js','conexao_sheets.js']){
 vm.runInContext(fs.readFileSync(path.join(raiz,'js',arq),'utf8'),sandbox,{filename:arq,timeout:5000});
}
const get=(expr)=>vm.runInContext(expr,sandbox);
for(const nome of ['obterDados','salvarDados','migrarDados','sincronizarComServidor','prepararReenvioSeguro','executarPostAPI','calcularSalarioLiquido','abrirEditorSalarial','criarIndicadorSincronizacaoUi','inicializarBanco','gerarHash']) {
 assert.equal(get('typeof '+nome),'function',nome+' não disponível');
}
assert.equal(get('FAIXAS_INSS_2026.length'),4);
assert.equal(get("classificarEntradaRendimento({tipo:'entrada',descricao:'Pagamento PLR',valor:1400},{categorias:[],financiamentos:[]})"),'salarial_extra','PLR deve ser classificada');
assert.equal(get("classificarEntradaRendimento({tipo:'entrada',descricao:'13º salário',valor:1400},{categorias:[],financiamentos:[]})"),'salarial_extra');
assert.equal(get("centavosRenda(21.179999999)"),21.18);
assert.equal(get("calcularSalarioLiquido(3000,{regimeRenda:'pj'}).inss.valor"),0);
assert.ok(get("calcularSalarioLiquido(3000,{regimeRenda:'clt'}).inss.valor")>0);
assert.equal(get("mesclarValorTresVias(1,2,1,'campo',[] )"),2);
assert.equal(get("mesclarValorTresVias(1,1,2,'campo',[] )"),2);
assert.equal(get("mesclarValorTresVias(undefined,undefined,{id:1},'campo',[]).id"),1);
let r=get(`mesclarSnapshotsTresVias(
 {usuarios:[],categorias:[],lancamentos:[{id:'id1',valor:10}]},
 {usuarios:[],categorias:[],lancamentos:[{id:'id1',valor:11}]},
 {usuarios:[],categorias:[],lancamentos:[{id:'id1',valor:10},{id:'id2',valor:20}],_revision:8}
)`);
assert.equal(r.conflitos.length,0);assert.equal(r.dados.lancamentos.length,2);
assert.ok(r.dados.lancamentos.some(l=>l.id==='id1'&&l.valor===11));
const usuario1={id:'u1',nome:'Um',usuario:'um',ativo:true,permissoes:{perfil:'usuario'},configuracaoSalarial:{},preferenciasNotificacao:{}};
const usuario2={id:'u2',nome:'Dois',usuario:'dois',ativo:true,permissoes:{perfil:'usuario'},configuracaoSalarial:{},preferenciasNotificacao:{}};
let servidor={usuarios:[usuario1,usuario2],categorias:[],cartoes:[],lancamentos:[],financiamentos:[],bens:[],notificacoes:[],logs:[],exclusao_movimento:[],edicao_movimento:[],fatura_cartao:[],_revision:5};
context.fetch=async (url,opts)=>{
 const arg=JSON.parse(opts.body);
 if(arg.action==='obterDados') return {ok:true,status:200,text:async()=>JSON.stringify({...servidor,status:'sucesso'})};
 if(arg.action==='revisao') return {ok:true,status:200,text:async()=>JSON.stringify({status:'sucesso',_revision:servidor._revision})};
 if(arg.action==='salvarDados') {
   if(arg.dados._revision!==servidor._revision) return {ok:true,status:200,text:async()=>JSON.stringify({status:'conflito',_revision:servidor._revision})};
   servidor=JSON.parse(JSON.stringify(arg.dados)); servidor._revision++;
   return {ok:true,status:200,text:async()=>JSON.stringify({status:'sucesso',_revision:servidor._revision})};
 }
 throw Error('Ação desconhecida: '+arg.action);
};
localStorage.setItem('usuarioLogado','u1');
sessionStorage.setItem('financeiroSessaoSegura','sessao-teste');
sessionStorage.setItem('financeiroSessaoUsuario','u1');
(async()=>{
 await get('inicializarBanco()');
 assert.equal(get('obterDados()._revision'),5);
 assert.equal(localStorage.getItem('syncPendente'),null);
 let dados=get('obterDados()');
 dados.lancamentos.push({id:'l1',usuarioId:'u1',tipo:'entrada',valor:90,descricao:'Teste',status:'pago',vencimento:'2026-10-23'});
 await get('salvarDados(obterDados())');
 assert.equal(localStorage.getItem('syncPendente'),'true');
 await get('sincronizarComServidor()');
 assert.equal(servidor._revision,6);
 assert.equal(servidor.lancamentos.find(l=>l.id==='l1').valor,90);
 assert.equal(localStorage.getItem('syncPendente'),null);
 assert.equal(get('obterDados()._revision'),6);
 // Confirma que mudanças de perfil de terceiros são revertidas no envio comum.
 let d2=get('obterDados()'); d2.usuarios.find(u=>u.id==='u2').nome='Invasão de perfil';
 await get('salvarDados(obterDados())');
 await get('sincronizarComServidor()');
 assert.equal(servidor.usuarios.find(u=>u.id==='u2').nome,'Dois');
 // Falha de rede não descarta alterações locais.
 let d3=get('obterDados()'); d3.lancamentos.push({id:'l2',usuarioId:'u1',tipo:'saida',valor:15,status:'pendente'});
 await get('salvarDados(obterDados())');
 const anterior=context.fetch; context.fetch=async()=>{ throw new TypeError('offline');};
 await get('sincronizarComServidor()');
 assert.equal(localStorage.getItem('syncPendente'),'true');
 assert.ok(get('obterDados().lancamentos.some(l=>l.id===\'l2\')'));
 context.fetch=anterior;
 // Deve conseguir reenviar após a rede voltar.
 await get('sincronizarComServidor()');
 assert.equal(localStorage.getItem('syncPendente'),null);
 assert.ok(servidor.lancamentos.some(l=>l.id==='l2'));
 // Resposta incompleta não pode substituir o cache por arrays vazios.
 const localIntegro=localStorage.getItem('sistemaFinanceiroCompartilhado');
 context.fetch=async()=>({ok:true,status:200,text:async()=>JSON.stringify({usuarios:[],_revision:20})});
 await assert.rejects(get('buscarDadosServidor()'),/incompleta/);
 assert.equal(localStorage.getItem('sistemaFinanceiroCompartilhado'),localIntegro);
 context.fetch=anterior;
 // Uma alteração na outra aba durante o POST nunca deve ser sobrescrita.
 const d4=get('obterDados()');d4.lancamentos.push({id:'l3',usuarioId:'u1',tipo:'saida',valor:9,status:'pendente'});
 await get('salvarDados(obterDados())');
 const rotinaNormal=context.fetch;
 context.fetch=async (url,opts)=>{
   const body=JSON.parse(opts.body);
   if(body.action==='salvarDados'){
     const aindaLocal=JSON.parse(localStorage.getItem('sistemaFinanceiroCompartilhado'));
     aindaLocal.lancamentos.push({id:'l4',usuarioId:'u1',tipo:'saida',valor:7,status:'pendente'});
     localStorage.setItem('sistemaFinanceiroCompartilhado',JSON.stringify(aindaLocal));
   }
   return rotinaNormal(url,opts);
 };
 await get('sincronizarComServidor()');
 context.fetch=rotinaNormal;
 assert.ok(servidor.lancamentos.some(l=>l.id==='l4'),'A edição da outra aba deve chegar ao servidor');
 assert.ok(get('obterDados().lancamentos.some(l=>l.id===\'l4\')'));
 // O filtro de relatórios só mostra os próprios e os de parceiro recíproco no escopo casal.
 const dadosEscopo={usuarios:[{id:'u1',parceiroId:'u2'},{id:'u2',parceiroId:'u1'},{id:'u3'}]};
 context.dadosEscopo=dadosEscopo;
 const resultadoFiltro=get(`filtrarDadosPorPermissao([
   {id:1,usuarioId:'u1',escopo:'individual'},
   {id:2,usuarioId:'u2',escopo:'casal'},
   {id:3,usuarioId:'u2',escopo:'individual'},
   {id:4,usuarioId:'u3',escopo:'casal'}], dadosEscopo, 'casal').map(l=>l.id)`);
 assert.deepEqual(Array.from(resultadoFiltro),[1,2]);
 const dadosNotificacoes={lancamentos:[{id:'xx_12',usuarioId:'u1',vencimento:'2026-11-02',pago:false,status:'pendente'}],notificacoes:[
  {id:'alerta_vencimento_u1_xx_12_20261102',tipo:'alerta_vencimento'},
  {id:'alerta_atraso_u1_indefinido_20261102',tipo:'alerta_vencimento'}]};
 context.dadosNotificacoes=dadosNotificacoes;
 get('limparNotificacoesResolvidas(dadosNotificacoes)');
 assert.equal(dadosNotificacoes.notificacoes.length,1);
 assert.equal(dadosNotificacoes.notificacoes[0].id,'alerta_vencimento_u1_xx_12_20261102');
 console.log('PASSOU: 3 scripts integrados; contratos de API; validação de snapshot; mesclagem; isolamento de casal; lembretes; resiliência a falhas; reenvio e alterações de outra aba.');
})().catch(e=>{console.error(e);process.exitCode=1});
