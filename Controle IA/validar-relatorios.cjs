/* Testes de regressão do comparador e das análises — dados totalmente fictícios. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const elementos = new Map();
function el(id) {
    if (!elementos.has(id)) elementos.set(id, {
        value: '', textContent: '', innerHTML: '', hidden: false, className: '',
        href: '', addEventListener() {}, replaceChildren() {}, add() {}
    });
    return elementos.get(id);
}
const escaparHTML = v => String(v).replace(/[&<>"']/g, c =>
    ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[c]);
let modoPrivado = false;
const contexto = {
    document: {getElementById: el, addEventListener() {}},
    URLSearchParams, Intl, Date, Math, Number, String, Map, Set, Array,
    console,
    privacidadeAtiva: () => modoPrivado,
    escaparHTML,
    normalizarTexto: v => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(),
    formatarMoeda: n => modoPrivado ? 'R$ •••,••' : 'R$ ' + Number(n).toFixed(2),
    dataLocalYYYYMMDD: () => '2026-10-20',
    filtrarDadosPorPermissao: (arr, dados, escopo) => arr.filter(l =>
        escopo === 'casal' || String(l.usuarioId) === '1')
};
vm.createContext(contexto);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'relatorios-page.js'), 'utf8'), contexto);
const executar = codigo => vm.runInContext(codigo, contexto);

const lancamentos = [
    {id: 1, usuarioId: 1, vencimento: '2026-09-04', categoriaId: 'uber', tipo: 'entrada', valor: 3000, pago: true},
    {id: 2, usuarioId: 1, vencimento: '2026-09-05', categoriaId: 'transporte', tipo: 'saida', valor: 600, pago: true},
    {id: 3, usuarioId: 1, vencimento: '2026-10-03', categoriaId: 'uber', tipo: 'entrada', valor: 1800, pago: true},
    {id: 4, usuarioId: 1, vencimento: '2026-10-06', categoriaId: 'uber', tipo: 'entrada', valor: 1000, pago: false},
    {id: 5, usuarioId: 1, vencimento: '2026-10-10', categoriaId: 'transporte', tipo: 'saida', valor: 400, pago: true},
    {id: 6, usuarioId: 1, vencimento: '2026-10-13', categoriaId: 'transporte', tipo: 'saida', valor: 120, pago: false},
    {id: 7, usuarioId: 1, vencimento: '2026-10-16', categoriaId: 'alimentacao', tipo: 'saida', valor: 300, pago: true, servicoEssencial: 'sim'},
    {id: 8, usuarioId: 2, vencimento: '2026-10-16', categoriaId: 'uber', tipo: 'entrada', valor: 800, pago: true},
    {id: 9, usuarioId: 1, vencimento: '2026-10-18', categoriaId: 'alimentacao', tipo: 'saida', valor: 20, pago: true,
        descricao: '<img src=x onerror=alert(1)>'}
];
const categorias = [
    {id: 'uber', nome: 'Ganhos Uber', tipo: 'entrada'},
    {id: 'transporte', nome: 'Transporte', tipo: 'saida'},
    {id: 'alimentacao', nome: 'Alimentação', tipo: 'saida'}
];
el('filtroMesRelatorio').value = '2026-10';
el('rptEscopo').value = 'individual';
el('rptSituacao').value = 'realizados';
el('rptJanelaComparacao').value = '2';
el('rptCategoriaEntrada').value = 'uber';
el('rptCategoriaSaida').value = 'transporte';
contexto.movimentosTeste = lancamentos;
contexto.categoriasTeste = categorias;
executar('rptEstado.dados = {categorias: categoriasTeste, lancamentos: movimentosTeste}; ' +
    'rptEstado.categorias = new Map(categoriasTeste.map(c => [String(c.id), c])); ' +
    'rptEstado.movimentos = filtrarDadosPorPermissao(movimentosTeste, {}, "individual")');

const comparacaoRealizada = executar('rptDadosComparacao("2026-10", 2, "uber", "transporte")');
assert.equal(comparacaoRealizada.entradas, 4800);
assert.equal(comparacaoRealizada.saidas, 1000);
assert.equal(comparacaoRealizada.entradasQtd, 2);
assert.equal(comparacaoRealizada.saidasQtd, 2);
assert.equal(comparacaoRealizada.linhas.length, 2);
assert.equal(comparacaoRealizada.linhas[0].mes, '2026-09');
assert.equal(comparacaoRealizada.linhas[1].mes, '2026-10');
assert.equal(executar('rptMesDeslocado("2026-01", -1)'), '2025-12');

const resumo = executar('rptResumo(rptMesMovimentos("2026-10"))');
assert.equal(resumo.entradas, 1800, 'Pendente excluído das receitas realizadas');
assert.equal(resumo.saidas, 720, 'Despesas realizadas somadas');
assert.equal(resumo.essenciais, 300, 'Despesas essenciais consideradas');
assert.equal(resumo.saldo, 1080);
el('rptSituacao').value = 'todos';
const comparacaoPrevista = executar('rptDadosComparacao("2026-10", 2, "uber", "transporte")');
assert.equal(comparacaoPrevista.entradas, 5800);
assert.equal(comparacaoPrevista.saidas, 1120);
el('rptSituacao').value = 'realizados';
assert.equal(executar('rptCategoriaPreferida("entrada", categoriasTeste.filter(c => c.tipo === "entrada"))'), 'uber');
assert.equal(executar('rptCategoriaPreferida("saida", categoriasTeste.filter(c => c.tipo === "saida"))'), 'transporte');

executar('rptRenderizarComparador()');
assert.match(el('rptResultadoComparacao').textContent, /3800/);
assert.match(el('rptGraficoCategorias').innerHTML, /categoriaId=uber/);
assert.match(el('rptGraficoCategorias').innerHTML, /mes=2026-09/);
assert.match(el('rptConclusaoComparacao').textContent, /Outros custos/);

modoPrivado = true;
executar('rptRenderizarComparador()');
assert.equal(el('rptValorEntrada').textContent, 'R$ •••,••');
assert.match(el('rptGraficoCategorias').innerHTML, /modo discreto/);
modoPrivado = false;

executar('rptRenderizarAuditoria("2026-10", rptMesMovimentos("2026-10"))');
assert.doesNotMatch(el('rptTabelaAuditoria').innerHTML, /<img/);
assert.match(el('rptTabelaAuditoria').innerHTML, /&lt;img/);

const url = executar('rptLinkGrafico("categoria", {categoriaId: "uber", mes: "2026-10"})');
assert.match(url, /categoriaId=uber/);
assert.match(url, /escopo=individual/);
assert.match(executar('rptLinkPagamentos("2026-10")'), /visao=competencia&mes=2026-10/);
console.log('OK: comparação Uber × Transporte, pagamentos pendentes, competência, privacidade, URLs e HTML seguro.');
