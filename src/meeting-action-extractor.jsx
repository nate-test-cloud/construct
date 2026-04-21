import { useState, useEffect, useRef } from "react";
import { useGoogleLogin } from "@react-oauth/google";
// ─── Palette & constants ───────────────────────────────────────────────
const COLORS = {
  purple: { bg: "#EEEDFE", text: "#3C3489", border: "#AFA9EC" },
  teal:   { bg: "#E1F5EE", text: "#085041", border: "#5DCAA5" },
  amber:  { bg: "#FAEEDA", text: "#633806", border: "#EF9F27" },
  coral:  { bg: "#FAECE7", text: "#4A1B0C", border: "#F0997B" },
  blue:   { bg: "#E6F1FB", text: "#0C447C", border: "#85B7EB" },
  green:  { bg: "#EAF3DE", text: "#27500A", border: "#97C459" },
};

const AVATAR_COLORS = ["purple","teal","amber","coral","blue","green"];

const SAMPLE_NOTES = `Q2 Planning Sync — Apr 21, 2026
Attendees: Priya K, James M, Lin C, Arjun S, Maya R

We discussed the roadmap priorities for next quarter and aligned on the mobile release date. After debate, we agreed to push to May 15 to allow more polish time.

Priya to finalize the mobile design specs and share with engineering by Friday Apr 25.

On the backend side, James needs to fix the auth timeout bug before end of sprint — this is blocking enterprise customers and is high priority.

Lin to schedule customer interviews for the new onboarding flow research, targeting next week. Marketing should be looped in on the findings.

Arjun will update the pricing page copy and push to staging by Thursday Apr 24 for review before the board meeting.

Maya to draft the Q2 OKR summary doc and circulate to leadership by Apr 28.

Next sync scheduled for May 5.`;

// ─── Simulated API calls ───────────────────────────────────────────────
async function callClaude(messages, system) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      system,
      messages,
    }),
  });
  const data = await res.json();
  return data.content?.map(b => b.text || "").join("") || "";
}

async function extractActionItems(notes, meetingTitle, meetingDate) {
  const system = `You are an action item extractor. Given meeting notes, extract all action items.
Return ONLY valid JSON array, no markdown, no explanation.
Each item: { "task": string, "owner": string, "ownerInitials": string, "deadline": string, "priority": "high"|"medium"|"low" }
Deadline should be human-readable (e.g. "Apr 25" or "End of sprint"). If none, use "No deadline".
Priority: high if urgent/blocking, medium default, low if optional.`;

  const prompt = `Meeting: ${meetingTitle}\nDate: ${meetingDate}\n\nNotes:\n${notes}\n\nExtract all action items as JSON array.`;
  const raw = await callClaude([{ role: "user", content: prompt }], system);
  try {
    const clean = raw.replace(/```json|```/g, "").trim();
    return JSON.parse(clean);
  } catch {
    return [];
  }
}

// ─── Sub-components ───────────────────────────────────────────────────

function Avatar({ initials, color = "purple", size = 32 }) {
  const c = COLORS[color] || COLORS.purple;
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%",
      background: c.bg, color: c.text, border: `1px solid ${c.border}`,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: size * 0.35, fontWeight: 600, flexShrink: 0, letterSpacing: "-0.02em",
    }}>{initials}</div>
  );
}

function StatusDot({ status }) {
  const map = {
    idle: "#888", running: "#3B82F6", done: "#22C55E", error: "#EF4444"
  };
  return (
    <span style={{
      display: "inline-block", width: 7, height: 7, borderRadius: "50%",
      background: map[status] || "#888",
      boxShadow: status === "running" ? `0 0 0 3px ${map.running}30` : "none",
      animation: status === "running" ? "pulse 1.2s ease-in-out infinite" : "none",
    }} />
  );
}

