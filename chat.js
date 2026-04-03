let currentUser = null
let currentProfile = null
let selectedUserId = null
let allUsers = []
let messageChannel = null
let publicChannel = null
let currentTab = 'public'
let renderedPublicIds = new Set()
let renderedMessageIds = new Set()

// ✅ FIX 1: Time format — সব device এ কাজ করবে
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
    const { data, error } = await supabaseClient
        .from('public_messages')
        .select('*')
        .order('created_at', { ascending: true })
        .limit(50)

    const container = document.getElementById('public-messages')
    container.innerHTML = ''
    renderedPublicIds.clear()

    if (error || !data || data.length === 0) {
        container.innerHTML = '<div class="loading-msg">Be the first to send a message! 👋</div>'
        return
    }

    // ✅ সব message এর profile আলাদা করে load করো
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
    // ✅ FIX 2: Duplicate বন্ধ
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
           style="background:${color};text-decoration:none;color:white;cursor:pointer;display:flex;align-items:center;justify-content:center;">
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

    if (!isOwn && currentTab !== 'public') {
        showNotification('🌍 Public Chat', `${name}: ${msg.message}`, () => {
            window.focus(); switchTab('public')
        })
    }
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
        console.log('Send error:', error)
        input.value = message
        return
    }

    if (data) {
        // ✅ profile আলাদা করে attach করো
        data.profiles = {
            full_name: currentProfile?.full_name,
            avatar_color: currentProfile?.avatar_color
        }
        renderPublicMessage(data)
    }
}

function handlePublicKeyPress(e) { if (e.key === 'Enter') sendPublicMessage() }

function subscribeToPublic() {
    publicChannel = supabaseClient.channel('public_messages_channel')
        .on('postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'public_messages' },
            async (payload) => {
                const msg = payload.new
                if (msg.user_id === currentUser.id) return

                const { data: profile } = await supabaseClient
                    .from('profiles').select('full_name, avatar_color')
                    .eq('id', msg.user_id).single()
                msg.profiles = profile
                renderPublicMessage(msg)

                if (currentTab !== 'public') {
                    const name = profile?.full_name || 'Someone'
                    showNotification('🌍 Public Chat', `${name}: ${msg.message}`, () => {
                        window.focus()
                        switchTab('public')
                        setTimeout(() => {
                            const container = document.getElementById('public-messages')
                            container.scrollTop = container.scrollHeight
                        }, 100)
                    })
                }
            }
        ).subscribe()
}

