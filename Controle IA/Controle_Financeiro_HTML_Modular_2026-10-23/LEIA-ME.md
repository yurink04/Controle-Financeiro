# Controle Financeiro — HTML e JavaScript modular (lote 23/10/2026)

## Arquivos do pacote

- 16 páginas HTML com nomes de produção (`index.html`, `dashboard.html`, etc.).
- `js/script.js`, `js/calculos_trabalhistas.js`, `js/conexao_sheets.js`: cópias EXATAS dos três JavaScripts deste envio.
- 15 novos arquivos `js/page/*.js`: código que antes estava dentro dos HTMLs e manipuladores de eventos estáticos migrados para `addEventListener`.
- `Code.gs`: cópia do **Code(9).gs** deste envio, sem alterações de lógica.
- `style.css`: versão revisada disponibilizada na auditoria anterior (não foi enviado novo CSS neste lote). **Compare com seu CSS local atual antes de substituir.**
- `js/cjs/validar-paginas.cjs`: teste estático executável com Node.js sem instalar dependências.
- `auditoria/`: inventário e relatórios de validação.

## Instalação segura

1. Salve uma cópia de sua pasta atual e faça backup da planilha do Google Sheets.
2. Copie os HTMLs atualizados para a raiz de `Controle Financeiro/` (nomes normalizados, sem `(5)` etc.).
3. Copie os 3 arquivos `.js` principais para `Controle Financeiro/js/` e os 15 arquivos novos para `Controle Financeiro/js/page/`.
4. **Preserve `js/page/relatorios.js` existente**, que foi referenciado em `relatorios.html` mas não foi anexado nesta remessa. Não remova nem substitua esse arquivo.
5. Antes de usar o `style.css` incluído, compare-o com seu CSS atual: a cópia incluída vem do lote anterior, não desta remessa.
6. O `Code.gs` está incluído para conferência; não é necessário republicá-lo só por causa da extração. Caso o substitua ou modifique no Apps Script, publique uma implantação atualizada e confira a URL em `js/conexao_sheets.js`.
7. Execute a checagem: no diretório do projeto, `node js/cjs/validar-paginas.cjs`.
8. Teste o navegador com conta e planilha de homologação: login, cadastro, lançamentos, edição, pagamentos, cartões, financiamentos, relatórios, conflitos e recuperação offline antes de usar em produção.

## Como os HTMLs carregam os scripts

```html
<script defer src="js/script.js"></script>
<script defer src="js/calculos_trabalhistas.js"></script>
<script defer src="js/conexao_sheets.js"></script>
<script defer src="js/page/nomedapagina.js"></script>
```

Mantenha esta ordem. São **scripts clássicos** que compartilham símbolos globais; não adicione `type="module"` sem migrar as dependências. `dashboard.html` carrega ainda Chart.js pelo CDN, antes dos demais scripts.

Os `.cjs` são testes Node.js e NÃO são adicionados aos HTMLs.

## Escopo e limitações

- A extração foi feita preservando o código de negócio e o comportamento dos manipuladores. Atribuições `on*` presentes no HTML estático foram convertidas em marcadores `data-page-handler` e listeners no JS correspondente.
- Manipuladores `onclick` criados dinamicamente por strings dentro de JavaScript compartilhado ou da página ainda existem (nova refatoração separada seria necessária para eliminá-los).
- As rotinas dos módulos JS e o `Code.gs` não foram reescritos nesta etapa para evitar regressões: a verificação aqui foi de compatibilidade de estruturas/ações, não homologação com planilha real.
- A execução integral em navegador por HTTP foi bloqueada pela política do ambiente de testes; a ligação dos eventos foi validada em navegador isolado sem backend real.
- Outros HTMLs, imagens e bibliotecas do projeto fora deste lote devem ser preservados.
