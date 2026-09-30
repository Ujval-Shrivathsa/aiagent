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
import { motion, AnimatePresence } from "motion/react";
import { DashboardShell, DashboardCard, StatCard } from "@/components/dashboard/Shell";
import { DualStatusBadges, DualStatusContainers, DualStatusFilters, CallStatusBadge, OutcomeStatusBadge } from "@/components/dashboard/DualStatus";
import { LEAD_STATUS, normalizeLeadStatus, OUTCOME_STATUSES, OUTCOME_UNKNOWN } from "@/lib/lead-status";
import { lookingStatusLabel } from "@/lib/call-summary";

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState<'overview' | 'interested'>('overview');
  const [leads, setLeads] = useState<any[]>([]);
  const [interestedLeads, setInterestedLeads] = useState<any[]>([]);
  const [isCalling, setIsCalling] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedLead, setSelectedLead] = useState<any>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [selectedLeads, setSelectedLeads] = useState<string[]>([]);
  const [newLead, setNewLead] = useState({ name: "", phone: "" });
  const [isSavingLead, setIsSavingLead] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [callStatusFilter, setCallStatusFilter] = useState<string>("all");
  const [outcomeStatusFilter, setOutcomeStatusFilter] = useState<string>("all");
  const [leadRecording, setLeadRecording] = useState<{ callId: string; hasAudio: boolean } | null>(null);
  const [activeCampaignId] = useState<string>("default-campaign");
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const fileInputRef = useRef<HTMLInputElement>(null);

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
    let cancelled = false;
    const load = async () => {
      await fetchAllData();
      if (!cancelled) setIsLoading(false);
    };
    void load();
    const interval = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      void fetchAllData();
    }, 15000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
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

  const openLeadDetails = async (lead: any) => {
    setSelectedLead(lead);
    setSummaryLoading(true);
    try {
      const res = await fetch(`/api/leads?id=${encodeURIComponent(lead.id)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.lead) {
          setSelectedLead(data.lead);
        }
      }
    } catch (e) {
      if (!(e instanceof Error && (e.name === "AbortError" || e.message === "Failed to fetch"))) {
        console.warn("Failed to refresh lead", e);
      }
    } finally {
      setSummaryLoading(false);
    }
  };

  const leadLookingLabel = (lead: any) => lookingStatusLabel(lead);

  const summaryEmptyMessage = (lead: any) => {
    const call = String(lead.call_status || lead.callStatus || lead.status || "").toLowerCase();
    if (["pending", "calling"].includes(call)) {
      return "Call not completed yet — summary will appear after the conversation.";
    }
    if (call === "not answered") {
      return "Call was not answered — no conversation summary available.";
    }
    if (summaryLoading) {
      return "Refreshing call report…";
    }
    return "No summary yet — it will appear shortly after a completed call.";
  };

  const isTransientFetchError = (err: unknown) => {
    if (!err || typeof err !== "object") return false;
    const name = "name" in err ? String((err as { name?: string }).name) : "";
    const message = "message" in err ? String((err as { message?: string }).message) : "";
    return (
      name === "AbortError" ||
      message === "Failed to fetch" ||
      message.toLowerCase().includes("network") ||
      message.toLowerCase().includes("aborted")
    );
  };

  const fetchAllData = async () => {
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const res = await fetch(
        `/api/leads?campaignId=${encodeURIComponent(activeCampaignId)}&includeInterested=true`,
        { cache: "no-store", signal: controller.signal },
      );
      if (!res.ok) {
        console.warn(`Fetch leads failed with status ${res.status}`);
        return;
      }
      const data = await res.json();
      if (data.success) {
        setLeads(Array.isArray(data.leads) ? data.leads : []);
        if (data.interestedLeads) {
          setInterestedLeads(Array.isArray(data.interestedLeads) ? data.interestedLeads : []);
        }
      }
    } catch (e) {
      if (!isTransientFetchError(e)) {
        console.warn("Fetch error", e);
      }
    } finally {
      clearTimeout(timeout);
      isFetchingRef.current = false;
    }
  };

  const handleManualAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSavingLead) return;
    setIsSavingLead(true);
    try {
      const res = await fetch("/api/leads", {
        method: "POST",
        body: JSON.stringify({ ...newLead, campaignId: activeCampaignId }),
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json().catch(() => ({} as any));
      if (res.ok && data.success) {
        setIsModalOpen(false);
        setNewLead({ name: "", phone: "" });
        await fetchAllData();
      } else {
        alert(data.error || `Could not save contact (${res.status}). Please try again.`);
      }
    } catch (e) {
      console.error("Add error", e);
      alert("Could not reach the server. Check your connection and try again.");
    } finally {
      setIsSavingLead(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.append("file", file);
    formData.append("campaignId", activeCampaignId);
    setIsUploading(true);
    try {
      const res = await fetch("/api/leads/upload", { method: "POST", body: formData });
      const data = await res.json().catch(() => ({} as any));
      if (res.ok && data.success) {
        await fetchAllData();
      } else {
        alert(data.error || `Import failed (${res.status}). Please try again.`);
      }
    } catch (e) {
      console.error("Upload error", e);
      alert("Could not reach the server. Check your connection and try again.");
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this contact?")) return;
    try {
      const res = await fetch(`/api/leads?id=${id}`, { method: "DELETE" });
      if (res.ok) {
        await fetchAllData();
      } else {
        const data = await res.json().catch(() => ({} as any));
        alert(data.error || `Delete failed (${res.status}). Please try again.`);
      }
    } catch (e) {
      console.error("Delete error", e);
      alert("Could not reach the server. Check your connection and try again.");
    }
  };

  const handleBulkDelete = async () => {
    if (selectedLeads.length === 0) return;
    if (!confirm(`Are you sure you want to delete ${selectedLeads.length} contacts?`)) return;
    try {
      const results = await Promise.all(
        selectedLeads.map((id) => fetch(`/api/leads?id=${id}`, { method: "DELETE" }).then((r) => r.ok).catch(() => false)),
      );
      const failed = results.filter((ok) => !ok).length;
      if (failed > 0) alert(`${failed} of ${selectedLeads.length} deletes failed. Please try again.`);
      setSelectedLeads([]);
      await fetchAllData();
    } catch (e) {
      console.error("Bulk delete error", e);
      alert("Could not reach the server. Check your connection and try again.");
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
      const failedRows = Array.isArray(startData.results)
        ? startData.results.filter((r: { ok?: boolean; error?: string }) => !r.ok)
        : [];
      if (failedRows.length) {
        alert(
          failedRows
            .map((r: { phone?: string; error?: string }) => `${r.phone || "lead"}: ${r.error || "failed"}`)
            .join("\n"),
        );
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
            const callingCount = data.leads.filter((l: any) => {
              const s = String(l.call_status || l.callStatus || l.status || '').toLowerCase();
              return s === 'calling' || s === 'answered';
            }).length;
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
      const call = String(lead.call_status || lead.callStatus || lead.status || "").toLowerCase();
      const outcome = String(lead.outcome_status || lead.outcomeStatus || OUTCOME_UNKNOWN).toLowerCase();
      if (callStatusFilter !== "all" && normalizeLeadStatus(call) !== callStatusFilter) return false;
      if (outcomeStatusFilter !== "all") {
        if (outcomeStatusFilter === OUTCOME_UNKNOWN) {
          if (outcome !== OUTCOME_UNKNOWN) return false;
        } else if (normalizeLeadStatus(outcome) !== outcomeStatusFilter) {
          return false;
        }
      }
      if (!q) return true;
      const name = (lead.name || "").toLowerCase();
      const phone = (lead.phone || "").replace(/\D/g, "");
      return name.includes(q) || (qDigits.length >= 4 && phone.includes(qDigits));
    });
  }, [leads, searchQuery, callStatusFilter, outcomeStatusFilter]);

  const completedCount = leads.filter((l) => {
    const s = normalizeLeadStatus(l.call_status || l.callStatus || l.status);
    return (
      s === LEAD_STATUS.CALL_ENDED ||
      s === LEAD_STATUS.CALL_COMPLETED ||
      s === LEAD_STATUS.NOT_ANSWERED ||
      s === LEAD_STATUS.FAILED ||
      (OUTCOME_STATUSES as readonly string[]).includes(
        normalizeLeadStatus(l.outcome_status || l.outcomeStatus || ""),
      )
    );
  }).length;

  const callingCount = leads.filter((l) => {
    const s = normalizeLeadStatus(l.call_status || l.callStatus || l.status);
    return s === LEAD_STATUS.CALLING || s === LEAD_STATUS.ANSWERED;
  }).length;

  const patchLeadDualStatus = async (
    leadId: string,
    patch: { call_status?: string; outcome_status?: string },
  ) => {
    try {
      const res = await fetch("/api/leads", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: leadId, ...patch }),
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data.lead) {
        setLeads((prev) => prev.map((l) => (l.id === leadId ? data.lead : l)));
        setSelectedLead((prev: any) => (prev?.id === leadId ? data.lead : prev));
      } else {
        fetchAllData();
      }
    } catch (e) {
      console.error("Status patch error", e);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <Loader2 className="animate-spin text-neutral-400" size={32} />
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
              className="btn-secondary flex-1 sm:flex-none"
            >
              <Mic size={16} strokeWidth={1.75} /> Recordings
            </Link>
            <button
              type="button"
              onClick={() => setIsModalOpen(true)}
              className="btn-secondary flex-1 sm:flex-none"
            >
              <Plus size={16} strokeWidth={1.75} /> Add Lead
            </button>
            <button
              type="button"
              onClick={startCampaign}
              disabled={isCalling || leads.length === 0}
              className="btn-primary w-full sm:w-auto"
            >
              {isCalling ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
              {isCalling
                ? "Launching…"
                : callingCount > 0
                  ? `Call again (${callingCount} stuck)`
                  : "Launch Campaign"}
            </button>
          </>
        }
      >

        {/* Tab switcher */}
        <div className="inline-flex bg-neutral-100 rounded-full p-1 mb-8 sm:mb-10 w-full sm:w-fit">
          {[
            { id: "overview" as const, label: "Overview" },
            { id: "interested" as const, label: "Confirmed", count: interestedLeads.length },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`px-5 py-2 rounded-full text-sm font-medium transition-colors flex items-center justify-center gap-2 flex-1 sm:flex-none min-h-[40px] whitespace-nowrap ${
                activeTab === tab.id
                  ? "bg-white text-neutral-900"
                  : "text-neutral-500 hover:text-neutral-900"
              }`}
            >
              {tab.label}
              {tab.count != null && tab.count > 0 && (
                <span className="text-neutral-400 text-xs font-medium">
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>
        {activeTab === "overview" && (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-10">
              <StatCard label="Total Leads" value={String(leads.length)} icon={Users} />
              <StatCard label="Hot Leads" value={String(interestedLeads.length)} icon={ThumbsUp} delay={50} />
              <StatCard label="Completed" value={String(completedCount)} icon={PhoneCall} delay={100} />
              <StatCard
                label="Success Rate"
                value={leads.length > 0 ? `${Math.round((interestedLeads.length / leads.length) * 100)}%` : "0%"}
                icon={TrendingUp}
                delay={150}
              />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 sm:gap-8">
              <div className="lg:col-span-2 space-y-6 sm:space-y-8">
                <DashboardCard
                  title="All Leads"
                  subtitle={
                    leads.length === 0
                      ? "Import a spreadsheet or add a contact to get started"
                      : `${filteredLeads.length} of ${leads.length} leads`
                  }
                  actions={
                    <div className="space-y-3">
                      <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
                        <div className="relative flex-1 min-w-0">
                          <Search size={15} strokeWidth={1.75} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none" />
                          <input
                            type="text"
                            placeholder="Search name or phone…"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-10 pr-3 py-2.5 bg-white border border-neutral-200 rounded-lg text-sm text-neutral-900 placeholder:text-neutral-400 input-base w-full min-h-[42px]"
                          />
                        </div>
                        <div className="flex gap-2 shrink-0">
                          {selectedLeads.length > 0 && (
                            <button type="button" onClick={handleBulkDelete} className="px-4 py-2.5 border border-neutral-200 rounded-full text-neutral-500 hover:text-neutral-900 hover:border-neutral-400 transition-colors flex items-center justify-center gap-2 text-xs font-semibold min-h-[42px]">
                              <Trash2 size={14} strokeWidth={1.75} /> Delete {selectedLeads.length}
                            </button>
                          )}
                          <button type="button" onClick={() => fileInputRef.current?.click()} disabled={isUploading} className="px-4 py-2.5 bg-white border border-neutral-200 rounded-full text-neutral-700 flex items-center justify-center gap-2 text-xs font-semibold min-h-[42px] hover:border-neutral-400 transition-colors disabled:opacity-50">
                            <FileUp size={14} strokeWidth={1.75} /> {isUploading ? "Importing…" : "Import"}
                          </button>
                        </div>
                      </div>
                      <div className="pt-3 border-t border-neutral-100">
                        <DualStatusFilters
                          callFilter={callStatusFilter}
                          outcomeFilter={outcomeStatusFilter}
                          onCallFilterChange={setCallStatusFilter}
                          onOutcomeFilterChange={setOutcomeStatusFilter}
                        />
                      </div>
                    </div>
                  }
                >
                  {/* Mobile / tablet card list */}
                  <div className="md:hidden divide-y divide-neutral-100">
                    {filteredLeads.length === 0 ? (
                      <div className="px-6 py-16 text-center">
                        <div className="mx-auto w-12 h-12 rounded-full bg-neutral-100 flex items-center justify-center mb-4">
                          <Database size={22} strokeWidth={1.5} className="text-neutral-400" />
                        </div>
                        <p className="text-sm font-medium text-neutral-600">
                          {leads.length === 0 ? "No leads yet" : "No leads match these filters"}
                        </p>
                        <p className="text-xs text-neutral-400 mt-1.5 max-w-xs mx-auto">
                          {leads.length === 0
                            ? "Use Import or Add Lead to start a campaign."
                            : "Try clearing search or status filters."}
                        </p>
                      </div>
                    ) : (
                      filteredLeads.map((lead) => (
                        <div
                          key={lead.id}
                          onClick={() => openLeadDetails(lead)}
                          className="p-4 flex items-start gap-3 active:bg-neutral-50 cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={selectedLeads.includes(lead.id)}
                            onChange={() => toggleLeadSelection(lead.id)}
                            onClick={(e) => e.stopPropagation()}
                            className="mt-1 w-4 h-4 accent-neutral-900 cursor-pointer shrink-0"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="font-medium text-sm text-neutral-900 truncate">
                                  {lead.name || <span className="text-neutral-400 italic">Unknown</span>}
                                </p>
                                <p className="text-neutral-400 text-[12px] font-mono mt-0.5 truncate">{lead.phone}</p>
                              </div>
                              <DualStatusBadges lead={lead} />
                            </div>
                            <div className="mt-3 flex items-center justify-between">
                              {lead.summary ? (
                                <span className="text-[11px] font-medium text-neutral-600 flex items-center gap-1">
                                  <Eye size={12} strokeWidth={1.75} /> View report
                                </span>
                              ) : (
                                <span className="text-neutral-400 text-[11px]">No summary</span>
                              )}
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); handleDelete(lead.id); }}
                                className="p-2 text-neutral-400 hover:text-neutral-900 hover:bg-neutral-100 rounded-full transition-colors"
                                aria-label="Delete lead"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  {/* Desktop table */}
                  <div className="hidden md:block overflow-x-auto dashboard-scroll">
                    <table className="w-full text-left">
                      <thead>
                        <tr className="border-b border-neutral-100 text-neutral-400 text-xs">
                          <th className="px-4 lg:px-6 py-3.5 w-10"></th>
                          <th className="px-4 lg:px-6 py-3.5 font-normal">Name</th>
                          <th className="px-4 lg:px-6 py-3.5 font-normal">Call status</th>
                          <th className="px-4 lg:px-6 py-3.5 font-normal">Lead interest</th>
                          <th className="px-4 lg:px-6 py-3.5 font-normal">Summary</th>
                          <th className="px-4 lg:px-6 py-3.5 text-right font-normal">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-neutral-100">
                        {filteredLeads.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="px-6 py-20 text-center">
                              <div className="mx-auto w-12 h-12 rounded-full bg-neutral-100 flex items-center justify-center mb-4">
                                <Database size={22} strokeWidth={1.5} className="text-neutral-400" />
                              </div>
                              <p className="text-sm font-medium text-neutral-600">
                                {leads.length === 0 ? "No leads yet" : "No leads match these filters"}
                              </p>
                              <p className="text-xs text-neutral-400 mt-1.5">
                                {leads.length === 0
                                  ? "Use Import or Add Lead to start a campaign."
                                  : "Try clearing search or status filters."}
                              </p>
                            </td>
                          </tr>
                        ) : (
                          filteredLeads.map((lead) => (
                            <tr key={lead.id} onClick={() => openLeadDetails(lead)} className="hover:bg-neutral-50 transition-colors group cursor-pointer">
                              <td className="px-4 lg:px-6 py-4" onClick={(e) => e.stopPropagation()}>
                                <input type="checkbox" checked={selectedLeads.includes(lead.id)} onChange={() => toggleLeadSelection(lead.id)} className="w-4 h-4 accent-neutral-900 cursor-pointer" />
                              </td>
                              <td className="px-4 lg:px-6 py-4">
                                <div className="flex flex-col min-w-0">
                                  <span className="font-medium text-sm text-neutral-900 truncate">{lead.name || <span className="text-neutral-400 italic">Unknown</span>}</span>
                                  <span className="text-neutral-400 text-[12px] font-mono mt-0.5">{lead.phone}</span>
                                </div>
                              </td>
                              <td className="px-4 lg:px-6 py-4">
                                <CallStatusBadge lead={lead} />
                              </td>
                              <td className="px-4 lg:px-6 py-4">
                                <OutcomeStatusBadge lead={lead} />
                              </td>
                              <td className="px-4 lg:px-6 py-4 text-center">
                                {lead.summary ? (
                                  <Eye size={16} strokeWidth={1.75} className="inline text-neutral-500 opacity-60 group-hover:opacity-100 transition-opacity" />
                                ) : (
                                  <span className="text-neutral-300">—</span>
                                )}
                              </td>
                              <td className="px-4 lg:px-6 py-4 text-right">
                                <button type="button" onClick={(e) => { e.stopPropagation(); handleDelete(lead.id); }} className="p-2 text-neutral-400 hover:text-neutral-900 hover:bg-neutral-100 rounded-full opacity-0 group-hover:opacity-100 transition-all">
                                  <Trash2 size={14} strokeWidth={1.75} />
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
              <div className="space-y-6 sm:space-y-8">
                <div className="bg-white rounded-xl border border-neutral-200 overflow-hidden">
                  <div className="p-4 sm:p-6 border-b border-neutral-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <h3 className="text-base sm:text-lg font-semibold tracking-tight text-neutral-900">Meeting Calendar</h3>
                    <div className="flex items-center gap-1 sm:gap-2 self-end sm:self-auto">
                      <button type="button" onClick={() => setCurrentMonth(new Date(currentMonth.setMonth(currentMonth.getMonth() - 1)))} className="p-2.5 hover:bg-neutral-100 rounded-full transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center">
                        <ChevronLeft size={16} strokeWidth={1.75} className="text-neutral-500" />
                      </button>
                      <span className="text-xs font-medium text-neutral-600 min-w-[6.5rem] sm:min-w-[100px] text-center">
                        {currentMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                      </span>
                      <button type="button" onClick={() => setCurrentMonth(new Date(currentMonth.setMonth(currentMonth.getMonth() + 1)))} className="p-2.5 hover:bg-neutral-100 rounded-full transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center">
                        <ChevronRight size={16} strokeWidth={1.75} className="text-neutral-500" />
                      </button>
                    </div>
                  </div>
                  <div className="p-3 sm:p-6">
                    <div className="grid grid-cols-7 gap-1 sm:gap-2 mb-3 sm:mb-4 text-center">
                      {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(d => (
                        <div key={d} className="section-label text-center">{d}</div>
                      ))}
                    </div>
                    <div className="grid grid-cols-7 gap-1 sm:gap-2">
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
                            className={`aspect-square min-h-[36px] sm:min-h-0 p-1 sm:p-2 rounded-lg flex flex-col items-center justify-center relative transition-colors ${
                              day ? 'hover:bg-neutral-100 cursor-pointer' : ''
                            } ${
                              meetings.length > 0 
                                ? 'bg-neutral-900 text-white' 
                                : isToday ? 'bg-neutral-100' : ''
                            }`}>
                            {day && (
                              <>
                                <span className={`text-[10px] sm:text-xs font-medium ${
                                  meetings.length > 0 ? 'text-white' : isToday ? 'text-neutral-900' : 'text-neutral-600'
                                }`}>{day}</span>
                                {meetings.length > 0 && (
                                  <div className="absolute bottom-0.5 sm:bottom-1.5 flex gap-0.5">
                                    {meetings.slice(0, 3).map((_, idx) => (
                                      <div key={idx} className="w-1 h-1 rounded-full bg-white/70" />
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
                <div className="bg-white rounded-xl border border-neutral-200 p-5 sm:p-8">
                  <div className="flex items-center justify-between mb-4 sm:mb-6">
                    <h3 className="text-base sm:text-lg font-semibold tracking-tight text-neutral-900">Hot Leads</h3>
                    <div className="text-neutral-400"><Zap size={17} strokeWidth={1.5} /></div>
                  </div>
                  <div className="space-y-3 sm:space-y-4">
                    {interestedLeads.length === 0 ? (
                      <div className="py-8 text-center text-neutral-300 flex flex-col items-center gap-2">
                        <ThumbsUp size={26} strokeWidth={1.5} /><span className="section-label">No hot leads yet</span>
                      </div>
                    ) : (
                      interestedLeads.slice(0, 5).map((lead, i) => (
                        <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} key={i} className="bg-white p-3 sm:p-4 rounded-xl border border-neutral-100 flex items-center gap-3 sm:gap-4">
                          <div className="w-9 h-9 rounded-full bg-neutral-100 flex items-center justify-center text-neutral-600 font-medium text-xs shrink-0">{lead.name?.charAt(0) || '?'}</div>
                          <div className="flex-1 min-w-0">
                            <h5 className="font-medium text-sm text-neutral-900 truncate">{lead.name}</h5>
                            <p className="text-[11px] text-neutral-400 font-mono mt-0.5 truncate">{lead.phone}</p>
                          </div>
                          <Clock size={14} strokeWidth={1.75} className="text-neutral-300 shrink-0" />
                        </motion.div>
                      ))
                    )}
                  </div>
                </div>

                <div className="rounded-xl border border-neutral-200 p-5 sm:p-7">
                  <div className="flex items-center gap-3 mb-3 text-neutral-500"><ShieldCheck size={17} strokeWidth={1.5} /><span className="section-label">Security Verified</span></div>
                  <p className="text-xs text-neutral-400 leading-relaxed">All AI interactions are encrypted and monitored for quality assurance.</p>
                </div>
              </div>
            </div>
          </>
        )}

        {/* Confirmed Leads Tab */}
        {activeTab === 'interested' && (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
            <div className="mb-8 sm:mb-10 rounded-xl bg-neutral-900 p-6 sm:p-10 flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6">
              <div className="flex items-center gap-4 flex-1 min-w-0">
                <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-white/10 flex items-center justify-center text-white shrink-0">
                  <ThumbsUp size={24} strokeWidth={1.5} />
                </div>
                <div className="min-w-0">
                  <h3 className="text-xl sm:text-3xl font-semibold tracking-tight text-white">Confirmed Leads</h3>
                  <p className="text-neutral-400 mt-1 text-sm sm:text-base">Customers who said <strong className="font-medium text-white">"Yes"</strong></p>
                </div>
              </div>
              <div className="sm:ml-auto sm:text-right flex sm:block items-baseline gap-2 pl-16 sm:pl-0">
                <div className="text-3xl sm:text-5xl font-semibold text-white tracking-tight">{interestedLeads.length}</div>
                <div className="text-xs text-neutral-400 font-medium">Hot Leads</div>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-neutral-200 overflow-hidden">
              <div className="p-4 sm:p-6 lg:p-8 border-b border-neutral-100 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
                <div>
                  <h3 className="text-lg sm:text-2xl font-semibold tracking-tight text-neutral-900">Confirmed List</h3>
                  <p className="text-xs sm:text-sm text-neutral-500 mt-1">Updated after each outbound call</p>
                </div>
                {selectedLeads.length > 0 && (
                  <button type="button" onClick={handleBulkDelete} className="px-4 py-2.5 border border-neutral-200 rounded-full text-neutral-500 hover:text-neutral-900 hover:border-neutral-400 transition-colors flex items-center justify-center gap-2 font-medium text-xs min-h-[44px]">
                    <Trash2 size={14} strokeWidth={1.75} /> Delete {selectedLeads.length}
                  </button>
                )}
              </div>

              {/* Mobile cards */}
              <div className="md:hidden divide-y divide-neutral-100">
                {interestedLeads.length === 0 ? (
                  <div className="px-4 py-16 text-center text-neutral-400">
                    <ThumbsUp size={32} strokeWidth={1.5} className="opacity-30 mx-auto mb-3" />
                    <p className="font-medium text-sm">No confirmed leads yet.</p>
                  </div>
                ) : (
                  interestedLeads.map((lead, i) => (
                    <div
                      key={lead.id}
                      onClick={() => openLeadDetails(lead)}
                      className="p-4 flex items-start gap-3 cursor-pointer active:bg-neutral-50"
                    >
                      <input
                        type="checkbox"
                        checked={selectedLeads.includes(lead.id)}
                        onChange={() => toggleLeadSelection(lead.id)}
                        onClick={(e) => e.stopPropagation()}
                        className="mt-1 w-4 h-4 accent-neutral-900 cursor-pointer shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-medium text-sm text-neutral-900 truncate">
                              {lead.name || <span className="text-neutral-400 italic">Unknown</span>}
                            </p>
                            <p className="text-neutral-400 font-mono text-[11px] mt-0.5 truncate">{lead.phone}</p>
                          </div>
                          <DualStatusBadges lead={lead} />
                        </div>
                        <p className="text-[10px] text-neutral-400 mt-2">
                          {lead.createdAt ? new Date(lead.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
                          <span className="mx-1.5 opacity-40">·</span>#{i + 1}
                        </p>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="hidden md:block p-0 overflow-x-auto dashboard-scroll">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-neutral-50 text-neutral-400 text-xs">
                      <th className="px-4 lg:px-8 py-4 w-12"></th>
                      <th className="px-4 lg:px-8 py-4 font-normal">#</th>
                      <th className="px-4 lg:px-8 py-4 font-normal">Name</th>
                      <th className="px-4 lg:px-8 py-4 font-normal">Phone Number</th>
                      <th className="px-4 lg:px-8 py-4 font-normal">Call Date</th>
                      <th className="px-4 lg:px-8 py-4 font-normal">Call Status</th>
                      <th className="px-4 lg:px-8 py-4 font-normal">Customer Outcome</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {interestedLeads.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-8 py-24 text-center">
                          <div className="flex flex-col items-center gap-4 text-neutral-400">
                            <ThumbsUp size={36} strokeWidth={1.5} className="opacity-30" />
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
                          onClick={() => openLeadDetails(lead)}
                          className="hover:bg-neutral-50 transition-colors cursor-pointer"
                        >
                          <td className="px-4 lg:px-8 py-6" onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={selectedLeads.includes(lead.id)} onChange={() => toggleLeadSelection(lead.id)} className="w-4 h-4 accent-neutral-900 cursor-pointer" /></td>
                          <td className="px-4 lg:px-8 py-6 text-neutral-300 text-sm">{i + 1}</td>
                          <td className="px-4 lg:px-8 py-6 font-medium text-sm text-neutral-900">{lead.name || <span className="text-neutral-400 italic">Unknown</span>}</td>
                          <td className="px-4 lg:px-8 py-6 text-neutral-500 font-mono text-sm">{lead.phone}</td>
                          <td className="px-4 lg:px-8 py-6 text-neutral-500 text-sm">{lead.createdAt ? new Date(lead.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}</td>
                          <td className="px-4 lg:px-8 py-6">
                            <CallStatusBadge lead={lead} />
                          </td>
                          <td className="px-4 lg:px-8 py-6">
                            <OutcomeStatusBadge lead={lead} />
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
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-6">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setIsModalOpen(false)} className="absolute inset-0 bg-neutral-900/40" />
            <motion.div initial={{ opacity: 0, y: 50, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 50, scale: 0.98 }} className="bg-white w-full max-w-md p-6 sm:p-10 rounded-t-2xl sm:rounded-2xl relative z-10 max-h-[90vh] overflow-y-auto">
              <h2 className="text-xl sm:text-2xl font-semibold tracking-tight text-neutral-900 mb-6">Add New Contact</h2>
              <form onSubmit={handleManualAdd} className="space-y-4">
                <div>
                  <label className="section-label mb-1.5 block">Full name</label>
                  <input type="text" required className="w-full px-4 py-3 bg-white border border-neutral-200 rounded-lg text-sm outline-none input-base min-h-[48px]" value={newLead.name} onChange={e => setNewLead({...newLead, name: e.target.value})} />
                </div>
                <div>
                  <label className="section-label mb-1.5 block">Phone number (with +91)</label>
                  <input type="text" required className="w-full px-4 py-3 bg-white border border-neutral-200 rounded-lg text-sm outline-none input-base min-h-[48px]" value={newLead.phone} onChange={e => setNewLead({...newLead, phone: e.target.value})} />
                </div>
                <button type="submit" disabled={isSavingLead} className="btn-primary w-full mt-4 min-h-[48px]">
                  {isSavingLead ? "Saving…" : "Save Contact"}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Lead Details Modal */}
      <AnimatePresence>
        {selectedLead && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-6">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setSelectedLead(null)} className="absolute inset-0 bg-neutral-900/40" />
            <motion.div initial={{ opacity: 0, y: 50, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 50, scale: 0.98 }} className="bg-white w-full max-w-2xl p-5 sm:p-10 rounded-t-2xl sm:rounded-2xl relative z-10 max-h-[92vh] overflow-y-auto">
              <div className="flex justify-between items-start mb-6 sm:mb-8 gap-3">
                <div className="min-w-0">
                  <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight text-neutral-900 truncate">{selectedLead.name}</h2>
                  <p className="text-neutral-500 font-mono text-sm mt-1 break-all">{selectedLead.phone}</p>
                  {selectedLead.calledFrom && (
                    <p className="text-neutral-400 text-xs mt-1">Called from {selectedLead.calledFrom}</p>
                  )}
                  {selectedLead.lastCalledAt && (
                    <p className="text-neutral-400 text-xs mt-0.5">
                      Last called {new Date(selectedLead.lastCalledAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                    </p>
                  )}
                </div>
                <button type="button" onClick={() => setSelectedLead(null)} className="p-2.5 hover:bg-neutral-100 rounded-full transition-colors shrink-0 min-h-[44px] min-w-[44px] flex items-center justify-center"><X size={22} strokeWidth={1.75} className="text-neutral-400" /></button>
              </div>

              <div className="space-y-6 sm:space-y-8">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium ${
                      leadLookingLabel(selectedLead) === 'Looking for Lead'
                        ? 'bg-neutral-900 text-white'
                        : leadLookingLabel(selectedLead) === 'Not Looking for Lead'
                          ? 'bg-white text-neutral-400 border border-neutral-200'
                          : 'bg-neutral-100 text-neutral-500'
                    }`}
                  >
                    {leadLookingLabel(selectedLead)}
                  </span>
                </div>

                <div>
                  <h4 className="section-label mb-3 sm:mb-4">AI Intelligence Report</h4>
                  <div className="bg-neutral-50 p-5 sm:p-8 rounded-xl border border-neutral-100">
                    {summaryLoading ? (
                      <div className="py-4 text-center">
                        <Loader2 size={22} className="animate-spin mx-auto mb-2 text-neutral-400" />
                        <p className="section-label">Loading report…</p>
                      </div>
                    ) : selectedLead.summary ? (
                      selectedLead.summary.includes('\n\n') ? (
                        <>
                          <div className="flex items-center gap-2 mb-4 pb-4 border-b border-neutral-200/70">
                            <Clock size={13} strokeWidth={1.75} className="text-neutral-400" />
                            <span className="section-label">
                              {selectedLead.summary.split('\n\n')[0]}
                            </span>
                          </div>
                          <p className="text-sm text-neutral-700 leading-relaxed">
                            {selectedLead.summary.split('\n\n')[1]}
                          </p>
                        </>
                      ) : (
                        <p className="text-sm text-neutral-700 leading-relaxed">
                          {selectedLead.summary}
                        </p>
                      )
                    ) : (
                      <div className="py-4 text-center">
                        <p className="text-sm text-neutral-500 leading-relaxed">
                          {summaryEmptyMessage(selectedLead)}
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
                  <div className="sm:col-span-2">
                    <DualStatusContainers
                      lead={selectedLead}
                      editable
                      onCallStatusChange={(value) =>
                        patchLeadDualStatus(selectedLead.id, { call_status: value })
                      }
                      onOutcomeStatusChange={(value) =>
                        patchLeadDualStatus(selectedLead.id, { outcome_status: value })
                      }
                    />
                  </div>
                  {selectedLead.duration != null && (
                    <div>
                      <h4 className="section-label mb-2">Duration</h4>
                      <p className="text-sm font-medium text-neutral-700">{selectedLead.duration}s</p>
                    </div>
                  )}
                </div>

                {(leadRecording?.hasAudio || selectedLead.recordingUrl) && (
                  <div>
                    <h4 className="section-label mb-3">Call Recording</h4>
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
                        className="text-sm font-medium text-neutral-900 underline underline-offset-4 decoration-neutral-300 hover:decoration-neutral-900 inline-flex items-center gap-1.5 min-h-[44px] transition-colors"
                      >
                        <Mic size={13} strokeWidth={1.75} /> View full transcript
                      </Link>
                    )}
                  </div>
                )}

                {selectedLead.transcription && (
                  <div>
                    <h4 className="section-label mb-2">Transcript</h4>
                    <p className="text-sm text-neutral-600 bg-neutral-50 p-4 rounded-xl border border-neutral-100 whitespace-pre-wrap max-h-40 overflow-y-auto">
                      {selectedLead.transcription}
                    </p>
                  </div>
                )}

                {selectedLead.appointmentTime && (
                  <div>
                    <h4 className="section-label mb-2">Visit Scheduled</h4>
                    <div className="flex items-center gap-3 text-neutral-700">
                      <Calendar size={16} strokeWidth={1.75} className="text-neutral-400 shrink-0" />
                      <span className="font-medium text-sm sm:text-base">{new Date(selectedLead.appointmentTime).toLocaleString('en-IN', { dateStyle: 'long', timeStyle: 'short' })}</span>
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
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-6">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setSelectedDay(null)} className="absolute inset-0 bg-neutral-900/40" />
            <motion.div initial={{ opacity: 0, y: 50, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 50, scale: 0.98 }} className="bg-white w-full max-w-md p-5 sm:p-10 rounded-t-2xl sm:rounded-2xl relative z-10 max-h-[90vh] overflow-y-auto">
              <div className="flex justify-between items-start mb-6 sm:mb-8 gap-3">
                <div className="min-w-0">
                  <h2 className="text-xl sm:text-2xl font-semibold tracking-tight text-neutral-900">
                    {selectedDay} {currentMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                  </h2>
                  <p className="text-neutral-500 text-sm mt-1">Scheduled Appointments</p>
                </div>
                <button type="button" onClick={() => setSelectedDay(null)} className="p-2.5 hover:bg-neutral-100 rounded-full transition-colors shrink-0 min-h-[44px] min-w-[44px] flex items-center justify-center"><X size={22} strokeWidth={1.75} className="text-neutral-400" /></button>
              </div>

              <div className="space-y-3 sm:space-y-4 max-h-[50vh] sm:max-h-[400px] overflow-y-auto pr-1">
                {getMeetingsForDay(selectedDay).length === 0 ? (
                  <div className="py-12 text-center text-neutral-400">No appointments for this day.</div>
                ) : (
                  getMeetingsForDay(selectedDay).map((lead, i) => (
                    <div key={i} className="p-4 bg-white rounded-xl border border-neutral-200 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <h5 className="font-medium text-sm text-neutral-900 truncate">{lead.name}</h5>
                        <div className="flex flex-wrap items-center gap-2 mt-1 text-neutral-400 font-mono text-[11px]">
                          <span className="truncate">{lead.phone}</span>
                          <span className="opacity-30">|</span>
                          <Clock size={12} strokeWidth={1.75} />
                          {new Date(lead.appointmentTime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>
                      <button 
                        type="button"
                        onClick={() => { setSelectedDay(null); openLeadDetails(lead); }}
                        className="p-2.5 border border-neutral-200 rounded-full text-neutral-500 hover:text-neutral-900 hover:border-neutral-400 transition-colors shrink-0 min-h-[44px] min-w-[44px] flex items-center justify-center"
                      >
                        <ArrowRight size={16} strokeWidth={1.75} />
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
