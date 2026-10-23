# Controle Financeiro — consolidação final de páginas e validações (23/10/2026)

## Como usar

Este pacote aplica a estrutura de pastas informada no projeto. Ele inclui as 17 páginas HTML, os três `.js` compartilhados, 17 `.js` de página (incluindo **rendimentos.js** e **relatorios.js**), o CSS atualizado, o `Code.gs` enviado na etapa anterior e os scripts de validação adaptados à estrutura `js/cjs`.

**Não copiar a pasta externa `Controle_Financeiro_Consolidado_2026-10-23` para dentro de seu projeto criando diretórios duplicados**. Copie o **conteúdo da pasta** respeitando os caminhos relativos abaixo.

```
Controle Financeiro/
├── *.html                 # 17 páginas HTML na raiz
├── style.css              # CSS do último envio, com ajustes de acessibilidade
├── Code.gs                # cópia do Code(9).gs para conferência
├── js/
│   ├── script.js
│   ├── calculos_trabalhistas.js
│   ├── conexao_sheets.js
│   ├── page/               # 17 arquivos de lógica por página
│   └── cjs/                # 13 validações/diagnósticos + executar-testes.cjs
└── auditoria/             # relatórios, inventário e execução de testes
```

**Observação:** as imagens e recursos de outras pastas do repositório não foram enviados, portanto preserve suas pastas `imagens/` e outros recursos locais. O `Code.gs` incluído é o mesmo da última remessa anterior; não foi necessária alteração de protocolo nesta fase.

## Instalação

1. Faça backup local do repositório e exporte uma cópia de segurança dos dados do Google Sheets.
2. Em `D:\GitHub\Financeiro\Controle Financeiro`, coloque os 17 `.html`, `Code.gs` e `style.css`.
3. Coloque os três `.js` comuns dentro de `js/`, os JavaScripts de página dentro de `js/page/` e os testes `.cjs` em `js/cjs/`.
4. Coloque os inventários e registros em `auditoria/`. Foram incluídos também os nomes informados `inventario_pagina.json` e `teste_eventons_navegador.json` para não quebrar seu layout.
5. **Não adicione arquivos `.cjs` a `<script>` no HTML.** Eles são exclusivos do Node.js.
6. Execute `node js/cjs/executar-testes.cjs` a partir da raiz do projeto.
7. Teste em uma cópia de homologação (não em produção): login, criação e edição de lançamentos, visão de rendimentos, relatórios, reenvio, offline e concorrência de dispositivos.

## Carregamento dos scripts no HTML

Use sempre esta ordem, com `defer`, incluindo somente a página correspondente:

```html
<script defer src="js/script.js"></script>
<script defer src="js/calculos_trabalhistas.js"></script>
<script defer src="js/conexao_sheets.js"></script>
<script defer src="js/page/rendimentos.js"></script>
```

A última linha acima é um exemplo para `rendimentos.html`. Para `relatorios.html`, use `js/page/relatorios.js`. São scripts **clássicos**, não `type="module"`, porque ainda compartilham funções globais.

## Testes

- `node js/cjs/executar-testes.cjs`: executa 12 verificações **offline**, sem Google Sheets real.
- `node js/cjs/validar-paginas.cjs`: caminhos, scripts inline, IDs e contratos de API.
- `node js/cjs/validar-relatorios.cjs`: cálculos, filtros, privacidade, URLs e escape de texto com dados fictícios.
- `node js/cjs/validar-code-gs.cjs`: esquema e permissões simuladas no backend.
- `node js/cjs/diagnosticar-api.cjs --online`: **opcional**, teste remoto do endpoint real com usuário sem sessão. **Faz requisições externas**; não é executado pela bateria offline. Sem `--online`, apenas mostra instruções.

## Limitações e pendências

- Os resultados aprovados referem-se a verificação estática, execução simulada e vinculação de eventos em navegador isolado, **não à operação completa em produção**.
- As imagens/fontes locais não foram fornecidas. Preserve-as em seus diretórios originais.
- `Code.gs` precisa estar publicado na implantação correspondente à constante `API_URL` de `js/conexao_sheets.js`; essa correspondência não pôde ser comprovada por teste real.
- O token compartilhado em JavaScript de navegador é exposto ao usuário final. Ele **não é uma credencial secreta confiável**; autorizações e isolamento de dados devem ser validados no servidor. Os testes não demonstram isolamento integral entre usuários autenticados.
- `Code.gs` e `js/` podem depender de outros arquivos do repositório ainda não fornecidos; preserve a versão atual dos demais recursos.

Veja `auditoria/RELATORIO_FINAL.md` e `auditoria/resultado_testes_consolidados.txt`.
