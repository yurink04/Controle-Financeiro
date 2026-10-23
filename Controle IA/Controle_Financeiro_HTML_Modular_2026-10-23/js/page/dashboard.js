// Controle Financeiro | Página: dashboard.html
// Arquivo extraído dos scripts embutidos no HTML original.
// Carregar APÓS js/script.js, js/calculos_trabalhistas.js e js/conexao_sheets.js.
// Mantém funções globais clássicas usadas por elementos gerados dinamicamente.

// ===== Bloco inline original 1 =====
    (function () {
        const el = document.getElementById('filtroMesAno');
        if (el && !el.value) {
            const h = new Date();
            el.value = h.getFullYear() + '-' + String(h.getMonth() + 1).padStart(2, '0');
        }
    })();
    

// ===== Bloco inline original 2 =====
    /* ============================================================
       FUNÇÕES EXTRAS DO PAINEL
       ============================================================ */

    function renderizarSessoesDashboardExtras() {
        try {
            const mes = document.getElementById('filtroMesAno')?.value || '';
            const esc = document.getElementById('filtroEscopoDashboardGeral')?.value || 'casal';
            const d = obterDados();
            const lns = filtrarDadosPorPermissao(d.lancamentos || [], d, esc)
                .filter(l => String(l.vencimento || l.dataCompra || '').startsWith(mes)
                    && (esc === 'todos' || l.tipo === 'entrada' || (l.escopo || 'casal') === esc));

            renderizarPulsoDashboard(lns, d, mes);
            renderizarTopCategoriasDashboard(d, lns);
        } catch (e) {
            console.warn('[Extras Dashboard]', e);
        }
    }