function subscribeToIncomingMessages() {
    supabaseClient.channel('incoming_' + currentUser.id)
        .on('postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'chat_messages' },
            async (payload) => {
                const msg = payload.new
                if (msg.receiver_id !== currentUser.id) return
                if (msg.sender_id === selectedUserId) return

                const { data: profile } = await supabaseClient
                    .from('profiles')
                    .select('id, full_name, avatar_color, bio')
                    .eq('id', msg.sender_id)
                    .single()

                const name = profile?.full_name || 'Someone'

                // ✅ allUsers এ না থাকলে add করো
                let user = allUsers.find(u => u.id === msg.sender_id)
                if (!user && profile) {
                    user = { ...profile, hasUnread: true }
                    allUsers.unshift(user)
                    renderUsers(allUsers)
                }

                showNotification(`💬 ${name}`, msg.message, async () => {
                    window.focus()
                    switchTab('inbox')

                    // ✅ user নিশ্চিত করে খোঁজো
                    const targetUser = allUsers.find(u => u.id === msg.sender_id) || profile
                    if (targetUser) {
                        await openChat(targetUser)
                    }
                })

                // ✅ unread dot যোগ করো
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

// ✅ FIX 4: Popup animation CSS
const notifStyle = document.createElement('style')
notifStyle.textContent = `
@keyframes slideIn { from { transform:translateY(-20px);opacity:0 } to { transform:translateY(0);opacity:1 } }
@keyframes fadeOut { from { opacity:1 } to { opacity:0 } }
`
document.head.appendChild(notifStyle)

function showNotification(title, body, onClick) {
    if (Notification.permission === 'granted') {
        try {
            const n = new Notification(title, { body })
            n.onclick = () => { onClick(); n.close() }
            setTimeout(() => n.close(), 5000)
        } catch(e) {}
    }

    const existing = document.getElementById('in-app-notif')
    if (existing) existing.remove()

    const notif = document.createElement('div')
    notif.id = 'in-app-notif'
    notif.style.cssText = `
        position:fixed;top:70px;right:16px;left:16px;max-width:400px;margin:0 auto;
        background:#1a8a5a;color:white;padding:14px 16px;border-radius:12px;
        box-shadow:0 4px 16px rgba(0,0,0,0.3);z-index:99999;cursor:pointer;
        animation:slideIn 0.3s ease;
    `
    notif.innerHTML = `
        <div style="font-weight:700;font-size:14px;margin-bottom:4px">${title}</div>
        <div style="font-size:13px;opacity:0.9;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${body}</div>
        <div style="font-size:11px;opacity:0.7;margin-top:4px">👆 tap to view</div>
    `
    notif.onclick = () => { onClick(); notif.remove() }
    document.body.appendChild(notif)
    setTimeout(() => {
        if (document.getElementById('in-app-notif')) {
            notif.style.animation = 'fadeOut 0.3s ease'
            setTimeout(() => notif.remove(), 300)
        }
    }, 5000)
}

async function loadUsers() {
    const { data, error } = await supabaseClient
        .from('profiles').select('id, full_name, bio, avatar_color').neq('id', currentUser.id)
    if (error) return

    const { data: unreadMsgs } = await supabaseClient
        .from('chat_messages').select('sender_id')
        .eq('receiver_id', currentUser.id).eq('is_read', false)

    const unreadSenders = new Set(unreadMsgs?.map(m => m.sender_id) || [])
    allUsers = data.map(u => ({ ...u, hasUnread: unreadSenders.has(u.id) }))
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
        const name = user.full_name || 'Unknown'
        const initials = name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
        const color = user.avatar_color || '#1a8a5a'
        const div = document.createElement('div')
        div.className = `user-item ${user.hasUnread ? 'has-unread' : ''}`
        div.id = 'user-item-' + user.id
        div.innerHTML = `
            <div class="user-item-avatar" style="background:${color}">${initials}</div>
            <div class="user-item-info">
                <div class="user-item-name">${name}</div>
                <div class="user-item-preview">${user.hasUnread ? '💬 New message' : (user.bio || 'Start chatting')}</div>
            </div>
            ${user.hasUnread ? '<div class="unread-dot"></div>' : ''}
        `
        div.onclick = () => openChat(user)
        list.appendChild(div)
    })
}

function searchUsers() {
    const query = document.getElementById('search-input').value.toLowerCase()
    renderUsers(allUsers.filter(u => (u.full_name || '').toLowerCase().includes(query)))
}

async function openChat(user) {
    selectedUserId = user.id
    document.querySelectorAll('.user-item').forEach(el => el.classList.remove('active'))
    const userItem = document.getElementById('user-item-' + user.id)
    if (userItem) userItem.classList.add('active')

    const name = user.full_name || 'Unknown'
    const initials = name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
    const color = user.avatar_color || '#1a8a5a'

    const avatar = document.getElementById('chat-avatar')
    avatar.textContent = initials
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

    // ✅ আগের channel সরাও
    if (messageChannel) {
        await supabaseClient.removeChannel(messageChannel)
        messageChannel = null
    }

    renderedMessageIds.clear()

    // ✅ আগে messages load করো, তারপর subscribe করো
    await loadMessages()
    subscribeToMessages()

    // ✅ সব unread message read করো
    await supabaseClient
        .from('chat_messages')
        .update({ is_read: true })
        .eq('sender_id', selectedUserId)
        .eq('receiver_id', currentUser.id)
        .eq('is_read', false)

    // ✅ UI থেকে unread সরাও
    const item = document.getElementById('user-item-' + user.id)
    if (item) {
        item.classList.remove('has-unread')
        const dot = item.querySelector('.unread-dot')
        if (dot) dot.remove()
        const preview = item.querySelector('.user-item-preview')
        if (preview) preview.textContent = user.bio || 'Start chatting'
    }
}
async function loadMessages() {
    const { data, error } = await supabaseClient
        .from('chat_messages').select('*')
        .or(`and(sender_id.eq.${currentUser.id},receiver_id.eq.${selectedUserId}),and(sender_id.eq.${selectedUserId},receiver_id.eq.${currentUser.id})`)
        .order('created_at', { ascending: true })

    const container = document.getElementById('messages-container')
    container.innerHTML = ''
    renderedMessageIds.clear()

    if (error || !data || data.length === 0) {
        container.innerHTML = '<div class="loading-msg">Say hello! 👋</div>'; return
    }
    data.forEach(msg => renderMessage(msg))
    scrollToBottom()
}

function renderMessage(msg) {
    // ✅ FIX: Duplicate বন্ধ
    const msgId = msg.id || (msg.created_at + msg.sender_id)
    if (renderedMessageIds.has(msgId)) return
    renderedMessageIds.add(msgId)

    const container = document.getElementById('messages-container')
    const isSent = msg.sender_id === currentUser.id
    const time = formatTime(msg.created_at)
    const empty = container.querySelector('.loading-msg')
    if (empty) empty.remove()

    const div = document.createElement('div')
    div.className = `message-bubble ${isSent ? 'sent' : 'received'}`
    div.style.cursor = 'pointer'
    div.onclick = () => window.location.href = 'profile.html?id=' + (isSent ? currentUser.id : selectedUserId)
    div.innerHTML = `${msg.message}<div class="message-time">${time}</div>`
    container.appendChild(div)
    scrollToBottom()
}

async function sendMessage() {
    const input = document.getElementById('message-input')
    const message = input.value.trim()
    if (!message || !selectedUserId) return

    input.value = ''
    input.disabled = true // ✅ Double send বন্ধ

    const { data, error } = await supabaseClient
        .from('chat_messages')
        .insert({ sender_id: currentUser.id, receiver_id: selectedUserId, message, is_read: false })
        .select().single()

    input.disabled = false
    input.focus()

    if (error) { console.log('Send error:', error); input.value = message; return }
    if (data) renderMessage(data)
}

function subscribeToMessages() {
    messageChannel = supabaseClient
        .channel('messages_' + [currentUser.id, selectedUserId].sort().join('_'))
        .on('postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `receiver_id=eq.${currentUser.id}` },
            async (payload) => {
                const msg = payload.new
                if (msg.sender_id !== selectedUserId) return

                renderMessage(msg)

                // ✅ নতুন message সাথে সাথে read mark করো
                await supabaseClient
                    .from('chat_messages')
                    .update({ is_read: true })
                    .eq('id', msg.id)
            }
        ).subscribe()
}

function handleKeyPress(e) { if (e.key === 'Enter') sendMessage() }
function scrollToBottom() {
    const c = document.getElementById('messages-container')
    c.scrollTop = c.scrollHeight
}
function backToList() {
    document.getElementById('chat-window').classList.remove('mobile-open')
    document.getElementById('chat-area').classList.add('hidden')
    document.getElementById('no-chat').classList.remove('hidden')
    selectedUserId = null

    // ✅ active highlight সরাও
    document.querySelectorAll('.user-item').forEach(el => el.classList.remove('active'))

    // ✅ channel সরাও
    if (messageChannel) {
        supabaseClient.removeChannel(messageChannel)
        messageChannel = null
    }
}
async function handleLogout() {
    if (messageChannel) supabaseClient.removeChannel(messageChannel)
    if (publicChannel) supabaseClient.removeChannel(publicChannel)
    await supabaseClient.auth.signOut()
    window.location.href = 'index.html'
}
function toggleMenu() { document.querySelector('.nav-links').classList.toggle('open') }
function scrollPublic(dir) {
    document.getElementById('public-messages').scrollBy({ top: dir === 'up' ? -200 : 200, behavior: 'smooth' })
}
function scrollInbox(dir) {
    document.getElementById('messages-container').scrollBy({ top: dir === 'up' ? -200 : 200, behavior: 'smooth' })
}

checkAuth()
