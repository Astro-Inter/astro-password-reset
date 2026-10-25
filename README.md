# Astro Password Reset

Microsserviço TypeScript para solicitar e confirmar recuperação de senha no Firebase Authentication, executado no Cloudflare Workers. Tarefa: [SCRUM-625](https://luizacursino.atlassian.net/browse/SCRUM-625). Sem banco de dados, armazenamento de códigos, Firebase Admin SDK ou servidor Node em produção.

## Execução local

Requer Node 24 LTS e npm. Os scripts chamam os executáveis por Node para funcionar também em caminhos Windows com espaços e `&`.

```sh
npm ci
cp .dev.vars.example .dev.vars
# Preencha FIREBASE_API_KEY em .dev.vars com a chave Web do seu projeto.
npm run typegen
npm run typecheck
npm test
npm run dev
```

O Wrangler inicia em `http://localhost:8787`. `.dev.vars` é ignorado pelo Git. O exemplo habilita CORS somente para localhost/127.0.0.1:5173; ajuste as origens se o Vite usar outra porta. Sem configuração válida, o serviço responde 503. Nenhum segredo real acompanha o projeto.

`npm test` gera o bundle e executa testes de contrato com Firebase simulado, além de um teste no workerd com o binding nativo de rate limiting. Não envia e-mails reais. `npm run build` prepara o bundle sem publicar; `npm run deploy` publica no Cloudflare. O Miniflare de teste usa exatamente a versão transitiva distribuída pelo Wrangler fixado. O override de `undici` 7.30.1 corrige os avisos presentes na dependência 7.29.1 do runtime local.

## Arquitetura

`src/index.ts` expõe apenas o handler do Worker; `app.ts` aplica configuração, HTTPS, CORS, roteamento e limite por IP. `http.ts` limita e interpreta JSON e padroniza respostas. `validation.ts` valida campos. `firebase.ts` faz a única chamada externa por operação, com timeout de 8 segundos e sem seguir redirects. `types.ts` descreve o ambiente; `worker-configuration.d.ts` contém os tipos do Wrangler, gerados com `npm run typegen`.

Fluxo: Web → Worker → Firebase REST → e-mail nativo → `/replacePassword?mode=resetPassword&oobCode=...` → Worker confirma nova senha → Web abre `/passwordChanged`. A conta é determinada exclusivamente pelo código. O serviço não cria sessões e não altera usuários por e-mail informado no reset.

## Contratos HTTP

Exatamente dois endpoints de negócio, ambos POST. OPTIONS atende somente ao preflight dessas rotas. Outros caminhos retornam 404; outros métodos, 405. Não há endpoint de consulta de código: o Firebase valida e consome o código na confirmação.

```http
POST /auth/forgot-password
Content-Type: application/json

{"email":"usuario@exemplo.com"}
```

HTTP 200, inclusive para conta inexistente ou desabilitada:

```json
{"success":true,"message":"Se o e-mail informado estiver cadastrado, você receberá instruções para redefinir sua senha."}
```

O serviço envia `requestType: PASSWORD_RESET`, e-mail sem espaços nas pontas e `X-Firebase-Locale: pt-BR` para `accounts:sendOobCode`. Não acrescenta `continueUrl`: isso não configura o handler do e-mail. Retornos de sucesso sem e-mail também são aceitos para preservar a proteção de privacidade do Firebase. Falhas operacionais não são tratadas como envio bem-sucedido.

```http
POST /auth/reset-password
Content-Type: application/json

{"oobCode":"CODIGO_RECEBIDO_NO_EMAIL","newPassword":"NovaSenhaSegura123!"}
```

HTTP 200:

```json
{"success":true,"message":"Senha alterada com sucesso."}
```

Envia somente código e senha para `accounts:resetPassword`. Ignora campos extras; nenhum e-mail ou identificador enviado pelo cliente escolhe a conta. Senhas não são aparadas nem normalizadas. A validação local aceita 6–4096 caracteres; o Firebase é a autoridade final da política, inclusive requisitos mais fortes. O Web mantém sua política existente de 8–128 caracteres, com maiúscula, minúscula, número e confirmação.

Erros sempre usam este envelope, sem corpo bruto do Firebase:

```json
{"success":false,"error":{"code":"INVALID_OR_EXPIRED_CODE","message":"O link de recuperação é inválido ou expirou. Solicite um novo."}}
```

| HTTP | Código | Quando |
| --- | --- | --- |
| 400 | INVALID_EMAIL | Tipo, presença, tamanho ou formato de e-mail inválido |
| 400 | INVALID_JSON / INVALID_PAYLOAD | JSON malformado ou valor diferente de objeto |
| 400 | INVALID_OR_EXPIRED_CODE | Código ausente, inválido, expirado ou usado; conta indisponível |
| 400 | INVALID_PASSWORD | Senha fora dos limites ou rejeitada pela política Firebase |
| 400 | HTTPS_REQUIRED | HTTP em produção |
| 403 | ORIGIN_NOT_ALLOWED / HEADERS_NOT_ALLOWED | Origem ou cabeçalho não permitido |
| 404 / 405 | NOT_FOUND / METHOD_NOT_ALLOWED | Rota ou método não permitido |
| 413 / 415 | PAYLOAD_TOO_LARGE / UNSUPPORTED_MEDIA_TYPE | Corpo acima de 8 KiB ou Content-Type incorreto |
| 429 | RATE_LIMITED | Limite local excedido; Retry-After: 60 |
| 503 | PROVIDER_UNAVAILABLE / SERVICE_UNAVAILABLE | Rede, timeout, quota/configuração do provedor ou ambiente inválido |

## Configuração

| Variável/binding | Produção | Uso |
| --- | --- | --- |
| FIREBASE_API_KEY | cadastrar pelo Wrangler secret | Chave Web do projeto Firebase, nunca chave administrativa |
| FRONTEND_BASE_URL | https://astro-inter.github.io/astro-web | Contrato e validação de configuração; não altera templates remotamente |
| ALLOWED_ORIGINS | https://astro-inter.github.io | Origens completas separadas por vírgula, sem caminhos |
| APP_ENV | production | HTTPS obrigatório; development permite origens locais HTTP |
| PASSWORD_RATE_LIMITER | binding em wrangler.jsonc | Cinco chamadas por minuto por IP, compartilhadas entre os dois endpoints |

## Firebase: configuração manual necessária

1. Use o mesmo projeto Firebase do Astro Web e habilite login por e-mail/senha. Confira a política real de senhas e mantenha a proteção contra enumeração de e-mails habilitada.
2. Em Authentication → Settings → Authorized domains, confira/adicione `astro-inter.github.io`. Domínios não contêm `/astro-web`. Para testes locais, autorize localhost quando exigido pela configuração do projeto.
3. Em Authentication → Templates → Password reset → editar → Customize action URL, configure **https://astro-inter.github.io/astro-web/replacePassword**. O Firebase acrescenta `mode`, `oobCode` e possíveis parâmetros adicionais. `FRONTEND_BASE_URL` no Worker não executa essa operação no Console.
4. **A documentação do Firebase informa que a URL personalizada é usada por todos os templates do projeto.** Antes de salvar em produção, inventarie verificação de e-mail, reversão de endereço e outros fluxos. O Web desta entrega aceita somente `mode=resetPassword` e rejeita outros modos sem consumir seus códigos. Não habilite a troca global até assegurar atendimento aos outros modos usados pelo Astro, ou adotar um handler comum aprovado pela equipe. A configuração global não foi alterada por este código.
5. Configure nome público/remetente como Projeto Astro, assunto de recuperação e mensagem explicando a solicitação, contendo o placeholder `%LINK%` e a orientação de ignorar caso não tenha solicitado. Use o editor nativo; recursos de personalização e envio estão sujeitos aos limites do Firebase. Não há SMTP/Resend/SendGrid nesta versão.
6. Confira restrições da Web API Key para Identity Toolkit e o contexto de chamada do Worker. Não copie automaticamente restrições HTTP-referrer de navegador para uma chave usada de servidor para servidor. Não use conta de serviço ou token administrativo.

Referências oficiais: [Firebase REST](https://firebase.google.com/docs/reference/rest/auth), [handler personalizado e impacto em templates](https://firebase.google.com/docs/auth/custom-email-handler), [edição de e-mails](https://support.google.com/firebase/answer/7000714?hl=en), [proteção contra enumeração](https://docs.cloud.google.com/identity-platform/docs/admin/email-enumeration-protection).

## Proteção contra abuso e dados sensíveis

O binding nativo Cloudflare mantém contadores fora das variáveis globais do Worker, por localização Cloudflare. O limite é aproximado, não global estrito; ataques distribuídos podem ultrapassá-lo. O namespace `625` é um identificador escolhido para esta aplicação, não um recurso remoto já provisionado. Antes do deploy confira se está livre na conta; se outro serviço o usa, escolha outro inteiro positivo. O Wrangler provisiona o binding pela configuração, sem KV/Redis/Durable Objects. Se faltar binding, falha com 503. Não há bypass silencioso em produção.

A chave de limite usa somente `CF-Connecting-IP` fornecido pela borda Cloudflare; nunca X-Forwarded-For ou e-mail. Sem esse cabeçalho em produção, responde 503. Não publique o Worker atrás de proxy que aceite falsificação desse cabeçalho. CORS não autentica clientes externos: requisições sem Origin continuam sujeitas ao limite. IP compartilhado pode limitar usuários legítimos; ajuste conforme métricas sem registrar conteúdo das solicitações. Quotas do Firebase continuam aplicáveis.

O corpo é limitado a 8 KiB mesmo sem Content-Length. Respostas usam no-store/no-referrer e não ecoam e-mail, código, senha ou erro bruto. O código não faz logs. Observabilidade do Worker está desabilitada na configuração: não habilite captura de corpos, URLs sensíveis, senhas ou códigos em Workers Logs, proxies e analytics. O e-mail do Firebase chega ao host estático com o código na URL; as políticas de acesso e retenção desse host precisam ser revisadas, pois a limpeza feita pelo JS não remove o acesso inicial dos logs do provedor.

O Web remove a query antes de inicializar o tracking e desabilita GTM durante a sessão iniciada em `/replacePassword`. Usa meta referrer no-referrer e fetch com referrerPolicy no-referrer. O código fica em memória, nunca localStorage/sessionStorage; atualizar a página depois da limpeza exige reabrir o link do e-mail. `continueUrl` e `apiKey` recebidos na query não controlam redirects ou o projeto Firebase. A navegação de sucesso é fixa.

Referências: [binding e precisão do rate limit](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/), [limites Workers Free](https://developers.cloudflare.com/workers/platform/limits/). O serviço não requer armazenamento pago ou upgrade; confira disponibilidade e cotas na conta antes de publicar.

## Deploy e verificação

```sh
npm ci
npm run typegen
npm run typecheck
npm test
npm run build
npx wrangler login
npx wrangler secret put FIREBASE_API_KEY
npm run deploy
```

No Windows, se `npx` falhar por causa de `&` no caminho, substitua `npx wrangler` por `node ./node_modules/wrangler/bin/wrangler.js`. Cadastre o secret na conta/Worker corretos. Confirme origens HTTPS e namespace antes do deploy. Use a URL efetivamente retornada pelo Wrangler; nenhuma URL de Worker foi inventada ou fixada nesta entrega.

No repositório astro-web, configure a variável do GitHub Actions `VITE_PASSWORD_RESET_API_URL` com a URL real do Worker (sem barra no final). O workflow Pages injeta essa variável no build. Se estiver ausente, o Web mostra indisponibilidade, sem cair no mock. A variável é pública: não coloque tokens ou credenciais nela.

Depois do deploy, verifique OPTIONS com a origem permitida, rejeição de origem externa, POST com JSON inválido (400), limites (429 após exceder janela), e os dois contratos em uma conta de teste autorizada. O teste real de e-mail e alteração de senha depende da configuração do Firebase. Confira que o link recebido abre `/replacePassword`, erros não abrem confirmação e sucesso abre `/passwordChanged`.

O workflow Pages do Web cria `replacePassword/index.html` e `passwordChanged/index.html` a partir do bundle, além do fallback 404 já existente. Isso atende ao acesso direto nas rotas críticas. A URL sem barra pode receber redirect de diretório do Pages; confira preservação da query no host após publicar. Abrir/atualizar as rotas localmente não comprova a versão publicada.

## Validação e limites da entrega

- API: 39 testes aprovados, incluindo timeout, privacidade, contrato Firebase, CORS, validação, erros e execução no workerd com rate limit real local. Typecheck, bundle e npm audit sem vulnerabilidades.
- Web: 391 testes aprovados, incluindo oito casos do fluxo integrado; build aprovado. Integração local do serviço real do Web com handler do Worker e Firebase simulado aprovada para envio, confirmação e código expirado.
- Acesso Firebase Console, configuração do template, envio real, alteração de senha real, publicação do Worker e verificação de rotas no Pages ficam pendentes. O deploy está preparado; testes não dependem de produção.

## Revisão Git

`main` exige PR, uma aprovação, descarte de aprovações obsoletas e aprovação do último push por outra pessoa, inclusive administradores. Force push e exclusão estão bloqueados. A implementação usa a tarefa pai SCRUM-625; subtarefas 626 (estrutura), 627 (API/testes), 628 (Web) e 629 (operação/documentação) descrevem as entregas. Não fazer merge sem revisão humana.
