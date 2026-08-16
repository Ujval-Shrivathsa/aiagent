# Platform Updates & AI Logic Enhancements

## Core Features Implemented

### 1. Interest Tracking (Outbound Calls)
- **Automatic Detection**: The AI now monitors the customer's *first response* to the initial greeting ("Hello, I am Priya...").
- **Real-time Persistence**: These updates are immediately saved to the database during the call.

### 2. Live Call Transcription
- **Real-time Updates**: As the conversation progresses, both AI and customer turns are transcribed and stored in the `Lead` model.
- **Visual Feedback**: The dashboard now features a "Live Transcribed" status for active calls.

### 3. Call Recording Integration
- **Twilio Recording**: All outbound calls are now automatically recorded.
- **Secure Storage**: Recording URLs are captured via a dedicated callback route (`/api/voice/recording`) and stored in the database.
- **Direct Playback**: Recordings can be played back directly from the Lead Details modal in the portal.

### 4. Advanced Portal Design (Sirrus- **Advanced Portal Design (Sirrus-inspired)**:
  - **Modern UI/UX**:
    - **Glassmorphism**: High-end translucent backgrounds and blurred elements.
    - **Animated States**: Extensive use of `framer-motion` for smooth transitions, hover effects, and staggered load-in animations for a dynamic feel.
    - **Live Interest Stream**: A dedicated sidebar showing the most recent leads who expressed interest.
    - **Detailed Modal View**: Comprehensive view of call summaries, recordings, and AI-generated sentiments.
  - **Enhanced Navigation**: Simplified to essential "Overview" and "Interested Leads" tabs.
  - **Refined Components**: Improved typography, spacing, and color contrast across tables, status badges, and buttons for a polished, modern aesthetic.

## Database Schema Changes (Prisma)
- Added `transcription` (String?) to store the conversation history.
- Added `recordingUrl` (String?) to link the call recording.
- Added `lastResponse` (String?) to capture the initial interest trigger.
- Expanded `status` to include `not - interested`, `follow up`, and `scheduled visit`.

## Core Features Summary (What Should Be There)

- **Interest Detection**: Automatic tracking of customer interest during the first response of outbound calls.
- **Short Call Summary**: Real-time summary of the call (AI & User) instead of full transcription.
- **Call Recording**: Automatic recording of all outbound calls with direct playback in the lead modal.
- **Interested Leads Section**: A dedicated tab and sidebar stream for high-priority "Hot Leads".
- **SQLite Concurrency & Timeout Fixes**:
  - Increased SQLite `busy_timeout` to 15,000ms (15 seconds) in `schema.prisma` to prevent "database is locked" errors during high-frequency dashboard polling.
  - Implemented robust **Retry Loops** (up to 5 attempts) for all lead-related API operations (GET, POST, PATCH, DELETE, and CSV Upload) to handle database locks gracefully.
  - Standardized the use of a **Singleton Prisma Client** across the entire application to minimize active database connections.
  - **Dashboard Optimization**: Combined multiple polling requests into a single unified API call and reduced the polling frequency to 15 seconds to further decrease database contention.
- **Professional Groq Intelligence Reports**:
  - The AI uses the **Groq API (Llama 3.3 70B)** to generate high-quality, professional summaries (2-3 sentences) of the conversation's actual outcome.
  - Live summary updates during the call have been disabled to keep the dashboard clean and focused on the final outcome.
  - The detail modal now separates technical info (call duration, turns) from the intelligence summary for better readability.
- **Enhanced Meeting Calendar**:
  - Days with scheduled appointments are now prominently highlighted with a gold ring, shadow, and pulse animation for maximum visibility.
  - Clicking on a highlighted day opens a modal showing a detailed list of all appointments for that specific day, including customer names, phone numbers, and timings.
- **Simplified Confirmed Leads Tab**:
  - The tab has been renamed from "Interested Leads" to "Confirmed Leads" to keep the interface focused on the lead's current status.
  - The "Interest" column has been removed.
- **Removal of Sentiment Tracking**: Sentiment analysis has been removed from the portal and backend logic across both root and SaaS platform projects.
- **Faster AI Response Latency**:
  - Reduced `silenceDurationMs` from 350ms to 200ms for ultra-fast turn detection.
  - Optimized the greeting delay from 500ms to 100ms for a more immediate start.
- **Multilingual Language Detection**:
  - Added a critical language rule to the system instructions.
  - The agent now automatically detects and switches to the user's language (Hindi, Kannada, Telugu, Tamil, etc.) immediately without asking.
- **Improved Portal UI**: Continuous refinements to the dashboard for a more premium, Awwwards-inspired aesthetic.
 - **Bulk Delete**: Ability to select and delete multiple leads at once.
- **Unnamed Outbound Flow**: If a customer says "Yes" on an unnamed call, the AI agent will politely ask for their name before proceeding.
- **Simplified Navigation**: Extra pages (leads, campaigns, settings) have been removed, leaving only the essential Overview and Confirmed Leads tabs.
- **Mobile Responsive**: Fully functional across desktop and mobile devices.

