let currentUser = null
let profileData = null
let isOwnProfile = true
let isFollowing = false
let viewingUserId = null
let _visitorProfiles = []
let _visitorsVisible = false
let selectedColor = '#1a8a5a'

async function checkAuth() {
    const { data: { session } } = await supabaseClient.auth.getSession()
    if (!session) {
        window.location.href = 'index.html'
        return
    }
    currentUser = session.user
    document.getElementById('user-name').textContent =
        currentUser.user_metadata?.full_name || currentUser.email

    const urlParams = new URLSearchParams(window.location.search)
    const profileId = urlParams.get('id')

    if (profileId && profileId !== currentUser.id) {
        isOwnProfile = false
        viewingUserId = profileId
        document.querySelector('.btn-edit').classList.add('hidden')
        document.getElementById('follow-btn').classList.remove('hidden')
        document.getElementById('edit-form').classList.add('hidden')
    } else {
        isOwnProfile = true
        viewingUserId = currentUser.id
        document.getElementById('follow-btn').classList.add('hidden')
        document.querySelector('.btn-edit').classList.remove('hidden')
    }

    await loadProfile()
    await loadFollowStats()

    if (!isOwnProfile) {
        await checkFollowing()
        await logVisit()
    } else {
        await loadVisitors()
    }
}

async function loadProfile() {
    const { data, error } = await supabaseClient
        .from('profiles')
        .select('*')
        .eq('id', viewingUserId || currentUser.id)
        .single()

    if (error || !data) {
        console.log('Profile নেই')
        return
    }

    profileData = data

    const name = data.full_name || 'নাম নেই'
    const initials = name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)

    const avatarColor = data.avatar_color || '#1a8a5a'
    selectedColor = avatarColor
    document.getElementById('profile-avatar').textContent = initials
    document.getElementById('profile-avatar').style.background = avatarColor
    document.getElementById('profile-name').textContent = name
    document.getElementById('profile-passion').textContent = data.passion || ''
    document.getElementById('profile-bio').textContent = data.bio || ''

    document.getElementById('stat-total').textContent =
        parseFloat(data.total_km || 0).toFixed(1)
    document.getElementById('stat-walking').textContent =
        parseFloat(data.walking_km || 0).toFixed(1)
    document.getElementById('stat-jogging').textContent =
        parseFloat(data.jogging_km || 0).toFixed(1)
    document.getElementById('stat-running').textContent =
        parseFloat(data.running_km || 0).toFixed(1)
    document.getElementById('stat-cycling').textContent =
        parseFloat(data.cycling_km || 0).toFixed(1)

    updateBadges(data)
}

function updateBadges(data) {
    const totalKm = parseFloat(data.total_km || 0)
    const cyclingKm = parseFloat(data.cycling_km || 0)
    const streak = parseInt(data.streak_days || 0)

    const badges = [
        { index: 0, condition: totalKm >= 1 },
        { index: 1, condition: totalKm >= 10 },
        { index: 2, condition: totalKm >= 50 },
        { index: 3, condition: totalKm >= 100 },
        { index: 4, condition: cyclingKm >= 20 },
        { index: 5, condition: streak >= 7 },
    ]

    const badgeItems = document.querySelectorAll('.badge-item')
    badges.forEach(badge => {
        if (badge.condition) {
            badgeItems[badge.index].classList.remove('locked')
            badgeItems[badge.index].classList.add('unlocked')
        }
    })
}

function toggleEdit() {
    const form = document.getElementById('edit-form')
    form.classList.toggle('hidden')

    if (!form.classList.contains('hidden') && profileData) {
        document.getElementById('edit-name').value = profileData.full_name || ''
        document.getElementById('edit-passion').value = profileData.passion || ''
        document.getElementById('edit-bio').value = profileData.bio || ''

        const currentColor = profileData.avatar_color || '#1a8a5a'
        selectedColor = currentColor
        document.querySelectorAll('.color-opt').forEach(el => {
            el.classList.remove('selected')
            el.textContent = ''
            if (el.dataset.color === currentColor) {
                el.classList.add('selected')
                el.textContent = '✓'
            }
        })
    }
}

function selectColor(el) {
    document.querySelectorAll('.color-opt').forEach(e => {
        e.classList.remove('selected')
        e.textContent = ''
    })
    el.classList.add('selected')
    el.textContent = '✓'
    selectedColor = el.dataset.color
}

async function saveProfile() {
    const name = document.getElementById('edit-name').value.trim()
    const passion = document.getElementById('edit-passion').value.trim()
    const bio = document.getElementById('edit-bio').value.trim()

    if (!name) {
        alert('নাম দাও')
        return
    }

    const { error } = await supabaseClient
        .from('profiles')
        .update({
            full_name: name,
            passion: passion,
            bio: bio,
            avatar_color: selectedColor
        })
        .eq('id', currentUser.id)

    if (error) {
        console.log('Save error:', error)
        alert('Save হয়নি, আবার চেষ্টা করো')
        return
    }

    document.getElementById('profile-name').textContent = name
    document.getElementById('profile-passion').textContent = passion
    document.getElementById('profile-bio').textContent = bio
    document.getElementById('profile-avatar').textContent =
        name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
    document.getElementById('profile-avatar').style.background = selectedColor

    profileData.avatar_color = selectedColor
    toggleEdit()
    alert('Profile update হয়েছে!')
}

