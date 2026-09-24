const DB_KEY = 'sistemaFinanceiroCompartilhado';
const BACKUP_TESTE_KEY = 'sistemaFinanceiroBackupTeste';
const API_URL = "https://script.google.com/macros/s/AKfycbzRyMczLpCP6ad9nplv6wFXy7NfGFU9NKUlQT3CbT_C4RAMVLHgGeuhjCL_K2yPmkRn/exec";
const TOKEN_API = "PLANOF1NALPRAS4AIRD@MERDA";
const SENHA_ADMIN = "praia2222";
const SCHEMA_VERSION = 2;
const SYNC_DEBOUNCE_MS = 250;
let syncTimer = null;
let syncPendingData = null;
let syncInFlight = false;
let ultimaSincronizacaoStatus = 'idle';

let chartEntradasSaidasInstance = null;
let chartGastosCategoriasInstance = null;
let chartCartoesLimiteInstance = null;
let chartRelatorioESInstance = null;
let chartRelatorioCatInstance = null;
let chartServicosEssenciaisInstance = null;

let processandoAcaoModal = false;


function filtrarDadosPorPermissao(lista, dadosGlobais, escopoFiltro = 'casal') {
    const usuarioAtualId = Number(localStorage.getItem('usuarioLogado'));
    const usuarioAtual = (dadosGlobais.usuarios || []).find(u => Number(u.id) === usuarioAtualId);
    
    if (!usuarioAtual) return [];

    const parceiroId = usuarioAtual.parceiroId ? Number(usuarioAtual.parceiroId) : null;

    return (lista || []).filter(item => {
        const donoId = Number(item.usuarioId);
        
        if (!item.usuarioId) return true;

        if (escopoFiltro === 'individual') {
            return donoId === usuarioAtualId;
        }

        if (donoId === usuarioAtualId || (parceiroId && donoId === parceiroId)) {
            return true;
        }

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
    // Mínimo de 8 caracteres, pelo menos uma letra maiúscula, uma minúscula, um número e um caractere especial
    const regex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[\W_]).{8,}$/;
    return regex.test(String(senha || ''));
}

async function selecionarUsuario(id) {
    const dados = obterDados();
    const usuario = dados.usuarios.find(u => Number(u.id) === Number(id));
    if (!usuario) return false;

    const senhaAtual = String(usuario.pin || usuario.senha || "").trim();
    
    // Se não tiver palavra-passe cadastrada, exige o cadastro seguro com 2 campos
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

        usuario.pin = novaSenha;
        usuario.senha = novaSenha;
        registrarLogInterno(dados, "CADASTRO SENHA INICIAL", `Utilizador ${usuario.nome} cadastrou a palavra-passe inicial.`);
        await salvarDados(dados);
        await mostrarAlertaModal("Palavra-passe cadastrada com sucesso!");
    } else {
        // Se já tem palavra-passe, faz a verificação normal exigindo apenas 1 campo
        const senhaDigitada = await mostrarPromptSenha(
            "Verificação de Palavra-passe",
            `Digite a palavra-passe de acesso para ${usuario.nome}:`,
            false
        );
        if (senhaDigitada === null || senhaDigitada !== senhaAtual) {
            await mostrarAlertaModal("Palavra-passe incorreta.");
            return false;
        }
    }

    mostrarLoading("A entrar no sistema...");
    localStorage.setItem('usuarioLogado', String(usuario.id));
    // Ao iniciar uma nova sessão, os valores voltam a ficar ocultos por padrão
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
    const partes = String(dataStr).split('-');
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

function definirDiaSeguro(ano, mesZeroBased, dia) {
    const ultimoDia = new Date(ano, mesZeroBased + 1, 0).getDate();
    return Math.min(Math.max(1, inteiroSeguro(dia, 1)), ultimoDia);
}

function dividirValorExato(valor, quantidade) {
    const qtd = Math.max(1, inteiroSeguro(quantidade, 1));
    const totalCentavos = paraCentavos(valor);
    const base = Math.floor(totalCentavos / qtd);
    const resto = totalCentavos % qtd;
    return Array.from({ length: qtd }, (_, index) =>
        deCentavos(base + (index < resto ? 1 : 0))
    );
}

function normalizarTexto(texto) {
    return String(texto || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toLowerCase();
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
    if (lancamento && lancamento.parcelamentoId) return lancamento.parcelamentoId;
    return null;
}

function resolverFinanciamentoIdPorLancamento(lancamento, dados) {
    if (lancamento && lancamento.financiamentoId != null) return lancamento.financiamentoId;
    const descricao = normalizarTexto(lancamento?.descricao || '');
    const candidato = (dados.financiamentos || []).find(f =>
        descricao.includes(normalizarTexto(`Financiamento: ${f.nome}`))
    );
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
    dados.financiamentos.forEach(fin => {
        porFinanciamento.set(normalizarTexto(fin.nome), fin.id);
    });

    dados.lancamentos.forEach(lanc => {
        if (lanc.pago === undefined) {
            lanc.pago = lanc.status === 'pago';
            alterou = true;
        }
        if (!lanc.status) {
            lanc.status = lanc.pago ? 'pago' : 'pendente';
            alterou = true;
        }
        if (lanc.horaExtra == null) { lanc.horaExtra = 0; alterou = true; }
        if (!lanc.servicoEssencial) { lanc.servicoEssencial = 'nao'; alterou = true; }
        
        // >>> AJUSTE AQUI: garante que lançamentos antigos tenham o escopo padrão 'casal' <<<
        if (!lanc.escopo) { lanc.escopo = 'casal'; alterou = true; }

        if (!lanc.observacao) lanc.observacao = '';
        if (!lanc.cartaoId && lanc.formaPagamento !== 'CARTAO') lanc.cartaoId = null;

        if (!lanc.parcelamentoId && Number(lanc.totalParcelas) > 1) {
            const base = descricaoBaseParcelamento(lanc.descricao);
            const chave = `${lanc.usuarioId || 0}|${lanc.cartaoId || 0}|${base}|${lanc.totalParcelas}`;
            if (!lanc._legacyParcelamentoChave) {
                lanc._legacyParcelamentoChave = chave;
                alterou = true;
            }
        }

        if (!lanc.financiamentoId && normalizarTexto(lanc.descricao).startsWith('financiamento:')) {
            const nome = normalizarTexto(lanc.descricao)
                .replace(/^financiamento:\s*/, '')
                .replace(/\s\(\d+\/\d+\)$/, '')
                .trim();
            const id = porFinanciamento.get(nome);
            if (id != null) {
                lanc.financiamentoId = id;
                alterou = true;
            }
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

    if (dados._schemaVersion !== SCHEMA_VERSION) {
        dados._schemaVersion = SCHEMA_VERSION;
        alterou = true;
    }

    return { dados, alterou };
}

document.addEventListener("DOMContentLoaded", () => {
    inicializarTemaVisual();
    inicializarPrivacidade(); // já aplica/remova a classe com base no que foi salvo em localStorage
    criarIndicadorSincronizacaoUi();
});

function inicializarPrivacidade() {
    const privacidade = localStorage.getItem('privacidadeAtiva');
    // Se for o primeiro acesso, o padrão será "true" (escondido) para maior privacidade
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
    const temaSalvo = localStorage.getItem('temaSistema') || 'claro';
    if (temaSalvo === 'escuro') {
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
    // Reaproveita o ícone de sincronização que já existe no HTML de cada página
    // (#syncStatusIcon), em vez de criar um segundo ícone ao lado dele.
    const chip = document.getElementById('syncStatusIcon');
    if (!chip || chip.dataset.syncWired === 'true') return;
    chip.dataset.syncWired = 'true';

    chip.title = "Status: Sincronizado. Clique para verificar novamente.";
    chip.style.cssText = `
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 4px;
        padding: 0 8px;
        height: 34px;
        border-radius: 9px;
        background: var(--success-soft);
        border: 1px solid color-mix(in srgb, var(--success) 26%, var(--border));
        color: var(--success);
        font-size: 1.1rem;
        cursor: pointer;
        margin-left: 8px;
        transition: var(--transition-fast);
    `;
    chip.innerHTML = '☁';

    chip.onclick = async () => {
        chip.style.transform = 'scale(0.9)';
        setTimeout(() => chip.style.transform = 'scale(1)', 150);
        
        atualizarIndicadorSyncUI('pending');
        
        try {
            if (syncPendingData) {
                await sincronizarComServidor();
            } else {
                const dados = obterDados();
                await salvarDados(dados, { sincronizar: true });
            }
            atualizarIndicadorSyncUI('success');
        } catch (e) {
            atualizarIndicadorSyncUI('error');
        } finally {
            // Recarrega a página após a tentativa de sincronização manual
            setTimeout(() => {
                window.location.reload();
            }, 800);
        }
    };

    const userChip = document.getElementById('usuarioLogadoNome');
    if (userChip && userChip.parentNode) {
        userChip.parentNode.style.display = 'flex';
        userChip.parentNode.style.alignItems = 'center';
        userChip.parentNode.style.flexWrap = 'nowrap';
    }
}

function atualizarIndicadorSyncUI(status) {
    const chip = document.getElementById('syncStatusIcon');
    if (!chip) return;
    
    if (status === 'pending') {
        chip.style.color = 'var(--warning)';
        chip.style.backgroundColor = 'var(--warning-soft)';
        chip.style.borderColor = 'color-mix(in srgb, var(--warning) 26%, var(--border))';
        chip.title = "Status: Sincronizando...";
        chip.innerHTML = `<img src="imagens/loading.gif" alt="Carregando" style="width: 16px; height: 16px; object-fit: contain;">`;
    } else if (status === 'success') {
        chip.style.color = 'var(--success)';
        chip.style.backgroundColor = 'var(--success-soft)';
        chip.style.borderColor = 'color-mix(in srgb, var(--success) 26%, var(--border))';
        chip.title = "Status: Sincronizado com sucesso";
        chip.innerHTML = `☁ <span style="font-size: 0.85rem; font-weight: bold; margin-left: 2px;">✓</span>`;
    } else if (status === 'error') {
        chip.style.color = 'var(--danger)';
        chip.style.backgroundColor = 'var(--danger-soft)';
        chip.style.borderColor = 'color-mix(in srgb, var(--danger) 26%, var(--border))';
        chip.title = "Status: Erro ao sincronizar";
        chip.innerHTML = `☁ <span style="font-size: 0.85rem; font-weight: bold; margin-left: 2px;">✕</span>`;
    }
}

function mostrarLoading(mensagem = "Salvando alterações...") {
    if (document.getElementById('loadingOverlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'loadingOverlay';
    overlay.className = 'modal-overlay';
    overlay.style.zIndex = '99999';
    overlay.innerHTML = `
        <div class="modal-box" style="text-align: center; padding: 30px;">
            <div style="border: 4px solid var(--border); border-top: 4px solid var(--primary); border-radius: 50%; width: 40px; height: 40px; animation: spin 1s linear infinite; margin: 0 auto 15px auto;"></div>
            <p style="font-weight: bold; font-size: 1rem; color: var(--text);">${mensagem}</p>
        </div>
        <style>
            @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        </style>
    `;
    document.body.appendChild(overlay);
}

function esconderLoading() {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) overlay.remove();
}

async function inicializarBanco() {
    const bruto = localStorage.getItem(DB_KEY);
    let dados;

    if (bruto) {
        try {
            dados = JSON.parse(bruto);
        } catch (_) {
            dados = null;
        }
    }

    if (!dados) {
        dados = {
            _schemaVersion: SCHEMA_VERSION,
            usuarios: [
                { id: 1, nome: "Samuel", senha: "" },
                { id: 2, nome: "Mariana", senha: "" },
                { id: 3, nome: "TESTE", senha: "" }
            ],
            categorias: [
                { id: 1, nome: "Alimentação", tipo: "saida" },
                { id: 2, nome: "Moradia / Contas", tipo: "saida" },
                { id: 3, nome: "Salário", tipo: "entrada" },
                { id: 4, nome: "Financiamentos", tipo: "saida" }
            ],
            cartoes: [],
            lancamentos: [],
            financiamentos: [],
            bens: [],
            notificacoes: [],
            logs: [],
            exclusao_movimento: [],
            edicao_movimento: []
        };
        localStorage.setItem(DB_KEY, JSON.stringify(dados));
        memoriaSistema = dados;
        return;
    }

    const resultado = migrarDados(dados);
    memoriaSistema = resultado.dados;
    if (resultado.alterou) {
        localStorage.setItem(DB_KEY, JSON.stringify(resultado.dados));
    }
}

let memoriaSistema = null;

function obterDados() {
    let dados = null;
    const dadosLocal = localStorage.getItem(DB_KEY);
    if (dadosLocal) {
        try {
            dados = JSON.parse(dadosLocal);
        } catch (_) {
            dados = null;
        }
    }

    if (!dados) {
        dados = memoriaSistema || {};
    }

    const resultado = migrarDados(dados);
    memoriaSistema = resultado.dados;
    if (resultado.alterou) {
        localStorage.setItem(DB_KEY, JSON.stringify(resultado.dados));
    }
    return resultado.dados;
}

function agendarSincronizacao(dados) {
    syncPendingData = clonarDados(dados);
    ultimaSincronizacaoStatus = 'pending';
    atualizarIndicadorSyncUI('pending');

    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(() => sincronizarComServidor(), SYNC_DEBOUNCE_MS);
}

async function sincronizarComServidor() {
    if (syncInFlight || !syncPendingData) return;
    syncInFlight = true;
    const payloadDados = syncPendingData;
    syncPendingData = null;

    try {
        await fetch(API_URL, {
            method: "POST",
            headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: JSON.stringify({
                action: "salvarDados",
                token: TOKEN_API,
                dados: payloadDados
            })
        });
        ultimaSincronizacaoStatus = 'success';
        atualizarIndicadorSyncUI('success');
    } catch (e) {
        ultimaSincronizacaoStatus = 'error';
        atualizarIndicadorSyncUI('error');
        console.error("Erro ao sincronizar com o Google Sheets:", e);
        syncPendingData = payloadDados;
    } finally {
        syncInFlight = false;
        if (syncPendingData) agendarSincronizacao(syncPendingData);
    }
}

async function buscarDadosServidor() {
    const resposta = await fetch(`${API_URL}?action=obterDados&token=${encodeURIComponent(TOKEN_API)}`);
    if (!resposta.ok) throw new Error('Falha de rede ao contatar o servidor.');
    const json = await resposta.json();
    if (json.status === 'erro') throw new Error(json.mensagem || 'Erro desconhecido do servidor.');
    return json;
}

async function salvarDados(dados, opcoes = {}) {
    const usuarioObj = obterUsuarioAtual(dados);
    if (usuarioObj && normalizarTexto(usuarioObj.nome) === 'teste') {
        memoriaSistema = dados;
        localStorage.setItem(DB_KEY, JSON.stringify(dados));
        return true;
    }

    const normalizado = migrarDados(dados).dados;
    memoriaSistema = normalizado;
    localStorage.setItem(DB_KEY, JSON.stringify(normalizado));

    if (opcoes.sincronizar !== false) {
        agendarSincronizacao(normalizado);
    }
    return true;
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
    sessionStorage.removeItem('adminAutorizado');
    sessionStorage.removeItem('adminLogado');
    window.location.href = 'index.html';
}

async function verificarAutenticacao() {
    await inicializarBanco();
    const usuarioId = localStorage.getItem('usuarioLogado');
    if (!usuarioId) {
        window.location.href = 'index.html';
        return false;
    }

    const dados = obterDados();
    const usuario = dados.usuarios.find(u => String(u.id) === String(usuarioId));
    if (!usuario) {
        deslogarSistema();
        return false;
    }

    const spanNome = document.getElementById('usuarioLogadoNome');
    if (spanNome) {
        spanNome.style.cursor = 'pointer';
        spanNome.title = "Clique para gerenciar seu perfil";
        // Exibe o nome próprio da pessoa na barra de navegação
        spanNome.innerHTML = `Perfil: <strong>${usuario.nome}</strong> ⚙️`;
        spanNome.onclick = () => {
            window.location.href = 'perfil.html';
        };
    }

    renderizarSinoNotificacoes();
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
        overlay.addEventListener('click', e => {
            if (e.target === overlay) finalizar(false);
        });
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
            titulo,
            mensagem: descricao,
            htmlExtra: htmlExtra + `
                <div class="modal-buttons" style="margin-top: 28px;">
                    <button type="button" class="btn-secundario" data-cancelar style="padding: 14px;">Cancelar</button>
                    <button type="button" data-confirmar style="padding: 14px;">Confirmar</button>
                </div>`
        });

        if (box) {
            box.style.width = "min(680px, 95vw)";
            box.style.padding = "40px";
        }

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

            if (!valNova) {
                mostrarAlertaModal("O campo de palavra-passe não pode estar vazio.");
                inputNova.focus();
                return;
            }

            if (exigirConfirmacao) {
                const valConfirma = inputConfirma.value.trim();
                if (!validarComplexidadeSenha(valNova)) {
                    mostrarAlertaModal("A palavra-passe não atende aos requisitos mínimos de segurança.");
                    inputNova.focus();
                    return;
                }
                if (valNova !== valConfirma) {
                    mostrarAlertaModal("As palavras-passe digitadas não conferem. Tente novamente.");
                    inputConfirma.value = '';
                    inputConfirma.focus();
                    return;
                }
            }

            finalizar(valNova);
        };

        inputNova.addEventListener('keydown', e => {
            if (e.key === 'Enter') {
                e.preventDefault();
                if (exigirConfirmacao && inputConfirma) {
                    inputConfirma.focus();
                } else {
                    overlay.querySelector('[data-confirmar]').click();
                }
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
            const resposta = await mostrarPromptSenha(titulo, descricao);
            resolve(resposta === null ? null : resposta);
            return;
        }

        const { overlay } = criarModalBase({
            titulo,
            mensagem: descricao,
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
            if (e.key === 'Enter') {
                e.preventDefault();
                finalizar(input.value.trim());
            }
            if (e.key === 'Escape') finalizar(null);
        });
    });
}

function mostrarPromptTextoModal(titulo, descricao) {
    return new Promise(resolve => {
        const { overlay } = criarModalBase({
            titulo,
            mensagem: descricao,
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
            if (!valor) {
                input.focus();
                mostrarAlertaModal('O preenchimento do motivo é obrigatório!');
                return;
            }
            finalizar(valor);
        };
        setTimeout(() => input?.focus(), 0);
        overlay.querySelector('[data-cancelar]').onclick = () => finalizar(null);
        overlay.querySelector('[data-confirmar]').onclick = confirmar;
        input.addEventListener('keydown', e => {
            if (e.key === 'Enter') {
                e.preventDefault();
                confirmar();
            }
            if (e.key === 'Escape') finalizar(null);
        });
    });
}

function mostrarAlertaModal(mensagem) {
    return new Promise(resolve => {
        const { overlay } = criarModalBase({
            titulo: 'Aviso',
            mensagem,
            htmlExtra: `
                <div class="modal-buttons modal-buttons-center">
                    <button type="button" data-confirmar>OK</button>
                </div>`
        });
        const finalizar = () => {
            fecharModal(overlay);
            resolve(true);
        };
        overlay.querySelector('[data-confirmar]').onclick = finalizar;
        overlay.addEventListener('keydown', e => {
            if (e.key === 'Enter' || e.key === 'Escape') finalizar();
        });
    });
}

async function verificarSenhaAdmin(nomeSecao = "esta seção") {
    const usuario = obterUsuarioAtual();
    if (usuario && normalizarTexto(usuario.nome) === 'teste') return true;
    if (sessionStorage.getItem('adminAutorizado') === 'true') return true;

    const senhaDigitada = await mostrarPromptSenha(
        "Acesso restrito",
        `Área protegida por senha de administrador para ${nomeSecao}.`
    );
    if (senhaDigitada === null) return false;

    if (senhaDigitada === SENHA_ADMIN) {
        const lembrar = await mostrarConfirmacaoModal("Deseja lembrar esta autorização durante a sessão?");
        if (lembrar) sessionStorage.setItem('adminAutorizado', 'true');
        return true;
    }

    await mostrarAlertaModal('Senha de administrador incorreta!');
    return false;
}

async function adicionarCategoria(nome, tipo) {
    if (processandoAcaoModal) return;
    if (!await verificarSenhaAdmin("cadastrar categoria")) return;
    
    processandoAcaoModal = true;
    mostrarLoading("Cadastrando categoria...");
    const dados = obterDados();
    const nomeNormalizado = normalizarTexto(nome);
    const usuarioAtualId = Number(obterUsuarioAtualId(dados));
    const ID_SISTEMA = 5;

    if (!nomeNormalizado || !['entrada', 'saida'].includes(tipo)) {
        esconderLoading();
        processandoAcaoModal = false;
        await mostrarAlertaModal('Dados da categoria inválidos.');
        return false;
    }

    // Verifica duplicação considerando o escopo correto
    const duplicada = dados.categorias.some(c => {
        const criadorId = Number(c.criadopor);
        const mesmoNomeTipo = c.tipo === tipo && normalizarTexto(c.nome) === nomeNormalizado;
        const pertenceAoContexto = criadorId === ID_SISTEMA || criadorId === usuarioAtualId;
        return mesmoNomeTipo && pertenceAoContexto;
    });

    if (duplicada) {
        esconderLoading();
        processandoAcaoModal = false;
        await mostrarAlertaModal('Já existe uma categoria com este nome e tipo.');
        return false;
    }

    const novaId = dados.categorias.reduce((m, c) => Math.max(m, Number(c.id) || 0), 0) + 1;
    dados.categorias.push({ 
        id: novaId, 
        nome: String(nome).trim(), 
        tipo, 
        classificacao: 'personalizado', 
        criadopor: usuarioAtualId 
    });

    registrarLogInterno(dados, "CADASTRO CATEGORIA", `Categoria personalizada criada: ${nome} (${tipo})`);
    await salvarDados(dados);
    
    esconderLoading();
    processandoAcaoModal = false;
    await mostrarAlertaModal("Categoria cadastrada com sucesso!");
    if (typeof renderizarCategorias === 'function') renderizarCategorias();
    return true;
}

async function atualizarCategoria(id, nome, tipo) {
    if (processandoAcaoModal) return false;
    if (!await verificarSenhaAdmin("editar categoria")) return false;

    processandoAcaoModal = true;
    mostrarLoading("Atualizando categoria...");
    try {
        const dados = obterDados();
        const categoria = dados.categorias.find(c => String(c.id) === String(id));
        const usuarioAtualId = Number(obterUsuarioAtualId(dados));

        if (!categoria) throw new Error('Categoria não encontrada.');

        // Impede que usuários comuns alterem categorias padrão do sistema
        if (categoria.classificacao === 'padrao') {
            throw new Error('Categorias padrão do sistema não podem ser alteradas.');
        }

        const nomeNormalizado = normalizarTexto(nome);
        const duplicada = dados.categorias.some(c =>
            String(c.id) !== String(id) &&
            c.tipo === tipo &&
            normalizarTexto(c.nome) === nomeNormalizado
        );
        if (duplicada) throw new Error('Já existe outra categoria com este nome e tipo.');

        categoria.nome = String(nome).trim();
        categoria.tipo = tipo;
        categoria.updatedAt = new Date().toISOString();

        registrarLogInterno(dados, "EDIÇÃO CATEGORIA", `Categoria ID ${id} alterada para: ${categoria.nome}`);
        await salvarDados(dados);

        esconderLoading();
        processandoAcaoModal = false;
        await mostrarAlertaModal("Categoria atualizada com sucesso!");
        if (typeof renderizarCategorias === 'function') renderizarCategorias();
        return true;
    } catch (erro) {
        esconderLoading();
        processandoAcaoModal = false;
        await mostrarAlertaModal(erro.message || 'Não foi possível atualizar a categoria.');
        return false;
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
        const cartoesUsuario = dados.cartoes
            .filter(c => c.ativo !== false)
            .filter(c => Number(c.usuarioId) === usuarioAtualId);

        if (cartoesUsuario.length === 0) {
            const opt = document.createElement('option');
            opt.value = '';
            opt.textContent = 'Nenhum cartão ativo cadastrado';
            selectCartao.appendChild(opt);
            return;
        }

        cartoesUsuario.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.id;
            opt.textContent = c.nome;
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
        opt.value = '';
        opt.textContent = `Nenhuma categoria de ${tipoNormalizado === 'entrada' ? 'entrada' : 'saída'} cadastrada`;
        selectCat.appendChild(opt);
        selectCat.disabled = true;
        selectCat.dataset.tipoAtual = tipoNormalizado;
        return false;
    }

    selectCat.disabled = false;

    filtradas.forEach(cat => {
        const opt = document.createElement('option');
        opt.value = String(cat.id);
        opt.textContent = cat.nome;
        selectCat.appendChild(opt);
    });

    const existeCategoriaPreferida = filtradas.some(
        cat => String(cat.id) === String(categoriaAtual)
    );

    selectCat.value = existeCategoriaPreferida
        ? String(categoriaAtual)
        : String(filtradas[0].id);

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

    if (labelData) {
        labelData.textContent = ehEntrada
            ? 'Data de recebimento'
            : 'Data de vencimento / referência';
    }

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
        if (usaCartao || selectForma.value === 'BOLETO' || selectForma.value === 'FIXO') {
            selectStatus.value = 'pendente';
        } else if (selectForma.value === 'DINHEIRO') {
            selectStatus.value = 'pago';
        }
    }
}

function inicializarControlesLancamento() {
    const tipoSelect = document.getElementById('tipoLancamento');
    const formaPagamento = document.getElementById('formaPagamento');
    const categoriaSelect = document.getElementById('categoriaLancamento');

    if (!tipoSelect) return;

    if (tipoSelect.dataset.controleInicializado !== 'true') {
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
        const qtdGerar = dadosForm.formaPagamento === 'FIXO'
            ? 12
            : Math.min(48, Math.max(1, inteiroSeguro(dadosForm.qtdParcelas, 1)));

        if (!dadosForm.descricao?.trim() || valorTotal <= 0 || !dadosForm.vencimento) {
            throw new Error('Preencha descrição, valor e data corretamente.');
        }

        const categoriaId = String(dadosForm.categoriaId ?? '').trim();
        const categoria = dados.categorias.find(
            c => String(c.id) === categoriaId
        );

        if (!categoriaId || !categoria) {
            throw new Error('Selecione uma categoria válida.');
        }

        if (categoria.tipo !== dadosForm.tipo) {
            throw new Error(
                `A categoria "${categoria.nome}" não pertence ao tipo de lançamento selecionado.`
            );
        }

        const formasSaidaValidas = ['DINHEIRO', 'BOLETO', 'FIXO', 'CARTAO'];
        if (
            dadosForm.tipo === 'saida' &&
            !formasSaidaValidas.includes(dadosForm.formaPagamento)
        ) {
            throw new Error('Forma de pagamento inválida.');
        }

        // Verifica se o bem vinculado é compartilhado para forçar o escopo como 'casal'
        let escopoFinal = dadosForm.tipo === 'saida' ? (dadosForm.escopo || 'casal') : 'casal';
        if (dadosForm.bemId) {
            const bemObj = (dados.bens || []).find(b => String(b.id) === String(dadosForm.bemId));
            if (bemObj && bemObj.compartilhado) {
                escopoFinal = 'casal';
            }
        }

        const valoresParcelas = dadosForm.formaPagamento === 'FIXO'
            ? Array.from({ length: qtdGerar }, () => Number(valorTotal.toFixed(2)))
            : dividirValorExato(valorTotal, qtdGerar);
        const valoresHoraExtra = dadosForm.horaExtra
            ? dividirValorExato(dadosForm.horaExtra, qtdGerar)
            : Array.from({ length: qtdGerar }, () => 0);

        const dataBase = criarDataLocal(dadosForm.vencimento);
        if (!dataBase) throw new Error('Data de vencimento inválida.');

        let proximaId = dados.lancamentos.reduce((m, l) => Math.max(m, Number(l.id) || 0), 0) + 1;
        const parcelamentoId = qtdGerar > 1 ? gerarId('parc') : null;
        
        // Localiza o objeto do cartão caso a forma de pagamento seja CARTAO
        let cartaoObj = null;
        if (dadosForm.formaPagamento === 'CARTAO' && dadosForm.cartaoId) {
            cartaoObj = (dados.cartoes || []).find(c => String(c.id) === String(dadosForm.cartaoId));
        }

        const hojeData = new Date();

        for (let i = 1; i <= qtdGerar; i++) {
            const dataVenc = adicionarMesesClamped(dataBase, i - 1);
            const descricaoParcelada = qtdGerar > 1
                ? `${String(dadosForm.descricao).trim()} (${i}/${qtdGerar})`
                : String(dadosForm.descricao).trim();
            const pagamento = dadosForm.formaPagamento === 'FIXO' ? 'BOLETO' : dadosForm.formaPagamento;
            
            // Lógica refinada de Status do Pagamento para Parcelamentos / Cartão
            let estaParcelaPaga = false;

            if (dadosForm.tipo === 'entrada') {
                estaParcelaPaga = dadosForm.statusInicial ? (dadosForm.statusInicial === 'pago') : true;
            } else if (dadosForm.formaPagamento === 'CARTAO' && cartaoObj) {
                const anoV = dataVenc.getFullYear();
                const mesV = dataVenc.getMonth(); // 0 a 11
                const diaFechamento = Number(cartaoObj.fechamento || 1);
                
                // O fechamento da fatura ocorre no mês anterior ao vencimento
                const dataFechamentoFatura = new Date(anoV, mesV - 1, diaFechamento);

                // Se a data atual for posterior ao fechamento desta fatura específica, ela já fechou (pendente)
                // Se a data atual for anterior ao fechamento, as parcelas anteriores ou a atual ainda não passaram pelo fechamento
                if (hojeData > dataFechamentoFatura) {
                    estaParcelaPaga = false; // Fatura já fechada / em aberto para pagamento
                } else {
                    // Se o fechamento ainda não ocorreu, considera-se quitada/antecipada em ciclos retroativos ou conforme regra
                    estaParcelaPaga = (i < qtdGerar); 
                }
            } else {
                estaParcelaPaga = dadosForm.statusInicial ? (dadosForm.statusInicial === 'pago') : false;
            }

            dados.lancamentos.push({
                id: proximaId++,
                usuarioId,
                descricao: descricaoParcelada,
                valor: valoresParcelas[i - 1],
                tipo: dadosForm.tipo,
                categoriaId,
                formaPagamento: pagamento,
                cartaoId: dadosForm.cartaoId || null,
                bemId: dadosForm.bemId ? Number(dadosForm.bemId) : null,
                dataCompra: dadosForm.dataCompra || null,
                vencimento: dataParaString(dataVenc),
                recorrencia: dadosForm.formaPagamento === 'FIXO' ? 'mensal' : 'unica',
                parcelaAtual: i,
                totalParcelas: qtdGerar,
                parcelamentoId,
                observacao: dadosForm.observacao || '',
                horaExtra: valoresHoraExtra[i - 1],
                servicoEssencial: dadosForm.tipo === 'saida' ? (dadosForm.servicoEssencial || 'nao') : 'nao',
                escopo: escopoFinal,
                pago: estaParcelaPaga,
                status: estaParcelaPaga ? 'pago' : 'pendente',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            });
        }

        if (typeof salvarMemoriaAdiantamentoSeNecessario === 'function') {
            salvarMemoriaAdiantamentoSeNecessario(dadosForm.descricao, valoresParcelas[0]);
        }
        registrarLogInterno(dados, "NOVO LANÇAMENTO", `Lançamento criado: ${dadosForm.descricao}, Valor total: ${formatarMoeda(valorTotal)} (${qtdGerar}x)`, {
            entidade: 'lancamento',
            parcelamentoId
        });
        await salvarDados(dados);

        esconderLoading();
        processandoAcaoModal = false;
        await mostrarAlertaModal("Lançamento cadastrado com sucesso!");
        if (typeof carregarDashboard === 'function') carregarDashboard();
        if (typeof carregarRelatorios === 'function') carregarRelatorios();
        return true;
    } catch (erro) {
        console.error(erro);
        esconderLoading();
        processandoAcaoModal = false;
        await mostrarAlertaModal(erro.message || 'Não foi possível cadastrar o lançamento.');
        return false;
    }
}

async function adicionarContaLotePorPeriodo(descricao, valorParcela, dataInicio, qtdMeses, categoriaId, bemId = null) {
    mostrarLoading("Gerando contas em lote...");
    const dados = obterDados();
    const usuarioId = parseInt(localStorage.getItem('usuarioLogado'));
    
    // Se o bem vinculado for compartilhado, força o escopo como casal
    let escopoLote = 'casal';
    if (bemId) {
        const bemObj = (dados.bens || []).find(b => String(b.id) === String(bemId));
        if (bemObj && !bemObj.compartilhado) {
            escopoLote = 'individual';
        }
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

        const novoLancamento = {
            id: proximaIdLanc++,
            usuarioId,
            descricao: `${descricao} (${i + 1}/${qtdMeses})`,
            valor: Number(valorParcela.toFixed(2)),
            tipo: 'saida',
            categoriaId: Number(categoriaId),
            formaPagamento: 'BOLETO',
            cartaoId: null,
            bemId: bemId ? Number(bemId) : null,
            vencimento: dataVencStr,
            recorrencia: 'unica',
            parcelaAtual: i + 1,
            totalParcelas: qtdMeses,
            parcelamentoId,
            observacao: 'Gerado por lote retroativo/período',
            horaExtra: 0,
            servicoEssencial: 'nao',
            escopo: escopoLote,
            pago: false,
            status: jaPassou ? 'atrasado' : 'pendente',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        dados.lancamentos.push(novoLancamento);
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

        if (!nomeFinal || valorFinal <= 0 || !dataBase || !catFinalId) {
            throw new Error('Preencha os dados do financiamento corretamente.');
        }

        let escopoFin = 'casal';
        if (bemId) {
            const bemObj = (dados.bens || []).find(b => String(b.id) === String(bemId));
            if (bemObj && !bemObj.compartilhado) {
                escopoFin = 'individual';
            }
        }

        const financiamentoId = dados.financiamentos.reduce((m, f) => Math.max(m, Number(f.id) || 0), 0) + 1;
        const parcelamentoId = gerarId('finparc');
        const totalMeses = recorrente === 'sim' ? meses : 1;

        dados.financiamentos.push({
            id: financiamentoId,
            usuarioId,
            nome: nomeFinal,
            bemId: bemId ? Number(bemId) : null,
            totalMeses,
            mesesPagos: 0,
            valorParcela: Number(valorFinal.toFixed(2)),
            categoriaId: catFinalId,
            primeiroVencimento,
            ativo: true,
            createdAt: new Date().toISOString()
        });

        let proximaIdLanc = dados.lancamentos.reduce((m, l) => Math.max(m, Number(l.id) || 0), 0) + 1;
        const parcelas = dividirValorExato(valorFinal * totalMeses, totalMeses);

        for (let i = 1; i <= totalMeses; i++) {
            const dataVenc = adicionarMesesClamped(dataBase, i - 1);
            dados.lancamentos.push({
                id: proximaIdLanc++,
                usuarioId,
                descricao: `Financiamento: ${nomeFinal} (${i}/${totalMeses})`,
                valor: parcelas[i - 1],
                tipo: 'saida',
                categoriaId: catFinalId,
                formaPagamento: 'BOLETO',
                cartaoId: null,
                bemId: bemId ? Number(bemId) : null,
                vencimento: dataParaString(dataVenc),
                recorrencia: 'mensal',
                parcelaAtual: i,
                totalParcelas: totalMeses,
                parcelamentoId,
                financiamentoId,
                observacao: 'Gerado automaticamente pelo contrato',
                horaExtra: 0,
                servicoEssencial: 'nao',
                escopo: escopoFin,
                pago: false,
                status: 'pendente',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            });
        }

        registrarLogInterno(dados, "CADASTRO FINANCIAMENTO", `Contrato criado: ${nomeFinal} (${totalMeses} meses)`, {
            entidade: 'financiamento', entidadeId: financiamentoId
        });
        await salvarDados(dados);

        esconderLoading();
        processandoAcaoModal = false;
        await mostrarAlertaModal("Financiamento cadastrado com sucesso!");
        if (typeof carregarRelatorios === 'function') carregarRelatorios();
        return true;
    } catch (erro) {
        console.error(erro);
        esconderLoading();
        processandoAcaoModal = false;
        await mostrarAlertaModal(erro.message || 'Não foi possível cadastrar o financiamento.');
        return false;
    }
}

async function atualizarLancamentoNoBanco(id, novosDados) {
    const dados = obterDados();
    const lancamento = dados.lancamentos.find(l => Number(l.id) === Number(id));
    if (!lancamento) {
        await mostrarAlertaModal("Lançamento não encontrado.");
        return;
    }

    // Validação da relação (se é compra parcelada ou financiamento)
    const grupoParcelamentoId = resolverParcelamentoId(lancamento);
    const financiamentoId = resolverFinanciamentoIdPorLancamento(lancamento, dados);
    const ehVinculado = Boolean(grupoParcelamentoId) || Boolean(financiamentoId) || (lancamento.totalParcelas && lancamento.totalParcelas > 1);

    let aplicarParaTodas = false;
    if (ehVinculado) {
        const escolha = await mostrarOpcaoEscopoModal("Este lançamento faz parte de um financiamento ou compra parcelada. Deseja tornar essa modificação para todas outras parcelas?");
        if (escolha === null) return; // Cancelado pelo usuário
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
        // Seleciona todos os lançamentos do mesmo grupo (financiamento ou parcelamento)
        const relacionados = financiamentoId 
            ? dados.lancamentos.filter(l => Number(l.financiamentoId) === Number(financiamentoId))
            : dados.lancamentos.filter(l => String(l.parcelamentoId) === String(grupoParcelamentoId));

        relacionados.forEach(l => {
            const descricaoAntiga = l.descricao;
            const valorAntigo = l.valor;

            // Mantém o sufixo do número da parcela (ex: " (2/12)") e atualiza o restante
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

            if (novosDados.formaPagamento === 'CARTAO') {
                l.cartaoId = novosDados.cartaoId || l.cartaoId || null;
            }

            dados.edicao_movimento.push({
                dataHora: dataHoraAtual,
                usuario: nomeUsuario,
                lancamentoId: l.id,
                descricaoAntiga: descricaoAntiga,
                descricaoNova: l.descricao,
                valorAntigo: valorAntigo,
                valorNovo: l.valor,
                motivo: `[EM LOTE] ${motivo}`
            });
        });

        registrarLogInterno(dados, "EDIÇÃO EM LOTE", `Atualizadas ${relacionados.length} parcelas vinculadas. Motivo: ${motivo}`);
    } else {
        // Atualiza apenas a parcela selecionada individualmente
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
            dataHora: dataHoraAtual,
            usuario: nomeUsuario,
            lancamentoId: id,
            descricaoAntiga: descricaoAntiga,
            descricaoNova: novosDados.descricao,
            valorAntigo: valorAntigo,
            valorNovo: novosDados.valor,
            motivo: motivo
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

        const parcelas = dados.lancamentos.filter(l =>
            String(l.financiamentoId) === String(id) ||
            (l.tipo === 'saida' && normalizarTexto(l.descricao).includes(normalizarTexto(`Financiamento: ${fin.nome}`)))
        );

        parcelas.forEach(l => {
            if (!Array.isArray(dados.exclusao_movimento)) dados.exclusao_movimento = [];
            const usuario = obterUsuarioAtual(dados);
            dados.exclusao_movimento.push({
                id: gerarId('exc'),
                dataHora: new Date().toLocaleString('pt-BR'),
                usuario: usuario ? usuario.nome : 'Desconhecido',
                lancamentoId: l.id,
                descricao: l.descricao,
                valor: l.valor,
                motivo: '[FINANCIAMENTO] Exclusão do contrato'
            });
        });

        dados.financiamentos = dados.financiamentos.filter(f => String(f.id) !== String(id));
        dados.lancamentos = dados.lancamentos.filter(l => !parcelas.some(p => String(p.id) === String(l.id)));
        registrarLogInterno(dados, "EXCLUSÃO FINANCIAMENTO", `Contrato ID ${id} (${fin.nome}) e ${parcelas.length} parcela(s) excluídos`, {
            entidade: 'financiamento', entidadeId: id
        });
        await salvarDados(dados);

        esconderLoading();
        processandoAcaoModal = false;
        await mostrarAlertaModal("Financiamento e suas parcelas foram excluídos com sucesso!");
        if (typeof carregarRelatorios === 'function') carregarRelatorios();
        return true;
    } catch (erro) {
        console.error(erro);
        esconderLoading();
        processandoAcaoModal = false;
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

        registrarLogInterno(dados, "STATUS PAGAMENTO", `Lançamento ID ${id} (${lancamento.descricao}) marcado como ${novoPago ? 'PAGO' : 'PENDENTE'}`, {
            entidade: 'lancamento', entidadeId: id
        });
        await salvarDados(dados);

        esconderLoading();
        processandoAcaoModal = false;
        
        // Executa as funções de atualização apenas se elas existirem no contexto da página atual
        if (typeof carregarRelatorios === 'function') carregarRelatorios();
        if (typeof carregarDashboard === 'function') carregarDashboard();
        if (typeof renderizarCartoes === 'function') renderizarCartoes();
        return true;
    } catch (erro) {
        console.error(erro);
        esconderLoading();
        processandoAcaoModal = false;
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

    const sucesso = await adicionarFinanciamentoComRecorrencia(
        nome, 'sim', valorParcela, qtdMeses, primeiroVencimento, categoriaId
    );

    if (sucesso) {
        document.getElementById('formFinanciamento')?.reset();
        const hoje = dataLocalYYYYMMDD();
        const campo = document.getElementById('primeiroVencimentoFin');
        if (campo) campo.value = hoje;
    }
}

function carregarDashboard() {
    const mesAno = document.getElementById('filtroMesAno').value;
    const escopo = document.getElementById('filtroEscopoDashboardGeral').value;
    const tipoFiltroLanc = document.getElementById('filtroTipoUltimosLancamentos').value;

    const dados = obterDados();
    const usuarioId = localStorage.getItem('usuarioLogado');
    const usuario = dados.usuarios.find(u => Number(u.id) === Number(usuarioId)) || {};
    
    // Passa o escopo selecionado para o filtro restritivo respeitar Individual vs Casal
    const lancamentos = filtrarDadosPorPermissao(dados.lancamentos || [], dados, escopo);
    const categorias = dados.categorias || [];
    const cartoes = filtrarDadosPorPermissao(dados.cartoes || [], dados, escopo).filter(c => c.ativo !== false);

    // Cálculo do Patrimônio Total de Bens (próprios + compartilhados se houver parceiro)
    const bens = filtrarDadosPorPermissao(dados.bens || [], dados, escopo);
    const bensValidos = bens.filter(b => {
        if (b.ativo === false) return false;
        const eSeu = Number(b.usuarioId) === Number(usuarioId) || !b.usuarioId;
        const eCompartilhado = b.compartilhado && usuario.parceiroId;
        return eSeu || eCompartilhado;
    });
    const valorTotalPatrimonio = bensValidos.reduce((acc, b) => acc + Number(b.valor || 0), 0);
    document.getElementById('totalPatrimonioBens').textContent = `R$ ${valorTotalPatrimonio.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`;

    const filtrados = lancamentos.filter(l => {
        const dataOk = (l.vencimento || l.data || '').startsWith(mesAno);
        const escopoOk = escopo === 'todos' || (l.tipo === 'entrada') || (l.escopo || 'casal') === escopo;
        return dataOk && escopoOk;
    });

    let totalEntradas = 0;
    let totalSaidas = 0;
    let totalFaturas = 0;
    let totalParcelas = 0;
    let totalFinanciamentos = 0;

    filtrados.forEach(l => {
        const val = Number(l.valor || 0);
        const descLower = (l.descricao || '').toLowerCase();

        if (l.tipo === 'entrada') {
            totalEntradas += val;
        } else {
            totalSaidas += val;
            
            // Lógica Exclusiva para separar Financiamentos x Parcelas x Faturas
            if (l.financiamentoId || descLower.includes('financiamento')) {
                totalFinanciamentos += val;
            } else if ((l.totalParcelas && Number(l.totalParcelas) > 1) || descLower.includes('parcela')) {
                totalParcelas += val;
            } else if (descLower.includes('fatura') || descLower.includes('cartão')) {
                totalFaturas += val;
            }
        }
    });

    const saldoGeral = totalEntradas - totalSaidas;

    document.getElementById('totalEntradas').textContent = `R$ ${totalEntradas.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`;
    document.getElementById('totalSaidas').textContent = `R$ ${totalSaidas.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`;
    
    const elSaldo = document.getElementById('saldoGeral');
    elSaldo.textContent = `R$ ${saldoGeral.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`;
    elSaldo.className = `stat-value ${saldoGeral >= 0 ? 'positivo' : 'negativo'}`;

    const kpiFaturas = document.getElementById('kpiCardFaturas');
    if (totalFaturas > 0) {
        document.getElementById('totalFaturasMes').textContent = `R$ ${totalFaturas.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`;
        kpiFaturas.style.display = 'block';
    } else {
        kpiFaturas.style.display = 'none';
    }

    const kpiParcelas = document.getElementById('kpiCardParcelas');
    if (totalParcelas > 0) {
        document.getElementById('totalParcelasMes').textContent = `R$ ${totalParcelas.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`;
        kpiParcelas.style.display = 'block';
    } else {
        kpiParcelas.style.display = 'none';
    }

    const kpiFinanciamentos = document.getElementById('kpiCardFinanciamentos');
    if (totalFinanciamentos > 0) {
        document.getElementById('totalFinanciamentosMes').textContent = `R$ ${totalFinanciamentos.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`;
        kpiFinanciamentos.style.display = 'block';
    } else {
        kpiFinanciamentos.style.display = 'none';
    }

    const cardCartoes = document.getElementById('cardGraficoCartoes');
    if (cardCartoes) {
        cardCartoes.style.display = cartoes.length === 0 ? 'none' : 'flex';
    }

    const tbodyLanc = document.getElementById('tabelaUltimosLancamentos');
    tbodyLanc.innerHTML = '';

    const lancamentosTabela = filtrados.filter(l => tipoFiltroLanc === 'todos' || l.tipo === tipoFiltroLanc);

    if (lancamentosTabela.length === 0) {
        tbodyLanc.innerHTML = `<tr><td colspan="7" style="text-align: center;">Nenhum lançamento encontrado.</td></tr>`;
    } else {
        lancamentosTabela.forEach(l => {
            const catObj = categorias.find(c => Number(c.id) === Number(l.categoriaId)) || { nome: 'Geral' };
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${l.usuario || 'Sistema'}</td>
                <td><strong>${l.descricao}</strong></td>
                <td>${catObj.nome}</td>
                <td>${l.dataPagamento ? l.dataPagamento.split('-').reverse().join('/') : '-'}</td>
                <td>${l.vencimento ? l.vencimento.split('-').reverse().join('/') : '-'}</td>
                <td class="${l.tipo === 'entrada' ? 'positivo' : 'negativo'}">R$ ${Number(l.valor || 0).toLocaleString('pt-BR', {minimumFractionDigits: 2})}</td>
                <td>
                    <button onclick="window.location.href='editar-lancamento.html?id=${l.id}'" class="btn-acao-icone editar" title="Editar"><img src="imagens/editar.png" alt="Editar"></button>
                    <button onclick="removerLancamentoInteligente(${l.id})" class="btn-acao-icone excluir" title="Excluir"><img src="imagens/excluir.png" alt="Excluir"></button>
                </td>
            `;
            tbodyLanc.appendChild(tr);
        });
    }

    atualizarGraficosDashboard(totalEntradas, totalSaidas, dados);
}

function atualizarGraficosDashboard(totalEntradas, totalSaidas, dados) {
    const usuarioLogadoId = parseInt(localStorage.getItem('usuarioLogado'));
    const escopoAtual = document.getElementById('filtroEscopoDashboardGeral')?.value || 'casal';

    const canvasES = document.getElementById('graficoEntradasSaidas');
    if (canvasES) {
        if (chartEntradasSaidasInstance) chartEntradasSaidasInstance.destroy();
        
        const dadosES = (totalEntradas > 0 || totalSaidas > 0) ? [totalEntradas, totalSaidas] : [1, 1];
        const coresES = (totalEntradas > 0 || totalSaidas > 0) ? ['#10b981', '#ef4444'] : ['#cbd5e1', '#cbd5e1'];

        chartEntradasSaidasInstance = new Chart(canvasES, {
            type: 'pie',
            data: {
                labels: ['Entradas', 'Saídas'],
                datasets: [{
                    data: dadosES,
                    backgroundColor: coresES,
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { position: 'bottom', labels: { boxWidth: 12 } } }
            }
        });
    }

    const filtroMesInput = document.getElementById('filtroMesAno');
    const mesAnoSelecionado = filtroMesInput ? filtroMesInput.value : '';
    const selectCatDash = document.getElementById('filtroCategoriaDashboard');
    const categoriaSelecionadaId = selectCatDash ? selectCatDash.value : 'todas';

    // Aplica o filtro restritivo de permissões e escopo para evitar dados cruzados (como de outros perfis)
    const lancamentosPermitidos = filtrarDadosPorPermissao(dados.lancamentos || [], dados, escopoAtual);

    const lancamentosPeriodo = lancamentosPermitidos.filter(l => {
        if (l.tipo !== 'saida') return false;
        if (mesAnoSelecionado && l.vencimento && !l.vencimento.startsWith(mesAnoSelecionado)) return false;
        if (categoriaSelecionadaId !== 'todas' && Number(l.categoriaId) !== Number(categoriaSelecionadaId)) return false;
        return true;
    });

    const somatorioPorCategoria = {};
    lancamentosPeriodo.forEach(l => {
        somatorioPorCategoria[l.categoriaId] = (somatorioPorCategoria[l.categoriaId] || 0) + Number(l.valor);
    });

    const labelsCategorias = [];
    const valoresCategorias = [];
    const coresPadrao = ['#3b82f6', '#f59e0b', '#10b981', '#8b5cf6', '#ec4899', '#06b6d4', '#64748b', '#ef4444'];

    for (let catId in somatorioPorCategoria) {
        const cat = dados.categorias.find(c => Number(c.id) === Number(catId));
        labelsCategorias.push(cat ? cat.nome : 'Outros');
        valoresCategorias.push(somatorioPorCategoria[catId]);
    }

    const canvasCat = document.getElementById('graficoGastosCategorias');
    if (canvasCat) {
        if (chartGastosCategoriasInstance) chartGastosCategoriasInstance.destroy();
        
        const dadosGrafico = valoresCategorias.length > 0 ? valoresCategorias : [1];
        const rotulosGrafico = labelsCategorias.length > 0 ? labelsCategorias : ['Sem gastos'];
        const coresGrafico = valoresCategorias.length > 0 ? coresPadrao.slice(0, valoresCategorias.length) : ['#cbd5e1'];

        chartGastosCategoriasInstance = new Chart(canvasCat, {
            type: 'pie',
            data: {
                labels: rotulosGrafico,
                datasets: [{
                    data: dadosGrafico,
                    backgroundColor: coresGrafico,
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { position: 'bottom', labels: { boxWidth: 12 } } }
            }
        });
    }

    let totalEssencial = 0;
    let totalNaoEssencial = 0;

    lancamentosPeriodo.forEach(l => {
        const valor = Number(l.valor);
        if (l.servicoEssencial === 'sim') {
            totalEssencial += valor;
        } else {
            totalNaoEssencial += valor;
        }
    });

    const canvasServicos = document.getElementById('graficoServicosEssenciais');
    if (canvasServicos) {
        if (chartServicosEssenciaisInstance) chartServicosEssenciaisInstance.destroy();

        const dadosServicos = (totalEssencial > 0 || totalNaoEssencial > 0) ? [totalEssencial, totalNaoEssencial] : [1];
        const coresServicos = (totalEssencial > 0 || totalNaoEssencial > 0) ? ['#10b981', '#f59e0b'] : ['#cbd5e1'];

        chartServicosEssenciaisInstance = new Chart(canvasServicos, {
            type: 'pie',
            data: {
                labels: ['Essenciais', 'Não Essenciais'],
                datasets: [{
                    data: dadosServicos,
                    backgroundColor: coresServicos,
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { position: 'bottom', labels: { boxWidth: 12 } } }
            }
        });
    }

    const selectFiltroCartao = document.getElementById('filtroGraficoCartao');
    const cartoesUsuario = filtrarDadosPorPermissao(dados.cartoes || [], dados, escopoAtual).filter(c => c.ativo !== false);
    
    if (selectFiltroCartao) {
        const valorAtual = selectFiltroCartao.value;
        selectFiltroCartao.innerHTML = '<option value="todos">Todos</option>';
        cartoesUsuario.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.id;
            opt.innerText = c.nome;
            selectFiltroCartao.appendChild(opt);
        });
        if (valorAtual) selectFiltroCartao.value = valorAtual;
    }

    const cartaoSelecionadoId = selectFiltroCartao ? selectFiltroCartao.value : 'todos';
    let totalLimiteGeral = 0;
    let totalUsadoGeral = 0;

    cartoesUsuario.forEach(cartao => {
        if (cartaoSelecionadoId === 'todos' || Number(cartao.id) === Number(cartaoSelecionadoId)) {
            const gastoUtilizado = lancamentosPermitidos
                .filter(l => Number(l.cartaoId) === Number(cartao.id) && !l.pago)
                .reduce((acc, l) => acc + Number(l.valor), 0);
            
            totalLimiteGeral += Number(cartao.limite || cartao.limiteTotal || 0);
            totalUsadoGeral += gastoUtilizado;
        }
    });

    const totalDisponivelGeral = Math.max(0, totalLimiteGeral - totalUsadoGeral);

    const canvasCartao = document.getElementById('graficoCartoesLimite');
    if (canvasCartao) {
        if (chartCartoesLimiteInstance) chartCartoesLimiteInstance.destroy();
        
        const dadosCartao = (totalUsadoGeral > 0 || totalDisponivelGeral > 0) ? [totalUsadoGeral, totalDisponivelGeral] : [1, 1];
        const coresCartao = (totalUsadoGeral > 0 || totalDisponivelGeral > 0) ? ['#f59e0b', '#3b82f6'] : ['#cbd5e1', '#cbd5e1'];

        chartCartoesLimiteInstance = new Chart(canvasCartao, {
            type: 'pie',
            data: {
                labels: ['Limite Usado', 'Limite Disponível'],
                datasets: [{
                    data: dadosCartao,
                    backgroundColor: coresCartao,
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { position: 'bottom', labels: { boxWidth: 12 } } }
            }
        });
    }
}

function carregarRelatorios() {
    const dados = obterDados();
    
    const filtroMesInput = document.getElementById('filtroMesAnoRelatorio');
    const mesAnoSelecionado = filtroMesInput ? filtroMesInput.value : '';

    const selectFiltroEssencial = document.getElementById('filtroServicoEssencialDashboard');
    const servicoFiltroVal = selectFiltroEssencial ? selectFiltroEssencial.value : 'todos';

    const lancamentosPeriodo = dados.lancamentos.filter(l => {
        if (mesAnoSelecionado && l.vencimento && !l.vencimento.startsWith(mesAnoSelecionado)) return false;
        if (servicoFiltroVal !== 'todos') {
            if (l.tipo === 'saida' && l.servicoEssencial !== servicoFiltroVal) return false;
            if (l.tipo === 'entrada' && servicoFiltroVal === 'sim') return false;
        }
        return true;
    });

    let entSamuel = 0, saiSamuel = 0, entMariana = 0, saiMariana = 0;

    lancamentosPeriodo.forEach(l => {
        const valor = Number(l.valor);
        if (Number(l.usuarioId) === 1) {
            if (l.tipo === 'entrada') entSamuel += valor;
            if (l.tipo === 'saida') saiSamuel += valor;
        } else if (Number(l.usuarioId) === 2) {
            if (l.tipo === 'entrada') entMariana += valor;
            if (l.tipo === 'saida') saiMariana += valor;
        }
    });

    const elEntSam = document.getElementById('relatorioEntradaSamuel');
    const elSaiSam = document.getElementById('relatorioSaidaSamuel');
    const elEntMar = document.getElementById('relatorioEntradaMariana');
    const elSaiMar = document.getElementById('relatorioSaidaMariana');

    if (elEntSam) elEntSam.innerText = `R$ ${entSamuel.toFixed(2)}`;
    if (elSaiSam) elSaiSam.innerText = `R$ ${saiSamuel.toFixed(2)}`;
    if (elEntMar) elEntMar.innerText = `R$ ${entMariana.toFixed(2)}`;
    if (elSaiMar) elSaiMar.innerText = `R$ ${saiMariana.toFixed(2)}`;

    const selectFiltroUnico = document.getElementById('filtroUsuarioGraficos');
    const usuarioFiltroGlobal = selectFiltroUnico ? selectFiltroUnico.value : 'todos';

    let totalEntradasES = 0;
    let totalSaidasES = 0;

    lancamentosPeriodo.forEach(l => {
        if (usuarioFiltroGlobal !== 'todos' && Number(l.usuarioId) !== Number(usuarioFiltroGlobal)) return;
        const valor = Number(l.valor);
        if (l.tipo === 'entrada') totalEntradasES += valor;
        if (l.tipo === 'saida') totalSaidasES += valor;
    });

    // CORREÇÃO: Garante valores seguros para o gráfico não sumir caso esteja zerado
    const canvasRelES = document.getElementById('graficoRelatorioEntradasSaidas');
    if (canvasRelES) {
        if (chartRelatorioESInstance) chartRelatorioESInstance.destroy();
        
        const dadosES = (totalEntradasES > 0 || totalSaidasES > 0) ? [totalEntradasES, totalSaidasES] : [1, 1];
        const coresES = (totalEntradasES > 0 || totalSaidasES > 0) ? ['#10b981', '#ef4444'] : ['#cbd5e1', '#cbd5e1'];

        chartRelatorioESInstance = new Chart(canvasRelES, {
            type: 'pie',
            data: {
                labels: ['Entradas', 'Saídas'],
                datasets: [{
                    data: dadosES,
                    backgroundColor: coresES,
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { position: 'bottom', labels: { boxWidth: 12 } } }
            }
        });
    }

    const somatorioCatRel = {};
    lancamentosPeriodo.filter(l => {
        if (l.tipo !== 'saida') return false;
        if (usuarioFiltroGlobal !== 'todos' && Number(l.usuarioId) !== Number(usuarioFiltroGlobal)) return false;
        return true;
    }).forEach(l => {
        somatorioCatRel[l.categoriaId] = (somatorioCatRel[l.categoriaId] || 0) + Number(l.valor);
    });

    const labelsCatRel = [];
    const valoresCatRel = [];
    const coresPadraoRel = ['#3b82f6', '#f59e0b', '#10b981', '#8b5cf6', '#ec4899', '#06b6d4', '#64748b', '#ef4444'];

    for (let catId in somatorioCatRel) {
        const catObj = dados.categorias.find(c => Number(c.id) === Number(catId));
        labelsCatRel.push(catObj ? catObj.nome : 'Outros');
        valoresCatRel.push(somatorioCatRel[catId]);
    }

    const canvasRelCat = document.getElementById('graficoRelatorioCategorias');
    if (canvasRelCat) {
        if (chartRelatorioCatInstance) chartRelatorioCatInstance.destroy();
        
        const dadosPizza = valoresCatRel.length > 0 ? valoresCatRel : [1];
        const rotulosPizza = labelsCatRel.length > 0 ? labelsCatRel : ['Sem gastos'];
        const coresPizza = valoresCatRel.length > 0 ? coresPadraoRel.slice(0, valoresCatRel.length) : ['#cbd5e1'];

        chartRelatorioCatInstance = new Chart(canvasRelCat, {
            type: 'pie',
            data: {
                labels: rotulosPizza,
                datasets: [{
                    data: dadosPizza,
                    backgroundColor: coresPizza,
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { position: 'bottom', labels: { boxWidth: 12 } } }
            }
        });
    }

    let totalEssencialRel = 0;
    let totalNaoEssencialRel = 0;

    lancamentosPeriodo.filter(l => {
        if (l.tipo !== 'saida') return false;
        if (usuarioFiltroGlobal !== 'todos' && Number(l.usuarioId) !== Number(usuarioFiltroGlobal)) return false;
        return true;
    }).forEach(l => {
        const valor = Number(l.valor);
        if (l.servicoEssencial === 'sim') {
            totalEssencialRel += valor;
        } else {
            totalNaoEssencialRel += valor;
        }
    });

    const canvasServicosRel = document.getElementById('graficoServicosEssenciais');
    if (canvasServicosRel) {
        if (chartServicosEssenciaisInstance) chartServicosEssenciaisInstance.destroy();

        const dadosServicosRel = (totalEssencialRel > 0 || totalNaoEssencialRel > 0) ? [totalEssencialRel, totalNaoEssencialRel] : [1];
        const coresServicosRel = (totalEssencialRel > 0 || totalNaoEssencialRel > 0) ? ['#10b981', '#f59e0b'] : ['#cbd5e1'];

        chartServicosEssenciaisInstance = new Chart(canvasServicosRel, {
            type: 'pie',
            data: {
                labels: ['Essenciais', 'Não Essenciais'],
                datasets: [{
                    data: dadosServicosRel,
                    backgroundColor: coresServicosRel,
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { position: 'bottom', labels: { boxWidth: 12 } } }
            }
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

    const itensDaFatura = dados.lancamentos.filter(l => 
        Number(l.cartaoId) === Number(cartaoId) && l.vencimento && l.vencimento.startsWith(anoMes)
    );

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
                        <tr>
                            <th>Descrição</th>
                            <th style="text-align: center; width: 100px;">Parcela</th>
                            <th style="text-align: right; width: 120px;">Valor</th>
                            <th style="text-align: center; width: 140px;">Vencimento</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${linhasHtml}
                    </tbody>
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
    const parcelasGrupo = (dados.lancamentos || []).filter(l => 
        (lancamento.parcelamentoId && l.parcelamentoId === lancamento.parcelamentoId) ||
        (!lancamento.parcelamentoId && descricaoBaseParcelamento(l.descricao) === chaveGrupo)
    );

    // Ordena por vencimento
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
    const forma = lancamento.formaPagamento;
    if (forma === 'CARTAO') {
        const cartaoObj = (dados.cartoes || []).find(c => String(c.id) === String(lancamento.cartaoId));
        infoFormaPagamento = `Cartão Utilizado: ${cartaoObj ? cartaoObj.nome : 'Crédito'}`;
    } else if (forma === 'BOLETO') {
        infoFormaPagamento = `Forma de Pagamento: Boleto / Conta`;
    } else if (forma === 'FIXO') {
        infoFormaPagamento = `Forma de Pagamento: Conta fixa / mensal`;
    } else {
        infoFormaPagamento = `Forma de Pagamento: ${forma || 'Não informada'}`;
    }

    let linhasTabelaHtml = '';
    parcelasPagina.forEach((p, idx) => {
        const numeroReal = inicio + idx + 1;
        linhasTabelaHtml += `
            <tr>
                <td style="text-align: center;">${numeroReal}/${totalParcelas}</td>
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

    // Fecha modal anterior se já estiver aberto para atualizar a página
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
                <thead>
                    <tr>
                        <th style="text-align: center;">Parcela</th>
                        <th>Vencimento</th>
                        <th style="text-align: right;">Valor</th>
                        <th style="text-align: center;">Status</th>
                    </tr>
                </thead>
                <tbody>
                    ${linhasTabelaHtml}
                </tbody>
            </table>
        </div>

        ${paginacaoHtml}

        <div class="modal-buttons modal-buttons-center" style="margin-top: 15px;">
            <button type="button" data-fechar style="background-color: var(--primary); width: 100%;">Fechar</button>
        </div>
    `;

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay modal-overlay-detalhe-parcelas';
    overlay.innerHTML = `
        <div class="modal-box" style="max-width: 650px; width: 95%;">
            <h3>Detalhes do Financiamento / Parcelamento</h3>
            ${htmlDetalhes}
        </div>
    `;
    document.body.appendChild(overlay);

    overlay.querySelector('[data-fechar]').onclick = () => fecharModal(overlay);
    overlay.addEventListener('click', e => {
        if (e.target === overlay) fecharModal(overlay);
    });
}

async function removerLancamento(id) {
    const motivo = await mostrarPromptTextoModal("Justificativa Obrigatória", "Informe o motivo da exclusão deste lançamento:");
    if (!motivo) return;

    mostrarLoading("Excluindo lançamento...");
    const dados = obterDados();
    const lanc = dados.lancamentos.find(l => Number(l.id) === Number(id));
    if (!lanc) {
        esconderLoading();
        return;
    }

    const usuarioId = localStorage.getItem('usuarioLogado');
    const u = dados.usuarios.find(user => user.id == usuarioId);
    const nomeUsuario = u ? u.nome : "Desconhecido";

    dados.exclusao_movimento.push({
        dataHora: new Date().toLocaleString('pt-BR'),
        usuario: nomeUsuario,
        lancamentoId: id,
        descricao: lanc.descricao,
        valor: lanc.valor,
        motivo: motivo
    });

    dados.lancamentos = dados.lancamentos.filter(l => Number(l.id) !== Number(id));
    registrarLogInterno(dados, "EXCLUSÃO LANÇAMENTO", `Lançamento ID ${id} (${lanc.descricao}) excluído. Motivo: ${motivo}`);
    await salvarDados(dados);
    
    esconderLoading();
    await mostrarAlertaModal("Lançamento excluído com sucesso!");
    carregarDashboard();
}

async function removerLancamentoRelatorio(id) {
    const motivo = await mostrarPromptTextoModal("Justificativa Obrigatória", "Informe o motivo da exclusão deste lançamento:");
    if (!motivo) return;

    mostrarLoading("Excluindo lançamento...");
    const dados = obterDados();
    const lanc = dados.lancamentos.find(l => Number(l.id) === Number(id));
    if (!lanc) {
        esconderLoading();
        return;
    }

    const usuarioId = localStorage.getItem('usuarioLogado');
    const u = dados.usuarios.find(user => user.id == usuarioId);
    const nomeUsuario = u ? u.nome : "Desconhecido";

    dados.exclusao_movimento.push({
        dataHora: new Date().toLocaleString('pt-BR'),
        usuario: nomeUsuario,
        lancamentoId: id,
        descricao: lanc.descricao,
        valor: lanc.valor,
        motivo: motivo
    });

    dados.lancamentos = dados.lancamentos.filter(l => Number(l.id) !== Number(id));
    registrarLogInterno(dados, "EXCLUSÃO LANÇAMENTO", `Lançamento ID ${id} (${lanc.descricao}) excluído. Motivo: ${motivo}`);
    await salvarDados(dados);
    
    esconderLoading();
    await mostrarAlertaModal("Lançamento excluído com sucesso!");
    carregarRelatorios();
}

async function adicionarContaLotePorPeriodo(descricao, valorParcela, dataInicio, qtdMeses, categoriaId, bemId = null) {
    mostrarLoading("Gerando contas em lote...");
    const dados = obterDados();
    const usuarioId = parseInt(localStorage.getItem('usuarioLogado'));
    
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

        const novoLancamento = {
            id: proximaIdLanc++,
            usuarioId,
            descricao: `${descricao} (${i + 1}/${qtdMeses})`,
            valor: Number(valorParcela.toFixed(2)),
            tipo: 'saida',
            categoriaId: Number(categoriaId),
            formaPagamento: 'BOLETO',
            cartaoId: null,
            bemId: bemId ? Number(bemId) : null,
            vencimento: dataVencStr,
            recorrencia: 'unica',
            parcelaAtual: i + 1,
            totalParcelas: qtdMeses,
            parcelamentoId,
            observacao: 'Gerado por lote retroativo/período',
            horaExtra: 0,
            servicoEssencial: 'nao',
            pago: false,
            status: jaPassou ? 'atrasado' : 'pendente',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        dados.lancamentos.push(novoLancamento);
    }

    registrarLogInterno(dados, "CONTA LOTE PERÍODO", `Lote por período criado: ${descricao} (${qtdMeses} meses)`);
    await salvarDados(dados);
    
    esconderLoading();
    await mostrarAlertaModal("Lotes criados com sucesso!");
    if (typeof carregarRelatorios === 'function') carregarRelatorios();
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
            dataHora: dataHoraAtual,
            usuario: nomeUsuario,
            lancamentoId: id,
            descricao: lanc.descricao,
            valor: lanc.valor,
            motivo: motivo
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
                id: gerarId('exc'),
                dataHora: dataHoraAtual,
                usuario: nomeUsuario,
                lancamentoId: l.id,
                descricao: l.descricao,
                valor: l.valor,
                motivo: `[LOTE] ${motivo}`
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
            id: proximaId++,
            usuarioId,
            descricao: `${descricaoBase} (Adiantamento 40%)`,
            valor: valorAdiantamento,
            tipo: 'entrada',
            categoriaId: Number(categoriaId),
            formaPagamento: 'BOLETO',
            cartaoId: null,
            vencimento: dataDia15,
            recorrencia: 'mensal',
            parcelaAtual: 1,
            totalParcelas: 1,
            observacao: 'Gerado automaticamente',
            horaExtra: 0,
            servicoEssencial: 'nao',
            pago: true
        },
        {
            id: proximaId++,
            usuarioId,
            descricao: `${descricaoBase} (Restante 60%)`,
            valor: valorRestante,
            tipo: 'entrada',
            categoriaId: Number(categoriaId),
            formaPagamento: 'BOLETO',
            cartaoId: null,
            vencimento: dataFimMes,
            recorrencia: 'mensal',
            parcelaAtual: 1,
            totalParcelas: 1,
            observacao: 'Gerado automaticamente',
            horaExtra: 0,
            servicoEssencial: 'nao',
            pago: true
        }
    ];

    dados.lancamentos.push(...entradasSalario);

    registrarLogInterno(dados, "SALÁRIO FRACIONADO", `Adiantamento e saldo cadastrados para ${descricaoBase}: R$ ${valorTotalSalario}`);
    await salvarDados(dados);

    esconderLoading();
    processandoAcaoModal = false;
    await mostrarAlertaModal("Salário fracionado cadastrado com sucesso (Dia 15 e Final do Mês)!");
    if (typeof carregarDashboard === 'function') carregarDashboard();
    if (typeof carregarRelatorios === 'function') carregarRelatorios();
}

function verificarCategoriaSalario() {
    const selectCat = document.getElementById('categoriaLancamento');
    const tipoSelect = document.getElementById('tipoLancamento');

    if (!selectCat || !tipoSelect || tipoSelect.value !== 'entrada') {
        return;
    }

    const dados = obterDados();
    const catSelecionada = dados.categorias.find(
        c => String(c.id) === String(selectCat.value)
    );

    if (
        catSelecionada &&
        normalizarTexto(catSelecionada.nome).includes('adiantamento')
    ) {
        carregarEPreencherAdiantamentoMemorizado();
    }
}

function carregarEPreencherAdiantamentoMemorizado() {
    const inputValor =
        document.getElementById('valorTotalLancamento') ||
        document.getElementById('valorTotal') ||
        document.getElementById('valorLancamento');

    const inputData =
        document.getElementById('vencimentoLancamento') ||
        document.getElementById('vencimento');

    const usuarioId = localStorage.getItem('usuarioLogado');
    const chaveMemoria = `adiantamentoSalario_u${usuarioId}`;
    const salvoStr = localStorage.getItem(chaveMemoria);

    if (salvoStr) {
        try {
            const salvo = JSON.parse(salvoStr);

            if (inputValor && salvo?.valor != null) {
                inputValor.value = salvo.valor;
            }
        } catch (erro) {
            console.warn(
                'Não foi possível ler a memória do adiantamento:',
                erro
            );
            localStorage.removeItem(chaveMemoria);
        }
    }

    if (inputData && inputData.value) {
        const partes = inputData.value.split('-');

        if (partes.length === 3) {
            partes[2] = '15';
            inputData.value = partes.join('-');
        }
    }
}

function salvarMemoriaAdiantamentoSeNecessario(descricao, valor) {
    const selectCat = document.getElementById('categoriaLancamento');
    const dados = obterDados();
    if (!selectCat) return;

    const catSelecionada = dados.categorias.find(c => Number(c.id) === Number(selectCat.value));
    if (catSelecionada && catSelecionada.nome.toLowerCase().includes('adiantamento')) {
        const usuarioId = localStorage.getItem('usuarioLogado');
        const chaveMemoria = `adiantamentoSalario_u${usuarioId}`;
        localStorage.setItem(chaveMemoria, JSON.stringify({ descricao, valor }));
    }
}

function renderizarSinoNotificacoes() {
    // Reaproveita o botão de notificação que já existe no HTML de cada página
    // (#btnNotificacoesHeader), em vez de criar um segundo botão em outro lugar do cabeçalho.
    const sinoBtn = document.getElementById('btnNotificacoesHeader');
    if (!sinoBtn) return;

    const dados = obterDados();
    const usuarioId = localStorage.getItem('usuarioLogado');
    const notificacoes = dados.notificacoes || [];
    
    // Conta quantas notificações não lidas o usuário tem
    const naoLidas = notificacoes.filter(n => Number(n.usuarioDestinoId) === Number(usuarioId) && !n.lida).length;

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

    // Marca todas como lidas ao abrir
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
            <div style="max-height: 350px; overflow-y: auto; margin: 16px 0; padding-right: 4px;">
                ${itensHtml}
            </div>
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
        // Vincula o parceiro reciprocamente
        usuarioDestino.parceiroId = remetente.id;
        remetente.parceiroId = usuarioDestino.id;

        // Notifica o remetente que foi aprovado
        dados.notificacoes.push({
            id: gerarId('notif'),
            usuarioDestinoId: remetente.id,
            remetenteId: usuarioDestino.id,
            tipo: 'resposta_parceiro',
            titulo: 'Parceiro Aprovado! 🤝',
            mensagem: `${usuarioDestino.nome} aprovou o seu atrelamento como parceiro no sistema.`,
            lida: false,
            statusAprovacao: 'aprovado',
            createdAt: new Date().toISOString()
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
                    <input type="password" class="modal-input" id="regSenha" placeholder="Digite sua senha" autocomplete="off" style="min-height: 44px;">
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

        if (!usuario || !nome || !senha) {
            await mostrarAlertaModal('Preencha todos os campos para continuar.');
            return;
        }

        const dados = obterDados();
        if (!Array.isArray(dados.usuarios)) dados.usuarios = [];

        const jaExiste = dados.usuarios.some(u => normalizarTexto(u.usuario || u.nome) === normalizarTexto(usuario));
        if (jaExiste) {
            await mostrarAlertaModal('Este nome de usuário já está cadastrado.');
            return;
        }

        const novoId = dados.usuarios.reduce((max, u) => Math.max(max, Number(u.id) || 0), 0) + 1;

        dados.usuarios.push({
            id: novoId,
            usuario: usuario,
            nome: nome,
            pin: senha,
            senha: senha,
            ativo: true
        });

        registrarLogInterno(dados, "CADASTRO USUÁRIO", `Novo usuário cadastrado via Primeiro Acesso: ${nome} (${usuario})`);
        await salvarDados(dados);

        fecharModal(overlay);
        await mostrarAlertaModal('Cadastro realizado com sucesso! Agora você já pode fazer o login.');
    };
}

async function atualizarLancamentoInteligente(id, novosDados) {
    const dados = obterDados();
    const lancamento = dados.lancamentos.find(l => Number(l.id) === Number(id));
    if (!lancamento) {
        await mostrarAlertaModal("Lançamento não encontrado.");
        return;
    }

    // Validação da relação (se é compra parcelada ou financiamento)
    const grupoParcelamentoId = resolverParcelamentoId(lancamento);
    const financiamentoId = resolverFinanciamentoIdPorLancamento(lancamento, dados);
    const ehVinculado = Boolean(grupoParcelamentoId) || Boolean(financiamentoId) || (lancamento.totalParcelas && lancamento.totalParcelas > 1);

    let aplicarParaTodas = false;
    if (ehVinculado) {
        const escolha = await mostrarOpcaoEscopoModal("Este lançamento faz parte de um financiamento ou compra parcelada. Deseja tornar essa modificação para todas outras parcelas?");
        if (escolha === null) return; // Cancelado pelo utilizador
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
        // Seleciona todos os lançamentos do mesmo grupo (financiamento ou parcelamento)
        const relacionados = financiamentoId 
            ? dados.lancamentos.filter(l => Number(l.financiamentoId) === Number(financiamentoId))
            : dados.lancamentos.filter(l => String(l.parcelamentoId) === String(grupoParcelamentoId));

        relacionados.forEach(l => {
            const descricaoAntiga = l.descricao;
            const valorAntigo = l.valor;

            // Mantém o prefixo/sufixo do número da parcela (ex: " (2/12)") e atualiza o resto
            const sufixoMatch = l.descricao.match(/\s\(\d+\/\d+\)$/);
            const sufixo = sufixoMatch ? sufixoMatch[0] : '';
            const baseNovaDescricao = novosDados.descricao.replace(/\s\(\d+\/\d+\)$/, '').trim();
            l.descricao = sufixo ? `${baseNovaDescricao}${sufixo}` : baseNovaDescricao;

            l.tipo = novosDados.tipo;
            l.categoriaId = novosDados.categoriaId;
            l.formaPagamento = novosDados.formaPagamento;
            // Se for lote/financiamento, preserva o valor individual de cada parcela ou aplica o novo se desejado
            l.observacao = novosDados.observacao;
            l.servicoEssencial = novosDados.tipo === 'saida' ? (novosDados.servicoEssencial || 'nao') : 'nao';
            l.escopo = novosDados.tipo === 'saida' ? (novosDados.escopo || 'casal') : 'casal';
            l.updatedAt = new Date().toISOString();

            if (novosDados.formaPagamento === 'CARTAO') {
                l.cartaoId = novosDados.cartaoId || l.cartaoId || null;
            }

            dados.edicao_movimento.push({
                dataHora: dataHoraAtual,
                usuario: nomeUsuario,
                lancamentoId: l.id,
                descricaoAntiga: descricaoAntiga,
                descricaoNova: l.descricao,
                valorAntigo: valorAntigo,
                valorNovo: l.valor,
                motivo: `[EM LOTE] ${motivo}`
            });
        });

        registrarLogInterno(dados, "EDIÇÃO EM LOTE", `Atualizadas ${relacionados.length} parcelas vinculadas. Motivo: ${motivo}`);
    } else {
        // Atualiza apenas a parcela selecionada individualmente
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
            dataHora: dataHoraAtual,
            usuario: nomeUsuario,
            lancamentoId: id,
            descricaoAntiga: descricaoAntiga,
            descricaoNova: novosDados.descricao,
            valorAntigo: valorAntigo,
            valorNovo: novosDados.valor,
            motivo: motivo
        });

        registrarLogInterno(dados, "EDIÇÃO LANÇAMENTO", `Lançamento ID ${id} atualizado. Motivo: ${motivo}`);
    }

    await salvarDados(dados);
    esconderLoading();
    await mostrarAlertaModal("Lançamento(s) atualizado(s) com sucesso!");
    
    if (typeof carregarDashboard === 'function') carregarDashboard();
    if (typeof carregarRelatorios === 'function') carregarRelatorios();
}

function calcularStatusParcelaCartao(dataVencimentoStr, cartaoObj, dataCompraStr) {
    if (!cartaoObj || !cartaoObj.fechamento) return 'pendente';
    
    const hoje = new Date();
    const [anoVenc, mesVenc, diaVenc] = String(dataVencimentoStr).split('-').map(Number);
    
    // Data de fechamento da fatura correspondente ao mês/ano do vencimento
    // Geralmente o fechamento ocorre alguns dias antes do vencimento no mesmo ciclo ou mês anterior
    const dataFechamento = new Date(anoVenc, mesVenc - 1, Number(cartaoObj.fechamento));
    // Se o dia de fechamento for menor que o vencimento, o fechamento costuma ser no mês anterior
    dataFechamento.setMonth(dataFechamento.getMonth() - 1);

    // Se a data atual já passou da data de fechamento desta fatura, considera-se que a fatura já fechou (portanto, pendente de pagamento se não paga)
    // Se a data atual é ANTERIOR ao fechamento, as parcelas anteriores a este ciclo assumem-se pagas.
    if (hoje > dataFechamento) {
        return 'pendente';
    } else {
        return 'pago';
    }
}

function redirecionarNovoLancamento(tipoAcao) {
    if (tipoAcao === 'entrada') {
        window.location.href = 'lancamentos.html?tipo=entrada';
        return;
    }

    if (tipoAcao === 'saida') {
        window.location.href = 'lancamentos.html?tipo=saida&forma=DINHEIRO';
        return;
    }

    if (tipoAcao === 'cartao') {
        const dados = obterDados();
        const usuarioAtualId = Number(obterUsuarioAtualId(dados));
        const cartoes = (dados.cartoes || []).filter(c => c.ativo !== false && Number(c.usuarioId) === usuarioAtualId);

        if (!cartoes.length) {
            mostrarAlertaModal('Nenhum cartão ativo cadastrado para o seu usuário. Cadastre um cartão primeiro em Cadastros > Cartões.');
            return;
        }

        const hoje = new Date();
        const diaAtual = hoje.getDate(); // Ex: 24

        let cartaoEscolhido = cartoes[0];

        // Lógica de intervalo:
        // Cartão 1 (Vencimento dia 13): Vigência do dia 13 até 25
        // Cartão 2 (Vencimento dia 26): Vigência do dia 26 até 12
        cartoes.forEach(c => {
            const vencimento = Number(c.diaVencimento || c.vencimento || 1);
            
            if (vencimento === 13) {
                if (diaAtual >= 13 && diaAtual <= 25) {
                    cartaoEscolhido = c;
                }
            } else if (vencimento === 26) {
                if (diaAtual >= 26 || diaAtual <= 12) {
                    cartaoEscolhido = c;
                }
            }
        });

        const cartaoId = cartaoEscolhido ? cartaoEscolhido.id : cartoes[0].id;
        window.location.href = `lancamentos.html?tipo=saida&forma=CARTAO&cartaoId=${cartaoId}`;
    }
}

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
        esconderLoading();
        processandoAcaoModal = false;
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
        esconderLoading();
        processandoAcaoModal = false;
        await mostrarAlertaModal('Já existe uma categoria com este nome e tipo.');
        return false;
    }

    const novaId = dados.categorias.reduce((m, c) => Math.max(m, Number(c.id) || 0), 0) + 1;
    dados.categorias.push({ 
        id: novaId, 
        nome: String(nome).trim(), 
        tipo, 
        classificacao: 'personalizado', 
        criadopor: usuarioAtualId 
    });

    registrarLogInterno(dados, "CADASTRO CATEGORIA", `Categoria personalizada criada: ${nome} (${tipo})`);
    await salvarDados(dados);
    
    esconderLoading();
    processandoAcaoModal = false;
    await mostrarAlertaModal("Categoria cadastrada com sucesso!");
    if (typeof renderizarCategorias === 'function') renderizarCategorias();
    return true;
}

async function atualizarCategoria(id, nome, tipo) {
    if (processandoAcaoModal) return false;
    if (!await verificarSenhaAdmin("editar categoria")) return false;

    processandoAcaoModal = true;
    mostrarLoading("Atualizando categoria...");
    try {
        const dados = obterDados();
        const categoria = dados.categorias.find(c => String(c.id) === String(id));
        const nomeNormalizado = normalizarTexto(nome);
        
        if (!categoria || !nomeNormalizado || !['entrada', 'saida'].includes(tipo)) {
            throw new Error('Dados da categoria inválidos.');
        }

        if (categoria.classificacao === 'padrao' || Number(categoria.criadopor) === 5) {
            throw new Error('Categorias padrão do sistema não podem ser alteradas.');
        }

        const duplicada = dados.categorias.some(c =>
            String(c.id) !== String(id) &&
            c.tipo === tipo &&
            normalizarTexto(c.nome) === nomeNormalizado
        );
        if (duplicada) throw new Error('Já existe outra categoria com este nome e tipo.');

        const tipoAntigo = categoria.tipo;
        categoria.nome = String(nome).trim();
        categoria.tipo = tipo;
        categoria.updatedAt = new Date().toISOString();

        if (tipoAntigo !== tipo) {
            dados.lancamentos.forEach(l => {
                if (String(l.categoriaId) === String(id)) {
                    l.updatedAt = new Date().toISOString();
                }
            });
        }

        registrarLogInterno(dados, "EDIÇÃO CATEGORIA", `Categoria ID ${id} alterada para: ${categoria.nome} (${tipo})`);
        await salvarDados(dados);

        esconderLoading();
        processandoAcaoModal = false;
        await mostrarAlertaModal("Categoria atualizada com sucesso!");
        if (typeof renderizarCategorias === 'function') renderizarCategorias();
        return true;
    } catch (erro) {
        esconderLoading();
        processandoAcaoModal = false;
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
        esconderLoading();
        processandoAcaoModal = false;
        await mostrarAlertaModal('Categorias padrão do sistema não podem ser excluídas.');
        return false;
    }

    const emUso = dados.lancamentos.some(l => Number(l.categoriaId) === Number(id)) ||
        dados.financiamentos.some(f => Number(f.categoriaId) === Number(id));
    
    if (emUso) {
        esconderLoading();
        processandoAcaoModal = false;
        await mostrarAlertaModal('Esta categoria está vinculada a lançamentos ou financiamentos e não pode ser excluída.');
        return false;
    }

    dados.categorias = dados.categorias.filter(c => String(c.id) !== String(id));
    registrarLogInterno(dados, "EXCLUSÃO CATEGORIA", `Categoria ID ${id} excluída`);
    await salvarDados(dados);
    
    esconderLoading();
    processandoAcaoModal = false;
    await mostrarAlertaModal("Categoria excluída com sucesso!");
    if (typeof renderizarCategorias === 'function') renderizarCategorias();
    return true;
}

function renderizarCategorias() {
    const dados = obterDados();
    const lista = document.getElementById('listaCategorias');
    if (!lista) return;
    lista.innerHTML = '';
    
    const filtroSelect = document.getElementById('filtroTipoCategoria');
    const filtroValor = filtroSelect ? filtroSelect.value : 'todos';

    let categoriasPermitidas = dados.categorias || [];

    if (filtroValor !== 'todos') {
        categoriasPermitidas = categoriasPermitidas.filter(c => c.tipo === filtroValor);
    }

    if (categoriasPermitidas.length === 0) {
        lista.innerHTML = '<li>Nenhuma categoria encontrada.</li>';
        return;
    }

    // Lista com os nomes exatos das categorias que quer considerar como padrão do sistema
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