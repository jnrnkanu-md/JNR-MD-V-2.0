// Shared group-info cache + gentle send queue.
// Why: asking WhatsApp for the group list on every message, and sending many
// messages with no pause, looks like automation and gets numbers flagged.
const TTL = 5 * 60 * 1000          // keep a group's info for 5 minutes
const cache = new Map()            // jid -> { at, data }
const inflight = new Map()         // jid -> Promise (one request at a time per group)

function install(sock) {
    const rawMeta = sock.groupMetadata.bind(sock)
    const fetchMeta = async (jid) => {
        const hit = cache.get(jid)
        if (hit && Date.now() - hit.at < TTL) return hit.data
        if (inflight.has(jid)) return inflight.get(jid)
        const p = rawMeta(jid)
            .then(data => { cache.set(jid, { at: Date.now(), data }); return data })
            .catch(err => { if (hit) return hit.data; throw err })   // on error, use the older copy
            .finally(() => inflight.delete(jid))
        inflight.set(jid, p)
        return p
    }
    sock.groupMetadata = fetchMeta
    // refresh on change (registered first, so it runs before other handlers)
    const drop = (jid) => { if (jid) cache.delete(jid) }
    sock.ev.on('group-participants.update', u => drop(u && u.id))
    sock.ev.on('groups.update', list => (list || []).forEach(g => drop(g.id)))
    sock.ev.on('groups.upsert', list => (list || []).forEach(g => drop(g.id)))
    if (cache.size > 500) cache.clear()
    return { getCached: async (key) => { const h = cache.get(key.remoteJid || key); return h ? h.data : undefined } }
}

// ---- send queue: one message at a time per chat, with a small human-like pause
const chains = new Map()
let lastGlobal = 0
function schedule(jid, light, task) {
    const prev = chains.get(jid) || Promise.resolve()
    const run = prev.catch(() => {}).then(async () => {
        const gap = light ? 250 : 600 + Math.floor(Math.random() * 400)
        const wait = Math.max(0, lastGlobal + 350 - Date.now())
        await new Promise(r => setTimeout(r, wait + (light ? 0 : Math.floor(Math.random() * 250))))
        lastGlobal = Date.now()
        try { return await task() } finally { await new Promise(r => setTimeout(r, gap)) }
    })
    chains.set(jid, run)
    run.finally(() => { if (chains.get(jid) === run) chains.delete(jid) }).catch(() => {})
    return run
}
module.exports = { install, schedule }
