let currentUser = null
let map = null
let userMarker = null
let otherMarkers = {}
let watchId = null
let currentLat = null
let currentLng = null
let locationGranted = false
let realtimeChannel = null
let distanceLines = []
let distancesVisible = false

window.addEventListener('beforeunload', () => {
    if (currentUser) {
        navigator.sendBeacon(
            `https://rmvtyysvnhvfodozijrl.supabase.co/rest/v1/live_locations?user_id=eq.${currentUser.id}`,
            JSON.stringify({ is_active: false })
        )
    }
})

async function checkAuth() {
    const { data: { session } } = await supabaseClient.auth.getSession()
    if (!session) {
        window.location.href = 'index.html'
        return
    }
    currentUser = session.user
    document.getElementById('user-name').textContent =
        currentUser.user_metadata?.full_name || currentUser.email

    await loadPrivacySetting()
    initMap()

    document.getElementById('allow-btn').addEventListener('click', requestLocation)
    document.getElementById('deny-btn').addEventListener('click', denyLocation)

    if (navigator.permissions) {
        const permission = await navigator.permissions.query({ name: 'geolocation' })

        if (permission.state === 'granted') {
            document.getElementById('location-popup').classList.add('hidden')
            requestLocation()
        } else if (permission.state === 'denied') {
            document.getElementById('location-popup').classList.add('hidden')
            updateLocationStatus(false)
        } else {
            document.getElementById('location-popup').classList.remove('hidden')
        }

        permission.onchange = () => {
            if (permission.state === 'granted') {
                document.getElementById('location-popup').classList.add('hidden')
                requestLocation()
            } else if (permission.state === 'denied') {
                document.getElementById('location-popup').classList.add('hidden')
                updateLocationStatus(false)
            }
        }
    } else {
        const { data } = await supabaseClient
            .from('live_locations')
            .select('latitude, longitude')
            .eq('user_id', currentUser.id)
            .single()

        if (data && data.latitude) {
            document.getElementById('location-popup').classList.add('hidden')
            requestLocation()
        } else {
            document.getElementById('location-popup').classList.remove('hidden')
        }
    }
}

function initMap() {
    if (map) {
        map.remove()
        map = null
    }

    map = L.map('map', {
        zoomControl: false,
        minZoom: 3,
        maxZoom: 19
    }).setView([23.8103, 90.4125], 13)

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap',
        maxZoom: 19
    }).addTo(map)

    L.control.zoom({ position: 'bottomright' }).addTo(map)

    setTimeout(() => {
        if (map) map.invalidateSize()
    }, 300)
}

