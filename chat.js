let currentUser = null
let currentProfile = null
let selectedUserId = null
let allUsers = []
let messageChannel = null
let publicChannel = null
let currentTab = 'public'

async function checkAuth() {
    const { data: { session } } = await supabaseClient.auth.getSession()
    if (!session) {
        window.location.href = 'index.html'
        return
    }
    currentUser = session.user

    const { data: profile } = await supabaseClient
        .from('profiles')
        .select('full_name, avatar_color')
        .eq('id', currentUser.id)
        .single()

    currentProfile = profile
    document.getElementById('user-name').textContent =
        profile?.full_name || currentUser.email

    if ('Notification' in window) {
        Notification.requestPermission()
    }

    await loadUsers()
    await loadPublicMessages()
    subscribeToPublic()
    subscribeToIncomingMessages()

    const chatWith = localStorage.getItem('chatWith')
    if (chatWith) {
        localStorage.removeItem('chatWith')
        const user = allUsers.find(u => u.id === chatWith)
        if (user) {
            switchTab('inbox')
            await openChat(user)
        }
    }
}

function switchTab(tab) {
    currentTab = tab
    document.getElementById('tab-public').classList.toggle('active', tab === 'public')
    document.getElementById('tab-inbox').classList.toggle('active', tab === 'inbox')
    document.getElementById('public-section').classList.toggle('hidden', tab !== 'public')
    document.getElementById('inbox-section').classList.toggle('hidden', tab !== 'inbox')

    if (tab === 'public') {
        document.getElementById('chat-window').style.display = 'none'
    } else {
        document.getElementById('chat-window').style.display = 'flex'
    }
}

async function loadPublicMessages() {
    const { data, error } = await supabaseClient
        .from('public_messages')
        .select('*, profiles(full_name, avatar_color)')
        .order('created_at', { ascending: true })
        .limit(50)

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

    data.forEach(msg => renderPublicMessage(msg))
    container.scrollTop = container.scrollHeight
}

function renderPublicMessage(msg) {
    const container = document.getElementById('public-messages')
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

async function sendPublicMessage() {
    const input = document.getElementById('public-input')
    const message = input.value.trim()
    if (!message) return

    input.value = ''

    const { error } = await supabaseClient
        .from('public_messages')
        .insert({
            user_id: currentUser.id,
            message: message
        })

    if (error) {
        console.log('Public send error:', error)
        input.value = message
    }
}

function handlePublicKeyPress(event) {
    if (event.key === 'Enter') sendPublicMessage()
}

function subscribeToPublic() {
    publicChannel = supabaseClient
        .channel('public_messages_channel')
        .on('postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'public_messages' },
            async (payload) => {
                const msg = payload.new
                const { data: profile } = await supabaseClient
                    .from('profiles')
                    .select('full_name, avatar_color')
                    .eq('id', msg.user_id)
                    .single()
                msg.profiles = profile
                renderPublicMessage(msg)
            }
        )
        .subscribe()
}

function subscribeToIncomingMessages() {
    supabaseClient
        .channel('incoming_messages_' + currentUser.id)
        .on('postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'chat_messages',
              filter: `receiver_id=eq.${currentUser.id}` },
            async (payload) => {
                const msg = payload.new
                if (msg.sender_id === selectedUserId) return

                const { data: profile } = await supabaseClient
                    .from('profiles')
                    .select('full_name')
                    .eq('id', msg.sender_id)
                    .single()

                const name = profile?.full_name || 'কেউ'

                const user = allUsers.find(u => u.id === msg.sender_id)

                showNotification(
                    `💬 ${name}`,
                    msg.message,
                    () => {
                        window.focus()
                        switchTab('inbox')
                        if (user) openChat(user)
                    }
                )

                const item = document.getElementById('user-item-' + msg.sender_id)
                if (item && !item.classList.contains('has-unread')) {
                    item.classList.add('has-unread')
                    const preview = item.querySelector('.user-item-preview')
                    if (preview) preview.textContent = '💬 নতুন message আছে'
                    if (!item.querySelector('.unread-dot')) {
                        const dot = document.createElement('div')
                        dot.className = 'unread-dot'
                        item.appendChild(dot)
                    }
                }
            }
        )
        .subscribe()
}

function showNotification(title, body, onClick) {
    // Browser notification try করো
    if (Notification.permission === 'granted') {
        const notification = new Notification(title, { body })
        notification.onclick = () => { onClick(); notification.close() }
        setTimeout(() => notification.close(), 5000)
    }

    // In-app notification — সব device এ কাজ করবে
    const existing = document.getElementById('in-app-notif')
    if (existing) existing.remove()

    const notif = document.createElement('div')
    notif.id = 'in-app-notif'
    notif.innerHTML = `
        <div style="
            position:fixed;top:70px;right:16px;
            background:#1a8a5a;color:white;
            padding:12px 16px;border-radius:12px;
            box-shadow:0 4px 16px rgba(0,0,0,0.3);
            z-index:9999;max-width:280px;
            cursor:pointer;animation:slideIn 0.3s ease;
        ">
            <div style="font-weight:700;font-size:14px;margin-bottom:4px">${title}</div>
            <div style="font-size:13px;opacity:0.9">${body}</div>
            <div style="font-size:11px;opacity:0.7;margin-top:6px">tap করো message দেখতে</div>
        </div>
    `
    notif.onclick = () => { onClick(); notif.remove() }
    document.body.appendChild(notif)
    setTimeout(() => { if (notif) notif.remove() }, 5000)
}

