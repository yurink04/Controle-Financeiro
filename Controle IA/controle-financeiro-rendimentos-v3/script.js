// ============================================================================
// 1. CONSTANTES E ESTADO GLOBAL
// ============================================================================
const DB_KEY = 'sistemaFinanceiroCompartilhado';
const BACKUP_TESTE_KEY = 'sistemaFinanceiroBackupTeste';
const API_URL = "https://script.google.com/macros/s/AKfycbxOTWLwazFf7hO7scTIRlKAOxHUdB0CroAVuAyfnC6Xsq2XMql7vvyTzNwJ0d1se1MW/exec";
const TOKEN_API = "PLANOF1NALPRAS4AIRD@MERDA";
const CHAVE_SESSAO_API = 'financeiroSessaoSegura';
const CHAVE_USUARIO_SESSAO = 'financeiroSessaoUsuario';
const CHAVE_DONO_PENDENCIAS = 'financeiroSyncUsuario';
const obterSessaoAPI = () => sessionStorage.getItem(CHAVE_SESSAO_API) || '';

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
let processandoAcaoModal = false;
let processandoSaidaSistema = false;
let memoriaSistema = null;
let verificacaoAutenticacaoPromise = null;

let _migracaoCacheRef = null;
let _migracaoCacheDados = null;

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
function formatarPercentualPrivado(v, casas = 0) {
    if (privacidadeAtiva()) return '••%';
    return Number(v).toFixed(casas) + '%';
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
const clonarDados = d => JSON.parse(JSON.stringify(d));
const validarComplexidadeSenha = s => /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[\W_]).{8,}$/.test(String(s || ''));

