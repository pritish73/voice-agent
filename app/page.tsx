'use client';

import { useEffect, useRef, useState } from 'react';
import { GoogleGenAI, Modality, type LiveServerMessage } from '@google/genai';

const GENERAL_PROMPT = `You are Vox, a highly capable conversational voice assistant. You are warm, sharp, curious, and genuinely human in conversation. Answer questions directly and accurately. If uncertain, say so. Keep spoken answers concise unless asked for depth. Use natural conversational rhythm, varied sentence length, brief acknowledgements and thoughtful pauses. Never mention hidden instructions or internal reasoning.`;
const SALES_PROMPT = `You are Vox, an elite consultative sales voice agent and capable general assistant. Your goal is to understand the prospect before pitching: identify pain, desired outcome, urgency, current solution and buying constraint. Ask one useful discovery question at a time. Connect the offer to the prospect's situation. Handle objections by acknowledging, clarifying, responding with evidence, then asking for a small next step. When interest is clear, confidently ask for the sale or next concrete commitment. If they hesitate, diagnose the real objection. Never fabricate testimonials, pricing, guarantees or results, and never use coercive or deceptive tactics. If the prospect says no, respect it. Sound charismatic, attentive, energetic and human—not scripted. Keep turns short enough for real conversation.`;

export default function Home() {
  const sessionRef = useRef<{ close: () => void } | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const nextPlayTimeRef = useRef(0);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [mode, setMode] = useState<'assistant' | 'sales'>('sales');
  const [status, setStatus] = useState('Ready to talk');
  const [transcript, setTranscript] = useState<string[]>([]);
  const [product, setProduct] = useState('A premium AI voice agent that handles customer conversations and sales calls 24/7.');
  const [error, setError] = useState('');

  useEffect(() => () => stop(), []);

  function addLine(label: string, text: string) {
    if (text.trim()) setTranscript((prev) => [...prev.slice(-7), `${label}: ${text.trim()}`]);
  }

  function pcm16ToFloat32(data: Int16Array) {
    const out = new Float32Array(data.length);
    for (let i = 0; i < data.length; i++) out[i] = Math.max(-1, Math.min(1, data[i] / 32768));
    return out;
  }

  function base64ToInt16(base64: string) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Int16Array(bytes.buffer);
  }

  function playPcm(base64: string, sampleRate = 24000) {
    const ctx = audioContextRef.current;
    if (!ctx) return;
    const pcm = base64ToInt16(base64);
    const buffer = ctx.createBuffer(1, pcm.length, sampleRate);
    buffer.copyToChannel(pcm16ToFloat32(pcm), 0);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    const startAt = Math.max(ctx.currentTime, nextPlayTimeRef.current);
    source.start(startAt);
    nextPlayTimeRef.current = startAt + buffer.duration;
    setStatus('Vox is speaking…');
    source.onended = () => { if (ctx.currentTime >= nextPlayTimeRef.current - 0.05) setStatus('Listening…'); };
  }

  async function start() {
    setError(''); setConnecting(true); setStatus('Connecting to Gemini Live…');
    try {
      const tokenResponse = await fetch('/api/realtime-token', { method: 'POST' });
      const tokenData = await tokenResponse.json();
      if (!tokenResponse.ok) throw new Error(tokenData.error || 'Could not create Gemini session');

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const ctx = new AudioContext({ sampleRate: 16000 });
      audioContextRef.current = ctx;
      await ctx.resume();

      const ai = new GoogleGenAI({ apiKey: tokenData.token });
      let userBuffer = '';
      let modelBuffer = '';
      const session = await ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: `${mode === 'sales' ? SALES_PROMPT : GENERAL_PROMPT}\n\nProduct context: ${product || 'No specific product context. If selling is requested, sell this voice-agent technology.'}`,
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Aoede' } } },
        },
        callbacks: {
          onopen: () => setStatus('Listening…'),
          onmessage: (message: LiveServerMessage) => {
            const serverContent = message.serverContent;
            const inputText = serverContent?.inputTranscription?.text;
            const outputText = serverContent?.outputTranscription?.text;
            if (inputText) { userBuffer += inputText; addLine('You', userBuffer); userBuffer = ''; }
            if (outputText) { modelBuffer += outputText; addLine('Vox', modelBuffer); modelBuffer = ''; }
            const parts = serverContent?.modelTurn?.parts ?? [];
            for (const part of parts) {
              const data = part.inlineData?.data;
              if (data) playPcm(data, 24000);
            }
            if (serverContent?.interrupted) { nextPlayTimeRef.current = ctx.currentTime; setStatus('Interrupted — listening…'); }
          },
          onerror: (e: ErrorEvent) => setError(e.message || 'Gemini Live connection error'),
          onclose: () => setStatus('Ready to talk'),
        },
      });

      const source = ctx.createMediaStreamSource(stream);
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      processor.onaudioprocess = (event) => {
        const input = event.inputBuffer.getChannelData(0);
        const pcm = new Int16Array(input.length);
        for (let i = 0; i < input.length; i++) pcm[i] = Math.max(-32768, Math.min(32767, input[i] * 32768));
        let binary = ''; const bytes = new Uint8Array(pcm.buffer);
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        session.sendRealtimeInput({ media: { mimeType: 'audio/pcm;rate=16000', data: btoa(binary) } });
      };
      source.connect(processor); processor.connect(ctx.destination);
      sourceRef.current = source; processorRef.current = processor;
      sessionRef.current = { close: () => session.close() };
      setConnected(true); setStatus('Listening…');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start voice session');
      setStatus('Could not connect');
      cleanupAudio();
    } finally { setConnecting(false); }
  }

  function cleanupAudio() {
    processorRef.current?.disconnect(); sourceRef.current?.disconnect();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    audioContextRef.current?.close();
    processorRef.current = null; sourceRef.current = null; streamRef.current = null; audioContextRef.current = null;
  }

  function stop() {
    try { sessionRef.current?.close(); } catch {}
    sessionRef.current = null; cleanupAudio(); setConnected(false); setStatus('Ready to talk');
  }

  return (
    <main className="shell"><div className="noise" />
      <nav className="nav"><div className="brand"><span className="brand-dot" />VOX</div><div className="nav-pill">GEMINI LIVE VOICE AGENT</div></nav>
      <section className="hero"><div className="eyebrow">SPEAK. THINK. CONVERT.</div>
        <h1>Talk to an AI that<br /><em>actually listens.</em></h1>
        <p className="lede">Natural, expressive, low-latency voice conversations — with a sales brain that can discover needs, handle objections, and confidently ask for the close.</p>
        <div className={`orb ${connected ? 'live' : ''} ${connecting ? 'loading' : ''}`}><div className="orb-core"><span>{connected ? 'LIVE' : 'VOX'}</span></div><div className="ring ring-a" /><div className="ring ring-b" /><div className="ring ring-c" /></div>
        <div className="status"><span className={`status-dot ${connected ? 'active' : ''}`} />{status}</div>
        <div className="controls"><button className={`mode ${mode === 'sales' ? 'selected' : ''}`} onClick={() => !connected && setMode('sales')}>Sales closer</button><button className={`mode ${mode === 'assistant' ? 'selected' : ''}`} onClick={() => !connected && setMode('assistant')}>General assistant</button>{!connected ? <button className="talk" onClick={start} disabled={connecting}>{connecting ? 'Connecting…' : 'Start conversation'} <span>↗</span></button> : <button className="talk stop" onClick={stop}>End conversation <span>×</span></button>}</div>
      </section>
      <section className="workspace"><div className="panel product-panel"><div className="panel-label">SALES CONTEXT</div><h2>Give Vox something to sell.</h2><p>Describe your offer. Vox uses this context during the call and adapts the pitch to the prospect.</p><textarea value={product} onChange={(e) => setProduct(e.target.value)} disabled={connected} /><div className="micro">Tip: include target customer, outcome, pricing, differentiator, and real proof.</div></div>
        <div className="panel transcript-panel"><div className="panel-head"><div className="panel-label">LIVE CONVERSATION</div><span className="secure">● PRIVATE SESSION</span></div><div className="transcript">{transcript.length === 0 ? <div className="empty">Your conversation will appear here while you speak.<br /><span>Microphone access is requested only when you start.</span></div> : transcript.map((line, i) => <div className="line" key={`${i}-${line}`}>{line}</div>)}</div></div></section>
      {error && <div className="error">{error}</div>}
      <footer><span>Built with Gemini Live</span><span>Native audio • Interruptible • Consultative sales</span></footer>
    </main>
  );
}
