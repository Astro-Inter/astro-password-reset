import { HttpError } from './http.ts';
import type { WorkerEnv } from './types.ts';

export interface SmtpMessage {
  from: string; to: string; subject: string; text: string; html: string;
  attachments: { filename: string; content: string; cid: string }[];
}
export type SmtpDeliver = (message: SmtpMessage, env: WorkerEnv, signal: AbortSignal) => Promise<void>;
export interface SmtpSocket {
  readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array>;
  opened: Promise<unknown>; close(): Promise<unknown>; startTls(): SmtpSocket;
}
export type SmtpConnect = (address: { hostname: string; port: number }, options: { secureTransport: 'on' | 'starttls'; allowHalfOpen: boolean }) => SmtpSocket;
const unavailable = () => new HttpError(503, 'PROVIDER_UNAVAILABLE', 'Não foi possível concluir a solicitação agora. Tente novamente.');
const base64 = (value: string) => btoa(Array.from(new TextEncoder().encode(value), byte => String.fromCharCode(byte)).join(''));
const wrap = (value: string) => value.match(/.{1,76}/g)?.join('\r\n') ?? '';
function mailbox(value: string): string {
  if (value.length > 254 || !/^[^\s<>\x00-\x1f\x7f@]+@[^\s<>\x00-\x1f\x7f@]+\.[^\s<>\x00-\x1f\x7f@]+$/.test(value)) throw unavailable();
  return value;
}
export function mimeMessage(mail: SmtpMessage): string {
  const outer = `related-${crypto.randomUUID()}`, inner = `alternative-${crypto.randomUUID()}`;
  const parts = [
    `From: Astro <${mailbox(mail.from)}>`, `To: <${mailbox(mail.to)}>`,
    `Subject: =?UTF-8?B?${base64(mail.subject)}?=`, `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@astro-inter.github.io>`, 'MIME-Version: 1.0',
    `Content-Type: multipart/related; boundary="${outer}"`, '', `--${outer}`,
    `Content-Type: multipart/alternative; boundary="${inner}"`, '',
  ];
  for (const [type, content] of [['plain', mail.text], ['html', mail.html]]) {
    parts.push(`--${inner}`, `Content-Type: text/${type}; charset=UTF-8`, 'Content-Transfer-Encoding: base64', '', wrap(base64(content!)));
  }
  parts.push(`--${inner}--`);
  for (const asset of mail.attachments) {
    if (!/^[\w.-]+$/.test(asset.filename) || !/^[\w.-]+$/.test(asset.cid) || !/^[A-Za-z0-9+/]*={0,2}$/.test(asset.content)) throw unavailable();
    parts.push(`--${outer}`, 'Content-Type: image/png', 'Content-Transfer-Encoding: base64',
      `Content-Disposition: inline; filename="${asset.filename}"`, `Content-ID: <${asset.cid}>`, '', wrap(asset.content));
  }
  parts.push(`--${outer}--`, '');
  return parts.join('\r\n');
}

/** Sem mensagem, verifica TLS e autenticação sem enviar e-mail. */
export async function smtpSession(env: WorkerEnv, signal: AbortSignal, mail?: SmtpMessage, connector?: SmtpConnect): Promise<void> {
  let socket: SmtpSocket | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let writer: WritableStreamDefaultWriter<Uint8Array> | undefined;
  const abort = () => { void socket?.close().catch(() => {}); };
  try {
    const port = Number(env.SMTP_PORT);
    if (!env.SMTP_HOST || !/^[a-zA-Z0-9.-]+$/.test(env.SMTP_HOST) || ![465, 587].includes(port) || !env.SMTP_USER || !env.SMTP_PASSWORD || signal.aborted) throw unavailable();
    if (mail) { mailbox(mail.from); mailbox(mail.to); }
    const connect = connector ?? (await import('cloudflare:sockets')).connect;
    socket = connect({ hostname: env.SMTP_HOST, port }, { secureTransport: port === 465 ? 'on' : 'starttls', allowHalfOpen: false });
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) throw unavailable();
    await socket.opened;
    reader = socket.readable.getReader(); writer = socket.writable.getWriter();
    let buffered = '';
    const decoder = new TextDecoder();
    const reply = async (expected: number[]): Promise<string> => {
      let result = '', code = '';
      while (true) {
        while (!buffered.includes('\r\n')) {
          const chunk = await reader!.read();
          if (chunk.done) throw unavailable();
          buffered += decoder.decode(chunk.value, { stream: true });
          if (buffered.length + result.length > 32768) throw unavailable();
        }
        const end = buffered.indexOf('\r\n'), line = buffered.slice(0, end);
        buffered = buffered.slice(end + 2);
        const match = /^(\d{3})([ -])/.exec(line);
        if (!match || (code && code !== match[1])) throw unavailable();
        code = match[1]!; result += line + '\r\n';
        if (result.length > 32768) throw unavailable();
        if (match[2] === ' ') {
          if (!expected.includes(Number(code))) throw unavailable();
          return result;
        }
      }
    };
    const command = async (value: string, expected: number[]) => {
      if (signal.aborted) throw unavailable();
      await writer!.write(new TextEncoder().encode(value + '\r\n'));
      return reply(expected);
    };
    await reply([220]);
    let capabilities = await command('EHLO astro-inter.github.io', [250]);
    if (port === 587) {
      if (!/^250[ -]STARTTLS\b/im.test(capabilities)) throw unavailable();
      await command('STARTTLS', [220]);
      if (buffered) throw unavailable();
      reader.releaseLock(); writer.releaseLock();
      socket = socket.startTls(); await socket.opened;
      reader = socket.readable.getReader(); writer = socket.writable.getWriter();
      capabilities = await command('EHLO astro-inter.github.io', [250]);
    }
    if (!/^250[ -]AUTH\b[^\r\n]*\bLOGIN\b/im.test(capabilities)) throw unavailable();
    await command('AUTH LOGIN', [334]);
    await command(base64(env.SMTP_USER), [334]);
    await command(base64(env.SMTP_PASSWORD), [235]);
    if (!mail) return;
    await command(`MAIL FROM:<${mail.from}>`, [250]);
    await command(`RCPT TO:<${mail.to}>`, [250, 251]);
    const mime = mimeMessage(mail);
    await command('DATA', [354]);
    await command(mime.replace(/^\./gm, '..') + '\r\n.', [250]);
  } catch { throw unavailable(); }
  finally {
    signal.removeEventListener('abort', abort);
    reader?.releaseLock(); writer?.releaseLock();
    await socket?.close().catch(() => {});
  }
}
export const sendSmtp: SmtpDeliver = (message, env, signal) => smtpSession(env, signal, message);
