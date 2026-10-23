# Relatório — refatoração dos HTMLs

Data: 23/10/2026

## Resultado

- **16 HTMLs** revisados e normalizados para nomes finais.
- **16 blocos `<script>`** extraídos de 15 páginas.
- **95 manipuladores HTML estáticos** (`on*`) migrados, distribuídos por 14 páginas.
- **15 arquivos** criados em `js/page/` (relatórios já referenciava um arquivo próprio).
- 49/49 checagens de sintaxe/conformidade aprovadas no teste Node.js.
- 15/15 páginas refatoradas ligaram todos os elementos estáticos marcados, sem exceções JavaScript, no teste de navegador isolado.
- CSS herdado da auditoria anterior: 1.207 regras e nenhum erro de parse de nível superior (`tinycss2`).

## Alterações de integração

- `central-pagamentos.html` referenciava `script.js` na raiz e não carregava os outros módulos compartilhados; corrigido para `js/script.js`, `js/calculos_trabalhistas.js`, `js/conexao_sheets.js` nesta ordem.
- `dashboard.html` continua carregando Chart.js; a tag foi marcada com `defer`, preservando a ordem antes do script próprio.
- As 16 páginas incluem suas referências de JS comum e JS por página com `defer`, evitando execução prematura dos scripts externos.
- Nenhuma regra de negócio, credencial, vínculo financeiro, regra de sincronização ou campo do `Code.gs` foi modificada neste lote.

## Compatibilidade do frontend com Code.gs

- As **11 coleções** em `COLECOES_DADOS` coincidem nominalmente com as 11 definidas em `SCHEMA` do Code.gs: `usuarios`, `categorias`, `cartoes`, `lancamentos`, `financiamentos`, `bens`, `notificacoes`, `logs`, `exclusao_movimento`, `edicao_movimento`, `fatura_cartao`.
- As **7 ações** literais usadas pelos arquivos JS estão presentes no backend: `obterDados`, `registrarPrimeiroUsuario`, `revisao`, `salvarDados`, `statusCadastro`, `verificarAdmin`, `verificarCredenciaisLogin`.
- O identificador de versão do frontend da tela de login coincide com `VERSAO_ACESSO` do Code.gs.
- O endpoint `/exec` foi **preservado do JavaScript recebido**; a correspondência com a implantação ativa exige verificação real no seu ambiente.

## Pendências importantes

1. **`js/page/relatorios.js` não foi anexado.** Não é possível garantir o funcionamento dessa página neste pacote sozinho. Copie seu arquivo já existente para o local correto e envie sua versão atual na próxima remessa.
2. **Nenhum CSS novo foi anexado neste lote.** O `style.css` do pacote foi retomado da auditoria anterior. Se você editou o CSS depois disso, não o sobrescreva sem comparar.
3. **Teste integrado real pendente.** O navegador isolado confirmou instalação dos manipuladores, mas não executou login, impressão, cartões, sincronização com Google Apps Script, edição e concorrência contra uma planilha real. O ambiente bloqueou a navegação HTTP local.
4. **HTML dinâmico ainda pode gerar atributos `onclick`.** A extração abrangeu os atributos do HTML estático, sem reescrever templates internos de JS que geram novos elementos.
5. **Alguns links levam a páginas de outros lotes**, por exemplo `rendimentos.html`; isso não constitui erro deste lote e esses arquivos devem continuar no repositório.

## Inventário por página

| HTML | Blocos extraídos | Eventos movidos | Arquivo de página |
|---|---:|---:|---|
| `admin-logs.html` | 1 | 8 | `js/page/admin-logs.js` |
| `bens.html` | 1 | 4 | `js/page/bens.js` |
| `cartoes.html` | 1 | 3 | `js/page/cartoes.js` |
| `categorias.html` | 1 | 3 | `js/page/categorias.js` |
| `central-pagamentos.html` | 1 | 11 | `js/page/central-pagamentos.js` |
| `configuracoes.html` | 1 | 10 | `js/page/configuracoes.js` |
| `dashboard.html` | 2 | 10 | `js/page/dashboard.js` |
| `detalhes-central-parcelada.html` | 1 | 0 | `js/page/detalhes-central-parcelada.js` |
| `detalhes-financiamento.html` | 1 | 1 | `js/page/detalhes-financiamento.js` |
| `editar-lancamento.html` | 1 | 6 | `js/page/editar-lancamento.js` |
| `financiamentos.html` | 1 | 5 | `js/page/financiamentos.js` |
| `grafico.html` | 1 | 4 | `js/page/grafico.js` |
| `index.html` | 1 | 4 | `js/page/index.js` |
| `lancamentos.html` | 1 | 17 | `js/page/lancamentos.js` |
| `perfil.html` | 1 | 9 | `js/page/perfil.js` |
| `relatorios.html` | 0 | 0 | `referência pré-existente (não anexado)` |

## Metodologia

- Comparação dos scripts inline e dos atributos `on*` com os HTMLs de origem.
- Validação de sintaxe com `node --check` e combinação do núcleo com cada página via `node:vm`.
- Análise HTML via parser, sem IDs duplicados nos arquivos do lote.
- Execução isolada dos scripts por página no Chromium sem enviar requisições reais ao Apps Script.
- Verificação estática das coleções e ações esperadas pelo frontend contra o `Code.gs` entregue.

Nenhuma afirmação acima deve ser interpretada como aprovação de funcionamento em produção.
