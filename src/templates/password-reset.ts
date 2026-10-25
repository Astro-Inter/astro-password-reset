import { montserratRegularBase64, montserratSemiboldBase64 } from './design-assets.ts';

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}

export function passwordResetTemplate(link: string): { html: string; text: string } {
  const url = new URL(link);
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('INVALID_EMAIL_LINK');
  const safeLink = escapeHtml(link);
  const text = `Olá!\n\nRecebemos uma solicitação para redefinir a senha da sua conta no Astro.\n\nPara criar uma nova senha, acesse:\n${link}\n\nO link é temporário e só pode ser utilizado uma vez. Se ele expirar, solicite outro na tela de login.\n\nSe você não solicitou esta alteração, ignore este e-mail. Sua senha continuará a mesma.\n\nEquipe Astro`;
  const html = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark">
  <title>Redefinição de senha — Astro</title>
  <style>
    @font-face { font-family:Montserrat; font-style:normal; font-weight:400; src:url(data:font/woff2;base64,${montserratRegularBase64}) format('woff2'); }
    @font-face { font-family:Montserrat; font-style:normal; font-weight:600; src:url(data:font/woff2;base64,${montserratSemiboldBase64}) format('woff2'); }
    :root { color-scheme:dark; supported-color-schemes:dark; }
    a:focus-visible { outline:2px solid #f6f6f6; outline-offset:4px; }
    @media only screen and (max-width:480px) { .email-content { padding-left:24px !important; padding-right:24px !important; } .email-title { font-size:25px !important; line-height:33px !important; } }
  </style>
  <!--[if mso]><style>body, table, td, h1, p, a { font-family:Arial,Helvetica,sans-serif !important; }</style><![endif]-->
</head>
<body bgcolor="#1c1839" style="margin:0;padding:0;background-color:#1c1839;color:#f6f6f6;-webkit-text-size-adjust:100%;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">Crie uma nova senha para sua conta no Astro.</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#1c1839" style="width:100%;background-color:#1c1839;">
    <tr><td align="center" style="padding:0 0 32px;">
      <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" bgcolor="#1c1839" style="width:100%;max-width:600px;background-color:#1c1839;font-family:Montserrat,Arial,Helvetica,sans-serif;color:#f6f6f6;">
        <tr><td align="center" style="padding:44px 24px 4px;"><img src="cid:logo-astro" alt="Astro" width="184" style="display:block;width:184px;max-width:100%;height:auto;border:0;"></td></tr>
        <tr><td align="center" style="padding:8px 24px 6px;"><img src="cid:recovery-planet" alt="" width="300" height="234" style="display:block;width:300px;max-width:100%;height:auto;border:0;"></td></tr>
        <tr><td class="email-content" align="center" style="padding:0 44px;"><h1 class="email-title" style="margin:0;font-size:28px;font-weight:600;line-height:36px;color:#f6f6f6;">Redefina sua senha</h1></td></tr>
        <tr><td class="email-content" align="center" style="padding:14px 44px 0;font-size:16px;font-weight:400;line-height:26px;color:#bcbacc;">Recebemos uma solicitação para redefinir a senha da sua conta no Astro.</td></tr>
        <tr><td class="email-content" align="center" style="padding:28px 44px 0;">
          <table role="presentation" width="360" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:360px;"><tr><td align="center" bgcolor="#8f00c4" style="background-color:#8f00c4;border-radius:10px;mso-padding-alt:17px 24px;"><a href="${safeLink}" target="_blank" rel="noreferrer" style="display:block;background-color:#8f00c4;color:#f6f6f6;text-decoration:none;border-radius:10px;padding:17px 24px;font-size:16px;font-weight:600;line-height:22px;">Redefinir senha</a></td></tr></table>
        </td></tr>
        <tr><td class="email-content" align="center" style="padding:22px 44px 0;font-size:13px;line-height:21px;color:#bcbacc;">O link é temporário e só pode ser usado uma vez.<br>Se expirar, solicite um novo na tela de login.</td></tr>
        <tr><td class="email-content" style="padding:28px 44px 0;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td height="1" bgcolor="#444252" style="height:1px;line-height:1px;font-size:1px;background-color:#444252;">&nbsp;</td></tr></table></td></tr>
        <tr><td class="email-content" align="center" style="padding:24px 44px 0;font-size:13px;line-height:22px;color:#bcbacc;">Se o botão não funcionar, copie e cole este link no navegador:</td></tr>
        <tr><td class="email-content" align="center" style="padding:10px 44px 0;font-size:12px;line-height:20px;word-break:break-all;overflow-wrap:anywhere;"><a href="${safeLink}" target="_blank" rel="noreferrer" style="color:#bcbacc;text-decoration:underline;text-underline-offset:3px;word-break:break-all;overflow-wrap:anywhere;">${safeLink}</a></td></tr>
        <tr><td class="email-content" align="center" style="padding:24px 44px 0;font-size:13px;line-height:22px;color:#bcbacc;">Não solicitou esta alteração? Ignore este e-mail.<br>Sua senha continuará a mesma.</td></tr>
        <tr><td align="center" style="padding:28px 24px 0;font-size:14px;font-weight:600;line-height:22px;color:#f6f6f6;">Equipe Astro</td></tr>
        <tr><td align="center" style="padding:10px 24px 20px;font-size:11px;line-height:18px;color:#bcbacc;">Mensagem automática de recuperação de conta.</td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  return { html, text };
}