const gerarId = (prefixo = 'id') => {
    try { if (window.crypto && window.crypto.randomUUID) return `${prefixo}_${window.crypto.randomUUID()}`; } catch (_) {}
    return `${prefixo}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
};

async function gerarHash(texto) {
    const data = new TextEncoder().encode(texto);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ============================================================================
// REMUNERAÇÃO CLT E HISTÓRICO DE RENDIMENTOS
// Referência: INSS / Receita Federal (competência 2026). É uma estimativa:
// rescisões, férias, 13º, múltiplos vínculos e rubricas específicas têm regras
// próprias. O lançamento financeiro registra o valor efetivamente recebido.
// ============================================================================
const REFERENCIA_CALCULO_SALARIAL = '2026';
const FAIXAS_INSS_2026 = Object.freeze([
    { limite: 1621.00, taxa: .075 },
    { limite: 2902.84, taxa: .09 },
    { limite: 4354.27, taxa: .12 },
    { limite: 8475.55, taxa: .14 }
]);
const FAIXAS_IRRF_2026 = Object.freeze([
    { limite: 2428.80, aliquota: 0, deducao: 0 },
    { limite: 2826.65, aliquota: .075, deducao: 182.16 },
    { limite: 3751.05, aliquota: .15, deducao: 394.16 },
    { limite: 4664.68, aliquota: .225, deducao: 675.49 },
    { limite: Infinity, aliquota: .275, deducao: 908.73 }
]);
function centavosRenda(valor) {
    const n = Number(valor);
    return Number.isFinite(n) ? Math.round((n + Number.EPSILON) * 100) / 100 : 0;
}
function normalizarConfiguracaoSalarial(valor) {
    const c = valor && typeof valor === 'object' && !Array.isArray(valor) ? valor : {};
    return {
        vtAtivo: c.vtAtivo === true,
        vtCustoMensal: Math.max(0, centavosRenda(c.vtCustoMensal)),
        irrfAtivo: c.irrfAtivo !== false,
        dependentes: Math.min(20, Math.max(0, Math.trunc(Number(c.dependentes) || 0))),
        descontos: Array.isArray(c.descontos) ? c.descontos.slice(0, 20)
            .filter(d => d && typeof d === 'object')
            .map(d => ({
                id: String(d.id || gerarId('desc')).slice(0, 70),
                nome: String(d.nome || 'Outro desconto').trim().slice(0, 70),
                tipo: d.tipo === 'percentual' ? 'percentual' : 'fixo',
                valor: Math.max(0, centavosRenda(d.valor))
            })) : []
    };
}
function calcularINSSSalario2026(remuneracaoBruta) {
    const base = Math.min(Math.max(0, Number(remuneracaoBruta) || 0), 8475.55);
    let anterior = 0, total = 0;
    const faixas = [];
    for (const faixa of FAIXAS_INSS_2026) {
        const parcela = Math.max(0, Math.min(base, faixa.limite) - anterior);
        if (parcela > 0) {
            const descontado = centavosRenda(parcela * faixa.taxa);
            faixas.push({ de: anterior, ate: Math.min(base, faixa.limite), aliquota: faixa.taxa, valor: descontado });
            total += descontado;
        }
        anterior = faixa.limite;
        if (base <= faixa.limite) break;
    }
    return { valor: centavosRenda(total), base, faixas };
}
function calcularIRRFSalario2026(remuneracaoBruta, inss, dependentes = 0) {
    const bruto = Math.max(0, Number(remuneracaoBruta) || 0);
    const deducaoDependentes = Math.max(0, Number(dependentes) || 0) * 189.59;
    const baseLegal = Math.max(0, bruto - inss - deducaoDependentes);
    const baseSimplificada = Math.max(0, bruto - 607.20);
    const simplificado = baseSimplificada < baseLegal;
    const base = centavosRenda(Math.min(baseLegal, baseSimplificada));
    const faixa = FAIXAS_IRRF_2026.find(f => base <= f.limite);
    const impostoTabela = centavosRenda(Math.max(0, base * faixa.aliquota - faixa.deducao));
    const reducaoLegal = bruto <= 5000 ? impostoTabela
        : bruto <= 7350 ? Math.max(0, 978.62 - 0.133145 * bruto) : 0;
    const reducao = Math.min(impostoTabela, centavosRenda(reducaoLegal));
    return {
        valor: centavosRenda(Math.max(0, impostoTabela - reducao)),
        base, baseLegal: centavosRenda(baseLegal), baseSimplificada: centavosRenda(baseSimplificada),
        simplificado, aliquota: faixa.aliquota, deducaoTabela: faixa.deducao,
        impostoTabela, reducao, dependentes: Math.max(0, Number(dependentes) || 0)
    };
}
function calcularSalarioLiquido(brutoInformado, configuracao) {
    const bruto = Math.max(0, centavosRenda(brutoInformado));
    const conf = normalizarConfiguracaoSalarial(configuracao);
    const inss = calcularINSSSalario2026(bruto);
    const irrf = conf.irrfAtivo
        ? calcularIRRFSalario2026(bruto, inss.valor, conf.dependentes)
        : { valor: 0, base: 0, impostoTabela: 0, reducao: 0, desativado: true };
    const vtMaximo = centavosRenda(bruto * .06);
    const valeTransporte = conf.vtAtivo
        ? centavosRenda(conf.vtCustoMensal > 0 ? Math.min(vtMaximo, conf.vtCustoMensal) : vtMaximo) : 0;
    const descontos = conf.descontos.map(d => ({
        ...d, calculado: centavosRenda(d.tipo === 'percentual' ? bruto * d.valor / 100 : d.valor)
    }));
    const outrosDescontos = centavosRenda(descontos.reduce((acc, d) => acc + d.calculado, 0));
    const totalDescontos = centavosRenda(inss.valor + irrf.valor + valeTransporte + outrosDescontos);
    return {
        bruto, inss, irrf, valeTransporte, vtMaximo, descontos, outrosDescontos, totalDescontos,
        liquido: Math.max(0, centavosRenda(bruto - totalDescontos)),
        descontosExcedemBruto: totalDescontos > bruto, referencia: REFERENCIA_CALCULO_SALARIAL
    };
}
function classificarEntradaRendimento(lancamento, dados) {
    if (!lancamento || lancamento.tipo !== 'entrada') return 'fora';
    const contrato = (dados.financiamentos || []).find(f => String(f.id) === String(lancamento.financiamentoId));
    if (contrato && ['emprestimo', 'consignado', 'financiamento'].includes(normalizarTexto(contrato.tipoContrato))) return 'nao_renda';
    const cat = (dados.categorias || []).find(c => String(c.id) === String(lancamento.categoriaId));
    const categoria = normalizarTexto(cat?.nome);
    const descricao = normalizarTexto(lancamento.descricao);
    // Crédito financeiro, reembolso e transferência não são rendimentos do trabalho.
    if (/emprestimo|financiamento|consignado|transferencia|estorno|reembolso|resgate/.test(categoria)) return 'nao_renda';
    const manual = String(lancamento.naturezaRenda || '');
    if (['folha', 'adiantamento', 'salarial_extra', 'variavel', 'nao_renda'].includes(manual)) return manual;
    const texto = categoria + ' ' + descricao;
    if (/adiantamento|antecipacao.*salario|vale.*salario/.test(texto)) return 'adiantamento';
    if (/ferias|decimo|13.?salario|participacao.*lucro|\bplr\b/.test(texto)) return 'salarial_extra';
    if (/salario|folha de pagamento|pagamento de folha/.test(texto)) return 'folha';
    if (/emprestimo|transferencia|estorno|reembolso|resgate/.test(descricao)) return 'nao_renda';
    return 'variavel';
}
function obterMesRendimento(lancamento) {
    return String(lancamento.dataPagamento || lancamento.vencimento || lancamento.dataCompra || lancamento.createdAt || '').slice(0, 7);
}
function consolidarRendimentosUsuario(dados, usuarioId, referencia = new Date()) {
    const mensal = new Map();
    const registros = [];
    for (const l of (dados.lancamentos || [])) {
        if (String(l.usuarioId) !== String(usuarioId) || l.tipo !== 'entrada') continue;
        if (l.pago !== true && l.status !== 'pago') continue;
        const classe = classificarEntradaRendimento(l, dados);
        if (classe === 'fora' || classe === 'nao_renda') continue;
        const mes = obterMesRendimento(l);
        if (!/^\d{4}-\d{2}$/.test(mes)) continue;
        const valor = Math.max(0, centavosRenda(l.valor));
        const horaExtra = classe === 'folha' ? Math.min(valor, Math.max(0, centavosRenda(l.horaExtra))) : 0;
        if (!mensal.has(mes)) mensal.set(mes, {
            mes, folha: 0, adiantamento: 0, salarial_extra: 0, variavel: 0, horasExtras: 0, total: 0, quantidade: 0
        });
        const grupo = mensal.get(mes);
        grupo[classe] = centavosRenda(grupo[classe] + valor);
        grupo.horasExtras = centavosRenda(grupo.horasExtras + horaExtra);
        grupo.total = centavosRenda(grupo.total + valor);
        grupo.quantidade++;
        registros.push({ ...l, classeRenda: classe, mesRenda: mes, valor, horasExtrasIncluidas: horaExtra });
    }
    const hoje = referencia instanceof Date ? referencia : new Date(referencia);
    const mesesMedia = [];
    let totalVariavelJanela = 0;
    for (let i = 0; i < 6; i++) {
        const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1);
        const mes = String(d.getFullYear()) + '-' + String(d.getMonth() + 1).padStart(2, '0');
        mesesMedia.push(mes);
        totalVariavelJanela += mensal.get(mes)?.variavel || 0;
    }
    const grupos = [...mensal.values()].sort((a, b) => b.mes.localeCompare(a.mes));
    registros.sort((a, b) => String(b.dataPagamento || b.vencimento || '').localeCompare(String(a.dataPagamento || a.vencimento || '')));
    return {
        meses: grupos, registros, mesesMedia, totalVariavelJanela: centavosRenda(totalVariavelJanela),
        mediaVariavel: centavosRenda(totalVariavelJanela / 6),
        totalFolha: centavosRenda(grupos.reduce((v, g) => v + g.folha, 0)),
        totalAdiantamentos: centavosRenda(grupos.reduce((v, g) => v + g.adiantamento, 0)),
        totalHorasExtras: centavosRenda(grupos.reduce((v, g) => v + g.horasExtras, 0))
    };
}

function abrirEditorSalarial() {
    if (document.getElementById('modalConfiguracaoSalarial')) return;
    const dados = obterDados(), usuario = obterUsuarioAtual(dados);
    if (!usuario) return;
    const conf = normalizarConfiguracaoSalarial(usuario.configuracaoSalarial);
    const modal = document.createElement('div');
    modal.className = 'modal-overlay salary-modal-overlay';
    modal.id = 'modalConfiguracaoSalarial';
    modal.innerHTML = `
        <div class="modal-box salary-modal" role="dialog" aria-modal="true" aria-labelledby="salarioModalTitulo">
            <div class="salary-modal-head">
                <div><span class="income-eyebrow">REMUNERAÇÃO MENSAL · CLT</span><h3 id="salarioModalTitulo">Configure seu salário</h3>
                    <p>Informe o valor bruto. Estimamos os descontos para mostrar quanto pode entrar líquido.</p></div>
                <button type="button" class="salary-close-btn" aria-label="Fechar edição">×</button>
            </div>
            <div class="salary-modal-grid">
                <div class="form-group"><label for="salarioBrutoEditor">Salário bruto mensal (R$)</label>
                    <input type="number" step="0.01" min="0" max="10000000" id="salarioBrutoEditor" value="${Number(usuario.rendaFixa || 0)}"></div>
                <div class="form-group"><label for="dependentesSalarioEditor">Dependentes para IRRF</label>
                    <input type="number" min="0" max="20" step="1" id="dependentesSalarioEditor" value="${conf.dependentes}"></div>
            </div>
            <div class="salary-modal-options">
                <label class="salary-option"><input type="checkbox" id="irrfSalarioEditor" ${conf.irrfAtivo ? 'checked' : ''}><span><strong>Calcular IRRF, quando aplicável</strong><small>Usa a tabela progressiva e a redução mensal de 2026.</small></span></label>
                <label class="salary-option"><input type="checkbox" id="vtSalarioEditor" ${conf.vtAtivo ? 'checked' : ''}><span><strong>Utilizo vale-transporte</strong><small>Até 6% do salário básico; o desconto real pode ser menor.</small></span></label>
                <div class="form-group salary-vt-cost"><label for="vtCustoEditor">Custo mensal do transporte (R$, opcional)</label><input type="number" min="0" step="0.01" max="1000000" id="vtCustoEditor" value="${conf.vtCustoMensal || ''}" placeholder="Se vazio, estima 6%"></div>
            </div>
            <div class="salary-deductions-head"><div><strong>Outros descontos</strong><p>Academia, alimentação, refeição, sindicato e demais rubricas.</p></div>
                <button type="button" class="btn-secundario" id="adicionarDescontoSalario">+ Adicionar</button></div>
            <div id="listaDescontosSalario" class="salary-deductions-list"></div>
            <div id="previaSalarioLiquido" class="salary-preview" aria-live="polite"></div>
            <p class="salary-disclaimer">Simulação informativa baseada nas regras gerais CLT de 2026. Contracheque real, 13º, férias e acordos específicos podem gerar valores diferentes.</p>
            <div class="salary-modal-actions"><span class="salary-editor-feedback" id="feedbackEditorSalario" role="status"></span>
                <button type="button" class="btn-secundario" id="cancelarEditorSalario">Cancelar</button>
                <button type="button" id="salvarEditorSalario">Salvar configuração</button>
            </div>
        </div>`;
    document.body.appendChild(modal);
    const campo = id => modal.querySelector('#' + id);
    const areaDescontos = campo('listaDescontosSalario');
    const salvar = campo('salvarEditorSalario');
    function adicionarLinha(desconto = {}) {
        if (areaDescontos.children.length >= 20) return;
        const linha = document.createElement('div');
        linha.className = 'salary-deduction-row';
        linha.innerHTML = `
            <input type="text" class="salary-deduction-name" maxlength="70" aria-label="Nome do desconto" placeholder="Ex.: vale-refeição" value="${escaparHTML(desconto.nome || '')}">
            <select class="salary-deduction-type" aria-label="Tipo do desconto"><option value="fixo">R$</option><option value="percentual">%</option></select>
            <input type="number" class="salary-deduction-value" min="0" max="10000000" step="0.01" aria-label="Valor do desconto" value="${Math.max(0, Number(desconto.valor) || 0)}">
            <button type="button" class="salary-deduction-remove" aria-label="Remover desconto">×</button>`;
        linha.querySelector('select').value = desconto.tipo === 'percentual' ? 'percentual' : 'fixo';
        linha.querySelector('button').onclick = () => { linha.remove(); atualizarPrevia(); };
        areaDescontos.appendChild(linha);
    }
    function lerEditor() {
        const bruto = Number(campo('salarioBrutoEditor').value);
        const dependentes = Number(campo('dependentesSalarioEditor').value);
        if (!Number.isFinite(bruto) || bruto < 0 || bruto > 10000000) throw new Error('Informe um salário bruto válido.');
        if (!Number.isInteger(dependentes) || dependentes < 0 || dependentes > 20) throw new Error('Informe entre 0 e 20 dependentes.');
        const descontos = [...areaDescontos.children].map((linha, i) => {
            const nome = linha.querySelector('.salary-deduction-name').value.trim();
            const tipo = linha.querySelector('.salary-deduction-type').value;
            const valor = Number(linha.querySelector('.salary-deduction-value').value);
            if (!nome || !Number.isFinite(valor) || valor < 0 || valor > 10000000 || (tipo === 'percentual' && valor > 100))
                throw new Error('Revise o nome e o valor dos descontos adicionais (percentual máximo: 100%).');
            return { id: 'desconto_' + i, nome, tipo, valor };
        });
        const vtCusto = Number(campo('vtCustoEditor').value || 0);
        if (!Number.isFinite(vtCusto) || vtCusto < 0 || vtCusto > 1000000) throw new Error('Custo de transporte inválido.');
        return {
            bruto, configuracao: {
                vtAtivo: campo('vtSalarioEditor').checked, vtCustoMensal: vtCusto,
                irrfAtivo: campo('irrfSalarioEditor').checked, dependentes, descontos
            }
        };
    }
    function atualizarPrevia() {
        const area = campo('previaSalarioLiquido');
        try {
            const { bruto, configuracao } = lerEditor();
            const c = calcularSalarioLiquido(bruto, configuracao);
            area.innerHTML = `
                <div><span>Salário bruto</span><strong>${formatarMoeda(c.bruto)}</strong></div>
                <div><span>INSS (faixas progressivas)</span><strong>− ${formatarMoeda(c.inss.valor)}</strong></div>
                <div><span>IRRF estimado</span><strong>− ${formatarMoeda(c.irrf.valor)}</strong></div>
                <div><span>Vale-transporte</span><strong>− ${formatarMoeda(c.valeTransporte)}</strong></div>
                <div><span>Outros descontos</span><strong>− ${formatarMoeda(c.outrosDescontos)}</strong></div>
                <div class="salary-preview-total"><span>Possível salário líquido</span><strong>${formatarMoeda(c.liquido)}</strong></div>
                ${c.descontosExcedemBruto ? '<p>Os descontos ultrapassaram o salário bruto. Revise os valores.</p>' : ''}`;
            campo('feedbackEditorSalario').textContent = '';
        } catch (e) {
            area.replaceChildren();
            campo('feedbackEditorSalario').textContent = e.message;
        }
    }
    conf.descontos.forEach(adicionarLinha);
    modal.addEventListener('input', atualizarPrevia);
    modal.addEventListener('change', atualizarPrevia);
    campo('adicionarDescontoSalario').onclick = () => { adicionarLinha(); atualizarPrevia(); };
    const fechar = () => modal.remove();
    modal.querySelector('.salary-close-btn').onclick = fechar;
    campo('cancelarEditorSalario').onclick = fechar;
    modal.addEventListener('click', e => { if (e.target === modal) fechar(); });
    modal.addEventListener('keydown', e => { if (e.key === 'Escape') fechar(); });
    salvar.onclick = async () => {
        try {
            const { bruto, configuracao } = lerEditor();
            salvar.disabled = true; salvar.textContent = 'Salvando…';
            const atual = obterDados();
            const u = obterUsuarioAtual(atual);
            if (!u) throw new Error('Sessão inválida.');
            u.rendaFixa = centavosRenda(bruto);
            u.configuracaoSalarial = normalizarConfiguracaoSalarial(configuracao);
            registrarLog(atual, 'ATUALIZAÇÃO SALARIAL', 'Remuneração e descontos do próprio usuário atualizados.');
            await salvarDados(atual);
            fechar();
            if (typeof carregarDadosPerfil === 'function') carregarDadosPerfil();
            if (typeof carregarHistoricoRendimentos === 'function') carregarHistoricoRendimentos();
            notificarOperacao('Configuração salarial salva. Sincronização em segundo plano.');
        } catch (e) {
            campo('feedbackEditorSalario').textContent = e.message;
            salvar.disabled = false; salvar.textContent = 'Salvar configuração';
        }
    };
    atualizarPrevia();
    campo('salarioBrutoEditor').focus();
}

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
    const usuarioAtualId = Number(obterUsuarioAtualId());
    const usuarioAtual = (dadosGlobais.usuarios || []).find(u => Number(u.id) === usuarioAtualId);
    if (!usuarioAtual) return [];
    const parceiroId = usuarioAtual.parceiroId ? Number(usuarioAtual.parceiroId) : null;
    return (lista || []).filter(item => {
        const donoId = Number(item.usuarioId);
        if (!item.usuarioId) return true;
        if (escopoFiltro === 'individual') return donoId === usuarioAtualId;
        return donoId === usuarioAtualId || (parceiroId && donoId === parceiroId);
    });
}

function usuarioPodeAlterarLancamento(lancamento, dados = obterDados()) {
    if (!lancamento) return false;
    const u = obterUsuarioAtual(dados); if (!u) return false;
    const donoId = lancamento.usuarioId == null ? null : String(lancamento.usuarioId);
    if (donoId === String(u.id)) return true;
    const pId = u.parceiroId == null ? null : String(u.parceiroId);
    return Boolean(pId && donoId === pId && (lancamento.escopo || 'casal') === 'casal');
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

async function selecionarUsuario(id) {
    // Entrada legada sem credenciais removida: somente o login cria uma sessão válida.
    window.location.href = 'index.html';
    return false;
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
            if (u && normalizarTexto(u.nome) === 'teste') {
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
                if (uL && normalizarTexto(uL.nome) === 'teste' && localStorage.getItem(BACKUP_TESTE_KEY)) {
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
    if (opcoes.sincronizar !== false && (!u || normalizarTexto(u.nome) !== 'teste')) {
        syncPendingData = clonarDados(norm);
        localStorage.setItem('syncPendente', 'true');
        if (dono) localStorage.setItem(CHAVE_DONO_PENDENCIAS, dono);
        if (!localStorage.getItem(SYNC_CONFLICT_KEY)) {
            atualizarIndicadorSyncUI('pending');
            agendarSincronizacaoSilenciosa();
        } else atualizarIndicadorSyncUI('error');
    } else if (u && normalizarTexto(u.nome) === 'teste') {
        clearTimeout(syncTimer); syncTimer = null; syncPendingData = null; localStorage.removeItem('syncPendente');
    }
    return true;
}

function registrarLog(dados, acao, detalhes, extras = {}) {
    if (!Array.isArray(dados.logs)) dados.logs = [];
    const u = obterUsuarioAtual(dados);
    const agora = new Date();
    dados.logs.push({ id: gerarId('log'), dataHora: agora.toISOString(), dataHoraFormatada: formatarDataSemHora(agora), usuario: u?.nome || 'Sistema', usuarioId: u?.id || null, acao, detalhes, ...extras });
}

function serializarEstavel(v) {
    if (v === undefined) return '__UNDEFINED__';
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) return '[' + v.map(serializarEstavel).join(',') + ']';
    return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + serializarEstavel(v[k])).join(',') + '}';
}

function mesclarValorTresVias(base, local, remoto, caminho, conflitos) {
    if (serializarEstavel(local) === serializarEstavel(base)) return clonarDados(remoto);
    if (serializarEstavel(remoto) === serializarEstavel(base)) return clonarDados(local);
    if (serializarEstavel(local) === serializarEstavel(remoto)) return clonarDados(local);
    const isObj = o => o !== null && typeof o === 'object' && !Array.isArray(o);
    if (isObj(local) && isObj(remoto) && (base === undefined || isObj(base))) {
        const res = {};
        new Set([...Object.keys(base || {}), ...Object.keys(local || {}), ...Object.keys(remoto || {})]).forEach(k => {
            const m = mesclarValorTresVias(base?.[k], local?.[k], remoto?.[k], `${caminho}.${k}`, conflitos);
            if (m !== undefined) res[k] = m;
        });
        return res;
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

function mesclarColecaoTresVias(nome, baseLista, localLista, remotoLista, conflitos) {
    const base = indexarColecao(baseLista), local = indexarColecao(localLista), remoto = indexarColecao(remotoLista);
    const vistos = new Set(), res = [];
    [...remoto.keys(), ...local.keys(), ...base.keys()].forEach(k => {
        if (vistos.has(k)) return; vistos.add(k);
        const v = mesclarValorTresVias(base.get(k), local.get(k), remoto.get(k), `${nome}[${k}]`, conflitos);
        if (v !== undefined) res.push(v);
    });
    return res;
}

function mesclarSnapshotsTresVias(base, local, remoto) {
    const conflitos = [], res = clonarDados(remoto || {});
    COLECOES_DADOS.forEach(n => res[n] = mesclarColecaoTresVias(n, base?.[n], local?.[n], remoto?.[n], conflitos));
    new Set([...Object.keys(base || {}), ...Object.keys(local || {}), ...Object.keys(remoto || {})]).forEach(k => {
        if (COLECOES_DADOS.includes(k) || k === '_revision') return;
        const v = mesclarValorTresVias(base?.[k], local?.[k], remoto?.[k], k, conflitos);
        if (v !== undefined) res[k] = v;
    });
    res._revision = Number(remoto?._revision) || 0;
    return { dados: res, conflitos: [...new Set(conflitos)] };
}

function marcarConflitoSincronizacao(dadosLocais, campos, mensagem) {
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
    // Em modo offline, os dados permanecem salvos localmente. A rede ativa o
    // próximo envio, sem requisições repetidas a cada segundo.
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
    const res = await fetch(API_URL, {
        method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, cache: 'no-store',
        body: JSON.stringify({ action: 'obterDados', token: TOKEN_API, sessao: obterSessaoAPI() })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    conferirSessaoRespostaAPI(json);
    if (json.status === 'erro' || !Array.isArray(json.usuarios)) throw new Error(json.mensagem || 'Dados inválidos.');
    return json;
}

// ---- Sincronização única em segundo plano (todas as páginas) ----
const SYNC_CHECK_MIN_MS = 30000;      // não consulta o servidor mais de 1x a cada 30s (somando todas as páginas)
const SYNC_CHECK_INTERVAL_MS = 60000; // checagem periódica enquanto a aba está visível
const SYNC_FALLBACK_FULL_MS = 300000; // se o servidor ainda não tem a ação 'revisao'
let _syncBgIniciado = false;
let _syncBgEmAndamento = false;

async function consultarRevisaoServidor() {
    const res = await fetch(API_URL, {
        method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, cache: 'no-store',
        body: JSON.stringify({ action: 'revisao', token: TOKEN_API, sessao: obterSessaoAPI() })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    conferirSessaoRespostaAPI(json);
    if (json.status !== 'sucesso' || !Number.isFinite(Number(json._revision))) return null; // Code.gs antigo
    return Number(json._revision);
}

async function verificarAtualizacaoServidor(forcar = false) {
    if (_syncBgEmAndamento || syncInFlight || syncPendingData || syncTimer) return;
    if (localStorage.getItem('syncPendente') === 'true' || localStorage.getItem(SYNC_CONFLICT_KEY)) return;
    if (!localStorage.getItem('usuarioLogado') || !navigator.onLine) return;
    const u = obterUsuarioAtual();
    if (u && normalizarTexto(u.nome) === 'teste') return;
    const agora = Date.now();
    if (!forcar && agora - Number(localStorage.getItem('ultimaChecagemMs') || 0) < SYNC_CHECK_MIN_MS) return;

    _syncBgEmAndamento = true;
    localStorage.setItem('ultimaChecagemMs', String(agora));
    try {
        const revRemota = await consultarRevisaoServidor();
        const revLocal = Number(window.revisaoServidorAtual ?? memoriaSistema?._revision) || 0;
        if (revRemota !== null) {
            if (revRemota === revLocal) { localStorage.setItem('ultimoSyncMs', String(Date.now())); return; }
        } else if (agora - Number(localStorage.getItem('ultimoSyncMs') || 0) < SYNC_FALLBACK_FULL_MS) {
            return;
        }
        const json = await buscarDadosServidor();
        // Houve edição local durante o download? Então não sobrescreve.
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
        console.warn('Checagem em segundo plano falhou:', e);
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

async function sincronizarComServidor() {
    if (syncInFlight || !syncPendingData || localStorage.getItem(SYNC_CONFLICT_KEY) || !navigator.onLine) return;
    syncInFlight = true; let payloadAtual = null, tentativas = 0;
    try {
        while (syncPendingData && tentativas < 5 && !localStorage.getItem(SYNC_CONFLICT_KEY)) {
            tentativas++; payloadAtual = syncPendingData; syncPendingData = null;
            const res = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: 'salvarDados', token: TOKEN_API, sessao: obterSessaoAPI(), dados: payloadAtual }) });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const json = await res.json();
            conferirSessaoRespostaAPI(json);
            if (json.status === 'conflito') {
                const lAtual = lerJSONLocal(DB_KEY, payloadAtual) || payloadAtual;
                const base = lerJSONLocal(SYNC_BASELINE_KEY, null);
                const serv = migrarDados(await buscarDadosServidor()).dados;
                if (!base) { marcarConflitoSincronizacao(lAtual, [], 'Sem snapshot-base.'); break; }
                const mescla = mesclarSnapshotsTresVias(migrarDados(base).dados, migrarDados(lAtual).dados, serv);
                if (mescla.conflitos.length) { marcarConflitoSincronizacao(lAtual, mescla.conflitos, 'Conflito de mesclagem.'); break; }
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
            if (syncPendingData) syncPendingData._revision = rev;
            if (memoriaSistema) { memoriaSistema._revision = rev; localStorage.setItem(DB_KEY, JSON.stringify(memoriaSistema)); }
            if (!syncPendingData) {
                localStorage.removeItem('syncPendente');
                localStorage.removeItem(CHAVE_DONO_PENDENCIAS);
                atualizarIndicadorSyncUI('success');
            }
            else { localStorage.setItem('syncPendente', 'true'); atualizarIndicadorSyncUI('pending'); }
        }
    } catch (e) {
        syncFalhasConsecutivas++;
        console.warn('Sync adiada:', e);
        if (!syncPendingData && payloadAtual) syncPendingData = clonarDados(lerJSONLocal(DB_KEY, payloadAtual) || payloadAtual);
        localStorage.setItem('syncPendente', 'true'); atualizarIndicadorSyncUI('error');
    } finally {
        syncInFlight = false;
        if (syncPendingData && !localStorage.getItem(SYNC_CONFLICT_KEY)) agendarSincronizacaoSilenciosa();
    }
}

async function inicializarBanco() {
    window.ultimaOrigemBanco = 'indefinida';
    const local = lerJSONLocal(DB_KEY, null);
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
        if (local) {
            window.ultimaOrigemBanco = 'local-offline';
            console.warn('Dados locais usados porque a atualização remota falhou:', e);
            return memoriaSistema = migrarDados(local).dados;
        }
        throw e;
    }
}

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
        if (u?.permissoes?.paginas && u?.permissoes?.acoes) return;
        const p = !mat && i === dados.usuarios.findIndex(us => us?.ativo !== false) ? 'admin' : 'supervisor';
        u.permissoes = { perfil: p, paginas: { dashboard: true, relatorios: true, lancamentos: true, cartoes: true, categorias: true, configuracoes: p === 'admin' }, acoes: { criarMovimento: p !== 'usuario', excluirMovimento: p !== 'usuario', financiamentos: p !== 'usuario', lotes: p !== 'usuario', usuarios: p === 'admin', logs: p === 'admin' } };
        alterou = true;
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
        const resposta = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({
                action: 'verificarAdmin',
                token: TOKEN_API,
                sessao: obterSessaoAPI(),
                senha: String(senhaInformada).trim()
            })
        });
        const dadosResposta = await resposta.json();
        conferirSessaoRespostaAPI(dadosResposta);

        if (dadosResposta.status === 'sucesso' && dadosResposta.autorizado === true) {
            return true;
        }

        if (dadosResposta.status === 'sucesso') {
            await mostrarAlertaModal('Senha administrativa incorreta. Tente novamente.');
        } else {
            console.warn('Falha na verificação administrativa:', dadosResposta.mensagem);
            await mostrarAlertaModal('Não foi possível validar o acesso agora. Tente novamente.');
        }
        return false;
    } catch (erro) {
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

function injetarBannerPrivacidade() {
    if (document.getElementById('bannerPrivacidade')) return;
    const b = document.createElement('button');
    b.id = 'bannerPrivacidade';
    b.type = 'button';
    b.className = 'privacy-banner';
    b.innerHTML = '🔒 Modo Discreto ativo — <u>revelar valores</u>';
    b.title = 'Clique para mostrar os valores';
    b.onclick = alternarPrivacidade;
    document.body.appendChild(b);
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
            const forcar = await mostrarConfirmacaoModal('Atenção! Existem dados locais não enviados ou em conflito. Deseja forçar um novo envio agora (baixando um backup de segurança antes)?');

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
    mostrarLoading("Criando backup e forçando envio...", true);
    try {
        const dbLocalStr = localStorage.getItem(DB_KEY);
        if (!dbLocalStr) throw new Error("Sem dados locais para enviar.");
        const dbLocal = JSON.parse(dbLocalStr);

        const blob = new Blob([dbLocalStr], { type: 'text/plain' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `backup_emergencia_${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        const resGet = await buscarDadosServidor();

        dbLocal._revision = resGet._revision;
        const reqPost = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({ action: 'salvarDados', token: TOKEN_API, sessao: obterSessaoAPI(), dados: dbLocal })
        });
        const resPost = await reqPost.json();

        if (resPost.status === 'sucesso') {
            localStorage.removeItem(SYNC_CONFLICT_KEY);
            localStorage.removeItem('syncPendente');
            localStorage.setItem(SYNC_BASELINE_KEY, JSON.stringify(dbLocal));
            localStorage.setItem('ultimoSyncMs', Date.now().toString());
            await mostrarAlertaModal('Sucesso! O backup foi baixado e seus lançamentos foram forçados para o servidor.');
            location.reload();
        } else {
            await mostrarAlertaModal('Erro do servidor: ' + resPost.mensagem);
        }
    } catch (e) {
        await mostrarAlertaModal('Erro na execução: ' + e.message);
    } finally {
        esconderLoading();
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
    c.title = estado === 'pending' ? 'Sincronizando...' : estado === 'success' ? 'Sincronizado' : 'Erro na sincronização';
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
        d.categorias.push({ id: d.categorias.reduce((m, c) => Math.max(m, c.id||0), 0)+1, nome: nome.trim(), tipo, classificacao: 'personalizado', criadopor: obterUsuarioAtualId(d) });
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
        const horaExtraInformada = numeroSeguro(form.horaExtra);
        if (horaExtraInformada < 0 || horaExtraInformada > vt || (horaExtraInformada > 0 && naturezaRenda && naturezaRenda !== 'folha')) {
            throw new Error('A hora extra deve fazer parte do valor total da folha de pagamento.');
        }
        const b = form.bemId ? d.bens.find(x => String(x.id) === String(form.bemId)) : null;
        let esc = form.tipo === 'saida' ? (form.escopo || 'casal') : 'casal';
        if (b) esc = b.compartilhado ? 'casal' : esc;
        const valP = dividirValorExato(vt, q);
        const heP = horaExtraInformada ? dividirValorExato(horaExtraInformada, q) : Array(q).fill(0);
        const dB = criarDataLocal(form.vencimento);
        let nId = d.lancamentos.reduce((m, l) => Math.max(m, l.id||0), 0) + 1;
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
    const horaExtraNova = novosDados.tipo === 'entrada' ? numeroSeguro(novosDados.horaExtra) : 0;
    if (horaExtraNova < 0 || horaExtraNova > valorNovo || (horaExtraNova > 0 && naturezaNova && naturezaNova !== 'folha')) {
        await mostrarAlertaModal('A hora extra informada deve estar incluída no valor da folha, sem ultrapassá-lo.'); return false;
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

        const finId = (dados.financiamentos || []).reduce((m, f) => Math.max(m, Number(f.id) || 0), 0) + 1;
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

        let nId = (dados.lancamentos || []).reduce((m, l) => Math.max(m, Number(l.id) || 0), 0) + 1;
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
        let nId = (dados.lancamentos || []).reduce((m, l) => Math.max(m, Number(l.id) || 0), 0) + 1;
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
// 7.5 FORMULÁRIO DE LANÇAMENTO
// ============================================================================
function popularSelectsLancamento() {
    const dados = obterDados();
    const selectTipo = document.getElementById('tipoLancamento');
    const selectCartao = document.getElementById('cartaoLancamento');
    const tipoInicial = selectTipo?.value === 'entrada' ? 'entrada' : 'saida';
    atualizarFiltroCategoriasPorTipo(tipoInicial);
    if (selectCartao) {
        selectCartao.innerHTML = '';
        const uId = Number(obterUsuarioAtualId(dados));
        const cartoes = dados.cartoes.filter(c => c.ativo !== false && !c.isBeneficio && Number(c.usuarioId) === uId);
        if (!cartoes.length) {
            const opt = document.createElement('option');
            opt.value = ''; opt.textContent = 'Nenhum cartão ativo cadastrado';
            selectCartao.appendChild(opt); return;
        }
        cartoes.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.id; opt.textContent = c.nome;
            selectCartao.appendChild(opt);
        });
    }
}

