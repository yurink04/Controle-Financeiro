// Controle Financeiro — script.js (núcleo de interface e regras de negócio)
// Dependências: carregue este arquivo ANTES de calculos_trabalhistas.js e conexao_sheets.js.
// Use <script defer> nos três arquivos em todas as páginas, sem carregar o monolito antigo.
// Os três arquivos compartilham um único escopo global clássico (não use type="module").

// Estados exclusivos das telas e do fluxo de autenticação.
let processandoAcaoModal = false;
let processandoSaidaSistema = false;
let verificacaoAutenticacaoPromise = null;

const charts = {
    entradasSaidas: null, gastosCategorias: null, cartoesLimite: null,
    relatorioES: null, relatorioCat: null, servicosEssenciais: null, servicosEssenciaisRel: null
};

// Modo Discreto: helpers de mascaramento reativo
function privacidadeAtiva() {
    return document.body.classList.contains('privacidade-ativa');
}
function formatarMoedaPrivada(v) {
    if (privacidadeAtiva()) return 'R$ •••,••';
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(numeroSeguro(v));
}

// ============================================================================
// 2. UTILITÁRIOS BASE
// ============================================================================
const numeroSeguro = (v, p = 0) => Number.isFinite(Number(v)) ? Number(v) : p;
const inteiroSeguro = (v, p = 0) => Number.isFinite(parseInt(v, 10)) ? parseInt(v, 10) : p;
const paraCentavos = v => Math.round(numeroSeguro(v) * 100);
const deCentavos = c => numeroSeguro(c) / 100;

// [MODO DISCRETO] formatarMoeda é reativo: respeita o estado de privacidade do body.
const formatarMoeda = v => {
    if (typeof document !== 'undefined' && document.body && document.body.classList.contains('privacidade-ativa')) {
        return 'R$ •••,••';
    }
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(numeroSeguro(v));
};

const normalizarTexto = t => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
const escaparHTML = v => { const d = document.createElement('div'); d.textContent = v == null ? '' : String(v); return d.innerHTML; };
// Na mesclagem de sincronização, undefined representa um registro removido.
// JSON.parse(undefined) causava erro e interrompia conflitos entre dispositivos.
const clonarDados = d => d === undefined ? undefined : JSON.parse(JSON.stringify(d));
const validarComplexidadeSenha = s => /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[\W_]).{8,}$/.test(String(s || ''));

const gerarId = (prefixo = 'id') => {
    try { if (window.crypto && window.crypto.randomUUID) return `${prefixo}_${window.crypto.randomUUID()}`; } catch (_) {}
    return `${prefixo}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
};

// IDs numéricos de lançamentos precisam ser únicos ENTRE aparelhos. "Maior id + 1" gera o mesmo
// número quando duas contas (ou dois aparelhos) lançam antes de sincronizar, e a mesclagem por id
// trava a sincronização ou descarta um dos lançamentos. Aqui o id nasce do relógio + sorteio.
// Fica abaixo de 1e15 (exato na planilha) até ~2041. Devolve o primeiro id de um bloco consecutivo.
function proximoIdLancamento(lista, quantidade = 1) {
    const total = Math.max(1, Math.floor(Number(quantidade)) || 1);
    const usados = new Set((Array.isArray(lista) ? lista : []).map(l => String(l?.id)));
    const livre = inicio => { for (let k = 0; k < total; k++) if (usados.has(String(inicio + k))) return false; return true; };
    let inicio = (Date.now() - 1767225600000) * 2048 + Math.floor(Math.random() * 2048);
    while (!livre(inicio)) inicio += total;
    return inicio;
}

async function gerarHash(texto) {
    if (typeof crypto === 'undefined' || !crypto.subtle?.digest) {
        throw new Error('A verificação segura de senha exige HTTPS ou localhost. Abra o sistema em uma origem segura.');
    }
    const data = new TextEncoder().encode(texto);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ============================================================================

// ============================================================================
// 3. UTILITÁRIOS DE DATA E PARCELAMENTO
// ============================================================================
function normalizarDataISO(dataValor) {
    if (dataValor == null || dataValor === '') return null;

    if (dataValor instanceof Date) {
        if (!Number.isFinite(dataValor.getTime())) return null;
        return `${dataValor.getFullYear()}-${String(dataValor.getMonth() + 1).padStart(2, '0')}-${String(dataValor.getDate()).padStart(2, '0')}`;
    }

    const texto = String(dataValor).trim();
    if (!texto) return null;

    let partes = texto.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:$|[T\s])/);
    let ano, mes, dia;

    if (partes) {
        ano = Number(partes[1]); mes = Number(partes[2]); dia = Number(partes[3]);
    } else {
        partes = texto.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})(?:$|[\s,])/);
        if (!partes) return null;
        dia = Number(partes[1]); mes = Number(partes[2]); ano = Number(partes[3]);
    }

    if (!ano || mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
    const teste = new Date(ano, mes - 1, dia);
    if (teste.getFullYear() !== ano || teste.getMonth() !== mes - 1 || teste.getDate() !== dia) return null;

    return `${String(ano).padStart(4, '0')}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

function formatarDataBR(dataStr) {
    if (dataStr == null || dataStr === '') return '-';

    const iso = normalizarDataISO(dataStr);
    if (iso) {
        const [ano, mes, dia] = iso.split('-');
        return `${dia}/${mes}/${ano}`;
    }

    const texto = String(dataStr).trim();
    if (/^(?:\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[\/.-]\d{1,2}[\/.-]\d{4})(?:$|[T\s,])/.test(texto)) return texto || '-';
    const data = new Date(texto);
    if (Number.isFinite(data.getTime())) return data.toLocaleDateString('pt-BR');
    return texto || '-';
}

function formatarDataSemHora(dataValor) {
    if (dataValor == null || dataValor === '') return '-';
    if (dataValor instanceof Date) {
        return Number.isFinite(dataValor.getTime()) ? dataValor.toLocaleDateString('pt-BR') : '-';
    }

    const texto = String(dataValor).trim();
    if (/^\d{4}-\d{2}-\d{2}T/.test(texto)) {
        const data = new Date(texto);
        if (Number.isFinite(data.getTime())) return data.toLocaleDateString('pt-BR');
    }
    return formatarDataBR(texto);
}

function dataLocalYYYYMMDD(data = new Date()) {
    return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}-${String(data.getDate()).padStart(2, '0')}`;
}

function dataParaString(data) { return dataLocalYYYYMMDD(data); }

function criarDataLocal(dataStr) {
    const iso = normalizarDataISO(dataStr);
    if (!iso) return null;
    const p = iso.split('-').map(Number);
    const d = new Date(p[0], p[1] - 1, p[2]);
    return (d.getFullYear() === p[0] && d.getMonth() === p[1] - 1 && d.getDate() === p[2]) ? d : null;
}

function adicionarMesesClamped(dataInicial, meses) {
    const b = new Date(dataInicial);
    const diaOrg = b.getDate();
    b.setDate(1); b.setMonth(b.getMonth() + meses);
    b.setDate(Math.min(diaOrg, new Date(b.getFullYear(), b.getMonth() + 1, 0).getDate()));
    return b;
}

function calcularPrimeiroVencimentoCartao(cartao, dataCompra) {
    const compra = criarDataLocal(dataCompra);
    if (!cartao || !compra) return dataCompra || '';
    const fechamento = Math.min(Math.max(1, inteiroSeguro(cartao.fechamento, 1)), new Date(compra.getFullYear(), compra.getMonth() + 1, 0).getDate());
    const diaVenc = Math.max(1, inteiroSeguro(cartao.vencimento, 1));
    const mesesAteVencimento = (diaVenc > fechamento) ? (compra.getDate() < fechamento ? 0 : 1) : (compra.getDate() < fechamento ? 1 : 2);
    const mesVenc = new Date(compra.getFullYear(), compra.getMonth() + mesesAteVencimento, 1);
    mesVenc.setDate(Math.min(diaVenc, new Date(mesVenc.getFullYear(), mesVenc.getMonth() + 1, 0).getDate()));
    return dataLocalYYYYMMDD(mesVenc);
}

function dividirValorExato(valor, quantidade) {
    const qtd = Math.max(1, inteiroSeguro(quantidade, 1));
    const tCentavos = paraCentavos(valor);
    const base = Math.floor(tCentavos / qtd);
    const resto = tCentavos % qtd;
    return Array.from({ length: qtd }, (_, i) => deCentavos(base + (i < resto ? 1 : 0)));
}

function descricaoBaseParcelamento(descricao = '') {
    return String(descricao).replace(/\s\(\d+\/\d+\)$/, '').trim();
}
function resolverParcelamentoId(lancamento) { return lancamento && lancamento.parcelamentoId ? lancamento.parcelamentoId : null; }

function resolverFinanciamentoIdPorLancamento(lancamento, dados = obterDados()) {
    if (lancamento && lancamento.financiamentoId != null && String(lancamento.financiamentoId).trim() !== '') return lancamento.financiamentoId;
    const descricao = normalizarTexto(descricaoBaseParcelamento(lancamento?.descricao || ''));
    let nome;
    if (descricao.startsWith('emprestimo recebido:')) nome = descricao.slice('emprestimo recebido:'.length).trim();
    else if (descricao.startsWith('financiamento:')) nome = descricao.slice('financiamento:'.length).trim();
    else if (descricao.startsWith('emprestimo:')) nome = descricao.slice('emprestimo:'.length).trim();
    else return null;
    const cand = (dados.financiamentos || []).filter(f => normalizarTexto(f.nome) === nome);
    const candDono = lancamento?.usuarioId == null ? [] : cand.filter(f => String(f.usuarioId) === String(lancamento.usuarioId));
    const finais = candDono.length ? candDono : cand;
    return finais.length === 1 ? finais[0].id : null;
}

function pertenceAoFinanciamento(lancamento, financiamento, dados = obterDados()) {
    if (!lancamento || !financiamento || lancamento.tipo !== 'saida') return false;
    if (lancamento.financiamentoId != null && String(lancamento.financiamentoId).trim() !== '') {
        return String(lancamento.financiamentoId) === String(financiamento.id);
    }
    const dBase = normalizarTexto(descricaoBaseParcelamento(lancamento.descricao || ''));
    const prefixo = financiamento.tipoContrato === 'emprestimo' ? 'Emprestimo:' : 'Financiamento:';
    if (dBase !== normalizarTexto(`${prefixo} ${financiamento.nome}`)) return false;
    const cand = (dados.financiamentos || []).filter(f => normalizarTexto(f.nome) === normalizarTexto(financiamento.nome));
    const candDono = lancamento.usuarioId == null ? [] : cand.filter(f => String(f.usuarioId) === String(lancamento.usuarioId));
    const finais = candDono.length ? candDono : cand;
    return finais.length === 1 && String(finais[0].id) === String(financiamento.id);
}

// ============================================================================
// 4. REGRAS DE ACESSO
// ============================================================================
const obterUsuarioAtualId = () => localStorage.getItem('usuarioLogado');
const obterUsuarioAtual = (dados = obterDados()) => (dados.usuarios || []).find(u => String(u.id) === String(obterUsuarioAtualId())) || null;

function filtrarDadosPorPermissao(lista, dadosGlobais, escopoFiltro = 'casal') {
    const usuarioId = String(obterUsuarioAtualId() || '');
    const usuario = (dadosGlobais.usuarios || []).find(u => String(u.id) === usuarioId);
    if (!usuario) return [];
    const parceiroId = usuario.parceiroId == null ? '' : String(usuario.parceiroId);
    const parceiro = (dadosGlobais.usuarios || []).find(u => String(u.id) === parceiroId);
    const vinculoReciproco = parceiro && String(parceiro.parceiroId || '') === usuarioId;
    return (lista || []).filter(item => {
        const donoId = item?.usuarioId == null ? '' : String(item.usuarioId);
        // Registros antigos sem dono não são apresentados como pertencentes a outra conta.
        if (donoId === usuarioId) return true;
        if (escopoFiltro === 'individual' || !vinculoReciproco || donoId !== parceiroId) return false;
        return (item.escopo || 'casal') === 'casal';
    });
}

function usuarioPodeAlterarLancamento(lancamento, dados = obterDados()) {
    if (!lancamento) return false;
    const u = obterUsuarioAtual(dados); if (!u) return false;
    const donoId = lancamento.usuarioId == null ? null : String(lancamento.usuarioId);
    if (donoId === String(u.id)) return true;
    const pId = u.parceiroId == null ? null : String(u.parceiroId);
    const parceiro = (dados.usuarios || []).find(item => String(item.id) === pId);
    return Boolean(pId && parceiro && String(parceiro.parceiroId || '') === String(u.id)
        && donoId === pId && (lancamento.escopo || 'casal') === 'casal');
}

function permissaoPaginaAtual() {
    const arq = String(window.location.pathname || '').split('/').pop().toLowerCase();
    const mapa = {
        'dashboard.html': 'dashboard', 'relatorios.html': 'relatorios', 'lancamentos.html': 'lancamentos',
        'editar-lancamento.html': 'lancamentos', 'central-pagamentos.html': 'lancamentos', 'detalhes-central-parcelada.html': 'lancamentos',
        'cartoes.html': 'cartoes', 'categorias.html': 'categorias', 'configuracoes.html': 'configuracoes',
        'admin-logs.html': 'configuracoes', 'financiamentos.html': 'configuracoes', 'detalhes-financiamento.html': 'configuracoes', 'bens.html': 'configuracoes', 'grafico.html': 'dashboard'
    };
    return mapa[arq] || null;
}

function usuarioPode(acao, dados = obterDados()) {
    const u = obterUsuarioAtual(dados);
    if (!u || u.ativo === false) return false;
    const p = u.permissoes;
    if (!p || typeof p !== 'object') return true;
    if (p.perfil === 'admin') return true;
    return p.acoes?.[acao] === true;
}

async function exigirPermissao(acao, descricao = 'realizar esta operação', dados = obterDados()) {
    if (usuarioPode(acao, dados)) return true;
    await mostrarAlertaModal(`Seu perfil não tem permissão para ${descricao}. Solicite acesso ao administrador.`);
    return false;
}

function usuarioPodeAcessarPagina(usuario, chavePagina) {
    if (!chavePagina) return true;
    const p = usuario?.permissoes;
    if (!p || typeof p !== 'object') return true;
    if (p.perfil === 'admin') return true;
    return p.paginas?.[chavePagina] === true;
}

function aplicarPermissoesNavegacao(usuario = obterUsuarioAtual()) {
    if (!usuario) return;
    const paginas = usuario.permissoes?.paginas;
    if (!paginas || typeof paginas !== 'object') return;
    const mapaNav = { 'dashboard.html': 'dashboard', 'relatorios.html': 'relatorios', 'lancamentos.html': 'lancamentos', 'cartoes.html': 'cartoes', 'categorias.html': 'categorias', 'configuracoes.html': 'configuracoes' };
    document.querySelectorAll('.app-nav-center a[href]').forEach(link => {
        const arq = String(link.getAttribute('href') || '').split('/').pop().toLowerCase();
        if (mapaNav[arq]) link.hidden = paginas[mapaNav[arq]] !== true;
    });
    const menu = document.querySelector('.nav-dropdown');
    if (menu) {
        menu.hidden = !(paginas.cartoes || paginas.categorias || paginas.configuracoes || usuario.permissoes?.acoes?.financiamentos);
        menu.querySelectorAll('.nav-dropdown-content a').forEach(link => {
            const dest = String(link.getAttribute('href') || '').split('/').pop().toLowerCase();
            link.hidden = !(dest === 'cartoes.html' ? paginas.cartoes :
                          dest === 'categorias.html' ? paginas.categorias :
                          dest === 'financiamentos.html' ? usuario.permissoes?.acoes?.financiamentos :
                          dest === 'bens.html' ? (paginas.configuracoes || usuario.permissoes?.acoes?.financiamentos) :
                          paginas.configuracoes);
        });
    }
}

async function deslogarSistema(solicitadoPeloUsuario = true) {
    if (processandoSaidaSistema) return false;
    processandoSaidaSistema = true;
    let loadingSaidaAtivo = false;

    try {
        const temPendencias = localStorage.getItem('syncPendente') === 'true';
        const temConflito = localStorage.getItem(SYNC_CONFLICT_KEY) !== null;

        if (solicitadoPeloUsuario && (temPendencias || temConflito)) {
            const aguardar = await mostrarConfirmacaoModal(
                temConflito
                    ? 'Existe um conflito de sincronização pendente. Deseja tentar resolver/enviar os dados antes de sair?'
                    : 'Há alterações sendo sincronizadas em segundo plano. Deseja aguardar a sincronização antes de sair?'
            );
            if (!aguardar) return false;

            mostrarLoading('Aguardando sincronização...');
            loadingSaidaAtivo = true;
            const sincronizado = await aguardarSincronizacaoPendente(30000);
            esconderLoading();
            loadingSaidaAtivo = false;

            if (!sincronizado) {
                const sairMesmoAssim = await mostrarConfirmacaoModal(
                    'Não foi possível concluir a sincronização agora. As alterações continuam salvas neste navegador e poderão ser sincronizadas quando você voltar. Deseja sair mesmo assim?'
                );
                if (!sairMesmoAssim) return false;
            }
        }

        const uId = localStorage.getItem('usuarioLogado');
        if (uId) {
            const dados = obterDados();
            const u = dados.usuarios.find(user => Number(user.id) === Number(uId));
            if (ehModoTesteAtivo(u)) {
                const bkp = localStorage.getItem(BACKUP_TESTE_KEY);
                if (bkp) { localStorage.setItem(DB_KEY, bkp); localStorage.removeItem(BACKUP_TESTE_KEY); }
            }
        }

        localStorage.removeItem('usuarioLogado');
        sessionStorage.removeItem(CHAVE_SESSAO_API);
        sessionStorage.removeItem(CHAVE_USUARIO_SESSAO);
        localStorage.removeItem('adminAutorizado');
        localStorage.removeItem('adminLogado');
        window.location.href = 'index.html';
        return true;
    } finally {
        processandoSaidaSistema = false;
        if (loadingSaidaAtivo) esconderLoading();
    }
}

async function aguardarSincronizacaoPendente(tempoLimiteMs = 30000) {
    if (!syncPendingData && localStorage.getItem('syncPendente') === 'true') {
        const local = lerJSONLocal(DB_KEY, null);
        if (local) syncPendingData = clonarDados(local);
    }

    if (!syncInFlight && syncPendingData && !syncTimer && !localStorage.getItem(SYNC_CONFLICT_KEY)) {
        agendarSincronizacaoSilenciosa();
    }

    const prazoFinal = Date.now() + Math.max(1000, Number(tempoLimiteMs) || 30000);
    while (Date.now() < prazoFinal) {
        const pendente = localStorage.getItem('syncPendente') === 'true';
        const conflito = localStorage.getItem(SYNC_CONFLICT_KEY) !== null;

        if (conflito) return false;
        if (!pendente && !syncInFlight && !syncPendingData) return true;

        if (pendente && !syncInFlight && syncPendingData && !syncTimer) {
            agendarSincronizacaoSilenciosa();
        }

        await new Promise(resolve => setTimeout(resolve, 200));
    }

    return localStorage.getItem('syncPendente') !== 'true'
        && localStorage.getItem(SYNC_CONFLICT_KEY) === null
        && !syncInFlight
        && !syncPendingData;
}

function verificarAutenticacao() {
    if (!verificacaoAutenticacaoPromise) {
        verificacaoAutenticacaoPromise = (async () => {
            const uId = localStorage.getItem('usuarioLogado');
            if (!uId || !obterSessaoAPI() || sessionStorage.getItem(CHAVE_USUARIO_SESSAO) !== String(uId)) {
                window.location.href = 'index.html'; return false;
            }
            try {
                                const dadosL = lerJSONLocal(DB_KEY, null);
                const uL = (dadosL?.usuarios || []).find(u => String(u.id) === String(uId));
                if (ehModoTesteAtivo(uL)) {
                    memoriaSistema = migrarDados(dadosL).dados;
                } else if (localStorage.getItem(SYNC_CONFLICT_KEY)) {
                    memoriaSistema = migrarDados(dadosL || {}).dados;
                    atualizarIndicadorSyncUI('error');
                } else if (localStorage.getItem('syncPendente') === 'true') {
                    await inicializarBanco();
                } else if (dadosL && Array.isArray(dadosL.usuarios) && dadosL.usuarios.length) {
                    // Cache persistente: abre instantaneamente; a revalidação ocorre em segundo plano.
                    memoriaSistema = migrarDados(dadosL).dados;
                    window.revisaoServidorAtual = Number(memoriaSistema._revision) || 0;
                } else {
                    const json = await buscarDadosServidor();
                    gravarSnapshotLocal(migrarDados(json).dados, true);
                    localStorage.removeItem(SYNC_CONFLICT_KEY);
                }
            } catch (e) {
                console.warn('Fallback offline.', e);
                if (!lerJSONLocal(DB_KEY, null)) { window.location.href = 'index.html'; return false; }
            }
            const d = obterDados();
            const u = (d.usuarios || []).find(user => String(user.id) === String(uId));
            if (!u || u.ativo === false) { deslogarSistema(false); return false; }
            if (u.trocaSenhaObrigatoria && !window.location.pathname.endsWith('perfil.html')) {
                window.location.href = 'perfil.html'; return false;
            }
            if (!usuarioPodeAcessarPagina(u, permissaoPaginaAtual())) {
                await mostrarAlertaModal('Acesso restrito.');
                window.location.href = 'dashboard.html'; return false;
            }
            gerarLembretesVencimento();
            iniciarSincronizacaoSegundoPlano();
            return true;
        })().catch(() => false).finally(() => verificacaoAutenticacaoPromise = null);
    }
    return verificacaoAutenticacaoPromise;
}

// ============================================================================

// Histórico de ações da interface; a persistência é feita por conexao_sheets.js.
function registrarLog(dados, acao, detalhes, extras = {}) {
    if (!Array.isArray(dados.logs)) dados.logs = [];
    const u = obterUsuarioAtual(dados);
    const agora = new Date();
    dados.logs.push({ id: gerarId('log'), dataHora: agora.toISOString(), dataHoraFormatada: formatarDataSemHora(agora), usuario: u?.nome || 'Sistema', usuarioId: u?.id || null, acao, detalhes, ...extras });
}

// ============================================================================
// 6. UI — MODAIS, HEADER, TEMA, PRIVACIDADE
// ============================================================================
function criarModalBase({ titulo, mensagem, htmlExtra = '', classe = '' }) {
    const o = document.createElement('div');
    o.className = `modal-overlay ${classe}`.trim();
    o.setAttribute('role', 'dialog');
    o.setAttribute('aria-modal', 'true');
    o.innerHTML = `<div class="modal-box" tabindex="-1"><h3>${escaparHTML(titulo)}</h3><p>${escaparHTML(mensagem)}</p>${htmlExtra}</div>`;
    document.body.appendChild(o);
    const box = o.querySelector('.modal-box');
    setTimeout(() => box?.focus(), 10);

    o.addEventListener('keydown', function trap(e) {
        if (e.key !== 'Tab') return;
        const focaveis = Array.from(box.querySelectorAll(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )).filter(el => el.offsetParent !== null);
        if (!focaveis.length) return;
        const primeiro = focaveis[0];
        const ultimo = focaveis[focaveis.length - 1];
        if (e.shiftKey && document.activeElement === primeiro) { e.preventDefault(); ultimo.focus(); }
        else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primeiro.focus(); }
    });
    return { overlay: o, box };
}

function fecharModal(overlay) { if (overlay) { overlay.classList.add('modal-closing'); setTimeout(() => overlay.remove(), 120); } }

function mostrarConfirmacaoModal(mensagem) {
    return new Promise(res => {
        const m = criarModalBase({ titulo: 'Confirmação', mensagem, htmlExtra: `<div class="modal-buttons"><button type="button" class="btn-secundario" data-cancelar>Cancelar</button><button type="button" class="btn-perigo" data-confirmar>Confirmar</button></div>` });
        let fim = false;
        const done = v => { if (fim) return; fim = true; fecharModal(m.overlay); res(v); };
        m.overlay.querySelector('[data-cancelar]').onclick = () => done(false);
        m.overlay.querySelector('[data-confirmar]').onclick = () => done(true);
        m.overlay.addEventListener('keydown', e => { if (e.key === 'Escape') done(false); if (e.key === 'Enter') done(true); });
    });
}

function mostrarAlertaModal(mensagem) {
    return new Promise(res => {
        const m = criarModalBase({ titulo: 'Aviso', mensagem, htmlExtra: `<div class="modal-buttons modal-buttons-center"><button type="button" data-confirmar>OK</button></div>` });
        let fim = false;
        const done = () => { if (fim) return; fim = true; fecharModal(m.overlay); res(true); };
        m.overlay.querySelector('[data-confirmar]').onclick = done;
        m.overlay.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === 'Escape') done(); });
    });
}

function mostrarPromptSenha(titulo, descricao, exigirConfirmacao = true) {
    return new Promise(res => {
        const extra = exigirConfirmacao ? `
            <div style="margin-top: 20px; display: flex; flex-direction: column; gap: 16px; text-align: left;">
                <div><label style="font-weight: bold;">Nova Palavra-passe:</label><input type="password" class="modal-input" id="pNova" maxlength="32"></div>
                <div><label style="font-weight: bold;">Confirme a Palavra-passe:</label><input type="password" class="modal-input" id="pConf" maxlength="32"></div>
            </div>` : `
            <div style="margin-top: 20px; display: flex; flex-direction: column; gap: 16px; text-align: left;">
                <div><label style="font-weight: bold;">Palavra-passe:</label><input type="password" class="modal-input" id="pNova" maxlength="32"></div>
            </div>`;
        const m = criarModalBase({ titulo, mensagem: descricao, htmlExtra: extra + `<div class="modal-buttons" style="margin-top: 28px;"><button type="button" class="btn-secundario" data-cancelar>Cancelar</button><button type="button" data-confirmar>Confirmar</button></div>` });
        const iN = m.overlay.querySelector('#pNova'), iC = m.overlay.querySelector('#pConf');
        let fim = false;
        const done = v => { if (fim) return; fim = true; fecharModal(m.overlay); res(v); };
        setTimeout(() => iN?.focus(), 0);
        m.overlay.querySelector('[data-cancelar]').onclick = () => done(null);
        m.overlay.querySelector('[data-confirmar]').onclick = () => {
            const vN = iN.value.trim(); if (!vN) return mostrarAlertaModal("Campo vazio.");
            if (exigirConfirmacao) {
                if (!validarComplexidadeSenha(vN)) return mostrarAlertaModal("Senha fraca.");
                if (vN !== iC.value.trim()) return mostrarAlertaModal("Senhas não conferem.");
            }
            done(vN);
        };
        m.overlay.addEventListener('keydown', e => { if (e.key === 'Escape') done(null); if (e.key === 'Enter') m.overlay.querySelector('[data-confirmar]').click(); });
    });
}

function mostrarPromptTextoModal(titulo, descricao) {
    return new Promise(res => {
        const m = criarModalBase({ titulo, mensagem: descricao, htmlExtra: `<input type="text" class="modal-input" data-valor maxlength="250"><div class="modal-buttons"><button type="button" class="btn-secundario" data-cancelar>Cancelar</button><button type="button" data-confirmar>Confirmar</button></div>` });
        const i = m.overlay.querySelector('[data-valor]');
        let fim = false;
        const done = v => { if (fim) return; fim = true; fecharModal(m.overlay); res(v); };
        setTimeout(() => i?.focus(), 0);
        m.overlay.querySelector('[data-cancelar]').onclick = () => done(null);
        m.overlay.querySelector('[data-confirmar]').onclick = () => { const v = i.value.trim(); if (!v) mostrarAlertaModal('Obrigatório!'); else done(v); };
        i.addEventListener('keydown', e => { if (e.key === 'Enter') m.overlay.querySelector('[data-confirmar]').click(); if (e.key === 'Escape') done(null); });
    });
}

function mostrarPromptModal(titulo, descricao, senhaCorreta = null) {
    return new Promise(async resolve => {
        if (senhaCorreta !== null && senhaCorreta !== undefined && senhaCorreta !== '') {
            const r = await mostrarPromptSenha(titulo, descricao, false);
            resolve(r === null ? null : r); return;
        }
        const { overlay } = criarModalBase({ titulo, mensagem: descricao, htmlExtra: `<input type="text" class="modal-input" data-valor autocomplete="off" placeholder="Digite o valor"><div class="modal-buttons"><button type="button" class="btn-secundario" data-cancelar>Cancelar</button><button type="button" data-confirmar>Confirmar</button></div>` });
        const input = overlay.querySelector('[data-valor]');
        let fim = false;
        const done = v => { if (fim) return; fim = true; fecharModal(overlay); resolve(v); };
        setTimeout(() => input?.focus(), 0);
        overlay.querySelector('[data-cancelar]').onclick = () => done(null);
        overlay.querySelector('[data-confirmar]').onclick = () => done(input.value.trim());
        input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); done(input.value.trim()); } if (e.key === 'Escape') done(null); });
    });
}

function mostrarOpcaoEscopoModal(mensagem) {
    return new Promise(resolve => {
        const { overlay } = criarModalBase({ titulo: 'Ação em Lote / Parcelamento', mensagem: '', htmlExtra: `<p style="margin: 15px 0; text-align: center;">${escaparHTML(mensagem)}</p><div class="modal-buttons" style="flex-direction: column; gap: 8px;"><button id="btnApenasEsta" style="background-color: #3b82f6; width: 100%; margin: 0;">Apenas esta parcela</button><button id="btnTodas" style="background-color: #f59e0b; width: 100%; margin: 0;">Todas as parcelas</button><button id="btnCancelarEscopo" style="background-color: #64748b; width: 100%; margin: 0;">Cancelar</button></div>` });
        document.getElementById('btnApenasEsta').onclick = () => { fecharModal(overlay); resolve('esta'); };
        document.getElementById('btnTodas').onclick = () => { fecharModal(overlay); resolve('todas'); };
        document.getElementById('btnCancelarEscopo').onclick = () => { fecharModal(overlay); resolve(null); };
    });
}

async function verificarSenhaAdmin(nomeSecao = 'esta seção') {
    const senhaInformada = await mostrarPromptSenha(
        'Acesso restrito',
        `Informe a senha administrativa para ${nomeSecao}.`,
        false
    );
    if (senhaInformada === null || !String(senhaInformada).trim()) return false;

    try {
        const resposta = await executarPostAPI('verificarAdmin', {
            sessao: obterSessaoAPI(),
            senha: String(senhaInformada).trim()
        });
        if (resposta.status === 'sucesso' && resposta.autorizado === true) return true;
        if (resposta.status === 'sucesso') {
            await mostrarAlertaModal('Senha administrativa incorreta. Tente novamente.');
        } else {
            console.warn('Falha na verificação administrativa:', resposta.mensagem);
            await mostrarAlertaModal('Não foi possível validar o acesso agora. Tente novamente.');
        }
        return false;
    } catch (erro) {
        // executarPostAPI já redirecionou para o login em caso de sessão expirada.
        if (/sess[aã]o expir/i.test(erro?.message || '')) return false;
        console.warn('Verificação administrativa indisponível:', erro);
        await mostrarAlertaModal('Não foi possível validar a senha. Verifique sua conexão e tente novamente.');
        return false;
    }
}

let temporizadorFeedbackIntegrado = null;
function atualizarFeedbackIntegrado(mensagem, estado = 'pending', duracao = 0) {
    const ilha = document.querySelector('.app-top-island');
    if (!ilha) return false;
    let indicador = ilha.querySelector('.app-action-status');
    if (!indicador) {
        indicador = document.createElement('div');
        indicador.className = 'app-action-status';
        indicador.setAttribute('role', 'status');
        indicador.setAttribute('aria-live', 'polite');
        indicador.innerHTML = '<span class="app-action-indicator" aria-hidden="true"></span><span class="app-action-message"></span>';
        ilha.append(indicador);
    }
    clearTimeout(temporizadorFeedbackIntegrado);
    indicador.dataset.state = estado;
    indicador.querySelector('.app-action-message').textContent = mensagem;
    if (duracao > 0) temporizadorFeedbackIntegrado = setTimeout(() => indicador.remove(), duracao);
    return true;
}

function notificarOperacao(mensagem = 'Pronto! Alteração registrada.') {
    atualizarFeedbackIntegrado(mensagem, 'success', 3300);
}

function mostrarLoading(mensagem = "Processando...", usarGif = false) {
    const span = document.getElementById('headerLoadingText');
    if (span) { span.textContent = mensagem; span.style.display = 'inline-block'; }

    const antigo = document.getElementById('loadingOverlay');
    if (antigo) antigo.remove();

    // Operações comuns mostram progresso na ilha. O GIF maior fica reservado
    // para tarefas explicitamente demoradas (backup, recuperação e saída).
    if (!usarGif && atualizarFeedbackIntegrado(mensagem, 'pending')) return;

    {
        const ov = document.createElement('div');
        ov.id = 'loadingOverlay';
        ov.setAttribute('role', 'status');
        ov.setAttribute('aria-live', 'polite');
        ov.className = 'app-loading-overlay';

        let indicador;
        if (usarGif) {
            indicador = document.createElement('img');
            indicador.src = 'imagens/loading1.gif';
            indicador.alt = '';
            indicador.className = 'app-loading-image';
            indicador.onerror = () => {
                const fallback = document.createElement('div');
                fallback.className = 'app-loading-spinner';
                indicador.replaceWith(fallback);
            };
        } else {
            indicador = document.createElement('div');
            indicador.className = 'app-loading-spinner';
        }

        const texto = document.createElement('span');
        texto.textContent = mensagem;
        ov.append(indicador, texto);
        document.body.appendChild(ov);
    }
}

function esconderLoading() {
    const span = document.getElementById('headerLoadingText');
    if (span) { span.style.display = 'none'; span.textContent = ''; }
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) overlay.remove();
    const integrado = document.querySelector('.app-action-status[data-state="pending"]');
    if (integrado) integrado.remove();
}

function definirSidebarAberto(aberto) {
    const painel = document.getElementById('appSidebar');
    const botao = document.getElementById('btnSidebarToggle');
    const focoEstavaDentro = painel && painel.contains(document.activeElement);
    // Não deixa links invisíveis acessíveis por Tab quando o painel estiver fechado.
    if (painel && aberto) {
        painel.inert = false;
        painel.setAttribute('aria-hidden', 'false');
    }
    if (!aberto && focoEstavaDentro) botao?.focus({ preventScroll: true });
    document.body.classList.toggle('sidebar-open', Boolean(aberto));
    if (painel && !aberto) {
        painel.inert = true;
        painel.setAttribute('aria-hidden', 'true');
    }
    if (botao) {
        botao.setAttribute('aria-expanded', String(aberto));
        botao.setAttribute('aria-label', aberto ? 'Fechar menu lateral' : 'Abrir menu lateral');
        botao.title = aberto ? 'Fechar menu lateral' : 'Abrir menu lateral';
        const icone = botao.querySelector('.sidebar-toggle-glyph');
        if (icone) icone.textContent = aberto ? '×' : '☰';
    }
    if (aberto) painel?.querySelector('.sidebar-close-btn')?.focus({ preventScroll: true });
}

function alternarSidebar() {
    definirSidebarAberto(!document.body.classList.contains('sidebar-open'));
}

function fecharSidebar() {
    definirSidebarAberto(false);
}

function alternarSubmenuSidebar() {
    const grupo = document.querySelector('#appSidebar .nav-dropdown');
    const botao = grupo?.querySelector('.sidebar-dropdown-trigger');
    if (!grupo || !botao) return;
    const expandir = !grupo.classList.contains('active');
    grupo.classList.toggle('active', expandir);
    botao.setAttribute('aria-expanded', String(expandir));
    const conteudo = grupo.querySelector('.nav-dropdown-content');
    if (conteudo) conteudo.inert = !expandir;
}

function iconeSidebar(nome) {
    // SVGs locais: o menu não depende de imagens adicionais nem de bibliotecas externas.
    const formas = {
        marca: '<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M7 15.5l3.2-4 2.6 2.3L17 8.5"/>',
        inicio: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.2"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.2"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.2"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.2"/>',
        lancamentos: '<path d="M4 5.5h16M4 11.5h16M4 17.5h10"/><path d="m16 17.5 2 2 3-4"/>',
        pagamentos: '<rect x="3.5" y="4" width="17" height="16" rx="3"/><path d="M3.5 9h17m-12 6h4"/>',
        relatorios: '<path d="M4 20.5V14m5 6.5V10m5 10.5V4m5 16.5v-8"/><path d="M2.5 21h19"/>',
        cadastros: '<rect x="3.5" y="4" width="17" height="16" rx="3"/><path d="M7 9h10M7 13h10M7 17h6"/>',
        configuracoes: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l-1.87 1.87A1.7 1.7 0 0 0 16 18.4a1.7 1.7 0 0 0-2 1.5h-4a1.7 1.7 0 0 0-2-1.5 1.7 1.7 0 0 0-1.87.34l-1.87-1.87A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.5-2v-2A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.87l1.87-1.87A1.7 1.7 0 0 0 8 5.6a1.7 1.7 0 0 0 2-1.5h4a1.7 1.7 0 0 0 2 1.5 1.7 1.7 0 0 0 1.87-.34l1.87 1.87A1.7 1.7 0 0 0 19.4 9a1.7 1.7 0 0 0 1.5 2v2a1.7 1.7 0 0 0-1.5 2z"/>',
        perfil: '<circle cx="12" cy="8" r="4"/><path d="M4.5 21c.5-4 3-6 7.5-6s7 2 7.5 6"/>',
        sair: '<path d="M10 4.5H5.5A2.5 2.5 0 0 0 3 7v10a2.5 2.5 0 0 0 2.5 2.5H10M14 7.5l4.5 4.5-4.5 4.5M8.5 12h10"/>',
        chevron: '<path d="m6 9 6 6 6-6"/>'
    };
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${formas[nome] || formas.inicio}</svg>`;
}

