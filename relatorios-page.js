// Relatórios: análise de competência e comparação de categorias.
// Usa apenas o armazenamento já carregado pelo script.js; não grava na planilha.
const rptEstado = {
    dados: null,
    movimentos: [],
    categorias: new Map(),
    prefKey: '',
    carregado: false
};

const rptEl = id => document.getElementById(id);
const rptValor = item => Math.max(0, Number.isFinite(Number(item?.valor)) ? Number(item.valor) : 0);
const rptConcluido = item => item?.pago === true || item?.status === 'pago';
const rptMesItem = item => String(item?.vencimento || item?.data || item?.dataCompra || item?.createdAt || '').slice(0, 7);
const rptMesValido = mes => /^\d{4}-(0[1-9]|1[0-2])$/.test(mes || '');
const rptTexto = valor => escaparHTML(valor == null ? '' : String(valor));
const rptMoeda = valor => formatarMoeda(valor);
const rptPorcentagem = (n, casas = 1) => privacidadeAtiva() ? '••%' : Number(n).toFixed(casas).replace('.', ',') + '%';

function rptMesDeslocado(mes, deslocamento) {
    const [ano, numero] = mes.split('-').map(Number);
    const data = new Date(ano, numero - 1 + deslocamento, 1);
    return data.getFullYear() + '-' + String(data.getMonth() + 1).padStart(2, '0');
}

function rptNomeMes(mes, abreviado = false) {
    if (!rptMesValido(mes)) return mes || '';
    const [ano, numero] = mes.split('-').map(Number);
    return new Intl.DateTimeFormat('pt-BR', {month: abreviado ? 'short' : 'long', year: 'numeric'})
        .format(new Date(ano, numero - 1, 1));
}

function rptFiltroAtual() {
    return {
        mes: rptEl('filtroMesRelatorio')?.value || '',
        escopo: rptEl('rptEscopo')?.value || 'individual',
        situacao: rptEl('rptSituacao')?.value || 'realizados'
    };
}

function rptMesMovimentos(mes, situacao = rptFiltroAtual().situacao) {
    return rptEstado.movimentos.filter(item => rptMesItem(item) === mes &&
        (situacao === 'todos' || rptConcluido(item)));
}

function rptResumo(movimentos) {
    const resumo = {entradas: 0, saidas: 0, essenciais: 0, entradasQtd: 0, saidasQtd: 0, saldo: 0};
    for (const item of movimentos) {
        const valor = rptValor(item);
        if (item.tipo === 'entrada') {
            resumo.entradas += valor;
            resumo.entradasQtd++;
        } else if (item.tipo === 'saida') {
            resumo.saidas += valor;
            resumo.saidasQtd++;
            if (item.servicoEssencial === 'sim') resumo.essenciais += valor;
        }
    }
    resumo.saldo = resumo.entradas - resumo.saidas;
    return resumo;
}

function rptLinkGrafico(tipo, extras = {}) {
    const filtros = rptFiltroAtual();
    const params = new URLSearchParams({tipo, escopo: filtros.escopo, ...extras});
    return 'grafico.html?' + params.toString();
}

function rptLinkPagamentos(mes = rptFiltroAtual().mes) {
    return 'central-pagamentos.html?' + new URLSearchParams({visao: 'competencia', mes}).toString();
}

function rptNomeCategoria(id) {
    return rptEstado.categorias.get(String(id))?.nome || 'Sem categoria';
}

function rptGuardarPreferencias() {
    if (!rptEstado.prefKey) return;
    const preferencias = {
        escopo: rptEl('rptEscopo')?.value,
        situacao: rptEl('rptSituacao')?.value,
        janela: rptEl('rptJanelaComparacao')?.value,
        entrada: rptEl('rptCategoriaEntrada')?.value,
        saida: rptEl('rptCategoriaSaida')?.value
    };
    try { localStorage.setItem(rptEstado.prefKey, JSON.stringify(preferencias)); } catch (_) {}
}

function rptLerPreferencias() {
    try { return JSON.parse(localStorage.getItem(rptEstado.prefKey) || '{}') || {}; }
    catch (_) { return {}; }
}

