// api/player-handler.js
import { createClient } from '@supabase/supabase-js';

// Use the SERVICE ROLE key to bypass RLS for the Player
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
    // Enable CORS so the player can call this
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    if (req.method === 'OPTIONS') return res.status(200).end();

    const { code, deviceId } = req.query;

    try {
        // 1. If Pairing (Code provided, no ID yet)
        if (code && !deviceId) {
            const { data, error } = await supabase
                .from('devices')
                .select('id, code')
                .eq('code', code.toUpperCase())
                .single();
            
            if (error || !data) return res.status(404).json({ error: 'Invalid Code' });
            return res.status(200).json(data);
        }

        // 2. If Playing (Heartbeat + Fetch Data)
        if (deviceId) {
            // A. Update Heartbeat
            await supabase.from('devices')
                .update({ status: 'online', last_seen: new Date() })
                .eq('id', deviceId);

            // B. Fetch Device & Commands
            const { data: device } = await supabase
                .from('devices')
                .select('id, playlist_id, refresh_requested, screenshot_requested')
                .eq('id', deviceId)
                .single();

            if (!device) return res.status(404).json({ error: 'Device not found' });

            // C. Determine Active Playlist (Default vs Scheduled)
            let activeId = device.playlist_id;
            const now = new Date();
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

            // D. Fetch Playlist Items & Media
            if (!activeId) return res.status(200).json({ device, playlist: [] });

            const { data: pl } = await supabase.from('playlists').select('items').eq('id', activeId).single();
            if (!pl || !pl.items.length) return res.status(200).json({ device, playlist: [] });

            const ids = pl.items.map(i => i.id);
            const { data: media } = await supabase.from('media').select('id, url, type').in('id', ids);

            // Merge Duration & Media Info
            const playlist = pl.items.map(i => {
                const f = media.find(m => m.id === i.id);
                return f ? { ...f, duration: i.duration } : null;
            }).filter(Boolean);

            return res.status(200).json({ device, playlist });
        }

    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}
