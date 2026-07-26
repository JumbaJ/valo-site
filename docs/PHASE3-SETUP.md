# Phase 3 setup — do these 5 things, then tell Claude "phase 3 ready"

1. Create the project: supabase.com → New project (free tier). Name: valo. Pick a
   strong database password (save it in a password manager — you rarely need it).

2. Run the schema: Dashboard → SQL Editor → New query → paste ALL of
   supabase/schema.sql → Run. Should say "Success. No rows returned."

3. Turn on email auth: Dashboard → Authentication → Providers → Email → enable
   (magic link / OTP is fine to start).

4. Grab the two public values: Dashboard → Settings → API →
   - Project URL   (looks like https://xxxx.supabase.co)
   - anon public key (long string — this one is DESIGNED to be public; RLS is the security)

5. Put them in Vercel: project → Settings → Environment Variables → add BOTH to
   Production AND Preview:
   - VITE_SUPABASE_URL   = the project URL
   - VITE_SUPABASE_ANON  = the anon key
   Also run locally in the repo:  npm install @supabase/supabase-js

Never share the service_role key with anyone or anything — Claude included.
The anon key + URL are fine to exist in the frontend.