function destacarPaginaSidebar() {
    const atual = String(window.location.pathname).split('/').pop().toLowerCase();
    const redirecionamentos = {
        'editar-lancamento.html': 'lancamentos.html',
        'detalhes-central-parcelada.html': 'central-pagamentos.html',
        'detalhes-financiamento.html': 'financiamentos.html',
        'admin-logs.html': 'configuracoes.html',
        'grafico.html': 'relatorios.html'
    };
    const destino = redirecionamentos[atual] || atual;
    const painel = document.getElementById('appSidebar');
    painel?.querySelectorAll('.sidebar-nav a[href]').forEach(link => {
        if (link.getAttribute('href') === destino) link.setAttribute('aria-current', 'page');
    });
    const grupo = painel?.querySelector('.nav-dropdown');
    const temSubpaginaAtiva = Boolean(grupo?.querySelector('.nav-dropdown-content a[aria-current="page"]'));
    if (temSubpaginaAtiva) {
        grupo.classList.add('active');
        const acionador = grupo.querySelector('.sidebar-dropdown-trigger');
        acionador?.setAttribute('aria-expanded', 'true');
        acionador?.classList.add('is-section-current');
        grupo.querySelector('.nav-dropdown-content').inert = false;
    }
}

function injetarHeader() {
    if (document.querySelector('.app-sidebar')) return;
    const old = document.querySelector('.app-header'); if (old) old.remove();
    document.body.insertAdjacentHTML('afterbegin', `
    <div class="mobile-overlay" aria-hidden="true" onclick="fecharSidebar()"></div>
    <aside id="appSidebar" class="app-sidebar" aria-label="Menu de navegação" aria-hidden="true" inert>
        <div class="sidebar-top">
            <a href="dashboard.html" class="sidebar-brand" aria-label="Ir ao painel">
                <span class="sidebar-brand-mark">${iconeSidebar('marca')}</span>
                <span class="sidebar-brand-copy"><strong>Controle Financeiro</strong><small>Seu espaço, suas finanças</small></span>
            </a>
            <button type="button" class="sidebar-close-btn" onclick="fecharSidebar()" aria-label="Fechar menu lateral" title="Fechar menu lateral">×</button>
        </div>
        <div class="sidebar-profile">
            <span class="sidebar-profile-eyebrow">Minha conta</span>
            <a id="usuarioLogadoNome" href="perfil.html" aria-label="Abrir meu perfil"><span class="sidebar-user-greeting">Meu perfil</span></a>
            <span id="headerLoadingText" class="sidebar-loading-text"></span>
        </div>
        <nav class="sidebar-nav app-nav-center" aria-label="Páginas do sistema">
            <span class="sidebar-nav-label">Navegação</span>
            <a class="sidebar-nav-link" href="dashboard.html"><span class="sidebar-nav-icon">${iconeSidebar('inicio')}</span><span>Visão geral</span></a>
            <a class="sidebar-nav-link" href="lancamentos.html"><span class="sidebar-nav-icon">${iconeSidebar('lancamentos')}</span><span>Lançamentos</span></a>
            <a class="sidebar-nav-link" href="central-pagamentos.html"><span class="sidebar-nav-icon">${iconeSidebar('pagamentos')}</span><span>Central de pagamentos</span></a>
            <a class="sidebar-nav-link" href="relatorios.html"><span class="sidebar-nav-icon">${iconeSidebar('relatorios')}</span><span>Relatórios</span></a>
            <div class="sidebar-divider" aria-hidden="true"></div>
            <span class="sidebar-nav-label">Organização</span>
            <div class="nav-dropdown">
                <button type="button" class="sidebar-nav-link sidebar-dropdown-trigger" onclick="alternarSubmenuSidebar()" aria-expanded="false" aria-controls="sidebarCadastros">
                    <span class="sidebar-nav-icon">${iconeSidebar('cadastros')}</span><span>Cadastros</span><span class="sidebar-chevron">${iconeSidebar('chevron')}</span>
                </button>
                <div id="sidebarCadastros" class="nav-dropdown-content" inert><div class="nav-dropdown-content-inner">
                    <a href="cartoes.html">Cartões</a><a href="categorias.html">Categorias</a><a href="bens.html">Bens</a><a href="financiamentos.html">Financiamentos</a>
                </div></div>
            </div>
            <div class="sidebar-divider" aria-hidden="true"></div>
            <span class="sidebar-nav-label">Minha área</span>
            <a class="sidebar-nav-link" href="perfil.html"><span class="sidebar-nav-icon">${iconeSidebar('perfil')}</span><span>Meu perfil</span></a>
            <a class="sidebar-nav-link" href="rendimentos.html"><span class="sidebar-nav-icon">${iconeSidebar('relatorios')}</span><span>Meus rendimentos</span></a>
            <a class="sidebar-nav-link" href="configuracoes.html"><span class="sidebar-nav-icon">${iconeSidebar('configuracoes')}</span><span>Configurações</span></a>
        </nav>
        <div class="sidebar-footer">
            <span class="sidebar-footer-note">Tudo organizado em um só lugar</span>
            <button type="button" onclick="deslogarSistema(true)" class="btn-sair-sidebar">${iconeSidebar('sair')}<span>Sair do sistema</span></button>
        </div>
    </aside>`);
    destacarPaginaSidebar();

    const p = String(window.location.pathname).split('/').pop().toLowerCase();
    const titulo = p.includes('admin-logs') ? 'Auditoria'
        : p.includes('lancamento') ? 'Lançamentos'
        : p.includes('central') ? 'Central'
        : p.includes('relatorios') ? 'Relatórios'
        : p.includes('rendimentos') ? 'Meus rendimentos'
        : p.includes('cartoes') ? 'Cartões'
        : p.includes('categorias') ? 'Categorias'
        : p.includes('bens') ? 'Bens'
        : p.includes('financiamentos') ? 'Financiamentos'
        : p.includes('config') ? 'Configurações'
        : p.includes('perfil') ? 'Meu Perfil'
        : 'Gestão Inteligente';

    const cnt = document.querySelector('.container');
    if (cnt && !document.querySelector('.app-top-island')) {
        cnt.insertAdjacentHTML('afterbegin', `
        <div class="app-top-island">
            <div class="top-island-leading">
                <button type="button" id="btnSidebarToggle" class="mobile-menu-btn" onclick="alternarSidebar()" aria-label="Abrir menu lateral" aria-expanded="false" aria-controls="appSidebar" title="Abrir menu lateral"><span class="sidebar-toggle-glyph" aria-hidden="true">☰</span></button>
                <a class="top-island-brand" href="dashboard.html" title="Ir para o início" aria-label="Controle Financeiro — ir para a página inicial">
                    <img class="top-island-home-icon" src="imagens/home.png" alt="" aria-hidden="true" onerror="this.onerror=null;this.src='imagens/casa.png'">
                    <div class="top-island-brand-copy">
                        <h1>Controle Financeiro</h1>
                        <span class="top-island-page-title">${escaparHTML(titulo)}</span>
                    </div>
                </a>
                <span class="top-island-divider" aria-hidden="true"></span>
                <button type="button" id="btnNotificacoes" class="top-island-icon-button" onclick="if(typeof abrirModalNotificacoes === 'function') abrirModalNotificacoes();" aria-label="Notificações" title="Notificações">
                    <img src="imagens/notificacao.png" alt="" aria-hidden="true" onerror="this.outerHTML='🔔'">
                </button>
            </div>
            <div class="top-island-settings">
                <button type="button" id="btnPrivacidade" class="top-island-icon-button" onclick="alternarPrivacidade()" aria-label="Alternar privacidade" title="Privacidade"><img id="imgPrivacidade" src="imagens/esconder.png" alt="" aria-hidden="true"><span class="top-island-action-label">Privacidade</span></button>
                <span class="top-island-divider" aria-hidden="true"></span>
                <button type="button" id="btnTemaVisual" class="top-island-icon-button" onclick="alternarTemaVisual(event)" aria-label="Alternar tema" title="Alternar tema"><img class="top-island-theme-icon" src="imagens/modo_escuro.jpg" alt="" aria-hidden="true"><span class="top-island-action-label">Tema</span></button>
            </div>
            <div class="top-island-sync">
                <button type="button" id="syncStatusIcon" class="top-island-sync-button" title="Consultar sincronização" aria-label="Sincronização: sincronizado. Clique para atualizar.">
                    <img src="imagens/sincronizar.png" alt="" aria-hidden="true">
                </button>
            </div>
        </div>`);
    }
    definirSidebarAberto(false);
    document.addEventListener('keydown', (e) => {
        if (!document.body.classList.contains('sidebar-open')) return;
        if (e.key === 'Escape') {
            e.preventDefault();
            fecharSidebar();
            return;
        }
        if (e.key === 'Tab') {
            const itens = [...document.querySelectorAll('#appSidebar a[href], #appSidebar button')]
                .filter(el => !el.closest('[inert]') && !el.hidden && !el.closest('[hidden]') && el.getClientRects().length);
            if (!itens.length) return;
            const primeiro = itens[0], ultimo = itens[itens.length - 1];
            if (e.shiftKey && document.activeElement === primeiro) {
                e.preventDefault(); ultimo.focus();
            } else if (!e.shiftKey && document.activeElement === ultimo) {
                e.preventDefault(); primeiro.focus();
            }
        }
    });
    const botaoTema = document.getElementById('btnTemaVisual');
    if (botaoTema) {
        const escuro = document.body.classList.contains('dark-mode');
        botaoTema.setAttribute('aria-pressed', String(escuro));
        botaoTema.title = escuro ? 'Ativar tema claro' : 'Ativar tema escuro';
        botaoTema.setAttribute('aria-label', botaoTema.title);
    }
    criarIndicadorSincronizacaoUi(); atualizarIconePrivacidade(); atualizarHeaderUsuario();
}

