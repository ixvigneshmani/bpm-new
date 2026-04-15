import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";

type ViewMode = "card" | "list";
type SortKey = "updated" | "name" | "tasks";

const MOCK_PROCESSES = [
  { id: "PRO-1247", name: "Vendor Onboarding", description: "End-to-end vendor registration and approval workflow", status: "Active", owner: "Sarah Chen", ownerInitials: "SC", ownerColor: "#F59E0B", updated: "2m ago", updatedSort: 1, version: "v2.1", tasks: 8, runs: 142 },
  { id: "PRO-892", name: "Invoice Approval", description: "Multi-level invoice review and payment authorization", status: "Pending", owner: "Mike Torres", ownerInitials: "MT", ownerColor: "#10B981", updated: "15m ago", updatedSort: 2, version: "v1.4", tasks: 5, runs: 89 },
  { id: "PRO-331", name: "Employee Offboarding", description: "Structured exit process with asset return and knowledge transfer", status: "Review", owner: "Priya Patel", ownerInitials: "PP", ownerColor: "#3B82F6", updated: "1h ago", updatedSort: 3, version: "v3.0", tasks: 12, runs: 56 },
  { id: "PRO-567", name: "Contract Renewal", description: "Automated contract expiry tracking and renewal pipeline", status: "Active", owner: "James Wilson", ownerInitials: "JW", ownerColor: "#8B5CF6", updated: "2h ago", updatedSort: 4, version: "v1.2", tasks: 6, runs: 234 },
  { id: "PRO-445", name: "Purchase Request", description: "Budget-aware purchase requisition and procurement flow", status: "Draft", owner: "Alex Kim", ownerInitials: "AK", ownerColor: "#6366F1", updated: "3h ago", updatedSort: 5, version: "v1.0", tasks: 4, runs: 0 },
  { id: "PRO-210", name: "Leave Approval", description: "Manager-cascaded leave request and balance management", status: "Active", owner: "Sarah Chen", ownerInitials: "SC", ownerColor: "#F59E0B", updated: "5h ago", updatedSort: 6, version: "v2.3", tasks: 3, runs: 312 },
];

const ALL_STATUSES = ["Active", "Pending", "Review", "Draft"];
const ALL_OWNERS = [...new Set(MOCK_PROCESSES.map((p) => p.owner))];

const statusColors: Record<string, { bg: string; text: string; dot: string; border: string; accent: string }> = {
  Active: { bg: "#ECFDF3", text: "#027A48", dot: "#12B76A", border: "#A6F4C5", accent: "#12B76A" },
  Pending: { bg: "#FFF6ED", text: "#B54708", dot: "#F79009", border: "#FEDF89", accent: "#F79009" },
  Review: { bg: "#EFF8FF", text: "#175CD3", dot: "#2E90FA", border: "#B2DDFF", accent: "#2E90FA" },
  Draft: { bg: "#F2F4F7", text: "#475467", dot: "#98A2B3", border: "#D0D5DD", accent: "#98A2B3" },
};

