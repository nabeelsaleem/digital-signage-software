import { createClient } from '@supabase/supabase-js';

// Initialize Supabase
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
    // 1. Enable CORS (Critical for the Player to talk to this API)
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    
    // Handle "Preflight" check from browser
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const { code, deviceId } = req.query;

    try {
        // --- SCENARIO A: MISSING PARAMETERS (The cause of your Timeout) ---
        if (!code && !deviceId) {
            return res.status(400).json({ 
                error: "Missing parameters. Provide '?code=X' or '?deviceId=Y'" 
            });
        }

        // --- SCENARIO B: PAIRING (User entered a code) ---
        if (code && !deviceId) {
            const { data, error } = await supabase
                .from('devices')
                .select('id, code')
                .eq('code', code.toUpperCase())
                .single();
            
            if (error || !data) {
                return res.status(404).json({ error: 'Invalid Pairing Code' });
            }
            return res.status(200).json(data);
        }

        // --- SCENARIO C: PLAYING (Heartbeat + Fetch Playlist) ---
        if (deviceId) {
            // 1. Update Heartbeat
            await supabase.from('devices')
                .update({ status: 'online', last_seen: new Date() })
                .eq('id', deviceId);

            // 2. Fetch Device Data
            const { data: device, error: devErr } = await supabase
                .from('devices')
                .select('id, playlist_id, refresh_requested, screenshot_requested')
                .eq('id', deviceId)
                .single();

            if (devErr || !device) {
                return res.status(404).json({ error: 'Device not found' });
            }

            // 3. Determine Active Playlist
            let activeId = device.playlist_id;
            const now = new Date();
            // Get HH:MM format (e.g., "14:30")
            const timeStr = now.toTimeString().slice(0, 5);
            
            const { data: schedules } = await supabase
                .from('schedules')
                .select('*')
                .eq('device_id', deviceId);

            if (schedules && schedules.length > 0) {
                const match = schedules.find(s => {
                    const start = s.start_time.slice(0, 5);
                    const end = s.end_time.slice(0, 5);
                    return timeStr >= start && timeStr <= end;
                });
                if (match) activeId = match.playlist_id;
            }

            // 4. Fetch Media Items
            if (!activeId) {
                return res.status(200).json({ device, playlist: [] });
            }

            const { data: pl } = await supabase.from('playlists').select('items').eq('id', activeId).single();
            
            // Handle empty playlist
            if (!pl || !pl.items || !pl.items.length) {
                return res.status(200).json({ device, playlist: [] });
            }

            // 5. Get URLs and Types for items
            const ids = pl.items.map(i => i.id);
            const { data: media } = await supabase.from('media').select('id, url, type').in('id', ids);

            // Merge details
            const playlist = pl.items.map(i => {
                const f = media ? media.find(m => m.id === i.id) : null;
                return f ? { ...f, duration: i.duration } : null;
            }).filter(Boolean);

            return res.status(200).json({ device, playlist });
        }

    } catch (error) {
        console.error("API Error:", error);
        return res.status(500).json({ error: error.message });
    }
}
