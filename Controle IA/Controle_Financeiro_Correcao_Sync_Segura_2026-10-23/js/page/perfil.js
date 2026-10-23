// Controle Financeiro | Página: perfil.html
// Arquivo extraído dos scripts embutidos no HTML original.
// Carregar APÓS js/script.js, js/calculos_trabalhistas.js e js/conexao_sheets.js.
// Mantém funções globais clássicas usadas por elementos gerados dinamicamente.

// ===== Bloco inline original 1 =====
        let salvandoFotoPerfil = false;
        let alteracoesPerfilPendentes = false;
        const SVG_AVATAR_PADRAO = 'data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22%23a89586%22%3E%3Cpath%20d%3D%22M12%2012c2.21%200%204-1.79%204-4s-1.79-4-4-4-4%201.79-4%204%201.79%204%204%204zm0%202c-2.67%200-8%201.34-8%204v2h16v-2c0-2.66-5.33-4-8-4z%22%2F%3E%3C%2Fsvg%3E';

        // CORREÇÃO: aviso antes de fechar/recarregar com edições não salvas.
        window.addEventListener('beforeunload', (e) => {
            if (alteracoesPerfilPendentes) {
                e.preventDefault();
                e.returnValue = '';
            }
        });

        document.addEventListener('DOMContentLoaded', async () => {
            injetarHeader();
            const autenticado = await verificarAutenticacao();
            if (autenticado) {
                const usuario = obterUsuarioAtual();
                document.querySelectorAll('[data-account-settings]').forEach(el => el.hidden = !usuarioPodeAcessarPagina(usuario, 'configuracoes'));
                document.querySelectorAll('[data-account-logs]').forEach(el => el.hidden = !(usuarioPodeAcessarPagina(usuario, 'configuracoes') && usuarioPode('logs')));
                carregarDadosPerfil();
                const form = document.getElementById('formMeuPerfil');
                form.addEventListener('input', marcarPerfilAlterado);
                form.addEventListener('change', marcarPerfilAlterado);
                document.getElementById('togglePinPerfil').addEventListener('click', () => {
                    const campo = document.getElementById('meuPinAtual');
                    const botao = document.getElementById('togglePinPerfil');
                    const visivel = campo.type === 'password';
                    campo.type = visivel ? 'text' : 'password';
                    botao.textContent = visivel ? 'Ocultar' : 'Mostrar';
                    botao.setAttribute('aria-label', visivel ? 'Ocultar senha' : 'Mostrar senha');
                    botao.setAttribute('aria-pressed', String(visivel));
                });
                document.getElementById('notifAtivaVencimento').addEventListener('change', atualizarLembretePerfil);
                atualizarLembretePerfil();
            }
        });

        function definirFeedbackPerfil(texto, estado = '') {
            const elemento = document.getElementById('perfilFeedback');
            elemento.textContent = texto;
            elemento.dataset.state = estado;
        }

        function definirModoEdicaoPerfil(editar, rolar = true) {
            const painel = document.getElementById('dados-pessoais');
            if (!editar) {
                if (obterUsuarioAtual()?.trocaSenhaObrigatoria) {
                    definirFeedbackPerfil('Defina sua nova senha para concluir o primeiro acesso.', 'pending');
                    return false;
                }
                if (alteracoesPerfilPendentes) {
                    definirFeedbackPerfil('Salve ou descarte suas alterações antes de fechar a edição.', 'pending');
                    painel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                    return false;
                }
            }
            painel.hidden = !editar;
            document.body.classList.toggle('profile-editing', editar);
            if (editar) document.getElementById('perfilCardFeedback').textContent = '';
            document.getElementById('btnEditarDadosPerfil').setAttribute('aria-expanded', String(editar));
            document.getElementById('rotuloEditarDadosPerfil').textContent = editar ? 'Fechar edição' : 'Editar meus dados';
            if (rolar) {
                if (editar) {
                    painel.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    document.getElementById('meuUsuarioLogin').focus({ preventScroll: true });
                } else document.getElementById('btnEditarDadosPerfil').focus({ preventScroll: true });
            }
            return true;
        }

        function alternarModoEdicaoPerfil() {
            definirModoEdicaoPerfil(document.getElementById('dados-pessoais').hidden);
        }

        function abrirSeletorFotoPerfil() {
            if (salvandoFotoPerfil) return;
            if (document.getElementById('btnSalvarPerfil').disabled) {
                feedbackFotoPerfil('Aguarde a gravação dos seus dados.', 'loading'); return;
            }
            document.getElementById('inputFotoPerfil').click();
        }

        function feedbackFotoPerfil(mensagem, estado = '') {
            const elemento = document.getElementById('fotoPerfilFeedback');
            elemento.textContent = mensagem;
            elemento.dataset.state = estado;
        }

        function marcarPerfilAlterado() {
            alteracoesPerfilPendentes = true;
            document.getElementById('descartarPerfil').hidden = false;
            definirFeedbackPerfil('Você tem alterações ainda não salvas.', 'pending');
        }

        function descartarAlteracoesPerfil() {
            carregarDadosPerfil();
            definirFeedbackPerfil('Alterações descartadas. Tudo atualizado.');
            definirModoEdicaoPerfil(false);
        }

        function atualizarLembretePerfil() {
            document.getElementById('notifDiasAntecedencia').disabled = !document.getElementById('notifAtivaVencimento').checked;
        }

        function carregarDadosPerfil() {
            const dados = obterDados();
            const usuarioId = localStorage.getItem('usuarioLogado');
            const usuario = dados.usuarios.find(u => Number(u.id) === Number(usuarioId));
            if (!usuario) return;

            document.getElementById('inputFotoPerfil').value = '';
            document.getElementById('meuPinAtual').value = '';
            document.getElementById('confirmarSenhaPerfil').value = '';
            document.getElementById('avisoTrocaSenhaObrigatoria').hidden = !usuario.trocaSenhaObrigatoria;
            document.getElementById('rotuloSenhaOpcional').hidden = !!usuario.trocaSenhaObrigatoria;
            document.getElementById('fotoPerfilLateral').src = usuario.fotoPerfil || SVG_AVATAR_PADRAO;
            document.getElementById('nomePerfilLateral').textContent = usuario.nome || 'Minha conta';
            document.getElementById('loginPerfilLateral').textContent = '@' + (usuario.usuario || usuario.nome || 'usuário');
            const estadoConta = document.getElementById('estadoContaPerfil');
            const ativo = usuario.ativo !== false;
            estadoConta.innerHTML = '<span></span> ' + (ativo ? 'Conta ativa' : 'Conta inativa');
            estadoConta.classList.toggle('is-inactive', !ativo);

            document.getElementById('meuUsuarioLogin').value = usuario.usuario || usuario.nome || '';
            document.getElementById('meuNome').value = usuario.nome || '';
            
            const prefsNotif = usuario.preferenciasNotificacao || {};
            document.getElementById('notifAtivaVencimento').checked = prefsNotif.ativo !== false;
            document.getElementById('lembretesAtivosPerfil').hidden = prefsNotif.ativo === false;
            document.getElementById('notifDiasAntecedencia').value = Number.isInteger(Number(prefsNotif.diasAntecedencia)) && Number(prefsNotif.diasAntecedencia) >= 1 && Number(prefsNotif.diasAntecedencia) <= 15 ? prefsNotif.diasAntecedencia : 3;
            atualizarLembretePerfil();

            const selectParceiro = document.getElementById('meuParceiro');
            selectParceiro.innerHTML = '<option value="">Nenhum (Apenas Individual)</option>';
            dados.usuarios.forEach(u => {
                if (Number(u.id) === Number(usuario.id)) return;
                const opt = document.createElement('option');
                opt.value = u.id;
                opt.textContent = u.nome;
                if (Number(u.id) === Number(usuario.parceiroId)) opt.selected = true;
                selectParceiro.appendChild(opt);
            });
            const parceiro = dados.usuarios.find(u => String(u.id) === String(usuario.parceiroId));
            const convitePendente = (dados.notificacoes || []).some(n =>
                n.tipo === 'solicitacao_parceiro' && String(n.remetenteId) === String(usuario.id) && n.statusAprovacao === 'pendente');
            document.getElementById('parceiroPerfilResumo').textContent = parceiro?.nome ||
                (convitePendente ? 'Convite aguardando aprovação' : 'Não vinculado');

            const usuarioIdNum = Number(usuarioId);
            const financiamentosAtivos = (dados.financiamentos || []).filter(f => Number(f.usuarioId) === usuarioIdNum && f.ativo !== false).length;
            const cartoesAtivos = (dados.cartoes || []).filter(c => Number(c.usuarioId) === usuarioIdNum && c.ativo !== false).length;

            const bensDoUsuario = (dados.bens || []).filter(b => {
                if (b.ativo === false) return false;
                const dono = Number(b.usuarioId);
                const ehCompartilhado = b.compartilhado && (dono === Number(usuario.parceiroId));
                return !dono || dono === usuarioIdNum || ehCompartilhado;
            });

            document.getElementById('qtdFinanciamentos').textContent = financiamentosAtivos;
            document.getElementById('qtdeBens').textContent = bensDoUsuario.length;
            document.getElementById('qtdeCartoes').textContent = cartoesAtivos;

            const historico = consolidarRendimentosUsuario(dados, usuarioIdNum);
            const confRenda = normalizarConfiguracaoSalarial(usuario.configuracaoSalarial);
            const calculo = calcularSalarioLiquido(usuario.rendaFixa, confRenda);
            const labelsRenda = { clt: ['Salário bruto estimado', 'Salário líquido estimado', 'CLT: com INSS, IRRF e descontos previstos.'],
                pj: ['Receita PJ bruta', 'Disponível PJ estimado', 'PJ: apenas os descontos que você informou, sem retenções automáticas de CLT.'],
                aposentado: ['Benefício bruto', 'Benefício líquido estimado', 'Aposentadoria: sem INSS de empregado; com IRRF estimado quando aplicável.'] };
            document.getElementById('labelRendaBrutaPerfil').textContent = labelsRenda[confRenda.regimeRenda][0];
            document.getElementById('labelRendaLiquidaPerfil').textContent = labelsRenda[confRenda.regimeRenda][1];
            document.getElementById('textoRegimePerfil').textContent = labelsRenda[confRenda.regimeRenda][2];
            document.getElementById('cardRendaFixaValor').textContent = formatarMoeda(calculo.bruto);
            document.getElementById('cardRendaLiquida').textContent = formatarMoeda(calculo.liquido);
            document.getElementById('cardMediaVariavel').textContent = formatarMoeda(historico.mediaVariavel);
            document.getElementById('cardRendaTotal').textContent = formatarMoeda(centavosRenda(calculo.liquido + historico.mediaVariavel));

            const tbodyBens = document.getElementById('tabelaBensPerfil');
            tbodyBens.innerHTML = '';
            
            if (bensDoUsuario.length === 0) {
                tbodyBens.innerHTML = `<tr><td colspan="4" class="account-table-empty">Nenhum bem vinculado ou compartilhado.</td></tr>`;
            } else {
                bensDoUsuario.forEach(b => {
                    const gastoBem = (dados.lancamentos || [])
                        .filter(l => Number(l.bemId) === Number(b.id) && l.tipo === 'saida')
                        .reduce((acc, l) => acc + Number(l.valor), 0);

                    const tr = document.createElement('tr');
                    tr.innerHTML = `
                        <td data-label="Bem"><span><strong>${escaparHTML(b.nome || 'Sem nome')}</strong> ${b.compartilhado ? '<span class="account-shared-badge">Compartilhado</span>' : ''}</span></td>
                        <td data-label="Tipo">${escaparHTML(String(b.tipo || 'Não informado').toUpperCase())}</td>
                        <td data-label="Valor inicial">R$ ${Number(b.valor || 0).toLocaleString('pt-BR', {minimumFractionDigits: 2})}</td>
                        <td data-label="Investido" class="negativo">R$ ${gastoBem.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</td>
                    `;
                    tbodyBens.appendChild(tr);
                });
            }
            alteracoesPerfilPendentes = false;
            document.getElementById('descartarPerfil').hidden = true;
            definirFeedbackPerfil('Tudo atualizado.', 'success');
            if (usuario.trocaSenhaObrigatoria) definirModoEdicaoPerfil(true, false);
        }

        async function salvarFotoPerfilRapida(fotoNova) {
            if (salvandoFotoPerfil) return;
            if (document.getElementById('btnSalvarPerfil').disabled) {
                feedbackFotoPerfil('Aguarde a gravação dos seus dados.', 'loading'); return;
            }
            const dados = obterDados();
            const usuario = obterUsuarioAtual(dados);
            if (!usuario) { feedbackFotoPerfil('Acesse novamente sua conta para alterar a foto.', 'error'); return; }
            const fotoAnterior = usuario.fotoPerfil || null;
            if (fotoAnterior === fotoNova) { feedbackFotoPerfil('Esta foto já está no seu perfil.', 'success'); return; }
            const botao = document.getElementById('btnEditarFotoPerfil');
            salvandoFotoPerfil = true;
            botao.disabled = true;
            document.getElementById('fotoPerfilLateral').src = fotoNova || SVG_AVATAR_PADRAO;
            feedbackFotoPerfil('Salvando foto…', 'loading');
            try {
                usuario.fotoPerfil = fotoNova;
                registrarLog(dados, 'FOTO PERFIL', 'Foto do próprio perfil atualizada.');
                await salvarDados(dados);
                atualizarHeaderUsuario();
                feedbackFotoPerfil('Foto atualizada. Sincronização em segundo plano.', 'success');
            } catch (erro) {
                console.error('Erro ao atualizar foto de perfil:', erro);
                usuario.fotoPerfil = fotoAnterior;
                document.getElementById('fotoPerfilLateral').src = fotoAnterior || SVG_AVATAR_PADRAO;
                feedbackFotoPerfil('Não foi possível salvar a foto. Tente novamente.', 'error');
            } finally {
                salvandoFotoPerfil = false;
                botao.disabled = false;
                document.getElementById('inputFotoPerfil').value = '';
            }
        }

        function processarFotoPerfil(event) {
            const file = event.target.files[0];
            if (!file) return;

            if (file.size > 5 * 1024 * 1024) {
                feedbackFotoPerfil('Escolha uma imagem de até 5 MB.', 'error');
                event.target.value = '';
                return;
            }
            if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
                feedbackFotoPerfil('Escolha uma imagem PNG, JPG ou WEBP.', 'error');
                event.target.value = '';
                return;
            }

            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    const maxSize = 250; 
                    let width = img.width;
                    let height = img.height;

                    if (width > height) {
                        if (width > maxSize) { height = Math.round(height * maxSize / width); width = maxSize; }
                    } else {
                        if (height > maxSize) { width = Math.round(width * maxSize / height); height = maxSize; }
                    }

                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);

                    const base64 = canvas.toDataURL('image/jpeg', 0.8);
                    
                    salvarFotoPerfilRapida(base64);
                };
                img.onerror = () => feedbackFotoPerfil('Não foi possível ler esta imagem.', 'error');
                img.src = e.target.result;
            };
            reader.onerror = () => feedbackFotoPerfil('Não foi possível abrir este arquivo.', 'error');
            reader.readAsDataURL(file);
        }

        function removerFotoPerfil() {
            salvarFotoPerfilRapida(null);
        }

        async function salvarMeuPerfil(event) {
            event.preventDefault();
            if (salvandoFotoPerfil) {
                definirFeedbackPerfil('Aguarde a foto de perfil terminar de salvar.', 'pending'); return;
            }
            const dados = obterDados();
            const usuarioId = localStorage.getItem('usuarioLogado');
            const usuario = dados.usuarios.find(u => Number(u.id) === Number(usuarioId));
            if (!usuario) return;
            const novoUsuarioLogin = document.getElementById('meuUsuarioLogin').value.trim();
            const novoNome = document.getElementById('meuNome').value.trim();
            const novoPin = document.getElementById('meuPinAtual').value.trim();
            const confirmarSenha = document.getElementById('confirmarSenhaPerfil').value.trim();
            const diasAntecedencia = Number(document.getElementById('notifDiasAntecedencia').value);
            const novoParceiroId = document.getElementById('meuParceiro').value ? Number(document.getElementById('meuParceiro').value) : null;
            if (!novoUsuarioLogin || !novoNome) {
                definirFeedbackPerfil('Informe o usuário de acesso e o nome de exibição.', 'error');
                return;
            }
            const usuarioExistente = dados.usuarios.find(u =>
                normalizarTexto(u.usuario || u.nome) === normalizarTexto(novoUsuarioLogin) && Number(u.id) !== Number(usuarioId)
            );
            if (usuarioExistente) {
                definirFeedbackPerfil('Este usuário de acesso já está em uso. Escolha outro.', 'error');
                return;
            }
            if (usuario.trocaSenhaObrigatoria && !novoPin) {
                definirFeedbackPerfil('Você precisa trocar a senha provisória antes de continuar.', 'error');
                return;
            }
            if (novoPin && !validarComplexidadeSenha(novoPin)) {
                definirFeedbackPerfil('A nova senha deve ter 8+ caracteres, maiúscula, minúscula, número e símbolo.', 'error');
                return;
            }
            if (novoPin !== confirmarSenha) {
                definirFeedbackPerfil('A confirmação não corresponde à nova senha.', 'error');
                return;
            }
            if (!Number.isInteger(diasAntecedencia) || diasAntecedencia < 1 || diasAntecedencia > 15) {
                definirFeedbackPerfil('Escolha entre 1 e 15 dias de antecedência.', 'error');
                return;
            }
            if (novoParceiroId && (!dados.usuarios.some(u => Number(u.id) === novoParceiroId && u.ativo !== false) || novoParceiroId === Number(usuario.id))) {
                definirFeedbackPerfil('Selecione um parceiro válido e ativo.', 'error');
                return;
            }
            const botao = document.getElementById('btnSalvarPerfil');
            botao.disabled = true;
            botao.textContent = 'Salvando alterações…';
            definirFeedbackPerfil('Salvando suas preferências…', 'loading');
            try {
                const hashPin = novoPin ? await gerarHash(novoPin) : null;
                usuario.usuario = novoUsuarioLogin;
                usuario.nome = novoNome;
                usuario.preferenciasNotificacao = {
                    ativo: document.getElementById('notifAtivaVencimento').checked,
                    diasAntecedencia
                };
                if (hashPin) {
                    usuario.pin = hashPin;
                    usuario.trocaSenhaObrigatoria = false;
                }
                let feedbackParceiro = '';
                if (novoParceiroId !== (usuario.parceiroId ? Number(usuario.parceiroId) : null)) {
                if (novoParceiroId) {
                    dados.notificacoes = dados.notificacoes || [];
                    const pendente = dados.notificacoes.some(n => n.tipo === 'solicitacao_parceiro' && String(n.remetenteId) === String(usuario.id) && String(n.usuarioDestinoId) === String(novoParceiroId) && n.statusAprovacao === 'pendente');
                    if (!pendente) dados.notificacoes.push({
                        id: gerarId('notif'), usuarioDestinoId: novoParceiroId, remetenteId: usuario.id,
                        tipo: 'solicitacao_parceiro', titulo: 'Solicitação de Atrelamento 🤝',
                        mensagem: `${usuario.nome} solicitou atrelar você como parceiro no sistema financeiro.`,
                        lida: false, statusAprovacao: 'pendente', createdAt: new Date().toISOString()
                    });
                    feedbackParceiro = pendente ? ' A solicitação ao parceiro já está pendente.' : ' Solicitação enviada ao parceiro para aprovação.';
                } else {
                    usuario.parceiroId = null;
                    feedbackParceiro = ' Vínculo de parceiro removido.';
                }
                }
                registrarLog(dados, 'ATUALIZAÇÃO PERFIL', `Usuário ${usuario.usuario} (${usuario.nome}) atualizou informações pessoais e preferências.`);
                await salvarDados(dados);
                atualizarHeaderUsuario();
                carregarDadosPerfil();
                definirModoEdicaoPerfil(false);
                const avisoCard = document.getElementById('perfilCardFeedback');
                avisoCard.textContent = 'Dados salvos. A sincronização continua em segundo plano.' + feedbackParceiro;
                definirFeedbackPerfil('Alterações salvas! A sincronização continuará em segundo plano.' + feedbackParceiro, 'success');
            } catch (erro) {
                console.error('Erro ao salvar perfil:', erro);
                definirFeedbackPerfil('Não foi possível salvar agora. Tente novamente.', 'error');
            } finally {
                botao.disabled = false;
                botao.innerHTML = 'Salvar alterações <span aria-hidden="true">→</span>';
            }
        }
    

// ===== Eventos migrados dos atributos on* do HTML =====
// Liga apenas os elementos estáticos marcados por data-page-handler,
// sem executar JavaScript como string e sem registrar eventos em duplicidade.
(function vincularEventosDaPagina() {
    const eventos = {
        "perfil-1": [
            ["click", function(event) {
                abrirEditorSalarial()
            }],
        ],
        "perfil-2": [
            ["click", function(event) {
                abrirSeletorFotoPerfil()
            }],
        ],
        "perfil-3": [
            ["load", function(event) {
                this.nextElementSibling.hidden=true
            }],
            ["error", function(event) {
                this.hidden=true
            }],
        ],
        "perfil-4": [
            ["change", function(event) {
                processarFotoPerfil(event)
            }],
        ],
        "perfil-5": [
            ["click", function(event) {
                alternarModoEdicaoPerfil()
            }],
        ],
        "perfil-6": [
            ["submit", function(event) {
                salvarMeuPerfil(event)
            }],
        ],
        "perfil-7": [
            ["click", function(event) {
                removerFotoPerfil()
            }],
        ],
        "perfil-8": [
            ["click", function(event) {
                descartarAlteracoesPerfil()
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

