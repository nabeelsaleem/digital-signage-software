import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (!supabase) return res.status(500).json({ error: "Server config error" });

    let { code, deviceId, timezone } = req.query;
    if (!timezone || timezone === 'undefined') timezone = 'UTC';
    if (deviceId === 'null' || deviceId === 'undefined') deviceId = null;

    try {
        // --- A. PAIRING ---
        if (code && !deviceId) {
            const { data, error } = await supabase.from('devices').select('id, code').eq('code', code.toUpperCase()).single();
            if (error || !data) return res.status(404).json({ error: 'Invalid Pairing Code' });
            return res.status(200).json(data);
        }

        // --- B. PLAYBACK UPDATE ---
        if (deviceId && code) {
            // 1. Heartbeat
            await supabase.from('devices').update({ status: 'online', last_seen: new Date() }).eq('id', deviceId);

            // 2. Fetch Device (ADDED layout_id HERE)
            const { data: device, error: devErr } = await supabase
                .from('devices')
                .select('id, code, group_id, playlist_id, layout_id, refresh_requested, screenshot_requested, unpair_requested, logo_url, logo_position, ticker_active, ticker_text, ticker_position, ticker_bg, ticker_color, ticker_speed')
                .eq('id', deviceId)
                .single();

            if (devErr || !device) return res.status(404).json({ error: 'Device not found' });
            if (device.code !== code.toUpperCase()) return res.status(403).json({ error: 'Unauthorized' });

            // Reset refresh flag if needed
            if (device.refresh_requested) {
                await supabase.from('devices').update({ refresh_requested: false }).eq('id', deviceId);
            }

            // --- 3. LAYOUT LOGIC (New PRO Feature) ---
            if (device.layout_id) {
                // Fetch the Layout details
                const { data: layout } = await supabase.from('layouts').select('*').eq('id', device.layout_id).single();
                
                if (layout && layout.zones) {
                    // We need to fetch the playlist items for EACH zone
                    const populatedZones = await Promise.all(layout.zones.map(async (zone) => {
                        if (!zone.playlist_id) return { ...zone, playlist_items: [] };

                        // Fetch Playlist Items
                        const { data: pl } = await supabase.from('playlists').select('items').eq('id', zone.playlist_id).single();
                        if (!pl || !pl.items || !pl.items.length) return { ...zone, playlist_items: [] };

                        // Fetch actual Media Files
                        const ids = pl.items.map(i => i.id);
                        const { data: media } = await supabase.from('media').select('id, url, type, metadata').in('id', ids);

                        // Merge duration with media info
                        const items = pl.items.map(i => {
                            const f = media ? media.find(m => m.id === i.id) : null;
                            return f ? { ...f, duration: i.duration } : null;
                        }).filter(Boolean);

                        return { ...zone, playlist_items: items };
                    }));

                    // Return Layout Data!
                    return res.status(200).json({ 
                        device, 
                        layout_data: { ...layout, zones: populatedZones } 
                    });
                }
            }

            // --- 4. STANDARD SINGLE PLAYLIST LOGIC (Fallback) ---
            
            // ... (Your existing scheduling logic mostly goes here) ...
            // Simplified for brevity: Use existing scheduling logic to find activeId
            
            let activeId = device.playlist_id;
            
            // (Insert your Schedule filtering logic here if you want schedules to override default playlists)
            // ... [Keep your existing schedule code block here] ...

            if (!activeId) return res.status(200).json({ device, playlist: [] });

            const { data: pl } = await supabase.from('playlists').select('items').eq('id', activeId).single();
            if (!pl || !pl.items) return res.status(200).json({ device, playlist: [] });

            const ids = pl.items.map(i => i.id);
            const { data: media } = await supabase.from('media').select('id, url, type, metadata').in('id', ids);
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