function atualizarFiltroCategoriasPorTipo(tipo, categoriaIdPreferida = null) {
    const dados = obterDados();
    const sel = document.getElementById('categoriaLancamento');
    if (!sel) return false;
    const t = tipo === 'entrada' ? 'entrada' : 'saida';
    const atual = categoriaIdPreferida ?? sel.value;
    const filtradas = dados.categorias.filter(c => c.tipo === t).sort((a, b) => normalizarTexto(a.nome).localeCompare(normalizarTexto(b.nome), 'pt-BR'));
    sel.innerHTML = '';
    if (!filtradas.length) {
        const opt = document.createElement('option');
        opt.value = ''; opt.textContent = `Nenhuma categoria de ${t === 'entrada' ? 'entrada' : 'saída'}`;
        sel.appendChild(opt); sel.disabled = true; sel.dataset.tipoAtual = t;
        return false;
    }
    sel.disabled = false;
    filtradas.forEach(c => { const o = document.createElement('option'); o.value = String(c.id); o.textContent = c.nome; sel.appendChild(o); });
    const existe = filtradas.some(c => String(c.id) === String(atual));
    sel.value = existe ? String(atual) : String(filtradas[0].id);
    sel.dataset.tipoAtual = t;
    return true;
}

function tratarMudancaTipoLancamento() {
    const sel = document.getElementById('tipoLancamento');
    if (!sel) return;
    const tipo = sel.value === 'entrada' ? 'entrada' : 'saida';
    atualizarFiltroCategoriasPorTipo(tipo);

    const blHE = document.getElementById('blocoHoraExtra');
    const blForma = document.getElementById('blocoFormaPagamentoContainer');
    const blCartao = document.getElementById('blocoCartao');
    const blEss = document.getElementById('blocoServicoEssencial');
    const lblData = document.getElementById('labelDataReferencia');
    const inHE = document.getElementById('valorHoraExtra');
    const blEsc = document.getElementById('blocoEscopo');
    const blSt = document.getElementById('blocoStatusPagamento');
    const blBem = document.getElementById('blocoBemLancamento');
    const ehEntrada = tipo === 'entrada';

    if (blHE) blHE.style.display = ehEntrada ? 'block' : 'none';
    if (blForma) blForma.style.display = ehEntrada ? 'none' : 'block';
    if (blEss) blEss.style.display = ehEntrada ? 'none' : 'block';
    if (blEsc) blEsc.style.display = ehEntrada ? 'none' : 'block';
    if (blSt) blSt.style.display = ehEntrada ? 'none' : 'block';
    if (blBem) blBem.style.display = ehEntrada ? 'none' : 'block';
    if (lblData) lblData.textContent = ehEntrada ? 'Data de recebimento' : 'Data de vencimento / referência';

    if (ehEntrada) { if (blCartao) blCartao.style.display = 'none'; if (inHE) inHE.value = inHE.value || '0'; }
    else tratarMudancaFormaPagamento();

    if (typeof verificarCategoriaSalario === 'function') verificarCategoriaSalario();
}

