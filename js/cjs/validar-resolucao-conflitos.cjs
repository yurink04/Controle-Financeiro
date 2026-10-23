/* Testes offline do conflito real (duas edições no mesmo campo), sem rede. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const fonte = fs.readFileSync(path.resolve(__dirname, '..', 'conexao_sheets.js'), 'utf8');
const ini = fonte.indexOf('function serializarEstavel(');
const fim = fonte.indexOf('function marcarConflitoSincronizacao(', ini);
const c = {
  COLECOES_DADOS: ['usuarios','categorias','cartoes','lancamentos','financiamentos','bens','notificacoes','logs','exclusao_movimento','edicao_movimento','fatura_cartao'],
  clonarDados: d => d === undefined ? undefined : JSON.parse(JSON.stringify(d))
};
vm.createContext(c);
vm.runInContext(fonte.slice(ini, fim), c);
const snapshot = () => ({...Object.fromEntries(c.COLECOES_DADOS.map(x => [x, []])),
  usuarios: [{id:1, nome:'Titular', ativo:true, permissoes:{perfil:'usuario'}},{id:2,nome:'Outro',ativo:true}],
  lancamentos:[{id:100, usuarioId:1, descricao:'Compra',valor:10,status:'pendente'}], _revision:5});
const base = snapshot(), local=snapshot(), remoto=snapshot();
local.lancamentos[0].valor=20;
remoto.lancamentos[0].valor=30;
remoto.lancamentos[0].status='pago';
remoto._revision=6;
let r=c.prepararReenvioSeguro(base,local,remoto,'1');
assert.equal(r.conflitos.length,1);
const campo = r.conflitos[0];
assert.match(campo,/^lancamentos\[id:100\]\.valor$/);
assert.equal(r.dados.lancamentos[0].status,'pago');
const escolhasLocal=Object.fromEntries([[campo,'local']]);
r=c.prepararReenvioSeguro(base,local,remoto,'1',escolhasLocal);
assert.equal(r.conflitos.length,0);
assert.equal(r.dados.lancamentos[0].valor,20);
assert.equal(r.dados.lancamentos[0].status,'pago');
assert.equal(r.dados._revision,6);
r=c.prepararReenvioSeguro(base,local,remoto,'1',Object.fromEntries([[campo,'remoto']]));
assert.equal(r.conflitos.length,0);
assert.equal(r.dados.lancamentos[0].valor,30);
assert.equal(r.dados.lancamentos[0].status,'pago');
r=c.prepararReenvioSeguro(base,local,remoto,'1',Object.fromEntries([[campo,'qualquer']]));
assert.equal(r.conflitos.length,1,'Opção inválida nunca permite envio');
// Edição em usuário alheio nunca pode ser usada para substituir perfil remoto.
const localUsuario=snapshot(), remotoUsuario=snapshot();
localUsuario.usuarios[1].nome='Tentativa local';
remotoUsuario.usuarios[1].nome='Perfil remoto';
remotoUsuario._revision=6;
r=c.prepararReenvioSeguro(base,localUsuario,remotoUsuario,'1');
assert.equal(r.dados.usuarios[1].nome,'Perfil remoto');
assert.equal(r.conflitos.length,0);
// Exclusão de registro x edição deve exigir escolha e não acontecer silenciosamente.
const localApagado=snapshot(), remotoEditado=snapshot();
localApagado.lancamentos=[];
remotoEditado.lancamentos[0].valor=77;
r=c.prepararReenvioSeguro(base,localApagado,remotoEditado,'1');
assert.equal(r.conflitos.length,1);
r=c.prepararReenvioSeguro(base,localApagado,remotoEditado,'1',Object.fromEntries([[r.conflitos[0],'remoto']]));
assert.equal(r.dados.lancamentos[0].valor,77);
const js=fs.readFileSync(path.resolve(__dirname, '..', 'script.js'),'utf8');
for(const m of ['revisarConflitosSincronizacao','resumirValorConflito','estadoMarcado','resVerificacao'])
 assert.ok(js.includes(m),'Fluxo de revisão ausente: '+m);
console.log('OK: escolhas explícitas, campos independentes, usuário protegido, exclusões e revisão remota.');
