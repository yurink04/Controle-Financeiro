const DB_KEY = 'sistemaFinanceiroCompartilhado';
const BACKUP_TESTE_KEY = 'sistemaFinanceiroBackupTeste';
const API_URL = "https://script.google.com/macros/s/AKfycbzaixW_fEhGFOwQVmnc7H2DV8vLNp7qxwjojucMg7XNeF9PTdGv5T1VKZGaWm-nRdmO/exec";
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

// Trava global para evitar duplo envio/duplicação em modais e caixas de diálogo
let processandoAcaoModal = false;

/* =========================
   NÚCLEO / UTILITÁRIOS
   ========================= */
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
    criarIndicadorSincronizacaoUi();
});

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
    if (document.getElementById('syncIndicator')) return;
    const chip = document.createElement('span');
    chip.id = 'syncIndicator';
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
        userChip.parentNode.appendChild(chip);
    }
}

function atualizarIndicadorSyncUI(status) {
    const chip = document.getElementById('syncIndicator');
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

// Antes o app só ENVIAVA dados para a planilha (sincronizarComServidor);
// não existia nenhuma forma de trazer de volta o que estava salvo na nuvem.
// Isso é usado pelo botão "Restaurar da nuvem" em configuracoes.html —
// é uma ação explícita e confirmada pelo usuário, nunca automática, para
// não sobrescrever dados locais mais recentes sem aviso.
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

async function selecionarUsuario(id) {
    const dados = obterDados();
    const usuario = dados.usuarios.find(u => Number(u.id) === Number(id));
    if (!usuario) return false;

    // Se o usuário não tem PIN cadastrado, é o primeiro acesso!
    if (!usuario.pin || String(usuario.pin).trim() === "") {
        const novoPin = await mostrarPromptSenha(
            "Primeiro Acesso - Cadastrar PIN",
            `Olá, ${usuario.nome}! Crie um PIN numérico seguro para proteger seus acessos futuros:`
        );
        
        if (!novoPin || novoPin.length < 4) {
            await mostrarAlertaModal("O PIN precisa ter pelo menos 4 dígitos.");
            return false;
        }

        // Salva o PIN de forma permanente no usuário
        usuario.pin = novoPin;
        registrarLogInterno(dados, "CADASTRO PIN", `Usuário ${usuario.nome} cadastrou o PIN de acesso pela primeira vez.`);
        await salvarDados(dados);
        await mostrarAlertaModal("PIN cadastrado com sucesso! Guarde-o bem.");
    } else {
        // Já tem PIN, solicita a confirmação
        const senhaDigitada = await mostrarPromptSenha(
            "Verificação de PIN",
            `Digite o PIN de acesso para ${usuario.nome}:`
        );
        if (senhaDigitada === null || senhaDigitada !== String(usuario.pin).trim()) {
            await mostrarAlertaModal("PIN incorreto.");
            return false;
        }
    }

    mostrarLoading("Entrando no sistema...");
    localStorage.setItem('usuarioLogado', String(usuario.id));

    if (normalizarTexto(usuario.nome) === 'teste') {
        localStorage.setItem(BACKUP_TESTE_KEY, JSON.stringify(dados));
    }

    registrarLogInterno(dados, "LOGIN", "Usuário acessou o sistema");
    await salvarDados(dados);
    esconderLoading();
    window.location.href = 'dashboard.html';
    return true;
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
        spanNome.innerHTML = `Perfil: <strong>${usuario.nome}</strong> ⚙️`;
        spanNome.onclick = () => {
            window.location.href = 'perfil.html';
        };
    }

    // Chama a renderização do sino de notificações na barra de navegação
    renderizarSinoNotificacoes();

    return true;
}

/* =========================
   MODAIS
   ========================= */
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

