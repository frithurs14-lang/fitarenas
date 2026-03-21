async function initNotifications() {
    const { data: { session } } = await supabaseClient.auth.getSession()
    if (!session) return

    const currentUser = session.user

    if ('Notification' in window) {
        Notification.requestPermission()
    }

    // ========== INBOX NOTIFICATION ==========
    supabaseClient
        .channel('global_notif_' + currentUser.id)
        .on('postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'chat_messages' },
            async (payload) => {
                const msg = payload.new
                if (msg.receiver_id !== currentUser.id) return

                const { data: profile } = await supabaseClient
                    .from('profiles')
                    .select('full_name')
                    .eq('id', msg.sender_id)
                    .single()

                const name = profile?.full_name || 'কেউ'

                showGlobalNotif(`💬 ${name}`, msg.message, 'chat.html')

                if (Notification.permission === 'granted') {
                    try {
                        const n = new Notification(`💬 ${name}`, { body: msg.message })
                        n.onclick = () => { window.location.href = 'chat.html'; n.close() }
                        setTimeout(() => n.close(), 5000)
                    } catch(e) {}
                }
            }
        )
        .subscribe()

    // ========== PUBLIC CHAT NOTIFICATION ==========
    supabaseClient
        .channel('global_public_notif_' + currentUser.id)
        .on('postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'public_messages' },
            async (payload) => {
                const msg = payload.new
                if (msg.user_id === currentUser.id) return

                const { data: profile } = await supabaseClient
                    .from('profiles')
                    .select('full_name')
                    .eq('id', msg.user_id)
                    .single()

                const name = profile?.full_name || 'কেউ'

                showGlobalNotif(`🌍 ${name}`, msg.message, 'chat.html')

                if (Notification.permission === 'granted') {
                    try {
                        const n = new Notification(`🌍 ${name}`, { body: msg.message })
                        n.onclick = () => { window.location.href = 'chat.html'; n.close() }
                        setTimeout(() => n.close(), 5000)
                    } catch(e) {}
                }
            }
        )
        .subscribe()
}

function showGlobalNotif(title, body, url) {
    const existing = document.getElementById('global-notif')
    if (existing) existing.remove()

    const notif = document.createElement('div')
    notif.id = 'global-notif'
    notif.style.cssText = `
        position:fixed;top:70px;right:16px;left:16px;
        background:#1a8a5a;color:white;
        padding:14px 16px;border-radius:12px;
        box-shadow:0 4px 16px rgba(0,0,0,0.3);
        z-index:99999;cursor:pointer;
    `
    notif.innerHTML = `
        <div style="font-weight:700;font-size:14px;margin-bottom:4px">${title}</div>
        <div style="font-size:13px;opacity:0.9">${body}</div>
        <div style="font-size:11px;opacity:0.7;margin-top:4px">👆 tap করো দেখতে</div>
    `
    notif.onclick = () => {
        window.location.href = url
        notif.remove()
    }
    document.body.appendChild(notif)
    setTimeout(() => {
        if (document.getElementById('global-notif')) notif.remove()
    }, 5000)
}

initNotifications()
