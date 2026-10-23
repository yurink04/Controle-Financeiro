# Controle Financeiro — JavaScript modularizado

## Resultado da revisão

Foram analisados os três anexos: `script(7).js`, `calculos_trabalhistas.js` e `conexao_sheets.js`.

Problemas objetivos encontrados e tratados:

1. **Duplicação de declarações:** o arquivo `script(7).js` ainda continha as constantes/funções de ambos os módulos, o que causaria `SyntaxError: Identifier ... has already been declared` ao incluir os três `<script>` na mesma página.
2. **Migração de dados ausente do módulo de conexão:** `migrarDados()` permanecia somente no monólito. A rotina foi preservada e incluída em `conexao_sheets.js`, juntamente com persistência local, tratamento de conflitos e sincronização.
3. **Registro de eventos separado incorretamente:** `registrarLog()` foi mantida no núcleo `script.js`, disponível para lançamentos, categorias, histórico e edição salarial.
4. **Função duplicada de status:** `atualizarIndicadorSyncUI()` foi centralizada em `conexao_sheets.js`.
5. **Expressões regulares corrompidas:** o arquivo extraído de cálculos tinha caracteres ASCII de retrocesso (`0x08`) no lugar de `\b` nos testes de `PLR`. Corrigido.
6. **Reconhecimento de 13º:** o classificador agora reconhece descrições como `13º salário`, `13° salário` e `13o salário`, sem confundi-las com a folha mensal.
7. **Estado global:** indicadores de processamento de tela e promessa de verificação de autenticação ficam no núcleo; temporizadores, cache e estado da sincronização ficam na conexão.

O resultado mantém as **interfaces globais já utilizadas pelo projeto** (`salvarDados`, `obterDados`, `verificarAutenticacao`, `calcularSalarioLiquido`, `abrirEditorSalarial`, `carregarDashboard` etc.), evitando migrar à força as chamadas de HTML para módulos ES.

## Estrutura do pacote

```text
Controle Financeiro/
├── index.html                  (existente: NÃO incluído no pacote)
├── dashboard.html              (existente: NÃO incluído no pacote)
├── ... demais HTMLs existentes
└── js/
    ├── script.js              Núcleo, utilitários, permissões, interface, CRUD, relatórios e início
    ├── calculos_trabalhistas.js  Renda, cálculo salarial, categorias e editor salarial
    └── conexao_sheets.js       API, estado local, migrações e sincronização com Sheets
```

### Instalação

1. Faça backup do diretório atual `D:\GitHub\Financeiro\Controle Financeiro\js` **e dos dados locais usados para testes**. Não apague o backup anterior antes de testar.
2. Extraia a pasta `js` deste ZIP para `D:\GitHub\Financeiro\Controle Financeiro\` (substitua somente os 3 arquivos correspondentes). O novo arquivo principal chama-se **`script.js`**.
3. Em **cada HTML** que carregava o script original, substitua a referência antiga pelo trio abaixo, **nessa ordem**:

```html
<script defer src="js/script.js"></script>
<script defer src="js/calculos_trabalhistas.js"></script>
<script defer src="js/conexao_sheets.js"></script>
```

O exemplo assume HTMLs diretamente na pasta `Controle Financeiro`. Para páginas HTML em subpastas, ajuste o caminho relativo (ex.: `../js/script.js`). Os três devem ter `defer`, na ordem apresentada, e devem ser incluídos **uma única vez** por página. Não use `type="module"` sem adaptar as chamadas globais do restante do projeto. Não carregue o monólito `script(7).js` junto dos novos scripts. Se houver outros scripts que utilizam funções desses módulos durante a execução, mantenha-os **após** esse trio com `defer` também.

4. Rode o sistema preferencialmente por `localhost` ou HTTPS; a verificação de senhas com Web Crypto exige origem segura. Evite testar fazendo login a partir de `file://`.
5. Valide console do navegador, login, lançamento, recarregamento, edição de financiamento, visualização do histórico salarial, sincronização entre duas sessões de teste e estado offline/reenvio.

### API Google Sheets — confira antes de publicar

O `API_URL` usado neste pacote é exatamente o presente no arquivo `conexao_sheets.js` enviado nesta mensagem. **Ele difere do endereço `/exec` informado em uma conversa anterior.** Não alterei a URL sem sua confirmação, pois a implantação pode ter sido atualizada deliberadamente. Se estiver apontando para uma implantação antiga, corrija a constante `API_URL` **somente em `js/conexao_sheets.js`**, sem replicá-la nos outros módulos.

A execução real depende de o `Code.gs` publicado reconhecer as operações `obterDados`, `salvarDados` e `revisao`, aceitar o formato de `sessao`, devolver `_revision` e disponibilizar todas as coleções/campos da versão atual. Não recebi `Code.gs` nem os HTMLs nesta revisão; por isso **não foi possível validar o esquema do lado do servidor, a implantação, todos os atributos HTML ou uma sincronização real entre usuários**.

**Segurança:** o token da API está embutido no JavaScript do navegador. Isso não é segredo de servidor: qualquer pessoa com acesso à página pode lê-lo. A proteção efetiva tem de ser feita no Google Apps Script com validação da sessão, autorização por usuário e revisão antes de gravar. Trocar somente os arquivos front-end não corrige uma possível permissão indevida no backend.

### Testes executados

Todos os arquivos passaram na análise sintática do Node (`node --check`). O teste offline de integração (`testes-modulos.cjs`) executa os três arquivos num mesmo contexto global, verifica funções fundamentais, mesclagem em três vias, cálculos salariais, recuperação de dados do servidor simulado, gravação, limite de edição de perfil de terceiros, falha de rede e reenvio. A falha simulada de rede aparece como aviso esperado nos logs.

Para repetir:

```powershell
node --check .\js\script.js
node --check .\js\calculos_trabalhistas.js
node --check .\js\conexao_sheets.js
node .\testes-modulos.cjs
```

Os testes de integração são **simulados**, não uma aprovação de produção. Um teste manual dos HTMLs reais ainda é necessário. Um arquivo `testes/index.html` opcional demonstra o carregamento dos três scripts no navegador, preferencialmente sob um servidor local.

### Escopo preservado

A divisão não redesenha o banco de dados nem modifica o contrato de comunicação da API. Mantive as rotinas e os campos existentes, com alterações pontuais para evitar redeclarações e corrigir o reconhecimento salarial. O script principal agora contém aproximadamente 2.790 linhas em vez das 3.867 do monólito enviado. Para uma segunda etapa, telas, relatórios e CRUD podem ser separados em mais módulos, **após** revisão dos HTMLs que chamam funções globais.
