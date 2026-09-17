const DB_KEY = 'sistemaFinanceiroCompartilhado';
const API_URL = "https://script.google.com/macros/s/AKfycbyFcD36E4h1aeU4-uAUkrmmfmq148oveMhjF9iLpPWzSVv407SIku7wHoh1NIobtYXz/exec";
const SENHA_ADMIN_EXCLUSAO = "praia22";

let chartEntradasSaidasInstance = null;
let chartCartoesLimiteInstance = null;

document.addEventListener("DOMContentLoaded", () => {
    inicializarTemaVisual();
});

function inicializarTemaVisual() {
    const temaSalvo = localStorage.getItem('temaSistema') || 'claro';
    if (temaSalvo === 'escuro') {
        document.body.classList.add('dark-mode');
    }
}

function alternarTemaVisual() {
    if (document.body.classList.contains('dark-mode')) {
        document.body.classList.remove('dark-mode');
        localStorage.setItem('temaSistema', 'claro');
    } else {
        document.body.classList.add('dark-mode');
        localStorage.setItem('temaSistema', 'escuro');
    }
}

async function inicializarBanco() {
    try {
        const response = await fetch(`${API_URL}?action=obterDados`);
        const dados = await response.json();
        if (dados && dados.usuarios) {
            memoriaSistema = dados;
            localStorage.setItem(DB_KEY, JSON.stringify(dados));
            return;
        }
    } catch (e) {
        console.warn("Modo offline ativo ou falha na API. Usando localStorage.");
    }

    if (!localStorage.getItem(DB_KEY)) {
        const dadosIniciais = {
            usuarios: [
                { id: 1, nome: "Samuel" },
                { id: 2, nome: "Mariana" }
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
            logs: []
        };
        localStorage.setItem(DB_KEY, JSON.stringify(dadosIniciais));
    }
}

let memoriaSistema = JSON.parse(localStorage.getItem(DB_KEY)) || {
    usuarios: [{ id: 1, nome: "Samuel" }, { id: 2, nome: "Mariana" }],
    categorias: [],
    cartoes: [],
    lancamentos: [],
    financiamentos: [],
    logs: []
};

function obterDados() {
    const dadosLocal = localStorage.getItem(DB_KEY);
    if (dadosLocal) {
        const parsed = JSON.parse(dadosLocal);
        if (!parsed.logs) parsed.logs = [];
        return parsed;
    }
    if (!memoriaSistema.logs) memoriaSistema.logs = [];
    return memoriaSistema;
}

async function salvarDados(dados) {
    memoriaSistema = dados;
    localStorage.setItem(DB_KEY, JSON.stringify(dados));
    
    try {
        await fetch(API_URL, {
            method: "POST",
            mode: "no-cors",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ action: "salvarDados", dados: dados })
        });
    } catch (e) {
        console.error("Erro ao sincronizar com o Google Sheets:", e);
    }
}

async function registrarLog(acao, detalhes) {
    const dados = obterDados();
    const usuarioId = localStorage.getItem('usuarioLogado');
    let nomeUsuario = "Sistema / Desconhecido";
    
    if (usuarioId) {
        const u = dados.usuarios.find(user => user.id == usuarioId);
        if (u) nomeUsuario = u.nome;
    }

    const agora = new Date();
    const dataHora = agora.toLocaleString('pt-BR');

    dados.logs.push({
        dataHora,
        usuario: nomeUsuario,
        acao,
        detalhes
    });

    await salvarDados(dados);
}

async function verificarAutenticacao() {
    await inicializarBanco();
    const usuarioId = localStorage.getItem('usuarioLogado');
    if (!usuarioId) {
        window.location.href = 'index.html';
        return;
    }
    const dados = obterDados();
    const usuario = dados.usuarios.find(u => u.id == usuarioId);
    const spanNome = document.getElementById('usuarioLogadoNome');
    if (spanNome && usuario) {
        spanNome.innerText = `Perfil: ${usuario.nome}`;
    }
}

// --- Modais Customizados Centralizados ---
function mostrarConfirmacaoModal(mensagem) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="modal-box">
                <h3>Confirmação</h3>
                <p>${mensagem}</p>
                <div class="modal-buttons">
                    <button id="btnNaoModal" style="background-color: #64748b;">Cancelar</button>
                    <button id="btnSimModal" style="background-color: #ef4444;">Confirmar</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        document.getElementById('btnSimModal').onclick = () => { overlay.remove(); resolve(true); };
        document.getElementById('btnNaoModal').onclick = () => { overlay.remove(); resolve(false); };
    });
}

function mostrarPromptModal(titulo, descricao) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="modal-box">
                <h3>${titulo}</h3>
                <p>${descricao}</p>
                <input type="password" id="inputModalValor" placeholder="Digite a senha..." autofocus>
                <div class="modal-buttons">
                    <button id="btnCancelarPrompt" style="background-color: #64748b;">Cancelar</button>
                    <button id="btnOkPrompt">Continuar</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        const input = document.getElementById('inputModalValor');
        input.focus();

        const finalizar = (val) => { overlay.remove(); resolve(val); };

        document.getElementById('btnOkPrompt').onclick = () => finalizar(input.value);
        document.getElementById('btnCancelarPrompt').onclick = () => finalizar(null);
        input.onkeydown = (e) => {
            if (e.key === 'Enter') finalizar(input.value);
            if (e.key === 'Escape') finalizar(null);
        };
    });
}