function tratarMudancaFormaPagamento() {
    const sel = document.getElementById('formaPagamento');
    if (!sel) return;
    const forma = sel.value;
    const usaCartao = forma === 'CARTAO';
    const tipo = document.getElementById('tipoLancamento')?.value || 'saida';
    const blCartao = document.getElementById('blocoCartao');
    const blVenc = document.getElementById('blocoVencimento');
    const blSt = document.getElementById('blocoStatusPagamento');
    const selSt = document.getElementById('statusPagamento');
    if (blCartao) blCartao.style.display = usaCartao && tipo !== 'entrada' ? 'block' : 'none';
    if (blVenc) blVenc.style.display = usaCartao && tipo !== 'entrada' ? 'none' : 'block';
    if (blSt) blSt.style.display = tipo === 'entrada' || usaCartao ? 'none' : 'block';
    if (selSt && tipo !== 'entrada') {
        if (usaCartao || forma === 'BOLETO' || forma === 'FIXO') selSt.value = 'pendente';
        else if (forma === 'DINHEIRO') selSt.value = 'pago';
    }
}

function inicializarControlesLancamento() {
    const selTipo = document.getElementById('tipoLancamento');
    const selForma = document.getElementById('formaPagamento');
    if (selTipo && selTipo.dataset.controleInicializado !== 'true') {
        selTipo.addEventListener('change', tratarMudancaTipoLancamento);
        selTipo.dataset.controleInicializado = 'true';
    }
    if (selForma && selForma.dataset.controleInicializado !== 'true') {
        selForma.addEventListener('change', tratarMudancaFormaPagamento);
        selForma.dataset.controleInicializado = 'true';
    }
    tratarMudancaTipoLancamento();
}

