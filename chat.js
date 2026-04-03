// ============================================================
// FITARENA CHAT — Fixed Version
// Fixes: duplicate messages, time format, popup, send errors
// ============================================================

let currentUser = null
let currentProfile = null
let selectedUserId = null
let allUsers = []
let messageChannel = null
let publicChannel = null
let currentTab = 'public'
let renderedPublicIds = new Set()
let renderedMessageIds = new Set()
let isSendingPublic = false
let isSendingMessage = false

// ── Inject notification animation ──────────────────────────
const _style = document.createElement('style')
_style.textContent = `
@keyframes slideInNotif {
    from { transform: translateY(-16px); opacity: 0; }
    to   { transform: translateY(0);     opacity: 1; }
}
@keyframes fadeOutNotif {
    from { opacity: 1; }
    to   { opacity: 0; }
}
`
document.head.appendChild(_style)

// ── Time helper (works on all devices) ─────────────────────
function formatTime(iso) {
    const d = new Date(iso)
    let h = d.getHours(), m = d.getMinutes()
    const ampm = h >= 12 ? 'PM' : 'AM'
    h = h % 12 || 12
    return `${h}:${m < 10 ? '0' + m : m} ${ampm}`
}

// ── Auth ────────────────────────────────────────────────────
async function checkAuth() {
    const { data: { session } } = await supabaseClient.auth.getSession()
    if (!session) { window.location.href = 'index.html'; return }
    currentUser = session.user

    const { data: profile } = await supabaseClient
        .from('profiles')
        .select('full_name, avatar_color')
        .eq('id', currentUser.id)
        .single()

    currentProfile = profile
    document.getElementById('user-name').textContent =
        profile?.full_name || currentUser.email

    if ('Notification' in window) Notification.requestPermission()

    await loadUsers()
    await loadPublicMessages()
    subscribeToPublic()
    subscribeToIncomingMessages()

    // open chat if redirected from map/profile
    const chatWith = localStorage.getItem('chatWith')
    if (chatWith) {
        localStorage.removeItem('chatWith')
        const user = allUsers.find(u => u.id === chatWith)
        if (user) { switchTab('inbox'); await openChat(user) }
    }
}

// ── Tab switching ───────────────────────────────────────────
function switchTab(tab) {
    currentTab = tab
    document.getElementById('tab-public').classList.toggle('active', tab === 'public')
    document.getElementById('tab-inbox').classList.toggle('active', tab === 'inbox')
    document.getElementById('public-section').classList.toggle('hidden', tab !== 'public')
    document.getElementById('inbox-section').classList.toggle('hidden', tab !== 'inbox')
    document.getElementById('chat-window').style.display = tab === 'inbox' ? 'flex' : 'none'
}

// ── PUBLIC CHAT ─────────────────────────────────────────────
async function loadPublicMessages() {
    const { data, error } = await supabaseClient
        .from('public_messages')
        .select('*, profiles(full_name, avatar_color)')
        .order('created_at', { ascending: true })
        .limit(60)

    const box = document.getElementById('public-messages')
    box.innerHTML = ''
    renderedPublicIds.clear()

    if (error || !data || data.length === 0) {
        box.innerHTML = '<div class="loading-msg">Be the first to say hello! 👋</div>'
        return
    }
    data.forEach(m => renderPublicMessage(m))
    box.scrollTop = box.scrollHeight
}

function renderPublicMessage(msg) {
    const uid = msg.id || (msg.created_at + msg.user_id)
    if (renderedPublicIds.has(uid)) return
    renderedPublicIds.add(uid)

    const box = document.getElementById('public-messages')
    const isOwn = msg.user_id === currentUser.id
    const name  = msg.profiles?.full_name || 'Unknown'
    const init  = name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
    const color = msg.profiles?.avatar_color || '#1a8a5a'
    const time  = formatTime(msg.created_at)

    box.querySelector('.loading-msg')?.remove()

    const div = document.createElement('div')
    div.className = `public-msg ${isOwn ? 'own' : ''}`
    div.innerHTML = `
        <a href="profile.html?id=${msg.user_id}" class="public-msg-avatar"
           style="background:${color};text-decoration:none;color:white;
                  cursor:pointer;display:flex;align-items:center;justify-content:center;">
            ${init}
        </a>
        <div class="public-msg-content">
            <div class="public-msg-name">${isOwn ? 'You' : name}</div>
            <div class="public-msg-bubble">${escapeHtml(msg.message)}</div>
            <div class="public-msg-time">${time}</div>
        </div>`
    box.appendChild(div)
    box.scrollTop = box.scrollHeight

    if (!isOwn && currentTab !== 'public') {
        showNotification('🌍 Public Chat', `${name}: ${msg.message}`, () => {
            window.focus(); switchTab('public')
        })
    }
}

