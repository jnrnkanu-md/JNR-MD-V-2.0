/**
 * JNR-MD - A WhatsApp Bot
 * Copyright (c) 2026 JNR NKANU CONCEPTS™ 
 * 
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the MIT License.
 * 
 * Credits:
 * - Baileys Library by @adiwajshing
 * - Pair Code implementation inspired by TechGod143 & DGXEON
 */
require('./settings')
const { Boom } = require('@hapi/boom')
const fs = require('fs')
const chalk = require('chalk')
const FileType = require('file-type')
const path = require('path')
const axios = require('axios')
const { handleMessages, handleGroupParticipantUpdate, handleStatus } = require('./main');
const PhoneNumber = require('awesome-phonenumber')
const { imageToWebp, videoToWebp, writeExifImg, writeExifVid } = require('./lib/exif')
const { smsg, isUrl, generateMessageTag, getBuffer, getSizeMedia, fetch, await, sleep, reSize } = require('./lib/myfunc')
const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    generateForwardMessageContent,
    prepareWAMessageMedia,
    generateWAMessageFromContent,
    generateMessageID,
    downloadContentFromMessage,
    jidDecode,
    proto,
    jidNormalizedUser,
    makeCacheableSignalKeyStore,
    delay
} = require("@whiskeysockets/baileys")
const NodeCache = require("node-cache")
const pino = require("pino")
const readline = require("readline")
const { rmSync, existsSync } = require('fs')
const { join } = require('path')

// Import lightweight store
const store = require('./lib/lightweight_store')

// Initialize store
store.readFromFile()
const settings = require('./settings')
setInterval(() => store.writeToFile(), settings.storeWriteInterval || 10000)

// Memory management
setInterval(() => {
    if (global.gc) {
        global.gc()
    }
}, 60_000)

setInterval(() => {
    const used = process.memoryUsage().rss / 1024 / 1024
    if (used > 400) {
        console.log('⚠️ RAM too high (>400MB), restarting bot...')
        process.exit(1)
    }
}, 30_000)

let phoneNumber = "911234567890"
let owner = JSON.parse(fs.readFileSync('./data/owner.json'))

global.botname = "🫧 JNR-MD V-2.0🔥"
global.themeemoji = "•"
const pairingCode = !!phoneNumber || process.argv.includes("--pairing-code")
const useMobile = process.argv.includes("--mobile")

const rl = process.stdin.isTTY ? readline.createInterface({ input: process.stdin, output: process.stdout }) : null
const question = (text) => {
    if (rl) {
        return new Promise((resolve) => rl.question(text, resolve))
    } else {
        return Promise.resolve(settings.ownerNumber || phoneNumber)
    }
}