function mostrarPromptSenha(titulo, descricao) {
    return new Promise(resolve => {
        const { overlay } = criarModalBase({
            titulo,
            mensagem: descricao,
            htmlExtra: `
                <input type="password" class="modal-input" data-valor maxlength="32" autocomplete="off" inputmode="numeric" placeholder="Digite a senha">
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
    if (!nomeNormalizado || !['entrada', 'saida'].includes(tipo)) {
        esconderLoading();
        processandoAcaoModal = false;
        await mostrarAlertaModal('Dados da categoria inválidos.');
        return false;
    }
    if (dados.categorias.some(c => c.tipo === tipo && normalizarTexto(c.nome) === nomeNormalizado)) {
        esconderLoading();
        processandoAcaoModal = false;
        await mostrarAlertaModal('Já existe uma categoria com este nome e tipo.');
        return false;
    }
    const novaId = dados.categorias.reduce((m, c) => Math.max(m, Number(c.id) || 0), 0) + 1;
    dados.categorias.push({ id: novaId, nome: String(nome).trim(), tipo });
    registrarLogInterno(dados, "CADASTRO CATEGORIA", `Categoria criada: ${nome} (${tipo})`);
    await salvarDados(dados);
    
    esconderLoading();
    processandoAcaoModal = false;
    await mostrarAlertaModal("Categoria cadastrada com sucesso!");
    if (typeof renderizarCategorias === 'function') renderizarCategorias();
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
        console.error(erro);
        esconderLoading();
        processandoAcaoModal = false;
        await mostrarAlertaModal(erro.message || 'Não foi possível atualizar a categoria.');
        return false;
    }
}

async function excluirCategoria(id) {
    if (processandoAcaoModal) return;
    if (!await verificarSenhaAdmin("excluir categoria")) return;
    
    processandoAcaoModal = true;
    mostrarLoading("Excluindo categoria...");
    const dados = obterDados();
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
}

function renderizarCategorias() {
    const dados = obterDados();
    const lista = document.getElementById('listaCategorias');
    if (!lista) return;
    lista.innerHTML = '';
    
    const filtroSelect = document.getElementById('filtroTipoCategoria');
    const filtroValor = filtroSelect ? filtroSelect.value : 'todos';

    let categoriasFiltradas = dados.categorias;
    if (filtroValor !== 'todos') {
        categoriasFiltradas = dados.categorias.filter(c => c.tipo === filtroValor);
    }

    if (categoriasFiltradas.length === 0) {
        lista.innerHTML = '<li>Nenhuma categoria encontrada para este filtro.</li>';
        return;
    }

    categoriasFiltradas.forEach(cat => {
        const li = document.createElement('li');
        li.innerHTML = `
            <span>${cat.nome} (<strong>${cat.tipo.toUpperCase()}</strong>)</span>
            <div>
                <button onclick="prepararEdicaoCategoria(${cat.id}, '${cat.nome}', '${cat.tipo}')" class="btn-acao-icone editar" title="Editar"><img src="imagens/editar.png" alt="Editar"></button>
                <button onclick="excluirCategoriaPrompt(${cat.id})" class="btn-acao-icone excluir" title="Excluir"><img src="imagens/excluir.png" alt="Excluir"></button>
            </div>
        `;
        lista.appendChild(li);
    });
}

// A gestão de cartões (criar/editar/excluir/renderizar) vive em cartoes.html,
// que usa os campos reais `limite` e `isBeneficio` (ver Code.gs SCHEMA.cartoes).
// Antes havia aqui uma implementação paralela com campos `limiteTotal`/`tipoCartao`
// que nunca era chamada por nenhuma página e divergia do schema salvo na planilha.

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

    if (!selectForma) return;

    const usaCartao = selectForma.value === 'CARTAO';

    if (blocoCartao) blocoCartao.style.display = usaCartao ? 'block' : 'none';
    if (blocoVencimento) blocoVencimento.style.display = usaCartao ? 'none' : 'block';
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

        for (let i = 1; i <= qtdGerar; i++) {
            const dataVenc = adicionarMesesClamped(dataBase, i - 1);
            const descricaoParcelada = qtdGerar > 1
                ? `${String(dadosForm.descricao).trim()} (${i}/${qtdGerar})`
                : String(dadosForm.descricao).trim();
            const pagamento = dadosForm.formaPagamento === 'FIXO' ? 'BOLETO' : dadosForm.formaPagamento;
            const pagoInicial = dadosForm.tipo === 'entrada';

            dados.lancamentos.push({
                id: proximaId++,
                usuarioId,
                descricao: descricaoParcelada,
                valor: valoresParcelas[i - 1],
                tipo: dadosForm.tipo,
                categoriaId,
                formaPagamento: pagamento,
                cartaoId: dadosForm.cartaoId || null,
                dataCompra: dadosForm.dataCompra || null,
                vencimento: dataParaString(dataVenc),
                recorrencia: dadosForm.formaPagamento === 'FIXO' ? 'mensal' : 'unica',
                parcelaAtual: i,
                totalParcelas: qtdGerar,
                parcelamentoId,
                observacao: dadosForm.observacao || '',
                horaExtra: valoresHoraExtra[i - 1],
                servicoEssencial: dadosForm.tipo === 'saida' ? (dadosForm.servicoEssencial || 'nao') : 'nao',
                
                // >>> AJUSTE AQUI: salva o escopo selecionado (ou 'casal' se for entrada) <<<
                escopo: dadosForm.tipo === 'saida' ? (dadosForm.escopo || 'casal') : 'casal',
                
                pago: pagoInicial,
                status: pagoInicial ? 'pago' : 'pendente',
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
async function atualizarLancamentoNoBanco(id, novosDados) {
    const motivo = await mostrarPromptTextoModal("Justificativa Obrigatória", "Informe o motivo da edição deste lançamento:");
    if (!motivo) return;

    mostrarLoading("Atualizando lançamento...");
    const dados = obterDados();
    const lancamento = dados.lancamentos.find(l => Number(l.id) === Number(id));
    if (lancamento) {
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
        
        // >>> AJUSTE AQUI: atualiza o escopo na edição <<<
        lancamento.escopo = novosDados.tipo === 'saida' ? (novosDados.escopo || 'casal') : 'casal';
        
        const usuarioId = localStorage.getItem('usuarioLogado');
        const u = dados.usuarios.find(user => user.id == usuarioId);
        const nomeUsuario = u ? u.nome : "Desconhecido";

        dados.edicao_movimento.push({
            dataHora: new Date().toLocaleString('pt-BR'),
            usuario: nomeUsuario,
            lancamentoId: id,
            descricaoAntiga: descricaoAntiga,
            descricaoNova: novosDados.descricao,
            valorAntigo: valorAntigo,
            valorNovo: novosDados.valor,
            motivo: motivo
        });

        registrarLogInterno(dados, "EDIÇÃO LANÇAMENTO", `Lançamento ID ${id} atualizado. Motivo: ${motivo}`);
        await salvarDados(dados);
        
        esconderLoading();
        await mostrarAlertaModal("Lançamento atualizado com sucesso!");
        if (typeof carregarDashboard === 'function') carregarDashboard();
        if (typeof carregarRelatorios === 'function') carregarRelatorios();
    } else {
        esconderLoading();
    }
}

async function adicionarFinanciamentoComRecorrencia(nome, recorrente, valorParcela, qtdMeses, primeiroVencimento, categoriaId = null) {
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

        const financiamentoId = dados.financiamentos.reduce((m, f) => Math.max(m, Number(f.id) || 0), 0) + 1;
        const parcelamentoId = gerarId('finparc');
        const totalMeses = recorrente === 'sim' ? meses : 1;

        dados.financiamentos.push({
            id: financiamentoId,
            usuarioId,
            nome: nomeFinal,
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
                vencimento: dataParaString(dataVenc),
                recorrencia: 'mensal',
                parcelaAtual: i,
                totalParcelas: totalMeses,
                parcelamentoId,
                financiamentoId,
                observacao: 'Gerado automaticamente pelo contrato',
                horaExtra: 0,
                servicoEssencial: 'nao',
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
    const dados = obterDados();
    
    const usuariosMap = {};
    dados.usuarios.forEach(u => {
        usuariosMap[u.id] = u.nome;
    });

    const selectCatDash = document.getElementById('filtroCategoriaDashboard');
    if (selectCatDash && selectCatDash.options.length <= 1) {
        const valorAtualCat = selectCatDash.value;
        selectCatDash.innerHTML = '<option value="todas">Todas as Categorias</option>';
        
        dados.categorias
            .filter(cat => cat.tipo === 'saida')
            .forEach(cat => {
                const opt = document.createElement('option');
                opt.value = cat.id;
                opt.innerText = cat.nome;
                selectCatDash.appendChild(opt);
            });
            
        if (valorAtualCat) selectCatDash.value = valorAtualCat;
    }

    const filtroMesInput = document.getElementById('filtroMesAno');
    const mesAnoSelecionado = filtroMesInput ? filtroMesInput.value : '';
    const categoriaSelecionadaId = selectCatDash ? selectCatDash.value : 'todas';

    const lancamentosFiltrados = dados.lancamentos.filter(l => {
        if (mesAnoSelecionado && l.vencimento && !l.vencimento.startsWith(mesAnoSelecionado)) {
            return false;
        }
        if (categoriaSelecionadaId !== 'todas' && Number(l.categoriaId) !== Number(categoriaSelecionadaId)) {
            return false;
        }
        return true;
    });

    let totalEntradas = 0;
    let totalSaidas = 0;
    let totalSaidasCartao = 0;
    let totalSaidasOutros = 0;

    lancamentosFiltrados.forEach(l => {
        if (l.tipo === 'entrada') {
            totalEntradas += Number(l.valor);
        }
        if (l.tipo === 'saida') {
            const val = Number(l.valor);
            totalSaidas += val;
            if (l.formaPagamento === 'CARTAO' || l.cartaoId) {
                totalSaidasCartao += val;
            } else {
                totalSaidasOutros += val;
            }
        }
    });

    const elTotalEntradas = document.getElementById('totalEntradas');
    const elTotalSaidas = document.getElementById('totalSaidas');
    if (elTotalEntradas) elTotalEntradas.innerText = `R$ ${totalEntradas.toFixed(2)}`;
    if (elTotalSaidas) elTotalSaidas.innerText = `R$ ${totalSaidas.toFixed(2)}`;
    
    const elSaidasCartao = document.getElementById('saidasCartao');
    const elSaidasOutros = document.getElementById('saidasOutros');
    if (elSaidasCartao) elSaidasCartao.innerText = `R$ ${totalSaidasCartao.toFixed(2)}`;
    if (elSaidasOutros) elSaidasOutros.innerText = `R$ ${totalSaidasOutros.toFixed(2)}`;
    
    const saldo = totalEntradas - totalSaidas;
    const elSaldo = document.getElementById('saldoGeral');
    if (elSaldo) {
        elSaldo.innerText = `R$ ${saldo.toFixed(2)}`;
        elSaldo.className = saldo >= 0 ? 'positivo' : 'negativo';
    }

    atualizarGraficosDashboard(totalEntradas, totalSaidas, dados);

    const ulProximos = document.getElementById('listaProximosPagamentos');
    if (ulProximos) {
        ulProximos.innerHTML = '';
        
        const hoje = new Date();
        hoje.setHours(0, 0, 0, 0);
        const hojeStr = hoje.toISOString().split('T')[0];

        const daqui30Dias = new Date();
        daqui30Dias.setDate(hoje.getDate() + 30);
        daqui30Dias.setHours(23, 59, 59, 999);
        const daqui30DiasStr = daqui30Dias.toISOString().split('T')[0];

        const contasNormaisPendentes = lancamentosFiltrados.filter(l => {
            if (l.tipo !== 'saida' || l.formaPagamento === 'CARTAO' || l.pago || !l.vencimento) return false;
            return l.vencimento >= hojeStr && l.vencimento <= daqui30DiasStr;
        });

        const faturasConsolidadasMap = {};
        dados.lancamentos.filter(l => l.tipo === 'saida' && l.formaPagamento === 'CARTAO' && l.cartaoId && l.vencimento && !l.pago).forEach(l => {
            const cartao = dados.cartoes.find(c => Number(c.id) === Number(l.cartaoId));
            const nomeCartao = cartao ? cartao.nome : 'Cartão';
            const mesVencimentoFatura = l.vencimento.substring(0, 7);
            const chaveFatura = `${l.cartaoId}_${mesVencimentoFatura}`;

            if (!faturasConsolidadasMap[chaveFatura]) {
                faturasConsolidadasMap[chaveFatura] = {
                    tipoItem: 'fatura',
                    cartaoId: l.cartaoId,
                    nomeCartao: nomeCartao,
                    vencimento: l.vencimento,
                    valorTotal: 0
                };
            }
            faturasConsolidadasMap[chaveFatura].valorTotal += Number(l.valor);
        });

        const faturasPendentesPeriodo = Object.values(faturasConsolidadasMap).filter(f => {
            return f.vencimento >= hojeStr && f.vencimento <= daqui30DiasStr;
        });

        const listaProximosGeral = [...contasNormaisPendentes, ...faturasPendentesPeriodo];

        if (listaProximosGeral.length === 0) {
            ulProximos.innerHTML = '<li>Nenhum pagamento pendente para os próximos 30 dias com este filtro.</li>';
        } else {
            listaProximosGeral.sort((a, b) => a.vencimento.localeCompare(b.vencimento));
            listaProximosGeral.forEach(item => {
                const li = document.createElement('li');
                const [ano, mes, dia] = item.vencimento.split('-');
                const dataFormatada = `${dia}/${mes}/${ano}`;

                if (item.tipoItem === 'fatura') {
                    li.innerHTML = `
                        <span><strong>Fatura - ${item.nomeCartao}</strong> (Vence: ${dataFormatada})</span>
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <button onclick="abrirDetalhamentoFatura('${item.cartaoId}', '${item.vencimento.substring(0, 7)}')" class="btn-acao-icone visualizar" title="Visualizar Detalhes"><img src="imagens/visualizar.png" alt="Visualizar"></button>
                            <strong class="negativo">R$ ${item.valorTotal.toFixed(2)}</strong>
                        </div>
                    `;
                } else {
                    let textoFormaPgto = item.formaPagamento;
                    li.innerHTML = `
                        <span><strong>${item.descricao}</strong> (Vence: ${dataFormatada}) <br><small style="color: var(--text-muted);">Pagamento: <strong>${textoFormaPgto}</strong></small></span>
                        <strong class="negativo">R$ ${Number(item.valor).toFixed(2)}</strong>
                    `;
                }
                ulProximos.appendChild(li);
            });
        }
    }

    const selectTipoLanc = document.getElementById('filtroTipoUltimosLancamentos');
    const tipoSelecionado = selectTipoLanc ? selectTipoLanc.value : 'todos';

    let lancamentosTabela = lancamentosFiltrados.filter(l => {
        if (tipoSelecionado !== 'todos' && l.tipo !== tipoSelecionado) {
            return false;
        }
        return true;
    });

    const tbody = document.getElementById('tabelaUltimosLancamentos');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (lancamentosTabela.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align: center;">Nenhum lançamento encontrado para os filtros selecionados.</td></tr>`;
        return;
    }

    const ultimos = [...lancamentosTabela].reverse();
    ultimos.forEach(l => {
        const cat = dados.categorias.find(c => Number(c.id) === Number(l.categoriaId));
        
        let textoFormaPgtoTabela = l.formaPagamento;
        if (l.tipo === 'entrada') {
            textoFormaPgtoTabela = 'Entrada / Receita';
        } else if (l.formaPagamento === 'CARTAO' && l.cartaoId) {
            const cartaoObj = dados.cartoes.find(c => Number(c.id) === Number(l.cartaoId));
            textoFormaPgtoTabela = cartaoObj ? `Cartão (${cartaoObj.nome})` : 'Cartão';
        }

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${usuariosMap[l.usuarioId] || 'Desconhecido'}</td>
            <td>${l.descricao} ${l.horaExtra ? `<br><small style="color:#10b981;">(HE inclusa: R$ ${Number(l.horaExtra).toFixed(2)})</small>` : ''} ${l.observacao ? `<br><small style="color:#64748b;">Obs: ${l.observacao}</small>` : ''}</td>
            <td>${cat ? cat.nome : '-'}</td>
            <td>${textoFormaPgtoTabela}</td>
            <td>${l.vencimento}</td>
            <td class="${l.tipo === 'entrada' ? 'positivo' : 'negativo'}">R$ ${Number(l.valor).toFixed(2)}</td>
            <td>
                <button onclick="window.location.href='editar-lancamento.html?id=${l.id}'" class="btn-acao-icone editar" title="Editar"><img src="imagens/editar.png" alt="Editar"></button>
                <button onclick="removerLancamentoInteligente(${l.id})" class="btn-acao-icone excluir" title="Excluir"><img src="imagens/excluir.png" alt="Excluir"></button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function atualizarGraficosDashboard(totalEntradas, totalSaidas, dados) {
    const usuarioLogadoId = parseInt(localStorage.getItem('usuarioLogado'));

    const canvasES = document.getElementById('graficoEntradasSaidas');
    if (canvasES) {
        if (chartEntradasSaidasInstance) {
            chartEntradasSaidasInstance.destroy();
        }
        chartEntradasSaidasInstance = new Chart(canvasES, {
            type: 'pie',
            data: {
                labels: ['Entradas', 'Saídas'],
                datasets: [{
                    data: [totalEntradas, totalSaidas],
                    backgroundColor: ['#10b981', '#ef4444'],
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'bottom', labels: { boxWidth: 12 } }
                }
            }
        });
    }

    const filtroMesInput = document.getElementById('filtroMesAno');
    const mesAnoSelecionado = filtroMesInput ? filtroMesInput.value : '';
    const selectCatDash = document.getElementById('filtroCategoriaDashboard');
    const categoriaSelecionadaId = selectCatDash ? selectCatDash.value : 'todas';

    const lancamentosPeriodo = dados.lancamentos.filter(l => {
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
        if (chartGastosCategoriasInstance) {
            chartGastosCategoriasInstance.destroy();
        }
        
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
                plugins: {
                    legend: { position: 'bottom', labels: { boxWidth: 12 } }
                }
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
        if (chartServicosEssenciaisInstance) {
            chartServicosEssenciaisInstance.destroy();
        }

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
                plugins: {
                    legend: { position: 'bottom', labels: { boxWidth: 12 } }
                }
            }
        });
    }

    const selectFiltroCartao = document.getElementById('filtroGraficoCartao');
    const cartoesUsuario = dados.cartoes.filter(c => c.usuarioId === usuarioLogadoId);
    
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
            const gastoUtilizado = dados.lancamentos
                .filter(l => Number(l.cartaoId) === Number(cartao.id) && !l.pago)
                .reduce((acc, l) => acc + Number(l.valor), 0);
            
            totalLimiteGeral += Number(cartao.limiteTotal);
            totalUsadoGeral += gastoUtilizado;
        }
    });

    const totalDisponivelGeral = Math.max(0, totalLimiteGeral - totalUsadoGeral);

    const canvasCartao = document.getElementById('graficoCartoesLimite');
    if (canvasCartao) {
        if (chartCartoesLimiteInstance) {
            chartCartoesLimiteInstance.destroy();
        }
        chartCartoesLimiteInstance = new Chart(canvasCartao, {
            type: 'pie',
            data: {
                labels: ['Limite Usado', 'Limite Disponível'],
                datasets: [{
                    data: [totalUsadoGeral, totalDisponivelGeral],
                    backgroundColor: ['#f59e0b', '#3b82f6'],
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'bottom', labels: { boxWidth: 12 } }
                }
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

function abrirDetalhamentoParcelamento(lancamentoId) {
    const dados = obterDados();
    const lancamentoSelecionado = dados.lancamentos.find(l => Number(l.id) === Number(lancamentoId));
    if (!lancamentoSelecionado) return;

    const descricaoBase = lancamentoSelecionado.descricao.replace(/\s\(\d+\/\d+\)$/, '').trim();

    const todasAsParcelas = dados.lancamentos.filter(l => {
        const descL = l.descricao.replace(/\s\(\d+\/\d+\)$/, '').trim();
        return descL.toLowerCase() === descricaoBase.toLowerCase() && Number(l.cartaoId) === Number(lancamentoSelecionado.cartaoId);
    });

    todasAsParcelas.sort((a, b) => a.vencimento.localeCompare(b.vencimento));

    const primeiraParcela = todasAsParcelas[0];
    const ultimaParcela = todasAsParcelas[todasAsParcelas.length - 1];

    const valorTotalCompra = todasAsParcelas.reduce((acc, p) => acc + Number(p.valor), 0);
    const qtdTotalParcelas = lancamentoSelecionado.totalParcelas || todasAsParcelas.length;

    const cartaoObj = dados.cartoes.find(c => Number(c.id) === Number(lancamentoSelecionado.cartaoId));
    const nomeCartao = cartaoObj ? cartaoObj.nome : 'Cartão não informado';

    const usuarioObj = dados.usuarios.find(u => Number(u.id) === Number(lancamentoSelecionado.usuarioId));
    const nomeUsuario = usuarioObj ? usuarioObj.nome : 'Desconhecido';

    const dataCompra = primeiraParcela ? primeiraParcela.vencimento : '-';
    const dataUltima = ultimaParcela ? ultimaParcela.vencimento : '-';

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
        <div class="modal-box" style="max-width: 600px; width: 95%;">
            <h3>Detalhes do Parcelamento</h3>
            <p style="margin-bottom: 16px; font-size: 1rem; font-weight: bold; color: var(--accent);">${descricaoBase}</p>
            
            <div style="display: flex; flex-direction: column; gap: 10px; margin-bottom: 20px; text-align: left; font-size: 0.95rem;">
                <p><strong>Valor Total da Compra:</strong> R$ ${valorTotalCompra.toFixed(2)}</p>
                <p><strong>Cartão Utilizado:</strong> ${nomeCartao}</p>
                <p><strong>Responsável pelo Lançamento:</strong> ${nomeUsuario}</p>
                <p><strong>Data da Compra (Primeira Parcela):</strong> ${dataCompra}</p>
                <p><strong>Quantidade de Parcelas:</strong> ${qtdTotalParcelas}x (Valor da Parcela: R$ ${Number(lancamentoSelecionado.valor).toFixed(2)})</p>
                <p><strong>Data da Última Parcela:</strong> ${dataUltima}</p>
            </div>

            <button onclick="this.closest('.modal-overlay').remove()" style="width: 100%; background-color: var(--primary);">Fechar</button>
        </div>
    `;
    document.body.appendChild(overlay);
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

async function adicionarContaLotePorPeriodo(descricao, valorParcela, dataInicio, qtdMeses, categoriaId) {
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
    if (document.getElementById('sinoNotificacao')) return;
    
    const dados = obterDados();
    const usuarioId = localStorage.getItem('usuarioLogado');
    const notificacoes = dados.notificacoes || [];
    
    // Conta quantas notificações não lidas o usuário tem
    const naoLidas = notificacoes.filter(n => Number(n.usuarioDestinoId) === Number(usuarioId) && !n.lida).length;

    const imagemIcone = naoLidas > 0 ? 'imagens/notific1.png' : 'imagens/notific.png';

    const sinoBtn = document.createElement('button');
    sinoBtn.id = 'sinoNotificacao';
    sinoBtn.type = 'button';
    sinoBtn.className = 'btn-theme';
    sinoBtn.title = naoLidas > 0 ? `Você tem ${naoLidas} nova(s) notificação(ões)` : 'Central de Notificações';
    sinoBtn.style.cssText = `
        position: relative;
        background: transparent;
        border: none;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 4px;
        margin-left: 6px;
    `;
    
    sinoBtn.innerHTML = `
        <img src="${imagemIcone}" alt="Notificações" style="width: 22px; height: 22px; object-fit: contain;">
        ${naoLidas > 0 ? `<span style="position: absolute; top: 2px; right: 2px; background: var(--danger); color: #fff; font-size: 0.6rem; padding: 1px 4px; border-radius: 50%; font-weight: bold;">${naoLidas}</span>` : ''}
    `;
    
    sinoBtn.onclick = () => abrirCentralNotificacoes();

    const userChip = document.getElementById('usuarioLogadoNome');
    if (userChip && userChip.parentNode) {
        userChip.parentNode.appendChild(sinoBtn);
    }
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