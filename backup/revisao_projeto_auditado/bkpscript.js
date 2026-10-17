// Arquivo: script.js (Revisado)
async function gerarHash(texto) {
    const encoder = new TextEncoder();
    const data = encoder.encode(texto);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

const DB_KEY = 'sistemaFinanceiroCompartilhado';
const BACKUP_TESTE_KEY = 'sistemaFinanceiroBackupTeste';
const API_URL = "https://script.google.com/macros/s/AKfycbyTOJtjTto1BR0NXu2Aynul9UVuOOeZlCwvcYvMLgDqHKe4RDpZdefozcQOxOQOA9og/exec";
const TOKEN_API = "PLANOF1NALPRAS4AIRD@MERDA";
const SCHEMA_VERSION = 3;
const SYNC_DEBOUNCE_MS = 1500;
const SYNC_BASELINE_KEY = 'sistemaFinanceiroSnapshotSincronizado';
const SYNC_CONFLICT_KEY = 'sistemaFinanceiroConflitoSync';
const COLECOES_DADOS = ['usuarios', 'categorias', 'cartoes', 'lancamentos', 'financiamentos', 'bens', 'notificacoes', 'logs', 'exclusao_movimento', 'edicao_movimento'];

let syncTimer = null;
let syncPendingData = null;
let syncInFlight = false;
let ultimaSincronizacaoStatus = 'idle';
let processandoAcaoModal = false;
let memoriaSistema = null;
let verificacaoAutenticacaoPromise = null;

// Instâncias de gráficos separadas para não dar conflito entre telas
let chartEntradasSaidasInstance = null;
let chartGastosCategoriasInstance = null;
let chartCartoesLimiteInstance = null;
let chartRelatorioESInstance = null;
let chartRelatorioCatInstance = null;
let chartServicosEssenciaisInstance = null;
let chartServicosEssenciaisRelInstance = null; 

function injetarHeader() {
    const headerHTML = `
    <style>
        @keyframes pulsoSuave {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.4; }
        }
    </style>
    <header class="app-header">
        <div class="header-inner">
            <div class="header-left">
                <div class="brand">
                    <span class="brand-title">Controle Financeiro</span>
                    <span class="brand-subtitle">Gestão Inteligente</span>
                </div>
                <div class="header-perfil-sync">
                    <span id="usuarioLogadoNome" class="user-chip"></span>
                    <span id="syncStatusIcon" title="Sincronizado" style="cursor: pointer; display: flex; align-items: center;">
                        <img src="imagens/sincronizar.png" alt="Sync" style="width: 22px; height: 22px; object-fit: contain;">
                    </span>
                    <span id="headerLoadingText" style="display: none; font-size: 0.85rem; font-weight: 700; color: var(--primary); margin-left: 12px; animation: pulsoSuave 1.5s infinite ease-in-out;"></span>
                </div>
            </div>
            <nav class="app-nav-center" aria-label="Navegação principal">
                <a href="dashboard.html">Início</a>
                <div class="nav-dropdown" style="position: relative;">
                    <a href="#" onclick="event.preventDefault();" style="cursor: pointer;">Cadastros ▾</a>
                    <div class="nav-dropdown-content" style="position: absolute; top: 100%; left: 0;">
                        <a href="cartoes.html">Cartões</a>
                        <a href="categorias.html">Categorias</a>
                        <a href="bens.html">Bens</a>
                        <a href="financiamentos.html">Financiamentos</a>
                    </div>
                </div>
                <a href="lancamentos.html">Lançamentos</a>
                <a href="central-pagamentos.html">Central de Pagamentos</a>
                <a href="relatorios.html">Relatórios</a>
            </nav>
            <div class="header-right">
                <div class="header-tools">
                    <button type="button" onclick="alternarPrivacidade()" title="Ocultar/Mostrar Valores" id="btnPrivacidade">
                        <img src="imagens/esconder.png" alt="Privacidade" id="imgPrivacidade">
                    </button>
                    <button type="button" onclick="alternarTemaVisual(event)" title="Alternar tema">
                        <img src="imagens/modo_escuro.jpg" alt="Tema">
                    </button>
                    <a href="configuracoes.html" title="Configurações">
                        <img src="imagens/config.png" alt="Configurações">
                    </a>
                    <button type="button" title="Notificações" id="btnNotificacoesHeader">
                        <img src="imagens/notificacao.png" alt="Notificações" onerror="this.style.display='none'">
                    </button>
                </div>
                <div class="header-tools" style="border-left: 1px solid var(--border-color, #e5e7eb); padding-left: 18px;">
                    <a href="index.html" onclick="event.preventDefault(); deslogarSistema()" class="btn-sair-extremo" title="Sair do sistema">
                        <img src="imagens/exit.png" alt="Sair">
                    </a>
                </div>
            </div>
        </div>
    </header>
    `;
    if (!document.querySelector('.app-header')) {
        document.body.insertAdjacentHTML('afterbegin', headerHTML);
    }
    criarIndicadorSincronizacaoUi();
    atualizarIconePrivacidade();
    atualizarHeaderUsuario();
}

function filtrarDadosPorPermissao(lista, dadosGlobais, escopoFiltro = 'casal') {
    const usuarioAtualId = Number(localStorage.getItem('usuarioLogado'));
    const usuarioAtual = (dadosGlobais.usuarios || []).find(u => Number(u.id) === usuarioAtualId);
    
    if (!usuarioAtual) return [];

    const parceiroId = usuarioAtual.parceiroId ? Number(usuarioAtual.parceiroId) : null;

    return (lista || []).filter(item => {
        const donoId = Number(item.usuarioId);
        if (!item.usuarioId) return true;
        if (escopoFiltro === 'individual') return donoId === usuarioAtualId;
        if (donoId === usuarioAtualId || (parceiroId && donoId === parceiroId)) return true;
        return false;
    });
}

function usuarioPodeAlterarLancamento(lancamento, dados = obterDados()) {
    if (!lancamento) return false;
    const usuario = obterUsuarioAtual(dados);
    if (!usuario) return false;
    const donoId = lancamento.usuarioId == null ? null : String(lancamento.usuarioId);
    const atualId = String(usuario.id);
    if (donoId === atualId) return true;

    // Um parceiro só pode alterar registros compartilhados explicitamente como casal/casa.
    const parceiroId = usuario.parceiroId == null ? null : String(usuario.parceiroId);
    return Boolean(
        parceiroId && donoId === parceiroId && (lancamento.escopo || 'casal') === 'casal'
    );
}

function gerarId(prefixo = 'id') {
    try {
        if (window.crypto && typeof window.crypto.randomUUID === 'function') {
            return `${prefixo}_${window.crypto.randomUUID()}`;
        }
    } catch (_) {}
    return `${prefixo}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function clonarDados(dados) {
    return JSON.parse(JSON.stringify(dados));
}

function validarComplexidadeSenha(senha) {
    const regex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[\W_]).{8,}$/;
    return regex.test(String(senha || ''));
}

async function selecionarUsuario(id) {
    const dados = obterDados();
    const usuario = dados.usuarios.find(u => String(u.id) === String(id));
    if (!usuario) return false;
    if (usuario.ativo === false) {
        await mostrarAlertaModal('Este usuário está desativado. Solicite ao administrador a reativação do acesso.');
        return false;
    }

    const ehUsuarioTeste = normalizarTexto(usuario.nome) === 'teste';
    if (ehUsuarioTeste && (localStorage.getItem('syncPendente') === 'true' || localStorage.getItem(SYNC_CONFLICT_KEY))) {
        await mostrarAlertaModal('Antes de abrir o perfil de teste, sincronize ou resolva as alterações pendentes. Isso evita misturar dados de teste com dados reais.');
        return false;
    }

    const senhaAtual = String(usuario.pin || usuario.senha || "").trim();
    
    if (!senhaAtual) {
        let novaSenha = null;
        let senhaValida = false;

        while (!senhaValida) {
            novaSenha = await mostrarPromptSenha(
                "Primeiro Acesso - Cadastrar Senha",
                `Olá, ${usuario.nome}! Crie uma palavra-passe segura:\n\nRequisitos:\n• Mínimo de 8 carateres\n• Letras (maiúsculas e minúsculas) e números\n• Pelo menos um caráter especial`,
                true
            );

            if (novaSenha === null) return false;

            if (validarComplexidadeSenha(novaSenha)) {
                senhaValida = true;
            } else {
                await mostrarAlertaModal("A palavra-passe informada não cumpre todos os requisitos mínimos de segurança. Tente novamente.");
            }
        }

        const hashSenha = await gerarHash(novaSenha);
        usuario.pin = hashSenha;
        usuario.senha = hashSenha;
        
        registrarLogInterno(dados, "CADASTRO SENHA INICIAL", `Utilizador ${usuario.nome} cadastrou a palavra-passe inicial.`);
        await salvarDados(dados);
        if (ehUsuarioTeste) {
            if (syncTimer) clearTimeout(syncTimer);
            syncTimer = null;
            await sincronizarComServidor();
            if (localStorage.getItem('syncPendente') === 'true' || localStorage.getItem(SYNC_CONFLICT_KEY)) {
                await mostrarAlertaModal('A senha foi preparada localmente, mas o servidor ainda não confirmou a sincronização. Resolva a pendência antes de entrar no perfil de teste.');
                return false;
            }
        }
        await mostrarAlertaModal("Palavra-passe cadastrada com sucesso!");
    } else {
        const senhaDigitada = await mostrarPromptSenha(
            "Verificação de Palavra-passe",
            `Digite a palavra-passe de acesso para ${usuario.nome}:`,
            false
        );
        
        if (senhaDigitada === null) return false;

        const hashDigitado = await gerarHash(senhaDigitada);
        
        if (hashDigitado !== senhaAtual && senhaDigitada !== senhaAtual) {
            await mostrarAlertaModal("Palavra-passe incorreta.");
            return false;
        }

        if (senhaDigitada === senhaAtual && hashDigitado !== senhaAtual) {
            usuario.pin = hashDigitado;
            usuario.senha = hashDigitado;
            await salvarDados(dados);
            if (ehUsuarioTeste) {
                if (syncTimer) clearTimeout(syncTimer);
                syncTimer = null;
                await sincronizarComServidor();
                if (localStorage.getItem('syncPendente') === 'true' || localStorage.getItem(SYNC_CONFLICT_KEY)) {
                    await mostrarAlertaModal('Não foi possível confirmar a atualização da senha no servidor. Resolva a pendência antes de entrar no perfil de teste.');
                    return false;
                }
            }
        }
    }

    mostrarLoading("A entrar no sistema...");
    localStorage.setItem('usuarioLogado', String(usuario.id));
    localStorage.setItem('privacidadeAtiva', 'true');

    if (normalizarTexto(usuario.nome) === 'teste') {
        localStorage.setItem(BACKUP_TESTE_KEY, JSON.stringify(dados));
    }

    registrarLogInterno(dados, "LOGIN", "Utilizador acedeu ao sistema");
    await salvarDados(dados);
    esconderLoading();
    window.location.href = 'dashboard.html';
    return true;
}

function numeroSeguro(valor, padrao = 0) {
    const n = Number(valor);
    return Number.isFinite(n) ? n : padrao;
}

function inteiroSeguro(valor, padrao = 0) {
    const n = parseInt(valor, 10);
    return Number.isFinite(n) ? n : padrao;
}

function paraCentavos(valor) {
    return Math.round(numeroSeguro(valor) * 100);
}

function deCentavos(centavos) {
    return numeroSeguro(centavos) / 100;
}

function formatarMoeda(valor) {
    return new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL'
    }).format(numeroSeguro(valor));
}

function formatarDataBR(dataStr) {
    if (!dataStr) return '-';
    let limpa = String(dataStr).trim();
    if (limpa.includes('T')) limpa = limpa.split('T')[0];
    const partes = limpa.split('-');
    if (partes.length !== 3) return String(dataStr);
    return `${partes[2]}/${partes[1]}/${partes[0]}`;
}

function dataLocalYYYYMMDD(data = new Date()) {
    const ano = data.getFullYear();
    const mes = String(data.getMonth() + 1).padStart(2, '0');
    const dia = String(data.getDate()).padStart(2, '0');
    return `${ano}-${mes}-${dia}`;
}

function criarDataLocal(dataStr) {
    if (!dataStr) return null;
    const partes = String(dataStr).trim().split('-');
    if (partes.length !== 3 || partes.some(parte => !/^\d+$/.test(parte))) return null;
    const [ano, mes, dia] = partes.map(Number);
    if (!Number.isInteger(ano) || !Number.isInteger(mes) || !Number.isInteger(dia) || ano < 1000 || mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
    const data = new Date(ano, mes - 1, dia);
    if (data.getFullYear() !== ano || data.getMonth() !== mes - 1 || data.getDate() !== dia) return null;
    return data;
}

function dataParaString(data) {
    return dataLocalYYYYMMDD(data);
}

function adicionarMesesClamped(dataInicial, meses) {
    const base = new Date(dataInicial);
    const diaOriginal = base.getDate();
    base.setDate(1);
    base.setMonth(base.getMonth() + meses);
    const ultimoDia = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
    base.setDate(Math.min(diaOriginal, ultimoDia));
    return base;
}

function calcularPrimeiroVencimentoCartao(cartao, dataCompra) {
    const compra = criarDataLocal(dataCompra);
    if (!cartao || !compra) return dataCompra || '';

    const fechamentoOriginal = inteiroSeguro(cartao.fechamento, 1);
    const fechamento = Math.min(Math.max(1, fechamentoOriginal), new Date(compra.getFullYear(), compra.getMonth() + 1, 0).getDate());
    const diasCompra = compra.getDate();

    // Compras antes do fechamento entram na próxima fatura; no dia ou após o fechamento,
    // entram no ciclo seguinte. O vencimento ocorre após o fechamento desse ciclo.
    const mesesAteVencimento = diasCompra < fechamento ? 1 : 2;
    const mesVencimento = new Date(compra.getFullYear(), compra.getMonth() + mesesAteVencimento, 1);
    const diaVencimento = Math.max(1, inteiroSeguro(cartao.vencimento, 1));
    const ultimoDiaMes = new Date(mesVencimento.getFullYear(), mesVencimento.getMonth() + 1, 0).getDate();
    mesVencimento.setDate(Math.min(diaVencimento, ultimoDiaMes));
    return dataParaString(mesVencimento);
}

function dividirValorExato(valor, quantidade) {
    const qtd = Math.max(1, inteiroSeguro(quantidade, 1));
    const totalCentavos = paraCentavos(valor);
    const base = Math.floor(totalCentavos / qtd);
    const resto = totalCentavos % qtd;
    return Array.from({ length: qtd }, (_, index) => deCentavos(base + (index < resto ? 1 : 0)));
}

function normalizarTexto(texto) {
    return String(texto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
}

function escaparHTML(valor) {
    const div = document.createElement('div');
    div.textContent = valor == null ? '' : String(valor);
    return div.innerHTML;
}

function obterUsuarioAtual(dados = obterDados()) {
    const usuarioId = localStorage.getItem('usuarioLogado');
    return dados.usuarios.find(u => String(u.id) === String(usuarioId)) || null;
}

function obterUsuarioAtualId(dados = obterDados()) {
    const usuario = obterUsuarioAtual(dados);
    return usuario ? usuario.id : null;
}


function permissaoPaginaAtual() {
    const arquivo = String(window.location.pathname || '').split('/').pop().toLowerCase();
    const mapa = {
        'dashboard.html': 'dashboard',
        'relatorios.html': 'relatorios',
        'lancamentos.html': 'lancamentos',
        'editar-lancamento.html': 'lancamentos',
        'central-pagamentos.html': 'lancamentos',
        'detalhes-central-parcelada.html': 'lancamentos',
        'cartoes.html': 'cartoes',
        'categorias.html': 'categorias',
        'configuracoes.html': 'configuracoes',
        'admin-logs.html': 'configuracoes',
        'financiamentos.html': 'configuracoes',
        'detalhes-financiamento.html': 'configuracoes',
        'bens.html': 'configuracoes'
    };
    return mapa[arquivo] || null;
}

function usuarioPode(acao, dados = obterDados()) {
    const usuario = obterUsuarioAtual(dados);
    if (!usuario || usuario.ativo === false) return false;

    const permissoes = usuario.permissoes;
    // Contas legadas recebem matriz explícita durante migrarDados(). Mantemos
    // compatibilidade apenas quando o campo realmente não existe.
    if (!permissoes || typeof permissoes !== 'object') return true;
    if (permissoes.perfil === 'admin') return true;

    const campo = {
        criarMovimento: 'criarMovimento',
        excluirMovimento: 'excluirMovimento',
        financiamentos: 'financiamentos',
        lotes: 'lotes',
        usuarios: 'usuarios',
        logs: 'logs'
    }[acao];
    if (!campo) return false;
    return permissoes.acoes?.[campo] === true;
}

async function exigirPermissao(acao, descricao = 'realizar esta operação', dados = obterDados()) {
    if (usuarioPode(acao, dados)) return true;
    await mostrarAlertaModal(`Seu perfil não tem permissão para ${descricao}. Solicite acesso ao administrador.`);
    return false;
}

function usuarioPodeAcessarPagina(usuario, chavePagina) {
    if (!chavePagina) return true;
    const permissoes = usuario?.permissoes;
    // A migração converte contas sem matriz. Esta exceção é só para compatibilidade
    // transitória com dados ainda não migrados; objetos parciais não ganham acesso.
    if (!permissoes || typeof permissoes !== 'object') return true;
    const paginas = permissoes.paginas;
    const arquivo = String(window.location.pathname || '').split('/').pop().toLowerCase();

    if (arquivo === 'admin-logs.html') return permissoes.acoes?.logs === true;
    if (arquivo === 'financiamentos.html' || arquivo === 'detalhes-financiamento.html') {
        return permissoes.acoes?.financiamentos === true;
    }
    if (arquivo === 'bens.html') {
        return paginas?.configuracoes === true || permissoes.acoes?.financiamentos === true;
    }
    if (!paginas || typeof paginas !== 'object') return permissoes.perfil === 'admin';
    return paginas[chavePagina] === true;
}

function aplicarPermissoesNavegacao(usuario = obterUsuarioAtual()) {
    if (!usuario) return;
    const paginas = usuario.permissoes?.paginas;
    if (!paginas || typeof paginas !== 'object') return;
    const acessoPorArquivo = {
        'dashboard.html': 'dashboard',
        'relatorios.html': 'relatorios',
        'lancamentos.html': 'lancamentos',
        'cartoes.html': 'cartoes',
        'categorias.html': 'categorias',
        'configuracoes.html': 'configuracoes'
    };
    document.querySelectorAll('.app-nav-center a[href]').forEach(link => {
        const arquivo = String(link.getAttribute('href') || '').split('/').pop().toLowerCase();
        const chave = acessoPorArquivo[arquivo];
        if (chave) link.hidden = paginas[chave] !== true;
    });
    const menuCadastros = document.querySelector('.nav-dropdown');
    if (menuCadastros) {
        const podeVerAlgumCadastro = paginas.cartoes === true || paginas.categorias === true || paginas.configuracoes === true || usuario.permissoes?.acoes?.financiamentos === true;
        menuCadastros.hidden = !podeVerAlgumCadastro;
        menuCadastros.querySelectorAll('.nav-dropdown-content a').forEach(link => {
            const destino = String(link.getAttribute('href') || '').split('/').pop().toLowerCase();
            const allowed = destino === 'cartoes.html' ? paginas.cartoes === true
                : destino === 'categorias.html' ? paginas.categorias === true
                : destino === 'financiamentos.html' ? usuario.permissoes?.acoes?.financiamentos === true
                : destino === 'bens.html' ? (paginas.configuracoes === true || usuario.permissoes?.acoes?.financiamentos === true)
                : paginas.configuracoes === true;
            link.hidden = !allowed;
        });
    }
}

function descricaoBaseParcelamento(descricao = '') {
    return String(descricao).replace(/\s\(\d+\/\d+\)$/, '').trim();
}

function resolverParcelamentoId(lancamento) {
    return lancamento && lancamento.parcelamentoId ? lancamento.parcelamentoId : null;
}

function resolverFinanciamentoIdPorLancamento(lancamento, dados = obterDados()) {
    if (lancamento && lancamento.financiamentoId != null && String(lancamento.financiamentoId).trim() !== '') {
        return lancamento.financiamentoId;
    }
    const descricao = normalizarTexto(descricaoBaseParcelamento(lancamento?.descricao || ''));
    const prefixo = 'financiamento:';
    if (!descricao.startsWith(prefixo)) return null;
    const nome = descricao.slice(prefixo.length).trim();
    const todosCandidatos = (dados.financiamentos || []).filter(f => normalizarTexto(f.nome) === nome);
    const candidatosDoDono = lancamento?.usuarioId == null
        ? []
        : todosCandidatos.filter(f => String(f.usuarioId) === String(lancamento.usuarioId));
    const candidatos = candidatosDoDono.length ? candidatosDoDono : todosCandidatos;
    // Um nome duplicado não identifica de forma segura qual contrato originou a parcela.
    return candidatos.length === 1 ? candidatos[0].id : null;
}

function pertenceAoFinanciamento(lancamento, financiamento, dados = obterDados()) {
    if (!lancamento || !financiamento) return false;
    if (lancamento.financiamentoId != null && String(lancamento.financiamentoId).trim() !== '') {
        return String(lancamento.financiamentoId) === String(financiamento.id);
    }
    const descricaoBase = normalizarTexto(descricaoBaseParcelamento(lancamento.descricao || ''));
    if (lancamento.tipo !== 'saida' || descricaoBase !== normalizarTexto(`Financiamento: ${financiamento.nome}`)) return false;
    const todosCandidatos = (dados.financiamentos || []).filter(f => normalizarTexto(f.nome) === normalizarTexto(financiamento.nome));
    const candidatosDoDono = lancamento.usuarioId == null
        ? []
        : todosCandidatos.filter(f => String(f.usuarioId) === String(lancamento.usuarioId));
    const candidatos = candidatosDoDono.length ? candidatosDoDono : todosCandidatos;
    return candidatos.length === 1 && String(candidatos[0].id) === String(financiamento.id);
}

function adicionarAuditoriaAoObjeto(dados, acao, detalhes, extras = {}) {
    if (!Array.isArray(dados.logs)) dados.logs = [];
    const usuario = obterUsuarioAtual(dados);
    dados.logs.push({
        id: gerarId('log'),
        dataHora: new Date().toISOString(),
        dataHoraFormatada: new Date().toLocaleString('pt-BR'),
        usuario: usuario ? usuario.nome : 'Sistema / Desconhecido',
        usuarioId: usuario ? usuario.id : null,
        acao,
        detalhes,
        ...extras
    });
}

function migrarDados(dados) {
    let alterou = false;
    if (!dados || typeof dados !== 'object') dados = {};

    const defaults = {
        usuarios: [], categorias: [], cartoes: [], lancamentos: [],
        financiamentos: [], bens: [], notificacoes: [], logs: [], exclusao_movimento: [], edicao_movimento: []
    };
    Object.entries(defaults).forEach(([chave, valor]) => {
        if (!Array.isArray(dados[chave])) {
            dados[chave] = valor;
            alterou = true;
        }
    });

    dados.cartoes.forEach(cartao => {
        if (cartao.ativo === undefined) { cartao.ativo = true; alterou = true; }
        if (!cartao.tipoCartao) { cartao.tipoCartao = cartao.isBeneficio ? 'beneficio' : 'credito'; alterou = true; }
        if (cartao.usuarioId == null) {
            const primeiroUsuario = dados.usuarios[0];
            if (primeiroUsuario) { cartao.usuarioId = primeiroUsuario.id; alterou = true; }
        }
    });

    dados.financiamentos.forEach(fin => {
        if (fin.ativo === undefined) { fin.ativo = true; alterou = true; }
        if (fin.totalMeses == null) { fin.totalMeses = 0; alterou = true; }
        if (!fin.valorParcela && fin.valorParcela !== 0) { fin.valorParcela = 0; alterou = true; }
    });

    const temMatrizDePermissoes = dados.usuarios.some(u =>
        u && u.permissoes && typeof u.permissoes === 'object' &&
        u.permissoes.paginas && typeof u.permissoes.paginas === 'object' &&
        u.permissoes.acoes && typeof u.permissoes.acoes === 'object'
    );
    const perfilLegado = (perfil) => ({
        perfil,
        paginas: {
            dashboard: true, relatorios: true, lancamentos: true,
            cartoes: true, categorias: true, configuracoes: perfil === 'admin'
        },
        acoes: {
            criarMovimento: perfil !== 'usuario',
            excluirMovimento: perfil !== 'usuario',
            financiamentos: perfil !== 'usuario',
            lotes: perfil !== 'usuario',
            usuarios: perfil === 'admin',
            logs: perfil === 'admin'
        }
    });
    const indicePrimeiroAtivo = dados.usuarios.findIndex(u => u && u.ativo !== false);
    dados.usuarios.forEach((usuario, indice) => {
        const perms = usuario?.permissoes;
        const matrizCompleta = perms && typeof perms === 'object' &&
            perms.paginas && typeof perms.paginas === 'object' &&
            perms.acoes && typeof perms.acoes === 'object';
        if (matrizCompleta) return;
        // Em uma base antiga sem nenhuma matriz, o primeiro usuário ativo vira
        // administrador inicial; os demais recebem perfil supervisor. Se a base
        // já tem matriz, qualquer registro incompleto recebe perfil supervisor.
        const perfil = !temMatrizDePermissoes && indice === indicePrimeiroAtivo ? 'admin' : 'supervisor';
        usuario.permissoes = perfilLegado(perfil);
        alterou = true;
    });

    // Registros de auditoria também precisam de identidade estável para a sincronização por três vias.
    // Os IDs legados são determinísticos para que duas sessões não gerem IDs diferentes para a mesma linha antiga.
    [
        ['exclusao_movimento', 'legacy_exc'],
        ['edicao_movimento', 'legacy_edit']
    ].forEach(([nomeColecao, prefixo]) => {
        dados[nomeColecao].forEach((registro, indice) => {
            if (!registro || typeof registro !== 'object' || registro.id) return;
            const conteudo = { ...registro };
            delete conteudo.id;
            registro.id = `${prefixo}_${encodeURIComponent(`${serializarEstavel(conteudo)}#${indice}`)}`;
            alterou = true;
        });
    });

    dados.lancamentos.forEach(lanc => {
        const pagoNormalizado = lanc.pago === true || String(lanc.status || '').toLowerCase() === 'pago';
        if (lanc.pago !== pagoNormalizado) { lanc.pago = pagoNormalizado; alterou = true; }
        const statusNormalizado = pagoNormalizado
            ? 'pago'
            : (String(lanc.status || '').toLowerCase() === 'atrasado' ? 'atrasado' : 'pendente');
        if (lanc.status !== statusNormalizado) { lanc.status = statusNormalizado; alterou = true; }
        if (lanc.horaExtra == null) { lanc.horaExtra = 0; alterou = true; }
        if (!lanc.servicoEssencial) { lanc.servicoEssencial = 'nao'; alterou = true; }
        if (!lanc.escopo) { lanc.escopo = 'casal'; alterou = true; }
        if (!lanc.observacao) lanc.observacao = '';
        if (!lanc.cartaoId && lanc.formaPagamento !== 'CARTAO') lanc.cartaoId = null;

        if (!lanc.parcelamentoId && Number(lanc.totalParcelas) > 1 && lanc.dataCompra) {
            const base = descricaoBaseParcelamento(lanc.descricao);
            // A descrição sozinha não identifica uma compra: a mesma despesa pode ter sido parcelada mais de uma vez.
            const chave = `${lanc.usuarioId || 0}|${lanc.cartaoId || 0}|${base}|${lanc.totalParcelas}|${String(lanc.dataCompra).slice(0, 10)}`;
            if (!lanc._legacyParcelamentoChave) { lanc._legacyParcelamentoChave = chave; alterou = true; }
        }

        if (!lanc.financiamentoId && normalizarTexto(lanc.descricao).startsWith('financiamento:')) {
            const nome = normalizarTexto(lanc.descricao).replace(/^financiamento:\s*/, '').replace(/\s\(\d+\/\d+\)$/, '').trim();
            const todosCandidatos = (dados.financiamentos || []).filter(fin => normalizarTexto(fin.nome) === nome);
            const candidatosDoDono = lanc.usuarioId == null
                ? []
                : todosCandidatos.filter(fin => String(fin.usuarioId) === String(lanc.usuarioId));
            const candidatos = candidatosDoDono.length ? candidatosDoDono : todosCandidatos;
            if (candidatos.length === 1) { lanc.financiamentoId = candidatos[0].id; alterou = true; }
        }
    });

    const gruposParcelamento = new Map();
    dados.lancamentos.forEach(lanc => {
        if (lanc._legacyParcelamentoChave) {
            if (!gruposParcelamento.has(lanc._legacyParcelamentoChave)) {
                gruposParcelamento.set(lanc._legacyParcelamentoChave, `legacy_${encodeURIComponent(lanc._legacyParcelamentoChave)}`);
            }
            lanc.parcelamentoId = gruposParcelamento.get(lanc._legacyParcelamentoChave);
            delete lanc._legacyParcelamentoChave;
            alterou = true;
        }
    });

    if (dados._schemaVersion !== SCHEMA_VERSION) { dados._schemaVersion = SCHEMA_VERSION; alterou = true; }

    return { dados, alterou };
}

document.addEventListener("DOMContentLoaded", async () => {
    inicializarTemaVisual();
    inicializarPrivacidade();
    criarIndicadorSincronizacaoUi();
    
    const estahNaPaginaLogin = window.location.pathname.endsWith('index.html') || window.location.pathname === '/' || window.location.pathname === '';

    if (!estahNaPaginaLogin && typeof verificarAutenticacao === 'function') {
        const autorizado = await verificarAutenticacao();
        if (autorizado) atualizarHeaderUsuario();
    }
});

function inicializarPrivacidade() {
    const privacidade = localStorage.getItem('privacidadeAtiva');
    if (privacidade !== 'false') {
        document.body.classList.add('privacidade-ativa');
        localStorage.setItem('privacidadeAtiva', 'true');
    } else {
        document.body.classList.remove('privacidade-ativa');
    }
    atualizarIconePrivacidade();
}

function alternarPrivacidade() {
    const body = document.body;
    const estaAtiva = body.classList.contains('privacidade-ativa');
    if (estaAtiva) {
        body.classList.remove('privacidade-ativa');
        localStorage.setItem('privacidadeAtiva', 'false');
    } else {
        body.classList.add('privacidade-ativa');
        localStorage.setItem('privacidadeAtiva', 'true');
    }
    atualizarIconePrivacidade();
}

function atualizarIconePrivacidade() {
    const img = document.getElementById('imgPrivacidade');
    if (!img) return;
    const estaAtiva = document.body.classList.contains('privacidade-ativa');
    img.src = estaAtiva ? 'imagens/esconder.png' : 'imagens/ver.png';
    img.alt = estaAtiva ? 'Escondido' : 'Visível';
}

function inicializarTemaVisual() {
    if ((localStorage.getItem('temaSistema') || 'claro') === 'escuro') {
        document.body.classList.add('dark-mode');
    }
}

function alternarTemaVisual(event) {
    const body = document.body;
    const botao = event?.currentTarget || document.querySelector('.btn-theme');
    const indoParaEscuro = !body.classList.contains('dark-mode');
    const rect = botao?.getBoundingClientRect();
    const x = event?.clientX ?? (rect ? rect.left + rect.width / 2 : window.innerWidth / 2);
    const y = event?.clientY ?? (rect ? rect.top + rect.height / 2 : 40);
    body.style.setProperty('--theme-x', `${x}px`);
    body.style.setProperty('--theme-y', `${y}px`);
    body.classList.toggle('theme-to-light', !indoParaEscuro);
    body.classList.add('theme-animating');
    if (botao) { botao.classList.remove('theme-switching'); void botao.offsetWidth; botao.classList.add('theme-switching'); }
    body.classList.toggle('dark-mode', indoParaEscuro);
    localStorage.setItem('temaSistema', indoParaEscuro ? 'escuro' : 'claro');
    window.setTimeout(() => {
        body.classList.remove('theme-animating', 'theme-to-light');
        botao?.classList.remove('theme-switching');
    }, 760);
}

function criarIndicadorSincronizacaoUi() {
    const chip = document.getElementById('syncStatusIcon');
    if (!chip || chip.dataset.syncWired === 'true') return;
    chip.dataset.syncWired = 'true';

    chip.title = "Status: Sincronizado. Clique para atualizar do banco de dados.";
    chip.style.cssText = `
        display: inline-flex; align-items: center; justify-content: center;
        padding: 4px 8px; height: 34px; border-radius: 9px;
        background: var(--success-soft); border: 1px solid color-mix(in srgb, var(--success) 26%, var(--border));
        cursor: pointer; margin-left: 8px; transition: var(--transition-fast);
    `;
    chip.innerHTML = `<img src="imagens/sincronizar.png" alt="Sync" style="width: 20px; height: 20px; object-fit: contain;">`;

    chip.onclick = async () => {
        chip.style.transform = 'scale(0.9)';
        setTimeout(() => chip.style.transform = 'scale(1)', 150);

        const possuiPendencias = localStorage.getItem('syncPendente') === 'true' || Boolean(localStorage.getItem(SYNC_CONFLICT_KEY));
        if (possuiPendencias) {
            const confirmarDescarte = await mostrarConfirmacaoModal('Há alterações locais ainda não sincronizadas. Atualizar do servidor descartará essas alterações locais. Deseja continuar?');
            if (!confirmarDescarte) return;
        }

        atualizarIndicadorSyncUI('pending');
        try {
            const json = await buscarDadosServidor();
            const resultado = migrarDados(json);
            gravarSnapshotLocal(resultado.dados, true);
            syncPendingData = null;
            localStorage.removeItem('syncPendente');
            localStorage.removeItem(SYNC_CONFLICT_KEY);
            atualizarIndicadorSyncUI('success');
            await mostrarAlertaModal('Dados atualizados do servidor com sucesso.');
        } catch (e) {
            atualizarIndicadorSyncUI('error');
            await mostrarAlertaModal('Erro ao atualizar do servidor: ' + e.message);
            return;
        }
        window.location.reload();
    };
}

function atualizarIndicadorSyncUI(status) {
    const chip = document.getElementById('syncStatusIcon');
    if (!chip) return;
    if (status === 'pending') {
        chip.style.backgroundColor = 'var(--warning-soft)';
        chip.style.borderColor = 'color-mix(in srgb, var(--warning) 26%, var(--border))';
        chip.title = "Status: Sincronizando...";
        chip.innerHTML = `<img src="imagens/sincronizar.gif" alt="Sincronizando" style="width: 20px; height: 20px; object-fit: contain;">`;
    } else if (status === 'success') {
        chip.style.backgroundColor = 'var(--success-soft)';
        chip.style.borderColor = 'color-mix(in srgb, var(--success) 26%, var(--border))';
        chip.title = "Status: Sincronizado com sucesso";
        chip.innerHTML = `<img src="imagens/sincronizar.png" alt="Sincronizado" style="width: 20px; height: 20px; object-fit: contain;">`;
    } else if (status === 'error') {
        chip.style.backgroundColor = 'var(--danger-soft)';
        chip.style.borderColor = 'color-mix(in srgb, var(--danger) 26%, var(--border))';
        const conflito = lerJSONLocal(SYNC_CONFLICT_KEY, null);
        const resumo = conflito?.mensagem || 'Falha temporária; as alterações locais continuam salvas.';
        const campos = Array.isArray(conflito?.campos) && conflito.campos.length
            ? ` Campos: ${conflito.campos.slice(0, 5).join(', ')}${conflito.campos.length > 5 ? '…' : ''}.`
            : '';
        chip.title = `Status: sincronização pendente. ${resumo}${campos} Clique para rever os dados.`;
        chip.innerHTML = `<img src="imagens/sincronizar.png" alt="Sincronização pendente" style="width: 20px; height: 20px; object-fit: contain;">`;
    }
}

function mostrarLoading(mensagem = "Processando...") {
    const spanText = document.getElementById('headerLoadingText');
    if (spanText) {
        spanText.textContent = mensagem;
        spanText.style.display = 'inline-block';
    }
}

function esconderLoading() {
    const spanText = document.getElementById('headerLoadingText');
    if (spanText) {
        spanText.style.display = 'none';
        spanText.textContent = '';
    }
    const overlayAntigo = document.getElementById('loadingOverlay');
    if (overlayAntigo) overlayAntigo.remove();
}
async function inicializarBanco() {
    const local = lerJSONLocal(DB_KEY, null);
    const pendente = localStorage.getItem('syncPendente') === 'true';

    if (local && pendente) {
        memoriaSistema = migrarDados(local).dados;
        syncPendingData = clonarDados(memoriaSistema);
        if (!localStorage.getItem(SYNC_CONFLICT_KEY)) {
            // Without a baseline we cannot distinguish local edits from server edits safely.
            if (!lerJSONLocal(SYNC_BASELINE_KEY, null)) {
                marcarConflitoSincronizacao(memoriaSistema, [], 'Não existe snapshot-base para mesclar as alterações pendentes.');
            } else {
                await sincronizarComServidor();
            }
        }
        return memoriaSistema;
    }

    try {
        const json = await buscarDadosServidor();
        const normalizado = migrarDados(json).dados;
        memoriaSistema = normalizado;
        window.revisaoServidorAtual = Number(normalizado._revision) || 0;
        gravarSnapshotLocal(normalizado, true);
        localStorage.removeItem('syncPendente');
        localStorage.removeItem(SYNC_CONFLICT_KEY);
        atualizarIndicadorSyncUI('success');
        return normalizado;
    } catch (e) {
        if (local) {
            memoriaSistema = migrarDados(local).dados;
            console.warn('Servidor indisponível; mantendo a cópia local.', e);
            return memoriaSistema;
        }
        throw e;
    }
}
async function salvarDados(dados, opcoes = {}) {
    const normalizado = migrarDados(dados).dados;
    if (!Number.isFinite(Number(normalizado._revision))) {
        normalizado._revision = Number(window.revisaoServidorAtual) || 0;
    }

    memoriaSistema = normalizado;
    localStorage.setItem(DB_KEY, JSON.stringify(normalizado));

    // A atualização visual não deve impedir que os dados sejam persistidos/sincronizados.
    [
        () => typeof carregarDashboard === 'function' && carregarDashboard(),
        () => typeof carregarRelatorios === 'function' && carregarRelatorios(),
        () => typeof renderizarCategorias === 'function' && renderizarCategorias(),
        () => typeof carregarCentralPagamentos === 'function' && carregarCentralPagamentos()
    ].forEach(atualizar => {
        try { atualizar(); } catch (erro) { console.error('Falha ao atualizar a tela após salvar:', erro); }
    });

    const usuarioSessaoId = localStorage.getItem('usuarioLogado');
    const usuarioSessao = (normalizado.usuarios || []).find(u => String(u.id) === String(usuarioSessaoId));
    const sessaoTeste = Boolean(usuarioSessao && normalizarTexto(usuarioSessao.nome) === 'teste');

    if (opcoes.sincronizar !== false && !sessaoTeste) {
        syncPendingData = clonarDados(normalizado);
        localStorage.setItem('syncPendente', 'true');
        if (!localStorage.getItem(SYNC_CONFLICT_KEY)) {
            atualizarIndicadorSyncUI('pending');
            agendarSincronizacaoSilenciosa();
        } else {
            atualizarIndicadorSyncUI('error');
        }
    } else if (sessaoTeste) {
        // O perfil de teste permanece local e não envia lançamentos ao servidor.
        if (syncTimer) clearTimeout(syncTimer);
        syncTimer = null;
        syncPendingData = null;
        localStorage.removeItem('syncPendente');
    }
    return true;
}

function lerJSONLocal(chave, padrao = null) {
    try {
        const bruto = localStorage.getItem(chave);
        return bruto == null ? padrao : JSON.parse(bruto);
    } catch (_) {
        return padrao;
    }
}

function gravarSnapshotLocal(dados, definirBase = false) {
    const copia = clonarDados(dados);
    memoriaSistema = copia;
    localStorage.setItem(DB_KEY, JSON.stringify(copia));
    if (definirBase) localStorage.setItem(SYNC_BASELINE_KEY, JSON.stringify(copia));
    window.revisaoServidorAtual = Number(copia._revision) || 0;
    return copia;
}

function serializarEstavel(valor) {
    if (valor === undefined) return '__UNDEFINED__';
    if (valor === null || typeof valor !== 'object') return JSON.stringify(valor);
    if (Array.isArray(valor)) return '[' + valor.map(serializarEstavel).join(',') + ']';
    return '{' + Object.keys(valor).sort().map(chave => JSON.stringify(chave) + ':' + serializarEstavel(valor[chave])).join(',') + '}';
}

function valoresIguais(a, b) {
    return serializarEstavel(a) === serializarEstavel(b);
}

function clonarValor(valor) {
    return valor === undefined ? undefined : JSON.parse(JSON.stringify(valor));
}

function mesclarValorTresVias(base, local, remoto, caminho, conflitos) {
    if (valoresIguais(local, base)) return clonarValor(remoto);
    if (valoresIguais(remoto, base)) return clonarValor(local);
    if (valoresIguais(local, remoto)) return clonarValor(local);

    const ehObjeto = valor => valor !== null && typeof valor === 'object' && !Array.isArray(valor);
    if (ehObjeto(local) && ehObjeto(remoto) && (base === undefined || ehObjeto(base))) {
        const resultado = {};
        const chaves = new Set([
            ...Object.keys(base || {}),
            ...Object.keys(local || {}),
            ...Object.keys(remoto || {})
        ]);
        chaves.forEach(chave => {
            const mesclado = mesclarValorTresVias(base?.[chave], local?.[chave], remoto?.[chave], `${caminho}.${chave}`, conflitos);
            if (mesclado !== undefined) resultado[chave] = mesclado;
        });
        return resultado;
    }

    conflitos.push(caminho);
    return clonarValor(local);
}

function indexarColecao(lista) {
    const mapa = new Map();
    const ocorrenciasSemId = new Map();
    (Array.isArray(lista) ? lista : []).forEach(item => {
        let chave;
        if (item && item.id !== undefined && item.id !== null && item.id !== '') {
            chave = `id:${String(item.id)}`;
        } else {
            // Conteúdo igual não significa identidade igual: usa ordinal para preservar duplicados.
            const assinatura = serializarEstavel(item);
            const ordinal = ocorrenciasSemId.get(assinatura) || 0;
            ocorrenciasSemId.set(assinatura, ordinal + 1);
            chave = `registro:${assinatura}#${ordinal}`;
        }
        mapa.set(chave, item);
    });
    return mapa;
}

