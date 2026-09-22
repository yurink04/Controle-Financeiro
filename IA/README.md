# Controle Financeiro — versão revisada

## Arquivos

Substitua os arquivos do projeto pelos arquivos desta pasta. O `Code.gs` deve ser colocado no projeto do Google Apps Script da planilha.

## Google Apps Script

O `Code.gs` é compatível com os campos usados pelo front-end revisado, incluindo:

- tipoCartao / ativo
- status / dataCompra / dataPagamento
- usuarioPagamentoId
- financiamentoId / parcelamentoId
- valorParcela / categoriaId / primeiroVencimento / ativo
- auditoria com id e usuário

### Configuração recomendada

No Google Apps Script, abra:

**Configurações do projeto → Propriedades do script**

e crie:

`SENHA_MESTRA_API = PLANOF1NALPRAS4AIRD@MERDA`

O código possui fallback para compatibilidade imediata, mas o ideal é retirar a senha fixa do código depois de validar o sistema.

### Publicação

Publique o projeto como **Aplicativo da Web** e mantenha a URL no `API_URL` do `script.js`.

O front-end envia o POST como `text/plain` em razão do `no-cors`; o conteúdo continua sendo JSON e o Apps Script faz `JSON.parse(e.postData.contents)`.

## Importante sobre sincronização

A versão atual ainda envia o snapshot completo do banco para o Apps Script. O `LockService` impede duas gravações simultâneas, mas não elimina o comportamento de última gravação vencer em dois navegadores com dados locais divergentes.

Para sincronização multiusuário totalmente segura, o próximo estágio deve trocar `salvarDados(snapshotCompleto)` por operações incrementais por entidade e ID.

## Teste recomendado

1. Faça backup da planilha atual.
2. Substitua o `script.js` e as páginas HTML.
3. Atualize o Apps Script com o `Code.gs`.
4. Salve/publice a nova versão da implantação.
5. Teste login, categoria, cartão, lançamento, parcelamento, financiamento, pagamento e relatório.
6. Verifique se novas colunas aparecem na planilha.
