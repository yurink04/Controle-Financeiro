# Diagnóstico de sincronização — 23/10/2026

## Fonte da comparação

Foram utilizados `Code(20261023-181229).gs` e `conexao_sheets(5).js` anexados nesta conversa, comparados byte a byte com os arquivos `Code.gs` e `js/conexao_sheets.js` no último pacote `Controle_Financeiro_Consolidado_2026-10-23`.

**Resultado:** os dois arquivos atuais coincidem com os do pacote. O erro mostrado no navegador não foi reproduzido a partir da imagem, pois ela não contém a resposta de rede da API do Google Apps Script.

## O que aparece na captura

- O cabeçalho do painel mostra o estado **Erro** para a sincronização.
- O DevTools mostra avisos de *Tracking Prevention* para `cdn.jsdelivr.net`. Esses avisos, isoladamente, **não comprovam** erro na API do Sheets, que utiliza `script.google.com`.
- Os 12 testes locais anteriores passaram, mas usam rede e planilha simuladas.

## Correções conservadoras incluídas

### `js/conexao_sheets.js`

1. `consultarRevisaoServidor()` deixou de converter `status: erro` em uma ausência silenciosa de revisão. Agora propaga a mensagem da API, para que o aplicativo possa distinguir uma falha real.
2. Um diagnóstico pequeno é mantido no `sessionStorage` sob a chave `financeiroDiagnosticoSincronizacao`, contendo **apenas** horário, etapa e texto limitado do erro — não inclui token, sessão, corpo de requisição nem conteúdo de coleções.
3. O título do indicador vermelho exibe o último erro ao posicionar o ponteiro do mouse, sem modificar o rótulo breve 'Erro'.
4. As falhas de envio, leitura inicial, revisão e conflito geram o diagnóstico; um estado confirmado de sincronização limpa o diagnóstico anterior.
5. Os dados pendentes e a estratégia de reenvio foram mantidos sem alteração.

### `js/page/index.js`

A pré-verificação `statusCadastro` deixou de incluir a chave de integração na URL GET. Usa o `executarPostAPI`, que já é aceito pelo backend, com tempo limite de 18 segundos.

### `js/cjs/validar-diagnostico-sync.cjs`

Novo teste offline para erros de revisão, limite de mensagem, supressão da chave, informações exibidas no tooltip, limpeza após sucesso e uso de POST no login.

## Verificações locais

13 de 13 scripts de teste offline aprovados com `node js/cjs/executar-testes.cjs`.

**Não verificadas:** a implantação efetivamente publicada, suas propriedades de script, permissões da planilha, resposta HTTP da produção, nem o estado real do armazenamento local do navegador do usuário.

## Como identificar a causa real sem modificar dados

1. Abra o dashboard e pressione F12.
2. Na aba **Network (Rede)** filtre por `script.google.com`, selecione uma requisição realizada no instante em que o estado muda para **Erro** e observe o código HTTP e o conteúdo **Response**, ocultando qualquer credencial. Em erros de CORS pode não haver Response legível.
3. No console, rode apenas comandos de leitura:

```js
(async () => {
  for (const action of ['statusCadastro', 'revisao']) {
    try {
      const resposta = await executarPostAPI(
        action,
        action === 'revisao' ? { sessao: obterSessaoAPI() } : {}
      );
      console.log(action, {
        status: resposta.status,
        mensagem: resposta.mensagem,
        versaoAcesso: resposta.versaoAcesso,
        versaoSincronizacao: resposta.versaoSincronizacao,
        revisao: resposta._revision
      });
    } catch (erro) {
      console.warn(action, erro.message);
    }
  }
  console.log('estado local', {
    pendente: localStorage.getItem('syncPendente') === 'true',
    conflito: Boolean(localStorage.getItem('sistemaFinanceiroConflitoSync')),
    falha: sessionStorage.getItem('financeiroDiagnosticoSincronizacao')
  });
})();
```

O código acima não envia dados financeiros nem grava na planilha: `statusCadastro` e `revisao` são consultas. O último campo `falha` só terá valor após instalar o JavaScript corrigido e uma falha ocorrer.

4. Confira **Implantações > Gerenciar implantações** no Apps Script; após alterar `Code.gs`, sempre publique uma **nova versão** na implantação usada pelo `API_URL`. Alterar apenas o editor não atualiza o Web App já publicado.
5. Confira as Script Properties `SENHA_MESTRA_API` e `SENHA_ADMIN` **sem compartilhar os seus valores**. A chave do frontend deve coincidir com a propriedade `SENHA_MESTRA_API`.
6. Se a publicação foi criada como projeto Apps Script independente, `SpreadsheetApp.getActiveSpreadsheet()` pode ser `null`; será necessário associar a planilha via ID com cuidado e testar primeiro em homologação.

## Segurança e integridade

- **Não clique em descartar alterações locais** no diálogo de sincronização enquanto houver pendências. Faça backup antes de qualquer intervenção.
- Não limpe `localStorage` / `sessionStorage` como tentativa de resolver o problema sem backup: existem snapshots e lançamentos que podem ainda não estar no Sheets.
- Não divulgue links da API que incluam `token=` nem valores de `SENHA_MESTRA_API`, `SENHA_ADMIN` ou `financeiroSessaoSegura`.
- O projeto ainda possui um token de integração visível no JS distribuído aos navegadores; ele **não é** um segredo confiável. A proteção dos dados depende da validação de sessões e permissões no Apps Script.

## Instalação

Substitua `js/conexao_sheets.js` e `js/page/index.js` pelos arquivos desta entrega, depois limpe apenas o cache de arquivos estáticos do navegador por meio de recarga forçada (Ctrl + F5). Não limpe o armazenamento do aplicativo. Não é necessária uma nova implantação do Code.gs para estes ajustes de frontend, pois ele não foi modificado.

O restante do pacote é igual à versão consolidada anterior, salvo os novos testes, o relatório e o executor de testes atualizado.