async function loadFollowStats() {
    const profileId = viewingUserId || currentUser.id

    const { data: followers } = await supabaseClient
        .from('follows')
        .select('id')
        .eq('following_id', profileId)

    const { data: following } = await supabaseClient
        .from('follows')
        .select('id')
        .eq('follower_id', profileId)

    document.getElementById('followers-count').textContent =
        followers?.length || 0
    document.getElementById('following-count').textContent =
        following?.length || 0
}

async function checkFollowing() {
    const { data } = await supabaseClient
        .from('follows')
        .select('id')
        .eq('follower_id', currentUser.id)
        .eq('following_id', viewingUserId)
        .single()

    isFollowing = !!data
    updateFollowButton()
}

function updateFollowButton() {
    const btn = document.getElementById('follow-btn')
    if (isFollowing) {
        btn.textContent = '✓ Following'
        btn.classList.add('following')
    } else {
        btn.textContent = '+ Follow'
        btn.classList.remove('following')
    }
}

async function toggleFollow() {
    if (isFollowing) {
        await supabaseClient
            .from('follows')
            .delete()
            .eq('follower_id', currentUser.id)
            .eq('following_id', viewingUserId)
        isFollowing = false
    } else {
        await supabaseClient
            .from('follows')
            .insert({
                follower_id: currentUser.id,
                following_id: viewingUserId
            })
        isFollowing = true
    }

    updateFollowButton()
    await loadFollowStats()
}

async function showFollowers() {
    document.getElementById('modal-title').textContent = 'Followers'
    document.getElementById('follow-modal').classList.remove('hidden')

    const profileId = viewingUserId || currentUser.id
    const { data } = await supabaseClient
        .from('follows')
        .select('follower_id')
        .eq('following_id', profileId)

    if (!data || data.length === 0) {
        document.getElementById('modal-list').innerHTML =
            '<div class="no-follow-msg">এখনো কোনো follower নেই</div>'
        return
    }

    const ids = data.map(f => f.follower_id)
    const { data: profiles } = await supabaseClient
        .from('profiles')
        .select('id, full_name, avatar_color')
        .in('id', ids)

    renderModalList(profiles)
}

async function showFollowing() {
    document.getElementById('modal-title').textContent = 'Following'
    document.getElementById('follow-modal').classList.remove('hidden')

    const profileId = viewingUserId || currentUser.id
    const { data } = await supabaseClient
        .from('follows')
        .select('following_id')
        .eq('follower_id', profileId)

    if (!data || data.length === 0) {
        document.getElementById('modal-list').innerHTML =
            '<div class="no-follow-msg">এখনো কাউকে follow করোনি</div>'
        return
    }

    const ids = data.map(f => f.following_id)
    const { data: profiles } = await supabaseClient
        .from('profiles')
        .select('id, full_name, avatar_color')
        .in('id', ids)

    renderModalList(profiles)
}

function renderModalList(profiles) {
    const list = document.getElementById('modal-list')
    list.innerHTML = ''

    profiles.forEach(p => {
        const name = p.full_name || 'Unknown'
        const initials = name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
        const color = p.avatar_color || '#1a8a5a'
        list.innerHTML += `
            <a href="profile.html?id=${p.id}"
               class="follow-user-item"
               onclick="closeModal()">
                <div class="follow-user-avatar" style="background:${color}">${initials}</div>
                <div class="follow-user-name">${name}</div>
            </a>
        `
    })
}

function closeModal() {
    document.getElementById('follow-modal').classList.add('hidden')
}

async function logVisit() {
    const urlParams = new URLSearchParams(window.location.search)
    const visitedId = urlParams.get('id')
    if (!visitedId || visitedId === currentUser.id) return

    await supabaseClient
        .from('profile_visits')
        .insert({
            profile_id: visitedId,
            visitor_id: currentUser.id
        })
}

async function loadVisitors() {
    const { data, error } = await supabaseClient
        .from('profile_visits')
        .select('visitor_id, visited_at')
        .eq('profile_id', currentUser.id)
        .order('visited_at', { ascending: false })

    if (error || !data || data.length === 0) return

    const uniqueVisitors = [...new Map(data.map(v => [v.visitor_id, v])).values()]
    document.getElementById('visitor-count').textContent = uniqueVisitors.length

    const visitorIds = uniqueVisitors.map(v => v.visitor_id)
    const { data: profiles } = await supabaseClient
        .from('profiles')
        .select('id, full_name, avatar_color')
        .in('id', visitorIds)

    if (!profiles) return

    _visitorProfiles = profiles

    const list = document.getElementById('visitors-list')
    list.innerHTML = `
        <p class="visitors-hint" onclick="toggleVisitors()">
            👆 click করো কারা দেখেছে জানতে
        </p>
    `
}

function toggleVisitors() {
    const list = document.getElementById('visitors-list')
    _visitorsVisible = !_visitorsVisible

    if (_visitorsVisible) {
        list.innerHTML = `
            <p class="visitors-hint" onclick="toggleVisitors()">
                🔼 লুকাও
            </p>
        `
        _visitorProfiles.forEach(p => {
            const name = p.full_name || 'Unknown'
            const initials = name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
            const color = p.avatar_color || '#1a8a5a'
            list.innerHTML += `
                <div class="visitor-item">
                    <div class="visitor-avatar" style="background:${color}">${initials}</div>
                    <span>${name}</span>
                </div>
            `
        })
    } else {
        list.innerHTML = `
            <p class="visitors-hint" onclick="toggleVisitors()">
                👆 click করো কারা দেখেছে জানতে
            </p>
        `
    }
}

async function handleLogout() {
    await supabaseClient.auth.signOut()
    window.location.href = 'index.html'
}

function toggleMenu() {
    document.querySelector('.nav-links').classList.toggle('open')
}

checkAuth()