function requestLocation() {
    document.getElementById('location-popup').classList.add('hidden')

    if (!navigator.geolocation) {
        alert('তোমার browser এ GPS সাপোর্ট নেই')
        return
    }

    navigator.geolocation.getCurrentPosition(
    (pos) => {
        locationGranted = true
        currentLat = pos.coords.latitude
        currentLng = pos.coords.longitude
        map.setView([currentLat, currentLng], 17)
        addUserMarker(currentLat, currentLng)
        updateLocationStatus(true)
        saveLocation(currentLat, currentLng)
        loadNearbyUsers()
        startLocationWatch()
        startRealtimeUpdates()

        setInterval(async () => {
            if (currentLat && currentLng) {
                await saveLocation(currentLat, currentLng)
            }
            await loadNearbyUsers()
        }, 30000)
    },
        (err) => {
            if (err.code === 1) {
                alert('Location permission দাও — browser settings এ Allow করো')
            } else if (err.code === 2) {
                alert('GPS signal পাওয়া যাচ্ছে না — একটু পরে আবার চেষ্টা করো')
            } else if (err.code === 3) {
                alert('GPS timeout — আবার Allow করো')
            }
            updateLocationStatus(false)
            document.getElementById('location-popup').classList.remove('hidden')
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    )
}

function denyLocation() {
    document.getElementById('location-popup').classList.add('hidden')
    updateLocationStatus(false)
}

function addUserMarker(lat, lng) {
    const icon = L.divIcon({
        className: '',
        html: '<div class="user-marker"></div>',
        iconSize: [16, 16],
        iconAnchor: [8, 8]
    })

    if (userMarker) {
        userMarker.setLatLng([lat, lng])
    } else {
        userMarker = L.marker([lat, lng], { icon })
            .addTo(map)
            .bindPopup('<b>📍 আমি</b>')
            .openPopup()
    }
}

function startLocationWatch() {
    if (watchId) navigator.geolocation.clearWatch(watchId)
    watchId = navigator.geolocation.watchPosition(
        (pos) => {
            currentLat = pos.coords.latitude
            currentLng = pos.coords.longitude
            addUserMarker(currentLat, currentLng)
            saveLocation(currentLat, currentLng)
        },
        (err) => console.log('GPS error:', err),
        { enableHighAccuracy: true, maximumAge: 3000, timeout: 15000 }
    )
}

async function saveLocation(lat, lng) {
    const privacySelect = document.getElementById('privacy-select')
    const status = privacySelect ? privacySelect.value : 'only_me'

    const { error } = await supabaseClient
        .from('live_locations')
        .upsert({
            user_id: currentUser.id,
            latitude: lat,
            longitude: lng,
            is_active: true,
            location_status: status,
            updated_at: new Date().toISOString()
        }, { onConflict: 'user_id' })

    if (error) console.log('Location save error:', error)
}

async function loadNearbyUsers() {
    if (!currentLat || !currentLng) return

    const { data, error } = await supabaseClient
        .from('live_locations')
        .select('user_id, latitude, longitude, location_status, is_active')
        .eq('is_active', true)
        .eq('location_status', 'public')
        .neq('user_id', currentUser.id)

    if (error) {
        console.log('Nearby error:', error)
        return
    }

    const nearby = data.filter(u => {
        const dist = calculateDistance(
            currentLat, currentLng,
            u.latitude, u.longitude
        )
        return dist <= 5
    })

    document.getElementById('nearby-count').textContent = nearby.length

    if (map) {
    Object.keys(otherMarkers).forEach(id => {
        try { map.removeLayer(otherMarkers[id]) } catch(e) {}
    })
}
otherMarkers = {}

for (const user of nearby) {
    await addOtherMarker(user)
}

    if (distancesVisible) {
        distanceLines.forEach(l => map.removeLayer(l))
        distanceLines = []
        distancesVisible = false
        const btn = document.getElementById('distance-btn')
        if (btn) btn.textContent = '📏 দূরত্ব'
    }
}

async function addOtherMarker(user) {
    const { data: profile } = await supabaseClient
        .from('profiles')
        .select('full_name, avatar_color')
        .eq('id', user.user_id)
        .single()

    const name = profile?.full_name || 'Unknown'
    const color = profile?.avatar_color || '#1a8a5a'
    const initials = name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)

    let distText = ''
    if (currentLat && currentLng) {
        const dist = calculateDistance(currentLat, currentLng, user.latitude, user.longitude)
        distText = dist < 1
            ? Math.round(dist * 1000) + ' মিটার দূরে'
            : dist.toFixed(1) + ' km দূরে'
    }

    const icon = L.divIcon({
        className: '',
        html: `
            <div style="display:flex;flex-direction:column;align-items:center;cursor:pointer;">
                <div style="
                    width:36px;height:36px;border-radius:50%;
                    background:${color};border:3px solid white;
                    box-shadow:0 2px 8px rgba(0,0,0,0.3);
                    display:flex;align-items:center;justify-content:center;
                    color:white;font-size:13px;font-weight:700;
                ">${initials}</div>
                <div style="
                    background:white;color:#333;font-size:11px;font-weight:600;
                    padding:2px 8px;border-radius:10px;margin-top:3px;
                    box-shadow:0 1px 4px rgba(0,0,0,0.2);white-space:nowrap;
                ">${name}</div>
            </div>
        `,
        iconSize: [60, 55],
        iconAnchor: [30, 55]
    })

    const marker = L.marker([user.latitude, user.longitude], { icon })
        .addTo(map)
        .bindPopup(`
            <div style="font-family:sans-serif;padding:6px;min-width:160px">
                <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
                    <div style="
                        width:40px;height:40px;border-radius:50%;flex-shrink:0;
                        background:${color};color:white;font-size:15px;font-weight:700;
                        display:flex;align-items:center;justify-content:center;
                    ">${initials}</div>
                    <div>
                        <div style="font-size:14px;font-weight:700;color:#333">${name}</div>
                        <div style="font-size:12px;color:#1a8a5a;font-weight:600">📍 ${distText}</div>
                    </div>
                </div>
                <div style="display:flex;gap:6px;">
                    <a href="profile.html?id=${user.user_id}"
                       style="flex:1;background:#f0fff6;color:#1a8a5a;padding:7px 4px;
                              border-radius:8px;text-decoration:none;font-size:12px;
                              font-weight:600;text-align:center;border:1px solid #c8eedd;">
                       👤 Profile
                    </a>
                    <a href="chat.html"
                       onclick="localStorage.setItem('chatWith','${user.user_id}')"
                       style="flex:1;background:#1a8a5a;color:white;padding:7px 4px;
                              border-radius:8px;text-decoration:none;font-size:12px;
                              font-weight:600;text-align:center;">
                       💬 Message
                    </a>
                </div>
            </div>
        `, { maxWidth: 200 })

    otherMarkers[user.user_id] = marker
}

function startRealtimeUpdates() {
    if (realtimeChannel) {
        supabaseClient.removeChannel(realtimeChannel)
    }

    realtimeChannel = supabaseClient
        .channel('live_locations_channel')
        .on('postgres_changes',
            { event: '*', schema: 'public', table: 'live_locations' },
            async (payload) => {
                const changed = payload.new
                if (!changed) return

                if (!changed.is_active || changed.location_status !== 'public') {
                    if (otherMarkers[changed.user_id]) {
                        map.removeLayer(otherMarkers[changed.user_id])
                        delete otherMarkers[changed.user_id]
                        document.getElementById('nearby-count').textContent =
                            Object.keys(otherMarkers).length
                        distanceLines.forEach(l => map.removeLayer(l))
                        distanceLines = []
                        distancesVisible = false
                        const btn = document.getElementById('distance-btn')
                        if (btn) btn.textContent = '📏 দূরত্ব'
                    }
                } else {
                    await loadNearbyUsers()
                }
            }
        )
        .subscribe()
}

