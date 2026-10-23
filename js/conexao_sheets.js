// ============================================================================
// 1. CONSTANTES E ESTADO GLOBAL DA API
// ============================================================================
const DB_KEY = 'sistemaFinanceiroCompartilhado';
const BACKUP_TESTE_KEY = 'sistemaFinanceiroBackupTeste';
const API_URL = "https://script.google.com/macros/s/AKfycbz8unMjgIe2wjr-zHHkSSwEa8t1MnlnEgjAP0VDrVQB1CU89S0GBVIrPUjp0wDMKYR8QQ/exec";
const TOKEN_API = "PLANOF1NALPRAS4AIRD@MERDA";
const CHAVE_SESSAO_API = 'financeiroSessaoSegura';
const CHAVE_USUARIO_SESSAO = 'financeiroSessaoUsuario';
const CHAVE_DONO_PENDENCIAS = 'financeiroSyncUsuario';
const obterSessaoAPI = () => sessionStorage.getItem(CHAVE_SESSAO_API) || '';

// Diagnóstico sem armazenar sessão, token, payload, valores financeiros ou dados pessoais.
const CHAVE_DIAGNOSTICO_SINCRONIZACAO = 'financeiroDiagnosticoSincronizacao';
function registrarFalhaSincronizacao(origem, erro) {
    // Mensagens de exceção do Apps Script podem ser longas; evite propagá-las por inteiro.
    const mensagem = String(erro?.message || erro || 'Erro de sincronização não identificado')
        .replaceAll(TOKEN_API, '[chave omitida]').slice(0, 320);
    const diagnostico = { dataHora: new Date().toISOString(), origem: String(origem).slice(0, 50), mensagem };
    try { sessionStorage.setItem(CHAVE_DIAGNOSTICO_SINCRONIZACAO, JSON.stringify(diagnostico)); }
    catch (_) { /* Armazenamento pode ser bloqueado; o console continua disponível. */ }
    return diagnostico;
}
function obterDiagnosticoSincronizacao() {
    try { return JSON.parse(sessionStorage.getItem(CHAVE_DIAGNOSTICO_SINCRONIZACAO) || 'null'); }
    catch (_) { return null; }
}
function limparDiagnosticoSincronizacao() {
    try { sessionStorage.removeItem(CHAVE_DIAGNOSTICO_SINCRONIZACAO); } catch (_) {}
}


function ehModoTesteAtivo(usuario) {
  return Boolean(usuario)
    && normalizarTexto(usuario.nome) === 'teste'
    && Boolean(localStorage.getItem(BACKUP_TESTE_KEY));
}

function conferirSessaoRespostaAPI(resposta) {
    if (resposta?.status === 'erro' && /sess[aã]o (expirada|inv[aá]lida)/i.test(String(resposta.mensagem || ''))) {
        sessionStorage.removeItem(CHAVE_SESSAO_API);
        sessionStorage.removeItem(CHAVE_USUARIO_SESSAO);
        localStorage.removeItem('usuarioLogado');
        if (!window.location.pathname.endsWith('index.html')) window.location.href = 'index.html';
        throw new Error('Sua sessão expirou. Entre novamente para continuar a sincronização.');
    }
    return resposta;
}

async function executarPostAPI(acao, campos = {}, tempoLimiteMs = 35000) {
    const controlador = new AbortController();
    const temporizador = setTimeout(() => controlador.abort(), tempoLimiteMs);
    try {
        const resposta = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            cache: 'no-store',
            signal: controlador.signal,
            body: JSON.stringify({ action: acao, token: TOKEN_API, ...campos })
        });
        if (!resposta.ok) throw new Error(`Servidor indisponível (HTTP ${resposta.status}).`);
        const texto = await resposta.text();
        let dados;
        try { dados = JSON.parse(texto); }
        catch (_) { throw new Error('A API não retornou JSON. Verifique o link /exec e as permissões da implantação.'); }
        return conferirSessaoRespostaAPI(dados);
    } catch (erro) {
        if (erro?.name === 'AbortError') throw new Error('Tempo limite ao comunicar com o Google Sheets. Os dados continuam salvos neste navegador.');
        if (erro instanceof TypeError) throw new Error('Falha de conexão com o Google Apps Script. Verifique sua rede, a URL /exec e a implantação publicada.');
        throw erro;
    } finally {
        clearTimeout(temporizador);
    }
}

const SCHEMA_VERSION = 5;
const SYNC_DEBOUNCE_MS = 1500;
const SYNC_RETRY_MAX_MS = 90000;
const SYNC_BASELINE_KEY = 'sistemaFinanceiroSnapshotSincronizado';
const SYNC_CONFLICT_KEY = 'sistemaFinanceiroConflitoSync';
const COLECOES_DADOS = ['usuarios', 'categorias', 'cartoes', 'lancamentos', 'financiamentos', 'bens', 'notificacoes', 'logs', 'exclusao_movimento', 'edicao_movimento', 'fatura_cartao'];

let syncTimer = null;
let syncPendingData = null;
let syncInFlight = false;
let syncFalhasConsecutivas = 0;
let reenvioEmAndamento = false;
let memoriaSistema = null;