async function verificarSenhaAdmin(nomeSecao = "esta seção") {
    if (sessionStorage.getItem('adminAutorizado') === 'true') {
        return true;
    }

    const senhaDigitada = await mostrarPromptModal("Acesso Restrito", `Área protegida por senha de administrador para ${nomeSecao}.`);
    if (senhaDigitada === null) return false;

    if (senhaDigitada === SENHA_ADMIN_EXCLUSAO) {
        const lembrar = await mostrarConfirmacaoModal("Deseja lembrar a autorização para essa seção durante esta sessão?");
        if (lembrar) {
            sessionStorage.setItem('adminAutorizado', 'true');
        }
        return true;
    } else {
        alert('Senha de administrador incorreta!');
        return false;
    }
}

async function adicionarCategoria(nome, tipo) {
    if (!await verificarSenhaAdmin("cadastrar categoria")) return;
    const dados = obterDados();
    const novaId = dados.categorias.length > 0 ? Number(dados.categorias[dados.categorias.length - 1].id) + 1 : 1;
    dados.categorias.push({ id: novaId, nome, tipo });
    await salvarDados(dados);
    await registrarLog("CADASTRO CATEGORIA", `Categoria criada: ${nome} (${tipo})`);
}

async function atualizarCategoria(id, nome, tipo) {
    if (!await verificarSenhaAdmin("editar categoria")) return;
    const dados = obterDados();
    const categoria = dados.categorias.find(c => Number(c.id) === Number(id));
    if (categoria) {
        categoria.nome = nome;
        categoria.tipo = tipo;
        await salvarDados(dados);
        await registrarLog("EDIÇÃO CATEGORIA", `Categoria ID ${id} alterada para: ${nome} (${tipo})`);
    }
}

async function excluirCategoria(id) {
    if (!await verificarSenhaAdmin("excluir categoria")) return;
    const dados = obterDados();
    dados.categorias = dados.categorias.filter(c => Number(c.id) !== Number(id));
    await salvarDados(dados);
    await registrarLog("EXCLUSÃO CATEGORIA", `Categoria ID ${id} excluída`);
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
                <button onclick="prepararEdicaoCategoria(${cat.id}, '${cat.nome}', '${cat.tipo}')" style="background-color: #f39c12; padding: 4px 8px; margin-right: 5px; width: auto; display: inline-block;">Editar</button>
                <button onclick="excluirCategoriaPrompt(${cat.id})" style="background-color: #ef4444; padding: 4px 8px; width: auto; display: inline-block;">Excluir</button>
            </div>
        `;
        lista.appendChild(li);
    });
}

// --- Gestão de Cartões (Com Fechamento e Vencimento) ---
async function adicionarCartao(nome, limiteTotal, fechamento, vencimento) {
    if (!await verificarSenhaAdmin("cadastrar cartão")) return;
    const dados = obterDados();
    const usuarioId = parseInt(localStorage.getItem('usuarioLogado'));
    const novaId = dados.cartoes.length > 0 ? Number(dados.cartoes[dados.cartoes.length - 1].id) + 1 : 1;
    
    dados.cartoes.push({ 
        id: novaId, 
        usuarioId, 
        nome, 
        limiteTotal: Number(limiteTotal), 
        fechamento: Number(fechamento),
        vencimento: Number(vencimento)
    });
    
    await salvarDados(dados);
    await registrarLog("CADASTRO CARTÃO", `Cartão criado: ${nome}, Limite: R$ ${limiteTotal}`);
    
    if (typeof renderizarCartoes === 'function') {
        renderizarCartoes();
    }
}

async function atualizarCartaoNoBanco(id, nome, limiteTotal, fechamento, vencimento) {
    if (!await verificarSenhaAdmin("editar cartão")) return;
    const dados = obterDados();
    const cartao = dados.cartoes.find(c => Number(c.id) === Number(id));
    
    if (cartao) {
        cartao.nome = nome;
        cartao.limiteTotal = Number(limiteTotal);
        cartao.fechamento = Number(fechamento);
        cartao.vencimento = Number(vencimento);
        
        await salvarDados(dados);
        await registrarLog("EDIÇÃO CARTÃO", `Cartão ID ${id} atualizado para: ${nome}`);
    }
}

async function excluirCartao(id) {
    if (!await verificarSenhaAdmin("excluir cartão")) return;
    const confirmar = await mostrarConfirmacaoModal("Deseja realmente excluir este cartão?");
    if (!confirmar) return;

    const dados = obterDados();
    dados.cartoes = dados.cartoes.filter(c => Number(c.id) !== Number(id));
    
    await salvarDados(dados);
    await registrarLog("EXCLUSÃO CARTÃO", `Cartão ID ${id} excluído`);
    renderizarCartoes();
}

function renderizarCartoes() {
    const dados = obterDados();
    const grid = document.getElementById('gridCartoes');
    if (!grid) return;
    grid.innerHTML = '';

    if (dados.cartoes.length === 0) {
        grid.innerHTML = '<p>Nenhum cartão cadastrado.</p>';
        return;
    }

    dados.cartoes.forEach(cartao => {
        const gastoUtilizado = dados.lancamentos
            .filter(l => Number(l.cartaoId) === Number(cartao.id) && !l.pago)
            .reduce((acc, l) => acc + Number(l.valor), 0);

        const disponivel = Number(cartao.limiteTotal) - gastoUtilizado;

        const box = document.createElement('div');
        box.className = 'stat-box';
        box.style.textAlign = 'left';
        box.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
                <h3 style="margin: 0; font-size: 1rem; color: var(--accent);">${cartao.nome}</h3>
                <div style="display: flex; gap: 4px;">
                    <button onclick="prepararEdicaoCartao(${cartao.id}, '${cartao.nome}', ${cartao.limiteTotal}, ${cartao.fechamento}, ${cartao.vencimento})" style="background-color: #f59e0b; padding: 4px 8px; font-size: 0.8rem; width: auto;">Editar</button>
                    <button onclick="excluirCartao(${cartao.id})" style="background-color: #ef4444; padding: 4px 8px; font-size: 0.8rem; width: auto;">Excluir</button>
                </div>
            </div>
            <p style="font-size: 0.85rem; font-weight: normal; margin-bottom: 4px;">Fechamento: dia ${cartao.fechamento} | Vencimento: dia ${cartao.vencimento}</p>
            <p style="font-size: 0.95rem; margin-top: 6px;">Limite Total: R$ ${Number(cartao.limiteTotal).toFixed(2)}</p>
            <p style="font-size: 0.95rem;" class="negativo">Utilizado: R$ ${gastoUtilizado.toFixed(2)}</p>
            <p style="font-size: 0.95rem;" class="positivo">Disponível: R$ ${disponivel.toFixed(2)}</p>
        `;
        grid.appendChild(box);
    });
}

