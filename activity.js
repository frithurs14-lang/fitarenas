let selectedType = null
let isTracking = false
let startTime = null
let timerInterval = null
let watchId = null
let totalDistance = 0
let lastPosition = null
let currentUser = null
let activityStarted = null

const typeConfig = {
    walking: { icon: '🚶', label: 'Walking', field: 'walking_km' },
    jogging: { icon: '🏃', label: 'Jogging', field: 'jogging_km' },
    running: { icon: '🏃‍♂️', label: 'Running', field: 'running_km' },
    cycling: { icon: '🚴', label: 'Cycling', field: 'cycling_km' }
}

async function checkAuth() {
    const { data: { session } } = await supabaseClient.auth.getSession()
    if (!session) {
        window.location.href = 'index.html'
        return
    }
    currentUser = session.user
    document.getElementById('user-name').textContent =
        currentUser.user_metadata?.full_name || currentUser.email

    const params = new URLSearchParams(window.location.search)
    const type = params.get('type')
    if (type && typeConfig[type]) selectType(type)
}

function selectType(type) {
    selectedType = type
    document.querySelectorAll('.type-card').forEach(c => c.classList.remove('selected'))
    document.getElementById('type-' + type).classList.add('selected')
    document.getElementById('start-btn').disabled = false
}

function startActivity() {
    if (!selectedType) return

    document.getElementById('select-section').classList.add('hidden')
    document.getElementById('tracking-section').classList.remove('hidden')

    const config = typeConfig[selectedType]
    document.getElementById('activity-icon').textContent = config.icon
    document.getElementById('activity-label').textContent = config.label

    isTracking = true
    startTime = new Date()
    activityStarted = new Date()
    totalDistance = 0
    lastPosition = null

    startTimer()
    startGPS()
}

function startTimer() {
    timerInterval = setInterval(() => {
        const now = new Date()
        const diff = Math.floor((now - startTime) / 1000)
        const h = Math.floor(diff / 3600).toString().padStart(2, '0')
        const m = Math.floor((diff % 3600) / 60).toString().padStart(2, '0')
        const s = (diff % 60).toString().padStart(2, '0')
        document.getElementById('timer').textContent = `${h}:${m}:${s}`
    }, 1000)
}

async function saveActivityLocation(lat, lng) {
    if (!currentUser) return
    await supabaseClient
        .from('live_locations')
        .upsert({
            user_id: currentUser.id,
            latitude: lat,
            longitude: lng,
            is_active: true,
            location_status: 'public',
            updated_at: new Date().toISOString()
        }, { onConflict: 'user_id' })
}

async function clearActivityLocation() {
    if (!currentUser) return
    await supabaseClient
        .from('live_locations')
        .update({ is_active: false })
        .eq('user_id', currentUser.id)
}

function startGPS() {
    if (!navigator.geolocation) return

    navigator.geolocation.getCurrentPosition(
        (pos) => {
            lastPosition = {
                lat: pos.coords.latitude,
                lng: pos.coords.longitude
            }
            saveActivityLocation(pos.coords.latitude, pos.coords.longitude)
        },
        (err) => console.log('Initial GPS error:', err),
        { enableHighAccuracy: true, timeout: 30000, maximumAge: 0 }
    )

    watchId = navigator.geolocation.watchPosition(
        (position) => {
            const { latitude, longitude, speed, accuracy } = position.coords

            // accuracy খারাপ হলে skip করো
            if (accuracy > 20) return

            saveActivityLocation(latitude, longitude)

            if (lastPosition) {
                const dist = calculateDistance(
                    lastPosition.lat, lastPosition.lng,
                    latitude, longitude
                )

                const minDist = selectedType === 'cycling' ? 0.010 :
                                selectedType === 'running' ? 0.008 :
                                selectedType === 'jogging' ? 0.006 : 0.010

                if (dist > minDist) {
                    totalDistance += dist
                    document.getElementById('distance').textContent =
                        totalDistance.toFixed(2)
                }
            }

            lastPosition = { lat: latitude, lng: longitude }
            const kmh = speed ? (speed * 3.6).toFixed(1) : '0.0'
            document.getElementById('speed').textContent = kmh
        },
        (err) => console.log('GPS error:', err),
        { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 }
    )
}