## Best Practices & Constraints (What NOT To Do)

- **[STRICT CONSTRAINT] Generic Names**: NEVER use "Customer", "Contact", or "Lead" in AI greetings. If a name is missing, the agent uses the unnamed flow automatically.
- **No Sentiment Tracking**: DO NOT add sentiment analysis back; it has been explicitly removed.
- **No Live Summary Updates**: DO NOT update the `summary` field in the database during the call with turn-by-turn metadata. Wait until the call ends to save the final professional summary.
- **No Repetitive Greetings**: DO NOT repeat the greeting if the user has already started speaking.
- **No Google Calendar**: The agent does NOT schedule meetings in Google Calendar. All "scheduled" meetings are tracked internally in the portal's calendar widget.
- **Functionality Stability**: DO NOT change the existing conversation flow of Priya (Alliance Square plot sales) unless explicitly requested. The new features (tracking, recording) are layered on top.
- **Data Persistence**: NEVER skip updating the database for call status or summaries. These are essential for the "Live Stream" feature in the dashboard.
- **Tool Usage**: ALWAYS call the `endCall` tool immediately if a customer says "No" or shows no interest to save costs and respect their time.
- **Language Consistency**: NEVER respond in English if the user has switched to another language. Stick to the user's preferred language.
- **SQLite Concurrency**: Avoid high-frequency database writes (under 500ms) to prevent SQLite from locking up. Always use the retry logic implemented in the API routes.
- **Singleton Prisma**: Never instantiate `new PrismaClient()` outside of `@/lib/prisma`. Always import the shared instance to keep connection counts low.

## How to Run the Platform

### 1. Prerequisites
- **Node.js**: v18+ recommended.
- **SQLite**: Local database (automatically created via Prisma).
- **Twilio Account**: Required for making calls and recording.
- **Google Gemini API Key**: Required for the AI voice agent.
- **ngrok**: Required to expose the local server for Twilio callbacks.

### 2. Environment Setup
Create a `.env` file in the `saas-platform` directory:
```env
GEMINI_API_KEY="your_gemini_key"
GROQ_API_KEY="your_groq_key"

# VOICE PROVIDER: Choose either "plivo" or "twilio"
VOICE_PROVIDER=plivo

# --- If using Plivo (RECOMMENDED) ---
PLIVO_AUTH_ID=your_plivo_auth_id_here
PLIVO_AUTH_TOKEN=your_plivo_auth_token_here
PLIVO_PHONE_NUMBER=+91xxxxxxxxxx

# --- If using Twilio ---
TWILIO_ACCOUNT_SID="your_sid"
TWILIO_AUTH_TOKEN="your_token"
TWILIO_PHONE_NUMBER="your_twilio_number"

APP_URL="https://your-ngrok-url.ngrok-free.app"
```

### 2.5 Configuring Your Plivo Number (Step-by-Step)

1. **Get your Plivo credentials**: Log into https://manage.plivo.com/
   - Copy your **Auth ID** (starts with `MA...`) and **Auth Token**
   - Buy or use your purchased **Plivo Phone Number** (copy it in +91... format)

2. **Create a Voice Application in Plivo**:
   - Go to: **Voice > Applications > Create New Application**
   - Application Name: `Priya AI Voice App`
   - **Answer URL** = `https://YOUR_NGROK_URL/api/plivo/answer` (Method: POST)
   - **Hangup URL** = `https://YOUR_NGROK_URL/api/plivo/status` (Method: POST)
   - Save the application

3. **Link the purchased number to the app**:
   - Go to **Phone Numbers** → Click your number
   - Under "Voice Application", select "Priya AI Voice App"
   - Save changes

4. **Your .env should match**:
   ```
   VOICE_PROVIDER=plivo
   PLIVO_AUTH_ID=MAxxxxxxxxxxxxxxxxxx
   PLIVO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxx
   PLIVO_PHONE_NUMBER=+919876543210
   ```
   That's it. Campaigns will use Plivo automatically.

### 3. Installation & Database
```bash
# Navigate to the saas-platform directory
cd saas-platform

# Install dependencies
npm install

# Initialize database and apply migrations
npx prisma migrate dev --name init
```

### 4. Launching the Platform
You can run the platform from either the root directory or the `saas-platform` directory:

**From the Root:**
```bash
npm run dev:all
```

**From the saas-platform directory:**
```bash
cd saas-platform
npm run dev:all
```


### 5. Deployment Notes
- The `APP_URL` must be updated every time you restart ngrok.
- Ensure the `VOICE_SERVER_URL` in your environment matches your `APP_URL` if they are the same server.
- Twilio callbacks for status and recording will point to `${APP_URL}/api/voice/status` and `${APP_URL}/api/voice/recording`.