function popularSelectsLancamento() {
    const dados = obterDados();
    const selectCartao = document.getElementById('cartaoLancamento');

    atualizarFiltroCategoriasPorTipo('saida');

    if (selectCartao) {
        selectCartao.innerHTML = '';
        dados.cartoes.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.id;
            opt.innerText = c.nome;
            selectCartao.appendChild(opt);
        });
    }
}

function atualizarFiltroCategoriasPorTipo(tipo) {
    const dados = obterDados();
    const selectCat = document.getElementById('categoriaLancamento');
    if (!selectCat) return;

    selectCat.innerHTML = '';
    const filtradas = dados.categorias.filter(c => c.tipo === tipo);
    
    if (filtradas.length === 0) {
        const opt = document.createElement('option');
        opt.value = "";
        opt.innerText = "Nenhuma categoria cadastrada para este tipo";
        selectCat.appendChild(opt);
        return;
    }

    filtradas.forEach(cat => {
        const opt = document.createElement('option');
        opt.value = cat.id;
        opt.innerText = cat.nome;
        selectCat.appendChild(opt);
    });

    if (typeof verificarCategoriaSalario === 'function') {
        verificarCategoriaSalario();
    }
}

function carregarSelectFinanciamentos() {
    const dados = obterDados();
    const selectFin = document.getElementById('selectFinanciamento');
    if (!selectFin) return;

    selectFin.innerHTML = '';
    if (dados.financiamentos.length === 0) {
        selectFin.innerHTML = '<option value="">Nenhum financiamento cadastrado</option>';
        return;
    }

    dados.financiamentos.forEach(f => {
        const opt = document.createElement('option');
        opt.value = f.id;
        opt.innerText = `${f.nome} (${f.mesesPagos}/${f.totalMeses} meses pagos)`;
        selectFin.appendChild(opt);
    });
    atualizarInfoFinanciamento();
}

function atualizarInfoFinanciamento() {
    const dados = obterDados();
    const selectFin = document.getElementById('selectFinanciamento');
    const infoTexto = document.getElementById('infoFinanciamentoTexto');
    if (!selectFin || !infoTexto) return;

    const finId = selectFin.value;
    const fin = dados.financiamentos.find(f => Number(f.id) === Number(finId));
    if (fin) {
        infoTexto.innerText = `Contrato: ${fin.nome} | Meses já quitados: ${fin.mesesPagos} de ${fin.totalMeses}`;
    } else {
        infoTexto.innerText = '';
    }
}

async function adicionarLancamentoComParcelas(dadosForm) {
    const dados = obterDados();
    const usuarioId = parseInt(localStorage.getItem('usuarioLogado'));
    let proximaId = dados.lancamentos.length > 0 ? Number(dados.lancamentos[dados.lancamentos.length - 1].id) + 1 : 1;

    const valorParcela = dadosForm.formaPagamento === 'FIXO' ? Number(dadosForm.valorTotal.toFixed(2)) : Number((dadosForm.valorTotal / dadosForm.qtdParcelas).toFixed(2));
    const qtdGerar = dadosForm.formaPagamento === 'FIXO' ? 12 : dadosForm.qtdParcelas;
    const valorHoraExtraParcela = dadosForm.horaExtra ? Number((dadosForm.horaExtra / qtdGerar).toFixed(2)) : 0;
    
    const [ano, mes, dia] = dadosForm.vencimento.split('-').map(Number);
    const dataBase = new Date(ano, mes - 1, dia);

    for (let i = 1; i <= qtdGerar; i++) {
        let dataVenc = new Date(dataBase.getFullYear(), dataBase.getMonth() + (i - 1), dataBase.getDate());
        
        const anoVenc = dataVenc.getFullYear();
        const mesVenc = String(dataVenc.getMonth() + 1).padStart(2, '0');
        const diaVenc = String(dataVenc.getDate()).padStart(2, '0');
        const dataVencStr = `${anoVenc}-${mesVenc}-${diaVenc}`;

        const descricaoParcelada = qtdGerar > 1 
            ? `${dadosForm.descricao} (${i}/${qtdGerar})` 
            : dadosForm.descricao;

        const novoLancamento = {
            id: proximaId++,
            usuarioId,
            descricao: descricaoParcelada,
            valor: valorParcela,
            tipo: dadosForm.tipo,
            categoriaId: dadosForm.categoriaId,
            formaPagamento: dadosForm.formaPagamento === 'FIXO' ? 'BOLETO' : dadosForm.formaPagamento,
            cartaoId: dadosForm.cartaoId || null,
            vencimento: dataVencStr,
            recorrencia: 'unica',
            parcelaAtual: i,
            totalParcelas: qtdGerar,
            observacao: dadosForm.observacao || '',
            horaExtra: valorHoraExtraParcela,
            pago: false
        };

        dados.lancamentos.push(novoLancamento);
    }

    await salvarDados(dados);
    await registrarLog("NOVO LANÇAMENTO", `Lançamento criado: ${dadosForm.descricao}, Valor: R$ ${valorParcela} (${qtdGerar}x)`);
}

