
let currentUser = null
let currentProfile = null
let selectedUserId = null
let allUsers = []
let messageChannel = null
let publicChannel = null
let currentTab = 'public'
let renderedPublicIds = new Set()
let renderedMessageIds = new Set()

// ✅ Fix 1: Notification & Inbox UI Style Injector
const customStyle = document.createElement('style')
customStyle.textContent = `
    /* Inbox User List Modern UI */
    .user-item {
        display: flex; align-items: center; padding: 12px 15px;
        margin: 8px; border-radius: 12px; cursor: pointer;
        transition: all 0.2s ease; background: rgba(255,255,255,0.05);
        border: 1px solid rgba(255,255,255,0.1); position: relative;
    }
    .user-item:hover { background: rgba(26, 138, 90, 0.15); transform: translateY(-2px); }
    .user-item.active { background: #1a8a5a; border-color: #1a8a5a; color: white; box-shadow: 0 4px 12px rgba(26,138,90,0.3); }
    .user-item-avatar { 
        width: 45px; height: 45px; border-radius: 50%; 
        display: flex; align-items: center; justify-content: center;
        font-weight: bold; font-size: 16px; margin-right: 12px; flex-shrink: 0;
        border: 2px solid rgba(255,255,255,0.2);
    }
    .user-item-info { flex-grow: 1; overflow: hidden; }
    .user-item-name { font-weight: 600; font-size: 15px; margin-bottom: 2px; }
    .user-item-preview { font-size: 12px; opacity: 0.7; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .unread-dot { 
        width: 10px; height: 10px; background: #ff4757; border-radius: 50%; 
        position: absolute; right: 15px; top: 50%; transform: translateY(-50%);
        box-shadow: 0 0 8px #ff4757;
    }
    @keyframes slideIn { from { transform:translateY(-20px); opacity:0 } to { transform:translateY(0); opacity:1 } }
    @keyframes fadeOut { from { opacity:1 } to { opacity:0 } }
`
document.head.appendChild(customStyle)