async function startXeonBotInc() {
    try {
        let { version, isLatest } = await fetchLatestBaileysVersion()
        const { state, saveCreds } = await useMultiFileAuthState(`./session`)
        const msgRetryCounterCache = new NodeCache()

        const XeonBotInc = makeWASocket({
            version,
            logger: pino({ level: 'silent' }),
            printQRInTerminal: !pairingCode,
            browser: ["Ubuntu", "Chrome", "20.0.04"],
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
            },
            markOnlineOnConnect: false,
            generateHighQualityLinkPreview: false,
            cachedGroupMetadata: async (jid) => (global.__jnrGroupCache ? global.__jnrGroupCache(jid) : undefined),
            syncFullHistory: false,
            getMessage: async (key) => {
                let jid = jidNormalizedUser(key.remoteJid)
                let msg = await store.loadMessage(jid, key.id)
                return msg?.message || ""
            },
            msgRetryCounterCache,
            defaultQueryTimeoutMs: 60000,
            connectTimeoutMs: 60000,
            keepAliveIntervalMs: 25000,
        })

        const _gc = require('./lib/groupCache')
        global.__jnrGroupCache = _gc.install(XeonBotInc).getCached

        // Every response ends with:  > ©Jnr Nkanu Concepts 2026
        // (chat-style replies such as away mode / chatbot / agent pass { noFooter: true })
        const FOOTER = '> ©Jnr Nkanu Concepts 2026'
        const rawSendMessage = XeonBotInc.sendMessage.bind(XeonBotInc)
        XeonBotInc.sendMessage = async (jid, content, options) => {
            let opts = options
            let skip = false
            if (options && options.noFooter) {
                skip = true
                opts = { ...options }
                delete opts.noFooter
            }
            try {
                if (!skip && content && typeof jid === 'string' && jid !== 'status@broadcast' && !jid.endsWith('@newsletter')) {
                    const field = typeof content.text === 'string' ? 'text' : (typeof content.caption === 'string' ? 'caption' : null)
                    if (field && content[field].trim() && !content[field].includes('©Jnr Nkanu Concepts 2026')) {
                        content = { ...content, [field]: content[field].replace(/\s+$/, '') + '\n\n' + FOOTER }
                    }
                }
            } catch (e) { /* never block a message because of the footer */ }
            const light = !!(content && (content.react || content.delete))
            return _gc.schedule(String(jid), light, () => rawSendMessage(jid, content, opts))
        }

        XeonBotInc.ev.on('creds.update', saveCreds)
        store.bind(XeonBotInc.ev)

        // MAIN MESSAGE LOOP (With Enhanced Activities Console Logger)
        XeonBotInc.ev.on('messages.upsert', async chatUpdate => {
            try {
                const mek = chatUpdate.messages[0]
                if (!mek || !mek.message) return

                // never act twice, and never act on old / late-delivered messages (see lib/messageGuard.js)
                const skipReason = require('./lib/messageGuard').shouldSkip(mek, chatUpdate)
                if (skipReason) {
                    console.log(chalk.gray(`⏭️  Skipped a message (${skipReason})`))
                    return
                }

                mek.message = (Object.keys(mek.message)[0] === 'ephemeralMessage') ? mek.message.ephemeralMessage.message : mek.message
                
                // 📡 REAL-TIME CONSOLE ACTIVITY TRACKER
                const chatId = mek.key.remoteJid;
                const isGroup = chatId.endsWith('@g.us');
                const fromMe = mek.key.fromMe;
                const senderNumber = (mek.key.participant || mek.key.remoteJid).split('@')[0];
                const pushName = mek.pushName || 'Unknown User';
                const time = new Date().toLocaleTimeString();
                const chatType = isGroup ? 'GROUP CHAT' : 'PRIVATE DM';

                const cleanText = mek.message?.conversation || 
                                  mek.message?.extendedTextMessage?.text || 
                                  mek.message?.imageMessage?.caption || 
                                  mek.message?.videoMessage?.caption || '';

                let contentSummary = cleanText;
                if (mek.message?.imageMessage) contentSummary = `🖼️ [Photo] ${cleanText}`.trim();
                if (mek.message?.videoMessage) contentSummary = `🎥 [Video] ${cleanText}`.trim();
                if (mek.message?.stickerMessage) contentSummary = `🎨 [Sticker]`;
                if (mek.message?.audioMessage) contentSummary = `🎵 [Audio/Voice Note]`;
                if (mek.message?.documentMessage) contentSummary = `📁 [Document: ${mek.message.documentMessage.fileName || 'File'}]`;

                if (chatId === 'status@broadcast') {
                    console.log(chalk.blueBright(`[${time}] 🟢 STATUS VIEWED | From: ${pushName} (+${senderNumber})`));
                    await handleStatus(XeonBotInc, chatUpdate);
                    return;
                } else if (fromMe) {
                    console.log(
                        chalk.cyan(`\n--- 📤 MESSAGE SENT ---`) +
                        chalk.white(`\n💬 Chat Type : `) + chalk.green(chatType) +
                        chalk.white(`\n👤 Receiver  : `) + chalk.yellow(chatId.split('@')[0]) +
                        chalk.white('\n🕒 Time      : ') + chalk.gray(time) +
                        chalk.white(`\n📝 Message   : `) + chalk.greenBright(contentSummary || '[System/Media Message]') +
                        chalk.cyan(`\n-----------------------\n`)
                    );
                } else {
                    console.log(
                        chalk.magenta(`\n--- 📥 MESSAGE RECEIVED ---`) +
                        chalk.white(`\n💬 Chat Type : `) + chalk.green(chatType) +
                        chalk.white(`\n👤 Sender    : `) + chalk.yellow(pushName) +
                        chalk.white(`\n📱 Number    : `) + chalk.yellowBright(`+${senderNumber}`) +
                        chalk.white('\n🕒 Time      : ') + chalk.gray(time) +
                        chalk.white(`\n📝 Message   : `) + chalk.cyanBright(contentSummary || '[Media/Empty]') +
                        chalk.magenta(`\n---------------------------\n`)
                    );
                }
                // 📡 TRACKER END

                if (!XeonBotInc.public && !mek.key.fromMe && chatUpdate.type === 'notify') {
                    if (!isGroup) return
                }
                if (mek.key.id.startsWith('BAE5') && mek.key.id.length === 16) return

                if (XeonBotInc?.msgRetryCounterCache) {
                    XeonBotInc.msgRetryCounterCache.clear()
                }

                try {
                    await handleMessages(XeonBotInc, chatUpdate, true)
                } catch (err) {
                    console.error("Error in handleMessages:", err)
                }
            } catch (err) {
                console.error("Error in messages.upsert:", err)
            }
        })

        XeonBotInc.decodeJid = (jid) => {
            if (!jid) return jid
            if (/:\d+@/gi.test(jid)) {
                let decode = jidDecode(jid) || {}
                return decode.user && decode.server && decode.user + '@' + decode.server || jid
            } else return jid
        }

        XeonBotInc.ev.on('contacts.update', update => {
            for (let contact of update) {
                let id = XeonBotInc.decodeJid(contact.id)
                if (store && store.contacts) store.contacts[id] = { id, name: contact.notify }
            }
        })

        XeonBotInc.getName = (jid, withoutContact = false) => {
            id = XeonBotInc.decodeJid(jid)
            withoutContact = XeonBotInc.withoutContact || withoutContact
            let v
            if (id.endsWith("@g.us")) return new Promise(async (resolve) => {
                v = store.contacts[id] || {}
                if (!(v.name || v.subject)) v = XeonBotInc.groupMetadata(id) || {}
                resolve(v.name || v.subject || PhoneNumber('+' + id.replace('@s.whatsapp.net', '')).getNumber('international'))
            })
            else v = id === '0@s.whatsapp.net' ? { id, name: 'WhatsApp' } : id === XeonBotInc.decodeJid(XeonBotInc.user.id) ? XeonBotInc.user : (store.contacts[id] || {})
            return (withoutContact ? '' : v.name) || v.subject || v.verifiedName || PhoneNumber('+' + jid.replace('@s.whatsapp.net', '')).getNumber('international')
        }

        XeonBotInc.public = true
        XeonBotInc.serializeM = (m) => smsg(XeonBotInc, m, store)

        // Pair Code Setup
        if (pairingCode && !XeonBotInc.authState.creds.registered) {
            if (useMobile) throw new Error('Cannot use pairing code with mobile api')

            let phoneNumber = global.phoneNumber || await question(chalk.bgBlack(chalk.greenBright(`Please type your WhatsApp number 😍\nFormat: 6281376552730: `)))
            phoneNumber = phoneNumber.replace(/[^0-9]/g, '')

            setTimeout(async () => {
                try {
                    let code = await XeonBotInc.requestPairingCode(phoneNumber)
                    code = code?.match(/.{1,4}/g)?.join("-") || code
                    console.log(chalk.black(chalk.bgGreen(`Your Pairing Code : `)), chalk.black(chalk.white(code)))
                } catch (error) {
                    console.error('Error requesting pairing code:', error)
                }
            }, 3000)
        }

        // Connection Update Handler with Big Joker Graphic Design
        XeonBotInc.ev.on('connection.update', async (s) => {
            const { connection, lastDisconnect, qr } = s
            
            if (qr) console.log(chalk.yellow('📱 QR Code generated.'))
            if (connection === 'connecting') console.log(chalk.yellow('🔄 Connecting to WhatsApp...'))
            if (connection == "open") {
                global.__jnrRetries = 0
                // 🤖 BIG JNR NKANU LOGO + BIG JNR NKANU TEXT ART FOR TERMINAL
                console.clear();
                console.log(chalk.red.bold(`
        @@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
@@@@@@@@@@@@@@@@@@@    ██████    @@@@@@@@@@@@@@@@@@@@@@@
@@@@@@@@@@@@@@@      ▄████████▄      @@@@@@@@@@@@@@@@@@@
@@@@@@@@@@@@@      ▄███▀    ▀███▄      @@@@@@@@@@@@@@@@@
@@@@@@@@@@@@      ███          ███      @@@@@@@@@@@@@@@@
@@@@@@@@@@@@      ███   ██     ███      @@@@@@@@@@@@@@@@
@@@@@@@@@@@@      ███        ▄███       @@@@@@@@@@@@@@@@
@@@@@@@@@@@@@      ▀██▄▄▄▄▄███▀       @@@@@@@@@@@@@@@@@@
@@@@@@@@@@@@@@@        ▀▀▀▀        @@@@@@@@@@@@@@@@@@@@@
@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@

     ██╗███╗   ██╗██████╗
     ██║████╗  ██║██╔══██╗
     ██║██╔██╗ ██║██████╔╝
██   ██║██║╚██╗██║██╔══██╗
╚█████╔╝██║ ╚████║██║  ██║
 ╚════╝ ╚═╝  ╚═══╝╚═╝  ╚═╝

███╗   ██╗██╗  ██╗ █████╗ ███╗   ██╗██╗   ██╗
████╗  ██║██║ ██╔╝██╔══██╗████╗  ██║██║   ██║
██╔██╗ ██║█████╔╝ ███████║██╔██╗ ██║██║   ██║
██║╚██╗██║██╔═██╗ ██╔══██║██║╚██╗██║██║   ██║
██║ ╚████║██║  ██╗██║  ██║██║ ╚████║╚██████╔╝
╚═╝  ╚═══╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝ ╚═════╝ 
                `));
                console.log(chalk.red.bold(`       [JNR NKANU CONCEPTS™  WhatsApp Bot is Now Online! ]\n`));
                console.log(chalk.cyan(`< ================================================== >`))
                console.log(chalk.magenta(`${global.themeemoji || '•'} YT CHANNEL : Jnr Nkanu Concepts`))
                console.log(chalk.magenta(`${global.themeemoji || '•'} GITHUB     : jnrnkanu`))
                console.log(chalk.magenta(`${global.themeemoji || '•'} CREDIT     : JNR NKANU CONCEPTS™ `))
                console.log(chalk.green(`${global.themeemoji || '•'} STATUS     : Connected Successfully! ✅`))
                console.log(chalk.cyan(`< ================================================== >\n`))

                // Connected message to your own chat (at most once every 6 hours, so reconnects never spam)
                try {
                    const botNumber = XeonBotInc.user.id.split(':')[0] + '@s.whatsapp.net';
                    const stampFile = path.join(__dirname, 'data', 'lastConnectMsg.txt')
                    let last = 0
                    try { last = Number(fs.readFileSync(stampFile, 'utf8')) || 0 } catch {}
                    if (Date.now() - last < 6 * 3600 * 1000) return
                    try { fs.mkdirSync(path.dirname(stampFile), { recursive: true }); fs.writeFileSync(stampFile, String(Date.now())) } catch {}
                    const { buildConnectMessage, botImage } = require('./lib/connectMessage')
                    const caption = buildConnectMessage()
                    const image = botImage()
                    const contextInfo = undefined
                    try {
                        await XeonBotInc.sendMessage(botNumber, image ? { image, caption, contextInfo } : { text: caption, contextInfo });
                    } catch (imgError) {
                        // image could not be sent: send the same welcome as plain text
                        await XeonBotInc.sendMessage(botNumber, { text: caption, contextInfo });
                    }
                } catch (error) {
                    console.error('Error sending auto-connect confirmation message:', error.message)
                }
            }
            
            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode || lastDisconnect?.error?.statusCode
                const replaced = statusCode === DisconnectReason.connectionReplaced || statusCode === 440
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut && !replaced
                if (replaced) console.log(chalk.red('This login is open somewhere else (another copy of the bot). Stopped here so the two copies do not fight. Keep only ONE running, then restart.'))

                console.log(chalk.red(`Connection closed. Status: ${statusCode}, Reconnecting: ${shouldReconnect}`))
                
                if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
                    try {
                        rmSync('./session', { recursive: true, force: true })
                        console.log(chalk.yellow('Session wiped due to clean logout. Re-authenticate.'))
                    } catch (e) {}
                }
                
                if (shouldReconnect) {
                    global.__jnrRetries = (global.__jnrRetries || 0) + 1
                    await delay(Math.min(60000, 5000 * global.__jnrRetries) + Math.floor(Math.random() * 2000))
                    startXeonBotInc()
                }
            }
        })

        // Call & Group handling
        const antiCallNotified = new Set();
        XeonBotInc.ev.on('call', async (calls) => {
            try {
                const { readState } = require('./commands/anticall');
                if (!readState().enabled) return;
                for (const call of calls) {
                    if (!call.from) continue;
                    if (!antiCallNotified.has(call.from)) {
                        antiCallNotified.add(call.from);
                        setTimeout(() => antiCallNotified.delete(call.from), 60000);
                        await XeonBotInc.sendMessage(call.from, { text: 'Anticall active.' });
                    }
                    setTimeout(async () => { try { await XeonBotInc.updateBlockStatus(call.from, 'block'); } catch {} }, 800);
                }
            } catch (e) {}
        });

        XeonBotInc.ev.on('group-participants.update', async (update) => {
            await handleGroupParticipantUpdate(XeonBotInc, update);
        });

        return XeonBotInc
    } catch (error) {
        console.error('Error in primary start loop:', error)
        await delay(5000)
        startXeonBotInc()
    }
}

startXeonBotInc().catch(error => {
    console.error('Fatal crash:', error)
    process.exit(1)
})

process.on('uncaughtException', (err) => console.error('Uncaught:', err))
process.on('unhandledRejection', (err) => console.error('Unhandled:', err))