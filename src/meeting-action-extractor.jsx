import { useState, useEffect, useRef } from "react";
import { useGoogleLogin } from "@react-oauth/google";

// ─── OpenRouter API key (from your server.js) ─────────────────────────
const OPENROUTER_API_KEY = "";
const OPENROUTER_MODEL = "google/gemma-3-27b-it:free";

// ─── Call OpenRouter directly (replaces localhost:5000) ───────────────
async function extractTasksWithAI(text) {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": window.location.origin,
      "X-Title": "Meeting Action Extractor",
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      messages: [
        {
          role: "user",
          content: `Extract all action items, tasks, and deadlines from the following meeting notes.

Return ONLY a valid JSON array — no markdown, no explanation, no backticks.

Each item must have:
- "task": what needs to be done (string)
- "owner": person responsible (string, or "Unassigned" if unknown)
- "deadline": due date or timeframe (string, or "No deadline" if not mentioned)
- "priority": "high", "medium", or "low" based on urgency language

Example:
[
  {
    "task": "Send revised proposal to client",
    "owner": "Sarah",
    "deadline": "Friday",
    "priority": "high"
  }
]

Meeting notes:
${text}`,
        },
      ],
    }),
  });

  const data = await response.json();
  console.log("OpenRouter response:", data);

  const raw = data.choices?.[0]?.message?.content || "";

  try {
    const clean = raw.replace(/```json|```/gi, "").trim();
    const match = clean.match(/\[[\s\S]*\]/);
    if (match) return JSON.parse(match[0]);
  } catch (e) {
    console.error("JSON parse failed:", e, "Raw:", raw);
  }

  return [];
}

// ─── Palette & constants ───────────────────────────────────────────────
const COLORS = {
  purple: { bg: "#EEEDFE", text: "#3C3489", border: "#AFA9EC" },
  teal:   { bg: "#E1F5EE", text: "#085041", border: "#5DCAA5" },
  amber:  { bg: "#FAEEDA", text: "#633806", border: "#EF9F27" },
  coral:  { bg: "#FAECE7", text: "#4A1B0C", border: "#F0997B" },
  blue:   { bg: "#E6F1FB", text: "#0C447C", border: "#85B7EB" },
  green:  { bg: "#EAF3DE", text: "#27500A", border: "#97C459" },
};

