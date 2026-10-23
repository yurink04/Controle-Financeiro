# Controle Financeiro — arquivos auditados (23/10/2026)

Este pacote contém as versões revisadas dos cinco arquivos fornecidos, preservando a estrutura do projeto:

```
Controle Financeiro/
├── Code.gs                    # Código para editor do Google Apps Script (NÃO carregar no navegador)
├── style.css                  # Estilo das páginas na raiz
└── js/
    ├── script.js              # Núcleo da interface / regras de negócio
    ├── calculos_trabalhistas.js # Cálculos e editor salarial
    ├── conexao_sheets.js      # Persistência, revisão, conflitos, API
    └── cjs/
        ├── testes-modulos.cjs
        ├── validar-code-gs.cjs
        └── testar-fluxo-sheets.cjs
```

## Instalação segura

1. Faça backup da planilha Google Sheets, do Apps Script, dos JavaScripts e do CSS originais antes de substituir qualquer arquivo.
2. Copie os três arquivos de `js/` para `D:\GitHub\Financeiro\Controle Financeiro\js\`.
3. Copie os `.cjs` para `D:\GitHub\Financeiro\Controle Financeiro\js\cjs\`; são testes do Node, e **não** entram em `<script>` nos HTMLs.
4. Substitua o conteúdo de `style.css` na raiz do projeto.
5. Substitua o conteúdo do arquivo Code.gs no **editor do Google Apps Script vinculado à planilha** e publique/atualize a implantação do Web App. O JavaScript novo chama `statusCadastro` via POST; uma implantação antiga que só aceita GET não funciona para o primeiro acesso.
6. Confira as **Script Properties** `SENHA_MESTRA_API` e `SENHA_ADMIN`, sem copiar seus valores para logs ou tickets. A primeira deve coincidir com o token esperado pelo frontend. Verifique também se `API_URL` em `js/conexao_sheets.js` aponta para o deployment **correto** com `/exec`. Não presume que a URL de versões anteriores é válida.
7. Em cada HTML existente na raiz, inclua uma única vez, nesta ordem:

```html
<link rel="stylesheet" href="style.css">
<script defer src="js/script.js"></script>
<script defer src="js/calculos_trabalhistas.js"></script>
<script defer src="js/conexao_sheets.js"></script>
```

Evite carregar os arquivos do monolito antigo ao mesmo tempo. Os três scripts do navegador usam escopo global clássico para preservar compatibilidade com HTMLs existentes; **não** use `type="module"` sem uma migração específica.

## Testes locais (sem Google Sheets real)

Execute na raiz do repositório, com Node.js:

```powershell
node js/cjs/testes-modulos.cjs
node js/cjs/validar-code-gs.cjs
node js/cjs/testar-fluxo-sheets.cjs
```

Os testes simulam DOM, rede, Script Properties e uma planilha em memória. Não acessam seu Google Sheets. A mensagem `Sync adiada: TypeError: offline` no teste de módulos é proposital: simula queda de conexão seguida de recuperação.

## Validações manuais essenciais antes de publicar a produção

- Conferir login em conta comum e admin, troca de senha e primeiro acesso (com Code.gs **já implantado**).
- Criar/editar/excluir lançamento próprio, com e sem conexão, e comparar o Sheets após reconectar.
- Em dois dispositivos, fazer alterações independentes e depois conflitantes. Conferir que conflitos são sinalizados, não apagados.
- Conferir relacionamento recíproco entre parceiros, lançamento individual e casal, cartões/faturas compartilhados e recuperação com backup.
- Testar desktop e telefone, tema claro/escuro, modais, navegação e telas pequenas. Os HTMLs não foram fornecidos nesta revisão, então não foi possível inspecionar o resultado visual efetivo.

## Limites e decisões técnicas

- Sem arquivos HTML, não é seguro eliminar funções aparentemente sem chamadas nos `.js`: várias podem ser usadas em atributos `onclick`, scripts inline ou outras páginas.
- A API mantém o modelo **snapshot completo**. Um usuário autenticado recebe as coleções financeiras completas; a filtragem visual no frontend **não substitui** autorização ou privacidade no backend. A migração para API por usuário, mutações por registro e filtragem server-side requer alteração coordenada de frontend, backend e modelo de sincronização. Esta revisão fortaleceu gravações, mas **não implementou isolamento de leitura entre usuários**.
- `TOKEN_API` está incluído no JS do navegador e, portanto, não é segredo. A sessão e as regras de autorização do backend são o controle efetivo de acesso. Se exposto anteriormente, considere rotacionar os segredos e revisar a implantação.
- A funcionalidade e os valores de INSS/IRRF devem ser conferidos separadamente com as regras oficiais de cada competência, especialmente em casos fora da folha mensal comum.
- A compatibilidade foi demonstrada por simulações locais, não por uma execução na planilha/implantação real.