async function refreshMap() {
    const btn = document.getElementById('refresh-btn')
    if (btn) {
        btn.textContent = '🔄 ...'
        btn.disabled = true
    }

    distanceLines.forEach(l => map.removeLayer(l))
    distanceLines = []
    distancesVisible = false
    const distBtn = document.getElementById('distance-btn')
    if (distBtn) distBtn.textContent = '📏 দূরত্ব'

    Object.keys(otherMarkers).forEach(id => {
        map.removeLayer(otherMarkers[id])
    })
    otherMarkers = {}

    if (currentLat && currentLng) {
        await saveLocation(currentLat, currentLng)
        await loadNearbyUsers()
    }

    if (btn) {
        btn.textContent = '🔄 Refresh'
        btn.disabled = false
    }
}

async function showDistances() {
    if (!currentLat || !currentLng) {
        alert('আগে location on করো')
        return
    }

    const ids = Object.keys(otherMarkers)
    if (ids.length === 0) {
        alert('কাছে কেউ নেই')
        return
    }

    if (distancesVisible) {
        distanceLines.forEach(l => map.removeLayer(l))
        distanceLines = []
        distancesVisible = false
        document.getElementById('distance-btn').textContent = '📏 দূরত্ব'
        return
    }

    distancesVisible = true
    document.getElementById('distance-btn').textContent = '❌ দূরত্ব বন্ধ'

    const { data } = await supabaseClient
        .from('live_locations')
        .select('user_id, latitude, longitude')
        .in('user_id', Object.keys(otherMarkers))

    if (!data) return

    const { data: profiles } = await supabaseClient
        .from('profiles')
        .select('id, full_name')
        .in('id', Object.keys(otherMarkers))

    data.forEach(u => {
        const dist = calculateDistance(currentLat, currentLng, u.latitude, u.longitude)
        const profile = profiles?.find(p => p.id === u.user_id)
        const name = profile?.full_name || 'Unknown'
        const distText = dist < 1
            ? Math.round(dist * 1000) + ' মি'
            : dist.toFixed(1) + ' km'

        const line = L.polyline(
            [[currentLat, currentLng], [u.latitude, u.longitude]],
            { color: '#1a8a5a', weight: 2, opacity: 0.7, dashArray: '6 4' }
        ).addTo(map)

        const midLat = (currentLat + u.latitude) / 2
        const midLng = (currentLng + u.longitude) / 2

        const label = L.divIcon({
            className: '',
            html: `
                <div style="
                    background:#1a8a5a;color:white;font-size:11px;font-weight:700;
                    padding:3px 8px;border-radius:10px;white-space:nowrap;
                    box-shadow:0 1px 4px rgba(0,0,0,0.2);
                ">📍 ${distText} · ${name}</div>
            `,
            iconAnchor: [40, 10]
        })

        const labelMarker = L.marker([midLat, midLng], { icon: label }).addTo(map)
        distanceLines.push(line)
        distanceLines.push(labelMarker)
    })
}

async function loadPrivacySetting() {
    const { data } = await supabaseClient
        .from('live_locations')
        .select('location_status')
        .eq('user_id', currentUser.id)
        .single()

    if (data) {
        document.getElementById('privacy-select').value = data.location_status
    }
}

async function updatePrivacy() {
    const status = document.getElementById('privacy-select').value
    if (currentLat && currentLng) {
        await saveLocation(currentLat, currentLng)
    } else {
        await supabaseClient
            .from('live_locations')
            .update({ location_status: status })
            .eq('user_id', currentUser.id)
    }

    if (status === 'only_me') {
        Object.keys(otherMarkers).forEach(id => map.removeLayer(otherMarkers[id]))
        otherMarkers = {}
        document.getElementById('nearby-count').textContent = '0'
        distanceLines.forEach(l => map.removeLayer(l))
        distanceLines = []
        distancesVisible = false
        const btn = document.getElementById('distance-btn')
        if (btn) btn.textContent = '📏 দূরত্ব'
    } else {
        await loadNearbyUsers()
    }
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

function updateLocationStatus(active) {
    const el = document.getElementById('location-status')
    if (active) {
        el.innerHTML = '<div class="status-dot"></div><span>Live location চলছে</span>'
        el.style.color = '#1a8a5a'
    } else {
        el.innerHTML = '<span>📍 Location off</span>'
        el.style.color = '#888'
    }
}

async function handleLogout() {
    if (watchId) navigator.geolocation.clearWatch(watchId)
    if (realtimeChannel) supabaseClient.removeChannel(realtimeChannel)
    await supabaseClient
        .from('live_locations')
        .update({ is_active: false })
        .eq('user_id', currentUser.id)
    await supabaseClient.auth.signOut()
    window.location.href = 'index.html'
}

function toggleMenu() {
    document.querySelector('.nav-links').classList.toggle('open')
}

document.addEventListener('DOMContentLoaded', () => {
    checkAuth()
})