async function sendPublicMessage() {
    if (isSendingPublic) return
    const input = document.getElementById('public-input')
    const message = input.value.trim()
    if (!message) return

    isSendingPublic = true
    input.value = ''
    input.disabled = true

    const { data, error } = await supabaseClient
        .from('public_messages')
        .insert({ user_id: currentUser.id, message })
        .select('*, profiles(full_name, avatar_color)')
        .single()

    input.disabled = false
    input.focus()
    isSendingPublic = false

    if (error) {
        console.error('Send public error:', error)
        input.value = message
        showToast('Failed to send. Try again.')
        return
    }
    if (data) renderPublicMessage(data)
}

function handlePublicKeyPress(e) {
    if (e.key === 'Enter') sendPublicMessage()
}

function subscribeToPublic() {
    publicChannel = supabaseClient
        .channel('public_chat_v2')
        .on('postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'public_messages' },
            async (payload) => {
                const msg = payload.new
                if (msg.user_id === currentUser.id) return // own msg already rendered
                const { data: p } = await supabaseClient
                    .from('profiles').select('full_name, avatar_color')
                    .eq('id', msg.user_id).single()
                msg.profiles = p
                renderPublicMessage(msg)
            }
        ).subscribe()
}

// ── INBOX / PRIVATE CHAT ────────────────────────────────────
async function loadUsers() {
    const { data, error } = await supabaseClient
        .from('profiles')
        .select('id, full_name, bio, avatar_color')
        .neq('id', currentUser.id)
    if (error) return

    const { data: unread } = await supabaseClient
        .from('chat_messages')
        .select('sender_id')
        .eq('receiver_id', currentUser.id)
        .eq('is_read', false)

    const unreadSet = new Set(unread?.map(m => m.sender_id) || [])
    allUsers = data.map(u => ({ ...u, hasUnread: unreadSet.has(u.id) }))
    allUsers.sort((a, b) => b.hasUnread - a.hasUnread)
    renderUsers(allUsers)
}

function renderUsers(users) {
    const list = document.getElementById('users-list')
    if (!users || users.length === 0) {
        list.innerHTML = '<div class="loading-msg">No users found</div>'; return
    }
    list.innerHTML = ''
    users.forEach(user => {
        const name  = user.full_name || 'Unknown'
        const init  = name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
        const color = user.avatar_color || '#1a8a5a'
        const div = document.createElement('div')
        div.className = `user-item ${user.hasUnread ? 'has-unread' : ''}`
        div.id = 'user-item-' + user.id
        div.innerHTML = `
            <div class="user-item-avatar" style="background:${color}">${init}</div>
            <div class="user-item-info">
                <div class="user-item-name">${name}</div>
                <div class="user-item-preview">
                    ${user.hasUnread ? '💬 New message' : (user.bio || 'Start chatting')}
                </div>
            </div>
            ${user.hasUnread ? '<div class="unread-dot"></div>' : ''}`
        div.onclick = () => openChat(user)
        list.appendChild(div)
    })
}

function searchUsers() {
    const q = document.getElementById('search-input').value.toLowerCase()
    renderUsers(allUsers.filter(u => (u.full_name || '').toLowerCase().includes(q)))
}

