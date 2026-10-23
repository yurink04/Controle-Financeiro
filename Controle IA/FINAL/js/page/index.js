// Controle Financeiro | Página: index.html
// Arquivo extraído dos scripts embutidos no HTML original.
// Carregar APÓS js/script.js, js/calculos_trabalhistas.js e js/conexao_sheets.js.
// Mantém funções globais clássicas usadas por elementos gerados dinamicamente.

// ===== Bloco inline original 1 =====
        let bancoInicializado = false;
        let primeiroCadastroDisponivel = false;
        let loginOcupado = false;
        let usuarioSelecionadoParaLogin = null;
        let conexaoInicialEmAndamento = null;
        const VERSAO_ACESSO_ESPERADA = '2026-10-20-r2';
        const AVATAR_PADRAO = 'data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22%23a89586%22%3E%3Cpath%20d%3D%22M12%2012c2.21%200%204-1.79%204-4s-1.79-4-4-4-4%201.79-4%204%201.79%204%204%204zm0%202c-2.67%200-8%201.34-8%204v2h16v-2c0-2.66-5.33-4-8-4z%22%2F%3E%3C%2Fsvg%3E';

        function atualizarStatusLogin(mensagem, estado = 'loading', visivel = true) {
            const painel = document.getElementById('loginConnection');
            const texto = document.getElementById('loginStatusText');
            if (texto) texto.textContent = mensagem;
            if (painel) {
                painel.dataset.state = estado;
                painel.dataset.visible = visivel ? 'true' : 'false';
            }
            const retry = document.getElementById('loginRetry');
            if (retry) retry.hidden = !visivel || estado !== 'error';
        }

        function testarConexaoInicial() {
            if (conexaoInicialEmAndamento) return conexaoInicialEmAndamento;
            const retry = document.getElementById('loginRetry');
            conexaoInicialEmAndamento = (async () => {
                if (retry) retry.disabled = true;
                const controle = new AbortController();
                // Uma única consulta verifica API e cadastro. A versão anterior
                // fazia dois fetches com o mesmo timeout, causando AbortError.
                const limite = setTimeout(() => controle.abort(), 18000);
                try {
                    const resposta = await fetch(`${API_URL}?action=statusCadastro&token=${encodeURIComponent(TOKEN_API)}`, {
                        cache: 'no-store', signal: controle.signal
                    });
                    const json = await resposta.json();
                    if (!resposta.ok) throw new Error(`Serviço indisponível (HTTP ${resposta.status}).`);
                    if (json.status !== 'sucesso') {
                        throw new Error(json.mensagem === 'Acesso não autorizado'
                            ? 'Chave de integração diferente da configurada no Apps Script.'
                            : 'O serviço respondeu com erro. Confira a implantação do Apps Script.');
                    }
                    bancoInicializado = true;
                    primeiroCadastroDisponivel = json.primeiroCadastroDisponivel === true;
                    const acessoInicial = document.getElementById('cardPrimeiroAcesso');
                    if (acessoInicial && !usuarioSelecionadoParaLogin) acessoInicial.hidden = !primeiroCadastroDisponivel;
                    if (!loginOcupado) {
                        if (json.versaoAcesso !== VERSAO_ACESSO_ESPERADA) {
                            atualizarStatusLogin('Conexão ativa, mas a versão publicada do Apps Script é anterior à versão deste login. Atualize a implantação.', 'error');
                        } else {
                            atualizarStatusLogin('', 'success', false);
                        }
                    }
                } catch (erro) {
                    console.warn('Pré-verificação de conexão em segundo plano:', erro);
                    if (!loginOcupado) atualizarStatusLogin(
                        erro?.name === 'AbortError'
                            ? 'O servidor demorou a responder. Você ainda pode tentar entrar ou verificar novamente.'
                            : (navigator.onLine ? (erro.message || 'Não foi possível consultar o Apps Script.')
                                : 'Sem internet. Verifique a conexão.'), 'error');
                } finally {
                    clearTimeout(limite);
                    if (retry) retry.disabled = false;
                }
            })().finally(() => { conexaoInicialEmAndamento = null; });
            return conexaoInicialEmAndamento;
        }

        function tentarConexaoNovamente() {
            atualizarStatusLogin('Tentando novamente...', 'loading');
            return testarConexaoInicial().then(() => {
                if (!bancoInicializado) atualizarStatusLogin('Sem conexão. Verifique sua internet e tente novamente.', 'error');
            });
        }

        document.addEventListener('DOMContentLoaded', () => {
            testarConexaoInicial();
        });

        function mensagemFalhaLogin(resposta, etapa = 'senha') {
            const codigo = String(resposta?.codigo || '');
            const mensagem = String(resposta?.mensagem || '');
            if (codigo === 'BLOQUEIO_TEMPORARIO' || /Muitas tentativas/i.test(mensagem))
                return 'Muitas tentativas de acesso. Aguarde 15 minutos antes de tentar novamente.';
            if (codigo === 'SENHA_NAO_CONFIGURADA' || /não possui palavra-passe cadastrada/i.test(mensagem))
                return 'Sua conta não tem uma senha válida cadastrada no Sheets. É necessário recuperar o acesso pelo administrador.';
            if (codigo === 'SENHA_INCORRETA' || /Palavra-passe incorreta/i.test(mensagem))
                return 'A senha digitada não corresponde à cadastrada. Verifique-a antes de tentar novamente.';
            if (codigo === 'USUARIO_DESATIVADO' || /usuário está desativado/i.test(mensagem))
                return 'Esta conta está desativada. Solicite a reativação ao administrador.';
            if (codigo === 'USUARIO_NAO_ENCONTRADO' || /Usuário não encontrado/i.test(mensagem))
                return 'Usuário não encontrado. Volte e confira o nome de acesso.';
            if (codigo === 'CREDENCIAL_MODIFICADA')
                return 'A senha foi modificada durante a tentativa. Tente entrar novamente.';
            if (/Acesso não autorizado/i.test(mensagem))
                return 'A chave de integração não corresponde à configurada no Apps Script.';
            if (/Ação inválida/i.test(mensagem))
                return 'A versão publicada do Apps Script não reconhece este login. Publique uma nova implantação.';
            if (resposta?.status === 'sucesso' && etapa === 'senha')
                return 'A resposta de autenticação está incompleta. Atualize a implantação do Apps Script.';
            return etapa === 'usuario'
                ? 'Não foi possível identificar o usuário. Confira a implantação e tente novamente.'
                : 'O servidor recusou a autenticação. Consulte o detalhe retornado no console e tente novamente.';
        }

        async function consultarLoginServidor(payload) {
            const controle = new AbortController();
            const limite = setTimeout(() => controle.abort(), 18000);
            try {
                const resposta = await fetch(API_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                    body: JSON.stringify({ action: 'verificarCredenciaisLogin', token: TOKEN_API, ...payload }),
                    signal: controle.signal
                });
                if (!resposta.ok) throw new Error(`Servidor não respondeu (HTTP ${resposta.status}).`);
                const dados = await resposta.json();
                if (!dados || typeof dados.status !== 'string') throw new Error('Resposta inesperada da autenticação.');
                return dados;
            } finally {
                clearTimeout(limite);
            }
        }

        async function realizarLogin(event) {
            if (event) event.preventDefault();

            const inputUsuario = document.getElementById("inputUsuario");
            const inputSenha = document.getElementById("inputSenha");
            const blocoSenha = document.getElementById("blocoSenha");
            const botao = document.getElementById("loginSubmit");
            const textoBotao = document.querySelector(".login-submit-text");
            const spanTextoBotao = document.querySelector(".login-submit-text span:first-child") || textoBotao;
            const setaBotao = document.getElementById("loginSubmitArrow");
            const gifLoadingBotao = document.getElementById("loginSubmitLoadingGif");
            const wrapperInputUsuario = document.getElementById("wrapperInputUsuario");
            const iconeUsuarioPadrao = document.getElementById("iconeUsuarioPadrao");
            const loginEyebrowText = document.getElementById("loginEyebrowText");
            const loginTitleText = document.getElementById("loginTitleText");
            const loginSubtitleText = document.getElementById("loginSubtitleText");
            const cardPrimeiroAcesso = document.getElementById("cardPrimeiroAcesso");

            if (loginOcupado) return;

            loginOcupado = true;
            if (botao) botao.disabled = true;
            try {
                // PASSO 1: IDENTIFICAR O USUÁRIO DIGITADO E BUSCAR APENAS OS DADOS DELE NO SERVIDOR
                if (!usuarioSelecionadoParaLogin) {
                    const usuarioDigitado = inputUsuario.value.trim();
                    if (!usuarioDigitado) return;

                    if (botao) botao.classList.add("loading");
                    if (spanTextoBotao) spanTextoBotao.textContent = "Validando usuário...";
                    if (setaBotao) setaBotao.style.display = "none";
                    if (gifLoadingBotao) gifLoadingBotao.style.display = "inline-block";
                    atualizarStatusLogin('Procurando seu usuário...', 'loading');

                    const resultadoCheck = await consultarLoginServidor({
                        usuario: usuarioDigitado,
                        senhaHash: 'CHECK_APENAS_USUARIO'
                    });
                    if (resultadoCheck.status !== 'sucesso' || !resultadoCheck.usuario) {
                        console.warn('Consulta de usuário recusada:', resultadoCheck.codigo || resultadoCheck.mensagem);
                        atualizarStatusLogin(mensagemFalhaLogin(resultadoCheck, 'usuario'), 'error');
                        inputUsuario.focus();
                        if (botao) botao.classList.remove("loading");
                        if (spanTextoBotao) spanTextoBotao.textContent = "Continuar";
                        if (setaBotao) setaBotao.style.display = "inline";
                        if (gifLoadingBotao) gifLoadingBotao.style.display = "none";
                        return;
                    }

                    const usuarioUnico = resultadoCheck.usuario;
                    if (!usuarioUnico) {
                        atualizarStatusLogin('Confira o usuário e tente novamente.', 'error');
                        if (botao) botao.classList.remove("loading");
                        if (spanTextoBotao) spanTextoBotao.textContent = "Continuar";
                        if (setaBotao) setaBotao.style.display = "inline";
                        if (gifLoadingBotao) gifLoadingBotao.style.display = "none";
                        return;
                    }

                    usuarioSelecionadoParaLogin = usuarioUnico;
                    inputUsuario.readOnly = true;
                    inputUsuario.classList.add('login-input-locked');

                    if (iconeUsuarioPadrao) {
                        iconeUsuarioPadrao.remove();
                    }
                    const avatarImg = document.createElement("img");
                    avatarImg.id = "avatarDinamicoInput";
                    avatarImg.src = usuarioSelecionadoParaLogin.fotoPerfil || AVATAR_PADRAO;
                    avatarImg.alt = "Avatar";
                    wrapperInputUsuario.prepend(avatarImg);

                    const primeiroNome = usuarioSelecionadoParaLogin.nome.split(' ')[0];
                    if (loginEyebrowText) loginEyebrowText.textContent = "AUTENTICAÇÃO";
                    if (loginTitleText) loginTitleText.textContent = `Bem-vindo, ${primeiroNome}!`;
                    
                    if (loginSubtitleText) {
                        loginSubtitleText.innerHTML = `Digite a sua senha <br><button type="button" class="btn-voltar-usuario" onclick="voltarParaTrocarUsuario()">← Voltar / Trocar usuário</button>`;
                    }

                    if (cardPrimeiroAcesso) cardPrimeiroAcesso.hidden = true;

                    blocoSenha.hidden = false;
                    if (botao) botao.classList.remove("loading");
                    if (spanTextoBotao) spanTextoBotao.textContent = "Entrar no Sistema";
                    if (setaBotao) setaBotao.style.display = "inline";
                    if (gifLoadingBotao) gifLoadingBotao.style.display = "none";
                    atualizarStatusLogin('', 'success', false);
                    
                    setTimeout(() => inputSenha.focus(), 50);
                    return;
                }

                // PASSO 2: VALIDAR A SENHA DE FORMA OTIMIZADA DIRETAMENTE NA NUVEM
                const senhaDigitada = inputSenha.value.trim();
                if (!senhaDigitada) {
                    atualizarStatusLogin('Digite sua senha para continuar.', 'error');
                    inputSenha.focus();
                    return;
                }

                if (botao) botao.classList.add("loading");
                if (spanTextoBotao) spanTextoBotao.textContent = "Validando senha...";
                if (setaBotao) setaBotao.style.display = "none";
                if (gifLoadingBotao) gifLoadingBotao.style.display = "inline-block";
                atualizarStatusLogin('Conferindo suas credenciais...', 'loading');

                const hashDigitado = await gerarHash(senhaDigitada);
                const resultadoAuth = await consultarLoginServidor({
                    usuario: usuarioSelecionadoParaLogin.usuario || usuarioSelecionadoParaLogin.nome,
                    senhaHash: hashDigitado
                });

                if (resultadoAuth.status !== 'sucesso' || !resultadoAuth.usuario?.id) {
                    console.warn('Autenticação recusada pelo servidor:', resultadoAuth.codigo || resultadoAuth.mensagem);
                    atualizarStatusLogin(mensagemFalhaLogin(resultadoAuth), 'error');
                    inputSenha.value = '';
                    inputSenha.focus();
                    if (botao) botao.classList.remove("loading");
                    if (spanTextoBotao) spanTextoBotao.textContent = "Entrar no Sistema";
                    if (setaBotao) setaBotao.style.display = "inline";
                    if (gifLoadingBotao) gifLoadingBotao.style.display = "none";
                    return;
                }

                if (!resultadoAuth.sessao) throw new Error('Sessão ausente na resposta de autenticação.');
                const donoPendente = localStorage.getItem(CHAVE_DONO_PENDENCIAS);
                if (localStorage.getItem('syncPendente') === 'true' && donoPendente && donoPendente !== String(resultadoAuth.usuario.id)) {
                    throw new Error('Existem alterações financeiras não sincronizadas de outra conta neste navegador. Entre primeiro na conta anterior para sincronizá-las.');
                }
                sessionStorage.setItem(CHAVE_SESSAO_API, resultadoAuth.sessao);
                sessionStorage.setItem(CHAVE_USUARIO_SESSAO, String(resultadoAuth.usuario.id));

                // Com dados locais válidos, a navegação é imediata. A página seguinte
                // revalida silenciosamente a revisão do servidor em segundo plano.
                // No primeiro acesso, carregamos o mínimo necessário antes de navegar.
                atualizarStatusLogin('Preparando seu painel...', 'loading');
                const cacheAtual = lerJSONLocal(DB_KEY, null);
                const usuarioEmCache = cacheAtual?.usuarios?.some(u => String(u.id) === String(resultadoAuth.usuario.id) && u.ativo !== false);
                if (!usuarioEmCache) {
                    await inicializarBanco();
                    const dadosCarregados = obterDados();
                    if (!dadosCarregados.usuarios.some(u => String(u.id) === String(resultadoAuth.usuario.id) && u.ativo !== false)) {
                        throw new Error('A conta autenticada não está disponível no armazenamento local.');
                    }
                }
                localStorage.setItem('usuarioLogado', String(resultadoAuth.usuario.id));
                localStorage.setItem('privacidadeAtiva', 'true');
                if (spanTextoBotao) spanTextoBotao.textContent = 'Abrindo seu espaço...';
                window.location.href = resultadoAuth.trocaSenhaObrigatoria ? 'perfil.html' : 'dashboard.html';
                return true;

            } catch (erro) {
                console.error("Erro no processo de login:", erro);
                if (botao) botao.classList.remove("loading");
                if (spanTextoBotao) spanTextoBotao.textContent = usuarioSelecionadoParaLogin ? "Entrar no Sistema" : "Continuar";
                if (setaBotao) setaBotao.style.display = "inline";
                if (gifLoadingBotao) gifLoadingBotao.style.display = "none";
                localStorage.removeItem('usuarioLogado');
                sessionStorage.removeItem(CHAVE_SESSAO_API);
                sessionStorage.removeItem(CHAVE_USUARIO_SESSAO);
                const mensagemAcesso = !navigator.onLine
                    ? 'Sem internet. Reconecte e tente novamente.'
                    : erro?.name === 'AbortError'
                        ? 'O servidor demorou a responder. Tente novamente em alguns instantes.'
                        : /verificação segura de senha exige HTTPS ou localhost/i.test(erro?.message || '')
                            ? erro.message
                        : /Sessão ausente|conta autenticada|Resposta inesperada/i.test(erro?.message || '')
                            ? (erro.message + ' Confira se a nova versão do Apps Script foi publicada.')
                            : 'Não foi possível concluir o acesso após a tentativa de autenticação. Confira a conexão e os detalhes no console.';
                atualizarStatusLogin(mensagemAcesso, 'error');
            } finally {
                loginOcupado = false;
                if (botao) botao.disabled = false;
            }
        }

        function voltarParaTrocarUsuario() {
            usuarioSelecionadoParaLogin = null;
            
            const inputUsuario = document.getElementById("inputUsuario");
            const inputSenha = document.getElementById("inputSenha");
            const blocoSenha = document.getElementById("blocoSenha");
            const textoBotao = document.querySelector(".login-submit-text");
            const spanTextoBotao = document.querySelector(".login-submit-text span:first-child") || textoBotao;
            const setaBotao = document.getElementById("loginSubmitArrow");
            const gifLoadingBotao = document.getElementById("loginSubmitLoadingGif");
            const wrapperInputUsuario = document.getElementById("wrapperInputUsuario");
            const avatarDinamicoInput = document.getElementById("avatarDinamicoInput");
            const loginEyebrowText = document.getElementById("loginEyebrowText");
            const loginTitleText = document.getElementById("loginTitleText");
            const loginSubtitleText = document.getElementById("loginSubtitleText");
            const cardPrimeiroAcesso = document.getElementById("cardPrimeiroAcesso");

            inputUsuario.readOnly = false;
            inputUsuario.classList.remove('login-input-locked');
            inputUsuario.value = '';

            if (avatarDinamicoInput) {
                avatarDinamicoInput.remove();
            }
            if (!document.getElementById("iconeUsuarioPadrao")) {
                const iconePadrao = document.createElement("span");
                iconePadrao.id = "iconeUsuarioPadrao";
                iconePadrao.className = "login-field-icon";
                iconePadrao.textContent = "👤";
                wrapperInputUsuario.prepend(iconePadrao);
            }

            blocoSenha.hidden = true;
            inputSenha.value = '';

            if (spanTextoBotao) spanTextoBotao.textContent = "Continuar";
            if (setaBotao) setaBotao.style.display = "inline";
            if (gifLoadingBotao) gifLoadingBotao.style.display = "none";
            if (loginEyebrowText) loginEyebrowText.textContent = "BOM TER VOCÊ POR AQUI";
            if (loginTitleText) loginTitleText.textContent = "Vamos começar?";
            if (loginSubtitleText) loginSubtitleText.textContent = "Seu acesso, de forma simples e segura.";
            if (cardPrimeiroAcesso) cardPrimeiroAcesso.hidden = !primeiroCadastroDisponivel;

            atualizarStatusLogin('', 'success', false);

            inputUsuario.focus();
        }

        function atualizarIconeTemaLogin() {
            const icone = document.getElementById('loginThemeGlyph');
            const botao = document.querySelector('.login-theme-toggle');
            const escuro = document.body.classList.contains('dark-mode');
            if (icone) icone.textContent = escuro ? '☀' : '☾';
            if (botao) botao.setAttribute('aria-label', escuro ? 'Usar tema claro' : 'Usar tema escuro');
        }

        document.addEventListener("DOMContentLoaded", () => {
            atualizarIconeTemaLogin();
        });

        const alternarTemaOriginal = window.alternarTemaVisual;
        window.alternarTemaVisual = function (event) {
            if (typeof alternarTemaOriginal === "function") {
                alternarTemaOriginal(event);
            }
            requestAnimationFrame(() => {
                atualizarIconeTemaLogin();
            });
        };
    

// ===== Eventos migrados dos atributos on* do HTML =====
// Liga apenas os elementos estáticos marcados por data-page-handler,
// sem executar JavaScript como string e sem registrar eventos em duplicidade.
(function vincularEventosDaPagina() {
    const eventos = {
        "index-1": [
            ["click", function(event) {
                alternarTemaVisual(event)
            }],
        ],
        "index-2": [
            ["submit", function(event) {
                realizarLogin(event)
            }],
        ],
        "index-3": [
            ["click", function(event) {
                abrirModalPrimeiroAcesso()
            }],
        ],
        "index-4": [
            ["click", function(event) {
                tentarConexaoNovamente()
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

