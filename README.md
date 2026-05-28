# 🌐 NexaLink — Premium Secure Real-Time Communications Platform

NexaLink is a state-of-the-art, secure real-time communications application featuring peer-to-peer WebRTC video/audio streaming, collaborative drawing canvases, persistent chat lobbies, Picture-in-Picture (PiP) multitasking, voice-morphing DSP pipelines, and offline-capable Web Push notifications.

Designed with a high-fidelity glassmorphic visual aesthetic and a robust distributed cloud architecture, NexaLink bridges Vite + React, FastAPI, Node.js Socket.IO, and Supabase into a singular secure collaboration space.

---

## 🗺️ Live Cloud Environments

The production infrastructure is distributed across highly optimized cloud providers:

| Component | Technology | Hosting Platform | Production URL |
| :--- | :--- | :--- | :--- |
| **Web Client** | React 18 + Vite + CSS3 | **Vercel** | [my-call-app-pi.vercel.app](https://my-call-app-pi.vercel.app) |
| **REST API Server** | FastAPI + SQLAlchemy | **Render** | [nexalink-backend-xjx6.onrender.com](https://nexalink-backend-xjx6.onrender.com) |
| **Signalling plane** | Node.js + Socket.IO | **Render** | [nexalink-signalling.onrender.com](https://nexalink-signalling.onrender.com) |
| **Database & Auth** | PostgreSQL + RLS | **Supabase** | `uejwhikwtjikrsbnaabo.supabase.co` |

---

## ✨ Key Premium Features

*   **🎬 WebRTC Grid & Layout Controls:** Adaptive video/audio layout grid supporting visual HTML5 drag-and-drop tile swapping, multi-axis adjustments, dynamic track hide/unhide toggling, and reliable cleanups upon screen-sharing termination.
*   **🎨 Interactive Collaborative Whiteboard:** Draw, write, and collaborate in real-time. Includes custom premium golden color brushes, local history stacks (Undo/Redo), cloud-saving snapshots directly to Supabase storage, and **collaborative image annotations** (upload local base64 files or paste online image URLs, adjust width/height, draw over images).
*   **🎤 DSP Voice Morphing & Filters:** Real-time audio pitch shifting/morphing, Whisper filters to amplify sub-ambient sounds, and auto-transcription for capturing logs during mute.
*   **🤖 Synthetic Voice (TTS):** Integrated Text-to-Speech client with male/female host profiles and custom voice cloning pipelines.
*   **📱 PWA & Web Push Notification Plane:** Progressive Web App shell backing offline caching capabilities. Intercepts incoming requests and rings background OS-level notifications (Web Push) with active "Accept/Decline" actions even when the browser tab is completely closed.
*   **🖼️ Floating Picture-in-Picture (PiP):** Manual and automatic picture-in-picture stream representations showing active calls in floating panels when minimized or navigating away.

---

## 🏗️ System Architecture

The following diagram illustrates NexaLink's real-time signalling, WebRTC P2P streaming, and secure metadata synchronization planes:

```mermaid
graph TD
    subgraph Client ["Client Tier (Vite + React PWA)"]
        UI["React Web App (App.tsx)"]
        SW["Service Worker (sw.js)"]
        RTC["WebRTC Engine (useWebRTC)"]
        WB["Whiteboard Canvas (Whiteboard.tsx)"]
    end

    subgraph Signalling ["Real-Time Signalling (Render)"]
        SIO["Socket.IO Server (server.js)"]
    end

    subgraph Backend ["REST API Server (Render)"]
        API["FastAPI App (main.py)"]
        DBW["Supabase REST Wrapper (supabase_api.py)"]
        ORM["SQLAlchemy ORM (models.py)"]
    end

    subgraph Cloud ["Database & Storage Tier (Supabase)"]
        PG["PostgreSQL DB (RLS Enabled)"]
        ST["Cloud Storage (whiteboard_saves)"]
        AUTH["Supabase Auth"]
    end

    %% WebRTC Connections
    RTC <-->|Signalling Handshakes| SIO
    RTC <-->|P2P Media Streams| Peer["Remote Peer"]

    %% Socket sync
    WB <-->|Drawing/Image sync| SIO

    %% REST APIs
    UI -->|JWT Auth & Profiles| API
    WB -->|Whiteboard Snapshots| API

    %% Database operations
    API -->|PostgREST REST queries| DBW
    API -->|SQL pooling (NullPool)| ORM
    DBW -->|Tables| PG
    ORM -->|Tables| PG
    UI -->|Cloud Uploads| ST
    UI -->|Sign-up Trigger| AUTH
```

---

## 📂 Project Repository Map

```
my-call-app/
├── client/           # Vite + React Frontend Web Client
│   ├── src/
│   │   ├── App.tsx             # Core layout grid, WebRTC state router, and PWA setup
│   │   ├── index.css           # Global custom tokens, styles, scroll rules, and overrides
│   │   └── components/
│   │       └── Whiteboard.tsx  # Dynamic whiteboard drawing canvas & annotation engine
│   └── public/
│       └── sw.js               # Service Worker handling Web Push and offline asset caches
├── server/           # FastAPI Python Backend REST API
│   ├── main.py                 # Endpoint routes, auth tokens, and CORS permissions
│   ├── db/
│   │   ├── supabase_api.py     # Database wrapper executing PostgREST API queries
│   │   ├── models.py           # SQLAlchemy database model definitions
│   │   └── session.py          # Database session pooling configuration
│   └── db_optimize.py          # PostgreSQL schema migration & index optimizer script
├── signalling/       # WebRTC Node.js Signalling Server
│   └── server.js               # Express, Socket.IO messaging events, and Web Push routers
└── infra/            # Shared infrastructure configurations
    └── migrations/
        └── supabase_schema.sql # PostgreSQL database tables, functions, and RLS rules
```

---

## 💾 Supabase Database Schema

All database tables incorporate strict **Row-Level Security (RLS)**. Active tables include:

1.  **`public.user_profiles`** — Linked to Supabase Auth (`id UUID`, `username VARCHAR(50)`, `email VARCHAR(100)`, `bio TEXT`, `profile_pic TEXT`).
2.  **`public.rooms`** — Live room session details and occupancy.
3.  **`public.call_logs`** — Historically tracks room joins, leaves, and durations.
4.  **`public.direct_messages`** — Persistent 1-on-1 contact chat history.
5.  **`public.direct_call_logs`** — Tracks secure direct call details.
6.  **`public.recording_consents`** — Audit trail verifying recording consents.
7.  **`public.whiteboard_saves`** — Tracks URLs and metadata of whiteboard drawings.

*Performance Optimization:* Heavy indexes are dynamically maintained on search/join fields like `call_logs(username, room_id)`, `direct_messages(conversation_key, sent_at DESC)`, and `whiteboard_saves(room_name)`.

---

## 🛠️ Local Development Setup

To run the entire NexaLink stack locally on your machine:

### 1. Prerequisite Environments
Create and populate `.env` files in their respective folders:

*   **`/server/.env`**:
    ```env
    SUPABASE_URL=https://your-project.supabase.co
    SUPABASE_ANON_KEY=your-anon-key
    DATABASE_URL=postgresql://postgres.your-project:...:6543/postgres
    JWT_SECRET_KEY=your-jwt-signing-secret
    ENV=development
    CORS_ORIGINS=http://localhost:5173
    ```
*   **`/signalling/.env`**:
    ```env
    PORT=8000
    SUPABASE_URL=https://your-project.supabase.co
    SUPABASE_ANON_KEY=your-anon-key
    ALLOWED_ORIGIN=http://localhost:5173
    VAPID_PUBLIC_KEY=your-vapid-public-key
    VAPID_PRIVATE_KEY=your-vapid-private-key
    VAPID_EMAIL=mailto:admin@your-domain.app
    ```
*   **`/client/.env`**:
    ```env
    VITE_API_URL=http://localhost:8001
    VITE_WS_URL=http://localhost:8000
    ```

### 2. Running the Backend Server
```bash
cd server
python -m venv venv
# Windows:
venv\Scripts\activate
# macOS/Linux:
source venv/bin/activate

pip install -r requirements.txt
uvicorn main:app --host 127.0.0.1 --port 8001 --reload
```

### 3. Running the Signalling Server
```bash
cd signalling
npm install
npm run dev # or node server.js
```

### 4. Running the React Web Client
```bash
cd client
npm install
npm run dev
```
Open `http://localhost:5173` in your browser.

---

## 📋 Security & Development Guidelines

Developers contributing to NexaLink must adhere to the following core constraints:

1.  **Security and Filter Injection Prevention:** All database queries and filters executed via the PostgREST wrapper must be URL-encoded using `urllib.parse.quote()` before request submission.
2.  **No `localStorage` Usage:** Under no circumstances should session tokens, user data, or sensitive contact lists be written to `localStorage`. Use in-memory React states, tab-scoped `sessionStorage`, or secure backend session endpoints.
3.  **Database Connection Safety:** Ensure all client SQLAlchemy connections bypass transaction poolers (such as PgBouncer) using `sqlalchemy.pool.NullPool` to prevent connection leaks.
4.  **Verification Before Pushing:**
    Before making commits or submitting pull requests, you must execute the three-phase quality check locally:
    *   **Optimize & Verify DB Indexes:** `python server/db_optimize.py`
    *   **TypeScript Compile Validation:** `cd client && npx tsc --noEmit`
    *   **Vite Production Compilation:** `cd client && npm run build`

---

*Developed and maintained with absolute attention to detail, secure engineering, and premium UX standards.*
