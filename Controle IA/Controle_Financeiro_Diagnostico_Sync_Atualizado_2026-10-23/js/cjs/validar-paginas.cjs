'use strict';
// Execute: node js/cjs/validar-paginas.cjs
// Teste estático sem dependências e sem qualquer acesso ao Google Sheets.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const raiz = path.resolve(__dirname, '../..');
const scriptsComuns = ['js/script.js', 'js/calculos_trabalhistas.js', 'js/conexao_sheets.js'];
let testes = 0;
let observacoes = 0;
const falhas = [];
const verificar = (descricao, cb) => {
  testes++;
  try { cb(); console.log('OK', descricao); }
  catch (err) { falhas.push(`${descricao}: ${err.message}`); console.error('FALHOU', descricao, err.message); }
};
const lista = fs.readdirSync(raiz).filter(nome => nome.endsWith('.html'));
const esperado = [...scriptsComuns];
const comuns = scriptsComuns.map(f => fs.readFileSync(path.join(raiz, f), 'utf8')).join('\n');
verificar('Arquivos compartilhados compilam em conjunto', () => new vm.Script(comuns));
for (const pagina of lista) {
  const doc = fs.readFileSync(path.join(raiz, pagina), 'utf8');
  const esperadoPagina = `js/page/${path.basename(pagina, '.html')}.js`;
  const caminhos = [...doc.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi)].map(m => m[1]);
  const locais = caminhos.filter(x => !/^https?:\/\//.test(x));
  verificar(`${pagina}: referências do núcleo na ordem correta`, () => {
    assert.deepEqual(locais.slice(0, 3), esperado);
    assert.equal(locais[3], esperadoPagina);
    assert.ok(!locais.includes('script.js'), 'Caminho antigo script.js encontrado');
  });
  verificar(`${pagina}: sem script inline e sem atributos on* estáticos`, () => {
    assert.ok(!/<script\b(?![^>]*\bsrc\s*=)[^>]*>\s*\S/gi.test(doc));
    assert.ok(!/\son(?:click|submit|change|input|load|error|blur|focus|keyup|keydown)\s*=/gi.test(doc));
  });
  for (const arquivo of locais) {
    if (!fs.existsSync(path.join(raiz, arquivo))) {
      if (arquivo === 'js/page/relatorios.js') {
        observacoes++;
        console.warn('PENDENTE: relatorios.js já existia no projeto, mas NÃO foi enviado; preserve sua versão atual.');
      } else falhas.push(`Falta ${arquivo} referenciado em ${pagina}`);
    }
  }
  const arquivoPagina = path.join(raiz, esperadoPagina);
  if (fs.existsSync(arquivoPagina)) {
    verificar(`${pagina}: JS da página e núcleo sem declarações globais conflitantes`, () => {
      new vm.Script(comuns + '\n' + fs.readFileSync(arquivoPagina, 'utf8'));
    });
  }
}
const gs=fs.readFileSync(path.join(raiz,'Code.gs'),'utf8');
verificar('Code.gs tem todas as ações consumidas pelo navegador', () => {
  for (const acao of ['obterDados','registrarPrimeiroUsuario','revisao','salvarDados','statusCadastro','verificarAdmin','verificarCredenciaisLogin']) {
    assert.ok(gs.includes(`'${acao}'`), `${acao} ausente`);
  }
});
console.log(`\n${testes - falhas.length}/${testes} checagens aprovadas; ${observacoes} pendência(s) informativa(s).`);
if (falhas.length) { console.error(falhas.join('\n')); process.exitCode = 1; }
