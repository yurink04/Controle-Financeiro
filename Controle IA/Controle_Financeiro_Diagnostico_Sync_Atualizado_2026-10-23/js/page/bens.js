// Controle Financeiro | Página: bens.html
// Arquivo extraído dos scripts embutidos no HTML original.
// Carregar APÓS js/script.js, js/calculos_trabalhistas.js e js/conexao_sheets.js.
// Mantém funções globais clássicas usadas por elementos gerados dinamicamente.

// ===== Bloco inline original 1 =====
        document.addEventListener('DOMContentLoaded', async () => {
            injetarHeader();
            const autenticado = await verificarAutenticacao();
            if (autenticado) carregarTabelaBensGeral();
        });

        function abrirModalNovoBem() {
            document.getElementById('modalNovoBem').style.display = 'flex';
            atualizarCampoEspecificoBem();
        }

        function fecharModalNovoBem() {
            document.getElementById('modalNovoBem').style.display = 'none';
            const form = document.getElementById('formBemModal');
            form.reset();
            delete form.dataset.editId;
            document.querySelector('#modalNovoBem h3').textContent = 'Cadastrar Bem Patrimonial';
        }

        function atualizarCampoEspecificoBem() {
            const tipo = document.getElementById('tipoBem').value;
            const label = document.getElementById('labelCampoEspecifico');
            const input = document.getElementById('campoEspecifico');
            const grupo = document.getElementById('grupoCampoEspecifico');

            if (tipo === 'veiculo') {
                grupo.style.display = 'block';
                label.textContent = 'Placa ou Final da Placa';
                input.placeholder = 'Ex.: ABC-1234 ou 1234';
                input.required = true;
            } else if (tipo === 'imovel') {
                grupo.style.display = 'block';
                label.textContent = 'CEP ou Final do CEP';
                input.placeholder = 'Ex.: 13000-000 ou 000';
                input.required = true;
            } else {
                grupo.style.display = 'none';
                input.required = false;
            }
        }

        async function salvarBemModal(event) {
            event.preventDefault();
            const nome = document.getElementById('nomeBem').value.trim();
            const tipo = document.getElementById('tipoBem').value;
            const valor = numeroSeguro(document.getElementById('valorBem').value);
            const campoEspecifico = document.getElementById('campoEspecifico').value.trim();
            const statusBem = document.getElementById('statusBem').value;
            const compartilhado = document.getElementById('bemCompartilhado').checked;
            const editId = document.getElementById('formBemModal').dataset.editId;

            if (!nome || valor < 0) { await mostrarAlertaModal('Preencha os campos corretamente.'); return; }
            if ((tipo === 'veiculo' || tipo === 'imovel') && !campoEspecifico) {
                await mostrarAlertaModal(tipo === 'veiculo' ? 'Informe a placa.' : 'Informe o CEP.');
                return;
            }

            mostrarLoading(editId ? "A atualizar bem..." : "A salvar bem...");
            const dados = obterDados();
            const usuarioId = Number(obterUsuarioAtualId());

            if (editId) {
                const b = (dados.bens || []).find(x => String(x.id) === String(editId) && Number(x.usuarioId) === usuarioId);
                if (!b) { esconderLoading(); await mostrarAlertaModal('Bem não encontrado ou sem permissão.'); return; }
                b.nome = nome; b.tipo = tipo; b.valor = Number(valor.toFixed(2));
                b.identificadorEspecifico = campoEspecifico; b.statusBem = statusBem; b.compartilhado = compartilhado;
                b.updatedAt = new Date().toISOString();
                registrarLog(dados, "EDIÇÃO BEM", `Bem atualizado: ${nome}`);
                await salvarDados(dados);
                esconderLoading(); fecharModalNovoBem(); carregarTabelaBensGeral();
                notificarOperacao('Bem atualizado. Sincronização em segundo plano.');
                return;
            }

            const bemId = dados.bens.reduce((m, b) => Math.max(m, Number(b.id) || 0), 0) + 1;
            dados.bens.push({
                id: bemId, usuarioId, nome, tipo, valor: Number(valor.toFixed(2)),
                identificadorEspecifico: campoEspecifico, statusBem, compartilhado, ativo: true,
                createdAt: new Date().toISOString()
            });
            registrarLog(dados, "CADASTRO BEM", `Bem cadastrado: ${nome} (${tipo})`, { entidade: 'bem', entidadeId: bemId });
            await salvarDados(dados);
            esconderLoading(); fecharModalNovoBem(); carregarTabelaBensGeral();

            if (statusBem === 'financiado') {
                const criar = await mostrarConfirmacaoModal("Bem cadastrado! Deseja criar o financiamento agora?");
                if (criar) window.location.href = 'financiamentos.html';
            } else {
                notificarOperacao('Bem cadastrado. Sincronização em segundo plano.');
            }
        }

        function prepararEdicaoBem(id) {
            const dados = obterDados();
            const usuarioAtualId = Number(obterUsuarioAtualId());
            const b = (dados.bens || []).find(x => Number(x.id) === Number(id));
            if (!b) { mostrarAlertaModal('Bem não encontrado.'); return; }
            if (Number(b.usuarioId) !== usuarioAtualId) { mostrarAlertaModal('Você só pode editar bens vinculados ao seu usuário.'); return; }
            document.getElementById('nomeBem').value = b.nome || '';
            document.getElementById('tipoBem').value = b.tipo || 'veiculo';
            document.getElementById('valorBem').value = b.valor || 0;
            document.getElementById('campoEspecifico').value = b.identificadorEspecifico || '';
            document.getElementById('statusBem').value = b.statusBem || 'quitado';
            document.getElementById('bemCompartilhado').checked = !!b.compartilhado;
            atualizarCampoEspecificoBem();
            document.getElementById('formBemModal').dataset.editId = String(b.id);
            document.querySelector('#modalNovoBem h3').textContent = 'Editar Bem';
            document.getElementById('modalNovoBem').style.display = 'flex';
        }

        function carregarTabelaBensGeral() {
            const dados = obterDados();
            const tbody = document.getElementById('tabelaBensGeral');
            if (!tbody) return;
            tbody.innerHTML = '';

            // [MODO DISCRETO]
            if (document.body.classList.contains('privacidade-ativa')) {
                tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:32px 12px;">
                    <div style="display:flex;flex-direction:column;align-items:center;gap:8px;color:var(--text-muted);">
                        <span style="font-size:2rem;opacity:.6;">🔒</span>
                        <strong style="color:var(--text-main);">Bens ocultos</strong>
                        <span style="font-size:.82rem;">Toque no banner de privacidade para ver os bens.</span>
                    </div>
                </td></tr>`;
                return;
            }

            const usuarioId = Number(obterUsuarioAtualId());
            const usuario = dados.usuarios.find(u => Number(u.id) === usuarioId) || {};
            const parceiroId = Number(usuario.parceiroId) || 0;

            // CORREÇÃO: mesma regra usada em perfil.html — próprios + do parceiro real.
            const bens = (dados.bens || []).filter(b => {
                if (b.ativo === false) return false;
                const dono = Number(b.usuarioId);
                if (!dono || dono === usuarioId) return true;
                return b.compartilhado === true && parceiroId > 0 && dono === parceiroId;
            });

            if (bens.length === 0) {
                tbody.innerHTML = `<tr><td colspan="5" style="text-align: center;">Nenhum bem cadastrado.</td></tr>`;
                return;
            }

            bens.forEach(b => {
                const financiamentoVinculado = (dados.financiamentos || []).find(f => Number(f.bemId) === Number(b.id) && f.ativo !== false);

                let statusHtml = '';
                if (financiamentoVinculado) {
                    statusHtml = `<a href="detalhes-financiamento.html?id=${encodeURIComponent(String(financiamentoVinculado.id))}" class="text-link">Financiado (${escaparHTML(financiamentoVinculado.nome)})</a>`;
                } else if (b.statusBem === 'financiado') {
                    statusHtml = `<a href="financiamentos.html" class="text-link" style="color: var(--warning);">Financiado (Sem contrato atrelado)</a>`;
                } else {
                    statusHtml = `<span class="status-badge status-pago">Quitado</span>`;
                }

                const infoExtra = b.identificadorEspecifico
                    ? `<br><small style="color: var(--text-muted);">${b.tipo === 'veiculo' ? 'Placa:' : 'CEP:'} ${escaparHTML(b.identificadorEspecifico)}</small>`
                    : '';

                // CORREÇÃO: agora renderiza as 5 colunas declaradas no <thead>.
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>
                        <strong>${escaparHTML(b.nome || 'Sem nome')}</strong>
                        ${infoExtra}
                    </td>
                    <td>${escaparHTML(String(b.tipo || 'outro').toUpperCase())}</td>
                    <td>${statusHtml}</td>
                    <td>R$ ${Number(b.valor || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                    <td>
                        <button onclick="prepararEdicaoBem(${Number(b.id)})" class="btn-acao-icone editar" title="Editar"><img src="imagens/editar.png" alt="Editar"></button>
                        <button onclick="excluirBemGeral(${Number(b.id)})" class="btn-acao-icone excluir" title="Excluir"><img src="imagens/excluir.png" alt="Excluir"></button>
                    </td>
                `;
                tbody.appendChild(tr);
            });
        }

        async function excluirBemGeral(id) {
            // CORREÇÃO: valida propriedade antes de qualquer ação sensível.
            const dadosCheck = obterDados();
            const bem = (dadosCheck.bens || []).find(b => Number(b.id) === Number(id));
            if (!bem) {
                await mostrarAlertaModal('Bem não encontrado.');
                return;
            }
            if (Number(bem.usuarioId) !== Number(obterUsuarioAtualId())) {
                await mostrarAlertaModal('Você só pode excluir bens vinculados ao seu usuário.');
                return;
            }

            const financiamentoVinculado = (dadosCheck.financiamentos || []).find(f => Number(f.bemId) === Number(id) && f.ativo !== false);
            if (financiamentoVinculado) {
                await mostrarAlertaModal(`Este bem está vinculado ao financiamento "${financiamentoVinculado.nome}". Exclua ou desvincule o financiamento antes de excluir o bem.`);
                return;
            }

            if (!await verificarSenhaAdmin("excluir bem")) return;

            const confirmar = await mostrarConfirmacaoModal("Deseja realmente excluir este bem?");
            if (!confirmar) return;

            mostrarLoading("A excluir...");
            const dados = obterDados();
            dados.bens = dados.bens.filter(b => String(b.id) !== String(id));

            registrarLog(dados, "EXCLUSÃO BEM", `Bem excluído (ID: ${id})`);
            await salvarDados(dados);

            esconderLoading();
            carregarTabelaBensGeral();
        }
    

// ===== Eventos migrados dos atributos on* do HTML =====
// Liga apenas os elementos estáticos marcados por data-page-handler,
// sem executar JavaScript como string e sem registrar eventos em duplicidade.
(function vincularEventosDaPagina() {
    const eventos = {
        "bens-1": [
            ["click", function(event) {
                abrirModalNovoBem()
            }],
        ],
        "bens-2": [
            ["submit", function(event) {
                salvarBemModal(event)
            }],
        ],
        "bens-3": [
            ["change", function(event) {
                atualizarCampoEspecificoBem()
            }],
        ],
        "bens-4": [
            ["click", function(event) {
                fecharModalNovoBem()
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

