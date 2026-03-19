// ========== AUTH CHECK ==========
// login না থাকলে login page এ পাঠাবে

async function checkAuth() {
    const { data: { session } } = await supabaseClient.auth.getSession()
    
    if (!session) {
        window.location.href = 'index.html'
        return
    }

    const user = session.user
    const fullName = user.user_metadata?.full_name || user.email
    document.getElementById('user-name').textContent = fullName
    
    loadUserStats(user.id)
}

// ========== LOGOUT ==========

async function handleLogout() {
    await supabaseClient.auth.signOut()
    window.location.href = 'index.html'
}

// ========== LOAD USER STATS ==========

async function loadUserStats(userId) {
    try {
        const { data, error } = await supabaseClient
            .from('profiles')
            .select('total_km, streak_days')
            .eq('id', userId)
            .single()

        if (data) {
            document.getElementById('total-km').textContent = 
                parseFloat(data.total_km || 0).toFixed(1)
            document.getElementById('streak-days').textContent = 
                data.streak_days || 0
        }
    } catch(e) {
        console.log('Stats load হয়নি এখনো')
    }
}

// ========== TOGGLE MOBILE MENU ==========

function toggleMenu() {
    const nav = document.querySelector('.nav-links')
    nav.classList.toggle('open')
}

// ========== START ==========

checkAuth()