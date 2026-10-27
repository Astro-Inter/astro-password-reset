# Diagnóstico operacional dos logs

Vínculo: [SCRUM-625](https://luizacursino.atlassian.net/browse/SCRUM-625). Continuação da [PR #1](https://github.com/Astro-Inter/astro-password-reset/pull/1) na branch `feat/SCRUM-625-recuperacao-de-senha`, atualizada com a main.

## Alteração

O tratamento HTTP recolhe diagnóstico interno e o envia no log OTLP pelo mesmo request_id. Contexto de OAuth, Firebase, recuperação e fases SMTP (conexão, greeting, EHLO, STARTTLS, autenticação, remetente, destinatário e DATA), sem registrar comandos ou dados de conta.

## Como investigar

Filtre o serviço no Grafana e localize o request_id/run_id do erro. Consulte etapa/dependência, código técnico, tipo e frames. No caminho OTLP, o Loki pode normalizar pontos dos atributos para sublinhados. O diagnóstico usa metadados de código e descrições controladas em vez de mensagens livres de drivers: estas podem conter consultas, valores, credenciais ou dados pessoais.

Não use identificadores de execução, mensagens ou stacks como labels indexados de Loki. Não há mudança de destino de coleta nesta alteração; duas origens já existentes ainda podem produzir cópias do mesmo evento. Não conte registros como incidentes distintos sem correlação. Não há deploy nem simulação de erro em produção nesta PR.

## Limites

O diagnóstico não prova a causa de infraestrutura nem corrige o incidente que o originou. Eventos antes da inicialização da aplicação dependem da coleta do runtime. A correlação implementada é local à requisição/execução; a propagação de traces entre todos os serviços não foi adicionada. Métricas, alertas e políticas de retenção não foram alterados.

## Validação local

As suítes existentes verificam contratos e fluxos com dependências simuladas. Os novos testes de diagnóstico verificam a omissão de mensagens/valores e a preservação de contexto. Testes de integração que exigem serviços externos seguem as condições já existentes no projeto; os comandos e os resultados efetivamente executados estão na descrição da PR.