function mesclarColecaoTresVias(nome, baseLista, localLista, remotoLista, conflitos) {
    const base = indexarColecao(baseLista);
    const local = indexarColecao(localLista);
    const remoto = indexarColecao(remotoLista);
    const ordem = [...remoto.keys(), ...local.keys(), ...base.keys()];
    const vistos = new Set();
    const resultado = [];

    ordem.forEach(chave => {
        if (vistos.has(chave)) return;
        vistos.add(chave);
        const b = base.get(chave);
        const l = local.get(chave);
        const r = remoto.get(chave);
        const valor = mesclarValorTresVias(b, l, r, `${nome}[${chave}]`, conflitos);
        if (valor !== undefined) resultado.push(valor);
    });
    return resultado;
}

function mesclarSnapshotsTresVias(base, local, remoto) {
    const conflitos = [];
    const resultado = clonarDados(remoto || {});
    COLECOES_DADOS.forEach(nome => {
        resultado[nome] = mesclarColecaoTresVias(nome, base?.[nome], local?.[nome], remoto?.[nome], conflitos);
    });
    const chaves = new Set([...Object.keys(base || {}), ...Object.keys(local || {}), ...Object.keys(remoto || {})]);
    chaves.forEach(chave => {
        if (COLECOES_DADOS.includes(chave) || chave === '_revision') return;
        const valor = mesclarValorTresVias(base?.[chave], local?.[chave], remoto?.[chave], chave, conflitos);
        if (valor !== undefined) resultado[chave] = valor;
    });
    resultado._revision = Number(remoto?._revision) || 0;
    return { dados: resultado, conflitos: [...new Set(conflitos)] };
}