function rptCategoriaPreferida(tipo, opcoes) {
    const padrao = tipo === 'entrada' ? /\buber\b/ : /^(transporte|combustivel|abastecimento)\b/;
    const encontrada = opcoes.find(cat => padrao.test(normalizarTexto(cat.nome)));
    if (encontrada) return String(encontrada.id);
    const somas = new Map();
    rptEstado.movimentos.filter(l => l.tipo === tipo).forEach(l => {
        const id = String(l.categoriaId);
        somas.set(id, (somas.get(id) || 0) + rptValor(l));
    });
    const ordenadas = [...opcoes].sort((a, b) => (somas.get(String(b.id)) || 0) -
        (somas.get(String(a.id)) || 0));
    return ordenadas.length ? String(ordenadas[0].id) : '';
}

function rptPopularCategorias() {
    const entradas = rptEl('rptCategoriaEntrada');
    const saidas = rptEl('rptCategoriaSaida');
    const preferencias = rptLerPreferencias();
    for (const [tipo, select, preferida] of [
        ['entrada', entradas, preferencias.entrada],
        ['saida', saidas, preferencias.saida]
    ]) {
        if (!select) continue;
        const anterior = select.value;
        const movimentadas = new Set(rptEstado.movimentos.filter(l => l.tipo === tipo)
            .map(l => String(l.categoriaId)));
        const opcoes = [...rptEstado.categorias.values()].filter(c => c.tipo === tipo ||
            movimentadas.has(String(c.id))).sort((a, b) =>
            String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR'));
        select.replaceChildren(new Option(tipo === 'entrada' ? 'Escolha uma receita' : 'Escolha um custo', ''));
        opcoes.forEach(cat => select.add(new Option(String(cat.nome || 'Sem nome'), String(cat.id))));
        const ids = new Set(opcoes.map(cat => String(cat.id)));
        const desejado = [anterior, preferida].find(id => id && ids.has(String(id))) ||
            rptCategoriaPreferida(tipo, opcoes);
        select.value = desejado || '';
    }
}

function rptAtualizarIndicadores(mes, resumo, movimentos) {
    const totalMovs = movimentos.length;
    rptEl('rptTituloMes').textContent = rptNomeMes(mes).replace(/^./, c => c.toUpperCase());
    const realizado = rptFiltroAtual().situacao === 'realizados';
    const identificacao = realizado ? 'concluídos' : 'programados e concluídos';
    rptEl('rptResumoTexto').textContent = totalMovs
        ? totalMovs + (totalMovs === 1 ? ' lançamento ' : ' lançamentos ') + identificacao +
          '. Use a comparação abaixo para entender o que está por trás do resultado.'
        : 'Ainda não há movimentações com esses filtros neste mês. Você pode mudar o período ou incluir um lançamento.';
    rptEl('relTotalEntradas').textContent = rptMoeda(resumo.entradas);
    rptEl('relTotalSaidas').textContent = rptMoeda(resumo.saidas);
    rptEl('relSaldo').textContent = rptMoeda(resumo.saldo);
    rptEl('relSaldo').className = 'rpt-kpi-value ' + (resumo.saldo >= 0 ? 'rpt-positive' : 'rpt-negative');
    rptEl('rptEntradasDetalhe').textContent = resumo.entradasQtd + ' ' +
        (resumo.entradasQtd === 1 ? 'recebimento' : 'recebimentos') + ' considerados';
    rptEl('rptSaidasDetalhe').textContent = resumo.saidasQtd + ' ' +
        (resumo.saidasQtd === 1 ? 'despesa' : 'despesas') + ' consideradas';
    rptEl('rptSaldoDetalhe').textContent = resumo.saldo >= 0
        ? 'Entradas acima das saídas' : 'Saídas acima das entradas';
    rptEl('relComprometimento').textContent = resumo.entradas
        ? rptPorcentagem(resumo.essenciais / resumo.entradas * 100) : '—';

    const pendentes = rptMesMovimentos(mes, 'todos').filter(l => l.tipo === 'saida' && !rptConcluido(l));
    const link = rptEl('rptPendenciasLink');
    link.href = rptLinkPagamentos(mes);
    link.textContent = pendentes.length
        ? pendentes.length + (pendentes.length === 1 ? ' despesa pendente ↗' : ' despesas pendentes ↗')
        : 'Consultar pagamentos ↗';
}

function rptRenderizarMudancas(mes, atual) {
    const mesAnterior = rptMesDeslocado(mes, -1);
    const anterior = rptResumo(rptMesMovimentos(mesAnterior));
    rptEl('rptComparativoSubtitulo').textContent = 'Em relação a ' + rptNomeMes(mesAnterior) + ', com o mesmo escopo e situação.';
    const indicadores = [
        {nome: 'Entradas', a: atual.entradas, b: anterior.entradas, melhora: 1},
        {nome: 'Saídas', a: atual.saidas, b: anterior.saidas, melhora: -1},
        {nome: 'Resultado', a: atual.saldo, b: anterior.saldo, melhora: 1},
        {nome: 'Despesas essenciais', a: atual.essenciais, b: anterior.essenciais, melhora: -1}
    ];
    rptEl('containerComparativo').innerHTML = indicadores.map(item => {
        const diferenca = item.a - item.b;
        const crescente = diferenca > .005;
        const igual = Math.abs(diferenca) < .005;
        const sinal = crescente ? '+' : '−';
        const tendencia = igual ? 'neutro' :
            (crescente ? item.melhora > 0 : item.melhora < 0) ? 'positivo' : 'negativo';
        let detalhe = igual ? 'Sem variação' : sinal + rptMoeda(Math.abs(diferenca));
        if (item.b > 0 && item.nome !== 'Resultado' && !igual) {
            detalhe += ' (' + rptPorcentagem(Math.abs(diferenca / item.b * 100), 0) + ')';
        }
        if (!item.b && item.a > 0 && item.nome !== 'Resultado') detalhe = 'Sem base no mês anterior';
        return `<div class="rpt-delta-item">
            <div><strong>${rptTexto(item.nome)}</strong><small>Antes: ${rptMoeda(item.b)}</small></div>
            <div class="rpt-delta-values"><strong>${rptMoeda(item.a)}</strong>
                <span class="rpt-delta-${tendencia}">${rptTexto(detalhe)}</span></div>
        </div>`;
    }).join('');
}

function rptRenderizarCategorias(mes, movimentos, resumo) {
    const somas = new Map();
    for (const item of movimentos) {
        if (item.tipo !== 'saida') continue;
        const chave = String(item.categoriaId || '');
        somas.set(chave, (somas.get(chave) || 0) + rptValor(item));
    }
    const ranking = [...somas].map(([id, valor]) => ({id, valor, nome: rptNomeCategoria(id)}))
        .sort((a, b) => b.valor - a.valor).slice(0, 5);
    const cont = rptEl('containerTopCategorias');
    if (!ranking.length) {
        cont.innerHTML = '<p class="rpt-empty">Nenhuma saída encontrada com os filtros atuais.</p>';
        return ranking;
    }
    if (privacidadeAtiva()) {
        cont.innerHTML = '<p class="rpt-empty">Categorias e distribuição ocultas pelo modo discreto. Revele os valores para analisar os gastos.</p>';
        return ranking;
    }
    cont.innerHTML = ranking.map((item, indice) => {
        const parcela = resumo.saidas ? item.valor / resumo.saidas * 100 : 0;
        const href = item.id ? rptLinkGrafico('categoria', {categoriaId: item.id, mes})
            : rptLinkGrafico('saidas', {mes});
        return `<a class="rpt-category-row" href="${rptTexto(href)}"
            aria-label="Conferir lançamentos da categoria ${rptTexto(item.nome)}">
            <span class="rpt-rank">${indice + 1}</span>
            <span class="rpt-category-main"><strong>${rptTexto(item.nome)}</strong>
                <span class="rpt-category-track"><span style="width:${Math.min(100, parcela).toFixed(2)}%"></span></span>
            </span>
            <span class="rpt-category-numbers"><strong>${rptMoeda(item.valor)}</strong>
                <small>${rptPorcentagem(parcela)} das saídas</small></span>
            <span class="rpt-open" aria-hidden="true">↗</span>
        </a>`;
    }).join('');
    return ranking;
}

function rptDadosComparacao(mes, janela, entradaId, saidaId) {
    const meses = Array.from({length: janela}, (_, indice) =>
        rptMesDeslocado(mes, indice - janela + 1));
    const linhas = meses.map(chave => {
        const movimentos = rptMesMovimentos(chave);
        const daEntrada = movimentos.filter(l => l.tipo === 'entrada' &&
            String(l.categoriaId) === String(entradaId));
        const daSaida = movimentos.filter(l => l.tipo === 'saida' &&
            String(l.categoriaId) === String(saidaId));
        return {
            mes: chave,
            entrada: daEntrada.reduce((acc, l) => acc + rptValor(l), 0),
            saida: daSaida.reduce((acc, l) => acc + rptValor(l), 0),
            entradasQtd: daEntrada.length,
            saidasQtd: daSaida.length
        };
    });
    return {
        linhas,
        entradas: linhas.reduce((s, l) => s + l.entrada, 0),
        saidas: linhas.reduce((s, l) => s + l.saida, 0),
        entradasQtd: linhas.reduce((s, l) => s + l.entradasQtd, 0),
        saidasQtd: linhas.reduce((s, l) => s + l.saidasQtd, 0)
    };
}

function rptRenderizarComparador() {
    const {mes, escopo} = rptFiltroAtual();
    const entradaId = rptEl('rptCategoriaEntrada')?.value || '';
    const saidaId = rptEl('rptCategoriaSaida')?.value || '';
    const janela = Number(rptEl('rptJanelaComparacao')?.value || 6);
    const completo = Boolean(entradaId && saidaId);
    rptEl('rptComparadorVazio').hidden = completo;
    rptEl('rptComparadorConteudo').hidden = !completo;
    if (!completo || !rptMesValido(mes)) return;

    const dados = rptDadosComparacao(mes, janela, entradaId, saidaId);
    const resultado = dados.entradas - dados.saidas;
    const custoPct = dados.entradas ? dados.saidas / dados.entradas * 100 : null;
    const nomeEntrada = rptNomeCategoria(entradaId);
    const nomeSaida = rptNomeCategoria(saidaId);
    rptEl('rptNomeEntrada').textContent = nomeEntrada;
    rptEl('rptNomeSaida').textContent = nomeSaida;
    rptEl('rptValorEntrada').textContent = rptMoeda(dados.entradas);
    rptEl('rptValorSaida').textContent = rptMoeda(dados.saidas);
    rptEl('rptQtdEntradas').textContent = dados.entradasQtd + ' recebimentos';
    rptEl('rptQtdSaidas').textContent = dados.saidasQtd + ' despesas';
    rptEl('rptResultadoComparacao').textContent = rptMoeda(resultado);
    rptEl('rptResultadoComparacao').className = resultado >= 0 ? 'rpt-positive' : 'rpt-negative';
    rptEl('rptResultadoPercentual').textContent = custoPct == null
        ? 'Sem entrada para calcular a proporção'
        : rptPorcentagem(custoPct) + ' da receita destinada a este custo';
    rptEl('rptPeriodoGrafico').textContent = janela === 1
        ? rptNomeMes(mes) : 'De ' + rptNomeMes(dados.linhas[0].mes) + ' a ' + rptNomeMes(mes);

    const grafico = rptEl('rptGraficoCategorias');
    if (privacidadeAtiva()) {
        grafico.innerHTML = '<div class="rpt-chart-private">Distribuição visual oculta pelo modo discreto.</div>';
    } else {
        const maior = Math.max(1, ...dados.linhas.flatMap(l => [l.entrada, l.saida]));
        grafico.innerHTML = `<div class="rpt-chart" role="group" aria-label="Gráfico de receita e custo por mês">
            ${dados.linhas.map(l => {
                const alturaEntrada = l.entrada ? Math.max(2, l.entrada / maior * 100) : 0;
                const alturaSaida = l.saida ? Math.max(2, l.saida / maior * 100) : 0;
                const hrefEntrada = rptLinkGrafico('categoria', {categoriaId: entradaId, mes: l.mes});
                const hrefSaida = rptLinkGrafico('categoria', {categoriaId: saidaId, mes: l.mes});
                return `<div class="rpt-chart-month">
                    <div class="rpt-chart-bars">
                        <a class="rpt-bar rpt-bar-income" href="${rptTexto(hrefEntrada)}"
                            style="height:${alturaEntrada.toFixed(2)}%"
                            title="${rptTexto(nomeEntrada)} · ${rptNomeMes(l.mes)}: ${rptMoeda(l.entrada)}"
                            aria-label="${rptTexto(nomeEntrada)}, ${rptNomeMes(l.mes)}: ${rptMoeda(l.entrada)}. Abrir lançamentos."></a>
                        <a class="rpt-bar rpt-bar-expense" href="${rptTexto(hrefSaida)}"
                            style="height:${alturaSaida.toFixed(2)}%"
                            title="${rptTexto(nomeSaida)} · ${rptNomeMes(l.mes)}: ${rptMoeda(l.saida)}"
                            aria-label="${rptTexto(nomeSaida)}, ${rptNomeMes(l.mes)}: ${rptMoeda(l.saida)}. Abrir lançamentos."></a>
                    </div>
                    <span>${rptTexto(rptNomeMes(l.mes, true).replace('.', ''))}</span>
                </div>`;
            }).join('')}
        </div>`;
    }

    let conclusao;
    if (privacidadeAtiva()) {
        conclusao = 'A interpretação dos valores fica oculta no modo discreto.';
    } else if (!dados.entradas && !dados.saidas) {
        conclusao = 'Não houve lançamentos nessas duas categorias no período. Experimente outra janela ou inclua novos registros.';
    } else if (!dados.entradas) {
        conclusao = 'Há saídas nesta categoria, mas nenhuma entrada na categoria comparada. Não é possível calcular a proporção de custo.';
    } else if (resultado < 0) {
        conclusao = 'O custo selecionado superou a receita comparada em ' + rptMoeda(Math.abs(resultado)) +
            '. Revise os lançamentos antes de tirar conclusões sobre a atividade.';
    } else {
        conclusao = 'Depois desse custo específico, restaram ' + rptMoeda(resultado) +
            ' da receita selecionada (' + rptPorcentagem(100 - custoPct) + '). Outros custos não entram nesta conta.';
    }
    rptEl('rptConclusaoComparacao').textContent = conclusao;
    const urlEntrada = rptLinkGrafico('categoria', {categoriaId: entradaId, mes});
    const urlSaida = rptLinkGrafico('categoria', {categoriaId: saidaId, mes});
    rptEl('rptLinksComparacao').innerHTML =
        `<a href="${rptTexto(urlEntrada)}">Examinar ${rptTexto(nomeEntrada)} neste mês ↗</a>
          <a href="${rptTexto(urlSaida)}">Examinar ${rptTexto(nomeSaida)} neste mês ↗</a>`;
}

function rptRenderizarInsights(mes, resumo, anterior, ranking) {
    const insights = [];
    const todas = rptMesMovimentos(mes, 'todos');
    const hoje = dataLocalYYYYMMDD();
    const atrasadas = todas.filter(l => l.tipo === 'saida' && !rptConcluido(l) &&
        String(l.vencimento || '') < hoje);
    const linkCentral = rptLinkPagamentos(mes);
    if (atrasadas.length) {
        insights.push({
            tipo: 'urgent', titulo: atrasadas.length === 1 ? 'Uma despesa vencida' :
                atrasadas.length + ' despesas vencidas',
            descricao: 'Confira os pagamentos em aberto do mês para identificar o que precisa ser resolvido.',
            acao: 'Ver pagamentos', href: linkCentral
        });
    }
    if (resumo.saldo < 0) {
        insights.push({
            tipo: 'urgent', titulo: 'Saídas acima das entradas',
            descricao: 'O resultado ficou negativo neste recorte. Investigue os lançamentos de saída antes de ajustar o orçamento.',
            acao: 'Investigar saídas', href: rptLinkGrafico('saidas', {mes})
        });
    }
    if (anterior.saidas > 0 && resumo.saidas > anterior.saidas * 1.15) {
        const cres = (resumo.saidas / anterior.saidas - 1) * 100;
        insights.push({
            tipo: 'review', titulo: 'Despesas cresceram em relação ao mês anterior',
            descricao: 'As saídas aumentaram ' + rptPorcentagem(cres, 0) + '. Veja quais categorias contribuíram para a mudança.',
            acao: 'Examinar categorias', href: '#rptDespesas'
        });
    }
    if (!privacidadeAtiva() && ranking.length && resumo.saidas > 0 &&
        ranking[0].valor / resumo.saidas >= .35) {
        insights.push({
            tipo: 'review', titulo: 'Uma categoria concentra boa parte dos gastos',
            descricao: rptTexto(ranking[0].nome) + ' representa ' +
                rptPorcentagem(ranking[0].valor / resumo.saidas * 100, 0) + ' das saídas deste recorte.',
            acao: 'Abrir categoria',
            href: ranking[0].id
                ? rptLinkGrafico('categoria', {categoriaId: ranking[0].id, mes})
                : rptLinkGrafico('saidas', {mes})
        });
    }
    if (!insights.length) {
        insights.push({
            tipo: 'neutral',
            titulo: !resumo.entradasQtd && !resumo.saidasQtd
                ? 'Ainda não há movimentações neste recorte'
                : 'Sem alertas relevantes neste recorte',
            descricao: !resumo.entradasQtd && !resumo.saidasQtd
                ? 'Escolha outro mês, inclua lançamentos ou considere também os valores pendentes para encontrar informações.'
                : 'Não houve atrasos, saldo negativo ou grandes variações segundo os critérios monitorados. Compare categorias para uma análise mais específica.',
            acao: !resumo.entradasQtd && !resumo.saidasQtd
                ? 'Consultar lançamentos' : 'Usar comparador',
            href: !resumo.entradasQtd && !resumo.saidasQtd
                ? rptLinkGrafico('todos', {mes}) : '#comparadorCategorias'
        });
    }
    rptEl('containerInsights').innerHTML = insights.slice(0, 3).map(i => `
        <article class="rpt-insight rpt-insight-${i.tipo}">
            <div><h3>${rptTexto(i.titulo)}</h3><p>${i.descricao}</p>
                <a href="${rptTexto(i.href)}">${rptTexto(i.acao)} <span aria-hidden="true">↗</span></a></div>
        </article>`).join('');
}

function rptRenderizarAuditoria(mes, movimentos) {
    const tbody = rptEl('rptTabelaAuditoria');
    if (!tbody) return;
    const urlCompleta = rptLinkGrafico('todos', {mes});
    rptEl('rptAuditoriaCompleta').href = urlCompleta;
    if (privacidadeAtiva()) {
        tbody.innerHTML = '<tr><td colspan="6" class="rpt-table-message">Lançamentos ocultos pelo modo discreto.</td></tr>';
        rptEl('rptAuditoriaLegenda').textContent = 'Revele os valores para consultar a amostra.';
        return;
    }
    const ordenados = [...movimentos].sort((a, b) =>
        String(b.vencimento || b.dataCompra || '').localeCompare(String(a.vencimento || a.dataCompra || '')));
    if (!ordenados.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="rpt-table-message">Nenhuma movimentação encontrada.</td></tr>';
        rptEl('rptAuditoriaLegenda').textContent = 'Sem registros com os filtros escolhidos.';
        return;
    }
    tbody.innerHTML = ordenados.slice(0, 20).map(item => {
        const valor = (item.tipo === 'saida' ? '− ' : '+ ') + rptMoeda(rptValor(item));
        const editar = 'editar-lancamento.html?id=' + encodeURIComponent(String(item.id));
        const dia = String(item.vencimento || '').split('-').reverse().join('/');
        return `<tr>
            <td>${rptTexto(dia || '—')}</td>
            <td>${rptTexto(item.descricao || 'Sem descrição')}</td>
            <td>${rptTexto(rptNomeCategoria(item.categoriaId))}</td>
            <td>${rptConcluido(item) ? 'Concluído' : 'Pendente'}</td>
            <td class="${item.tipo === 'entrada' ? 'rpt-positive' : 'rpt-negative'}">${rptTexto(valor)}</td>
            <td><a href="${rptTexto(editar)}" class="rpt-text-link">Abrir ↗</a></td>
        </tr>`;
    }).join('');
    rptEl('rptAuditoriaLegenda').textContent = 'Exibindo ' +
        Math.min(20, ordenados.length) + ' de ' + ordenados.length +
        ' movimentações. O histórico completo está na página de gráficos.';
}

function carregarRelatorioMensal() {
    const filtros = rptFiltroAtual();
    if (!rptMesValido(filtros.mes)) return;
    try {
        rptEstado.dados = obterDados();
        rptEstado.categorias = new Map((rptEstado.dados.categorias || [])
            .map(c => [String(c.id), c]));
        rptEstado.movimentos = filtrarDadosPorPermissao(
            rptEstado.dados.lancamentos || [], rptEstado.dados, filtros.escopo)
            .filter(l => l.tipo === 'entrada' || l.tipo === 'saida');
        rptPopularCategorias();
        const movimentos = rptMesMovimentos(filtros.mes);
        const resumo = rptResumo(movimentos);
        const anterior = rptResumo(rptMesMovimentos(rptMesDeslocado(filtros.mes, -1)));
        const ranking = rptRenderizarCategorias(filtros.mes, movimentos, resumo);
        rptAtualizarIndicadores(filtros.mes, resumo, movimentos);
        rptRenderizarComparador();
        rptRenderizarMudancas(filtros.mes, resumo);
        rptRenderizarInsights(filtros.mes, resumo, anterior, ranking);
        rptRenderizarAuditoria(filtros.mes, movimentos);
        rptEl('rptVerTodasSaidas').href = rptLinkGrafico('saidas', {mes: filtros.mes});
        rptEl('rptExplorarGrafico').href = rptLinkGrafico('todos', {mes: filtros.mes});
        rptEl('rptDestinoGrafico').href = rptLinkGrafico('todos', {mes: filtros.mes});
        rptEl('rptDestinoPagamentos').href = rptLinkPagamentos(filtros.mes);
        rptGuardarPreferencias();
    } catch (erro) {
        console.error('Não foi possível atualizar o relatório:', erro);
        rptEl('rptFeedback').textContent = 'Não foi possível atualizar os indicadores. Verifique a conexão e tente novamente.';
    }
}

function rptExportarCSV() {
    if (privacidadeAtiva()) {
        rptEl('rptFeedback').textContent = 'Revele os valores no modo discreto para exportar os lançamentos.';
        return;
    }
    const {mes} = rptFiltroAtual();
    const itens = rptMesMovimentos(mes);
    if (!itens.length) {
        rptEl('rptFeedback').textContent = 'Não há lançamentos nesse período para exportar.';
        return;
    }
    const seguro = valor => {
        let t = String(valor == null ? '' : valor).replace(/\r?\n/g, ' ');
        if (/^[\s\u0000-\u001f]*[=+\-@]/.test(t)) t = "'" + t;
        return '"' + t.replace(/"/g, '""') + '"';
    };
    const linhas = [['Vencimento', 'Descrição', 'Categoria', 'Tipo', 'Situação', 'Valor (R$)']];
    itens.forEach(l => linhas.push([
        l.vencimento || '', l.descricao || '', rptNomeCategoria(l.categoriaId),
        l.tipo === 'entrada' ? 'Entrada' : 'Saída', rptConcluido(l) ? 'Concluído' : 'Pendente',
        rptValor(l).toFixed(2).replace('.', ',')
    ]));
    const blob = new Blob(['\uFEFF' + linhas.map(l => l.map(seguro).join(';')).join('\r\n')],
        {type: 'text/csv;charset=utf-8;'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'relatorio_' + mes + '.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    rptEl('rptFeedback').textContent = 'Arquivo CSV preparado com os filtros selecionados.';
}

document.addEventListener('DOMContentLoaded', async () => {
    injetarHeader();
    const autenticado = await verificarAutenticacao();
    if (!autenticado) return;
    rptEstado.prefKey = 'relatorioAnalise:v1:' + String(obterUsuarioAtualId());
    const preferencias = rptLerPreferencias();
    const params = new URLSearchParams(window.location.search);
    const mesUrl = params.get('mes');
    rptEl('filtroMesRelatorio').value = rptMesValido(mesUrl)
        ? mesUrl : dataLocalYYYYMMDD().slice(0, 7);
    rptEl('rptEscopo').value = ['casal', 'individual'].includes(preferencias.escopo)
        ? preferencias.escopo : 'individual';
    rptEl('rptSituacao').value = preferencias.situacao === 'todos' ? 'todos' : 'realizados';
    rptEl('rptJanelaComparacao').value = ['1', '3', '6', '12'].includes(preferencias.janela)
        ? preferencias.janela : '6';
    for (const id of ['filtroMesRelatorio', 'rptEscopo', 'rptSituacao']) {
        rptEl(id).addEventListener('change', carregarRelatorioMensal);
    }
    for (const id of ['rptCategoriaEntrada', 'rptCategoriaSaida', 'rptJanelaComparacao']) {
        rptEl(id).addEventListener('change', () => {
            rptRenderizarComparador();
            rptGuardarPreferencias();
        });
    }
    rptEl('rptExportarCSV').addEventListener('click', rptExportarCSV);
    rptEl('rptExportarPDF').addEventListener('click', () => window.print());
    rptEstado.carregado = true;
    carregarRelatorioMensal();
});
