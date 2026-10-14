import { createServer, type Server } from 'node:net';

/** Minimal SMTP server for tests: accepts every message and records it. */
export interface CapturedMail {
  from: string;
  to: string[];
  data: string;
}

export async function startSmtpSink(): Promise<{ port: number; mails: CapturedMail[]; close: () => Promise<void> }> {
  const mails: CapturedMail[] = [];
  const server: Server = createServer((socket) => {
    let current: CapturedMail = { from: '', to: [], data: '' };
    let inData = false;
    let buffer = '';
    socket.write('220 sink ESMTP\r\n');
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let idx: number;
      while ((idx = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        if (inData) {
          if (line === '.') {
            inData = false;
            mails.push(current);
            current = { from: '', to: [], data: '' };
            socket.write('250 queued\r\n');
          } else {
            current.data += `${line.startsWith('..') ? line.slice(1) : line}\n`;
          }
          continue;
        }
        const cmd = line.slice(0, 4).toUpperCase();
        if (cmd === 'EHLO' || cmd === 'HELO') socket.write('250-sink\r\n250 OK\r\n');
        else if (cmd === 'MAIL') { current.from = line.slice(10).replace(/[<>]/g, '').trim(); socket.write('250 OK\r\n'); }
        else if (cmd === 'RCPT') { current.to.push(line.slice(8).replace(/[<>]/g, '').trim()); socket.write('250 OK\r\n'); }
        else if (cmd === 'DATA') { inData = true; socket.write('354 go\r\n'); }
        else if (cmd === 'QUIT') { socket.write('221 bye\r\n'); socket.end(); }
        else socket.write('250 OK\r\n');
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return { port, mails, close: () => new Promise((r) => server.close(() => r())) };
}
