// Controle Financeiro | Página: configuracoes.html
// Arquivo extraído dos scripts embutidos no HTML original.
// Carregar APÓS js/script.js, js/calculos_trabalhistas.js e js/conexao_sheets.js.
// Mantém funções globais clássicas usadas por elementos gerados dinamicamente.

// ===== Bloco inline original 1 =====
        document.addEventListener('DOMContentLoaded', async () => {
            injetarHeader();
            const autenticado = await verificarAutenticacao();
            if (autenticado) {
                document.querySelectorAll('[data-account-logs]').forEach(el => el.hidden = !usuarioPode('logs'));
                const acessoUsuarios = usuarioPode('usuarios');
                document.getElementById('btnNovoUsuarioConfig').hidden = !acessoUsuarios;
                document.getElementById('btnAcessarLogsConfig').hidden = !usuarioPode('logs');
                document.getElementById('buscarUsuarioConfig').addEventListener('input', renderizarTabelaUsuariosConfig);
                document.getElementById('filtrarUsuarioConfig').addEventListener('change', renderizarTabelaUsuariosConfig);
                document.getElementById('formUsuarioModal').querySelectorAll('.account-permissions-grid input').forEach(input => input.addEventListener('change', atualizarResumoPermissoes));
                document.getElementById('modalUsuario').addEventListener('click', event => {
                    if (event.target === event.currentTarget) fecharModalUsuario();
                });
                document.addEventListener('keydown', event => {
                    if (event.key === 'Escape' && !document.getElementById('modalUsuario').hidden) fecharModalUsuario();
                });
                renderizarTabelaUsuariosConfig();
            }
        });

        function atualizarResumoPermissoes() {
            const marcadas = document.querySelectorAll('.account-permissions-grid input:checked').length;
            document.getElementById('resumoPermissoesConfig').textContent = `${marcadas} de 12 selecionadas`;
            document.getElementById('avisoPerfilAdmin').hidden = document.getElementById('perfilUsuarioModal').value !== 'admin';
        }

        function renderizarTabelaUsuariosConfig() {
            const dados = obterDados();
            const tbody = document.getElementById('tabelaUsuariosConfig');
            if (!tbody) return;
            tbody.innerHTML = '';

            const todos = dados.usuarios || [];
            document.getElementById('configTotalUsuarios').textContent = todos.length;
            document.getElementById('configUsuariosAtivos').textContent = todos.filter(u => u.ativo !== false).length;
            document.getElementById('configAdministradores').textContent = todos.filter(u => u.permissoes?.perfil === 'admin').length;
            const termo = normalizarTexto(document.getElementById('buscarUsuarioConfig').value.trim());
            const status = document.getElementById('filtrarUsuarioConfig').value;
            const usuarios = todos.filter(u => {
                if (status === 'ativos' && u.ativo === false) return false;
                if (status === 'inativos' && u.ativo !== false) return false;
                const parceiro = todos.find(p => String(p.id) === String(u.parceiroId))?.nome || '';
                return !termo || normalizarTexto(`${u.nome || ''} ${u.usuario || ''} ${u.permissoes?.perfil || ''} ${parceiro}`).includes(termo);
            });
            document.getElementById('contadorUsuariosConfig').textContent = `Exibindo ${usuarios.length} de ${todos.length} usuários`;
            if (usuarios.length === 0) {
                tbody.innerHTML = `<tr><td colspan="4" class="account-table-empty">${todos.length ? 'Nenhum usuário corresponde aos filtros.' : 'Nenhum usuário cadastrado.'}</td></tr>`;
                return;
            }

            usuarios.forEach(u => {
                const tr = document.createElement('tr');
                const statusBadge = u.ativo !== false 
                    ? '<span class="account-status-badge is-active">● Ativo</span>'
                    : '<span class="account-status-badge is-inactive">● Inativo</span>';
                
                const perfilNome = u.permissoes?.perfil ? u.permissoes.perfil.toUpperCase() : 'PERSONALIZADO';
                const rendaFixaStr = `R$ ${Number(u.rendaFixa || 0).toLocaleString('pt-BR', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
                
                let parceiroNome = 'Nenhum';
                if (u.parceiroId) {
                    const pObj = usuarios.find(x => Number(x.id) === Number(u.parceiroId));
                    if (pObj) parceiroNome = pObj.nome;
                }

                tr.innerHTML = `
                    <td data-label="Usuário"><strong>${escaparHTML(u.nome || 'Sem nome')}</strong><small class="account-subtle-line">${escaparHTML(u.usuario || '')}</small></td>
                    <td data-label="Status">${statusBadge}</td>
                    <td data-label="Detalhes"><span class="account-role-tag">${escaparHTML(perfilNome)}</span><div class="account-user-meta">Renda: <strong>${rendaFixaStr}</strong></div><div class="account-user-meta">Parceiro: ${escaparHTML(parceiroNome)}</div></td>
                    <td data-label="Ações">
                        <div class="account-row-buttons">
                            ${usuarioPode('usuarios') ? `<button type="button" onclick="abrirModalUsuario(${Number(u.id)})" class="account-mini-button" title="Editar usuário">✎ Editar</button>
                            <button type="button" onclick="excluirOuDesativarUsuario(${Number(u.id)})" class="account-mini-button account-mini-danger" title="Excluir ou desativar usuário">Desativar / excluir</button>` : '<span class="muted">Sem permissão de edição</span>'}
                        </div>
                    </td>
                `;
                tbody.appendChild(tr);
            });
        }

        function popularSelectParceiros(usuarioAtualId = null) {
            const dados = obterDados();
            const select = document.getElementById('parceiroUsuarioModal');
            select.innerHTML = '<option value="">Nenhum (Apenas Individual)</option>';

            const usuarios = dados.usuarios || [];
            usuarios.forEach(u => {
                if (usuarioAtualId && Number(u.id) === Number(usuarioAtualId)) return;
                const opt = document.createElement('option');
                opt.value = u.id;
                opt.textContent = u.nome;
                select.appendChild(opt);
            });
        }

        function aplicarPerfilPredefinido() {
            const perfil = document.getElementById('perfilUsuarioModal').value;
            
            const pDash = document.getElementById('pDashboard');
            const pRel = document.getElementById('pRelatorios');
            const pLanc = document.getElementById('pLancamentos');
            const pCart = document.getElementById('pCartoes');
            const pCat = document.getElementById('pCategorias');
            const pConf = document.getElementById('pConfiguracoes');

            const aCriar = document.getElementById('aCriarMovimento');
            const aExcluir = document.getElementById('aExcluirMovimento');
            const aFin = document.getElementById('aFinanciamentos');
            const aLotes = document.getElementById('aLotes');
            const aUser = document.getElementById('aUsuarios');
            const aLogs = document.getElementById('aLogs');

            if (perfil === 'usuario') {
                pDash.checked = true; pRel.checked = true; pLanc.checked = true; pCart.checked = true; pCat.checked = true; pConf.checked = false;
                aCriar.checked = false; aExcluir.checked = false; aFin.checked = false; aLotes.checked = false; aUser.checked = false; aLogs.checked = false;
            } else if (perfil === 'supervisor') {
                pDash.checked = true; pRel.checked = true; pLanc.checked = true; pCart.checked = true; pCat.checked = true; pConf.checked = false;
                aCriar.checked = true; aExcluir.checked = true; aFin.checked = true; aLotes.checked = true; aUser.checked = false; aLogs.checked = false;
            } else if (perfil === 'admin') {
                pDash.checked = true; pRel.checked = true; pLanc.checked = true; pCart.checked = true; pCat.checked = true; pConf.checked = true;
                aCriar.checked = true; aExcluir.checked = true; aFin.checked = true; aLotes.checked = true; aUser.checked = true; aLogs.checked = true;
            }
            atualizarResumoPermissoes();
        }

        function abrirModalUsuario(id = null) {
            const modal = document.getElementById('modalUsuario');
            const titulo = document.getElementById('modalUsuarioTitulo');
            if (!usuarioPode('usuarios')) {
                mostrarAlertaModal('Seu perfil não tem permissão para gerenciar usuários.');
                return;
            }
            document.getElementById('formUsuarioModal').reset();
            aplicarPerfilPredefinido();
            popularSelectParceiros(id);

            if (id) {
                const dados = obterDados();
                const u = dados.usuarios.find(user => Number(user.id) === Number(id));
                if (u) {
                    titulo.textContent = 'Editar Usuário';
                    document.getElementById('editUsuarioId').value = u.id;
                    document.getElementById('nomeUsuarioModal').value = u.nome;
                    document.getElementById('loginUsuarioModal').value = u.usuario || u.nome;
                    document.getElementById('rendaFixaUsuarioModal').value = u.rendaFixa || '';
                    document.getElementById('ativoUsuarioModal').checked = u.ativo !== false;
                    document.getElementById('parceiroUsuarioModal').value = u.parceiroId || '';
                    
                    const perms = u.permissoes || {};
                    document.getElementById('perfilUsuarioModal').value = perms.perfil || 'supervisor';

                    const paginas = perms.paginas || { dashboard: true, relatorios: true, lancamentos: true, cartoes: true, categorias: true, configuracoes: false };
                    document.getElementById('pDashboard').checked = paginas.dashboard;
                    document.getElementById('pRelatorios').checked = paginas.relatorios;
                    document.getElementById('pLancamentos').checked = paginas.lancamentos;
                    document.getElementById('pCartoes').checked = paginas.cartoes;
                    document.getElementById('pCategorias').checked = paginas.categorias;
                    document.getElementById('pConfiguracoes').checked = paginas.configuracoes;

                    const acoes = perms.acoes || { criarMovimento: true, excluirMovimento: true, financiamentos: true, lotes: false, usuarios: false, logs: false };
                    document.getElementById('aCriarMovimento').checked = acoes.criarMovimento;
                    document.getElementById('aExcluirMovimento').checked = acoes.excluirMovimento;
                    document.getElementById('aFinanciamentos').checked = acoes.financiamentos;
                    document.getElementById('aLotes').checked = acoes.lotes;
                    document.getElementById('aUsuarios').checked = acoes.usuarios;
                    document.getElementById('aLogs').checked = acoes.logs;
                }
            } else {
                titulo.textContent = 'Novo Usuário';
                document.getElementById('editUsuarioId').value = '';
                document.getElementById('loginUsuarioModal').value = '';
                document.getElementById('rendaFixaUsuarioModal').value = '';
                document.getElementById('ativoUsuarioModal').checked = true;
                document.getElementById('perfilUsuarioModal').value = 'supervisor';
                document.getElementById('parceiroUsuarioModal').value = '';
                aplicarPerfilPredefinido();
            }
            atualizarResumoPermissoes();
            document.getElementById('senhaTemporariaObrigatoria').textContent = id ? '(opcional)' : '(obrigatória para novos usuários)';
            modal.hidden = false;
            modal.style.display = 'flex';
            document.body.classList.add('account-modal-open');
            document.getElementById('nomeUsuarioModal').focus();
        }

        function fecharModalUsuario() {
            const modal = document.getElementById('modalUsuario');
            modal.hidden = true;
            modal.style.display = 'none';
            document.body.classList.remove('account-modal-open');
        }

        async function salvarUsuarioConfig(event) {
            event.preventDefault();
            if (!await exigirPermissao('usuarios', 'gerenciar usuários')) return;
            const id = document.getElementById('editUsuarioId').value;
            const nome = document.getElementById('nomeUsuarioModal').value.trim();
            const login = document.getElementById('loginUsuarioModal').value.trim();
            const senhaTemporaria = document.getElementById('senhaTemporariaUsuarioModal').value;
            const rendaFixa = numeroSeguro(document.getElementById('rendaFixaUsuarioModal').value);
            const parceiroId = document.getElementById('parceiroUsuarioModal').value ? Number(document.getElementById('parceiroUsuarioModal').value) : null;
            const resetPin = document.getElementById('resetPinModal').checked;
            const ativo = document.getElementById('ativoUsuarioModal').checked;
            
            const permissoes = {
                perfil: document.getElementById('perfilUsuarioModal').value,
                paginas: {
                    dashboard: document.getElementById('pDashboard').checked,
                    relatorios: document.getElementById('pRelatorios').checked,
                    lancamentos: document.getElementById('pLancamentos').checked,
                    cartoes: document.getElementById('pCartoes').checked,
                    categorias: document.getElementById('pCategorias').checked,
                    configuracoes: document.getElementById('pConfiguracoes').checked
                },
                acoes: {
                    criarMovimento: document.getElementById('aCriarMovimento').checked,
                    excluirMovimento: document.getElementById('aExcluirMovimento').checked,
                    financiamentos: document.getElementById('aFinanciamentos').checked,
                    lotes: document.getElementById('aLotes').checked,
                    usuarios: document.getElementById('aUsuarios').checked,
                    logs: document.getElementById('aLogs').checked
                }
            };

            const dados = obterDados();
            if (!nome || !login) {
                await mostrarAlertaModal('Informe o nome e o login do usuário.');
                return;
            }
            if ((!id || senhaTemporaria) && !validarComplexidadeSenha(senhaTemporaria)) {
                await mostrarAlertaModal('Defina uma senha provisória com pelo menos 8 caracteres, letras maiúsculas e minúsculas, número e símbolo.');
                return;
            }
            const duplicado = (dados.usuarios || []).some(user =>
                String(user.id) !== String(id || '') && [user.usuario, user.nome].filter(Boolean).some(valor =>
                    normalizarTexto(valor) === normalizarTexto(login) || normalizarTexto(valor) === normalizarTexto(nome))
            );
            if (duplicado) {
                await mostrarAlertaModal('Já existe um usuário com este nome/login. Use um nome diferente.');
                return;
            }

            const usuarioEditado = id ? dados.usuarios.find(user => String(user.id) === String(id)) : null;
            if (id && !usuarioEditado) {
                await mostrarAlertaModal('O usuário que você tentou editar não existe mais. Atualize a tela e tente novamente.');
                return;
            }
            if (usuarioEditado?.permissoes?.perfil === 'admin' && (permissoes.perfil !== 'admin' || !ativo)) {
                const outrosAdminsAtivos = dados.usuarios.filter(u => String(u.id) !== String(id) && u.ativo !== false && u.permissoes?.perfil === 'admin');
                if (!outrosAdminsAtivos.length) {
                    await mostrarAlertaModal('É necessário manter ao menos um administrador ativo. Cadastre outro administrador antes de alterar esta conta.');
                    return;
                }
            }
            if (parceiroId && String(parceiroId) === String(id || '')) {
                await mostrarAlertaModal('Um usuário não pode ser vinculado como próprio parceiro.');
                return;
            }
            const parceiroSelecionado = parceiroId ? dados.usuarios.find(user => String(user.id) === String(parceiroId)) : null;
            if (parceiroId && (!parceiroSelecionado || parceiroSelecionado.ativo === false)) {
                await mostrarAlertaModal('Selecione um parceiro válido e ativo.');
                return;
            }
            if (parceiroSelecionado && parceiroSelecionado.parceiroId != null &&
                String(parceiroSelecionado.parceiroId) !== String(id || '') &&
                String(parceiroSelecionado.id) !== String(usuarioEditado?.parceiroId || '')) {
                await mostrarAlertaModal('Este usuário já está vinculado a outro parceiro. Remova o vínculo anterior antes de continuar.');
                return;
            }

            if (!await verificarSenhaAdmin(id ? 'alterar o cadastro e as permissões desta conta' : 'cadastrar o novo usuário')) return;

            const parceiroAnteriorId = usuarioEditado?.parceiroId == null ? null : String(usuarioEditado.parceiroId);
            if (usuarioEditado && parceiroAnteriorId && parceiroAnteriorId !== String(parceiroId || '')) {
                const parceiroAnterior = dados.usuarios.find(user => String(user.id) === parceiroAnteriorId);
                if (parceiroAnterior && String(parceiroAnterior.parceiroId) === String(usuarioEditado.id)) parceiroAnterior.parceiroId = null;
            }

            const hashSenhaTemporaria = senhaTemporaria ? await gerarHash(senhaTemporaria) : null;
            if (usuarioEditado) {
                usuarioEditado.nome = nome;
                usuarioEditado.usuario = login;
                usuarioEditado.rendaFixa = rendaFixa;
                usuarioEditado.parceiroId = parceiroId;
                usuarioEditado.ativo = ativo;
                usuarioEditado.permissoes = permissoes;
                if (hashSenhaTemporaria) usuarioEditado.pin = hashSenhaTemporaria;
                if (resetPin || hashSenhaTemporaria) usuarioEditado.trocaSenhaObrigatoria = true;
                if (parceiroSelecionado) parceiroSelecionado.parceiroId = Number(usuarioEditado.id);
                registrarLog(dados, "EDIÇÃO USUÁRIO", `Permissões/dados do usuário '${nome}' foram alterados.`);
            } else {
                const novoId = dados.usuarios.reduce((m, u) => Math.max(m, Number(u.id) || 0), 0) + 1;
                dados.usuarios.push({
    id: novoId,
    usuario: login,
    nome,
    rendaFixa,
    parceiroId,
    pin: hashSenhaTemporaria,
    trocaSenhaObrigatoria: true,
    ativo,
    permissoes,
    preferenciasNotificacao: { ativo: true, diasAntecedencia: 3 },
    configuracaoSalarial: {}
});
                if (parceiroSelecionado) parceiroSelecionado.parceiroId = novoId;
                registrarLog(dados, "NOVO USUÁRIO", `Usuário '${nome}' foi criado.`);
            }

            const botaoSalvar = document.getElementById('btnSalvarUsuarioConfig');
            botaoSalvar.disabled = true;
            botaoSalvar.textContent = 'Salvando…';
            try {
                await salvarDados(dados);
                await sincronizarComServidor();
                if (localStorage.getItem('syncPendente') === 'true' || localStorage.getItem(SYNC_CONFLICT_KEY)) {
                    throw new Error('O cadastro está salvo neste dispositivo, mas o servidor ainda não confirmou a alteração. Verifique a sincronização.');
                }
                fecharModalUsuario();
                renderizarTabelaUsuariosConfig();
                document.getElementById('contadorUsuariosConfig').textContent += ' · Alterações salvas!';
            } catch (erro) {
                console.error('Falha ao salvar usuário:', erro);
                await mostrarAlertaModal(erro.message || 'Falha ao salvar usuário. Verifique a sincronização e tente novamente.');
            } finally {
                botaoSalvar.disabled = false;
                botaoSalvar.textContent = 'Salvar usuário →';
            }
        }

        async function excluirOuDesativarUsuario(id) {
            if (!await exigirPermissao('usuarios', 'excluir ou desativar usuários')) return;
            
            const dados = obterDados();
            const u = dados.usuarios.find(user => Number(user.id) === Number(id));
            if (!u) return;

            if (String(u.id) === String(localStorage.getItem('usuarioLogado'))) {
                await mostrarAlertaModal('Você não pode excluir ou desativar a própria conta durante esta sessão. Utilize outro administrador.');
                return;
            }

            if (u.permissoes?.perfil === 'admin' && u.ativo !== false && !dados.usuarios.some(outro => String(outro.id) !== String(id) && outro.ativo !== false && outro.permissoes?.perfil === 'admin')) {
                await mostrarAlertaModal('Este é o último administrador ativo. Não é possível desativá-lo ou excluí-lo.');
                return;
            }
            if (!await verificarSenhaAdmin('excluir ou desativar usuário')) return;

            const temLancamentos = dados.lancamentos.some(l => Number(l.usuarioId) === Number(id));
            const temCartoes = dados.cartoes.some(c => Number(c.usuarioId) === Number(id) && c.ativo !== false);
            const temVinculoParceiro = dados.usuarios.some(user => String(user.id) !== String(id) && String(user.parceiroId || '') === String(id));

            if (temLancamentos || temCartoes || temVinculoParceiro) {
                const confirmarDesativacao = await mostrarConfirmacaoModal(
                    `O usuário "${escaparHTML(u.nome)}" possui lançamentos, cartões ou vínculo de parceiro e não pode ser excluído permanentemente.\n\nDeseja desativar este usuário?`
                );
                if (confirmarDesativacao) {
                    u.ativo = false;
                    registrarLog(dados, "DESATIVAÇÃO USUÁRIO", `Usuário '${u.nome}' foi desativado.`);
                    await salvarDados(dados);
                    renderizarTabelaUsuariosConfig();
                    await mostrarAlertaModal("Usuário desativado com sucesso!");
                }
            } else {
                const confirmarExclusao = await mostrarConfirmacaoModal(
                    `Deseja realmente excluir o usuário "${escaparHTML(u.nome)}" permanentemente?`
                );
                if (confirmarExclusao) {
                    dados.usuarios = dados.usuarios.filter(user => Number(user.id) !== Number(id));
                    registrarLog(dados, "EXCLUSÃO USUÁRIO", `Usuário '${u.nome}' foi excluído permanentemente.`);
                    await salvarDados(dados);
                    renderizarTabelaUsuariosConfig();
                    await mostrarAlertaModal("Usuário excluído com sucesso!");
                }
            }
        }

        function exportarBackupJSON() {
            const dados = obterDados();
            const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(dados, null, 2));
            const downloadAnchor = document.createElement('a');
            downloadAnchor.setAttribute("href", dataStr);
            downloadAnchor.setAttribute("download", `backup_financeiro_${dataLocalYYYYMMDD()}.json`);
            document.body.appendChild(downloadAnchor);
            downloadAnchor.click();
            downloadAnchor.remove();
        }

        async function importarBackupJSON(event) {
            const input = event?.target;
            const arquivo = input?.files?.[0];
            if (!arquivo) return;

            try {
                if (!await verificarSenhaAdmin('restaurar um backup local')) return;
                const confirmar = await mostrarConfirmacaoModal('Restaurar um backup substituirá todos os dados atuais do sistema e da nuvem. Faça um backup atual antes de continuar. Deseja prosseguir?');
                if (!confirmar) return;

                const texto = await arquivo.text();
                const dadosImportados = JSON.parse(texto);
                if (!dadosImportados || typeof dadosImportados !== 'object' || Array.isArray(dadosImportados)) {
                    throw new Error('O arquivo não contém um objeto JSON válido.');
                }

                const colecoesObrigatorias = [
                    'usuarios', 'categorias', 'cartoes', 'lancamentos', 'financiamentos', 'bens',
                    'notificacoes', 'logs', 'exclusao_movimento', 'edicao_movimento'
                ];
                const ausentes = colecoesObrigatorias.filter(nome => !Array.isArray(dadosImportados[nome]));
                if (ausentes.length) {
                    throw new Error('Backup incompleto. Coleções ausentes ou inválidas: ' + ausentes.join(', '));
                }
                const registrosInvalidos = colecoesObrigatorias.some(nome =>
                    dadosImportados[nome].some(registro => !registro || typeof registro !== 'object' || Array.isArray(registro))
                );
                if (registrosInvalidos) throw new Error('Há registros inválidos no backup. Nenhum dado foi restaurado.');

                mostrarLoading('Validando backup e preparando restauração...');
                const dadosNuvem = await buscarDadosServidor();
                const normalizados = migrarDados(dadosImportados).dados;
                normalizados._revision = Number(dadosNuvem._revision) || 0;

                if (syncTimer) clearTimeout(syncTimer);
                syncTimer = null;
                syncPendingData = null;
                localStorage.removeItem('syncPendente');
                localStorage.removeItem(SYNC_CONFLICT_KEY);
                localStorage.setItem(SYNC_BASELINE_KEY, JSON.stringify(dadosNuvem));

                await salvarDados(normalizados);
                await sincronizarComServidor();
                esconderLoading();

                if (localStorage.getItem(SYNC_CONFLICT_KEY) || localStorage.getItem('syncPendente') === 'true') {
                    throw new Error('A restauração foi aplicada localmente, mas a sincronização com a nuvem está pendente ou em conflito. Verifique o indicador de sincronização antes de sair desta página.');
                }
                await mostrarAlertaModal('Backup validado e restaurado na nuvem com sucesso. A página será recarregada.');
                window.location.reload();
            } catch (err) {
                esconderLoading();
                console.error('Falha ao restaurar backup:', err);
                await mostrarAlertaModal('Erro ao restaurar backup: ' + (err.message || 'arquivo inválido ou falha de conexão.'));
            } finally {
                if (input) input.value = '';
            }
        }

        async function restaurarBackupNuvem() {
            if (!await verificarSenhaAdmin("restaurar dados da nuvem")) return;
            const confirmar = await mostrarConfirmacaoModal("Isto vai buscar os dados salvos na planilha (Google Sheets) e substituir TUDO o que está neste dispositivo agora. Se houver alterações locais ainda não sincronizadas, elas serão perdidas. Deseja continuar?");
            if (!confirmar) return;

            mostrarLoading("Buscando dados na nuvem...");
            try {
                const dadosNuvem = migrarDados(await buscarDadosServidor()).dados;
                if (syncTimer) clearTimeout(syncTimer);
                syncTimer = null;
                syncPendingData = null;
                localStorage.removeItem('syncPendente');
                localStorage.removeItem(SYNC_CONFLICT_KEY);
                gravarSnapshotLocal(dadosNuvem, true);
                await salvarDados(dadosNuvem, { sincronizar: false });
                esconderLoading();
                await mostrarAlertaModal("Dados restaurados da nuvem com sucesso! A página será recarregada.");
                window.location.reload();
            } catch (erro) {
                esconderLoading();
                console.error(erro);
                await mostrarAlertaModal("Não foi possível buscar os dados da nuvem: " + (erro.message || erro));
            }
        }

        async function tentarAcessarAdminLogs() {
            if (!await exigirPermissao('logs', 'acessar logs de auditoria')) return;
            const autorizado = await verificarSenhaAdmin("painel administrativo");
            if (autorizado) {
                document.getElementById('painelAdminConteudo').hidden = false;
                document.getElementById('btnLimparLogs').hidden = false;
                carregarLogsAdmin();
            }
        }

        function carregarLogsAdmin() {
            const dados = obterDados();
            const tbody = document.getElementById('tabelaLogsAdmin');
            if (!tbody) return;
            tbody.innerHTML = '';

            const logs = dados.logs || [];
            if (logs.length === 0) {
                tbody.innerHTML = `<tr><td colspan="4" class="account-table-empty">Nenhum log registrado.</td></tr>`;
                return;
            }

            [...logs].reverse().slice(0, 12).forEach(log => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td data-label="Data / hora">${escaparHTML(log.dataHora && !Number.isNaN(new Date(log.dataHora).getTime()) ? new Date(log.dataHora).toLocaleString('pt-BR') : (log.dataHoraFormatada || '-'))}</td>
                    <td data-label="Usuário">${escaparHTML(log.usuario || 'Sistema')}</td>
                    <td data-label="Ação"><span class="account-action-badge">${escaparHTML(log.acao || '-')}</span></td>
                    <td data-label="Detalhes">${escaparHTML(log.detalhes || '-')}</td>
                `;
                tbody.appendChild(tr);
            });
        }

        async function limparLogsAntigos() {
            if (!await exigirPermissao('logs', 'limpar logs de auditoria')) return;
            if (!await verificarSenhaAdmin('limpar os logs de auditoria')) return;
            const confirmar = await mostrarConfirmacaoModal("Deseja realmente limpar todos os registros de logs de auditoria?");
            if (!confirmar) return;

            const dados = obterDados();
            dados.logs = [];
            registrarLog(dados, 'LIMPEZA DE LOGS', 'O histórico de auditoria foi limpo em Configurações.');
            await salvarDados(dados);
            carregarLogsAdmin();
            await mostrarAlertaModal("Logs limpos com sucesso!");
        }
    

