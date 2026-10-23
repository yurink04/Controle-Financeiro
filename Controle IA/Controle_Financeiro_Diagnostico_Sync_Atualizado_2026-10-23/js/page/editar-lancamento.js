// Controle Financeiro | Página: editar-lancamento.html
// Arquivo extraído dos scripts embutidos no HTML original.
// Carregar APÓS js/script.js, js/calculos_trabalhistas.js e js/conexao_sheets.js.
// Mantém funções globais clássicas usadas por elementos gerados dinamicamente.

// ===== Bloco inline original 1 =====
        const urlParams = new URLSearchParams(window.location.search);
        const lancamentoId = urlParams.get('id') || '';
        const returnUrlInformada = urlParams.get('returnUrl') || '';
        const destinosRetornoPermitidos = new Set([
            'dashboard.html', 'central-pagamentos.html', 'lancamentos.html',
            'relatorios.html', 'cartoes.html', 'financiamentos.html', 'grafico.html',
            'rendimentos.html'
        ]);
        const returnUrl = destinosRetornoPermitidos.has(returnUrlInformada) ? returnUrlInformada : '';
        let lancamentoAtualEdicao = null;

        document.addEventListener('DOMContentLoaded', async () => {
            injetarHeader();
            const autenticado = await verificarAutenticacao();
            if (autenticado) carregarFormulario();
        });

        function voltarOrigem(event) {
            if (event) event.preventDefault();
            window.location.href = returnUrl || 'dashboard.html';
        }

        function popularCategoriasEdicao(tipo, categoriaPreferida = null) {
            const dados = obterDados();
            const sel = document.getElementById('editCategoria');
            const categorias = (dados.categorias || []).filter(c => c.tipo === tipo &&
                (categoriaRendaDisponivel(c, obterUsuarioAtual(dados)) || String(c.id) === String(lancamentoAtualEdicao?.categoriaId)))
                .sort((a, b) => normalizarTexto(a.nome).localeCompare(normalizarTexto(b.nome), 'pt-BR'));
            sel.replaceChildren();
            categorias.forEach(c => { const o = document.createElement('option'); o.value = String(c.id); o.textContent = c.nome; sel.appendChild(o); });
            if (!categorias.length) {
                sel.innerHTML = '<option value="">Nenhuma categoria deste tipo</option>';
                sel.disabled = true;
                return;
            }
            sel.disabled = false;
            const pref = categorias.some(c => String(c.id) === String(categoriaPreferida));
            sel.value = pref ? String(categoriaPreferida) : String(categorias[0].id);
        }

        function popularCartoesEdicao(dados) {
            const sel = document.getElementById('editCartao');
            const usuarioAtualId = Number(obterUsuarioAtualId());
            const cartoes = (dados.cartoes || []).filter(c => c.ativo !== false && !c.isBeneficio && Number(c.usuarioId) === usuarioAtualId);
            sel.replaceChildren();
            sel.appendChild(new Option(cartoes.length ? 'Selecione um cartão' : 'Nenhum cartão ativo', ''));
            cartoes.forEach(c => sel.appendChild(new Option(c.nome, String(c.id))));
        }

        function popularBensEdicao(dados) {
            const sel = document.getElementById('editBem');
            const usuario = obterUsuarioAtual();
            const usuarioId = String(usuario?.id ?? '');
            const parceiroId = String(usuario?.parceiroId ?? '');
            const bens = (dados.bens || []).filter(b => b.ativo !== false && (b.usuarioId == null || String(b.usuarioId) === usuarioId || (b.compartilhado && String(b.usuarioId) === parceiroId)));
            sel.innerHTML = '<option value="">Nenhum bem vinculado</option>';
            bens.forEach(b => sel.appendChild(new Option(b.nome, String(b.id))));
        }

        function carregarFormulario() {
            const dados = obterDados();
            lancamentoAtualEdicao = (dados.lancamentos || []).find(l => String(l.id) === String(lancamentoId));
            if (!lancamentoAtualEdicao) {
                mostrarAlertaModal('Lançamento não encontrado.').then(() => voltarOrigem());
                return;
            }
            if (!usuarioPodeAlterarLancamento(lancamentoAtualEdicao, dados)) {
                mostrarAlertaModal('Sem permissão para editar este lançamento.').then(() => voltarOrigem());
                return;
            }

            const lanc = lancamentoAtualEdicao;

            // Info de vínculo (rastreabilidade)
            const infoEl = document.getElementById('infoVinculoEdit');
            if (typeof descreverOrigemLancamento === 'function') {
                const origem = descreverOrigemLancamento(lanc, dados);
                if (origem) {
                    infoEl.style.display = 'flex';
                    infoEl.innerHTML = `<span style="font-size:1.4rem;">${origem.icone}</span><div><strong>${escaparHTML(origem.detalhe)}</strong><br><span class="muted small">Este lançamento está vinculado a outro registro. Alterações afetam o vínculo.</span></div>`;
                }
            }

            // Bloqueio para entrada de empréstimo
            const finVinculado = lanc.financiamentoId
                ? (dados.financiamentos || []).find(f => String(f.id) === String(lanc.financiamentoId))
                : null;
            if (finVinculado?.tipoContrato === 'emprestimo' && lanc.tipo === 'entrada') {
                infoEl.style.display = 'flex';
                infoEl.classList.add('bloqueio');
                infoEl.innerHTML = `<span style="font-size:1.4rem;">🔒</span><div><strong>Entrada de empréstimo não pode ser editada</strong><br><span class="muted small">Este lançamento representa o valor recebido do contrato <em>${escaparHTML(finVinculado.nome)}</em>. Para alterar, edite o contrato em Financiamentos.</span></div>`;
                document.querySelectorAll('#formEditarLancamento input, #formEditarLancamento select, #formEditarLancamento button[type="submit"]').forEach(el => el.disabled = true);
            }

            document.getElementById('editId').value = String(lanc.id);
            document.getElementById('editDescricao').value = lanc.descricao || '';
            document.getElementById('editTipo').value = lanc.tipo === 'entrada' ? 'entrada' : 'saida';
            document.getElementById('editFormaPagamento').value = lanc.formaPagamento || 'BOLETO';
            document.getElementById('editValor').value = Number(lanc.valor || 0);
            document.getElementById('editObservacao').value = lanc.observacao || '';
            document.getElementById('editVencimento').value = lanc.vencimento || dataLocalYYYYMMDD();
            document.getElementById('editServicoEssencial').value = lanc.servicoEssencial || 'nao';
            document.getElementById('editEscopo').value = lanc.escopo || 'casal';
            document.getElementById('editHoraExtra').value = Number(lanc.horaExtra || 0);
            document.getElementById('editHoraExtraBruta').value = Number(lanc.horaExtraBruta || 0);
            document.getElementById('editRemuneracaoBruta').value = Number(lanc.remuneracaoBruta || 0) || '';
            document.getElementById('editCompetenciaRenda').value = lanc.competenciaRenda || obterMesRendimento(lanc);
            document.getElementById('editNaturezaRenda').value = lanc.naturezaRenda || '';
            document.getElementById('editDataCompra').value = lanc.dataCompra || '';

            popularCategoriasEdicao(lanc.tipo === 'entrada' ? 'entrada' : 'saida', lanc.categoriaId);
            popularCartoesEdicao(dados);
            popularBensEdicao(dados);
            if (lanc.cartaoId) document.getElementById('editCartao').value = String(lanc.cartaoId);
            if (lanc.bemId) document.getElementById('editBem').value = String(lanc.bemId);

            if (Number(lanc.totalParcelas) > 1 || lanc.parcelamentoId) {
                document.getElementById('infoParcelamentoEdit').textContent =
                    `Parcela ${lanc.parcelaAtual || 1} de ${lanc.totalParcelas || 1}. O número total de parcelas é definido na criação — para alterar, exclua e recrie o parcelamento.`;
            }

            tratarMudancaTipoEdicao();
            tratarMudancaFormaEdicao();
        }

        function tratarMudancaTipoEdicao(atualizarCategorias = true) {
            const tipo = document.getElementById('editTipo').value === 'entrada' ? 'entrada' : 'saida';
            if (atualizarCategorias) {
                const catAtual = document.getElementById('editCategoria').value;
                popularCategoriasEdicao(tipo, catAtual);
            }
            const ehEntrada = tipo === 'entrada';
            document.getElementById('blocoServicoEssencial').style.display = ehEntrada ? 'none' : 'block';
            document.getElementById('blocoEditEscopo').style.display = ehEntrada ? 'none' : 'block';
            document.getElementById('blocoEditBem').style.display = ehEntrada ? 'none' : 'block';
            document.getElementById('blocoEditNaturezaRenda').style.display = ehEntrada ? 'block' : 'none';
            document.getElementById('blocoEditCompetenciaRenda').style.display = ehEntrada ? 'block' : 'none';
            atualizarOpcoesNaturezaRenda(document.getElementById('editNaturezaRenda'), obterUsuarioAtual(),
                lancamentoAtualEdicao?.naturezaRenda || '');

            const catSel = document.getElementById('editCategoria');
            const dados = obterDados();
            const amostra = { tipo, categoriaId: catSel.value, descricao: document.getElementById('editDescricao').value,
                naturezaRenda: document.getElementById('editNaturezaRenda').value };
            const ehFolha = classificarEntradaRendimento(amostra, dados) === 'folha';
            const ehExtraSalarial = classificarEntradaRendimento(amostra, dados) === 'salarial_extra';
            const clt = normalizarConfiguracaoSalarial(obterUsuarioAtual()?.configuracaoSalarial).regimeRenda === 'clt';
            document.getElementById('blocoEditHoraExtra').style.display = (ehEntrada && ehFolha && clt) ? 'block' : 'none';
            document.getElementById('blocoEditBrutoFolha').style.display = (ehEntrada && (ehFolha || ehExtraSalarial)) ? 'grid' : 'none';
            document.getElementById('campoEditHoraExtraBruta').style.display = ehFolha && clt ? 'block' : 'none';
            document.getElementById('labelEditBruto').textContent = ehFolha ? 'Bruto total da folha (R$)' : 'Bruto da verba (13º/férias/PLR) (R$)';

            if (ehEntrada) {
                document.getElementById('blocoEditCartaoSecao').style.display = 'none';
            } else {
                tratarMudancaFormaEdicao();
            }
        }

        function tratarMudancaFormaEdicao() {
            const forma = document.getElementById('editFormaPagamento').value;
            const tipo = document.getElementById('editTipo').value;
            const ehCartao = (tipo === 'saida' && forma === 'CARTAO');
            document.getElementById('blocoEditCartaoSecao').style.display = ehCartao ? 'block' : 'none';
            document.getElementById('blocoEditDataCompra').style.display = ehCartao ? 'block' : 'none';
        }

        document.addEventListener('change', e => {
            if (e.target.id === 'editCategoria') tratarMudancaTipoEdicao(false);
        });
        document.getElementById('editDescricao').addEventListener('input', () => tratarMudancaTipoEdicao(false));

        async function salvarEdicaoLancamento(event) {
            event.preventDefault();
            const dados = obterDados();
            const lanc = (dados.lancamentos || []).find(l => String(l.id) === String(lancamentoId));
            if (!lanc || !usuarioPodeAlterarLancamento(lanc, dados)) {
                await mostrarAlertaModal('Sem permissão ou lançamento não existe mais.');
                return;
            }

            const descricao = document.getElementById('editDescricao').value.trim();
            const tipo = document.getElementById('editTipo').value || 'saida';
            const formaPagamento = document.getElementById('editFormaPagamento').value || 'BOLETO';
            const valor = numeroSeguro(document.getElementById('editValor').value, NaN);
            const categoriaId = document.getElementById('editCategoria').value;
            const cartaoId = (tipo === 'saida' && formaPagamento === 'CARTAO') ? (document.getElementById('editCartao').value || null) : null;
            const bemId = tipo === 'saida' ? (document.getElementById('editBem').value || null) : null;
            const naturezaRenda = tipo === 'entrada' ? document.getElementById('editNaturezaRenda').value : '';
            const folha = classificarEntradaRendimento({tipo, naturezaRenda, categoriaId, descricao}, dados) === 'folha';
            const horaExtra = folha ? numeroSeguro(document.getElementById('editHoraExtra').value) : 0;
            const extraSalarial = classificarEntradaRendimento({tipo, naturezaRenda, categoriaId, descricao}, dados) === 'salarial_extra';
            const regimeClt = normalizarConfiguracaoSalarial(obterUsuarioAtual()?.configuracaoSalarial).regimeRenda === 'clt';
            const horaExtraBruta = folha && regimeClt ? document.getElementById('editHoraExtraBruta').value : '';
            const remuneracaoBruta = folha || extraSalarial ? document.getElementById('editRemuneracaoBruta').value : '';
            const competenciaRenda = tipo === 'entrada' ? document.getElementById('editCompetenciaRenda').value : '';
            const dataCompra = (tipo === 'saida' && formaPagamento === 'CARTAO') ? (document.getElementById('editDataCompra').value || null) : null;

            if (!descricao || !Number.isFinite(valor) || valor <= 0) {
                await mostrarAlertaModal('Descrição e valor maior que zero são obrigatórios.');
                return;
            }
            if (horaExtra < 0 || horaExtra > valor) {
                await mostrarAlertaModal('A hora extra precisa fazer parte do valor da folha de pagamento.'); return;
            }
            if (!(dados.categorias || []).some(c => String(c.id) === String(categoriaId) && c.tipo === tipo)) {
                await mostrarAlertaModal('Selecione uma categoria válida.');
                return;
            }
            if (tipo === 'saida' && formaPagamento === 'CARTAO') {
                const cartao = (dados.cartoes || []).find(c => String(c.id) === String(cartaoId) && c.ativo !== false && !c.isBeneficio && Number(c.usuarioId) === Number(obterUsuarioAtualId()));
                if (!cartao) { await mostrarAlertaModal('Selecione um cartão válido.'); return; }
                if (!dataCompra) { await mostrarAlertaModal('Informe a data da compra.'); return; }
            }
            const vencimento = document.getElementById('editVencimento').value;
            if (!criarDataLocal(vencimento)) { await mostrarAlertaModal('Data de vencimento inválida.'); return; }

            const ok = await atualizarLancamentoNoBanco(lancamentoId, {
                descricao, tipo, categoriaId, formaPagamento, valor,
                observacao: document.getElementById('editObservacao').value.trim(),
                vencimento,
                servicoEssencial: tipo === 'saida' ? (document.getElementById('editServicoEssencial').value || 'nao') : 'nao',
                escopo: document.getElementById('editEscopo').value || 'casal',
                cartaoId, dataCompra, bemId, horaExtra, horaExtraBruta, remuneracaoBruta,
                competenciaRenda, naturezaRenda
            });
            if (ok) voltarOrigem();
        }
    

