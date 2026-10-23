/* Testes estáticos abrangentes da arquitetura modular. Sem acesso a rede real. */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const raiz=path.resolve(__dirname,'..','..');
const ler=nome=>fs.readFileSync(path.join(raiz,nome),'utf8');
const comuns=['js/script.js','js/calculos_trabalhistas.js','js/conexao_sheets.js'];
const htmls=fs.readdirSync(raiz).filter(n=>n.endsWith('.html')).sort();
assert.equal(htmls.length,17,'Devem existir 17 páginas HTML (incluindo rendimentos).');
const jsComum=comuns.map(ler).join('\n');
assert.doesNotThrow(()=>new vm.Script(jsComum), 'JavaScript compartilhado sem duplicações léxicas');
const css=ler('style.css');
assert.match(css,/account-hero/);assert.match(css,/login-story/);assert.match(css,/income-page/);
const gs=ler('Code.gs');
new vm.Script(gs);
const colFront=[...ler('js/conexao_sheets.js').match(/const COLECOES_DADOS = \[([^\]]+)\]/)[1].matchAll(/'([^']+)'/g)].map(m=>m[1]);
const ctx=vm.createContext({SpreadsheetApp:{getActiveSpreadsheet:()=>({})},PropertiesService:{getScriptProperties:()=>({getProperty:()=> 'valor-simulado'})}});vm.runInContext(gs,ctx);
const colBack=Object.keys(vm.runInContext('SCHEMA',ctx));
assert.deepEqual(colFront,colBack,'O banco do Sheets deve manter as coleções esperadas');
const acoes=['obterDados','registrarPrimeiroUsuario','revisao','salvarDados','statusCadastro','verificarAdmin','verificarCredenciaisLogin'];
acoes.forEach(acao=>assert.ok(gs.includes("'"+acao+"'"),'Ação não declarada: '+acao));
let checked=0;
for(const nome of htmls) {
 const pagina=nome.slice(0,-5), html=ler(nome);
 assert.match(html,/href="style.css"/,`${nome}: CSS`);
 assert.doesNotMatch(html,/<script\b(?![^>]*\bsrc\s*=)[^>]*>\s*\S/i,`${nome}: script inline`);
 const refs=[...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map(m=>m[1]).filter(n=>!/^https?:/.test(n));
 assert.deepEqual(refs,[...comuns,`js/page/${pagina}.js`],`${nome}: dependências JS`);
 for (const asset of refs) assert.ok(fs.existsSync(path.join(raiz,asset)),`${nome}: asset ${asset}`);
 new vm.Script(jsComum+'\n'+ler(`js/page/${pagina}.js`));
 const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
 assert.equal(new Set(ids).size,ids.length,`${nome}: IDs estáticos duplicados`);
 checked++;
}
assert.match(ler('js/page/rendimentos.js'),/function carregarHistoricoRendimentos\(/);
assert.match(ler('js/page/relatorios.js'),/function carregarRelatorioMensal\(/);
console.log('PASSOU:',checked,'páginas + 3 JS compartilhados + CSS + contratos Code.gs; 17 scripts de página analisados.');
