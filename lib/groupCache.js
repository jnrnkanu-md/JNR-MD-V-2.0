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

// ---- send pacing: a message sent after a quiet moment goes out IMMEDIATELY.
// Only a rapid burst in the same chat (for example a menu of three messages) is spaced by a
// fraction of a second, and a slow upload never holds back the next message.
const state = new Map()            // jid -> time when the next message may start
const GAP_PRIVATE = 250, GAP_GROUP = 450
function schedule(jid, light, task) {
    if (light) return task()                                   // reactions and deletes: no delay at all
    const now = Date.now()
    const st = state.get(jid) || 0
    const wait = Math.max(0, st - now)
    state.set(jid, now + wait + (String(jid).endsWith('@g.us') ? GAP_GROUP : GAP_PRIVATE))
    if (state.size > 2000) { for (const [k, t] of state) if (t < now) state.delete(k) }
    return wait ? new Promise((resolve, reject) => setTimeout(() => task().then(resolve, reject), wait)) : task()
}
module.exports = { install, schedule }
