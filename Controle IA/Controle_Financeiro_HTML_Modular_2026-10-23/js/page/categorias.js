// Controle Financeiro | Página: categorias.html
// Arquivo extraído dos scripts embutidos no HTML original.
// Carregar APÓS js/script.js, js/calculos_trabalhistas.js e js/conexao_sheets.js.
// Mantém funções globais clássicas usadas por elementos gerados dinamicamente.

// ===== Bloco inline original 1 =====
        document.addEventListener('DOMContentLoaded', async () => {
            injetarHeader();
            const autenticado = await verificarAutenticacao();
            if (autenticado) {
                renderizarCategorias();
            }
        });

        async function salvarCategoriaForm(event) {
            event.preventDefault();
            const idEdit = document.getElementById('catIdEdit').value;
            const nome = document.getElementById('nomeCategoria').value.trim();
            const tipo = document.getElementById('tipoCategoria').value;
            const ok = idEdit ? await atualizarCategoria(idEdit, nome, tipo) : await adicionarCategoria(nome, tipo);
            if (ok) cancelarEdicaoCategoria();
        }

        function prepararEdicaoCategoria(id, nome, tipo) {
            document.getElementById('catIdEdit').value = id;
            document.getElementById('nomeCategoria').value = nome;
            document.getElementById('tipoCategoria').value = tipo;
            document.getElementById('tituloFormCategoria').textContent = 'Editar categoria';
            document.getElementById('btnSalvarCat').textContent = 'Atualizar categoria';
            document.getElementById('btnCancelarCat').style.display = 'inline-flex';
            document.getElementById('nomeCategoria').focus();
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }

        function cancelarEdicaoCategoria() {
            document.getElementById('catIdEdit').value = '';
            document.getElementById('formCategoria').reset();
            document.getElementById('tipoCategoria').value = 'saida';
            document.getElementById('tituloFormCategoria').textContent = 'Nova categoria';
            document.getElementById('btnSalvarCat').textContent = 'Salvar categoria';
            document.getElementById('btnCancelarCat').style.display = 'none';
        }

        async function excluirCategoriaPrompt(id) {
            const ok = await mostrarConfirmacaoModal('Deseja realmente excluir esta categoria?');
            if (ok) await excluirCategoria(id);
        }
    

// ===== Eventos migrados dos atributos on* do HTML =====
// Liga apenas os elementos estáticos marcados por data-page-handler,
// sem executar JavaScript como string e sem registrar eventos em duplicidade.
(function vincularEventosDaPagina() {
    const eventos = {
        "categorias-1": [
            ["submit", function(event) {
                salvarCategoriaForm(event)
            }],
        ],
        "categorias-2": [
            ["click", function(event) {
                cancelarEdicaoCategoria()
            }],
        ],
        "categorias-3": [
            ["change", function(event) {
                renderizarCategorias()
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

