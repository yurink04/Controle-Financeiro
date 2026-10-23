// Controle Financeiro | Página: cartoes.html
// Arquivo extraído dos scripts embutidos no HTML original.
// Carregar APÓS js/script.js, js/calculos_trabalhistas.js e js/conexao_sheets.js.
// Mantém funções globais clássicas usadas por elementos gerados dinamicamente.

// ===== Bloco inline original 1 =====
        document.addEventListener('DOMContentLoaded', async () => {
            injetarHeader();
            const autenticado = await verificarAutenticacao();
            if (autenticado) {
                renderizarCartoes();
                if (!usuarioPode('criarMovimento')) {
                    const formCartao = document.getElementById('formCartao');
                    if (formCartao) formCartao.closest('.form-card').hidden = true;
                }
            }
        });

        function alternarCamposBeneficio() {
            const isBeneficio = document.getElementById('isBeneficioCartao').checked;
            const camposCredito = document.getElementById('camposCredito');
            const labelLimite = document.getElementById('labelLimiteCartao');
            const fechamentoInput = document.getElementById('fechamentoCartao');
            const vencimentoInput = document.getElementById('vencimentoCartao');

            if (isBeneficio) {
                camposCredito.style.display = 'none';
                labelLimite.textContent = 'Saldo Inicial / Atual (R$)';
                fechamentoInput.required = false;
                vencimentoInput.required = false;
            } else {
                camposCredito.style.display = 'grid';
                labelLimite.textContent = 'Limite total (R$)';
                fechamentoInput.required = true;
                vencimentoInput.required = true;
            }
        }

        async function salvarCartaoForm(event) {
            event.preventDefault();
            if (!await exigirPermissao('criarMovimento', 'criar ou editar cartões')) return;
            const idEdit = document.getElementById('cartaoIdEdit').value;
            const nome = document.getElementById('nomeCartao').value.trim();
            const limite = numeroSeguro(document.getElementById('limiteCartao').value);
            const isBeneficio = document.getElementById('isBeneficioCartao').checked;
            
            const fechamento = isBeneficio ? null : inteiroSeguro(document.getElementById('fechamentoCartao').value);
            const vencimento = isBeneficio ? null : inteiroSeguro(document.getElementById('vencimentoCartao').value);

            const dados = obterDados();
            dados.cartoes = dados.cartoes || [];
            
            // Limpeza: não precisa mais de parâmetro (dados)
            const usuarioAtualId = Number(obterUsuarioAtualId());

            if (!nome || !Number.isFinite(limite) || limite < 0 || (!isBeneficio && (!Number.isInteger(fechamento) || fechamento < 1 || fechamento > 31 || !Number.isInteger(vencimento) || vencimento < 1 || vencimento > 31))) {
                await mostrarAlertaModal('Confira o nome, limite/saldo e os dias de fechamento/vencimento do cartão.');
                return;
            }

            if (idEdit) {
                const c = dados.cartoes.find(card => Number(card.id) === Number(idEdit) && Number(card.usuarioId) === usuarioAtualId);
                if (!c) {
                    await mostrarAlertaModal('Você só pode editar cartões vinculados ao seu usuário.');
                    return;
                }
                const possuiMovimentos = (dados.lancamentos || []).some(l => String(l.cartaoId) === String(c.id));
                if (possuiMovimentos && Boolean(c.isBeneficio) !== Boolean(isBeneficio)) {
                    await mostrarAlertaModal('Não é possível mudar o tipo de um cartão que já possui movimentações vinculadas.');
                    return;
                }
                c.nome = nome;
                c.limite = limite;
                c.fechamento = fechamento;
                c.vencimento = vencimento;
                c.isBeneficio = isBeneficio;
                c.tipoCartao = isBeneficio ? 'beneficio' : 'credito';
                c.updatedAt = new Date().toISOString();
                registrarLog(dados, "EDIÇÃO CARTÃO", `Cartão atualizado: ${nome}`);
            } else {
                const novoId = dados.cartoes.reduce((m, c) => Math.max(m, Number(c.id) || 0), 0) + 1;
                dados.cartoes.push({
                    id: novoId,
                    usuarioId: usuarioAtualId,
                    nome,
                    limite,
                    fechamento,
                    vencimento,
                    isBeneficio,
                    tipoCartao: isBeneficio ? 'beneficio' : 'credito',
                    ativo: true,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                });
                registrarLog(dados, "NOVO CARTÃO", `Cartão cadastrado: ${nome}`);
            }

            await salvarDados(dados);
            cancelarEdicaoCartao();
            renderizarCartoes();
            notificarOperacao('Cartão salvo. Sincronização em segundo plano.');
        }

        function renderizarCartoes() {
    const dados = obterDados();
    const gridCredito = document.getElementById('gridCartoesCredito');
    const gridBeneficio = document.getElementById('gridCartoesBeneficio');
    if (!gridCredito || !gridBeneficio) return;

    // [MODO DISCRETO]
    if (document.body.classList.contains('privacidade-ativa')) {
        const ph = `<div class="empty-state" style="grid-column: span 3; padding: 32px;">
            <div style="display:flex;flex-direction:column;align-items:center;gap:8px;color:var(--text-muted);">
                <span style="font-size:2rem;opacity:.6;">🔒</span>
                <strong style="color:var(--text-main);">Cartões ocultos</strong>
                <span style="font-size:.82rem;">Toque no banner de privacidade para revelar.</span>
            </div>
        </div>`;
        gridCredito.innerHTML = ph;
        gridBeneficio.innerHTML = ph;
        return;
    }

    gridCredito.innerHTML = '';
    gridBeneficio.innerHTML = '';

    const cartoesPermitidos = filtrarDadosPorPermissao(dados.cartoes || [], dados, 'casal').filter(c => c.ativo !== false);
    const creditos = cartoesPermitidos.filter(c => !c.isBeneficio);
    const beneficios = cartoesPermitidos.filter(c => c.isBeneficio);

    const uId = Number(obterUsuarioAtualId());

    if (creditos.length === 0) {
        gridCredito.innerHTML = `<div class="empty-state" style="grid-column: span 3;"><strong>Nenhum cartão de crédito cadastrado.</strong></div>`;
    } else {
        creditos.forEach(c => {
            const div = document.createElement('div');
            div.className = 'form-card card-visual';
            div.style.marginBottom = '0';
            div.innerHTML = `
                <span class="status-badge status-pendente" style="margin-bottom: 8px; display: inline-block;">CRÉDITO</span>
                <h3 style="margin-bottom: 6px;">${escaparHTML(c.nome)}</h3>
                <p class="muted small">Limite: <strong>R$ ${Number(c.limite || 0).toLocaleString('pt-BR', {minimumFractionDigits: 2})}</strong></p>
                <p class="muted small" style="margin-top: 2px;">Fechamento: Dia ${c.fechamento} | Vencimento: Dia ${c.vencimento}</p>
                ${Number(c.usuarioId) === uId && usuarioPode('criarMovimento') ? `<div style="margin-top: 14px; display: flex; gap: 6px;"><button onclick="prepararEdicaoCartao(${Number(c.id)})" class="btn-secundario small" style="padding: 6px 12px;">Editar</button></div>` : ''}
            `;
            gridCredito.appendChild(div);
        });
    }

    if (beneficios.length === 0) {
        gridBeneficio.innerHTML = `<div class="empty-state" style="grid-column: span 3;"><strong>Nenhum cartão de benefício (VR/VA) cadastrado.</strong></div>`;
    } else {
        beneficios.forEach(c => {
            const lancamentos = dados.lancamentos || [];
            const saldoAtual = lancamentos.reduce((acc, l) => {
                if (Number(l.cartaoId) === Number(c.id)) {
                    return l.tipo === 'entrada' ? acc + Number(l.valor) : acc - Number(l.valor);
                }
                return acc;
            }, Number(c.limite || 0));

            const div = document.createElement('div');
            div.className = 'form-card card-visual';
            div.style.marginBottom = '0';
            div.innerHTML = `
                <span class="status-badge status-pago" style="margin-bottom: 8px; display: inline-block;">BENEFÍCIO (VR/VA)</span>
                <h3 style="margin-bottom: 6px;">${escaparHTML(c.nome)}</h3>
                <p class="muted small">Saldo Atual: <strong class="positivo">R$ ${saldoAtual.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</strong></p>
                ${Number(c.usuarioId) === uId && usuarioPode('criarMovimento') ? `<div style="margin-top: 14px; display: flex; gap: 6px;"><button onclick="prepararEdicaoCartao(${Number(c.id)})" class="btn-secundario small" style="padding: 6px 12px;">Editar</button></div>` : ''}
            `;
            gridBeneficio.appendChild(div);
        });
    }
}

        function prepararEdicaoCartao(id) {
            const dados = obterDados();
            const c = (dados.cartoes || []).find(card => Number(card.id) === Number(id) && Number(card.usuarioId) === Number(obterUsuarioAtualId()));
            if (!c || !usuarioPode('criarMovimento')) {
                mostrarAlertaModal('Você só pode editar cartões próprios e com permissão de alteração.');
                return;
            }

            document.getElementById('cartaoIdEdit').value = c.id;
            document.getElementById('nomeCartao').value = c.nome;
            document.getElementById('limiteCartao').value = c.limite;
            document.getElementById('isBeneficioCartao').checked = !!c.isBeneficio;
            
            if (!c.isBeneficio) {
                document.getElementById('fechamentoCartao').value = c.fechamento;
                document.getElementById('vencimentoCartao').value = c.vencimento;
            }

            alternarCamposBeneficio();

            document.getElementById('tituloFormCartao').textContent = 'Editar cartão';
            document.getElementById('btnSalvarCartao').textContent = 'Atualizar cartão';
            document.getElementById('btnCancelarCartao').style.display = 'inline-flex';
            document.getElementById('nomeCartao').focus();
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }

        function cancelarEdicaoCartao() {
            document.getElementById('cartaoIdEdit').value = '';
            document.getElementById('formCartao').reset();
            document.getElementById('isBeneficioCartao').checked = false;
            alternarCamposBeneficio();
            document.getElementById('tituloFormCartao').textContent = 'Novo cartão';
            document.getElementById('btnSalvarCartao').textContent = 'Salvar cartão';
            document.getElementById('btnCancelarCartao').style.display = 'none';
        }
    

// ===== Eventos migrados dos atributos on* do HTML =====
// Liga apenas os elementos estáticos marcados por data-page-handler,
// sem executar JavaScript como string e sem registrar eventos em duplicidade.
(function vincularEventosDaPagina() {
    const eventos = {
        "cartoes-1": [
            ["submit", function(event) {
                salvarCartaoForm(event)
            }],
        ],
        "cartoes-2": [
            ["change", function(event) {
                alternarCamposBeneficio()
            }],
        ],
        "cartoes-3": [
            ["click", function(event) {
                cancelarEdicaoCartao()
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

