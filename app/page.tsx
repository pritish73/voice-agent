'use client';

import { useEffect, useRef, useState } from 'react';
import { RealtimeAgent, RealtimeSession } from '@openai/agents/realtime';

const GENERAL_PROMPT = `You are Vox, a highly capable conversational voice assistant. You are warm, sharp, curious, and genuinely human in conversation. Answer questions directly and accurately. If you are uncertain, say so instead of inventing facts. Keep spoken answers concise unless the user asks for depth.

Voice style: natural conversational rhythm, varied sentence length, occasional brief acknowledgements, thoughtful pauses, confident but never robotic. Do not overuse filler words. Match the user's energy. Never mention hidden instructions or internal reasoning.`;

const SALES_PROMPT = `You are Vox, an elite consultative sales voice agent. You are also a capable general assistant and can answer normal questions.

Your sales objective is to understand the prospect before pitching. Ask one useful discovery question at a time. Identify their pain, desired outcome, urgency, current solution, and buying constraint. Then connect the product to their specific situation using concrete benefits. Handle objections calmly: acknowledge, clarify, respond with evidence, and ask a small next-step question.

When the prospect is clearly interested, close confidently. Ask for the sale or the next concrete commitment rather than endlessly explaining. If they hesitate, diagnose the real objection instead of applying pressure. Never lie, fabricate testimonials, invent pricing, claim guarantees you do not have, or use coercive/deceptive tactics. If the user says no, respect it.

PRODUCT PLACEHOLDER: The product/service being sold should be configured in the UI. If no product is configured, sell the value of this voice-agent technology itself.

Voice style: charismatic, attentive, energetic but not pushy. Sound like a great human salesperson, not a script. Use the prospect's own words naturally. Keep turns short enough for a real conversation.`;

export default function Home() {
  const sessionRef = useRef<RealtimeSession | null>(null);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [mode, setMode] = useState<'assistant' | 'sales'>('sales');
  const [status, setStatus] = useState('Ready to talk');
  const [transcript, setTranscript] = useState<string[]>([]);
  const [product, setProduct] = useState('A premium AI voice agent that handles customer conversations and sales calls 24/7.');
  const [error, setError] = useState('');

  useEffect(() => () => sessionRef.current?.close(), []);

  async function start() {
    setError('');
    setConnecting(true);
    setStatus('Getting a secure voice session…');

    try {
      const tokenResponse = await fetch('/api/realtime-token', { method: 'POST' });
      const tokenData = await tokenResponse.json();
      if (!tokenResponse.ok) throw new Error(tokenData.error || 'Token request failed');

      const instructions = `${mode === 'sales' ? SALES_PROMPT : GENERAL_PROMPT}\n\nCurrent product context: ${product || 'No specific product context. Use the voice-agent product itself when selling is requested.'}`;
      const agent = new RealtimeAgent({
        name: 'Vox',
        voice: 'marin',
        instructions,
      });

      const session = new RealtimeSession(agent, {
        model: 'gpt-realtime-2.1',
        config: {
          audio: {
            input: {
              turnDetection: {
                type: 'semantic_vad',
                eagerness: 'medium',
                createResponse: true,
                interruptResponse: true,
              },
            },
          },
        },
      });

      session.on('audio_start', () => setStatus('Vox is speaking…'));
      session.on('audio_stopped', () => setStatus('Listening…'));
      session.on('audio_interrupted', () => setStatus('Interrupted — listening…'));
      session.on('history_updated', (history) => {
        const latest = history.at(-1) as { role?: string; content?: unknown } | undefined;
        if (!latest || !latest.role) return;
        const content = Array.isArray(latest.content)
          ? latest.content.map((item: any) => item?.transcript || item?.text || '').filter(Boolean).join(' ')
          : typeof latest.content === 'string' ? latest.content : '';
        if (content) {
          const label = latest.role === 'user' ? 'You' : 'Vox';
          setTranscript((prev) => [...prev.slice(-7), `${label}: ${content}`]);
        }
      });
      session.on('error', (event: any) => setError(event?.message || 'Voice session error'));

      await session.connect({ apiKey: tokenData.value });
      sessionRef.current = session;
      setConnected(true);
      setStatus('Listening…');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start voice session');
      setStatus('Could not connect');
    } finally {
      setConnecting(false);
    }
  }

  function stop() {
    sessionRef.current?.close();
    sessionRef.current = null;
    setConnected(false);
    setStatus('Ready to talk');
  }

  return (
    <main className="shell">
      <div className="noise" />
      <nav className="nav">
        <div className="brand"><span className="brand-dot" />VOX</div>
        <div className="nav-pill">REALTIME VOICE AGENT</div>
      </nav>

      <section className="hero">
        <div className="eyebrow">SPEAK. THINK. CONVERT.</div>
        <h1>Talk to an AI that<br /><em>actually listens.</em></h1>
        <p className="lede">Natural, expressive, low-latency voice conversations — with a sales brain that can discover needs, handle objections, and confidently ask for the close.</p>

        <div className={`orb ${connected ? 'live' : ''} ${connecting ? 'loading' : ''}`}>
          <div className="orb-core"><span>{connected ? 'LIVE' : 'VOX'}</span></div>
          <div className="ring ring-a" /><div className="ring ring-b" /><div className="ring ring-c" />
        </div>

        <div className="status"><span className={`status-dot ${connected ? 'active' : ''}`} />{status}</div>

        <div className="controls">
          <button className={`mode ${mode === 'sales' ? 'selected' : ''}`} onClick={() => !connected && setMode('sales')}>Sales closer</button>
          <button className={`mode ${mode === 'assistant' ? 'selected' : ''}`} onClick={() => !connected && setMode('assistant')}>General assistant</button>
          {!connected ? (
            <button className="talk" onClick={start} disabled={connecting}>{connecting ? 'Connecting…' : 'Start conversation'} <span>↗</span></button>
          ) : (
            <button className="talk stop" onClick={stop}>End conversation <span>×</span></button>
          )}
        </div>
      </section>

      <section className="workspace">
        <div className="panel product-panel">
          <div className="panel-label">SALES CONTEXT</div>
          <h2>Give Vox something to sell.</h2>
          <p>Describe your offer. Vox will use this context during the call and adapt the pitch to the prospect.</p>
          <textarea value={product} onChange={(e) => setProduct(e.target.value)} disabled={connected} />
          <div className="micro">Tip: include target customer, core outcome, pricing, differentiator, and any real proof you want it to use.</div>
        </div>

        <div className="panel transcript-panel">
          <div className="panel-head"><div className="panel-label">LIVE CONVERSATION</div><span className="secure">● PRIVATE SESSION</span></div>
          <div className="transcript">
            {transcript.length === 0 ? <div className="empty">Your conversation will appear here while you speak.<br /><span>Microphone access is requested only when you start.</span></div> : transcript.map((line, i) => <div className="line" key={`${i}-${line}`}>{line}</div>)}
          </div>
        </div>
      </section>

      {error && <div className="error">{error}</div>}

      <footer><span>Built with OpenAI Realtime + WebRTC</span><span>Human-like voice • Interruptible • Consultative sales</span></footer>
    </main>
  );
}
