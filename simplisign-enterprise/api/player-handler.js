import { createClient } from '@supabase/supabase-js';

// Initialize Supabase safely
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

const supabase = (supabaseUrl && supabaseKey) 
    ? createClient(supabaseUrl, supabaseKey) 
    : null;

export default async function handler(req, res) {
    // 1. Enable CORS
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (!supabase) {
        return res.status(500).json({ error: "Server configuration error." });
    }

    const { code, deviceId } = req.query;

    try {
        // --- SCENARIO A: MISSING PARAMETERS ---
        if (!code && !deviceId) {
            return res.status(400).json({ error: "Missing parameters." });
        }

        // --- SCENARIO B: PAIRING ---
        if (code && !deviceId) {
            const { data, error } = await supabase
                .from('devices')
                .select('id, code')
                .eq('code', code.toUpperCase())
                .single();
            
            if (error || !data) {
                return res.status(404).json({ error: 'Invalid Pairing Code' });
            }

            // Return public keys for the frontend
            return res.status(200).json({
                ...data,
                supabaseUrl: process.env.SUPABASE_URL,
                supabaseKey: process.env.SUPABASE_ANON_KEY
            });            
        }

        // --- SCENARIO C: PLAYING ---
        if (deviceId) {
            // 1. Update Heartbeat
            await supabase.from('devices')
                .update({ status: 'online', last_seen: new Date() })
                .eq('id', deviceId);

            // 2. Fetch Device Data
            const { data: device, error: devErr } = await supabase
                .from('devices')
                .select('id, playlist_id, refresh_requested, screenshot_requested, unpair_requested')
                .eq('id', deviceId)
                .single();

            if (devErr || !device) {
                return res.status(404).json({ error: 'Device not found' });
            }

            // Reset refresh flag if true
            if (device.refresh_requested) {
                await supabase.from('devices').update({ refresh_requested: false }).eq('id', deviceId);
            }

            // 3. Determine Active Playlist (Schedule Logic)
            let activeId = device.playlist_id;
            const now = new Date();
            const timeStr = now.toTimeString().slice(0, 5); // "14:30"
            
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

            // 4. Fetch Items
            if (!activeId) {
                return res.status(200).json({ device, playlist: [] });
            }

            const { data: pl } = await supabase.from('playlists').select('items').eq('id', activeId).single();
            
            if (!pl || !pl.items || !pl.items.length) {
                return res.status(200).json({ device, playlist: [] });
            }

            // 5. Join with Media Table
            const ids = pl.items.map(i => i.id);
            const { data: media } = await supabase.from('media').select('id, url, type').in('id', ids);

            const playlist = pl.items.map(i => {
                const f = media ? media.find(m => m.id === i.id) : null;
                return f ? { ...f, duration: i.duration || 10 } : null;
            }).filter(Boolean);

            return res.status(200).json({ device, playlist });
        }

    } catch (error) {
        console.error("API Error:", error);
        return res.status(500).json({ error: error.message });
    }
}