async function loadUsers() {
    const { data, error } = await supabaseClient
        .from('profiles')
        .select('id, full_name, bio, avatar_color')
        .neq('id', currentUser.id)

    if (error) return

    const { data: unreadMsgs } = await supabaseClient
        .from('chat_messages')
        .select('sender_id')
        .eq('receiver_id', currentUser.id)
        .eq('is_read', false)

    const unreadSenders = new Set(unreadMsgs?.map(m => m.sender_id) || [])

    allUsers = data.map(u => ({ ...u, hasUnread: unreadSenders.has(u.id) }))
    allUsers.sort((a, b) => b.hasUnread - a.hasUnread)
    renderUsers(allUsers)
}

function renderUsers(users) {
    const list = document.getElementById('users-list')

    if (!users || users.length === 0) {
        list.innerHTML = '<div class="loading-msg">কোনো user নেই</div>'
        return
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
                <div class="user-item-preview">
                    ${user.hasUnread ? '💬 নতুন message আছে' : (user.bio || 'Chat শুরু করো')}
                </div>
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

    if (window.innerWidth <= 768) {
        document.getElementById('chat-window').classList.add('mobile-open')
    }

    if (messageChannel) {
        supabaseClient.removeChannel(messageChannel)
    }

    await loadMessages()
    subscribeToMessages()

    await supabaseClient
        .from('chat_messages')
        .update({ is_read: true })
        .eq('sender_id', selectedUserId)
        .eq('receiver_id', currentUser.id)
        .eq('is_read', false)

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
    const { data, error } = await supabaseClient
        .from('chat_messages')
        .select('*')
        .or(`and(sender_id.eq.${currentUser.id},receiver_id.eq.${selectedUserId}),and(sender_id.eq.${selectedUserId},receiver_id.eq.${currentUser.id})`)
        .order('created_at', { ascending: true })

    if (error) {
        console.log('Messages error:', error)
        return
    }

    const container = document.getElementById('messages-container')
    container.innerHTML = ''

    if (!data || data.length === 0) {
        container.innerHTML = '<div class="loading-msg">প্রথম message পাঠাও! 👋</div>'
        return
    }

    data.forEach(msg => renderMessage(msg))
    scrollToBottom()
}

function renderMessage(msg) {
    const container = document.getElementById('messages-container')
    const isSent = msg.sender_id === currentUser.id
    const time = new Date(msg.created_at).toLocaleTimeString('bn-BD', {
        hour: '2-digit',
        minute: '2-digit'
    })

    const empty = container.querySelector('.loading-msg')
    if (empty) empty.remove()

    const profileId = isSent ? currentUser.id : selectedUserId

    const div = document.createElement('div')
    div.className = `message-bubble ${isSent ? 'sent' : 'received'}`
    div.style.cursor = 'pointer'
    div.onclick = () => window.location.href = 'profile.html?id=' + profileId
    div.innerHTML = `
        ${msg.message}
        <div class="message-time">${time}</div>
    `
    container.appendChild(div)
    scrollToBottom()
}

async function sendMessage() {
    const input = document.getElementById('message-input')
    const message = input.value.trim()
    if (!message || !selectedUserId) return

    input.value = ''

    const { error } = await supabaseClient
        .from('chat_messages')
        .insert({
            sender_id: currentUser.id,
            receiver_id: selectedUserId,
            message: message,
            is_read: false
        })

    if (error) {
        console.log('Send error:', error)
        input.value = message
    }
}

function subscribeToMessages() {
    messageChannel = supabaseClient
        .channel('messages_' + currentUser.id + '_' + selectedUserId)
        .on('postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'chat_messages' },
            (payload) => {
                const msg = payload.new
                const isRelevant =
                    (msg.sender_id === currentUser.id && msg.receiver_id === selectedUserId) ||
                    (msg.sender_id === selectedUserId && msg.receiver_id === currentUser.id)
                if (isRelevant) renderMessage(msg)
            }
        )
        .subscribe()
}

function handleKeyPress(event) {
    if (event.key === 'Enter') sendMessage()
}

function scrollToBottom() {
    const container = document.getElementById('messages-container')
    container.scrollTop = container.scrollHeight
}

function backToList() {
    document.getElementById('chat-window').classList.remove('mobile-open')
    selectedUserId = null
}

async function handleLogout() {
    if (messageChannel) supabaseClient.removeChannel(messageChannel)
    if (publicChannel) supabaseClient.removeChannel(publicChannel)
    await supabaseClient.auth.signOut()
    window.location.href = 'index.html'
}

function toggleMenu() {
    document.querySelector('.nav-links').classList.toggle('open')
}

checkAuth()
