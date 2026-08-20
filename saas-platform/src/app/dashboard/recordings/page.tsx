"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Mic,
  PhoneIncoming,
  PhoneOutgoing,
  Search,
  Loader2,
  Play,
  Clock,
  MessageSquare,
  X,
  RefreshCw,
  Headphones,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { DashboardShell, DashboardCard, StatCard } from "@/components/dashboard/Shell";

type RecordingItem = {
  callId: string;
  phone: string | null;
  outbound: boolean;
  startedAt: string;
  endedAt: string | null;
  durationSec: number | null;
  turnCount: number;
  hasAudio: boolean;
};

type ConversationTurn = {
  speaker: "customer" | "ai";
  text: string;
  timestamp: string;
};

type RecordingDetail = RecordingItem & {
  conversation: ConversationTurn[];
};

function formatDuration(sec: number | null): string {
  if (sec == null) return "—";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function formatWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default function RecordingsPage() {
  const [recordings, setRecordings] = useState<RecordingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "outbound" | "inbound">("all");
  const [selected, setSelected] = useState<RecordingDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const fetchRecordings = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/recordings");
      const data = await res.json();
      if (data.success) setRecordings(data.recordings || []);
    } catch (e) {
      console.error("Failed to load recordings", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRecordings();
    const interval = setInterval(fetchRecordings, 20000);
    return () => clearInterval(interval);
  }, [fetchRecordings]);

  const filtered = useMemo(() => {
    const q = search.replace(/\D/g, "").slice(-10);
    return recordings.filter((r) => {
      if (filter === "outbound" && !r.outbound) return false;
      if (filter === "inbound" && r.outbound) return false;
      if (!q) return true;
      const tail = (r.phone || "").replace(/\D/g, "").slice(-10);
      return tail.includes(q);
    });
  }, [recordings, search, filter]);

  const stats = useMemo(() => {
    const withAudio = recordings.filter((r) => r.hasAudio).length;
    const outbound = recordings.filter((r) => r.outbound).length;
    const totalSec = recordings.reduce((a, r) => a + (r.durationSec || 0), 0);
    return {
      total: recordings.length,
      withAudio,
      outbound,
      inbound: recordings.length - outbound,
      totalMin: Math.round(totalSec / 60),
    };
  }, [recordings]);

  const openDetail = async (item: RecordingItem) => {
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/recordings/${item.callId}`);
      const data = await res.json();
      if (data.success && data.recording) {
        setSelected({
          ...item,
          conversation: data.recording.conversation || [],
        });
      }
    } catch (e) {
      console.error(e);
    } finally {
      setDetailLoading(false);
    }
  };

  return (
    <>
      <DashboardShell
        title="Call Recordings"
        subtitle="Stereo WAV files and live transcripts from every inbound and outbound call"
        actions={
          <button
            type="button"
            onClick={fetchRecordings}
            disabled={loading}
            className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 px-4 sm:px-5 py-2.5 rounded-2xl flex items-center justify-center gap-2 hover:shadow-md transition-all dark:text-stone-200 text-sm font-semibold disabled:opacity-50 min-h-[44px] w-full sm:w-auto"
          >
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
        }
      >
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 lg:gap-6 mb-6 sm:mb-10">
          <StatCard label="Total Calls" value={String(stats.total)} icon={Mic} color="text-gold" delay={0} />
          <StatCard label="Outbound" value={String(stats.outbound)} icon={PhoneOutgoing} color="text-blue-500" delay={50} />
          <StatCard label="Inbound" value={String(stats.inbound)} icon={PhoneIncoming} color="text-emerald-500" delay={100} />
          <StatCard label="Talk Time" value={`${stats.totalMin}m`} icon={Clock} color="text-purple-500" delay={150} />
        </div>

        <DashboardCard
          title="Conversation Archive"
          subtitle={`${filtered.length} recording${filtered.length === 1 ? "" : "s"} · customer L · AI R`}
          actions={
            <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 w-full">
              <div className="relative flex-1 min-w-0">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
                <input
                  type="text"
                  placeholder="Search phone…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9 pr-4 py-2.5 bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-gold/30 w-full min-h-[44px]"
                />
              </div>
              <div className="flex rounded-xl overflow-hidden border border-stone-200 dark:border-stone-700 text-xs font-bold w-full sm:w-auto">
                {(["all", "outbound", "inbound"] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setFilter(f)}
                    className={`flex-1 sm:flex-none px-3 sm:px-4 py-2.5 capitalize transition-colors min-h-[44px] ${
                      filter === f
                        ? "gold-gradient text-white"
                        : "bg-stone-50 dark:bg-stone-800 text-stone-500 hover:text-stone-800 dark:hover:text-stone-200"
                    }`}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>
          }
        >
          {loading && recordings.length === 0 ? (
            <div className="py-24 flex flex-col items-center gap-3 text-stone-400">
              <Loader2 className="animate-spin text-gold" size={36} />
              <p className="text-xs font-bold uppercase tracking-widest">Loading recordings…</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-16 sm:py-24 flex flex-col items-center gap-4 text-stone-400 px-4 sm:px-8 text-center">
              <Headphones size={48} className="opacity-20" />
              <p className="font-medium text-stone-600 dark:text-stone-300">No recordings yet</p>
              <p className="text-sm max-w-md">
                After a call ends, the stereo WAV and transcript appear here automatically.
              </p>
            </div>
          ) : (
            <>
              {/* Mobile / tablet cards */}
              <div className="md:hidden divide-y divide-stone-100 dark:divide-stone-800">
                {filtered.map((r) => (
                  <button
                    key={r.callId}
                    type="button"
                    onClick={() => openDetail(r)}
                    className="w-full text-left p-4 active:bg-stone-50 dark:active:bg-stone-800/40 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-mono text-sm dark:text-stone-200 truncate">{r.phone || "—"}</p>
                        <p className="text-[11px] text-stone-500 mt-1">{formatWhen(r.startedAt)}</p>
                      </div>
                      <span
                        className={`shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-wider ${
                          r.outbound
                            ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                            : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                        }`}
                      >
                        {r.outbound ? <PhoneOutgoing size={10} /> : <PhoneIncoming size={10} />}
                        {r.outbound ? "Out" : "In"}
                      </span>
                    </div>
                    <div className="mt-3 flex items-center justify-between text-[11px] text-stone-500">
                      <span className="flex items-center gap-3">
                        <span className="inline-flex items-center gap-1"><Clock size={12} />{formatDuration(r.durationSec)}</span>
                        <span className="inline-flex items-center gap-1"><MessageSquare size={12} />{r.turnCount}</span>
                      </span>
                      <span className="inline-flex items-center gap-1.5 text-gold font-bold uppercase tracking-wider">
                        <Play size={12} />
                        {r.hasAudio ? "Play" : "View"}
                      </span>
                    </div>
                  </button>
                ))}
              </div>

              {/* Desktop table */}
              <div className="hidden md:block overflow-x-auto dashboard-scroll">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-stone-50/80 dark:bg-stone-800/40 text-stone-400 text-[10px] font-black uppercase tracking-[0.2em]">
                      <th className="px-4 lg:px-6 py-4">When</th>
                      <th className="px-4 lg:px-6 py-4">Phone</th>
                      <th className="px-4 lg:px-6 py-4">Direction</th>
                      <th className="px-4 lg:px-6 py-4">Duration</th>
                      <th className="px-4 lg:px-6 py-4">Turns</th>
                      <th className="px-4 lg:px-6 py-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
                    {filtered.map((r) => (
                      <tr
                        key={r.callId}
                        onClick={() => openDetail(r)}
                        className="hover:bg-stone-50 dark:hover:bg-stone-800/30 cursor-pointer transition-colors group"
                      >
                        <td className="px-4 lg:px-6 py-4 text-sm text-stone-600 dark:text-stone-300 whitespace-nowrap">
                          {formatWhen(r.startedAt)}
                        </td>
                        <td className="px-4 lg:px-6 py-4 font-mono text-sm dark:text-stone-200">
                          {r.phone || "—"}
                        </td>
                        <td className="px-4 lg:px-6 py-4">
                          <span
                            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${
                              r.outbound
                                ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                                : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                            }`}
                          >
                            {r.outbound ? <PhoneOutgoing size={12} /> : <PhoneIncoming size={12} />}
                            {r.outbound ? "Outbound" : "Inbound"}
                          </span>
                        </td>
                        <td className="px-4 lg:px-6 py-4 text-sm text-stone-500">{formatDuration(r.durationSec)}</td>
                        <td className="px-4 lg:px-6 py-4">
                          <span className="inline-flex items-center gap-1 text-sm text-stone-500">
                            <MessageSquare size={14} />
                            {r.turnCount}
                          </span>
                        </td>
                        <td className="px-4 lg:px-6 py-4 text-right">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              openDetail(r);
                            }}
                            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-stone-100 dark:bg-stone-800 text-gold text-xs font-bold uppercase tracking-wider opacity-80 group-hover:opacity-100 hover:bg-gold/10 transition-all"
                          >
                            <Play size={14} />
                            {r.hasAudio ? "Play" : "Transcript"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </DashboardCard>
      </DashboardShell>

      <AnimatePresence>
        {(selected || detailLoading) && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 lg:p-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => !detailLoading && setSelected(null)}
              className="absolute inset-0 bg-stone-900/60 backdrop-blur-md"
            />
            <motion.div
              initial={{ opacity: 0, y: 24, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 24, scale: 0.98 }}
              className="bg-white dark:bg-stone-900 w-full max-w-2xl max-h-[92vh] rounded-t-3xl sm:rounded-3xl shadow-2xl relative z-10 flex flex-col overflow-hidden"
            >
              {detailLoading || !selected ? (
                <div className="p-16 flex flex-col items-center gap-3">
                  <Loader2 className="animate-spin text-gold" size={32} />
                  <p className="text-sm text-stone-500">Loading transcript…</p>
                </div>
              ) : (
                <>
                  <div className="p-4 sm:p-6 lg:p-8 border-b border-stone-100 dark:border-stone-800 flex justify-between items-start gap-3">
                    <div className="min-w-0">
                      <p className="text-[10px] font-black uppercase tracking-widest text-gold mb-1">
                        {selected.outbound ? "Outbound call" : "Inbound call"}
                      </p>
                      <h2 className="text-xl sm:text-2xl font-serif font-bold dark:text-white truncate">
                        {selected.phone || "Unknown number"}
                      </h2>
                      <p className="text-xs sm:text-sm text-stone-500 mt-1">
                        {formatWhen(selected.startedAt)} · {formatDuration(selected.durationSec)}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelected(null)}
                      className="p-2.5 hover:bg-stone-100 dark:hover:bg-stone-800 rounded-xl shrink-0 min-h-[44px] min-w-[44px] flex items-center justify-center"
                    >
                      <X size={22} className="text-stone-400" />
                    </button>
                  </div>

                  {selected.hasAudio && (
                    <div className="px-4 sm:px-6 lg:px-8 pt-4 sm:pt-6">
                      <p className="text-[10px] font-black uppercase tracking-widest text-stone-400 mb-2">
                        Recording (L = customer · R = AI)
                      </p>
                      <audio
                        controls
                        className="w-full rounded-xl"
                        src={`/api/recordings/${selected.callId}/audio`}
                      />
                    </div>
                  )}

                  <div className="p-4 sm:p-6 lg:p-8 overflow-y-auto flex-1 space-y-3 sm:space-y-4">
                    <p className="text-[10px] font-black uppercase tracking-widest text-stone-400">
                      Conversation
                    </p>
                    {selected.conversation.length === 0 ? (
                      <p className="text-sm text-stone-400 italic py-8 text-center">No transcript captured.</p>
                    ) : (
                      selected.conversation.map((turn, i) => (
                        <div
                          key={i}
                          className={`flex ${turn.speaker === "customer" ? "justify-start" : "justify-end"}`}
                        >
                          <div
                            className={`max-w-[90%] sm:max-w-[85%] rounded-2xl px-3.5 sm:px-4 py-2.5 sm:py-3 text-sm leading-relaxed ${
                              turn.speaker === "customer"
                                ? "bg-stone-100 dark:bg-stone-800 text-stone-800 dark:text-stone-200 rounded-bl-md"
                                : "gold-gradient text-white rounded-br-md shadow-md"
                            }`}
                          >
                            <p className="text-[9px] font-black uppercase tracking-wider opacity-70 mb-1">
                              {turn.speaker === "customer" ? "Customer" : "Bhoomi"} · {turn.timestamp}
                            </p>
                            {turn.text}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
