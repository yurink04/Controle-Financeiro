/* Executa SOMENTE testes locais, nunca diagnosticar-api --online. */
'use strict';
const {spawnSync}=require('node:child_process');
const path=require('node:path');
const testes=[
 'validar-paginas.cjs', 'validar-integracao.cjs', 'testes-modulos.cjs',
 'validar-code-gs.cjs','testar-fluxo-sheets.cjs', 'validar-acesso.cjs',
 'validar-ids-lancamento.cjs', 'validar-lancamentos-parceiro.cjs',
 'validar-rede.cjs','validar-reenvio.cjs','validar-relatorios.cjs',
 'validar-sincronizacao.cjs'
];
let falhas=0;
for(const arquivo of testes) {
 const p=spawnSync(process.execPath,[path.resolve(__dirname,arquivo)],
   {cwd:path.resolve(__dirname,'..','..'),encoding:'utf8',timeout:30000,maxBuffer:1024*1024*4});
 const passou=p.status===0 && !p.error;
 console.log(`${passou ? 'PASSOU' : 'FALHOU'}: ${arquivo}`);
 if(!passou){ falhas++; console.error((p.stderr||p.stdout||p.error?.message||'Sem saída').slice(-3000)); }
}
console.log(`\n${testes.length-falhas}/${testes.length} scripts de testes offline aprovados.`);
if(falhas) process.exitCode=1;
