// Controle Financeiro | Página: lancamentos.html
// Arquivo extraído dos scripts embutidos no HTML original.
// Carregar APÓS js/script.js, js/calculos_trabalhistas.js e js/conexao_sheets.js.
// Mantém funções globais clássicas usadas por elementos gerados dinamicamente.

// ===== Bloco inline original 1 =====
        const wizardState = { step: 1, intent: null, saving: false, avancoPendente: null };

        function mensagemWizard(texto, estado = 'error', campo = null) {
            const aviso = document.getElementById('wizardFeedback');
            aviso.textContent = texto;
            aviso.dataset.state = estado;
            aviso.hidden = false;
            if (campo) document.getElementById(campo)?.focus();
        }

        function limparMensagemWizard() {
            const aviso = document.getElementById('wizardFeedback');
            aviso.hidden = true;
            aviso.textContent = '';
        }

        function obterPeriodoLote() {
            const inicio = criarDataLocal(document.getElementById('primeiroVencimentoLote').value);
            const fim = criarDataLocal(document.getElementById('ultimoVencimentoLote').value);
            const diferencaMeses = inicio && fim
                ? (fim.getFullYear() - inicio.getFullYear()) * 12 + fim.getMonth() - inicio.getMonth() : -1;
            const quantidade = diferencaMeses >= 0 ? diferencaMeses + 1 : 0;
            const forma = document.getElementById('formaPagamentoLote').value;
            const cartaoId = forma === 'CARTAO' ? document.getElementById('cartaoLote').value : null;
            return { inicio, fim, quantidade, forma, cartaoId };
        }

        document.addEventListener('DOMContentLoaded', async () => {
            injetarHeader();
            const autenticado = await verificarAutenticacao();
            if (!autenticado) return;

            popularSelectsBens();
            popularSelectsCartoesLote();

            const hojeStr = dataLocalYYYYMMDD();
            document.getElementById('competenciaRendaLancamento').value = hojeStr.slice(0, 7);
            ['vencimentoLancamento', 'dataCompraCartao'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.value = hojeStr;
            });
            const el1 = document.getElementById('primeiroVencimentoLote');
            if (el1) el1.value = hojeStr;
            const el2 = document.getElementById('ultimoVencimentoLote');
            if (el2) el2.value = hojeStr;
            tratarMudancaFormaLote();

            const params = new URLSearchParams(window.location.search);
            const qsTipo = params.get('tipo');
            const qsForma = params.get('forma');
            const qsCartaoId = params.get('cartaoId');
            if (qsTipo || qsForma) {
                let intent = 'saida';
                if (qsTipo === 'entrada') intent = 'entrada';
                else if (qsForma === 'CARTAO') intent = 'cartao';
                else if (qsForma === 'FIXO') intent = 'fixo';
                else if (qsForma === 'LOTE' || qsTipo === 'lote') intent = 'lote';
                setTimeout(() => {
                    escolherIntent(intent);
                    if (qsCartaoId) {
                        const sel = document.getElementById('cartaoLancamento');
                        if (sel) sel.value = qsCartaoId;
                    }
                }, 100);
            }
        });

        function atualizarWizard() {
            document.querySelectorAll('.wizard-step-content').forEach(c => {
                c.classList.toggle('active', Number(c.dataset.step) === wizardState.step);
            });
            document.querySelectorAll('.wizard-step').forEach(s => {
                const n = Number(s.dataset.step);
                s.classList.toggle('active', n === wizardState.step);
                s.classList.toggle('done', n < wizardState.step);
            });
            document.getElementById('wizardProgressFill').style.width = `${((wizardState.step - 1) / 3) * 100}%`;
            const voltar = document.getElementById('btnVoltarWizard');
            voltar.style.visibility = wizardState.step === 1 ? 'hidden' : 'visible';
            document.getElementById('btnProximoWizard').style.display = wizardState.step === 4 ? 'none' : 'inline-block';
            document.getElementById('btnSalvarWizard').style.display = wizardState.step === 4 ? 'inline-block' : 'none';
            document.getElementById('btnSalvarWizard').textContent = wizardState.intent === 'lote' ? '✓ Gerar contas em lote' : '✓ Salvar lançamento';
        }

        function proximaEtapa() {
            if (wizardState.saving) return;
            if (!validarEtapa(wizardState.step)) return;
            limparMensagemWizard();
            if (wizardState.step === 3) renderizarResumoFinal();
            wizardState.step = Math.min(4, wizardState.step + 1);
            atualizarWizard();
        }

        function etapaAnterior() {
            if (wizardState.saving) return;
            limparMensagemWizard();
            wizardState.step = Math.max(1, wizardState.step - 1);
            atualizarWizard();
        }

        function validarEtapa(step) {
            if (step === 1) {
                if (!wizardState.intent) {
                    mensagemWizard('Escolha o tipo de lançamento antes de continuar.');
                    return false;
                }
                return true;
            }
            if (step === 2) {
                const desc = document.getElementById('descricaoLancamento').value.trim();
                const cat = document.getElementById('categoriaLancamento').value;
                const val = numeroSeguro(document.getElementById('valorTotalLancamento').value);
                if (!desc || !cat || val <= 0) {
                    mensagemWizard('Preencha descrição, categoria e um valor maior que zero.', 'error', !cat ? 'categoriaLancamento' : !desc ? 'descricaoLancamento' : 'valorTotalLancamento');
                    return false;
                }
                if (wizardState.intent === 'entrada' && document.getElementById('blocoHoraExtra').style.display !== 'none') {
                    const extra = Number(document.getElementById('valorHoraExtra').value || 0);
                    if (!Number.isFinite(extra) || extra < 0 || extra > val) {
                        mensagemWizard('Hora extra deve estar entre zero e o valor total já recebido.', 'error', 'valorHoraExtra');
                        return false;
                    }
                }
                if (wizardState.intent === 'lote') {
                    const periodo = obterPeriodoLote();
                    if (!periodo.inicio || !periodo.fim) {
                        mensagemWizard('Informe a primeira data e o último mês do lote.', 'error', !periodo.inicio ? 'primeiroVencimentoLote' : 'ultimoVencimentoLote');
                        return false;
                    }
                    if (periodo.quantidade === 0) {
                        mensagemWizard('O último mês não pode ser anterior ao primeiro vencimento.', 'error', 'ultimoVencimentoLote');
                        return false;
                    }
                    if (periodo.quantidade < 1 || periodo.quantidade > 120) {
                        mensagemWizard('O período precisa ter entre 1 e 120 meses.', 'error', 'ultimoVencimentoLote');
                        return false;
                    }
                    if (periodo.forma === 'CARTAO') {
                        const usuarioId = Number(obterUsuarioAtualId());
                        const cartao = (obterDados().cartoes || []).find(c => String(c.id) === String(periodo.cartaoId) && c.ativo !== false && !c.isBeneficio && Number(c.usuarioId) === usuarioId);
                        if (!cartao) {
                            mensagemWizard('Selecione um cartão de crédito ativo.', 'error', 'cartaoLote');
                            return false;
                        }
                    }
                    return true;
                }
                if (wizardState.intent === 'cartao') {
                    const cart = document.getElementById('cartaoLancamento').value;
                    const data = document.getElementById('dataCompraCartao').value;
                    if (!cart) { mensagemWizard('Selecione um cartão.', 'error', 'cartaoLancamento'); return false; }
                    if (!data) { mensagemWizard('Informe a data da compra.', 'error', 'dataCompraCartao'); return false; }
                } else {
                    if (!document.getElementById('vencimentoLancamento').value) {
                        mensagemWizard('Informe a data.', 'error', 'vencimentoLancamento');
                        return false;
                    }
                }
                return true;
            }
            return true;
        }

        function escolherIntent(intent) {
            if (wizardState.saving) return;
            clearTimeout(wizardState.avancoPendente);
            limparMensagemWizard();
            wizardState.intent = intent;
            document.querySelectorAll('.tipo-card').forEach(c => c.classList.remove('selected'));
            document.querySelector(`.tipo-card[data-intent="${intent}"]`)?.classList.add('selected');

            const tipo = intent === 'entrada' ? 'entrada' : 'saida';
            atualizarFiltroCategoriasPorTipo(tipo);

            const ehCartao = intent === 'cartao';
            const ehFixo = intent === 'fixo';
            const ehLote = intent === 'lote';
            const ehEntrada = intent === 'entrada';
            const ehSaidaAVista = intent === 'saida';
            const ehSaida = tipo === 'saida';

            document.getElementById('blocoCartao').style.display = ehCartao ? 'block' : 'none';
            document.getElementById('blocoQtdParcelasFixo').style.display = ehFixo ? 'block' : 'none';
            document.getElementById('blocoVencimento').style.display = (ehCartao || ehLote) ? 'none' : 'block';
            document.getElementById('blocoPeriodoLote').hidden = !ehLote;
            document.getElementById('labelValorLancamento').innerHTML = ehLote ? 'Valor de cada mês (R$) <span class="campo-obrigatorio">*</span>' : 'Valor total (R$) <span class="campo-obrigatorio">*</span>';

            document.getElementById('blocoServicoEssencial').style.display = ehSaida ? 'block' : 'none';
            document.getElementById('blocoFormaPagamentoSaida').style.display = ehSaidaAVista ? 'block' : 'none';
            document.getElementById('blocoEscopo').style.display = ehSaida ? 'block' : 'none';
            document.getElementById('blocoBemLancamento').style.display = ehSaida ? 'block' : 'none';
            document.getElementById('blocoStatusPagamento').style.display = (ehEntrada || ehCartao || ehLote) ? 'none' : 'block';

            const labelData = document.getElementById('labelDataReferencia');
            if (labelData) labelData.textContent = ehEntrada ? 'Data de recebimento' : 'Data de vencimento';

            tratarMudancaCategoria();
            if (ehLote) tratarMudancaFormaLote();
            atualizarPreviewValor();

            wizardState.avancoPendente = setTimeout(() => {
                if (wizardState.step === 1) proximaEtapa();
                wizardState.avancoPendente = null;
            }, 180);
        }

        function tratarMudancaCategoria() {
            const blocoNatureza = document.getElementById('blocoNaturezaRenda');
            blocoNatureza.style.display = wizardState.intent === 'entrada' ? 'block' : 'none';
            document.getElementById('blocoCompetenciaRenda').style.display = wizardState.intent === 'entrada' ? 'block' : 'none';
            if (wizardState.intent !== 'entrada') {
                document.getElementById('blocoHoraExtra').style.display = 'none';
                document.getElementById('blocoBrutoFolha').style.display = 'none';
                return;
            }
            atualizarOpcoesNaturezaRenda(document.getElementById('naturezaRendaLancamento'));
            const sel = document.getElementById('categoriaLancamento');
            const dados = obterDados();
            const cat = dados.categorias.find(c => String(c.id) === String(sel.value));

            if (cat && /adiantamento/i.test(normalizarTexto(cat.nome))) {
                const campoValor = document.getElementById('valorTotalLancamento');
                if (campoValor && !campoValor.value) {
                    try {
                        const salvo = JSON.parse(localStorage.getItem('adiantamentoSalario_u' + obterUsuarioAtualId()) || '{}');
                        if (salvo && salvo.valor) campoValor.value = salvo.valor;
                    } catch (_) {}
                }
            }

            const classe = classificarEntradaRendimento({
                tipo: 'entrada', categoriaId: sel.value,
                descricao: document.getElementById('descricaoLancamento').value.trim(),
                naturezaRenda: document.getElementById('naturezaRendaLancamento').value
            }, dados);
            const ehSalario = classe === 'folha';
            const clt = normalizarConfiguracaoSalarial(obterUsuarioAtual(dados)?.configuracaoSalarial).regimeRenda === 'clt';
            const extraSalarial = classe === 'salarial_extra';
            document.getElementById('blocoHoraExtra').style.display = ehSalario && clt ? 'block' : 'none';
            document.getElementById('blocoBrutoFolha').style.display = ehSalario || extraSalarial ? 'block' : 'none';
            document.getElementById('campoHoraExtraBrutaLancamento').style.display = ehSalario && clt ? 'block' : 'none';
            document.getElementById('labelBrutoLancamento').textContent = ehSalario ? 'Bruto total da folha (R$, opcional)' : 'Bruto desta verba (R$, opcional)';
            document.getElementById('avisoBrutoLancamento').textContent = ehSalario
                ? 'O valor lançado é líquido. O bruto já inclui as horas extras e permite comparar descontos previstos com os efetivos.'
                : '13º, férias e PLR têm descontos específicos. Informe o bruto e o líquido efetivamente recebidos para apurar a diferença sem aplicar indevidamente a tabela comum.';
            if (!ehSalario) document.getElementById('valorHoraExtra').value = '0';
            if (!ehSalario && !extraSalarial) {
                document.getElementById('remuneracaoBrutaLancamento').value = '';
                document.getElementById('horaExtraBrutaLancamento').value = '';
            }
            if (!ehSalario || !clt) document.getElementById('horaExtraBrutaLancamento').value = '';
        }

        function atualizarPreviewValor() {
            const intent = wizardState.intent;
            const valor = numeroSeguro(document.getElementById('valorTotalLancamento').value);
            const preview = document.getElementById('valorPreview');
            if (!preview) return;
            if (valor <= 0) { preview.style.display = 'none'; return; }

            if (intent === 'cartao') {
                const qtd = Math.min(48, Math.max(1, inteiroSeguro(document.getElementById('qtdParcelas').value, 1)));
                if (qtd > 1) {
                    const parcela = valor / qtd;
                    preview.style.display = 'block';
                    preview.innerHTML = `<strong>${qtd}x de ${formatarMoeda(parcela)}</strong> — Total: ${formatarMoeda(valor)}`;
                } else {
                    preview.style.display = 'block';
                    preview.innerHTML = `<strong>Compra à vista no cartão</strong> — ${formatarMoeda(valor)}`;
                }
            } else if (intent === 'fixo') {
                const qtd = Math.min(48, Math.max(1, inteiroSeguro(document.getElementById('qtdParcelasFixo').value, 12)));
                preview.style.display = 'block';
                preview.innerHTML = `<strong>${qtd} cobranças de ${formatarMoeda(valor)}</strong> — Total previsto: ${formatarMoeda(valor * qtd)}`;
            } else if (intent === 'lote') {
                const periodo = obterPeriodoLote();
                preview.style.display = 'block';
                preview.innerHTML = periodo.quantidade > 0 && periodo.quantidade <= 120
                    ? `<strong>${periodo.quantidade} ${periodo.quantidade === 1 ? 'conta' : 'contas'} de ${formatarMoeda(valor)}</strong> — Total previsto: ${formatarMoeda(valor * periodo.quantidade)}`
                    : '<strong>Escolha o primeiro e o último mês</strong> para calcular o total do lote.';
            } else {
                preview.style.display = 'none';
            }
        }

        function renderizarResumoFinal() {
            const intent = wizardState.intent;
            const dados = obterDados();
            const catId = document.getElementById('categoriaLancamento').value;
            const cat = dados.categorias.find(c => String(c.id) === String(catId));
            const valor = numeroSeguro(document.getElementById('valorTotalLancamento').value);
            const desc = document.getElementById('descricaoLancamento').value.trim();

            if (intent === 'lote') {
                const periodo = obterPeriodoLote();
                const bemId = document.getElementById('bemLancamento').value;
                const bem = (dados.bens || []).find(b => String(b.id) === String(bemId));
                const cartao = (dados.cartoes || []).find(c => String(c.id) === String(periodo.cartaoId));
                const formas = { BOLETO: 'Boleto / Conta', DINHEIRO: 'Dinheiro / Pix / Débito', FIXO: 'Conta fixa / mensal', CARTAO: 'Cartão de crédito' };
                const escopo = bem ? (bem.compartilhado ? 'Casal / Casa' : 'Individual')
                    : document.getElementById('escopoLancamento').value === 'individual' ? 'Individual' : 'Casal / Casa';
                const linhasLote = [
                    ['Tipo', '🗓️ Contas em lote'],
                    ['Categoria', escaparHTML(cat?.nome || '—')],
                    ['Descrição', escaparHTML(desc)],
                    ['Forma de pagamento', escaparHTML(formas[periodo.forma] || periodo.forma)],
                    [periodo.forma === 'CARTAO' ? 'Primeira compra' : 'Primeiro vencimento', formatarDataBR(dataParaString(periodo.inicio))],
                    ['Último mês', periodo.fim.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })],
                    ['Quantidade', `${periodo.quantidade} ${periodo.quantidade === 1 ? 'conta' : 'contas'}`],
                    ['Valor por mês', formatarMoeda(valor)],
                    ['Status inicial', 'A pagar (vencidas ficam atrasadas)'],
                    ['Escopo', escopo]
                ];
                if (cartao && periodo.forma === 'CARTAO') linhasLote.push(['Cartão', escaparHTML(cartao.nome)]);
                if (bem) linhasLote.push(['Bem vinculado', escaparHTML(bem.nome)]);
                if (document.getElementById('servicoEssencial').value === 'sim') linhasLote.push(['Despesa essencial', 'Sim']);
                const observacao = document.getElementById('observacaoLancamento').value.trim();
                if (observacao) linhasLote.push(['Observação', escaparHTML(observacao)]);

                document.getElementById('resumoFinal').innerHTML = `
                    <div class="resumo-titulo">📋 Confira antes de gerar</div>
                    <div class="resumo-valor-destaque">${formatarMoeda(valor * periodo.quantidade)}
                        <small class="lote-resumo-subtotal">Total de ${periodo.quantidade} ${periodo.quantidade === 1 ? 'conta' : 'contas'} de ${formatarMoeda(valor)}</small>
                    </div>
                    ${linhasLote.map(([k, v]) => `<div class="resumo-linha"><span>${k}</span><strong>${v}</strong></div>`).join('')}
                    <p class="lote-resumo-nota">As contas serão criadas sem baixa de pagamento. As vencidas aparecerão como atrasadas; as compras no cartão serão vinculadas às faturas correspondentes.</p>
                `;
                return;
            }

            const labelsIntent = {
                entrada: '💰 Entrada',
                saida: '💸 Saída à vista',
                cartao: '💳 Compra no cartão',
                fixo: '🔁 Conta fixa'
            };

            let dataResumo = '';
            if (intent === 'cartao') {
                dataResumo = document.getElementById('dataCompraCartao').value;
            } else {
                dataResumo = document.getElementById('vencimentoLancamento').value;
            }

            const linhas = [
                ['Tipo', labelsIntent[intent] || intent],
                ['Categoria', escaparHTML(cat?.nome || '—')],
                ['Descrição', escaparHTML(desc)],
                ['Data', escaparHTML(formatarDataBR(dataResumo))]
            ];

            if (intent === 'saida') {
                const formaSel = document.getElementById('formaPagamentoSaida');
                const formaMap = { DINHEIRO: 'Dinheiro / Pix / Débito', BOLETO: 'Boleto', PIX: 'Pix', DEBITO: 'Débito' };
                linhas.push(['Forma de pagamento', formaMap[formaSel.value] || formaSel.value]);
            }

            if (intent === 'cartao') {
                const cartaoId = document.getElementById('cartaoLancamento').value;
                const cartao = (dados.cartoes || []).find(c => String(c.id) === String(cartaoId));
                const qtd = Math.min(48, Math.max(1, inteiroSeguro(document.getElementById('qtdParcelas').value, 1)));
                linhas.push(['Cartão', escaparHTML(cartao?.nome || '—')]);
                linhas.push(['Parcelas', qtd > 1 ? `${qtd}x de ${formatarMoeda(valor/qtd)}` : 'À vista']);
            }
            if (intent === 'fixo') {
                const qtd = Math.min(48, Math.max(1, inteiroSeguro(document.getElementById('qtdParcelasFixo').value, 12)));
                linhas.push(['Repetição', `${qtd} meses`]);
            }
            if (intent === 'entrada') {
                const selRenda = document.getElementById('naturezaRendaLancamento');
                const tipoRenda = classificarEntradaRendimento({
                    tipo: 'entrada', categoriaId: document.getElementById('categoriaLancamento').value,
                    descricao: document.getElementById('descricaoLancamento').value,
                    naturezaRenda: selRenda.value
                }, dados);
                const nomesTipos = { folha: 'Folha de pagamento', adiantamento: 'Adiantamento de salário', salarial_extra: '13º, férias ou PLR', variavel: 'Renda variável', nao_renda: 'Não contabilizar como renda' };
                linhas.push(['Classificação da entrada', nomesTipos[tipoRenda] || 'Outra entrada']);
                const horaExtra = numeroSeguro(document.getElementById('valorHoraExtra').value);
                if (horaExtra > 0 && tipoRenda === 'folha') linhas.push(['Hora extra (inclusa no total)', formatarMoeda(horaExtra)]);
                if (tipoRenda === 'folha' || tipoRenda === 'salarial_extra') {
                    const bruto = numeroSeguro(document.getElementById('remuneracaoBrutaLancamento').value);
                    const extraBruta = numeroSeguro(document.getElementById('horaExtraBrutaLancamento').value);
                    if (bruto) linhas.push(['Bruto do recebimento', formatarMoeda(bruto)]);
                    if (extraBruta) linhas.push(['Hora extra bruta (inclusa no bruto)', formatarMoeda(extraBruta)]);
                }
                linhas.push(['Competência', escaparHTML(document.getElementById('competenciaRendaLancamento').value)]);
            }
            if (intent === 'saida' || intent === 'fixo') {
                const essencial = document.getElementById('servicoEssencial').value;
                if (essencial === 'sim') linhas.push(['Essencial', 'Sim']);
                const bemId = document.getElementById('bemLancamento').value;
                if (bemId) {
                    const bem = (dados.bens || []).find(b => String(b.id) === String(bemId));
                    if (bem) linhas.push(['Bem vinculado', escaparHTML(bem.nome)]);
                }
            }

            document.getElementById('resumoFinal').innerHTML = `
                <div class="resumo-titulo">📋 Confirme os dados</div>
                <div class="resumo-valor-destaque">${formatarMoeda(valor)}</div>
                ${linhas.map(([k, v]) => `<div class="resumo-linha"><span>${k}</span><strong>${v}</strong></div>`).join('')}
            `;
        }

        function reiniciarWizard() {
            clearTimeout(wizardState.avancoPendente);
            document.querySelectorAll('.tipo-card').forEach(c => c.classList.remove('selected'));
            document.querySelectorAll('.wizard-step-content input, .wizard-step-content select').forEach(el => {
                if (el.type === 'number') el.value = el.id === 'qtdParcelasFixo' ? '12' : el.id === 'qtdParcelas' ? '1' : el.id === 'valorHoraExtra' ? '0' : '';
                else if (el.tagName === 'SELECT') el.selectedIndex = 0;
                else el.value = '';
            });
            const hoje = dataLocalYYYYMMDD();
            document.getElementById('competenciaRendaLancamento').value = hoje.slice(0, 7);
            ['vencimentoLancamento', 'dataCompraCartao', 'primeiroVencimentoLote', 'ultimoVencimentoLote'].forEach(id => {
                const campo = document.getElementById(id);
                if (campo) campo.value = hoje;
            });
            document.getElementById('blocoPeriodoLote').hidden = true;
            document.getElementById('blocoCartaoLote').hidden = true;
            document.getElementById('valorPreview').style.display = 'none';
            wizardState.intent = null;
            wizardState.step = 1;
            atualizarWizard();
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }

        async function salvarContasLoteWizard() {
            const periodo = obterPeriodoLote();
            const quantidade = periodo.quantidade;
            const descricao = document.getElementById('descricaoLancamento').value.trim();
            const valor = numeroSeguro(document.getElementById('valorTotalLancamento').value);
            const categoriaId = document.getElementById('categoriaLancamento').value;
            const bemId = document.getElementById('bemLancamento').value || null;
            const opcoes = {
                observacao: document.getElementById('observacaoLancamento').value.trim(),
                servicoEssencial: document.getElementById('servicoEssencial').value,
                escopo: document.getElementById('escopoLancamento').value,
                silencioso: true,
                onError: mensagem => mensagemWizard(mensagem, 'error')
            };
            const botao = document.getElementById('btnSalvarWizard');
            wizardState.saving = true;
            botao.disabled = true;
            botao.textContent = 'Gerando contas...';
            mensagemWizard(`Registrando ${quantidade} ${quantidade === 1 ? 'conta' : 'contas'} com segurança...`, 'loading');
            try {
                const salvo = await adicionarContaLotePorPeriodo(descricao, valor, periodo.inicio, quantidade,
                    categoriaId, bemId, periodo.forma, periodo.cartaoId, opcoes);
                if (!salvo) {
                    if (document.getElementById('wizardFeedback').dataset.state !== 'error') {
                        mensagemWizard('Não foi possível concluir o lote. Confira as informações e tente novamente.');
                    }
                    return;
                }
                reiniciarWizard();
                mensagemWizard(`${quantidade} ${quantidade === 1 ? 'conta criada' : 'contas criadas'} com sucesso! Os lançamentos já estão disponíveis na Central de Pagamentos.`, 'success');
                document.getElementById('wizardFeedback').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            } catch (erro) {
                console.error('Falha ao gerar contas em lote:', erro);
                mensagemWizard(erro.message || 'Não foi possível concluir o lote. Tente novamente.');
            } finally {
                wizardState.saving = false;
                botao.disabled = false;
                atualizarWizard();
            }
        }

        async function salvarLancamentoWizard(event) {
            event.preventDefault();
            if (wizardState.saving) return;
            if (!validarEtapa(2)) {
                wizardState.step = 2;
                atualizarWizard();
                return;
            }
            if (wizardState.intent === 'lote') {
                await salvarContasLoteWizard();
                return;
            }
            const intent = wizardState.intent;
            const tipo = intent === 'entrada' ? 'entrada' : 'saida';

            // CORREÇÃO: 'saida' (à vista) usa o select de forma de pagamento;
            // 'cartao' e 'fixo' têm formas fixas; 'entrada' é sempre DINHEIRO.
            let forma;
            if (intent === 'entrada') forma = 'DINHEIRO';
            else if (intent === 'cartao') forma = 'CARTAO';
            else if (intent === 'fixo') forma = 'FIXO';
            else if (intent === 'saida') forma = document.getElementById('formaPagamentoSaida')?.value || 'DINHEIRO';
            else forma = 'BOLETO';

            const descricao = document.getElementById('descricaoLancamento').value.trim();
            const categoriaId = document.getElementById('categoriaLancamento').value;
            const valorTotal = numeroSeguro(document.getElementById('valorTotalLancamento').value);
            const observacao = document.getElementById('observacaoLancamento').value.trim();
            const servicoEssencial = tipo === 'saida' ? (document.getElementById('servicoEssencial').value || 'nao') : 'nao';
            const escopo = document.getElementById('escopoLancamento').value || 'casal';
            const bemId = tipo === 'saida' ? (document.getElementById('bemLancamento').value || null) : null;
            const horaExtra = (intent === 'entrada' && document.getElementById('blocoHoraExtra').style.display !== 'none')
                ? numeroSeguro(document.getElementById('valorHoraExtra').value) : 0;
            const naturezaRenda = intent === 'entrada' ? document.getElementById('naturezaRendaLancamento').value : '';
            const competenciaRenda = intent === 'entrada' ? document.getElementById('competenciaRendaLancamento').value : '';
            const remuneracaoBruta = intent === 'entrada' ? document.getElementById('remuneracaoBrutaLancamento').value : '';
            const horaExtraBruta = intent === 'entrada' ? document.getElementById('horaExtraBrutaLancamento').value : '';
            const statusInicial = tipo === 'entrada' ? 'pago' : (document.getElementById('statusPagamento').value || 'pendente');

            let vencimento, cartaoId = null, dataCompra = null, qtdParcelas = 1;

            if (intent === 'cartao') {
                cartaoId = document.getElementById('cartaoLancamento').value || null;
                dataCompra = document.getElementById('dataCompraCartao').value;
                qtdParcelas = Math.min(48, Math.max(1, inteiroSeguro(document.getElementById('qtdParcelas').value, 1)));
                const cartao = (obterDados().cartoes || []).find(c => String(c.id) === String(cartaoId) && c.ativo !== false);
                if (!cartao) { await mostrarAlertaModal('Cartão inválido.'); return; }
                vencimento = calcularPrimeiroVencimentoCartao(cartao, dataCompra);
            } else if (intent === 'fixo') {
                vencimento = document.getElementById('vencimentoLancamento').value;
                qtdParcelas = Math.min(48, Math.max(1, inteiroSeguro(document.getElementById('qtdParcelasFixo').value, 12)));
            } else {
                vencimento = document.getElementById('vencimentoLancamento').value;
            }

            const salvo = await adicionarLancamentoComParcelas({
                descricao, tipo, categoriaId, bemId, formaPagamento: forma,
                cartaoId, dataCompra, qtdParcelas, valorTotal, vencimento,
                observacao, horaExtra, horaExtraBruta, remuneracaoBruta, competenciaRenda,
                naturezaRenda, servicoEssencial, escopo, statusInicial
            });
            if (!salvo) return;

            reiniciarWizard();
        }

        function popularSelectsBens() {
            const dados = obterDados();
            const usuario = obterUsuarioAtual();
            const usuarioId = String(usuario?.id ?? '');
            const parceiroId = String(usuario?.parceiroId ?? '');
            const bensAtivos = (dados.bens || []).filter(b => b.ativo !== false && (b.usuarioId == null || String(b.usuarioId) === usuarioId || (b.compartilhado === true && String(b.usuarioId) === parceiroId)));
            ['bemLancamento'].forEach(idSelect => {
                const select = document.getElementById(idSelect);
                if (!select) return;
                select.innerHTML = '<option value="">Nenhum bem vinculado</option>';
                bensAtivos.forEach(b => { const o = document.createElement('option'); o.value = b.id; o.textContent = b.nome; select.appendChild(o); });
            });
        }

        function popularSelectsCartoesLote() {
            const dados = obterDados();
            const usuarioAtualId = Number(obterUsuarioAtualId());
            const cartoes = (dados.cartoes || []).filter(c => c.ativo !== false && !c.isBeneficio && Number(c.usuarioId) === usuarioAtualId);
            const selLote = document.getElementById('cartaoLote');
            const selLanc = document.getElementById('cartaoLancamento');
            [selLote, selLanc].forEach(select => {
                if (!select) return;
                select.innerHTML = '';
                if (!cartoes.length) { select.innerHTML = '<option value="">Nenhum cartão ativo</option>'; return; }
                cartoes.forEach(c => { const o = document.createElement('option'); o.value = c.id; o.textContent = c.nome; select.appendChild(o); });
            });
        }

        function tratarMudancaFormaLote() {
            const forma = document.getElementById('formaPagamentoLote').value;
            const usaCartao = forma === 'CARTAO';
            document.getElementById('blocoCartaoLote').hidden = !usaCartao;
            document.getElementById('labelInicioLote').textContent = usaCartao ? 'Data da primeira compra' : 'Primeiro vencimento';
            document.getElementById('labelFimLote').textContent = usaCartao ? 'Último mês de compra' : 'Último mês de vencimento';
            atualizarPreviewValor();
        }
    

