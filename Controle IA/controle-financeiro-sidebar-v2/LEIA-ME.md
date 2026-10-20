# Controle Financeiro — edição integrada

Este pacote reúne **17 páginas HTML**, `style.css`, `script.js` e `Code.gs` com a mesma linguagem visual das páginas de perfil, configurações e auditoria.

## Novidade: salário bruto, descontos e histórico de rendimentos (20/10/2026)

- **Perfil → Configurar salário:** informe o salário **bruto**; o sistema estima o **INSS progressivo (2026)**, o **IRRF (2026)**, quando aplicável, e o **vale-transporte**, somente se o usuário realmente o utiliza (limite de 6% do salário básico e possibilidade de custo menor).
- **Outros descontos:** cadastre quantos forem necessários, até 20 itens, em reais ou porcentagem do bruto. Exemplos: academia, vale-alimentação, vale-refeição e sindicato. A configuração fica no próprio perfil e é sincronizada via `configuracaoSalarial`.
- **Salário líquido estimado:** demonstração que separa bruto, INSS, IRRF, VT, outras rubricas e resultado. É uma simulação CLT geral, não substitui o holerite. Contratos, regimes e situações específicas podem mudar o resultado.
- **Novo `rendimentos.html`:** acessível pelo sidebar, perfil, dashboard e relatórios. Apresenta o cálculo de folha, a composição da média variável, histórico mensal de salário com adiantamentos, verbas adicionais, horas extras e extrato item a item. Filtro de 3/6/12 meses ou todo o período e exportação CSV.
- **Lançamento e edição:** em **entradas**, campo para classificar folha, adiantamento, verba salarial eventual, variável ou recebimento que não é renda; o campo de hora extra só se aplica à folha. Ao editar, essa classificação é preservada.
- **Horas extras:** o número informado **já integra o valor do lançamento**, e o histórico não o soma novamente. Adiantamentos e folhas lançados separadamente entram na consolidação pelo mês em que foram recebidos.
- **Renda variável:** agrupamento por mês, por categoria, valores por lançamento e média real dos últimos 6 meses corridos, **inclusive meses sem renda variável**, evitando média artificialmente alta.
- **Gráfico entradas × saídas:** nos detalhes do gráfico de entradas ou todos, um resumo explica quanto foi folha, adiantamento, verba salarial eventual e variável, respeitando o período e os filtros. A visão individual detalhada fica no histórico.
- **Privacidade:** os valores do histórico ficam ocultos no modo de privacidade. Os valores exportados pelo CSV são os registros selecionados; exportar é desabilitado quando o modo privado está ativo.

**Importante antes de usar:** `Code.gs` deve ser atualizado e sua implantação republicada **junto com** `script.js`, `style.css` e as páginas. Os campos novos `usuarios.configuracaoSalarial` (JSON) e `lancamentos.naturezaRenda` são necessários para persistência. O backend adiciona as colunas no processo de escrita conforme o esquema. Não se esqueça de manter seus backups.

**Cuidado com o histórico existente:** registros anteriores sem classificação explícita são interpretados pela categoria e descrição. Revise folha e adiantamentos antigos e corrija sua classificação em **Editar lançamento** quando necessário. Para não contar o adiantamento em dobro, lance a **folha pelo valor efetivamente recebido depois do adiantamento**; se registrar o mesmo valor integral da folha e o adiantamento em outro lançamento, a soma dos recebimentos ficará maior que o dinheiro que entrou.

## Atualização do sidebar (20/10/2026)

O sidebar foi reconstruído na versão integrada mais recente. Os arquivos `style(20261020-112747).css` e `script(20261020-112747).js` recebidos para diagnóstico continham o menu **anterior**: o botão era injetado fora da ilha e a estilização do painel não acompanhava o cabeçalho novo. Também faltavam, na base integrada, fundo e borda explícitos para o sidebar.

- Menu retrátil em painel com fundo, bordas arredondadas, sombra e cores coordenadas ao tema claro/escuro.
- Botão **dentro da ilha superior**, sem criar um segundo botão flutuante.
- Ícones vetoriais integrados para os atalhos; não precisam de novos arquivos de imagem.
- Página atual destacada, seções organizadas e submenu **Cadastros** com transição suave.
- Perfil como atalho, ações de sair preservadas, suporte a Esc, fechamento pelo fundo e navegação por teclado.
- Layout compacto no celular, sem deslocar o conteúdo principal e sem deixar o painel invisível acessível por Tab.
- As permissões existentes continuam filtrando as páginas visíveis; a autorização real permanece sob responsabilidade do `Code.gs`.

**Importante:** instale o `style.css` e `script.js` **deste pacote juntos**. Misturar os anexos antigos com a versão nova recria o problema. O `Code.gs` não recebeu alterações específicas do sidebar e pode ser mantido se já estiver na mesma versão deste pacote.

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

Execute `node validar-integracao.cjs` na pasta descompactada. O verificador cobre a sintaxe de `script.js`, `Code.gs` e os scripts das 17 páginas, vínculos HTML locais, IDs duplicados e cenários simulados de cálculos INSS/IRRF, VT, descontos adicionais, adiantamentos, horas extras, rendimentos, persistência em planilha, autenticação, permissões, sessões, alterações, reset de senha e alertas.

**Ainda é necessário testar no navegador e no Apps Script real:** primeiro acesso, login, edição, lançamentos em lote, reconexão offline, troca de usuário com alterações pendentes, permissões de administrador e modo celular. O teste local usa simulações e não escreve na planilha.

## Limites de segurança da arquitetura atual

- `TOKEN_API` está no JavaScript do navegador. **Ele não é um segredo**: o Apps Script deve continuar exigindo uma sessão válida e conferir permissões no servidor para cada ação. Não trate a chave de integração como autenticação de usuário.
- A sincronização atual usa um **snapshot financeiro compartilhado** para as contas autenticadas. É adequada somente a um grupo de confiança (ex.: núcleo familiar); não garante isolamento de dados entre usuários independentes. Para oferecer privacidade por usuário, é preciso evoluir o backend para consultas e atualizações filtradas por proprietário, em vez de sincronização integral.
- O sistema usa hash SHA-256 para senha por compatibilidade com a base existente. Para um produto comercial com dados sensíveis e muitos usuários, é recomendado autenticação gerenciada e hash de senha com salt e fator de custo em backend próprio. Não existe promessa de segurança absoluta com frontend estático e Apps Script público.

Se surgir conflito de sincronização, **não descarte os dados locais sem fazer backup**. Use o indicador de sincronização da ilha para decidir a recuperação.
