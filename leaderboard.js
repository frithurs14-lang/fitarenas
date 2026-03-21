let currentUser = null
let currentPeriod = 'weekly'
let currentActivity = 'all'

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

function changePeriod(period) {
    currentPeriod = period
    document.querySelectorAll('.period-tab').forEach(t => t.classList.remove('active'))
    event.target.classList.add('active')
    loadLeaderboard()
}

function changeActivity(activity) {
    currentActivity = activity
    document.querySelectorAll('.filter-btn').forEach(t => t.classList.remove('active'))
    event.target.classList.add('active')
    loadLeaderboard()
}

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
        total_km: parseFloat((userTotals[p.id] || 0).toFixed(2))
    })).sort((a, b) => b.total_km - a.total_km)

    renderTopThree(ranked)
    renderList(ranked)
    renderMyRank(ranked)
}

function getLevel(km, rank) {
    if (rank === 1) return { label: '💎 Diamond', class: 'level-diamond' }
    if (rank === 2) return { label: '🏆 Platinum', class: 'level-platinum' }
    if (rank === 3) return { label: '🥇 Gold', class: 'level-gold' }
    return { label: '🥉 Bronze', class: 'level-bronze' }
}

function renderTopThree(ranked) {
    const top3 = ranked.slice(0, 3)
    const container = document.getElementById('top-three')
    container.innerHTML = ''

    if (top3.length === 0) return

    const icons = ['🥇', '🥈', '🥉']
    const rankClasses = ['rank-1', 'rank-2', 'rank-3']
    const order = top3.length === 1 ? [0] :
                  top3.length === 2 ? [1, 0] :
                  [1, 0, 2]

    order.forEach(i => {
        if (!top3[i]) return
        const user = top3[i]
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

function renderList(ranked) {
    const list = document.getElementById('leaderboard-list')
    list.innerHTML = ''

    ranked.forEach((user, i) => {
        const rank = i + 1
        const name = user.full_name || 'Unknown'
        const initials = name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
        const isMe = user.id === currentUser.id
        const level = getLevel(user.total_km, rank)

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
                <div class="lb-details">${user.total_km.toFixed(2)} km</div>
            </div>
            <span class="lb-level ${level.class}">${level.label}</span>
            <div class="lb-km">
                ${user.total_km.toFixed(2)}
                <span>km</span>
            </div>
        `
        list.appendChild(div)
    })
}

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
    const level = getLevel(me.total_km, myIndex + 1)

    container.innerHTML = `
        <div class="my-rank-number">#${myIndex + 1}</div>
        <div class="my-rank-info">
            <p>তোমার rank</p>
            <h4>${level.label}</h4>
        </div>
        <div class="my-rank-km">
            ${me.total_km.toFixed(2)} km
        </div>
    `
}

async function handleLogout() {
    await supabaseClient.auth.signOut()
    window.location.href = 'index.html'
}

function toggleMenu() {
    document.querySelector('.nav-links').classList.toggle('open')
}

checkAuth()
