// Controle Financeiro | Página: admin-logs.html
// Arquivo extraído dos scripts embutidos no HTML original.
// Carregar APÓS js/script.js, js/calculos_trabalhistas.js e js/conexao_sheets.js.
// Mantém funções globais clássicas usadas por elementos gerados dinamicamente.

// ===== Bloco inline original 1 =====
        let painelAdminLiberado = false;
        let paginaAtualLogs = 1;
        let logsFiltradosAtuais = [];

        document.addEventListener('DOMContentLoaded', async () => {
            injetarHeader();
            const autenticado = await verificarAutenticacao();
            if (!autenticado) return;
            document.getElementById('divLoginAdmin').hidden = false;
            if (!usuarioPode('logs')) {
                document.getElementById('formAcessoAuditoria').hidden = true;
                document.querySelector('#divLoginAdmin h2').textContent = 'Acesso não permitido';
                document.querySelector('#divLoginAdmin > p').textContent = 'Sua conta não possui permissão para consultar auditoria. Solicite acesso a um administrador.';
                return;
            }
            const campo = document.getElementById('senhaAdminInput');
            const alternar = document.getElementById('alternarSenhaAdmin');
            alternar.addEventListener('click', () => {
                const visivel = campo.type === 'password';
                campo.type = visivel ? 'text' : 'password';
                alternar.textContent = visivel ? 'Ocultar' : 'Mostrar';
                alternar.setAttribute('aria-pressed', String(visivel));
                alternar.setAttribute('aria-label', visivel ? 'Ocultar senha' : 'Mostrar senha');
            });
            ['filtroLogs', 'filtroAcaoLogs', 'filtroPeriodoLogs', 'quantidadeLogsPagina'].forEach(id => {
                document.getElementById(id).addEventListener(id === 'filtroLogs' ? 'input' : 'change', () => {
                    paginaAtualLogs = 1;
                    carregarTabelaLogs();
                });
            });
        });

        async function autenticarPainelAdmin() {
            if (!usuarioPode('logs')) return;
            const campo = document.getElementById('senhaAdminInput');
            const senha = campo.value.trim();
            if (!senha) return;
            const botao = document.getElementById('btnAcessarAuditoria');
            const status = document.getElementById('statusAcessoAdmin');
            botao.disabled = true;
            botao.textContent = 'Verificando acesso…';
            status.textContent = 'Validando credenciais com o servidor…';
            status.dataset.state = 'loading';
            try {
                const resposta = await fetch(API_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                    body: JSON.stringify({ action: 'verificarAdmin', token: TOKEN_API, sessao: obterSessaoAPI(), senha })
                });
                if (!resposta.ok) throw new Error('Servidor indisponível.');
                const resultado = await resposta.json();
                if (resultado.status === 'sucesso' && resultado.autorizado === true) {
                    localStorage.removeItem('adminAutorizado');
                    const dados = obterDados();
                    registrarLog(dados, 'LOGIN ADMIN', 'Administrador acessou o painel de auditoria');
                    await salvarDados(dados);
                    campo.value = '';
                    liberarPainelAdmin();
                } else {
                    campo.value = '';
                    status.textContent = 'Senha incorreta. Confira e tente novamente.';
                    status.dataset.state = 'error';
                    campo.focus();
                }
            } catch (erro) {
                console.error('Falha de validação administrativa:', erro);
                status.textContent = 'Não foi possível validar agora. Confira sua conexão e tente novamente.';
                status.dataset.state = 'error';
            } finally {
                botao.disabled = false;
                botao.textContent = 'Desbloquear auditoria →';
            }
        }

        function liberarPainelAdmin() {
            painelAdminLiberado = true;
            document.getElementById('divLoginAdmin').hidden = true;
            document.getElementById('divConteudoAdmin').hidden = false;
            atualizarOpcoesAcoes();
            paginaAtualLogs = 1;
            carregarTabelaLogs();
        }

        function bloquearPainelAdmin() {
            painelAdminLiberado = false;
            logsFiltradosAtuais = [];
            document.getElementById('tabelaLogs').replaceChildren();
            document.getElementById('divConteudoAdmin').hidden = true;
            document.getElementById('divLoginAdmin').hidden = false;
            document.getElementById('statusAcessoAdmin').textContent = '';
            document.getElementById('senhaAdminInput').focus();
        }

        function timestampLog(log) {
            const valor = log.dataHora || log.createdAt || log.timestamp;
            const ts = valor ? new Date(valor).getTime() : NaN;
            return Number.isFinite(ts) ? ts : 0;
        }

        function obterLogsOrdenados() {
            return [...(obterDados().logs || [])].sort((a, b) => timestampLog(b) - timestampLog(a));
        }

        function atualizarOpcoesAcoes() {
            const select = document.getElementById('filtroAcaoLogs');
            const atual = select.value;
            const acoes = [...new Set(obterLogsOrdenados().map(log => String(log.acao || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
            select.replaceChildren(new Option('Todas as ações', ''));
            acoes.forEach(acao => select.add(new Option(acao, acao)));
            select.value = acoes.includes(atual) ? atual : '';
        }

        function carregarTabelaLogs() {
            if (!painelAdminLiberado || !usuarioPode('logs')) return;
            const todos = obterLogsOrdenados();
            const busca = normalizarTexto(document.getElementById('filtroLogs').value.trim());
            const acao = document.getElementById('filtroAcaoLogs').value;
            const periodo = document.getElementById('filtroPeriodoLogs').value;
            const dias = periodo === 'todos' ? 0 : Number(periodo);
            const limite = dias ? Date.now() - dias * 86400000 : 0;
            logsFiltradosAtuais = todos.filter(log => {
                if (acao && log.acao !== acao) return false;
                if (dias && (!timestampLog(log) || timestampLog(log) < limite)) return false;
                return !busca || normalizarTexto(`${log.dataHoraFormatada || log.dataHora || ''} ${log.usuario || ''} ${log.acao || ''} ${log.detalhes || ''}`).includes(busca);
            });
            document.getElementById('auditoriaTotalEventos').textContent = todos.length.toLocaleString('pt-BR');
            document.getElementById('auditoriaEventosRecentes').textContent = todos.filter(log => timestampLog(log) >= Date.now() - 7 * 86400000).length.toLocaleString('pt-BR');
            document.getElementById('auditoriaUsuariosUnicos').textContent = new Set(todos.map(log => normalizarTexto(String(log.usuario || 'Sistema')))).size.toLocaleString('pt-BR');
            document.getElementById('contadorLogs').textContent = `${logsFiltradosAtuais.length.toLocaleString('pt-BR')} de ${todos.length.toLocaleString('pt-BR')} registros`;

            const porPagina = Number(document.getElementById('quantidadeLogsPagina').value) || 20;
            const totalPaginas = Math.max(1, Math.ceil(logsFiltradosAtuais.length / porPagina));
            paginaAtualLogs = Math.min(Math.max(1, paginaAtualLogs), totalPaginas);
            const inicio = (paginaAtualLogs - 1) * porPagina;
            const tbody = document.getElementById('tabelaLogs');
            tbody.replaceChildren();
            const pagina = logsFiltradosAtuais.slice(inicio, inicio + porPagina);
            if (!pagina.length) {
                const td = tbody.insertRow().insertCell();
                td.colSpan = 4;
                td.className = 'account-table-empty';
                td.textContent = 'Nenhum registro encontrado. Experimente ajustar os filtros.';
            } else pagina.forEach(log => {
                const tr = tbody.insertRow();
                const data = timestampLog(log) ? new Date(timestampLog(log)).toLocaleString('pt-BR') : (log.dataHoraFormatada || '-');
                [data, log.usuario || 'Sistema', log.acao || '-', log.detalhes || '-'].forEach((valor, i) => {
                    const td = tr.insertCell();
                    td.textContent = String(valor);
                    td.dataset.label = ['Data / hora', 'Usuário', 'Ação', 'Detalhes'][i];
                    if (i === 2) {
                        const badge = document.createElement('span');
                        badge.className = 'account-action-badge';
                        badge.textContent = td.textContent;
                        td.replaceChildren(badge);
                    }
                });
            });
            document.getElementById('paginacaoResumoLogs').textContent = logsFiltradosAtuais.length ? `Exibindo ${inicio + 1}–${Math.min(inicio + porPagina, logsFiltradosAtuais.length)} de ${logsFiltradosAtuais.length}` : 'Nenhum registro';
            document.getElementById('paginacaoLogs').textContent = `${paginaAtualLogs} / ${totalPaginas}`;
            document.getElementById('logsPaginaAnterior').disabled = paginaAtualLogs <= 1;
            document.getElementById('logsPaginaProxima').disabled = paginaAtualLogs >= totalPaginas;
        }

        function mudarPaginaAuditoria(direcao) {
            if (!painelAdminLiberado) return;
            paginaAtualLogs += direcao;
            carregarTabelaLogs();
        }

        function limparFiltrosAuditoria() {
            document.getElementById('filtroLogs').value = '';
            document.getElementById('filtroAcaoLogs').value = '';
            document.getElementById('filtroPeriodoLogs').value = 'todos';
            paginaAtualLogs = 1;
            carregarTabelaLogs();
        }

        function exportarLogsCSV() {
            if (!painelAdminLiberado || !usuarioPode('logs')) return;
            const celula = valor => {
                const texto = String(valor ?? '').replace(/\r?\n/g, ' ');
                const seguro = /^\s*[=+\-@]/.test(texto) ? "'" + texto : texto;
                return '"' + seguro.replace(/"/g, '""') + '"';
            };
            const linhas = [['Data/hora', 'Usuário', 'Ação', 'Detalhes'].map(celula).join(';')];
            logsFiltradosAtuais.forEach(log => linhas.push([timestampLog(log) ? new Date(timestampLog(log)).toLocaleString('pt-BR') : (log.dataHoraFormatada || ''), log.usuario || '', log.acao || '', log.detalhes || ''].map(celula).join(';')));
            const url = URL.createObjectURL(new Blob(['\uFEFF' + linhas.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
            const link = document.createElement('a');
            link.href = url;
            link.download = `auditoria_financeiro_${new Date().toISOString().slice(0, 10)}.csv`;
            link.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        }

        async function limparLogsSistemaComSenha() {
            if (!painelAdminLiberado || !await exigirPermissao('logs', 'limpar logs de auditoria')) return;
            if (!await verificarSenhaAdmin('limpeza de logs')) return;
            if (!await mostrarConfirmacaoModal('Apagar todo o histórico de auditoria? Essa operação remove os registros atuais permanentemente.')) return;
            mostrarLoading('Limpando logs…');
            try {
                const dados = obterDados();
                dados.logs = [];
                registrarLog(dados, 'LIMPEZA DE LOGS', 'Histórico de auditoria foi limpo pelo administrador');
                await salvarDados(dados);
                atualizarOpcoesAcoes();
                paginaAtualLogs = 1;
                carregarTabelaLogs();
            } catch (erro) {
                console.error('Erro ao limpar logs:', erro);
                await mostrarAlertaModal('Não foi possível concluir a limpeza dos logs.');
            } finally { esconderLoading(); }
        }
    

// ===== Eventos migrados dos atributos on* do HTML =====
// Liga apenas os elementos estáticos marcados por data-page-handler,
// sem executar JavaScript como string e sem registrar eventos em duplicidade.
(function vincularEventosDaPagina() {
    const eventos = {
        "admin-logs-1": [
            ["submit", function(event) {
                event.preventDefault(); autenticarPainelAdmin();
            }],
        ],
        "admin-logs-2": [
            ["click", function(event) {
                bloquearPainelAdmin()
            }],
        ],
        "admin-logs-3": [
            ["click", function(event) {
                carregarTabelaLogs()
            }],
        ],
        "admin-logs-4": [
            ["click", function(event) {
                exportarLogsCSV()
            }],
        ],
        "admin-logs-5": [
            ["click", function(event) {
                limparFiltrosAuditoria()
            }],
        ],
        "admin-logs-6": [
            ["click", function(event) {
                mudarPaginaAuditoria(-1)
            }],
        ],
        "admin-logs-7": [
            ["click", function(event) {
                mudarPaginaAuditoria(1)
            }],
        ],
        "admin-logs-8": [
            ["click", function(event) {
                limparLogsSistemaComSenha()
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