// ===== Eventos migrados dos atributos on* do HTML =====
// Liga apenas os elementos estáticos marcados por data-page-handler,
// sem executar JavaScript como string e sem registrar eventos em duplicidade.
(function vincularEventosDaPagina() {
    const eventos = {
        "configuracoes-1": [
            ["click", function(event) {
                abrirModalUsuario()
            }],
        ],
        "configuracoes-2": [
            ["click", function(event) {
                exportarBackupJSON()
            }],
        ],
        "configuracoes-3": [
            ["change", function(event) {
                importarBackupJSON(event)
            }],
        ],
        "configuracoes-4": [
            ["click", function(event) {
                restaurarBackupNuvem()
            }],
        ],
        "configuracoes-5": [
            ["click", function(event) {
                tentarAcessarAdminLogs()
            }],
        ],
        "configuracoes-6": [
            ["click", function(event) {
                limparLogsAntigos()
            }],
        ],
        "configuracoes-7": [
            ["click", function(event) {
                fecharModalUsuario()
            }],
        ],
        "configuracoes-8": [
            ["submit", function(event) {
                salvarUsuarioConfig(event)
            }],
        ],
        "configuracoes-9": [
            ["change", function(event) {
                aplicarPerfilPredefinido()
            }],
        ],
        "configuracoes-10": [
            ["click", function(event) {
                fecharModalUsuario()
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

