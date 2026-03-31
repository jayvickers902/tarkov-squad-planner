# Tarkov Squad Planner

Real-time raid planning tool for Escape from Tarkov squads.
Built with React + Vite, Supabase (real-time multiplayer), and the tarkov.dev GraphQL API.

---

## Setup: Step by Step

### 1. Get the code onto your machine

Download or unzip this folder somewhere you'll remember, e.g. `C:\Projects\tarkov-squad-planner`.

Open a terminal in that folder:
- Windows: right-click the folder → "Open in Terminal" (or open PowerShell and `cd` to it)
- Mac: right-click the folder → "New Terminal at Folder"

### 2. Install dependencies

```bash
npm install
```

This downloads React, Vite, and the Supabase client into a `node_modules` folder. Takes about 30 seconds.

### 3. Set up Supabase (free — no credit card needed)

Supabase is the real-time database that lets your squad share party state across devices.

**a) Create a project**
- Go to https://supabase.com and sign in
- Click "New project"
- Give it a name (e.g. `tarkov-planner`), pick a region close to you, set a database password (save it somewhere)
- Wait ~2 minutes for it to provision

**b) Create the database table**
- In your Supabase dashboard, click "SQL Editor" in the left sidebar
- Click "New query"
- Open the file `supabase-schema.sql` from this folder, copy the entire contents, paste it in, and click "Run"
- You should see "Success. No rows returned."

**c) Get your API keys**
- In Supabase, go to Settings (gear icon) → API
- You need two values:
  - **Project URL** — looks like `https://abcdefgh.supabase.co`
  - **anon public key** — a long string starting with `eyJ...`

### 4. Create your .env file

In the project folder, create a file called `.env` (no extension, just `.env`).
Open it in any text editor and paste:

```
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
```

Replace the values with your actual URL and key from step 3c.

**Important:** Never share this file or commit it to Git. It's already in `.gitignore`.

### 5. Run it locally to test

```bash
npm run dev
```

Open http://localhost:5173 in your browser. You should see the Squad Planner lobby.
Test it: create a party in one tab, copy the code, open a new tab and join with the same code — you should see each other in real time.

### 6. Deploy to Vercel

**a) Push to GitHub first**
Vercel deploys from GitHub. If you don't have Git installed:
- Download from https://git-scm.com and install it
- Then in your project terminal:

```bash
git init
git add .
git commit -m "Initial commit"
```

- Go to https://github.com, create a new repository (call it `tarkov-squad-planner`)
- GitHub will show you two commands — run the ones under "push an existing repository":

```bash
git remote add origin https://github.com/YOUR_USERNAME/tarkov-squad-planner.git
git branch -M main
git push -u origin main
```

**b) Deploy on Vercel**
- Go to https://vercel.com and sign in with your GitHub account
- Click "Add New → Project"
- Find and select your `tarkov-squad-planner` repository
- Click "Import"
- **Before clicking Deploy**, open "Environment Variables" and add:
  - `VITE_SUPABASE_URL` → your Supabase project URL
  - `VITE_SUPABASE_ANON_KEY` → your Supabase anon key
- Click "Deploy"
- Wait ~1 minute. Vercel will give you a URL like `tarkov-squad-planner.vercel.app`

**c) Connect your own domain**
- In Vercel, go to your project → Settings → Domains
- Click "Add Domain" and type your domain (e.g. `tarkov.yourdomain.com`)
- Vercel will show you DNS records to add
- Log into wherever your domain is registered (e.g. Namecheap, GoDaddy, Cloudflare)
- Add the DNS records Vercel gives you (usually a CNAME record)
- Wait up to 10 minutes for DNS to propagate — then your site is live at your domain

### 7. Future updates

Any time you change the code, just:

```bash
git add .
git commit -m "describe what you changed"
git push
```

Vercel automatically redeploys within about 30 seconds.

---

## How the app works

- **Party codes** — 6-character codes stored in Supabase. Anyone with the code can join.
- **Real-time sync** — Supabase broadcasts database changes instantly to all connected players via WebSockets. No polling.
- **Quest data** — fetched live from https://api.tarkov.dev (community-maintained GraphQL API). Includes all quests, filtered to show only quests for the selected map plus map-agnostic quests.
- **Map images** — loaded from assets.tarkov.dev. The SVG terrain overlay is shown as fallback if the image fails.
- **Route optimization** — nearest-first algorithm from the selected spawn point through all active quest objective locations.

---

## Project structure

```
src/
  App.jsx           — root, wires everything together
  main.jsx          — React entry point
  index.css         — global styles
  supabase.js       — Supabase client
  useParty.js       — all party state + Supabase real-time logic
  useTarkov.js      — tarkov.dev API calls (maps + tasks)
  constants.js      — spawn zones, terrain data, map list
  components/
    Lobby.jsx       — create/join party screen
    Room.jsx        — main party view, map selector, tabs
    QuestSearch.jsx — autocomplete quest search
    TodoList.jsx    — merged party objective checklist
    MapOverlay.jsx  — SVG map with spawn markers + route
```
