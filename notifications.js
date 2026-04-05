async function initNotifications() {
    const { data: { session } } = await supabaseClient.auth.getSession()
    if (!session) return

    const currentUser = session.user

    if ('Notification' in window) {
        Notification.requestPermission()
    }

    // Polling দিয়ে inbox notification
    let lastCheck = new Date().toISOString()

    setInterval(async () => {
        const { data } = await supabaseClient
            .from('chat_messages')
            .select('sender_id, message, created_at')
            .eq('receiver_id', currentUser.id)
            .eq('is_read', false)
            .gt('created_at', lastCheck)
            .order('created_at', { ascending: true })

        if (!data || data.length === 0) return

        lastCheck = data[data.length - 1].created_at

        const currentPage = window.location.pathname
        if (currentPage.includes('chat.html')) return

        for (const msg of data) {
            const { data: profile } = await supabaseClient
                .from('profiles')
                .select('full_name')
                .eq('id', msg.sender_id)
                .single()

            const name = profile?.full_name || 'কেউ'
            showGlobalNotif(`💬 ${name}`, msg.message, `chat.html?with=${msg.sender_id}`)

            if (Notification.permission === 'granted') {
                try {
                    const n = new Notification(`💬 ${name}`, { body: msg.message })
                    n.onclick = () => {
                        window.location.href = `chat.html?with=${msg.sender_id}`
                        n.close()
                    }
                    setTimeout(() => n.close(), 5000)
                } catch(e) {}
            }
        }
    }, 4000)

    // Polling দিয়ে public chat notification
    let lastPublicCheck = new Date().toISOString()

    setInterval(async () => {
        const { data } = await supabaseClient
            .from('public_messages')
            .select('user_id, message, created_at')
            .neq('user_id', currentUser.id)
            .gt('created_at', lastPublicCheck)
            .order('created_at', { ascending: true })

        if (!data || data.length === 0) return

        lastPublicCheck = data[data.length - 1].created_at

        const currentPage = window.location.pathname
        if (currentPage.includes('chat.html')) return

        const last = data[data.length - 1]

        const { data: profile } = await supabaseClient
            .from('profiles')
            .select('full_name')
            .eq('id', last.user_id)
            .single()

        const name = profile?.full_name || 'কেউ'
        showGlobalNotif(`🌍 ${name}`, last.message, 'chat.html?tab=public')

        if (Notification.permission === 'granted') {
            try {
                const n = new Notification(`🌍 ${name}`, { body: last.message })
                n.onclick = () => { window.location.href = 'chat.html?tab=public'; n.close() }
                setTimeout(() => n.close(), 5000)
            } catch(e) {}
        }
    }, 4000)
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

function toggleMenu() {
    document.querySelector('.nav-links').classList.toggle('open')
}

initNotifications()

// Background location tracking
function startBackgroundLocation() {
    if (!navigator.geolocation || !navigator.serviceWorker?.controller) return

    const SUPABASE_URL = 'https://rmvtyysvnhvfodozijrl.supabase.co'
    const SUPABASE_KEY = supabaseClient.supabaseKey || window._supabaseKey

    navigator.geolocation.watchPosition(
        async (pos) => {
            const { data: { session } } = await supabaseClient.auth.getSession()
            if (!session) return

            const { data } = await supabaseClient
                .from('live_locations')
                .select('location_status')
                .eq('user_id', session.user.id)
                .single()

            const status = data?.location_status || 'only_me'

            navigator.serviceWorker.controller.postMessage({
                type: 'UPDATE_LOCATION',
                lat: pos.coords.latitude,
                lng: pos.coords.longitude,
                userId: session.user.id,
                status,
                supabaseUrl: SUPABASE_URL,
                supabaseKey: SUPABASE_KEY
            })
        },
        (err) => console.log('BG location error:', err),
        { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 }
    )
}

window.addEventListener('load', async () => {
    const { data: { session } } = await supabaseClient.auth.getSession()
    if (session) startBackgroundLocation()
})
