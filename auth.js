// ========== HELPER FUNCTIONS ==========

function showError(msg) {
    const el = document.getElementById('error-msg')
    const sel = document.getElementById('success-msg')
    el.textContent = msg
    el.classList.remove('hidden')
    sel.classList.add('hidden')
}

function showSuccess(msg) {
    const el = document.getElementById('success-msg')
    const eel = document.getElementById('error-msg')
    el.textContent = msg
    el.classList.remove('hidden')
    eel.classList.add('hidden')
}

function setLoading(btn, loading) {
    btn.disabled = loading
    btn.textContent = loading ? 'অপেক্ষা করো...' : btn.dataset.text
}

// ========== LOGIN ==========

async function handleLogin() {
    const email = document.getElementById('email').value.trim()
    const password = document.getElementById('password').value
    const btn = document.querySelector('.btn-primary')

    if (!email || !password) {
        showError('Email আর Password দাও')
        return
    }

    btn.dataset.text = 'Login'
    setLoading(btn, true)

    const { data, error } = await supabaseClient.auth.signInWithPassword({
        email,
        password
    })

    setLoading(btn, false)

    if (error) {
        if (error.message.includes('Invalid login')) {
            showError('Email বা Password ভুল হয়েছে')
        } else if (error.message.includes('Email not confirmed')) {
            showError('আগে email verify করো, inbox চেক করো')
        } else {
            showError(error.message)
        }
        return
    }

    showSuccess('Login সফল! যাচ্ছি...')
    setTimeout(() => {
        window.location.href = 'home.html'
    }, 1000)
}

// ========== REGISTER ==========

async function handleRegister() {
    const fullname = document.getElementById('fullname').value.trim()
    const email = document.getElementById('email').value.trim()
    const password = document.getElementById('password').value
    const confirm = document.getElementById('confirm-password').value
    const btn = document.querySelector('.btn-primary')

    if (!fullname || !email || !password || !confirm) {
        showError('সব ঘর পূরণ করো')
        return
    }

    if (password.length < 6) {
        showError('Password কমপক্ষে ৬ অক্ষর হতে হবে')
        return
    }

    if (password !== confirm) {
        showError('দুটো Password মিলছে না')
        return
    }

    btn.dataset.text = 'Register করো'
    setLoading(btn, true)

    const { data, error } = await supabaseClient.auth.signUp({
        email,
        password,
        options: {
            data: {
                full_name: fullname
            }
        }
    })

    setLoading(btn, false)

    if (error) {
        if (error.message.includes('already registered')) {
            showError('এই email দিয়ে আগেই account আছে')
        } else {
            showError(error.message)
        }
        return
    }

    showSuccess('Account হয়ে গেছে! Email এ verify link গেছে, inbox চেক করো')
    
    setTimeout(() => {
        document.querySelector('.auth-card').innerHTML = `
            <div style="text-align:center; padding: 20px 0">
                <div style="font-size:48px; margin-bottom:16px">📧</div>
                <h2 style="color:#1a8a5a; margin-bottom:10px">Email চেক করো!</h2>
                <p style="color:#666; font-size:14px; line-height:1.6">
                    <strong>${email}</strong> এ একটা verification link পাঠানো হয়েছে।
                    Link এ click করলেই login করতে পারবে।
                </p>
                <a href="index.html" style="display:inline-block; margin-top:20px; color:#1a8a5a; font-weight:600">
                    → Login এ যাও
                </a>
            </div>
        `
    }, 1500)
}

// ========== FORGOT PASSWORD ==========

async function handleForgot() {
    const email = document.getElementById('email').value.trim()
    const btn = document.querySelector('.btn-primary')

    if (!email) {
        showError('Email দাও')
        return
    }

    btn.dataset.text = 'Reset Link পাঠাও'
    setLoading(btn, true)

    const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + '/reset.html'
    })

    setLoading(btn, false)

    if (error) {
        showError(error.message)
        return
    }

    showSuccess('Reset link পাঠানো হয়েছে! Email inbox চেক করো')
}

// ========== AUTO REDIRECT ==========
// login থাকলে সরাসরি home এ পাঠাবে

async function checkAuth() {
    const { data: { session } } = await supabaseClient.auth.getSession()
    if (session) {
        window.location.href = 'home.html'
    }
}

if (document.querySelector('.auth-body')) {
    checkAuth()
}