function marcarConflitoSincronizacao(dadosLocais, campos, mensagem) {
    const conflito = {
        dataHora: new Date().toISOString(),
        campos: (campos || []).slice(0, 30),
        mensagem: mensagem || 'Há alterações conflitantes entre esta sessão e o servidor.'
    };
    localStorage.setItem(SYNC_CONFLICT_KEY, JSON.stringify(conflito));
    localStorage.setItem('syncPendente', 'true');
    if (dadosLocais) {
        memoriaSistema = dadosLocais;
        localStorage.setItem(DB_KEY, JSON.stringify(dadosLocais));
        syncPendingData = clonarDados(dadosLocais);
    }
    atualizarIndicadorSyncUI('error');
    console.error('Sincronização bloqueada para evitar sobrescrita de dados:', conflito);
}
async function sincronizarComServidor() {
    if (syncInFlight || !syncPendingData || localStorage.getItem(SYNC_CONFLICT_KEY)) return;
    syncInFlight = true;
    let payloadAtual = null;
    let tentativas = 0;

    try {
        while (syncPendingData && tentativas < 5 && !localStorage.getItem(SYNC_CONFLICT_KEY)) {
            tentativas++;
            payloadAtual = syncPendingData;
            syncPendingData = null;

            const resposta = await fetch(API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify({ action: 'salvarDados', token: TOKEN_API, dados: payloadAtual })
            });
            if (!resposta.ok) throw new Error(`Falha HTTP ${resposta.status} ao salvar os dados.`);
            const json = await resposta.json();

            if (json.status === 'conflito') {
                const localAtual = lerJSONLocal(DB_KEY, payloadAtual) || payloadAtual;
                const base = lerJSONLocal(SYNC_BASELINE_KEY, null);
                const servidor = migrarDados(await buscarDadosServidor()).dados;

                if (!base) {
                    marcarConflitoSincronizacao(localAtual, [], 'O servidor mudou, mas esta instalação não tem um snapshot-base para comparar com segurança.');
                    break;
                }

                const mesclagem = mesclarSnapshotsTresVias(migrarDados(base).dados, migrarDados(localAtual).dados, servidor);
                if (mesclagem.conflitos.length) {
                    marcarConflitoSincronizacao(localAtual, mesclagem.conflitos, 'Alguns campos foram alterados localmente e no servidor ao mesmo tempo. Nenhuma versão foi sobrescrita automaticamente.');
                    break;
                }

                localStorage.setItem(SYNC_BASELINE_KEY, JSON.stringify(servidor));
                mesclagem.dados._revision = Number(servidor._revision) || 0;
                gravarSnapshotLocal(mesclagem.dados, false);
                syncPendingData = clonarDados(mesclagem.dados);
                localStorage.setItem('syncPendente', 'true');
                continue;
            }

            if (json.status !== 'sucesso') throw new Error(json.mensagem || 'Erro desconhecido ao sincronizar os dados.');

            const revisaoNova = Number(json._revision);
            if (!Number.isFinite(revisaoNova)) throw new Error('O servidor não retornou uma revisão válida.');

            // Registra como base somente o snapshot efetivamente aceito pelo servidor.
            const snapshotAceito = clonarDados(payloadAtual);
            snapshotAceito._revision = revisaoNova;
            localStorage.setItem(SYNC_BASELINE_KEY, JSON.stringify(snapshotAceito));
            window.revisaoServidorAtual = revisaoNova;

            if (syncPendingData) syncPendingData._revision = revisaoNova;
            if (memoriaSistema) {
                memoriaSistema._revision = revisaoNova;
                localStorage.setItem(DB_KEY, JSON.stringify(memoriaSistema));
            }

            if (!syncPendingData) {
                localStorage.removeItem('syncPendente');
                atualizarIndicadorSyncUI('success');
            } else {
                localStorage.setItem('syncPendente', 'true');
                atualizarIndicadorSyncUI('pending');
            }
        }
    } catch (erro) {
        console.warn('Sincronização adiada por erro de rede ou servidor:', erro);
        if (!syncPendingData && payloadAtual) syncPendingData = clonarDados(lerJSONLocal(DB_KEY, payloadAtual) || payloadAtual);
        localStorage.setItem('syncPendente', 'true');
        atualizarIndicadorSyncUI('error');
    } finally {
        syncInFlight = false;
        if (syncPendingData && !localStorage.getItem(SYNC_CONFLICT_KEY)) agendarSincronizacaoSilenciosa();
    }
}

function obterDados() {
    let dados = null;
    try {
        dados = JSON.parse(localStorage.getItem(DB_KEY));
    } catch (_) {}

    if (!dados) {
        dados = memoriaSistema || { usuarios: [], categorias: [], cartoes: [], lancamentos: [], financiamentos: [], bens: [], notificacoes: [], logs: [], exclusao_movimento: [], edicao_movimento: [] };
    }

    const resultado = migrarDados(dados);
    memoriaSistema = resultado.dados;
    return resultado.dados;
}

function agendarSincronizacaoSilenciosa() {
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(sincronizarComServidor, SYNC_DEBOUNCE_MS);
}

async function buscarDadosServidor() {
    const url = `${API_URL}?action=obterDados&token=${encodeURIComponent(TOKEN_API)}`;
    const resposta = await fetch(url, { cache: 'no-store' });
    if (!resposta.ok) throw new Error(`Falha HTTP ${resposta.status} ao consultar o servidor.`);
    const json = await resposta.json();
    if (json.status === 'erro') throw new Error(json.mensagem || 'Erro desconhecido do servidor.');
    if (!Array.isArray(json.usuarios) || !Array.isArray(json.lancamentos)) throw new Error('A resposta do servidor não contém a estrutura esperada.');
    return json;
}

function registrarLogInterno(dados, acao, detalhes, extras = {}) {
    adicionarAuditoriaAoObjeto(dados, acao, detalhes, extras);
}

function deslogarSistema() {
    const usuarioId = localStorage.getItem('usuarioLogado');
    if (usuarioId) {
        const dados = obterDados();
        const usuario = dados.usuarios.find(u => Number(u.id) === Number(usuarioId));
        if (usuario && normalizarTexto(usuario.nome) === 'teste') {
            const backup = localStorage.getItem(BACKUP_TESTE_KEY);
            if (backup) {
                localStorage.setItem(DB_KEY, backup);
                localStorage.removeItem(BACKUP_TESTE_KEY);
            }
        }
    }
    localStorage.removeItem('usuarioLogado');
    localStorage.removeItem('adminAutorizado');
    localStorage.removeItem('adminLogado');
    window.location.href = 'index.html';
}
function verificarAutenticacao() {
    if (!verificacaoAutenticacaoPromise) {
        verificacaoAutenticacaoPromise = verificarAutenticacaoInterna().catch(erro => {
            verificacaoAutenticacaoPromise = null;
            console.error('Falha ao validar a sessão:', erro);
            return false;
        });
    }
    return verificacaoAutenticacaoPromise;
}

async function verificarAutenticacaoInterna() {
    const usuarioId = localStorage.getItem('usuarioLogado');
    if (!usuarioId) {
        window.location.href = 'index.html';
        return false;
    }

    try {
        const dadosLocais = lerJSONLocal(DB_KEY, null);
        const usuarioLocal = (dadosLocais?.usuarios || []).find(u => String(u.id) === String(usuarioId));
        const sessaoTesteLocal = Boolean(
            usuarioLocal && normalizarTexto(usuarioLocal.nome) === 'teste' && localStorage.getItem(BACKUP_TESTE_KEY)
        );

        if (sessaoTesteLocal) {
            // Preserva os dados temporários entre páginas; eles serão descartados ao sair do perfil de teste.
            memoriaSistema = migrarDados(dadosLocais).dados;
        } else if (localStorage.getItem(SYNC_CONFLICT_KEY)) {
            memoriaSistema = migrarDados(dadosLocais || {}).dados;
            atualizarIndicadorSyncUI('error');
        } else if (localStorage.getItem('syncPendente') === 'true') {
            await inicializarBanco();
        } else {
            // Revalida a revisão ao abrir cada página para que abas e usuários não fiquem presos a dados antigos.
            const json = await buscarDadosServidor();
            const atualizados = migrarDados(json).dados;
            gravarSnapshotLocal(atualizados, true);
            localStorage.removeItem(SYNC_CONFLICT_KEY);
        }
    } catch (erro) {
        console.warn('Servidor indisponível; tentando continuar com os dados locais:', erro);
        if (!lerJSONLocal(DB_KEY, null)) {
            window.location.href = 'index.html';
            return false;
        }
    }

    const dados = obterDados();
    const usuario = (dados.usuarios || []).find(u => String(u.id) === String(usuarioId));
    if (!usuario || usuario.ativo === false) {
        deslogarSistema();
        return false;
    }
    const chavePagina = permissaoPaginaAtual();
    if (!usuarioPodeAcessarPagina(usuario, chavePagina)) {
        await mostrarAlertaModal('Seu perfil não tem permissão para acessar esta página.');
        window.location.href = 'dashboard.html';
        return false;
    }
    return true;
}

function criarModalBase({ titulo, mensagem, htmlExtra = '', classe = '' }) {
    const overlay = document.createElement('div');
    overlay.className = `modal-overlay ${classe}`.trim();
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.innerHTML = `
        <div class="modal-box" tabindex="-1">
            <h3>${escaparHTML(titulo)}</h3>
            <p>${escaparHTML(mensagem)}</p>
            ${htmlExtra}
        </div>
    `;
    document.body.appendChild(overlay);
    const box = overlay.querySelector('.modal-box');
    if (box) box.focus();
    return { overlay, box };
}

function fecharModal(overlay) {
    if (!overlay) return;
    overlay.classList.add('modal-closing');
    setTimeout(() => overlay.remove(), 120);
}

function mostrarConfirmacaoModal(mensagem) {
    return new Promise(resolve => {
        const { overlay } = criarModalBase({
            titulo: 'Confirmação',
            mensagem,
            htmlExtra: `
                <div class="modal-buttons">
                    <button type="button" class="btn-secundario" data-cancelar>Cancelar</button>
                    <button type="button" class="btn-perigo" data-confirmar>Confirmar</button>
                </div>`
        });
        let finalizado = false;
        const finalizar = valor => {
            if (finalizado) return;
            finalizado = true;
            fecharModal(overlay);
            resolve(valor);
        };
        overlay.querySelector('[data-cancelar]').onclick = () => finalizar(false);
        overlay.querySelector('[data-confirmar]').onclick = () => finalizar(true);
        overlay.addEventListener('click', e => { if (e.target === overlay) finalizar(false); });
        overlay.addEventListener('keydown', e => {
            if (e.key === 'Escape') finalizar(false);
            if (e.key === 'Enter') finalizar(true);
        });
    });
}

function mostrarPromptSenha(titulo, descricao, exigirConfirmacao = true) {
    return new Promise(resolve => {
        const htmlExtra = exigirConfirmacao ? `
            <div style="margin-top: 20px; display: flex; flex-direction: column; gap: 16px; text-align: left;">
                <div>
                    <label style="font-size: 0.95rem; font-weight: bold; color: var(--text-main); display: block; margin-bottom: 6px;">Nova Palavra-passe:</label>
                    <input type="password" class="modal-input" id="promptNovaSenha" maxlength="32" autocomplete="off" placeholder="Digite a nova palavra-passe" style="min-height: 54px; font-size: 1.05rem;">
                </div>
                <div>
                    <label style="font-size: 0.95rem; font-weight: bold; color: var(--text-main); display: block; margin-bottom: 6px;">Confirme a Nova Palavra-passe:</label>
                    <input type="password" class="modal-input" id="promptConfirmaSenha" maxlength="32" autocomplete="off" placeholder="Digite a palavra-passe novamente" style="min-height: 54px; font-size: 1.05rem;">
                </div>
            </div>
        ` : `
            <div style="margin-top: 20px; display: flex; flex-direction: column; gap: 16px; text-align: left;">
                <div>
                    <label style="font-size: 0.95rem; font-weight: bold; color: var(--text-main); display: block; margin-bottom: 6px;">Palavra-passe:</label>
                    <input type="password" class="modal-input" id="promptNovaSenha" maxlength="32" autocomplete="off" placeholder="Digite a sua palavra-passe" style="min-height: 54px; font-size: 1.05rem;">
                </div>
            </div>
        `;

        const { overlay, box } = criarModalBase({
            titulo, mensagem: descricao,
            htmlExtra: htmlExtra + `
                <div class="modal-buttons" style="margin-top: 28px;">
                    <button type="button" class="btn-secundario" data-cancelar style="padding: 14px;">Cancelar</button>
                    <button type="button" data-confirmar style="padding: 14px;">Confirmar</button>
                </div>`
        });

        if (box) { box.style.width = "min(680px, 95vw)"; box.style.padding = "40px"; }

        const inputNova = overlay.querySelector('#promptNovaSenha');
        const inputConfirma = overlay.querySelector('#promptConfirmaSenha');
        let finalizado = false;

        const finalizar = valor => {
            if (finalizado) return;
            finalizado = true;
            fecharModal(overlay);
            resolve(valor);
        };

        setTimeout(() => inputNova?.focus(), 0);
        overlay.querySelector('[data-cancelar]').onclick = () => finalizar(null);
        
        overlay.querySelector('[data-confirmar]').onclick = () => {
            const valNova = inputNova.value.trim();
            if (!valNova) { mostrarAlertaModal("O campo de palavra-passe não pode estar vazio."); inputNova.focus(); return; }
            if (exigirConfirmacao) {
                const valConfirma = inputConfirma.value.trim();
                if (!validarComplexidadeSenha(valNova)) {
                    mostrarAlertaModal("A palavra-passe não atende aos requisitos mínimos de segurança."); inputNova.focus(); return;
                }
                if (valNova !== valConfirma) {
                    mostrarAlertaModal("As palavras-passe digitadas não conferem. Tente novamente."); inputConfirma.value = ''; inputConfirma.focus(); return;
                }
            }
            finalizar(valNova);
        };

        inputNova.addEventListener('keydown', e => {
            if (e.key === 'Enter') {
                e.preventDefault();
                if (exigirConfirmacao && inputConfirma) inputConfirma.focus();
                else overlay.querySelector('[data-confirmar]').click();
            }
            if (e.key === 'Escape') finalizar(null);
        });

        if (inputConfirma) {
            inputConfirma.addEventListener('keydown', e => {
                if (e.key === 'Enter') { e.preventDefault(); overlay.querySelector('[data-confirmar]').click(); }
                if (e.key === 'Escape') finalizar(null);
            });
        }
    });
}

function mostrarPromptModal(titulo, descricao, senhaCorreta = null) {
    return new Promise(async resolve => {
        if (senhaCorreta !== null && senhaCorreta !== undefined && senhaCorreta !== '') {
            // Parâmetro 'false' adicionado aqui também
            const resposta = await mostrarPromptSenha(titulo, descricao, false);
            resolve(resposta === null ? null : resposta);
            return;
        }

        const { overlay } = criarModalBase({
            titulo, mensagem: descricao,
            htmlExtra: `
                <input type="text" class="modal-input" data-valor autocomplete="off" placeholder="Digite o valor">
                <div class="modal-buttons">
                    <button type="button" class="btn-secundario" data-cancelar>Cancelar</button>
                    <button type="button" data-confirmar>Confirmar</button>
                </div>`
        });
        const input = overlay.querySelector('[data-valor]');
        let finalizado = false;
        const finalizar = valor => {
            if (finalizado) return;
            finalizado = true;
            fecharModal(overlay);
            resolve(valor);
        };
        setTimeout(() => input?.focus(), 0);
        overlay.querySelector('[data-cancelar]').onclick = () => finalizar(null);
        overlay.querySelector('[data-confirmar]').onclick = () => finalizar(input.value.trim());
        input.addEventListener('keydown', e => {
            if (e.key === 'Enter') { e.preventDefault(); finalizar(input.value.trim()); }
            if (e.key === 'Escape') finalizar(null);
        });
    });
}

function mostrarPromptTextoModal(titulo, descricao) {
    return new Promise(resolve => {
        const { overlay } = criarModalBase({
            titulo, mensagem: descricao,
            htmlExtra: `
                <input type="text" class="modal-input" data-valor maxlength="250" placeholder="Digite o motivo obrigatório...">
                <div class="modal-buttons">
                    <button type="button" class="btn-secundario" data-cancelar>Cancelar</button>
                    <button type="button" data-confirmar>Confirmar</button>
                </div>`
        });
        const input = overlay.querySelector('[data-valor]');
        let finalizado = false;
        const finalizar = valor => {
            if (finalizado) return;
            finalizado = true;
            fecharModal(overlay);
            resolve(valor);
        };
        const confirmar = () => {
            const valor = input.value.trim();
            if (!valor) { input.focus(); mostrarAlertaModal('O preenchimento do motivo é obrigatório!'); return; }
            finalizar(valor);
        };
        setTimeout(() => input?.focus(), 0);
        overlay.querySelector('[data-cancelar]').onclick = () => finalizar(null);
        overlay.querySelector('[data-confirmar]').onclick = confirmar;
        input.addEventListener('keydown', e => {
            if (e.key === 'Enter') { e.preventDefault(); confirmar(); }
            if (e.key === 'Escape') finalizar(null);
        });
    });
}

function mostrarAlertaModal(mensagem) {
    return new Promise(resolve => {
        const { overlay } = criarModalBase({
            titulo: 'Aviso', mensagem,
            htmlExtra: `
                <div class="modal-buttons modal-buttons-center">
                    <button type="button" data-confirmar>OK</button>
                </div>`
        });
        const finalizar = () => { fecharModal(overlay); resolve(true); };
        overlay.querySelector('[data-confirmar]').onclick = finalizar;
        overlay.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === 'Escape') finalizar(); });
    });
}
async function verificarSenhaAdmin(nomeSecao = 'esta seção') {
    const senhaDigitada = await mostrarPromptSenha(
        'Acesso restrito',
        `Informe a senha administrativa para ${nomeSecao}.`,
        false
    );
    if (senhaDigitada === null || !String(senhaDigitada).trim()) return false;

    try {
        const resposta = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({ action: 'verificarAdmin', token: TOKEN_API, senha: senhaDigitada })
        });
        if (!resposta.ok) throw new Error(`Falha HTTP ${resposta.status}`);
        const resultado = await resposta.json();
        if (resultado.status === 'sucesso' && resultado.autorizado === true) return true;
        await mostrarAlertaModal('Senha administrativa incorreta.');
        return false;
    } catch (erro) {
        console.error('Falha ao validar a senha administrativa:', erro);
        await mostrarAlertaModal('Não foi possível validar a senha administrativa no servidor. Verifique a conexão.');
        return false;
    }
}

// Operações de categoria centralizadas, com propriedade, validação e limpeza garantidas.
async function adicionarCategoria(nome, tipo) {
    if (!await exigirPermissao('criarMovimento', 'gerenciar categorias')) return false;
    if (processandoAcaoModal) return false;
    if (!await verificarSenhaAdmin('cadastrar categoria')) return false;

    processandoAcaoModal = true;
    mostrarLoading('Cadastrando categoria...');
    try {
        const dados = obterDados();
        const nomeLimpo = String(nome || '').trim();
        const nomeNormalizado = normalizarTexto(nomeLimpo);
        const usuarioAtualId = Number(obterUsuarioAtualId(dados));

        if (!nomeNormalizado || !['entrada', 'saida'].includes(tipo)) {
            throw new Error('Dados da categoria inválidos.');
        }
        // As categorias são listadas em comum e usadas por todos os lançamentos;
        // nomes duplicados globais causavam seleção ambígua entre usuários.
        const duplicada = (dados.categorias || []).some(c =>
            c.tipo === tipo && normalizarTexto(c.nome) === nomeNormalizado
        );
        if (duplicada) throw new Error('Já existe uma categoria com este nome e tipo.');

        const novaId = (dados.categorias || []).reduce((m, c) => Math.max(m, Number(c.id) || 0), 0) + 1;
        dados.categorias.push({
            id: novaId,
            nome: nomeLimpo,
            tipo,
            classificacao: 'personalizado',
            criadopor: usuarioAtualId
        });
        registrarLogInterno(dados, 'CADASTRO CATEGORIA', `Categoria personalizada criada: ${nomeLimpo} (${tipo})`);
        await salvarDados(dados);
        await mostrarAlertaModal('Categoria cadastrada com sucesso!');
        if (typeof renderizarCategorias === 'function') renderizarCategorias();
        return true;
    } catch (erro) {
        console.error('Falha ao cadastrar categoria:', erro);
        await mostrarAlertaModal(erro.message || 'Não foi possível cadastrar a categoria.');
        return false;
    } finally {
        esconderLoading();
        processandoAcaoModal = false;
    }
}