function atualizarHeaderUsuario() {
    const u = obterUsuarioAtual();
    if (u) aplicarPermissoesNavegacao(u);
    const sn = document.getElementById('usuarioLogadoNome');
    if (sn && u) {
        const av = u.fotoPerfil || 'data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22%23a89586%22%3E%3Cpath%20d%3D%22M12%2012c2.21%200%204-1.79%204-4s-1.79-4-4-4-4%201.79-4%204%201.79%204%204%204zm0%202c-2.67%200-8%201.34-8%204v2h16v-2c0-2.66-5.33-4-8-4z%22%2F%3E%3C%2Fsvg%3E';
        const nomeSeguro = u.nome ? String(u.nome) : 'Usuário';
        const primeiroNome = nomeSeguro.split(' ')[0] || 'Usuário';
        // Foto e nome vêm do banco: usar propriedades de DOM evita injeção HTML.
        sn.replaceChildren();
        const avatar = document.createElement('img');
        avatar.alt = 'Avatar';
        avatar.className = 'sidebar-user-avatar';
        const avatarPadrao = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="8" r="4" fill="#a89586"/><path d="M3 21c0-5 4-8 9-8s9 3 9 8" fill="#a89586"/></svg>');
        avatar.src = /^(https:\/\/|data:image\/(?:png|jpeg|gif|webp|svg\+xml);)/i.test(String(av)) ? av : avatarPadrao;
        avatar.onerror = () => { avatar.onerror = null; avatar.src = avatarPadrao; };
        const saudacao = document.createElement('span');
        saudacao.className = 'sidebar-user-greeting';
        saudacao.append('Olá, ');
        const nome = document.createElement('b');
        nome.textContent = primeiroNome;
        saudacao.append(nome);
        sn.append(avatar, saudacao);
    }
    if (typeof renderizarSinoNotificacoes === 'function') renderizarSinoNotificacoes();
}

function inicializarPrivacidade() {
    if (localStorage.getItem('privacidadeAtiva') !== 'false') {
        document.body.classList.add('privacidade-ativa');
        localStorage.setItem('privacidadeAtiva', 'true');
    } else {
        document.body.classList.remove('privacidade-ativa');
    }
    atualizarIconePrivacidade();
}

function alternarPrivacidade() {
    const ativa = document.body.classList.toggle('privacidade-ativa');
    localStorage.setItem('privacidadeAtiva', ativa.toString());
    atualizarIconePrivacidade();

    rerenderizarTelaAtual();

    // Feedback visual rápido
    const icone = document.getElementById('imgPrivacidade');
    if (icone) { icone.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.25)' }, { transform: 'scale(1)' }], { duration: 260 }); }
}

function rerenderizarTelaAtual() {
    try {
        if (typeof carregarDashboard === 'function' && document.getElementById('filtroMesAno')) carregarDashboard();
        if (typeof carregarRelatorioMensal === 'function' && document.getElementById('filtroMesRelatorio')) carregarRelatorioMensal();
        if (typeof carregarCentralPagamentos === 'function' && document.getElementById('tabela-pagamentos-body')) carregarCentralPagamentos();
        if (typeof carregarTabelaFinanciamentosGeral === 'function' && document.getElementById('tabelaFinanciamentosGeral')) carregarTabelaFinanciamentosGeral();
        if (typeof carregarTabelaBensGeral === 'function' && document.getElementById('tabelaBensGeral')) carregarTabelaBensGeral();
        if (typeof renderizarCartoes === 'function' && document.getElementById('gridCartoesCredito')) renderizarCartoes();
        if (typeof carregarDetalhesFinanciamentoPagina === 'function' && document.getElementById('tabelaParcelasFinanciamento')) carregarDetalhesFinanciamentoPagina();
        if (typeof carregarDetalhesParceladaPagina === 'function' && document.getElementById('tabelaParcelasGrupo')) carregarDetalhesParceladaPagina();
        if (typeof carregarGraficoDetalhado === 'function' && document.getElementById('tabelaGraficoDetalhado')) carregarGraficoDetalhado();
        if (typeof renderizarCategorias === 'function' && document.getElementById('listaCategorias')) renderizarCategorias();
    } catch (e) { console.warn('Falha ao re-renderizar:', e); }
}

function atualizarIconePrivacidade() {
    const img = document.getElementById('imgPrivacidade');
    const ativa = document.body.classList.contains('privacidade-ativa');
    if (img) img.src = ativa ? 'imagens/esconder.png' : 'imagens/ver.png';
    const botao = document.getElementById('btnPrivacidade');
    if (botao) {
        botao.setAttribute('aria-pressed', String(ativa));
        botao.setAttribute('aria-label', ativa ? 'Privacidade ativa. Mostrar valores' : 'Privacidade desativada. Esconder valores');
        botao.title = ativa ? 'Mostrar valores' : 'Esconder valores';
    }
}

function inicializarTemaVisual() { if ((localStorage.getItem('temaSistema') || 'claro') === 'escuro') document.body.classList.add('dark-mode'); }

function alternarTemaVisual(e) {
    const b = document.body; const escuro = !b.classList.contains('dark-mode');
    b.classList.add('theme-animating'); b.classList.toggle('dark-mode', escuro);
    localStorage.setItem('temaSistema', escuro ? 'escuro' : 'claro');
    const botao = document.getElementById('btnTemaVisual');
    if (botao) {
        botao.setAttribute('aria-pressed', String(escuro));
        botao.title = escuro ? 'Ativar tema claro' : 'Ativar tema escuro';
        botao.setAttribute('aria-label', botao.title);
    }
    setTimeout(() => b.classList.remove('theme-animating'), 760);
}

function criarIndicadorSincronizacaoUi() {
    const c = document.getElementById('syncStatusIcon'); if (!c || c.dataset.syncWired) return;
    c.dataset.syncWired = 'true';
    c.dataset.syncState = 'success';
    c.innerHTML = '<img src="imagens/sincronizar.png" alt="" aria-hidden="true"><span id="syncTextLabel">Sincronizado</span>';

    c.onclick = async () => {
        const pendente = localStorage.getItem('syncPendente') === 'true';
        const temConflito = localStorage.getItem(SYNC_CONFLICT_KEY) !== null;

        if (pendente || temConflito) {
            const forcar = await mostrarConfirmacaoModal('Existem alterações locais pendentes ou em conflito. Deseja baixar um backup e tentar conciliá-las com os dados atuais do Sheets? Se houver conflito real, o envio será bloqueado.');

            if (forcar) {
                await forcarEnvioComBackup();
            } else {
                if (await mostrarConfirmacaoModal('Aviso: Tem certeza que deseja descartar suas alterações locais e baixar os dados limpos do servidor?')) {
                    atualizarIndicadorSyncUI('pending');
                    try {
                        const j = await buscarDadosServidor();
                        gravarSnapshotLocal(migrarDados(j).dados, true);
                        syncPendingData = null;
                        localStorage.removeItem('syncPendente');
                        localStorage.removeItem(SYNC_CONFLICT_KEY);
                        atualizarIndicadorSyncUI('success');
                    } catch (e) {
                        atualizarIndicadorSyncUI('error');
                        await mostrarAlertaModal('Erro: ' + e.message);
                    }
                }
            }
            return;
        }

        atualizarIndicadorSyncUI('pending');
        try { const j = await buscarDadosServidor(); gravarSnapshotLocal(migrarDados(j).dados, true); syncPendingData = null; localStorage.removeItem('syncPendente'); localStorage.removeItem(SYNC_CONFLICT_KEY); atualizarIndicadorSyncUI('success'); }
        catch (e) { atualizarIndicadorSyncUI('error'); await mostrarAlertaModal('Erro: ' + e.message); }
    };
}

