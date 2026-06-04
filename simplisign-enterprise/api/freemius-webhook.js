import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

// Initialize Supabase with the SERVICE ROLE KEY so it can bypass RLS to upgrade users
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
    // Webhooks are always POST requests
    if (req.method !== 'POST') {
        return res.status(405).send('Method Not Allowed');
    }

    try {
        // Verify Freemius Webhook Signature to prevent unauthorized upgrades
        const signature = req.headers['x-freemius-signature'];
        const secret = process.env.FREEMIUS_SECRET_KEY;

// Fail immediately if either is missing
if (!secret || !signature) {
    return res.status(401).send('Webhook not configured or missing signature');
}

const hash = crypto.createHmac('sha256', secret).update(JSON.stringify(req.body)).digest('hex');
if (hash !== signature) return res.status(401).send('Unauthorized Webhook');


        const payload = req.body;
        
        // Freemius payloads typically contain the event type and user data
        const eventType = payload.type;
        
        // Safely extract the user's email and the plan they purchased
        const userEmail = payload.user?.email || payload.data?.user?.email;
        const planId = payload.plan_id || payload.data?.plan_id;

        if (!userEmail) {
            console.log("Ignored: No email found in payload.");
            return res.status(200).send('Ignored');
        }

        // Determine the Subscription Tier based on your Freemius Plan IDs
        let targetTier = 'free';
        if (planId == 49968) targetTier = 'standard';
        if (planId == 50087) targetTier = 'pro';

        // Process the Event
        if (eventType.includes('install.upgraded') || eventType.includes('payment.created') || eventType.includes('license.activated')) {
            // UPGRADE USER
            await supabase.from('profiles').update({ subscription_tier: targetTier }).eq('email', userEmail);
            console.log(`Upgraded ${userEmail} to ${targetTier}`);
            
        } else if (eventType.includes('subscription.cancelled') || eventType.includes('subscription.expired')) {
            // DOWNGRADE USER
            await supabase.from('profiles').update({ subscription_tier: 'free' }).eq('email', userEmail);
            console.log(`Downgraded ${userEmail} to free`);
        }

        // Always return 200 OK so Freemius knows you received the message
        return res.status(200).json({ success: true });

    } catch (error) {
        console.error('Webhook processing failed:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
}
