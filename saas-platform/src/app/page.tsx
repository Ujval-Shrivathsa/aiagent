import Link from "next/link";
import { ArrowRight, PhoneCall, Zap, Shield, Sparkles } from "lucide-react";

export default function Home() {
  return (
    <div className="min-h-screen bg-stone-50 dark:bg-stone-950 flex flex-col items-center justify-center p-6 relative overflow-hidden text-stone-900 dark:text-stone-100">
      {/* Background Orbs */}
      <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-gold/10 rounded-full blur-[120px]" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-amber-500/5 rounded-full blur-[120px]" />

      <main className="max-w-5xl w-full relative z-10 flex flex-col items-center text-center">
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-stone-200/50 dark:bg-stone-900/50 border border-stone-300/50 dark:border-stone-800 backdrop-blur-sm text-sm font-medium mb-12 animate-fade-in shadow-inner">
          <Sparkles className="text-gold" size={16} />
          <span>Next Generation AI Calling Platform</span>
        </div>

        <h1 className="text-6xl md:text-8xl font-serif font-bold tracking-tight mb-8 leading-[1.1]">
          Power your sales with <br />
          <span className="text-gold">Outbound AI</span>
        </h1>
        
        <p className="text-xl md:text-2xl text-stone-500 dark:text-stone-400 mb-12 max-w-2xl leading-relaxed">
          Priya is your intelligent, empathetic voice agent that calls leads, understands needs, and scales your business effortlessly.
        </p>

        <div className="flex flex-col sm:flex-row gap-6 mb-20 w-full sm:w-auto">
          <Link 
            href="/auth/signup"
            className="gold-gradient text-white px-10 py-5 rounded-3xl font-bold text-lg shadow-2xl shadow-gold/20 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-2"
          >
            Start Your Campaign <ArrowRight size={20} />
          </Link>
          <Link 
            href="/auth/login"
            className="bg-[#2D2926] text-white px-10 py-5 rounded-3xl font-bold text-lg shadow-xl hover:bg-black hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center"
          >
            Sign In
          </Link>
        </div>

        {/* Feature Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 w-full border-t border-stone-200 dark:border-stone-800 pt-20">
          <div className="flex flex-col items-center p-6">
            <div className="w-14 h-14 rounded-2xl bg-stone-100 dark:bg-stone-900 border border-stone-200 dark:border-stone-800 flex items-center justify-center text-gold mb-6 shadow-sm">
              <Zap size={28} />
            </div>
            <h3 className="text-xl font-bold mb-3">Instant Scaling</h3>
            <p className="text-stone-500 text-sm">Upload a CSV and let Priya handle 1,000+ calls simultaneously with zero latency.</p>
          </div>
          <div className="flex flex-col items-center p-6">
            <div className="w-14 h-14 rounded-2xl bg-stone-100 dark:bg-stone-900 border border-stone-200 dark:border-stone-800 flex items-center justify-center text-gold mb-6 shadow-sm">
              <PhoneCall size={28} />
            </div>
            <h3 className="text-xl font-bold mb-3">Natural Voice</h3>
            <p className="text-stone-500 text-sm">Human-like intonation that builds trust and empathy with your customers from the first word.</p>
          </div>
          <div className="flex flex-col items-center p-6">
            <div className="w-14 h-14 rounded-2xl bg-stone-100 dark:bg-stone-900 border border-stone-200 dark:border-stone-800 flex items-center justify-center text-gold mb-6 shadow-sm">
              <Shield size={28} />
            </div>
            <h3 className="text-xl font-bold mb-3">Secure & Robust</h3>
            <p className="text-stone-500 text-sm">Enterprise-grade security for your lead data and campaign telemetry.</p>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="mt-20 py-10 border-t border-stone-200 dark:border-stone-800 w-full max-w-5xl flex justify-between items-center opacity-50 text-xs font-bold uppercase tracking-widest">
        <span>© 2026 Alliance Square Properties</span>
        <div className="flex gap-8">
          <span>Privacy Policy</span>
          <span>Terms of Service</span>
        </div>
      </footer>
    </div>
  );
}
