let currentUser = null
let currentProfile = null
let selectedUserId = null
let allUsers = []
let messageChannel = null
let publicChannel = null
let currentTab = 'public'
let renderedPublicIds = new Set()
let renderedMessageIds = new Set()

function formatTime(isoString) {
    const date = new Date(isoString)
    let hours = date.getHours()
    let minutes = date.getMinutes()
    const ampm = hours >= 12 ? 'PM' : 'AM'
    hours = hours % 12 || 12
    minutes = minutes < 10 ? '0' + minutes : minutes
    return `${hours}:${minutes} ${ampm}`
}

async function checkAuth() {
    const { data: { session } } = await supabaseClient.auth.getSession()
    if (!session) { window.location.href = 'index.html'; return }
    currentUser = session.user

    const { data: profile } = await supabaseClient
        .from('profiles').select('full_name, avatar_color')
        .eq('id', currentUser.id).single()

    currentProfile = profile
    document.getElementById('user-name').textContent = profile?.full_name || currentUser.email

    if ('Notification' in window) Notification.requestPermission()

    await loadUsers()
    await loadPublicMessages()
    subscribeToPublic()
    subscribeToIncomingMessages()

    const chatWith = localStorage.getItem('chatWith')
    if (chatWith) {
        localStorage.removeItem('chatWith')
        const user = allUsers.find(u => u.id === chatWith)
        if (user) { switchTab('inbox'); await openChat(user) }
    }
}

function switchTab(tab) {
    currentTab = tab
    document.getElementById('tab-public').classList.toggle('active', tab === 'public')
    document.getElementById('tab-inbox').classList.toggle('active', tab === 'inbox')
    document.getElementById('public-section').classList.toggle('hidden', tab !== 'public')
    document.getElementById('inbox-section').classList.toggle('hidden', tab !== 'inbox')
    document.getElementById('chat-window').style.display = tab === 'public' ? 'none' : 'flex'
}

async function loadPublicMessages() {
    const container = document.getElementById('public-messages')
    container.innerHTML = '<div class="loading-msg">লোড হচ্ছে...</div>'
    renderedPublicIds.clear()

    const { data, error } = await supabaseClient
        .from('public_messages')
        .select('*')
        .order('created_at', { ascending: true })
        .limit(50)

    if (error) {
        container.innerHTML = '<div class="loading-msg">Error: ' + error.message + '</div>'
        return
    }

    if (!data || data.length === 0) {
        container.innerHTML = '<div class="loading-msg">Be the first to send a message! 👋</div>'
        return
    }

    container.innerHTML = ''

    for (const msg of data) {
        const { data: profile } = await supabaseClient
            .from('profiles')
            .select('full_name, avatar_color')
            .eq('id', msg.user_id)
            .single()
        msg.profiles = profile
        renderPublicMessage(msg)
    }

    container.scrollTop = container.scrollHeight
}

function renderPublicMessage(msg) {
    const msgId = msg.id || (msg.created_at + msg.user_id)
    if (renderedPublicIds.has(msgId)) return
    renderedPublicIds.add(msgId)

    const container = document.getElementById('public-messages')
    const isOwn = msg.user_id === currentUser.id
    const name = msg.profiles?.full_name || 'Unknown'
    const initials = name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
    const color = msg.profiles?.avatar_color || '#1a8a5a'
    const time = formatTime(msg.created_at)

    const empty = container.querySelector('.loading-msg')
    if (empty) empty.remove()

    const div = document.createElement('div')
    div.className = `public-msg ${isOwn ? 'own' : ''}`
    div.innerHTML = `
        <a href="profile.html?id=${msg.user_id}" class="public-msg-avatar"
           style="background:${color};color:white;display:flex;align-items:center;justify-content:center;">
           ${initials}
        </a>
        <div class="public-msg-content">
            <div class="public-msg-name">${isOwn ? 'You' : name}</div>
            <div class="public-msg-bubble">${msg.message}</div>
            <div class="public-msg-time">${time}</div>
        </div>
    `
    container.appendChild(div)
    container.scrollTop = container.scrollHeight
}

async function sendPublicMessage() {
    const input = document.getElementById('public-input')
    const message = input.value.trim()
    if (!message) return

    input.value = ''
    input.disabled = true

    const { data, error } = await supabaseClient
        .from('public_messages')
        .insert({ user_id: currentUser.id, message })
        .select().single()

    input.disabled = false
    input.focus()

    if (error) {
        input.value = message
        return
    }

    if (data) {
        data.profiles = {
            full_name: currentProfile?.full_name,
            avatar_color: currentProfile?.avatar_color
        }
        renderPublicMessage(data)
    }
}

function handlePublicKeyPress(e) { if (e.key === 'Enter') sendPublicMessage() }

function showNotification(title, body, onClick) {
    const existing = document.getElementById('in-app-notif')
    if (existing) existing.remove()

    const notif = document.createElement('div')
    notif.id = 'in-app-notif'
    notif.style.cssText = `
        position:fixed;top:70px;right:16px;left:16px;max-width:400px;margin:0 auto;
        background:#1a8a5a;color:white;padding:14px;border-radius:12px;
        z-index:99999;cursor:pointer;
    `

    notif.innerHTML = `
        <div style="font-weight:700">${title}</div>
        <div style="font-size:13px">${body}</div>
    `

    notif.onclick = () => {
        onClick()
        setTimeout(() => {
            const c1 = document.getElementById('public-messages')
            const c2 = document.getElementById('messages-container')
            if (c1) c1.scrollTop = c1.scrollHeight
            if (c2) c2.scrollTop = c2.scrollHeight
        }, 200)
        notif.remove()
    }

    document.body.appendChild(notif)
    setTimeout(() => notif.remove(), 5000)
}

function renderUsers(users) {
    const list = document.getElementById('users-list')
    list.innerHTML = ''

    users.forEach(user => {
        const name = user.full_name || 'Unknown'
        const initials = name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
        const color = user.avatar_color || '#1a8a5a'

        const div = document.createElement('div')
        div.style.cssText = `
            display:flex;align-items:center;gap:12px;padding:10px;
            border-radius:10px;margin-bottom:6px;cursor:pointer;
        `

        div.innerHTML = `
            <div style="width:40px;height:40px;border-radius:50%;background:${color};
                display:flex;align-items:center;justify-content:center;color:white;">
                ${initials}
            </div>
            <div>
                <div style="font-weight:600">${name}</div>
                <div style="font-size:12px;color:gray;">${user.bio || ''}</div>
            </div>
        `

        div.onclick = () => openChat(user)
        list.appendChild(div)
    })
}

// बाकी code unchanged
checkAuth()
