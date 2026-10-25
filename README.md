# Vox — Real-Time AI Voice Agent

**Live demo:** https://voice-agent-nine-eta.vercel.app/  
**Source code:** https://github.com/pritish73/voice-agent

Vox is a browser-based, real-time AI voice agent built with Next.js, React, TypeScript, and the Google Gemini Live API. Talk to it naturally, see live transcriptions, and switch between a general assistant and a consultative sales agent.

> **Try it:** Open the live demo, allow microphone access, choose a mode, and select **Start conversation**. A working microphone and a supported browser are required.

## Features

- **Real-time voice conversations** powered by Gemini Live native audio.
- **Two conversation modes:** a general-purpose voice assistant and a consultative sales agent.
- **Live transcription:** displays recognized user speech and the model's response.
- **Streaming audio playback:** receives audio chunks and schedules playback through the Web Audio API.
- **Microphone activity visualization:** a live audio-level meter and voice activity state.
- **Product context:** provide information about a product or service for the sales agent to use.
- **Sales intelligence:** a lightweight rule-based lead score, buying-signal detection, and sales-stage indicator.
- **Conversation history:** stores recent conversation transcripts in the current browser using `localStorage`, with options to review or clear them.
- **Short-lived API token:** the long-lived Gemini API key stays on the server and is not embedded in browser code.

## Tech stack

| Layer | Technology |
|---|---|
| UI | Next.js 15, React 19, TypeScript |
| Voice AI | Google Gemini Live API via `@google/genai` |
| Audio input/output | Browser MediaDevices API and Web Audio API |
| Styling | CSS |
| Server endpoint | Next.js Route Handler |
| Deployment | Vercel |

## How it works

```text
Browser
  ├── Requests a short-lived token
  │       POST /api/realtime-token
  │                  |
  │                  v
  │         Next.js server route
  │                  |
  │           GEMINI_API_KEY
  │                  |
  │                  v
  │        Google Gemini token API
  │
  └── Uses the short-lived token with the Gemini Live SDK
          ├── Microphone audio captured by Web Audio API
          ├── Audio converted to PCM and streamed to Gemini
          ├── Audio response chunks played in the browser
          └── Input/output transcription displayed in the UI
```

### Audio and model configuration

- Live model configured in the app: `gemini-2.5-flash-native-audio-preview-12-2025`
- Input audio is sent as PCM at **16 kHz**.
- Output PCM audio is played at **24 kHz**.
- The configured prebuilt voice is **Aoede**.
- The frontend uses the `@google/genai` SDK's live connection callbacks to handle transcription, audio chunks, turn completion, interruptions, errors, and connection close events.

### Token security

The browser first calls `POST /api/realtime-token`. The Next.js server route reads `GEMINI_API_KEY` from the server environment and asks Google to create a short-lived token. The client uses that token to start its Gemini Live session.

**Never prefix the secret with `NEXT_PUBLIC_` or commit the real key to Git.** Keep it in `.env.local` locally and in Vercel's server-side environment variables for deployment.

## Run locally

### Requirements

- Node.js compatible with the project's Next.js version
- npm
- A Google Gemini API key with access to the configured Gemini Live model
- A browser with microphone access

### 1. Clone and install

```bash
git clone https://github.com/pritish73/voice-agent.git
cd voice-agent
npm install
```

### 2. Configure the API key

Create a file named `.env.local` in the project root:

```env
GEMINI_API_KEY=your_gemini_api_key_here
```

You can use `.env.example` as a reference. Do not commit `.env.local` or share your key.

### 3. Start the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), allow microphone access, and start a conversation.

### 4. Create a production build

```bash
npm run build
npm run start
```

## Deploy to Vercel

1. Import [the GitHub repository](https://github.com/pritish73/voice-agent) into Vercel.
2. In the project's **Settings → Environment Variables**, add `GEMINI_API_KEY` and set its value to your Gemini API key. Apply it to the deployment environments you use.
3. Deploy or redeploy the project so the environment variable is available to the server route.
4. Open the deployed URL and test microphone permission and a complete conversation.

Live deployment: **https://voice-agent-nine-eta.vercel.app/**

If the demo cannot connect, check that `GEMINI_API_KEY` is set correctly in Vercel, the deployment was redeployed after adding it, the API key has access to the configured model, and the browser has microphone permission.

## Sales scoring notes

The lead scoring logic in `lib/sales-engine.ts` is a **rule-based heuristic**, not a trained prediction model. It uses keyword patterns to update a score, record buying signals, and estimate a sales stage. Treat it as a demonstration feature rather than a validated measure of a real prospect's likelihood to buy.

The sales prompt is designed to encourage consultative, honest conversations. It instructs Vox not to fabricate testimonials, pricing, guarantees, or results, and to respect a prospect's refusal. Provide accurate product context before using the agent for real sales conversations.

## Privacy and limitations

- Conversation history is stored in the current browser's `localStorage`; it is not a server-side account or cross-device database.
- The browser needs microphone permission for voice input.
- The app sends audio to Google's Gemini Live service for processing.
- The current UI uses browser-side audio capture/playback and a preview model identifier; model availability and API behavior may change.
- Do not enter confidential or sensitive information into the demo.

## Possible future improvements

- Add stronger session lifecycle and reconnect handling.
- Move from heuristic lead scoring to configurable, evaluated sales analytics.
- Add authenticated accounts and optional encrypted server-side history.
- Add consent-aware export, analytics, and CRM integrations.
- Add automated tests for token creation, audio-session lifecycle, and history normalization.
- Add a user-facing error guide for browser permission, API access, and network issues.

## Project structure

```text
app/
  api/
    realtime-token/
      route.ts       # Creates a short-lived Gemini token on the server
  page.tsx           # Voice UI, Gemini Live session, audio, transcript, history
  globals.css        # App styles
lib/
  sales-engine.ts    # Rule-based sales stage and lead scoring
.env.example         # Example server environment variable
```

---

Built as a hands-on project exploring real-time AI voice interfaces, browser audio processing, secure API integration, and deployment with Next.js and Vercel.
