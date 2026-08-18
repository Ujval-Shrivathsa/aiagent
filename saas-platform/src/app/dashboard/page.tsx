"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import Link from "next/link";
import { 
  Users, 
  PhoneCall, 
  Plus, 
  FileUp, 
  Play, 
  Loader2,
  Trash2,
  ThumbsUp,
  Calendar,
  Clock,
  ArrowRight,
  TrendingUp,
  ShieldCheck,
  Zap,
  X,
  ChevronLeft,
  ChevronRight,
  Eye,
  Database,
  Search,
  Mic,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { DashboardShell, DashboardCard, StatCard } from "@/components/dashboard/Shell";
import { StatusBadge } from "@/components/dashboard/Sidebar";

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState<'overview' | 'interested'>('overview');
  const [leads, setLeads] = useState<any[]>([]);
  const [interestedLeads, setInterestedLeads] = useState<any[]>([]);
  const [isCalling, setIsCalling] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedLead, setSelectedLead] = useState<any>(null);
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [selectedLeads, setSelectedLeads] = useState<string[]>([]);
  const [newLead, setNewLead] = useState({ name: "", phone: "" });
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [leadRecording, setLeadRecording] = useState<{ callId: string; hasAudio: boolean } | null>(null);
  const [activeCampaignId] = useState<string>("default-campaign");
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchAllData();
    setIsLoading(false);
  }, []);

  useEffect(() => {
    if (!selectedLead?.phone) {
      setLeadRecording(null);
      return;
    }
    const digits = selectedLead.phone.replace(/\D/g, "").slice(-10);
    if (digits.length < 10) return;
    fetch(`/api/recordings?phone=${encodeURIComponent(selectedLead.phone)}`)
      .then((r) => r.json())
      .then((data) => {
        const first = data.recordings?.[0];
        if (first) setLeadRecording({ callId: first.callId, hasAudio: first.hasAudio });
        else setLeadRecording(null);
      })
      .catch(() => setLeadRecording(null));
  }, [selectedLead?.phone, selectedLead?.id]);

  useEffect(() => {
    fetchAllData(); // Initial fetch
    const interval = setInterval(fetchAllData, 15000); // Poll every 15s
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (selectedLead) {
      const updatedLead = leads.find(l => l.id === selectedLead.id);
      if (updatedLead && JSON.stringify(updatedLead) !== JSON.stringify(selectedLead)) {
        setSelectedLead(updatedLead);
      }
    }
  }, [leads, selectedLead]);

  const isFetchingRef = useRef(false);

  const fetchAllData = async () => {
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;
    try {
      const res = await fetch(`/api/leads?campaignId=${activeCampaignId}&includeInterested=true`);
      if (!res.ok) {
        console.error(`Fetch leads failed with status ${res.status}`);
        return;
      }
      const data = await res.json();
      if (data.success) {
        setLeads(data.leads);
        if (data.interestedLeads) {
          setInterestedLeads(data.interestedLeads);
        }
      }
    } catch (e) {
      console.error("Fetch error", e);
    } finally {
      isFetchingRef.current = false;
    }
  };

  const handleManualAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch("/api/leads", {
        method: "POST",
        body: JSON.stringify({ ...newLead, campaignId: activeCampaignId }),
        headers: { "Content-Type": "application/json" },
      });
      if (res.ok) {
        setIsModalOpen(false);
        setNewLead({ name: "", phone: "" });
        fetchAllData();
      }
    } catch (e) {
      console.error("Add error", e);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.append("file", file);
    formData.append("campaignId", activeCampaignId);
    try {
      const res = await fetch("/api/leads/upload", { method: "POST", body: formData });
      if (res.ok) fetchAllData();
    } catch (e) {
      console.error("Upload error", e);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this contact?")) return;
    try {
      const res = await fetch(`/api/leads?id=${id}`, { method: "DELETE" });
      if (res.ok) {
        fetchAllData();
      }
    } catch (e) {
      console.error("Delete error", e);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedLeads.length === 0) return;
    if (!confirm(`Are you sure you want to delete ${selectedLeads.length} contacts?`)) return;
    try {
      for (const id of selectedLeads) {
        await fetch(`/api/leads?id=${id}`, { method: "DELETE" });
      }
      setSelectedLeads([]);
      fetchAllData();
    } catch (e) {
      console.error("Bulk delete error", e);
    }
  };

  const toggleLeadSelection = (id: string) => {
    setSelectedLeads(prev => 
      prev.includes(id) ? prev.filter(l => l !== id) : [...prev, id]
    );
  };

  const startCampaign = async () => {
    setIsCalling(true);
    try {
      const startRes = await fetch("/api/campaign/start", {
        method: "POST",
        body: JSON.stringify({ campaignId: activeCampaignId }),
        headers: { "Content-Type": "application/json" },
      });
      const startData = await startRes.json().catch(() => ({}));
      if (!startRes.ok) {
        const message = startData.error || `Campaign start failed (${startRes.status})`;
        console.error("Campaign start failed", message);
        alert(message);
        setIsCalling(false);
        fetchAllData();
        return;
      }
      
      const interval = setInterval(async () => {
        try {
          const res = await fetch(`/api/leads?campaignId=${activeCampaignId}&includeInterested=true`);
          if (!res.ok) return;
          const data = await res.json();
          if (data.success) {
            setLeads(data.leads);
            if (data.interestedLeads) {
              setInterestedLeads(data.interestedLeads);
            }
            const callingCount = data.leads.filter((l: any) => l.status === 'calling').length;
            if (callingCount === 0) clearInterval(interval);
          }
        } catch (e) {
          console.error("Interval fetch error", e);
        }
      }, 2000);
      setTimeout(() => clearInterval(interval), 300000);
    } catch (e) {
      console.error("Campaign start error", e);
    } finally {
      setIsCalling(false);
    }
  };

  const getCalendarDays = () => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const days = [];
    for (let i = 0; i < firstDay; i++) days.push(null);
    for (let i = 1; i <= daysInMonth; i++) days.push(i);
    return days;
  };

  const getMeetingsForDay = (day: number) => {
    return leads.filter(lead => {
      if (!lead.appointmentTime) return false;
      const apptDate = new Date(lead.appointmentTime);
      return apptDate.getDate() === day && 
             apptDate.getMonth() === currentMonth.getMonth() &&
             apptDate.getFullYear() === currentMonth.getFullYear();
    });
  };

  const filteredLeads = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const qDigits = searchQuery.replace(/\D/g, "").slice(-10);
    return leads.filter((lead) => {
      if (statusFilter !== "all" && lead.status !== statusFilter) return false;
      if (!q) return true;
      const name = (lead.name || "").toLowerCase();
      const phone = (lead.phone || "").replace(/\D/g, "");
      return name.includes(q) || (qDigits.length >= 4 && phone.includes(qDigits));
    });
  }, [leads, searchQuery, statusFilter]);

  const completedCount = leads.filter((l) =>
    ["call ended", "call completed", "completed", "visit scheduled", "scheduled visit", "follow up", "not interested", "not - interested"].includes(
      (l.status || "").toLowerCase()
    )
  ).length;

  const callingCount = leads.filter((l) => l.status === "calling").length;

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-stone-50 dark:bg-stone-950">
        <Loader2 className="animate-spin text-gold" size={40} />
      </div>
    );
  }

  return (
    <>
      <input type="file" ref={fileInputRef} onChange={handleFileUpload} className="hidden" accept=".csv, .xlsx, .xls" />

      <DashboardShell
        title="Outbound AI Agent"
        subtitle="Manage leads, launch campaigns, and track customer interest in real time"
        actions={
          <>
            <Link
              href="/dashboard/recordings"
              className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 px-5 py-2.5 rounded-2xl flex items-center gap-2 hover:shadow-md transition-all dark:text-stone-200 text-sm font-semibold"
            >
              <Mic size={16} /> Recordings
            </Link>
            <button
              type="button"
              onClick={() => setIsModalOpen(true)}
              className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 px-5 py-2.5 rounded-2xl flex items-center gap-2 hover:shadow-md transition-all dark:text-stone-200 text-sm font-semibold"
            >
              <Plus size={16} /> Add Lead
            </button>
            <button
              type="button"
              onClick={startCampaign}
              disabled={isCalling || leads.length === 0}
              className="gold-gradient text-white px-5 py-2.5 rounded-2xl font-bold flex items-center gap-2 hover:shadow-xl hover:scale-[1.02] transition-all disabled:opacity-50 text-sm"
            >
              {isCalling ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
              {isCalling ? "Launching…" : callingCount > 0 ? `Calling (${callingCount})` : "Launch Campaign"}
            </button>
          </>
        }
      >

        {/* Tab switcher */}
        <div className="flex gap-2 mb-8 p-1 bg-stone-100 dark:bg-stone-900 rounded-2xl w-fit border border-stone-200 dark:border-stone-800">
          {[
            { id: "overview" as const, label: "Overview" },
            { id: "interested" as const, label: "Confirmed Leads", count: interestedLeads.length },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`px-5 py-2.5 rounded-xl text-sm font-bold transition-all flex items-center gap-2 ${
                activeTab === tab.id
                  ? "bg-white dark:bg-stone-800 text-gold shadow-sm"
                  : "text-stone-500 hover:text-stone-800 dark:hover:text-stone-200"
              }`}
            >
              {tab.label}
              {tab.count != null && tab.count > 0 && (
                <span className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 text-[10px] font-black px-2 py-0.5 rounded-full">
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>
        {activeTab === "overview" && (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 mb-10">
              <StatCard label="Total Leads" value={String(leads.length)} icon={Users} color="text-blue-500" />
              <StatCard label="Hot Leads" value={String(interestedLeads.length)} icon={ThumbsUp} color="text-emerald-500" delay={50} />
              <StatCard label="Completed" value={String(completedCount)} icon={PhoneCall} color="text-gold" delay={100} />
              <StatCard
                label="Success Rate"
                value={leads.length > 0 ? `${Math.round((interestedLeads.length / leads.length) * 100)}%` : "0%"}
                icon={TrendingUp}
                color="text-purple-500"
                delay={150}
              />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              <div className="lg:col-span-2 space-y-8">
                <DashboardCard
                  title="All Leads"
                  subtitle={`${filteredLeads.length} shown · select rows to bulk delete`}
                  actions={
                    <div className="flex flex-wrap gap-3">
                      <div className="relative">
                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
                        <input
                          type="text"
                          placeholder="Search name or phone…"
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          className="pl-9 pr-3 py-2 bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded-xl text-xs outline-none focus:ring-2 focus:ring-gold/30 w-44"
                        />
                      </div>
                      <select
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value)}
                        className="py-2 px-3 bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded-xl text-xs font-semibold outline-none"
                      >
                        <option value="all">All statuses</option>
                        <option value="calling">Calling</option>
                        <option value="follow up">Follow up</option>
                        <option value="visit scheduled">Visit scheduled</option>
                        <option value="not interested">Not interested</option>
                        <option value="call ended">Call ended</option>
                      </select>
                      {selectedLeads.length > 0 && (
                        <button type="button" onClick={handleBulkDelete} className="px-3 py-2 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-xl text-red-500 flex items-center gap-2 font-black text-[10px] uppercase tracking-widest">
                          <Trash2 size={14} /> Delete {selectedLeads.length}
                        </button>
                      )}
                      <button type="button" onClick={() => fileInputRef.current?.click()} className="px-3 py-2 bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded-xl dark:text-stone-300 flex items-center gap-2 font-black text-[10px] uppercase tracking-widest">
                        <FileUp size={14} /> Import
                      </button>
                    </div>
                  }
                >
                  <div className="overflow-x-auto">
                    <table className="w-full text-left">
                      <thead>
                        <tr className="bg-stone-50/50 dark:bg-stone-800/30 text-stone-400 text-[10px] font-black uppercase tracking-[0.2em]">
                          <th className="px-6 py-4 w-10"></th>
                          <th className="px-6 py-4">Name</th>
                          <th className="px-6 py-4">Status</th>
                          <th className="px-6 py-4">Summary</th>
                          <th className="px-6 py-4 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
                        {filteredLeads.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="px-6 py-20 text-center">
                              <div className="flex flex-col items-center gap-3 opacity-40">
                                <Database size={40} />
                                <p className="font-bold uppercase tracking-widest text-xs">No leads match</p>
                              </div>
                            </td>
                          </tr>
                        ) : (
                          filteredLeads.map((lead) => (
                            <tr key={lead.id} onClick={() => setSelectedLead(lead)} className="hover:bg-stone-50 dark:hover:bg-stone-800/10 transition-all group cursor-pointer">
                              <td className="px-6 py-4" onClick={(e) => e.stopPropagation()}>
                                <input type="checkbox" checked={selectedLeads.includes(lead.id)} onChange={() => toggleLeadSelection(lead.id)} className="w-4 h-4 rounded border-stone-300 text-gold cursor-pointer" />
                              </td>
                              <td className="px-6 py-4">
                                <div className="flex flex-col">
                                  <span className="uppercase font-black text-xs tracking-tighter dark:text-stone-200">{lead.name || <span className="text-stone-400 normal-case font-normal italic">Unknown</span>}</span>
                                  <span className="text-stone-400 text-[10px] font-mono mt-1">{lead.phone}</span>
                                </div>
                              </td>
                              <td className="px-6 py-4">
                                <StatusBadge status={lead.status} />
                              </td>
                              <td className="px-6 py-4 text-center">
                                {lead.summary ? (
                                  <Eye size={16} className="inline text-gold opacity-60 group-hover:opacity-100" />
                                ) : (
                                  <span className="text-stone-300">—</span>
                                )}
                              </td>
                              <td className="px-6 py-4 text-right">
                                <button type="button" onClick={(e) => { e.stopPropagation(); handleDelete(lead.id); }} className="p-2 bg-red-50 dark:bg-red-950/20 text-red-500 rounded-xl opacity-0 group-hover:opacity-100 transition-all">
                                  <Trash2 size={14} />
                                </button>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </DashboardCard>
              </div>

              {/* Calendar Widget */}
              <div className="space-y-8">
                <div className="bg-white dark:bg-stone-900 rounded-[2.5rem] border border-stone-200 dark:border-stone-800 overflow-hidden shadow-lg">
                  <div className="p-6 border-b border-stone-100 dark:border-stone-800 bg-stone-50/30 dark:bg-stone-800/20 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Calendar size={20} className="text-gold" />
                      <h3 className="text-lg font-serif font-bold dark:text-white">Meeting Calendar</h3>
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => setCurrentMonth(new Date(currentMonth.setMonth(currentMonth.getMonth() - 1)))} className="p-2 hover:bg-stone-100 dark:hover:bg-stone-800 rounded-xl transition-all">
                        <ChevronLeft size={16} className="text-stone-500" />
                      </button>
                      <span className="text-xs font-bold text-stone-600 dark:text-stone-300 min-w-[100px] text-center">
                        {currentMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                      </span>
                      <button onClick={() => setCurrentMonth(new Date(currentMonth.setMonth(currentMonth.getMonth() + 1)))} className="p-2 hover:bg-stone-100 dark:hover:bg-stone-800 rounded-xl transition-all">
                        <ChevronRight size={16} className="text-stone-500" />
                      </button>
                    </div>
                  </div>
                  <div className="p-6">
                    <div className="grid grid-cols-7 gap-2 mb-4 text-center">
                      {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(d => (
                        <div key={d} className="text-[10px] font-black text-stone-400 uppercase">{d}</div>
                      ))}
                    </div>
                    <div className="grid grid-cols-7 gap-2">
                      {getCalendarDays().map((day, i) => {
                        const meetings = day ? getMeetingsForDay(day) : [];
                        const isToday = day && new Date().getDate() === day && new Date().getMonth() === currentMonth.getMonth() && new Date().getFullYear() === currentMonth.getFullYear();
                        
                        return (
                          <div 
                            key={i} 
                            onClick={() => {
                              if (day && meetings.length > 0) {
                                setSelectedDay(day);
                              }
                            }}
                            className={`aspect-square p-2 rounded-xl flex flex-col items-center justify-center relative transition-all ${
                              day ? 'hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer' : ''
                            } ${
                              meetings.length > 0 
                                ? 'bg-gold/30 dark:bg-gold/20 ring-4 ring-gold/60 shadow-[0_0_20px_rgba(212,175,55,0.5)] animate-pulse' 
                                : isToday ? 'bg-stone-100 dark:bg-stone-800' : ''
                            }`}
                          >
                            {day && (
                              <>
                                <span className={`text-xs font-bold ${
                                  meetings.length > 0 ? 'text-gold' : isToday ? 'text-stone-900 dark:text-white' : 'text-stone-600 dark:text-stone-300'
                                }`}>{day}</span>
                                {meetings.length > 0 && (
                                  <div className="absolute bottom-1.5 flex gap-0.5">
                                    {meetings.slice(0, 3).map((_, idx) => (
                                      <div key={idx} className="w-1 h-1 rounded-full bg-gold" />
                                    ))}
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Upcoming Meetings */}
                <div className="bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/30 rounded-[2.5rem] p-8 shadow-lg">
                  <div className="flex items-center justify-between mb-6">
                    <h3 className="text-lg font-serif font-bold text-emerald-900 dark:text-emerald-100">Hot Leads</h3>
                    <div className="p-2 bg-emerald-100 dark:bg-emerald-900/40 rounded-xl text-emerald-600"><Zap size={18} /></div>
                  </div>
                  <div className="space-y-4">
                    {interestedLeads.length === 0 ? (
                      <div className="py-8 text-center text-emerald-400/50 flex flex-col items-center gap-2">
                        <ThumbsUp size={28} /><span className="text-[10px] font-black uppercase tracking-widest">No hot leads yet</span>
                      </div>
                    ) : (
                      interestedLeads.slice(0, 5).map((lead, i) => (
                        <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} key={i} className="bg-white dark:bg-stone-900 p-4 rounded-2xl shadow-md border border-emerald-100/50 dark:border-emerald-800/20 flex items-center gap-4">
                          <div className="w-10 h-10 rounded-full bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center text-emerald-600 font-bold text-xs uppercase">{lead.name?.charAt(0) || '?'}</div>
                          <div className="flex-1">
                            <h5 className="font-black text-[10px] uppercase tracking-tighter dark:text-stone-200">{lead.name}</h5>
                            <p className="text-[10px] text-stone-500 font-mono mt-0.5">{lead.phone}</p>
                          </div>
                          <Clock size={14} className="text-emerald-500" />
                        </motion.div>
                      ))
                    )}
                  </div>
                </div>

                <div className="bg-gold/10 border border-gold/20 rounded-[2.5rem] p-8">
                  <div className="flex items-center gap-4 mb-6 text-gold"><ShieldCheck size={20} /><span className="text-[10px] font-black uppercase tracking-[0.2em]">Security Verified</span></div>
                  <p className="text-xs text-stone-500 dark:text-stone-400 leading-relaxed italic">All AI interactions are encrypted and monitored for quality assurance.</p>
                </div>
              </div>
            </div>
          </>
        )}

        {/* Confirmed Leads Tab */}
        {activeTab === 'interested' && (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
            <div className="mb-10 p-8 rounded-[2.5rem] bg-gradient-to-r from-emerald-50 to-teal-50 dark:from-emerald-950/30 dark:to-teal-950/30 border border-emerald-100 dark:border-emerald-900/30 flex items-center gap-6 shadow-lg">
              <div className="w-16 h-16 rounded-3xl bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shadow-inner">
                <ThumbsUp size={32} />
              </div>
              <div>
                <h3 className="text-3xl font-serif font-bold text-emerald-900 dark:text-emerald-100">Confirmed Leads</h3>
                <p className="text-emerald-600 dark:text-emerald-400 mt-1 text-lg">Customers who said <strong>"Yes"</strong> — ready for follow-up</p>
              </div>
              <div className="ml-auto text-right">
                <div className="text-5xl font-black text-emerald-600 dark:text-emerald-400">{interestedLeads.length}</div>
                <div className="text-sm text-emerald-500 font-semibold uppercase tracking-widest">Hot Leads</div>
              </div>
            </div>

            <div className="bg-white dark:bg-stone-900 rounded-[2.5rem] border border-stone-200 dark:border-stone-800 overflow-hidden shadow-lg">
              <div className="p-8 border-b border-stone-100 dark:border-stone-800 bg-stone-50/30 dark:bg-stone-800/20 flex justify-between items-center">
                <div>
                  <h3 className="text-2xl font-serif font-bold dark:text-white">Confirmed List</h3>
                  <p className="text-sm text-stone-500 mt-1">Updated automatically after each outbound call</p>
                </div>
                {selectedLeads.length > 0 && (
                  <button onClick={handleBulkDelete} className="p-3 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-2xl text-red-500 flex items-center gap-2 font-black text-[10px] uppercase tracking-widest">
                    <Trash2 size={16} /> Delete {selectedLeads.length}
                  </button>
                )}
              </div>

              <div className="p-0 overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-stone-50 dark:bg-stone-800/50 text-stone-400 dark:text-stone-500 text-[11px] font-black uppercase tracking-[0.2em]">
                      <th className="px-8 py-5 w-12"></th>
                      <th className="px-8 py-5">#</th>
                      <th className="px-8 py-5">Name</th>
                      <th className="px-8 py-5">Phone Number</th>
                      <th className="px-8 py-5">Call Date</th>
                      <th className="px-8 py-5">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
                    {interestedLeads.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-8 py-24 text-center">
                          <div className="flex flex-col items-center gap-4 text-stone-400">
                            <ThumbsUp size={40} className="opacity-20" />
                            <p className="font-medium">No confirmed leads yet.</p>
                            <p className="text-sm">When customers say "Yes" to Priya, they'll appear here automatically.</p>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      interestedLeads.map((lead, i) => (
                        <motion.tr 
                          key={lead.id} 
                          initial={{ opacity: 0, x: -10 }} 
                          animate={{ opacity: 1, x: 0 }} 
                          transition={{ delay: i * 0.05 }} 
                          onClick={() => setSelectedLead(lead)}
                          className="hover:bg-emerald-50/30 dark:hover:bg-emerald-900/10 transition-all cursor-pointer"
                        >
                          <td className="px-8 py-6" onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={selectedLeads.includes(lead.id)} onChange={() => toggleLeadSelection(lead.id)} className="w-4 h-4 rounded border-stone-300 cursor-pointer" /></td>
                          <td className="px-8 py-6 text-stone-300 text-sm font-medium">{i + 1}</td>
                          <td className="px-8 py-6 uppercase font-black text-xs tracking-tighter dark:text-white">{lead.name || <span className="text-stone-400 normal-case font-normal italic">Unknown</span>}</td>
                          <td className="px-8 py-6 text-stone-600 dark:text-stone-300 font-mono text-sm">{lead.phone}</td>
                          <td className="px-8 py-6 text-stone-500 text-sm">{lead.createdAt ? new Date(lead.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}</td>
                          <td className="px-8 py-6">
                            <StatusBadge status={lead.status} />
                          </td>
                        </motion.tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </motion.div>
        )}
      </DashboardShell>

      {/* Manual Add Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setIsModalOpen(false)} className="absolute inset-0 bg-stone-900/60 backdrop-blur-md" />
            <motion.div initial={{ opacity: 0, y: 50, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 50, scale: 0.95 }} className="bg-white dark:bg-stone-900 w-full max-w-md p-10 rounded-3xl shadow-2xl relative z-10">
              <h2 className="text-2xl font-serif font-bold dark:text-white mb-6">Add New Contact</h2>
              <form onSubmit={handleManualAdd} className="space-y-4">
                <div>
                  <label className="text-xs font-bold text-stone-500 mb-1 block">FULL NAME</label>
                  <input type="text" required className="w-full px-4 py-3 bg-stone-50 dark:bg-stone-800 rounded-xl outline-none focus:ring-2 focus:ring-gold/20" value={newLead.name} onChange={e => setNewLead({...newLead, name: e.target.value})} />
                </div>
                <div>
                  <label className="text-xs font-bold text-stone-500 mb-1 block">PHONE NUMBER (WITH +91)</label>
                  <input type="text" required className="w-full px-4 py-3 bg-stone-50 dark:bg-stone-800 rounded-xl outline-none focus:ring-2 focus:ring-gold/20" value={newLead.phone} onChange={e => setNewLead({...newLead, phone: e.target.value})} />
                </div>
                <button className="w-full gold-gradient text-white py-4 rounded-2xl font-bold mt-4 shadow-lg">Save Contact</button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Lead Details Modal */}
      <AnimatePresence>
        {selectedLead && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setSelectedLead(null)} className="absolute inset-0 bg-stone-900/60 backdrop-blur-md" />
            <motion.div initial={{ opacity: 0, y: 50, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 50, scale: 0.95 }} className="bg-white dark:bg-stone-900 w-full max-w-2xl p-10 rounded-3xl shadow-2xl relative z-10">
              <div className="flex justify-between items-start mb-8">
                <div>
                  <h2 className="text-3xl font-serif font-bold dark:text-white">{selectedLead.name}</h2>
                  <p className="text-stone-500 font-mono text-sm mt-1">{selectedLead.phone}</p>
                </div>
                <button onClick={() => setSelectedLead(null)} className="p-2 hover:bg-stone-100 dark:hover:bg-stone-800 rounded-xl transition-all"><X size={24} className="text-stone-400" /></button>
              </div>

              <div className="space-y-8">
                <div>
                  <h4 className="text-xs font-black uppercase tracking-[0.2em] text-gold mb-4">AI Intelligence Report</h4>
                  <div className="bg-stone-50 dark:bg-stone-800/50 p-8 rounded-3xl border border-stone-100 dark:border-stone-700/50 shadow-inner">
                    {selectedLead.summary ? (
                      selectedLead.summary.includes('\n\n') ? (
                        <>
                          <div className="flex items-center gap-2 mb-4 pb-4 border-b border-stone-200/50 dark:border-stone-700/50">
                            <Clock size={14} className="text-gold" />
                            <span className="text-[10px] font-black uppercase tracking-widest text-stone-400">
                              {selectedLead.summary.split('\n\n')[0]}
                            </span>
                          </div>
                          <p className="text-sm text-stone-600 dark:text-stone-300 italic leading-relaxed font-medium">
                            "{selectedLead.summary.split('\n\n')[1]}"
                          </p>
                        </>
                      ) : (
                        <div className="space-y-4">
                           <div className="flex items-center gap-2 mb-4 pb-4 border-b border-stone-200/50 dark:border-stone-700/50">
                            <Clock size={14} className="text-gold" />
                            <span className="text-[10px] font-black uppercase tracking-widest text-stone-400">
                              Metadata row
                            </span>
                          </div>
                          <p className="text-sm text-stone-600 dark:text-stone-300 italic leading-relaxed">
                            {selectedLead.summary}
                          </p>
                        </div>
                      )
                    ) : (
                      <div className="py-4 text-center opacity-30">
                        <Loader2 size={24} className="animate-spin mx-auto mb-2" />
                        <p className="text-[10px] font-black uppercase tracking-widest">Generating report...</p>
                      </div>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  <div>
                    <h4 className="text-xs font-black uppercase tracking-[0.2em] text-gold mb-2">Status</h4>
                    <StatusBadge status={selectedLead.status} />
                  </div>
                  {selectedLead.duration != null && (
                    <div>
                      <h4 className="text-xs font-black uppercase tracking-[0.2em] text-gold mb-2">Duration</h4>
                      <p className="text-sm font-semibold text-stone-600 dark:text-stone-300">{selectedLead.duration}s</p>
                    </div>
                  )}
                </div>

                {(leadRecording?.hasAudio || selectedLead.recordingUrl) && (
                  <div>
                    <h4 className="text-xs font-black uppercase tracking-[0.2em] text-gold mb-3">Call Recording</h4>
                    <audio
                      controls
                      className="w-full rounded-xl mb-2"
                      src={
                        leadRecording?.hasAudio
                          ? `/api/recordings/${leadRecording.callId}/audio`
                          : selectedLead.recordingUrl
                      }
                    />
                    {leadRecording && (
                      <Link
                        href={`/dashboard/recordings?call=${leadRecording.callId}`}
                        className="text-xs font-bold text-gold hover:underline inline-flex items-center gap-1"
                      >
                        <Mic size={12} /> View full transcript
                      </Link>
                    )}
                  </div>
                )}

                {selectedLead.transcription && (
                  <div>
                    <h4 className="text-xs font-black uppercase tracking-[0.2em] text-gold mb-2">Transcript</h4>
                    <p className="text-sm text-stone-600 dark:text-stone-300 bg-stone-50 dark:bg-stone-800/50 p-4 rounded-2xl whitespace-pre-wrap max-h-40 overflow-y-auto">
                      {selectedLead.transcription}
                    </p>
                  </div>
                )}

                {selectedLead.appointmentTime && (
                  <div>
                    <h4 className="text-xs font-black uppercase tracking-[0.2em] text-gold mb-2">Visit Scheduled</h4>
                    <div className="flex items-center gap-3 text-stone-600 dark:text-stone-300">
                      <Calendar size={18} className="text-emerald-500" />
                      <span className="font-bold">{new Date(selectedLead.appointmentTime).toLocaleString('en-IN', { dateStyle: 'long', timeStyle: 'short' })}</span>
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Calendar Day Details Modal */}
      <AnimatePresence>
        {selectedDay && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setSelectedDay(null)} className="absolute inset-0 bg-stone-900/60 backdrop-blur-md" />
            <motion.div initial={{ opacity: 0, y: 50, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 50, scale: 0.95 }} className="bg-white dark:bg-stone-900 w-full max-w-md p-10 rounded-3xl shadow-2xl relative z-10">
              <div className="flex justify-between items-start mb-8">
                <div>
                  <h2 className="text-2xl font-serif font-bold dark:text-white">
                    {selectedDay} {currentMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                  </h2>
                  <p className="text-stone-500 text-sm mt-1">Scheduled Appointments</p>
                </div>
                <button onClick={() => setSelectedDay(null)} className="p-2 hover:bg-stone-100 dark:hover:bg-stone-800 rounded-xl transition-all"><X size={24} className="text-stone-400" /></button>
              </div>

              <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2">
                {getMeetingsForDay(selectedDay).length === 0 ? (
                  <div className="py-12 text-center text-stone-400 italic">No appointments for this day.</div>
                ) : (
                  getMeetingsForDay(selectedDay).map((lead, i) => (
                    <div key={i} className="p-4 bg-stone-50 dark:bg-stone-800/50 rounded-2xl border border-stone-100 dark:border-stone-700/50 flex items-center justify-between group">
                      <div>
                        <h5 className="font-black text-xs uppercase tracking-tight dark:text-white">{lead.name}</h5>
                        <div className="flex items-center gap-2 mt-1 text-stone-500 font-mono text-[9px]">
                          <span>{lead.phone}</span>
                          <span className="opacity-30">|</span>
                          <Clock size={12} className="text-emerald-500" />
                          {new Date(lead.appointmentTime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>
                      <button 
                        onClick={() => { setSelectedDay(null); setSelectedLead(lead); }}
                        className="p-2 bg-white dark:bg-stone-900 rounded-xl shadow-sm opacity-0 group-hover:opacity-100 transition-all text-gold"
                      >
                        <ArrowRight size={16} />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
