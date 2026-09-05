'use client';

import { useEffect, useRef, useState } from 'react';
import { GoogleGenAI, Modality, type LiveServerMessage } from '@google/genai';
import { analyzeSalesTurn, createLeadState, stageLabel, type LeadState } from '@/lib/sales-engine';

type Message = { id: number; role: 'You' | 'Vox'; text: string };
type HistoryItem = { id: string; date: string; mode: 'assistant' | 'sales'; messages: Message[]; score: number; stage: string };

const HISTORY_KEY = 'vox-conversation-history';
const GENERAL_PROMPT = `You are Vox, a highly capable conversational voice assistant. You are warm, sharp, curious, and genuinely human in conversation. Answer questions directly and accurately. If uncertain, say so. Keep spoken answers concise unless asked for depth. Use natural conversational rhythm, varied sentence length, brief acknowledgements and thoughtful pauses. Never mention hidden instructions or internal reasoning.`;
const SALES_PROMPT = `You are Vox, an elite consultative sales voice agent. Your goal is to understand the prospect before pitching: identify pain, desired outcome, urgency, current solution, budget and buying authority. Ask one useful discovery question at a time. Connect the offer to the prospect's situation. Handle objections by acknowledging, clarifying, responding with evidence, then asking for a small next step. When interest is clear, confidently ask for the sale or next concrete commitment. Never fabricate testimonials, pricing, guarantees or results, and never use coercive or deceptive tactics. If the prospect says no, respect it. Sound charismatic, attentive, energetic and human—not scripted. Keep turns short enough for real conversation.`;

function normalizeHistory(raw: unknown): HistoryItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item, historyIndex) => {
    if (!item || typeof item !== 'object') return [];
    const value = item as Record<string, unknown>;
    const rawMessages = Array.isArray(value.messages) ? value.messages : null;
    const rawLines = Array.isArray(value.lines) ? value.lines : null;
    const messages: Message[] = rawMessages
      ? rawMessages.flatMap((message, messageIndex) => {
          if (!message || typeof message !== 'object') return [];
          const m = message as Record<string, unknown>;
          const role = m.role === 'You' || m.role === 'Vox' ? m.role : null;
          const text = typeof m.text === 'string' ? m.text.trim() : '';
          return role && text ? [{ id: Number(m.id) || messageIndex + 1, role, text }] : [];
        })
      : rawLines
        ? rawLines.flatMap((line, lineIndex) => {
            if (typeof line !== 'string' || !line.trim()) return [];
            const text = line.trim();
            const match = text.match(/^(You|Vox)\s*:\s*(.*)$/i);
            const role = match?.[1]?.toLowerCase() === 'you' ? 'You' : 'Vox';
            return [{ id: lineIndex + 1, role, text: match?.[2]?.trim() || text }];
          })
        : [];
    if (!messages.length) return [];
    return [{
      id: typeof value.id === 'string' ? value.id : `${Date.now()}-${historyIndex}`,
      date: typeof value.date === 'string' ? value.date : 'Previous conversation',
      mode: value.mode === 'assistant' ? 'assistant' : 'sales',
      messages,
      score: typeof value.score === 'number' ? value.score : 0,
      stage: typeof value.stage === 'string' ? value.stage : 'Unknown',
    }];
  });
}

