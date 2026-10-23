# Correção de conflitos de sincronização — 23/10/2026

1. **Antes de instalar:** faça backup da pasta do projeto, exporte os dados do navegador pelo fluxo já existente e faça uma cópia da planilha Google Sheets. Não limpe armazenamento local.
2. **Implantação:** este pacote altera `js/script.js`, `js/conexao_sheets.js`, `style.css` e acrescenta `js/cjs/validar-resolucao-conflitos.cjs`; atualiza `js/cjs/executar-testes.cjs`. O `Code.gs` continua compatível e inalterado.
3. **Teste:** rode `node js/cjs/executar-testes.cjs` na raiz. Homologue com uma cópia de teste da planilha.
4. **Resolver conflito:** no indicador vermelho de sincronização, abra a recuperação/reenvio seguro. O sistema baixa um backup e, quando detecta divergências, apresenta os valores locais e remotos para escolher por campo, seguido de confirmação. Você pode cancelar sem enviar nada.
5. **Se o Sheets mudar durante a revisão:** o envio é abortado e o backup permanece local; refaça a conciliação para avaliar a nova revisão.
6. **Importante:** os dados do `localStorage` não são incluídos neste repositório nem nos testes. Não existem como inspecioná-los remotamente somente com acesso ao código.

Consulte `auditoria/MAPA_FLUXO_SYNC.md` para causas, fluxograma e limitações.
