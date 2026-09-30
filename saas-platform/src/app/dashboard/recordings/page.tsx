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
import { motion, AnimatePresence } from "motion/react";
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
            className="btn-secondary w-full sm:w-auto"
          >
            <RefreshCw size={16} strokeWidth={1.75} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
        }
      >
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-8 sm:mb-10">
          <StatCard label="Total Calls" value={String(stats.total)} icon={Mic} delay={0} />
          <StatCard label="Outbound" value={String(stats.outbound)} icon={PhoneOutgoing} delay={50} />
          <StatCard label="Inbound" value={String(stats.inbound)} icon={PhoneIncoming} delay={100} />
          <StatCard label="Talk Time" value={`${stats.totalMin}m`} icon={Clock} delay={150} />
        </div>

        <DashboardCard
          title="Conversation Archive"
          subtitle={`${filtered.length} recording${filtered.length === 1 ? "" : "s"} · customer L · AI R`}
          actions={
            <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 w-full">
              <div className="relative flex-1 min-w-0">
                <Search size={16} strokeWidth={1.75} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                <input
                  type="text"
                  placeholder="Search phone…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9 pr-4 py-2.5 bg-white border border-neutral-200 rounded-full text-sm input-base w-full min-h-[44px]"
                />
              </div>
              <div className="inline-flex bg-neutral-100 rounded-full p-1 w-full sm:w-auto">
                {(["all", "outbound", "inbound"] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setFilter(f)}
                    className={`flex-1 sm:flex-none px-4 py-1.5 rounded-full text-sm font-medium capitalize transition-colors min-h-[36px] ${
                      filter === f
                        ? "bg-white text-neutral-900"
                        : "text-neutral-500 hover:text-neutral-900"
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
            <div className="py-24 flex flex-col items-center gap-3 text-neutral-400">
              <Loader2 className="animate-spin" size={32} />
              <p className="section-label">Loading recordings…</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-16 sm:py-24 flex flex-col items-center gap-4 text-neutral-400 px-4 sm:px-8 text-center">
              <Headphones size={44} strokeWidth={1.5} className="opacity-30" />
              <p className="font-medium text-neutral-600">No recordings yet</p>
              <p className="text-sm max-w-md">
                After a call ends, the stereo WAV and transcript appear here automatically.
              </p>
            </div>
          ) : (
            <>
              {/* Mobile / tablet cards */}
              <div className="md:hidden divide-y divide-neutral-100">
                {filtered.map((r) => (
                  <button
                    key={r.callId}
                    type="button"
                    onClick={() => openDetail(r)}
                    className="w-full text-left p-4 active:bg-neutral-50 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-mono text-sm text-neutral-900 truncate">{r.phone || "—"}</p>
                        <p className="text-[11px] text-neutral-500 mt-1">{formatWhen(r.startedAt)}</p>
                      </div>
                      <span
                        className={`shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${
                          r.outbound
                            ? "bg-neutral-900 text-white"
                            : "bg-neutral-100 text-neutral-600"
                        }`}
                      >
                        {r.outbound ? <PhoneOutgoing size={11} strokeWidth={1.75} /> : <PhoneIncoming size={11} strokeWidth={1.75} />}
                        {r.outbound ? "Out" : "In"}
                      </span>
                    </div>
                    <div className="mt-3 flex items-center justify-between text-[11px] text-neutral-500">
                      <span className="flex items-center gap-3">
                        <span className="inline-flex items-center gap-1"><Clock size={12} strokeWidth={1.75} />{formatDuration(r.durationSec)}</span>
                        <span className="inline-flex items-center gap-1"><MessageSquare size={12} />{r.turnCount}</span>
                      </span>
                      <span className="inline-flex items-center gap-1.5 text-neutral-900 font-medium">
                        <Play size={12} strokeWidth={1.75} />
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
                    <tr className="bg-neutral-50 text-neutral-400 text-xs">
                      <th className="px-4 lg:px-6 py-4 font-normal">When</th>
                      <th className="px-4 lg:px-6 py-4 font-normal">Phone</th>
                      <th className="px-4 lg:px-6 py-4 font-normal">Direction</th>
                      <th className="px-4 lg:px-6 py-4 font-normal">Duration</th>
                      <th className="px-4 lg:px-6 py-4 font-normal">Turns</th>
                      <th className="px-4 lg:px-6 py-4 text-right font-normal">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {filtered.map((r) => (
                      <tr
                        key={r.callId}
                        onClick={() => openDetail(r)}
                        className="hover:bg-neutral-50 cursor-pointer transition-colors group"
                      >
                        <td className="px-4 lg:px-6 py-4 text-sm text-neutral-600 whitespace-nowrap">
                          {formatWhen(r.startedAt)}
                        </td>
                        <td className="px-4 lg:px-6 py-4 font-mono text-sm text-neutral-900">
                          {r.phone || "—"}
                        </td>
                        <td className="px-4 lg:px-6 py-4">
                          <span
                            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium ${
                              r.outbound
                                ? "bg-neutral-900 text-white"
                                : "bg-neutral-100 text-neutral-600"
                            }`}
                          >
                            {r.outbound ? <PhoneOutgoing size={12} strokeWidth={1.75} /> : <PhoneIncoming size={12} strokeWidth={1.75} />}
                            {r.outbound ? "Outbound" : "Inbound"}
                          </span>
                        </td>
                        <td className="px-4 lg:px-6 py-4 text-sm text-neutral-500">{formatDuration(r.durationSec)}</td>
                        <td className="px-4 lg:px-6 py-4">
                          <span className="inline-flex items-center gap-1 text-sm text-neutral-500">
                            <MessageSquare size={14} strokeWidth={1.75} />
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
                            className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-neutral-900 text-white text-xs font-medium opacity-70 group-hover:opacity-100 hover:opacity-100 transition-opacity"
                          >
                            <Play size={13} strokeWidth={1.75} />
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
              className="absolute inset-0 bg-neutral-900/40"
            />
            <motion.div
              initial={{ opacity: 0, y: 24, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 24, scale: 0.98 }}
              className="bg-white w-full max-w-2xl max-h-[92vh] rounded-t-2xl sm:rounded-2xl relative z-10 flex flex-col overflow-hidden"
            >
              {detailLoading || !selected ? (
                <div className="p-16 flex flex-col items-center gap-3">
                  <Loader2 className="animate-spin text-neutral-400" size={28} />
                  <p className="text-sm text-neutral-500">Loading transcript…</p>
                </div>
              ) : (
                <>
                  <div className="p-4 sm:p-6 lg:p-8 border-b border-neutral-100 flex justify-between items-start gap-3">
                    <div className="min-w-0">
                      <p className="section-label mb-1">
                        {selected.outbound ? "Outbound call" : "Inbound call"}
                      </p>
                      <h2 className="text-xl sm:text-2xl font-semibold tracking-tight text-neutral-900 truncate">
                        {selected.phone || "Unknown number"}
                      </h2>
                      <p className="text-xs sm:text-sm text-neutral-500 mt-1">
                        {formatWhen(selected.startedAt)} · {formatDuration(selected.durationSec)}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelected(null)}
                      className="p-2.5 hover:bg-neutral-100 rounded-full transition-colors shrink-0 min-h-[44px] min-w-[44px] flex items-center justify-center"
                    >
                      <X size={20} strokeWidth={1.75} className="text-neutral-400" />
                    </button>
                  </div>

                  {selected.hasAudio && (
                    <div className="px-4 sm:px-6 lg:px-8 pt-4 sm:pt-6">
                      <p className="section-label mb-2">
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
                    <p className="section-label">
                      Conversation
                    </p>
                    {selected.conversation.length === 0 ? (
                      <p className="text-sm text-neutral-400 py-8 text-center">No transcript captured.</p>
                    ) : (
                      selected.conversation.map((turn, i) => (
                        <div
                          key={i}
                          className={`flex ${turn.speaker === "customer" ? "justify-start" : "justify-end"}`}
                        >
                          <div
                            className={`max-w-[90%] sm:max-w-[85%] rounded-2xl px-3.5 sm:px-4 py-2.5 sm:py-3 text-sm leading-relaxed ${
                              turn.speaker === "customer"
                                ? "bg-neutral-100 text-neutral-800 rounded-bl-md"
                                : "bg-neutral-900 text-white rounded-br-md"
                            }`}
                          >
                            <p className="text-[10px] font-medium uppercase tracking-wider opacity-60 mb-1">
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