async function atualizarLancamentoNoBanco(id, novosDados) {
    const dados = obterDados();
    const lancamento = dados.lancamentos.find(l => Number(l.id) === Number(id));
    if (lancamento) {
        lancamento.descricao = novosDados.descricao;
        lancamento.tipo = novosDados.tipo;
        lancamento.categoriaId = novosDados.categoriaId;
        lancamento.formaPagamento = novosDados.formaPagamento;
        lancamento.valor = Number(novosDados.valor);
        lancamento.observacao = novosDados.observacao;
        lancamento.vencimento = novosDados.vencimento;
        await salvarDados(dados);
        await registrarLog("EDIÇÃO LANÇAMENTO", `Lançamento ID ${id} atualizado para: ${novosDados.descricao} (R$ ${novosDados.valor})`);
    }
}

async function adicionarFinanciamentoComRecorrencia(nome, recorrente, valorParcela, qtdMeses, primeiroVencimento, categoriaId = null) {
    if (!await verificarSenhaAdmin("cadastrar contrato de financiamento")) return;
    const dados = obterDados();
    const usuarioId = parseInt(localStorage.getItem('usuarioLogado'));
    const novaId = dados.financiamentos.length > 0 ? Number(dados.financiamentos[dados.financiamentos.length - 1].id) + 1 : 1;

    const catFinalId = categoriaId || (dados.categorias.find(c => c.nome.toLowerCase().includes('financiamento')) ? dados.categorias.find(c => c.nome.toLowerCase().includes('financiamento')).id : (dados.categorias[0] ? dados.categorias[0].id : 1));

    const novoFinanciamento = {
        id: novaId,
        usuarioId,
        nome,
        totalMeses: recorrente === 'sim' ? qtdMeses : 12,
        mesesPagos: 0
    };

    dados.financiamentos.push(novoFinanciamento);

    if (recorrente === 'sim' && qtdMeses > 0 && valorParcela > 0) {
        let proximaIdLanc = dados.lancamentos.length > 0 ? Number(dados.lancamentos[dados.lancamentos.length - 1].id) + 1 : 1;

        const [ano, mes, dia] = primeiroVencimento.split('-').map(Number);
        const dataBase = new Date(ano, mes - 1, dia);

        for (let i = 1; i <= qtdMeses; i++) {
            let dataVenc = new Date(dataBase.getFullYear(), dataBase.getMonth() + (i - 1), dataBase.getDate());
            
            const anoVenc = dataVenc.getFullYear();
            const mesVenc = String(dataVenc.getMonth() + 1).padStart(2, '0');
            const diaVenc = String(dataVenc.getDate()).padStart(2, '0');
            const dataVencStr = `${anoVenc}-${mesVenc}-${diaVenc}`;

            const novoLancamento = {
                id: proximaIdLanc++,
                usuarioId,
                descricao: `Financiamento: ${nome} (${i}/${qtdMeses})`,
                valor: Number(valorParcela.toFixed(2)),
                tipo: 'saida',
                categoriaId: catFinalId,
                formaPagamento: 'BOLETO',
                cartaoId: null,
                vencimento: dataVencStr,
                recorrencia: 'unica',
                parcelaAtual: i,
                totalParcelas: qtdMeses,
                observacao: 'Gerado automaticamente pelo contrato',
                horaExtra: 0,
                pago: false
            };

            dados.lancamentos.push(novoLancamento);
        }
    }

    await salvarDados(dados);
    await registrarLog("CADASTRO FINANCIAMENTO", `Contrato criado: ${nome} (${qtdMeses} meses)`);
}

async function prepararEdicaoFinanciamento(id) {
    if (!await verificarSenhaAdmin("editar financiamento")) return;
    
    const dados = obterDados();
    const financiamento = dados.financiamentos.find(f => Number(f.id) === Number(id));
    if (!financiamento) {
        alert("Financiamento não encontrado!");
        return;
    }

    const novoNome = await mostrarPromptModal("Editar Financiamento", `Novo nome para o financiamento (Atual: ${financiamento.nome}):`);
    if (novoNome === null || novoNome.trim() === "") return;

    const novoTotalMesesStr = await mostrarPromptModal("Editar Financiamento", `Nova quantidade total de meses (Atual: ${financiamento.totalMeses}):`);
    if (novoTotalMesesStr === null) return;

    const novoTotalMeses = parseInt(novoTotalMesesStr);
    if (isNaN(novoTotalMeses) || novoTotalMeses <= 0) {
        alert("Quantidade de meses inválida!");
        return;
    }

    financiamento.nome = novoNome.trim();
    financiamento.totalMeses = novoTotalMeses;

    await salvarDados(dados);
    await registrarLog("EDIÇÃO FINANCIAMENTO", `Contrato ID ${id} alterado para: ${novoNome} (${novoTotalMeses} meses)`);
    alert("Financiamento atualizado com sucesso!");
    
    if (typeof carregarRelatorios === 'function') {
        carregarRelatorios();
    }
}

