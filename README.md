# Astro Password Reset

Microsserviço TypeScript para solicitar e confirmar recuperação de senha no Firebase Authentication, executado no Cloudflare Workers. Tarefa: [SCRUM-625](https://luizacursino.atlassian.net/browse/SCRUM-625). O Firebase gera e valida os códigos; o SMTP entrega o e-mail HTML próprio do Astro. Sem banco de dados, armazenamento de códigos, Firebase Admin SDK ou servidor Node em produção.

## Execução local

Requer Node 24 LTS e npm. Os scripts chamam os executáveis por Node para funcionar também em caminhos Windows com espaços e `&`.

```sh
npm ci
cp .dev.vars.example .dev.vars
# Preencha as variáveis Firebase e SMTP descritas abaixo em .dev.vars.
npm run typegen
npm run typecheck
npm test
npm run dev
```

O Wrangler inicia em `http://localhost:8787`. `.dev.vars` é ignorado pelo Git. O exemplo habilita CORS somente para localhost/127.0.0.1:5173; ajuste as origens se o Vite usar outra porta. Sem configuração válida, o serviço responde 503. Nenhum segredo real acompanha o projeto.

`npm test` gera o bundle e executa testes de contrato com Firebase simulado, além de um teste no workerd com o binding nativo de rate limiting. Não envia e-mails reais. `npm run build` prepara o bundle sem publicar; `npm run deploy` publica no Cloudflare. O Miniflare de teste usa exatamente a versão transitiva distribuída pelo Wrangler fixado. O override de `undici` 7.30.1 corrige os avisos presentes na dependência 7.29.1 do runtime local.

## Arquitetura

`src/index.ts` expõe o handler e agenda telemetria; `app.ts` aplica configuração, HTTPS, CORS, roteamento e limite por IP. `http.ts` interpreta JSON e padroniza respostas. `validation.ts` valida campos. `firebase.ts` confirma a senha e suporta envio nativo opcional. `google-auth.ts` usa jose/Web Crypto para obter autorização Google. `recovery-email.ts` gera o link no Firebase e envia via SMTP/TLS, com orçamento total de sessenta segundos. As chamadas HTTP usam redirect manual, compatível com workerd, e rejeitam respostas de redirecionamento. `src/templates/` contém HTML/texto e a logo inline. `types.ts` descreve o ambiente; os tipos de runtime são gerados pelo Wrangler.

Fluxo padrão: Web → Worker → OAuth Google → Firebase REST gera link sem enviar e-mail → SMTP entrega HTML/texto Astro → `/replacePassword?mode=resetPassword&oobCode=...` → Worker confirma nova senha no Firebase → Web abre `/passwordChanged`. A conta é determinada exclusivamente pelo código. O serviço não cria sessões e não altera usuários por e-mail informado no reset.

O fluxo foi adaptado de [Ludos Password Reset](https://github.com/Ludos-Souk/ludos-password-reset), a pedido do usuário: e-mail próprio enviado pelo backend. Aqui a implementação usa APIs HTTP, sockets SMTP e jose compatíveis com Workers, sem Express, Admin SDK, Firestore ou funcionalidades de atendimento do Ludos.

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

No modo `smtp`, o serviço envia `requestType: PASSWORD_RESET`, e-mail sem espaços nas pontas, `targetProjectId` e `returnOobLink: true` ao Firebase, com autorização OAuth de conta de serviço. O Firebase não envia e-mail nessa operação. O Worker extrai apenas o `oobCode` da resposta confiável e monta o destino fixo do Astro Web, sem redirecionamento controlado pelo cliente. O servidor SMTP precisa aceitar a mensagem com código 250 após DATA antes da resposta de sucesso; isso significa aceitação para processamento, não confirmação de chegada à caixa de entrada. Falhas operacionais retornam 503; conta inexistente/desabilitada mantém resposta genérica, incluindo HTTP 200 sem link quando a proteção contra enumeração está ativa.

O modo `native` permanece disponível explicitamente para usar e-mail do Firebase. Nesse modo, `continueUrl` não configura o handler; respostas sem e-mail são aceitas para preservar a proteção de privacidade. O Wrangler e o exemplo local estão configurados para `smtp`; falta de credenciais não causa fallback silencioso para outro remetente ou template.

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
| EMAIL_DELIVERY_MODE | smtp | Template próprio via SMTP; native usa o e-mail do Firebase |
| FIREBASE_PROJECT_ID | astro-ba278 | Mesmo projeto Firebase do Web, usado na geração autenticada |
| FIREBASE_CLIENT_EMAIL | secret Cloudflare | E-mail da conta de serviço Google usada para gerar os links |
| FIREBASE_PRIVATE_KEY | secret Cloudflare | Chave PEM PKCS8 da conta de serviço; aceita quebras escapadas como \n |
| SMTP_HOST / SMTP_PORT | secret Cloudflare | Servidor SMTP; porta 587 com STARTTLS obrigatório ou 465 com TLS |
| SMTP_USER / SMTP_PASSWORD | secret Cloudflare | Credenciais de autenticação SMTP; no Gmail use senha de app |
| SMTP_FROM_EMAIL | secret Cloudflare | Endereço remetente autorizado pelo servidor; nome apresentado é Astro |
| OTEL_EXPORTER_OTLP_ENDPOINT | https://otlp-gateway-prod-sa-east-1.grafana.net/otlp | Endpoint base público do Grafana; o exportador acrescenta /v1/logs |
| OTEL_EXPORTER_OTLP_HEADERS | secret Cloudflare | Authorization no formato OTEL, com Basic e espaço codificado como %20 |
| PASSWORD_RATE_LIMITER | binding em wrangler.jsonc | Cinco chamadas por minuto por IP, compartilhadas entre os dois endpoints |

## Firebase: configuração manual necessária

1. Use o mesmo projeto Firebase do Astro Web e habilite login por e-mail/senha. Confira a política real de senhas e mantenha a proteção contra enumeração de e-mails habilitada.
2. Em Authentication → Settings → Authorized domains, confira/adicione `astro-inter.github.io`. Domínios não contêm `/astro-web`. Para testes locais, autorize localhost quando exigido pela configuração do projeto.
3. Para `smtp`, configure uma conta de serviço no projeto correto com a permissão `firebaseauth.users.sendEmail`, necessária para geração de link, seguindo o menor privilégio. Cadastre client email e chave privada somente como secrets. A assinatura JWT RS256 é feita pela biblioteca jose e trocada por um access token de escopo Identity Toolkit. Não há armazenamento de senhas ou códigos; a credencial administrativa deve ficar exclusivamente no Worker.
4. No modo `smtp`, **não é necessário mudar a Custom Email Action URL global no Console**: o Worker monta o link do Astro Web a partir do código retornado. O HTML é versionado neste repositório. Outros templates Firebase continuam com a configuração atual.
5. Somente se optar por `native`: configure a Custom Email Action URL como **https://astro-inter.github.io/astro-web/replacePassword**. A documentação Firebase informa que essa alteração afeta todos os templates; antes de ativá-la, assegure atendimento aos outros modos usados pelo Astro. O Web aceita somente resetPassword. `continueUrl` e FRONTEND_BASE_URL não executam essa alteração no Console.
6. Confira as restrições da Web API Key para Identity Toolkit e o contexto servidor-servidor. Ela continua usada na confirmação via REST; não é substituída pela conta de serviço. Não copie automaticamente restrições HTTP-referrer de navegador para a chamada do Worker.

Referências oficiais: [Firebase REST](https://firebase.google.com/docs/reference/rest/auth), [handler personalizado e impacto em templates](https://firebase.google.com/docs/auth/custom-email-handler), [edição de e-mails](https://support.google.com/firebase/answer/7000714?hl=en), [proteção contra enumeração](https://docs.cloud.google.com/identity-platform/docs/admin/email-enumeration-protection).

## Template próprio e SMTP

O template em `src/templates/password-reset.ts` segue o [Figma Astro](https://www.figma.com/design/qdCrRXAVuiNhNkBuim95zz/Astro-2%C2%B0-ano?node-id=4791-6753): fundo contínuo #1c1839, textos #f6f6f6/#bcbacc, Montserrat e botão #8f00c4. Usa logo e ilustração oficial do envelope orbital em anexos inline (CID), link alternativo, orientação de segurança e versão em texto. A logo foi reutilizada do Astro Web; ilustração, fontes, licença e referências ficam em `assets/email/`. `npm run assets:email` regenera os assets incorporados usados pelo Worker.

O HTML usa tabelas e estilos inline. As fontes são incorporadas para clientes que aceitam @font-face, com fallback Arial/Helvetica e tratamento MSO; não há busca externa de imagens/fontes. Dados do link são escapados. Não afirma validade fixa de 24 horas: a validade e o uso único são controlados pelo Firebase. A prévia foi conferida no Chrome em 680px e 390px, sem overflow, com logo/ilustração proporcionais e foco visível. Gmail/Outlook e possíveis ajustes automáticos de cores/fontes continuam dependendo de teste com entrega real.

O envio usa sockets TCP nativos do Cloudflare. Na porta 587, STARTTLS é obrigatório antes da autenticação LOGIN; na porta 465, TLS começa na conexão. O e-mail MIME multipart inclui texto, HTML e imagens inline com Content-ID. A conexão é encerrada após a aceitação da mensagem, inclusive em falhas e cancelamento. Credenciais ficam em secrets e não são registradas em logs. Não há reescrita de links ou tracking de abertura pelo código.

Para visualizar sem enviar:

```sh
npm run preview:email
# Abra dist/email-preview.html; a versão texto está em dist/email-preview.txt.
```

A prévia usa um código fictício e substitui o CID da logo por data URI apenas para exibição local. O e-mail enviado mantém o anexo inline. Conferência no navegador não comprova renderização no Gmail/Outlook: testar uma entrega real somente após configurar as credenciais.

Referências: [geração autenticada returnOobLink](https://docs.cloud.google.com/identity-platform/docs/reference/rest/v1/accounts/sendOobCode), [OAuth conta de serviço](https://developers.google.com/identity/protocols/oauth2/service-account), [sockets TCP Cloudflare](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/).

## Proteção contra abuso e dados sensíveis

O binding nativo Cloudflare mantém contadores fora das variáveis globais do Worker, por localização Cloudflare. O limite é aproximado, não global estrito; ataques distribuídos podem ultrapassá-lo. O namespace `625` é um identificador escolhido para esta aplicação, não um recurso remoto já provisionado. Antes do deploy confira se está livre na conta; se outro serviço o usa, escolha outro inteiro positivo. O Wrangler provisiona o binding pela configuração, sem KV/Redis/Durable Objects. Se faltar binding, falha com 503. Não há bypass silencioso em produção.

A chave de limite usa somente `CF-Connecting-IP` fornecido pela borda Cloudflare; nunca X-Forwarded-For ou e-mail. Sem esse cabeçalho em produção, responde 503. Não publique o Worker atrás de proxy que aceite falsificação desse cabeçalho. CORS não autentica clientes externos: requisições sem Origin continuam sujeitas ao limite. IP compartilhado pode limitar usuários legítimos; ajuste conforme métricas sem registrar conteúdo das solicitações. Quotas do Firebase continuam aplicáveis.

O corpo é limitado a 8 KiB mesmo sem Content-Length. Respostas usam no-store/no-referrer e não ecoam e-mail, código, senha ou erro bruto. Os logs OTLP usam exclusivamente os metadados permitidos descritos abaixo. A captura automática do Worker permanece desabilitada: não habilite captura de corpos, URLs sensíveis, senhas ou códigos em Workers Logs, proxies e analytics. O e-mail do Firebase chega ao host estático com o código na URL; as políticas de acesso e retenção desse host precisam ser revisadas, pois a limpeza feita pelo JS não remove o acesso inicial dos logs do provedor.

O Web remove a query antes de inicializar o tracking e desabilita GTM durante a sessão iniciada em `/replacePassword`. Usa meta referrer no-referrer e fetch com referrerPolicy no-referrer. O código fica em memória, nunca localStorage/sessionStorage; atualizar a página depois da limpeza exige reabrir o link do e-mail. `continueUrl` e `apiKey` recebidos na query não controlam redirects ou o projeto Firebase. A navegação de sucesso é fixa.

Referências: [binding e precisão do rate limit](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/), [limites Workers Free](https://developers.cloudflare.com/workers/platform/limits/). O serviço não requer armazenamento pago ou upgrade; confira disponibilidade e cotas na conta antes de publicar.

## Logs no Grafana Cloud

`src/telemetry.ts` envia logs OTLP/HTTP JSON diretamente para o Grafana, sem SDK Node, coletor ou processo persistente. Cada requisição concluída agenda uma exportação com `context.waitUntil`, fora do tempo de resposta da API. Há timeout de três segundos, sem retries; falhas do coletor não mudam a resposta da API. É uma entrega best effort: indisponibilidade e quotas podem causar perda de logs. Uma requisição ao coletor por chamada da API aumenta os subrequests; acompanhe o volume e a retenção no Grafana.

Campos permitidos: serviço fixo `astro-password-reset`, ambiente conhecido, rota entre os dois caminhos definidos (ou `unmatched`), método conhecido, status HTTP, duração e UUID gerado pelo servidor. O UUID também aparece no header `X-Request-ID`. Status 2xx/3xx usam INFO, 4xx WARN e 5xx ERROR. Não há e-mail, IP, query string, URL completa, headers do cliente, corpo, senha, oobCode ou erro bruto do Firebase nos eventos. Isso cobre logs das requisições HTTP concluídas; não captura automaticamente exceções de inicialização, traces ou métricas.

O endpoint público está no Wrangler. A credencial real fica somente em `.dev.vars` (ignorado) e no GitHub Actions secret `OTEL_EXPORTER_OTLP_HEADERS`, nunca no Git ou no frontend. O secret do GitHub não é copiado automaticamente para o Cloudflare por este projeto. Sem ambas as variáveis, a exportação fica inativa.

Após o primeiro deploy criar o Worker, cadastre a mesma autorização no Cloudflare:

```sh
npx wrangler secret put OTEL_EXPORTER_OTLP_HEADERS
# Cole o valor OTEL completo: Authorization=Basic%20...
```

O exportador decodifica o `%20` e envia apenas o header Authorization. Não acrescente `/v1/logs` à variável de endpoint base; o código já faz isso. O endpoint fornecido foi validado com um evento sintético sem dados de usuários e respondeu HTTP 204 (aceito). O secret de ingestão também é cadastrado no Cloudflare durante a publicação. Não foi feita alteração de senha real.

Para consultar: no Grafana, abra Explore, selecione a fonte de logs/Loki e filtre `{service_name="astro-password-reset"}` no intervalo recente. O evento é `password_reset.request_completed`; os metadados permitem filtrar status, rota e request ID. A indexação pode demorar alguns minutos. A chave fornecida é de ingestão; a confirmação HTTP valida o recebimento, sem comprovar uma consulta no Explore.

Referências: [endpoint OTLP Grafana](https://grafana.com/docs/grafana-cloud/send-data/otlp/send-data-otlp/), [formato OTLP de logs](https://github.com/open-telemetry/opentelemetry-proto/blob/main/examples/logs.json).

## Deploy e verificação

```sh
npm ci
npm run typegen
npm run typecheck
npm test
npm run build
npx wrangler login
npx wrangler secret put FIREBASE_API_KEY
npx wrangler secret put FIREBASE_CLIENT_EMAIL
npx wrangler secret put FIREBASE_PRIVATE_KEY
npx wrangler secret put SMTP_HOST
npx wrangler secret put SMTP_PORT
npx wrangler secret put SMTP_USER
npx wrangler secret put SMTP_PASSWORD
npx wrangler secret put SMTP_FROM_EMAIL
npx wrangler secret put OTEL_EXPORTER_OTLP_HEADERS
npm run deploy
```

No Windows, se `npx` falhar por causa de `&` no caminho, substitua `npx wrangler` por `node ./node_modules/wrangler/bin/wrangler.js`. Cadastre o secret na conta/Worker corretos. Confirme origens HTTPS e namespace antes do deploy. Use a URL efetivamente retornada pelo Wrangler; nenhuma URL de Worker foi inventada ou fixada nesta entrega.

A API publicada está em https://astro-password-reset.app-4str0.workers.dev, com Firebase, SMTP e Grafana em secrets. CORS e rejeição de código fictício foram conferidos no ambiente publicado; nenhuma senha foi alterada e nenhum e-mail real foi enviado.

O job de deploy no GitHub Actions executa somente após validação e push na main, quando a variável CLOUDFLARE_DEPLOY_ENABLED estiver true. Cadastre o secret CLOUDFLARE_API_TOKEN com permissão Workers Scripts Edit restrita à conta, e a variável CLOUDFLARE_ACCOUNT_ID. Os secrets de aplicação continuam no Cloudflare. O deploy automático permanece desativado até cadastrar esse token; a sessão OAuth local do Wrangler não é copiada para o GitHub. A proteção de PR e aprovação da main continua obrigatória.

No repositório astro-web, configure a variável do GitHub Actions `VITE_PASSWORD_RESET_API_URL` com a URL real do Worker (sem barra no final). O workflow Pages injeta essa variável no build. Se estiver ausente, o Web mostra indisponibilidade, sem cair no mock. A variável é pública: não coloque tokens ou credenciais nela.

Depois do deploy, verifique OPTIONS com a origem permitida, rejeição de origem externa, POST com JSON inválido (400), limites (429 após exceder janela), e os dois contratos em uma conta de teste autorizada. O teste real de e-mail e alteração de senha depende da configuração do Firebase. Confira que o link recebido abre `/replacePassword`, erros não abrem confirmação e sucesso abre `/passwordChanged`.

O workflow Pages do Web cria `replacePassword/index.html` e `passwordChanged/index.html` a partir do bundle, além do fallback 404 já existente. Isso atende ao acesso direto nas rotas críticas. A URL sem barra pode receber redirect de diretório do Pages; confira preservação da query no host após publicar. Abrir/atualizar as rotas localmente não comprova a versão publicada.

## Validação e limites da entrega

- API: 67 testes aprovados, incluindo geração Firebase autenticada e envio SMTP simulados, assinatura JWT verificada, HTML/texto e logo, privacidade, timeout, CORS, execução no workerd, rate limit local e OTLP. Typecheck e bundle aprovados; npm audit sem vulnerabilidades após adicionar jose.
- Web: 391 testes aprovados, incluindo oito casos do fluxo integrado; build aprovado. Integração local do serviço real do Web com handler do Worker e Firebase simulado aprovada para envio, confirmação e código expirado.
- Template padrão Firebase foi consultado, mas não alterado. Autenticação Google e SMTP com STARTTLS validadas em workerd sem enviar mensagem. Envio real, alteração de senha real e verificação das rotas publicadas no Pages exigem uma conta de teste autorizada. Prévia local do HTML foi conferida. Os testes automatizados não dependem de produção.

## Revisão Git

`main` exige PR, uma aprovação, descarte de aprovações obsoletas e aprovação do último push por outra pessoa, inclusive administradores. Force push e exclusão estão bloqueados. A implementação usa a tarefa pai SCRUM-625; subtarefas 626 (estrutura), 627 (API/testes), 628 (Web), 629 (operação), 630 (Grafana) e 631 (e-mail próprio) descrevem as entregas. Não fazer merge sem revisão humana.

## Correção de timeout — SCRUM-643

O envio completo autorizado reproduziu cancelamento aos oito segundos durante DATA, após autenticação SMTP e aceitação do destinatário. Com orçamento de trinta segundos, o SMTP aceitou a mensagem em aproximadamente 10,7 segundos no workerd local. O orçamento de produção passa a 60 segundos e o Web deve aguardar 70 segundos para permitir a resposta do Worker. A resposta de sucesso continua dependendo da aceitação SMTP (250 após DATA), sem garantir chegada à caixa de entrada. Não há retry automático, evitando duplicar mensagens após respostas ambíguas.

## Diagnóstico operacional

Consulte [os campos e limites dos novos diagnósticos](docs/observability-diagnostics.md) para investigar falhas por requisição ou execução no Grafana.
