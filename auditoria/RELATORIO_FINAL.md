# Relatório de integração — 23/10/2026

## Resultado

- **17 HTMLs presentes**, correspondendo às 16 páginas anteriores mais `rendimentos.html`.
- **17 JavaScripts de página**, incluindo o `js/page/relatorios.js` recebido e o novo `js/page/rendimentos.js` extraído integralmente do HTML.
- 99 manipuladores estáticos migrados para scripts de página nos dois lotes (inclui quatro de rendimentos).
- Arquivos **.cjs** relocalizados para `js/cjs`, com referências relativas ajustadas e testes legados incompatíveis com o monolito substituídos pela validação modular.
- **12 de 12 testes offline aprovados**, incluindo fluxo simulado do Sheets, autorização, login, contas compartilhadas, mesclagem e reenvio.
- **17 de 17 páginas** aprovadas em teste de vinculação de eventos no Chromium isolado (sem fazer login nem chamadas de API reais).
- **53 de 53 verificações** do teste `validar-paginas.cjs` aprovadas.
- **20 de 20 arquivos JavaScript** compilaram com `node --check`.
- CSS atualizado recebeu correções aditivas para estados `:focus-visible`, elementos `hidden`, tabelas roláveis, layouts de largura mínima e preferência por movimento reduzido. O CSS teve **0 erros sintáticos de nível superior** na análise (`tinycss2`).
- `relatorios.js`: **46 referências literais a IDs encontradas** no HTML.
- `rendimentos.js`: **21 referências literais a IDs encontradas** no HTML.

## Compatibilidade entre frontend e Code.gs

- Conferidas as 11 coleções de dados e suas ações de API no teste modular e no teste dedicado do backend.
- Nenhuma mudança de protocolo ou do conteúdo dos dados financeiros foi efetuada nesta consolidação.
- A URL da implantação do Apps Script foi **mantida exatamente como recebida** nos JavaScripts anteriores; não houve verificação remota.

## Limitações importantes

1. **Não é uma homologação de produção.** Fluxos reais com autenticação e Google Sheets precisam de teste controlado.
2. **Não foi removida a arquitetura de funções globais.** Os scripts de página a utilizam conscientemente; conversão para ES modules exigiria outra migração.
3. **Atributos de eventos gerados dinamicamente** por templates JS continuam sujeitos a auditoria futura. O processo removeu os `on*` estáticos presentes nos HTMLs que foram entregues.
4. A bateria offline não chama `diagnosticar-api.cjs --online`. Testar o endpoint real precisa de rede, implantação publicada e escolha explícita de quem executa.
5. Recursos fora do material enviado, como imagens e bibliotecas externas, não foram testados no sistema hospedado.
6. O token da API colocado no frontend pode ser lido por qualquer navegador. A autenticação e as permissões em `Code.gs` continuam sendo controles essenciais; uma avaliação de isolamento por usuário permanece recomendada.

## Arquivos de auditoria

- `inventario_paginas.json`: inventário completo das 17 páginas.
- `inventario_pagina.json`: cópia para corresponder ao nome informado no projeto.
- `teste_eventos_navegador.json`: resultados do teste isolado.
- `teste_eventons_navegador.json`: cópia usando o nome que você informou.
- `resultado_testes_consolidados.txt`: resultado da bateria offline.
- `resumo_consolidacao.json`: sumário estruturado da conferência.

## Recomendações para a próxima evolução

Priorizar autorização e escopo de leitura no backend, tratamento de token exposto, melhorias graduais para dividir `script.js` por domínio, e testes ponta a ponta de uma conta real com planilha de homologação. Evitar refatorar toda a sincronização no mesmo lote que altera o layout e os eventos.