async function excluirFinanciamento(id) {
    if (!await verificarSenhaAdmin("excluir financiamento")) return;

    const confirmar = await mostrarConfirmacaoModal("Deseja realmente excluir este contrato de financiamento e todas as suas parcelas associadas?");
    if (!confirmar) return;

    const dados = obterDados();
    const fin = dados.financiamentos.find(f => Number(f.id) === Number(id));
    
    if (fin) {
        // Remove o contrato da lista de financiamentos
        dados.financiamentos = dados.financiamentos.filter(f => Number(f.id) !== Number(id));
        
        // Remove também todos os lançamentos/parcelas associados a este financiamento específico
        dados.lancamentos = dados.lancamentos.filter(l => {
            const eFinanciamento = l.tipo === 'saida' && l.descricao.toLowerCase().includes(`financiamento: ${fin.nome.toLowerCase()}`);
            return !eFinanciamento;
        });

        await salvarDados(dados);
        await registrarLog("EXCLUSÃO FINANCIAMENTO", `Contrato ID ${id} (${fin.nome}) e suas parcelas foram excluídos`);
        alert("Financiamento e suas parcelas foram excluídos com sucesso!");

        if (typeof carregarRelatorios === 'function') {
            carregarRelatorios();
        }
    }
}
async function alternarStatusPagamento(id) {
    const dados = obterDados();
    const lancamento = dados.lancamentos.find(l => Number(l.id) === Number(id));
    
    if (!lancamento) return;

    lancamento.pago = !lancamento.pago;
    await salvarDados(dados);
    await registrarLog("STATUS PAGAMENTO", `Lançamento ID ${id} (${lancamento.descricao}) marcado como ${lancamento.pago ? 'PAGO' : 'PENDENTE'}`);

    if (typeof carregarRelatorios === 'function') {
        carregarRelatorios();
    }
    if (typeof carregarDashboard === 'function') {
        carregarDashboard();
    }
    if (typeof renderizarCartoes === 'function') {
        renderizarCartoes();
    }
}