let _migracaoCacheRef = null;
let _migracaoCacheDados = null;

// ============================================================================
// 5. BANCO DE DADOS E SYNC
// ============================================================================
function obterDados() {
    let d = memoriaSistema || lerJSONLocal(DB_KEY, null) || { usuarios: [], categorias: [], cartoes: [], lancamentos: [], financiamentos: [], bens: [], notificacoes: [], logs: [], exclusao_movimento: [], edicao_movimento: [], fatura_cartao: [] };
    if (_migracaoCacheRef === d && _migracaoCacheDados) return _migracaoCacheDados;
    const res = migrarDados(d);
    memoriaSistema = res.dados;
    _migracaoCacheRef = res.dados;
    _migracaoCacheDados = res.dados;
    return res.dados;
}

function lerJSONLocal(chave, padrao = null) {
    try { const b = localStorage.getItem(chave); return b == null ? padrao : JSON.parse(b); } catch { return padrao; }
}

function gravarSnapshotLocal(dados, definirBase = false) {
    _migracaoCacheRef = null;
    _migracaoCacheDados = null;
    const c = clonarDados(dados);
    memoriaSistema = c;
    localStorage.setItem(DB_KEY, JSON.stringify(c));
    if (definirBase) { localStorage.setItem(SYNC_BASELINE_KEY, JSON.stringify(c)); localStorage.setItem('ultimoSyncMs', String(Date.now())); }
    window.revisaoServidorAtual = Number(c._revision) || 0;
    return c;
}

async function salvarDados(dados, opcoes = {}) {
    const dono = localStorage.getItem('usuarioLogado');
    const outroDono = localStorage.getItem(CHAVE_DONO_PENDENCIAS);
    if (localStorage.getItem('syncPendente') === 'true' && outroDono && dono && outroDono !== dono) {
        throw new Error('Há alterações pendentes de outro usuário neste navegador. Entre na conta anterior para sincronizá-las.');
    }
    _migracaoCacheRef = null;
    _migracaoCacheDados = null;
    const norm = migrarDados(dados).dados;
    norm._revision = Number(norm._revision) || Number(window.revisaoServidorAtual) || 0;
    memoriaSistema = norm;
    localStorage.setItem(DB_KEY, JSON.stringify(norm));

    [
        () => typeof carregarDashboard === 'function' && carregarDashboard(),
        () => typeof carregarRelatorios === 'function' && carregarRelatorios(),
        () => typeof renderizarCategorias === 'function' && renderizarCategorias(),
        () => typeof carregarCentralPagamentos === 'function' && carregarCentralPagamentos()
    ].forEach(fn => { try { fn(); } catch (e) { console.error('Falha ao atualizar tela:', e); } });

    const u = obterUsuarioAtual(norm);
    if (opcoes.sincronizar !== false && !ehModoTesteAtivo(u)) {
        syncPendingData = clonarDados(norm);
        localStorage.setItem('syncPendente', 'true');
        if (dono) localStorage.setItem(CHAVE_DONO_PENDENCIAS, dono);
        if (!localStorage.getItem(SYNC_CONFLICT_KEY)) {
            atualizarIndicadorSyncUI('pending');
            agendarSincronizacaoSilenciosa();
        } else atualizarIndicadorSyncUI('error');
    } else if (ehModoTesteAtivo(u)) {
        clearTimeout(syncTimer); syncTimer = null; syncPendingData = null; localStorage.removeItem('syncPendente');
    }
    return true;
}

function serializarEstavel(v) {
    if (v === undefined) return '__UNDEFINED__';
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) return '[' + v.map(serializarEstavel).join(',') + ']';
    return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + serializarEstavel(v[k])).join(',') + '}';
}

function mesclarValorTresVias(base, local, remoto, caminho, conflitos, escolhas = null) {
    if (serializarEstavel(local) === serializarEstavel(base)) return clonarDados(remoto);
    if (serializarEstavel(remoto) === serializarEstavel(base)) return clonarDados(local);
    if (serializarEstavel(local) === serializarEstavel(remoto)) return clonarDados(local);
    const isObj = o => o !== null && typeof o === 'object' && !Array.isArray(o);
    if (isObj(local) && isObj(remoto) && (base === undefined || isObj(base))) {
        const res = {};
        new Set([...Object.keys(base || {}), ...Object.keys(local || {}), ...Object.keys(remoto || {})]).forEach(k => {
            const m = mesclarValorTresVias(base?.[k], local?.[k], remoto?.[k], `${caminho}.${k}`, conflitos, escolhas);
            if (m !== undefined) res[k] = m;
        });
        return res;
    }
    // Uma escolha explícita só vale para este campo, nesta conciliação.
    // Sem escolha, nunca favoreça silenciosamente um dos lados.
    if (escolhas && Object.prototype.hasOwnProperty.call(escolhas, caminho)) {
        if (escolhas[caminho] === 'local') return clonarDados(local);
        if (escolhas[caminho] === 'remoto') return clonarDados(remoto);
    }
    conflitos.push(caminho);
    return clonarDados(local);
}