/* 🚦 PULSO DO MÊS — clicável, com redirecionamento contextual */
function renderizarPulsoDashboard(lns, dados, mes) {
    const cont = document.getElementById('pulsoDashboard');
    if (!cont) return;

    if (document.body.classList.contains('privacidade-ativa')) {
        cont.innerHTML = `
            <div class="privacy-section-placeholder">
                <div><strong>Pulso do mês oculto</strong></div>
                <div style="font-size:0.82rem;font-weight:500;">Toque no banner de privacidade para revelar o veredito.</div>
            </div>`;
        return;
    }

    let ent = 0, sai = 0, ess = 0;
    lns.forEach(l => {
        const v = Number(l.valor || 0);
        if (l.tipo === 'entrada') ent += v;
        else { sai += v; if (l.servicoEssencial === 'sim') ess += v; }
    });

    const hoje = dataLocalYYYYMMDD();
    const atrasadas = lns.filter(l => !l.pago && l.vencimento && l.vencimento < hoje && l.tipo === 'saida');
    const totalAtrasado = atrasadas.reduce((a, l) => a + Number(l.valor || 0), 0);
    const saldoMes = ent - sai;

    const baseCompleta = (typeof obterDados === 'function') ? obterDados() : (dados || {});
    const escopoAtual = document.getElementById('filtroEscopoDashboardGeral')?.value || 'casal';
    const calcularSaldoAte = (limiteMes) => {
        if (!limiteMes) return 0;
        return filtrarDadosPorPermissao(baseCompleta.lancamentos || [], baseCompleta, escopoAtual)
            .filter(l => {
                const mLanc = String(l.vencimento || l.dataCompra || '').slice(0, 7);
                if (!mLanc || mLanc > limiteMes) return false;
                return l.tipo === 'entrada' || (l.escopo || 'casal') === escopoAtual;
            })
            .reduce((acc, l) => acc + (l.tipo === 'entrada' ? 1 : -1) * Number(l.valor || 0), 0);
    };
    let saldoAnterior = 0;
    if (/^\d{4}-\d{2}$/.test(mes)) {
        const [anoRef, mesRef] = mes.split('-').map(Number);
        const dataAnt = new Date(anoRef, mesRef - 2, 1);
        saldoAnterior = calcularSaldoAte(
            dataAnt.getFullYear() + '-' + String(dataAnt.getMonth() + 1).padStart(2, '0')
        );
    }
    const saldoAcumulado = saldoAnterior + saldoMes;
    const taxaPoupMes = ent > 0 ? (saldoMes / ent) * 100 : 0;
    const compEss = ent > 0 ? (ess / ent) * 100 : 0;

    let nivel = 'saudavel', icone = '🟢', titulo = '', detalhe = '';
    let destino = { href: 'relatorios.html' + (mes ? '?mes=' + encodeURIComponent(mes) : ''), dica: 'Ver análise completa do mês nos Relatórios →' };

    if (saldoAcumulado < 0) {
        nivel = 'perigo'; icone = '🚨';
        if (saldoMes < 0 && saldoAnterior >= 0) {
            titulo = `Conta no vermelho: ${formatarMoeda(Math.abs(saldoAcumulado))}`;
            detalhe = `O mês fechou negativo em ${formatarMoeda(Math.abs(saldoMes))} e consumiu o saldo anterior de ${formatarMoeda(saldoAnterior)}.`;
        } else if (saldoMes >= 0 && saldoAnterior < 0) {
            titulo = `Ainda no vermelho: ${formatarMoeda(Math.abs(saldoAcumulado))}`;
            detalhe = `O mês foi positivo (${formatarMoeda(saldoMes)}), mas ainda faltam ${formatarMoeda(Math.abs(saldoAcumulado))} para quitar o saldo negativo anterior.`;
        } else {
            titulo = `Conta no vermelho: ${formatarMoeda(Math.abs(saldoAcumulado))}`;
            detalhe = 'Entradas e saídas acumuladas deixaram a conta negativa. Priorize cortar gastos não essenciais.';
        }
        destino = { href: 'relatorios.html' + (mes ? '?mes=' + encodeURIComponent(mes) : ''), dica: 'Analisar saídas e saldo nos Relatórios →' };
    } else if (totalAtrasado > 0) {
        nivel = 'perigo'; icone = '⏰';
        titulo = `${atrasadas.length} conta(s) atrasada(s) — ${formatarMoeda(totalAtrasado)}`;
        detalhe = 'Priorize a quitação para evitar juros e negativação. Abra a Central de Pagamentos.';
        destino = { href: `central-pagamentos.html?visao=competencia&mes=${encodeURIComponent(mes || '')}`, dica: 'Ver contas atrasadas na Central de Pagamentos →' };
    } else if (lns.length === 0 && saldoAnterior === 0) {
        nivel = 'neutro'; icone = '📊';
        titulo = 'Mês sem movimento';
        detalhe = 'Registre seus lançamentos para ver o pulso do mês.';
        destino = { href: 'lancamentos.html', dica: 'Registrar o primeiro lançamento do mês →' };
    } else if (lns.length === 0 && saldoAcumulado > 0) {
        nivel = 'saudavel'; icone = '🟢';
        titulo = `Sem movimentações — saldo preservado`;
        detalhe = `Sua conta mantém ${formatarMoeda(saldoAcumulado)} do período anterior. Nenhuma despesa nova este mês.`;
    } else if (saldoMes < 0) {
        nivel = 'perigo'; icone = '🚨';
        titulo = `Mês no vermelho: ${formatarMoeda(Math.abs(saldoMes))}`;
        detalhe = `Gastou mais do que recebeu neste mês. O saldo acumulado de ${formatarMoeda(saldoAcumulado)} ainda cobre — mas fique atento.`;
        destino = { href: 'relatorios.html' + (mes ? '?mes=' + encodeURIComponent(mes) : ''), dica: 'Investigar saídas nos Relatórios →' };
    } else if (compEss > 70 && ent > 0) {
        nivel = 'atencao'; icone = '⚠️';
        titulo = `Essenciais consomem ${compEss.toFixed(0)}% da renda`;
        detalhe = `${formatarMoeda(ess)} foram para despesas essenciais. Revise contratos e assinaturas.`;
        destino = { href: 'relatorios.html' + (mes ? '?mes=' + encodeURIComponent(mes) : ''), dica: 'Revisar essenciais nos Relatórios →' };
    } else if (taxaPoupMes < 10 && ent > 0) {
        nivel = 'atencao'; icone = '📉';
        titulo = `Poupança baixa no mês: ${taxaPoupMes.toFixed(0)}%`;
        detalhe = `Guardou ${formatarMoeda(saldoMes)} de ${formatarMoeda(ent)} recebidos. Ideal é guardar 20% ou mais.`;
        destino = { href: 'relatorios.html' + (mes ? '?mes=' + encodeURIComponent(mes) : ''), dica: 'Ver onde reduzir nos Relatórios →' };
    } else {
        nivel = 'saudavel'; icone = '✅';
        if (saldoMes > 0) {
            titulo = `Boa saúde financeira — ${formatarMoeda(saldoAcumulado)} em conta`;
            detalhe = `Guardou ${formatarMoeda(saldoMes)} este mês${saldoAnterior > 0 ? ` e manteve os ${formatarMoeda(saldoAnterior)} do período anterior` : ''}. Continue assim.`;
        } else {
            titulo = `Saldo preservado — ${formatarMoeda(saldoAcumulado)} em conta`;
            detalhe = `Sem novas dívidas. Seu saldo positivo do período anterior continua disponível.`;
        }
    }

    cont.innerHTML = `
        <a href="${escaparHTML(destino.href)}" class="pulso-card ${nivel}" aria-label="${escaparHTML(destino.dica.replace(/[→↗]/g, '').trim())}">
            <div class="pulso-icone">${icone}</div>
            <div class="pulso-conteudo">
                <div class="pulso-eyebrow">Pulso do mês · Saldo em conta</div>
                <div class="pulso-titulo">${escaparHTML(titulo)}</div>
                <div class="pulso-detalhe">${escaparHTML(detalhe)}</div>
                <span class="pulso-dica">${escaparHTML(destino.dica)}</span>
            </div>
        </a>`;
}

    /* 💸 ONDE O DINHEIRO FOI — totalmente oculto no modo discreto */
    function renderizarTopCategoriasDashboard(dados, lns) {
        const cont = document.getElementById('topCategoriasDashboard');
        if (!cont) return;

        // Modo Discreto: substitui por placeholder neutro
        if (document.body.classList.contains('privacidade-ativa')) {
            cont.innerHTML = `
                <div class="privacy-section-placeholder">
                    <div><strong>Distribuição de gastos oculta</strong></div>
                    <div style="font-size:0.82rem;font-weight:500;">Categorias ficam protegidas no modo discreto.</div>
                </div>`;
            return;
        }

        const saidas = lns.filter(l => l.tipo !== 'entrada');
        const totalSaidas = saidas.reduce((a, l) => a + Number(l.valor || 0), 0);

        if (!saidas.length) {
            cont.innerHTML = `<p class="muted" style="text-align:center; padding:24px 0;">Nenhum gasto registrado no mês.</p>`;
            return;
        }

        const nomeCat = id => (dados.categorias.find(x => String(x.id) === String(id)) || {}).nome || 'Sem categoria';
        const somasCat = {};
        const essencialCat = {};
        saidas.forEach(l => {
            const k = nomeCat(l.categoriaId);
            somasCat[k] = (somasCat[k] || 0) + Number(l.valor || 0);
            if (l.servicoEssencial === 'sim') essencialCat[k] = true;
        });

        const ranking = Object.entries(somasCat).sort((a, b) => b[1] - a[1]).slice(0, 5);
        const maxVal = ranking[0]?.[1] || 1;

        cont.innerHTML = ranking.map(([nome, valor], i) => {
            const pctTotal = totalSaidas > 0 ? (valor / totalSaidas) * 100 : 0;
            const pctBarra = (valor / maxVal) * 100;
            const essencial = essencialCat[nome];
            return `
                <div class="categoria-barra">
                    <div class="categoria-barra-header">
                        <div class="categoria-barra-info">
                            <span class="categoria-barra-pos">${i + 1}</span>
                            <span class="categoria-barra-nome">${escaparHTML(nome)}${essencial ? ' <span style="font-size:0.65rem;color:var(--danger);font-weight:800;">ESSENCIAL</span>' : ''}</span>
                        </div>
                        <div class="categoria-barra-valores">
                            <span class="categoria-barra-valor">${formatarMoeda(valor)}</span>
                            <span class="categoria-barra-pct">${pctTotal.toFixed(1)}% do total</span>
                        </div>
                    </div>
                    <div class="categoria-barra-track">
                        <div class="categoria-barra-fill ${essencial ? 'essencial' : ''}" style="width:${pctBarra}%"></div>
                    </div>
                </div>`;
        }).join('');
    }

        document.addEventListener('DOMContentLoaded', async () => {
        injetarHeader();

        const dd = document.querySelector('.dropdown-acao');
        if (dd) {
            dd.querySelector('.btn-acao-principal').addEventListener('click', e => {
                e.stopPropagation();
                dd.classList.toggle('aberto');
            });
            document.addEventListener('click', () => dd.classList.remove('aberto'));
        }
        if (await verificarAutenticacao()) carregarDashboard();
    });
    

