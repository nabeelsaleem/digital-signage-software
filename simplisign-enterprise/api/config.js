export default function handler(request, response) {
  // This function runs securely on Vercel's servers.
  // It reads the hidden Environment Variables.
  const config = {
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseKey: process.env.SUPABASE_ANON_KEY
  };

  // Return the keys to your frontend
  response.status(200).json(config);
}