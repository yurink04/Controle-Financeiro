# Controle Financeiro — pacote integrado

Pacote de atualização das telas de **perfil**, **configurações**, **auditoria**, **lançamentos** e **login**, junto com `script.js`, `style.css` e o backend `Code.gs`. As demais páginas do seu projeto permanecem como estão e devem ficar na mesma pasta do script e CSS compartilhados.

## Como instalar

1. **Faça backup** da planilha Google Sheets e da pasta atual do site. Guarde também uma cópia da implantação existente do Apps Script.
2. Copie `index.html`, `perfil.html`, `configuracoes.html`, `admin-logs.html`, `lancamentos.html`, `script.js` e `style.css` para a pasta raiz do site, substituindo somente esses arquivos. **Mantenha os demais HTMLs e a pasta `imagens/`**. Em especial, `imagens/loading1.gif`, `imagens/home.png` e os ícones que seu site já utiliza continuam sendo necessários.
3. No editor Google Apps Script ligado à sua planilha, atualize todo o conteúdo do arquivo de backend com `Code.gs`. Confira as propriedades do script:
   - `SENHA_MESTRA_API`: deve corresponder à constante `TOKEN_API` do `script.js`.
   - `SENHA_ADMIN`: senha administrativa própria, **diferente da senha de login**.
4. **Implante uma nova versão** do aplicativo da Web (Gerenciar implantações → Editar → Nova versão). Confirme se a URL `/exec` corresponde à constante `API_URL` do `script.js`. Apenas salvar o código no editor **não** atualiza a versão implantada.
5. Após fazer o backup, teste primeiro com uma cópia da planilha ou uma implantação de homologação: login, perfil, criação de usuário, mudança de senha, lançamento e sincronização. Limpe/atualize o cache do navegador (`Ctrl+F5`) depois de substituir os arquivos.
6. Opcional: execute **uma única vez** a função `instalarGatilhoAlertas()` no editor Apps Script, autorizando o gatilho. Ela verifica contas a vencer diariamente, por volta das 8h no fuso do projeto, sem enviar e-mails. Também há lembretes gerados quando a pessoa entra no sistema. Confira o fuso do projeto nas configurações do Apps Script.

## O que mudou

- CSS das páginas de conta consolidado no `style.css`, com melhorias de legibilidade. O `<style>` existente no login foi movido para esse arquivo.
- Novos usuários recebem **login e senha provisória** configurados pelo administrador. Senhas novas precisam de pelo menos oito caracteres, maiúscula, minúscula, número e símbolo; no próximo acesso a troca de senha é obrigatória.
- A redefinição de senha deixa de apagar a senha do usuário. Operações de cadastro/alteração de contas exigem validação administrativa adicional.
- Login fornece sessão temporária; consultas, sincronização e ações de administração exigem sessão e permissões. Sessões são revogadas ao trocar a senha de outra conta ou desativá-la.
- O servidor não envia hashes de senha na consulta de dados. A gravação preserva as senhas armazenadas sem expô-las ao navegador.
- Limite de tentativas de login; proteção contra promoção indevida de permissões e alteração de movimentos sem autorização.
- Auditoria antiga sem identificador recebe um ID de compatibilidade, preservado na próxima gravação.
- Lembretes de vencimento respeitam a preferência do perfil e evitam duplicações; notificações aparecem no sino existente.
- A página de login esconde a opção de cadastro inicial quando o sistema já tem usuários. Em instalação vazia, o cadastro inicial exige `SENHA_ADMIN`. Cadastros posteriores são feitos em Configurações por pessoa autorizada.
- Mudanças pendentes de sincronização ficam vinculadas à conta que as criou, evitando misturá-las às de outra conta no mesmo navegador.

## Segurança e limites importantes

- **A chave `TOKEN_API` no JavaScript do navegador é pública**: não deve ser tratada como uma senha administrativa. O servidor protege operações com sessões e permissões, mas você deve cuidar da senha `SENHA_ADMIN` nas *Script Properties* e nunca incluí-la no HTML/JS. Como a chave anterior já esteve em código distribuído, é recomendável trocá-la nas propriedades e no JS ao implantar.
- Os dados financeiros continuam **compartilhados entre as contas autenticadas do mesmo sistema**, conforme o modelo do projeto. Agora existe restrição de gravação por papel e titularidade/parceiro, mas não foi criada uma separação absoluta entre espaços privados. Se pretende contas totalmente isoladas, isso exige uma revisão maior do modelo de dados e das telas.
- O navegador mantém cache local para permitir o fluxo de sincronização. Evite dispositivos compartilhados sem proteção e não exporte backups com informações pessoais para locais públicos.
- O modelo antigo de hash SHA-256 do PIN foi preservado para não bloquear acessos existentes. Usuários legados com PIN curto devem redefinir suas senhas; uma migração futura para hash com sal e derivação de chave no servidor é recomendável.
- **Teste real** de publicação, autenticação e escrita na sua planilha deve ser feito na implantação Apps Script. O script de teste incluído usa uma planilha simulada, sem tocar em dados reais.

## Verificações locais

Com Node.js instalado, na pasta destes arquivos:

```bash
node validar-integracao.cjs
```

O teste verifica a sintaxe dos scripts, sessões, validação administrativa, bloqueio de alterações indevidas, redefinição de senhas, parceiros e avisos de vencimento com dados simulados.

Se uma sincronização antiga permanecer pendente após a instalação, faça backup do navegador e reconcilie-a com a **mesma conta** antes de tentar entrar por outra. Não apague armazenamento local enquanto houver modificações sem envio.
