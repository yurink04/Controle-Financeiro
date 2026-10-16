# Revisão técnica — Controle Financeiro

**Data:** 16/10/2026  
**Escopo:** `script.js`, `Code.gs`, `dashboard.html`, `relatorios.html`, `lancamentos.html`, `admin-logs.html` e `style.css` enviados para esta revisão.

## Correções aplicadas

### Consistência e sincronização
- Substituída a gravação cega de snapshots concorrentes por comparação de revisão no servidor e mesclagem local/servidor de três vias baseada no último snapshot sincronizado.
- Alterações independentes podem ser mescladas; alterações simultâneas no mesmo campo geram conflito explícito, sem escolher silenciosamente uma versão.
- Ajustado o estado de sincronização para não apagar a indicação de pendência quando outra alteração é criada durante uma requisição.
- Protegida a leitura das abas do Google Sheets com `LockService` e adicionadas validações de estrutura antes de aceitar uma gravação.
- Tornado o refresh/autenticação inicial compartilhado para evitar inicializações simultâneas desnecessárias.

### Lançamentos, datas e parcelamentos
- Corrigido o tratamento de mudança de categoria, que tinha uma chamada recursiva capaz de travar a tela.
- Centralizado o cálculo do primeiro vencimento de cartão e corrigido o enquadramento de compras antes/no/apos o dia de fechamento.
- Os valores divididos entre parcelas agora são distribuídos em centavos, preservando a soma exata do total informado.
- Validada a existência real da data (por exemplo, 30/02 não passa como data válida).
- Removido o agrupamento inferido só pelo nome da despesa. Para edição/exclusão em lote, a relação exige um identificador confiável de parcelamento/financiamento; a migração legada só infere grupo quando também existe data de compra para distinguir compras diferentes.
- Ao editar um gasto e mudar sua forma de pagamento de cartão para outra forma, os metadados antigos de cartão/compra são limpos.
- Corrigidos os campos de data do formulário de contas em lote quando a forma escolhida é cartão.
- Adicionada identificação estável às linhas legadas de auditoria e preenchido `usuarioId` também nos eventos de edição e exclusão em lote.

### Dashboard, relatórios e segurança de renderização
- Corrigida a estrutura do bloco de KPIs e removidos cards obsoletos que ficavam permanentemente ocultos e sem atualização.
- Implementada a lista de próximos pagamentos para contas pendentes e faturas futuras dentro da janela de 30 dias.
- Aplicados os filtros de categoria/essencial aos gráficos correspondentes.
- Corrigidos os filtros mensais para não incluir registros sem data em todos os meses; a seleção usa uma data de referência disponível (`vencimento`, `data`, `dataCompra` ou `createdAt`).
- Ajustados rótulos de relatórios para corresponder às métricas calculadas.
- Endurecida a exportação CSV contra fórmulas de planilha e adicionada assinatura BOM para compatibilidade com ferramentas comuns.
- Corrigida a gravação do estado “lida” das notificações e escapados textos dinâmicos apresentados em notificações, categorias, detalhes e relatórios.
- O painel de auditoria volta a exigir confirmação da senha no servidor a cada abertura, sem confiar em autorização persistida no `localStorage`.

## Validações executadas

- `node --check` em `script.js` e no código `Code.gs` copiado temporariamente para verificação de sintaxe JavaScript.
- HTMLs parseáveis; IDs duplicados não encontrados.
- Nenhuma declaração de função duplicada identificada em `script.js` (106 declarações analisadas).
- CSS validado com `tinycss2`, sem erros de sintaxe.
- Testes automatizados de lógica passaram para: mesclagem de alterações independentes, detecção de conflito simultâneo, preservação de novos registros, cálculo do vencimento de cartão, divisão exata de valores, diferenciação de parcelamentos legados com datas distintas, IDs estáveis de auditoria e validação de datas.

## Pendências importantes antes de uso real

### 1. Credencial da API exposta no navegador — bloqueador de segurança
`script.js` ainda contém `TOKEN_API` porque a versão atual do Apps Script exige esse token nas chamadas. Todo segredo incluído em JavaScript entregue ao navegador pode ser visto e reutilizado por qualquer pessoa com acesso ao site. Como a API permite ler e gravar o conjunto de dados, isso pode expor informações financeiras e permitir sobrescrita dos dados.

**Ação recomendada:** revogar/rotacionar imediatamente o token atualmente exposto e planejar autenticação real no servidor (sessões verificadas no backend e autorização por usuário/ação). Trocar o texto do token no front-end por outro token fixo não resolve o problema estrutural. Não publique esta versão como solução segura multiusuário até corrigir essa arquitetura.

### 2. A gravação no Sheets ainda não é transacional
As validações e o `LockService` reduzem risco de gravações concorrentes e payloads inválidos, mas `atualizarTabelas()` reescreve abas inteiras de forma sequencial. Se ocorrer uma falha durante a sequência, algumas abas podem já ter sido atualizadas. Faça uma cópia de segurança da planilha antes de implantar; para maior robustez, a persistência deve evoluir para escrita em lote com estratégia de staging/rollback.

### 3. Registros históricos sem proprietário
A função de filtragem ainda permite exibir registros sem `usuarioId` para usuários da sessão. Isso preserva dados legados que não têm proprietário identificado, mas significa que esses registros compartilhados não ficam isolados por usuário. Antes de mudar a regra, audite os registros sem proprietário e mapeie-os explicitamente; não é seguro atribuí-los automaticamente.

### 4. Funções que não têm chamador no material enviado
- `adicionarSalarioFracionado()` não é chamado por nenhuma página/script deste pacote. Permanece no código para não remover uma possível integração de página externa, mas nenhuma ação de interface enviada aciona essa rotina.
- `calcularStatusParcelaCartao()` também não tem chamador no material enviado e seu cálculo de `pago/pendente` parece depender de uma regra antiga. Não a conectei automaticamente sem ver a página de pagamentos que poderia consumi-la.
- A navegação referencia outras páginas não incluídas neste pacote (por exemplo, cadastros e central de pagamentos). Elas precisam ser revisadas junto ao projeto completo, pois podem chamar funções não observadas aqui.

### 5. Teste de integração não executado
Os testes cobrem a sintaxe e as regras de lógica locais descritas acima. Não foi possível autenticar na implantação real do Google Apps Script nem testar leitura/gravação da sua planilha nesta execução. Após backup, valide em ambiente de teste: entrada, saída, lote recorrente, compra parcelada, pagamento de fatura, edição/exclusão em lote, dois usuários editando simultaneamente e restauração após conflito.

## Implantação

1. Faça backup dos arquivos atuais e da planilha Google Sheets.
2. Substitua os arquivos estáticos pelos arquivos desta pasta, mantendo os recursos de imagens e demais páginas já existentes.
3. Publique `Code.gs` no projeto de Apps Script correspondente e confirme as propriedades `SENHA_MESTRA_API` e `SENHA_ADMIN`.
4. Implante uma nova versão do Apps Script e confirme que `API_URL` no `script.js` aponta para a implantação correta.
5. **Antes de uso real, trate o bloqueador de segurança da API descrito acima.**