export default function Home() {
  const sessionRef = useRef<{ close: () => void } | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const nextPlayTimeRef = useRef(0);
  const messagesRef = useRef<Message[]>([]);
  const nextMessageIdRef = useRef(1);
  const leadRef = useRef<LeadState>(createLeadState());
  const userBufferRef = useRef('');
  const modelBufferRef = useRef('');
  const lastMeterUpdateRef = useRef(0);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [mode, setMode] = useState<'assistant' | 'sales'>('sales');
  const [status, setStatus] = useState('Ready to talk');
  const [transcript, setTranscript] = useState<Message[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [selectedHistory, setSelectedHistory] = useState<HistoryItem | null>(null);
  const [product, setProduct] = useState('A premium AI voice agent that handles customer conversations and sales calls 24/7.');
  const [error, setError] = useState('');
  const [lead, setLead] = useState<LeadState>(createLeadState());
  const [voiceLevel, setVoiceLevel] = useState(0);
  const [voiceRole, setVoiceRole] = useState<'idle' | 'user' | 'model'>('idle');

  useEffect(() => {
    try {
      const saved = localStorage.getItem(HISTORY_KEY);
      if (saved) {
        const normalized = normalizeHistory(JSON.parse(saved));
        setHistory(normalized);
        localStorage.setItem(HISTORY_KEY, JSON.stringify(normalized));
      }
    } catch {
      localStorage.removeItem(HISTORY_KEY);
    }
  }, []);

  useEffect(() => {
    const el = transcriptRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [transcript, selectedHistory]);

  function replaceMessages(messages: Message[]) {
    messagesRef.current = messages;
    setTranscript(messages);
  }

  function addOrUpdateMessage(role: 'You' | 'Vox', text: string) {
    const clean = text.trim();
    if (!clean) return;
    const current = messagesRef.current;
    const last = current[current.length - 1];
    let next: Message[];
    if (last?.role === role) {
      next = [...current.slice(0, -1), { ...last, text: clean }];
    } else {
      next = [...current, { id: nextMessageIdRef.current++, role, text: clean }];
    }
    replaceMessages(next);
  }

  function saveHistory(messages = messagesRef.current) {
    if (!messages.length) return;
    const item: HistoryItem = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      date: new Date().toLocaleString(),
      mode,
      messages: messages.map((m) => ({ ...m })),
      score: leadRef.current.score,
      stage: stageLabel(leadRef.current.stage),
    };
    setHistory((prev) => {
      const next = [item, ...prev].slice(0, 50);
      try { localStorage.setItem(HISTORY_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }

  function finishTurn() {
    userBufferRef.current = '';
    modelBufferRef.current = '';
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
    source.buffer = buffer;
    source.connect(ctx.destination);
    const startAt = Math.max(ctx.currentTime, nextPlayTimeRef.current);
    source.start(startAt);
    nextPlayTimeRef.current = startAt + buffer.duration;
    setVoiceRole('model');
    setVoiceLevel(0.8);
    setStatus('Vox is speaking…');
    source.onended = () => {
      if (ctx.currentTime >= nextPlayTimeRef.current - 0.05) {
        setVoiceRole('user');
        setVoiceLevel(0);
        setStatus('Listening…');
      }
    };
  }

  async function start() {
    if (messagesRef.current.length) saveHistory(messagesRef.current);
    setSelectedHistory(null);
    setError('');
    setConnecting(true);
    setVoiceLevel(0);
    setVoiceRole('idle');
    setStatus('Connecting to Gemini Live…');
    leadRef.current = createLeadState();
    setLead(leadRef.current);
    replaceMessages([]);
    finishTurn();
    nextMessageIdRef.current = 1;
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
          onopen: () => {
            setStatus('Listening…');
            setVoiceRole('user');
          },
          onmessage: (message: LiveServerMessage) => {
            const serverContent = message.serverContent;
            const inputText = serverContent?.inputTranscription?.text;
            const outputText = serverContent?.outputTranscription?.text;
            if (inputText) {
              userBufferRef.current += inputText;
              updateLead(userBufferRef.current);
              addOrUpdateMessage('You', userBufferRef.current);
            }
            if (outputText) {
              modelBufferRef.current += outputText;
              addOrUpdateMessage('Vox', modelBufferRef.current);
            }
            const parts = serverContent?.modelTurn?.parts ?? [];
            for (const part of parts) {
              const data = part.inlineData?.data;
              if (data) playPcm(data, 24000);
            }
            if (serverContent?.interrupted) {
              nextPlayTimeRef.current = ctx.currentTime;
              setVoiceRole('user');
              setVoiceLevel(0);
              setStatus('Interrupted — listening…');
              modelBufferRef.current = '';
            }
            if (serverContent?.turnComplete) finishTurn();
          },
          onerror: (e: ErrorEvent) => setError(e.message || 'Gemini Live connection error'),
          onclose: () => {
            setVoiceRole('idle');
            setVoiceLevel(0);
            setStatus('Ready to talk');
          },
        },
      });
      const source = ctx.createMediaStreamSource(stream);
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      processor.onaudioprocess = (event) => {
        const input = event.inputBuffer.getChannelData(0);
        let sum = 0;
        for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
        const rms = Math.sqrt(sum / input.length);
        const level = Math.min(1, Math.max(0, rms * 7));
        const now = performance.now();
        if (now - lastMeterUpdateRef.current > 55) {
          lastMeterUpdateRef.current = now;
          setVoiceLevel(level);
          if (level > 0.035) setVoiceRole('user');
          else if (voiceRole === 'user') setVoiceRole('user');
        }
        const pcm = new Int16Array(input.length);
        for (let i = 0; i < input.length; i++) pcm[i] = Math.max(-32768, Math.min(32767, input[i] * 32768));
        let binary = '';
        const bytes = new Uint8Array(pcm.buffer);
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        session.sendRealtimeInput({ media: { mimeType: 'audio/pcm;rate=16000', data: btoa(binary) } });
      };
      source.connect(processor);
      processor.connect(ctx.destination);
      sourceRef.current = source;
      processorRef.current = processor;
      sessionRef.current = { close: () => session.close() };
      setConnected(true);
      setVoiceRole('user');
      setStatus('Listening…');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start voice session');
      setStatus('Could not connect');
      setVoiceRole('idle');
      setVoiceLevel(0);
      cleanupAudio();
    } finally {
      setConnecting(false);
    }
  }

  function cleanupAudio() {
    processorRef.current?.disconnect();
    sourceRef.current?.disconnect();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    audioContextRef.current?.close();
    processorRef.current = null;
    sourceRef.current = null;
    streamRef.current = null;
    audioContextRef.current = null;
    setVoiceRole('idle');
    setVoiceLevel(0);
  }

  function stop() {
    saveHistory(messagesRef.current);
    try { sessionRef.current?.close(); } catch {}
    sessionRef.current = null;
    cleanupAudio();
    finishTurn();
    setConnected(false);
    setStatus('Ready to talk');
  }

  useEffect(() => () => {
    try { sessionRef.current?.close(); } catch {}
    cleanupAudio();
  }, []);

  function clearHistory() {
    setHistory([]);
    setSelectedHistory(null);
    try { localStorage.removeItem(HISTORY_KEY); } catch {}
  }

  const displayedMessages = selectedHistory ? selectedHistory.messages : transcript;
  const waveformBars = Array.from({ length: 32 }, (_, index) => {
    const center = 1 - Math.abs(index - 15.5) / 15.5;
    const wave = 0.55 + center * 0.45;
    return Math.max(4, Math.round(6 + voiceLevel * 34 * wave));
  });

  return (
    <main className="shell">
      <div className="noise" />
      <nav className="nav"><div className="brand"><span className="brand-dot" />VOX</div><div className="nav-pill">GEMINI LIVE VOICE AGENT</div></nav>
      <section className="hero">
        <div className="eyebrow">SPEAK. THINK. CONVERT.</div>
        <h1>Talk to an AI that<br /><em>actually listens.</em></h1>
        <p className="lede">Natural, expressive, low-latency voice conversations — with a sales brain that can discover needs, handle objections, and confidently ask for the close.</p>
        <div className={`orb ${connected ? 'live' : ''} ${connecting ? 'loading' : ''}`}><div className="orb-core"><span>{connected ? 'LIVE' : 'VOX'}</span></div><div className="ring ring-a" /><div className="ring ring-b" /><div className="ring ring-c" /></div>
        <div className="status"><span className={`status-dot ${connected ? 'active' : ''}`} />{status}</div>
        <div className={`voice-activity ${voiceRole === 'model' ? 'model' : ''} ${voiceRole === 'user' ? 'live' : ''}`}>
          <div className="voice-activity-head">
            <div className={`voice-state ${voiceRole !== 'idle' ? 'active' : ''}`}><span className="voice-state-dot" />{voiceRole === 'model' ? 'VOX IS SPEAKING' : voiceRole === 'user' ? 'YOU ARE SPEAKING' : 'VOICE ACTIVITY'}</div>
            <span className="micro">LIVE AUDIO</span>
          </div>
          <div className="voice-meter" aria-label="Live voice activity">
            {waveformBars.map((height, index) => <span className="voice-bar" key={index} style={{ height: `${height}px`, opacity: voiceRole === 'idle' ? 0.45 : 0.55 + Math.min(0.45, voiceLevel) }} />)}
          </div>
        </div>
        <div className="controls"><button className={`mode ${mode === 'sales' ? 'selected' : ''}`} onClick={() => !connected && setMode('sales')}>Sales closer</button><button className={`mode ${mode === 'assistant' ? 'selected' : ''}`} onClick={() => !connected && setMode('assistant')}>General assistant</button>{!connected ? <button className="talk" onClick={start} disabled={connecting}>{connecting ? 'Connecting…' : 'Start conversation'} <span>↗</span></button> : <button className="talk stop" onClick={stop}>End conversation <span>×</span></button>}</div>
      </section>
      <section className="workspace">
        <div className="panel product-panel"><div className="panel-label">SALES CONTEXT</div><h2>Give Vox something to sell.</h2><p>Describe your offer. Vox uses this context during the call and adapts the pitch to the prospect.</p><textarea value={product} onChange={(e) => setProduct(e.target.value)} disabled={connected} /><div className="micro">Tip: include target customer, outcome, pricing, differentiator, and real proof.</div></div>
        <div className="panel transcript-panel"><div className="panel-head"><div className="panel-label">{selectedHistory ? 'PAST CONVERSATION' : 'LIVE CONVERSATION'}</div><span className="secure">● PRIVATE SESSION</span></div><div className="transcript" ref={transcriptRef}>{displayedMessages.length === 0 ? <div className="empty">Your conversation will appear here while you speak.<br /><span>Scroll up anytime to see earlier messages.</span></div> : displayedMessages.map((message) => <div className={`chat-row ${message.role === 'You' ? 'user' : 'assistant'}`} key={message.id}><div className={`chat-bubble ${message.role === 'You' ? 'user' : 'assistant'}`}><div className="chat-role">{message.role}</div><div>{message.text}</div></div></div>)}</div></div>
      </section>
      {mode === 'sales' && !selectedHistory && <section className="panel" style={{ marginTop: 24 }}><div className="panel-head"><div className="panel-label">LIVE SALES INTELLIGENCE</div><span className="secure">LEAD SCORE {lead.score}/100</span></div><div style={{ display: 'flex', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap' }}><div><strong>{stageLabel(lead.stage)}</strong><div className="micro">Current sales stage</div></div><div><strong>{lead.signals.length ? lead.signals.join(' • ') : 'Waiting for qualification signals'}</strong><div className="micro">Detected buying signals</div></div></div></section>}
      <section className="panel history-panel"><div className="panel-head"><div><div className="panel-label">CONVERSATION HISTORY</div><div className="micro">Saved locally in this browser • {history.length} conversation{history.length === 1 ? '' : 's'}</div></div>{history.length > 0 && <button className="history-clear" onClick={clearHistory}>Clear history</button>}</div><div className="history-list">{history.length === 0 ? <div className="empty history-empty">No past conversations yet. End a call and it will appear here.</div> : history.map((item) => <button className={`history-item ${selectedHistory?.id === item.id ? 'selected' : ''}`} key={item.id} onClick={() => setSelectedHistory(item)}><div><strong>{item.mode === 'sales' ? 'Sales conversation' : 'General conversation'}</strong><div className="micro">{item.date} • {item.messages.length} messages</div></div><div className="history-meta">{item.mode === 'sales' ? `${item.score}/100 • ${item.stage}` : 'Assistant'}</div></button>)}</div>{selectedHistory && <button className="history-back" onClick={() => setSelectedHistory(null)}>← Back to live conversation</button>}</section>
      {error && <div className="error">{error}</div>}
      <footer><span>Built with Gemini Live</span><span>Native audio • WhatsApp-style chat • Full history • Lead scoring</span></footer>
    </main>
  );
}