function indexarColecao(lista) {
    const map = new Map(), oc = new Map();
    (Array.isArray(lista) ? lista : []).forEach(item => {
        let key = item?.id ? `id:${item.id}` : null;
        if (!key) {
            const ass = serializarEstavel(item);
            const ord = oc.get(ass) || 0;
            oc.set(ass, ord + 1);
            key = `registro:${ass}#${ord}`;
        }
        map.set(key, item);
    });
    return map;
}

function mesclarColecaoTresVias(nome, baseLista, localLista, remotoLista, conflitos, escolhas = null) {
    const base = indexarColecao(baseLista), local = indexarColecao(localLista), remoto = indexarColecao(remotoLista);
    const vistos = new Set(), res = [];
    [...remoto.keys(), ...local.keys(), ...base.keys()].forEach(k => {
        if (vistos.has(k)) return; vistos.add(k);
        const v = mesclarValorTresVias(base.get(k), local.get(k), remoto.get(k), `${nome}[${k}]`, conflitos, escolhas);
        if (v !== undefined) res.push(v);
    });
    return res;
}

function mesclarSnapshotsTresVias(base, local, remoto, escolhas = null) {
    const conflitos = [], res = clonarDados(remoto || {});
    COLECOES_DADOS.forEach(n => res[n] = mesclarColecaoTresVias(n, base?.[n], local?.[n], remoto?.[n], conflitos, escolhas));
    new Set([...Object.keys(base || {}), ...Object.keys(local || {}), ...Object.keys(remoto || {})]).forEach(k => {
        if (COLECOES_DADOS.includes(k) || k === '_revision') return;
        const v = mesclarValorTresVias(base?.[k], local?.[k], remoto?.[k], k, conflitos, escolhas);
        if (v !== undefined) res[k] = v;
    });
    res._revision = Number(remoto?._revision) || 0;
    return { dados: res, conflitos: [...new Set(conflitos)] };
}

function prepararReenvioSeguro(baseOriginal, localOriginal, remotoOriginal, usuarioId, escolhas = null) {
    const idAtual = String(usuarioId || '').trim();
    if (!idAtual) throw new Error('Usuário não identificado. Entre novamente antes de sincronizar.');
    if (!baseOriginal || !localOriginal || !remotoOriginal) {
        throw new Error('Não há histórico de sincronização suficiente para conciliar os dados. O backup local foi preservado.');
    }
    const usuariosRemotos = Array.isArray(remotoOriginal.usuarios) ? remotoOriginal.usuarios : [];
    const porId = usuario => String(usuario?.id ?? '') === idAtual;
    const usuarioRemoto = usuariosRemotos.find(porId);
    if (!usuarioRemoto) throw new Error('Sua conta não consta na resposta do servidor. Reenvio interrompido.');

    const camposProtegidos = ['id', 'ativo', 'permissoes', 'trocaSenhaObrigatoria'];
    const protegerProprioPerfil = usuario => {
        const protegido = clonarDados(usuario || usuarioRemoto);
        camposProtegidos.forEach(campo => {
            if (Object.prototype.hasOwnProperty.call(usuarioRemoto, campo)) {
                protegido[campo] = clonarDados(usuarioRemoto[campo]);
            } else delete protegido[campo];
        });
        delete protegido.pin;
        delete protegido.senha;
        return protegido;
    };
    const protegerColecaoUsuarios = snapshot => {
        const proprio = (Array.isArray(snapshot.usuarios) ? snapshot.usuarios : []).find(porId);
        snapshot.usuarios = usuariosRemotos.map(usuarioRemotoLista =>
            porId(usuarioRemotoLista) ? protegerProprioPerfil(proprio) : clonarDados(usuarioRemotoLista));
    };

    const base = clonarDados(baseOriginal);
    const local = clonarDados(localOriginal);
    protegerColecaoUsuarios(base);
    protegerColecaoUsuarios(local);
    const resultado = mesclarSnapshotsTresVias(base, local, remotoOriginal, escolhas);
    const proprioFinal = (resultado.dados.usuarios || []).find(porId);
    resultado.dados.usuarios = usuariosRemotos.map(usuarioRemotoLista =>
        porId(usuarioRemotoLista) ? protegerProprioPerfil(proprioFinal) : clonarDados(usuarioRemotoLista));
    return resultado;
}

function marcarConflitoSincronizacao(dadosLocais, campos, mensagem) {
    registrarFalhaSincronizacao('conflito-de-dados', mensagem || 'Conflito de sincronização');
    _migracaoCacheRef = null;
    _migracaoCacheDados = null;
    const conflito = { dataHora: new Date().toISOString(), campos: (campos || []).slice(0, 30), mensagem: mensagem || 'Conflito de alterações.' };
    localStorage.setItem(SYNC_CONFLICT_KEY, JSON.stringify(conflito));
    localStorage.setItem('syncPendente', 'true');
    if (dadosLocais) {
        memoriaSistema = dadosLocais;
        localStorage.setItem(DB_KEY, JSON.stringify(dadosLocais));
        syncPendingData = clonarDados(dadosLocais);
    }
    atualizarIndicadorSyncUI('error');
    console.error('Sincronização bloqueada:', conflito);
}