function formatTime(isoString) {
    const date = new Date(isoString)
    const now = new Date()

    const isToday = date.toLocaleDateString() === now.toLocaleDateString()
    const yesterday = new Date(now - 86400000)
    const isYesterday = date.toLocaleDateString() === yesterday.toLocaleDateString()

    const timeStr = date.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
        timeZone: 'Asia/Dhaka'
    })

    if (isToday) return timeStr
    if (isYesterday) return `গতকাল ${timeStr}`

    const dateStr = date.toLocaleDateString('en-BD', {
        day: 'numeric',
        month: 'numeric',
        year: 'numeric',
        timeZone: 'Asia/Dhaka'
    })
    return `${dateStr} ${timeStr}`
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

    const params = new URLSearchParams(window.location.search)
    const tab = params.get('tab')
    const chatWith = params.get('with') || localStorage.getItem('chatWith')

    if (tab === 'public') {
        switchTab('public')
        const msgid = params.get('msgid')
        setTimeout(() => {
            if (msgid) {
                const el = document.getElementById('pub-msg-' + msgid)
                if (el) {
                    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
                    el.style.background = '#2ecc71'
                    setTimeout(() => el.style.background = '', 2000)
                }
            } else {
                const container = document.getElementById('public-messages')
                container.scrollTop = container.scrollHeight
            }
        }, 1500)
    } else if (chatWith) {
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

// ✅ Fix: Public Message Loading Logic Improved
async function loadPublicMessages() {
    const { data, error } = await supabaseClient
        .from('public_messages')
        .select('*, profiles(full_name, avatar_color)')
        .order('created_at', { ascending: false })
        .limit(100)

    if (error) {
        console.log('Public messages error:', error)
        return
    }

    const container = document.getElementById('public-messages')
    container.innerHTML = ''

    if (!data || data.length === 0) {
        container.innerHTML = '<div class="loading-msg">প্রথম message পাঠাও! 👋</div>'
        return
    }

    data.reverse().forEach(msg => renderPublicMessage(msg))
    container.scrollTop = container.scrollHeight
}

function renderPublicMessage(msg) {
    const container = document.getElementById('public-messages')
    
    if (msg.id && document.getElementById('pub-msg-' + msg.id)) return
    
    const isOwn = msg.user_id === currentUser.id
    const name = msg.profiles?.full_name || 'Unknown'
    const initials = name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
    const color = msg.profiles?.avatar_color || '#1a8a5a'
    const time = new Date(msg.created_at).toLocaleTimeString('bn-BD', {
        hour: '2-digit',
        minute: '2-digit'
    })

    const empty = container.querySelector('.loading-msg')
    if (empty) empty.remove()

    const div = document.createElement('div')
    div.className = `public-msg ${isOwn ? 'own' : ''}`
    div.id = 'pub-msg-' + msg.id
    div.innerHTML = `
        <a href="profile.html?id=${msg.user_id}"
           class="public-msg-avatar"
           style="background:${color};text-decoration:none;color:white;cursor:pointer;display:flex;align-items:center;justify-content:center;">
           ${initials}
        </a>
        <div class="public-msg-content">
            <div class="public-msg-name">${isOwn ? 'আমি' : name}</div>
            <div class="public-msg-bubble">${msg.message}</div>
            <div class="public-msg-time">${time}</div>
        </div>
    `
    container.appendChild(div)
    container.scrollTop = container.scrollHeight

    if (!isOwn && currentTab !== 'public') {
        showNotification('🌍 Public Chat', `${name}: ${msg.message}`, () => {
            window.focus()
            switchTab('public')
        })
    }
}

// ✅ Fix: Public message save validation
async function sendPublicMessage() {
    const input = document.getElementById('public-input')
    const message = input.value.trim()
    if (!message) return

    input.value = ''
    input.disabled = true

    // Direct insertion check
    const { data, error } = await supabaseClient
        .from('public_messages')
        .insert([{ user_id: currentUser.id, message: message }])
        .select(`*, profiles(full_name, avatar_color)` )
        .single()

    input.disabled = false
    input.focus()

    if (error) {
        console.error('Save Error:', error)
        alert('Message save failed. Please check internet.')
        input.value = message
        return
    }

    if (data) renderPublicMessage(data)
}

function handlePublicKeyPress(e) { if (e.key === 'Enter') sendPublicMessage() }

function subscribeToPublic() {
    let lastMessageTime = new Date().toISOString()

    setInterval(async () => {
        const { data } = await supabaseClient
            .from('public_messages')
            .select('*, profiles(full_name, avatar_color)')
            .gt('created_at', lastMessageTime)
            .order('created_at', { ascending: true })

        if (!data || data.length === 0) return

        lastMessageTime = data[data.length - 1].created_at
        data.forEach(msg => {
            if (!document.getElementById('pub-msg-' + msg.id)) {
                renderPublicMessage(msg)
            }
        })
    }, 3000)
}

// ✅ Fix: Popup interaction & Inbox Navigation
function showNotification(title, body, onClick) {
    if (Notification.permission === 'granted') {
        const n = new Notification(title, { body })
        n.onclick = () => { window.focus(); onClick(); n.close() }
    }

    const existing = document.getElementById('in-app-notif')
    if (existing) existing.remove()

    const notif = document.createElement('div')
    notif.id = 'in-app-notif'
    notif.style.cssText = `
        position:fixed; top:20px; right:20px; width:300px;
        background:#1a8a5a; color:white; padding:15px; border-radius:12px;
        box-shadow:0 10px 25px rgba(0,0,0,0.2); z-index:10000; cursor:pointer;
        animation: slideIn 0.3s ease;
    `
    notif.innerHTML = `
        <div style="font-weight:bold; margin-bottom:5px;">${title}</div>
        <div style="font-size:13px; opacity:0.9;">${body}</div>
    `
    notif.onclick = () => { onClick(); notif.remove() }
    document.body.appendChild(notif)
    setTimeout(() => { if(notif) notif.remove() }, 5000)
}

function subscribeToIncomingMessages() {
    supabaseClient.channel('incoming_' + currentUser.id)
        .on('postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'chat_messages' },
            async (payload) => {
                const msg = payload.new
                if (msg.receiver_id !== currentUser.id || msg.sender_id === selectedUserId) return

                const { data: profile } = await supabaseClient
                    .from('profiles').select('id, full_name, avatar_color, bio').eq('id', msg.sender_id).single()

                showNotification(`💬 ${profile?.full_name}`, msg.message, async () => {
                    window.focus()
                    switchTab('inbox')
                    if (profile) await openChat(profile)
                })
                await loadUsers() // Refresh list UI
            }
        ).subscribe()
}

async function loadUsers() {
    const { data: profiles } = await supabaseClient.from('profiles').select('id, full_name, bio, avatar_color').neq('id', currentUser.id)
    const { data: unreadMsgs } = await supabaseClient.from('chat_messages').select('sender_id').eq('receiver_id', currentUser.id).eq('is_read', false)
    
    const unreadSenders = new Set(unreadMsgs?.map(m => m.sender_id) || [])
    allUsers = profiles.map(u => ({ ...u, hasUnread: unreadSenders.has(u.id) }))
    allUsers.sort((a, b) => b.hasUnread - a.hasUnread)
    renderUsers(allUsers)
}

function renderUsers(users) {
    const list = document.getElementById('users-list')
    list.innerHTML = users.length ? '' : '<div class="loading-msg">No users found</div>'
    users.forEach(user => {
        const name = user.full_name || 'Unknown'
        const initials = name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
        const div = document.createElement('div')
        div.className = `user-item ${user.hasUnread ? 'has-unread' : ''} ${selectedUserId === user.id ? 'active' : ''}`
        div.id = 'user-item-' + user.id
        div.innerHTML = `
            <div class="user-item-avatar" style="background:${user.avatar_color || '#1a8a5a'}">${initials}</div>
            <div class="user-item-info">
                <div class="user-item-name">${name}</div>
                <div class="user-item-preview">${user.hasUnread ? '📩 New message' : (user.bio || 'Start chatting')}</div>
            </div>
            ${user.hasUnread ? '<div class="unread-dot"></div>' : ''}
        `
        div.onclick = () => openChat(user)
        list.appendChild(div)
    })
}

function searchUsers() {
    const query = document.getElementById('search-input').value.toLowerCase()
    const filtered = allUsers.filter(u =>
        (u.full_name || '').toLowerCase().includes(query)
    )
    renderUsers(filtered)
}

async function openChat(user) {
    selectedUserId = user.id
    switchTab('inbox')

    // Avatar set করো
    const name = user.full_name || 'Unknown'
    const initials = name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
    const avatar = document.getElementById('chat-avatar')
    avatar.textContent = initials
    avatar.style.background = user.avatar_color || '#1a8a5a'
    avatar.style.cursor = 'pointer'
    avatar.onclick = () => window.location.href = 'profile.html?id=' + user.id

    // Username click করলে profile এ যাবে
    const username = document.getElementById('chat-username')
    username.textContent = name
    username.style.cursor = 'pointer'
    username.onclick = () => window.location.href = 'profile.html?id=' + user.id

    // Profile button
    document.getElementById('view-profile-btn').href = 'profile.html?id=' + user.id

    document.getElementById('no-chat').classList.add('hidden')
    document.getElementById('chat-area').classList.remove('hidden')
    
    if (window.innerWidth <= 768) document.getElementById('chat-window').classList.add('mobile-open')

    if (messageChannel) supabaseClient.removeChannel(messageChannel)
    await loadMessages()
    subscribeToMessages()

    // Mark as read
    await supabaseClient.from('chat_messages').update({ is_read: true }).eq('sender_id', user.id).eq('receiver_id', currentUser.id)
    
    // allUsers array update
    const idx = allUsers.findIndex(u => u.id === user.id)
    if (idx !== -1) allUsers[idx].hasUnread = false

    // UI থেকে unread dot সরাও
    const item = document.getElementById('user-item-' + user.id)
    if (item) {
        item.classList.remove('has-unread')
        const dot = item.querySelector('.unread-dot')
        if (dot) dot.remove()
        const preview = item.querySelector('.user-item-preview')
        if (preview) preview.textContent = user.bio || 'Chat শুরু করো'
    }
}
async function loadMessages() {
    const { data } = await supabaseClient.from('chat_messages').select('*')
        .or(`and(sender_id.eq.${currentUser.id},receiver_id.eq.${selectedUserId}),and(sender_id.eq.${selectedUserId},receiver_id.eq.${currentUser.id})`)
        .order('created_at', { ascending: true })

    const container = document.getElementById('messages-container')
    container.innerHTML = ''
    renderedMessageIds.clear()
    if (data) data.forEach(msg => renderMessage(msg))
    scrollToBottom()
}

function renderMessage(msg) {
    const msgId = msg.id || (msg.created_at + msg.sender_id)
    if (renderedMessageIds.has(msgId)) return
    renderedMessageIds.add(msgId)

    const container = document.getElementById('messages-container')
    const isSent = msg.sender_id === currentUser.id
    const div = document.createElement('div')
    div.className = `message-bubble ${isSent ? 'sent' : 'received'}`
    div.innerHTML = `${msg.message}<div class="message-time">${formatTime(msg.created_at)}</div>`
    container.appendChild(div)
    scrollToBottom()
}

async function sendMessage() {
    const input = document.getElementById('message-input')
    const message = input.value.trim()
    if (!message || !selectedUserId) return
    input.value = ''; input.disabled = true

    const { data } = await supabaseClient.from('chat_messages')
        .insert({ sender_id: currentUser.id, receiver_id: selectedUserId, message, is_read: false })
        .select().single()

    input.disabled = false; input.focus()
    if (data) renderMessage(data)
}

function subscribeToMessages() {
    messageChannel = supabaseClient.channel('chat_' + selectedUserId)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, 
        payload => {
            const msg = payload.new
            if ((msg.sender_id === selectedUserId && msg.receiver_id === currentUser.id) || 
                (msg.sender_id === currentUser.id && msg.receiver_id === selectedUserId)) {
                renderMessage(msg)
            }
        }).subscribe()
}

function handleKeyPress(e) { if (e.key === 'Enter') sendMessage() }
function scrollToBottom() { const c = document.getElementById('messages-container'); c.scrollTop = c.scrollHeight }
function backToList() { 
    document.getElementById('chat-window').classList.remove('mobile-open')
    selectedUserId = null; renderUsers(allUsers) 
}

checkAuth()
