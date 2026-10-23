const fs=require('fs'),vm=require('vm');
function carregarFront(arquivo){
const noop=()=>{};
const el=new Proxy(function(){}, {get:(t,k)=>k===Symbol.toPrimitive?()=>'':(k==='style'||k==='classList'||k==='dataset')?new Proxy({}, {get:()=>noop,set:()=>true}):el, apply:()=>el, set:()=>true});
const ls=new Map();
const front={console,window:{addEventListener:noop,location:{pathname:'/x.html',href:''}},document:{addEventListener:noop,querySelector:()=>null,querySelectorAll:()=>[],getElementById:()=>null,createElement:()=>el,body:el,readyState:'complete'},
 localStorage:{getItem:k=>ls.has(k)?ls.get(k):null,setItem:(k,v)=>ls.set(k,String(v)),removeItem:k=>ls.delete(k)},navigator:{onLine:true},
 setTimeout:noop,setInterval:noop,clearTimeout:noop,fetch:noop,structuredClone,URL,Intl,Date,JSON,Math,Number,String,Array,Object,Set,Map};
front.window.document=front.document;front.globalThis=front;
vm.createContext(front);vm.runInContext(fs.readFileSync(arquivo,'utf8'),front);vm.runInContext(fs.readFileSync(require('path').join(require('path').dirname(arquivo),'conexao_sheets.js'),'utf8'),front);return front;}
const f=carregarFront(require('path').resolve(__dirname,'..','script.js'));
const cp=v=>JSON.parse(JSON.stringify(v));
const cols=['usuarios','categorias','cartoes','lancamentos','financiamentos','bens','notificacoes','logs','exclusao_movimento','edicao_movimento','fatura_cartao'];
const snap=l=>{const d=Object.fromEntries(cols.map(c=>[c,[]]));d.usuarios=[{id:1,usuario:'eu',nome:'Eu',ativo:true,permissoes:{perfil:'supervisor'}},{id:2,usuario:'p',nome:'P',ativo:true,permissoes:{perfil:'supervisor'}}];d.lancamentos=l;d._revision=5;return d;};
const L=(id,uid,desc,v)=>({id,usuarioId:uid,descricao:desc,valor:v,tipo:'saida',escopo:'casal'});
const base=snap([L(1,1,'antigo',10)]);
// A) dois aparelhos criam lançamento ao mesmo tempo, ambos com id=max+1=2
const idNovo=(d)=>f.proximoIdLancamento?f.proximoIdLancamento(d.lancamentos):d.lancamentos.reduce((m,l)=>Math.max(m,l.id||0),0)+1;
const meu=cp(base);meu.lancamentos.push(L(idNovo(meu),1,'MERCADO',50));
const dele=cp(base);dele.lancamentos.push(L(idNovo(dele),2,'GASOLINA',80));dele._revision=6;   // já sincronizado no servidor
const r=f.prepararReenvioSeguro(base,meu,dele,1);
const ls=r.dados.lancamentos;
console.log('A) dois aparelhos, mesmo instante');
console.log('   conflitos:',r.conflitos.length,'| lançamentos finais:',ls.map(l=>`${l.id}:${l.descricao}`).join(', '));
const perdeu=!ls.some(l=>l.descricao==='MERCADO')||!ls.some(l=>l.descricao==='GASOLINA');
const hibrido=ls.some(l=>l.id===idNovo(meu)&&(l.descricao==='MERCADO')!==(l.valor===50));
console.log('   perdeu algum?',perdeu,'| registro híbrido?',hibrido,'| sync travaria?',r.conflitos.length>0);
// B) servidor gravou mas a resposta se perdeu; o reenvio cai em 'conflito' com o mesmo conteúdo
const local=cp(base);local.lancamentos.push(L(idNovo(local),1,'MERCADO',50));
const remotoJaGravado=cp(local);remotoJaGravado._revision=6;
const r2=f.prepararReenvioSeguro(base,local,remotoJaGravado,1);
console.log('B) resposta perdida, reenvio  -> conflitos:',r2.conflitos.length,'| lançamentos:',r2.dados.lancamentos.length,'(esperado 2: sem duplicar)');
// C) ids gerados em sequência e por aparelhos diferentes
const ids=new Set();let colide=0;
for(let i=0;i<2000;i++){const a=idNovo(cp(base)),b=idNovo(cp(base));if(a===b)colide++;ids.add(a);}
console.log('C) 2000 pares de ids no mesmo estado: colisões =',colide,'| seguro p/ planilha?',[...ids].every(n=>Number.isSafeInteger(n)&&n<1e15));