async function atualizarCategoria(id, nome, tipo) {
    if (!await exigirPermissao('criarMovimento', 'gerenciar categorias')) return false;
    if (processandoAcaoModal) return false;
    if (!await verificarSenhaAdmin('editar categoria')) return false;

    processandoAcaoModal = true;
    mostrarLoading('Atualizando categoria...');
    try {
        const dados = obterDados();
        const categoria = (dados.categorias || []).find(c => String(c.id) === String(id));
        const nomeLimpo = String(nome || '').trim();
        const nomeNormalizado = normalizarTexto(nomeLimpo);
        const usuarioAtualId = Number(obterUsuarioAtualId(dados));

        if (!categoria || !nomeNormalizado || !['entrada', 'saida'].includes(tipo)) {
            throw new Error('Dados da categoria inválidos.');
        }
        if (categoria.classificacao === 'padrao' || Number(categoria.criadopor) === 5) {
            throw new Error('Categorias padrão do sistema não podem ser alteradas.');
        }
        if (Number(categoria.criadopor) !== usuarioAtualId) {
            throw new Error('Você só pode editar categorias criadas pelo seu usuário.');
        }
        const duplicada = (dados.categorias || []).some(c =>
            String(c.id) !== String(id) && c.tipo === tipo && normalizarTexto(c.nome) === nomeNormalizado
        );
        if (duplicada) throw new Error('Já existe outra categoria com este nome e tipo.');

        const tipoAntigo = categoria.tipo;
        if (tipoAntigo !== tipo) {
            const emUso = (dados.lancamentos || []).some(l => String(l.categoriaId) === String(id)) ||
                (dados.financiamentos || []).some(f => String(f.categoriaId) === String(id));
            if (emUso) {
                throw new Error('Não é possível trocar o tipo de uma categoria em uso. Reclassifique os lançamentos antes.');
            }
        }

        categoria.nome = nomeLimpo;
        categoria.tipo = tipo;
        registrarLogInterno(dados, 'EDIÇÃO CATEGORIA', `Categoria ID ${id} alterada para: ${categoria.nome} (${tipo})`);
        await salvarDados(dados);
        await mostrarAlertaModal('Categoria atualizada com sucesso!');
        if (typeof renderizarCategorias === 'function') renderizarCategorias();
        return true;
    } catch (erro) {
        console.error('Falha ao atualizar categoria:', erro);
        await mostrarAlertaModal(erro.message || 'Não foi possível atualizar a categoria.');
        return false;
    } finally {
        esconderLoading();
        processandoAcaoModal = false;
    }
}

async function excluirCategoria(id) {
    if (!await exigirPermissao('excluirMovimento', 'excluir categorias')) return false;
    if (processandoAcaoModal) return false;
    if (!await verificarSenhaAdmin('excluir categoria')) return false;

    processandoAcaoModal = true;
    mostrarLoading('Excluindo categoria...');
    try {
        const dados = obterDados();
        const categoria = (dados.categorias || []).find(c => String(c.id) === String(id));
        const usuarioAtualId = Number(obterUsuarioAtualId(dados));
        if (!categoria) throw new Error('Categoria não encontrada. Atualize a lista e tente novamente.');
        if (categoria.classificacao === 'padrao' || Number(categoria.criadopor) === 5) {
            throw new Error('Categorias padrão do sistema não podem ser excluídas.');
        }
        if (Number(categoria.criadopor) !== usuarioAtualId) {
            throw new Error('Você só pode excluir categorias criadas pelo seu usuário.');
        }

        const emUso = (dados.lancamentos || []).some(l => String(l.categoriaId) === String(id)) ||
            (dados.financiamentos || []).some(f => String(f.categoriaId) === String(id));
        if (emUso) throw new Error('Esta categoria está vinculada a lançamentos ou financiamentos e não pode ser excluída.');

        dados.categorias = (dados.categorias || []).filter(c => String(c.id) !== String(id));
        registrarLogInterno(dados, 'EXCLUSÃO CATEGORIA', `Categoria ID ${id} excluída`);
        await salvarDados(dados);
        await mostrarAlertaModal('Categoria excluída com sucesso!');
        if (typeof renderizarCategorias === 'function') renderizarCategorias();
        return true;
    } catch (erro) {
        console.error('Falha ao excluir categoria:', erro);
        await mostrarAlertaModal(erro.message || 'Não foi possível excluir a categoria.');
        return false;
    } finally {
        esconderLoading();
        processandoAcaoModal = false;
    }
}

function popularSelectsLancamento() {
    const dados = obterDados();
    const selectTipo = document.getElementById('tipoLancamento');
    const selectCartao = document.getElementById('cartaoLancamento');

    const tipoInicial = selectTipo?.value === 'entrada' ? 'entrada' : 'saida';
    atualizarFiltroCategoriasPorTipo(tipoInicial);

    if (selectCartao) {
        selectCartao.innerHTML = '';
        const usuarioAtualId = Number(obterUsuarioAtualId(dados));
        const cartoesUsuario = dados.cartoes.filter(c => c.ativo !== false && !c.isBeneficio && Number(c.usuarioId) === usuarioAtualId);

        if (cartoesUsuario.length === 0) {
            const opt = document.createElement('option');
            opt.value = ''; opt.textContent = 'Nenhum cartão ativo cadastrado';
            selectCartao.appendChild(opt);
            return;
        }

        cartoesUsuario.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.id; opt.textContent = c.nome;
            selectCartao.appendChild(opt);
        });
    }
}

function atualizarFiltroCategoriasPorTipo(tipo, categoriaIdPreferida = null) {
    const dados = obterDados();
    const selectCat = document.getElementById('categoriaLancamento');
    if (!selectCat) return false;

    const tipoNormalizado = tipo === 'entrada' ? 'entrada' : 'saida';
    const categoriaAtual = categoriaIdPreferida ?? selectCat.value;

    const filtradas = dados.categorias
        .filter(c => c.tipo === tipoNormalizado)
        .sort((a, b) => normalizarTexto(a.nome).localeCompare(normalizarTexto(b.nome), 'pt-BR'));

    selectCat.innerHTML = '';

    if (filtradas.length === 0) {
        const opt = document.createElement('option');
        opt.value = ''; opt.textContent = `Nenhuma categoria de ${tipoNormalizado === 'entrada' ? 'entrada' : 'saída'} cadastrada`;
        selectCat.appendChild(opt);
        selectCat.disabled = true; selectCat.dataset.tipoAtual = tipoNormalizado;
        return false;
    }

    selectCat.disabled = false;
    filtradas.forEach(cat => {
        const opt = document.createElement('option');
        opt.value = String(cat.id); opt.textContent = cat.nome;
        selectCat.appendChild(opt);
    });

    const existeCategoriaPreferida = filtradas.some(cat => String(cat.id) === String(categoriaAtual));
    selectCat.value = existeCategoriaPreferida ? String(categoriaAtual) : String(filtradas[0].id);
    selectCat.dataset.tipoAtual = tipoNormalizado;

    return true;
}

function tratarMudancaTipoLancamento() {
    const selectTipo = document.getElementById('tipoLancamento');
    if (!selectTipo) return;

    const tipo = selectTipo.value === 'entrada' ? 'entrada' : 'saida';
    atualizarFiltroCategoriasPorTipo(tipo);

    const blocoHE = document.getElementById('blocoHoraExtra');
    const blocoFormaPgto = document.getElementById('blocoFormaPagamentoContainer');
    const blocoCartao = document.getElementById('blocoCartao');
    const blocoEssencial = document.getElementById('blocoServicoEssencial');
    const labelData = document.getElementById('labelDataReferencia');
    const inputHE = document.getElementById('valorHoraExtra');
    const blocoEscopo = document.getElementById('blocoEscopo');
    const blocoStatus = document.getElementById('blocoStatusPagamento');
    const blocoBem = document.getElementById('blocoBemLancamento');

    const ehEntrada = tipo === 'entrada';

    if (blocoHE) blocoHE.style.display = ehEntrada ? 'block' : 'none';
    if (blocoFormaPgto) blocoFormaPgto.style.display = ehEntrada ? 'none' : 'block';
    if (blocoEssencial) blocoEssencial.style.display = ehEntrada ? 'none' : 'block';
    if (blocoEscopo) blocoEscopo.style.display = ehEntrada ? 'none' : 'block';
    if (blocoStatus) blocoStatus.style.display = ehEntrada ? 'none' : 'block';
    if (blocoBem) blocoBem.style.display = ehEntrada ? 'none' : 'block';

    if (labelData) labelData.textContent = ehEntrada ? 'Data de recebimento' : 'Data de vencimento / referência';

    if (ehEntrada) {
        if (blocoCartao) blocoCartao.style.display = 'none';
        if (inputHE) inputHE.value = inputHE.value || '0';
    } else {
        tratarMudancaFormaPagamento();
    }

    // Centraliza a atualização de categoria/salário/hora extra após trocar o tipo.
    if (typeof tratarMudancaCategoria === 'function') tratarMudancaCategoria();
    else verificarCategoriaSalario();
}
function tratarMudancaFormaPagamento() {
    const selectForma = document.getElementById('formaPagamento');
    if (!selectForma) return;

    const forma = selectForma.value;
    const usaCartao = forma === 'CARTAO';
    const tipo = document.getElementById('tipoLancamento')?.value || 'saida';
    const blocoCartao = document.getElementById('blocoCartao');
    const blocoVencimento = document.getElementById('blocoVencimento');
    const blocoStatus = document.getElementById('blocoStatusPagamento');
    const selectStatus = document.getElementById('statusPagamento');

    if (blocoCartao) blocoCartao.style.display = usaCartao && tipo !== 'entrada' ? 'block' : 'none';
    if (blocoVencimento) blocoVencimento.style.display = usaCartao && tipo !== 'entrada' ? 'none' : 'block';
    if (blocoStatus) blocoStatus.style.display = tipo === 'entrada' || usaCartao ? 'none' : 'block';

    if (selectStatus && tipo !== 'entrada') {
        if (usaCartao || forma === 'BOLETO' || forma === 'FIXO') selectStatus.value = 'pendente';
        else if (forma === 'DINHEIRO') selectStatus.value = 'pago';
    }
}

function inicializarControlesLancamento() {
    const tipoSelect = document.getElementById('tipoLancamento');
    const formaPagamento = document.getElementById('formaPagamento');
    const categoriaSelect = document.getElementById('categoriaLancamento');

    if (tipoSelect && tipoSelect.dataset.controleInicializado !== 'true') {
        tipoSelect.addEventListener('change', tratarMudancaTipoLancamento);
        tipoSelect.dataset.controleInicializado = 'true';
    }

    if (formaPagamento && formaPagamento.dataset.controleInicializado !== 'true') {
        formaPagamento.addEventListener('change', tratarMudancaFormaPagamento);
        formaPagamento.dataset.controleInicializado = 'true';
    }

    tratarMudancaTipoLancamento();
}

async function adicionarLancamentoComParcelas(dadosForm) {
    if (!await exigirPermissao('criarMovimento', 'criar lançamentos')) return false;
    if (processandoAcaoModal) return false;
    processandoAcaoModal = true;
    mostrarLoading("Salvando lançamento...");

    try {
        const dados = obterDados();
        const usuarioId = Number(localStorage.getItem('usuarioLogado'));
        const valorTotal = numeroSeguro(dadosForm.valorTotal);
        const qtdGerar = dadosForm.formaPagamento === 'FIXO' ? 12 : Math.min(48, Math.max(1, inteiroSeguro(dadosForm.qtdParcelas, 1)));

        if (!dadosForm.descricao?.trim() || valorTotal <= 0 || !dadosForm.vencimento) throw new Error('Preencha descrição, valor e data corretamente.');

        const categoriaId = String(dadosForm.categoriaId ?? '').trim();
        const categoria = dados.categorias.find(c => String(c.id) === categoriaId);

        if (!categoriaId || !categoria) throw new Error('Selecione uma categoria válida.');
        if (categoria.tipo !== dadosForm.tipo) throw new Error(`A categoria "${categoria.nome}" não pertence ao tipo de lançamento selecionado.`);

        const formasSaidaValidas = ['DINHEIRO', 'BOLETO', 'FIXO', 'CARTAO'];
        if (dadosForm.tipo === 'saida' && !formasSaidaValidas.includes(dadosForm.formaPagamento)) throw new Error('Forma de pagamento inválida.');

        let escopoFinal = dadosForm.tipo === 'saida' ? (dadosForm.escopo || 'casal') : 'casal';
        if (dadosForm.bemId) {
            const bemObj = (dados.bens || []).find(b => String(b.id) === String(dadosForm.bemId) && b.ativo !== false);
            if (!bemObj) throw new Error('O bem selecionado não existe ou está inativo.');
            const donoBemId = bemObj.usuarioId == null ? null : String(bemObj.usuarioId);
            const parceiroIdAtual = obterUsuarioAtual(dados)?.parceiroId == null ? null : String(obterUsuarioAtual(dados).parceiroId);
            if (donoBemId && donoBemId !== String(usuarioId) && !(bemObj.compartilhado === true && donoBemId === parceiroIdAtual)) {
                throw new Error('Este bem pertence a outro usuário e não está compartilhado.');
            }
            if (bemObj.compartilhado === true) escopoFinal = 'casal';
        }

        const valoresParcelas = dadosForm.formaPagamento === 'FIXO' ? Array.from({ length: qtdGerar }, () => Number(valorTotal.toFixed(2))) : dividirValorExato(valorTotal, qtdGerar);
        const valoresHoraExtra = dadosForm.horaExtra ? dividirValorExato(dadosForm.horaExtra, qtdGerar) : Array.from({ length: qtdGerar }, () => 0);
        const dataBase = criarDataLocal(dadosForm.vencimento);
        if (!dataBase) throw new Error('Data de vencimento inválida.');

        let proximaId = dados.lancamentos.reduce((m, l) => Math.max(m, Number(l.id) || 0), 0) + 1;
        const parcelamentoId = qtdGerar > 1 ? gerarId('parc') : null;
        
        let cartaoObj = null;
        if (dadosForm.formaPagamento === 'CARTAO' && dadosForm.cartaoId) {
            cartaoObj = (dados.cartoes || []).find(c => String(c.id) === String(dadosForm.cartaoId));
        }

        if (dadosForm.formaPagamento === 'CARTAO' && (!cartaoObj || cartaoObj.ativo === false || cartaoObj.isBeneficio || Number(cartaoObj.usuarioId) !== usuarioId)) {
            throw new Error('Selecione um cartão de crédito ativo (cartões de benefício não aceitam compras de crédito).');
        }

        for (let i = 1; i <= qtdGerar; i++) {
            const dataVenc = adicionarMesesClamped(dataBase, i - 1);
            const descricaoParcelada = qtdGerar > 1 ? `${String(dadosForm.descricao).trim()} (${i}/${qtdGerar})` : String(dadosForm.descricao).trim();
            const pagamento = dadosForm.formaPagamento === 'FIXO' ? 'BOLETO' : dadosForm.formaPagamento;
            
            let estaParcelaPaga = false;
            if (dadosForm.tipo === 'entrada') {
                estaParcelaPaga = dadosForm.statusInicial ? (dadosForm.statusInicial === 'pago') : true;
            } else if (dadosForm.formaPagamento === 'CARTAO') {
                // Uma compra no cartão só fica paga quando a fatura correspondente é quitada.
                estaParcelaPaga = false;
            } else {
                estaParcelaPaga = dadosForm.statusInicial ? (dadosForm.statusInicial === 'pago') : false;
            }

            dados.lancamentos.push({
                id: proximaId++,
                usuarioId, descricao: descricaoParcelada, valor: valoresParcelas[i - 1], tipo: dadosForm.tipo,
                categoriaId, formaPagamento: pagamento, cartaoId: dadosForm.cartaoId || null, bemId: dadosForm.bemId ? Number(dadosForm.bemId) : null,
                dataCompra: dadosForm.dataCompra || null, vencimento: dataParaString(dataVenc), recorrencia: dadosForm.formaPagamento === 'FIXO' ? 'mensal' : 'unica',
                parcelaAtual: i, totalParcelas: qtdGerar, parcelamentoId, observacao: dadosForm.observacao || '',
                horaExtra: valoresHoraExtra[i - 1], servicoEssencial: dadosForm.tipo === 'saida' ? (dadosForm.servicoEssencial || 'nao') : 'nao',
                escopo: escopoFinal, pago: estaParcelaPaga, status: estaParcelaPaga ? 'pago' : 'pendente',
                createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
            });
        }

        if (escopoFinal === 'casal') {
            const usuarioAtual = dados.usuarios.find(u => Number(u.id) === Number(usuarioId));
            if (usuarioAtual && usuarioAtual.parceiroId) {
                if (!Array.isArray(dados.notificacoes)) dados.notificacoes = [];
                const primeiroNome = usuarioAtual.nome.split(' ')[0];
                const tipoAcaoTxt = dadosForm.tipo === 'entrada' ? 'uma entrada' : 'um gasto';
                const tituloNotif = dadosForm.tipo === 'entrada' ? 'Nova Entrada de Casal 💰' : 'Novo Gasto de Casal 🏠';
                dados.notificacoes.push({
                    id: gerarId('notif'), usuarioDestinoId: usuarioAtual.parceiroId, remetenteId: usuarioId,
                    tipo: 'lancamento_casal', titulo: tituloNotif, mensagem: `${primeiroNome} registou ${tipoAcaoTxt} de casal: ${dadosForm.descricao} no valor de ${formatarMoeda(valorTotal)}.`,
                    lida: false, createdAt: new Date().toISOString()
                });
            }
        }

        if (typeof salvarMemoriaAdiantamentoSeNecessario === 'function') salvarMemoriaAdiantamentoSeNecessario(dadosForm.descricao, valoresParcelas[0]);
        
        registrarLogInterno(dados, "NOVO LANÇAMENTO", `Lançamento criado: ${dadosForm.descricao}, Valor total: ${formatarMoeda(valorTotal)} (${qtdGerar}x)`, { entidade: 'lancamento', parcelamentoId });
        await salvarDados(dados);

        esconderLoading(); processandoAcaoModal = false;
        await mostrarAlertaModal("Lançamento cadastrado com sucesso!");
        if (typeof carregarDashboard === 'function') carregarDashboard();
        if (typeof carregarRelatorios === 'function') carregarRelatorios();
        return true;
    } catch (erro) {
        console.error(erro);
        esconderLoading(); processandoAcaoModal = false;
        await mostrarAlertaModal(erro.message || 'Não foi possível cadastrar o lançamento.');
        return false;
    }
}

// Consolidado de adicionarContaLotePorPeriodo
async function adicionarContaLotePorPeriodo(descricao, valorParcela, dataInicio, qtdMeses, categoriaId, bemId = null, formaPagamento = 'BOLETO', cartaoId = null) {
    if (!await exigirPermissao('lotes', 'gerar contas em lote')) return false;
    if (!await exigirPermissao('criarMovimento', 'criar lançamentos')) return false;
    if (processandoAcaoModal) return false;
    processandoAcaoModal = true;
    mostrarLoading('Gerando contas em lote...');

    try {
        const dados = obterDados();
        const usuarioId = Number(localStorage.getItem('usuarioLogado'));
        const descricaoFinal = String(descricao || '').trim();
        const valorFinal = numeroSeguro(valorParcela);
        const quantidade = inteiroSeguro(qtdMeses, 0);
        const dataBase = dataInicio instanceof Date ? new Date(dataInicio) : criarDataLocal(dataInicio);
        const categoria = (dados.categorias || []).find(c => String(c.id) === String(categoriaId) && c.tipo === 'saida');

        if (!descricaoFinal || valorFinal <= 0 || !dataBase || !Number.isFinite(dataBase.getTime())) throw new Error('Informe descrição, valor e data inicial válidos.');
        if (!categoria) throw new Error('Selecione uma categoria válida de saída.');
        if (quantidade < 1 || quantidade > 120) throw new Error('O lote deve conter de 1 a 120 meses.');
        if (!['DINHEIRO', 'BOLETO', 'FIXO', 'CARTAO'].includes(formaPagamento)) throw new Error('Forma de pagamento inválida.');

        const cartao = formaPagamento === 'CARTAO'
            ? (dados.cartoes || []).find(c => String(c.id) === String(cartaoId) && c.ativo !== false && !c.isBeneficio && Number(c.usuarioId) === usuarioId)
            : null;
        if (formaPagamento === 'CARTAO' && !cartao) throw new Error('Selecione um cartão ativo pertencente ao usuário atual.');

        let escopo = 'casal';
        if (bemId) {
            const bem = (dados.bens || []).find(b => String(b.id) === String(bemId) && b.ativo !== false);
            if (!bem) throw new Error('O bem patrimonial selecionado não existe ou está inativo.');
            const donoBemId = bem.usuarioId == null ? null : String(bem.usuarioId);
            const parceiroIdAtual = obterUsuarioAtual(dados)?.parceiroId == null ? null : String(obterUsuarioAtual(dados).parceiroId);
            if (donoBemId && donoBemId !== String(usuarioId) && !(bem.compartilhado === true && donoBemId === parceiroIdAtual)) {
                throw new Error('Este bem pertence a outro usuário e não está compartilhado.');
            }
            if (!bem.compartilhado) escopo = 'individual';
            else escopo = 'casal';
        }

        let proximaId = (dados.lancamentos || []).reduce((maior, l) => Math.max(maior, Number(l.id) || 0), 0) + 1;
        const parcelamentoId = quantidade > 1 ? gerarId('lote') : null;
        const agora = new Date().toISOString();
        const hoje = dataLocalYYYYMMDD();

        for (let i = 0; i < quantidade; i++) {
            const dataCompraDate = adicionarMesesClamped(dataBase, i);
            const dataCompraStr = dataParaString(dataCompraDate);
            const vencimento = cartao
                ? calcularPrimeiroVencimentoCartao(cartao, dataCompraStr)
                : dataCompraStr;
            const atrasada = vencimento < hoje;

            dados.lancamentos.push({
                id: proximaId++, usuarioId, descricao: `${descricaoFinal} (${i + 1}/${quantidade})`,
                valor: Number(valorFinal.toFixed(2)), tipo: 'saida', categoriaId: categoria.id,
                formaPagamento: formaPagamento === 'FIXO' ? 'BOLETO' : formaPagamento,
                cartaoId: cartao ? cartao.id : null, bemId: bemId ? Number(bemId) : null,
                dataCompra: cartao ? dataCompraStr : null, vencimento, recorrencia: formaPagamento === 'FIXO' ? 'mensal' : 'unica',
                parcelaAtual: i + 1, totalParcelas: quantidade, parcelamentoId,
                observacao: 'Gerado por lote retroativo/período', horaExtra: 0,
                servicoEssencial: 'nao', escopo, pago: false, status: atrasada ? 'atrasado' : 'pendente',
                createdAt: agora, updatedAt: agora
            });
        }

        registrarLogInterno(dados, 'CONTA LOTE PERÍODO', `Lote criado: ${descricaoFinal} (${quantidade} meses; forma: ${formaPagamento})`);
        await salvarDados(dados);
        await mostrarAlertaModal('Contas em lote criadas com sucesso.');
        return true;
    } catch (erro) {
        console.error('Falha ao criar contas em lote:', erro);
        await mostrarAlertaModal(erro.message || 'Não foi possível criar as contas em lote.');
        return false;
    } finally {
        esconderLoading();
        processandoAcaoModal = false;
    }
}

