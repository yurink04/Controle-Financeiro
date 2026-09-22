const DB_KEY = 'sistemaFinanceiroCompartilhado';
const BACKUP_TESTE_KEY = 'sistemaFinanceiroBackupTeste';
const API_URL = "https://script.google.com/macros/s/AKfycbxsGdyzSH-XmWepLo_y7sEN05xBz8-wpxKYEpzJR3-JZB3mXtIWR_brdVSeZGAbaYbZ/exec";
const TOKEN_API = "PLANOF1NALPRAS4AIRD@MERDA"; 
const SENHA_ADMIN_EXCLUSAO = "praia22";

let chartEntradasSaidasInstance = null;
let chartGastosCategoriasInstance = null;
let chartCartoesLimiteInstance = null;
let chartRelatorioESInstance = null;
let chartRelatorioCatInstance = null;
let chartServicosEssenciaisInstance = null;

// Trava global para evitar duplo envio/duplicação em modais e caixas de diálogo
let processandoAcaoModal = false;

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

// --- Tela de Carregamento (Loading) ---
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
    if (!localStorage.getItem(DB_KEY)) {
        const dadosIniciais = {
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
            logs: [],
            exclusao_movimento: [],
            edicao_movimento: []
        };
        localStorage.setItem(DB_KEY, JSON.stringify(dadosIniciais));
    }
}

let memoriaSistema = JSON.parse(localStorage.getItem(DB_KEY)) || {
    usuarios: [
        { id: 1, nome: "Samuel", senha: "" }, 
        { id: 2, nome: "Mariana", senha: "" }, 
        { id: 3, nome: "TESTE", senha: "" }
    ],
    categorias: [],
    cartoes: [],
    lancamentos: [],
    financiamentos: [],
    logs: [],
    exclusao_movimento: [],
    edicao_movimento: []
};

function obterDados() {
    const dadosLocal = localStorage.getItem(DB_KEY);
    if (dadosLocal) {
        const parsed = JSON.parse(dadosLocal);
        if (!parsed.logs) parsed.logs = [];
        if (!parsed.exclusao_movimento) parsed.exclusao_movimento = [];
        if (!parsed.edicao_movimento) parsed.edicao_movimento = [];
        return parsed;
    }
    if (!memoriaSistema.logs) memoriaSistema.logs = [];
    if (!memoriaSistema.exclusao_movimento) memoriaSistema.exclusao_movimento = [];
    if (!memoriaSistema.edicao_movimento) memoriaSistema.edicao_movimento = [];
    return memoriaSistema;
}

async function salvarDados(dados) {
    const usuarioId = localStorage.getItem('usuarioLogado');
    const usuarioObj = dados.usuarios.find(u => u.id == usuarioId);
    
    if (usuarioObj && usuarioObj.nome.toUpperCase() === 'TESTE') {
        return;
    }

    memoriaSistema = dados;
    localStorage.setItem(DB_KEY, JSON.stringify(dados));
    
    fetch(API_URL, {
        method: "POST",
        mode: "no-cors",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ 
            action: "salvarDados", 
            token: TOKEN_API, 
            dados: dados 
        })
    }).catch(e => {
        console.error("Erro ao sincronizar em segundo plano com o Google Sheets:", e);
    });
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

// --- Seleção de Usuário com Verificação Automática de PIN ---
async function selecionarUsuario(id) {
    const dados = obterDados();
    const usuario = dados.usuarios.find(u => Number(u.id) === Number(id));
    
    if (!usuario) {
        return;
    }

    if (usuario.senha !== undefined && usuario.senha !== null && String(usuario.senha).trim() !== "") {
        const senhaDigitada = await mostrarPromptModal("Verificação de PIN", `Digite o PIN de acesso para ${usuario.nome}:`, usuario.senha);
        if (senhaDigitada === null) return;
    }

    mostrarLoading("Entrando no sistema...");

    localStorage.setItem('usuarioLogado', id);

    if (usuario.nome.toUpperCase() === 'TESTE') {
        localStorage.setItem(BACKUP_TESTE_KEY, JSON.stringify(dados));
    }

    fetch(`${API_URL}?action=obterDados&token=${TOKEN_API}`)
        .then(res => res.json())
        .then(dadosRemotos => {
            if (dadosRemotos && dadosRemotos.usuarios) {
                localStorage.setItem(DB_KEY, JSON.stringify(dadosRemotos));
            }
        }).catch(e => {
            console.warn("Aviso ao atualizar dados remotos em segundo plano:", e);
        });

    esconderLoading();
    window.location.href = 'dashboard.html';
}

