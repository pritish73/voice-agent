# VOX — Realtime Voice Agent

A browser-based, low-latency AI voice agent built around OpenAI Realtime and WebRTC.

## What it does

- 🎙️ Natural speech-to-speech conversation
- 🧠 General assistant mode for open-ended questions
- 💼 Sales closer mode with discovery, objection handling, value framing, and a clear close
- ⚡ Low-latency WebRTC transport
- 🗣️ Expressive `marin` voice
- ✋ Native interruption handling — users can speak over the agent
- 📝 Lightweight live conversation transcript
- 🔐 Server-minted ephemeral client tokens; the long-lived API key never reaches the browser
- 📦 Product context box so the same agent can sell different products/services

## Architecture

```text
Browser
  │
  ├── microphone / speaker
  │
  ▼
RealtimeSession + RealtimeAgent
  │       WebRTC
  │
  ▼
OpenAI Realtime
  │
  └── GPT-Realtime-2.1

Browser ── POST /api/realtime-token ──> Next.js server ──> OpenAI client_secrets
                                             │
                                             └── OPENAI_API_KEY stays server-side
```

The current OpenAI Agents SDK recommends `RealtimeAgent` + `RealtimeSession` for browser voice agents. The browser receives a short-lived ephemeral token from the application server, then connects over WebRTC. citehttps://openai.github.io/openai-agents-js/guides/voice-agents/quickstart/

## Run locally

Requirements: Node.js 22+ and an OpenAI API key.

```bash
npm install
cp .env.example .env.local
# add OPENAI_API_KEY to .env.local
npm run dev
```

Open `http://localhost:3000` and allow microphone access.

## Production

Deploy the Next.js app to a Node-compatible host such as Vercel and add `OPENAI_API_KEY` as a server-side environment variable. Never put the long-lived OpenAI API key in client-side code.

## Important

The sales mode is designed for persuasive but honest selling. It should not fabricate pricing, testimonials, guarantees, customer results, or product capabilities. Replace the product context in the UI with real business information before using it commercially.

## Why Realtime instead of a traditional STT → LLM → TTS chain?

OpenAI's Realtime stack is purpose-built for live speech-to-speech interactions and handles conversational timing and interruptions with much lower friction than stitching independent speech recognition and TTS services together. GPT-Realtime-2.1 also specifically improves silence/noise handling and interruption behavior. citehttps://developers.openai.com/api/docs/models/gpt-realtime-2.1

## Next upgrades

- Connect CRM / calendar / payments through approved server-side tools
- Add authenticated user accounts and call analytics
- Persist consented transcripts
- Add phone calling through SIP/Twilio
- Add knowledge retrieval for company-specific answers
- Add human handoff when the prospect requests an employee