// ===== Eventos migrados dos atributos on* do HTML =====
// Liga apenas os elementos estáticos marcados por data-page-handler,
// sem executar JavaScript como string e sem registrar eventos em duplicidade.
(function vincularEventosDaPagina() {
    const eventos = {
        "lancamentos-1": [
            ["click", function(event) {
                escolherIntent('entrada')
            }],
        ],
        "lancamentos-2": [
            ["click", function(event) {
                escolherIntent('saida')
            }],
        ],
        "lancamentos-3": [
            ["click", function(event) {
                escolherIntent('cartao')
            }],
        ],
        "lancamentos-4": [
            ["click", function(event) {
                escolherIntent('fixo')
            }],
        ],
        "lancamentos-5": [
            ["click", function(event) {
                escolherIntent('lote')
            }],
        ],
        "lancamentos-6": [
            ["change", function(event) {
                tratarMudancaCategoria()
            }],
        ],
        "lancamentos-7": [
            ["input", function(event) {
                tratarMudancaCategoria()
            }],
        ],
        "lancamentos-8": [
            ["input", function(event) {
                atualizarPreviewValor()
            }],
        ],
        "lancamentos-9": [
            ["change", function(event) {
                tratarMudancaFormaLote()
            }],
        ],
        "lancamentos-10": [
            ["change", function(event) {
                atualizarPreviewValor()
            }],
        ],
        "lancamentos-11": [
            ["change", function(event) {
                atualizarPreviewValor()
            }],
        ],
        "lancamentos-12": [
            ["input", function(event) {
                atualizarPreviewValor()
            }],
        ],
        "lancamentos-13": [
            ["input", function(event) {
                atualizarPreviewValor()
            }],
        ],
        "lancamentos-14": [
            ["change", function(event) {
                tratarMudancaCategoria()
            }],
        ],
        "lancamentos-15": [
            ["click", function(event) {
                etapaAnterior()
            }],
        ],
        "lancamentos-16": [
            ["click", function(event) {
                proximaEtapa()
            }],
        ],
        "lancamentos-17": [
            ["click", function(event) {
                salvarLancamentoWizard(event)
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

