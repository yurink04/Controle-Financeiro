# Atualização da página Relatórios — Controle Financeiro

Esta entrega reformula a página de relatórios e integra seus encaminhamentos
com as páginas já existentes. Os dados continuam armazenados e sincronizados
pelo `script.js` e pelo Google Apps Script atuais.

## Como instalar

1. Faça uma cópia dos arquivos atuais do seu projeto.
2. Copie `relatorios.html` e `style.css` desta entrega sobre os respectivos
   arquivos existentes.
3. Coloque o **novo** `relatorios-page.js` na **mesma pasta** do `relatorios.html`.
4. Copie `central-pagamentos.html` sobre o existente para que os links que
   apontam para um mês específico também funcionem nessa página.
5. Mantenha os arquivos `script.js`, `Code.gs`, demais páginas e a pasta de
   imagens como já estão no seu projeto. Esta atualização **não exige novas
   colunas ou abas no Google Sheets**.
6. Atualize a página no navegador, de preferência com `Ctrl + F5` para limpar
   o cache da versão anterior.

## O que mudou

- **Fechamento por mês**: entradas, saídas, resultado e participação das
  despesas essenciais, com opção de incluir ou excluir pendências.
- **Comparação de categorias**: selecione uma categoria de entrada e uma de
  saída; o sistema soma os lançamentos no intervalo de 1, 3, 6 ou 12 meses.
  Se as categorias existirem, `Ganhos Uber` e `Transporte` são sugeridas.
- **Evolução mensal clicável**: cada barra abre os lançamentos daquela categoria
  e daquele mês na página de gráficos.
- **Pontos de atenção**: sinaliza dívidas vencidas, resultados negativos,
  aumentos relevantes de despesas e categorias com concentração de gastos.
  Cada aviso tem um caminho para investigação.
- **Mudanças em relação ao mês anterior** e **principais categorias de gasto**.
- **Acesso ao detalhamento**: links contextuais para a central de pagamentos,
  gráficos/lançamentos, dashboard e rendimentos.
- **Conferência**: amostra dos registros, exportação CSV e impressão em PDF.
- **Modo discreto**: mascara valores e detalhes analíticos quando habilitado.

## Regras importantes

- A referência mensal usa a **data de vencimento/competência** registrada
  em cada lançamento. Ela não representa necessariamente a data em que o
  dinheiro entrou ou saiu da conta.
- O filtro `Pagos e recebidos` considera lançamentos marcados como concluídos;
  `Realizados + pendentes` também soma os agendados ou em aberto.
- `Somente minhas` e `Minhas + parceiro` usam as permissões já implementadas
  pelo sistema.
- No exemplo Uber, `Ganhos Uber – Transporte` mostra apenas o **resultado
  parcial entre essas duas categorias**, e não o lucro líquido total da
  atividade. Seguro, manutenção, tributos, depreciação e outros custos ficam
  de fora se registrados em outras categorias.
- A nova página **não grava nem altera lançamentos**, apenas os analisa e
  encaminha para as telas existentes.

## Validação

Caso use Node.js, na pasta do projeto execute:

```bash
node --check relatorios-page.js
node validar-relatorios.cjs
node validar-integracao.cjs
```

Os testes usam dados fictícios e não acessam sua planilha.