function deslogarSistema() {
    const usuarioId = localStorage.getItem('usuarioLogado');
    if (usuarioId) {
        const dados = obterDados();
        const usuario = dados.usuarios.find(u => Number(u.id) === Number(usuarioId));
        
        if (usuario && usuario.nome.toUpperCase() === 'TESTE') {
            const backup = localStorage.getItem(BACKUP_TESTE_KEY);
            if (backup) {
                localStorage.setItem(DB_KEY, backup);
                localStorage.removeItem(BACKUP_TESTE_KEY);
            } else {
                localStorage.removeItem(DB_KEY);
            }
        }
    }

    localStorage.removeItem('usuarioLogado');
    sessionStorage.removeItem('adminAutorizado');
    window.location.href = 'index.html';
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

// --- Modais Customizados com PIN Automático e Trava de Submissão Única ---
function mostrarConfirmacaoModal(mensagem) {
    return new Promise((resolve) => {
        if (processandoAcaoModal) return;
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="modal-box">
                <h3>Confirmação</h3>
                <p>${mensagem}</p>
                <div class="modal-buttons">
                    <button id="btnNaoModal">Cancelar</button>
                    <button id="btnSimModal">Confirmar</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        const finalizar = (val) => {
            overlay.remove();
            resolve(val);
        };

        document.getElementById('btnSimModal').onclick = () => finalizar(true);
        document.getElementById('btnNaoModal').onclick = () => finalizar(false);
    });
}

function mostrarPromptModal(titulo, descricao, senhaCorreta = null) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="modal-box" style="text-align: center;">
                <h3>${titulo}</h3>
                <p>${descricao}</p>
                <input type="password" id="inputModalValor" placeholder="••••" maxlength="6" autofocus style="text-align: center; font-size: 1.5rem; letter-spacing: 8px; width: 150px; margin: 15px auto;">
                <div class="modal-buttons" style="justify-content: center; margin-top: 10px;">
                    <button id="btnCancelarPrompt" style="background-color: #64748b; flex: 1; max-width: 150px;">Cancelar</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        const input = document.getElementById('inputModalValor');
        input.focus();

        const finalizar = (val) => {
            if (processandoAcaoModal) return;
            processandoAcaoModal = true;
            overlay.remove();
            setTimeout(() => { processandoAcaoModal = false; }, 300);
            resolve(val);
        };

        input.oninput = () => {
            const digitado = input.value.trim();
            if (senhaCorreta !== null && senhaCorreta !== undefined && senhaCorreta !== "") {
                if (digitado === String(senhaCorreta).trim()) {
                    finalizar(digitado);
                }
            }
        };

        document.getElementById('btnCancelarPrompt').onclick = () => finalizar(null);
        input.onkeydown = (e) => {
            if (e.key === 'Escape') finalizar(null);
        };
    });
}

function mostrarPromptTextoModal(titulo, descricao) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="modal-box">
                <h3>${titulo}</h3>
                <p>${descricao}</p>
                <input type="text" id="inputModalTextoMotivo" placeholder="Digite o motivo obrigatório..." autofocus style="width: 100%; padding: 8px; margin-top: 10px; border: 1px solid var(--border); border-radius: 4px;">
                <div class="modal-buttons" style="margin-top: 15px;">
                    <button id="btnCancelarPromptTexto">Cancelar</button>
                    <button id="btnOkPromptTexto" style="background-color: var(--primary); color: #fff;">Confirmar</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        const input = document.getElementById('inputModalTextoMotivo');
        input.focus();

        const finalizar = (val) => {
            if (processandoAcaoModal) return;
            processandoAcaoModal = true;
            overlay.remove();
            setTimeout(() => { processandoAcaoModal = false; }, 300);
            resolve(val);
        };

        const acaoConfirmar = () => {
            const val = input.value.trim();
            if (!val) {
                alert("O preenchimento do motivo é obrigatório!");
                return;
            }
            finalizar(val);
        };

        document.getElementById('btnOkPromptTexto').onclick = acaoConfirmar;
        document.getElementById('btnCancelarPromptTexto').onclick = () => finalizar(null);
        
        input.onkeydown = (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                acaoConfirmar();
            }
            if (e.key === 'Escape') finalizar(null);
        };
    });
}

function mostrarAlertaModal(mensagem) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="modal-box" style="text-align: center;">
                <h3>Aviso</h3>
                <p style="margin: 15px 0; text-align: center;">${mensagem}</p>
                <div class="modal-buttons" style="justify-content: center;">
                    <button id="btnOkAlerta" style="flex: 1; max-width: 200px;">OK</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        const finalizar = () => {
            overlay.remove();
            resolve(true);
        };

        document.getElementById('btnOkAlerta').onclick = finalizar;
        
        const handleKeyDown = (e) => {
            if (e.key === 'Enter' || e.key === 'Escape') {
                document.removeEventListener('keydown', handleKeyDown);
                finalizar();
            }
        };
        document.addEventListener('keydown', handleKeyDown);
    });
}

async function verificarSenhaAdmin(nomeSecao = "esta seção") {
    const usuarioId = localStorage.getItem('usuarioLogado');
    const dadosCheck = obterDados();
    const usuarioObj = dadosCheck.usuarios.find(u => u.id == usuarioId);
    if (usuarioObj && usuarioObj.nome.toUpperCase() === 'TESTE') {
        return true;
    }

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
        await mostrarAlertaModal('Senha de administrador incorreta!');
        return false;
    }
}