async function openChat(user) {
    selectedUserId = user.id
    renderedMessageIds.clear()

    document.querySelectorAll('.user-item').forEach(el => el.classList.remove('active'))
    document.getElementById('user-item-' + user.id)?.classList.add('active')

    const name  = user.full_name || 'Unknown'
    const init  = name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
    const color = user.avatar_color || '#1a8a5a'

    const avatar = document.getElementById('chat-avatar')
    avatar.textContent = init
    avatar.style.background = color
    avatar.style.cursor = 'pointer'
    avatar.onclick = () => window.location.href = 'profile.html?id=' + user.id

    document.getElementById('chat-username').textContent = name
    document.getElementById('chat-status').textContent = 'active'
    document.getElementById('view-profile-btn').href = 'profile.html?id=' + user.id
    document.getElementById('no-chat').classList.add('hidden')
    document.getElementById('chat-area').classList.remove('hidden')

    if (window.innerWidth <= 768)
        document.getElementById('chat-window').classList.add('mobile-open')

    if (messageChannel) supabaseClient.removeChannel(messageChannel)

    await loadMessages()
    subscribeToMessages()

    // mark as read
    await supabaseClient.from('chat_messages')
        .update({ is_read: true })
        .eq('sender_id', selectedUserId)
        .eq('receiver_id', currentUser.id)
        .eq('is_read', false)

    const item = document.getElementById('user-item-' + user.id)
    if (item) {
        item.classList.remove('has-unread')
        item.querySelector('.unread-dot')?.remove()
        const preview = item.querySelector('.user-item-preview')
        if (preview) preview.textContent = user.bio || 'Start chatting'
    }
}

async function loadMessages() {
    const { data, error } = await supabaseClient
        .from('chat_messages')
        .select('*')
        .or(`and(sender_id.eq.${currentUser.id},receiver_id.eq.${selectedUserId}),and(sender_id.eq.${selectedUserId},receiver_id.eq.${currentUser.id})`)
        .order('created_at', { ascending: true })

    const box = document.getElementById('messages-container')
    box.innerHTML = ''
    renderedMessageIds.clear()

    if (error || !data || data.length === 0) {
        box.innerHTML = '<div class="loading-msg">Say hello! 👋</div>'; return
    }
    data.forEach(m => renderMessage(m))
    scrollToBottom()
}

function renderMessage(msg) {
    const uid = msg.id || (msg.created_at + msg.sender_id + msg.receiver_id)
    if (renderedMessageIds.has(uid)) return
    renderedMessageIds.add(uid)

    const box    = document.getElementById('messages-container')
    const isSent = msg.sender_id === currentUser.id
    const time   = formatTime(msg.created_at)

    box.querySelector('.loading-msg')?.remove()

    const div = document.createElement('div')
    div.className = `message-bubble ${isSent ? 'sent' : 'received'}`
    div.innerHTML = `${escapeHtml(msg.message)}<div class="message-time">${time}</div>`
    box.appendChild(div)
    scrollToBottom()
}

async function sendMessage() {
    if (isSendingMessage) return
    const input = document.getElementById('message-input')
    const message = input.value.trim()
    if (!message || !selectedUserId) return

    isSendingMessage = true
    input.value = ''
    input.disabled = true

    const { data, error } = await supabaseClient
        .from('chat_messages')
        .insert({
            sender_id:   currentUser.id,
            receiver_id: selectedUserId,
            message,
            is_read: false
        })
        .select()
        .single()

    input.disabled = false
    input.focus()
    isSendingMessage = false

    if (error) {
        console.error('Send error:', error)
        input.value = message
        showToast('Failed to send. Try again.')
        return
    }
    if (data) renderMessage(data)
}

function subscribeToMessages() {
    messageChannel = supabaseClient
        .channel('dm_' + [currentUser.id, selectedUserId].sort().join('_'))
        .on('postgres_changes',
            {
                event: 'INSERT', schema: 'public', table: 'chat_messages',
                filter: `receiver_id=eq.${currentUser.id}`
            },
            (payload) => {
                const msg = payload.new
                if (msg.sender_id !== selectedUserId) return
                renderMessage(msg)
            }
        ).subscribe()
}