// ===== Eventos migrados dos atributos on* do HTML =====
// Liga apenas os elementos estáticos marcados por data-page-handler,
// sem executar JavaScript como string e sem registrar eventos em duplicidade.
(function vincularEventosDaPagina() {
    const eventos = {
        "editar-lancamento-1": [
            ["click", function(event) {
                voltarOrigem(event)
            }],
        ],
        "editar-lancamento-2": [
            ["submit", function(event) {
                salvarEdicaoLancamento(event)
            }],
        ],
        "editar-lancamento-3": [
            ["change", function(event) {
                tratarMudancaTipoEdicao()
            }],
        ],
        "editar-lancamento-4": [
            ["change", function(event) {
                tratarMudancaFormaEdicao()
            }],
        ],
        "editar-lancamento-5": [
            ["change", function(event) {
                tratarMudancaTipoEdicao(false)
            }],
        ],
        "editar-lancamento-6": [
            ["click", function(event) {
                voltarOrigem(event)
            }],
        ],
    };
    function ligar() {
        document.querySelectorAll("[data-page-handler]").forEach((el) => {
            const nome = el.getAttribute("data-page-handler");
            const especificacoes = eventos[nome];
            if (!especificacoes || el.dataset.pageHandlerBound === "1") return;
            el.dataset.pageHandlerBound = "1";
            for (const [evento, handler] of especificacoes) {
                const executar = function(e) {
                    const resultado = handler.call(el, e);
                    if (resultado === false) e.preventDefault();
                };
                el.addEventListener(evento, executar);
                // Imagens podem carregar antes de scripts com defer serem executados.
                if (el.tagName === "IMG" && el.complete) {
                    if (evento === "load" && el.naturalWidth > 0) executar(new Event("load"));
                    if (evento === "error" && el.naturalWidth === 0) executar(new Event("error"));
                }
            }
        });
    }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ligar, { once: true });
    else ligar();
})();

