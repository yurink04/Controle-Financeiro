/* Integração simulada Code.gs: login -> obterDados -> salvarDados -> conflito.
 * Sem conexão com a planilha real ou necessidade de credenciais do usuário.
 */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const crypto=require('node:crypto');
const codigo=fs.readFileSync(path.resolve(__dirname,'..','..','Code.gs'),'utf8');
const tabs=new Map(),props=new Map([['SENHA_MESTRA_API','token-teste'],['SENHA_ADMIN','admin-teste'],['DADOS_REVISAO','0']]);
const cache=new Map();
class Sheet {
 constructor(n){this.nome=n;this.rows=[];}
 getLastRow(){return this.rows.reduce((m,r,i)=>r.some(x=>x!==null && x!==undefined && x!=='')?i+1:m,0);}
 getLastColumn(){return this.rows.reduce((m,r)=>Math.max(m,r.length),0);}
 getRange(r,c,rs=1,cs=1){
  const sh=this;
  return {
   getValues(){return Array.from({length:rs},(_,i)=>Array.from({length:cs},(_,j)=>sh.rows[r-1+i]?.[c-1+j]??''));},
   setValues(m){for(let i=0;i<m.length;i++){sh.rows[r-1+i]??=[];for(let j=0;j<m[i].length;j++)sh.rows[r-1+i][c-1+j]=m[i][j];}},
   setValue(v){this.setValues([[v]]);},
   clearContent(){for(let i=0;i<rs;i++)for(let j=0;j<cs;j++){sh.rows[r-1+i]??=[];sh.rows[r-1+i][c-1+j]='';}}
  };
 }
 setFrozenRows(){}
}
const workbook={getSheetByName:n=>tabs.get(n)||null,insertSheet:n=>{const x=new Sheet(n);tabs.set(n,x);return x;}};
let inc=1;
const app={
 console, SpreadsheetApp:{getActiveSpreadsheet:()=>workbook,flush(){}},
 PropertiesService:{getScriptProperties:()=>({getProperty:k=>props.get(k)||null,setProperty:(k,v)=>props.set(k,String(v))})},
 LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){},hasLock:()=>true})},
 CacheService:{getScriptCache:()=>({get:k=>cache.get(k)||null,put:(k,v)=>cache.set(k,String(v)),remove:k=>cache.delete(k)})},
 ContentService:{MimeType:{JSON:'json'},createTextOutput(v){return {value:v,setMimeType(){return this;}}}},
 Utilities:{getUuid:()=>`${String(inc++).padStart(8,'0')}-1111-2222-3333-abcdefabcdef`,
   DigestAlgorithm:{SHA_256:1},Charset:{UTF_8:1},computeDigest:(_,v)=>Array.from(crypto.createHash('sha256').update(String(v)).digest())},
 Session:{getScriptTimeZone:()=> 'America/Sao_Paulo'},
};
vm.createContext(app);vm.runInContext(codigo,app,{filename:'Code.gs'});
const hash=(s)=>crypto.createHash('sha256').update(s).digest('hex');
const perms={perfil:'supervisor',paginas:{dashboard:true,relatorios:true,lancamentos:true,cartoes:true,categorias:true,configuracoes:true},acoes:{criarMovimento:true,excluirMovimento:true,financiamentos:true,lotes:true,usuarios:false,logs:false}};
const adminPerms={...perms,perfil:'admin',acoes:{...perms.acoes,usuarios:true,logs:true}};
const accounts=[{id:1,usuario:'admin',nome:'Admin',pin:hash('Admin!123'),ativo:true,permissoes:adminPerms,configuracaoSalarial:{},preferenciasNotificacao:{}},
{id:2,usuario:'teste',nome:'Conta teste',pin:hash('Teste!123'),ativo:true,permissoes:perms,configuracaoSalarial:{},preferenciasNotificacao:{}}];
app.escreverAba('usuarios',accounts,app.SCHEMA.usuarios);
const post=(a,extra={})=>JSON.parse(app.doPost({postData:{contents:JSON.stringify({action:a,token:'token-teste',...extra})}}).value);
const login=post('verificarCredenciaisLogin',{usuario:'teste',senhaHash:hash('Teste!123')});
assert.equal(login.status,'sucesso',JSON.stringify(login));
assert.ok(login.sessao && login.sessao.length===64);
const resposta=post('obterDados',{sessao:login.sessao});
assert.equal(resposta._revision,0);
assert.equal(resposta.usuarios.length,2);
assert.ok(!resposta.usuarios.some(u=>Object.hasOwn(u,'pin')),'Hashes não podem ser retornados');
for(const key of Object.keys(app.SCHEMA))assert.ok(Array.isArray(resposta[key]),`coleção ${key}`);
const dados=JSON.parse(JSON.stringify(resposta));
dados.lancamentos.push({id:12001337,usuarioId:2,descricao:'Recebimento teste',valor:50,tipo:'entrada',pago:true,status:'pago',dataPagamento:'2026-10-23',vencimento:'2026-10-23'});
const salvo=post('salvarDados',{sessao:login.sessao,dados});
assert.equal(salvo.status,'sucesso',JSON.stringify(salvo));
assert.equal(salvo._revision,1);
const atualizado=post('obterDados',{sessao:login.sessao});
assert.equal(atualizado.lancamentos.length,1);
assert.equal(atualizado.lancamentos[0].valor,50);
assert.equal(atualizado.usuarios.length,2);
assert.ok(!atualizado.usuarios.some(u=>Object.hasOwn(u,'pin')));
const salvatentativa=post('salvarDados',{sessao:login.sessao,dados});
assert.equal(salvatentativa.status,'conflito');
assert.equal(salvatentativa._revision,1);
const revisao=post('revisao',{sessao:login.sessao});
assert.equal(revisao.status,'sucesso');assert.equal(revisao._revision,1);
console.log('PASSOU: Code.gs com Sheets e sessão simulados: login, leitura de 11 coleções, hashes protegidos, gravação própria, revisão e conflito de escrita obsoleta.');
