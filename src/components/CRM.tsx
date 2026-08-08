import React, { useState, useEffect } from 'react';
import { Calendar, User, Phone, MapPin, MessageSquare, Clock, BarChart3, ChevronRight, RefreshCcw, Search, Filter } from 'lucide-react';

interface Lead {
  id: string;
  date: string;
  time: string;
  clientName: string;
  phoneNumber: string;
  project: string;
  location: string;
  status: string;
  summary: string;
  duration: string;
}

const CRM: React.FC = () => {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);

  const fetchLeads = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/leads');
      const data = await res.json();
      setLeads(data);
    } catch (err) {
      console.error("Failed to fetch leads:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLeads();
    const interval = setInterval(fetchLeads, 10000); // Poll every 10s
    return () => clearInterval(interval);
  }, []);

  const filteredLeads = leads.filter(lead => 
    lead.clientName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    lead.project.toLowerCase().includes(searchTerm.toLowerCase()) ||
    lead.phoneNumber.includes(searchTerm)
  );

  return (
    <div className="min-h-screen bg-[#0a0a0b] text-white p-6 md:p-8 font-['Inter',sans-serif]">
      {/* Header */}
      <div className="max-w-7xl mx-auto mb-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-400 to-indigo-500 bg-clip-text text-transparent">
            Priya AI Lead Dashboard
          </h1>
          <p className="text-gray-400 mt-1">Real-time intelligent lead insights from Alliance Square Properties</p>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={fetchLeads}
            className="p-2.5 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-all text-gray-300"
          >
            <RefreshCcw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input 
              type="text" 
              placeholder="Search leads..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 pr-4 py-2.5 bg-white/5 border border-white/10 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/50 w-64 text-sm"
            />
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Stats Summary */}
        <div className="lg:col-span-1 space-y-4">
          <div className="p-6 rounded-3xl bg-gradient-to-br from-blue-600/20 to-indigo-600/20 border border-blue-500/20 backdrop-blur-xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 rounded-lg bg-blue-500/20 text-blue-400">
                <BarChart3 className="w-5 h-5" />
              </div>
              <span className="font-semibold text-blue-100 uppercase text-xs tracking-wider">Total Leads</span>
            </div>
            <div className="text-4xl font-bold text-white mb-1">{leads.length}</div>
            <div className="text-xs text-blue-400">Captured in last 30 days</div>
          </div>

          <div className="p-6 rounded-3xl bg-[#141417] border border-white/5">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 rounded-lg bg-green-500/20 text-green-400">
                <Calendar className="w-5 h-5" />
              </div>
              <span className="font-semibold text-gray-400 uppercase text-xs tracking-wider">Active Bookings</span>
            </div>
            <div className="text-4xl font-bold text-white mb-1">
              {leads.filter(l => l.status === 'Scheduled').length}
            </div>
            <div className="text-xs text-green-500">Site visits confirmed</div>
          </div>
        </div>

        {/* Lead Table */}
        <div className="lg:col-span-3">
          <div className="bg-[#141417]/50 border border-white/5 rounded-3xl overflow-hidden backdrop-blur-md">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-white/5 text-xs uppercase tracking-wider text-gray-500 border-b border-white/5">
                    <th className="px-6 py-4 font-semibold">Client / Contact</th>
                    <th className="px-6 py-4 font-semibold">Project</th>
                    <th className="px-6 py-4 font-semibold">Duration</th>
                    <th className="px-6 py-4 font-semibold">Status</th>
                    <th className="px-6 py-4 font-semibold"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {filteredLeads.map((lead) => (
                    <tr 
                      key={lead.id} 
                      onClick={() => setSelectedLead(lead)}
                      className="group hover:bg-white/[0.02] cursor-pointer transition-colors"
                    >
                      <td className="px-6 py-5">
                        <div className="flex flex-col">
                          <span className="font-medium text-gray-200">{lead.clientName}</span>
                          <span className="text-xs text-gray-500 flex items-center gap-1 mt-1">
                            <Phone className="w-3 h-3" /> {lead.phoneNumber}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-5">
                        <div className="flex flex-col">
                          <span className="text-sm font-medium text-blue-400">{lead.project}</span>
                          <span className="text-xs text-gray-500 flex items-center gap-1 mt-1">
                            <MapPin className="w-3 h-3" /> {lead.location || 'Mysuru'}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-5">
                        <div className="flex items-center gap-2 text-xs text-gray-400">
                          <Clock className="w-3 h-3 text-indigo-400" />
                          {lead.duration}
                        </div>
                        <div className="text-[10px] text-gray-600 mt-1">{lead.date} • {lead.time}</div>
                      </td>
                      <td className="px-6 py-5">
                        <span className={`px-3 py-1 rounded-lg text-xs font-medium border ${
                          lead.status === 'Scheduled' ? 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20' :
                          lead.status === 'Brochure Sent' ? 'bg-amber-500/10 text-amber-500 border-amber-500/20' :
                          'bg-white/5 text-gray-400 border-white/10'
                        }`}>
                          {lead.status}
                        </span>
                      </td>
                      <td className="px-6 py-5 text-right">
                        <button className="p-2 rounded-lg bg-white/5 border border-white/5 group-hover:border-blue-500/30 group-hover:bg-blue-500/10 transition-all">
                          <ChevronRight className="w-4 h-4 text-gray-500 group-hover:text-blue-400" />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {filteredLeads.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-6 py-12 text-center text-gray-500">
                        No leads found. Priya is waiting for calls...
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {/* Lead Detail Modal */}
      {selectedLead && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-[#1c1c1f] border border-white/10 rounded-[2.5rem] w-full max-w-lg overflow-hidden shadow-2xl">
            <div className="p-8 border-b border-white/5 relative">
              <button 
                onClick={() => setSelectedLead(null)}
                className="absolute top-6 right-6 p-2 rounded-full bg-white/5 hover:bg-white/10 text-gray-400"
              >
                ×
              </button>
              <div className="flex items-center gap-4 mb-6">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-2xl font-bold">
                  {selectedLead.clientName[0]}
                </div>
                <div>
                  <h2 className="text-2xl font-bold">{selectedLead.clientName}</h2>
                  <p className="text-gray-400">{selectedLead.phoneNumber}</p>
                </div>
              </div>
              
              <div className="grid grid-cols-1 gap-4">
                <div className="p-3 rounded-2xl bg-white/5 border border-white/5">
                  <div className="text-[10px] text-gray-500 uppercase font-bold tracking-widest mb-1">Status</div>
                  <div className="text-sm font-medium">{selectedLead.status}</div>
                </div>
              </div>
            </div>
            
            <div className="p-8 space-y-6">
              <div>
                <div className="flex items-center gap-2 mb-3 text-blue-400">
                  <MessageSquare className="w-4 h-4" />
                  <span className="text-xs uppercase font-bold tracking-widest">AI Call Summary</span>
                </div>
                <div className="p-4 rounded-2xl bg-white/5 border border-white/5 text-gray-300 text-sm leading-relaxed">
                  {selectedLead.summary}
                </div>
              </div>

              <div className="flex items-center justify-between pt-4">
                <div className="text-xs text-gray-500">
                  Record ID: {selectedLead.id}
                </div>
                <button 
                  onClick={() => setSelectedLead(null)}
                  className="px-6 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition-all shadow-lg shadow-blue-600/20"
                >
                  Close Insights
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CRM;