async function adicionarFinanciamentoComRecorrencia(nome, recorrente, valorParcela, qtdMeses, primeiroVencimento, categoriaId = null, bemId = null) {
    if (!await exigirPermissao('financiamentos', 'criar financiamentos')) return false;
    if (processandoAcaoModal) return false;
    if (!await verificarSenhaAdmin("cadastrar contrato de financiamento")) return false;

    processandoAcaoModal = true;
    mostrarLoading("Cadastrando financiamento...");

    try {
        const dados = obterDados();
        const usuarioId = Number(localStorage.getItem('usuarioLogado'));
        const nomeFinal = String(nome || '').trim();
        const valorFinal = numeroSeguro(valorParcela);
        const meses = Math.min(360, Math.max(1, inteiroSeguro(qtdMeses, 1)));
        const dataBase = criarDataLocal(primeiroVencimento);
        const catFinalId = categoriaId || dados.categorias.find(c => normalizarTexto(c.nome).includes('financiamento'))?.id || dados.categorias.find(c => c.tipo === 'saida')?.id || null;

        const categoriaFin = (dados.categorias || []).find(c => String(c.id) === String(catFinalId) && c.tipo === 'saida');
        const nomeContratoDuplicado = (dados.financiamentos || []).some(f =>
            Number(f.usuarioId) === usuarioId && normalizarTexto(f.nome) === normalizarTexto(nomeFinal)
        );
        if (nomeContratoDuplicado) throw new Error('Você já possui um financiamento com esse nome. Use uma descrição diferente para evitar vinculações ambíguas.');
        if (!nomeFinal || !Number.isFinite(valorFinal) || valorFinal <= 0 || !dataBase || !Number.isFinite(dataBase.getTime()) || !categoriaFin) {
            throw new Error('Preencha os dados do financiamento corretamente e selecione uma categoria de saída válida.');
        }
        if (meses < 1 || meses > 360) throw new Error('A quantidade de parcelas deve ficar entre 1 e 360.');
        const bemObj = bemId ? (dados.bens || []).find(b => String(b.id) === String(bemId) && b.ativo !== false) : null;
        if (!bemObj) throw new Error('Selecione um bem patrimonial ativo e válido.');
        const proprietarioBemId = Number(bemObj.usuarioId || 0);
        const usuarioAtual = (dados.usuarios || []).find(u => Number(u.id) === usuarioId);
        const parceiroAtualId = Number(usuarioAtual?.parceiroId || 0);
        const bemPertenceAoParceiro = proprietarioBemId !== 0 && proprietarioBemId !== usuarioId &&
            proprietarioBemId === parceiroAtualId && bemObj.compartilhado === true;
        if (proprietarioBemId !== 0 && proprietarioBemId !== usuarioId && !bemPertenceAoParceiro) {
            throw new Error('Você não pode vincular um financiamento a um bem privado de outro usuário.');
        }

        let escopoFin = bemObj.compartilhado ? 'casal' : 'individual';

        const financiamentoId = dados.financiamentos.reduce((m, f) => Math.max(m, Number(f.id) || 0), 0) + 1;
        const parcelamentoId = gerarId('finparc');
        const totalMeses = recorrente === 'sim' ? meses : 1;

        dados.financiamentos.push({
            id: financiamentoId, usuarioId, nome: nomeFinal, bemId: bemId ? Number(bemId) : null,
            totalMeses, mesesPagos: 0, valorParcela: Number(valorFinal.toFixed(2)), categoriaId: catFinalId,
            primeiroVencimento, ativo: true, createdAt: new Date().toISOString()
        });

        let proximaIdLanc = dados.lancamentos.reduce((m, l) => Math.max(m, Number(l.id) || 0), 0) + 1;
        const parcelas = dividirValorExato(valorFinal * totalMeses, totalMeses);

        for (let i = 1; i <= totalMeses; i++) {
            const dataVenc = adicionarMesesClamped(dataBase, i - 1);
            dados.lancamentos.push({
                id: proximaIdLanc++, usuarioId, descricao: `Financiamento: ${nomeFinal} (${i}/${totalMeses})`, valor: parcelas[i - 1],
                tipo: 'saida', categoriaId: catFinalId, formaPagamento: 'BOLETO', cartaoId: null, bemId: bemId ? Number(bemId) : null,
                vencimento: dataParaString(dataVenc), recorrencia: 'mensal', parcelaAtual: i, totalParcelas: totalMeses, parcelamentoId,
                financiamentoId, observacao: 'Gerado automaticamente pelo contrato', horaExtra: 0, servicoEssencial: 'nao',
                escopo: escopoFin, pago: false, status: 'pendente', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
            });
        }

        registrarLogInterno(dados, "CADASTRO FINANCIAMENTO", `Contrato criado: ${nomeFinal} (${totalMeses} meses)`, { entidade: 'financiamento', entidadeId: financiamentoId });
        await salvarDados(dados);

        esconderLoading(); processandoAcaoModal = false;
        await mostrarAlertaModal("Financiamento cadastrado com sucesso!");
        if (typeof carregarRelatorios === 'function') carregarRelatorios();
        return true;
    } catch (erro) {
        console.error(erro);
        esconderLoading(); processandoAcaoModal = false;
        await mostrarAlertaModal(erro.message || 'Não foi possível cadastrar o financiamento.');
        return false;
    }
}

// Consolidado de AtualizarLancamento
async function atualizarLancamentoNoBanco(id, novosDados) {
    if (!await exigirPermissao('criarMovimento', 'editar lançamentos')) return false;
    const dados = obterDados();
    const lancamento = (dados.lancamentos || []).find(l => String(l.id) === String(id));
    if (!lancamento) {
        await mostrarAlertaModal("Lançamento não encontrado.");
        return false;
    }
    if (!usuarioPodeAlterarLancamento(lancamento, dados)) {
        await mostrarAlertaModal('Você não tem permissão para editar este lançamento.');
        return false;
    }
    const tipoValido = ['entrada', 'saida'].includes(novosDados?.tipo);
    const categoriaValida = (dados.categorias || []).some(c =>
        String(c.id) === String(novosDados?.categoriaId) && c.tipo === novosDados?.tipo
    );
    if (!tipoValido || !categoriaValida) {
        await mostrarAlertaModal('Selecione uma categoria válida para o tipo de lançamento escolhido.');
        return false;
    }
    const valorNovo = numeroSeguro(novosDados?.valor, NaN);
    if (!Number.isFinite(valorNovo) || valorNovo <= 0) {
        await mostrarAlertaModal('O valor do lançamento deve ser maior que zero.');
        return false;
    }

    const grupoParcelamentoId = resolverParcelamentoId(lancamento);
    const financiamentoId = resolverFinanciamentoIdPorLancamento(lancamento, dados);
    const ehVinculado = Boolean(grupoParcelamentoId) || Boolean(financiamentoId);

    let aplicarParaTodas = false;
    if (ehVinculado) {
        const escolha = await mostrarOpcaoEscopoModal("Este lançamento faz parte de um financiamento ou compra parcelada. Deseja tornar essa modificação para todas outras parcelas?");
        if (escolha === null) return false;
        aplicarParaTodas = (escolha === 'todas');
    }

    const motivo = await mostrarPromptTextoModal("Justificativa Obrigatória", "Informe o motivo da edição deste lançamento:");
    if (!motivo) return false;

    mostrarLoading("Atualizando lançamento(s)...");

    const usuarioId = localStorage.getItem('usuarioLogado');
    const u = dados.usuarios.find(user => Number(user.id) === Number(usuarioId));
    const nomeUsuario = u ? u.nome : "Desconhecido";
    const dataHoraAtual = new Date().toLocaleString('pt-BR');

    if (aplicarParaTodas) {
        const relacionados = financiamentoId
            ? dados.lancamentos.filter(l => String(resolverFinanciamentoIdPorLancamento(l, dados)) === String(financiamentoId))
            : dados.lancamentos.filter(l => String(l.parcelamentoId) === String(grupoParcelamentoId));
        if (!relacionados.length || relacionados.some(l => !usuarioPodeAlterarLancamento(l, dados))) {
            esconderLoading();
            await mostrarAlertaModal('O grupo contém parcelas que não podem ser alteradas por este usuário. Nenhum registro foi modificado.');
            return false;
        }

        const financiamentoEditado = financiamentoId == null
            ? null
            : (dados.financiamentos || []).find(f => String(f.id) === String(financiamentoId));
        if (financiamentoEditado) {
            const descricaoBaseNova = String(novosDados.descricao || '').replace(/\s\(\d+\/\d+\)$/, '').trim();
            financiamentoEditado.nome = descricaoBaseNova.replace(/^Financiamento:\s*/i, '').trim() || financiamentoEditado.nome;
            financiamentoEditado.valorParcela = Number(valorNovo.toFixed(2));
            financiamentoEditado.categoriaId = novosDados.categoriaId;
            const dataReferencia = novosDados.vencimento ? criarDataLocal(novosDados.vencimento) : null;
            if (dataReferencia) financiamentoEditado.primeiroVencimento = dataParaString(adicionarMesesClamped(dataReferencia, 1 - Number(lancamento.parcelaAtual || 1)));
            financiamentoEditado.updatedAt = new Date().toISOString();
        }

        relacionados.forEach(l => {
            const descricaoAntiga = l.descricao;
            const valorAntigo = l.valor;

            const sufixoMatch = l.descricao.match(/\s\(\d+\/\d+\)$/);
            const sufixo = sufixoMatch ? sufixoMatch[0] : '';
            const baseNovaDescricao = novosDados.descricao.replace(/\s\(\d+\/\d+\)$/, '').trim();
            l.descricao = sufixo ? `${baseNovaDescricao}${sufixo}` : baseNovaDescricao;

            l.tipo = novosDados.tipo;
            l.categoriaId = novosDados.categoriaId;
            l.formaPagamento = novosDados.formaPagamento;
            if (novosDados.valor !== undefined && novosDados.valor !== null && novosDados.valor !== '') {
                l.valor = Number(numeroSeguro(novosDados.valor).toFixed(2));
            }
            l.observacao = novosDados.observacao;
            l.servicoEssencial = novosDados.tipo === 'saida' ? (novosDados.servicoEssencial || 'nao') : 'nao';
            l.escopo = novosDados.tipo === 'saida' ? (novosDados.escopo || 'casal') : 'casal';
            if (novosDados.formaPagamento === 'CARTAO' && novosDados.tipo === 'saida') {
                l.cartaoId = novosDados.cartaoId || l.cartaoId || null;
                l.dataCompra = novosDados.dataCompra || l.dataCompra || null;
            } else {
                l.cartaoId = null;
                l.dataCompra = null;
            }
            if (novosDados.vencimento) {
                const novaDataReferencia = criarDataLocal(novosDados.vencimento);
                if (novaDataReferencia) {
                    const numeroParcelaAtual = Number(lancamento.parcelaAtual || 1);
                    const numeroParcelaRelacionada = Number(l.parcelaAtual || numeroParcelaAtual);
                    l.vencimento = dataParaString(adicionarMesesClamped(novaDataReferencia, numeroParcelaRelacionada - numeroParcelaAtual));
                }
            }
            l.updatedAt = new Date().toISOString();

            dados.edicao_movimento.push({
                id: gerarId('edit'), dataHora: dataHoraAtual, usuario: nomeUsuario, usuarioId: Number(usuarioId), lancamentoId: l.id,
                descricaoAntiga, descricaoNova: l.descricao, valorAntigo, valorNovo: l.valor, motivo: `[EM LOTE] ${motivo}`
            });
        });

        registrarLogInterno(dados, "EDIÇÃO EM LOTE", `Atualizadas ${relacionados.length} parcelas vinculadas. Motivo: ${motivo}`);
    } else {
        const descricaoAntiga = lancamento.descricao;
        const valorAntigo = lancamento.valor;

        lancamento.descricao = novosDados.descricao;
        lancamento.tipo = novosDados.tipo;
        lancamento.categoriaId = novosDados.categoriaId;
        lancamento.formaPagamento = novosDados.formaPagamento;
        lancamento.valor = Number(numeroSeguro(novosDados.valor).toFixed(2));
        lancamento.observacao = novosDados.observacao;
        lancamento.vencimento = novosDados.vencimento;
        lancamento.updatedAt = new Date().toISOString();

        if (novosDados.formaPagamento === 'CARTAO' && novosDados.tipo === 'saida') {
            lancamento.cartaoId = novosDados.cartaoId || lancamento.cartaoId || null;
            lancamento.dataCompra = novosDados.dataCompra || lancamento.dataCompra || null;
        } else {
            lancamento.cartaoId = null;
            lancamento.dataCompra = null;
        }
        lancamento.servicoEssencial = novosDados.tipo === 'saida' ? (novosDados.servicoEssencial || 'nao') : 'nao';
        lancamento.escopo = novosDados.tipo === 'saida' ? (novosDados.escopo || 'casal') : 'casal';

        dados.edicao_movimento.push({
            id: gerarId('edit'), dataHora: dataHoraAtual, usuario: nomeUsuario, usuarioId: Number(usuarioId), lancamentoId: id,
            descricaoAntiga, descricaoNova: novosDados.descricao, valorAntigo, valorNovo: novosDados.valor, motivo
        });

        registrarLogInterno(dados, "EDIÇÃO LANÇAMENTO", `Lançamento ID ${id} atualizado. Motivo: ${motivo}`);
    }

    await salvarDados(dados);
    esconderLoading();
    await mostrarAlertaModal("Lançamento(s) atualizado(s) com sucesso!");
    if (typeof carregarDashboard === 'function') carregarDashboard();
    if (typeof carregarRelatorios === 'function') carregarRelatorios();
    if (typeof carregarCentralPagamentos === 'function') carregarCentralPagamentos();
    return true;
}

async function excluirFinanciamento(id) {
    if (!await exigirPermissao('financiamentos', 'excluir financiamentos')) return false;
    if (!await exigirPermissao('excluirMovimento', 'excluir movimentos')) return false;
    if (processandoAcaoModal) return false;
    if (!await verificarSenhaAdmin("excluir financiamento")) return false;

    const confirmar = await mostrarConfirmacaoModal("Deseja realmente excluir este contrato de financiamento e todas as suas parcelas associadas?");
    if (!confirmar) return false;

    processandoAcaoModal = true;
    mostrarLoading("Excluindo financiamento...");

    try {
        const dados = obterDados();
        const fin = dados.financiamentos.find(f => String(f.id) === String(id));
        if (!fin) throw new Error('Financiamento não encontrado.');
        if (Number(fin.usuarioId) !== Number(obterUsuarioAtualId(dados))) {
            throw new Error('Você só pode excluir contratos vinculados ao seu usuário.');
        }

        const parcelas = dados.lancamentos.filter(l => pertenceAoFinanciamento(l, fin, dados));

        parcelas.forEach(l => {
            if (!Array.isArray(dados.exclusao_movimento)) dados.exclusao_movimento = [];
            const usuario = obterUsuarioAtual(dados);
            dados.exclusao_movimento.push({
                id: gerarId('exc'), dataHora: new Date().toLocaleString('pt-BR'), usuario: usuario ? usuario.nome : 'Desconhecido',
                usuarioId: usuario ? Number(usuario.id) : null, lancamentoId: l.id, descricao: l.descricao, valor: l.valor, motivo: '[FINANCIAMENTO] Exclusão do contrato'
            });
        });

        dados.financiamentos = dados.financiamentos.filter(f => String(f.id) !== String(id));
        dados.lancamentos = dados.lancamentos.filter(l => !parcelas.some(p => String(p.id) === String(l.id)));
        registrarLogInterno(dados, "EXCLUSÃO FINANCIAMENTO", `Contrato ID ${id} (${fin.nome}) e ${parcelas.length} parcela(s) excluídos`, { entidade: 'financiamento', entidadeId: id });
        await salvarDados(dados);

        esconderLoading(); processandoAcaoModal = false;
        await mostrarAlertaModal("Financiamento e suas parcelas foram excluídos com sucesso!");
        if (typeof carregarRelatorios === 'function') carregarRelatorios();
        return true;
    } catch (erro) {
        console.error(erro);
        esconderLoading(); processandoAcaoModal = false;
        await mostrarAlertaModal(erro.message || 'Não foi possível excluir o financiamento.');
        return false;
    }
}

async function alternarStatusPagamento(id) {
    if (!await exigirPermissao('criarMovimento', 'alterar o status de pagamentos')) return false;
    if (processandoAcaoModal) return false;
    processandoAcaoModal = true;
    mostrarLoading("Atualizando status...");
    try {
        const dados = obterDados();
        const lancamento = dados.lancamentos.find(l => String(l.id) === String(id));
        if (!lancamento) throw new Error('Lançamento não encontrado.');
        if (!usuarioPodeAlterarLancamento(lancamento, dados)) {
            throw new Error('Você não tem permissão para alterar o status deste lançamento.');
        }
        if (lancamento.formaPagamento === 'CARTAO') {
            throw new Error('Compras no cartão são quitadas pela fatura consolidada. Abra a fatura do cartão para alterar o status.');
        }

        const novoPago = !Boolean(lancamento.pago);
        lancamento.pago = novoPago;
        lancamento.status = novoPago ? 'pago' : (lancamento.vencimento && lancamento.vencimento < dataLocalYYYYMMDD() ? 'atrasado' : 'pendente');
        lancamento.dataPagamento = novoPago ? dataLocalYYYYMMDD() : null;
        lancamento.usuarioPagamentoId = novoPago ? obterUsuarioAtualId(dados) : null;
        lancamento.updatedAt = new Date().toISOString();
        const financiamentoIdAtualizado = resolverFinanciamentoIdPorLancamento(lancamento, dados);
        if (financiamentoIdAtualizado != null) {
            const financiamento = (dados.financiamentos || []).find(f => String(f.id) === String(financiamentoIdAtualizado));
            if (financiamento) {
                financiamento.mesesPagos = dados.lancamentos.filter(l =>
                    String(resolverFinanciamentoIdPorLancamento(l, dados)) === String(financiamento.id) && (l.pago === true || l.status === 'pago')
                ).length;
                financiamento.updatedAt = new Date().toISOString();
            }
        }

        registrarLogInterno(dados, "STATUS PAGAMENTO", `Lançamento ID ${id} (${lancamento.descricao}) marcado como ${novoPago ? 'PAGO' : 'PENDENTE'}`, { entidade: 'lancamento', entidadeId: id });
        await salvarDados(dados);

        esconderLoading(); processandoAcaoModal = false;
        
        if (typeof carregarRelatorios === 'function') carregarRelatorios();
        if (typeof carregarDashboard === 'function') carregarDashboard();
        if (typeof renderizarCartoes === 'function') renderizarCartoes();
        return true;
    } catch (erro) {
        console.error(erro);
        esconderLoading(); processandoAcaoModal = false;
        await mostrarAlertaModal(erro.message || 'Não foi possível atualizar o status.');
        return false;
    }
}