function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371
    const dLat = (lat2 - lat1) * Math.PI / 180
    const dLon = (lon2 - lon1) * Math.PI / 180
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2)
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    return R * c
}

async function stopActivity() {
    isTracking = false
    clearInterval(timerInterval)
    if (watchId) navigator.geolocation.clearWatch(watchId)

    await clearActivityLocation()

    const endTime = new Date()
    const durationSeconds = Math.floor((endTime - activityStarted) / 1000)
    const finalDistance = parseFloat(totalDistance.toFixed(2))

    document.getElementById('tracking-section').classList.add('hidden')
    document.getElementById('result-section').classList.remove('hidden')

    const mins = Math.floor(durationSeconds / 60)
    const secs = durationSeconds % 60
    document.getElementById('result-distance').textContent = finalDistance + ' km'
    document.getElementById('result-time').textContent =
        `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`

    await saveActivity(finalDistance, durationSeconds)
}

async function saveActivity(distance, duration) {
    try {
        const durationHours = duration / 3600
        const maxSpeed = selectedType === 'cycling' ? 60 :
                         selectedType === 'running' ? 25 :
                         selectedType === 'jogging' ? 15 : 10
        const maxPossibleKm = durationHours * maxSpeed

        if (distance > maxPossibleKm) {
            alert('Invalid activity! এত কম সময়ে এত দূর যাওয়া সম্ভব না।')
            return
        }

        const { error: logError } = await supabaseClient
            .from('activity_logs')
            .insert({
                user_id: currentUser.id,
                activity_type: selectedType,
                distance_km: distance,
                duration_seconds: duration,
                started_at: activityStarted.toISOString(),
                ended_at: new Date().toISOString()
            })

        if (logError) {
            console.log('Log error:', logError)
            return
        }

        const field = typeConfig[selectedType].field

        const { data: profileData, error: fetchError } = await supabaseClient
            .from('profiles')
            .select('*')
            .eq('id', currentUser.id)
            .single()

        if (fetchError || !profileData) {
            await supabaseClient
                .from('profiles')
                .insert({
                    id: currentUser.id,
                    full_name: currentUser.user_metadata?.full_name || '',
                    total_km: distance,
                    [field]: distance,
                    last_active: new Date().toISOString().split('T')[0]
                })
            return
        }

        const today = new Date().toISOString().split('T')[0]
        const lastActive = profileData.last_active
        const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0]

        let newStreak = 1
        if (lastActive === yesterday) {
            newStreak = (profileData.streak_days || 0) + 1
        } else if (lastActive === today) {
            newStreak = profileData.streak_days || 1
        }

        await supabaseClient
            .from('profiles')
            .update({
                total_km: parseFloat(profileData.total_km || 0) + distance,
                [field]: parseFloat(profileData[field] || 0) + distance,
                last_active: today,
                streak_days: newStreak
            })
            .eq('id', currentUser.id)

        console.log('সব save হয়েছে!')

    } catch(e) {
        console.log('Save error:', e)
    }
}

function newActivity() {
    selectedType = null
    totalDistance = 0
    lastPosition = null

    document.querySelectorAll('.type-card').forEach(c => c.classList.remove('selected'))
    document.getElementById('start-btn').disabled = true
    document.getElementById('result-section').classList.add('hidden')
    document.getElementById('select-section').classList.remove('hidden')
    document.getElementById('timer').textContent = '00:00:00'
    document.getElementById('distance').textContent = '0.00'
    document.getElementById('speed').textContent = '0.0'
}

async function handleLogout() {
    await supabaseClient.auth.signOut()
    window.location.href = 'index.html'
}

function toggleMenu() {
    document.querySelector('.nav-links').classList.toggle('open')
}

checkAuth()