function agendarSincronizacaoSilenciosa(urgente = false) {
    clearTimeout(syncTimer);
    if (!navigator.onLine) {
        syncTimer = null;
        atualizarIndicadorSyncUI('pending');
        return;
    }
    const atraso = urgente ? 120 : Math.min(SYNC_RETRY_MAX_MS, SYNC_DEBOUNCE_MS * Math.pow(2, Math.min(syncFalhasConsecutivas, 6)));
    syncTimer = setTimeout(() => {
        syncTimer = null;
        sincronizarComServidor();
    }, atraso);
}

async function buscarDadosServidor() {
    const json = await executarPostAPI('obterDados', { sessao: obterSessaoAPI() });
    if (!json || json.status === 'erro') throw new Error(json?.mensagem || 'Falha ao carregar os dados do servidor.');
    if (!COLECOES_DADOS.every(nome => Array.isArray(json[nome])) ||
        !Number.isSafeInteger(Number(json._revision)) || Number(json._revision) < 0) {
        throw new Error('Resposta incompleta do Google Sheets. Os dados locais foram preservados para evitar perda de informações.');
    }
    return json;
}

const SYNC_CHECK_MIN_MS = 30000;
const SYNC_CHECK_INTERVAL_MS = 60000;
const SYNC_FALLBACK_FULL_MS = 300000;
let _syncBgIniciado = false;
let _syncBgEmAndamento = false;

async function consultarRevisaoServidor() {
    const json = await executarPostAPI('revisao', { sessao: obterSessaoAPI() });
    // Um erro de autenticação/servidor não é ausência de suporte à API de revisão.
    // Antes ele virava null e a causa podia ficar oculta por até cinco minutos.
    if (json?.status === 'erro') throw new Error(json.mensagem || 'Servidor recusou a consulta de revisão.');
    if (json?.status !== 'sucesso' || !Number.isSafeInteger(Number(json?._revision)) || Number(json._revision) < 0)
        throw new Error('Resposta de revisão inválida do Google Sheets.');
    return Number(json._revision);
}

async function verificarAtualizacaoServidor(forcar = false) {
    if (_syncBgEmAndamento || syncInFlight || reenvioEmAndamento || syncPendingData || syncTimer) return;
    if (localStorage.getItem('syncPendente') === 'true' || localStorage.getItem(SYNC_CONFLICT_KEY)) return;
    if (!localStorage.getItem('usuarioLogado') || !navigator.onLine) return;
    const u = obterUsuarioAtual();
    if (ehModoTesteAtivo(u)) return;
    const agora = Date.now();
    if (!forcar && agora - Number(localStorage.getItem('ultimaChecagemMs') || 0) < SYNC_CHECK_MIN_MS) return;

    _syncBgEmAndamento = true;
    localStorage.setItem('ultimaChecagemMs', String(agora));
    try {
        const revRemota = await consultarRevisaoServidor();
        const revLocal = Number(window.revisaoServidorAtual ?? memoriaSistema?._revision) || 0;
        if (revRemota !== null) {
            if (revRemota === revLocal) {
                localStorage.setItem('ultimoSyncMs', String(Date.now()));
                atualizarIndicadorSyncUI('success');
                return;
            }
        } else if (agora - Number(localStorage.getItem('ultimoSyncMs') || 0) < SYNC_FALLBACK_FULL_MS) {
            return;
        }
        const json = await buscarDadosServidor();
        if (syncInFlight || syncPendingData || syncTimer || localStorage.getItem('syncPendente') === 'true' || localStorage.getItem(SYNC_CONFLICT_KEY)) return;
        if (revRemota === null && Number(json._revision) === revLocal) { localStorage.setItem('ultimoSyncMs', String(Date.now())); return; }
        _migracaoCacheRef = null; _migracaoCacheDados = null;
        gravarSnapshotLocal(migrarDados(json).dados, true);
        const ae = document.activeElement;
        const digitando = ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName);
        const modalAberto = [...document.querySelectorAll('.modal-overlay')].some(m => m.style.display && m.style.display !== 'none');
        if (!digitando && !modalAberto) rerenderizarTelaAtual();
        atualizarIndicadorSyncUI('success');
    } catch (e) {
        registrarFalhaSincronizacao('verificacao-segundo-plano', e);
        console.warn('Checagem em segundo plano falhou:', e);
        atualizarIndicadorSyncUI('error');
    } finally {
        _syncBgEmAndamento = false;
    }
}

function iniciarSincronizacaoSegundoPlano() {
    if (_syncBgIniciado) return;
    _syncBgIniciado = true;
    setTimeout(() => verificarAtualizacaoServidor(), 500);
    setInterval(() => { if (!document.hidden) verificarAtualizacaoServidor(); }, SYNC_CHECK_INTERVAL_MS);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) verificarAtualizacaoServidor(); });
    window.addEventListener('online', () => {
        if (syncPendingData || localStorage.getItem('syncPendente') === 'true') {
            if (!syncPendingData) syncPendingData = clonarDados(lerJSONLocal(DB_KEY, {}) || {});
            agendarSincronizacaoSilenciosa(true);
        } else verificarAtualizacaoServidor(true);
    });
}

