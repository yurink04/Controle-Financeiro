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
const SENHA_ADMIN = "praia2222";
const SCHEMA_VERSION = 2;
const SYNC_DEBOUNCE_MS = 250;

let syncTimer = null;
let syncPendingData = null;
let syncInFlight = false;
let ultimaSincronizacaoStatus = 'idle';
let processandoAcaoModal = false;
let memoriaSistema = null;

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
    document.body.insertAdjacentHTML('afterbegin', headerHTML);
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
    const usuario = dados.usuarios.find(u => Number(u.id) === Number(id));
    if (!usuario) return false;

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
            salvarDados(dados); 
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
    const [ano, mes, dia] = String(dataStr).split('-').map(Number);
    if (!ano || !mes || !dia) return null;
    return new Date(ano, mes - 1, dia);
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

function descricaoBaseParcelamento(descricao = '') {
    return String(descricao).replace(/\s\(\d+\/\d+\)$/, '').trim();
}

function resolverParcelamentoId(lancamento) {
    return lancamento && lancamento.parcelamentoId ? lancamento.parcelamentoId : null;
}

function resolverFinanciamentoIdPorLancamento(lancamento, dados) {
    if (lancamento && lancamento.financiamentoId != null) return lancamento.financiamentoId;
    const descricao = normalizarTexto(lancamento?.descricao || '');
    const candidato = (dados.financiamentos || []).find(f => descricao.includes(normalizarTexto(`Financiamento: ${f.nome}`)));
    return candidato ? candidato.id : null;
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
        if (!cartao.tipoCartao) { cartao.tipoCartao = 'credito'; alterou = true; }
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

    const porFinanciamento = new Map();
    dados.financiamentos.forEach(fin => porFinanciamento.set(normalizarTexto(fin.nome), fin.id));

    dados.lancamentos.forEach(lanc => {
        if (lanc.pago === undefined) { lanc.pago = lanc.status === 'pago'; alterou = true; }
        if (!lanc.status) { lanc.status = lanc.pago ? 'pago' : 'pendente'; alterou = true; }
        if (lanc.horaExtra == null) { lanc.horaExtra = 0; alterou = true; }
        if (!lanc.servicoEssencial) { lanc.servicoEssencial = 'nao'; alterou = true; }
        if (!lanc.escopo) { lanc.escopo = 'casal'; alterou = true; }
        if (!lanc.observacao) lanc.observacao = '';
        if (!lanc.cartaoId && lanc.formaPagamento !== 'CARTAO') lanc.cartaoId = null;

        if (!lanc.parcelamentoId && Number(lanc.totalParcelas) > 1) {
            const base = descricaoBaseParcelamento(lanc.descricao);
            const chave = `${lanc.usuarioId || 0}|${lanc.cartaoId || 0}|${base}|${lanc.totalParcelas}`;
            if (!lanc._legacyParcelamentoChave) { lanc._legacyParcelamentoChave = chave; alterou = true; }
        }

        if (!lanc.financiamentoId && normalizarTexto(lanc.descricao).startsWith('financiamento:')) {
            const nome = normalizarTexto(lanc.descricao).replace(/^financiamento:\s*/, '').replace(/\s\(\d+\/\d+\)$/, '').trim();
            const id = porFinanciamento.get(nome);
            if (id != null) { lanc.financiamentoId = id; alterou = true; }
        }
    });

    const gruposParcelamento = new Map();
    dados.lancamentos.forEach(lanc => {
        if (lanc._legacyParcelamentoChave) {
            if (!gruposParcelamento.has(lanc._legacyParcelamentoChave)) {
                gruposParcelamento.set(lanc._legacyParcelamentoChave, gerarId('parc'));
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
        if (autorizado) {
            atualizarHeaderUsuario();
            if (typeof carregarDashboard === 'function') carregarDashboard();
        }
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
        atualizarIndicadorSyncUI('pending');
        try {
            const json = await buscarDadosServidor(false);
            const resultado = migrarDados(json);
            memoriaSistema = resultado.dados;
            window.revisaoServidorAtual = Number(resultado.dados._revision) || 0;
            localStorage.setItem(DB_KEY, JSON.stringify(memoriaSistema));
            localStorage.removeItem('syncPendente');
            atualizarIndicadorSyncUI('success');
            await mostrarAlertaModal("Dados atualizados com sucesso do banco de dados!");
        } catch (e) {
            atualizarIndicadorSyncUI('error');
            await mostrarAlertaModal("Erro ao atualizar do servidor: " + e.message);
        } finally {
            setTimeout(() => window.location.reload(), 500);
        }
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
        chip.title = "Status: Erro ao sincronizar";
        chip.innerHTML = `<img src="imagens/sincronizar.png" alt="Erro" style="width: 20px; height: 20px; object-fit: contain;">`;
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
    try {
        if (localStorage.getItem('syncPendente') === 'true') {
            const dadosPendentes = localStorage.getItem(DB_KEY);
            if (dadosPendentes) {
                syncPendingData = JSON.parse(dadosPendentes);
                sincronizarComServidor();
            }
        }
        const json = await buscarDadosServidor(false);
        const resultado = migrarDados(json);
        if (!Number.isFinite(Number(resultado.dados._revision))) resultado.dados._revision = json._revision || 0;
        
        memoriaSistema = resultado.dados;
        window.revisaoServidorAtual = resultado.dados._revision;
        localStorage.setItem(DB_KEY, JSON.stringify(memoriaSistema));
        localStorage.removeItem('syncPendente');
    } catch (e) {
        console.warn("Sincronização em segundo plano adiada (modo offline ou instável).", e);
    }
}

async function salvarDados(dados, opcoes = {}) {
    const normalizado = migrarDados(dados).dados;
    if (!Number.isFinite(Number(normalizado._revision))) {
        normalizado._revision = Number(window.revisaoServidorAtual) || 0;
    }

    memoriaSistema = normalizado;
    localStorage.setItem(DB_KEY, JSON.stringify(normalizado));

    if (typeof carregarDashboard === 'function') carregarDashboard();
    if (typeof carregarRelatorios === 'function') carregarRelatorios();
    if (typeof renderizarCategorias === 'function') renderizarCategorias();
    if (typeof carregarCentralPagamentos === 'function') carregarCentralPagamentos();

    if (opcoes.sincronizar !== false) {
        syncPendingData = normalizado;
        localStorage.setItem('syncPendente', 'true');
        atualizarIndicadorSyncUI('pending');
        agendarSincronizacaoSilenciosa();
    }
    return true;
}

async function sincronizarComServidor() {
    if (syncInFlight || !syncPendingData) return;
    syncInFlight = true;
    const payloadDados = syncPendingData;
    syncPendingData = null;

    try {
        const resposta = await fetch(API_URL, {
            method: "POST",
            headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: JSON.stringify({ action: "salvarDados", token: TOKEN_API, dados: payloadDados })
        });

        const json = JSON.parse(await resposta.text());

        if (json.status === 'conflito') {
            console.warn("Conflito detectado. Sincronizando versão do servidor...");
            const dadosServidor = await buscarDadosServidor(false);
            const resultadoServidor = migrarDados(dadosServidor);
            window.revisaoServidorAtual = Number(resultadoServidor.dados._revision) || 0;
            payloadDados._revision = window.revisaoServidorAtual;
            syncPendingData = payloadDados;
            syncInFlight = false;
            sincronizarComServidor();
            return;
        }

        if (json.status !== 'sucesso') throw new Error(json.mensagem || "Erro desconhecido no servidor.");

        localStorage.removeItem('syncPendente');
        if (json._revision !== undefined && memoriaSistema) {
            window.revisaoServidorAtual = json._revision;
            memoriaSistema._revision = json._revision;
            localStorage.setItem(DB_KEY, JSON.stringify(memoriaSistema));
        }

        atualizarIndicadorSyncUI('success');
    } catch (e) {
        console.warn("Sincronização adiada por instabilidade de rede:", e);
        syncPendingData = payloadDados;
        localStorage.setItem('syncPendente', 'true');
        atualizarIndicadorSyncUI('error');
    } finally {
        syncInFlight = false;
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
    syncTimer = setTimeout(sincronizarComServidor, 1500);
}

async function buscarDadosServidor(apenasMovimentos = false) {
    const resposta = await fetch(`${API_URL}?action=obterDados&token=${encodeURIComponent(TOKEN_API)}&apenasMovimentos=${apenasMovimentos}`);
    if (!resposta.ok) throw new Error('Falha de rede ao contatar o servidor.');
    const json = await resposta.json();
    if (json.status === 'erro') throw new Error(json.mensagem || 'Erro desconhecido do servidor.');
    return json;
}

async function registrarLog(acao, detalhes, extras = {}) {
    const dados = obterDados();
    adicionarAuditoriaAoObjeto(dados, acao, detalhes, extras);
    await salvarDados(dados);
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

async function verificarAutenticacao() {
    if (!localStorage.getItem(DB_KEY)) {
        try {
            const json = await buscarDadosServidor(false);
            const resultado = migrarDados(json);
            memoriaSistema = resultado.dados;
            localStorage.setItem(DB_KEY, JSON.stringify(memoriaSistema));
        } catch (e) {
            console.warn("Erro ao carregar dados da sessão:", e);
        }
    }

    const usuarioId = localStorage.getItem('usuarioLogado');
    if (!usuarioId) {
        window.location.href = 'index.html';
        return false;
    }

    const usuario = obterDados().usuarios.find(u => String(u.id) === String(usuarioId));
    if (!usuario) {
        deslogarSistema();
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

async function verificarSenhaAdmin(nomeSecao = "esta seção") {
    const usuario = obterUsuarioAtual();
    if (usuario && normalizarTexto(usuario.nome) === 'teste') return true;
    if (localStorage.getItem('adminAutorizado') === 'true') return true;

    // A correção foi feita adicionando o parâmetro 'false' no final desta chamada
    const senhaDigitada = await mostrarPromptSenha(
        "Acesso restrito", 
        `Área protegida por senha de administrador para ${nomeSecao}.`, 
        false 
    );
    if (senhaDigitada === null) return false;

    if (senhaDigitada === SENHA_ADMIN) {
        const lembrar = await mostrarConfirmacaoModal("Deseja lembrar esta autorização durante a sessão?");
        if (lembrar) localStorage.setItem('adminAutorizado', 'true');
        return true;
    }

    await mostrarAlertaModal('Senha de administrador incorreta!');
    return false;
}

// Consolidado de adicionarCategoria
async function adicionarCategoria(nome, tipo) {
    if (processandoAcaoModal) return false;
    if (!await verificarSenhaAdmin("cadastrar categoria")) return false;
    
    processandoAcaoModal = true;
    mostrarLoading("Cadastrando categoria...");
    const dados = obterDados();
    const nomeNormalizado = normalizarTexto(nome);
    const usuarioAtualId = Number(obterUsuarioAtualId(dados));
    const ID_SISTEMA = 5;

    if (!nomeNormalizado || !['entrada', 'saida'].includes(tipo)) {
        esconderLoading(); processandoAcaoModal = false;
        await mostrarAlertaModal('Dados da categoria inválidos.');
        return false;
    }

    const duplicada = dados.categorias.some(c => {
        const criadorId = Number(c.criadopor);
        const mesmoNomeTipo = c.tipo === tipo && normalizarTexto(c.nome) === nomeNormalizado;
        const pertenceAoContexto = criadorId === ID_SISTEMA || criadorId === usuarioAtualId;
        return mesmoNomeTipo && pertenceAoContexto;
    });

    if (duplicada) {
        esconderLoading(); processandoAcaoModal = false;
        await mostrarAlertaModal('Já existe uma categoria com este nome e tipo.');
        return false;
    }

    const novaId = dados.categorias.reduce((m, c) => Math.max(m, Number(c.id) || 0), 0) + 1;
    dados.categorias.push({ id: novaId, nome: String(nome).trim(), tipo, classificacao: 'personalizado', criadopor: usuarioAtualId });

    registrarLogInterno(dados, "CADASTRO CATEGORIA", `Categoria personalizada criada: ${nome} (${tipo})`);
    await salvarDados(dados);
    
    esconderLoading(); processandoAcaoModal = false;
    await mostrarAlertaModal("Categoria cadastrada com sucesso!");
    if (typeof renderizarCategorias === 'function') renderizarCategorias();
    return true;
}

// Consolidado de atualizarCategoria
async function atualizarCategoria(id, nome, tipo) {
    if (processandoAcaoModal) return false;
    if (!await verificarSenhaAdmin("editar categoria")) return false;

    processandoAcaoModal = true;
    mostrarLoading("Atualizando categoria...");
    try {
        const dados = obterDados();
        const categoria = dados.categorias.find(c => String(c.id) === String(id));
        const nomeNormalizado = normalizarTexto(nome);
        
        if (!categoria || !nomeNormalizado || !['entrada', 'saida'].includes(tipo)) throw new Error('Dados da categoria inválidos.');
        if (categoria.classificacao === 'padrao' || Number(categoria.criadopor) === 5) throw new Error('Categorias padrão do sistema não podem ser alteradas.');

        const duplicada = dados.categorias.some(c => String(c.id) !== String(id) && c.tipo === tipo && normalizarTexto(c.nome) === nomeNormalizado);
        if (duplicada) throw new Error('Já existe outra categoria com este nome e tipo.');

        const tipoAntigo = categoria.tipo;
        categoria.nome = String(nome).trim();
        categoria.tipo = tipo;
        categoria.updatedAt = new Date().toISOString();

        if (tipoAntigo !== tipo) {
            dados.lancamentos.forEach(l => {
                if (String(l.categoriaId) === String(id)) l.updatedAt = new Date().toISOString();
            });
        }

        registrarLogInterno(dados, "EDIÇÃO CATEGORIA", `Categoria ID ${id} alterada para: ${categoria.nome} (${tipo})`);
        await salvarDados(dados);

        esconderLoading(); processandoAcaoModal = false;
        await mostrarAlertaModal("Categoria atualizada com sucesso!");
        if (typeof renderizarCategorias === 'function') renderizarCategorias();
        return true;
    } catch (erro) {
        esconderLoading(); processandoAcaoModal = false;
        await mostrarAlertaModal(erro.message || 'Não foi possível atualizar a categoria.');
        return false;
    }
}

async function excluirCategoria(id) {
    if (processandoAcaoModal) return false;
    if (!await verificarSenhaAdmin("excluir categoria")) return false;
    
    processandoAcaoModal = true;
    mostrarLoading("Excluindo categoria...");
    const dados = obterDados();
    const categoria = dados.categorias.find(c => String(c.id) === String(id));

    if (categoria && (categoria.classificacao === 'padrao' || Number(categoria.criadopor) === 5)) {
        esconderLoading(); processandoAcaoModal = false;
        await mostrarAlertaModal('Categorias padrão do sistema não podem ser excluídas.');
        return false;
    }

    const emUso = dados.lancamentos.some(l => Number(l.categoriaId) === Number(id)) || dados.financiamentos.some(f => Number(f.categoriaId) === Number(id));
    if (emUso) {
        esconderLoading(); processandoAcaoModal = false;
        await mostrarAlertaModal('Esta categoria está vinculada a lançamentos ou financiamentos e não pode ser excluída.');
        return false;
    }

    dados.categorias = dados.categorias.filter(c => String(c.id) !== String(id));
    registrarLogInterno(dados, "EXCLUSÃO CATEGORIA", `Categoria ID ${id} excluída`);
    await salvarDados(dados);
    
    esconderLoading(); processandoAcaoModal = false;
    await mostrarAlertaModal("Categoria excluída com sucesso!");
    if (typeof renderizarCategorias === 'function') renderizarCategorias();
    return true;
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
        const cartoesUsuario = dados.cartoes.filter(c => c.ativo !== false && Number(c.usuarioId) === usuarioAtualId);

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

    verificarCategoriaSalario();
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

    const ehEntrada = tipo === 'entrada';

    if (blocoHE) blocoHE.style.display = ehEntrada ? 'block' : 'none';
    if (blocoFormaPgto) blocoFormaPgto.style.display = ehEntrada ? 'none' : 'block';
    if (blocoEssencial) blocoEssencial.style.display = ehEntrada ? 'none' : 'block';

    if (labelData) labelData.textContent = ehEntrada ? 'Data de recebimento' : 'Data de vencimento / referência';

    if (ehEntrada) {
        if (blocoCartao) blocoCartao.style.display = 'none';
        if (inputHE) inputHE.value = '0';
    } else {
        tratarMudancaFormaPagamento();
    }
}

function tratarMudancaFormaPagamento() {
    const selectForma = document.getElementById('formaPagamento');
    const blocoCartao = document.getElementById('blocoCartao');
    const blocoVencimento = document.getElementById('blocoVencimento');
    const selectStatus = document.getElementById('statusPagamento');

    if (!selectForma) return;

    const usaCartao = selectForma.value === 'CARTAO';
    if (blocoCartao) blocoCartao.style.display = usaCartao ? 'block' : 'none';
    if (blocoVencimento) blocoVencimento.style.display = usaCartao ? 'none' : 'block';

    if (selectStatus) {
        if (usaCartao || selectForma.value === 'BOLETO' || selectForma.value === 'FIXO') selectStatus.value = 'pendente';
        else if (selectForma.value === 'DINHEIRO') selectStatus.value = 'pago';
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

    if (categoriaSelect && categoriaSelect.dataset.controleInicializado !== 'true') {
        categoriaSelect.addEventListener('change', verificarCategoriaSalario);
        categoriaSelect.dataset.controleInicializado = 'true';
    }

    tratarMudancaTipoLancamento();
}

async function adicionarLancamentoComParcelas(dadosForm) {
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
            const bemObj = (dados.bens || []).find(b => String(b.id) === String(dadosForm.bemId));
            if (bemObj && bemObj.compartilhado) escopoFinal = 'casal';
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

        const hojeData = new Date();

        for (let i = 1; i <= qtdGerar; i++) {
            const dataVenc = adicionarMesesClamped(dataBase, i - 1);
            const descricaoParcelada = qtdGerar > 1 ? `${String(dadosForm.descricao).trim()} (${i}/${qtdGerar})` : String(dadosForm.descricao).trim();
            const pagamento = dadosForm.formaPagamento === 'FIXO' ? 'BOLETO' : dadosForm.formaPagamento;
            
            let estaParcelaPaga = false;
            if (dadosForm.tipo === 'entrada') {
                estaParcelaPaga = dadosForm.statusInicial ? (dadosForm.statusInicial === 'pago') : true;
            } else if (dadosForm.formaPagamento === 'CARTAO' && cartaoObj) {
                const anoV = dataVenc.getFullYear();
                const mesV = dataVenc.getMonth(); 
                const diaFechamento = Number(cartaoObj.fechamento || 1);
                const dataFechamentoFatura = new Date(anoV, mesV - 1, diaFechamento);
                estaParcelaPaga = hojeData <= dataFechamentoFatura && (i < qtdGerar); 
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
async function adicionarContaLotePorPeriodo(descricao, valorParcela, dataInicio, qtdMeses, categoriaId, bemId = null) {
    mostrarLoading("Gerando contas em lote...");
    const dados = obterDados();
    const usuarioId = parseInt(localStorage.getItem('usuarioLogado'));
    
    let escopoLote = 'casal';
    if (bemId) {
        const bemObj = (dados.bens || []).find(b => String(b.id) === String(bemId));
        if (bemObj && !bemObj.compartilhado) escopoLote = 'individual';
    }

    let proximaIdLanc = dados.lancamentos.reduce((m, l) => Math.max(m, Number(l.id) || 0), 0) + 1;
    const parcelamentoId = qtdMeses > 1 ? gerarId('lote') : null;

    for (let i = 0; i < qtdMeses; i++) {
        let dataVenc = adicionarMesesClamped(dataInicio, i);
        const anoVenc = dataVenc.getFullYear();
        const mesVenc = String(dataVenc.getMonth() + 1).padStart(2, '0');
        const diaVenc = String(dataVenc.getDate()).padStart(2, '0');
        const dataVencStr = `${anoVenc}-${mesVenc}-${diaVenc}`;

        const mesAnoVenc = `${anoVenc}-${mesVenc}`;
        const mesAnoAtual = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
        const jaPassou = mesAnoVenc < mesAnoAtual;

        dados.lancamentos.push({
            id: proximaIdLanc++, usuarioId, descricao: `${descricao} (${i + 1}/${qtdMeses})`, valor: Number(valorParcela.toFixed(2)),
            tipo: 'saida', categoriaId: Number(categoriaId), formaPagamento: 'BOLETO', cartaoId: null, bemId: bemId ? Number(bemId) : null,
            vencimento: dataVencStr, recorrencia: 'unica', parcelaAtual: i + 1, totalParcelas: qtdMeses, parcelamentoId,
            observacao: 'Gerado por lote retroativo/período', horaExtra: 0, servicoEssencial: 'nao', escopo: escopoLote,
            pago: false, status: jaPassou ? 'atrasado' : 'pendente', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
        });
    }

    registrarLogInterno(dados, "CONTA LOTE PERÍODO", `Lote por período criado: ${descricao} (${qtdMeses} meses)`);
    await salvarDados(dados);
    
    esconderLoading();
    await mostrarAlertaModal("Lotes criados com sucesso!");
    if (typeof carregarRelatorios === 'function') carregarRelatorios();
}

async function adicionarFinanciamentoComRecorrencia(nome, recorrente, valorParcela, qtdMeses, primeiroVencimento, categoriaId = null, bemId = null) {
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

        if (!nomeFinal || valorFinal <= 0 || !dataBase || !catFinalId) throw new Error('Preencha os dados do financiamento corretamente.');

        let escopoFin = 'casal';
        if (bemId) {
            const bemObj = (dados.bens || []).find(b => String(b.id) === String(bemId));
            if (bemObj && !bemObj.compartilhado) escopoFin = 'individual';
        }

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
    const dados = obterDados();
    const lancamento = dados.lancamentos.find(l => Number(l.id) === Number(id));
    if (!lancamento) {
        await mostrarAlertaModal("Lançamento não encontrado.");
        return;
    }

    const grupoParcelamentoId = resolverParcelamentoId(lancamento);
    const financiamentoId = resolverFinanciamentoIdPorLancamento(lancamento, dados);
    const ehVinculado = Boolean(grupoParcelamentoId) || Boolean(financiamentoId) || (lancamento.totalParcelas && lancamento.totalParcelas > 1);

    let aplicarParaTodas = false;
    if (ehVinculado) {
        const escolha = await mostrarOpcaoEscopoModal("Este lançamento faz parte de um financiamento ou compra parcelada. Deseja tornar essa modificação para todas outras parcelas?");
        if (escolha === null) return; 
        aplicarParaTodas = (escolha === 'todas');
    }

    const motivo = await mostrarPromptTextoModal("Justificativa Obrigatória", "Informe o motivo da edição deste lançamento:");
    if (!motivo) return;

    mostrarLoading("Atualizando lançamento(s)...");

    const usuarioId = localStorage.getItem('usuarioLogado');
    const u = dados.usuarios.find(user => Number(user.id) === Number(usuarioId));
    const nomeUsuario = u ? u.nome : "Desconhecido";
    const dataHoraAtual = new Date().toLocaleString('pt-BR');

    if (aplicarParaTodas) {
        const relacionados = financiamentoId 
            ? dados.lancamentos.filter(l => Number(l.financiamentoId) === Number(financiamentoId))
            : dados.lancamentos.filter(l => String(l.parcelamentoId) === String(grupoParcelamentoId));

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
            l.observacao = novosDados.observacao;
            l.servicoEssencial = novosDados.tipo === 'saida' ? (novosDados.servicoEssencial || 'nao') : 'nao';
            l.escopo = novosDados.tipo === 'saida' ? (novosDados.escopo || 'casal') : 'casal';
            l.updatedAt = new Date().toISOString();

            if (novosDados.formaPagamento === 'CARTAO') l.cartaoId = novosDados.cartaoId || l.cartaoId || null;

            dados.edicao_movimento.push({
                dataHora: dataHoraAtual, usuario: nomeUsuario, lancamentoId: l.id,
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

        if (novosDados.formaPagamento === 'CARTAO') {
            lancamento.cartaoId = novosDados.cartaoId || lancamento.cartaoId || null;
            lancamento.dataCompra = novosDados.dataCompra || lancamento.dataCompra || null;
        }
        lancamento.servicoEssencial = novosDados.tipo === 'saida' ? (novosDados.servicoEssencial || 'nao') : 'nao';
        lancamento.escopo = novosDados.tipo === 'saida' ? (novosDados.escopo || 'casal') : 'casal';

        dados.edicao_movimento.push({
            dataHora: dataHoraAtual, usuario: nomeUsuario, lancamentoId: id,
            descricaoAntiga, descricaoNova: novosDados.descricao, valorAntigo, valorNovo: novosDados.valor, motivo
        });

        registrarLogInterno(dados, "EDIÇÃO LANÇAMENTO", `Lançamento ID ${id} atualizado. Motivo: ${motivo}`);
    }

    await salvarDados(dados);
    esconderLoading();
    await mostrarAlertaModal("Lançamento(s) atualizado(s) com sucesso!");
    
    if (typeof carregarDashboard === 'function') carregarDashboard();
    if (typeof carregarRelatorios === 'function') carregarRelatorios();
}

async function excluirFinanciamento(id) {
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

        const parcelas = dados.lancamentos.filter(l => String(l.financiamentoId) === String(id) || (l.tipo === 'saida' && normalizarTexto(l.descricao).includes(normalizarTexto(`Financiamento: ${fin.nome}`))));

        parcelas.forEach(l => {
            if (!Array.isArray(dados.exclusao_movimento)) dados.exclusao_movimento = [];
            const usuario = obterUsuarioAtual(dados);
            dados.exclusao_movimento.push({
                id: gerarId('exc'), dataHora: new Date().toLocaleString('pt-BR'), usuario: usuario ? usuario.nome : 'Desconhecido',
                lancamentoId: l.id, descricao: l.descricao, valor: l.valor, motivo: '[FINANCIAMENTO] Exclusão do contrato'
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
    if (processandoAcaoModal) return false;
    processandoAcaoModal = true;
    mostrarLoading("Atualizando status...");
    try {
        const dados = obterDados();
        const lancamento = dados.lancamentos.find(l => String(l.id) === String(id));
        if (!lancamento) throw new Error('Lançamento não encontrado.');

        const novoPago = !Boolean(lancamento.pago);
        lancamento.pago = novoPago;
        lancamento.status = novoPago ? 'pago' : (lancamento.vencimento && lancamento.vencimento < dataLocalYYYYMMDD() ? 'atrasado' : 'pendente');
        lancamento.dataPagamento = novoPago ? dataLocalYYYYMMDD() : null;
        lancamento.usuarioPagamentoId = novoPago ? obterUsuarioAtualId(dados) : null;
        lancamento.updatedAt = new Date().toISOString();

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

async function salvarFinanciamentoForm(event) {
    event.preventDefault();
    const nome = document.getElementById('nomeFinanciamento')?.value?.trim();
    const valorParcela = numeroSeguro(document.getElementById('valorParcelaFin')?.value);
    const qtdMeses = inteiroSeguro(document.getElementById('qtdMesesFin')?.value, 1);
    const categoriaId = document.getElementById('categoriaFinanciamento')?.value || null;
    const primeiroVencimento = document.getElementById('primeiroVencimentoFin')?.value;

    const sucesso = await adicionarFinanciamentoComRecorrencia(nome, 'sim', valorParcela, qtdMeses, primeiroVencimento, categoriaId);

    if (sucesso) {
        document.getElementById('formFinanciamento')?.reset();
        const campo = document.getElementById('primeiroVencimentoFin');
        if (campo) campo.value = dataLocalYYYYMMDD();
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
    filtrados.forEach(l => { l.tipo === 'entrada' ? totalEntradas += Number(l.valor || 0) : totalSaidas += Number(l.valor || 0); });

    const elTotalEntradas = document.getElementById('totalEntradas');
    if (elTotalEntradas) elTotalEntradas.textContent = `R$ ${totalEntradas.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`;
    
    const elTotalSaidas = document.getElementById('totalSaidas');
    if (elTotalSaidas) elTotalSaidas.textContent = `R$ ${totalSaidas.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`;
    
    const elSaldo = document.getElementById('saldoGeral');
    if (elSaldo) {
        elSaldo.textContent = `R$ ${(totalEntradas - totalSaidas).toLocaleString('pt-BR', {minimumFractionDigits: 2})}`;
        elSaldo.className = `stat-value ${(totalEntradas - totalSaidas) >= 0 ? 'positivo' : 'negativo'}`;
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
                tbodyLanc.innerHTML += `
                    <tr>
                        <td>${l.usuario || 'Sistema'}</td>
                        <td><strong>${l.descricao}</strong></td>
                        <td>${catObj.nome}</td>
                        <td>${formatarDataBR(l.dataPagamento)}</td>
                        <td>${formatarDataBR(l.vencimento)}</td>
                        <td class="${l.tipo === 'entrada' ? 'positivo' : 'negativo'}">R$ ${Number(l.valor || 0).toLocaleString('pt-BR', {minimumFractionDigits: 2})}</td>
                        <td>
                            <button onclick="window.location.href='editar-lancamento.html?id=${l.id}'" class="btn-acao-icone editar" title="Editar"><img src="imagens/editar.png" alt="Editar"></button>
                            <button onclick="removerLancamentoInteligente(${l.id})" class="btn-acao-icone excluir" title="Excluir"><img src="imagens/excluir.png" alt="Excluir"></button>
                        </td>
                    </tr>
                `;
            });
        }
    }
    atualizarGraficosDashboard(totalEntradas, totalSaidas, dados);
}

function atualizarGraficosDashboard(totalEntradas, totalSaidas, dados) {
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
    const categoriaSelecionadaId = document.getElementById('filtroCategoriaDashboard')?.value || 'todas';
    const lancamentosPermitidos = filtrarDadosPorPermissao(dados.lancamentos || [], dados, escopoAtual);

    const lancamentosPeriodo = lancamentosPermitidos.filter(l => 
        l.tipo === 'saida' && (!mesAnoSelecionado || !l.vencimento || l.vencimento.startsWith(mesAnoSelecionado)) &&
        (categoriaSelecionadaId === 'todas' || Number(l.categoriaId) === Number(categoriaSelecionadaId))
    );

    const somatorioPorCategoria = {};
    lancamentosPeriodo.forEach(l => somatorioPorCategoria[l.categoriaId] = (somatorioPorCategoria[l.categoriaId] || 0) + Number(l.valor));

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

    let totalEssencial = 0, totalNaoEssencial = 0;
    lancamentosPeriodo.forEach(l => l.servicoEssencial === 'sim' ? totalEssencial += Number(l.valor) : totalNaoEssencial += Number(l.valor));

    const canvasServicos = document.getElementById('graficoServicosEssenciais');
    if (canvasServicos) {
        if (chartServicosEssenciaisInstance) chartServicosEssenciaisInstance.destroy();
        chartServicosEssenciaisInstance = new Chart(canvasServicos, {
            type: 'pie',
            data: {
                labels: ['Essenciais', 'Não Essenciais'],
                datasets: [{
                    data: (totalEssencial > 0 || totalNaoEssencial > 0) ? [totalEssencial, totalNaoEssencial] : [1],
                    backgroundColor: (totalEssencial > 0 || totalNaoEssencial > 0) ? ['#10b981', '#f59e0b'] : ['#cbd5e1'],
                    borderWidth: 1
                }]
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 12 } } } }
        });
    }

    const selectFiltroCartao = document.getElementById('filtroGraficoCartao');
    const cartoesUsuario = filtrarDadosPorPermissao(dados.cartoes || [], dados, escopoAtual).filter(c => c.ativo !== false);
    
    if (selectFiltroCartao) {
        const valorAtual = selectFiltroCartao.value;
        selectFiltroCartao.innerHTML = '<option value="todos">Todos</option>';
        cartoesUsuario.forEach(c => {
            selectFiltroCartao.innerHTML += `<option value="${c.id}">${c.nome}</option>`;
        });
        if (valorAtual) selectFiltroCartao.value = valorAtual;
    }

    const cartaoSelecionadoId = selectFiltroCartao ? selectFiltroCartao.value : 'todos';
    let totalLimiteGeral = 0, totalUsadoGeral = 0;

    cartoesUsuario.forEach(cartao => {
        if (cartaoSelecionadoId === 'todos' || Number(cartao.id) === Number(cartaoSelecionadoId)) {
            totalUsadoGeral += lancamentosPermitidos.filter(l => Number(l.cartaoId) === Number(cartao.id) && !l.pago).reduce((acc, l) => acc + Number(l.valor), 0);
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
    const dados = obterDados();
    const mesAnoSelecionado = document.getElementById('filtroMesAnoRelatorio')?.value || '';
    const servicoFiltroVal = document.getElementById('filtroServicoEssencialDashboard')?.value || 'todos';

    const lancamentosPeriodo = dados.lancamentos.filter(l => 
        (!mesAnoSelecionado || !l.vencimento || l.vencimento.startsWith(mesAnoSelecionado)) &&
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
    mostrarLoading("Atualizando fatura...");
    const dados = obterDados();
    dados.lancamentos.forEach(l => {
        if (Number(l.cartaoId) === Number(cartaoId) && l.vencimento && l.vencimento.startsWith(anoMes)) {
            l.pago = statusPago;
            l.status = statusPago ? 'pago' : 'pendente';
            l.dataPagamento = statusPago ? dataLocalYYYYMMDD() : null;
            l.usuarioPagamentoId = statusPago ? obterUsuarioAtualId(dados) : null;
            l.updatedAt = new Date().toISOString();
        }
    });
    registrarLogInterno(dados, "STATUS FATURA", `Fatura do cartão ID ${cartaoId} (${anoMes}) marcada como ${statusPago ? 'PAGA' : 'PENDENTE'}`);
    await salvarDados(dados);
    esconderLoading();
    carregarRelatorios();
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
            linhasHtml += `
                <tr>
                    <td>${item.descricao}</td>
                    <td style="text-align: center;">${item.totalParcelas > 1 ? `${item.parcelaAtual}/${item.totalParcelas}` : 'À vista'}</td>
                    <td style="text-align: right;">R$ ${Number(item.valor).toFixed(2)}</td>
                    <td style="text-align: center;">${item.vencimento}</td>
                </tr>
            `;
        });
    }

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
        <div class="modal-box" style="max-width: 800px; width: 95%;">
            <h3>Detalhamento da Fatura: ${nomeCartao}</h3>
            <p style="margin-bottom: 14px; font-size: 0.9rem;">Competência: ${anoMes}</p>
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

    const chaveGrupo = lancamento.parcelamentoId || descricaoBaseParcelamento(lancamento.descricao);
    const parcelasGrupo = (dados.lancamentos || []).filter(l => (lancamento.parcelamentoId && l.parcelamentoId === lancamento.parcelamentoId) || (!lancamento.parcelamentoId && descricaoBaseParcelamento(l.descricao) === chaveGrupo));

    parcelasGrupo.sort((a, b) => new Date(a.vencimento) - new Date(b.vencimento));

    const itensPorPagina = 30;
    const totalParcelas = parcelasGrupo.length || Number(lancamento.totalParcelas) || 1;
    const totalPaginas = Math.ceil(totalParcelas / itensPorPagina);
    const paginaSegura = Math.max(1, Math.min(paginaAtual, totalPaginas));

    const inicio = (paginaSegura - 1) * itensPorPagina;
    const fim = inicio + itensPorPagina;
    const parcelasPagina = parcelasGrupo.slice(inicio, fim);

    const valorParcela = Number(lancamento.valor || 0);
    const valorTotalCompra = parcelasGrupo.reduce((acc, p) => acc + Number(p.valor || 0), 0);
    
    const usuarioObj = (dados.usuarios || []).find(u => Number(u.id) === Number(lancamento.usuarioId));
    const nomeResponsavel = usuarioObj ? usuarioObj.nome : 'Usuário';

    let infoFormaPagamento = '';
    if (lancamento.formaPagamento === 'CARTAO') {
        const cartaoObj = (dados.cartoes || []).find(c => String(c.id) === String(lancamento.cartaoId));
        infoFormaPagamento = `Cartão Utilizado: ${cartaoObj ? cartaoObj.nome : 'Crédito'}`;
    } else if (lancamento.formaPagamento === 'BOLETO') {
        infoFormaPagamento = `Forma de Pagamento: Boleto / Conta`;
    } else if (lancamento.formaPagamento === 'FIXO') {
        infoFormaPagamento = `Forma de Pagamento: Conta fixa / mensal`;
    } else {
        infoFormaPagamento = `Forma de Pagamento: ${lancamento.formaPagamento || 'Não informada'}`;
    }

    let linhasTabelaHtml = '';
    parcelasPagina.forEach((p, idx) => {
        linhasTabelaHtml += `
            <tr>
                <td style="text-align: center;">${inicio + idx + 1}/${totalParcelas}</td>
                <td>${formatarDataBR(p.vencimento)}</td>
                <td style="text-align: right;">R$ ${Number(p.valor || 0).toFixed(2)}</td>
                <td style="text-align: center;"><span class="status-badge ${p.pago ? 'status-pago' : 'status-pendente'}">${p.pago ? 'Pago' : 'Pendente'}</span></td>
            </tr>
        `;
    });

    let paginacaoHtml = '';
    if (totalPaginas > 1) {
        paginacaoHtml = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin: 15px 0; gap: 10px;">
                <button type="button" class="btn-secundario" ${paginaSegura === 1 ? 'disabled style="opacity: 0.5;"' : ''} onclick="abrirDetalhamentoParcelamento(${lancamentoId}, ${paginaSegura - 1})">← Anterior</button>
                <span style="font-size: 0.85rem; font-weight: bold;">Página ${paginaSegura} de ${totalPaginas}</span>
                <button type="button" class="btn-secundario" ${paginaSegura === totalPaginas ? 'disabled style="opacity: 0.5;"' : ''} onclick="abrirDetalhamentoParcelamento(${lancamentoId}, ${paginaSegura + 1})">Próxima →</button>
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
                <p style="margin: 15px 0; text-align: center;">${mensagem}</p>
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
    const dados = obterDados();
    const lanc = dados.lancamentos.find(l => Number(l.id) === Number(id));
    if (!lanc) return;

    const grupoParcelamentoId = resolverParcelamentoId(lanc);
    const ehParceladoOuLote = Boolean(grupoParcelamentoId) || (lanc.totalParcelas && lanc.totalParcelas > 1);

    let escopo = 'esta';
    if (ehParceladoOuLote) {
        escopo = await mostrarOpcaoEscopoModal(`Este lançamento possui ${lanc.totalParcelas || 'vários'} registros associados. Deseja excluir apenas esta parcela ou todas?`);
        if (!escopo) return;
    }

    const motivo = await mostrarPromptTextoModal("Justificativa Obrigatória", "Informe o motivo da exclusão:");
    if (!motivo) return;

    mostrarLoading("Processando exclusão...");
    const usuarioId = localStorage.getItem('usuarioLogado');
    const u = dados.usuarios.find(user => user.id == usuarioId);
    const nomeUsuario = u ? u.nome : "Desconhecido";
    const dataHoraAtual = new Date().toLocaleString('pt-BR');

    if (escopo === 'esta') {
        dados.exclusao_movimento.push({
            dataHora: dataHoraAtual, usuario: nomeUsuario, lancamentoId: id,
            descricao: lanc.descricao, valor: lanc.valor, motivo: motivo
        });

        dados.lancamentos = dados.lancamentos.filter(l => Number(l.id) !== Number(id));
        registrarLogInterno(dados, "EXCLUSÃO LANÇAMENTO", `Lançamento ID ${id} (${lanc.descricao}) excluído. Motivo: ${motivo}`);
    } else if (escopo === 'todas') {
        const descricaoBase = descricaoBaseParcelamento(lanc.descricao);
        const relacionados = grupoParcelamentoId
            ? dados.lancamentos.filter(l => String(l.parcelamentoId) === String(grupoParcelamentoId))
            : dados.lancamentos.filter(l => descricaoBaseParcelamento(l.descricao) === descricaoBase);

        relacionados.forEach(l => {
            dados.exclusao_movimento.push({
                id: gerarId('exc'), dataHora: dataHoraAtual, usuario: nomeUsuario,
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
}

async function adicionarSalarioFracionado(descricaoBase, valorTotalSalario, categoriaId, dataReferencia) {
    if (processandoAcaoModal) return;
    processandoAcaoModal = true;
    mostrarLoading("Cadastrando salário fracionado...");

    const dados = obterDados();
    const usuarioId = parseInt(localStorage.getItem('usuarioLogado'));
    let proximaId = dados.lancamentos.reduce((m, l) => Math.max(m, Number(l.id) || 0), 0) + 1;

    const [ano, mes, _] = dataReferencia.split('-').map(Number);
    const valorAdiantamento = Number((valorTotalSalario * 0.40).toFixed(2));
    const dataDia15 = `${ano}-${String(mes).padStart(2, '0')}-15`;
    const valorRestante = Number((valorTotalSalario - valorAdiantamento).toFixed(2));
    const ultimoDiaMes = new Date(ano, mes, 0).getDate();
    const dataFimMes = `${ano}-${String(mes).padStart(2, '0')}-${String(ultimoDiaMes).padStart(2, '0')}`;

    const entradasSalario = [
        {
            id: proximaId++, usuarioId, descricao: `${descricaoBase} (Adiantamento 40%)`, valor: valorAdiantamento,
            tipo: 'entrada', categoriaId: Number(categoriaId), formaPagamento: 'BOLETO', cartaoId: null,
            vencimento: dataDia15, recorrencia: 'mensal', parcelaAtual: 1, totalParcelas: 1,
            observacao: 'Gerado automaticamente', horaExtra: 0, servicoEssencial: 'nao', pago: true
        },
        {
            id: proximaId++, usuarioId, descricao: `${descricaoBase} (Restante 60%)`, valor: valorRestante,
            tipo: 'entrada', categoriaId: Number(categoriaId), formaPagamento: 'BOLETO', cartaoId: null,
            vencimento: dataFimMes, recorrencia: 'mensal', parcelaAtual: 1, totalParcelas: 1,
            observacao: 'Gerado automaticamente', horaExtra: 0, servicoEssencial: 'nao', pago: true
        }
    ];

    dados.lancamentos.push(...entradasSalario);
    registrarLogInterno(dados, "SALÁRIO FRACIONADO", `Adiantamento e saldo cadastrados para ${descricaoBase}: R$ ${valorTotalSalario}`);
    await salvarDados(dados);

    esconderLoading(); processandoAcaoModal = false;
    await mostrarAlertaModal("Salário fracionado cadastrado com sucesso (Dia 15 e Final do Mês)!");
    if (typeof carregarDashboard === 'function') carregarDashboard();
    if (typeof carregarRelatorios === 'function') carregarRelatorios();
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

function abrirCentralNotificacoes() {
    const dados = obterDados();
    const usuarioId = localStorage.getItem('usuarioLogado');
    const notificacoes = (dados.notificacoes || []).filter(n => Number(n.usuarioDestinoId) === Number(usuarioId));

    notificacoes.forEach(n => n.lida = true);
    salvarDados(dados, { sincronizar: false });

    let itensHtml = '';
    if (notificacoes.length === 0) {
        itensHtml = `<p style="text-align: center; color: var(--text-muted); padding: 20px;">Nenhuma notificação no momento.</p>`;
    } else {
        notificacoes.reverse().forEach(n => {
            let acoesHtml = '';
            if (n.tipo === 'solicitacao_parceiro' && n.statusAprovacao === 'pendente') {
                acoesHtml = `
                    <div style="margin-top: 8px; display: flex; gap: 8px;">
                        <button onclick="responderSolicitacaoParceiro('${n.id}', true)" style="background: var(--success); padding: 6px 12px; font-size: 0.8rem;">Aprovar</button>
                        <button onclick="responderSolicitacaoParceiro('${n.id}', false)" style="background: var(--danger); padding: 6px 12px; font-size: 0.8rem;">Negar</button>
                    </div>
                `;
            } else if (n.statusAprovacao && n.statusAprovacao !== 'pendente') {
                acoesHtml = `<p style="font-size: 0.78rem; font-weight: bold; margin-top: 4px; color: ${n.statusAprovacao === 'aprovado' ? 'var(--success)' : 'var(--danger)'};">Status: ${n.statusAprovacao.toUpperCase()}</p>`;
            }

            itensHtml += `
                <div style="background: var(--surface-2); padding: 12px; border-radius: 8px; margin-bottom: 8px; text-align: left; border-left: 4px solid var(--primary);">
                    <strong style="font-size: 0.9rem; color: var(--text-main);">${n.titulo}</strong>
                    <p style="font-size: 0.85rem; margin-top: 4px; color: var(--text-muted);">${n.mensagem}</p>
                    <small style="font-size: 0.7rem; color: var(--text-muted);">${n.createdAt ? new Date(n.createdAt).toLocaleString('pt-BR') : ''}</small>
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

        dados.usuarios.push({ id: novoId, usuario, nome, pin: hashSenha, senha: hashSenha, ativo: true });

        registrarLogInterno(dados, "CADASTRO USUÁRIO", `Novo usuário cadastrado via Primeiro Acesso: ${nome} (${usuario})`);
        await salvarDados(dados);

        fecharModal(overlay);
        await mostrarAlertaModal('Cadastro realizado com sucesso! Agora você já pode fazer o login.');
    };
}

function calcularStatusParcelaCartao(dataVencimentoStr, cartaoObj, dataCompraStr) {
    if (!cartaoObj || !cartaoObj.fechamento) return 'pendente';
    
    const hoje = new Date();
    const [anoVenc, mesVenc, diaVenc] = String(dataVencimentoStr).split('-').map(Number);
    const dataFechamento = new Date(anoVenc, mesVenc - 1, Number(cartaoObj.fechamento));
    dataFechamento.setMonth(dataFechamento.getMonth() - 1);

    if (hoje > dataFechamento) return 'pendente';
    return 'pago';
}

function redirecionarNovoLancamento(tipoAcao) {
    if (tipoAcao === 'entrada') { window.location.href = 'lancamentos.html?tipo=entrada'; return; }
    if (tipoAcao === 'saida') { window.location.href = 'lancamentos.html?tipo=saida&forma=DINHEIRO'; return; }

    if (tipoAcao === 'cartao') {
        const dados = obterDados();
        const usuarioAtualId = Number(obterUsuarioAtualId(dados));
        const cartoes = (dados.cartoes || []).filter(c => c.ativo !== false && Number(c.usuarioId) === usuarioAtualId);

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
    lista.innerHTML = '';
    
    const filtroSelect = document.getElementById('filtroTipoCategoria');
    const filtroValor = filtroSelect ? filtroSelect.value : 'todos';

    let categoriasPermitidas = dados.categorias || [];
    if (filtroValor !== 'todos') categoriasPermitidas = categoriasPermitidas.filter(c => c.tipo === filtroValor);

    if (categoriasPermitidas.length === 0) {
        lista.innerHTML = '<li>Nenhuma categoria encontrada.</li>';
        return;
    }

    const nomesPadrao = ["alimentação", "moradia / contas", "salário", "financiamentos", "lazer", "transporte", "internet", "energia/luz", "carro", "pet"];

    categoriasPermitidas.forEach(cat => {
        const nomeLower = String(cat.nome || '').trim().toLowerCase();
        const ehPadrao = nomesPadrao.includes(nomeLower);

        const li = document.createElement('li');
        li.innerHTML = `
            <span>${cat.nome} (<strong>${cat.tipo.toUpperCase()}</strong>) - <span style="font-size:0.75rem; color:var(--text-muted);">${ehPadrao ? 'Padrão' : 'Personalizada'}</span></span>
            <div>
                ${!ehPadrao ? `
                    <button onclick="prepararEdicaoCategoria(${cat.id}, '${cat.nome}', '${cat.tipo}')" class="btn-acao-icone editar" title="Editar"><img src="imagens/editar.png" alt="Editar"></button>
                    <button onclick="excluirCategoriaPrompt(${cat.id})" class="btn-acao-icone excluir" title="Excluir"><img src="imagens/excluir.png" alt="Excluir"></button>
                ` : `<span style="font-size: 0.75rem; color: var(--text-muted);">Sistema</span>`}
            </div>
        `;
        lista.appendChild(li);
    });
}

function atualizarHeaderUsuario() {
    const usuario = obterUsuarioAtual();
    const spanNome = document.getElementById('usuarioLogadoNome');
    if (spanNome && usuario) spanNome.textContent = `Olá, ${usuario.nome}`;
    if (typeof renderizarSinoNotificacoes === 'function') renderizarSinoNotificacoes();
}