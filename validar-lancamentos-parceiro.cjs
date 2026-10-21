/* Offline: nenhum dado real. Uso: node validar-lancamentos-parceiro.cjs [Code.gs] */
const fs=require('fs'),vm=require('vm'),crypto=require('crypto'),path=require('path');
const arquivoGs=path.resolve(process.argv[2]||path.join(__dirname,'Code.gs'));
const planilhas=new Map(),cache=new Map(),props=new Map([['SENHA_MESTRA_API','k'],['SENHA_ADMIN','a']]);
class P{constructor(){this.l=[]}getLastRow(){return this.l.length}getLastColumn(){return this.l[0]?.length||0}setFrozenRows(){}clearContents(){this.l=[]}
 getRange(r,c,q,w){return{getValues:()=>Array.from({length:q},(_,i)=>Array.from({length:w},(_,j)=>this.l[r-1+i]?.[c-1+j]??'')),setValues:m=>m.forEach((v,i)=>{this.l[r-1+i]=v.slice()})}}}
const gs={SpreadsheetApp:{getActiveSpreadsheet:()=>({getSheetByName:n=>planilhas.get(n)||null,insertSheet:n=>{const f=new P();planilhas.set(n,f);return f}}),flush(){}},
 PropertiesService:{getScriptProperties:()=>({getProperty:k=>props.get(k)??null,setProperty:(k,v)=>props.set(k,v),deleteProperty:k=>props.delete(k)})},
 CacheService:{getScriptCache:()=>({get:k=>cache.get(k)??null,put:(k,v)=>cache.set(k,v),remove:k=>cache.delete(k)})},
 LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){},hasLock:()=>false})},
 ContentService:{MimeType:{JSON:'j'},createTextOutput:t=>({t,setMimeType(){return this}})},
 Utilities:{getUuid:()=>crypto.randomUUID(),formatDate:d=>new Date(d).toISOString().slice(0,10)},Logger:{log(){}},Session:{getScriptTimeZone:()=>'America/Sao_Paulo'},console};
vm.createContext(gs);vm.runInContext(fs.readFileSync(arquivoGs,'utf8'),gs);
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const perm=(p,acoes={})=>({perfil:p,paginas:{dashboard:true,relatorios:true,lancamentos:true,cartoes:true,categorias:true,configuracoes:p==='admin'},
  acoes:Object.assign({criarMovimento:true,excluirMovimento:true,financiamentos:true,lotes:true,usuarios:p==='admin',logs:p==='admin'},acoes)});
const lanc=(id,uid,esc,extra={})=>Object.assign({id,usuarioId:uid,descricao:'L'+id,valor:10,tipo:'saida',vencimento:'2026-10-20',escopo:esc,pago:false,status:'pendente'},extra);
let falhas=0;
function montar({par1=2,par2=1,perm1=perm('supervisor')}={}){
  planilhas.clear();cache.clear();props.set('REVISAO_DADOS','5');
  const u=(id,n,pm,par)=>({id,usuario:n,nome:n,pin:sha(n),rendaFixa:0,parceiroId:par,ativo:true,permissoes:pm,preferenciasNotificacao:{},fotoPerfil:'',trocaSenhaObrigatoria:false,configuracaoSalarial:{}});
  gs.escreverAba('usuarios',[u(1,'eu',perm1,par1),u(2,'parceiro',perm('supervisor'),par2),u(3,'estranho',perm('admin'),'')],gs.SCHEMA.usuarios);
  ['categorias','cartoes','financiamentos','bens','notificacoes','logs','exclusao_movimento','edicao_movimento','fatura_cartao'].forEach(n=>gs.escreverAba(n,[],gs.SCHEMA[n]));
  gs.escreverAba('lancamentos',[lanc(10,2,'individual'),lanc(11,2,'casal'),lanc(12,3,'casal'),lanc(13,1,'individual')],gs.SCHEMA.lancamentos);
  return gs.criarSessaoUsuario(gs.lerAba('usuarios')[0]);
}
function enviar(sess,mut){
  const d=JSON.parse(gs.doGet({parameter:{action:'obterDados',token:'k',sessao:sess}}).t);mut(d);
  return JSON.parse(gs.doPost({postData:{contents:JSON.stringify({action:'salvarDados',token:'k',sessao:sess,dados:d})}}).t);
}
function caso(nome,esperado,cfg,mut){
  const s=montar(cfg);const r=enviar(s,mut);const ok=(r.status==='sucesso')===esperado;
  if(!ok)falhas++;
  console.log((ok?'OK    ':'FALHA ')+nome.padEnd(70)+(esperado?'(deve passar)':'(deve bloquear)')+' -> '+r.status+(r.mensagem?' '+r.mensagem:''));
}
const achar=(d,id)=>d.lancamentos.find(l=>l.id===id);
console.log('== 1) Lançamentos pessoais pertencem só ao usuário autenticado');
caso('cria lançamento próprio individual',true,{},d=>d.lancamentos.push(lanc(20,1,'individual')));
caso('cria lançamento no nome do parceiro (casal)',false,{},d=>d.lancamentos.push(lanc(20,2,'casal')));
caso('cria lançamento no nome do parceiro (individual)',false,{},d=>d.lancamentos.push(lanc(20,2,'individual')));
caso('cria lançamento no nome de quem não é parceiro',false,{},d=>d.lancamentos.push(lanc(20,3,'casal')));
caso('toma para si lançamento individual do parceiro (troca usuarioId)',false,{},d=>{achar(d,10).usuarioId=1});
caso('transfere lançamento próprio ao parceiro (troca usuarioId)',false,{},d=>{achar(d,13).usuarioId=2;achar(d,13).escopo='casal'});
caso('edita lançamento individual do parceiro',false,{},d=>{achar(d,10).descricao='x'});
caso('exclui lançamento individual do parceiro',false,{},d=>{d.lancamentos=d.lancamentos.filter(l=>l.id!==10)});
console.log('== 2) Compartilhados respeitam vínculo e permissões');
caso('edita lançamento casal do parceiro (vínculo recíproco)',true,{},d=>{achar(d,11).descricao='x'});
caso('edita lançamento casal de quem não é parceiro',false,{},d=>{achar(d,12).descricao='x'});
caso('muda lançamento casal do parceiro para individual',false,{},d=>{achar(d,11).escopo='individual'});
caso('vínculo só de um lado: edita casal do "parceiro"',false,{par2:''},d=>{achar(d,11).descricao='x'});
caso('sem vínculo algum: edita casal do outro',false,{par1:'',par2:''},d=>{achar(d,11).descricao='x'});
caso('sem permissão criarMovimento: cria lançamento próprio',false,{perm1:perm('usuario',{criarMovimento:false})},d=>d.lancamentos.push(lanc(20,1,'casal')));
caso('sem excluirMovimento: exclui lançamento próprio',false,{perm1:perm('supervisor',{excluirMovimento:false})},d=>{d.lancamentos=d.lancamentos.filter(l=>l.id!==13)});
caso('lançamento casal próprio + notificação ao parceiro',true,{},d=>{d.lancamentos.push(lanc(21,1,'casal'));d.notificacoes.push({id:'n1',usuarioDestinoId:2,remetenteId:1,tipo:'lancamento_casal',titulo:'t',mensagem:'m',lida:false,statusAprovacao:'',createdAt:new Date().toISOString()})});
process.exit(falhas?1:0);
