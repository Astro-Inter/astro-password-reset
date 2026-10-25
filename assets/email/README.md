# Assets do e-mail Astro

- `recovery-planet.png`: ilustração original retornada pelo Figma para o node `4798:6603`, dentro da tela `emailSend` (`4791:6753`) do arquivo `qdCrRXAVuiNhNkBuim95zz`. Dimensões originais 1419 × 1109, preservadas. Sem edição ou recorte; o HTML mantém a proporção. Arquivo usado como anexo inline `cid:recovery-planet`.
- `montserrat-400.woff2` e `montserrat-600.woff2`: Montserrat Latin, reutilizada do pacote `@fontsource/montserrat` do Astro Web. Licença completa em `Montserrat-OFL.txt`. Fontes incorporadas no HTML para clientes que aceitam `@font-face`; Arial/Helvetica são os fallbacks, inclusive no Outlook MSO.
- A logo continua vindo de `src/templates/astro-logo.ts`, reutilizada de `astro-web/public/logo.png`, correspondendo ao imagotipo da marca.

Referência: [Astro no Figma](https://www.figma.com/design/qdCrRXAVuiNhNkBuim95zz/Astro-2%C2%B0-ano?node-id=4791-6753). Cores e tipografia conferidas no Brand Board (`1053:1533`) e na tela replacePassword (`4798:6614`). O e-mail adapta essas referências; não é uma exportação integral da interface Web.

Execute `npm run assets:email` após atualizar os arquivos para regenerar `src/templates/design-assets.ts`. O Worker importa os valores gerados, sem filesystem em runtime e sem URLs temporárias ou requisições externas para imagens/fontes. `npm run preview:email` substitui somente os CIDs por data URIs na prévia local; a entrega SendGrid usa anexos inline.