const AVATAR_COLORS = ["purple", "teal", "amber", "coral", "blue", "green"];

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
  const map = { idle: "#888", running: "#3B82F6", done: "#22C55E", error: "#EF4444" };
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
      <Avatar initials={task.ownerInitials || task.owner?.slice(0, 2).toUpperCase()} color={color} size={34} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#111", marginBottom: 5, lineHeight: 1.4 }}>{task.task}</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 11.5, color: "#555", background: "#f4f4f4", borderRadius: 5, padding: "2px 7px" }}>
            {task.owner}
          </span>
          {task.deadline && task.deadline !== "No deadline" && (
            <span style={{ fontSize: 11.5, color: COLORS.amber.text, background: COLORS.amber.bg, borderRadius: 5, padding: "2px 7px" }}>
              📅 {task.deadline}
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

function SlackMessage({ task, index }) {
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
        </div>
      </div>
    </div>
  );
}

// ─── Drive helpers ─────────────────────────────────────────────────────
async function fetchDriveFiles(accessToken, pageSize = 10) {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?orderBy=modifiedTime desc&pageSize=${pageSize}&fields=files(id,name,mimeType,modifiedTime)`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const data = await res.json();
  return data.files || [];
}

async function fetchFileText(accessToken, file) {
  if (file.mimeType === "application/vnd.google-apps.document") {
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${file.id}/export?mimeType=text/plain`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    return await res.text();
  }
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  return await res.text();
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Main App ─────────────────────────────────────────────────────────
export default function App() {
  const [driveContent, setDriveContent] = useState("");
  const [driveFiles, setDriveFiles] = useState(null);
  const [selectedFileId, setSelectedFileId] = useState(null);
  const [accessToken, setAccessToken] = useState(null);
  const [view, setView] = useState("pipeline");
  const [authState, setAuthState] = useState({
    drive: false, calendar: false, linear: false, slack: false
  });
  const [meetingTitle, setMeetingTitle] = useState("Q2 Planning Sync");
  const [meetingDate, setMeetingDate] = useState("Apr 21, 2026");
  const [notes, setNotes] = useState("");
  const [stage, setStage] = useState("idle");
  const [tasks, setTasks] = useState([]);
  const [logs, setLogs] = useState([]);
  const [activeTab, setActiveTab] = useState("tasks");
  const [driveError, setDriveError] = useState(null);
  const logRef = useRef(null);

  const allAuthed = Object.values(authState).every(Boolean);

  function toggleAuth(key) {
    setAuthState(p => ({ ...p, [key]: !p[key] }));
  }

  function addLog(entry) {
    setLogs(l => [...l, { ...entry, id: Date.now() + Math.random() }]);
  }

  const loadDriveFiles = async (token) => {
    setDriveError(null);
    try {
      const files = await fetchDriveFiles(token, 10);
      setDriveFiles(files);
      if (files.length > 0) {
        setSelectedFileId(files[0].id);
        const text = await fetchFileText(token, files[0]);
        setDriveContent(text);
        setNotes(text);
      } else {
        setDriveFiles([]);
      }
    } catch (err) {
      console.error("Drive fetch failed:", err);
      setDriveError("Failed to fetch Drive files. Token may have expired — reconnect Drive.");
      setDriveFiles([]);
    }
  };

  const onSelectFile = async (fileId) => {
    setSelectedFileId(fileId);
    if (!accessToken) return;
    const file = driveFiles.find(f => f.id === fileId);
    if (!file) return;
    const text = await fetchFileText(accessToken, file);
    setDriveContent(text);
    setNotes(text);
  };

  const login = useGoogleLogin({
    scope: "https://www.googleapis.com/auth/drive.readonly",
    onSuccess: async (tokenResponse) => {
      const token = tokenResponse.access_token;
      setAccessToken(token);
      localStorage.setItem("drive_token", token);
      localStorage.setItem("drive_connected", "true");
      setAuthState(p => ({ ...p, drive: true }));
      await loadDriveFiles(token);
    },
    onError: (err) => {
      console.error("OAuth error:", err);
      setDriveError("Google login failed.");
    },
  });

  useEffect(() => {
    const token = localStorage.getItem("drive_token");
    const connected = localStorage.getItem("drive_connected");
    if (token && connected) {
      setAccessToken(token);
      setAuthState(p => ({ ...p, drive: true }));
      loadDriveFiles(token);
    }
  }, []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  async function runPipeline() {
    if (!notes.trim()) return;
    setTasks([]);
    setLogs([]);
    setStage("detecting");

    addLog({ icon: "📁", text: "detect_post_meeting_doc", sub: `Scanning Drive for docs linked to "${meetingTitle}"...`, status: "running" });
    await delay(800);
    addLog({ icon: "✅", text: "Doc loaded", sub: selectedFileId ? `File: ${driveFiles?.find(f => f.id === selectedFileId)?.name || selectedFileId}` : "Using pasted notes", status: "done" });

    setStage("extracting");
    addLog({ icon: "🧠", text: "extract_action_items", sub: "Calling OpenRouter (Gemma) — extracting tasks, owners, deadlines...", status: "running" });

    let extracted = [];
    try {
      extracted = await extractTasksWithAI(notes);
      if (extracted.length > 0) {
        addLog({ icon: "✅", text: `${extracted.length} action items extracted`, sub: `Owners: ${[...new Set(extracted.map(t => t.owner?.split(" ")[0]))].join(", ")}`, status: "done" });
      }
    } catch (err) {
      console.error("AI extraction failed:", err);
      addLog({ icon: "❌", text: "Extraction failed", sub: err.message, status: "error" });
    }

    if (!extracted.length) {
      extracted = [
        { task: "Finalize mobile design specs", owner: "Priya K", deadline: "Apr 25", priority: "high" },
        { task: "Fix auth timeout bug", owner: "James M", deadline: "End of sprint", priority: "high" },
        { task: "Schedule customer interviews", owner: "Lin C", deadline: "Next week", priority: "medium" },
        { task: "Update pricing page copy", owner: "Arjun S", deadline: "Apr 24", priority: "medium" },
        { task: "Draft Q2 OKR summary doc", owner: "Maya R", deadline: "Apr 28", priority: "low" },
      ];
      addLog({ icon: "⚠️", text: "Using fallback demo tasks", sub: "AI returned empty — check console for details", status: "done" });
    }

    setTasks(extracted);

    setStage("creating");
    addLog({ icon: "⚡", text: "create_linear_tasks", sub: `Creating ${extracted.length} tickets in Linear...`, status: "running" });
    await delay(1000);
    extracted.forEach((t, i) => {
      addLog({ icon: "🎫", text: `ENG-${411 + i} created`, sub: `${t.task} → ${t.owner}`, status: "done" });
    });

    setStage("notifying");
    addLog({ icon: "💬", text: "notify_assignees", sub: `Sending Slack DMs to ${[...new Set(extracted.map(t => t.owner))].length} members...`, status: "running" });
    await delay(800);
    [...new Set(extracted.map(t => t.owner))].forEach(owner => {
      addLog({ icon: "✉️", text: `DM sent to @${owner?.split(" ")[0]?.toLowerCase()}`, sub: `${extracted.filter(t => t.owner === owner).length} task(s) included`, status: "done" });
    });

    setStage("done");
    addLog({ icon: "🎉", text: "Pipeline complete", sub: `${extracted.length} tasks · ${[...new Set(extracted.map(t => t.owner))].length} members notified`, status: "done" });
  }

  const stageLabel = {
    idle: "Ready", detecting: "Detecting doc…", extracting: "Extracting tasks…",
    creating: "Creating tickets…", notifying: "Notifying team…", done: "Complete",
  }[stage];

  return (
    <div style={{ fontFamily: "'DM Sans', 'Helvetica Neue', sans-serif", minHeight: "100vh", background: "#f9f9f7", color: "#1a1a1a" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,wght@0,400;0,500;0,600;1,400&family=DM+Mono:wght@400;500&display=swap');
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        @keyframes slideIn { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
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
          {["pipeline", "run", "history"].map(v => (
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
            { key: "drive", label: "Drive", icon: "📁" },
            { key: "calendar", label: "Calendar", icon: "📅" },
            { key: "linear", label: "Linear", icon: "⚡" },
            { key: "slack", label: "Slack", icon: "💬" },
          ].map(a => (
            <div key={a.key} onClick={() => a.key === "drive" ? login() : toggleAuth(a.key)} style={{ cursor: "pointer" }}>
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
              Watches Drive for post-meeting docs, extracts action items with AI, creates Linear tickets, and DMs every assignee on Slack.
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 28 }}>
              {[
                { num: "01", icon: "📁", tool: "detect_post_meeting_doc", title: "Detect doc", desc: "Fetches your latest Google Drive docs — select which one to process.", trigger: "Google Drive API" },
                { num: "02", icon: "🧠", tool: "extract_action_items", title: "Extract tasks", desc: "OpenRouter (Gemma) parses freeform notes to identify tasks, owners, and deadlines.", trigger: "OpenRouter API" },
                { num: "03", icon: "⚡", tool: "create_linear_tasks", title: "Create tickets", desc: "One Linear issue per action item, assigned to the right team member with priority.", trigger: "Linear API" },
                { num: "04", icon: "💬", tool: "notify_assignees", title: "DM assignees", desc: "Each person gets a Slack DM with their tasks, the meeting name, and deadline.", trigger: "Slack API" },
              ].map((s) => (
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

            {!allAuthed && (
              <div style={{
                background: "#FAEEDA", border: "0.5px solid #EF9F27", borderRadius: 10,
                padding: "13px 16px", marginBottom: 20, fontSize: 13, color: "#633806",
                display: "flex", alignItems: "center", gap: 10,
              }}>
                <span>⚠️</span>
                <div>
                  Connect all 4 integrations in the top bar.{" "}
                  <strong>{Object.values(authState).filter(Boolean).length}/4 connected.</strong>
                  {" "}Click the Drive badge to authenticate with Google.
                </div>
              </div>
            )}

            <button onClick={() => setView("run")} style={{
              padding: "11px 24px", borderRadius: 9, border: "none", cursor: "pointer",
              background: "#1a1a1a", color: "#fff", fontWeight: 600, fontSize: 14,
              fontFamily: "inherit", letterSpacing: "-0.01em",
            }}>Run pipeline →</button>
          </div>
        )}

        {/* ── RUN VIEW ── */}
        {view === "run" && (
          <div style={{ animation: "slideIn 0.3s ease" }}>

            {/* Drive file selector */}
            {authState.drive && (
              <div style={{ background: "#fff", border: "0.5px solid #e8e8e8", borderRadius: 10, padding: "14px 16px", marginBottom: 18 }}>
                <div style={{ fontSize: 12, color: "#888", fontWeight: 500, marginBottom: 8 }}>📁 Google Drive — select a document to load</div>
                {driveFiles === null ? (
                  <div style={{ fontSize: 13, color: "#aaa" }}>Loading Drive files…</div>
                ) : driveFiles.length === 0 ? (
                  <div style={{ fontSize: 13, color: "#aaa" }}>No files found in Drive.</div>
                ) : (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {driveFiles.map(file => (
                      <button key={file.id} onClick={() => onSelectFile(file.id)} style={{
                        padding: "5px 11px", borderRadius: 7, cursor: "pointer", fontSize: 12.5,
                        border: `0.5px solid ${selectedFileId === file.id ? "#1a1a1a" : "#e0e0e0"}`,
                        background: selectedFileId === file.id ? "#1a1a1a" : "#fafafa",
                        color: selectedFileId === file.id ? "#fff" : "#555",
                        fontFamily: "inherit", fontWeight: 500, transition: "all 0.15s",
                      }}>
                        {file.name.length > 32 ? file.name.slice(0, 32) + "…" : file.name}
                      </button>
                    ))}
                  </div>
                )}
                {driveError && <div style={{ color: "#A32D2D", fontSize: 12, marginTop: 8 }}>⚠️ {driveError}</div>}
              </div>
            )}

            {!authState.drive && (
              <div style={{
                background: "#E6F1FB", border: "0.5px solid #85B7EB", borderRadius: 10,
                padding: "13px 16px", marginBottom: 18, fontSize: 13, color: "#0C447C",
                display: "flex", alignItems: "center", gap: 10,
              }}>
                <span>ℹ️</span>
                <div>Connect Google Drive in the top bar to auto-load docs, or paste your meeting notes below.</div>
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
              <label style={{ fontSize: 12, color: "#888", display: "block", marginBottom: 5, fontWeight: 500 }}>
                Meeting notes {authState.drive && driveContent ? "(loaded from Drive — editable)" : "(paste here)"}
              </label>
              <textarea value={notes} onChange={e => setNotes(e.target.value)}
                placeholder="Paste your meeting notes here, or connect Drive to auto-load…"
                rows={10} style={{
                  width: "100%", padding: "11px 14px", borderRadius: 8,
                  border: "0.5px solid #e0e0e0", fontSize: 12.5, fontFamily: "'DM Mono', monospace",
                  background: "#fff", outline: "none", color: "#333", lineHeight: 1.7,
                }} />
            </div>

            <div style={{ display: "flex", gap: 10, marginBottom: 22 }}>
              <button onClick={runPipeline}
                disabled={stage !== "idle" && stage !== "done"}
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

            {(tasks.length > 0 || logs.length > 0) && (
              <div style={{ background: "#fff", border: "0.5px solid #e8e8e8", borderRadius: 12, overflow: "hidden" }}>
                <div style={{ display: "flex", borderBottom: "0.5px solid #e8e8e8", background: "#fafafa" }}>
                  {["tasks", "slack", "log"].map(t => (
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
                        : tasks.map((t, i) => <SlackMessage key={i} task={t} index={i} />)
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
                  <span style={{ fontSize: 11.5, background: "#f4f4f4", padding: "3px 9px", borderRadius: 99, color: "#555" }}>{r.tasks} tasks</span>
                  <span style={{ fontSize: 11.5, background: "#E1F5EE", padding: "3px 9px", borderRadius: 99, color: "#085041" }}>{r.members} notified</span>
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
