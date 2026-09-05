'use client';

import { useEffect, useRef, useState } from 'react';
import { GoogleGenAI, Modality, type LiveServerMessage } from '@google/genai';
import { analyzeSalesTurn, createLeadState, stageLabel, type LeadState } from '@/lib/sales-engine';

type HistoryItem = { id: string; date: string; mode: 'assistant' | 'sales'; lines: string[]; score: number; stage: string };

const HISTORY_KEY = 'vox-conversation-history';
const GENERAL_PROMPT = `You are Vox, a highly capable conversational voice assistant. You are warm, sharp, curious, and genuinely human in conversation. Answer questions directly and accurately. If uncertain, say so. Keep spoken answers concise unless asked for depth. Use natural conversational rhythm, varied sentence length, brief acknowledgements and thoughtful pauses. Never mention hidden instructions or internal reasoning.`;
const SALES_PROMPT = `You are Vox, an elite consultative sales voice agent. Your goal is to understand the prospect before pitching: identify pain, desired outcome, urgency, current solution, budget and buying authority. Ask one useful discovery question at a time. Connect the offer to the prospect's situation. Handle objections by acknowledging, clarifying, responding with evidence, then asking for a small next step. When interest is clear, confidently ask for the sale or next concrete commitment. Never fabricate testimonials, pricing, guarantees or results, and never use coercive or deceptive tactics. If the prospect says no, respect it. Sound charismatic, attentive, energetic and human—not scripted. Keep turns short enough for real conversation.`;