function verificarCategoriaSalario() {
    const sel = document.getElementById('categoriaLancamento');
    const selTipo = document.getElementById('tipoLancamento');
    if (!sel || !selTipo || selTipo.value !== 'entrada') return;
    const dados = obterDados();
    const cat = dados.categorias.find(c => String(c.id) === String(sel.value));
    if (cat && normalizarTexto(cat.nome).includes('adiantamento')) carregarEPreencherAdiantamentoMemorizado();
}

function carregarEPreencherAdiantamentoMemorizado() {
    const inputValor = document.getElementById('valorTotalLancamento') || document.getElementById('valorTotal') || document.getElementById('valorLancamento');
    const inputData = document.getElementById('vencimentoLancamento') || document.getElementById('vencimento');
    const uId = localStorage.getItem('usuarioLogado');
    const chave = `adiantamentoSalario_u${uId}`;
    const salvo = localStorage.getItem(chave);
    if (salvo) {
        try { const obj = JSON.parse(salvo); if (inputValor && obj?.valor != null) inputValor.value = obj.valor; }
        catch { localStorage.removeItem(chave); }
    }
    if (inputData && inputData.value) {
        const p = inputData.value.split('-');
        if (p.length === 3) { p[2] = '15'; inputData.value = p.join('-'); }
    }
}

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
    const d = obterDados();
    popularFiltrosDashboard(d);
    const nomeCat = id => (d.categorias.find(x => String(x.id) === String(id)) || {}).nome || 'Sem categoria';
    const lns = filtrarDadosPorPermissao(d.lancamentos || [], d, esc).filter(l => String(l.vencimento || l.dataCompra || '').startsWith(mes) && (esc === 'todos' || l.tipo === 'entrada' || (l.escopo || 'casal') === esc));
    const reSalario = /salario|adiantamento|plr|decimo terceiro|(^|[^0-9])13(?![0-9])/;
    const reUber = /uber|(^|[^0-9])99(?![0-9])/;
    let tE = 0, tS = 0, tSal = 0, tUb = 0, tEmprestimos = 0, tCart = 0;
    lns.forEach(l => {
        const v = Number(l.valor || 0), c = normalizarTexto(nomeCat(l.categoriaId));
        const contratoEntrada = l.tipo === 'entrada' && (d.financiamentos || []).some(f =>
            String(f.id) === String(l.financiamentoId) && f.tipoContrato === 'emprestimo'
        );
        if (l.tipo === 'entrada') {
            tE += v;
            if (contratoEntrada) tEmprestimos += v;
            else if (reSalario.test(c)) tSal += v;
            else if (reUber.test(c)) tUb += v;
        } else { tS += v; if (l.formaPagamento === 'CARTAO') tCart += v; }
    });

    const priv = document.body.classList.contains('privacidade-ativa');
    const safeHTML = (id, html) => { const e = document.getElementById(id); if (e) e.innerHTML = html; };

    safeHTML('totalEntradas', formatarMoeda(tE)); safeHTML('totalSaidas', formatarMoeda(tS));
    const eS = document.getElementById('saldoGeral'); if (eS) { eS.textContent = formatarMoeda(tE - tS); eS.className = `stat-value saldo-destaque ${tE - tS >= 0 ? 'positivo' : 'negativo'}`; }

    // Modo Discreto: os sub-detalhes (Salário/Cartão/etc.) são informação sensível.
    // Não são apenas mascarados, são completamente removidos quando privacidade está ativa.
    if (priv) {
        safeHTML('subDetalhesEntradas', '');
        safeHTML('subDetalhesSaidas', '');
        safeHTML('maiorFocoDetalhe', '');
        const elFoco = document.getElementById('maiorFocoValor');
        if (elFoco) elFoco.textContent = formatarMoeda(0); // já é 0, mas garante
    } else {
        safeHTML('subDetalhesEntradas', `<strong>Salário:</strong> ${formatarMoeda(tSal)}<br><strong>Uber:</strong> ${formatarMoeda(tUb)}<br><strong>Empréstimos:</strong> ${formatarMoeda(tEmprestimos)}<br><strong>Outros:</strong> ${formatarMoeda(Math.max(0, tE - tSal - tUb - tEmprestimos))}`);
        safeHTML('subDetalhesSaidas', `<strong>Cartão:</strong> ${formatarMoeda(tCart)}<br><strong>Outras:</strong> ${formatarMoeda(Math.max(0, tS - tCart))}`);
        const saidas = lns.filter(l => l.tipo !== 'entrada');
        const topo = somarPor(saidas, l => nomeCat(l.categoriaId))[0];
        safeHTML('maiorFocoValor', formatarMoeda(topo ? topo[1] : 0));
        safeHTML('maiorFocoDetalhe', topo ? `${escaparHTML(topo[0])} — ${Math.round((topo[1] / (tS || 1)) * 100)}% das saídas` : 'Nenhum gasto registrado');
    }

    atualizarGraficosDashboard(tE, tS, d, lns);
    renderizarTabelaUltimosLancamentos(lns, d, nomeCat);
    renderizarCentralLembretes(lns, d, mes);

    if (typeof renderizarSessoesDashboardExtras === 'function') {
        try { renderizarSessoesDashboardExtras(); } catch (e) { console.warn('[Extras Dashboard]', e); }
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

    // [MODO DISCRETO] — injeta placeholder consistente em cada gráfico
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

    draw('entradasSaidas', 'graficoEntradasSaidas', 'pie', ['Entradas', 'Saídas'], [tE, tS], ['#10b981', '#ef4444'], {
        options: clickOpts((evt, els) => {
            let filtro = 'todos';
            if (els && els.length) filtro = els[0].index === 0 ? 'entradas' : 'saidas';
            irParaGrafico(filtro);
        })
    });

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

function renderizarCentralLembretes(lns, dados, mes) {
    const lst = document.getElementById('listaCentralLembretes'), cnt = document.getElementById('contadorLembretes');
    if (!lst) return;

    // [MODO DISCRETO] — oculta os lembretes e o contador de pendências
    if (document.body.classList.contains('privacidade-ativa')) {
        if (cnt) cnt.style.display = 'none';
        lst.innerHTML = `<li style="list-style:none;padding:0;">
            <div class="privacy-section-placeholder" style="padding:26px 18px;margin:6px 0;">
                <div><strong>Lembretes ocultos</strong></div>
                <div style="font-size:0.82rem;font-weight:500;">Toque no banner de privacidade para revelar os compromissos financeiros.</div>
            </div>
        </li>`;
        return;
    }

    const hj = dataLocalYYYYMMDD(), fats = {}, lms = [];
    lns.forEach(l => {
        if (l.tipo !== 'saida') return;
        if (l.formaPagamento === 'CARTAO' && l.cartaoId) {
            const cF = `${l.cartaoId}_${l.vencimento?.slice(0,7) || mes}`;
            if (!fats[cF]) fats[cF] = { cartaoId: l.cartaoId, cartaoNome: (dados.cartoes.find(c => String(c.id) === String(l.cartaoId)) || {}).nome, val: 0, v: l.vencimento, pago: true, m: cF.slice(cF.lastIndexOf('_') + 1) };
            fats[cF].val += Number(l.valor || 0); if (!l.pago) fats[cF].pago = false;
            if (l.vencimento > fats[cF].v) fats[cF].v = l.vencimento;
        } else { lms.push({ id: l.id, desc: l.descricao, val: Number(l.valor || 0), v: l.vencimento, pago: l.pago }); }
    });
    Object.values(fats).forEach(f => lms.push({ cartaoId: f.cartaoId, desc: `Fatura: ${f.cartaoNome}`, val: f.val, v: f.v, pago: f.pago, isFat: true, m: f.m }));
    const fin = lms.filter(x => !x.pago || (x.v && x.v >= hj)).sort((a, b) => (a.v || '9999').localeCompare(b.v || '9999'));
    if (cnt) { const pnd = fin.filter(x => !x.pago).length; cnt.style.display = pnd ? 'inline-flex' : 'none'; cnt.textContent = pnd; }

    lst.innerHTML = fin.length ? fin.map(i => {
        const btnAcao = i.isFat
            ? `<a href="grafico.html?tipo=cartao&cartaoId=${i.cartaoId}&mes=${i.m}" class="btn-acao-icone" title="Gerenciar Fatura" style="display:inline-flex; align-items:center; justify-content:center; text-decoration:none;"><span style="font-size:16px;">💳</span></a>`
            : `<button class="btn-acao-icone ${i.pago ? 'desfazer' : 'pagar'}" onclick="alternarStatusPagamento(${Number(i.id)})"><img src="imagens/${i.pago ? 'desfazer' : 'pagar'}.png" style="width:20px;" alt=""></button>`;

        return `<li style="opacity:${i.pago ? '0.55' : '1'}; border-bottom:1px solid var(--border); display:flex; justify-content:space-between; align-items:center;">
            <div><strong style="${i.pago ? 'text-decoration:line-through;' : ''}">${escaparHTML(i.desc)}</strong><br><small>Venc: ${formatarDataBR(i.v)}</small></div>
            <div style="display:flex; align-items:center; gap:10px;">
                <span class="${i.pago ? 'muted' : 'negativo'}">${formatarMoeda(i.val)}</span>
                ${btnAcao}
            </div>
        </li>`;
    }).join('') : `<li><span class="muted" style="width:100%; text-align:center;">Nada pendente. 🎉</span></li>`;
}

async function toggleFaturaDaCentral(cId, m, p) {
    const fatId = `fat_${cId}_${m}`;
    await alternarStatusFaturaConsolidada(fatId, p);
    if (typeof carregarDashboard === 'function') carregarDashboard();
}

function toggleCentralLembretes() {
    const c = document.getElementById('corpoCentralLembretes'), i = document.getElementById('iconeToggleLembretes');
    if (!c) return;
    const recolhido = c.classList.toggle('recolhido');
    if (i) i.style.transform = recolhido ? 'rotate(-90deg)' : 'rotate(0deg)';
}

function carregarRelatorios() {
    if (typeof window.carregarRelatorioMensal === 'function') return window.carregarRelatorioMensal();
    if (typeof Chart === 'undefined') return;
    const dados = obterDados();
    const mes = document.getElementById('filtroMesAnoRelatorio')?.value || '';
    const servFiltro = document.getElementById('filtroServicoEssencialDashboard')?.value || 'todos';
    const uFiltro = document.getElementById('filtroUsuarioGraficos')?.value || 'todos';
    const periodo = dados.lancamentos.filter(l =>
        (!mes || String(l.vencimento || l.data || l.dataCompra || l.createdAt || '').startsWith(mes)) &&
        (servFiltro === 'todos' || (l.tipo === 'saida' && l.servicoEssencial === servFiltro) || (l.tipo === 'entrada' && servFiltro !== 'sim'))
    );
    const setTxt = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
    let eS = 0, sS = 0, eM = 0, sM = 0;
    periodo.forEach(l => {
        const v = Number(l.valor);
        if (Number(l.usuarioId) === 1) l.tipo === 'entrada' ? eS += v : sS += v;
        else if (Number(l.usuarioId) === 2) l.tipo === 'entrada' ? eM += v : sM += v;
    });
    setTxt('relatorioEntradaSamuel', formatarMoeda(eS));
    setTxt('relatorioSaidaSamuel', formatarMoeda(sS));
    setTxt('relatorioEntradaMariana', formatarMoeda(eM));
    setTxt('relatorioSaidaMariana', formatarMoeda(sM));
    let tE = 0, tS = 0;
    periodo.forEach(l => {
        if (uFiltro !== 'todos' && Number(l.usuarioId) !== Number(uFiltro)) return;
        l.tipo === 'entrada' ? tE += Number(l.valor) : tS += Number(l.valor);
    });
    const cES = document.getElementById('graficoRelatorioEntradasSaidas');
    if (cES) {
        if (charts.relatorioES) charts.relatorioES.destroy();
        charts.relatorioES = new Chart(cES, {
            type: 'pie',
            data: { labels: ['Entradas', 'Saídas'], datasets: [{ data: (tE > 0 || tS > 0) ? [tE, tS] : [1,1], backgroundColor: (tE > 0 || tS > 0) ? ['#10b981', '#ef4444'] : ['#cbd5e1','#cbd5e1'], borderWidth: 1 }] },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 12 } } } }
        });
    }
    const somCat = {};
    periodo.filter(l => l.tipo === 'saida' && (uFiltro === 'todos' || Number(l.usuarioId) === Number(uFiltro)))
        .forEach(l => somCat[l.categoriaId] = (somCat[l.categoriaId] || 0) + Number(l.valor));
    const labelsCat = [], valoresCat = [], cores = ['#3b82f6','#f59e0b','#10b981','#8b5cf6','#ec4899','#06b6d4','#64748b','#ef4444'];
    for (const catId in somCat) {
        const c = dados.categorias.find(x => Number(x.id) === Number(catId));
        labelsCat.push(c ? c.nome : 'Outros'); valoresCat.push(somCat[catId]);
    }
    const cCat = document.getElementById('graficoRelatorioCategorias');
    if (cCat) {
        if (charts.relatorioCat) charts.relatorioCat.destroy();
        charts.relatorioCat = new Chart(cCat, {
            type: 'pie',
            data: { labels: valoresCat.length ? labelsCat : ['Sem gastos'], datasets: [{ data: valoresCat.length ? valoresCat : [1], backgroundColor: valoresCat.length ? cores.slice(0, valoresCat.length) : ['#cbd5e1'], borderWidth: 1 }] },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 12 } } } }
        });
    }
    let ess = 0, naoEss = 0;
    periodo.filter(l => l.tipo === 'saida' && (uFiltro === 'todos' || Number(l.usuarioId) === Number(uFiltro)))
        .forEach(l => l.servicoEssencial === 'sim' ? ess += Number(l.valor) : naoEss += Number(l.valor));
    const cSrv = document.getElementById('graficoServicosEssenciais');
    if (cSrv) {
        if (charts.servicosEssenciaisRel) charts.servicosEssenciaisRel.destroy();
        charts.servicosEssenciaisRel = new Chart(cSrv, {
            type: 'pie',
            data: { labels: ['Essenciais', 'Não Essenciais'], datasets: [{ data: (ess > 0 || naoEss > 0) ? [ess, naoEss] : [1], backgroundColor: (ess > 0 || naoEss > 0) ? ['#10b981', '#f59e0b'] : ['#cbd5e1'], borderWidth: 1 }] },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 12 } } } }
        });
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

