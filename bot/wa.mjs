// Bot de WhatsApp de MATEANDO (número propio del bot, vinculado como
// "dispositivo" igual que WhatsApp Web). Sirve para mandar avisos a grupos.
//
//   node bot/wa.mjs login                 → muestra QR para vincular el teléfono del bot
//   node bot/wa.mjs login --code 549...   → alternativa: código de 8 letras en vez de QR
//   node bot/wa.mjs groups                → lista los grupos donde está el bot (con su id)
//   echo "hola" | node bot/wa.mjs send <group_id>
//
// La sesión se guarda en ~/.claude/.wa-bot-auth (fuera del repo).

import makeWASocket, { DisconnectReason, fetchLatestBaileysVersion, useMultiFileAuthState, Browsers } from '@whiskeysockets/baileys';
import { homedir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import qrcode from 'qrcode-terminal';

const AUTH_DIR = join(homedir(), '.claude/.wa-bot-auth');
const [cmd, ...args] = process.argv.slice(2);

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8').trim();
}

// Conecta y resuelve con el socket cuando la sesión está abierta.
// Reintenta en los cortes esperables (p. ej. el reinicio que pide WhatsApp tras vincular).
function connect({ interactive = false, pairPhone = null } = {}) {
  return new Promise(async (resolve, reject) => {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    const { version } = await fetchLatestBaileysVersion();
    const sock = makeWASocket({
      version,
      auth: state,
      logger: pino({ level: 'silent' }),
      browser: Browsers.macOS('Mateando Bot'),
      markOnlineOnConnect: false,
      syncFullHistory: false,
    });
    sock.ev.on('creds.update', saveCreds);

    let codeRequested = false;
    sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
      if (qr) {
        if (!interactive) return reject(new Error('El bot no está vinculado. Correr: node bot/wa.mjs login'));
        if (pairPhone && !codeRequested) {
          codeRequested = true;
          const code = await sock.requestPairingCode(pairPhone);
          console.log(`\nEn el teléfono del bot: WhatsApp → Dispositivos vinculados → Vincular con número de teléfono\nCódigo: ${code}\n`);
        } else if (!pairPhone) {
          console.log('\nEscaneá este QR desde el teléfono del bot: WhatsApp → Dispositivos vinculados → Vincular dispositivo\n');
          qrcode.generate(qr, { small: true });
        }
      }
      if (connection === 'open') resolve(sock);
      if (connection === 'close') {
        const code = lastDisconnect?.error?.output?.statusCode;
        if (code === DisconnectReason.loggedOut) return reject(new Error('Sesión cerrada desde el teléfono. Volver a correr login.'));
        connect({ interactive, pairPhone }).then(resolve, reject);
      }
    });
  });
}

async function listGroups(sock) {
  const groups = await sock.groupFetchAllParticipating();
  const list = Object.values(groups);
  if (!list.length) console.log('El bot no está en ningún grupo todavía.');
  for (const g of list) console.log(`${g.id}  ·  ${g.subject}  (${g.participants.length} integrantes)`);
}

const done = async (sock) => {
  await new Promise((r) => setTimeout(r, 2000)); // dejar que se vacíe la cola de envío
  sock.end(undefined);
  process.exit(0);
};

if (cmd === 'login') {
  const i = args.indexOf('--code');
  const pairPhone = i >= 0 ? args[i + 1].replace(/\D/g, '') : null;
  const sock = await connect({ interactive: true, pairPhone });
  console.log('✅ Bot vinculado. Grupos:');
  await listGroups(sock);
  await done(sock);
} else if (cmd === 'groups') {
  const sock = await connect();
  await listGroups(sock);
  await done(sock);
} else if (cmd === 'send') {
  const [jid] = args;
  const text = await readStdin();
  if (!jid || !text) throw new Error('Uso: echo "texto" | node bot/wa.mjs send <group_id>');
  const sock = await connect();
  await sock.sendMessage(jid, { text });
  console.log(`WhatsApp enviado a ${jid}`);
  await done(sock);
} else {
  console.log('Comandos: login [--code 549...] | groups | send <group_id>');
}
