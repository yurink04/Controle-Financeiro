// Controle Financeiro | Página: rendimentos.html
// Extraído do HTML mantendo a lógica e as dependências globais existentes.
// Carregue este arquivo depois de script.js, calculos_trabalhistas.js e conexao_sheets.js.

        let itensRendaExportacao = [];
        const nomesRenda = {
            folha: 'Folha de pagamento', adiantamento: 'Adiantamento salarial',
            salarial_extra: 'Outros salariais', variavel: 'Renda variável'
        };
        function mesRendaPtBr(mes) {
            const partes = String(mes || '').split('-');
            if (partes.length !== 2) return mes;
            return new Date(Number(partes[0]), Number(partes[1]) - 1, 1)
                .toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
        }
        function periodoRendaInclui(mes, fim, qtd) {
            if (!mes || mes > fim) return false;
            if (qtd === 'todos') return true;
            const [ano, m] = fim.split('-').map(Number);
            const inicio = new Date(ano, m - 1 - (Number(qtd) - 1), 1);
            const chave = inicio.getFullYear() + '-' + String(inicio.getMonth() + 1).padStart(2, '0');
            return mes >= chave;
        }
        function linhaRenda(rotulo, valor, classe = '') {
            return '<div class="income-breakdown-line ' + classe + '"><span>' + escaparHTML(rotulo) +
                '</span><strong>' + formatarMoeda(valor) + '</strong></div>';
        }
        function carregarHistoricoRendimentos() {
            const conteudo = document.getElementById('conteudoRendimentos');
            const oculto = document.getElementById('rendaPrivacidadeOculta');
            const discreto = document.body.classList.contains('privacidade-ativa');
            conteudo.hidden = discreto;
            oculto.hidden = !discreto;
            document.getElementById('exportarRendimentosCsv').disabled = discreto;
            itensRendaExportacao = [];
            if (discreto) return;
            const dados = obterDados(), usuario = obterUsuarioAtual(dados);
            if (!usuario) return;
            const conf = normalizarConfiguracaoSalarial(usuario.configuracaoSalarial);
            const calculo = calcularSalarioLiquido(usuario.rendaFixa, conf);
            const rotulos = {clt: ['Salário CLT bruto estimado', 'Salário CLT líquido estimado'],
                pj: ['Faturamento PJ estimado', 'Disponível PJ após descontos informados'],
                aposentado: ['Benefício bruto mensal', 'Benefício líquido estimado']};
            document.getElementById('rotuloRendaBrutaCard').textContent = rotulos[conf.regimeRenda][0];
            document.getElementById('rotuloRendaLiquidaCard').textContent = rotulos[conf.regimeRenda][1];
            nomesRenda.folha = conf.regimeRenda === 'clt' ? 'Folha de pagamento'
                : conf.regimeRenda === 'pj' ? 'Recebimento PJ' : 'Aposentadoria / pensão';
            nomesRenda.salarial_extra = conf.regimeRenda === 'aposentado' ? '13º / benefício extra' : '13º / férias / PLR';
            document.getElementById('rotuloExtrasSalariais').textContent = conf.regimeRenda === 'pj' ? 'Outros recebimentos'
                : conf.regimeRenda === 'aposentado' ? '13º / benefícios adicionais' : '13º / férias / PLR';
            document.getElementById('detalheRegrasCLT').hidden = conf.regimeRenda === 'pj';
            document.getElementById('descricaoCalculoRegime').textContent = conf.regimeRenda === 'pj'
                ? 'PJ: sem descontos automáticos de CLT; use os custos e impostos cadastrados (simulação, não cálculo tributário PJ).'
                : conf.regimeRenda === 'aposentado'
                    ? 'Aposentadoria: sem INSS de empregado; IRRF estimado e eventual isenção 65+, além dos descontos cadastrados.'
                    : 'CLT: INSS e IRRF consideram também as horas extras brutas previstas, além dos demais descontos.';
            const consolidado = consolidarRendimentosUsuario(dados, usuario.id);
            const fim = document.getElementById('fimPeriodoRenda').value;
            const qtd = document.getElementById('inicioPeriodoRenda').value;
            const meses = consolidado.meses.filter(x => periodoRendaInclui(x.mes, fim, qtd));
            const registros = consolidado.registros.filter(x => periodoRendaInclui(x.mesRenda, fim, qtd));
            itensRendaExportacao = registros;
            document.getElementById('rendaBrutaCard').textContent = formatarMoeda(calculo.bruto);
            document.getElementById('rendaLiquidaCard').textContent = formatarMoeda(calculo.liquido);
            document.getElementById('mediaVariavelCard').textContent = formatarMoeda(consolidado.mediaVariavel);
            document.getElementById('rendaCompostaCard').textContent = formatarMoeda(centavosRenda(calculo.liquido + consolidado.mediaVariavel));
            const itens = [
                linhaRenda('Renda-base bruta', calculo.brutoBase),
                ...(calculo.extraBruta ? [linhaRenda('Horas extras brutas previstas', calculo.extraBruta)] : []),
                linhaRenda('Renda bruta total estimada', calculo.bruto)
            ];
            if (conf.regimeRenda === 'clt') itens.push(linhaRenda('INSS (progressivo)', -calculo.inss.valor));
            if (conf.regimeRenda !== 'pj') itens.push(linhaRenda('IRRF estimado', -calculo.irrf.valor));
            if (calculo.isencaoAposentadoria) itens.push(linhaRenda('Parcela isenta 65+ na base do IRRF', calculo.isencaoAposentadoria));
            if (conf.regimeRenda === 'clt') itens.push(linhaRenda('Vale-transporte', -calculo.valeTransporte));
            calculo.descontos.forEach(d => itens.push(linhaRenda(d.nome + (d.tipo === 'percentual' ? ' (' + d.valor + '%)' : ''), -d.calculado)));
            itens.push(linhaRenda('Total dos descontos', -calculo.totalDescontos, 'income-breakdown-subtotal'));
            itens.push(linhaRenda('Renda líquida projetada', calculo.liquido, 'income-breakdown-total'));
            document.getElementById('detalheFolhaEstimado').innerHTML = itens.join('');
            document.getElementById('detalheFaixasINSS').innerHTML =
                (conf.regimeRenda === 'clt'
                    ? '<p>O INSS incide por faixas, não por uma alíquota única sobre todo o salário:</p>' +
                      calculo.inss.faixas.map(f => linhaRenda((f.aliquota * 100).toLocaleString('pt-BR') + '% sobre ' + formatarMoeda(f.ate - f.de), f.valor)).join('')
                    : '<p>Não há contribuição previdenciária de empregado sobre o benefício nesta simulação.</p>') +
                '<p>IRRF: base ' + formatarMoeda(calculo.irrf.base || 0) + ', imposto antes da redução ' +
                formatarMoeda(calculo.irrf.impostoTabela || 0) + ', redução ' + formatarMoeda(calculo.irrf.reducao || 0) + '.</p>';
            const variaveis = consolidado.mesesMedia.map(mes => {
                const total = consolidado.meses.find(g => g.mes === mes)?.variavel || 0;
                return linhaRenda(mesRendaPtBr(mes), total);
            });
            variaveis.push(linhaRenda('Soma dos 6 meses', consolidado.totalVariavelJanela, 'income-breakdown-subtotal'));
            variaveis.push(linhaRenda('Média (soma ÷ 6)', consolidado.mediaVariavel, 'income-breakdown-total'));
            document.getElementById('detalheMediaVariavel').innerHTML = variaveis.join('');

            const tdVazio = (colunas, texto) => '<tr><td colspan="' + colunas + '" class="income-empty">' + texto + '</td></tr>';
            const mesesSalario = meses.filter(m => m.folha || m.adiantamento || m.salarial_extra);
            document.getElementById('historicoSalarioMensal').innerHTML = mesesSalario.length
                ? mesesSalario.map(m => '<tr><td data-label="Competência"><strong>' + escaparHTML(mesRendaPtBr(m.mes)) + '</strong></td>' +
                    '<td data-label="Folha">' + formatarMoeda(m.folha) + '</td>' +
                    '<td data-label="Adiantamentos">' + formatarMoeda(m.adiantamento) + '</td>' +
                    '<td data-label="Outros">' + formatarMoeda(m.salarial_extra) + '</td>' +
                    '<td data-label="HE bruta"><span class="income-extra-badge">' + (m.horasExtrasBrutas ? formatarMoeda(m.horasExtrasBrutas) : '—') + '</span></td>' +
                    '<td data-label="Bruto simulado">' + formatarMoeda(m.brutoEstimado) + '</td>' +
                    '<td data-label="Descontos previstos">' + formatarMoeda(m.calculoFolha.totalDescontos) + '</td>' +
                    '<td data-label="Descontos efetivos">' + (m.descontosEfetivos == null ? '—' : formatarMoeda(m.descontosEfetivos)) + '</td>' +
                    '<td data-label="Descontos de extras">' + (m.descontosExtrasEfetivos == null ? '—' : formatarMoeda(m.descontosExtrasEfetivos)) + '</td>' +
                    '<td data-label="Líquido previsto">' + formatarMoeda(m.calculoFolha.liquido) + '</td>' +
                    '<td data-label="Total recebido"><strong>' + formatarMoeda(m.totalClt) + '</strong></td></tr>').join('')
                : tdVazio(11, 'Ainda não há recebimentos principais neste período.');
            const mesesVariavel = meses.filter(m => m.variavel);
            document.getElementById('historicoVariavelMensal').innerHTML = mesesVariavel.length
                ? mesesVariavel.map(m => '<tr><td data-label="Mês">' + escaparHTML(mesRendaPtBr(m.mes)) + '</td><td data-label="Lançamentos">' +
                    registros.filter(r => r.mesRenda === m.mes && r.classeRenda === 'variavel').length +
                    '</td><td data-label="Variável"><strong>' + formatarMoeda(m.variavel) + '</strong></td></tr>').join('')
                : tdVazio(3, 'Nenhuma renda variável no período.');
            const totaisCategorias = new Map();
            registros.filter(r => r.classeRenda === 'variavel').forEach(r => {
                const categoria = (dados.categorias || []).find(c => String(c.id) === String(r.categoriaId))?.nome || 'Sem categoria';
                totaisCategorias.set(categoria, centavosRenda((totaisCategorias.get(categoria) || 0) + r.valor));
            });
            const topCategorias = [...totaisCategorias.entries()].sort((a, b) => b[1] - a[1]);
            const totalCategorias = topCategorias.reduce((s, x) => s + x[1], 0);
            document.getElementById('categoriasVariaveis').innerHTML = topCategorias.length ?
                '<h3>Origem da renda variável</h3>' + topCategorias.map(([nome, valor]) =>
                    '<div class="income-category-item"><div><strong>' + escaparHTML(nome) + '</strong><span>' + formatarMoeda(valor) +
                    '</span></div><div class="income-category-track"><span style="width:' +
                    Math.min(100, Math.max(0, valor / totalCategorias * 100)).toFixed(2) + '%"></span></div></div>').join('')
                : '<p class="income-empty">Cadastre entradas variáveis para ver as origens aqui.</p>';
            document.getElementById('historicoRendimentosItens').innerHTML = registros.length
                ? registros.map(r => {
                    const categoria = (dados.categorias || []).find(c => String(c.id) === String(r.categoriaId))?.nome || 'Sem categoria';
                    const data = r.dataPagamento || r.vencimento || r.dataCompra;
                    return '<tr><td data-label="Data">' + formatarDataBR(data) + '</td><td data-label="Competência">' +
                        escaparHTML(r.mesRenda) + '</td><td data-label="Descrição">' +
                        escaparHTML(r.descricao || 'Sem descrição') + '</td><td data-label="Categoria">' +
                        escaparHTML(categoria) + '</td><td data-label="Tipo"><span class="income-tag">' +
                        escaparHTML(nomesRenda[r.classeRenda]) + '</span></td><td data-label="Hora extra">' +
                        (r.horasExtrasBrutas ? formatarMoeda(r.horasExtrasBrutas) : '—') + '</td><td data-label="Recebido"><strong>' +
                        formatarMoeda(r.valor) + '</strong></td><td data-label="Abrir"><a class="income-row-link" href="editar-lancamento.html?id=' +
                        encodeURIComponent(String(r.id)) + '&returnUrl=rendimentos.html">↗</a></td></tr>';
                }).join('')
                : tdVazio(8, 'Sem entradas salariais ou variáveis registradas neste período.');
        }
        function exportarHistoricoRendimentos() {
            if (document.body.classList.contains('privacidade-ativa')) return;
            if (!itensRendaExportacao.length) { notificarOperacao('Não há registros no período para exportar.'); return; }
            const dados = obterDados();
            const linhas = [['Data','Competência','Descrição','Categoria','Classificação','Hora extra bruta','Bruto da folha','Valor recebido']];
            itensRendaExportacao.forEach(r => {
                const categoria = (dados.categorias || []).find(c => String(c.id) === String(r.categoriaId))?.nome || '';
                linhas.push([r.dataPagamento || r.vencimento || '', r.mesRenda, r.descricao || '',
                    categoria, nomesRenda[r.classeRenda], r.horasExtrasBrutas, r.remuneracaoBruta || '', r.valor]);
            });
            // Planilhas podem executar células começando por operadores, mesmo em campos CSV entre aspas.
            const celulaSegura = valor => {
                let texto = String(valor ?? '');
                if (/^\s*[=+\-@]/.test(texto) && typeof valor === 'string') texto = "'" + texto;
                return '"' + texto.replace(/"/g, '""') + '"';
            };
            const csv = '\uFEFF' + linhas.map(row => row.map(celulaSegura).join(';')).join('\r\n');
            const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
            const a = document.createElement('a');
            a.href = url; a.download = 'meus-rendimentos.csv'; document.body.append(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
        document.addEventListener('DOMContentLoaded', async () => {
            injetarHeader();
            if (!await verificarAutenticacao()) return;
            const agora = new Date();
            const params = new URLSearchParams(window.location.search);
            const mesSolicitado = params.get('mes');
            document.getElementById('fimPeriodoRenda').value = /^\d{4}-(0[1-9]|1[0-2])$/.test(mesSolicitado || '')
                ? mesSolicitado : agora.getFullYear() + '-' + String(agora.getMonth() + 1).padStart(2, '0');
            carregarHistoricoRendimentos();
            new MutationObserver(() => carregarHistoricoRendimentos())
                .observe(document.body, { attributes: true, attributeFilter: ['class'] });
        });
    

// Eventos estáticos migrados para addEventListener.
(function vincularEventosRendimentos(){
    const eventos = {
        "rendimentos-1": [
            ["change", function(event) {
                carregarHistoricoRendimentos()
            }],
        ],
        "rendimentos-2": [
            ["change", function(event) {
                carregarHistoricoRendimentos()
            }],
        ],
        "rendimentos-3": [
            ["click", function(event) {
                exportarHistoricoRendimentos()
            }],
        ],
        "rendimentos-4": [
            ["click", function(event) {
                abrirEditorSalarial()
            }],
        ],
    };
    function ligar() {
        document.querySelectorAll("[data-page-handler]").forEach(el => {
            const especificacoes = eventos[el.getAttribute("data-page-handler")];
            if (!especificacoes || el.dataset.pageHandlerBound === "1") return;
            el.dataset.pageHandlerBound = "1";
            especificacoes.forEach(([evento, acao]) => {
                el.addEventListener(evento, function(e) {
                    const retorno = acao.call(el, e);
                    if (retorno === false) e.preventDefault();
                });
            });
        });
    }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ligar, {once:true});
    else ligar();
})();