function carregarDashboard() {
    const filtroMesInput = document.getElementById('filtroMesAno');
    if (filtroMesInput && !filtroMesInput.value) {
        const hoje = new Date();
        filtroMesInput.value = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
    }

    const mesAno = filtroMesInput ? filtroMesInput.value : '';
    const escopo = document.getElementById('filtroEscopoDashboardGeral')?.value || 'casal';
    const tipoFiltroLanc = document.getElementById('filtroTipoUltimosLancamentos')?.value || 'todos';

    const dados = obterDados();
    const usuarioId = localStorage.getItem('usuarioLogado');
    const usuario = dados.usuarios.find(u => Number(u.id) === Number(usuarioId)) || {};
    
    const lancamentos = filtrarDadosPorPermissao(dados.lancamentos || [], dados, escopo);
    const categorias = dados.categorias || [];
    
    const bens = filtrarDadosPorPermissao(dados.bens || [], dados, escopo);
    const bensValidos = bens.filter(b => b.ativo !== false && (Number(b.usuarioId) === Number(usuarioId) || !b.usuarioId || (b.compartilhado && usuario.parceiroId)));
    
    const elPatrimonio = document.getElementById('totalPatrimonioBens');
    if (elPatrimonio) elPatrimonio.textContent = `R$ ${bensValidos.reduce((acc, b) => acc + Number(b.valor || 0), 0).toLocaleString('pt-BR', {minimumFractionDigits: 2})}`;

    const filtrados = lancamentos.filter(l => {
        const dataRef = String(l.vencimento || l.dataCompra || l.createdAt || '');
        return (!mesAno || dataRef.startsWith(mesAno)) && (escopo === 'todos' || (l.tipo === 'entrada') || (l.escopo || 'casal') === escopo);
    });

let totalEntradas = 0, totalSaidas = 0;
    let totalSalario = 0, totalUber = 0, totalCartaoCredito = 0;

    filtrados.forEach(l => {
        const val = Number(l.valor || 0);
        const catObj = categorias.find(c => Number(c.id) === Number(l.categoriaId));
        const catNome = catObj ? normalizarTexto(catObj.nome) : '';

        if (l.tipo === 'entrada') {
            totalEntradas += val;
            
            if (['salario', 'adiantamento', 'ferias', 'plr', 'decimo terceiro', '13'].some(t => catNome.includes(t))) {
                totalSalario += val;
            } else if (['uber', '99', 'indrive'].some(t => catNome.includes(t))) {
                totalUber += val;
            }
        } else {
            totalSaidas += val;
            
            if (l.formaPagamento === 'CARTAO') {
                totalCartaoCredito += val;
            }
        }
    });

    const elTotalEntradas = document.getElementById('totalEntradas');
    if (elTotalEntradas) elTotalEntradas.textContent = `R$ ${totalEntradas.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`;
    
    const elTotalSaidas = document.getElementById('totalSaidas');
    if (elTotalSaidas) elTotalSaidas.textContent = `R$ ${totalSaidas.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`;
    
    const elSaldo = document.getElementById('saldoGeral');
    if (elSaldo) {
        elSaldo.textContent = `R$ ${(totalEntradas - totalSaidas).toLocaleString('pt-BR', {minimumFractionDigits: 2})}`;
        elSaldo.className = `stat-value ${(totalEntradas - totalSaidas) >= 0 ? 'positivo' : 'negativo'}`;
    }

 const elSubEntradas = document.getElementById('subDetalhesEntradas');
    if (elSubEntradas) {
        let outrosGanhos = totalEntradas - totalSalario - totalUber;
        if (outrosGanhos < 0) outrosGanhos = 0;
        
        let textoSubEntradas = `<strong>Salário:</strong> R$ ${totalSalario.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`;
        if (totalUber > 0) textoSubEntradas += `<br><strong>Uber:</strong> R$ ${totalUber.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`;
        textoSubEntradas += `<br><strong>Outros ganhos:</strong> R$ ${outrosGanhos.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`;
        
        elSubEntradas.innerHTML = textoSubEntradas;
        elSubEntradas.style.color = 'var(--text-main)';
        elSubEntradas.style.lineHeight = '1.5';
        elSubEntradas.style.fontSize = '0.85rem';
        elSubEntradas.style.marginTop = '10px';
    }

    const elSubSaidas = document.getElementById('subDetalhesSaidas');
    if (elSubSaidas) {
        let outrasDespesas = totalSaidas - totalCartaoCredito;
        if (outrasDespesas < 0) outrasDespesas = 0;
        
        elSubSaidas.innerHTML = `<strong>Cartão:</strong> R$ ${totalCartaoCredito.toLocaleString('pt-BR', {minimumFractionDigits: 2})}<br><strong>Outras despesas:</strong> R$ ${outrasDespesas.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`;
        elSubSaidas.style.color = 'var(--text-main)';
        elSubSaidas.style.lineHeight = '1.5';
        elSubSaidas.style.fontSize = '0.85rem';
        elSubSaidas.style.marginTop = '10px';
    }

    // === CÁLCULO: MAIOR FOCO DE ATENÇÃO ===
    const elFocoValor = document.getElementById('maiorFocoValor');
    const elFocoDetalhe = document.getElementById('maiorFocoDetalhe');
    
    if (elFocoValor && elFocoDetalhe) {
        // Agrupar apenas as SAÍDAS do mês filtrado por categoria
        const gastosPorCategoria = {};
        
        filtrados.forEach(l => {
            if (l.tipo === 'saida') {
                const catId = l.categoriaId;
                gastosPorCategoria[catId] = (gastosPorCategoria[catId] || 0) + Number(l.valor || 0);
            }
        });

        // Transformar em array e ordenar do maior para o menor
        const categoriasOrdenadas = Object.keys(gastosPorCategoria)
            .map(id => ({ id: Number(id), total: gastosPorCategoria[id] }))
            .sort((a, b) => b.total - a.total);

        if (categoriasOrdenadas.length === 0) {
            elFocoValor.textContent = "R$ 0,00";
            elFocoDetalhe.textContent = "Nenhum gasto registrado";
        } else {
            // Pegar até os 3 maiores
            const top3 = categoriasOrdenadas.slice(0, 3);
            
            // O valor exibido grandão será o da categoria número 1
            const top1Cat = categorias.find(c => Number(c.id) === top3[0].id);
            const top1Nome = top1Cat ? top1Cat.nome : 'Outros';
            
            elFocoValor.textContent = `${top1Nome}: R$ ${top3[0].total.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`;
            
            // Construir o subtítulo com os próximos (se houver)
            let textoSub = "";
            for (let i = 1; i < top3.length; i++) {
                const catObj = categorias.find(c => Number(c.id) === top3[i].id);
                const nomeCat = catObj ? catObj.nome : 'Outros';
                textoSub += `<strong>${escaparHTML(nomeCat)}:</strong> R$ ${top3[i].total.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`;
                if (i < top3.length - 1) textoSub += "<br>";
            }
            
            if (textoSub === "") {
                 elFocoDetalhe.innerHTML = "Não há outros gastos.";
            } else {
                 elFocoDetalhe.innerHTML = textoSub;
            }
            
            // Formatar os detalhes igual fizemos nos de entrada/saída
            elFocoDetalhe.style.color = 'var(--text-main)';
            elFocoDetalhe.style.lineHeight = '1.5';
            elFocoDetalhe.style.fontSize = '0.85rem';
            elFocoDetalhe.style.marginTop = '10px';
            elFocoValor.style.fontSize = 'clamp(1.15rem, 2.2vw, 1.4rem)'; // Dá uma ajustada no tamanho do titulo para caber o texto
        }
    }

    const tbodyLanc = document.getElementById('tabelaUltimosLancamentos');
    if (tbodyLanc) {
        tbodyLanc.innerHTML = '';
        const lancamentosTabela = filtrados.filter(l => tipoFiltroLanc === 'todos' || l.tipo === tipoFiltroLanc);

        if (lancamentosTabela.length === 0) {
            tbodyLanc.innerHTML = `<tr><td colspan="7" style="text-align: center;">Nenhum lançamento encontrado para o mês ${mesAno}.</td></tr>`;
        } else {
            lancamentosTabela.forEach(l => {
                const catObj = categorias.find(c => Number(c.id) === Number(l.categoriaId)) || { nome: 'Geral' };
                const usuarioObj = (dados.usuarios || []).find(u => String(u.id) === String(l.usuarioId));
                const nomeUsuario = l.usuario || usuarioObj?.nome || 'Sistema';
                tbodyLanc.innerHTML += `
                    <tr>
                        <td>${escaparHTML(nomeUsuario)}</td>
                        <td><strong>${escaparHTML(l.descricao)}</strong></td>
                        <td>${escaparHTML(catObj.nome)}</td>
                        <td>${escaparHTML(formatarDataBR(l.dataPagamento))}</td>
                        <td>${escaparHTML(formatarDataBR(l.vencimento))}</td>
                        <td class="${l.tipo === 'entrada' ? 'positivo' : 'negativo'}">${escaparHTML(formatarMoeda(l.valor))}</td>
                        <td>
                            <button type="button" onclick="window.location.href='editar-lancamento.html?id=${encodeURIComponent(String(l.id))}'" class="btn-acao-icone editar" title="Editar"><img src="imagens/editar.png" alt="Editar"></button>
                            <button type="button" onclick="removerLancamentoInteligente(${Number(l.id)})" class="btn-acao-icone excluir" title="Excluir"><img src="imagens/excluir.png" alt="Excluir"></button>
                        </td>
                    </tr>
                `;
            });
        }
    }
    atualizarGraficosDashboard(totalEntradas, totalSaidas, dados);
    renderizarCentralLembretes(filtrados, dados, mesAno);
    renderizarProximosPagamentos(lancamentos, dados, escopo);
}

function renderizarProximosPagamentos(lancamentosPermitidos, dados, escopo) {
    const secao = document.getElementById('secaoProximosPagamentos');
    const lista = document.getElementById('listaProximosPagamentos');
    if (!secao || !lista) return;

    const hojeStr = dataLocalYYYYMMDD();
    const limiteData = criarDataLocal(hojeStr);
    limiteData.setDate(limiteData.getDate() + 30);
    const limiteStr = dataLocalYYYYMMDD(limiteData);

    const pendentes = (lancamentosPermitidos || []).filter(l => {
        const vencimento = String(l.vencimento || '').slice(0, 10);
        return l.tipo === 'saida' && !l.pago && vencimento >= hojeStr && vencimento <= limiteStr &&
            (escopo === 'todos' || (l.escopo || 'casal') === escopo);
    });

    const cartoes = new Map((dados.cartoes || []).map(c => [String(c.id), c]));
    const agrupadasFaturas = new Map();
    const itens = [];
    pendentes.forEach(l => {
        if (l.formaPagamento === 'CARTAO' && l.cartaoId != null) {
            const chave = `${l.cartaoId}|${String(l.vencimento).slice(0, 10)}`;
            const grupo = agrupadasFaturas.get(chave) || {
                vencimento: String(l.vencimento).slice(0, 10),
                descricao: `Fatura — ${(cartoes.get(String(l.cartaoId)) || {}).nome || 'Cartão'}`,
                valor: 0,
                tipo: 'fatura'
            };
            grupo.valor += numeroSeguro(l.valor);
            agrupadasFaturas.set(chave, grupo);
        } else {
            itens.push({
                vencimento: String(l.vencimento).slice(0, 10),
                descricao: String(l.descricao || 'Conta sem descrição'),
                valor: numeroSeguro(l.valor),
                tipo: 'conta'
            });
        }
    });
    itens.push(...agrupadasFaturas.values());
    itens.sort((a, b) => a.vencimento.localeCompare(b.vencimento) || a.descricao.localeCompare(b.descricao, 'pt-BR'));

    lista.replaceChildren();
    itens.forEach(item => {
        const li = document.createElement('li');
        const descricao = document.createElement('strong');
        descricao.textContent = item.descricao;
        const detalhe = document.createElement('span');
        detalhe.textContent = `${formatarDataBR(item.vencimento)} · ${formatarMoeda(item.valor)}`;
        li.append(descricao, detalhe);
        lista.appendChild(li);
    });

    secao.style.display = itens.length ? 'block' : 'none';
}

function atualizarGraficosDashboard(totalEntradas, totalSaidas, dados) {
    if (typeof Chart === 'undefined') { console.warn('Chart.js não foi carregado; gráficos ignorados.'); return; }
    const escopoAtual = document.getElementById('filtroEscopoDashboardGeral')?.value || 'casal';

    const canvasES = document.getElementById('graficoEntradasSaidas');
    if (canvasES) {
        if (chartEntradasSaidasInstance) chartEntradasSaidasInstance.destroy();
        chartEntradasSaidasInstance = new Chart(canvasES, {
            type: 'pie',
            data: {
                labels: ['Entradas', 'Saídas'],
                datasets: [{
                    data: (totalEntradas > 0 || totalSaidas > 0) ? [totalEntradas, totalSaidas] : [1, 1],
                    backgroundColor: (totalEntradas > 0 || totalSaidas > 0) ? ['#10b981', '#ef4444'] : ['#cbd5e1', '#cbd5e1'],
                    borderWidth: 1
                }]
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 12 } } } }
        });
    }

    const mesAnoSelecionado = document.getElementById('filtroMesAno')?.value || '';
    const selectFiltroCategoria = document.getElementById('filtroCategoriaDashboard');
    let categoriaSelecionadaId = selectFiltroCategoria?.value || 'todas';
    if (selectFiltroCategoria) {
        const categoriasSaida = (dados.categorias || [])
            .filter(c => c.tipo === 'saida')
            .sort((a, b) => normalizarTexto(a.nome).localeCompare(normalizarTexto(b.nome), 'pt-BR'));
        const categoriaAindaExiste = categoriasSaida.some(c => String(c.id) === String(categoriaSelecionadaId));
        selectFiltroCategoria.replaceChildren();
        const opcaoTodas = document.createElement('option');
        opcaoTodas.value = 'todas';
        opcaoTodas.textContent = 'Todas';
        selectFiltroCategoria.appendChild(opcaoTodas);
        categoriasSaida.forEach(c => {
            const option = document.createElement('option');
            option.value = String(c.id);
            option.textContent = c.nome || 'Categoria sem nome';
            selectFiltroCategoria.appendChild(option);
        });
        selectFiltroCategoria.value = categoriaAindaExiste ? String(categoriaSelecionadaId) : 'todas';
        categoriaSelecionadaId = selectFiltroCategoria.value || 'todas';
    }

    const lancamentosPermitidos = filtrarDadosPorPermissao(dados.lancamentos || [], dados, escopoAtual);
    const lancamentosEscopo = lancamentosPermitidos.filter(l =>
        escopoAtual === 'todos' || (l.escopo || 'casal') === escopoAtual
    );
    const lancamentosDespesasPeriodo = lancamentosEscopo.filter(l =>
        l.tipo === 'saida' && (!mesAnoSelecionado || String(l.vencimento || l.data || l.dataCompra || l.createdAt || '').startsWith(mesAnoSelecionado))
    );
    const lancamentosPeriodo = lancamentosDespesasPeriodo.filter(l =>
        categoriaSelecionadaId === 'todas' || String(l.categoriaId) === String(categoriaSelecionadaId)
    );

    const somatorioPorCategoria = {};
    lancamentosPeriodo.forEach(l => somatorioPorCategoria[l.categoriaId] = (somatorioPorCategoria[l.categoriaId] || 0) + numeroSeguro(l.valor));

    const labelsCategorias = [], valoresCategorias = [], coresPadrao = ['#3b82f6', '#f59e0b', '#10b981', '#8b5cf6', '#ec4899', '#06b6d4', '#64748b', '#ef4444'];
    for (let catId in somatorioPorCategoria) {
        const cat = dados.categorias.find(c => Number(c.id) === Number(catId));
        labelsCategorias.push(cat ? cat.nome : 'Outros');
        valoresCategorias.push(somatorioPorCategoria[catId]);
    }

    const canvasCat = document.getElementById('graficoGastosCategorias');
    if (canvasCat) {
        if (chartGastosCategoriasInstance) chartGastosCategoriasInstance.destroy();
        chartGastosCategoriasInstance = new Chart(canvasCat, {
            type: 'pie',
            data: {
                labels: valoresCategorias.length > 0 ? labelsCategorias : ['Sem gastos'],
                datasets: [{
                    data: valoresCategorias.length > 0 ? valoresCategorias : [1],
                    backgroundColor: valoresCategorias.length > 0 ? coresPadrao.slice(0, valoresCategorias.length) : ['#cbd5e1'],
                    borderWidth: 1
                }]
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 12 } } } }
        });
    }

    const filtroServicoEssencial = document.getElementById('filtroServicoEssencialDashboard')?.value || 'todos';
    const lancamentosClassificacao = lancamentosDespesasPeriodo.filter(l =>
        filtroServicoEssencial === 'todos' || (l.servicoEssencial === 'sim' ? 'sim' : 'nao') === filtroServicoEssencial
    );
    let totalEssencial = 0, totalNaoEssencial = 0;
    lancamentosClassificacao.forEach(l => l.servicoEssencial === 'sim' ? totalEssencial += numeroSeguro(l.valor) : totalNaoEssencial += numeroSeguro(l.valor));

    const canvasServicos = document.getElementById('graficoServicosEssenciais');
    if (canvasServicos) {
        if (chartServicosEssenciaisInstance) chartServicosEssenciaisInstance.destroy();
        const temClassificacao = totalEssencial > 0 || totalNaoEssencial > 0;
        let labelsServicos = ['Essenciais', 'Não essenciais'];
        let valoresServicos = [totalEssencial, totalNaoEssencial];
        let coresServicos = ['#10b981', '#f59e0b'];
        if (!temClassificacao) {
            labelsServicos = ['Sem despesas'];
            valoresServicos = [1];
            coresServicos = ['#cbd5e1'];
        } else if (filtroServicoEssencial === 'sim') {
            labelsServicos = ['Essenciais'];
            valoresServicos = [totalEssencial];
            coresServicos = ['#10b981'];
        } else if (filtroServicoEssencial === 'nao') {
            labelsServicos = ['Não essenciais'];
            valoresServicos = [totalNaoEssencial];
            coresServicos = ['#f59e0b'];
        }
        chartServicosEssenciaisInstance = new Chart(canvasServicos, {
            type: 'pie',
            data: {
                labels: labelsServicos,
                datasets: [{ data: valoresServicos, backgroundColor: coresServicos, borderWidth: 1 }]
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 12 } } } }
        });
    }

    const selectFiltroCartao = document.getElementById('filtroGraficoCartao');
    const cartoesUsuario = filtrarDadosPorPermissao(dados.cartoes || [], dados, escopoAtual).filter(c => c.ativo !== false);
    
    if (selectFiltroCartao) {
        const valorAtual = selectFiltroCartao.value || 'todos';
        selectFiltroCartao.replaceChildren();
        const opcaoTodosCartoes = document.createElement('option');
        opcaoTodosCartoes.value = 'todos';
        opcaoTodosCartoes.textContent = 'Todos';
        selectFiltroCartao.appendChild(opcaoTodosCartoes);
        cartoesUsuario.forEach(c => {
            const option = document.createElement('option');
            option.value = String(c.id);
            option.textContent = c.nome || 'Cartão sem nome';
            selectFiltroCartao.appendChild(option);
        });
        selectFiltroCartao.value = cartoesUsuario.some(c => String(c.id) === String(valorAtual)) ? String(valorAtual) : 'todos';
    }

    const cartaoSelecionadoId = selectFiltroCartao ? (selectFiltroCartao.value || 'todos') : 'todos';
    let totalLimiteGeral = 0, totalUsadoGeral = 0;

    cartoesUsuario.forEach(cartao => {
        if (cartaoSelecionadoId === 'todos' || Number(cartao.id) === Number(cartaoSelecionadoId)) {
            totalUsadoGeral += lancamentosEscopo.filter(l => Number(l.cartaoId) === Number(cartao.id) && l.tipo === 'saida' && !l.pago).reduce((acc, l) => acc + numeroSeguro(l.valor), 0);
            totalLimiteGeral += Number(cartao.limite || cartao.limiteTotal || 0);
        }
    });

    const totalDisponivelGeral = Math.max(0, totalLimiteGeral - totalUsadoGeral);
    const canvasCartao = document.getElementById('graficoCartoesLimite');
    if (canvasCartao) {
        if (chartCartoesLimiteInstance) chartCartoesLimiteInstance.destroy();
        chartCartoesLimiteInstance = new Chart(canvasCartao, {
            type: 'pie',
            data: {
                labels: ['Limite Usado', 'Limite Disponível'],
                datasets: [{
                    data: (totalUsadoGeral > 0 || totalDisponivelGeral > 0) ? [totalUsadoGeral, totalDisponivelGeral] : [1, 1],
                    backgroundColor: (totalUsadoGeral > 0 || totalDisponivelGeral > 0) ? ['#f59e0b', '#3b82f6'] : ['#cbd5e1', '#cbd5e1'],
                    borderWidth: 1
                }]
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 12 } } } }
        });
    }
}

