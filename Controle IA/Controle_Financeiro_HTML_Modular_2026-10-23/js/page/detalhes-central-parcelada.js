// Controle Financeiro | Página: detalhes-central-parcelada.html
// Arquivo extraído dos scripts embutidos no HTML original.
// Carregar APÓS js/script.js, js/calculos_trabalhistas.js e js/conexao_sheets.js.
// Mantém funções globais clássicas usadas por elementos gerados dinamicamente.

// ===== Bloco inline original 1 =====
        const urlParams = new URLSearchParams(window.location.search);
        const lancamentoIdUrl = urlParams.get('id');
        const parcelamentoIdUrl = urlParams.get('parcelamentoId');
        let paginaAtualParcelas = 1;
        const itensPorPaginaParc = 30;

        document.addEventListener('DOMContentLoaded', async () => {
            injetarHeader();
            const autenticado = await verificarAutenticacao();
            if (autenticado) {
                if (!lancamentoIdUrl && !parcelamentoIdUrl) {
                    mostrarAlertaModal('Identificador do parcelamento não especificado.').then(() => window.location.href = 'central-pagamentos.html');
                } else {
                    carregarDetalhesParceladaPagina();
                }
            }
        });

        function obterParcelasDoGrupo(dados) {
            const lancamentos = filtrarDadosPorPermissao(dados.lancamentos || [], dados, 'casal').filter(l => usuarioPodeAlterarLancamento(l, dados) || l.usuarioId == null);
            let grupo = [];
            if (parcelamentoIdUrl) {
                grupo = lancamentos.filter(l => String(l.parcelamentoId || '') === String(parcelamentoIdUrl));
            } else if (lancamentoIdUrl) {
                const referencia = lancamentos.find(l => String(l.id) === String(lancamentoIdUrl));
                if (!referencia) return [];
                grupo = referencia.parcelamentoId
                    ? lancamentos.filter(l => String(l.parcelamentoId) === String(referencia.parcelamentoId))
                    : [referencia];
            }
            return grupo.sort((a, b) => {
                const parcelaA = Number(a.parcelaAtual || 0), parcelaB = Number(b.parcelaAtual || 0);
                if (parcelaA !== parcelaB) return parcelaA - parcelaB;
                return String(a.vencimento || '').localeCompare(String(b.vencimento || ''));
            });
        }

         function statusBadge(lancamento) {
            const status = lancamento.status || (lancamento.pago ? 'pago' : 'pendente');
            const texto = status === 'pago' ? 'Pago' : status === 'atrasado' ? 'Atrasado' : 'Pendente';
            const classe = status === 'pago' ? 'status-pago' : status === 'atrasado' ? 'status-atrasado' : 'status-pendente';
            return `<span class="status-badge ${classe}">${texto}</span>`;
        }

        function mudarPaginaParcelasGrupo(novaPagina) {
            paginaAtualParcelas = novaPagina;
            carregarDetalhesParceladaPagina();
        }

        function carregarDetalhesParceladaPagina() {
    const dados = obterDados();

    // [MODO DISCRETO] — oculta tudo (parcelas e valores)
    if (document.body.classList.contains('privacidade-ativa')) {
        const campos = [
            'infoValorTotalCompra','infoProgressoParcelas','infoValorParcela','infoTerminoParcelamento'
        ];
        campos.forEach(id => { const el = document.getElementById(id); if (el) el.textContent = '•••'; });
        const desc = document.getElementById('detalheDescricaoBase');
        if (desc) desc.value = '••••••••';
        const forma = document.getElementById('detalheFormaPagamento');
        if (forma) forma.value = '••••••••';
        const tbody = document.getElementById('tabelaParcelasGrupo');
        if (tbody) tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:32px 12px;">
            <div style="display:flex;flex-direction:column;align-items:center;gap:8px;color:var(--text-muted);">
                <span style="font-size:2rem;opacity:.6;">🔒</span>
                <strong style="color:var(--text-main);">Parcelas ocultas</strong>
                <span style="font-size:.82rem;">Toque no banner de privacidade para ver os detalhes.</span>
            </div>
        </td></tr>`;
        const pagTopo = document.getElementById('paginacaoTopoParcelas');
        const pagRod = document.getElementById('paginacaoRodapeParcelas');
        if (pagTopo) pagTopo.innerHTML = '';
        if (pagRod) pagRod.innerHTML = '';
        return;
    }

    const parcelas = obterParcelasDoGrupo(dados);
    if (!parcelas.length) {
        mostrarAlertaModal('Nenhum registro de parcelamento encontrado.').then(() => window.location.href = 'central-pagamentos.html');
        return;
    }

    const primeira = parcelas[0];
    const baseDesc = descricaoBaseParcelamento(primeira.descricao || '');

    const elTitulo = document.getElementById('tituloParcelamentoDetalhe');
    if (elTitulo) elTitulo.textContent = `Parcelamento: ${baseDesc}`;

    const elDescBase = document.getElementById('detalheDescricaoBase');
    if (elDescBase) elDescBase.value = baseDesc;

    let infoForma = primeira.formaPagamento || 'BOLETO';
    if (infoForma === 'CARTAO' && primeira.cartaoId) {
        const cartaoObj = (dados.cartoes || []).find(c => String(c.id) === String(primeira.cartaoId));
        infoForma = `Cartão de Crédito (${cartaoObj ? cartaoObj.nome : 'Cartão'})`;
    }
    const elForma = document.getElementById('detalheFormaPagamento');
    if (elForma) elForma.value = infoForma;

    const totalCompra = parcelas.reduce((acc, p) => acc + Number(p.valor || 0), 0);
    const pagas = parcelas.filter(p => p.pago === true || p.status === 'pago').length;
    const totalQtd = parcelas.length;

    const elTotal = document.getElementById('infoValorTotalCompra');
    if (elTotal) elTotal.textContent = formatarMoeda(totalCompra);
    const elProg = document.getElementById('infoProgressoParcelas');
    if (elProg) elProg.textContent = `${pagas} / ${totalQtd}`;
    const elValP = document.getElementById('infoValorParcela');
    if (elValP) elValP.textContent = formatarMoeda(primeira.valor || 0);

    const ultima = parcelas[parcelas.length - 1];
    const elTerm = document.getElementById('infoTerminoParcelamento');
    if (ultima && ultima.vencimento && elTerm) {
        const partesVenc = ultima.vencimento.split('-');
        elTerm.textContent = partesVenc.length === 3 ? `${partesVenc[1]}/${partesVenc[0]}` : '--/----';
    }

    const totalPaginas = Math.ceil(parcelas.length / itensPorPaginaParc) || 1;
    if (paginaAtualParcelas > totalPaginas) paginaAtualParcelas = totalPaginas;

    const inicio = (paginaAtualParcelas - 1) * itensPorPaginaParc;
    const fim = inicio + itensPorPaginaParc;
    const parcelasPagina = parcelas.slice(inicio, fim);

    const renderizarPaginacaoHtml = () => {
        if (totalPaginas <= 1) return '';
        let optionsSelect = '';
        for (let p = 1; p <= totalPaginas; p++) {
            const parcelaInicialBloco = ((p - 1) * itensPorPaginaParc) + 1;
            const parcelaFinalBloco = Math.min(p * itensPorPaginaParc, parcelas.length);
            optionsSelect += `<option value="${p}" ${p === paginaAtualParcelas ? 'selected' : ''}>Parcelas ${parcelaInicialBloco} a ${parcelaFinalBloco}</option>`;
        }
        return `
            <button type="button" class="btn-secundario" ${paginaAtualParcelas === 1 ? 'disabled style="opacity:0.5;"' : ''} onclick="mudarPaginaParcelasGrupo(${paginaAtualParcelas - 1})">← Anterior</button>
            <div style="display: flex; align-items: center; gap: 6px;">
                <span style="font-size: 0.85rem; font-weight: bold;">Salto:</span>
                <select onchange="mudarPaginaParcelasGrupo(Number(this.value))" style="padding: 4px 8px; border-radius: 6px; border: 1px solid var(--border); font-size: 0.85rem; background: var(--surface); color: var(--text-main);">
                    ${optionsSelect}
                </select>
                <span style="font-size: 0.85rem; font-weight: bold;">(Pág. ${paginaAtualParcelas}/${totalPaginas})</span>
            </div>
            <button type="button" class="btn-secundario" ${paginaAtualParcelas === totalPaginas ? 'disabled style="opacity:0.5;"' : ''} onclick="mudarPaginaParcelasGrupo(${paginaAtualParcelas + 1})">Próxima →</button>
        `;
    };

    const htmlPaginacao = renderizarPaginacaoHtml();
    document.getElementById('paginacaoTopoParcelas').innerHTML = htmlPaginacao;
    document.getElementById('paginacaoRodapeParcelas').innerHTML = htmlPaginacao;

    const tbody = document.getElementById('tabelaParcelasGrupo');
    if (!tbody) return;
    tbody.innerHTML = '';

    parcelasPagina.forEach(l => {
        const cat = (dados.categorias || []).find(c => String(c.id) === String(l.categoriaId));
        const tr = document.createElement('tr');
        const rotuloParcela = `${l.parcelaAtual || '-'} / ${l.totalParcelas || totalQtd}`;
        tr.innerHTML = `
            <td><strong>${escaparHTML(rotuloParcela)}</strong></td>
            <td>${escaparHTML(formatarDataBR(l.vencimento || ''))}</td>
            <td>${escaparHTML(cat?.nome || 'Geral')}</td>
            <td>${escaparHTML(formatarMoeda(l.valor || 0))}</td>
            <td>${statusBadge(l)}</td>
            <td class="action-cell">
                <button type="button" onclick="editarValorParcelaGrupo(${Number(l.id)})" class="btn-acao-icone editar" title="Editar valor">✎</button>
                ${l.formaPagamento === 'CARTAO'
                    ? `<a href="grafico.html?tipo=cartao&cartaoId=${l.cartaoId}&mes=${String(l.vencimento).slice(0, 7)}" class="btn-acao-icone" title="Gerenciar Fatura" style="display:inline-flex; align-items:center; justify-content:center; text-decoration:none;"><span style="font-size:16px;">💳</span></a>`
                    : `<button type="button" onclick="alternarStatusPagamentoParcela(${Number(l.id)})" class="btn-acao-icone ${(l.pago === true || l.status === 'pago') ? 'desfazer' : 'pagar'}" title="Alterar status">${(l.pago === true || l.status === 'pago') ? '↩' : '✓'}</button>`}
            </td>`;
        tbody.appendChild(tr);
    });
}

        async function editarValorParcelaGrupo(lancamentoId) {
            const valorStr = await mostrarPromptModal('Editar valor da parcela', 'Digite o novo valor (R$):');
            if (valorStr === null) return;
            const novoValor = numeroSeguro(String(valorStr).replace(',', '.'));
            if (novoValor <= 0) {
                await mostrarAlertaModal('Valor inválido.'); 
                return;
            }
            if (!await exigirPermissao('criarMovimento', 'editar valores de parcelas')) return;
            const dados = obterDados();
            const lanc = (dados.lancamentos || []).find(l => String(l.id) === String(lancamentoId));
            if (!lanc || !usuarioPodeAlterarLancamento(lanc, dados)) {
                await mostrarAlertaModal('Você não tem permissão para editar esta parcela.');
                return;
            }
            lanc.valor = Number(novoValor.toFixed(2));
            lanc.updatedAt = new Date().toISOString();
            registrarLog(dados, 'EDIÇÃO VALOR PARCELA', `Parcela ID ${lancamentoId} alterada para ${formatarMoeda(novoValor)}`);
            await salvarDados(dados);
            notificarOperacao('Valor atualizado. Sincronização em segundo plano.');
            carregarDetalhesParceladaPagina();
        }

        async function alternarStatusPagamentoParcela(lancamentoId) {
            const ok = await alternarStatusPagamento(lancamentoId);
            if (ok) carregarDetalhesParceladaPagina();
        }

    

