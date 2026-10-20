# Controle Financeiro — edição integrada

Este pacote reúne **16 páginas HTML**, `style.css`, `script.js` e `Code.gs` com a mesma linguagem visual das páginas de perfil, configurações e auditoria.

## Principais ajustes

- **Login redesenhado:** tela mais limpa, maior legibilidade, modo claro/escuro, fluxo usuário → senha e mensagem de erro discreta. A pré-verificação do serviço ocorre em segundo plano e **não bloqueia o botão**. A senha só é verificada quando o usuário a informa.
- **Transição de acesso:** com cache válido, a navegação para o painel ocorre logo após a autenticação; a checagem de atualizações continua na tela seguinte. No primeiro acesso, os dados essenciais são baixados antes da abertura.
- **Visual compartilhado:** cabeçalhos com a identidade do perfil, cartões e filtros harmonizados, grade de indicadores 2×2 no celular, menu lateral retrátil dentro da ilha, navegação por ícones em telas compactas.
- **Carregamentos curtos:** status discreto integrado à ilha do cabeçalho; o GIF maior continua disponível para tarefas demoradas. Confirmações importantes e erros continuam explícitos.
- **Sincronização:** gravação local imediata e envio automático, revisão periódica da nuvem, preservação de alterações pendentes e tratamento de conflito. Quando a rede falha, o reenvio aguarda de forma progressiva (até 90 segundos), retomando imediatamente quando a conexão volta.
- **Segurança:** manutenção de sessão autenticada, validação de permissões no Apps Script, validação administrativa para operações protegidas, bloqueio de elevação de privilégios e de alterações indevidas. O avatar no cabeçalho agora é criado por DOM, evitando interpolar dados do usuário dentro de HTML.
- **CSS consolidado:** o bloco de estilos do dashboard foi movido para `style.css`; os arquivos HTML não contêm elementos `<style>`.
- **Fluxos preservados:** lançamentos por etapas (inclusive contas em lote), edição, cartões, patrimônio, relatórios, central de pagamentos, financiamentos, perfil, configurações e auditoria.

## Como atualizar

1. Faça um backup da pasta atual e da planilha no Google Sheets.
2. Extraia **todos os arquivos** deste ZIP na pasta do projeto, substituindo os arquivos de mesmo nome. Não misture `script.js` ou `style.css` desta versão com páginas anteriores.
3. **Mantenha a sua pasta `imagens/` original.** Ela não veio nos anexos e não está neste ZIP. O sistema espera imagens como `home.png`, `loading1.gif`, `sincronizar.png`, `modo_escuro.jpg` e outras já utilizadas.
4. No projeto do Google Apps Script, atualize o conteúdo de `Code.gs` e faça uma **nova implantação / atualização da implantação**. Confira `SENHA_MESTRA_API` e `SENHA_ADMIN` nas Propriedades do Script — nunca publique os valores dessas propriedades em documentação ou prints.
5. Confirme se o endereço `API_URL` no início de `script.js` aponta para a implantação correta e se o token público de integração corresponde ao valor configurado no servidor.
6. Recarregue com **Ctrl + Shift + R** para impedir que o navegador use CSS/JS antigo.

## Validação

Execute `node validar-integracao.cjs` na pasta descompactada. O verificador cobre a sintaxe de `script.js`, `Code.gs` e os scripts das 16 páginas, vínculos HTML locais, IDs duplicados e cenários simulados de autenticação, permissões, sessões, alterações, reset de senha e alertas.

**Ainda é necessário testar no navegador e no Apps Script real:** primeiro acesso, login, edição, lançamentos em lote, reconexão offline, troca de usuário com alterações pendentes, permissões de administrador e modo celular. O teste local usa simulações e não escreve na planilha.

## Limites de segurança da arquitetura atual

- `TOKEN_API` está no JavaScript do navegador. **Ele não é um segredo**: o Apps Script deve continuar exigindo uma sessão válida e conferir permissões no servidor para cada ação. Não trate a chave de integração como autenticação de usuário.
- A sincronização atual usa um **snapshot financeiro compartilhado** para as contas autenticadas. É adequada somente a um grupo de confiança (ex.: núcleo familiar); não garante isolamento de dados entre usuários independentes. Para oferecer privacidade por usuário, é preciso evoluir o backend para consultas e atualizações filtradas por proprietário, em vez de sincronização integral.
- O sistema usa hash SHA-256 para senha por compatibilidade com a base existente. Para um produto comercial com dados sensíveis e muitos usuários, é recomendado autenticação gerenciada e hash de senha com salt e fator de custo em backend próprio. Não existe promessa de segurança absoluta com frontend estático e Apps Script público.

Se surgir conflito de sincronização, **não descarte os dados locais sem fazer backup**. Use o indicador de sincronização da ilha para decidir a recuperação.
