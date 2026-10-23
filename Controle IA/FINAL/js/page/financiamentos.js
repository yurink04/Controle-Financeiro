// Controle Financeiro | Página: financiamentos.html
// Arquivo extraído dos scripts embutidos no HTML original.
// Carregar APÓS js/script.js, js/calculos_trabalhistas.js e js/conexao_sheets.js.
// Mantém funções globais clássicas usadas por elementos gerados dinamicamente.

// ===== Bloco inline original 1 =====
        document.addEventListener('DOMContentLoaded', async () => {
            injetarHeader();
            document.getElementById('valorCompraFin')?.addEventListener('input', atualizarPreviewValorFinanciado);
            document.getElementById('valorEntradaFin')?.addEventListener('input', atualizarPreviewValorFinanciado);
            const autenticado = await verificarAutenticacao();
            if (autenticado) carregarTabelaFinanciamentosGeral();
        });

        function tratarMudancaTipoContrato() {
            const tipo = document.getElementById('tipoContratoFin')?.value || 'financiamento';
            const ehEmprestimo = tipo === 'emprestimo';
            const blocoBem = document.getElementById('blocoBemVinculadoFin');
            const selectBem = document.getElementById('bemVinculadoFin');
            const labelBem = document.getElementById('labelBemVinculadoFin');
            const blocoEmprestimo = document.getElementById('blocoDadosEmprestimo');
            const blocoCompra = document.getElementById('blocoDadosCompraFin');
            const valorCompraEl = document.getElementById('valorCompraFin');
            const catEntrada = document.getElementById('categoriaEntradaEmprestimo');
            const escopo = document.getElementById('escopoContratoEmprestimo');
            const texto = document.getElementById('descricaoModalNovoContrato');

            if (blocoBem) blocoBem.style.display = 'block';
            if (selectBem) selectBem.required = !ehEmprestimo;
            if (labelBem) labelBem.textContent = ehEmprestimo ? 'Bem vinculado (opcional)' : 'Vincular a um bem patrimonial (obrigatório)';
            if (blocoEmprestimo) blocoEmprestimo.style.display = ehEmprestimo ? 'block' : 'none';
            if (blocoCompra) blocoCompra.style.display = ehEmprestimo ? 'none' : 'block';
            if (valorCompraEl) valorCompraEl.required = !ehEmprestimo;
            if (catEntrada) catEntrada.required = ehEmprestimo;
            if (escopo) escopo.required = ehEmprestimo;
            const valorLib = document.getElementById('valorLiberadoEmprestimo');
            const dataLib = document.getElementById('dataLiberacaoEmprestimo');
            if (valorLib) valorLib.required = ehEmprestimo;
            if (dataLib) dataLib.required = ehEmprestimo;
            if (texto) texto.textContent = ehEmprestimo
                ? 'O valor liberado será lançado como entrada e as parcelas mensais como saídas vinculadas a este contrato.'
                : 'Cadastre o financiamento vinculado a um bem patrimonial e informe o preço de compra para calcular o custo adicional e a taxa estimada.';
            atualizarPreviewValorFinanciado();
        }

        function atualizarPreviewValorFinanciado() {
            const tipo = document.getElementById('tipoContratoFin')?.value || 'financiamento';
            const preview = document.getElementById('previewValorFinanciado');
            if (!preview || tipo === 'emprestimo') return;
            const compraTxt = document.getElementById('valorCompraFin')?.value ?? '';
            const entradaTxt = document.getElementById('valorEntradaFin')?.value ?? '0';
            if (compraTxt.trim() === '') { preview.textContent = 'Valor financiado estimado: —'; return; }
            const compra = Number(compraTxt);
            const entrada = entradaTxt.trim() === '' ? 0 : Number(entradaTxt);
            if (!Number.isFinite(compra) || !Number.isFinite(entrada) || compra <= 0 || entrada < 0 || entrada >= compra) {
                preview.textContent = 'Confira os valores: a entrada deve ser igual ou superior a zero e menor que o preço de compra.';
                return;
            }
            preview.textContent = `Valor financiado estimado: ${formatarMoeda(compra - entrada)}`;
        }

        async function abrirModalNovoFinanciamento() {
            const dados = obterDados();
            const usuario = obterUsuarioAtual();
            const usuarioId = String(usuario?.id ?? '');
            const parceiroId = String(usuario?.parceiroId ?? '');
            const bensAtivos = (dados.bens || []).filter(b => b.ativo !== false && (b.usuarioId == null || String(b.usuarioId) === usuarioId || (b.compartilhado === true && String(b.usuarioId) === parceiroId)));

            const selectBens = document.getElementById('bemVinculadoFin');
            const selectCatSaida = document.getElementById('categoriaFinanciamento');
            const selectCatEntrada = document.getElementById('categoriaEntradaEmprestimo');
            selectBens.innerHTML = '<option value="">Nenhum bem vinculado</option>';
            bensAtivos.forEach(b => {
                const opt = document.createElement('option'); opt.value = b.id; opt.textContent = b.nome; selectBens.appendChild(opt);
            });
            selectCatSaida.innerHTML = '';
            (dados.categorias || []).filter(c => c.tipo === 'saida').forEach(c => {
                const opt = document.createElement('option'); opt.value = c.id; opt.textContent = c.nome; selectCatSaida.appendChild(opt);
            });
            selectCatEntrada.innerHTML = '';
            (dados.categorias || []).filter(c => c.tipo === 'entrada').forEach(c => {
                const opt = document.createElement('option'); opt.value = c.id; opt.textContent = c.nome; selectCatEntrada.appendChild(opt);
            });
            if (!selectCatSaida.options.length) {
                await mostrarAlertaModal('Cadastre ao menos uma categoria do tipo saída antes de criar um contrato.'); return;
            }
            if (!selectCatEntrada.options.length) {
                // O financiamento tradicional ainda pode ser cadastrado, mas o empréstimo exige categoria de entrada.
                selectCatEntrada.innerHTML = '<option value="">Cadastre uma categoria de entrada</option>';
            }
            document.getElementById('formFinanciamentoModal').reset();
            document.getElementById('tipoContratoFin').value = 'financiamento';
            document.getElementById('primeiroVencimentoFin').value = dataLocalYYYYMMDD();
            document.getElementById('dataLiberacaoEmprestimo').value = dataLocalYYYYMMDD();
            document.getElementById('qtdMesesFin').value = 48;
            document.getElementById('valorEntradaFin').value = '0';
            if (selectCatEntrada.options.length && selectCatEntrada.options[0].value) selectCatEntrada.value = selectCatEntrada.options[0].value;
            tratarMudancaTipoContrato();
            atualizarPreviewValorFinanciado();
            document.getElementById('modalNovoFinanciamento').style.display = 'flex';
        }

        function fecharModalNovoFinanciamento() {
            document.getElementById('modalNovoFinanciamento').style.display = 'none';
            document.getElementById('formFinanciamentoModal').reset();
            tratarMudancaTipoContrato();
        }

        async function salvarFinanciamentoModal(event) {
            event.preventDefault();
            const tipoContrato = document.getElementById('tipoContratoFin').value;
            const nome = document.getElementById('nomeFinanciamento').value.trim();
            const bemId = document.getElementById('bemVinculadoFin').value || null;
            const qtdMeses = parseInt(document.getElementById('qtdMesesFin').value, 10);
            const valorParcela = numeroSeguro(document.getElementById('valorParcelaFin').value);
            const primeiroVencimento = document.getElementById('primeiroVencimentoFin').value;
            const categoriaId = document.getElementById('categoriaFinanciamento').value;
            const valorLiberado = numeroSeguro(document.getElementById('valorLiberadoEmprestimo').value);
            const dataLiberacao = document.getElementById('dataLiberacaoEmprestimo').value;
            const categoriaEntradaId = document.getElementById('categoriaEntradaEmprestimo').value;
            const escopoContrato = document.getElementById('escopoContratoEmprestimo').value;
            const valorCompra = numeroSeguro(document.getElementById('valorCompraFin').value, NaN);
            const valorEntrada = numeroSeguro(document.getElementById('valorEntradaFin').value, 0);

            if (!nome || !qtdMeses || qtdMeses < 1 || qtdMeses > 360 || !Number.isFinite(valorParcela) || valorParcela <= 0 || !primeiroVencimento || !categoriaId) {
                await mostrarAlertaModal('Preencha os dados do contrato e das parcelas corretamente.'); return;
            }
            if (tipoContrato === 'financiamento' && !bemId) {
                await mostrarAlertaModal('Selecione um bem patrimonial para o financiamento.'); return;
            }
            if (tipoContrato === 'financiamento' && (!Number.isFinite(valorCompra) || valorCompra <= 0 || !Number.isFinite(valorEntrada) || valorEntrada < 0 || valorEntrada >= valorCompra)) {
                await mostrarAlertaModal('Informe o preço de compra e uma entrada entre R$ 0,00 e um valor menor que o preço de compra.'); return;
            }
            if (tipoContrato === 'emprestimo' && (valorLiberado <= 0 || !dataLiberacao || !categoriaEntradaId)) {
                await mostrarAlertaModal('Informe o valor recebido, a data de recebimento e uma categoria de entrada.'); return;
            }

            const opcoes = tipoContrato === 'emprestimo'
                ? { tipoContrato, valorLiberado, dataLiberacao, categoriaEntradaId, escopoContrato }
                : { tipoContrato, valorCompra, valorEntrada };
            const sucesso = await adicionarFinanciamentoComRecorrencia(
                nome, 'sim', valorParcela, qtdMeses, primeiroVencimento, categoriaId, bemId, opcoes
            );
            if (sucesso) {
                fecharModalNovoFinanciamento();
                carregarTabelaFinanciamentosGeral();
            }
        }

        function carregarTabelaFinanciamentosGeral() {
    const dados = obterDados();
    const tbody = document.getElementById('tabelaFinanciamentosGeral');
    if (!tbody) return;
    tbody.innerHTML = '';

    // [MODO DISCRETO]
    if (document.body.classList.contains('privacidade-ativa')) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:32px 12px;">
            <div style="display:flex;flex-direction:column;align-items:center;gap:8px;color:var(--text-muted);">
                <span style="font-size:2rem;opacity:.6;">🔒</span>
                <strong style="color:var(--text-main);">Contratos ocultos</strong>
                <span style="font-size:.82rem;">Toque no banner de privacidade para ver os financiamentos.</span>
            </div>
        </td></tr>`;
        return;
    }

    const financiamentos = filtrarDadosPorPermissao(dados.financiamentos || [], dados, 'casal').filter(f => f.ativo !== false);
    if (financiamentos.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align: center;">Nenhum contrato cadastrado.</td></tr>`;
        return;
    }

    financiamentos.forEach(f => {
        const lancamentosFin = (dados.lancamentos || []).filter(l => pertenceAoFinanciamento(l, f, dados));
        const pagos = lancamentosFin.filter(l => l.pago).length;
        const saldoDevedor = lancamentosFin.filter(l => !l.pago).reduce((acc, l) => acc + Number(l.valor || 0), 0);
        const totalMeses = Math.max(1, Number(f.totalMeses) || lancamentosFin.length || 1);
        const percentual = Math.min(100, Math.round((pagos / totalMeses) * 100)) || 0;
        const bemObj = (dados.bens || []).find(b => Number(b.id) === Number(f.bemId));
        const nomeBem = bemObj ? bemObj.nome : 'Não vinculado';

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${escaparHTML(f.nome)}</strong></td>
            <td>${f.tipoContrato === 'emprestimo' ? 'Empréstimo / Consignado' : 'Financiamento'}</td>
            <td>${escaparHTML(nomeBem)}</td>
            <td>${pagos}/${totalMeses} (${percentual}%)</td>
            <td>R$ ${Number(f.valorParcela || 0).toLocaleString('pt-BR', {minimumFractionDigits: 2})}</td>
            <td class="negativo">R$ ${saldoDevedor.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</td>
            <td>
                <button onclick="window.location.href='detalhes-financiamento.html?id=${encodeURIComponent(String(f.id))}'" class="btn-acao-icone visualizar" title="Detalhes"><img src="imagens/visualizar.png" alt="Detalhes"></button>
                ${Number(f.usuarioId) === Number(obterUsuarioAtualId()) && usuarioPode('financiamentos') ? `<button onclick="excluirFinanciamentoGeral(${Number(f.id)})" class="btn-acao-icone excluir" title="Excluir"><img src="imagens/excluir.png" alt="Excluir"></button>` : ''}
            </td>
        `;
        tbody.appendChild(tr);
    });
}
        async function excluirFinanciamentoGeral(id) {
            const sucesso = await excluirFinanciamento(id);
            if (sucesso) carregarTabelaFinanciamentosGeral();
        }
    

// ===== Eventos migrados dos atributos on* do HTML =====
// Liga apenas os elementos estáticos marcados por data-page-handler,
// sem executar JavaScript como string e sem registrar eventos em duplicidade.
(function vincularEventosDaPagina() {
    const eventos = {
        "financiamentos-1": [
            ["click", function(event) {
                abrirModalNovoFinanciamento()
            }],
        ],
        "financiamentos-2": [
            ["submit", function(event) {
                salvarFinanciamentoModal(event)
            }],
        ],
        "financiamentos-3": [
            ["change", function(event) {
                tratarMudancaTipoContrato()
            }],
        ],
        "financiamentos-4": [
            ["click", function(event) {
                window.location.href='bens.html'
            }],
        ],
        "financiamentos-5": [
            ["click", function(event) {
                fecharModalNovoFinanciamento()
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