function protegerUsuariosNaoProprios(payload) {
    const userId = localStorage.getItem('usuarioLogado');
    const base = lerJSONLocal(SYNC_BASELINE_KEY, null);
    if (!userId || !base || !Array.isArray(base.usuarios) || !Array.isArray(payload.usuarios)) return payload;
    const baseMap = new Map(base.usuarios.map(u => [String(u.id), u]));
    const campos = ['id', 'usuario', 'nome', 'pin', 'rendaFixa', 'parceiroId', 'ativo',
        'permissoes', 'preferenciasNotificacao', 'fotoPerfil', 'trocaSenhaObrigatoria', 'configuracaoSalarial'];
    payload.usuarios = payload.usuarios.map(u => {
        if (String(u.id) === String(userId)) return u;
        const b = baseMap.get(String(u.id));
        if (!b) return u;
        const soParceiro = campos.filter(c => c !== 'parceiroId')
            .every(c => JSON.stringify(u[c]) === JSON.stringify(b[c]));
        const aprovada = soParceiro && u.parceiroId
            && (payload.notificacoes || []).some(n =>
                n.tipo === 'solicitacao_parceiro'
                && String(n.remetenteId) === String(u.id)
                && String(n.usuarioDestinoId) === String(userId)
                && n.statusAprovacao === 'aprovado');
        return aprovada ? u : clonarDados(b);
    });
    return payload;
}

async function sincronizarComServidor() {
    if (reenvioEmAndamento || syncInFlight || !syncPendingData || localStorage.getItem(SYNC_CONFLICT_KEY) || !navigator.onLine) return;
    const donoPendente = localStorage.getItem(CHAVE_DONO_PENDENCIAS);
    const usuarioAtivo = localStorage.getItem('usuarioLogado');
    if (donoPendente && donoPendente !== usuarioAtivo) {
        marcarConflitoSincronizacao(lerJSONLocal(DB_KEY, null), [],
            'Existem alterações pertencentes a outra conta neste navegador. Entre na conta de origem para reconciliá-las.');
        return;
    }
    syncInFlight = true; let payloadAtual = null, tentativas = 0;
    try {
        while (syncPendingData && tentativas < 5 && !localStorage.getItem(SYNC_CONFLICT_KEY)) {
            tentativas++;
            payloadAtual = protegerUsuariosNaoProprios(syncPendingData);
            syncPendingData = null;
            const snapshotNoInicioEnvio = localStorage.getItem(DB_KEY);
            const json = await executarPostAPI('salvarDados',
                { sessao: obterSessaoAPI(), dados: payloadAtual }, 45000);
            if (json.status === 'conflito') {
                const lAtual = lerJSONLocal(DB_KEY, payloadAtual) || payloadAtual;
                const base = lerJSONLocal(SYNC_BASELINE_KEY, null);
                const serv = clonarDados(await buscarDadosServidor());
                if (!base) { marcarConflitoSincronizacao(lAtual, [], 'Sem snapshot-base.'); break; }
                // Uma edição pode ter ocorrido enquanto o servidor era consultado.
                // Mescle sempre o snapshot local mais recente, nunca o capturado
                // antes do await buscarDadosServidor().
                const localMaisRecente = lerJSONLocal(DB_KEY, lAtual) || lAtual;
                const mescla = prepararReenvioSeguro(
                    migrarDados(clonarDados(base)).dados,
                    migrarDados(clonarDados(localMaisRecente)).dados,
                    serv,
                    localStorage.getItem('usuarioLogado')
                );
                if (mescla.conflitos.length) { marcarConflitoSincronizacao(localMaisRecente, mescla.conflitos, 'Conflito de mesclagem.'); break; }
                localStorage.setItem(SYNC_BASELINE_KEY, JSON.stringify(serv));
                mescla.dados._revision = Number(serv._revision) || 0;
                gravarSnapshotLocal(mescla.dados, false);
                syncPendingData = clonarDados(mescla.dados);
                localStorage.setItem('syncPendente', 'true');
                continue;
            }
            if (json.status !== 'sucesso') throw new Error(json.mensagem || 'Erro sync.');
            syncFalhasConsecutivas = 0;
            const rev = Number(json._revision);
            if (!Number.isFinite(rev)) throw new Error('Revisão inválida.');
            payloadAtual._revision = rev;
            localStorage.setItem(SYNC_BASELINE_KEY, JSON.stringify(payloadAtual));
            window.revisaoServidorAtual = rev;
            // A confirmação do Sheets não pode regravar um cache obsoleto.
            // Releia o armazenamento: outra aba ou uma ação local pode ter salvo
            // dados durante o POST. Mantenha-os pendentes com a nova revisão.
            const textoAtual = localStorage.getItem(DB_KEY);
            if (textoAtual !== snapshotNoInicioEnvio) {
                const editadoDurantePost = lerJSONLocal(DB_KEY, null);
                if (editadoDurantePost) {
                    syncPendingData = clonarDados(editadoDurantePost);
                    memoriaSistema = clonarDados(editadoDurantePost);
                } else {
                    marcarConflitoSincronizacao(payloadAtual, [],
                        'O armazenamento mudou durante o envio e não pôde ser lido. Preserve o backup local.');
                    break;
                }
            }
            if (syncPendingData) {
                // Não confunda revisão confirmada com garantia de mesclagem:
                // a próxima escrita ainda passará pelo controle de revisão do servidor.
                syncPendingData._revision = rev;
                memoriaSistema = clonarDados(syncPendingData);
                localStorage.setItem(DB_KEY, JSON.stringify(syncPendingData));
            } else if (memoriaSistema) {
                memoriaSistema._revision = rev;
                localStorage.setItem(DB_KEY, JSON.stringify(memoriaSistema));
            }
            if (!syncPendingData) {
                localStorage.removeItem('syncPendente');
                localStorage.removeItem(CHAVE_DONO_PENDENCIAS);
                atualizarIndicadorSyncUI('success');
                atualizarFeedbackIntegrado('Alterações sincronizadas.', 'success', 3000);
            } else {
                localStorage.setItem('syncPendente', 'true');
                atualizarIndicadorSyncUI('pending');
            }
        }
    } catch (e) {
        syncFalhasConsecutivas++;
        registrarFalhaSincronizacao('envio-de-alteracoes', e);
        console.warn('Sync adiada:', e);
        if (!syncPendingData && payloadAtual) syncPendingData = clonarDados(lerJSONLocal(DB_KEY, payloadAtual) || payloadAtual);
        localStorage.setItem('syncPendente', 'true');
        atualizarIndicadorSyncUI('error');
        if (syncFalhasConsecutivas === 1) atualizarFeedbackIntegrado(
            'Não foi possível sincronizar. Alterações preservadas no navegador; nova tentativa automática.', 'error', 8000);
    } finally {
        syncInFlight = false;
        if (syncPendingData && !localStorage.getItem(SYNC_CONFLICT_KEY)) agendarSincronizacaoSilenciosa();
    }
}

