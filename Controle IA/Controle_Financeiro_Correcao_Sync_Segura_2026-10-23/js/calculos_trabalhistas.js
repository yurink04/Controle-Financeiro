// Controle Financeiro — cálculo salarial, classificação de rendimentos e editor.
// Depende das utilidades e dos serviços globais de script.js e conexao_sheets.js.

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
    const regimeRenda = ['clt', 'pj', 'aposentado'].includes(c.regimeRenda) ? c.regimeRenda : 'clt';
    return {
        regimeRenda,
        utilizaAdiantamento: regimeRenda === 'clt' && c.utilizaAdiantamento !== false,
        aposentado65Mais: regimeRenda === 'aposentado' && c.aposentado65Mais === true,
        horasExtrasPrevistas: regimeRenda === 'clt' ? Math.max(0, centavosRenda(c.horasExtrasPrevistas)) : 0,
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
function calcularIRRFSalario2026(remuneracaoBruta, inss, dependentes = 0, isencaoAposentadoria = 0) {
    const brutoOriginal = Math.max(0, Number(remuneracaoBruta) || 0);
    const bruto = Math.max(0, centavosRenda(brutoOriginal - Math.max(0, isencaoAposentadoria)));
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
function calcularSalarioLiquido(brutoInformado, configuracao, extraBrutaInformada = null) {
    const conf = normalizarConfiguracaoSalarial(configuracao);
    const extraBruta = conf.regimeRenda === 'clt'
        ? Math.max(0, centavosRenda(extraBrutaInformada == null ? conf.horasExtrasPrevistas : extraBrutaInformada)) : 0;
    const bruto = Math.max(0, centavosRenda(brutoInformado)) + extraBruta;
    const brutoTotal = centavosRenda(bruto);
    const inss = conf.regimeRenda === 'clt' ? calcularINSSSalario2026(brutoTotal)
        : { valor: 0, base: 0, faixas: [], naoAplicavel: true };
    const isencaoAposentadoria = conf.aposentado65Mais ? Math.min(brutoTotal, 1903.98) : 0;
    const irrf = conf.regimeRenda !== 'pj' && conf.irrfAtivo
        ? calcularIRRFSalario2026(brutoTotal, inss.valor, conf.dependentes, isencaoAposentadoria)
        : { valor: 0, base: 0, impostoTabela: 0, reducao: 0, desativado: true };
    const vtMaximo = centavosRenda(Math.max(0, centavosRenda(brutoInformado)) * .06);
    const valeTransporte = conf.regimeRenda === 'clt' && conf.vtAtivo
        ? centavosRenda(conf.vtCustoMensal > 0 ? Math.min(vtMaximo, conf.vtCustoMensal) : vtMaximo) : 0;
    const descontos = conf.descontos.map(d => ({
        ...d, calculado: centavosRenda(d.tipo === 'percentual' ? brutoTotal * d.valor / 100 : d.valor)
    }));
    const outrosDescontos = centavosRenda(descontos.reduce((acc, d) => acc + d.calculado, 0));
    const totalDescontos = centavosRenda(inss.valor + irrf.valor + valeTransporte + outrosDescontos);
    return {
        bruto: brutoTotal, brutoBase: centavosRenda(brutoInformado), extraBruta,
        regimeRenda: conf.regimeRenda, isencaoAposentadoria,
        inss, irrf, valeTransporte, vtMaximo, descontos, outrosDescontos, totalDescontos,
        liquido: Math.max(0, centavosRenda(brutoTotal - totalDescontos)),
        descontosExcedemBruto: totalDescontos > brutoTotal, referencia: REFERENCIA_CALCULO_SALARIAL
    };
}
function categoriaRemuneracaoRestrita(nome) {
    const n = normalizarTexto(nome || '');
    if (/(^|\s)adiantamento(?:\s+(?:de|do))?\s+salario|antecipacao\s+salario/.test(n)) return 'adiantamento';
    if (/(^|\s)(?:decimo\s+terceiro|13\s*[º°o]?\s*salario)/.test(n)) return 'decimo';
    if (/(^|\s)ferias(?:\s|$)/.test(n)) return 'ferias';
    if (/(^|\s)plr(?:\s|$)|participacao nos lucros/.test(n)) return 'plr';
    return '';
}
function categoriaRendaDisponivel(categoria, usuario) {
    if (!categoria || categoria.tipo !== 'entrada') return true;
    const conf = normalizarConfiguracaoSalarial(usuario?.configuracaoSalarial);
    const restricao = categoriaRemuneracaoRestrita(categoria.nome);
    if (conf.regimeRenda === 'pj') return !restricao;
    if (conf.regimeRenda === 'aposentado') return !['adiantamento', 'ferias', 'plr'].includes(restricao);
    return restricao !== 'adiantamento' || conf.utilizaAdiantamento;
}
function validarRendaPorRegime(lancamento, dados, usuario) {
    if (lancamento.tipo !== 'entrada') return true;
    const cat = (dados.categorias || []).find(c => String(c.id) === String(lancamento.categoriaId));
    if (!categoriaRendaDisponivel(cat, usuario)) return false;
    const conf = normalizarConfiguracaoSalarial(usuario?.configuracaoSalarial);
    const manual = lancamento.naturezaRenda || '';
    return !(manual === 'adiantamento' && (conf.regimeRenda !== 'clt' || !conf.utilizaAdiantamento)) &&
        !(manual === 'salarial_extra' && conf.regimeRenda === 'pj');
}
function atualizarOpcoesNaturezaRenda(select, usuario = obterUsuarioAtual(), naturezaHistorica = '') {
    if (!select) return;
    const conf = normalizarConfiguracaoSalarial(usuario?.configuracaoSalarial);
    for (const opt of select.options) {
        const desabilitada = (opt.value === 'adiantamento' &&
            (conf.regimeRenda !== 'clt' || !conf.utilizaAdiantamento)) ||
            (opt.value === 'salarial_extra' && conf.regimeRenda === 'pj');
        const legado = desabilitada && opt.value === naturezaHistorica;
        opt.disabled = desabilitada && !legado;
        opt.hidden = desabilitada && !legado;
        if (opt.value === 'folha') opt.textContent = conf.regimeRenda === 'clt' ? 'Folha de pagamento / salário'
            : conf.regimeRenda === 'pj' ? 'Recebimento principal PJ' : 'Aposentadoria / pensão mensal';
        if (opt.value === 'salarial_extra' && conf.regimeRenda === 'aposentado') opt.textContent = '13º da aposentadoria';
    }
    if (select.selectedOptions[0]?.disabled) select.value = '';
}

function atualizarFiltroCategoriasPorTipo(tipo) {
    const sel = document.getElementById('categoriaLancamento');
    if (!sel) return;
    const dados = obterDados();
    const usuario = obterUsuarioAtual(dados);
    const valorAtual = sel.value;
    const categorias = (dados.categorias || [])
        .filter(c => c.tipo === tipo && categoriaRendaDisponivel(c, usuario))
        .sort((a, b) => normalizarTexto(a.nome).localeCompare(normalizarTexto(b.nome), 'pt-BR'));

    sel.replaceChildren();
    if (!categorias.length) {
        sel.appendChild(new Option('Nenhuma categoria deste tipo cadastrada', ''));
        sel.disabled = true;
        return;
    }
    sel.disabled = false;
    categorias.forEach(c => sel.appendChild(new Option(c.nome, String(c.id))));
    if ([...sel.options].some(o => o.value === valorAtual)) sel.value = valorAtual;
}

function classificarEntradaRendimento(lancamento, dados) {
    if (!lancamento || lancamento.tipo !== 'entrada') return 'fora';
    const contrato = (dados.financiamentos || []).find(f => String(f.id) === String(lancamento.financiamentoId));
    if (contrato && ['emprestimo', 'consignado', 'financiamento'].includes(normalizarTexto(contrato.tipoContrato))) return 'nao_renda';
    const cat = (dados.categorias || []).find(c => String(c.id) === String(lancamento.categoriaId));
    const categoria = normalizarTexto(cat?.nome);
    const descricao = normalizarTexto(lancamento.descricao);
    if (/emprestimo|financiamento|consignado|transferencia|estorno|reembolso|resgate/.test(categoria)) return 'nao_renda';
    const rubrica = categoriaRemuneracaoRestrita(cat?.nome);
    if (rubrica === 'adiantamento' || /adiantamento.*salario|antecipacao.*salario/.test(descricao)) return 'adiantamento';
    if (['decimo', 'ferias', 'plr'].includes(rubrica) ||
        /ferias|decimo|13\s*[º°o]?\s*salario|participacao.*lucro|\bplr\b/.test(descricao)) return 'salarial_extra';
    if (/^(salario|folha de pagamento|salario mensal)$/.test(categoria)) return 'folha';
    const manual = String(lancamento.naturezaRenda || '');
    if (['folha', 'adiantamento', 'salarial_extra', 'variavel', 'nao_renda'].includes(manual)) return manual;
    const texto = categoria + ' ' + descricao;
    if (/adiantamento|antecipacao.*salario|vale.*salario/.test(texto)) return 'adiantamento';
    if (/ferias|decimo|13\s*[º°o]?\s*salario|participacao.*lucro|\bplr\b/.test(texto)) return 'salarial_extra';
    if (/salario|folha de pagamento|pagamento de folha/.test(texto)) return 'folha';
    if (/emprestimo|transferencia|estorno|reembolso|resgate/.test(descricao)) return 'nao_renda';
    return 'variavel';
}

function obterMesRendimento(lancamento) {
    const competencia = String(lancamento.competenciaRenda || '');
    return /^\d{4}-(0[1-9]|1[0-2])$/.test(competencia) ? competencia
        : String(lancamento.dataPagamento || lancamento.vencimento || lancamento.dataCompra || lancamento.createdAt || '').slice(0, 7);
}

function consolidarRendimentosUsuario(dados, usuarioId, referencia = new Date()) {
    const mensal = new Map();
    const registros = [];
    const usuario = (dados.usuarios || []).find(u => String(u.id) === String(usuarioId)) || {};
    const conf = normalizarConfiguracaoSalarial(usuario.configuracaoSalarial);
    for (const l of (dados.lancamentos || [])) {
        if (String(l.usuarioId) !== String(usuarioId) || l.tipo !== 'entrada') continue;
        if (l.pago !== true && l.status !== 'pago') continue;
        const classe = classificarEntradaRendimento(l, dados);
        if (classe === 'fora' || classe === 'nao_renda') continue;
        const mes = obterMesRendimento(l);
        if (!/^\d{4}-\d{2}$/.test(mes)) continue;
        const valor = Math.max(0, centavosRenda(l.valor));
        const horaExtra = classe === 'folha' ? Math.min(valor, Math.max(0, centavosRenda(l.horaExtra))) : 0;
        const extraBruta = classe === 'folha' ? Math.max(0, centavosRenda(l.horaExtraBruta)) : 0;
        const brutoRegistrado = classe === 'folha' ? Math.max(0, centavosRenda(l.remuneracaoBruta)) : 0;
        const brutoExtra = classe === 'salarial_extra' ? Math.max(0, centavosRenda(l.remuneracaoBruta)) : 0;
        if (!mensal.has(mes)) mensal.set(mes, {
            mes, folha: 0, adiantamento: 0, salarial_extra: 0, variavel: 0, horasExtras: 0,
            horasExtrasBrutas: 0, brutoInformado: 0, brutoExtrasInformado: 0,
            extrasSemBruto: 0, total: 0, quantidade: 0
        });
        const grupo = mensal.get(mes);
        grupo[classe] = centavosRenda(grupo[classe] + valor);
        grupo.horasExtras = centavosRenda(grupo.horasExtras + horaExtra);
        grupo.horasExtrasBrutas = centavosRenda(grupo.horasExtrasBrutas + extraBruta);
        grupo.brutoInformado = centavosRenda(grupo.brutoInformado + brutoRegistrado);
        grupo.brutoExtrasInformado = centavosRenda(grupo.brutoExtrasInformado + brutoExtra);
        if (classe === 'salarial_extra' && !brutoExtra) grupo.extrasSemBruto++;
        grupo.total = centavosRenda(grupo.total + valor);
        grupo.quantidade++;
        registros.push({ ...l, classeRenda: classe, mesRenda: mes, valor,
            horasExtrasIncluidas: horaExtra, horasExtrasBrutas: extraBruta });
    }
    for (const grupo of mensal.values()) {
        grupo.totalClt = centavosRenda(grupo.folha + grupo.adiantamento + grupo.salarial_extra);
        grupo.totalPrincipal = centavosRenda(grupo.folha + grupo.adiantamento);
        const base = grupo.brutoInformado > 0 ? grupo.brutoInformado : Number(usuario.rendaFixa || 0);
        grupo.calculoFolha = calcularSalarioLiquido(base, conf,
            grupo.brutoInformado > 0 ? 0 : grupo.horasExtrasBrutas);
        grupo.diferencaProjecao = centavosRenda(grupo.totalPrincipal - grupo.calculoFolha.liquido);
        grupo.brutoEstimado = grupo.calculoFolha.bruto;
        grupo.descontosEfetivos = grupo.brutoInformado > 0 && grupo.folha > 0
            ? centavosRenda(grupo.brutoInformado - grupo.totalPrincipal) : null;
        grupo.descontosExtrasEfetivos = grupo.brutoExtrasInformado > 0 && grupo.extrasSemBruto === 0
            ? centavosRenda(grupo.brutoExtrasInformado - grupo.salarial_extra) : null;
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
                <div><span class="income-eyebrow">PERFIL DE RENDA</span><h3 id="salarioModalTitulo">Configure seus rendimentos</h3>
                    <p>Escolha seu vínculo e informe a remuneração bruta habitual. O cálculo muda conforme o regime.</p></div>
                <button type="button" class="salary-close-btn" aria-label="Fechar edição">×</button>
            </div>
            <div class="form-group"><label for="regimeRendaEditor">Como você recebe sua renda principal?</label>
                <select id="regimeRendaEditor">
                    <option value="clt">CLT · empregado com carteira assinada</option>
                    <option value="pj">PJ · prestador de serviços / empresa</option>
                    <option value="aposentado">Aposentadoria / pensão</option>
                </select></div>
            <div class="salary-modal-grid">
                <div class="form-group"><label for="salarioBrutoEditor" id="labelSalarioEditor">Remuneração bruta mensal habitual (R$)</label>
                    <input type="number" step="0.01" min="0" max="10000000" id="salarioBrutoEditor" value="${Number(usuario.rendaFixa || 0)}"></div>
                <div class="form-group" data-regimes="clt aposentado"><label for="dependentesSalarioEditor">Dependentes para IRRF</label>
                    <input type="number" min="0" max="20" step="1" id="dependentesSalarioEditor" value="${conf.dependentes}"></div>
            </div>
            <div class="salary-modal-options">
                <label class="salary-option" data-regimes="clt"><input type="checkbox" id="adiantamentoSalarioEditor" ${conf.utilizaAdiantamento ? 'checked' : ''}><span><strong>Recebo adiantamento de salário</strong><small>Habilita a categoria de adiantamento nos lançamentos.</small></span></label>
                <div class="form-group" data-regimes="clt"><label for="horasExtrasPrevistasEditor">Horas extras brutas previstas por mês (R$, opcional)</label><input type="number" min="0" step="0.01" id="horasExtrasPrevistasEditor" value="${conf.horasExtrasPrevistas || 0}"></div>
                <label class="salary-option" data-regimes="clt aposentado"><input type="checkbox" id="irrfSalarioEditor" ${conf.irrfAtivo ? 'checked' : ''}><span><strong>Estimar IRRF, quando aplicável</strong><small>Usa a tabela progressiva e a redução mensal de 2026.</small></span></label>
                <label class="salary-option" data-regimes="aposentado"><input type="checkbox" id="aposentado65Editor" ${conf.aposentado65Mais ? 'checked' : ''}><span><strong>Tenho 65 anos ou mais</strong><small>Considerar parcela mensal isenta dos proventos, quando elegível.</small></span></label>
                <label class="salary-option" data-regimes="clt"><input type="checkbox" id="vtSalarioEditor" ${conf.vtAtivo ? 'checked' : ''}><span><strong>Utilizo vale-transporte</strong><small>Até 6% do salário básico; o desconto real pode ser menor.</small></span></label>
                <div class="form-group salary-vt-cost" data-regimes="clt"><label for="vtCustoEditor">Custo mensal do transporte (R$, opcional)</label><input type="number" min="0" step="0.01" max="1000000" id="vtCustoEditor" value="${conf.vtCustoMensal || ''}" placeholder="Se vazio, estima 6%"></div>
            </div>
            <div class="salary-deductions-head"><div><strong>Descontos personalizados</strong><p>Valores fixos ou percentuais. Para PJ, informe aqui os tributos, custos e retenções que conhece.</p></div>
                <button type="button" class="btn-secundario" id="adicionarDescontoSalario">+ Adicionar</button></div>
            <div id="listaDescontosSalario" class="salary-deductions-list"></div>
            <div id="previaSalarioLiquido" class="salary-preview" aria-live="polite"></div>
            <p id="avisoRegimeEditor" class="salary-disclaimer"></p>
            <div class="salary-modal-actions"><span class="salary-editor-feedback" id="feedbackEditorSalario" role="status"></span>
                <button type="button" class="btn-secundario" id="cancelarEditorSalario">Cancelar</button>
                <button type="button" id="salvarEditorSalario">Salvar configuração</button>
            </div>
        </div>`;
    document.body.appendChild(modal);
    const campo = id => modal.querySelector('#' + id);
    const areaDescontos = campo('listaDescontosSalario');
    const salvar = campo('salvarEditorSalario');
    campo('regimeRendaEditor').value = conf.regimeRenda;
    function atualizarCamposRegime() {
        const regime = campo('regimeRendaEditor').value;
        modal.querySelectorAll('[data-regimes]').forEach(el => {
            el.hidden = !el.dataset.regimes.split(' ').includes(regime);
        });
        campo('labelSalarioEditor').textContent = regime === 'clt' ? 'Salário-base bruto (sem horas extras) (R$)'
            : regime === 'pj' ? 'Receita mensal bruta de serviços (R$)' : 'Benefício bruto mensal (R$)';
        campo('avisoRegimeEditor').textContent = regime === 'clt'
            ? 'CLT: estimamos INSS e IRRF sobre salário-base + horas extras brutas. 13º, férias e PLR possuem apurações próprias e não integram automaticamente a base mensal.'
            : regime === 'pj' ? 'PJ: não aplicamos descontos de CLT. Informe manualmente custos, impostos e pró-labore conforme seu regime tributário; isto não substitui cálculo contábil.'
            : 'Aposentadoria: não descontamos contribuição previdenciária de empregado. Estimamos IRRF, considerando a isenção adicional após 65 anos quando marcada; confira o informe da fonte pagadora.';
    }
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
        const regimeRenda = campo('regimeRendaEditor').value;
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
        const extrasPrevistas = Number(campo('horasExtrasPrevistasEditor').value || 0);
        if (!Number.isFinite(vtCusto) || vtCusto < 0 || vtCusto > 1000000) throw new Error('Custo de transporte inválido.');
        if (!Number.isFinite(extrasPrevistas) || extrasPrevistas < 0 || extrasPrevistas > 10000000) throw new Error('Horas extras previstas inválidas.');
        return {
            bruto, configuracao: {
                regimeRenda, utilizaAdiantamento: campo('adiantamentoSalarioEditor').checked,
                aposentado65Mais: campo('aposentado65Editor').checked,
                horasExtrasPrevistas: extrasPrevistas,
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
                <div><span>Renda-base bruta</span><strong>${formatarMoeda(c.brutoBase)}</strong></div>
                ${c.extraBruta ? `<div><span>Horas extras brutas</span><strong>+ ${formatarMoeda(c.extraBruta)}</strong></div>` : ''}
                <div><span>Total bruto estimado</span><strong>${formatarMoeda(c.bruto)}</strong></div>
                ${c.regimeRenda === 'clt' ? `<div><span>INSS (faixas progressivas)</span><strong>− ${formatarMoeda(c.inss.valor)}</strong></div>` : ''}
                ${c.regimeRenda !== 'pj' ? `<div><span>IRRF estimado</span><strong>− ${formatarMoeda(c.irrf.valor)}</strong></div>` : ''}
                ${c.isencaoAposentadoria ? `<div><span>Parcela isenta 65+ (base de IRRF)</span><strong>${formatarMoeda(c.isencaoAposentadoria)}</strong></div>` : ''}
                ${c.regimeRenda === 'clt' ? `<div><span>Vale-transporte</span><strong>− ${formatarMoeda(c.valeTransporte)}</strong></div>` : ''}
                <div><span>Outros descontos</span><strong>− ${formatarMoeda(c.outrosDescontos)}</strong></div>
                <div class="salary-preview-total"><span>Renda disponível estimada</span><strong>${formatarMoeda(c.liquido)}</strong></div>
                ${c.descontosExcedemBruto ? '<p>Os descontos ultrapassaram o salário bruto. Revise os valores.</p>' : ''}`;
            campo('feedbackEditorSalario').textContent = '';
        } catch (e) {
            area.replaceChildren();
            campo('feedbackEditorSalario').textContent = e.message;
        }
    }
    conf.descontos.forEach(adicionarLinha);
    atualizarCamposRegime();
    campo('regimeRendaEditor').addEventListener('change', atualizarCamposRegime);
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