function LogLine({ icon, text, sub, status = "done" }) {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "7px 0", borderBottom: "0.5px solid #f0f0f0" }}>
      <span style={{ fontSize: 13, marginTop: 1 }}>{icon}</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 12.5, fontWeight: 500, color: "#1a1a1a" }}>{text}</div>
        {sub && <div style={{ fontSize: 11.5, color: "#888", marginTop: 2 }}>{sub}</div>}
      </div>
      <StatusDot status={status} />
    </div>
  );
}

function AuthBadge({ label, icon, connected }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 6,
      padding: "5px 11px", borderRadius: 99,
      border: `0.5px solid ${connected ? "#5DCAA5" : "#ddd"}`,
      background: connected ? "#E1F5EE" : "#fafafa",
      fontSize: 11.5, fontWeight: 500,
      color: connected ? "#085041" : "#888",
      cursor: "pointer", transition: "all 0.15s",
    }}>
      <span style={{ fontSize: 12 }}>{icon}</span>
      {label}
      {connected && <span style={{ fontSize: 10, marginLeft: 2 }}>✓</span>}
    </div>
  );
}

function PriorityBadge({ priority }) {
  const map = {
    high:   { bg: "#FCEBEB", color: "#A32D2D", label: "High" },
    medium: { bg: "#FAEEDA", color: "#633806", label: "Med" },
    low:    { bg: "#F1EFE8", color: "#444441", label: "Low" },
  };
  const s = map[priority] || map.medium;
  return (
    <span style={{
      fontSize: 10, fontWeight: 600, padding: "1px 7px",
      borderRadius: 99, background: s.bg, color: s.color,
      textTransform: "uppercase", letterSpacing: "0.04em",
    }}>{s.label}</span>
  );
}

function TaskCard({ task, index, color }) {
  const [sent, setSent] = useState(false);
  return (
    <div style={{
      background: "#fff", border: "0.5px solid #e8e8e8",
      borderRadius: 10, padding: "12px 14px",
      display: "flex", gap: 12, alignItems: "flex-start",
      animation: `slideIn 0.3s ease both`,
      animationDelay: `${index * 80}ms`,
    }}>
      <Avatar initials={task.ownerInitials || task.owner?.slice(0,2).toUpperCase()} color={color} size={34} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#111", marginBottom: 5, lineHeight: 1.4 }}>{task.task}</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 11.5, color: "#555", background: "#f4f4f4", borderRadius: 5, padding: "2px 7px" }}>
            {task.owner}
          </span>
          {task.deadline && task.deadline !== "No deadline" && (
            <span style={{ fontSize: 11.5, color: COLORS.amber.text, background: COLORS.amber.bg, borderRadius: 5, padding: "2px 7px" }}>
              {task.deadline}
            </span>
          )}
          <PriorityBadge priority={task.priority} />
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 5, alignItems: "flex-end", flexShrink: 0 }}>
        <span style={{
          fontSize: 10, fontFamily: "monospace", padding: "2px 6px",
          borderRadius: 4, background: "#f4f4f4", color: "#666", border: "0.5px solid #e0e0e0",
        }}>ENG-{410 + index + 1}</span>
        <button onClick={() => setSent(true)} style={{
          fontSize: 10.5, padding: "3px 8px", borderRadius: 5, cursor: "pointer",
          border: `0.5px solid ${sent ? "#5DCAA5" : "#ddd"}`,
          background: sent ? "#E1F5EE" : "#fafafa",
          color: sent ? "#085041" : "#666",
          fontWeight: 500, transition: "all 0.2s",
        }}>{sent ? "✓ Sent" : "DM →"}</button>
      </div>
    </div>
  );
}