async function inicializarBanco() {
    window.ultimaOrigemBanco = 'indefinida';
    const local = lerJSONLocal(DB_KEY, null);
    const pendenteDe = localStorage.getItem(CHAVE_DONO_PENDENCIAS);
    const usuarioAtivo = localStorage.getItem('usuarioLogado');
    if (local && localStorage.getItem('syncPendente') === 'true' &&
        pendenteDe && pendenteDe !== usuarioAtivo) {
        window.ultimaOrigemBanco = 'pendencia-outra-conta';
        marcarConflitoSincronizacao(local, [],
            'Existem alterações locais pendentes de outra conta. Entre na conta de origem antes de sincronizar.');
        throw new Error('Alterações locais de outro usuário preservadas. Faça login na conta original para sincronizar.');
    }
    if (local && localStorage.getItem('syncPendente') === 'true') {
        window.ultimaOrigemBanco = 'local-pendente';
        memoriaSistema = migrarDados(local).dados;
        syncPendingData = clonarDados(memoriaSistema);
        if (!localStorage.getItem(SYNC_CONFLICT_KEY)) {
            if (!lerJSONLocal(SYNC_BASELINE_KEY, null)) {
                marcarConflitoSincronizacao(memoriaSistema, [], 'Sem snapshot.');
            } else {
                agendarSincronizacaoSilenciosa();
            }
        }
        return memoriaSistema;
    }
    try {
        const json = await buscarDadosServidor();
        const norm = migrarDados(json).dados;
        window.ultimaOrigemBanco = 'remoto';
        memoriaSistema = norm; window.revisaoServidorAtual = Number(norm._revision) || 0;
        gravarSnapshotLocal(norm, true);
        localStorage.removeItem('syncPendente'); localStorage.removeItem(CHAVE_DONO_PENDENCIAS); localStorage.removeItem(SYNC_CONFLICT_KEY);
        atualizarIndicadorSyncUI('success'); return norm;
    } catch (e) {
        registrarFalhaSincronizacao('leitura-inicial', e);
        if (local) {
            window.ultimaOrigemBanco = 'local-offline';
            console.warn('Dados locais usados porque a atualização remota falhou:', e);
            atualizarIndicadorSyncUI('error');
            return memoriaSistema = migrarDados(local).dados;
        }
        throw e;
    }
}

function atualizarIndicadorSyncUI(status) {
    const c = document.getElementById('syncStatusIcon'); if (!c) return;
    const l = c.querySelector('#syncTextLabel'), i = c.querySelector('img');
    if (!l || !i) return;
    const estado = status === 'pending' ? 'pending' : status === 'success' ? 'success' : 'error';
    c.dataset.syncState = estado;
    l.textContent = estado === 'pending' ? 'Sincronizando...' : estado === 'success' ? 'Sincronizado' : 'Erro';
    i.src = estado === 'pending' ? 'imagens/sincronizar.gif' : 'imagens/sincronizar.png';
    c.setAttribute('aria-label', estado === 'pending' ? 'Sincronização em andamento' : estado === 'success'
        ? 'Sincronizado. Clique para consultar as informações do servidor'
        : 'Erro de sincronização. Clique para tentar novamente');
    if (estado === 'success') limparDiagnosticoSincronizacao();
    const falha = estado === 'error' ? obterDiagnosticoSincronizacao() : null;
    c.title = estado === 'pending' ? 'Sincronização pendente...' : estado === 'success' ? 'Sincronizado'
        : falha ? `Erro de sincronização (${falha.origem}): ${falha.mensagem}` : 'Erro na sincronização';
}