function carregarRelatorios() {
    if (typeof window.carregarRelatorioMensal === 'function') return window.carregarRelatorioMensal();
    if (typeof Chart === 'undefined') { console.warn('Chart.js não foi carregado; relatórios gráficos ignorados.'); return; }
    const dados = obterDados();
    const mesAnoSelecionado = document.getElementById('filtroMesAnoRelatorio')?.value || '';
    const servicoFiltroVal = document.getElementById('filtroServicoEssencialDashboard')?.value || 'todos';

    const lancamentosPeriodo = dados.lancamentos.filter(l => 
        (!mesAnoSelecionado || String(l.vencimento || l.data || l.dataCompra || l.createdAt || '').startsWith(mesAnoSelecionado)) &&
        (servicoFiltroVal === 'todos' || (l.tipo === 'saida' && l.servicoEssencial === servicoFiltroVal) || (l.tipo === 'entrada' && servicoFiltroVal !== 'sim'))
    );

    let entSamuel = 0, saiSamuel = 0, entMariana = 0, saiMariana = 0;
    lancamentosPeriodo.forEach(l => {
        const valor = Number(l.valor);
        if (Number(l.usuarioId) === 1) l.tipo === 'entrada' ? entSamuel += valor : saiSamuel += valor;
        else if (Number(l.usuarioId) === 2) l.tipo === 'entrada' ? entMariana += valor : saiMariana += valor;
    });

    if (document.getElementById('relatorioEntradaSamuel')) document.getElementById('relatorioEntradaSamuel').innerText = `R$ ${entSamuel.toFixed(2)}`;
    if (document.getElementById('relatorioSaidaSamuel')) document.getElementById('relatorioSaidaSamuel').innerText = `R$ ${saiSamuel.toFixed(2)}`;
    if (document.getElementById('relatorioEntradaMariana')) document.getElementById('relatorioEntradaMariana').innerText = `R$ ${entMariana.toFixed(2)}`;
    if (document.getElementById('relatorioSaidaMariana')) document.getElementById('relatorioSaidaMariana').innerText = `R$ ${saiMariana.toFixed(2)}`;

    const usuarioFiltroGlobal = document.getElementById('filtroUsuarioGraficos')?.value || 'todos';
    let totalEntradasES = 0, totalSaidasES = 0;

    lancamentosPeriodo.forEach(l => {
        if (usuarioFiltroGlobal !== 'todos' && Number(l.usuarioId) !== Number(usuarioFiltroGlobal)) return;
        l.tipo === 'entrada' ? totalEntradasES += Number(l.valor) : totalSaidasES += Number(l.valor);
    });

    const canvasRelES = document.getElementById('graficoRelatorioEntradasSaidas');
    if (canvasRelES) {
        if (chartRelatorioESInstance) chartRelatorioESInstance.destroy();
        chartRelatorioESInstance = new Chart(canvasRelES, {
            type: 'pie',
            data: {
                labels: ['Entradas', 'Saídas'],
                datasets: [{
                    data: (totalEntradasES > 0 || totalSaidasES > 0) ? [totalEntradasES, totalSaidasES] : [1, 1],
                    backgroundColor: (totalEntradasES > 0 || totalSaidasES > 0) ? ['#10b981', '#ef4444'] : ['#cbd5e1', '#cbd5e1'],
                    borderWidth: 1
                }]
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 12 } } } }
        });
    }

    const somatorioCatRel = {};
    lancamentosPeriodo.filter(l => l.tipo === 'saida' && (usuarioFiltroGlobal === 'todos' || Number(l.usuarioId) === Number(usuarioFiltroGlobal)))
        .forEach(l => somatorioCatRel[l.categoriaId] = (somatorioCatRel[l.categoriaId] || 0) + Number(l.valor));

    const labelsCatRel = [], valoresCatRel = [], coresPadraoRel = ['#3b82f6', '#f59e0b', '#10b981', '#8b5cf6', '#ec4899', '#06b6d4', '#64748b', '#ef4444'];
    for (let catId in somatorioCatRel) {
        const catObj = dados.categorias.find(c => Number(c.id) === Number(catId));
        labelsCatRel.push(catObj ? catObj.nome : 'Outros');
        valoresCatRel.push(somatorioCatRel[catId]);
    }

    const canvasRelCat = document.getElementById('graficoRelatorioCategorias');
    if (canvasRelCat) {
        if (chartRelatorioCatInstance) chartRelatorioCatInstance.destroy();
        chartRelatorioCatInstance = new Chart(canvasRelCat, {
            type: 'pie',
            data: {
                labels: valoresCatRel.length > 0 ? labelsCatRel : ['Sem gastos'],
                datasets: [{
                    data: valoresCatRel.length > 0 ? valoresCatRel : [1],
                    backgroundColor: valoresCatRel.length > 0 ? coresPadraoRel.slice(0, valoresCatRel.length) : ['#cbd5e1'],
                    borderWidth: 1
                }]
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 12 } } } }
        });
    }

    let totalEssencialRel = 0, totalNaoEssencialRel = 0;
    lancamentosPeriodo.filter(l => l.tipo === 'saida' && (usuarioFiltroGlobal === 'todos' || Number(l.usuarioId) === Number(usuarioFiltroGlobal)))
        .forEach(l => l.servicoEssencial === 'sim' ? totalEssencialRel += Number(l.valor) : totalNaoEssencialRel += Number(l.valor));

    const canvasServicosRel = document.getElementById('graficoServicosEssenciais');
    if (canvasServicosRel) {
        if (chartServicosEssenciaisRelInstance) chartServicosEssenciaisRelInstance.destroy();
        chartServicosEssenciaisRelInstance = new Chart(canvasServicosRel, {
            type: 'pie',
            data: {
                labels: ['Essenciais', 'Não Essenciais'],
                datasets: [{
                    data: (totalEssencialRel > 0 || totalNaoEssencialRel > 0) ? [totalEssencialRel, totalNaoEssencialRel] : [1],
                    backgroundColor: (totalEssencialRel > 0 || totalNaoEssencialRel > 0) ? ['#10b981', '#f59e0b'] : ['#cbd5e1'],
                    borderWidth: 1
                }]
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 12 } } } }
        });
    }
}

async function alternarStatusFaturaConsolidada(cartaoId, anoMes, statusPago) {
    if (!await exigirPermissao('criarMovimento', 'alterar o status de faturas')) return false;
    if (processandoAcaoModal) return false;

    processandoAcaoModal = true;
    mostrarLoading('Atualizando fatura...');
    try {
        const dados = obterDados();
        const usuarioId = Number(obterUsuarioAtualId(dados));
        const cartao = (dados.cartoes || []).find(c => String(c.id) === String(cartaoId));
        if (!cartao || cartao.ativo === false || cartao.isBeneficio) {
            throw new Error('A fatura precisa pertencer a um cartão de crédito ativo.');
        }
        if (Number(cartao.usuarioId) !== usuarioId) {
            throw new Error('Somente o responsável pelo cartão pode quitar ou reabrir sua fatura.');
        }
        if (!/^\d{4}-\d{2}$/.test(String(anoMes || ''))) {
            throw new Error('Competência da fatura inválida.');
        }

        const itens = (dados.lancamentos || []).filter(l =>
            l.tipo === 'saida' && l.formaPagamento === 'CARTAO' &&
            String(l.cartaoId) === String(cartaoId) &&
            String(l.vencimento || '').startsWith(String(anoMes))
        );
        if (!itens.length) throw new Error('Nenhuma compra foi encontrada nesta fatura.');
        if (itens.some(l => !usuarioPodeAlterarLancamento(l, dados))) {
            throw new Error('A fatura contém movimentações que não podem ser alteradas por este usuário. Nenhum status foi modificado.');
        }

        const hoje = dataLocalYYYYMMDD();
        const agora = new Date().toISOString();
        itens.forEach(l => {
            l.pago = Boolean(statusPago);
            l.status = statusPago ? 'pago' : (l.vencimento && l.vencimento < hoje ? 'atrasado' : 'pendente');
            l.dataPagamento = statusPago ? hoje : null;
            l.usuarioPagamentoId = statusPago ? usuarioId : null;
            l.updatedAt = agora;
        });

        registrarLogInterno(dados, 'STATUS FATURA', `Fatura do cartão ${cartao.nome} (${anoMes}) marcada como ${statusPago ? 'PAGA' : 'PENDENTE'}`);
        await salvarDados(dados);
        if (typeof carregarRelatorios === 'function') carregarRelatorios();
        if (typeof carregarDashboard === 'function') carregarDashboard();
        return true;
    } catch (erro) {
        console.error('Falha ao atualizar fatura:', erro);
        await mostrarAlertaModal(erro.message || 'Não foi possível atualizar a fatura.');
        return false;
    } finally {
        esconderLoading();
        processandoAcaoModal = false;
    }
}

function abrirDetalhamentoFatura(cartaoId, anoMes) {
    const dados = obterDados();
    const cartao = dados.cartoes.find(c => Number(c.id) === Number(cartaoId));
    const nomeCartao = cartao ? cartao.nome : 'Cartão';

    const itensDaFatura = dados.lancamentos.filter(l => Number(l.cartaoId) === Number(cartaoId) && l.vencimento && l.vencimento.startsWith(anoMes));

    let linhasHtml = '';
    if (itensDaFatura.length === 0) {
        linhasHtml = `<tr><td colspan="4" style="text-align: center;">Nenhuma compra encontrada nesta fatura.</td></tr>`;
    } else {
        itensDaFatura.forEach(item => {
            const parcela = Number(item.totalParcelas) > 1
                ? `${escaparHTML(item.parcelaAtual)}/${escaparHTML(item.totalParcelas)}`
                : 'À vista';
            linhasHtml += `
                <tr>
                    <td>${escaparHTML(item.descricao || '-')}</td>
                    <td style="text-align: center;">${parcela}</td>
                    <td style="text-align: right;">${escaparHTML(formatarMoeda(item.valor))}</td>
                    <td style="text-align: center;">${escaparHTML(formatarDataBR(item.vencimento))}</td>
                </tr>
            `;
        });
    }

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
        <div class="modal-box" style="max-width: 800px; width: 95%;">
            <h3>Detalhamento da Fatura: ${escaparHTML(nomeCartao)}</h3>
            <p style="margin-bottom: 14px; font-size: 0.9rem;">Competência: ${escaparHTML(anoMes)}</p>
            <div class="tabela-container" style="max-height: 400px; overflow-y: auto; overflow-x: hidden; margin-bottom: 20px;">
                <table class="tabela" style="width: 100%;">
                    <thead>
                        <tr><th>Descrição</th><th style="text-align: center; width: 100px;">Parcela</th><th style="text-align: right; width: 120px;">Valor</th><th style="text-align: center; width: 140px;">Vencimento</th></tr>
                    </thead>
                    <tbody>${linhasHtml}</tbody>
                </table>
            </div>
            <button onclick="this.closest('.modal-overlay').remove()" style="width: 100%; background-color: var(--primary);">Fechar</button>
        </div>
    `;
    document.body.appendChild(overlay);
}

function abrirDetalhamentoParcelamento(lancamentoId, paginaAtual = 1) {
    const dados = obterDados();
    const lancamento = (dados.lancamentos || []).find(l => Number(l.id) === Number(lancamentoId));
    if (!lancamento) return;

    const chaveGrupo = resolverParcelamentoId(lancamento);
    const financiamentoId = resolverFinanciamentoIdPorLancamento(lancamento, dados);
    let parcelasGrupo;
    if (chaveGrupo) {
        parcelasGrupo = (dados.lancamentos || []).filter(l => String(l.parcelamentoId) === String(chaveGrupo));
    } else if (financiamentoId != null) {
        parcelasGrupo = (dados.lancamentos || []).filter(l => String(resolverFinanciamentoIdPorLancamento(l, dados)) === String(financiamentoId));
    } else {
        // A descrição não é uma chave segura: podem existir compras diferentes com o mesmo nome.
        parcelasGrupo = [lancamento];
    }

    parcelasGrupo.sort((a, b) => String(a.vencimento || '').localeCompare(String(b.vencimento || '')));

    const itensPorPagina = 30;
    const totalParcelas = parcelasGrupo.length || Number(lancamento.totalParcelas) || 1;
    const totalPaginas = Math.ceil(totalParcelas / itensPorPagina);
    const paginaSegura = Math.max(1, Math.min(paginaAtual, totalPaginas));

    const inicio = (paginaSegura - 1) * itensPorPagina;
    const fim = inicio + itensPorPagina;
    const parcelasPagina = parcelasGrupo.slice(inicio, fim);

    const lancamentoIdSeguro = Number(lancamento.id);
    const valorParcela = Number(lancamento.valor || 0);
    const valorTotalCompra = parcelasGrupo.reduce((acc, p) => acc + Number(p.valor || 0), 0);
    
    const usuarioObj = (dados.usuarios || []).find(u => Number(u.id) === Number(lancamento.usuarioId));
    const nomeResponsavel = usuarioObj ? usuarioObj.nome : 'Usuário';

    let infoFormaPagamento = '';
    if (lancamento.formaPagamento === 'CARTAO') {
        const cartaoObj = (dados.cartoes || []).find(c => String(c.id) === String(lancamento.cartaoId));
        infoFormaPagamento = `Cartão Utilizado: ${escaparHTML(cartaoObj ? cartaoObj.nome : 'Crédito')}`;
    } else if (lancamento.formaPagamento === 'BOLETO') {
        infoFormaPagamento = `Forma de Pagamento: Boleto / Conta`;
    } else if (lancamento.formaPagamento === 'FIXO') {
        infoFormaPagamento = `Forma de Pagamento: Conta fixa / mensal`;
    } else {
        infoFormaPagamento = `Forma de Pagamento: ${escaparHTML(lancamento.formaPagamento || 'Não informada')}`;
    }

    let linhasTabelaHtml = '';
    parcelasPagina.forEach((p, idx) => {
        linhasTabelaHtml += `
            <tr>
                <td style="text-align: center;">${inicio + idx + 1}/${totalParcelas}</td>
                <td>${escaparHTML(formatarDataBR(p.vencimento))}</td>
                <td style="text-align: right;">${escaparHTML(formatarMoeda(p.valor))}</td>
                <td style="text-align: center;"><span class="status-badge ${p.pago ? 'status-pago' : 'status-pendente'}">${p.pago ? 'Pago' : 'Pendente'}</span></td>
            </tr>
        `;
    });

    let paginacaoHtml = '';
    if (totalPaginas > 1) {
        paginacaoHtml = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin: 15px 0; gap: 10px;">
                <button type="button" class="btn-secundario" ${paginaSegura === 1 ? 'disabled style="opacity: 0.5;"' : ''} onclick="abrirDetalhamentoParcelamento(${lancamentoIdSeguro}, ${paginaSegura - 1})">← Anterior</button>
                <span style="font-size: 0.85rem; font-weight: bold;">Página ${paginaSegura} de ${totalPaginas}</span>
                <button type="button" class="btn-secundario" ${paginaSegura === totalPaginas ? 'disabled style="opacity: 0.5;"' : ''} onclick="abrirDetalhamentoParcelamento(${lancamentoIdSeguro}, ${paginaSegura + 1})">Próxima →</button>
            </div>
        `;
    }

    document.querySelectorAll('.modal-overlay-detalhe-parcelas').forEach(el => el.remove());

    const htmlDetalhes = `
        <div style="text-align: left; display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; font-size: 0.9rem;">
            <p><strong>Descrição:</strong> ${escaparHTML(descricaoBaseParcelamento(lancamento.descricao))}</p>
            <p><strong>Valor Total:</strong> R$ ${valorTotalCompra.toLocaleString('pt-BR', {minimumFractionDigits: 2})} (${totalParcelas}x de R$ ${valorParcela.toFixed(2)})</p>
            <p><strong>${infoFormaPagamento}</strong> | <strong>Responsável:</strong> ${escaparHTML(nomeResponsavel)}</p>
        </div>
        <h4 style="margin: 10px 0 6px 0; font-size: 0.95rem; text-align: left;">Parcelas do Período (${inicio + 1} a ${Math.min(fim, totalParcelas)} de ${totalParcelas}):</h4>
        ${paginacaoHtml}
        <div class="tabela-container" style="max-height: 240px; overflow-y: auto; border: 1px solid var(--border); border-radius: 8px;">
            <table class="tabela" style="width: 100%; font-size: 0.85rem;">
                <thead><tr><th style="text-align: center;">Parcela</th><th>Vencimento</th><th style="text-align: right;">Valor</th><th style="text-align: center;">Status</th></tr></thead>
                <tbody>${linhasTabelaHtml}</tbody>
            </table>
        </div>
        ${paginacaoHtml}
        <div class="modal-buttons modal-buttons-center" style="margin-top: 15px;">
            <button type="button" data-fechar style="background-color: var(--primary); width: 100%;">Fechar</button>
        </div>
    `;

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay modal-overlay-detalhe-parcelas';
    overlay.innerHTML = `<div class="modal-box" style="max-width: 650px; width: 95%;"><h3>Detalhes do Financiamento / Parcelamento</h3>${htmlDetalhes}</div>`;
    document.body.appendChild(overlay);

    overlay.querySelector('[data-fechar]').onclick = () => fecharModal(overlay);
    overlay.addEventListener('click', e => { if (e.target === overlay) fecharModal(overlay); });
}

async function mostrarOpcaoEscopoModal(mensagem) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="modal-box" style="text-align: center;">
                <h3>Ação em Lote / Parcelamento</h3>
                <p style="margin: 15px 0; text-align: center;">${escaparHTML(mensagem)}</p>
                <div class="modal-buttons" style="flex-direction: column; gap: 8px;">
                    <button id="btnApenasEsta" style="background-color: #3b82f6; width: 100%; margin: 0;">Apenas esta parcela</button>
                    <button id="btnTodas" style="background-color: #f59e0b; width: 100%; margin: 0;">Todas as parcelas</button>
                    <button id="btnCancelarEscopo" style="background-color: #64748b; width: 100%; margin: 0;">Cancelar</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        document.getElementById('btnApenasEsta').onclick = () => { overlay.remove(); resolve('esta'); };
        document.getElementById('btnTodas').onclick = () => { overlay.remove(); resolve('todas'); };
        document.getElementById('btnCancelarEscopo').onclick = () => { overlay.remove(); resolve(null); };
    });
}

// Consolidado de RemoverLancamento
async function removerLancamentoInteligente(id) {
    if (!await exigirPermissao('excluirMovimento', 'excluir lançamentos')) return false;
    const dados = obterDados();
    const lanc = (dados.lancamentos || []).find(l => String(l.id) === String(id));
    if (!lanc) {
        await mostrarAlertaModal('Lançamento não encontrado.');
        return false;
    }
    if (!usuarioPodeAlterarLancamento(lanc, dados)) {
        await mostrarAlertaModal('Você não tem permissão para excluir este lançamento.');
        return false;
    }

    const grupoParcelamentoId = resolverParcelamentoId(lanc);
    const financiamentoId = resolverFinanciamentoIdPorLancamento(lanc, dados);
    const ehParceladoOuLote = Boolean(grupoParcelamentoId) || Boolean(financiamentoId);

    let escopo = 'esta';
    if (ehParceladoOuLote) {
        escopo = await mostrarOpcaoEscopoModal(`Este lançamento possui ${lanc.totalParcelas || 'vários'} registros associados. Deseja excluir apenas esta parcela ou todas?`);
        if (!escopo) return false;
    }

    const motivo = await mostrarPromptTextoModal("Justificativa Obrigatória", "Informe o motivo da exclusão:");
    if (!motivo) return false;

    mostrarLoading("Processando exclusão...");
    const usuarioId = localStorage.getItem('usuarioLogado');
    const u = dados.usuarios.find(user => user.id == usuarioId);
    const nomeUsuario = u ? u.nome : "Desconhecido";
    const dataHoraAtual = new Date().toLocaleString('pt-BR');

    if (escopo === 'esta') {
        dados.exclusao_movimento.push({
            id: gerarId('exc'), dataHora: dataHoraAtual, usuario: nomeUsuario,
            usuarioId: Number(usuarioId), lancamentoId: id,
            descricao: lanc.descricao, valor: lanc.valor, motivo: motivo
        });

        dados.lancamentos = dados.lancamentos.filter(l => Number(l.id) !== Number(id));
        registrarLogInterno(dados, "EXCLUSÃO LANÇAMENTO", `Lançamento ID ${id} (${lanc.descricao}) excluído. Motivo: ${motivo}`);
    } else if (escopo === 'todas') {
        const descricaoBase = descricaoBaseParcelamento(lanc.descricao);
        const relacionados = grupoParcelamentoId
            ? dados.lancamentos.filter(l => String(l.parcelamentoId) === String(grupoParcelamentoId))
            : dados.lancamentos.filter(l => String(resolverFinanciamentoIdPorLancamento(l, dados)) === String(financiamentoId));

        relacionados.forEach(l => {
            dados.exclusao_movimento.push({
                id: gerarId('exc'), dataHora: dataHoraAtual, usuario: nomeUsuario, usuarioId: Number(usuarioId),
                lancamentoId: l.id, descricao: l.descricao, valor: l.valor, motivo: `[LOTE] ${motivo}`
            });
        });

        const idsRelacionados = new Set(relacionados.map(l => String(l.id)));
        dados.lancamentos = dados.lancamentos.filter(l => !idsRelacionados.has(String(l.id)));
        registrarLogInterno(dados, "EXCLUSÃO LOTE", `Todas as parcelas de "${descricaoBase}" foram excluídas. Motivo: ${motivo}`);
    }

    await salvarDados(dados);
    esconderLoading();
    await mostrarAlertaModal("Exclusão realizada com sucesso!");
    if (typeof carregarDashboard === 'function') carregarDashboard();
    if (typeof carregarRelatorios === 'function') carregarRelatorios();
    if (typeof carregarCentralPagamentos === 'function') carregarCentralPagamentos();
    return true;
}

function verificarCategoriaSalario() {
    const selectCat = document.getElementById('categoriaLancamento');
    const tipoSelect = document.getElementById('tipoLancamento');
    if (!selectCat || !tipoSelect || tipoSelect.value !== 'entrada') return;

    const dados = obterDados();
    const catSelecionada = dados.categorias.find(c => String(c.id) === String(selectCat.value));
    if (catSelecionada && normalizarTexto(catSelecionada.nome).includes('adiantamento')) carregarEPreencherAdiantamentoMemorizado();
}

function carregarEPreencherAdiantamentoMemorizado() {
    const inputValor = document.getElementById('valorTotalLancamento') || document.getElementById('valorTotal') || document.getElementById('valorLancamento');
    const inputData = document.getElementById('vencimentoLancamento') || document.getElementById('vencimento');
    const usuarioId = localStorage.getItem('usuarioLogado');
    const chaveMemoria = `adiantamentoSalario_u${usuarioId}`;
    const salvoStr = localStorage.getItem(chaveMemoria);

    if (salvoStr) {
        try {
            const salvo = JSON.parse(salvoStr);
            if (inputValor && salvo?.valor != null) inputValor.value = salvo.valor;
        } catch (erro) {
            console.warn('Não foi possível ler a memória do adiantamento:', erro);
            localStorage.removeItem(chaveMemoria);
        }
    }

    if (inputData && inputData.value) {
        const partes = inputData.value.split('-');
        if (partes.length === 3) { partes[2] = '15'; inputData.value = partes.join('-'); }
    }
}

function salvarMemoriaAdiantamentoSeNecessario(descricao, valor) {
    const selectCat = document.getElementById('categoriaLancamento');
    const dados = obterDados();
    if (!selectCat) return;

    const catSelecionada = dados.categorias.find(c => Number(c.id) === Number(selectCat.value));
    if (catSelecionada && catSelecionada.nome.toLowerCase().includes('adiantamento')) {
        const usuarioId = localStorage.getItem('usuarioLogado');
        localStorage.setItem(`adiantamentoSalario_u${usuarioId}`, JSON.stringify({ descricao, valor }));
    }
}