// --- Dashboard com Filtro de Mês, Lembretes e Gráficos de Pizza ---
function carregarDashboard() {
    const dados = obterDados();
    
    const usuariosMap = {};
    dados.usuarios.forEach(u => {
        usuariosMap[u.id] = u.nome;
    });

    const filtroMesInput = document.getElementById('filtroMesAno');
    const mesAnoSelecionado = filtroMesInput ? filtroMesInput.value : '';

    const lancamentosFiltrados = dados.lancamentos.filter(l => {
        if (!mesAnoSelecionado) return true;
        return l.vencimento && l.vencimento.startsWith(mesAnoSelecionado);
    });

    let totalEntradas = 0;
    let totalSaidas = 0;

    lancamentosFiltrados.forEach(l => {
        if (l.tipo === 'entrada') totalEntradas += Number(l.valor);
        if (l.tipo === 'saida') totalSaidas += Number(l.valor);
    });

    document.getElementById('totalEntradas').innerText = `R$ ${totalEntradas.toFixed(2)}`;
    document.getElementById('totalSaidas').innerText = `R$ ${totalSaidas.toFixed(2)}`;
    
    const saldo = totalEntradas - totalSaidas;
    const elSaldo = document.getElementById('saldoGeral');
    elSaldo.innerText = `R$ ${saldo.toFixed(2)}`;
    elSaldo.className = saldo >= 0 ? 'positivo' : 'negativo';

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
        
        const proximos = dados.lancamentos
            .filter(l => {
                if (l.tipo !== 'saida' || l.pago || !l.vencimento) return false;
                return l.vencimento >= hojeStr && l.vencimento <= daqui30DiasStr;
            })
            .sort((a, b) => a.vencimento.localeCompare(b.vencimento));

        if (proximos.length === 0) {
            ulProximos.innerHTML = '<li>Nenhum pagamento pendente para os próximos 30 dias.</li>';
        } else {
            proximos.forEach(p => {
                const li = document.createElement('li');
                const [ano, mes, dia] = p.vencimento.split('-');
                const dataFormatada = `${dia}/${mes}/${ano}`;

                li.innerHTML = `
                    <span><strong>${p.descricao}</strong> (Vence em: ${dataFormatada})</span>
                    <strong class="negativo">R$ ${Number(p.valor).toFixed(2)}</strong>
                `;
                ulProximos.appendChild(li);
            });
        }
    }

    const tbody = document.getElementById('tabelaUltimosLancamentos');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (lancamentosFiltrados.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align: center;">Nenhum lançamento encontrado para este mês.</td></tr>`;
        return;
    }

    const ultimos = [...lancamentosFiltrados].reverse();
    ultimos.forEach(l => {
        const cat = dados.categorias.find(c => Number(c.id) === Number(l.categoriaId));
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${usuariosMap[l.usuarioId] || 'Desconhecido'}</td>
            <td>${l.descricao} ${l.horaExtra ? `<br><small style="color:#10b981;">(HE inclusa: R$ ${Number(l.horaExtra).toFixed(2)})</small>` : ''} ${l.observacao ? `<br><small style="color:#64748b;">Obs: ${l.observacao}</small>` : ''}</td>
            <td>${cat ? cat.nome : '-'}</td>
            <td>${l.vencimento}</td>
            <td class="${l.tipo === 'entrada' ? 'positivo' : 'negativo'}">R$ ${Number(l.valor).toFixed(2)}</td>
            <td>
                <button onclick="window.location.href='editar-lancamento.html?id=${l.id}'" style="background-color: #f59e0b; padding: 4px 8px; margin-right: 5px; width: auto; display: inline-block;">Editar</button>
                <button onclick="removerLancamento(${l.id})" style="background-color: #ef4444; padding: 4px 8px; width: auto; display: inline-block;">Excluir</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

let chartGastosCategoriasInstance = null;

function atualizarGraficosDashboard(totalEntradas, totalSaidas, dados) {
    const usuarioLogadoId = parseInt(localStorage.getItem('usuarioLogado'));

    // 1. Gráfico Entradas vs Saídas
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

    // 2. Gráfico de Gastos por Categoria (Baseado no mês filtrado do Dashboard)
    const filtroMesInput = document.getElementById('filtroMesAno');
    const mesAnoSelecionado = filtroMesInput ? filtroMesInput.value : '';

    const lancamentosPeriodo = dados.lancamentos.filter(l => {
        if (l.tipo !== 'saida') return false;
        if (!mesAnoSelecionado) return true;
        return l.vencimento && l.vencimento.startsWith(mesAnoSelecionado);
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

    // 3. Gráfico de Limite do Cartão
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

    const cartaoSelecionadoId = selectFiltroCartao ? selectF_cartao_val = selectFiltroCartao.value : 'todos';
    let totalLimiteGeral = 0;
    let totalUsadoGeral = 0;

    cartoesUsuario.forEach(cartao => {
        if (selectFiltroCartao.value === 'todos' || Number(cartao.id) === Number(selectFiltroCartao.value)) {
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

// --- Relatórios com Consolidação de Faturas de Cartão, Contas Pagas e Detalhamento ---
function carregarRelatorios() {
    const dados = obterDados();
    
    const filtroMesInput = document.getElementById('filtroMesAnoRelatorio');
    const mesAnoSelecionado = filtroMesInput ? filtroMesInput.value : '';

    const lancamentosFiltrados = dados.lancamentos.filter(l => {
        if (!mesAnoSelecionado) return true;
        return l.vencimento && l.vencimento.startsWith(mesAnoSelecionado);
    });

    const elTotalHe = document.getElementById('totalHoraExtraPeriodo');
    if (elTotalHe) {
        const totalHe = lancamentosFiltrados.reduce((acc, l) => acc + Number(l.horaExtra || 0), 0);
        elTotalHe.innerText = `R$ ${totalHe.toFixed(2)}`;
    }

    const divCat = document.getElementById('relatorioCategorias');
    if (divCat) {
        divCat.innerHTML = '';
        const gastosPorCat = {};

        lancamentosFiltrados.filter(l => l.tipo === 'saida').forEach(l => {
            gastosPorCat[l.categoriaId] = (gastosPorCat[l.categoriaId] || 0) + Number(l.valor);
        });

        if (Object.keys(gastosPorCat).length === 0) {
            divCat.innerHTML = '<p>Nenhum gasto registrado neste período.</p>';
        } else {
            for (let catId in gastosPorCat) {
                const cat = dados.categorias.find(c => Number(c.id) == Number(catId));
                const p = document.createElement('p');
                p.innerHTML = `<strong>${cat ? cat.nome : 'Outros'}:</strong> R$ ${gastosPorCat[catId].toFixed(2)}`;
                divCat.appendChild(p);
            }
        }
    }

    const tbodyParcelas = document.getElementById('tabelaParcelamentos');
    if (tbodyParcelas) {
        tbodyParcelas.innerHTML = '';
        const parcelasMes = lancamentosFiltrados.filter(l => l.formaPagamento === 'CARTAO' && l.totalParcelas > 1);
        
        if (parcelasMes.length === 0) {
            tbodyParcelas.innerHTML = `<tr><td colspan="4" style="text-align: center;">Nenhum parcelamento neste período.</td></tr>`;
        } else {
            parcelasMes.forEach(l => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${l.descricao} ${l.observacao ? `<br><small style="color:#64748b;">Obs: ${l.observacao}</small>` : ''}</td>
                    <td><strong>${l.parcelaAtual}</strong> / ${l.totalParcelas}</td>
                    <td>R$ ${Number(l.valor).toFixed(2)}</td>
                    <td>${l.vencimento}</td>
                `;
                tbodyParcelas.appendChild(tr);
            });
        }
    }

    const divFin = document.getElementById('listaFinanciamentos');
    if (divFin) {
        divFin.innerHTML = '';
        if (!dados.financiamentos || dados.financiamentos.length === 0) {
            divFin.innerHTML = '<p>Nenhum financiamento cadastrado.</p>';
        } else {
            dados.financiamentos.forEach(f => {
                const parcelasPagasReais = dados.lancamentos.filter(l => 
                    l.tipo === 'saida' && 
                    l.descricao.toLowerCase().includes(`financiamento: ${f.nome.toLowerCase()}`) && 
                    l.pago === true
                ).length;

                const box = document.createElement('div');
                box.className = 'stat-box';
                box.style.marginBottom = '12px';
                box.style.textAlign = 'left';
                box.innerHTML = `
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; flex-wrap: wrap;">
                        <div>
                            <h3 style="margin-bottom: 4px;">${f.nome}</h3>
                            <p style="font-size: 0.95rem; font-weight: normal;">Progresso: <strong>${parcelasPagasReais}</strong> / ${f.totalMeses} meses pagos</p>
                        </div>
                        <div style="display: flex; gap: 6px;">
                            <button onclick="window.location.href='detalhes-financiamento.html?id=${f.id}'" style="background-color: #3b82f6; padding: 6px 12px; font-size: 0.85rem;">Visualizar</button>
                            <button onclick="excluirFinanciamento(${f.id})" style="background-color: #ef4444; padding: 6px 12px; font-size: 0.85rem;">Excluir</button>
                        </div>
                    </div>
                `;
                divFin.appendChild(box);
            });
        }
    }

    // --- Consolidação de Contas, Boletos e Faturas de Cartão ---
    const tbodyContas = document.getElementById('tabelaContasAPagar');
    const tbodyContasPagas = document.getElementById('tabelaContasPagas');
    
    if (tbodyContas && tbodyContasPagas) {
        tbodyContas.innerHTML = '';
        tbodyContasPagas.innerHTML = '';

        const todasSaidas = dados.lancamentos.filter(l => l.tipo === 'saida' && l.vencimento);

        const contasNormais = todasSaidas.filter(l => l.formaPagamento !== 'CARTAO' && (
            !mesAnoSelecionado || l.vencimento.startsWith(mesAnoSelecionado) || (!l.pago && l.vencimento < `${mesAnoSelecionado}-01`)
        ));

        const faturasConsolidadasMap = {};
        
        todasSaidas.filter(l => l.formaPagamento === 'CARTAO' && l.cartaoId).forEach(l => {
            const cartao = dados.cartoes.find(c => Number(c.id) === Number(l.cartaoId));
            const nomeCartao = cartao ? cartao.nome : 'Cartão Desconhecido';
            const mesVencimentoFatura = l.vencimento.substring(0, 7); // YYYY-MM

            if (mesAnoSelecionado && mesVencimentoFatura !== mesAnoSelecionado && l.pago) return;
            if (mesAnoSelecionado && !l.pago && mesVencimentoFatura > mesAnoSelecionado) return;

            const chaveFatura = `${l.cartaoId}_${mesVencimentoFatura}`;

            if (!faturasConsolidadasMap[chaveFatura]) {
                faturasConsolidadasMap[chaveFatura] = {
                    idVirtual: chaveFatura,
                    cartaoId: l.cartaoId,
                    nomeCartao: nomeCartao,
                    vencimento: l.vencimento,
                    valorTotal: 0,
                    pago: true,
                    itens: []
                };
            }

            faturasConsolidadasMap[chaveFatura].valorTotal += Number(l.valor);
            faturasConsolidadasMap[chaveFatura].itens.push(l);
            if (!l.pago) {
                faturasConsolidadasMap[chaveFatura].pago = false;
            }
        });

        const listaFaturas = Object.values(faturasConsolidadasMap);
        const itensPendentes = [...contasNormais.filter(l => !l.pago), ...listaFaturas.filter(f => !f.pago)];
        const itensPagos = [...contasNormais.filter(l => l.pago), ...listaFaturas.filter(f => f.pago)];

        if (itensPendentes.length === 0) {
            tbodyContas.innerHTML = `<tr><td colspan="4" style="text-align: center;">Nenhuma conta ou fatura pendente.</td></tr>`;
        } else {
            itensPendentes.sort((a, b) => a.vencimento.localeCompare(b.vencimento));
            itensPendentes.forEach(item => {
                const tr = document.createElement('tr');
                const [ano, mes, dia] = item.vencimento.split('-');
                const dataFormatada = `${dia}/${mes}/${ano}`;

                if (item.nomeCartao) {
                    tr.innerHTML = `
                        <td><strong>Fatura - ${item.nomeCartao}</strong></td>
                        <td>${dataFormatada}</td>
                        <td class="negativo">R$ ${item.valorTotal.toFixed(2)}</td>
                        <td>
                            <button onclick="abrirDetalhamentoFatura('${item.cartaoId}', '${item.vencimento.substring(0, 7)}')" style="background-color: #3b82f6; padding: 5px 10px; font-size: 0.85rem; margin-right: 5px;">Detalhamento</button>
                            <button onclick="alternarStatusFaturaConsolidada('${item.cartaoId}', '${item.vencimento.substring(0, 7)}', true)" style="background-color: #10b981; padding: 5px 10px; font-size: 0.85rem; margin-right: 5px;">Marcar Fatura Paga</button>
                        </td>
                    `;
                } else {
                    tr.innerHTML = `
                        <td>${item.descricao} ${item.observacao ? `<br><small style="color:#64748b;">Obs: ${item.observacao}</small>` : ''}</td>
                        <td>${dataFormatada}</td>
                        <td>R$ ${Number(item.valor).toFixed(2)}</td>
                        <td>
                            <button onclick="alternarStatusPagamento(${item.id})" style="background-color: #10b981; padding: 5px 10px; font-size: 0.85rem; margin-right: 5px;">Marcar Pago</button>
                            <button onclick="removerLancamentoRelatorio(${item.id})" style="background-color: #ef4444; padding: 5px 10px; font-size: 0.85rem;">Excluir</button>
                        </td>
                    `;
                }
                tbodyContas.appendChild(tr);
            });
        }

        if (itensPagos.length === 0) {
            tbodyContasPagas.innerHTML = `<tr><td colspan="4" style="text-align: center;">Nenhuma conta ou fatura paga neste período.</td></tr>`;
        } else {
            itensPagos.sort((a, b) => a.vencimento.localeCompare(b.vencimento));
            itensPagos.forEach(item => {
                const tr = document.createElement('tr');
                const [ano, mes, dia] = item.vencimento.split('-');
                const dataFormatada = `${dia}/${mes}/${ano}`;
                const estiloLinha = 'opacity: 0.7;';

                if (item.nomeCartao) {
                    tr.innerHTML = `
                        <td style="${estiloLinha}"><strong>Fatura - ${item.nomeCartao}</strong></td>
                        <td style="${estiloLinha}">${dataFormatada}</td>
                        <td class="positivo" style="${estiloLinha}">R$ ${item.valorTotal.toFixed(2)}</td>
                        <td>
                            <button onclick="abrirDetalhamentoFatura('${item.cartaoId}', '${item.vencimento.substring(0, 7)}')" style="background-color: #3b82f6; padding: 5px 10px; font-size: 0.85rem; margin-right: 5px;">Detalhamento</button>
                            <button onclick="alternarStatusFaturaConsolidada('${item.cartaoId}', '${item.vencimento.substring(0, 7)}', false)" style="background-color: #64748b; padding: 5px 10px; font-size: 0.85rem;">Marcar Pendente</button>
                        </td>
                    `;
                } else {
                    tr.innerHTML = `
                        <td style="${estiloLinha}">${item.descricao}</td>
                        <td style="${estiloLinha}">${dataFormatada}</td>
                        <td style="${estiloLinha}">R$ ${Number(item.valor).toFixed(2)}</td>
                        <td>
                            <button onclick="alternarStatusPagamento(${item.id})" style="background-color: #64748b; padding: 5px 10px; font-size: 0.85rem; margin-right: 5px;">Desfazer</button>
                            <button onclick="removerLancamentoRelatorio(${item.id})" style="background-color: #ef4444; padding: 5px 10px; font-size: 0.85rem;">Excluir</button>
                        </td>
                    `;
                }
                tbodyContasPagas.appendChild(tr);
            });
        }
    }
}

async function alternarStatusFaturaConsolidada(cartaoId, anoMes, statusPago) {
    const dados = obterDados();
    dados.lancamentos.forEach(l => {
        if (Number(l.cartaoId) === Number(cartaoId) && l.vencimento && l.vencimento.startsWith(anoMes)) {
            l.pago = statusPago;
        }
    });
    await salvarDados(dados);
    await registrarLog("STATUS FATURA", `Fatura do cartão ID ${cartaoId} (${anoMes}) marcada como ${statusPago ? 'PAGA' : 'PENDENTE'}`);
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
                    <td>${item.totalParcelas > 1 ? `${item.parcelaAtual}/${item.totalParcelas}` : 'À vista'}</td>
                    <td>R$ ${Number(item.valor).toFixed(2)}</td>
                    <td>${item.vencimento}</td>
                </tr>
            `;
        });
    }

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
        <div class="modal-box" style="max-width: 600px; width: 95%;">
            <h3>Detalhamento da Fatura: ${nomeCartao}</h3>
            <p style="margin-bottom: 14px; font-size: 0.9rem;">Competência: ${anoMes}</p>
            
            <div class="tabela-container" style="max-height: 300px; overflow-y: auto; margin-bottom: 20px;">
                <table class="tabela">
                    <thead>
                        <tr>
                            <th>Descrição</th>
                            <th>Parcela</th>
                            <th>Valor</th>
                            <th>Vencimento / Fatura</th>
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

async function removerLancamento(id) {
    const confirmar = await mostrarConfirmacaoModal('Deseja realmente excluir este lançamento?');
    if (confirmar) {
        const dados = obterDados();
        const lanc = dados.lancamentos.find(l => Number(l.id) === Number(id));
        dados.lancamentos = dados.lancamentos.filter(l => Number(l.id) !== Number(id));
        await salvarDados(dados);
        await registrarLog("EXCLUSÃO LANÇAMENTO", `Lançamento ID ${id} (${lanc ? lanc.descricao : 'N/A'}) excluído`);
        carregarDashboard();
    }
}

async function removerLancamentoRelatorio(id) {
    const confirmar = await mostrarConfirmacaoModal('Deseja realmente excluir este lançamento?');
    if (confirmar) {
        const dados = obterDados();
        const lanc = dados.lancamentos.find(l => Number(l.id) === Number(id));
        dados.lancamentos = dados.lancamentos.filter(l => Number(l.id) !== Number(id));
        await salvarDados(dados);
        await registrarLog("EXCLUSÃO LANÇAMENTO", `Lançamento ID ${id} (${lanc ? lanc.descricao : 'N/A'}) excluído`);
        carregarRelatorios();
    }
}