// Migrações de esquema: fonte única (não repetir no núcleo).
function migrarDados(dados) {
    let alterou = false; if (!dados || typeof dados !== 'object') dados = {};
    const d = { usuarios: [], categorias: [], cartoes: [], lancamentos: [], financiamentos: [], bens: [], notificacoes: [], logs: [], exclusao_movimento: [], edicao_movimento: [], fatura_cartao: [] };
    Object.keys(d).forEach(k => { if (!Array.isArray(dados[k])) { dados[k] = d[k]; alterou = true; } });

    const camposDataPorColecao = {
        lancamentos: ['vencimento', 'dataCompra', 'dataPagamento'],
        financiamentos: ['primeiroVencimento', 'dataLiberacao'],
        fatura_cartao: ['dataVencimento']
    };
    Object.entries(camposDataPorColecao).forEach(([colecao, campos]) => {
        (dados[colecao] || []).forEach(registro => {
            campos.forEach(campo => {
                const original = registro?.[campo];
                if (original == null || original === '') return;
                const iso = normalizarDataISO(original);
                if (iso && String(original) !== iso) { registro[campo] = iso; alterou = true; }
            });
        });
    });

    (dados.logs || []).forEach(registro => {
        if (!registro) return;
        const referencia = registro.dataHora || registro.dataHoraFormatada;
        if (referencia) {
            const dataExibicao = formatarDataSemHora(referencia);
            if (registro.dataHoraFormatada !== dataExibicao) { registro.dataHoraFormatada = dataExibicao; alterou = true; }
        }
    });
    ['exclusao_movimento', 'edicao_movimento'].forEach(colecao => {
        (dados[colecao] || []).forEach(registro => {
            if (!registro || !registro.dataHora) return;
            const dataExibicao = formatarDataSemHora(registro.dataHora);
            if (registro.dataHora !== dataExibicao) { registro.dataHora = dataExibicao; alterou = true; }
        });
    });

    dados.cartoes.forEach(c => {
        if (c.ativo === undefined) { c.ativo = true; alterou = true; }
        if (!c.tipoCartao) { c.tipoCartao = c.isBeneficio ? 'beneficio' : 'credito'; alterou = true; }
        if (c.usuarioId == null && dados.usuarios[0]) { c.usuarioId = dados.usuarios[0].id; alterou = true; }
    });

    dados.financiamentos.forEach(f => {
        if (f.ativo === undefined) { f.ativo = true; alterou = true; }
        if (f.totalMeses == null) { f.totalMeses = 0; alterou = true; }
        if (!f.valorParcela) { f.valorParcela = 0; alterou = true; }
        if (!f.tipoContrato) { f.tipoContrato = 'financiamento'; alterou = true; }
        if (f.valorLiberado == null) { f.valorLiberado = 0; alterou = true; }
        if (f.categoriaEntradaId == null) { f.categoriaEntradaId = ''; alterou = true; }
        if (f.dataLiberacao == null) { f.dataLiberacao = ''; alterou = true; }
        if (!f.escopoContrato) { f.escopoContrato = 'individual'; alterou = true; }

        if (f.valorCompra === '' || f.valorCompra === undefined) { f.valorCompra = null; alterou = true; }
        else if (f.valorCompra !== null && !Number.isFinite(Number(f.valorCompra))) { f.valorCompra = null; alterou = true; }

        if (f.valorEntrada === '' || f.valorEntrada === undefined || f.valorEntrada === null) {
            if (f.valorEntrada !== 0) { f.valorEntrada = 0; alterou = true; }
        } else if (!Number.isFinite(Number(f.valorEntrada))) {
            f.valorEntrada = 0; alterou = true;
        }

        if (f.valorFinanciado === '' || f.valorFinanciado === undefined || f.valorFinanciado === null
            || !Number.isFinite(Number(f.valorFinanciado))) {
            f.valorFinanciado = Number(f.valorCompra) > 0
                ? Number(Math.max(0, Number(f.valorCompra) - Number(f.valorEntrada || 0)).toFixed(2))
                : null;
            alterou = true;
        }
    });

    const mat = dados.usuarios.some(u => u?.permissoes?.paginas && u?.permissoes?.acoes);
dados.usuarios.forEach((u, i) => {
    if (!(u?.permissoes?.paginas && u?.permissoes?.acoes)) {
        const p = !mat && i === dados.usuarios.findIndex(us => us?.ativo !== false) ? 'admin' : 'supervisor';
        u.permissoes = {
            perfil: p,
            paginas: { dashboard: true, relatorios: true, lancamentos: true, cartoes: true, categorias: true, configuracoes: p === 'admin' },
            acoes: { criarMovimento: p !== 'usuario', excluirMovimento: p !== 'usuario', financiamentos: p !== 'usuario', lotes: p !== 'usuario', usuarios: p === 'admin', logs: p === 'admin' }
        };
        alterou = true;
    }
    // Normaliza campos JSON: evita falso positivo "alterar outro usuário" em cache legado.
    if (!u.configuracaoSalarial || typeof u.configuracaoSalarial !== 'object' || Array.isArray(u.configuracaoSalarial)) {
        u.configuracaoSalarial = {};
        alterou = true;
    }
    if (!u.preferenciasNotificacao || typeof u.preferenciasNotificacao !== 'object' || Array.isArray(u.preferenciasNotificacao)) {
        u.preferenciasNotificacao = {};
        alterou = true;
    }
});

    [['exclusao_movimento', 'legacy_exc'], ['edicao_movimento', 'legacy_edit']].forEach(([nc, pref]) => {
        dados[nc].forEach((r, i) => {
            if (!r || r.id) return;
            const c = { ...r }; delete c.id;
            r.id = `${pref}_${encodeURIComponent(`${serializarEstavel(c)}#${i}`)}`; alterou = true;
        });
    });

    dados.lancamentos.forEach(l => {
        const pago = l.pago === true || String(l.status).toLowerCase() === 'pago';
        if (l.pago !== pago) { l.pago = pago; alterou = true; }
        const sts = pago ? 'pago' : (String(l.status).toLowerCase() === 'atrasado' ? 'atrasado' : 'pendente');
        if (l.status !== sts) { l.status = sts; alterou = true; }
        if (l.horaExtra == null) { l.horaExtra = 0; alterou = true; }
        if (!l.servicoEssencial) { l.servicoEssencial = 'nao'; alterou = true; }
        if (!l.escopo) { l.escopo = 'casal'; alterou = true; }
        if (!l.observacao) l.observacao = '';
        if (!l.cartaoId && l.formaPagamento !== 'CARTAO') l.cartaoId = null;

        if (l.formaPagamento === 'CARTAO' && l.cartaoId && l.vencimento && !l.faturaId) {
            l.faturaId = `fat_${l.cartaoId}_${String(l.vencimento).slice(0, 7)}`;
            alterou = true;
        }

        if (!l.parcelamentoId && Number(l.totalParcelas) > 1 && l.dataCompra) {
            const ch = `${l.usuarioId || 0}|${l.cartaoId || 0}|${descricaoBaseParcelamento(l.descricao)}|${l.totalParcelas}|${String(l.dataCompra).slice(0, 10)}`;
            if (!l._legacyParcelamentoChave) { l._legacyParcelamentoChave = ch; alterou = true; }
        }
        if (!l.financiamentoId && normalizarTexto(l.descricao).startsWith('financiamento:')) {
            const cand = (dados.financiamentos || []).filter(f => normalizarTexto(f.nome) === normalizarTexto(l.descricao).slice(14).replace(/\s\(\d+\/\d+\)$/, '').trim());
            const fin = l.usuarioId == null ? cand : (cand.filter(f => String(f.usuarioId) === String(l.usuarioId)).length ? cand.filter(f => String(f.usuarioId) === String(l.usuarioId)) : cand);
            if (fin.length === 1) { l.financiamentoId = fin[0].id; alterou = true; }
        }
    });

    const grps = new Map();
    dados.lancamentos.forEach(l => {
        if (l._legacyParcelamentoChave) {
            if (!grps.has(l._legacyParcelamentoChave)) grps.set(l._legacyParcelamentoChave, `legacy_${encodeURIComponent(l._legacyParcelamentoChave)}`);
            l.parcelamentoId = grps.get(l._legacyParcelamentoChave); delete l._legacyParcelamentoChave; alterou = true;
        }
    });

    const faturasAtivas = new Set();
    dados.lancamentos.forEach(l => {
        if (l.faturaId && l.formaPagamento === 'CARTAO') {
            faturasAtivas.add(l.faturaId);
            let fat = dados.fatura_cartao.find(f => f.id === l.faturaId);
            if (!fat) {
                fat = {
                    id: l.faturaId, cartaoId: l.cartaoId, mesReferencia: String(l.vencimento).slice(0, 7),
                    valorTotal: 0, valorPago: 0, status: 'pendente',
                    dataVencimento: l.vencimento, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
                };
                dados.fatura_cartao.push(fat);
                alterou = true;
            }
        }
    });

    dados.fatura_cartao.forEach(fat => {
        const itens = dados.lancamentos.filter(l => String(l.faturaId) === String(fat.id));
        const vTot = Number(itens.reduce((a, b) => a + Number(b.valor || 0), 0).toFixed(2));
        const vPag = Number(itens.filter(x => x.pago).reduce((a, b) => a + Number(b.valor || 0), 0).toFixed(2));
        const st = vPag === 0 ? 'pendente' : (vPag >= vTot ? 'paga' : 'parcial');

        if (fat.valorTotal !== vTot || fat.valorPago !== vPag || fat.status !== st) {
            fat.valorTotal = vTot; fat.valorPago = vPag; fat.status = st;
            fat.updatedAt = new Date().toISOString();
            alterou = true;
        }
    });

    const antesOrfas = dados.fatura_cartao.length;
    dados.fatura_cartao = dados.fatura_cartao.filter(f => faturasAtivas.has(f.id));
    if (dados.fatura_cartao.length !== antesOrfas) alterou = true;

    if (dados._schemaVersion !== SCHEMA_VERSION) { dados._schemaVersion = SCHEMA_VERSION; alterou = true; }
    return { dados, alterou };
}
