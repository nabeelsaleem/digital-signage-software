import { createClient } from '@supabase/supabase-js';

// Initialize Supabase
// NOTE: Ensure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set in your .env or Vercel Dashboard!
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Prevent crash if env vars are missing during local testing
const supabase = supabaseUrl && supabaseKey 
    ? createClient(supabaseUrl, supabaseKey) 
    : null;

export default async function handler(req, res) {
    // 1. Enable CORS
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (!supabase) {
        return res.status(500).json({ error: "Server configuration error: Missing database keys." });
    }

    // 1. Read the Timezone from the request (Default to UTC if missing)
    let { code, deviceId, timezone } = req.query;
    
    // Safety check for timezone
    if (!timezone || timezone === 'undefined') timezone = 'UTC';

    // --- SAFETY FIX: Prevent "null" string crash ---
    if (deviceId === 'null' || deviceId === 'undefined') {
        deviceId = null;
    }

    try {
        // --- SCENARIO A: MISSING PARAMETERS ---
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
                // If error is "PGRST116", it means no rows found (404 effectively)
                // If generic error, log it
                console.error("Pairing DB Error:", error);
                return res.status(404).json({ error: 'Invalid Pairing Code' });
            }
            return res.status(200).json(data);
        }

        // --- SCENARIO C: PLAYING (Heartbeat + Fetch Playlist) ---
        if (deviceId && code) {
            // 1. Update Heartbeat
            await supabase.from('devices')
                .update({ status: 'online', last_seen: new Date() })
                .eq('id', deviceId)
                .eq('code', code.toUpperCase()); // Security Check

            // 2. Fetch Device Data
                const { data: device, error: devErr } = await supabase
                .from('devices')
                .select('id, code, group_id, playlist_id, refresh_requested, screenshot_requested, unpair_requested')
                .eq('id', deviceId)
                .single();

            if (devErr) {
                console.error("Device fetch error:", devErr);
                return res.status(500).json({ error: 'Database error' });
            }

            if (!device) {
                return res.status(404).json({ error: 'Device not found' });
            }

            // SECURITY CHECK: Verify the code matches
            if (device.code !== code.toUpperCase()) {
                return res.status(403).json({ error: 'Unauthorized Access' });
            }

            // --- FIX: RESET REFRESH FLAG ---
            // We reset it in the DB, but keep it true in the response variable 
            // so the frontend JS knows to reload once.
            const shouldRefresh = device.refresh_requested;
            if (shouldRefresh) {
                await supabase.from('devices')
                    .update({ refresh_requested: false })
                    .eq('id', deviceId);
            }
            // Return modified device object to frontend
            const deviceResponse = { ...device, refresh_requested: shouldRefresh };

            // 3. Determine Active Playlist
            let activeId = device.playlist_id;
            
            // --- GLOBAL TIMEZONE LOGIC ---
            // Create a date object for the current time
            const utcDate = new Date();
            
            // Convert server time to the DEVICE'S Reported Timezone
            let localDateString;
            try {
                localDateString = utcDate.toLocaleString('en-US', { timeZone: timezone });
            } catch (e) {
                // Fallback if device sent garbage data
                console.error("Invalid timezone:", timezone);
                localDateString = utcDate.toLocaleString('en-US', { timeZone: 'UTC' });
            }
            
            const now = new Date(localDateString); 
            
            const timeStr = now.toTimeString().slice(0, 5); // "14:30" (In Device's Local Time)
            const year = now.getFullYear();
            const month = String(now.getMonth() + 1).padStart(2, '0');
            const day = String(now.getDate()).padStart(2, '0');
            const dateStr = `${year}-${month}-${day}`;
            const dayOfWeek = now.getDay(); // 0=Sun, 6=Sat
            
            // NEW LOGIC: Fetch schedules for this Device OR its Group
            let query = supabase.from('schedules').select('*');
            
            if (device.group_id) {
                // If device is in a group, get schedules for BOTH
                query = query.or(`device_id.eq.${deviceId},group_id.eq.${device.group_id}`);
            } else {
                // Otherwise just get device schedules
                query = query.eq('device_id', deviceId);
            }

            const { data: schedules } = await query;

            
            if (schedules && schedules.length > 0) {
                // 1. Filter for currently active schedules
                const activeSchedules = schedules.filter(s => {
                    // Date Range Check
                    if (s.start_date && dateStr < s.start_date) return false;
                    if (s.end_date && dateStr > s.end_date) return false;

                    // Day of Week Check
                    if (s.days_of_week && Array.isArray(s.days_of_week)) {
                        if (!s.days_of_week.includes(dayOfWeek)) return false;
                    }

                    // Time Match
                    const start = s.start_time.slice(0, 5);
                    const end = s.end_time.slice(0, 5);

                    if (start <= end) {
                        return timeStr >= start && timeStr <= end;
                    } else {
                        // Overnight (e.g. 23:00 to 02:00)
                        return timeStr >= start || timeStr <= end;
                    }
                });

                // 2. Sort by Priority > Specificity > Start Time
                if (activeSchedules.length > 0) {
                    activeSchedules.sort((a, b) => {
                        // Priority (Higher wins)
                        const pA = a.priority || 1;
                        const pB = b.priority || 1;
                        if (pA !== pB) return pB - pA;

                        // Specificity (Device > Group)
                        const specA = a.device_id ? 1 : 0;
                        const specB = b.device_id ? 1 : 0;
                        if (specA !== specB) return specB - specA;

                        // Start Time (Latest wins)
                        return b.start_time.localeCompare(a.start_time);
                    });
                    
                    activeId = activeSchedules[0].playlist_id;
                }
            }

            // 4. Fetch Media Items
            if (!activeId) {
                return res.status(200).json({ device: deviceResponse, playlist: [] });
            }

            const { data: pl } = await supabase.from('playlists').select('items').eq('id', activeId).single();
            
            if (!pl || !pl.items || !pl.items.length) {
                return res.status(200).json({ device: deviceResponse, playlist: [] });
            }

            // 5. Get URLs and Types for items
            const ids = pl.items.map(i => i.id);
            const { data: media } = await supabase.from('media').select('id, url, type').in('id', ids);

            const playlist = pl.items.map(i => {
                const f = media ? media.find(m => m.id === i.id) : null;
                return f ? { ...f, duration: i.duration } : null;
            }).filter(Boolean);

            return res.status(200).json({ device: deviceResponse, playlist });
        }

    } catch (error) {
        console.error("Unhandled API Error:", error);
        return res.status(500).json({ error: error.message });
    }
}