export default function ProcessListPage() {
  const navigate = useNavigate();
  const [view, setView] = useState<ViewMode>("card");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [ownerFilter, setOwnerFilter] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState<SortKey>("updated");
  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const [showSortDropdown, setShowSortDropdown] = useState(false);

  const filtered = useMemo(() => {
    let result = MOCK_PROCESSES.filter((p) => {
      const matchesSearch =
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        p.id.toLowerCase().includes(search.toLowerCase()) ||
        p.description.toLowerCase().includes(search.toLowerCase());
      const matchesStatus = statusFilter.length === 0 || statusFilter.includes(p.status);
      const matchesOwner = ownerFilter.length === 0 || ownerFilter.includes(p.owner);
      return matchesSearch && matchesStatus && matchesOwner;
    });
    result = [...result].sort((a, b) => {
      if (sortBy === "name") return a.name.localeCompare(b.name);
      if (sortBy === "tasks") return b.tasks - a.tasks;
      return a.updatedSort - b.updatedSort;
    });
    return result;
  }, [search, statusFilter, ownerFilter, sortBy]);

  const activeFilterCount = statusFilter.length + ownerFilter.length;

  const toggleStatus = (s: string) => {
    setStatusFilter((prev) => prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]);
  };
  const toggleOwner = (o: string) => {
    setOwnerFilter((prev) => prev.includes(o) ? prev.filter((x) => x !== o) : [...prev, o]);
  };
  const clearAllFilters = () => { setStatusFilter([]); setOwnerFilter([]); };

  const removeChip = (type: "status" | "owner", value: string) => {
    if (type === "status") setStatusFilter((prev) => prev.filter((x) => x !== value));
    else setOwnerFilter((prev) => prev.filter((x) => x !== value));
  };

  return (
    <div style={{ position: "relative" }} onClick={() => { setShowFilterPanel(false); setShowSortDropdown(false); }}>
      {/* Page header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "#101828", letterSpacing: "-0.02em", margin: 0 }}>
            Process Designer
          </h1>
          <p style={{ fontSize: 14, color: "#667085", margin: "4px 0 0" }}>
            Design, manage, and version your BPMN workflows
          </p>
        </div>
        <button
          onClick={() => navigate("/designer/new")}
          style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "10px 20px", borderRadius: 10, border: "none",
            background: "linear-gradient(135deg, #4F46E5, #6366F1)",
            fontSize: 14, fontWeight: 600, color: "#fff", cursor: "pointer",
            fontFamily: "inherit",
            boxShadow: "0 4px 12px rgba(79,70,229,0.25)",
            transition: "all 0.2s ease",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.boxShadow = "0 6px 20px rgba(79,70,229,0.35)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.boxShadow = "0 4px 12px rgba(79,70,229,0.25)"; }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Create Process
        </button>
      </div>

      {/* Toolbar */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        {/* Search */}
        <div style={{ position: "relative", flex: 1, minWidth: 200, maxWidth: 320 }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#98A2B3" strokeWidth="2" strokeLinecap="round"
            style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)" }}>
            <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            type="text" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search processes..."
            style={{
              width: "100%", padding: "8px 12px 8px 36px",
              border: "1px solid #E5E7EB", borderRadius: 8,
              fontSize: 13, color: "#101828", fontFamily: "inherit", outline: "none", background: "#fff",
            }}
            onFocus={(e) => { e.currentTarget.style.borderColor = "#C7D2FE"; e.currentTarget.style.boxShadow = "0 0 0 3px rgba(99,102,241,0.08)"; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = "#E5E7EB"; e.currentTarget.style.boxShadow = "none"; }}
          />
        </div>

        {/* Filters button */}
        <div style={{ position: "relative" }}>
          <button
            onClick={(e) => { e.stopPropagation(); setShowFilterPanel(!showFilterPanel); setShowSortDropdown(false); }}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "8px 14px", border: "1px solid #E5E7EB", borderRadius: 8,
              background: activeFilterCount > 0 ? "#EEF2FF" : "#fff",
              borderColor: activeFilterCount > 0 ? "#C7D2FE" : "#E5E7EB",
              fontSize: 13, fontWeight: 500,
              color: activeFilterCount > 0 ? "#4F46E5" : "#475467",
              cursor: "pointer", fontFamily: "inherit", transition: "all 0.15s ease",
            }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" />
            </svg>
            Filters
            {activeFilterCount > 0 && (
              <span style={{
                width: 18, height: 18, borderRadius: "50%",
                background: "#4F46E5", color: "#fff",
                fontSize: 10, fontWeight: 700,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>{activeFilterCount}</span>
            )}
          </button>

          {/* Filter dropdown panel */}
          {showFilterPanel && (
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 40,
                background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12,
                boxShadow: "0 8px 24px rgba(0,0,0,0.1)", width: 280, padding: 0,
              }}
            >
              {/* Status section */}
              <div style={{ padding: "14px 16px 10px" }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "#98A2B3", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>Status</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  {ALL_STATUSES.map((s) => {
                    const st = statusColors[s];
                    const checked = statusFilter.includes(s);
                    const count = MOCK_PROCESSES.filter((p) => p.status === s).length;
                    return (
                      <label
                        key={s}
                        style={{
                          display: "flex", alignItems: "center", gap: 10,
                          padding: "7px 8px", borderRadius: 6, cursor: "pointer",
                          background: checked ? "#F9FAFB" : "transparent",
                          transition: "background 0.1s ease",
                        }}
                        onMouseEnter={(e) => { if (!checked) e.currentTarget.style.background = "#F9FAFB"; }}
                        onMouseLeave={(e) => { if (!checked) e.currentTarget.style.background = "transparent"; }}
                      >
                        <input
                          type="checkbox" checked={checked} onChange={() => toggleStatus(s)}
                          style={{ accentColor: "#4F46E5", width: 15, height: 15, cursor: "pointer" }}
                        />
                        <span style={{ width: 7, height: 7, borderRadius: "50%", background: st.dot, flexShrink: 0 }} />
                        <span style={{ flex: 1, fontSize: 13, color: "#344054", fontWeight: checked ? 600 : 400 }}>{s}</span>
                        <span style={{ fontSize: 11, color: "#98A2B3" }}>{count}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div style={{ height: 1, background: "#F2F4F7" }} />

              {/* Owner section */}
              <div style={{ padding: "14px 16px 10px" }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "#98A2B3", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>Owner</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  {ALL_OWNERS.map((o) => {
                    const checked = ownerFilter.includes(o);
                    const proc = MOCK_PROCESSES.find((p) => p.owner === o);
                    return (
                      <label
                        key={o}
                        style={{
                          display: "flex", alignItems: "center", gap: 10,
                          padding: "7px 8px", borderRadius: 6, cursor: "pointer",
                          background: checked ? "#F9FAFB" : "transparent",
                          transition: "background 0.1s ease",
                        }}
                        onMouseEnter={(e) => { if (!checked) e.currentTarget.style.background = "#F9FAFB"; }}
                        onMouseLeave={(e) => { if (!checked) e.currentTarget.style.background = "transparent"; }}
                      >
                        <input
                          type="checkbox" checked={checked} onChange={() => toggleOwner(o)}
                          style={{ accentColor: "#4F46E5", width: 15, height: 15, cursor: "pointer" }}
                        />
                        <div style={{
                          width: 22, height: 22, borderRadius: "50%", flexShrink: 0,
                          background: `linear-gradient(135deg, ${proc?.ownerColor || "#6366F1"}, ${proc?.ownerColor || "#6366F1"}cc)`,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: 8, fontWeight: 600, color: "#fff",
                        }}>{proc?.ownerInitials}</div>
                        <span style={{ flex: 1, fontSize: 13, color: "#344054", fontWeight: checked ? 600 : 400 }}>{o}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Footer actions */}
              {activeFilterCount > 0 && (
                <>
                  <div style={{ height: 1, background: "#F2F4F7" }} />
                  <div style={{ padding: "10px 16px", display: "flex", justifyContent: "flex-end" }}>
                    <button
                      onClick={clearAllFilters}
                      style={{
                        padding: "6px 14px", border: "none", borderRadius: 6,
                        background: "transparent", fontSize: 13, fontWeight: 500,
                        color: "#B42318", cursor: "pointer", fontFamily: "inherit",
                      }}
                    >Clear all</button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Sort dropdown */}
        <div style={{ position: "relative" }}>
          <button
            onClick={(e) => { e.stopPropagation(); setShowSortDropdown(!showSortDropdown); setShowFilterPanel(false); }}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "8px 14px", border: "1px solid #E5E7EB", borderRadius: 8,
              background: "#fff", fontSize: 13, fontWeight: 500, color: "#475467",
              cursor: "pointer", fontFamily: "inherit", transition: "all 0.15s ease",
            }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M11 5h10M11 9h7M11 13h4M3 17l4 4 4-4M7 3v18" />
            </svg>
            {sortBy === "updated" ? "Recent" : sortBy === "name" ? "Name" : "Tasks"}
          </button>
          {showSortDropdown && (
            <div onClick={(e) => e.stopPropagation()} style={{
              position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 40,
              background: "#fff", border: "1px solid #E5E7EB", borderRadius: 10,
              boxShadow: "0 8px 24px rgba(0,0,0,0.1)", minWidth: 160, overflow: "hidden",
            }}>
              {([["updated", "Last Updated"], ["name", "Name (A–Z)"], ["tasks", "Most Tasks"]] as [SortKey, string][]).map(([key, label]) => (
                <div
                  key={key}
                  onClick={() => { setSortBy(key); setShowSortDropdown(false); }}
                  style={{
                    padding: "9px 14px", fontSize: 13, cursor: "pointer",
                    color: sortBy === key ? "#4F46E5" : "#344054",
                    background: sortBy === key ? "#EEF2FF" : "transparent",
                    fontWeight: sortBy === key ? 600 : 400,
                    transition: "background 0.1s ease",
                  }}
                  onMouseEnter={(e) => { if (sortBy !== key) e.currentTarget.style.background = "#F9FAFB"; }}
                  onMouseLeave={(e) => { if (sortBy !== key) e.currentTarget.style.background = "transparent"; }}
                >{label}</div>
              ))}
            </div>
          )}
        </div>

        <div style={{ flex: 1 }} />

        {/* Result count */}
        <span style={{ fontSize: 13, color: "#98A2B3", fontWeight: 500 }}>
          {filtered.length} process{filtered.length !== 1 ? "es" : ""}
        </span>

        {/* View toggle */}
        <div style={{ display: "flex", borderRadius: 8, border: "1px solid #E5E7EB", overflow: "hidden" }}>
          {(["card", "list"] as ViewMode[]).map((v) => (
            <button
              key={v} onClick={() => setView(v)}
              style={{
                padding: "7px 12px", border: "none",
                background: view === v ? "#EEF2FF" : "#fff",
                color: view === v ? "#4F46E5" : "#667085",
                fontSize: 13, fontWeight: view === v ? 600 : 500,
                cursor: "pointer", fontFamily: "inherit",
                display: "flex", alignItems: "center", gap: 5,
                transition: "all 0.15s ease",
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                {v === "card" ? (
                  <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>
                ) : (
                  <><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" /></>
                )}
              </svg>
              {v === "card" ? "Cards" : "List"}
            </button>
          ))}
        </div>
      </div>

      {/* Active filter chips */}
      {activeFilterCount > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
          {statusFilter.map((s) => {
            const st = statusColors[s];
            return (
              <span key={`s-${s}`} style={{
                display: "inline-flex", alignItems: "center", gap: 5,
                padding: "4px 8px 4px 10px", borderRadius: 6,
                background: st.bg, border: `1px solid ${st.border}`,
                fontSize: 12, fontWeight: 500, color: st.text,
              }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: st.dot }} />
                {s}
                <span
                  onClick={() => removeChip("status", s)}
                  style={{ cursor: "pointer", marginLeft: 2, display: "flex", alignItems: "center", opacity: 0.6 }}
                  onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
                  onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.6")}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </span>
              </span>
            );
          })}
          {ownerFilter.map((o) => {
            const proc = MOCK_PROCESSES.find((p) => p.owner === o);
            return (
              <span key={`o-${o}`} style={{
                display: "inline-flex", alignItems: "center", gap: 5,
                padding: "4px 8px 4px 10px", borderRadius: 6,
                background: "#F9FAFB", border: "1px solid #E5E7EB",
                fontSize: 12, fontWeight: 500, color: "#344054",
              }}>
                <div style={{
                  width: 16, height: 16, borderRadius: "50%",
                  background: `linear-gradient(135deg, ${proc?.ownerColor || "#6366F1"}, ${proc?.ownerColor || "#6366F1"}cc)`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 7, fontWeight: 600, color: "#fff",
                }}>{proc?.ownerInitials}</div>
                {o}
                <span
                  onClick={() => removeChip("owner", o)}
                  style={{ cursor: "pointer", marginLeft: 2, display: "flex", alignItems: "center", opacity: 0.6 }}
                  onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
                  onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.6")}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </span>
              </span>
            );
          })}
          <button
            onClick={clearAllFilters}
            style={{
              padding: "4px 10px", border: "none", borderRadius: 6,
              background: "transparent", fontSize: 12, fontWeight: 500,
              color: "#B42318", cursor: "pointer", fontFamily: "inherit",
            }}
          >Clear all</button>
        </div>
      )}

      {/* Empty state */}
      {filtered.length === 0 && (
        <div style={{
          textAlign: "center", padding: "60px 20px",
          background: "#fff", borderRadius: 12, border: "1px solid #E5E7EB",
        }}>
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#D0D5DD" strokeWidth="1.5" style={{ marginBottom: 12 }}>
            <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
          </svg>
          <div style={{ fontSize: 15, fontWeight: 600, color: "#344054", marginBottom: 4 }}>No processes found</div>
          <div style={{ fontSize: 13, color: "#98A2B3" }}>Try adjusting your search or filters</div>
        </div>
      )}

      {/* ─── Card View (Option B — Left Accent + Tags) ─── */}
      {view === "card" && filtered.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 16 }}>
          {filtered.map((proc) => {
            const st = statusColors[proc.status] || statusColors.Draft;
            return (
              <div
                className="process-card"
                key={proc.id}
                onClick={() => navigate(`/designer/new`)}
                style={{
                  background: "#fff",
                  border: "1px solid #E5E7EB",
                  borderRadius: 12,
                  cursor: "pointer",
                  transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
                  overflow: "hidden",
                  display: "flex",
                  boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = "#C7D2FE";
                  e.currentTarget.style.boxShadow = "0 12px 32px rgba(99,102,241,0.12), 0 4px 12px rgba(0,0,0,0.04)";
                  e.currentTarget.style.transform = "translateY(-4px)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "#E5E7EB";
                  e.currentTarget.style.boxShadow = "0 1px 2px rgba(0,0,0,0.04)";
                  e.currentTarget.style.transform = "translateY(0)";
                }}
              >

                <div style={{ flex: 1, padding: "18px 20px" }}>
                  {/* Header: title + status badge */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
                    <div style={{ fontSize: 15, fontWeight: 600, color: "#111827" }}>{proc.name}</div>
                    <span style={{
                      display: "inline-flex", alignItems: "center", gap: 5,
                      padding: "3px 10px", borderRadius: 6,
                      background: st.bg, fontSize: 11, fontWeight: 600, color: st.text, flexShrink: 0,
                    }}>
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: st.dot }} />
                      {proc.status}
                    </span>
                  </div>

                  {/* ID + version */}
                  <div style={{ fontSize: 11, color: "#9CA3AF", fontFamily: "var(--font-mono, monospace)", marginBottom: 8 }}>
                    {proc.id} &middot; {proc.version}
                  </div>

                  {/* Description */}
                  <p style={{
                    fontSize: 13, color: "#6B7280", lineHeight: "19px", margin: "0 0 14px",
                    display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
                  }}>
                    {proc.description}
                  </p>

                  {/* Metadata tags */}
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
                    <span style={{
                      padding: "3px 8px", borderRadius: 5, fontSize: 11, fontWeight: 500,
                      background: "#F9FAFB", color: "#475467", border: "1px solid #F2F4F7",
                    }}>{proc.tasks} tasks</span>
                    <span style={{
                      padding: "3px 8px", borderRadius: 5, fontSize: 11, fontWeight: 500,
                      background: "#F9FAFB", color: "#475467", border: "1px solid #F2F4F7",
                    }}>{proc.runs} runs</span>
                    <span style={{
                      padding: "3px 8px", borderRadius: 5, fontSize: 11, fontWeight: 500,
                      background: "#F9FAFB", color: "#475467", border: "1px solid #F2F4F7",
                    }}>Updated {proc.updated}</span>
                  </div>

                  {/* Footer: owner + chevron */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingTop: 12, borderTop: "1px solid #F3F4F6" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{
                        width: 24, height: 24, borderRadius: "50%",
                        background: `linear-gradient(135deg, ${proc.ownerColor}, ${proc.ownerColor}cc)`,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 9, fontWeight: 600, color: "#fff",
                      }}>{proc.ownerInitials}</div>
                      <span style={{ fontSize: 12, color: "#6B7280" }}>{proc.owner}</span>
                    </div>
                    <svg className="card-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#D0D5DD" strokeWidth="1.5" strokeLinecap="round"
                      style={{ transition: "transform 0.3s ease, stroke 0.3s ease" }}>
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ─── List View ─── */}
      {view === "list" && filtered.length > 0 && (
        <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12, overflow: "hidden" }}>
          {/* Table header */}
          <div style={{
            display: "grid", gridTemplateColumns: "minmax(220px, 2.5fr) 100px 80px 80px 140px 100px 40px",
            padding: "10px 20px", background: "#F9FAFB", borderBottom: "1px solid #E5E7EB",
            fontSize: 11, fontWeight: 600, color: "#98A2B3", textTransform: "uppercase", letterSpacing: "0.06em",
            alignItems: "center",
          }}>
            <span>Process</span>
            <span>Status</span>
            <span style={{ textAlign: "center" }}>Tasks</span>
            <span style={{ textAlign: "center" }}>Runs</span>
            <span>Owner</span>
            <span>Updated</span>
            <span></span>
          </div>

          {/* Table rows */}
          {filtered.map((proc) => {
            const st = statusColors[proc.status] || statusColors.Draft;
            return (
              <div
                key={proc.id} onClick={() => navigate(`/designer/new`)}
                style={{
                  display: "grid", gridTemplateColumns: "minmax(220px, 2.5fr) 100px 80px 80px 140px 100px 40px",
                  padding: "14px 20px", borderBottom: "1px solid #F2F4F7",
                  alignItems: "center", cursor: "pointer", transition: "background 0.15s ease",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#FAFBFC")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                {/* Process name + ID */}
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "#111827", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{proc.name}</div>
                  <div style={{ fontSize: 11, color: "#9CA3AF", fontFamily: "var(--font-mono, monospace)", marginTop: 1 }}>
                    {proc.id} &middot; {proc.version}
                  </div>
                </div>

                {/* Status badge */}
                <div>
                  <span style={{
                    display: "inline-flex", alignItems: "center", gap: 5,
                    padding: "3px 10px", borderRadius: 6,
                    background: st.bg, fontSize: 11, fontWeight: 600, color: st.text,
                  }}>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: st.dot }} />
                    {proc.status}
                  </span>
                </div>

                {/* Tasks */}
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "#111827" }}>{proc.tasks}</div>
                </div>

                {/* Runs */}
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "#111827" }}>{proc.runs}</div>
                </div>

                {/* Owner */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                  <div style={{
                    width: 24, height: 24, borderRadius: "50%", flexShrink: 0,
                    background: `linear-gradient(135deg, ${proc.ownerColor}, ${proc.ownerColor}cc)`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 9, fontWeight: 600, color: "#fff",
                  }}>{proc.ownerInitials}</div>
                  <span style={{ fontSize: 13, color: "#344054", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{proc.owner}</span>
                </div>

                {/* Updated */}
                <span style={{ fontSize: 12, color: "#9CA3AF" }}>{proc.updated}</span>

                {/* Chevron */}
                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#C7D2FE" strokeWidth="1.5" strokeLinecap="round">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
