import { test } from 'node:test';
import assert from 'node:assert/strict';
import { smtpSession, mimeMessage, type SmtpConnect, type SmtpSocket, type SmtpMessage } from '../src/smtp.ts';
import type { WorkerEnv } from '../src/types.ts';

const env = { SMTP_HOST: 'smtp.example.test', SMTP_PORT: '587', SMTP_USER: 'test-user', SMTP_PASSWORD: 'test-password' } as WorkerEnv;
const mail: SmtpMessage = { from: 'sender@example.test', to: 'recipient@example.test', subject: 'Redefinição — Astro', text: 'Olá\n.link', html: '<p>Olá</p>', attachments: [{ filename: 'logo.png', cid: 'logo-astro', content: 'aGVsbG8=' }] };
function server(options: { noTls?: boolean; rejectAuth?: boolean; rejectRecipient?: boolean; eof?: boolean } = {}) {
  const commands: { secure: boolean; value: string }[] = [];
  let closed = 0, upgraded = false;
  function socket(secure: boolean): SmtpSocket {
    let input!: ReadableStreamDefaultController<Uint8Array>, auth = 0, data = false, ended = false;
    const reply = (line: string) => { if (!ended) input.enqueue(new TextEncoder().encode(line + '\r\n')); };
    const readable = new ReadableStream<Uint8Array>({ start(controller) { input = controller; } });
    if (!secure) reply('220 smtp test');
    return {
      opened: Promise.resolve(), readable,
      writable: new WritableStream({ write(bytes) {
        const value = new TextDecoder().decode(bytes).replace(/\r\n$/, '');
        commands.push({ secure, value });
        if (options.eof) { ended = true; input.close(); return; }
        if (value.startsWith('EHLO')) reply(secure ? '250-test\r\n250 AUTH LOGIN PLAIN' : options.noTls ? '250 AUTH LOGIN' : '250-test\r\n250 STARTTLS');
        else if (value === 'STARTTLS') reply('220 ready');
        else if (value === 'AUTH LOGIN') { auth = 1; reply('334 username'); }
        else if (auth === 1) { auth = 2; reply('334 password'); }
        else if (auth === 2) { auth = 0; reply(options.rejectAuth ? '535 rejected' : '235 authenticated'); }
        else if (value.startsWith('MAIL FROM')) reply('250 ok');
        else if (value.startsWith('RCPT TO')) reply(options.rejectRecipient ? '550 rejected' : '250 ok');
        else if (value === 'DATA') { data = true; reply('354 ready'); }
        else if (data) { data = false; reply('250 queued'); }
        else throw Error('unexpected command');
      } }),
      startTls() { upgraded = true; return socket(true); },
      async close() { closed++; if (!ended) { ended = true; input.close(); } },
    };
  }
  const connect: SmtpConnect = (_address, options) => {
    assert.equal(options.secureTransport, 'starttls');
    return socket(false);
  };
  return { connect, commands, closed: () => closed, upgraded: () => upgraded };
}
test('STARTTLS obrigatório precede credenciais; entrega MIME e fecha conexão', async () => {
  const mock = server();
  await smtpSession(env, AbortSignal.timeout(2000), mail, mock.connect);
  assert.equal(mock.upgraded(), true);
  assert.ok(mock.commands.filter(c => !c.secure).every(c => !c.value.includes('AUTH') && !c.value.includes(btoa(env.SMTP_PASSWORD!))));
  assert.ok(mock.commands.some(c => c.secure && c.value === 'AUTH LOGIN'));
  const data = mock.commands.at(-1)!.value;
  assert.match(data, /multipart\/related/);
  assert.match(data, /Content-ID: <logo-astro>/);
  assert.match(data, /Content-Type: text\/html; charset=UTF-8/);
  assert.match(data, /\r\n\.\r?$/);
  assert.equal(mock.closed(), 1);
});
test('verificação autentica sem enviar e-mail', async () => {
  const mock = server();
  await smtpSession(env, AbortSignal.timeout(2000), undefined, mock.connect);
  assert.ok(!mock.commands.some(c => c.value.startsWith('MAIL FROM')));
  assert.equal(mock.closed(), 1);
});
for (const options of [{ noTls: true }, { rejectAuth: true }, { rejectRecipient: true }, { eof: true }]) {
  test(`falha SMTP é segura e fecha socket: ${JSON.stringify(options)}`, async () => {
    const mock = server(options);
    await assert.rejects(smtpSession(env, AbortSignal.timeout(2000), mail, mock.connect), { code: 'PROVIDER_UNAVAILABLE' });
    assert.equal(mock.closed(), 1);
    if (options.noTls) assert.ok(!mock.commands.some(c => c.value === 'AUTH LOGIN'));
  });
}
test('MIME preserva UTF-8 e rejeita injeções em endereço ou anexos', () => {
  const mime = mimeMessage(mail);
  assert.ok(mime.includes(Buffer.from(mail.text).toString('base64')));
  assert.doesNotMatch(mime, /test-password/);
  assert.throws(() => mimeMessage({ ...mail, to: 'victim@example.test\r\nBcc: other@example.test' }));
  assert.throws(() => mimeMessage({ ...mail, attachments: [{ filename: 'bad\r\nheader', cid: 'x', content: 'eA==' }] }));
});
test('configuração insegura ou sinal já cancelado não conecta', async () => {
  const mock = server();
  for (const config of [{ ...env, SMTP_PORT: '25' }, { ...env, SMTP_PASSWORD: '' }]) {
    await assert.rejects(smtpSession(config, AbortSignal.timeout(2000), mail, mock.connect), { code: 'PROVIDER_UNAVAILABLE' });
  }
  await assert.rejects(smtpSession(env, AbortSignal.abort(), mail, mock.connect));
  assert.equal(mock.commands.length, 0);
});
