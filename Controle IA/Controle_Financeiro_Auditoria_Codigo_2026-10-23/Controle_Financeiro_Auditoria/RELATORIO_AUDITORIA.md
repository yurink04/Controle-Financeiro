# Relatório de auditoria — Controle Financeiro
**Data:** 23/10/2026  
**Fontes:** `Code(8).gs`, `script(8).js`, `conexao_sheets(1).js`, `calculos_trabalhistas(1).js`, `style(7).css`.

## Contrato frontend ↔ Google Apps Script

**Resultado:** as 11 coleções têm os mesmos nomes e ordem em `COLECOES_DADOS` e `SCHEMA`. Ações verificadas: `obterDados`, `salvarDados`, `revisao`, `verificarAdmin`, `registrarPrimeiroUsuario`, `statusCadastro`; o backend também suporta `verificarCredenciaisLogin` usado pelo fluxo HTML. Campos de renda, empréstimos, parcelamentos, cartões e faturas estão previstos no esquema. O backend preserva IDs, revisão e os tipos JSON/booleano/data já adotados.

## Correções aplicadas

| Área | Diagnóstico | Solução |
|---|---|---|
| Backend — proprietário | Havia validações de propriedade assimétricas em cartões, financiamentos, bens e categorias. | Rejeição de registros novos em nome de outro usuário e de alterações do dono dos registros existentes (exceto operações administrativas já autorizadas). |
| Backend — escopo | Parceiro conseguia alterar `escopo` de individual para casal e editar em um único envio. | Verificação do escopo anterior e do proposto. |
| Backend — notificações | Um destinatário podia mudar remetente, título ou conteúdo de notificação recebida. | Campos imutáveis; somente `lida` e decisões válidas de convite pendente são modificáveis. |
| Backend — IDs | Identificadores duplicados em um lote podiam criar perdas em mesclagens por ID. | Validação de unicidade nas 11 coleções antes de qualquer gravação. |
| Backend — faturas | Possível transferir `cartaoId` de uma fatura existente. | Identidade do cartão fica imutável. Faturas derivadas de cartões de parceiro recíproco permanecem permitidas. |
| API — primeiro acesso | `statusCadastro` usava GET com token na URL e havia chamada direta `fetch` para cadastro. | Ambos passam pelo cliente POST com timeout e tratamento de erro; o Code.gs oferece `statusCadastro` em POST e mantém GET legado. |
| Cliente — leitura | Apenas `usuarios` era exigido em resposta remota, permitindo migrar respostas parciais para arrays vazios. | Verificação explícita de todas as coleções e da revisão antes de aceitar snapshot. |
| Cliente — sessões locais | Pendências de um usuário podiam iniciar envio autenticado por outro usuário no mesmo navegador. | Bloqueio por proprietário pendente; os dados são preservados sem envio. |
| Cliente — concorrência | Resposta de sync podia sobrescrever cache modificado por outra aba durante a requisição. | Detecção de mudança entre início e fim do POST e reenvio do cache mais recente. |
| Cliente — mesclagem | Reenvio podia usar uma cópia local anterior a um fetch demorado. | Releitura do cache após consultar o servidor, imediatamente antes da mesclagem. |
| Cliente — compartilhamento | Filtro visual não exigia vínculo recíproco nem respeitava `escopo=individual` do parceiro. | Filtragem por IDs e vínculo recíproco; dados sem dono não são exibidos como de outra conta. |
| Cliente — alertas | IDs locais `alerta_atraso` e remotos `alerta_vencimento` têm prefixos e separadores diferentes. | Limpeza por chaves completas montadas a partir dos lançamentos, sem fragmentar IDs. |
| Cliente — novos IDs | Categoria e financiamento usavam maior ID + 1, vulnerável a colisões entre dispositivos. | Reutilização do gerador de IDs numéricos com instante e aleatoriedade existente. |
| CSS | Havia regras completamente idênticas e estilos parcialmente desalinhados entre componentes. | Remoção de três regras idênticas e adição de tokens/regras comuns para formulários, tabelas, foco, modais, responsividade e redução de movimento. |

## O que foi testado

- Sintaxe de todos os `.js`, `.cjs`, `Code.gs` (parse via Node) e `style.css` (PostCSS).
- Carregamento dos três JS juntos, sem colisão de declarações globais, funções básicas e cálculos salariais.
- Cenários offline: revisão, salvamento, reenvio, falha/reconexão e preservação de edição feita em outra aba.
- Validação de resposta do servidor incompleta e filtragem de lançamentos próprios, compartilhados e individuais.
- Testes de autorização em Code.gs para novas contas de cartão/contrato/bem, convites, escopo, categorias e faturas.
- Simulação ponta a ponta **local** de `Code.gs`: login com hash, obtenção das 11 coleções, proteção de hash na leitura, salvamento, incremento de revisão, conflito de revisão antiga.

## Pendências e riscos restantes

1. **Alto impacto:** o endpoint de leitura ainda retorna dados financeiros de todos os usuários autenticados. A proteção do frontend não impede consulta direta ao JSON. Isolar as leituras exige abandonar o snapshot compartilhado ou separar o escopo por usuário/parceiro no backend, junto com protocolo de alterações granulares.
2. **Alto impacto operacional:** gravação por snapshot reescreve coleções inteiras quando alteradas e ainda pode ser lenta em planilhas grandes. A aplicação mantém LockService, checagem de versão e tentativa de rollback, mas não possui transação real multiaba do Sheets.
3. A planilha real, a publicação `/exec`, permissões de Google Apps Script e funcionalidades contidas nos HTMLs não estão disponíveis neste conjunto de anexos. Os testes são simulações, não homologação em produção.
4. Funções JavaScript aparentemente sem referências dentro dos `.js` podem ser chamadas diretamente pelos HTMLs. Não foram removidas indiscriminadamente para evitar quebra de páginas.
5. Parâmetros de cálculo salarial foram preservados; validação tributária oficial deve ser feita separadamente antes de uso para decisões trabalhistas.