async function adicionarCategoria(nome, tipo) {
    if (processandoAcaoModal) return;
    if (!await verificarSenhaAdmin("cadastrar categoria")) return;
    
    processandoAcaoModal = true;
    mostrarLoading("Cadastrando categoria...");
    const dados = obterDados();
    const novaId = dados.categorias.length > 0 ? Number(dados.categorias[dados.categorias.length - 1].id) + 1 : 1;
    dados.categorias.push({ id: novaId, nome, tipo });
    
    await salvarDados(dados);
    await registrarLog("CADASTRO CATEGORIA", `Categoria criada: ${nome} (${tipo})`);
    
    esconderLoading();
    processandoAcaoModal = false;
    await mostrarAlertaModal("Categoria cadastrada com sucesso!");
    if (typeof renderizarCategorias === 'function') renderizarCategorias();
}

async function atualizarCategoria(id, nome, tipo) {
    if (processandoAcaoModal) return;
    if (!await verificarSenhaAdmin("editar categoria")) return;
    
    processandoAcaoModal = true;
    mostrarLoading("Atualizando categoria...");
    const dados = obterDados();
    const categoria = dados.categorias.find(c => Number(c.id) === Number(id));
    if (categoria) {
        categoria.nome = nome;
        categoria.tipo = tipo;
        await salvarDados(dados);
        await registrarLog("EDIÇÃO CATEGORIA", `Categoria ID ${id} alterada para: ${nome} (${tipo})`);
        
        esconderLoading();
        processandoAcaoModal = false;
        await mostrarAlertaModal("Categoria atualizada com sucesso!");
        if (typeof renderizarCategorias === 'function') renderizarCategorias();
    } else {
        esconderLoading();
        processandoAcaoModal = false;
    }
}