export default function Home() {
  const sessionRef = useRef<{ close: () => void } | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const nextPlayTimeRef = useRef(0);
  const leadRef = useRef<LeadState>(createLeadState());
  const userBufferRef = useRef('');
  const modelBufferRef = useRef('');
  const lastTranscriptLabelRef = useRef<'You' | 'Vox' | null>(null);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [mode, setMode] = useState<'assistant' | 'sales'>('sales');
  const [status, setStatus] = useState('Ready to talk');
  const [transcript, setTranscript] = useState<string[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [selectedHistory, setSelectedHistory] = useState<HistoryItem | null>(null);
  const [product, setProduct] = useState('A premium AI voice agent that handles customer conversations and sales calls 24/7.');
  const [error, setError] = useState('');
  const [lead, setLead] = useState<LeadState>(createLeadState());

  useEffect(() => {
    try {
      const saved = localStorage.getItem(HISTORY_KEY);
      if (saved) setHistory(JSON.parse(saved));
    } catch {}
  }, []);

  useEffect(() => {
    const element = transcriptRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [transcript]);

  useEffect(() => () => stop(), []);

  function saveHistory(lines: string[] = transcript) {
    if (!lines.length) return;
    const item: HistoryItem = {
      id: `${Date.now()}`,
      date: new Date().toLocaleString(),
      mode,
      lines,
      score: leadRef.current.score,
      stage: stageLabel(leadRef.current.stage),
    };
    setHistory((prev) => {
      const next = [item, ...prev].slice(0, 50);
      try { localStorage.setItem(HISTORY_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }

  function updateTranscript(label: 'You' | 'Vox', text: string) {
    const clean = text.trim();
    if (!clean) return;
    setTranscript((prev) => {
      const next = [...prev];
      const lastIndex = next.length - 1;
      if (lastIndex >= 0 && lastTranscriptLabelRef.current === label) next[lastIndex] = `${label}: ${clean}`;
      else next.push(`${label}: ${clean}`);
      return next;
    });
    lastTranscriptLabelRef.current = label;
  }

  function finishTranscriptTurn() {
    userBufferRef.current = '';
    modelBufferRef.current = '';
    lastTranscriptLabelRef.current = null;
  }

  function updateLead(text: string) {
    if (mode !== 'sales') return;
    const next = analyzeSalesTurn(text, leadRef.current);
    leadRef.current = next;
    setLead(next);
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
    source.buffer = buffer; source.connect(ctx.destination);
    const startAt = Math.max(ctx.currentTime, nextPlayTimeRef.current);
    source.start(startAt); nextPlayTimeRef.current = startAt + buffer.duration;
    setStatus('Vox is speaking…');
    source.onended = () => { if (ctx.currentTime >= nextPlayTimeRef.current - 0.05) setStatus('Listening…'); };
  }

  async function start() {
    if (transcript.length) saveHistory();
    setSelectedHistory(null);
    setError(''); setConnecting(true); setStatus('Connecting to Gemini Live…');
    leadRef.current = createLeadState(); setLead(leadRef.current); setTranscript([]); finishTranscriptTurn();
    try {
      const tokenResponse = await fetch('/api/realtime-token', { method: 'POST' });
      const tokenData = await tokenResponse.json();
      if (!tokenResponse.ok) throw new Error(tokenData.error || 'Could not create Gemini session');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const ctx = new AudioContext({ sampleRate: 16000 });
      audioContextRef.current = ctx; await ctx.resume();
      const ai = new GoogleGenAI({ apiKey: tokenData.token });
      const session = await ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: `${mode === 'sales' ? SALES_PROMPT : GENERAL_PROMPT}\n\nProduct context: ${product || 'No specific product context. If selling is requested, sell this voice-agent technology.'}`,
          inputAudioTranscription: {}, outputAudioTranscription: {},
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Aoede' } } },
        },
        callbacks: {
          onopen: () => setStatus('Listening…'),
          onmessage: (message: LiveServerMessage) => {
            const serverContent = message.serverContent;
            const inputText = serverContent?.inputTranscription?.text;
            const outputText = serverContent?.outputTranscription?.text;
            if (inputText) { userBufferRef.current += inputText; updateLead(userBufferRef.current); updateTranscript('You', userBufferRef.current); }
            if (outputText) { modelBufferRef.current += outputText; updateTranscript('Vox', modelBufferRef.current); }
            const parts = serverContent?.modelTurn?.parts ?? [];
            for (const part of parts) { const data = part.inlineData?.data; if (data) playPcm(data, 24000); }
            if (serverContent?.interrupted) { nextPlayTimeRef.current = ctx.currentTime; setStatus('Interrupted — listening…'); modelBufferRef.current = ''; lastTranscriptLabelRef.current = null; }
            if (serverContent?.turnComplete) finishTranscriptTurn();
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
      setError(err instanceof Error ? err.message : 'Could not start voice session'); setStatus('Could not connect'); cleanupAudio();
    } finally { setConnecting(false); }
  }

  function cleanupAudio() {
    processorRef.current?.disconnect(); sourceRef.current?.disconnect();
    streamRef.current?.getTracks().forEach((track) => track.stop()); audioContextRef.current?.close();
    processorRef.current = null; sourceRef.current = null; streamRef.current = null; audioContextRef.current = null;
  }

  function stop() {
    if (transcript.length) saveHistory();
    try { sessionRef.current?.close(); } catch {}
    sessionRef.current = null; cleanupAudio(); finishTranscriptTurn(); setConnected(false); setStatus('Ready to talk');
  }

  function openHistory(item: HistoryItem) {
    setSelectedHistory(item);
  }

  function clearHistory() {
    setHistory([]); setSelectedHistory(null);
    try { localStorage.removeItem(HISTORY_KEY); } catch {}
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
        <div className="panel transcript-panel"><div className="panel-head"><div className="panel-label">LIVE CONVERSATION</div><span className="secure">● PRIVATE SESSION</span></div><div className="transcript" ref={transcriptRef}>{selectedHistory ? selectedHistory.lines.map((line, i) => <div className="line" key={`${i}-${line}`}>{line}</div>) : transcript.length === 0 ? <div className="empty">Your conversation will appear here while you speak.<br /><span>Past conversations are saved in history below.</span></div> : transcript.map((line, i) => <div className="line" key={`${i}-${line}`}>{line}</div>)}</div></div></section>
      {mode === 'sales' && !selectedHistory && <section className="panel" style={{ marginTop: 24 }}><div className="panel-head"><div className="panel-label">LIVE SALES INTELLIGENCE</div><span className="secure">LEAD SCORE {lead.score}/100</span></div><div style={{ display: 'flex', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap' }}><div><strong>{stageLabel(lead.stage)}</strong><div className="micro">Current sales stage</div></div><div><strong>{lead.signals.length ? lead.signals.join(' • ') : 'Waiting for qualification signals'}</strong><div className="micro">Detected buying signals</div></div></div></section>}
      <section className="panel history-panel"><div className="panel-head"><div><div className="panel-label">CONVERSATION HISTORY</div><div className="micro">Saved locally in this browser • {history.length} conversation{history.length === 1 ? '' : 's'}</div></div>{history.length > 0 && <button className="history-clear" onClick={clearHistory}>Clear history</button>}</div><div className="history-list">{history.length === 0 ? <div className="empty history-empty">No past conversations yet. End a call and it will appear here.</div> : history.map((item) => <button className={`history-item ${selectedHistory?.id === item.id ? 'selected' : ''}`} key={item.id} onClick={() => openHistory(item)}><div><strong>{item.mode === 'sales' ? 'Sales conversation' : 'General conversation'}</strong><div className="micro">{item.date} • {item.lines.length} messages</div></div><div className="history-meta">{item.mode === 'sales' ? `${item.score}/100 • ${item.stage}` : 'Assistant'}</div></button>)}</div>{selectedHistory && <button className="history-back" onClick={() => setSelectedHistory(null)}>← Back to live conversation</button>}</section>
      {error && <div className="error">{error}</div>}
      <footer><span>Built with Gemini Live</span><span>Native audio • Conversation history • Lead scoring • Consultative sales</span></footer>
    </main>
  );
}