function abrirDetalhamentoFatura(cartaoId, anoMes) {
    const dados = obterDados();
    const cartao = dados.cartoes.find(c => Number(c.id) === Number(cartaoId));
    const nomeCartao = cartao ? cartao.nome : 'Cartão';
    const itens = dados.lancamentos.filter(l => Number(l.cartaoId) === Number(cartaoId) && l.vencimento && l.vencimento.startsWith(anoMes));
    let linhas = '';
    if (!itens.length) linhas = `<tr><td colspan="4" style="text-align:center;">Nenhuma compra encontrada.</td></tr>`;
    else itens.forEach(it => {
        const parc = Number(it.totalParcelas) > 1 ? `${escaparHTML(it.parcelaAtual)}/${escaparHTML(it.totalParcelas)}` : 'À vista';
        linhas += `<tr><td>${escaparHTML(it.descricao || '-')}</td><td style="text-align:center;">${parc}</td><td style="text-align:right;">${escaparHTML(formatarMoeda(it.valor))}</td><td style="text-align:center;">${escaparHTML(formatarDataBR(it.vencimento))}</td></tr>`;
    });
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `<div class="modal-box" style="max-width:800px;width:95%;"><h3>Detalhamento da Fatura: ${escaparHTML(nomeCartao)}</h3><p style="margin-bottom:14px;font-size:.9rem;">Competência: ${escaparHTML(anoMes)}</p><div class="tabela-container" style="max-height:400px;overflow-y:auto;margin-bottom:20px;"><table class="tabela" style="width:100%;"><thead><tr><th>Descrição</th><th style="text-align:center;width:100px;">Parcela</th><th style="text-align:right;width:120px;">Valor</th><th style="text-align:center;width:140px;">Vencimento</th></tr></thead><tbody>${linhas}</tbody></table></div><button onclick="this.closest('.modal-overlay').remove()" style="width:100%;background-color:var(--primary);">Fechar</button></div>`;
    document.body.appendChild(overlay);
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
    const naoLidas = (d.notificacoes || []).filter(n => String(n.usuarioDestinoId) === String(uId) && !n.lida);
    let badge = btn.querySelector('.badge-notificacao');
    if (naoLidas.length > 0) {
        if (!badge) {
            badge = document.createElement('span');
            badge.className = 'badge-notificacao';
            badge.style.cssText = 'position:absolute;top:-4px;right:-4px;background:var(--danger,#ef4444);color:white;border-radius:50%;padding:2px 5px;font-size:.65rem;font-weight:bold;min-width:16px;text-align:center;';
            btn.appendChild(badge);
        }
        badge.textContent = naoLidas.length > 9 ? '9+' : naoLidas.length;
    } else if (badge) badge.remove();
}