async function excluirCategoria(id) {
    if (processandoAcaoModal) return;
    if (!await verificarSenhaAdmin("excluir categoria")) return;
    
    processandoAcaoModal = true;
    mostrarLoading("Excluindo categoria...");
    const dados = obterDados();
    dados.categorias = dados.categorias.filter(c => Number(c.id) !== Number(id));
    await salvarDados(dados);
    await registrarLog("EXCLUSÃO CATEGORIA", `Categoria ID ${id} excluída`);
    
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

// --- Gestão de Cartões e Benefícios (VR / VA) ---
async function adicionarCartao(nome, limiteTotal, fechamento, vencimento, tipoCartao = 'credito') {
    if (processandoAcaoModal) return;
    if (!await verificarSenhaAdmin("cadastrar cartão")) return;
    
    processandoAcaoModal = true;
    mostrarLoading("Salvando cartão...");
    const dados = obterDados();
    const usuarioId = parseInt(localStorage.getItem('usuarioLogado'));
    const novaId = dados.cartoes.length > 0 ? Number(dados.cartoes[dados.cartoes.length - 1].id) + 1 : 1;
    
    dados.cartoes.push({ 
        id: novaId, 
        usuarioId, 
        nome, 
        limiteTotal: Number(limiteTotal), 
        fechamento: Number(fechamento),
        vencimento: Number(vencimento),
        tipoCartao: tipoCartao // 'credito' ou 'beneficio' (VR/VA)
    });
    
    await salvarDados(dados);
    await registrarLog("CADASTRO CARTÃO", `Cartão criado: ${nome} (${tipoCartao}), Valor Inicial/Limite: R$ ${limiteTotal}`);
    
    esconderLoading();
    processandoAcaoModal = false;
    await mostrarAlertaModal("Cartão/Benefício cadastrado com sucesso!");
    if (typeof renderizarCartoes === 'function') renderizarCartoes();
}

function renderizarCartoes() {
    const dados = obterDados();
    const grid = document.getElementById('gridCartoes');
    if (!grid) return;
    grid.innerHTML = '';

    if (dados.cartoes.length === 0) {
        grid.innerHTML = '<p>Nenhum cartão ou benefício cadastrado.</p>';
        return;
    }

    dados.cartoes.forEach(cartao => {
        const isBeneficio = cartao.tipoCartao === 'beneficio';
        
        const gastosUtilizados = dados.lancamentos
            .filter(l => Number(l.cartaoId) === Number(cartao.id) && !l.pago)
            .reduce((acc, l) => acc + Number(l.valor), 0);

        let infoHtml = '';
        if (isBeneficio) {
            const saldoAtual = Number(cartao.limiteTotal) - gastosUtilizados;
            infoHtml = `
                <p style="font-size: 0.85rem; font-weight: normal; margin-bottom: 4px;">Tipo: <strong>Vale-Alimentação / Refeição (VR/VA)</strong></p>
                <p style="font-size: 0.95rem; margin-top: 6px;">Carga Mensal: R$ ${Number(cartao.limiteTotal).toFixed(2)}</p>
                <p style="font-size: 0.95rem;" class="negativo">Gasto no Mês: R$ ${gastosUtilizados.toFixed(2)}</p>
                <p style="font-size: 0.95rem;" class="positivo">Saldo Disponível: R$ ${saldoAtual.toFixed(2)}</p>
            `;
        } else {
            const disponivel = Number(cartao.limiteTotal) - gastosUtilizados;
            infoHtml = `
                <p style="font-size: 0.85rem; font-weight: normal; margin-bottom: 4px;">Fechamento: dia ${cartao.fechamento} | Vencimento: dia ${cartao.vencimento}</p>
                <p style="font-size: 0.95rem; margin-top: 6px;">Limite Total: R$ ${Number(cartao.limiteTotal).toFixed(2)}</p>
                <p style="font-size: 0.95rem;" class="negativo">Utilizado: R$ ${gastoUtilizado.toFixed(2)}</p>
                <p style="font-size: 0.95rem;" class="positivo">Disponível: R$ ${disponivel.toFixed(2)}</p>
            `;
        }

        const box = document.createElement('div');
        box.className = 'stat-box';
        box.style.textAlign = 'left';
        box.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
                <h3 style="margin: 0; font-size: 1rem; color: var(--accent);">${cartao.nome}</h3>
                <div style="display: flex; gap: 4px;">
                    <button onclick="excluirCartao(${cartao.id})" class="btn-acao-icone excluir" title="Excluir"><img src="imagens/excluir.png" alt="Excluir"></button>
                </div>
            </div>
            ${infoHtml}
        `;
        grid.appendChild(box);
    });
}

async function atualizarCartaoNoBanco(id, nome, limiteTotal, fechamento, vencimento) {
    if (processandoAcaoModal) return;
    if (!await verificarSenhaAdmin("editar cartão")) return;
    
    processandoAcaoModal = true;
    mostrarLoading("Atualizando cartão...");
    const dados = obterDados();
    const cartao = dados.cartoes.find(c => Number(c.id) === Number(id));
    
    if (cartao) {
        cartao.nome = nome;
        cartao.limiteTotal = Number(limiteTotal);
        cartao.fechamento = Number(fechamento);
        cartao.vencimento = Number(vencimento);
        
        await salvarDados(dados);
        await registrarLog("EDIÇÃO CARTÃO", `Cartão ID ${id} atualizado para: ${nome}`);
        
        esconderLoading();
        processandoAcaoModal = false;
        await mostrarAlertaModal("Cartão atualizado com sucesso!");
        if (typeof renderizarCartoes === 'function') renderizarCartoes();
    } else {
        esconderLoading();
        processandoAcaoModal = false;
    }
}

async function excluirCartao(id) {
    if (processandoAcaoModal) return;
    if (!await verificarSenhaAdmin("excluir cartão")) return;
    const confirmar = await mostrarConfirmacaoModal("Deseja realmente excluir este cartão?");
    if (!confirmar) return;

    processandoAcaoModal = true;
    mostrarLoading("Excluindo cartão...");
    const dados = obterDados();
    dados.cartoes = dados.cartoes.filter(c => Number(c.id) !== Number(id));
    
    await salvarDados(dados);
    await registrarLog("EXCLUSÃO CARTÃO", `Cartão ID ${id} excluído`);
    
    esconderLoading();
    processandoAcaoModal = false;
    await mostrarAlertaModal("Cartão excluído com sucesso!");
    if (typeof renderizarCartoes === 'function') renderizarCartoes();
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

function tratarMudancaTipoLancamento() {
    const tipo = document.getElementById('tipoLancamento').value;
    atualizarFiltroCategoriasPorTipo(tipo);
    
    const blocoHE = document.getElementById('blocoHoraExtra');
    const blocoFormaPgto = document.getElementById('blocoFormaPagamentoContainer');
    const blocoCartao = document.getElementById('blocoCartao');
    const blocoEssencial = document.getElementById('blocoServicoEssencial');
    const labelData = document.getElementById('labelDataReferencia');

    if (tipo === 'entrada') {
        if (blocoHE) blocoHE.style.display = 'block';
        if (blocoFormaPgto) blocoFormaPgto.style.display = 'none';
        if (blocoCartao) blocoCartao.style.display = 'none';
        if (blocoEssencial) blocoEssencial.style.display = 'none';
        if (labelData) labelData.innerText = 'Data de Recebimento:';
    } else {
        if (blocoHE) blocoHE.style.display = 'none';
        const inputHE = document.getElementById('valorHoraExtra');
        if (inputHE) inputHE.value = '0';
        if (blocoFormaPgto) blocoFormaPgto.style.display = 'block';
        if (blocoEssencial) blocoEssencial.style.display = 'block';
        if (labelData) labelData.innerText = 'Data de Vencimento / Referência:';
        if (typeof tratarMudancaFormaPagamento === 'function') {
            tratarMudancaFormaPagamento();
        }
    }
}

async function adicionarLancamentoComParcelas(dadosForm) {
    if (processandoAcaoModal) return;
    processandoAcaoModal = true;
    mostrarLoading("Salvando lançamento...");
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
            servicoEssencial: dadosForm.tipo === 'saida' ? (dadosForm.servicoEssencial || 'nao') : 'nao',
            pago: dadosForm.tipo === 'entrada' ? true : false
        };

        dados.lancamentos.push(novoLancamento);
    }

    salvarMemoriaAdiantamentoSeNecessario(dadosForm.descricao, valorParcela);

    await salvarDados(dados);
    await registrarLog("NOVO LANÇAMENTO", `Lançamento criado: ${dadosForm.descricao}, Valor: R$ ${valorParcela} (${qtdGerar}x)`);
    
    esconderLoading();
    processandoAcaoModal = false;
    await mostrarAlertaModal("Lançamento cadastrado com sucesso!");
    if (typeof carregarDashboard === 'function') carregarDashboard();
    if (typeof carregarRelatorios === 'function') carregarRelatorios();
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
        lancamento.valor = Number(novosDados.valor);
        lancamento.observacao = novosDados.observacao;
        lancamento.vencimento = novosDados.vencimento;
        lancamento.servicoEssencial = novosDados.tipo === 'saida' ? (novosDados.servicoEssencial || 'nao') : 'nao';
        
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

        await salvarDados(dados);
        await registrarLog("EDIÇÃO LANÇAMENTO", `Lançamento ID ${id} atualizado. Motivo: ${motivo}`);
        
        esconderLoading();
        await mostrarAlertaModal("Lançamento atualizado com sucesso!");
        if (typeof carregarDashboard === 'function') carregarDashboard();
        if (typeof carregarRelatorios === 'function') carregarRelatorios();
    } else {
        esconderLoading();
    }
}

async function adicionarFinanciamentoComRecorrencia(nome, recorrente, valorParcela, qtdMeses, primeiroVencimento, categoriaId = null) {
    if (processandoAcaoModal) return;
    if (!await verificarSenhaAdmin("cadastrar contrato de financiamento")) return;
    
    processandoAcaoModal = true;
    mostrarLoading("Cadastrando financiamento...");
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
                servicoEssencial: 'nao',
                pago: false
            };

            dados.lancamentos.push(novoLancamento);
        }
    }

    await salvarDados(dados);
    await registrarLog("CADASTRO FINANCIAMENTO", `Contrato criado: ${nome} (${qtdMeses} meses)`);
    
    esconderLoading();
    processandoAcaoModal = false;
    await mostrarAlertaModal("Financiamento cadastrado com sucesso!");
    if (typeof carregarRelatorios === 'function') carregarRelatorios();
}

async function excluirFinanciamento(id) {
    if (processandoAcaoModal) return;
    if (!await verificarSenhaAdmin("excluir financiamento")) return;

    const confirmar = await mostrarConfirmacaoModal("Deseja realmente excluir este contrato de financiamento e todas as suas parcelas associadas?");
    if (!confirmar) return;

    processandoAcaoModal = true;
    mostrarLoading("Excluindo financiamento...");
    const dados = obterDados();
    const fin = dados.financiamentos.find(f => Number(f.id) === Number(id));
    
    if (fin) {
        dados.financiamentos = dados.financiamentos.filter(f => Number(f.id) !== Number(id));
        
        dados.lancamentos = dados.lancamentos.filter(l => {
            const eFinanciamento = l.tipo === 'saida' && l.descricao.toLowerCase().includes(`financiamento: ${fin.nome.toLowerCase()}`);
            return !eFinanciamento;
        });

        await salvarDados(dados);
        await registrarLog("EXCLUSÃO FINANCIAMENTO", `Contrato ID ${id} (${fin.nome}) e suas parcelas foram excluídos`);
        
        esconderLoading();
        processandoAcaoModal = false;
        await mostrarAlertaModal("Financiamento e suas parcelas foram excluídos com sucesso!");
        if (typeof carregarRelatorios === 'function') carregarRelatorios();
    } else {
        esconderLoading();
        processandoAcaoModal = false;
    }
}

async function alternarStatusPagamento(id) {
    mostrarLoading("Atualizando status...");
    const dados = obterDados();
    const lancamento = dados.lancamentos.find(l => Number(l.id) === Number(id));
    
    if (!lancamento) {
        esconderLoading();
        return;
    }

    lancamento.pago = !lancamento.pago;
    await salvarDados(dados);
    await registrarLog("STATUS PAGAMENTO", `Lançamento ID ${id} (${lancamento.descricao}) marcado como ${lancamento.pago ? 'PAGO' : 'PENDENTE'}`);

    esconderLoading();
    if (typeof carregarRelatorios === 'function') carregarRelatorios();
    if (typeof carregarDashboard === 'function') carregarDashboard();
    if (typeof renderizarCartoes === 'function') renderizarCartoes();
}

// --- Dashboard com Filtro de Mês, Lembretes e Gráficos ---
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

    document.getElementById('totalEntradas').innerText = `R$ ${totalEntradas.toFixed(2)}`;
    document.getElementById('totalSaidas').innerText = `R$ ${totalSaidas.toFixed(2)}`;
    
    const elSaidasCartao = document.getElementById('saidasCartao');
    const elSaidasOutros = document.getElementById('saidasOutros');
    if (elSaidasCartao) elSaidasCartao.innerText = `R$ ${totalSaidasCartao.toFixed(2)}`;
    if (elSaidasOutros) elSaidasOutros.innerText = `R$ ${totalSaidasOutros.toFixed(2)}`;
    
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

// --- Relatórios com Consolidação Completa ---
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

    const canvasRelES = document.getElementById('graficoRelatorioEntradasSaidas');
    if (canvasRelES) {
        if (chartRelatorioESInstance) chartRelatorioESInstance.destroy();
        chartRelatorioESInstance = new Chart(canvasRelES, {
            type: 'pie',
            data: {
                labels: ['Entradas', 'Saídas'],
                datasets: [{
                    data: [totalEntradasES, totalSaidasES],
                    backgroundColor: ['#10b981', '#ef4444'],
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

    const elTotalHe = document.getElementById('totalHoraExtraPeriodo');
    if (elTotalHe) {
        const totalHe = lancamentosPeriodo.reduce((acc, l) => acc + Number(l.horaExtra || 0), 0);
        elTotalHe.innerText = `R$ ${totalHe.toFixed(2)}`;
    }

    const divCat = document.getElementById('relatorioCategorias');
    if (divCat) {
        divCat.innerHTML = '';
        const gastosPorCat = {};

        lancamentosPeriodo.filter(l => l.tipo === 'saida').forEach(l => {
            gastosPorCat[l.categoriaId] = (gastosPorCat[l.categoriaId] || 0) + Number(l.valor);
        });

        if (Object.keys(gastosPorCat).length === 0) {
            divCat.innerHTML = '<p>Nenhum gasto registrado neste período.</p>';
        } else {
            let indexCor = 0;
            for (let catId in gastosPorCat) {
                const cat = dados.categorias.find(c => Number(c.id) == Number(catId));
                const corAtual = coresPadraoRel[indexCor % coresPadraoRel.length];
                
                const p = document.createElement('p');
                p.style.color = corAtual;
                p.style.fontWeight = 'bold';
                p.innerHTML = `${cat ? cat.nome : 'Outros'}: R$ ${gastosPorCat[catId].toFixed(2)}`;
                divCat.appendChild(p);

                indexCor++;
            }
        }
    }

    const selectCartaoParc = document.getElementById('filtroCartaoParcelamento');
    if (selectCartaoParc && selectCartaoParc.options.length <= 1) {
        const valorAtualCartaoParc = selectCartaoParc.value;
        selectCartaoParc.innerHTML = '<option value="todos">Todos os Cartões</option>';
        dados.cartoes.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.id;
            opt.innerText = c.nome;
            selectCartaoParc.appendChild(opt);
        });
        if (valorAtualCartaoParc) selectCartaoParc.value = valorAtualCartaoParc;
    }

    const cartaoFiltroId = selectCartaoParc ? selectCartaoParc.value : 'todos';

    const tbodyParcelas = document.getElementById('tabelaParcelamentos');
    if (tbodyParcelas) {
        tbodyParcelas.innerHTML = '';
        
        const parcelasMes = lancamentosPeriodo.filter(l => {
            if (l.formaPagamento !== 'CARTAO' || !(l.totalParcelas > 1)) return false;
            if (cartaoFiltroId !== 'todos' && Number(l.cartaoId) !== Number(cartaoFiltroId)) return false;
            return true;
        });
        
        if (parcelasMes.length === 0) {
            tbodyParcelas.innerHTML = `<tr><td colspan="5" style="text-align: center;">Nenhum parcelamento encontrado para este filtro.</td></tr>`;
        } else {
            parcelasMes.forEach(l => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${l.descricao} ${l.observacao ? `<br><small style="color:#64748b;">Obs: ${l.observacao}</small>` : ''}</td>
                    <td style="text-align: center;"><strong>${l.parcelaAtual}</strong> / ${l.totalParcelas}</td>
                    <td style="text-align: right;">R$ ${Number(l.valor).toFixed(2)}</td>
                    <td style="text-align: center;">${l.vencimento}</td>
                    <td style="text-align: center;">
                        <button onclick="abrirDetalhamentoParcelamento(${l.id})" class="btn-acao-icone visualizar" title="Visualizar Detalhes"><img src="imagens/visualizar.png" alt="Visualizar"></button>
                    </td>
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
                            <button onclick="window.location.href='detalhes-financiamento.html?id=${f.id}'" class="btn-acao-icone visualizar" title="Visualizar"><img src="imagens/visualizar.png" alt="Visualizar"></button>
                            <button onclick="excluirFinanciamento(${f.id})" class="btn-acao-icone excluir" title="Excluir"><img src="imagens/excluir.png" alt="Excluir"></button>
                        </div>
                    </div>
                `;
                divFin.appendChild(box);
            });
        }
    }

    const tbodyContas = document.getElementById('tabelaContasAPagar');
    const tbodyContasPagas = document.getElementById('tabelaContasPagas');
    
    if (tbodyContas && tbodyContasPagas) {
        tbodyContas.innerHTML = '';
        tbodyContasPagas.innerHTML = '';

        const todasSaidas = lancamentosPeriodo.filter(l => l.tipo === 'saida' && l.vencimento);

        const contasNormais = todasSaidas.filter(l => l.formaPagamento !== 'CARTAO' && (
            !mesAnoSelecionado || l.vencimento.startsWith(mesAnoSelecionado) || (!l.pago && l.vencimento < `${mesAnoSelecionado}-01`)
        ));

        const faturasConsolidadasMap = {};
        
        todasSaidas.filter(l => l.formaPagamento === 'CARTAO' && l.cartaoId).forEach(l => {
            const cartao = dados.cartoes.find(c => Number(c.id) === Number(l.cartaoId));
            const nomeCartao = cartao ? cartao.nome : 'Cartão Desconhecido';
            const mesVencimentoFatura = l.vencimento.substring(0, 7);

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
                            <button onclick="abrirDetalhamentoFatura('${item.cartaoId}', '${item.vencimento.substring(0, 7)}')" class="btn-acao-icone visualizar" title="Visualizar Detalhes"><img src="imagens/visualizar.png" alt="Visualizar"></button>
                            <button onclick="alternarStatusFaturaConsolidada('${item.cartaoId}', '${item.vencimento.substring(0, 7)}', true)" class="btn-acao-icone pagar" title="Marcar Fatura Paga"><img src="imagens/pagar.png" alt="Pagar"></button>
                        </td>
                    `;
                } else {
                    tr.innerHTML = `
                        <td>${item.descricao} ${item.observacao ? `<br><small style="color:#64748b;">Obs: ${item.observacao}</small>` : ''}</td>
                        <td>${dataFormatada}</td>
                        <td>R$ ${Number(item.valor).toFixed(2)}</td>
                        <td>
                            <button onclick="alternarStatusPagamento(${item.id})" class="btn-acao-icone pagar" title="Marcar Pago"><img src="imagens/pagar.png" alt="Pagar"></button>
                            <button onclick="removerLancamentoRelatorio(${item.id})" class="btn-acao-icone excluir" title="Excluir"><img src="imagens/excluir.png" alt="Excluir"></button>
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
                            <button onclick="abrirDetalhamentoFatura('${item.cartaoId}', '${item.vencimento.substring(0, 7)}')" class="btn-acao-icone visualizar" title="Visualizar Detalhes"><img src="imagens/visualizar.png" alt="Visualizar"></button>
                            <button onclick="alternarStatusFaturaConsolidada('${item.cartaoId}', '${item.vencimento.substring(0, 7)}', false)" class="btn-acao-icone desfazer" title="Marcar Pendente"><img src="imagens/desfazer.png" alt="Desfazer"></button>
                        </td>
                    `;
                } else {
                    tr.innerHTML = `
                        <td style="${estiloLinha}">${item.descricao}</td>
                        <td style="${estiloLinha}">${dataFormatada}</td>
                        <td style="${estiloLinha}">R$ ${Number(item.valor).toFixed(2)}</td>
                        <td>
                            <button onclick="alternarStatusPagamento(${item.id})" class="btn-acao-icone desfazer" title="Desfazer"><img src="imagens/desfazer.png" alt="Desfazer"></button>
                            <button onclick="removerLancamentoRelatorio(${item.id})" class="btn-acao-icone excluir" title="Excluir"><img src="imagens/excluir.png" alt="Excluir"></button>
                        </td>
                    `;
                }
                tbodyContasPagas.appendChild(tr);
            });
        }
    }
}

async function alternarStatusFaturaConsolidada(cartaoId, anoMes, statusPago) {
    mostrarLoading("Atualizando fatura...");
    const dados = obterDados();
    dados.lancamentos.forEach(l => {
        if (Number(l.cartaoId) === Number(cartaoId) && l.vencimento && l.vencimento.startsWith(anoMes)) {
            l.pago = statusPago;
        }
    });
    await salvarDados(dados);
    await registrarLog("STATUS FATURA", `Fatura do cartão ID ${cartaoId} (${anoMes}) marcada como ${statusPago ? 'PAGA' : 'PENDENTE'}`);
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
    await salvarDados(dados);
    await registrarLog("EXCLUSÃO LANÇAMENTO", `Lançamento ID ${id} (${lanc.descricao}) excluído. Motivo: ${motivo}`);
    
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
    await salvarDados(dados);
    await registrarLog("EXCLUSÃO LANÇAMENTO", `Lançamento ID ${id} (${lanc.descricao}) excluído. Motivo: ${motivo}`);
    
    esconderLoading();
    await mostrarAlertaModal("Lançamento excluído com sucesso!");
    carregarRelatorios();
}

async function adicionarContaLotePorPeriodo(descricao, valorParcela, dataInicio, qtdMeses, categoriaId) {
    mostrarLoading("Gerando contas em lote...");
    const dados = obterDados();
    const usuarioId = parseInt(localStorage.getItem('usuarioLogado'));
    
    let proximaIdLanc = dados.lancamentos.length > 0 ? Number(dados.lancamentos[dados.lancamentos.length - 1].id) + 1 : 1;

    for (let i = 0; i < qtdMeses; i++) {
        let dataVenc = new Date(dataInicio.getFullYear(), dataInicio.getMonth() + i, dataInicio.getDate());
        
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
            observacao: 'Gerado por lote retroativo/período',
            horaExtra: 0,
            servicoEssencial: 'nao',
            pago: jaPassou
        };

        dados.lancamentos.push(novoLancamento);
    }

    await salvarDados(dados);
    await registrarLog("CONTA LOTE PERÍODO", `Lote por período criado: ${descricao} (${qtdMeses} meses)`);
    
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

    const ehParceladoOuLote = lanc.totalParcelas && lanc.totalParcelas > 1;

    let escopo = 'esta';
    if (ehParceladoOuLote) {
        escopo = await mostrarOpcaoEscopoModal(`Este lançamento possui ${lanc.totalParcelas} parcelas/registros associados. Deseja excluir apenas esta parcela ou todas?`);
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
        await registrarLog("EXCLUSÃO LANÇAMENTO", `Lançamento ID ${id} (${lanc.descricao}) excluído. Motivo: ${motivo}`);
    } else if (escopo === 'todas') {
        const descricaoBase = lanc.descricao.replace(/\s\(\d+\/\d+\)$/, '').trim();
        
        dados.lancamentos.forEach(l => {
            const descL = l.descricao.replace(/\s\(\d+\/\d+\)$/, '').trim();
            if (descL === descricaoBase) {
                dados.exclusao_movimento.push({
                    dataHora: dataHoraAtual,
                    usuario: nomeUsuario,
                    lancamentoId: l.id,
                    descricao: l.descricao,
                    valor: l.valor,
                    motivo: `[LOTE] ${motivo}`
                });
            }
        });

        dados.lancamentos = dados.lancamentos.filter(l => {
            const descL = l.descricao.replace(/\s\(\d+\/\d+\)$/, '').trim();
            return descL !== descricaoBase;
        });
        await registrarLog("EXCLUSÃO LOTE", `Todas as parcelas de "${descricaoBase}" foram excluídas. Motivo: ${motivo}`);
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
    let proximaId = dados.lancamentos.length > 0 ? Number(dados.lancamentos[dados.lancamentos.length - 1].id) + 1 : 1;

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

    await salvarDados(dados);
    await registrarLog("SALÁRIO FRACIONADO", `Adiantamento e saldo cadastrados para ${descricaoBase}: R$ ${valorTotalSalario}`);

    esconderLoading();
    processandoAcaoModal = false;
    await mostrarAlertaModal("Salário fracionado cadastrado com sucesso (Dia 15 e Final do Mês)!");
    if (typeof carregarDashboard === 'function') carregarDashboard();
    if (typeof carregarRelatorios === 'function') carregarRelatorios();
}

// --- Detecção e Preenchimento Automático por Categoria (Adiantamento Salário) ---
function verificarCategoriaSalario() {
    const selectCat = document.getElementById('categoriaLancamento');
    const tipoLanc = document.getElementById('tipoLancamento').value;
    if (!selectCat || tipoLanc !== 'entrada') return;

    const dados = obterDados();
    const catSelecionada = dados.categorias.find(c => Number(c.id) === Number(selectCat.value));
    
    if (catSelecionada && catSelecionada.nome.toLowerCase().includes('adiantamento')) {
        carregarEPreencherAdiantamentoMemorizado();
    }
}

function carregarEPreencherAdiantamentoMemorizado() {
    const inputValor = document.getElementById('valorTotal') || document.getElementById('valorLancamento');
    const inputData = document.getElementById('vencimentoLancamento') || document.getElementById('vencimento') || document.querySelector('input[type="date"]');
    
    const usuarioId = localStorage.getItem('usuarioLogado');
    const chaveMemoria = `adiantamentoSalario_u${usuarioId}`;
    const salvoStr = localStorage.getItem(chaveMemoria);

    if (salvoStr) {
        const salvo = JSON.parse(salvoStr);
        if (inputValor && salvo.valor) {
            inputValor.value = salvo.valor;
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