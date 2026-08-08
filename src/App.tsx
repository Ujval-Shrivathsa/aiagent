import React, { useState, useRef, useEffect, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, ThinkingLevel } from "@google/genai";
import { Phone, Building2, Info, Mic, MicOff, Loader2, Volume2, VolumeX, ArrowRight, MapPin, Calendar, X, ExternalLink, LayoutDashboard } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from './lib/utils';
import { PRIYA_SYSTEM_INSTRUCTION, SEND_NOTIFICATION_TOOL, SCHEDULE_SITE_VISIT_TOOL } from './constants';
import CRM from './components/CRM';

// --- Types ---
interface AudioVisualizerProps {
  isSpeaking: boolean;
  isListening: boolean;
}

export default function App() {
  // State
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [transcription, setTranscription] = useState("");
  const [volume, setVolume] = useState(0);
  const [showInfo, setShowInfo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentView, setCurrentView] = useState<'agent' | 'crm'>('agent');

  // Refs
  const sessionRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioWorkletNodeRef = useRef<AudioWorkletNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioQueueRef = useRef<Int16Array[]>([]);
  const isProcessingQueueRef = useRef(false);
  const lastAudioTimeRef = useRef<number>(0);
  const initialMuteRef = useRef(true);

  const nextStartTimeRef = useRef<number>(0);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const audioAccumulatorRef = useRef<Int16Array[]>([]);
  const accumulatorLengthRef = useRef<number>(0);

  // Audio Processing Logic
  const processAudioQueue = useCallback(async () => {
    if (isProcessingQueueRef.current || audioQueueRef.current.length === 0 || !audioContextRef.current) return;

    isProcessingQueueRef.current = true;
    setIsSpeaking(true);

    if (nextStartTimeRef.current < audioContextRef.current.currentTime) {
      nextStartTimeRef.current = audioContextRef.current.currentTime + 0.05;
    }

    while (audioQueueRef.current.length > 0) {
      const audioData = audioQueueRef.current.shift()!;
      const audioBuffer = audioContextRef.current.createBuffer(1, audioData.length, 24000);
      const channelData = audioBuffer.getChannelData(0);
      
      for (let i = 0; i < audioData.length; i++) {
        channelData[i] = audioData[i] / 32768.0;
      }

      const source = audioContextRef.current.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioContextRef.current.destination);
      
      activeSourcesRef.current.add(source);
      source.onended = () => {
        activeSourcesRef.current.delete(source);
      };

      source.start(nextStartTimeRef.current);
      nextStartTimeRef.current += audioBuffer.duration;

      if (audioQueueRef.current.length > 10) continue;
      await new Promise(resolve => setTimeout(resolve, 5));
    }

    isProcessingQueueRef.current = false;
    
    const checkSpeaking = () => {
      if (audioQueueRef.current.length === 0 && activeSourcesRef.current.size === 0) {
        setIsSpeaking(false);
      } else if (audioQueueRef.current.length > 0) {
        processAudioQueue();
      } else {
        setTimeout(checkSpeaking, 100);
      }
    };
    setTimeout(checkSpeaking, 100);
  }, []);

  const handleToolCall = async (call: any) => {
    console.log("Tool call received:", call);
    const { name, args, id } = call;

    if (name === "sendNotification") {
      try {
        const response = await fetch('/api/notify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(args),
        });
        const result = await response.json();
        return { name, response: result, id };
      } catch (err) {
        return { name, response: { error: "Failed to send notification" }, id };
      }
    }

    if (name === "scheduleSiteVisit") {
      try {
        const scheduleResponse = await fetch('/api/calendar/schedule', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            startTime: args.startTime,
            endTime: args.endTime,
            summary: `Site Visit: ${args.customerName}`,
            description: `Project: ${args.project}`,
          }),
        });
        const result = await scheduleResponse.json();
        return { name, response: result, id };
      } catch (err) {
        return { name, response: { error: "Failed to schedule site visit" }, id };
      }
    }

    return { name, response: { error: "Unknown tool" }, id };
  };

  const startSession = async () => {
    try {
      setIsConnecting(true);
      setError(null);
      setTranscription("");
      
      await setupAudioInput();

      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      
      const session = await ai.live.connect({
        model: "gemini-3.1-flash-live-preview",
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } },
          },
          systemInstruction: `${PRIYA_SYSTEM_INSTRUCTION}\n\nCURRENT DATE AND TIME: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: 'numeric' })}\nUSER TIMEZONE: Asia/Kolkata`,
          // @ts-ignore - Standard Stable VAD
          automaticActivityDetection: {
            silenceDurationMs: 1000,
            startOfSpeechSensitivity: 0.5,
            endOfSpeechSensitivity: 0.5,
          },
          // @ts-ignore - Fallback turn detection key
          turnDetection: {
            automatic: {
              silenceDurationMs: 1000,
            },
          },
          // @ts-ignore - Flattened generationConfig as requested by runtime.
          candidateCount: 1,
          maxOutputTokens: 100,
          temperature: 0.5,
          topP: 0.8,
          topK: 40,
          tools: [
            { functionDeclarations: [SEND_NOTIFICATION_TOOL, SCHEDULE_SITE_VISIT_TOOL] }
          ],
        },
        callbacks: {
          onopen: () => {
            setIsConnected(true);
            setIsConnecting(false);
            if (sessionRef.current) {
              sessionRef.current.sendRealtimeInput({ text: "Say exactly this: Thank you for calling Alliance Square, how can I help you today?" });
            }
          },
          onmessage: async (message: LiveServerMessage) => {
            if (message.serverContent?.modelTurn?.parts) {
              for (const part of message.serverContent.modelTurn.parts) {
                if (part.inlineData?.data) {
                  const binaryString = atob(part.inlineData.data);
                  const bytes = new Uint8Array(binaryString.length);
                  for (let i = 0; i < binaryString.length; i++) {
                    bytes[i] = binaryString.charCodeAt(i);
                  }
                  audioQueueRef.current.push(new Int16Array(bytes.buffer));
                  processAudioQueue();
                }
              }
            }

            if (message.serverContent?.inputTranscription) {
              setTranscription(message.serverContent.inputTranscription.text || "");
            }

            if (message.toolCall) {
              const toolResponses = [];
              for (const call of message.toolCall.functionCalls) {
                const response = await handleToolCall(call);
                toolResponses.push(response);
              }
              sessionRef.current.sendToolResponse({ functionResponses: toolResponses });
            }

            if (message.serverContent?.interrupted) {
              audioQueueRef.current = [];
              activeSourcesRef.current.forEach(source => {
                try { source.stop(); } catch (e) {}
              });
              activeSourcesRef.current.clear();
              nextStartTimeRef.current = 0;
              setIsSpeaking(false);
            }
          },
          onclose: () => cleanup(),
          onerror: (err) => {
            console.error("Live API Error:", err);
            setError("Connection error. Please try again.");
            cleanup();
          }
        }
      });

      sessionRef.current = session;
      
      // Disable the mic for a tiny moment so room noise doesn't interrupt her before she can even speak!
      initialMuteRef.current = true;
      setTimeout(() => {
        initialMuteRef.current = false;
      }, 200);

    } catch (err) {
      console.error("Failed to start session:", err);
      setError("Failed to connect to Priya. Please check your microphone and try again.");
      setIsConnecting(false);
    }
  };

  const setupAudioInput = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      
      audioContextRef.current = new AudioContext({ 
        sampleRate: 16000,
        latencyHint: 'interactive'
      });
      if (audioContextRef.current.state === 'suspended') {
        await audioContextRef.current.resume();
      }
      await audioContextRef.current.audioWorklet.addModule(
        URL.createObjectURL(new Blob([`
          class AudioProcessor extends AudioWorkletProcessor {
            process(inputs, outputs, parameters) {
              const input = inputs[0][0];
              if (input) {
                const int16Data = new Int16Array(input.length);
                let sum = 0;
                for (let i = 0; i < input.length; i++) {
                  int16Data[i] = Math.max(-1, Math.min(1, input[i])) * 0x7FFF;
                  sum += Math.abs(input[i]);
                }
                const avg = sum / input.length;
                this.port.postMessage({ buffer: int16Data.buffer, volume: avg }, [int16Data.buffer]);
              }
              return true;
            }
          }
          registerProcessor('audio-processor', AudioProcessor);
        `], { type: 'application/javascript' }))
      );

      const source = audioContextRef.current.createMediaStreamSource(stream);
      audioWorkletNodeRef.current = new AudioWorkletNode(audioContextRef.current, 'audio-processor');
      
      audioWorkletNodeRef.current.port.onmessage = (event) => {
        const { buffer, volume: vol } = event.data;
        setVolume(vol);

        if (sessionRef.current && !isMuted && !initialMuteRef.current) {
          const uint8 = new Uint8Array(buffer);
          let binary = '';
          for (let i = 0; i < uint8.length; i++) binary += String.fromCharCode(uint8[i]);
          const base64Data = btoa(binary);
          
          sessionRef.current.sendRealtimeInput({
            audio: { data: base64Data, mimeType: 'audio/pcm;rate=16000' }
          });
          
          lastAudioTimeRef.current = Date.now();
          setIsListening(true);
        }
      };

      const silenceInterval = setInterval(() => {
        if (Date.now() - lastAudioTimeRef.current > 1000) setIsListening(false);
      }, 500);

      source.connect(audioWorkletNodeRef.current);
      return () => clearInterval(silenceInterval);
    } catch (err) {
      console.error("Microphone access error:", err);
      setError("Microphone access denied.");
    }
  };

  const cleanup = () => {
    setIsConnected(false);
    setIsConnecting(false);
    setIsSpeaking(false);
    setIsListening(false);
    
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    if (sessionRef.current) {
      sessionRef.current.close();
      sessionRef.current = null;
    }

    activeSourcesRef.current.forEach(source => {
      try { source.stop(); } catch (e) {}
    });
    activeSourcesRef.current.clear();
    nextStartTimeRef.current = 0;

    audioQueueRef.current = [];
  };

  return (
    <div className="min-h-screen bg-[#F5F2ED] text-[#2D2926] font-['Outfit',sans-serif] selection:bg-[#D4AF37]/20 selection:text-[#D4AF37] overflow-x-hidden">
      {/* Navigation Toggle */}
      <div className="fixed top-6 right-6 z-[100] flex gap-2">
        <button
          onClick={() => setCurrentView(currentView === 'agent' ? 'crm' : 'agent')}
          className="flex items-center gap-2 px-5 py-2.5 rounded-2xl bg-white/70 backdrop-blur-md border border-white shadow-xl shadow-black/5 hover:bg-white transition-all group"
        >
          {currentView === 'agent' ? (
            <>
              <LayoutDashboard size={18} className="text-[#D4AF37]" />
              <span className="text-sm font-semibold text-[#5C5852]">Lead Dashboard</span>
            </>
          ) : (
            <>
              <Phone size={18} className="text-[#D4AF37]" />
              <span className="text-sm font-semibold text-[#5C5852]">Back to Agent</span>
            </>
          )}
        </button>
      </div>

      {currentView === 'crm' ? (
        <CRM />
      ) : (
        <div className="max-w-4xl mx-auto px-4 pt-20 pb-32">
          {/* Header */}
          <header className="fixed top-0 left-0 right-0 h-20 px-6 flex items-center justify-between z-40 bg-[#FDFCF9]/80 backdrop-blur-md border-b border-[#E5E1DA]">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-full bg-[#D4AF37] flex items-center justify-center text-white shadow-lg shadow-[#D4AF37]/20">
                <Building2 size={20} />
              </div>
              <div>
                <h1 className="text-lg font-semibold tracking-tight">Priya</h1>
                <div className="flex items-center gap-1.5">
                  <span className={cn("w-2 h-2 rounded-full", isConnected ? "bg-green-500 animate-pulse" : "bg-gray-300")} />
                  <span className="text-[10px] uppercase tracking-widest font-bold text-[#8E8B82]">
                    {isConnected ? "Live Connection" : "Offline"}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button 
                onClick={() => setShowInfo(!showInfo)}
                className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-[#E5E1DA] transition-colors text-[#5C5852]"
              >
                <Info size={20} />
              </button>
            </div>
          </header>

          {/* Main Content */}
          <main className="pt-20 pb-32 min-h-screen flex flex-col items-center justify-center px-6">
            <div className="relative w-full max-w-lg aspect-square flex items-center justify-center">
              <div className="absolute inset-0 flex items-center justify-center opacity-20">
                <div className="w-[120%] h-[120%] border border-[#D4AF37] rounded-full animate-[spin_60s_linear_infinite]" />
                <div className="absolute w-[100%] h-[100%] border border-[#D4AF37] rounded-full animate-[spin_45s_linear_infinite_reverse]" />
              </div>

              <div className="relative z-10 w-64 h-64 flex items-center justify-center">
                <AnimatePresence mode="wait">
                  {!isConnected && !isConnecting ? (
                    <motion.div
                      key="idle"
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 1.1 }}
                      className="text-center"
                    >
                      <div className="w-32 h-32 rounded-full bg-[#D4AF37] flex items-center justify-center mx-auto mb-6 shadow-2xl shadow-[#D4AF37]/40">
                        <Phone size={40} className="text-white" />
                      </div>
                      <h2 className="text-2xl font-serif italic text-[#2D2926] mb-2">Ready to talk?</h2>
                      <p className="text-sm text-[#8E8B82] max-w-[200px] mx-auto">Priya is available to help with your property search.</p>
                    </motion.div>
                  ) : (
                    <motion.div
                      key="active"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="relative w-full h-full flex items-center justify-center"
                    >
                      <div className={cn(
                        "absolute inset-0 rounded-full border-2 border-[#D4AF37]/30 transition-all duration-1000",
                        (isSpeaking || isListening) && "animate-ping"
                      )} />
                      <div className={cn(
                        "absolute inset-4 rounded-full border border-[#D4AF37]/20 transition-all duration-1000 delay-150",
                        (isSpeaking || isListening) && "animate-ping"
                      )} />
                      
                      <AudioVisualizer isSpeaking={isSpeaking} isListening={isListening} />

                      <div className="absolute -bottom-16 left-0 right-0 text-center">
                        <p className="text-[10px] uppercase tracking-[0.2em] font-bold text-[#D4AF37]">
                          {isSpeaking ? "Priya is speaking..." : isListening ? "Priya is listening" : "Connected"}
                        </p>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>

            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 10 }}
                  className="fixed bottom-36 px-4 py-2 rounded-lg bg-red-50 border border-red-100 text-red-600 text-xs font-medium flex items-center gap-2"
                >
                  <X size={14} className="cursor-pointer" onClick={() => setError(null)} />
                  {error}
                </motion.div>
              )}
            </AnimatePresence>
          </main>

          <footer className="fixed bottom-0 left-0 right-0 p-8 flex justify-center z-40">
            <div className="bg-[#2D2926] rounded-full px-8 py-4 flex items-center gap-8 shadow-2xl shadow-black/20 border border-white/5">
              {!isConnected ? (
                <button
                  onClick={startSession}
                  disabled={isConnecting}
                  className="flex items-center gap-3 bg-[#D4AF37] hover:bg-[#C5A028] text-white px-8 py-3 rounded-full font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-[#D4AF37]/20"
                >
                  {isConnecting ? (
                    <>
                      <Loader2 size={20} className="animate-spin" />
                      <span>Connecting...</span>
                    </>
                  ) : (
                    <>
                      <Phone size={20} />
                      <span>Talk to Priya</span>
                    </>
                  )}
                </button>
              ) : (
                <>
                  <button
                    onClick={() => setIsMuted(!isMuted)}
                    className={cn(
                      "w-12 h-12 rounded-full flex items-center justify-center transition-all",
                      isMuted ? "bg-red-500/20 text-red-500" : "bg-white/10 text-white hover:bg-white/20"
                    )}
                  >
                    {isMuted ? <MicOff size={20} /> : <Mic size={20} />}
                  </button>

                  <button
                    onClick={cleanup}
                    className="bg-red-500 hover:bg-red-600 text-white px-8 py-3 rounded-full font-bold transition-all shadow-lg shadow-red-500/20"
                  >
                    End Call
                  </button>

                  <div className="flex items-center gap-3 text-white/40">
                    <div className="flex items-center gap-1 h-4">
                      {[...Array(5)].map((_, i) => (
                        <motion.div
                          key={i}
                          animate={{ 
                            height: isConnected && !isMuted ? `${Math.max(4, volume * 100 * (1 + Math.random()))}px` : '4px' 
                          }}
                          className="w-1 bg-[#D4AF37] rounded-full"
                        />
                      ))}
                    </div>
                    <Volume2 size={18} />
                  </div>
                </>
              )}
            </div>
          </footer>

          <AnimatePresence>
            {showInfo && (
              <>
                <motion.div
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  onClick={() => setShowInfo(false)}
                  className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50"
                />
                <motion.div
                  initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
                  className="fixed top-0 right-0 bottom-0 w-full max-w-md bg-[#FDFCF9] z-50 shadow-2xl p-8 overflow-y-auto"
                >
                  <div className="flex items-center justify-between mb-12">
                    <h3 className="text-2xl font-serif italic text-[#2D2926]">About Alliance Square</h3>
                    <X className="cursor-pointer" onClick={() => setShowInfo(false)} />
                  </div>
                  <div className="space-y-10">
                    <section>
                      <h4 className="text-[10px] uppercase tracking-[0.2em] font-bold text-[#D4AF37] mb-4">Our Legacy</h4>
                      <p className="text-[#5C5852] leading-relaxed">
                        Pioneering Mysuru's real estate for over 20 years, we've helped 25,000+ families find their home.
                      </p>
                    </section>
                    <section>
                      <h4 className="text-[10px] uppercase tracking-[0.2em] font-bold text-[#D4AF37] mb-4">Key Projects</h4>
                      <div className="grid gap-4">
                        {[{ name: "Alliance Serene", loc: "Bannur Road" }, { name: "Dhatri Square", loc: "Hunsur Road" }].map((p, i) => (
                          <div key={i} className="p-4 rounded-2xl bg-[#E5E1DA]/30 border border-[#E5E1DA]">
                            <span className="font-semibold text-[#2D2926]">{p.name}</span>
                            <div className="text-xs text-[#8E8B82]">{p.loc}</div>
                          </div>
                        ))}
                      </div>
                    </section>
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

function AudioVisualizer({ isSpeaking, isListening }: AudioVisualizerProps) {
  return (
    <div className="flex items-center gap-1.5 h-12">
      {[...Array(12)].map((_, i) => (
        <motion.div
          key={i}
          animate={{ height: isSpeaking || isListening ? [12, 48, 12] : 4, opacity: isSpeaking || isListening ? 1 : 0.3 }}
          transition={{ duration: 0.8, repeat: Infinity, delay: i * 0.05 }}
          className="w-1.5 bg-[#D4AF37] rounded-full"
        />
      ))}
    </div>
  );
}