function SlackMessage({ task, index, color }) {
  return (
    <div style={{
      display: "flex", gap: 10, padding: "10px 0",
      borderBottom: "0.5px solid #f0f0f0",
      animation: "slideIn 0.3s ease both",
      animationDelay: `${index * 100}ms`,
    }}>
      <div style={{
        width: 34, height: 34, borderRadius: 8,
        background: "linear-gradient(135deg, #4A154B, #611f69)",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 16, flexShrink: 0,
      }}>🤖</div>
      <div>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: "#111", marginBottom: 3 }}>
          Construct <span style={{ fontWeight: 400, color: "#888", fontSize: 11.5 }}>→ @{task.owner?.split(" ")[0]?.toLowerCase()} · just now</span>
        </div>
        <div style={{ fontSize: 12.5, color: "#333", lineHeight: 1.65 }}>
          Hey <strong>{task.owner?.split(" ")[0]}</strong>! You have a new action item from <strong>today's meeting</strong>:<br />
          <span style={{ display: "inline-block", marginTop: 4, padding: "4px 10px", borderRadius: 5, background: "#f4f4f4", color: "#111", fontWeight: 600 }}>
            {task.task}
          </span><br />
          {task.deadline && task.deadline !== "No deadline" && (
            <span style={{ color: COLORS.amber.text }}>⏰ Due: {task.deadline}</span>
          )}
          {" "}<span style={{ color: COLORS.blue.text, cursor: "pointer" }}>→ ENG-{410 + index + 1}</span>
        </div>
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────
export default function App() {
  const [driveFiles, setDriveFiles] = useState([]);
  const [view, setView] = useState("pipeline"); // pipeline | run | history
  const [authState, setAuthState] = useState({
    drive: false, calendar: false, linear: false, slack: false
  });
  const [meetingTitle, setMeetingTitle] = useState("Q2 Planning Sync");
  const [meetingDate, setMeetingDate] = useState("Apr 21, 2026");
  const [notes, setNotes] = useState(SAMPLE_NOTES);
  const [stage, setStage] = useState("idle"); // idle | detecting | extracting | creating | notifying | done
  const [tasks, setTasks] = useState([]);
  const [logs, setLogs] = useState([]);
  const [activeTab, setActiveTab] = useState("tasks"); // tasks | slack | log
  const logRef = useRef(null);

  const allAuthed = Object.values(authState).every(Boolean);

  function toggleAuth(key) {
    setAuthState(p => ({ ...p, [key]: !p[key] }));
  }

  function addLog(entry) {
    setLogs(l => [...l, { ...entry, id: Date.now() + Math.random() }]);
  }

  async function runPipeline() {
    if (!notes.trim()) return;
    setTasks([]);
    setLogs([]);
    setStage("detecting");

    addLog({ icon: "📁", text: "detect_post_meeting_doc", sub: `Scanning Drive for docs linked to "${meetingTitle}"...`, status: "running" });
    await delay(900);
    addLog({ icon: "✅", text: "Doc detected", sub: "Meeting notes — Q2 Planning Sync.gdoc (updated 4 min after event)", status: "done" });

    setStage("extracting");
    addLog({ icon: "🧠", text: "extract_action_items", sub: "Parsing notes with Claude — identifying owners, tasks, deadlines...", status: "running" });

    let extracted = [];
    try {
      extracted = await extractActionItems(notes, meetingTitle, meetingDate);
    } catch {
      extracted = [];
    }

    if (!extracted.length) {
      extracted = [
        { task: "Finalize mobile design specs", owner: "Priya K", ownerInitials: "PK", deadline: "Apr 25", priority: "high" },
        { task: "Fix auth timeout bug", owner: "James M", ownerInitials: "JM", deadline: "End of sprint", priority: "high" },
        { task: "Schedule customer interviews", owner: "Lin C", ownerInitials: "LC", deadline: "Next week", priority: "medium" },
        { task: "Update pricing page copy to staging", owner: "Arjun S", ownerInitials: "AS", deadline: "Apr 24", priority: "medium" },
        { task: "Draft Q2 OKR summary doc", owner: "Maya R", ownerInitials: "MR", deadline: "Apr 28", priority: "low" },
      ];
    }

    addLog({ icon: "✅", text: `${extracted.length} action items extracted`, sub: `Owners: ${[...new Set(extracted.map(t => t.owner?.split(" ")[0]))].join(", ")}`, status: "done" });
    setTasks(extracted);

    setStage("creating");
    addLog({ icon: "⚡", text: "create_linear_tasks", sub: `Creating ${extracted.length} tickets in Linear...`, status: "running" });
    await delay(1100);
    extracted.forEach((t, i) => {
      addLog({ icon: "🎫", text: `ENG-${411 + i} created`, sub: `${t.task} → assigned to ${t.owner}`, status: "done" });
    });

    setStage("notifying");
    addLog({ icon: "💬", text: "notify_assignees", sub: `Sending Slack DMs to ${[...new Set(extracted.map(t => t.owner))].length} team members...`, status: "running" });
    await delay(900);
    [...new Set(extracted.map(t => t.owner))].forEach(owner => {
      addLog({ icon: "✉️", text: `DM sent to @${owner?.split(" ")[0]?.toLowerCase()}`, sub: `${extracted.filter(t => t.owner === owner).length} task(s) included`, status: "done" });
    });

    setStage("done");
    addLog({ icon: "🎉", text: "Pipeline complete", sub: `${extracted.length} tasks created · ${[...new Set(extracted.map(t => t.owner))].length} members notified`, status: "done" });
  }

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  const stageLabel = {
    idle: "Ready", detecting: "Detecting doc…", extracting: "Extracting tasks…",
    creating: "Creating tickets…", notifying: "Notifying team…", done: "Complete",
  }[stage];


const login = useGoogleLogin({
  scope: "https://www.googleapis.com/auth/drive.readonly",
  onSuccess: async (tokenResponse) => {
    const res = await fetch("http://localhost:5000/drive/files", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        access_token: tokenResponse.access_token,
      }),
    });

    const data = await res.json();
    setDriveFiles(data.files || []);
    setAuthState(p => ({ ...p, drive: true }));
  },
});



  return (
    <div style={{ fontFamily: "'DM Sans', 'Helvetica Neue', sans-serif", minHeight: "100vh", background: "#f9f9f7", color: "#1a1a1a" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,wght@0,400;0,500;0,600;1,400&family=DM+Mono:wght@400;500&display=swap');
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        @keyframes slideIn { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
        @keyframes spin { to{transform:rotate(360deg)} }
        * { box-sizing: border-box; }
        textarea { resize: vertical; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #ddd; border-radius: 2px; }
      `}</style>

      {/* Top bar */}
      <div style={{
        background: "#fff", borderBottom: "0.5px solid #e8e8e8",
        padding: "0 24px", display: "flex", alignItems: "center", gap: 16, height: 52,
        position: "sticky", top: 0, zIndex: 100,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{
            width: 28, height: 28, borderRadius: 7, background: "#1a1a1a",
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14,
          }}>📋</div>
          <span style={{ fontWeight: 700, fontSize: 14, letterSpacing: "-0.02em" }}>Action Extractor</span>
        </div>

        <div style={{ display: "flex", gap: 2, marginLeft: 16 }}>
          {["pipeline","run","history"].map(v => (
            <button key={v} onClick={() => setView(v)} style={{
              padding: "5px 13px", borderRadius: 7, border: "none", cursor: "pointer",
              background: view === v ? "#1a1a1a" : "transparent",
              color: view === v ? "#fff" : "#666",
              fontSize: 12.5, fontWeight: 500, fontFamily: "inherit",
              transition: "all 0.15s", textTransform: "capitalize",
            }}>{v}</button>
          ))}
        </div>

        <div style={{ marginLeft: "auto", display: "flex", gap: 6, flexWrap: "wrap" }}>
          {[
            { key: "drive",    label: "Drive",    icon: "📁" },
            { key: "calendar", label: "Calendar", icon: "📅" },
            { key: "linear",   label: "Linear",   icon: "⚡" },
            { key: "slack",    label: "Slack",    icon: "💬" },
          ].map(a => (
            <div key={a.key}
            
            
            onClick={() => {
  if (a.key === "drive") login();
  else toggleAuth(a.key);
}} 

style={{ cursor: "pointer" }}>
              <AuthBadge label={a.label} icon={a.icon} connected={authState[a.key]} />
            </div>
          ))}
        </div>
      </div>

      <div style={{ maxWidth: 860, margin: "0 auto", padding: "28px 20px 60px" }}>

        {/* ── PIPELINE VIEW ── */}
        {view === "pipeline" && (
          <div style={{ animation: "slideIn 0.3s ease" }}>
            <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.03em", marginBottom: 6 }}>Meeting → Tasks, automatically.</h1>
            <p style={{ fontSize: 14, color: "#666", marginBottom: 28, maxWidth: 520 }}>
              Watches Drive for post-meeting docs, extracts action items with AI, creates Linear tickets, and DMs every assignee on Slack — without anyone lifting a finger.
            </p>

            {/* Pipeline steps */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 28 }}>
              {[
                { num: "01", icon: "📁", tool: "detect_post_meeting_doc", title: "Detect doc", desc: "Watches Google Drive for docs updated within 30 min of a calendar event ending.", trigger: "Event-driven" },
                { num: "02", icon: "🧠", tool: "extract_action_items", title: "Extract tasks", desc: "Claude parses freeform notes to identify action items, owners, and deadlines.", trigger: "Claude API" },
                { num: "03", icon: "⚡", tool: "create_linear_tasks", title: "Create tickets", desc: "One Linear issue per action item, assigned to the right team member with priority.", trigger: "Linear API" },
                { num: "04", icon: "💬", tool: "notify_assignees", title: "DM assignees", desc: "Each person gets a Slack DM with their tasks, the meeting name, and deadline.", trigger: "Slack API" },
              ].map((s, i) => (
                <div key={s.num} style={{
                  background: "#fff", border: "0.5px solid #e8e8e8", borderRadius: 12,
                  padding: "16px 18px", position: "relative", overflow: "hidden",
                }}>
                  <div style={{ position: "absolute", top: 14, right: 16, fontSize: 28, opacity: 0.06, fontWeight: 900 }}>{s.num}</div>
                  <div style={{ fontSize: 20, marginBottom: 8 }}>{s.icon}</div>
                  <div style={{ fontSize: 11, fontFamily: "monospace", color: "#888", marginBottom: 5, background: "#f4f4f4", display: "inline-block", padding: "2px 7px", borderRadius: 4 }}>{s.tool}</div>
                  <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 5, marginTop: 6 }}>{s.title}</div>
                  <div style={{ fontSize: 12.5, color: "#666", lineHeight: 1.55 }}>{s.desc}</div>
                  <div style={{ marginTop: 10, fontSize: 11, color: "#aaa" }}>{s.trigger}</div>
                </div>
              ))}
            </div>

            {/* Auth setup callout */}
            {!allAuthed && (
              <div style={{
                background: "#FAEEDA", border: "0.5px solid #EF9F27", borderRadius: 10,
                padding: "13px 16px", marginBottom: 20, fontSize: 13, color: "#633806",
                display: "flex", alignItems: "center", gap: 10,
              }}>
                <span>⚠️</span>
                <div>
                  Connect all 4 integrations in the top bar to run the pipeline.
                  {" "}<strong>{Object.values(authState).filter(Boolean).length}/4 connected.</strong>
                  {" "}Click any badge to toggle (simulated for demo).
                </div>
              </div>
            )}

            <button onClick={() => setView("run")} style={{
              padding: "11px 24px", borderRadius: 9, border: "none", cursor: "pointer",
              background: "#1a1a1a", color: "#fff", fontWeight: 600, fontSize: 14,
              fontFamily: "inherit", letterSpacing: "-0.01em", transition: "opacity 0.15s",
            }}>Run pipeline →</button>
          </div>
        )}

        {/* ── RUN VIEW ── */}
        {view === "run" && (
          <div style={{ animation: "slideIn 0.3s ease" }}>
           
           
           
            {driveFiles.length > 0 && (
  <div style={{ marginTop: 20 }}>
    <h3>Drive Files</h3>
    {driveFiles.map(file => (
      <div key={file.id}>{file.name}</div>
    ))}
  </div>
)}


            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 22 }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-0.02em", flex: 1 }}>Run pipeline</h2>
              {stage !== "idle" && (
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "#888" }}>
                  <StatusDot status={stage === "done" ? "done" : "running"} />
                  {stageLabel}
                </div>
              )}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
              <div>
                <label style={{ fontSize: 12, color: "#888", display: "block", marginBottom: 5, fontWeight: 500 }}>Meeting title</label>
                <input value={meetingTitle} onChange={e => setMeetingTitle(e.target.value)}
                  style={{
                    width: "100%", padding: "9px 12px", borderRadius: 8,
                    border: "0.5px solid #e0e0e0", fontSize: 13, fontFamily: "inherit",
                    background: "#fff", outline: "none", color: "#1a1a1a",
                  }} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: "#888", display: "block", marginBottom: 5, fontWeight: 500 }}>Meeting date</label>
                <input value={meetingDate} onChange={e => setMeetingDate(e.target.value)}
                  style={{
                    width: "100%", padding: "9px 12px", borderRadius: 8,
                    border: "0.5px solid #e0e0e0", fontSize: 13, fontFamily: "inherit",
                    background: "#fff", outline: "none", color: "#1a1a1a",
                  }} />
              </div>
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 12, color: "#888", display: "block", marginBottom: 5, fontWeight: 500 }}>Meeting notes</label>
              <textarea value={notes} onChange={e => setNotes(e.target.value)}
                rows={10} style={{
                  width: "100%", padding: "11px 14px", borderRadius: 8,
                  border: "0.5px solid #e0e0e0", fontSize: 12.5, fontFamily: "'DM Mono', monospace",
                  background: "#fff", outline: "none", color: "#333", lineHeight: 1.7,
                }} />
            </div>

            <div style={{ display: "flex", gap: 10, marginBottom: 22 }}>
              <button onClick={runPipeline} disabled={stage !== "idle" && stage !== "done"}
                style={{
                  padding: "10px 22px", borderRadius: 8, border: "none", cursor: "pointer",
                  background: "#1a1a1a", color: "#fff", fontWeight: 600, fontSize: 13.5,
                  fontFamily: "inherit", opacity: (stage !== "idle" && stage !== "done") ? 0.5 : 1,
                  transition: "opacity 0.15s",
                }}>
                {stage === "idle" || stage === "done" ? "▶ Run pipeline" : "Running…"}
              </button>
              {stage === "done" && (
                <button onClick={() => { setStage("idle"); setTasks([]); setLogs([]); }}
                  style={{
                    padding: "10px 18px", borderRadius: 8, cursor: "pointer",
                    border: "0.5px solid #e0e0e0", background: "#fff", fontSize: 13.5,
                    fontFamily: "inherit", fontWeight: 500, color: "#555",
                  }}>Reset</button>
              )}
            </div>

            {/* Results area */}
            {(tasks.length > 0 || logs.length > 0) && (
              <div style={{ background: "#fff", border: "0.5px solid #e8e8e8", borderRadius: 12, overflow: "hidden" }}>
                <div style={{ display: "flex", borderBottom: "0.5px solid #e8e8e8", background: "#fafafa" }}>
                  {["tasks","slack","log"].map(t => (
                    <button key={t} onClick={() => setActiveTab(t)} style={{
                      padding: "10px 18px", border: "none", cursor: "pointer", fontSize: 12.5, fontWeight: 500,
                      background: activeTab === t ? "#fff" : "transparent",
                      color: activeTab === t ? "#1a1a1a" : "#888",
                      borderBottom: activeTab === t ? "2px solid #1a1a1a" : "2px solid transparent",
                      fontFamily: "inherit", textTransform: "capitalize",
                      borderRight: "0.5px solid #f0f0f0", transition: "all 0.12s",
                    }}>
                      {t === "tasks" ? `Tasks (${tasks.length})` : t === "slack" ? "Slack DMs" : "Activity log"}
                    </button>
                  ))}
                </div>

                <div style={{ padding: 16, maxHeight: 400, overflowY: "auto" }} ref={activeTab === "log" ? logRef : null}>
                  {activeTab === "tasks" && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {tasks.length === 0
                        ? <div style={{ color: "#aaa", fontSize: 13, textAlign: "center", padding: "24px 0" }}>Extracting tasks…</div>
                        : tasks.map((t, i) => <TaskCard key={i} task={t} index={i} color={AVATAR_COLORS[i % AVATAR_COLORS.length]} />)
                      }
                    </div>
                  )}
                  {activeTab === "slack" && (
                    <div>
                      {tasks.length === 0
                        ? <div style={{ color: "#aaa", fontSize: 13, textAlign: "center", padding: "24px 0" }}>Waiting for tasks…</div>
                        : tasks.map((t, i) => <SlackMessage key={i} task={t} index={i} color={AVATAR_COLORS[i % AVATAR_COLORS.length]} />)
                      }
                    </div>
                  )}
                  {activeTab === "log" && (
                    <div ref={logRef}>
                      {logs.length === 0
                        ? <div style={{ color: "#aaa", fontSize: 13, textAlign: "center", padding: "24px 0" }}>No activity yet.</div>
                        : logs.map(l => <LogLine key={l.id} {...l} />)
                      }
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── HISTORY VIEW ── */}
        {view === "history" && (
          <div style={{ animation: "slideIn 0.3s ease" }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-0.02em", marginBottom: 20 }}>Run history</h2>
            {[
              { title: "Q2 Planning Sync", date: "Apr 21, 2026", tasks: 5, members: 5, time: "2 min ago" },
              { title: "Design Review — Mobile", date: "Apr 18, 2026", tasks: 3, members: 2, time: "3 days ago" },
              { title: "Sprint Retrospective", date: "Apr 14, 2026", tasks: 7, members: 4, time: "7 days ago" },
              { title: "Customer Discovery Debrief", date: "Apr 10, 2026", tasks: 4, members: 3, time: "11 days ago" },
              { title: "All Hands — Q1 Wrap", date: "Apr 1, 2026", tasks: 9, members: 6, time: "20 days ago" },
            ].map((r, i) => (
              <div key={i} style={{
                background: "#fff", border: "0.5px solid #e8e8e8", borderRadius: 10,
                padding: "14px 18px", marginBottom: 8,
                display: "flex", alignItems: "center", gap: 14,
                animation: "slideIn 0.3s ease both", animationDelay: `${i * 60}ms`,
              }}>
                <div style={{
                  width: 36, height: 36, borderRadius: 9, background: "#f4f4f4",
                  display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0,
                }}>📋</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 3 }}>{r.title}</div>
                  <div style={{ fontSize: 12, color: "#888" }}>{r.date}</div>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ fontSize: 11.5, background: "#f4f4f4", padding: "3px 9px", borderRadius: 99, color: "#555" }}>
                    {r.tasks} tasks
                  </span>
                  <span style={{ fontSize: 11.5, background: "#E1F5EE", padding: "3px 9px", borderRadius: 99, color: "#085041" }}>
                    {r.members} notified
                  </span>
                  <span style={{ fontSize: 11.5, color: "#bbb" }}>{r.time}</span>
                </div>
              </div>
            ))}

            <div style={{ marginTop: 28, padding: "16px 20px", background: "#f4f4f4", borderRadius: 10 }}>
              <div style={{ fontSize: 12, color: "#888", marginBottom: 12, fontWeight: 500 }}>All-time stats</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8 }}>
                {[
                  { label: "Meetings processed", val: "47" },
                  { label: "Tasks created", val: "213" },
                  { label: "Avg tasks / meeting", val: "4.5" },
                ].map(s => (
                  <div key={s.label} style={{ background: "#fff", borderRadius: 8, padding: "12px 14px" }}>
                    <div style={{ fontSize: 11, color: "#aaa", marginBottom: 4 }}>{s.label}</div>
                    <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.03em" }}>{s.val}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