function renderizarSinoNotificacoes() {
    const sinoBtn = document.getElementById('btnNotificacoesHeader');
    if (!sinoBtn) return;

    const dados = obterDados();
    const usuarioId = localStorage.getItem('usuarioLogado');
    const naoLidas = (dados.notificacoes || []).filter(n => Number(n.usuarioDestinoId) === Number(usuarioId) && !n.lida).length;
    const imagemIcone = naoLidas > 0 ? 'imagens/notific1.png' : 'imagens/notific.png';

    sinoBtn.title = naoLidas > 0 ? `Você tem ${naoLidas} nova(s) notificação(ões)` : 'Central de Notificações';
    sinoBtn.style.position = 'relative';

    sinoBtn.innerHTML = `
        <img src="${imagemIcone}" alt="Notificações" style="width: 22px; height: 22px; object-fit: contain;" onerror="this.style.display='none'">
        ${naoLidas > 0 ? `<span style="position: absolute; top: 2px; right: 2px; background: var(--danger); color: #fff; font-size: 0.6rem; padding: 1px 4px; border-radius: 50%; font-weight: bold;">${naoLidas}</span>` : ''}
    `;

    sinoBtn.onclick = () => abrirCentralNotificacoes();
}

async function abrirCentralNotificacoes() {
    const dados = obterDados();
    const usuarioId = localStorage.getItem('usuarioLogado');
    const notificacoes = (dados.notificacoes || []).filter(n => Number(n.usuarioDestinoId) === Number(usuarioId));

    const haviaNaoLidas = notificacoes.some(n => !n.lida);
    if (haviaNaoLidas) {
        notificacoes.forEach(n => { n.lida = true; });
        // O estado de leitura faz parte dos dados compartilhados e precisa chegar ao servidor.
        await salvarDados(dados);
    }

    let itensHtml = '';
    if (notificacoes.length === 0) {
        itensHtml = `<p style="text-align: center; color: var(--text-muted); padding: 20px;">Nenhuma notificação no momento.</p>`;
    } else {
        notificacoes.reverse().forEach(n => {
            let acoesHtml = '';
            if (n.tipo === 'solicitacao_parceiro' && n.statusAprovacao === 'pendente') {
                const idSeguro = String(n.id == null ? '' : n.id).replace(/[^a-zA-Z0-9_-]/g, '');
                acoesHtml = idSeguro ? `
                    <div style="margin-top: 8px; display: flex; gap: 8px;">
                        <button onclick="responderSolicitacaoParceiro('${idSeguro}', true)" style="background: var(--success); padding: 6px 12px; font-size: 0.8rem;">Aprovar</button>
                        <button onclick="responderSolicitacaoParceiro('${idSeguro}', false)" style="background: var(--danger); padding: 6px 12px; font-size: 0.8rem;">Negar</button>
                    </div>
                ` : '';
            } else if (n.statusAprovacao && n.statusAprovacao !== 'pendente') {
                acoesHtml = `<p style="font-size: 0.78rem; font-weight: bold; margin-top: 4px; color: ${n.statusAprovacao === 'aprovado' ? 'var(--success)' : 'var(--danger)'};">Status: ${n.statusAprovacao.toUpperCase()}</p>`;
            }

            itensHtml += `
                <div style="background: var(--surface-2); padding: 12px; border-radius: 8px; margin-bottom: 8px; text-align: left; border-left: 4px solid var(--primary);">
                    <strong style="font-size: 0.9rem; color: var(--text-main);">${escaparHTML(n.titulo || '')}</strong>
                    <p style="font-size: 0.85rem; margin-top: 4px; color: var(--text-muted);">${escaparHTML(n.mensagem || '')}</p>
                    <small style="font-size: 0.7rem; color: var(--text-muted);">${n.createdAt ? escaparHTML(new Date(n.createdAt).toLocaleString('pt-BR')) : ''}</small>
                    ${acoesHtml}
                </div>
            `;
        });
    }

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
        <div class="modal-box" style="max-width: 500px; width: 95%;">
            <h3>Central de Notificações</h3>
            <div style="max-height: 350px; overflow-y: auto; margin: 16px 0; padding-right: 4px;">${itensHtml}</div>
            <button onclick="this.closest('.modal-overlay').remove(); window.location.reload();" style="width: 100%; background-color: var(--primary);">Fechar</button>
        </div>
    `;
    document.body.appendChild(overlay);
}

async function responderSolicitacaoParceiro(notificacaoId, aprovado) {
    const dados = obterDados();
    const notif = (dados.notificacoes || []).find(n => String(n.id) === String(notificacaoId));
    if (!notif) return;

    notif.statusAprovacao = aprovado ? 'aprovado' : 'negado';
    const usuarioDestino = dados.usuarios.find(u => Number(u.id) === Number(notif.usuarioDestinoId));
    const remetente = dados.usuarios.find(u => Number(u.id) === Number(notif.remetenteId));

    if (aprovado && usuarioDestino && remetente) {
        usuarioDestino.parceiroId = remetente.id;
        remetente.parceiroId = usuarioDestino.id;

        dados.notificacoes.push({
            id: gerarId('notif'), usuarioDestinoId: remetente.id, remetenteId: usuarioDestino.id,
            tipo: 'resposta_parceiro', titulo: 'Parceiro Aprovado! 🤝', mensagem: `${usuarioDestino.nome} aprovou o seu atrelamento como parceiro no sistema.`,
            lida: false, statusAprovacao: 'aprovado', createdAt: new Date().toISOString()
        });
    }

    registrarLogInterno(dados, "PARCEIRO", `Solicitação de parceiro ${aprovado ? 'aprovada' : 'negada'} entre usuários.`);
    await salvarDados(dados);
    await mostrarAlertaModal(aprovado ? "Parceiro atrelado com sucesso!" : "Solicitação negada.");
    document.querySelector('.modal-overlay')?.remove();
    abrirCentralNotificacoes();
}

async function abrirModalPrimeiroAcesso() {
    const { overlay } = criarModalBase({
        titulo: 'Primeiro Acesso - Cadastro',
        mensagem: 'Cadastre suas informações para começar a usar o sistema.',
        htmlExtra: `
            <div style="margin-top: 15px; display: flex; flex-direction: column; gap: 12px; text-align: left;">
                <div>
                    <label style="font-size: 0.85rem; font-weight: bold; color: var(--text-main);">Nome de Usuário (Login):</label>
                    <input type="text" class="modal-input" id="regUsuario" placeholder="Ex: samuel" autocomplete="off" style="min-height: 44px;">
                </div>
                <div>
                    <label style="font-size: 0.85rem; font-weight: bold; color: var(--text-main);">Nome Completo:</label>
                    <input type="text" class="modal-input" id="regNome" placeholder="Ex: Samuel Silva" autocomplete="off" style="min-height: 44px;">
                </div>
                <div>
                    <label style="font-size: 0.85rem; font-weight: bold; color: var(--text-main);">Senha Inicial:</label>
                    <input type="password" class="modal-input" id="regSenha" placeholder="Mín 8 caracteres, letras, números e especial" autocomplete="off" style="min-height: 44px;">
                </div>
            </div>
            <div class="modal-buttons" style="margin-top: 20px;">
                <button type="button" class="btn-secundario" data-cancelar>Cancelar</button>
                <button type="button" data-confirmar>Cadastrar</button>
            </div>
        `
    });

    const inputUsuario = overlay.querySelector('#regUsuario');
    const inputNome = overlay.querySelector('#regNome');
    const inputSenha = overlay.querySelector('#regSenha');

    setTimeout(() => inputUsuario?.focus(), 0);
    overlay.querySelector('[data-cancelar]').onclick = () => fecharModal(overlay);

    overlay.querySelector('[data-confirmar]').onclick = async () => {
        const usuario = inputUsuario.value.trim();
        const nome = inputNome.value.trim();
        const senha = inputSenha.value.trim();

        if (!usuario || !nome || !senha) { await mostrarAlertaModal('Preencha todos os campos para continuar.'); return; }
        if (!validarComplexidadeSenha(senha)) { await mostrarAlertaModal('A senha informada não cumpre os requisitos mínimos. Tente novamente.'); return; }

        const dados = obterDados();
        if (!Array.isArray(dados.usuarios)) dados.usuarios = [];

        const jaExiste = dados.usuarios.some(u => normalizarTexto(u.usuario || u.nome) === normalizarTexto(usuario));
        if (jaExiste) { await mostrarAlertaModal('Este nome de usuário já está cadastrado.'); return; }

        const novoId = dados.usuarios.reduce((max, u) => Math.max(max, Number(u.id) || 0), 0) + 1;
        const hashSenha = await gerarHash(senha);
        const primeiroUsuario = dados.usuarios.length === 0;
        const permissoes = primeiroUsuario
            ? {
                perfil: 'admin',
                paginas: { dashboard: true, relatorios: true, lancamentos: true, cartoes: true, categorias: true, configuracoes: true },
                acoes: { criarMovimento: true, excluirMovimento: true, financiamentos: true, lotes: true, usuarios: true, logs: true }
            }
            : {
                perfil: 'usuario',
                paginas: { dashboard: true, relatorios: true, lancamentos: true, cartoes: true, categorias: true, configuracoes: false },
                acoes: { criarMovimento: false, excluirMovimento: false, financiamentos: false, lotes: false, usuarios: false, logs: false }
            };

        dados.usuarios.push({ id: novoId, usuario, nome, pin: hashSenha, senha: hashSenha, ativo: true, permissoes });

        registrarLogInterno(dados, "CADASTRO USUÁRIO", `Novo usuário cadastrado via Primeiro Acesso: ${nome} (${usuario})`);
        await salvarDados(dados);

        fecharModal(overlay);
        await mostrarAlertaModal('Cadastro realizado com sucesso! Agora você já pode fazer o login.');
    };
}

function redirecionarNovoLancamento(tipoAcao) {
    if (tipoAcao === 'entrada') { window.location.href = 'lancamentos.html?tipo=entrada'; return; }
    if (tipoAcao === 'saida') { window.location.href = 'lancamentos.html?tipo=saida&forma=DINHEIRO'; return; }

    if (tipoAcao === 'cartao') {
        const dados = obterDados();
        const usuarioAtualId = Number(obterUsuarioAtualId(dados));
        const cartoes = (dados.cartoes || []).filter(c => c.ativo !== false && !c.isBeneficio && Number(c.usuarioId) === usuarioAtualId);

        if (!cartoes.length) {
            mostrarAlertaModal('Nenhum cartão ativo cadastrado para o seu usuário. Cadastre um cartão primeiro em Cadastros > Cartões.');
            return;
        }

        const hoje = new Date();
        const diaAtual = hoje.getDate(); 
        let cartaoEscolhido = cartoes[0];

        cartoes.forEach(c => {
            const vencimento = Number(c.diaVencimento || c.vencimento || 1);
            if (vencimento === 13) { if (diaAtual >= 13 && diaAtual <= 25) cartaoEscolhido = c; } 
            else if (vencimento === 26) { if (diaAtual >= 26 || diaAtual <= 12) cartaoEscolhido = c; }
        });

        const cartaoId = cartaoEscolhido ? cartaoEscolhido.id : cartoes[0].id;
        window.location.href = `lancamentos.html?tipo=saida&forma=CARTAO&cartaoId=${cartaoId}`;
    }
}

function renderizarCategorias() {
    const dados = obterDados();
    const lista = document.getElementById('listaCategorias');
    if (!lista) return;
    lista.replaceChildren();

    const filtroSelect = document.getElementById('filtroTipoCategoria');
    const filtroValor = filtroSelect ? filtroSelect.value : 'todos';
    let categoriasPermitidas = dados.categorias || [];
    if (filtroValor !== 'todos') categoriasPermitidas = categoriasPermitidas.filter(c => c.tipo === filtroValor);

    if (categoriasPermitidas.length === 0) {
        const li = document.createElement('li');
        li.textContent = 'Nenhuma categoria encontrada.';
        lista.appendChild(li);
        return;
    }

    const usuarioAtualId = Number(obterUsuarioAtualId(dados));
    categoriasPermitidas.forEach(cat => {
        const nome = String(cat.nome || 'Categoria sem nome');
        const ehPadrao = cat.classificacao === 'padrao' || Number(cat.criadopor) === 5;
        const podeGerenciar = !ehPadrao && Number(cat.criadopor) === usuarioAtualId && usuarioPode('criarMovimento');

        const li = document.createElement('li');
        const descricao = document.createElement('span');
        descricao.append(document.createTextNode(`${nome} (`));
        const tipo = document.createElement('strong');
        tipo.textContent = String(cat.tipo || '').toUpperCase();
        descricao.append(tipo, document.createTextNode(') - '));

        const classificacao = document.createElement('span');
        classificacao.style.cssText = 'font-size:0.75rem; color:var(--text-muted);';
        classificacao.textContent = ehPadrao ? 'Padrão' : (Number(cat.criadopor) === usuarioAtualId ? 'Personalizada' : 'Compartilhada');
        descricao.appendChild(classificacao);

        const acoes = document.createElement('div');
        if (podeGerenciar) {
            const btnEditar = document.createElement('button');
            btnEditar.type = 'button';
            btnEditar.className = 'btn-acao-icone editar';
            btnEditar.title = 'Editar categoria';
            btnEditar.setAttribute('aria-label', `Editar categoria ${nome}`);
            const imgEditar = document.createElement('img');
            imgEditar.src = 'imagens/editar.png';
            imgEditar.alt = 'Editar';
            btnEditar.appendChild(imgEditar);
            btnEditar.addEventListener('click', () => prepararEdicaoCategoria(cat.id, nome, cat.tipo));

            const btnExcluir = document.createElement('button');
            btnExcluir.type = 'button';
            btnExcluir.className = 'btn-acao-icone excluir';
            btnExcluir.title = 'Excluir categoria';
            btnExcluir.setAttribute('aria-label', `Excluir categoria ${nome}`);
            const imgExcluir = document.createElement('img');
            imgExcluir.src = 'imagens/excluir.png';
            imgExcluir.alt = 'Excluir';
            btnExcluir.appendChild(imgExcluir);
            btnExcluir.addEventListener('click', () => excluirCategoriaPrompt(cat.id));

            acoes.append(btnEditar, btnExcluir);
        } else {
            const info = document.createElement('span');
            info.style.cssText = 'font-size:0.75rem; color:var(--text-muted);';
            info.textContent = ehPadrao ? 'Sistema' : 'Somente leitura';
            acoes.appendChild(info);
        }

        li.append(descricao, acoes);
        lista.appendChild(li);
    });
}

function atualizarHeaderUsuario() {
    const usuario = obterUsuarioAtual();
    if (usuario) aplicarPermissoesNavegacao(usuario);
    const spanNome = document.getElementById('usuarioLogadoNome');
    if (spanNome && usuario) spanNome.textContent = `Olá, ${usuario.nome}`;
    if (typeof renderizarSinoNotificacoes === 'function') renderizarSinoNotificacoes();
}

/* =========================================================
   CENTRAL DE LEMBRETES INTELIGENTE
   ========================================================= */

function renderizarCentralLembretes(filtradosMes, dados, mesAnoFiltro) {
    const lista = document.getElementById('listaCentralLembretes');
    const contador = document.getElementById('contadorLembretes');
    if (!lista) return;
    
    lista.innerHTML = '';
    const hojeDataStr = dataLocalYYYYMMDD();
    const faturas = {};
    const lembretes = [];
    
    // 1. Separar contas avulsas de compras em cartão
    filtradosMes.forEach(l => {
        if (l.tipo !== 'saida') return;
        
        if (l.formaPagamento === 'CARTAO' && l.cartaoId) {
            const mesFatura = l.vencimento ? l.vencimento.substring(0, 7) : mesAnoFiltro;
            const chave = `${l.cartaoId}_${mesFatura}`;
            
            if (!faturas[chave]) {
                const cartaoObj = dados.cartoes.find(c => Number(c.id) === Number(l.cartaoId));
                faturas[chave] = {
                    cartaoId: l.cartaoId,
                    cartaoNome: cartaoObj ? cartaoObj.nome : 'Cartão',
                    valorTotal: 0,
                    vencimento: l.vencimento,
                    todosPagos: true,
                    mesAno: mesFatura
                };
            }
            faturas[chave].valorTotal += Number(l.valor || 0);
            if (!l.pago) faturas[chave].todosPagos = false;
            // Pega o vencimento mais distante se houver variações no mesmo mês
            if (l.vencimento > faturas[chave].vencimento) faturas[chave].vencimento = l.vencimento;
            
        } else {
            lembretes.push({
                id: l.id,
                descricao: l.descricao,
                valor: Number(l.valor || 0),
                vencimento: l.vencimento,
                pago: Boolean(l.pago),
                isFatura: false
            });
        }
    });
    
    // 2. Mesclar faturas consolidadas no array principal
    Object.values(faturas).forEach(f => {
        lembretes.push({
            cartaoId: f.cartaoId,
            descricao: `Fatura: ${f.cartaoNome}`,
            valor: f.valorTotal,
            vencimento: f.vencimento,
            pago: f.todosPagos,
            isFatura: true,
            mesAno: f.mesAno
        });
    });
    
    // 3. Regra Mestre de Retenção:
    // Se PENDENTE: Sempre mostra.
    // Se PAGO: Só mostra se a data de vencimento for HOJE ou no FUTURO. (some no dia seguinte ao vencimento)
    const lembretesFiltrados = lembretes.filter(item => {
        if (!item.pago) return true;
        if (!item.vencimento) return false; 
        return item.vencimento >= hojeDataStr;
    });
    
    // 4. Ordenar do mais urgente para o mais distante
    lembretesFiltrados.sort((a, b) => {
        const da = a.vencimento || '9999-99-99';
        const db = b.vencimento || '9999-99-99';
        return da.localeCompare(db);
    });
    
    // Atualiza o Badge contador no topo do card
    if (contador) {
        const pendentesCount = lembretesFiltrados.filter(l => !l.pago).length;
        if (pendentesCount > 0) {
            contador.style.display = 'inline-flex';
            contador.textContent = pendentesCount;
        } else {
            contador.style.display = 'none';
        }
    }
    
    // Fallback vazio
    if (lembretesFiltrados.length === 0) {
        lista.innerHTML = `<li><span class="muted" style="width: 100%; text-align: center; display: block; padding: 10px 0;">Nenhum pagamento pendente no radar. 🎉</span></li>`;
        return;
    }
    
    // 5. Renderizar
    let html = '';
    lembretesFiltrados.forEach(item => {
        const statusStr = item.pago ? 'Pago' : (item.vencimento < hojeDataStr ? 'Atrasado' : 'Pendente');
        const statusClass = item.pago ? 'status-pago' : (item.vencimento < hojeDataStr ? 'status-atrasado' : 'status-pendente');
        
        // Elementos Dinâmicos Baseados no Status
        const btnColorClass = item.pago ? 'desfazer' : 'pagar';
        const titleAcao = item.pago ? 'Desmarcar pagamento' : 'Marcar como pago';
        const imgBtn = item.pago ? 'imagens/desfazer.png' : 'imagens/pagar.png';
        const opacidade = item.pago ? '0.55' : '1';
        const tachado = item.pago ? 'text-decoration: line-through;' : '';
        
        // Direcionamento da ação (Lançamento solto x Fatura de Cartão)
        const cartaoIdSeguro = Number(item.cartaoId);
        const lancamentoIdSeguro = Number(item.id);
        const mesAnoSeguro = /^\d{4}-\d{2}$/.test(String(item.mesAno || '')) ? String(item.mesAno) : '';
        let acaoClick = item.isFatura && Number.isFinite(cartaoIdSeguro) && mesAnoSeguro
            ? `onclick="toggleFaturaDaCentral(${cartaoIdSeguro}, '${mesAnoSeguro}', ${!item.pago})"`
            : Number.isFinite(lancamentoIdSeguro) ? `onclick="alternarStatusPagamento(${lancamentoIdSeguro})"` : 'disabled';
        
        html += `
            <li style="opacity: ${opacidade}; transition: opacity 0.3s; align-items: center; border-bottom: 1px solid var(--border);">
                <div style="display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 0;">
                    <strong style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; ${tachado}">${escaparHTML(item.descricao)}</strong>
                    <div style="font-size: 0.78rem; color: var(--text-muted);">
                        Vencimento: <strong>${escaparHTML(formatarDataBR(item.vencimento))}</strong>
                    </div>
                </div>
                <div style="display: flex; align-items: center; gap: 14px; flex-shrink: 0;">
                    <span style="font-weight: 850; font-size: 1.1rem; ${tachado}" class="${item.pago ? 'muted' : 'negativo'}">
                        R$ ${item.valor.toLocaleString('pt-BR', {minimumFractionDigits: 2})}
                    </span>
                    <div style="display: flex; flex-direction: column; align-items: center; gap: 6px; min-width: 70px;">
                        <span class="status-badge ${statusClass}">${statusStr}</span>
                    </div>
                    <button ${acaoClick} class="btn-acao-icone ${btnColorClass}" title="${titleAcao}" style="margin: 0; width: 38px; height: 38px;">
                        <img src="${imgBtn}" alt="Ação" style="width: 20px; height: 20px;" onerror="this.style.display='none'; this.parentNode.innerHTML='${item.pago ? '↩' : '✓'}'">
                    </button>
                </div>
            </li>
        `;
    });
    
    lista.innerHTML = html;
}

// Wrapper para sincronizar Fatura com a UI do Dashboard
async function toggleFaturaDaCentral(cartaoId, mesAno, statusPago) {
    await alternarStatusFaturaConsolidada(cartaoId, mesAno, statusPago);
    if (typeof carregarDashboard === 'function') carregarDashboard();
}

// Expansão e retração do card
function toggleCentralLembretes() {
    const corpo = document.getElementById('corpoCentralLembretes');
    const icone = document.getElementById('iconeToggleLembretes');
    if (corpo.style.display === 'none') {
        corpo.style.display = 'block';
        icone.style.transform = 'rotate(0deg)';
    } else {
        corpo.style.display = 'none';
        icone.style.transform = 'rotate(-90deg)';
    }
}