// ===== Eventos migrados dos atributos on* do HTML =====
// Liga apenas os elementos estáticos marcados por data-page-handler,
// sem executar JavaScript como string e sem registrar eventos em duplicidade.
(function vincularEventosDaPagina() {
    const eventos = {
        "dashboard-1": [
            ["click", function(event) {
                redirecionarNovoLancamento('entrada')
            }],
        ],
        "dashboard-2": [
            ["click", function(event) {
                redirecionarNovoLancamento('saida')
            }],
        ],
        "dashboard-3": [
            ["click", function(event) {
                redirecionarNovoLancamento('cartao')
            }],
        ],
        "dashboard-4": [
            ["input", function(event) {
                carregarDashboard()
            }],
        ],
        "dashboard-5": [
            ["change", function(event) {
                carregarDashboard()
            }],
        ],
        "dashboard-6": [
            ["change", function(event) {
                carregarDashboard()
            }],
        ],
        "dashboard-7": [
            ["change", function(event) {
                carregarDashboard()
            }],
        ],
        "dashboard-8": [
            ["change", function(event) {
                carregarDashboard()
            }],
        ],
        "dashboard-9": [
            ["change", function(event) {
                carregarDashboard()
            }],
        ],
        "dashboard-10": [
            ["change", function(event) {
                carregarDashboard()
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