function subscribeToIncomingMessages() {
    supabaseClient
        .channel('inbox_' + currentUser.id)
        .on('postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'chat_messages' },
            async (payload) => {
                const msg = payload.new
                if (msg.receiver_id !== currentUser.id) return
                if (msg.sender_id === selectedUserId) return

                const { data: p } = await supabaseClient
                    .from('profiles').select('full_name')
                    .eq('id', msg.sender_id).single()
                const name = p?.full_name || 'Someone'
                const user = allUsers.find(u => u.id === msg.sender_id)

                showNotification(`💬 ${name}`, msg.message, () => {
                    switchTab('inbox')
                    if (user) openChat(user)
                })

                const item = document.getElementById('user-item-' + msg.sender_id)
                if (item && !item.classList.contains('has-unread')) {
                    item.classList.add('has-unread')
                    const preview = item.querySelector('.user-item-preview')
                    if (preview) preview.textContent = '💬 New message'
                    if (!item.querySelector('.unread-dot')) {
                        const dot = document.createElement('div')
                        dot.className = 'unread-dot'
                        item.appendChild(dot)
                    }
                }
            }
        ).subscribe()
}

// ── Notification popup ──────────────────────────────────────
function showNotification(title, body, onClick) {
    if (Notification.permission === 'granted') {
        try {
            const n = new Notification(title, { body })
            n.onclick = () => { onClick(); n.close() }
            setTimeout(() => n.close(), 5000)
        } catch(e) {}
    }

    document.getElementById('in-app-notif')?.remove()

    const notif = document.createElement('div')
    notif.id = 'in-app-notif'
    notif.style.cssText = `
        position:fixed;top:70px;right:16px;left:16px;max-width:400px;margin:0 auto;
        background:#1a8a5a;color:white;padding:14px 16px;border-radius:12px;
        box-shadow:0 4px 20px rgba(0,0,0,0.25);z-index:99999;cursor:pointer;
        animation:slideInNotif 0.3s ease;
    `
    notif.innerHTML = `
        <div style="font-weight:700;font-size:14px;margin-bottom:3px">${title}</div>
        <div style="font-size:13px;opacity:0.9;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${body}</div>
        <div style="font-size:11px;opacity:0.65;margin-top:4px">👆 Tap to view</div>`
    notif.onclick = () => { onClick(); notif.remove() }
    document.body.appendChild(notif)

    setTimeout(() => {
        if (document.getElementById('in-app-notif')) {
            notif.style.animation = 'fadeOutNotif 0.3s ease forwards'
            setTimeout(() => notif.remove(), 300)
        }
    }, 5000)
}

// ── Small toast for errors ──────────────────────────────────
function showToast(msg) {
    document.getElementById('_toast')?.remove()
    const t = document.createElement('div')
    t.id = '_toast'
    t.style.cssText = `
        position:fixed;bottom:80px;left:50%;transform:translateX(-50%);
        background:#333;color:white;padding:10px 20px;border-radius:20px;
        font-size:13px;z-index:99999;white-space:nowrap;
    `
    t.textContent = msg
    document.body.appendChild(t)
    setTimeout(() => t.remove(), 3000)
}

// ── Helpers ─────────────────────────────────────────────────
function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
}

function handleKeyPress(e)       { if (e.key === 'Enter') sendMessage() }
function handlePublicKeyPress(e) { if (e.key === 'Enter') sendPublicMessage() }

function scrollToBottom() {
    const c = document.getElementById('messages-container')
    if (c) c.scrollTop = c.scrollHeight
}

function scrollPublic(dir) {
    document.getElementById('public-messages')
        ?.scrollBy({ top: dir === 'up' ? -200 : 200, behavior: 'smooth' })
}

function scrollInbox(dir) {
    document.getElementById('messages-container')
        ?.scrollBy({ top: dir === 'up' ? -200 : 200, behavior: 'smooth' })
}

function backToList() {
    document.getElementById('chat-window').classList.remove('mobile-open')
    selectedUserId = null
}

function toggleMenu() {
    document.querySelector('.nav-links').classList.toggle('open')
}

async function handleLogout() {
    if (messageChannel) supabaseClient.removeChannel(messageChannel)
    if (publicChannel)  supabaseClient.removeChannel(publicChannel)
    await supabaseClient.auth.signOut()
    window.location.href = 'index.html'
}

// ── Start ───────────────────────────────────────────────────
checkAuth()
