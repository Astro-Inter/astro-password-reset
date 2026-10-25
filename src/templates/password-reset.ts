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
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><title>Redefinição de senha — Astro</title></head>
<body style="margin:0;padding:0;background-color:#f0edf6;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">Crie uma nova senha para sua conta no Astro.</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background-color:#f0edf6;">
    <tr><td align="center" style="padding:32px 12px;">
      <table role="presentation" width="540" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:540px;background-color:#ffffff;border:3px solid #8f00c4;border-radius:28px;font-family:Arial,Helvetica,sans-serif;color:#28223d;">
        <tr><td align="center" style="padding:36px 24px;background-color:#1c1839;border-radius:24px 24px 0 0;"><img src="cid:logo-astro" alt="Astro" width="176" style="display:block;width:176px;max-width:100%;height:auto;border:0;"></td></tr>
        <tr><td style="padding:32px 32px 0;font-size:13px;font-weight:bold;letter-spacing:1px;color:#7411a0;">SEGURANÇA DA SUA CONTA</td></tr>
        <tr><td style="padding:12px 32px 0;"><h1 style="margin:0;font-size:28px;line-height:1.2;color:#1c1839;">Vamos redefinir sua senha?</h1></td></tr>
        <tr><td style="padding:24px 32px 0;font-size:16px;line-height:1.6;">Olá!<br><br>Recebemos uma solicitação para redefinir a senha da sua conta no <strong>Astro</strong>. Clique no botão abaixo para criar sua nova senha.</td></tr>
        <tr><td align="center" style="padding:28px 32px;"><a href="${safeLink}" target="_blank" rel="noreferrer" style="display:block;background-color:#8f00c4;color:#ffffff;text-decoration:none;border-radius:10px;padding:17px 20px;font-size:16px;font-weight:bold;line-height:1.4;">Redefinir minha senha</a></td></tr>
        <tr><td style="padding:0 32px;font-size:14px;line-height:1.6;color:#514963;">Se o botão não funcionar, copie e cole este link no navegador:<br><a href="${safeLink}" target="_blank" rel="noreferrer" style="color:#7411a0;text-decoration:underline;word-break:break-all;overflow-wrap:anywhere;">${safeLink}</a></td></tr>
        <tr><td style="padding:24px 32px 0;font-size:14px;line-height:1.6;color:#514963;">O link é temporário e só pode ser utilizado uma vez. Se ele expirar, solicite outro na tela de login.</td></tr>
        <tr><td style="padding:20px 32px 0;font-size:14px;line-height:1.6;color:#514963;">Não foi você quem solicitou? Pode ignorar este e-mail. Sua senha continuará a mesma.</td></tr>
        <tr><td style="padding:28px 32px 36px;font-size:14px;line-height:1.6;">Até mais,<br><strong>Equipe Astro</strong></td></tr>
      </table>
      <p style="margin:20px 0 0;font:12px/1.5 Arial,Helvetica,sans-serif;color:#625b70;">Mensagem automática de recuperação de conta do Astro.</p>
    </td></tr>
  </table>
</body>
</html>`;
  return { html, text };
}