async function abrirModalNotificacoes() {
    const dados = obterDados();
    const usuarioId = obterUsuarioAtualId();
    const notificacoes = (dados.notificacoes || []).filter(n => String(n.usuarioDestinoId) === String(usuarioId));
    const haviaNaoLidas = notificacoes.some(n => !n.lida);
    if (haviaNaoLidas) {
        notificacoes.forEach(n => { n.lida = true; });
        await salvarDados(dados);
    }
    let itensHtml = '';
    if (notificacoes.length === 0) {
        itensHtml = `<p style="text-align:center;color:var(--text-muted);padding:20px;">Nenhuma notificação no momento.</p>`;
    } else {
        notificacoes.reverse().forEach(n => {
            let acoesHtml = '';
            if (n.tipo === 'solicitacao_parceiro' && n.statusAprovacao === 'pendente') {
                const idSeguro = String(n.id == null ? '' : n.id).replace(/[^a-zA-Z0-9_-]/g, '');
                acoesHtml = idSeguro ? `
                    <div style="margin-top:8px; display:flex; gap:8px;">
                        <button onclick="responderSolicitacaoParceiro('${idSeguro}', true)" style="background: var(--success); padding:6px 12px; font-size:.8rem;">Aprovar</button>
                        <button onclick="responderSolicitacaoParceiro('${idSeguro}', false)" style="background: var(--danger); padding:6px 12px; font-size:.8rem;">Negar</button>
                    </div>
                ` : '';
            } else if (n.statusAprovacao && n.statusAprovacao !== 'pendente') {
                acoesHtml = `<p style="font-size:.78rem; font-weight:bold; margin-top:4px; color:${n.statusAprovacao === 'aprovado' ? 'var(--success)' : 'var(--danger)'};">Status: ${n.statusAprovacao.toUpperCase()}</p>`;
            }
            itensHtml += `
                <div style="background: var(--surface-2); padding:12px; border-radius:8px; margin-bottom:8px; text-align:left; border-left:4px solid var(--primary);">
                    <strong style="font-size:.9rem; color:var(--text-main);">${escaparHTML(n.titulo || '')}</strong>
                    <p style="font-size:.85rem; margin-top:4px; color:var(--text-muted);">${escaparHTML(n.mensagem || '')}</p>
                    <small style="font-size:.7rem; color:var(--text-muted);">${n.createdAt ? escaparHTML(formatarDataSemHora(n.createdAt)) : ''}</small>
                    ${acoesHtml}
                </div>
            `;
        });
    }
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
        <div class="modal-box" style="max-width:500px; width:95%;">
            <h3>Central de Notificações</h3>
            <div style="max-height:350px; overflow-y:auto; margin:16px 0; padding-right:4px;">${itensHtml}</div>
            <button type="button" data-fechar-notif style="width:100%; background-color:var(--primary);">Fechar</button>
        </div>
    `;
    document.body.appendChild(overlay);

    const fechar = () => { overlay.remove(); renderizarSinoNotificacoes(); };
    overlay.querySelector('[data-fechar-notif]').onclick = fechar;
    overlay.addEventListener('click', e => { if (e.target === overlay) fechar(); });
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

function criarNotificacao(usuarioDestinoId, titulo, mensagem, tipo = 'info') {
    const d = obterDados();
    if (!Array.isArray(d.notificacoes)) d.notificacoes = [];
    d.notificacoes.push({
        id: gerarId('notif'),
        usuarioDestinoId: String(usuarioDestinoId),
        remetenteId: Number(obterUsuarioAtualId()),
        tipo, titulo, mensagem,
        lida: false,
        statusAprovacao: '',
        createdAt: new Date().toISOString()
    });
    salvarDados(d);
    renderizarSinoNotificacoes();
}

// Um aviso por conta/vencimento: a chave estável evita duplicações ao navegar.
// Funciona localmente e a sincronização existente o propaga para outros dispositivos.
function gerarLembretesVencimento() {
    const dados = obterDados();
    const uId = obterUsuarioAtualId();
    const usuario = (dados.usuarios || []).find(u => String(u.id) === String(uId));
    const preferencias = usuario?.preferenciasNotificacao || {};
    if (!usuario || preferencias.ativo === false || usuario.trocaSenhaObrigatoria) return 0;
    const dias = Math.max(1, Math.min(15, Number(preferencias.diasAntecedencia) || 3));
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
        if (diferenca < 0 || diferenca > dias) return;
        const id = `alerta_vencimento_${uId}_${String(l.id).replace(/[^a-zA-Z0-9_-]/g, '_')}_${vencimento.replace(/-/g, '')}`;
        if (ids.has(id)) return;
        ids.add(id);
        const descricao = String(l.descricao || 'Conta').slice(0, 120);
        dados.notificacoes.push({
            id, usuarioDestinoId: uId, remetenteId: uId, tipo: 'alerta_vencimento',
            titulo: diferenca === 0 ? 'Conta vence hoje' : 'Conta próxima do vencimento',
            mensagem: `${descricao} · ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(numeroSeguro(l.valor))} · ${formatarDataBR(vencimento)}`,
            lida: false, statusAprovacao: '', createdAt: new Date().toISOString()
        });
        criados++;
    });
    if (criados) {
        salvarDados(dados).catch(erro => console.warn('Não foi possível guardar lembretes:', erro));
        renderizarSinoNotificacoes();
    }
    return criados;
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
        const req = await fetch(`${API_URL}?action=statusCadastro&token=${encodeURIComponent(TOKEN_API)}`, { cache: 'no-store' });
        const situacao = await req.json();
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
            const resposta = await fetch(API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify({ action: 'registrarPrimeiroUsuario', token: TOKEN_API, usuario, nome, senhaHash: hashSenha, senhaAdmin })
            });
            if (!resposta.ok) throw new Error('Servidor indisponível para salvar o cadastro.');
            const resultado = await resposta.json();
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