async function forcarEnvioComBackup() {
    if (syncInFlight || reenvioEmAndamento) {
        await mostrarAlertaModal('Já existe uma sincronização em andamento. Aguarde sua conclusão antes de recuperar os dados.');
        return;
    }
    reenvioEmAndamento = true;
    clearTimeout(syncTimer); syncTimer = null;
    mostrarLoading('Salvando backup e conciliando informações...', true);
    try {
        const dbLocalStr = localStorage.getItem(DB_KEY);
        if (!dbLocalStr) throw new Error('Sem dados locais para enviar.');
        const usuarioId = localStorage.getItem('usuarioLogado');
        const donoPendencias = localStorage.getItem(CHAVE_DONO_PENDENCIAS);
        if (!usuarioId || (donoPendencias && String(donoPendencias) !== String(usuarioId))) {
            throw new Error('Os dados pendentes pertencem a outra sessão. Entre com a conta correspondente antes de reenviar.');
        }
        const dbLocal = JSON.parse(dbLocalStr);

        const blob = new Blob([dbLocalStr], { type: 'text/plain' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `backup_emergencia_${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(a.href), 30000);

        const base = lerJSONLocal(SYNC_BASELINE_KEY, null);
        if (!base || !COLECOES_DADOS.every(nome => Array.isArray(base[nome]))) {
            throw new Error('Não existe snapshot-base completo para uma recuperação segura. O backup foi gerado; nenhuma alteração foi enviada.');
        }
        const resGet = await buscarDadosServidor();
        if (!COLECOES_DADOS.every(nome => Array.isArray(resGet[nome]))) {
            throw new Error('O servidor retornou coleções incompletas. Reenvio cancelado para proteger os dados.');
        }
        if (localStorage.getItem(DB_KEY) !== dbLocalStr) {
            throw new Error('Os dados locais mudaram durante a recuperação. Tente novamente para incluir os lançamentos recentes.');
        }
        const conciliacao = prepararReenvioSeguro(
            migrarDados(clonarDados(base)).dados,
            migrarDados(clonarDados(dbLocal)).dados,
            clonarDados(resGet),
            usuarioId
        );
        if (conciliacao.conflitos.length) {
            marcarConflitoSincronizacao(dbLocal, conciliacao.conflitos,
                'Alterações simultâneas precisam ser analisadas antes do reenvio.');
            throw new Error('Foram encontrados ' + conciliacao.conflitos.length +
                ' conflitos entre o navegador e o Sheets. Nada foi sobrescrito. O backup local permanece disponível.');
        }

        const dadosConciliados = conciliacao.dados;
        dadosConciliados._revision = Number(resGet._revision) || 0;
        const snapshotAntesPost = localStorage.getItem(DB_KEY);
        const resPost = await executarPostAPI('salvarDados',
            { sessao: obterSessaoAPI(), dados: dadosConciliados }, 45000);

        if (resPost.status === 'sucesso') {
            const revisao = Number(resPost._revision);
            if (!Number.isFinite(revisao)) throw new Error('O servidor confirmou sem uma revisão válida; preserve o backup e recarregue os dados antes de reenviar.');
            dadosConciliados._revision = revisao;
            clearTimeout(syncTimer); syncTimer = null;
            syncFalhasConsecutivas = 0;
            // Pode ter ocorrido um lançamento local durante o POST. Não o
            // substitua pelo snapshot anterior ao envio já confirmado.
            if (localStorage.getItem(DB_KEY) !== snapshotAntesPost) {
                localStorage.setItem(SYNC_BASELINE_KEY, JSON.stringify(dadosConciliados));
                localStorage.setItem('ultimoSyncMs', String(Date.now()));
                const novosDados = lerJSONLocal(DB_KEY, null);
                if (!novosDados) throw new Error('O estado local mudou e não pôde ser lido. Preserve o backup antes de continuar.');
                novosDados._revision = revisao;
                memoriaSistema = clonarDados(novosDados);
                localStorage.setItem(DB_KEY, JSON.stringify(novosDados));
                syncPendingData = clonarDados(novosDados);
                localStorage.setItem('syncPendente', 'true');
                localStorage.removeItem(SYNC_CONFLICT_KEY);
                atualizarIndicadorSyncUI('pending');
                await mostrarAlertaModal('O reenvio foi concluído, mas há alterações locais mais recentes. Elas foram preservadas e serão sincronizadas em seguida.');
                return;
            }
            syncPendingData = null;
            gravarSnapshotLocal(dadosConciliados, true);
            localStorage.removeItem(SYNC_CONFLICT_KEY);
            localStorage.removeItem('syncPendente');
            localStorage.removeItem(CHAVE_DONO_PENDENCIAS);
            atualizarIndicadorSyncUI('success');
            await mostrarAlertaModal('Dados conciliados e sincronizados! Um backup foi baixado antes do envio.');
            location.reload();
        } else if (resPost.status === 'conflito') {
            throw new Error('Outra alteração chegou ao Sheets durante a recuperação. Nada foi descartado; tente novamente.');
        } else {
            throw new Error('O servidor recusou o reenvio: ' + (resPost.mensagem || 'erro não identificado'));
        }
    } catch (e) {
        atualizarIndicadorSyncUI('error');
        await mostrarAlertaModal('Erro na execução: ' + e.message);
    } finally {
        reenvioEmAndamento = false;
        if (syncPendingData && !localStorage.getItem(SYNC_CONFLICT_KEY)) agendarSincronizacaoSilenciosa(true);
        esconderLoading();
    }
}


// ============================================================================
// 7. CRUD — CATEGORIAS, LANÇAMENTOS, FATURAS, FINANCIAMENTOS, LOTES
// ============================================================================
async function adicionarCategoria(nome, tipo) {
    if (!await exigirPermissao('criarMovimento') || processandoAcaoModal || !await verificarSenhaAdmin('cadastrar categoria')) return false;
    processandoAcaoModal = true; mostrarLoading('Salvando...');
    try {
        const d = obterDados(), nl = normalizarTexto(nome);
        if (!nl || !['entrada','saida'].includes(tipo)) throw new Error('Dados inválidos.');
        if ((d.categorias || []).some(c => c.tipo === tipo && normalizarTexto(c.nome) === nl)) throw new Error('Categoria já existe.');
        d.categorias.push({ id: proximoIdLancamento(d.categorias), nome: nome.trim(), tipo, classificacao: 'personalizado', criadopor: obterUsuarioAtualId(d) });
        registrarLog(d, 'CADASTRO CATEGORIA', `Criada: ${nome} (${tipo})`);
        await salvarDados(d); notificarOperacao('Categoria adicionada. Sincronização em segundo plano.'); return true;
    } catch (e) { await mostrarAlertaModal(e.message); return false; } finally { esconderLoading(); processandoAcaoModal = false; }
}

async function atualizarCategoria(id, nome, tipo) {
    if (!await exigirPermissao('criarMovimento') || processandoAcaoModal || !await verificarSenhaAdmin('editar categoria')) return false;
    processandoAcaoModal = true; mostrarLoading('Atualizando...');
    try {
        const d = obterDados(), c = d.categorias.find(x => String(x.id) === String(id));
        if (!c || c.classificacao === 'padrao') throw new Error('Inválido ou padrão.');
        if (Number(c.criadopor) !== Number(obterUsuarioAtualId(d))) throw new Error('Só o criador pode editar.');
        if (c.tipo !== tipo && ((d.lancamentos||[]).some(l=>String(l.categoriaId)===String(id)) || (d.financiamentos||[]).some(f=>String(f.categoriaId)===String(id)))) throw new Error('Categoria em uso, não pode mudar tipo.');
        c.nome = nome.trim(); c.tipo = tipo;
        registrarLog(d, 'EDIÇÃO CATEGORIA', `Atualizada: ${c.nome}`);
        await salvarDados(d); notificarOperacao('Categoria atualizada. Sincronização em segundo plano.'); return true;
    } catch (e) { await mostrarAlertaModal(e.message); return false; } finally { esconderLoading(); processandoAcaoModal = false; }
}

async function excluirCategoria(id) {
    if (!await exigirPermissao('excluirMovimento') || processandoAcaoModal || !await verificarSenhaAdmin('excluir categoria')) return false;
    processandoAcaoModal = true; mostrarLoading('Excluindo...');
    try {
        const d = obterDados(), c = d.categorias.find(x => String(x.id) === String(id));
        if (!c || c.classificacao === 'padrao' || Number(c.criadopor) !== Number(obterUsuarioAtualId(d))) throw new Error('Não pode excluir.');
        if ((d.lancamentos||[]).some(l=>String(l.categoriaId)===String(id)) || (d.financiamentos||[]).some(f=>String(f.categoriaId)===String(id))) throw new Error('Em uso.');
        d.categorias = d.categorias.filter(x => String(x.id) !== String(id));
        registrarLog(d, 'EXCLUSÃO CATEGORIA', `Excluída: ${id}`);
        await salvarDados(d); notificarOperacao('Categoria removida. Sincronização em segundo plano.'); return true;
    } catch (e) { await mostrarAlertaModal(e.message); return false; } finally { esconderLoading(); processandoAcaoModal = false; }
}

async function adicionarLancamentoComParcelas(form) {
    if (!await exigirPermissao('criarMovimento') || processandoAcaoModal) return false;
    processandoAcaoModal = true; mostrarLoading("Salvando...");
    try {
        const d = obterDados(), uId = Number(obterUsuarioAtualId(d)), vt = numeroSeguro(form.valorTotal);
        const q = Math.min(48, Math.max(1, inteiroSeguro(form.qtdParcelas, 1)));
        if (!form.descricao?.trim() || vt <= 0 || !form.vencimento) throw new Error('Preencha corretamente.');
        const naturezaRenda = form.tipo === 'entrada' && ['folha', 'adiantamento', 'salarial_extra', 'variavel', 'nao_renda'].includes(form.naturezaRenda)
            ? form.naturezaRenda : '';
        if (!validarRendaPorRegime({tipo: form.tipo, categoriaId: form.categoriaId, naturezaRenda}, d, obterUsuarioAtual(d))) {
            throw new Error('Esta categoria ou classificação não está habilitada para seu perfil de renda.');
        }
        const horaExtraInformada = numeroSeguro(form.horaExtra);
        if (horaExtraInformada < 0 || horaExtraInformada > vt || (horaExtraInformada > 0 && naturezaRenda && naturezaRenda !== 'folha')) {
            throw new Error('A hora extra deve fazer parte do valor total da folha de pagamento.');
        }
        const classeRenda = classificarEntradaRendimento({tipo: form.tipo, categoriaId: form.categoriaId,
            descricao: form.descricao, naturezaRenda}, d);
        const brutoFolha = Number(form.remuneracaoBruta || 0);
        const horaExtraBruta = Number(form.horaExtraBruta || 0);
        if (![brutoFolha, horaExtraBruta].every(v => Number.isFinite(v) && v >= 0 && v <= 10000000) ||
            (!['folha', 'salarial_extra'].includes(classeRenda) && (brutoFolha || horaExtraBruta)) ||
            (classeRenda !== 'folha' && horaExtraBruta) || (brutoFolha && horaExtraBruta > brutoFolha)) {
            throw new Error('Valores brutos inválidos: horas extras só pertencem à folha regular.');
        }
        if (form.competenciaRenda && !/^\d{4}-(0[1-9]|1[0-2])$/.test(form.competenciaRenda)) {
            throw new Error('Competência de renda inválida.');
        }
        const b = form.bemId ? d.bens.find(x => String(x.id) === String(form.bemId)) : null;
        let esc = form.tipo === 'saida' ? (form.escopo || 'casal') : 'casal';
        if (b) esc = b.compartilhado ? 'casal' : esc;
        const valP = dividirValorExato(vt, q);
        const heP = horaExtraInformada ? dividirValorExato(horaExtraInformada, q) : Array(q).fill(0);
        const dB = criarDataLocal(form.vencimento);
        let nId = proximoIdLancamento(d.lancamentos, q);
        const pId = q > 1 ? gerarId('parc') : null;

        for (let i = 1; i <= q; i++) {
            const dV = adicionarMesesClamped(dB, i - 1);
            const pg = form.tipo === 'entrada' ? (form.statusInicial === 'pago') : (form.formaPagamento !== 'CARTAO' && form.statusInicial === 'pago');
            const vencStr = dataLocalYYYYMMDD(dV);
            const fatId = form.formaPagamento === 'CARTAO' ? `fat_${form.cartaoId}_${vencStr.slice(0, 7)}` : null;

            d.lancamentos.push({
                id: nId++, usuarioId: uId, descricao: q > 1 ? `${form.descricao} (${i}/${q})` : form.descricao,
                valor: valP[i-1], tipo: form.tipo, categoriaId: form.categoriaId, formaPagamento: form.formaPagamento === 'FIXO' ? 'BOLETO' : form.formaPagamento,
                cartaoId: form.cartaoId || null, bemId: form.bemId ? Number(form.bemId) : null, dataCompra: form.dataCompra || null,
                vencimento: vencStr, recorrencia: form.formaPagamento === 'FIXO' ? 'mensal' : 'unica', parcelaAtual: i, totalParcelas: q, parcelamentoId: pId,
                observacao: form.observacao || '', horaExtra: form.tipo === 'entrada' ? heP[i-1] : 0,
                horaExtraBruta: form.tipo === 'entrada' && classeRenda === 'folha' ? centavosRenda(horaExtraBruta) : 0,
                remuneracaoBruta: form.tipo === 'entrada' && ['folha','salarial_extra'].includes(classeRenda) ? centavosRenda(brutoFolha) : 0,
                competenciaRenda: form.tipo === 'entrada' ? (form.competenciaRenda || vencStr.slice(0, 7)) : '',
                naturezaRenda, servicoEssencial: form.tipo === 'saida' ? (form.servicoEssencial || 'nao') : 'nao',
                escopo: esc, pago: pg, status: pg ? 'pago' : 'pendente', dataPagamento: pg ? vencStr : null,
                faturaId: fatId, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
            });
        }
        if (esc === 'casal') {
            const usuarioAtual = d.usuarios.find(u => Number(u.id) === uId);
            if (usuarioAtual?.parceiroId) {
                if (!Array.isArray(d.notificacoes)) d.notificacoes = [];
                const primeiroNome = (usuarioAtual.nome || 'Usuário').split(' ')[0];
                const tipoAcaoTxt = form.tipo === 'entrada' ? 'uma entrada' : 'um gasto';
                const tituloNotif = form.tipo === 'entrada' ? 'Nova Entrada de Casal 💰' : 'Novo Gasto de Casal 🏠';
                d.notificacoes.push({
                    id: gerarId('notif'),
                    usuarioDestinoId: usuarioAtual.parceiroId,
                    remetenteId: uId,
                    tipo: 'lancamento_casal',
                    titulo: tituloNotif,
                    mensagem: `${primeiroNome} registou ${tipoAcaoTxt} de casal: ${form.descricao} no valor de ${formatarMoedaPrivada(vt)}.`,
                    lida: false,
                    statusAprovacao: '',
                    createdAt: new Date().toISOString()
                });
            }
        }
        registrarLog(d, "NOVO LANÇAMENTO", `Criado: ${form.descricao} (${q}x)`);
        if (typeof salvarMemoriaAdiantamentoSeNecessario === 'function') {
            try { salvarMemoriaAdiantamentoSeNecessario(form.descricao, valP[0]); } catch (_) {}
        }
        await salvarDados(d); notificarOperacao('Lançamento registrado. Sincronização em segundo plano.'); return true;
    } catch (e) { await mostrarAlertaModal(e.message); return false; } finally { esconderLoading(); processandoAcaoModal = false; }
}

async function alternarStatusPagamento(id) {
    if (!await exigirPermissao('criarMovimento') || processandoAcaoModal) return false;
    processandoAcaoModal = true; mostrarLoading("Atualizando...");
    try {
        const d = obterDados(), l = d.lancamentos.find(x => String(x.id) === String(id));
        if (!l || !usuarioPodeAlterarLancamento(l, d)) throw new Error('Sem permissão.');
        const contratoVinculado = (d.financiamentos || []).find(f => String(f.id) === String(l.financiamentoId));
        if (contratoVinculado?.tipoContrato === 'emprestimo' && l.tipo === 'entrada') {
            throw new Error('Esta entrada representa o valor já recebido do empréstimo. Para evitar divergências, ela não pode ser marcada como pendente.');
        }
        if (l.faturaId || l.formaPagamento === 'CARTAO') throw new Error('A quitação de compras de crédito é controlada globalmente pela fatura do cartão.');

        l.pago = !l.pago; l.status = l.pago ? 'pago' : (l.vencimento < dataLocalYYYYMMDD() ? 'atrasado' : 'pendente');
        l.dataPagamento = l.pago ? dataLocalYYYYMMDD() : null; l.usuarioPagamentoId = l.pago ? obterUsuarioAtualId(d) : null;
        l.updatedAt = new Date().toISOString();
        registrarLog(d, "STATUS PAGAMENTO", `${l.descricao} -> ${l.pago ? 'PAGO' : 'PENDENTE'}`);
        await salvarDados(d); return true;
    } catch (e) { await mostrarAlertaModal(e.message); return false; } finally { esconderLoading(); processandoAcaoModal = false; }
}

async function alternarStatusFaturaConsolidada(faturaId, statusPago) {
    if (!await exigirPermissao('criarMovimento') || processandoAcaoModal) return false;
    processandoAcaoModal = true; mostrarLoading('Atualizando a fatura inteira...');
    try {
        const d = obterDados(), uId = Number(obterUsuarioAtualId(d));

        const itens = d.lancamentos.filter(l => String(l.faturaId) === String(faturaId));
        if (!itens.length) throw new Error('Nenhum lançamento foi encontrado para esta fatura.');

        const hj = dataLocalYYYYMMDD(), ag = new Date().toISOString();
        itens.forEach(l => {
            l.pago = statusPago;
            l.status = statusPago ? 'pago' : (l.vencimento < hj ? 'atrasado' : 'pendente');
            l.dataPagamento = statusPago ? hj : null;
            l.usuarioPagamentoId = statusPago ? uId : null;
            l.updatedAt = ag;
        });

        registrarLog(d, 'STATUS FATURA', `Fatura ${faturaId} -> ${statusPago ? 'PAGA' : 'PENDENTE'}`);
        await salvarDados(d); return true;
    } catch (e) { await mostrarAlertaModal(e.message); return false; } finally { esconderLoading(); processandoAcaoModal = false; }
}

async function removerLancamentoInteligente(id) {
    if (!await exigirPermissao('excluirMovimento')) return false;
    const d = obterDados(), l = d.lancamentos.find(x => String(x.id) === String(id));
    if (!l || !usuarioPodeAlterarLancamento(l, d)) return mostrarAlertaModal('Sem permissão.');
    const contratoVinculado = (d.financiamentos || []).find(f => String(f.id) === String(l.financiamentoId));
    if (contratoVinculado?.tipoContrato === 'emprestimo' && l.tipo === 'entrada') {
        await mostrarAlertaModal('Esta entrada é a liberação do empréstimo. Para evitar deixar o contrato inconsistente, exclua o contrato completo na tela de Financiamentos.');
        return false;
    }
    const pId = resolverParcelamentoId(l), fId = resolverFinanciamentoIdPorLancamento(l, d);
    let esc = 'esta';
    if (pId || fId) { esc = await mostrarOpcaoEscopoModal('Excluir apenas esta ou todas?'); if (!esc) return false; }
    const mt = await mostrarPromptTextoModal("Justificativa", "Motivo:"); if (!mt) return false;
    mostrarLoading("Excluindo...");
    const uId = Number(obterUsuarioAtualId(d)), nU = obterUsuarioAtual(d)?.nome || 'User', dh = formatarDataSemHora(new Date());
    if (esc === 'esta') {
        d.exclusao_movimento.push({ id: gerarId('exc'), dataHora: dh, usuario: nU, usuarioId: uId, lancamentoId: id, descricao: l.descricao, valor: l.valor, motivo: mt });
        d.lancamentos = d.lancamentos.filter(x => String(x.id) !== String(id));
    } else {
        const contratoGrupo = fId == null ? null : (d.financiamentos || []).find(f => String(f.id) === String(fId));
        const rel = pId
            ? d.lancamentos.filter(x => x.parcelamentoId === pId)
            : d.lancamentos.filter(x => String(resolverFinanciamentoIdPorLancamento(x, d)) === String(fId)
                && (contratoGrupo?.tipoContrato !== 'emprestimo' || x.tipo === 'saida'));
        rel.forEach(x => d.exclusao_movimento.push({ id: gerarId('exc'), dataHora: dh, usuario: nU, usuarioId: uId, lancamentoId: x.id, descricao: x.descricao, valor: x.valor, motivo: mt }));
        const rIds = new Set(rel.map(x => String(x.id)));
        d.lancamentos = d.lancamentos.filter(x => !rIds.has(String(x.id)));
    }
    registrarLog(d, "EXCLUSÃO", `Excluído. Motivo: ${mt}`);
    await salvarDados(d); esconderLoading(); notificarOperacao('Lançamento removido. Sincronização em segundo plano.'); return true;
}

function descreverOrigemLancamento(l, dados = obterDados()) {
    if (!l) return null;
    const finId = resolverFinanciamentoIdPorLancamento(l, dados);
    if (finId) {
        const fin = (dados.financiamentos || []).find(f => String(f.id) === String(finId));
        if (fin) return {
            icone: fin.tipoContrato === 'emprestimo' ? '💰' : '🏦',
            cor: 'var(--primary)',
            detalhe: `${fin.tipoContrato === 'emprestimo' ? 'Empréstimo' : 'Financiamento'}: ${fin.nome}`
        };
    }
    if (l.parcelamentoId) return {
        icone: '🔢', cor: 'var(--warning)',
        detalhe: `Compra parcelada: ${descricaoBaseParcelamento(l.descricao || '')}`
    };
    if (l.faturaId) return {
        icone: '💳', cor: 'var(--text-muted)',
        detalhe: `Fatura de cartão: ${l.faturaId}`
    };
    return null;
}

// O valor salvo em uma compra parcelada é o valor de cada parcela.
// Reconstrói o total real a partir do grupo, inclusive centavos de arredondamento.
function obterValorTotalCompraParcelada(lancamento, dados = obterDados()) {
    const quantidade = Number(lancamento?.totalParcelas);
    if (lancamento?.tipo !== 'saida' || lancamento?.formaPagamento !== 'CARTAO'
        || !Number.isInteger(quantidade) || quantidade < 2) return null;

    const lancamentos = dados.lancamentos || [];
    const grupoId = resolverParcelamentoId(lancamento);
    // Um lote de contas no cartão não é uma única compra parcelada.
    if (String(grupoId || '').startsWith('lote_')) return null;
    const mesmaCompra = item => item.tipo === 'saida'
        && item.formaPagamento === 'CARTAO'
        && Number(item.totalParcelas) === quantidade
        && String(item.usuarioId) === String(lancamento.usuarioId)
        && String(item.cartaoId) === String(lancamento.cartaoId);

    const parcelas = grupoId != null
        ? lancamentos.filter(item => mesmaCompra(item) && String(resolverParcelamentoId(item)) === String(grupoId))
        : lancamentos.filter(item => mesmaCompra(item) && !resolverParcelamentoId(item)
            && String(item.dataCompra || '') === String(lancamento.dataCompra || '')
            && descricaoBaseParcelamento(item.descricao || '') === descricaoBaseParcelamento(lancamento.descricao || ''));

    const numeros = new Set(parcelas.map(item => Number(item.parcelaAtual)));
    const grupoCompleto = parcelas.length === quantidade && numeros.size === quantidade
        && [...numeros].every(n => Number.isInteger(n) && n >= 1 && n <= quantidade);
    const valor = grupoCompleto
        ? parcelas.reduce((soma, item) => soma + Number(item.valor || 0), 0)
        : Number(lancamento.valor || 0) * quantidade;

    return { valor: Number(valor.toFixed(2)), estimado: !grupoCompleto };
}

function abrirHistoricoLancamento(lancamentoId) {
    const dados = obterDados();
    const lanc = (dados.lancamentos || []).find(l => String(l.id) === String(lancamentoId));
    if (!lanc) { mostrarAlertaModal('Lançamento não encontrado.'); return; }

    const edicoes = (dados.edicao_movimento || []).filter(e => String(e.lancamentoId) === String(lancamentoId));
    const exclusoes = (dados.exclusao_movimento || []).filter(e => String(e.lancamentoId) === String(lancamentoId));
    const origem = descreverOrigemLancamento(lanc, dados);

    let timeline = '';
    edicoes.slice().reverse().forEach(e => {
        timeline += `<li style="margin-bottom:10px;padding:10px;background:var(--warning-soft);border-radius:8px;list-style:none;">
            <div style="font-size:.72rem;color:var(--text-muted);">${escaparHTML(e.dataHora || '-')} • ${escaparHTML(e.usuario || '-')}</div>
            <div style="font-size:.85rem;margin-top:4px;"><strong>Edição:</strong>
                ${escaparHTML(e.descricaoAntiga || '')} → ${escaparHTML(e.descricaoNova || '')}<br>
                Valor: ${escaparHTML(formatarMoeda(e.valorAntigo || 0))} → ${escaparHTML(formatarMoeda(e.valorNovo || 0))}<br>
                <em style="color:var(--text-muted);">Motivo: ${escaparHTML(e.motivo || '-')}</em>
            </div></li>`;
    });
    exclusoes.slice().reverse().forEach(e => {
        timeline += `<li style="margin-bottom:10px;padding:10px;background:var(--danger-soft);border-radius:8px;list-style:none;">
            <div style="font-size:.72rem;color:var(--text-muted);">${escaparHTML(e.dataHora || '-')} • ${escaparHTML(e.usuario || '-')}</div>
            <div style="font-size:.85rem;margin-top:4px;"><strong>Exclusão:</strong>
                ${escaparHTML(e.descricao || '')} (${escaparHTML(formatarMoeda(e.valor || 0))})<br>
                <em style="color:var(--text-muted);">Motivo: ${escaparHTML(e.motivo || '-')}</em>
            </div></li>`;
    });
    if (!timeline) timeline = '<li style="color:var(--text-muted);text-align:center;padding:20px;list-style:none;">Nenhuma edição ou exclusão registrada.</li>';

    const origemHtml = origem
        ? `<p style="margin-bottom:4px;"><strong>Origem:</strong> <span style="color:${origem.cor};font-weight:700;">${origem.icone} ${escaparHTML(origem.detalhe)}</span></p>`
        : '';
    const parcInfo = (lanc.parcelaAtual && lanc.totalParcelas)
        ? `<p style="margin-bottom:4px;"><strong>Parcela:</strong> ${escaparHTML(lanc.parcelaAtual)}/${escaparHTML(lanc.totalParcelas)}</p>` : '';
    const totalCompra = obterValorTotalCompraParcelada(lanc, dados);
    const valorTotalHtml = totalCompra
        ? `<p class="auditoria-valor-total"><strong>Valor total${totalCompra.estimado ? ' estimado' : ''}:</strong> ${escaparHTML(formatarMoeda(totalCompra.valor))}</p>`
        : '';

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
        <div class="modal-box" style="max-width:560px;width:95%;">
            <h3>Histórico do lançamento</h3>
            <div style="text-align:left;margin-bottom:14px;font-size:.9rem;">
                <p style="margin-bottom:4px;"><strong>Descrição:</strong> ${escaparHTML(lanc.descricao || '-')}</p>
                <p style="margin-bottom:4px;"><strong>Valor:</strong> ${escaparHTML(formatarMoeda(lanc.valor || 0))}</p>
                ${valorTotalHtml}
                <p style="margin-bottom:4px;"><strong>Vencimento:</strong> ${escaparHTML(formatarDataBR(lanc.vencimento || ''))}</p>
                ${parcInfo}${origemHtml}
                <p style="margin-bottom:4px;"><strong>Criado em:</strong> ${escaparHTML(formatarDataSemHora(lanc.createdAt || ''))}</p>
                <p style="margin-bottom:4px;"><strong>Última alteração:</strong> ${escaparHTML(formatarDataSemHora(lanc.updatedAt || ''))}</p>
            </div>
            <h4 style="margin:12px 0 8px;font-size:.95rem;">Linha do tempo</h4>
            <ul style="padding:0;max-height:300px;overflow-y:auto;">${timeline}</ul>
            <button type="button" data-fechar style="width:100%;background-color:var(--primary);margin-top:16px;">Fechar</button>
        </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('[data-fechar]').onclick = () => fecharModal(overlay);
    overlay.addEventListener('click', e => { if (e.target === overlay) fecharModal(overlay); });
}

async function atualizarLancamentoNoBanco(id, novosDados, opcoes = {}) {
    if (!await exigirPermissao('criarMovimento', 'editar lançamentos')) return false;
    const dados = obterDados();
    const lancamento = (dados.lancamentos || []).find(l => String(l.id) === String(id));
    if (!lancamento) { await mostrarAlertaModal("Lançamento não encontrado."); return false; }
    if (!usuarioPodeAlterarLancamento(lancamento, dados)) { await mostrarAlertaModal('Sem permissão.'); return false; }
    const tipoValido = ['entrada', 'saida'].includes(novosDados?.tipo);
    const categoriaValida = (dados.categorias || []).some(c => String(c.id) === String(novosDados?.categoriaId) && c.tipo === novosDados?.tipo);
    if (!tipoValido || !categoriaValida) { await mostrarAlertaModal('Selecione uma categoria válida.'); return false; }
    const valorNovo = numeroSeguro(novosDados?.valor, NaN);
    if (!Number.isFinite(valorNovo) || valorNovo <= 0) { await mostrarAlertaModal('O valor deve ser maior que zero.'); return false; }
    const naturezaNova = novosDados.tipo === 'entrada' && ['folha', 'adiantamento', 'salarial_extra', 'variavel', 'nao_renda'].includes(novosDados.naturezaRenda)
        ? novosDados.naturezaRenda : '';
    const naturezaOriginal = String(lancamento.naturezaRenda || '');
    const preservaClassificacaoHistorica = novosDados.tipo === lancamento.tipo &&
        String(novosDados.categoriaId) === String(lancamento.categoriaId) && naturezaNova === naturezaOriginal;
    if (!preservaClassificacaoHistorica &&
        !validarRendaPorRegime({tipo: novosDados.tipo, categoriaId: novosDados.categoriaId, naturezaRenda: naturezaNova},
            dados, (dados.usuarios || []).find(u => String(u.id) === String(lancamento.usuarioId)))) {
        await mostrarAlertaModal('Esta classificação não está habilitada para o perfil de renda.'); return false;
    }
    const horaExtraNova = novosDados.tipo === 'entrada' ? numeroSeguro(novosDados.horaExtra) : 0;
    if (horaExtraNova < 0 || horaExtraNova > valorNovo || (horaExtraNova > 0 && naturezaNova && naturezaNova !== 'folha')) {
        await mostrarAlertaModal('A hora extra informada deve estar incluída no valor da folha, sem ultrapassá-lo.'); return false;
    }
    const novaClasseRenda = classificarEntradaRendimento({tipo: novosDados.tipo, categoriaId: novosDados.categoriaId,
        descricao: novosDados.descricao, naturezaRenda: naturezaNova}, dados);
    const brutoNovo = Number(novosDados.remuneracaoBruta || 0);
    const extraBrutaNova = Number(novosDados.horaExtraBruta || 0);
    const competenciaNova = novosDados.tipo === 'entrada' ? String(novosDados.competenciaRenda || '') : '';
    if (![brutoNovo, extraBrutaNova].every(v => Number.isFinite(v) && v >= 0 && v <= 10000000) ||
        (!['folha','salarial_extra'].includes(novaClasseRenda) && (brutoNovo || extraBrutaNova)) ||
        (novaClasseRenda !== 'folha' && extraBrutaNova) ||
        (brutoNovo && extraBrutaNova > brutoNovo) ||
        (competenciaNova && !/^\d{4}-(0[1-9]|1[0-2])$/.test(competenciaNova))) {
        await mostrarAlertaModal('Valores brutos ou competência inválidos.'); return false;
    }

    const grupoId = resolverParcelamentoId(lancamento);
    const finId = resolverFinanciamentoIdPorLancamento(lancamento, dados);
    const contratoEditado = finId == null ? null : (dados.financiamentos || []).find(f => String(f.id) === String(finId));
    if (contratoEditado?.tipoContrato === 'emprestimo' && lancamento.tipo === 'entrada') {
        await mostrarAlertaModal('A entrada do valor liberado é controlada pelo contrato do empréstimo e não pode ser editada como uma parcela comum.');
        return false;
    }
    if (finId != null && novosDados.tipo !== lancamento.tipo) {
        await mostrarAlertaModal('Não é possível mudar o tipo de um lançamento vinculado a um contrato. Edite apenas valor, descrição ou vencimento.');
        return false;
    }
    const ehVinculado = Boolean(grupoId) || Boolean(finId);

    let aplicarParaTodas = false;
    if (ehVinculado) {
        const escolha = await mostrarOpcaoEscopoModal("Este lançamento faz parte de um financiamento ou compra parcelada. Aplicar a modificação a todas as parcelas?");
        if (escolha === null) return false;
        aplicarParaTodas = (escolha === 'todas');
    }

    const motivo = await mostrarPromptTextoModal("Justificativa Obrigatória", "Informe o motivo da edição:");
    if (!motivo) return false;

    mostrarLoading("Atualizando...");
    const uId = localStorage.getItem('usuarioLogado');
    const u = dados.usuarios.find(user => Number(user.id) === Number(uId));
    const nomeUsuario = u ? u.nome : "Desconhecido";
    const dataHoraAtual = formatarDataSemHora(new Date());

    if (aplicarParaTodas) {
        const relacionados = finId
            ? dados.lancamentos.filter(l => String(resolverFinanciamentoIdPorLancamento(l, dados)) === String(finId) && l.tipo === lancamento.tipo)
            : dados.lancamentos.filter(l => String(l.parcelamentoId) === String(grupoId));
        if (!relacionados.length || relacionados.some(l => !usuarioPodeAlterarLancamento(l, dados))) {
            esconderLoading();
            await mostrarAlertaModal('O grupo contém parcelas que não podem ser alteradas.'); return false;
        }
        const finEditado = finId == null ? null : (dados.financiamentos || []).find(f => String(f.id) === String(finId));
        if (finEditado) {
            const baseNova = String(novosDados.descricao || '').replace(/\s\(\d+\/\d+\)$/, '').trim();
            finEditado.nome = baseNova.replace(/^(?:Financiamento|Empréstimo|Emprestimo):\s*/i, '').trim() || finEditado.nome;
            finEditado.valorParcela = Number(valorNovo.toFixed(2));
            finEditado.categoriaId = novosDados.categoriaId;
            const dataRef = novosDados.vencimento ? criarDataLocal(novosDados.vencimento) : null;
            if (dataRef) finEditado.primeiroVencimento = dataParaString(adicionarMesesClamped(dataRef, 1 - Number(lancamento.parcelaAtual || 1)));
            finEditado.updatedAt = new Date().toISOString();
        }
        relacionados.forEach(l => {
            const descAntiga = l.descricao, valorAntigo = l.valor;
            const sufixoMatch = l.descricao.match(/\s\(\d+\/\d+\)$/);
            const sufixo = sufixoMatch ? sufixoMatch[0] : '';
            const baseNova = novosDados.descricao.replace(/\s\(\d+\/\d+\)$/, '').trim();
            l.descricao = sufixo ? `${baseNova}${sufixo}` : baseNova;
            l.tipo = novosDados.tipo;
            l.categoriaId = novosDados.categoriaId;
            l.formaPagamento = novosDados.formaPagamento;
            if (novosDados.valor !== undefined && novosDados.valor !== null && novosDados.valor !== '') l.valor = Number(numeroSeguro(novosDados.valor).toFixed(2));
            l.observacao = novosDados.observacao;
            l.servicoEssencial = novosDados.tipo === 'saida' ? (novosDados.servicoEssencial || 'nao') : 'nao';
            l.escopo = novosDados.tipo === 'saida' ? (novosDados.escopo || 'casal') : 'casal';

            l.horaExtra = horaExtraNova;
            l.naturezaRenda = naturezaNova;
            l.horaExtraBruta = extraBrutaNova;
            l.remuneracaoBruta = brutoNovo;
            l.competenciaRenda = competenciaNova;
            l.bemId = (novosDados.tipo === 'saida' && novosDados.bemId != null && novosDados.bemId !== '')
                ? Number(novosDados.bemId) : null;

            const cartaoAnteriorGrupo = l.cartaoId;
            if (novosDados.formaPagamento === 'CARTAO' && novosDados.tipo === 'saida') {
                l.cartaoId = novosDados.cartaoId || l.cartaoId || null;
                l.dataCompra = novosDados.dataCompra || l.dataCompra || null;
                if (String(l.cartaoId) !== String(cartaoAnteriorGrupo) && l.dataCompra) {
                    const novoCartao = (dados.cartoes || []).find(c => String(c.id) === String(l.cartaoId));
                    if (novoCartao) l.vencimento = calcularPrimeiroVencimentoCartao(novoCartao, l.dataCompra);
                }
            } else { l.cartaoId = null; l.dataCompra = null; }

            if (novosDados.vencimento) {
                const novaDataRef = criarDataLocal(novosDados.vencimento);
                if (novaDataRef) {
                    const pAtual = Number(lancamento.parcelaAtual || 1);
                    const pRel = Number(l.parcelaAtual || pAtual);
                    l.vencimento = dataParaString(adicionarMesesClamped(novaDataRef, pRel - pAtual));
                }
            }

            l.faturaId = (l.formaPagamento === 'CARTAO' && l.cartaoId && l.vencimento) ? `fat_${l.cartaoId}_${String(l.vencimento).slice(0, 7)}` : null;

            l.updatedAt = new Date().toISOString();
            dados.edicao_movimento.push({ id: gerarId('edit'), dataHora: dataHoraAtual, usuario: nomeUsuario, usuarioId: Number(uId), lancamentoId: l.id, descricaoAntiga: descAntiga, descricaoNova: l.descricao, valorAntigo, valorNovo: l.valor, motivo: `[EM LOTE] ${motivo}` });
        });
        registrarLog(dados, "EDIÇÃO EM LOTE", `Atualizadas ${relacionados.length} parcelas. Motivo: ${motivo}`);
    } else {
        const descAntiga = lancamento.descricao, valorAntigo = lancamento.valor;
        lancamento.descricao = novosDados.descricao;
        lancamento.tipo = novosDados.tipo;
        lancamento.categoriaId = novosDados.categoriaId;
        lancamento.formaPagamento = novosDados.formaPagamento;
        lancamento.valor = Number(numeroSeguro(novosDados.valor).toFixed(2));
        lancamento.observacao = novosDados.observacao;
        lancamento.vencimento = novosDados.vencimento;
        lancamento.updatedAt = new Date().toISOString();

        lancamento.horaExtra = horaExtraNova;
        lancamento.naturezaRenda = naturezaNova;
        lancamento.horaExtraBruta = extraBrutaNova;
        lancamento.remuneracaoBruta = brutoNovo;
        lancamento.competenciaRenda = competenciaNova;
        lancamento.bemId = (novosDados.tipo === 'saida' && novosDados.bemId != null && novosDados.bemId !== '')
            ? Number(novosDados.bemId) : null;

        const cartaoAnterior = lancamento.cartaoId;
        if (novosDados.formaPagamento === 'CARTAO' && novosDados.tipo === 'saida') {
            lancamento.cartaoId = novosDados.cartaoId || lancamento.cartaoId || null;
            lancamento.dataCompra = novosDados.dataCompra || lancamento.dataCompra || null;
            if (String(lancamento.cartaoId) !== String(cartaoAnterior) && lancamento.dataCompra) {
                const novoCartao = (dados.cartoes || []).find(c => String(c.id) === String(lancamento.cartaoId));
                if (novoCartao) lancamento.vencimento = calcularPrimeiroVencimentoCartao(novoCartao, lancamento.dataCompra);
            }
        } else { lancamento.cartaoId = null; lancamento.dataCompra = null; }

        lancamento.faturaId = (lancamento.formaPagamento === 'CARTAO' && lancamento.cartaoId && lancamento.vencimento) ? `fat_${lancamento.cartaoId}_${String(lancamento.vencimento).slice(0, 7)}` : null;

        lancamento.servicoEssencial = novosDados.tipo === 'saida' ? (novosDados.servicoEssencial || 'nao') : 'nao';
        lancamento.escopo = novosDados.tipo === 'saida' ? (novosDados.escopo || 'casal') : 'casal';
        dados.edicao_movimento.push({ id: gerarId('edit'), dataHora: dataHoraAtual, usuario: nomeUsuario, usuarioId: Number(uId), lancamentoId: id, descricaoAntiga: descAntiga, descricaoNova: novosDados.descricao, valorAntigo, valorNovo: novosDados.valor, motivo });
        registrarLog(dados, "EDIÇÃO LANÇAMENTO", `ID ${id} atualizado. Motivo: ${motivo}`);
    }
    await salvarDados(dados);
    esconderLoading();
    if (!opcoes.silencioso) await mostrarAlertaModal("Lançamento(s) atualizado(s) com sucesso!");
    return true;
}

async function adicionarFinanciamentoComRecorrencia(nome, recorrente, valorParcela, qtdMeses, primeiroVencimento, categoriaId = null, bemId = null, opcoes = {}) {
    if (!await exigirPermissao('financiamentos', 'criar contratos')) return false;
    if (processandoAcaoModal) return false;
    if (!await verificarSenhaAdmin(opcoes.tipoContrato === 'emprestimo' ? 'cadastrar contrato de empréstimo/consignado' : 'cadastrar contrato de financiamento')) return false;
    processandoAcaoModal = true; mostrarLoading(opcoes.tipoContrato === 'emprestimo' ? 'Cadastrando empréstimo...' : 'Cadastrando financiamento...');
    try {
        const dados = obterDados();
        const usuarioId = Number(localStorage.getItem('usuarioLogado'));
        const nomeFinal = String(nome || '').trim();
        const tipoContrato = opcoes.tipoContrato === 'emprestimo' ? 'emprestimo' : 'financiamento';
        const valorFinal = numeroSeguro(valorParcela);
        const meses = Math.min(360, Math.max(1, inteiroSeguro(qtdMeses, 1)));
        const dataBase = criarDataLocal(primeiroVencimento);
        const catId = categoriaId || dados.categorias.find(c => c.tipo === 'saida' && normalizarTexto(c.nome).includes('financiamento'))?.id || dados.categorias.find(c => c.tipo === 'saida')?.id || null;
        const catFin = (dados.categorias || []).find(c => String(c.id) === String(catId) && c.tipo === 'saida');
        const dup = (dados.financiamentos || []).some(f => Number(f.usuarioId) === usuarioId && normalizarTexto(f.nome) === normalizarTexto(nomeFinal));
        if (dup) throw new Error('Você já possui um contrato com esse nome.');
        if (!nomeFinal || !Number.isFinite(valorFinal) || valorFinal <= 0 || !dataBase || !Number.isFinite(dataBase.getTime()) || !catFin) throw new Error('Informe nome, parcela, primeiro vencimento e uma categoria de saída válidos.');

        const bem = bemId ? (dados.bens || []).find(x => String(x.id) === String(bemId) && x.ativo !== false) : null;
        if (tipoContrato === 'financiamento' && !bem) throw new Error('Selecione um bem patrimonial ativo para o financiamento.');
        if (bemId && !bem) throw new Error('O bem selecionado não existe ou está inativo.');
        if (bem) {
            const propBem = Number(bem.usuarioId || 0);
            const uAtual = (dados.usuarios || []).find(u => Number(u.id) === usuarioId);
            const pAtual = Number(uAtual?.parceiroId || 0);
            const bemDoParceiro = propBem !== 0 && propBem !== usuarioId && propBem === pAtual && bem.compartilhado === true;
            if (propBem !== 0 && propBem !== usuarioId && !bemDoParceiro) throw new Error('O bem pertence a outro usuário e não está compartilhado.');
        }

        let valorLiberado = 0, dataLiberacao = '', categoriaEntradaId = '', escopoContrato = opcoes.escopoContrato === 'casal' ? 'casal' : 'individual';
        let valorCompra = null, valorEntrada = 0, valorFinanciado = null;
        if (tipoContrato === 'emprestimo') {
            valorLiberado = numeroSeguro(opcoes.valorLiberado);
            const dataLib = criarDataLocal(opcoes.dataLiberacao);
            categoriaEntradaId = opcoes.categoriaEntradaId || '';
            const catEntrada = (dados.categorias || []).find(c => String(c.id) === String(categoriaEntradaId) && c.tipo === 'entrada');
            if (!Number.isFinite(valorLiberado) || valorLiberado <= 0) throw new Error('Informe o valor líquido efetivamente recebido no empréstimo.');
            if (!dataLib || !Number.isFinite(dataLib.getTime())) throw new Error('Informe uma data de recebimento válida.');
            if (!catEntrada) throw new Error('Selecione uma categoria do tipo entrada para registrar o valor recebido.');
            dataLiberacao = dataParaString(dataLib);
        } else {
            valorCompra = numeroSeguro(opcoes.valorCompra, NaN);
            valorEntrada = numeroSeguro(opcoes.valorEntrada, 0);
            if (!Number.isFinite(valorCompra) || valorCompra <= 0) throw new Error('Informe o valor de compra do bem.');
            if (!Number.isFinite(valorEntrada) || valorEntrada < 0) throw new Error('O valor da entrada não pode ser negativo.');
            if (valorEntrada >= valorCompra) throw new Error('A entrada deve ser menor que o valor de compra para haver saldo financiado.');
            valorCompra = Number(valorCompra.toFixed(2));
            valorEntrada = Number(valorEntrada.toFixed(2));
            valorFinanciado = Number((valorCompra - valorEntrada).toFixed(2));
            escopoContrato = bem?.compartilhado ? 'casal' : 'individual';
        }

        const finId = proximoIdLancamento(dados.financiamentos || []);
        const parcelamentoId = tipoContrato === 'financiamento' ? gerarId('finparc') : null;
        const totalMeses = recorrente === 'sim' ? meses : 1;
        const valorParcelaFinal = Number(valorFinal.toFixed(2));
        const valorContrato = {
            id: finId, usuarioId, nome: nomeFinal, tipoContrato,
            bemId: bem ? Number(bem.id) : null,
            totalMeses, mesesPagos: 0, valorParcela: valorParcelaFinal,
            valorLiberado, categoriaId: catId, categoriaEntradaId,
            dataLiberacao, valorCompra, valorEntrada, valorFinanciado,
            primeiroVencimento: dataParaString(dataBase),
            escopoContrato, ativo: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
        };
        dados.financiamentos.push(valorContrato);

        let nId = proximoIdLancamento(dados.lancamentos, (Number(totalMeses) || 1) + 1);
        const agora = new Date().toISOString();
        const prefixo = tipoContrato === 'emprestimo' ? 'Empréstimo' : 'Financiamento';

        if (tipoContrato === 'emprestimo') {
            dados.lancamentos.push({
                id: nId++, usuarioId, descricao: `Empréstimo recebido: ${nomeFinal}`,
                valor: Number(valorLiberado.toFixed(2)), tipo: 'entrada', categoriaId: Number(categoriaEntradaId),
                formaPagamento: 'DINHEIRO', cartaoId: null, bemId: null,
                vencimento: dataLiberacao, dataCompra: null, dataPagamento: dataLiberacao,
                recorrencia: 'unica', parcelaAtual: 1, totalParcelas: 1, parcelamentoId: null,
                financiamentoId: finId, observacao: 'Valor efetivamente recebido na liberação do contrato de empréstimo/consignado.',
                horaExtra: 0, servicoEssencial: 'nao', escopo: escopoContrato,
                pago: true, status: 'pago', usuarioPagamentoId: usuarioId, faturaId: null,
                createdAt: agora, updatedAt: agora
            });
        }

        for (let i = 1; i <= totalMeses; i++) {
            const dataVenc = adicionarMesesClamped(dataBase, i - 1);
            dados.lancamentos.push({
                id: nId++, usuarioId, descricao: `${prefixo}: ${nomeFinal} (${i}/${totalMeses})`, valor: valorParcelaFinal,
                tipo: 'saida', categoriaId: catId, formaPagamento: 'BOLETO', cartaoId: null, bemId: bem ? Number(bem.id) : null,
                vencimento: dataParaString(dataVenc), recorrencia: 'mensal', parcelaAtual: i, totalParcelas: totalMeses,
                parcelamentoId, financiamentoId: finId,
                observacao: tipoContrato === 'emprestimo' ? 'Parcela mensal gerada pelo contrato de empréstimo/consignado.' : 'Gerado automaticamente pelo contrato',
                horaExtra: 0, servicoEssencial: 'nao', escopo: escopoContrato,
                pago: false, status: 'pendente', faturaId: null, createdAt: agora, updatedAt: agora
            });
        }

        registrarLog(dados, tipoContrato === 'emprestimo' ? 'CADASTRO EMPRÉSTIMO' : 'CADASTRO FINANCIAMENTO',
            tipoContrato === 'emprestimo'
                ? `Contrato: ${nomeFinal}; recebido ${formatarMoeda(valorLiberado)}; ${totalMeses} parcelas de ${formatarMoeda(valorParcelaFinal)}.`
                : `Contrato: ${nomeFinal} (${totalMeses} meses)`,
            { entidade: 'financiamento', entidadeId: finId });
        await salvarDados(dados);
        esconderLoading(); processandoAcaoModal = false;
        await mostrarAlertaModal(tipoContrato === 'emprestimo'
            ? 'Empréstimo cadastrado! O valor recebido foi lançado como entrada e as parcelas foram criadas como saídas.'
            : 'Financiamento cadastrado com sucesso!');
        return true;
    } catch (erro) {
        console.error(erro);
        esconderLoading(); processandoAcaoModal = false;
        await mostrarAlertaModal(erro.message || 'Erro ao cadastrar o contrato.');
        return false;
    }
}

async function excluirFinanciamento(id) {
    if (!await exigirPermissao('financiamentos', 'excluir financiamentos')) return false;
    if (!await exigirPermissao('excluirMovimento', 'excluir movimentos')) return false;
    if (processandoAcaoModal) return false;
    if (!await verificarSenhaAdmin("excluir financiamento")) return false;
    if (!await mostrarConfirmacaoModal("Excluir este contrato e todas as parcelas associadas?")) return false;
    processandoAcaoModal = true; mostrarLoading("Excluindo financiamento...");
    try {
        const dados = obterDados();
        const fin = dados.financiamentos.find(f => String(f.id) === String(id));
        if (!fin) throw new Error('Financiamento não encontrado.');
        if (Number(fin.usuarioId) !== Number(obterUsuarioAtualId(dados))) throw new Error('Só o dono pode excluir.');
        const parcelas = dados.lancamentos.filter(l =>
            String(l.financiamentoId) === String(fin.id) || pertenceAoFinanciamento(l, fin, dados)
        );
        parcelas.forEach(l => {
            const u = obterUsuarioAtual(dados);
            dados.exclusao_movimento.push({ id: gerarId('exc'), dataHora: formatarDataSemHora(new Date()), usuario: u ? u.nome : 'Desconhecido', usuarioId: u ? Number(u.id) : null, lancamentoId: l.id, descricao: l.descricao, valor: l.valor, motivo: '[FINANCIAMENTO] Exclusão do contrato' });
        });
        dados.financiamentos = dados.financiamentos.filter(f => String(f.id) !== String(id));
        dados.lancamentos = dados.lancamentos.filter(l => !parcelas.some(p => String(p.id) === String(l.id)));
        registrarLog(dados, "EXCLUSÃO FINANCIAMENTO", `ID ${id} (${fin.nome}) e ${parcelas.length} parcela(s).`, { entidade: 'financiamento', entidadeId: id });
        await salvarDados(dados);
        esconderLoading(); processandoAcaoModal = false;
        await mostrarAlertaModal("Financiamento excluído com sucesso!"); return true;
    } catch (erro) {
        console.error(erro);
        esconderLoading(); processandoAcaoModal = false;
        await mostrarAlertaModal(erro.message || 'Erro ao excluir.'); return false;
    }
}

async function adicionarContaLotePorPeriodo(descricao, valorParcela, dataInicio, qtdMeses, categoriaId, bemId = null, formaPagamento = 'BOLETO', cartaoId = null, opcoes = {}) {
    if (!await exigirPermissao('lotes', 'gerar contas em lote')) return false;
    if (!await exigirPermissao('criarMovimento', 'criar lançamentos')) return false;
    if (processandoAcaoModal) return false;
    processandoAcaoModal = true; mostrarLoading('Gerando contas em lote...');
    try {
        const dados = obterDados();
        const usuarioId = Number(localStorage.getItem('usuarioLogado'));
        const descFinal = String(descricao || '').trim();
        const valorFinal = numeroSeguro(valorParcela);
        const quantidade = inteiroSeguro(qtdMeses, 0);
        const dataBase = dataInicio instanceof Date ? new Date(dataInicio) : criarDataLocal(dataInicio);
        const categoria = (dados.categorias || []).find(c => String(c.id) === String(categoriaId) && c.tipo === 'saida');
        if (!descFinal || valorFinal <= 0 || !dataBase || !Number.isFinite(dataBase.getTime())) throw new Error('Descrição, valor e data inválidos.');
        if (!categoria) throw new Error('Categoria de saída inválida.');
        if (quantidade < 1 || quantidade > 120) throw new Error('O lote deve ter 1 a 120 meses.');
        const cartao = formaPagamento === 'CARTAO' ? (dados.cartoes || []).find(c => String(c.id) === String(cartaoId) && c.ativo !== false && !c.isBeneficio && Number(c.usuarioId) === usuarioId) : null;
        if (formaPagamento === 'CARTAO' && !cartao) throw new Error('Cartão inválido.');
        let escopo = opcoes.escopo === 'individual' ? 'individual' : 'casal';
        if (bemId) {
            const bem = (dados.bens || []).find(b => String(b.id) === String(bemId) && b.ativo !== false);
            if (!bem) throw new Error('Bem inválido.');
            escopo = bem.compartilhado ? 'casal' : 'individual';
        }
        const observacao = String(opcoes.observacao || '').trim().slice(0, 250) || 'Gerado por lote/período';
        const servicoEssencial = opcoes.servicoEssencial === 'sim' ? 'sim' : 'nao';
        let nId = proximoIdLancamento(dados.lancamentos, quantidade);
        const parcelamentoId = quantidade > 1 ? gerarId('lote') : null;
        const agora = new Date().toISOString(), hoje = dataLocalYYYYMMDD();

        for (let i = 0; i < quantidade; i++) {
            const dataCompraDate = adicionarMesesClamped(dataBase, i);
            const dataCompraStr = dataParaString(dataCompraDate);
            const vencimento = cartao ? calcularPrimeiroVencimentoCartao(cartao, dataCompraStr) : dataCompraStr;
            const atrasada = vencimento < hoje;
            const fatId = cartao ? `fat_${cartao.id}_${vencimento.slice(0, 7)}` : null;

            dados.lancamentos.push({
                id: nId++, usuarioId, descricao: `${descFinal} (${i + 1}/${quantidade})`,
                valor: Number(valorFinal.toFixed(2)), tipo: 'saida', categoriaId: categoria.id,
                formaPagamento: formaPagamento === 'FIXO' ? 'BOLETO' : formaPagamento,
                cartaoId: cartao ? cartao.id : null, bemId: bemId ? Number(bemId) : null,
                dataCompra: cartao ? dataCompraStr : null, vencimento, recorrencia: formaPagamento === 'FIXO' ? 'mensal' : 'unica',
                parcelaAtual: i + 1, totalParcelas: quantidade, parcelamentoId,
                observacao, horaExtra: 0, servicoEssencial,
                escopo, pago: false, status: atrasada ? 'atrasado' : 'pendente', faturaId: fatId,
                createdAt: agora, updatedAt: agora
            });
        }
        registrarLog(dados, 'CONTA LOTE PERÍODO', `Lote: ${descFinal} (${quantidade} meses)`);
        await salvarDados(dados);
        if (!opcoes.silencioso) notificarOperacao('Contas em lote criadas. Sincronização em segundo plano.');
        return true;
    } catch (erro) {
        console.error(erro);
        if (typeof opcoes.onError === 'function') opcoes.onError(erro.message || 'Erro ao criar lote.');
        else await mostrarAlertaModal(erro.message || 'Erro ao criar lote.');
        return false;
    } finally { esconderLoading(); processandoAcaoModal = false; }
}

// ============================================================================
// 7.5 MEMÓRIA DE ADIANTAMENTO SALARIAL
// ============================================================================
function salvarMemoriaAdiantamentoSeNecessario(descricao, valor) {
    const sel = document.getElementById('categoriaLancamento');
    const dados = obterDados();
    if (!sel) return;
    const cat = dados.categorias.find(c => Number(c.id) === Number(sel.value));
    if (cat && cat.nome.toLowerCase().includes('adiantamento')) {
        const uId = localStorage.getItem('usuarioLogado');
        localStorage.setItem(`adiantamentoSalario_u${uId}`, JSON.stringify({ descricao, valor }));
    }
}

// ============================================================================
// 8. DASHBOARD, GRÁFICOS, RELATÓRIOS
// ============================================================================
const PALETA_GRAFICOS = ['#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#ec4899','#84cc16','#f97316','#6366f1','#14b8a6','#a855f7'];
const somarPor = (lista, chave) => { const m = {}; lista.forEach(l => { const k = chave(l); m[k] = (m[k] || 0) + Number(l.valor || 0); }); return Object.entries(m).sort((a, b) => b[1] - a[1]); };

function popularFiltrosDashboard(d) {
    const preencher = (id, itens, rotuloTodos, valorTodos) => {
        const el = document.getElementById(id); if (!el) return;
        const assinatura = itens.map(i => i.id + ':' + i.nome).join('|');
        if (el.dataset.assinatura === assinatura) return;
        const atual = el.value;
        el.innerHTML = '';
        el.add(new Option(rotuloTodos, valorTodos));
        itens.forEach(i => el.add(new Option(i.nome, i.id)));
        el.value = [...el.options].some(o => o.value === atual) ? atual : valorTodos;
        el.dataset.assinatura = assinatura;
    };
    preencher('filtroCategoriaDashboard', (d.categorias || []).filter(c => c.tipo !== 'entrada'), 'Todas', 'todas');
    preencher('filtroGraficoCartao', (d.cartoes || []).filter(c => c.ativo !== false), 'Todos', 'todos');
}

function carregarDashboard() {
    const elMes = document.getElementById('filtroMesAno');
    if (elMes && !elMes.value) elMes.value = dataLocalYYYYMMDD().slice(0, 7);
    const mes = elMes?.value || '', esc = document.getElementById('filtroEscopoDashboardGeral')?.value || 'casal';
    const buscaDash = normalizarTexto(document.getElementById('filtroDescricaoDashboard')?.value || '');
    
    const d = obterDados();
    popularFiltrosDashboard(d);
    const nomeCat = id => (d.categorias.find(x => String(x.id) === String(id)) || {}).nome || 'Sem categoria';
    
    // Lançamentos base (sem busca) para cálculos consolidados
    const lnsBase = filtrarDadosPorPermissao(d.lancamentos || [], d, esc).filter(l => {
        const mesValido = String(l.vencimento || l.dataCompra || '').startsWith(mes);
        const escopoValido = (esc === 'todos' || l.tipo === 'entrada' || (l.escopo || 'casal') === esc);
        return mesValido && escopoValido;
    });
    
    // Lançamentos filtrados pela busca (para tabela e saídas)
    const lnsFiltrados = lnsBase.filter(l => 
        !buscaDash || normalizarTexto(l.descricao || '').includes(buscaDash)
    );
    
    // Saídas filtradas (para KPI de saídas e gráficos de saída)
    const lnsSaidasFiltradas = lnsFiltrados.filter(l => l.tipo === 'saida');

    // Totais de entrada (base) e saídas (base e filtrada)
    let tE = 0, tSal = 0, tUb = 0, tEmprestimos = 0;
    let tS_original = 0, tCart_original = 0;
    let tS_filtrado = 0, tCart_filtrado = 0;
    
    const reUber = /uber|(^|[^0-9])99(?![0-9])/;
    
    lnsBase.forEach(l => {
        const v = Number(l.valor || 0), c = normalizarTexto(nomeCat(l.categoriaId));
        const contratoEntrada = l.tipo === 'entrada' && (d.financiamentos || []).some(f =>
            String(f.id) === String(l.financiamentoId) && f.tipoContrato === 'emprestimo'
        );
        if (l.tipo === 'entrada') {
            tE += v;
            if (contratoEntrada) tEmprestimos += v;
            else if (['folha', 'adiantamento', 'salarial_extra'].includes(classificarEntradaRendimento(l, d))) tSal += v;
            else if (reUber.test(c)) tUb += v;
        } else {
            tS_original += v;
            if (l.formaPagamento === 'CARTAO') tCart_original += v;
        }
    });
    
    lnsSaidasFiltradas.forEach(l => {
        const v = Number(l.valor || 0);
        tS_filtrado += v;
        if (l.formaPagamento === 'CARTAO') tCart_filtrado += v;
    });
    
        // [SALDO ACUMULADO] O saldo "geral" representa o dinheiro que continua em conta:
    // soma de todas as entradas − saídas até o mês selecionado (inclusive).
    // O saldo do mês isolado continua disponível no sub-detalhe.
    const calcularSaldoAte = (limiteMes) => {
        if (!limiteMes) return 0;
        const todos = filtrarDadosPorPermissao(d.lancamentos || [], d, esc).filter(l => {
            const mesLanc = String(l.vencimento || l.dataCompra || '').slice(0, 7);
            if (!mesLanc || mesLanc > limiteMes) return false;
            return l.tipo === 'entrada' || (l.escopo || 'casal') === esc;
        });
        return todos.reduce((acc, l) => acc + (l.tipo === 'entrada' ? 1 : -1) * Number(l.valor || 0), 0);
    };

    const saldoMes = tE - tS_original;
    let saldoAnterior = 0;
    if (/^\d{4}-\d{2}$/.test(mes)) {
        const [anoRef, mesRef] = mes.split('-').map(Number);
        const dataAnt = new Date(anoRef, mesRef - 2, 1);
        const mesAnt = dataAnt.getFullYear() + '-' + String(dataAnt.getMonth() + 1).padStart(2, '0');
        saldoAnterior = calcularSaldoAte(mesAnt);
    }
    const saldoAcumulado = saldoAnterior + saldoMes;

    const priv = document.body.classList.contains('privacidade-ativa');
    const safeHTML = (id, html) => { const e = document.getElementById(id); if (e) e.innerHTML = html; };

    safeHTML('totalEntradas', formatarMoeda(tE)); 
    safeHTML('totalSaidas', formatarMoeda(tS_filtrado));
    
    const eS = document.getElementById('saldoGeral'); 
    if (eS) { 
        eS.textContent = formatarMoeda(saldoAcumulado); 
        eS.className = `stat-value saldo-destaque ${saldoAcumulado >= 0 ? 'positivo' : 'negativo'}`;
        const rotuloEl = eS.previousElementSibling;
        if (rotuloEl && rotuloEl.classList.contains('stat-label')) {
            rotuloEl.textContent = 'Saldo em Conta';
        }
        const detalheEl = eS.nextElementSibling;
        if (detalheEl && detalheEl.classList.contains('stat-detail')) {
            detalheEl.innerHTML = priv
                ? ''
                : `<strong>Mês:</strong> ${formatarMoeda(saldoMes)}<br><strong>Anterior:</strong> ${formatarMoeda(saldoAnterior)}`;
        }
    }

    if (priv) {
        safeHTML('subDetalhesEntradas', '');
        safeHTML('subDetalhesSaidas', '');
        safeHTML('maiorFocoDetalhe', '');
        const elFoco = document.getElementById('maiorFocoValor');
        if (elFoco) elFoco.textContent = formatarMoeda(0);
    } else {
        safeHTML('subDetalhesEntradas', `<strong>Renda principal:</strong> ${formatarMoeda(tSal)}<br><strong>Uber:</strong> ${formatarMoeda(tUb)}<br><strong>Empréstimos:</strong> ${formatarMoeda(tEmprestimos)}<br><strong>Outros:</strong> ${formatarMoeda(Math.max(0, tE - tSal - tUb - tEmprestimos))}`);
        safeHTML('subDetalhesSaidas', `<strong>Cartão:</strong> ${formatarMoeda(tCart_filtrado)}<br><strong>Outras:</strong> ${formatarMoeda(Math.max(0, tS_filtrado - tCart_filtrado))}`);
        
        // Maior foco usa as saídas ORIGINAIS (sem busca)
        const saidasOriginais = lnsBase.filter(l => l.tipo !== 'entrada');
        const topo = somarPor(saidasOriginais, l => nomeCat(l.categoriaId))[0];
        safeHTML('maiorFocoValor', formatarMoeda(topo ? topo[1] : 0));
        safeHTML('maiorFocoDetalhe', topo ? `${escaparHTML(topo[0])} — ${Math.round((topo[1] / (tS_original || 1)) * 100)}% das saídas` : 'Nenhum gasto registrado');
    }

    // Gráficos usam saídas filtradas (mas entradas totais)
    atualizarGraficosDashboard(tE, tS_filtrado, d, lnsSaidasFiltradas);
    
    // Tabela usa todos os lançamentos filtrados (entradas + saídas)
    renderizarTabelaUltimosLancamentos(lnsFiltrados, d, nomeCat);
    
    // Pulso usa dados base (sem busca)
    renderizarCentralLembretes(lnsBase, d, mes);

    // Extras: pulso e top categorias usam dados base (sem busca)
    if (typeof renderizarSessoesDashboardExtras === 'function') {
        try { 
            const dadosBase = { ...d, lancamentos: lnsBase };
            renderizarPulsoDashboard(lnsBase, dadosBase, mes);
            // Top categorias também com dados base
            renderizarTopCategoriasDashboard(dadosBase, lnsBase);
        } catch (e) { 
            console.warn('[Extras Dashboard]', e); 
        }
    }
}

function atualizarGraficosDashboard(tE, tS, dados, lns) {
    if (typeof Chart === 'undefined') return;
    const priv = document.body.classList.contains('privacidade-ativa');
    const isDashboard = String(window.location.pathname).split('/').pop().toLowerCase() === 'dashboard.html';
    const val = id => document.getElementById(id)?.value;
    const nomeCat = id => (dados.categorias.find(x => String(x.id) === String(id)) || {}).nome || 'Sem categoria';
    const saidas = lns.filter(l => l.tipo !== 'entrada');

    const irParaGrafico = (tipo, extras = {}) => {
        if (!isDashboard) return;
        const mes = val('filtroMesAno') || '';
        const escopo = val('filtroEscopoDashboardGeral') || 'casal';
        const qs = new URLSearchParams({ tipo, mes, escopo, ...extras });
        window.location.href = `grafico.html?${qs.toString()}`;
    };

    const clickOpts = (cb) => {
        if (!isDashboard) return {};
        return {
            onClick: cb,
            onHover: (evt, els) => { if (evt?.native?.target) evt.native.target.style.cursor = els.length ? 'pointer' : 'default'; }
        };
    };

    const gerenciarPlaceholder = (canvasId, mensagem) => {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;
        const container = canvas.parentElement;
        if (!container) return;
        const existente = container.querySelector('.privacy-section-placeholder');
        if (priv) {
            canvas.style.visibility = 'hidden';
            canvas.style.position = 'absolute';
            if (!existente) {
                const ph = document.createElement('div');
                ph.className = 'privacy-section-placeholder';
                ph.style.cssText = 'position:absolute;inset:0;margin:0;height:100%;';
                ph.innerHTML = `<div><strong>${escaparHTML(mensagem)}</strong></div><div style="font-size:0.82rem;font-weight:500;">Toque no banner de privacidade para revelar.</div>`;
                container.appendChild(ph);
            }
        } else {
            canvas.style.visibility = '';
            canvas.style.position = '';
            if (existente) existente.remove();
        }
    };

    gerenciarPlaceholder('graficoEntradasSaidas', 'Entradas x saídas oculto');
    gerenciarPlaceholder('graficoGastosCategorias', 'Gastos por categoria oculto');
    gerenciarPlaceholder('graficoServicosEssenciais', 'Essenciais x não essenciais oculto');
    gerenciarPlaceholder('graficoCartoesLimite', 'Limite dos cartões oculto');
    gerenciarPlaceholder('graficoTiposSaida', 'Tipos de saída oculto');

    if (priv) return;

    const draw = (chave, canvasId, type, labels, data, colors, extra = {}) => {
        const c = document.getElementById(canvasId); if (!c) return;
        if (charts[chave]) charts[chave].destroy();
        const vazio = !data.some(n => n > 0);
        const extraOptions = extra.options || {};
        charts[chave] = new Chart(c, {
            type,
            data: { labels: vazio ? ['Sem dados'] : labels, datasets: extra.datasets || [{ data: vazio ? [1] : data, backgroundColor: vazio ? ['#cbd5e1'] : colors, borderWidth: 1 }] },
            options: Object.assign(
                { responsive: true, maintainAspectRatio: false, plugins: { tooltip: { callbacks: { label: ctx => `${ctx.label}: ${formatarMoeda(ctx.raw)}` } } } },
                extraOptions
            )
        });
    };

    // Gráfico Entradas x Saídas
    draw('entradasSaidas', 'graficoEntradasSaidas', 'pie', ['Entradas', 'Saídas'], [tE, tS], ['#10b981', '#ef4444'], {
        options: clickOpts((evt, els) => {
            let filtro = 'todos';
            if (els && els.length) filtro = els[0].index === 0 ? 'entradas' : 'saidas';
            irParaGrafico(filtro);
        })
    });

    // Gráfico Gastos por Categoria
    const fCat = val('filtroCategoriaDashboard') || 'todas';
    const base = fCat === 'todas'
        ? somarPor(saidas, l => nomeCat(l.categoriaId))
        : somarPor(saidas.filter(l => String(l.categoriaId) === String(fCat)), l => l.descricao || 'Sem descrição');
    draw('gastosCategorias', 'graficoGastosCategorias', 'doughnut', base.map(x => x[0]), base.map(x => x[1]), PALETA_GRAFICOS, {
        options: clickOpts((evt, els) => {
            let categoriaId = fCat !== 'todas' ? fCat : '';
            if (!categoriaId && els && els.length && base[els[0].index]) {
                const label = base[els[0].index][0];
                const cat = (dados.categorias || []).find(c => c.nome === label);
                if (cat) categoriaId = cat.id;
            }
            irParaGrafico(categoriaId ? 'categoria' : 'saidas', categoriaId ? { categoriaId: String(categoriaId) } : {});
        })
    });

    // Gráfico Essenciais x Não Essenciais
    const fEss = val('filtroServicoEssencialDashboard') || 'todos';
    const ehEss = l => normalizarTexto(l.servicoEssencial) === 'sim';
    if (fEss === 'todos') {
        draw('servicosEssenciais', 'graficoServicosEssenciais', 'pie',
            ['Essenciais', 'Não essenciais'],
            [saidas.filter(ehEss).reduce((a, l) => a + Number(l.valor || 0), 0), saidas.filter(l => !ehEss(l)).reduce((a, l) => a + Number(l.valor || 0), 0)],
            ['#3b82f6', '#f59e0b'],
            {
                options: clickOpts((evt, els) => {
                    let filtroEss = '';
                    if (els && els.length) filtroEss = els[0].index === 0 ? 'sim' : 'nao';
                    irParaGrafico('essencial', { filtro: filtroEss || 'todos' });
                })
            }
        );
    } else {
        const sub = somarPor(saidas.filter(l => (fEss === 'sim') === ehEss(l)), l => nomeCat(l.categoriaId));
        draw('servicosEssenciais', 'graficoServicosEssenciais', 'pie', sub.map(x => x[0]), sub.map(x => x[1]), PALETA_GRAFICOS, {
            options: clickOpts(() => irParaGrafico('essencial', { filtro: fEss }))
        });
    }

    // Gráfico Limite dos Cartões (usa dados globais)
    const fCar = val('filtroGraficoCartao') || 'todos';
    const cartoes = (dados.cartoes || []).filter(c => c.ativo !== false && (fCar === 'todos' || String(c.id) === String(fCar)));
    const usado = cartoes.map(c => (dados.lancamentos || []).filter(l => l.formaPagamento === 'CARTAO' && String(l.cartaoId) === String(c.id) && !l.pago).reduce((a, l) => a + Number(l.valor || 0), 0));
    const disp = cartoes.map((c, i) => Math.max(0, Number(c.limite || 0) - usado[i]));

    draw('cartoesLimite', 'graficoCartoesLimite', 'bar', cartoes.map(c => c.nome), usado.concat(disp), [], {
        datasets: [{ label: 'Usado', data: usado, backgroundColor: '#ef4444' }, { label: 'Disponível', data: disp, backgroundColor: '#10b981' }],
        options: Object.assign(
            { scales: { x: { stacked: true }, y: { stacked: true, ticks: { callback: v => formatarMoeda(v) } } } },
            clickOpts((evt, els) => {
                let cartaoId = fCar !== 'todos' ? fCar : '';
                if (!cartaoId && els && els.length) {
                    const cartao = cartoes[els[0].index];
                    if (cartao) cartaoId = cartao.id;
                }
                irParaGrafico('cartao', cartaoId ? { cartaoId: String(cartaoId) } : {});
            })
        )
    });

    // Gráfico Tipos de Saída (por forma de pagamento) — clicável.
    // Preservamos a chave bruta (DINHEIRO/CARTAO/BOLETO/PIX/DEBITO/FIXO) em paralelo
    // ao rótulo traduzido, para que o filtro enviado ao grafico.html corresponda
    // exatamente ao valor armazenado no lançamento.
    const mapaFormas = { DINHEIRO: 'Dinheiro / Pix / Débito', BOLETO: 'Boleto', CARTAO: 'Cartão', FIXO: 'Conta Fixa', PIX: 'Pix', DEBITO: 'Débito' };
    const somasFormas = new Map();
    saidas.forEach(l => {
        const chave = l.formaPagamento || 'Outros';
        somasFormas.set(chave, (somasFormas.get(chave) || 0) + Number(l.valor || 0));
    });
    const chavesFormas = [...somasFormas.keys()];
    const labelsFormas = chavesFormas.map(f => mapaFormas[f] || f);
    const dataFormas = chavesFormas.map(k => somasFormas.get(k));

    draw('tiposSaida', 'graficoTiposSaida', 'doughnut', labelsFormas, dataFormas, PALETA_GRAFICOS, {
        options: clickOpts((evt, els) => {
            if (!els || !els.length) return;
            const chave = chavesFormas[els[0].index];
            if (!chave) return;
            irParaGrafico('formaPagamento', { formaPagamento: chave });
        })
    });
}

function renderizarTabelaUltimosLancamentos(lns, d, nomeCat) {
    const tb = document.getElementById('tabelaUltimosLancamentos'); if (!tb) return;

    // Modo Discreto: esconde toda a tabela — descrições, categorias e valores são sensíveis
    if (document.body.classList.contains('privacidade-ativa')) {
        tb.innerHTML = `<tr class="dashboard-tabela-mensagem"><td colspan="7" style="text-align:center;padding:32px 12px;">
            <div style="display:flex;flex-direction:column;align-items:center;gap:8px;color:var(--text-muted);">
                <span style="font-size:2rem;opacity:.6;">🔒</span>
                <strong style="color:var(--text-main);">Últimos lançamentos ocultos</strong>
                <span style="font-size:.82rem;">Toque no banner de privacidade para ver o histórico.</span>
            </div>
        </td></tr>`;
        return;
    }

    const f = document.getElementById('filtroTipoUltimosLancamentos')?.value || 'todos';
    const lista = lns.filter(l => f === 'todos' || l.tipo === f)
        .sort((a, b) => String(b.vencimento || b.dataCompra || '').localeCompare(String(a.vencimento || a.dataCompra || ''))).slice(0, 20);
    if (!lista.length) { tb.innerHTML = '<tr class="dashboard-tabela-mensagem"><td colspan="7" class="muted" style="text-align:center;">Nenhum lançamento no período.</td></tr>'; return; }

    tb.innerHTML = lista.map(l => {
        const u = (d.usuarios || []).find(x => String(x.id) === String(l.usuarioId));
        const ent = l.tipo === 'entrada';
        const origem = descreverOrigemLancamento(l, d);
        const badgeOrigem = origem
            ? ` <span title="${escaparHTML(origem.detalhe)}" style="font-size:.85rem;opacity:.85;cursor:help;">${origem.icone}</span>` : '';
        const fId = l.faturaId || (l.formaPagamento === 'CARTAO' && l.cartaoId && l.vencimento ? `fat_${l.cartaoId}_${String(l.vencimento).slice(0, 7)}` : null);
        const podeAlternar = !fId && l.formaPagamento !== 'CARTAO';
        const acao = podeAlternar
            ? `<button class="btn-acao-icone ${l.pago ? 'desfazer' : 'pagar'}" title="${l.pago ? 'Desfazer pagamento' : 'Marcar como pago'}" onclick="alternarStatusPagamento(${Number(l.id)})"><img src="imagens/${l.pago ? 'desfazer' : 'pagar'}.png" style="width:20px;" alt=""></button>`
            : `<a href="grafico.html?tipo=cartao&cartaoId=${l.cartaoId}&mes=${String(l.vencimento).slice(0, 7)}" class="btn-acao-icone" title="Gerenciar Fatura" style="display:inline-flex; align-items:center; justify-content:center; text-decoration:none;"><span style="font-size:16px;">💳</span></a>`;
        const btnHist = `<button class="btn-acao-icone" title="Histórico / auditoria" onclick="abrirHistoricoLancamento(${Number(l.id)})" style="background:color-mix(in srgb,var(--primary) 20%,transparent);border-color:var(--primary);">🕘</button>`;
        const totalCompra = obterValorTotalCompraParcelada(l, d);
        const valorTotalHtml = totalCompra
            ? `<span class="dashboard-valor-total">Valor total${totalCompra.estimado ? ' estimado' : ''}: ${escaparHTML(formatarMoeda(totalCompra.valor))}</span>`
            : '';

        return `<tr>
            <td data-label="Usuário">${escaparHTML(u ? String(u.nome).split(' ')[0] : '-')}</td>
            <td data-label="Descrição">${escaparHTML(l.descricao)}${badgeOrigem}</td>
            <td data-label="Categoria">${escaparHTML(nomeCat(l.categoriaId))}</td>
            <td data-label="Pagamento">${escaparHTML(l.formaPagamento || '-')}</td>
            <td data-label="Vencimento">${formatarDataBR(l.vencimento || l.dataCompra)}</td>
            <td data-label="Valor" class="${ent ? 'positivo' : 'negativo'} dashboard-valor-parcela">
                <span>${ent ? '+' : '-'} ${formatarMoeda(l.valor)}</span>${valorTotalHtml}
            </td>
            <td data-label="Ações" class="dashboard-lancamento-acoes">${acao}${btnHist}</td></tr>`;
    }).join('');
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

// Extrai os lembretes (contas + faturas consolidadas) a partir da base.
// Reutilizada pelo modal de notificações e por compatibilidade.
function obterLembretesAtivos(dados = obterDados()) {
    const hj = dataLocalYYYYMMDD();
    const lns = filtrarDadosPorPermissao(dados.lancamentos || [], dados, 'casal');
    const fats = {}, lms = [];
    lns.forEach(l => {
        if (l.tipo !== 'saida') return;
        if (l.formaPagamento === 'CARTAO' && l.cartaoId) {
            const mesRef = String(l.vencimento || '').slice(0, 7);
            const cF = `${l.cartaoId}_${mesRef}`;
            if (!fats[cF]) {
                const cartaoObj = (dados.cartoes || []).find(c => String(c.id) === String(l.cartaoId));
                fats[cF] = { cartaoId: l.cartaoId, cartaoNome: cartaoObj?.nome || 'Cartão', val: 0, v: l.vencimento, pago: true, m: mesRef };
            }
            fats[cF].val += Number(l.valor || 0);
            if (!l.pago) fats[cF].pago = false;
            if (l.vencimento > fats[cF].v) fats[cF].v = l.vencimento;
        } else {
            lms.push({ id: l.id, desc: l.descricao, val: Number(l.valor || 0), v: l.vencimento, pago: l.pago });
        }
    });
    Object.values(fats).forEach(f => lms.push({ cartaoId: f.cartaoId, desc: `Fatura: ${f.cartaoNome}`, val: f.val, v: f.v, pago: f.pago, isFat: true, m: f.m }));
    return lms.filter(x => !x.pago || (x.v && x.v >= hj)).sort((a, b) => (a.v || '9999').localeCompare(b.v || '9999'));
}

function renderizarListaLembretes(container, lembretes) {
    if (!container) return;
    if (document.body.classList.contains('privacidade-ativa')) {
        container.innerHTML = `<li style="list-style:none;padding:0;">
            <div class="privacy-section-placeholder" style="padding:26px 18px;margin:6px 0;">
                <div><strong>Lembretes ocultos</strong></div>
                <div style="font-size:0.82rem;font-weight:500;">Use o botão de privacidade na barra superior para revelar.</div>
            </div>
        </li>`;
        return;
    }
    container.innerHTML = lembretes.length ? lembretes.map(i => {
        const btnAcao = i.isFat
            ? `<a href="grafico.html?tipo=cartao&cartaoId=${i.cartaoId}&mes=${i.m}" class="btn-acao-icone" title="Gerenciar Fatura" style="display:inline-flex; align-items:center; justify-content:center; text-decoration:none;"><span style="font-size:16px;">💳</span></a>`
            : `<button type="button" class="btn-acao-icone ${i.pago ? 'desfazer' : 'pagar'}" title="${i.pago ? 'Desfazer pagamento' : 'Marcar como pago'}" onclick="alternarStatusPagamento(${Number(i.id)}).then(function(ok){ if (ok) atualizarModalNotificacoesAposAcao(); })"><img src="imagens/${i.pago ? 'desfazer' : 'pagar'}.png" style="width:20px;" alt=""></button>`;
        return `<li style="opacity:${i.pago ? '0.55' : '1'}; border-bottom:1px solid var(--border); display:flex; justify-content:space-between; align-items:center; padding:10px 0; list-style:none;">
            <div><strong style="${i.pago ? 'text-decoration:line-through;' : ''}">${escaparHTML(i.desc)}</strong><br><small>Venc: ${formatarDataBR(i.v)}</small></div>
            <div style="display:flex; align-items:center; gap:10px;">
                <span class="${i.pago ? 'muted' : 'negativo'}">${formatarMoeda(i.val)}</span>
                ${btnAcao}
            </div>
        </li>`;
    }).join('') : `<li style="list-style:none;text-align:center;padding:20px;"><span class="muted">Nada pendente. 🎉</span></li>`;
}

// Compatibilidade: a Central de Lembretes agora vive dentro do modal de notificações.
function renderizarCentralLembretes(lns, dados, mes) {
    if (typeof renderizarSinoNotificacoes === 'function') {
        try { renderizarSinoNotificacoes(); } catch (_) {}
    }
}

function atualizarModalNotificacoesAposAcao() {
    const modal = document.querySelector('.modal-overlay[data-notif-modal]');
    if (!modal) return;
    const lembretes = obterLembretesAtivos();
    const lista = modal.querySelector('#notifLembretesLista');
    if (lista) renderizarListaLembretes(lista, lembretes);
    const pendentes = lembretes.filter(x => !x.pago).length;
    const tab = modal.querySelector('[data-tab="lembretes"]');
    if (tab) {
        const badge = tab.querySelector('.notif-tab-badge');
        if (pendentes > 0) {
            if (badge) badge.textContent = pendentes;
            else tab.insertAdjacentHTML('beforeend', ` <span class="notif-tab-badge">${pendentes}</span>`);
        } else if (badge) badge.remove();
    }
    if (typeof renderizarSinoNotificacoes === 'function') renderizarSinoNotificacoes();
}

function toggleCentralLembretes() {
    const c = document.getElementById('corpoCentralLembretes'), i = document.getElementById('iconeToggleLembretes');
    if (!c) return;
    const recolhido = c.classList.toggle('recolhido');
    if (i) i.style.transform = recolhido ? 'rotate(-90deg)' : 'rotate(0deg)';
}

function carregarRelatorios() {
    // Compatibilidade: quando existe a página de relatórios dedicada, delega
    // para carregarRelatorioMensal. O código legado não é mais necessário.
    if (typeof window.carregarRelatorioMensal === 'function') {
        return window.carregarRelatorioMensal();
    }
}

function renderizarCategorias() {
    const dados = obterDados();
    const lista = document.getElementById('listaCategorias');
    if (!lista) return;

    // [MODO DISCRETO] — oculta a lista de categorias
    if (document.body.classList.contains('privacidade-ativa')) {
        lista.innerHTML = `<li style="list-style:none;padding:0;">
            <div class="privacy-section-placeholder">
                <div><strong>Categorias ocultas</strong></div>
                <div style="font-size:0.82rem;font-weight:500;">Toque no banner de privacidade para revelar.</div>
            </div>
        </li>`;
        return;
    }

    lista.replaceChildren();
    const filtro = document.getElementById('filtroTipoCategoria');
    const fVal = filtro ? filtro.value : 'todos';
    let cats = dados.categorias || [];
    if (fVal !== 'todos') cats = cats.filter(c => c.tipo === fVal);
    if (!cats.length) {
        const li = document.createElement('li'); li.textContent = 'Nenhuma categoria encontrada.';
        lista.appendChild(li); return;
    }
    const uId = Number(obterUsuarioAtualId(dados));
    cats.forEach(cat => {
        const nome = String(cat.nome || 'Categoria');
        const padrao = cat.classificacao === 'padrao' || Number(cat.criadopor) === 5;
        const gerenciar = !padrao && Number(cat.criadopor) === uId && usuarioPode('criarMovimento');
        const li = document.createElement('li');
        const desc = document.createElement('span');
        desc.append(document.createTextNode(`${nome} (`));
        const t = document.createElement('strong'); t.textContent = String(cat.tipo || '').toUpperCase();
        desc.append(t, document.createTextNode(') - '));
        const cls = document.createElement('span'); cls.style.cssText = 'font-size:.75rem;color:var(--text-muted);';
        cls.textContent = padrao ? 'Padrão' : (Number(cat.criadopor) === uId ? 'Personalizada' : 'Compartilhada');
        desc.appendChild(cls);
        const acoes = document.createElement('div');
        if (gerenciar) {
            const bE = document.createElement('button'); bE.type = 'button'; bE.className = 'btn-acao-icone editar';
            bE.title = 'Editar'; bE.setAttribute('aria-label', `Editar ${nome}`);
            const iE = document.createElement('img'); iE.src = 'imagens/editar.png'; iE.alt = 'Editar';
            bE.appendChild(iE);
            bE.addEventListener('click', () => {
                if (typeof prepararEdicaoCategoria === 'function') prepararEdicaoCategoria(cat.id, nome, cat.tipo);
                else console.warn('prepararEdicaoCategoria não definida (deve estar em categorias.html)');
            });
            const bX = document.createElement('button'); bX.type = 'button'; bX.className = 'btn-acao-icone excluir';
            bX.title = 'Excluir'; bX.setAttribute('aria-label', `Excluir ${nome}`);
            const iX = document.createElement('img'); iX.src = 'imagens/excluir.png'; iX.alt = 'Excluir';
            bX.appendChild(iX);
            bX.addEventListener('click', () => {
                if (typeof excluirCategoriaPrompt === 'function') excluirCategoriaPrompt(cat.id);
                else console.warn('excluirCategoriaPrompt não definida (deve estar em categorias.html)');
            });
            acoes.append(bE, bX);
        } else {
            const info = document.createElement('span'); info.style.cssText = 'font-size:.75rem;color:var(--text-muted);';
            info.textContent = padrao ? 'Sistema' : 'Somente leitura';
            acoes.appendChild(info);
        }
        li.append(desc, acoes);
        lista.appendChild(li);
    });
}

function abrirDetalhamentoParcelamento(lancamentoId, paginaAtual = 1) {
    const dados = obterDados();
    const lanc = (dados.lancamentos || []).find(l => Number(l.id) === Number(lancamentoId));
    if (!lanc) return;
    const grupoId = resolverParcelamentoId(lanc);
    const finId = resolverFinanciamentoIdPorLancamento(lanc, dados);
    let grupo;
    const finRelacionado = finId == null ? null : (dados.financiamentos || []).find(f => String(f.id) === String(finId));
    if (finRelacionado?.tipoContrato === 'emprestimo' && lanc.tipo === 'entrada') grupo = [lanc];
    else if (grupoId) grupo = dados.lancamentos.filter(l => String(l.parcelamentoId) === String(grupoId));
    else if (finId != null) grupo = dados.lancamentos.filter(l =>
        String(resolverFinanciamentoIdPorLancamento(l, dados)) === String(finId) &&
        (finRelacionado?.tipoContrato !== 'emprestimo' || l.tipo === 'saida')
    );
    else grupo = [lanc];
    grupo.sort((a, b) => String(a.vencimento || '').localeCompare(String(b.vencimento || '')));
    const porPag = 30, total = grupo.length || Number(lanc.totalParcelas) || 1, totalPgs = Math.ceil(total / porPag);
    const pg = Math.max(1, Math.min(paginaAtual, totalPgs));
    const ini = (pg - 1) * porPag, fim = ini + porPag;
    const slice = grupo.slice(ini, fim);
    const idSeg = Number(lanc.id), valParc = Number(lanc.valor || 0);
    const valTot = grupo.reduce((a, p) => a + Number(p.valor || 0), 0);
    const uObj = (dados.usuarios || []).find(u => Number(u.id) === Number(lanc.usuarioId));
    const resp = uObj ? uObj.nome : 'Usuário';
    let formaInfo = '';
    if (lanc.formaPagamento === 'CARTAO') { const c = (dados.cartoes || []).find(x => String(x.id) === String(lanc.cartaoId)); formaInfo = `Cartão: ${escaparHTML(c ? c.nome : 'Crédito')}`; }
    else if (lanc.formaPagamento === 'BOLETO') formaInfo = 'Boleto / Conta';
    else if (lanc.formaPagamento === 'FIXO') formaInfo = 'Conta fixa / mensal';
    else formaInfo = escaparHTML(lanc.formaPagamento || 'Não informada');
    let linhas = '';
    slice.forEach((p, i) => {
        linhas += `<tr><td style="text-align:center;">${ini + i + 1}/${total}</td><td>${escaparHTML(formatarDataBR(p.vencimento))}</td><td style="text-align:right;">${escaparHTML(formatarMoeda(p.valor))}</td><td style="text-align:center;"><span class="status-badge ${p.pago ? 'status-pago' : 'status-pendente'}">${p.pago ? 'Pago' : 'Pendente'}</span></td></tr>`;
    });
    let pag = '';
    if (totalPgs > 1) pag = `<div style="display:flex;justify-content:space-between;align-items:center;margin:15px 0;gap:10px;"><button type="button" class="btn-secundario" ${pg === 1 ? 'disabled style="opacity:.5;"' : ''} onclick="abrirDetalhamentoParcelamento(${idSeg}, ${pg - 1})">← Anterior</button><span style="font-size:.85rem;font-weight:bold;">Página ${pg} de ${totalPgs}</span><button type="button" class="btn-secundario" ${pg === totalPgs ? 'disabled style="opacity:.5;"' : ''} onclick="abrirDetalhamentoParcelamento(${idSeg}, ${pg + 1})">Próxima →</button></div>`;
    document.querySelectorAll('.modal-overlay-detalhe-parcelas').forEach(el => el.remove());
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay modal-overlay-detalhe-parcelas';
    overlay.innerHTML = `<div class="modal-box" style="max-width:650px;width:95%;"><h3>${finRelacionado?.tipoContrato === 'emprestimo' ? 'Detalhes do Empréstimo / Consignado' : 'Detalhes do Financiamento / Parcelamento'}</h3><div style="text-align:left;display:flex;flex-direction:column;gap:6px;margin-bottom:12px;font-size:.9rem;"><p><strong>Descrição:</strong> ${escaparHTML(descricaoBaseParcelamento(lanc.descricao))}</p><p><strong>Valor Total:</strong> ${formatarMoeda(valTot)} (${total}x de ${formatarMoeda(valParc)})</p><p><strong>${formaInfo}</strong> | <strong>Responsável:</strong> ${escaparHTML(resp)}</p></div><h4 style="margin:10px 0 6px 0;font-size:.95rem;text-align:left;">Parcelas (${ini + 1} a ${Math.min(fim, total)} de ${total}):</h4>${pag}<div class="tabela-container" style="max-height:240px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;"><table class="tabela" style="width:100%;font-size:.85rem;"><thead><tr><th style="text-align:center;">Parcela</th><th>Vencimento</th><th style="text-align:right;">Valor</th><th style="text-align:center;">Status</th></tr></thead><tbody>${linhas}</tbody></table></div>${pag}<div class="modal-buttons modal-buttons-center" style="margin-top:15px;"><button type="button" data-fechar style="background-color:var(--primary);width:100%;">Fechar</button></div></div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('[data-fechar]').onclick = () => fecharModal(overlay);
    overlay.addEventListener('click', e => { if (e.target === overlay) fecharModal(overlay); });
}

// ============================================================================
// 9. NOTIFICAÇÕES
// ============================================================================
function renderizarSinoNotificacoes() {
    const btn = document.getElementById('btnNotificacoes');
    if (!btn) return;
    const d = obterDados();
    const uId = obterUsuarioAtualId();
    const naoLidas = (d.notificacoes || []).filter(n => String(n.usuarioDestinoId) === String(uId) && !n.lida).length;
    const pendentes = typeof obterLembretesAtivos === 'function'
        ? obterLembretesAtivos(d).filter(x => !x.pago).length : 0;
    const total = naoLidas + pendentes;
    let badge = btn.querySelector('.badge-notificacao');
    if (total > 0) {
        if (!badge) {
            badge = document.createElement('span');
            badge.className = 'badge-notificacao';
            badge.style.cssText = 'position:absolute;top:-4px;right:-4px;background:var(--danger,#ef4444);color:white;border-radius:50%;padding:2px 5px;font-size:.65rem;font-weight:bold;min-width:16px;text-align:center;';
            btn.appendChild(badge);
        }
        badge.textContent = total > 9 ? '9+' : total;
    } else if (badge) badge.remove();
}

async function abrirModalNotificacoes(abaInicial) {
    const dados = obterDados();
    const usuarioId = obterUsuarioAtualId();
    const notificacoes = (dados.notificacoes || []).filter(n => String(n.usuarioDestinoId) === String(usuarioId));
    const naoLidasSnapshot = notificacoes.filter(n => !n.lida).length;
    const lembretes = obterLembretesAtivos(dados);
    const lembretesPendentes = lembretes.filter(x => !x.pago).length;
    const aba = abaInicial || (lembretesPendentes > 0 ? 'lembretes' : 'notificacoes');

    if (naoLidasSnapshot > 0) {
        notificacoes.forEach(n => { n.lida = true; });
        await salvarDados(dados);
    }

    let itensHtml = '';
    if (notificacoes.length === 0) {
        itensHtml = `<p class="empty-state">Nenhuma notificação no momento.</p>`;
    } else {
        notificacoes.slice().reverse().forEach(n => {
            let acoesHtml = '';
            let linkRedirecionamento = '';
            let icone = '🔔';

            // Roteamento inteligente baseado no tipo
            if (n.tipo === 'lancamento_casal') {
                icone = '🤝';
                linkRedirecionamento = 'lancamentos.html';
                acoesHtml = `<a href="${linkRedirecionamento}" class="btn-acao-secundario" style="margin-top:8px; padding: 6px 12px; font-size: 0.75rem;">Ver lançamento</a>`;
            } else if (n.tipo === 'alerta_vencimento') {
                icone = '⚠️';
                linkRedirecionamento = 'central-pagamentos.html';
                acoesHtml = `<a href="${linkRedirecionamento}" class="btn-acao-secundario" style="margin-top:8px; padding: 6px 12px; font-size: 0.75rem;">Ir para Central</a>`;
            } else if (n.tipo === 'solicitacao_parceiro' && n.statusAprovacao === 'pendente') {
                icone = '👤';
                const idSeguro = String(n.id == null ? '' : n.id).replace(/[^a-zA-Z0-9_-]/g, '');
                if (idSeguro) {
                    acoesHtml = `
                        <div style="margin-top:10px; display:flex; gap:8px;">
                            <button onclick="responderSolicitacaoParceiro('${idSeguro}', true)" class="btn-success" style="padding:6px 12px; font-size:.8rem; flex:1;">Aprovar</button>
                            <button onclick="responderSolicitacaoParceiro('${idSeguro}', false)" class="btn-danger" style="padding:6px 12px; font-size:.8rem; flex:1;">Negar</button>
                        </div>`;
                }
            } else if (n.statusAprovacao && n.statusAprovacao !== 'pendente') {
                icone = n.statusAprovacao === 'aprovado' ? '✅' : '❌';
                acoesHtml = `<p style="font-size:.78rem; font-weight:bold; margin-top:6px; color:${n.statusAprovacao === 'aprovado' ? 'var(--success)' : 'var(--danger)'};">Status: ${n.statusAprovacao.toUpperCase()}</p>`;
            }

            // Estrutura do Card de Notificação
            itensHtml += `
                <div class="notif-card" ${linkRedirecionamento && !acoesHtml.includes('button') ? `onclick="window.location.href='${linkRedirecionamento}'"` : ''}>
                    <div class="notif-card-icon">${icone}</div>
                    <div class="notif-card-content">
                        <strong>${escaparHTML(n.titulo || '')}</strong>
                        <p>${escaparHTML(n.mensagem || '')}</p>
                        <small>${n.createdAt ? escaparHTML(formatarDataSemHora(n.createdAt)) : ''}</small>
                        ${acoesHtml}
                    </div>
                </div>`;
        });
    }

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.setAttribute('data-notif-modal', 'true');
    overlay.innerHTML = `
        <div class="modal-box notif-modal-box" style="max-width:560px; width:95%; padding: 0; overflow: hidden;">
            <div class="notif-modal-head" style="padding: 24px 24px 0;">
                <h3 style="margin-bottom: 16px;">Central de Avisos</h3>
                <div class="notif-tabs" role="tablist">
                    <button type="button" role="tab" data-tab="lembretes" aria-selected="${aba === 'lembretes'}" class="${aba === 'lembretes' ? 'active' : ''}">
                        📅 Lembretes${lembretesPendentes ? ` <span class="notif-tab-badge">${lembretesPendentes}</span>` : ''}
                    </button>
                    <button type="button" role="tab" data-tab="notificacoes" aria-selected="${aba === 'notificacoes'}" class="${aba === 'notificacoes' ? 'active' : ''}">
                        🔔 Eventos${naoLidasSnapshot ? ` <span class="notif-tab-badge">${naoLidasSnapshot}</span>` : ''}
                    </button>
                </div>
            </div>
            <div class="notif-tab-body" id="notifTabLembretes" ${aba !== 'lembretes' ? 'hidden' : ''} style="padding: 16px 24px 24px;">
                <p style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 12px;">Suas pendências financeiras operacionais.</p>
                <ul class="lista-simples" style="margin:0;padding:0;" id="notifLembretesLista"></ul>
            </div>
            <div class="notif-tab-body" id="notifTabNotificacoes" ${aba !== 'notificacoes' ? 'hidden' : ''} style="padding: 16px 24px 24px; background: var(--surface-2);">
                <p style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 12px;">Avisos do sistema e interações sociais.</p>
                <div id="notifNotificacoesLista" style="max-height:360px; overflow-y:auto; padding-right:4px;">${itensHtml}</div>
            </div>
            <div style="padding: 16px 24px; border-top: 1px solid var(--border); background: var(--surface);">
                <button type="button" data-fechar-notif style="width:100%; background-color:var(--primary);">Fechar Central</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    renderizarListaLembretes(overlay.querySelector('#notifLembretesLista'), lembretes);

    const alternarAba = tab => {
        overlay.querySelectorAll('[data-tab]').forEach(b => {
            const ativo = b.dataset.tab === tab;
            b.classList.toggle('active', ativo);
            b.setAttribute('aria-selected', String(ativo));
        });
        overlay.querySelector('#notifTabLembretes').hidden = tab !== 'lembretes';
        overlay.querySelector('#notifTabNotificacoes').hidden = tab !== 'notificacoes';
    };
    overlay.querySelectorAll('[data-tab]').forEach(btn => btn.addEventListener('click', () => alternarAba(btn.dataset.tab)));

    const fechar = () => { overlay.remove(); renderizarSinoNotificacoes(); };
    overlay.querySelector('[data-fechar-notif]').onclick = fechar;
    overlay.addEventListener('click', e => { if (e.target === overlay) fechar(); });
}

async function responderSolicitacaoParceiro(notificacaoId, aprovado) {
    const dados = obterDados();
    const notif = (dados.notificacoes || []).find(n => String(n.id) === String(notificacaoId));
    if (!notif || notif.tipo !== 'solicitacao_parceiro' ||
        notif.statusAprovacao !== 'pendente' ||
        String(notif.usuarioDestinoId) !== String(obterUsuarioAtualId())) {
        await mostrarAlertaModal('Esta solicitação não está mais pendente ou não pertence à sua conta.');
        return;
    }
    notif.statusAprovacao = aprovado ? 'aprovado' : 'negado';
    const usuarioDestino = dados.usuarios.find(u => Number(u.id) === Number(notif.usuarioDestinoId));
    const remetente = dados.usuarios.find(u => Number(u.id) === Number(notif.remetenteId));
    if (aprovado && usuarioDestino && remetente) {
        usuarioDestino.parceiroId = remetente.id;
        remetente.parceiroId = usuarioDestino.id;
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
    registrarLog(dados, "PARCEIRO", `Solicitação de parceiro ${aprovado ? 'aprovada' : 'negada'}.`);
    await salvarDados(dados);
    await mostrarAlertaModal(aprovado ? "Parceiro atrelado com sucesso!" : "Solicitação negada.");
    document.querySelector('.modal-overlay')?.remove();
    abrirModalNotificacoes();
}

async function limparNotificacoes() {
    if (!await mostrarConfirmacaoModal("Excluir todas as suas notificações?")) return;
    mostrarLoading("Limpando...");
    const d = obterDados(); const uId = obterUsuarioAtualId();
    d.notificacoes = (d.notificacoes || []).filter(n => String(n.usuarioDestinoId) !== String(uId));
    await salvarDados(d);
    esconderLoading();
    const ov = document.querySelector('.modal-overlay');
    if (ov) fecharModal(ov);
    renderizarSinoNotificacoes();
    await mostrarAlertaModal("Notificações excluídas.");
}

function gerarLembretesVencimento() {
    const dados = obterDados();
    const uId = obterUsuarioAtualId();
    const usuario = (dados.usuarios || []).find(u => String(u.id) === String(uId));
    if (!usuario || usuario.trocaSenhaObrigatoria) return 0;
    
    const hoje = normalizarDataISO(new Date());
    if (!hoje) return 0;
    const hojeUTC = Date.parse(hoje + 'T00:00:00Z');
    const ids = new Set((dados.notificacoes || []).map(n => String(n.id)));
    let criados = 0;
    
    (dados.lancamentos || []).forEach(l => {
        if (String(l.usuarioId) !== String(uId) || normalizarTexto(l.tipo) !== 'saida') return;
        if (l.pago === true || normalizarTexto(l.status) === 'pago') return;
        
        const vencimento = normalizarDataISO(l.vencimento);
        if (!vencimento) return;
        
        const diferenca = Math.round((Date.parse(vencimento + 'T00:00:00Z') - hojeUTC) / 86400000);
        
        // GERA NOTIFICAÇÃO APENAS PARA ATRASOS (O resto fica na aba Lembretes)
        if (diferenca >= 0) return; 
        
        const id = `alerta_atraso_${uId}_${String(l.id).replace(/[^a-zA-Z0-9_-]/g, '_')}_${vencimento.replace(/-/g, '')}`;
        if (ids.has(id)) return;
        ids.add(id);
        
        const descricao = String(l.descricao || 'Conta').slice(0, 120);
        dados.notificacoes.push({
            id, usuarioDestinoId: uId, remetenteId: uId, tipo: 'alerta_vencimento',
            titulo: 'Conta em Atraso ⚠️',
            mensagem: `${descricao} venceu em ${formatarDataBR(vencimento)}. Valor: ${formatarMoeda(l.valor)}.`,
            lida: false, statusAprovacao: '', createdAt: new Date().toISOString()
        });
        criados++;
    });
    
    if (criados) {
        salvarDados(dados).catch(() => {});
        renderizarSinoNotificacoes();
    }
    return criados;
}

function limparNotificacoesResolvidas(dados) {
    if (!dados.notificacoes || !dados.lancamentos) return false;
    const totalAntes = dados.notificacoes.length;
    const alertasPendentes = new Set();
    dados.lancamentos.forEach(l => {
        if (l.pago === true || normalizarTexto(l.status) === 'pago') return;
        const vencimento = normalizarDataISO(l.vencimento);
        if (!vencimento) return;
        const usuario = String(l.usuarioId ?? '');
        const identificador = String(l.id).replace(/[^a-zA-Z0-9_-]/g, '_');
        const data = vencimento.replace(/-/g, '');
        alertasPendentes.add(`alerta_vencimento_${usuario}_${identificador}_${data}`);
        alertasPendentes.add(`alerta_atraso_${usuario}_${identificador}_${data}`);
    });
    dados.notificacoes = dados.notificacoes.filter(n =>
        n.tipo !== 'alerta_vencimento' || alertasPendentes.has(String(n.id)));
    
    return dados.notificacoes.length !== totalAntes;
}
// ============================================================================
// 9.5 PRIMEIRO ACESSO (index.html)
// ============================================================================
async function abrirModalPrimeiroAcesso() {
    if (localStorage.getItem('syncPendente') === 'true' || localStorage.getItem(SYNC_CONFLICT_KEY)) {
        await mostrarAlertaModal('Existem alterações locais aguardando sincronização. Resolva a pendência antes de cadastrar outro usuário.');
        return;
    }
    try {
        const situacao = await executarPostAPI('statusCadastro');
        if (situacao.status !== 'sucesso') throw new Error(situacao.mensagem || 'Não foi possível verificar o cadastro.');
        if (!situacao.primeiroCadastroDisponivel) {
            await mostrarAlertaModal('O sistema já possui contas. Solicite a criação do seu acesso a um administrador em Configurações.');
            return;
        }
    } catch (erro) {
        await mostrarAlertaModal('Não foi possível verificar se o cadastro inicial está disponível. Verifique a conexão e a implantação do Code.gs.');
        return;
    }
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
                <div>
                    <label for="regSenhaAdmin">Senha administrativa de implantação:</label>
                    <input type="password" class="modal-input" id="regSenhaAdmin" placeholder="Configurada em SENHA_ADMIN" autocomplete="off">
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
    const inputSenhaAdmin = overlay.querySelector('#regSenhaAdmin');
    setTimeout(() => inputUsuario?.focus(), 0);
    overlay.querySelector('[data-cancelar]').onclick = () => fecharModal(overlay);
    overlay.querySelector('[data-confirmar]').onclick = async () => {
        const confirmar = overlay.querySelector('[data-confirmar]');
        if (confirmar.disabled) return;
        const usuario = inputUsuario.value.trim();
        const nome = inputNome.value.trim();
        const senha = inputSenha.value.trim();
        const senhaAdmin = inputSenhaAdmin.value;
        if (!usuario || !nome || !senha || !senhaAdmin) { await mostrarAlertaModal('Preencha todos os campos para continuar.'); return; }
        if (!validarComplexidadeSenha(senha)) { await mostrarAlertaModal('A senha informada não cumpre os requisitos mínimos. Tente novamente.'); return; }
        confirmar.disabled = true;
        const textoAnterior = confirmar.textContent;
        confirmar.textContent = 'Salvando no servidor...';
        try {
            if (localStorage.getItem('syncPendente') === 'true' || localStorage.getItem(SYNC_CONFLICT_KEY)) {
                throw new Error('Há uma sincronização pendente. Conclua-a antes de cadastrar outro usuário.');
            }
            const hashSenha = await gerarHash(senha);
            const resultado = await executarPostAPI('registrarPrimeiroUsuario',
                { usuario, nome, senhaHash: hashSenha, senhaAdmin });
            if (resultado.status !== 'sucesso') throw new Error(resultado.status === 'conflito'
                ? 'Os dados mudaram durante o cadastro. Tente novamente.'
                : resultado.mensagem || 'O servidor não confirmou o cadastro.');
            fecharModal(overlay);
            await mostrarAlertaModal('Cadastro confirmado no servidor! Agora você pode entrar.');
        } catch (erro) {
            await mostrarAlertaModal(erro.message || 'Não foi possível salvar o cadastro.');
        } finally {
            confirmar.disabled = false;
            confirmar.textContent = textoAnterior;
        }
    };
}

// ============================================================================
// 10. INICIALIZAÇÃO
// ============================================================================

window.addEventListener('storage', (e) => {
    if (e.key === DB_KEY && e.newValue && !syncInFlight && !syncPendingData) {
        try {
            const novo = JSON.parse(e.newValue);
            _migracaoCacheRef = null; _migracaoCacheDados = null;
            memoriaSistema = migrarDados(novo).dados;
            [
                () => typeof carregarDashboard === 'function' && document.getElementById('filtroMesAno') && carregarDashboard(),
                () => typeof carregarCentralPagamentos === 'function' && document.getElementById('tabela-pagamentos-body') && carregarCentralPagamentos(),
                () => typeof carregarTabelaFinanciamentosGeral === 'function' && document.getElementById('tabelaFinanciamentosGeral') && carregarTabelaFinanciamentosGeral(),
                () => typeof renderizarCategorias === 'function' && document.getElementById('listaCategorias') && renderizarCategorias()
            ].forEach(fn => { try { fn(); } catch (_) {} });
        } catch (_) {}
    }
});

document.addEventListener("DOMContentLoaded", async () => {
    inicializarTemaVisual();
    inicializarPrivacidade();
    injetarHeader();

    document.addEventListener('click', (e) => {
        const dd = document.querySelector('.nav-dropdown');
        if (!dd || !dd.classList.contains('active')) return;
        if (!dd.contains(e.target) && !document.body.classList.contains('sidebar-open')) {
            dd.classList.remove('active');
            dd.querySelector('.sidebar-dropdown-trigger')?.setAttribute('aria-expanded', 'false');
            const conteudo = dd.querySelector('.nav-dropdown-content');
            if (conteudo) conteudo.inert = true;
        }
    });

    if (!window.location.pathname.endsWith('index.html') && typeof verificarAutenticacao === 'function') {
        if (await verificarAutenticacao()) atualizarHeaderUsuario();
    }
});