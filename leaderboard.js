let currentUser = null
let currentPeriod = 'weekly'
let currentActivity = 'all'

// ========== AUTH CHECK ==========

async function checkAuth() {
    const { data: { session } } = await supabaseClient.auth.getSession()
    if (!session) {
        window.location.href = 'index.html'
        return
    }
    currentUser = session.user
    document.getElementById('user-name').textContent =
        currentUser.user_metadata?.full_name || currentUser.email

    await loadLeaderboard()
}

// ========== CHANGE PERIOD ==========

function changePeriod(period) {
    currentPeriod = period
    document.querySelectorAll('.period-tab').forEach(t => t.classList.remove('active'))
    event.target.classList.add('active')
    loadLeaderboard()
}

// ========== CHANGE ACTIVITY ==========

function changeActivity(activity) {
    currentActivity = activity
    document.querySelectorAll('.filter-btn').forEach(t => t.classList.remove('active'))
    event.target.classList.add('active')
    loadLeaderboard()
}

// ========== GET DATE RANGE ==========

function getDateRange() {
    const now = new Date()
    let from = new Date()

    if (currentPeriod === 'weekly') {
        from.setDate(now.getDate() - 7)
    } else if (currentPeriod === 'monthly') {
        from.setMonth(now.getMonth() - 1)
    } else if (currentPeriod === 'yearly') {
        from.setFullYear(now.getFullYear() - 1)
    } else {
        return null
    }

    return from.toISOString()
}

// ========== LOAD LEADERBOARD ==========

async function loadLeaderboard() {
    document.getElementById('leaderboard-list').innerHTML =
        '<div class="loading-msg">লোড হচ্ছে...</div>'
    document.getElementById('top-three').innerHTML = ''
    document.getElementById('my-rank').innerHTML = ''

    let query = supabaseClient
        .from('activity_logs')
        .select('user_id, distance_km, activity_type')

    const from = getDateRange()
    if (from) {
        query = query.gte('created_at', from)
    }

    if (currentActivity !== 'all') {
        query = query.eq('activity_type', currentActivity)
    }

    const { data, error } = await query

    if (error) {
        console.log('Leaderboard error:', error)
        return
    }

    const userTotals = {}
    data.forEach(log => {
        if (!userTotals[log.user_id]) {
            userTotals[log.user_id] = 0
        }
        userTotals[log.user_id] += parseFloat(log.distance_km || 0)
    })

    const userIds = Object.keys(userTotals)
    if (userIds.length === 0) {
        document.getElementById('leaderboard-list').innerHTML =
            '<div class="loading-msg">এই সময়ে কোনো activity নেই</div>'
        return
    }

    const { data: profiles } = await supabaseClient
        .from('profiles')
        .select('id, full_name')
        .in('id', userIds)

    const ranked = profiles.map(p => ({
        ...p,
        total_km: userTotals[p.id] || 0
    })).sort((a, b) => b.total_km - a.total_km)

    renderTopThree(ranked)
    renderList(ranked)
    renderMyRank(ranked)
}

// ========== GET LEVEL ==========

function getLevel(km) {
    if (km >= 100) return { label: '💎 Diamond', class: 'level-diamond' }
    if (km >= 50) return { label: '🥇 Gold', class: 'level-gold' }
    if (km >= 10) return { label: '🥈 Silver', class: 'level-silver' }
    return { label: '🥉 Bronze', class: 'level-bronze' }
}

// ========== RENDER TOP 3 ==========

function renderTopThree(ranked) {
    const top3 = ranked.slice(0, 3)
    const container = document.getElementById('top-three')
    container.innerHTML = ''

    const icons = ['🥇', '🥈', '🥉']
    const rankClasses = ['rank-1', 'rank-2', 'rank-3']

    top3.forEach((user, i) => {
        const name = user.full_name || 'Unknown'
        const initials = name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)

        const div = document.createElement('div')
        div.className = `top-card ${rankClasses[i]}`
        div.onclick = () => window.location.href = 'profile.html?id=' + user.id
        div.innerHTML = `
            <span class="top-rank-icon">${icons[i]}</span>
            <div class="top-avatar">${initials}</div>
            <div class="top-name">${name}</div>
            <div class="top-km">
                ${user.total_km.toFixed(1)}
                <span>km</span>
            </div>
        `
        container.appendChild(div)
    })
}

// ========== RENDER LIST ==========

function renderList(ranked) {
    const list = document.getElementById('leaderboard-list')
    list.innerHTML = ''

    ranked.forEach((user, i) => {
        const rank = i + 1
        const name = user.full_name || 'Unknown'
        const initials = name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
        const isMe = user.id === currentUser.id
        const level = getLevel(user.total_km)

        let rankColor = ''
        if (rank === 1) rankColor = 'gold'
        else if (rank === 2) rankColor = 'silver'
        else if (rank === 3) rankColor = 'bronze'

        const div = document.createElement('div')
        div.className = `lb-row ${isMe ? 'is-me' : ''}`
        div.onclick = () => window.location.href = 'profile.html?id=' + user.id
        div.innerHTML = `
            <div class="lb-rank ${rankColor}">${rank}</div>
            <div class="lb-avatar">${initials}</div>
            <div class="lb-info">
                <div class="lb-name">${name} ${isMe ? '(আমি)' : ''}</div>
                <div class="lb-details">${user.total_km.toFixed(1)} km</div>
            </div>
            <span class="lb-level ${level.class}">${level.label}</span>
            <div class="lb-km">
                ${user.total_km.toFixed(1)}
                <span>km</span>
            </div>
        `
        list.appendChild(div)
    })
}

// ========== RENDER MY RANK ==========

function renderMyRank(ranked) {
    const myIndex = ranked.findIndex(u => u.id === currentUser.id)
    const container = document.getElementById('my-rank')

    if (myIndex === -1) {
        container.innerHTML = `
            <div class="my-rank-number">—</div>
            <div class="my-rank-info">
                <p>এই সময়ে তোমার কোনো activity নেই</p>
                <h4>Activity শুরু করো!</h4>
            </div>
        `
        return
    }

    const me = ranked[myIndex]
    const level = getLevel(me.total_km)

    container.innerHTML = `
        <div class="my-rank-number">#${myIndex + 1}</div>
        <div class="my-rank-info">
            <p>তোমার rank</p>
            <h4>${level.label}</h4>
        </div>
        <div class="my-rank-km">
            ${me.total_km.toFixed(1)} km
        </div>
    `
}

// ========== LOGOUT & MENU ==========

async function handleLogout() {
    await supabaseClient.auth.signOut()
    window.location.href = 'index.html'
}

function toggleMenu() {
    document.querySelector('.nav-links').classList.toggle('open')
}

// ========== START ==========

checkAuth()