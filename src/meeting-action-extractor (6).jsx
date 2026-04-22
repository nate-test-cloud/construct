import { useState, useCallback } from "react";

// ─── Anthropic API ─────────────────────────────────────────────────────
async function analyzeMeeting(notes, fallbackDate) {
  const prompt = `You are analyzing raw meeting notes. Return ONLY a single valid JSON object — no markdown, no backticks, no explanation.

FALLBACK DATE: If no date is mentioned in the meeting notes, you MUST use this date: ${fallbackDate}

The JSON must have exactly these keys:
{
  "title": "Short professional title summarising the meeting (specific, not generic like 'Team Meeting')",
  "date": "YYYY-MM-DD format. Extract from notes if mentioned, otherwise use: ${fallbackDate}",
  "summary": "2-3 sentence summary of what the meeting was about",
  "tasks": [
    {
      "task": "specific action item",
      "owner": "full name of person responsible, or 'Unassigned'",
      "deadline": "YYYY-MM-DD if a real date is mentioned or clearly implied, otherwise 'No deadline'",
      "priority": "high | medium | low based on urgency language in the notes"
    }
  ]
}
`;

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": "Bearer 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",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "openrouter/free",
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: notes }
      ],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`API error: ${err}`);
  }

  const data = await response.json();
  const raw =
    data?.choices?.[0]?.message?.content ||
    data?.content?.map?.(b => b.text || "").join("") ||
    "";

  if (!raw) throw new Error("Empty response from model");
  const clean = raw.replace(/```json|```/gi, "").trim();
  const match = clean.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("No JSON found in response");

  let parsed;
  try {
    parsed = JSON.parse(match[0]);
  } catch (e) {
    throw new Error("Failed to parse JSON");
  }

  return {
    title: parsed.title || "Untitled Meeting",
    date: parsed.date || fallbackDate,
    summary: parsed.summary || "",
    tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
  };
}

// ─── Google OAuth ──────────────────────────────────────────────────────
const CLIENT_ID = "77065490099-3hv8t5n9nlddqs48hdphil370meectlb.apps.googleusercontent.com";
const SCOPES = [
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/calendar.events",
].join(" ");

function openGoogleOAuth(onToken, onError) {
  const width = 500, height = 600;
  const left = window.screenX + (window.outerWidth - width) / 2;
  const top = window.screenY + (window.outerHeight - height) / 2;

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: window.location.origin,
    response_type: "token",
    scope: SCOPES,
    prompt: "consent",
  });

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  const popup = window.open(authUrl, "google-oauth", `width=${width},height=${height},left=${left},top=${top}`);

  const interval = setInterval(() => {
    try {
      if (!popup || popup.closed) {
        clearInterval(interval);
        onError("Popup closed");
        return;
      }
      const url = popup.location.href;
      if (url.includes("access_token")) {
        clearInterval(interval);
        popup.close();
        const hash = new URLSearchParams(popup.location.hash.replace("#", ""));
        const token = hash.get("access_token");
        if (token) onToken(token);
        else onError("No token found");
      }
    } catch (e) {
      // Cross-origin, keep waiting
    }
  }, 200);
}

// ─── Google Drive helpers ──────────────────────────────────────────────
const READABLE_MIME_TYPES = [
  "application/vnd.google-apps.document",
  "text/plain",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

async function fetchDriveFiles(token) {
  const mimeQuery = READABLE_MIME_TYPES.map(m => `mimeType='${m}'`).join(" or ");
  const q = encodeURIComponent(`(${mimeQuery}) and trashed=false`);
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&orderBy=modifiedTime desc&pageSize=30&fields=files(id,name,mimeType,modifiedTime,createdTime)`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error("Drive fetch failed");
  const data = await res.json();
  return data.files || [];
}

async function fetchFileText(token, file) {
  if (file.mimeType === "application/vnd.google-apps.document") {
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${file.id}/export?mimeType=text/plain`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) throw new Error("Export failed");
    return res.text();
  }
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error("File read failed");
  return res.text();
}

// ─── Google Calendar: create event ────────────────────────────────────
// Works with OR without a deadline. Tasks without a deadline are added as
// an all-day event on today, titled with priority prefix so it's visible.
async function createCalendarEvent(token, task, meetingTitle) {
  const today = new Date().toISOString().split("T")[0];
  const dateStr = (task.deadline && task.deadline !== "No deadline") ? task.deadline : today;

  const priorityLabel = task.priority ? ` (${task.priority.toLowerCase()})` : "";
  const event = {
    summary: `${task.task}${priorityLabel}`,
    description: `Action item from: ${meetingTitle}\nAssigned to: ${task.owner}\nPriority: ${task.priority || "medium"}`,
    start: { date: dateStr },
    end: { date: dateStr },
  };

  const res = await fetch(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(event),
    }
  );

  if (!res.ok) return null;
  const data = await res.json();
  // Return the Google Calendar event ID so we can delete it later
  return data.id || null;
}

// ─── Google Calendar: delete event ────────────────────────────────────
async function deleteCalendarEvent(token, eventId) {
  if (!eventId) return false;
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    }
  );
  // 204 = success, 410 = already gone — both are fine
  return res.status === 204 || res.status === 410;
}


// ─── Slack: post task to #tasks ───────────────────────────────────────
const SLACK_TOKEN = "";
const SLACK_CHANNEL = "#tasks";

async function postToSlack(task, meetingTitle) {
  const priorityEmoji = { high: "🔴", medium: "🟡", low: "🟢" }[task.priority?.toLowerCase()] || "⚪";
  const dateStr = (task.deadline && task.deadline !== "No deadline") ? task.deadline : "No deadline";
  const text = [
    `${priorityEmoji} *${task.task}* (${task.priority || "medium"})`,
    `📅 ${dateStr}`,
    `👤 Assigned to: ${task.owner}`,
    `📌 From: ${meetingTitle}`,
  ].join("\n");
  await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SLACK_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ channel: SLACK_CHANNEL, text }),
  });
  // Intentionally silent on failure — Calendar add still succeeds
}

// ─── Color palette per person ──────────────────────────────────────────
const OWNER_COLORS = [
  { bg: "#EEF2FF", text: "#3730A3", dot: "#818CF8" },
  { bg: "#F0FDF4", text: "#166534", dot: "#4ADE80" },
  { bg: "#FFF7ED", text: "#9A3412", dot: "#FB923C" },
  { bg: "#FDF4FF", text: "#7E22CE", dot: "#C084FC" },
  { bg: "#ECFEFF", text: "#164E63", dot: "#22D3EE" },
  { bg: "#FFF1F2", text: "#9F1239", dot: "#FB7185" },
];
const ownerColorMap = {};
let colorIdx = 0;
function getOwnerColor(owner) {
  if (!ownerColorMap[owner]) {
    ownerColorMap[owner] = OWNER_COLORS[colorIdx % OWNER_COLORS.length];
    colorIdx++;
  }
  return ownerColorMap[owner];
}

function initials(name) {
  if (!name || name === "Unassigned") return "?";
  return name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
}

// ─── Components ───────────────────────────────────────────────────────
function Avatar({ name, size = 34 }) {
  const c = getOwnerColor(name);
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%",
      background: c.bg, color: c.text,
      border: `1.5px solid ${c.dot}60`,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: size * 0.33, fontWeight: 700, flexShrink: 0,
      letterSpacing: "-0.03em",
    }}>{initials(name)}</div>
  );
}

function Badge({ children, color = "#f4f4f4", textColor = "#555", style, onClick, onMouseEnter, onMouseLeave }) {
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 600,
        padding: "2px 8px",
        borderRadius: 99,
        background: color,
        color: textColor,
        letterSpacing: "0.02em",
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        cursor: onClick ? "pointer" : "default",
        transition: "all 0.15s",
        ...style,
      }}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {children}
    </span>
  );
}

function PriorityBadge({ priority, onClick, disabled }) {
  const map = {
    high:   { bg: "#FEE2E2", color: "#991B1B" },
    medium: { bg: "#FEF3C7", color: "#92400E" },
    low:    { bg: "#F1F5F9", color: "#475569" },
  };
  const s = map[priority?.toLowerCase()] || map.medium;
  return (
    <span
      onClick={onClick}
      style={{
        fontSize: 11, fontWeight: 600, padding: "2px 8px",
        borderRadius: 99, background: s.bg, color: s.color,
        letterSpacing: "0.02em", display: "inline-flex", alignItems: "center", gap: 3,
        cursor: (onClick && !disabled) ? "pointer" : "default",
        transition: "all 0.15s",
        opacity: disabled ? 0.5 : 1,
      }}
      onMouseEnter={e => (onClick && !disabled) && (e.currentTarget.style.opacity = "0.8")}
      onMouseLeave={e => (onClick && !disabled) && (e.currentTarget.style.opacity = disabled ? "0.5" : "1")}
    >
      {(priority || "medium").toUpperCase()}
    </span>
  );
}

// calendarEventIds: { [taskName]: googleEventId }
function TaskCard({ task, index, onCalendarToggle, calendarEventIds, calendarLoading, onPriorityChange, onRemoveTask, onUpdateTask }) {
  const [editingTask, setEditingTask] = useState(false);
  const [editingDeadline, setEditingDeadline] = useState(false);
  const [editedTaskText, setEditedTaskText] = useState(task.task);
  const [editedDeadline, setEditedDeadline] = useState(task.deadline);

  const c = getOwnerColor(task.owner);
  const hasDate = task.deadline && task.deadline !== "No deadline";
  const isAdded = !!calendarEventIds[task.task];
  const isLoading = calendarLoading[task.task];

  const cyclePriority = () => {
    const priorities = ["high", "medium", "low"];
    const current = task.priority?.toLowerCase() || "medium";
    const currentIdx = priorities.indexOf(current);
    onPriorityChange(task.task, priorities[(currentIdx + 1) % 3]);
  };

  const saveTaskEdit = () => {
    if (editedTaskText.trim() && editedTaskText !== task.task) {
      onUpdateTask(task.task, editedTaskText, task.deadline);
    } else {
      setEditedTaskText(task.task);
    }
    setEditingTask(false);
  };

  const saveDeadlineEdit = () => {
    if (editedDeadline !== task.deadline) {
      onUpdateTask(task.task, task.task, editedDeadline);
    }
    setEditingDeadline(false);
  };

  const handleTaskKeyDown = (e) => {
    if (e.key === "Enter") saveTaskEdit();
    if (e.key === "Escape") { setEditedTaskText(task.task); setEditingTask(false); }
  };

  const handleDeadlineKeyDown = (e) => {
    if (e.key === "Enter") saveDeadlineEdit();
    if (e.key === "Escape") { setEditedDeadline(task.deadline); setEditingDeadline(false); }
  };

  // Cal button label
  let calLabel = "+ Cal";
  if (isLoading) calLabel = "…";
  else if (isAdded) calLabel = "✓ Added";

  return (
    <div style={{
      background: "#fff",
      border: "1px solid #F1F5F9",
      borderRadius: 12,
      padding: "14px 16px",
      display: "flex",
      gap: 12,
      alignItems: "flex-start",
      animation: `fadeUp 0.35s ease both`,
      animationDelay: `${index * 70}ms`,
      transition: "box-shadow 0.15s",
    }}
      onMouseEnter={e => e.currentTarget.style.boxShadow = "0 4px 20px rgba(0,0,0,0.06)"}
      onMouseLeave={e => e.currentTarget.style.boxShadow = "none"}
    >
      <Avatar name={task.owner} />
      <div style={{ flex: 1, minWidth: 0 }}>
        {editingTask ? (
          <input
            type="text"
            value={editedTaskText}
            onChange={e => setEditedTaskText(e.target.value)}
            onBlur={saveTaskEdit}
            onKeyDown={handleTaskKeyDown}
            autoFocus
            style={{
              width: "100%", padding: "6px 8px", fontSize: 13.5, fontWeight: 600,
              border: "1.5px solid #0F172A", borderRadius: 6, color: "#0F172A",
              outline: "none", marginBottom: 7,
            }}
          />
        ) : (
          <div
            onClick={() => setEditingTask(true)}
            style={{
              fontSize: 13.5, fontWeight: 600, color: "#0F172A", lineHeight: 1.45,
              marginBottom: 7, cursor: "pointer", padding: "2px 4px", borderRadius: 4,
              transition: "background 0.15s",
            }}
            onMouseEnter={e => e.currentTarget.style.background = "#F0F0F0"}
            onMouseLeave={e => e.currentTarget.style.background = "transparent"}
          >
            {task.task}
          </div>
        )}
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center" }}>
          <Badge color={c.bg} textColor={c.text}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: c.dot, display: "inline-block" }} />
            {task.owner}
          </Badge>
          {hasDate ? (
            editingDeadline ? (
              <input
                type="date"
                value={editedDeadline === "No deadline" ? "" : editedDeadline}
                onChange={e => setEditedDeadline(e.target.value || "No deadline")}
                onBlur={saveDeadlineEdit}
                onKeyDown={handleDeadlineKeyDown}
                autoFocus
                style={{
                  fontSize: 11, fontWeight: 600, padding: "4px 6px",
                  borderRadius: 4, border: "1.5px solid #1D4ED8", outline: "none", cursor: "pointer",
                }}
              />
            ) : (
              <Badge
                color="#EFF6FF" textColor="#1D4ED8"
                style={{ cursor: "pointer" }}
                onClick={() => !isAdded && setEditingDeadline(true)}
                onMouseEnter={e => e.currentTarget.style.opacity = "0.8"}
                onMouseLeave={e => e.currentTarget.style.opacity = "1"}
              >
                📅 {task.deadline}
              </Badge>
            )
          ) : (
            <Badge color="#F8FAFC" textColor="#94A3B8" style={{ cursor: !isAdded ? "pointer" : "default" }}
              onClick={() => !isAdded && setEditingDeadline(true)}
            >
              📅 No deadline
            </Badge>
          )}
          <PriorityBadge priority={task.priority} onClick={isAdded ? undefined : cyclePriority} disabled={isAdded} />
        </div>
      </div>

      {/* +Cal / ✓ Added / remove button */}
      <button
        onClick={() => !isLoading && onCalendarToggle(task)}
        onMouseEnter={e => !isLoading && (e.currentTarget.style.transform = "scale(1.05)")}
        onMouseLeave={e => e.currentTarget.style.transform = "scale(1)"}
        style={{
          padding: "5px 10px", borderRadius: 7,
          background: isAdded ? "#F0FDF4" : "#F8FAFC",
          color: isAdded ? "#166534" : "#64748B",
          fontSize: 11, fontWeight: 600,
          cursor: isLoading ? "wait" : "pointer",
          flexShrink: 0, transition: "all 0.15s",
          border: `1px solid ${isAdded ? "#BBF7D0" : "#E2E8F0"}`,
          opacity: isLoading ? 0.7 : 1,
        }}
        title={isAdded ? "Click to remove from Calendar" : "Add to Google Calendar"}
      >
        {calLabel}
      </button>
      <button
        onClick={() => onRemoveTask(task)}
        style={{
          padding: "5px 10px", borderRadius: 7,
          background: "#FEE2E2", color: "#991B1B",
          fontSize: 11, fontWeight: 600, cursor: "pointer",
          flexShrink: 0, transition: "all 0.15s",
          border: "1px solid #FECDD3",
        }}
        title="Remove task"
      >
        ✕
      </button>
    </div>
  );
}

function Spinner() {
  return (
    <div style={{
      width: 16, height: 16, borderRadius: "50%",
      border: "2px solid #E2E8F0",
      borderTopColor: "#0F172A",
      animation: "spin 0.7s linear infinite",
      display: "inline-block",
    }} />
  );
}

// ─── Main App ─────────────────────────────────────────────────────────
export default function App() {
  const [accessToken, setAccessToken] = useState(null);
  const [driveConnected, setDriveConnected] = useState(false);
  const [calendarConnected, setCalendarConnected] = useState(false);
  const [driveFiles, setDriveFiles] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [notes, setNotes] = useState("");
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [loadingFile, setLoadingFile] = useState(false);

  const [meetingTitle, setMeetingTitle] = useState("");
  const [meetingDate, setMeetingDate] = useState("");
  const [meetingSummary, setMeetingSummary] = useState("");
  const [tasks, setTasks] = useState([]);
  const [removedTasks, setRemovedTasks] = useState([]);

  // { [taskName]: googleCalendarEventId }  — the source of truth for "added" state
  const [calendarEventIds, setCalendarEventIds] = useState({});
  // { [taskName]: true }  — tasks currently being added/removed (loading state)
  const [calendarLoading, setCalendarLoading] = useState({});

  const [stage, setStage] = useState("idle");
  const [error, setError] = useState("");
  const [statusMsg, setStatusMsg] = useState("");
  const [activeTab, setActiveTab] = useState("tasks");

  const connectGoogle = useCallback(() => {
    setError("");
    openGoogleOAuth(
      async (token) => {
        setAccessToken(token);
        setDriveConnected(true);
        setCalendarConnected(true);
        setLoadingFiles(true);
        try {
          const files = await fetchDriveFiles(token);
          setDriveFiles(files);
        } catch (e) {
          setError("Could not load Drive files. Try reconnecting.");
        }
        setLoadingFiles(false);
      },
      (err) => setError("Google login failed: " + err)
    );
  }, []);

  const selectFile = async (file) => {
    setSelectedFile(file);
    setNotes("");
    setMeetingTitle("");
    setMeetingSummary("");
    setTasks([]);
    setRemovedTasks([]);
    setStage("idle");
    setError("");
    setLoadingFile(true);
    try {
      const text = await fetchFileText(accessToken, file);
      setNotes(text);
      const fileDateStr = file.createdTime || file.modifiedTime;
      setMeetingDate(fileDateStr
        ? new Date(fileDateStr).toISOString().split("T")[0]
        : new Date().toISOString().split("T")[0]
      );
    } catch (e) {
      setError("Could not read this file.");
    }
    setLoadingFile(false);
  };

  const runPipeline = async () => {
    if (!notes.trim()) return;
    setStage("running");
    setError("");
    setTasks([]);
    setMeetingTitle("");
    setMeetingSummary("");
    setCalendarEventIds({});
    setCalendarLoading({});

    try {
      setStatusMsg("Reading meeting notes…");
      const fallbackDate = meetingDate && meetingDate.trim()
        ? meetingDate
        : new Date().toISOString().split("T")[0];
      setStatusMsg("AI is analysing the meeting…");
      const result = await analyzeMeeting(notes, fallbackDate);
      setMeetingTitle(result.title);
      setMeetingDate(result.date || fallbackDate);
      setMeetingSummary(result.summary);
      setTasks(result.tasks);
      setRemovedTasks([]);
      setActiveTab("tasks");
      setStage("done");
      setStatusMsg("");
    } catch (e) {
      setError(e.message || "Something went wrong.");
      setStage("error");
      setStatusMsg("");
    }
  };

  // Toggle a single task on/off in Google Calendar.
  // If adding   → call createCalendarEvent, store the returned event ID.
  // If removing → call deleteCalendarEvent with the stored event ID, then clear it.
  const onCalendarToggle = async (task) => {
    if (!calendarConnected || !accessToken) {
      setError("Connect Google first to use Calendar.");
      return;
    }

    const alreadyAdded = !!calendarEventIds[task.task];

    // Mark as loading
    setCalendarLoading(l => ({ ...l, [task.task]: true }));

    if (alreadyAdded) {
      // ── Remove from Google Calendar ──────────────────────────────────
      const eventId = calendarEventIds[task.task];
      const ok = await deleteCalendarEvent(accessToken, eventId);
      if (ok || true) {
        // Always clear locally even if event was already gone on Google's side
        setCalendarEventIds(ids => {
          const copy = { ...ids };
          delete copy[task.task];
          return copy;
        });
      } else {
        setError("Failed to remove from Calendar. Try again.");
      }
    } else {
      // ── Add to Google Calendar ───────────────────────────────────────
      const eventId = await createCalendarEvent(accessToken, task, meetingTitle);
      if (eventId) {
        setCalendarEventIds(ids => ({ ...ids, [task.task]: eventId }));
        postToSlack(task, meetingTitle);
      } else {
        setError("Failed to add to Calendar. Token may have expired — try reconnecting Google.");
      }
    }

    setCalendarLoading(l => {
      const copy = { ...l };
      delete copy[task.task];
      return copy;
    });
  };

  // Add ALL tasks to calendar at once
  const pushAllToCalendar = async () => {
    if (!calendarConnected || !accessToken) return;
    for (const t of tasks) {
      if (!calendarEventIds[t.task]) {
        await onCalendarToggle(t);
      }
    }
  };

  const onPriorityChange = (taskName, newPriority) => {
    setTasks(tasks.map(t => t.task === taskName ? { ...t, priority: newPriority } : t));
  };

  const removeTask = (taskToRemove) => {
    setTasks(tasks.filter(t => t.task !== taskToRemove.task));
    setRemovedTasks([...removedTasks, taskToRemove]);
    // If it was in the calendar, clean up local state (event stays in Google Calendar)
    if (calendarEventIds[taskToRemove.task]) {
      setCalendarEventIds(ids => {
        const copy = { ...ids };
        delete copy[taskToRemove.task];
        return copy;
      });
    }
  };

  const restoreTask = (taskToRestore) => {
    setRemovedTasks(removedTasks.filter(t => t.task !== taskToRestore.task));
    setTasks([...tasks, taskToRestore]);
  };

  const updateTask = (oldTaskName, newTaskName, newDeadline) => {
    setTasks(tasks.map(t =>
      t.task === oldTaskName
        ? { ...t, task: newTaskName, deadline: newDeadline }
        : t
    ));
    // Re-key the calendar event ID if task name changed
    if (oldTaskName !== newTaskName && calendarEventIds[oldTaskName]) {
      setCalendarEventIds(ids => {
        const copy = { ...ids };
        copy[newTaskName] = copy[oldTaskName];
        delete copy[oldTaskName];
        return copy;
      });
    }
  };

  const addedCount = Object.keys(calendarEventIds).length;

  return (
    <div style={{
      fontFamily: "'DM Sans', system-ui, sans-serif",
      minHeight: "100vh",
      background: "#F8FAFC",
      color: "#0F172A",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=DM+Mono:wght@400;500&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        @keyframes fadeUp { from { opacity:0; transform:translateY(10px) } to { opacity:1; transform:translateY(0) } }
        @keyframes spin { to { transform: rotate(360deg) } }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
        textarea { resize: vertical; }
        button { font-family: inherit; }
        ::-webkit-scrollbar { width: 5px; height: 5px; }
        ::-webkit-scrollbar-thumb { background: #CBD5E1; border-radius: 3px; }
      `}</style>

      {/* ── Header ── */}
      <div style={{
        background: "#fff",
        borderBottom: "1px solid #E2E8F0",
        padding: "0 28px",
        height: 56,
        display: "flex",
        alignItems: "center",
        gap: 12,
        position: "sticky",
        top: 0,
        zIndex: 100,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <div style={{
            width: 30, height: 30, borderRadius: 8,
            background: "#0F172A",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 15,
          }}>📋</div>
          <span style={{ fontWeight: 700, fontSize: 14.5, letterSpacing: "-0.02em" }}>MeetingOS</span>
        </div>

        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          {driveConnected && (
            <span style={{
              fontSize: 12, fontWeight: 500, color: "#166534",
              background: "#F0FDF4", border: "1px solid #BBF7D0",
              borderRadius: 99, padding: "4px 12px",
              display: "flex", alignItems: "center", gap: 5,
            }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#22C55E", display: "inline-block" }} />
              Google connected
            </span>
          )}
          <button
            onClick={connectGoogle}
            style={{
              padding: "7px 16px", borderRadius: 8,
              border: "1px solid #E2E8F0",
              background: driveConnected ? "#F8FAFC" : "#0F172A",
              color: driveConnected ? "#64748B" : "#fff",
              fontSize: 12.5, fontWeight: 600, cursor: "pointer",
              transition: "all 0.15s",
            }}
          >
            {driveConnected ? "Reconnect" : "Connect Google"}
          </button>
        </div>
      </div>

      <div style={{ maxWidth: 800, margin: "0 auto", padding: "32px 20px 80px" }}>

        {/* ── Meeting meta header ── */}
        <div style={{
          background: "#fff",
          border: "1px solid #E2E8F0",
          borderRadius: 16,
          padding: "20px 24px",
          marginBottom: 20,
          animation: "fadeUp 0.3s ease",
        }}>
          <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#94A3B8", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>
                Meeting Title
              </div>
              <div style={{
                fontSize: 21, fontWeight: 700, letterSpacing: "-0.025em",
                color: meetingTitle ? "#0F172A" : "#CBD5E1",
                minHeight: 30,
              }}>
                {meetingTitle || (stage === "running"
                  ? <span style={{ animation: "pulse 1.5s ease infinite", display: "inline-block" }}>Analysing…</span>
                  : "Run pipeline to get title"
                )}
              </div>
              {meetingSummary && (
                <div style={{ fontSize: 13, color: "#64748B", marginTop: 7, lineHeight: 1.6 }}>
                  {meetingSummary}
                </div>
              )}
            </div>
            <div style={{ textAlign: "right", flexShrink: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#94A3B8", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>
                Date
              </div>
              <div style={{
                fontSize: 15, fontWeight: 600,
                color: meetingDate ? "#0F172A" : "#CBD5E1",
                fontFamily: "'DM Mono', monospace",
              }}>
                {meetingDate || "—"}
              </div>
            </div>
          </div>
        </div>

        {/* ── Drive file picker ── */}
        {driveConnected && (
          <div style={{
            background: "#fff",
            border: "1px solid #E2E8F0",
            borderRadius: 12,
            padding: "16px 20px",
            marginBottom: 20,
            animation: "fadeUp 0.3s ease 0.05s both",
          }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#64748B", marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
              📁 Google Drive {loadingFiles && <Spinner />}
            </div>
            {driveFiles.length === 0 && !loadingFiles && (
              <div style={{ fontSize: 13, color: "#94A3B8" }}>No files found.</div>
            )}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {driveFiles.map(f => (
                <button
                  key={f.id}
                  onClick={() => selectFile(f)}
                  style={{
                    padding: "5px 12px", borderRadius: 8,
                    border: `1px solid ${selectedFile?.id === f.id ? "#0F172A" : "#E2E8F0"}`,
                    background: selectedFile?.id === f.id ? "#0F172A" : "#F8FAFC",
                    color: selectedFile?.id === f.id ? "#fff" : "#475569",
                    fontSize: 12.5, fontWeight: 500,
                    cursor: "pointer", transition: "all 0.12s",
                  }}
                >
                  {f.name.length > 35 ? f.name.slice(0, 35) + "…" : f.name}
                </button>
              ))}
            </div>
            {loadingFile && (
              <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, color: "#64748B" }}>
                <Spinner /> Loading file…
              </div>
            )}
          </div>
        )}

        {/* ── Notes textarea ── */}
        <div style={{
          background: "#fff",
          border: "1px solid #E2E8F0",
          borderRadius: 12,
          padding: "16px 20px",
          marginBottom: 20,
          animation: "fadeUp 0.3s ease 0.1s both",
        }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#64748B", marginBottom: 10 }}>
            Meeting Notes {selectedFile ? `— ${selectedFile.name}` : "(paste or load from Drive)"}
          </div>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Paste your meeting notes here, or select a file from Drive above…"
            rows={10}
            style={{
              width: "100%", padding: "12px 14px", borderRadius: 8,
              border: "1px solid #E2E8F0", fontSize: 13,
              fontFamily: "'DM Mono', monospace", color: "#334155",
              lineHeight: 1.7, background: "#F8FAFC", outline: "none",
            }}
          />
        </div>

        {/* ── Run / Add all / Reset buttons ── */}
        <div style={{ display: "flex", gap: 10, marginBottom: 28, alignItems: "center", flexWrap: "wrap" }}>
          <button
            onClick={runPipeline}
            disabled={!notes.trim() || stage === "running"}
            style={{
              padding: "11px 28px", borderRadius: 10, border: "none",
              background: (!notes.trim() || stage === "running") ? "#CBD5E1" : "#0F172A",
              color: "#fff", fontWeight: 700, fontSize: 14, cursor: (!notes.trim() || stage === "running") ? "not-allowed" : "pointer",
              display: "flex", alignItems: "center", gap: 8, transition: "all 0.15s",
            }}
          >
            {stage === "running" ? <><Spinner /> Analysing…</> : "▶  Run Pipeline"}
          </button>

          {stage === "done" && tasks.length > 0 && calendarConnected && (
            <button
              onClick={pushAllToCalendar}
              style={{
                padding: "11px 20px", borderRadius: 10,
                border: "1px solid #BBF7D0", background: "#F0FDF4",
                color: "#166534", fontWeight: 600, fontSize: 13.5, cursor: "pointer",
                transition: "all 0.15s",
              }}
            >
              📅 Add all to Calendar ({tasks.length - addedCount} remaining)
            </button>
          )}

          {stage === "done" && (
            <button
              onClick={() => {
                setStage("idle"); setTasks([]); setNotes("");
                setMeetingTitle(""); setMeetingDate(""); setMeetingSummary("");
                setSelectedFile(null); setCalendarEventIds({}); setCalendarLoading({});
              }}
              style={{
                padding: "11px 18px", borderRadius: 10,
                border: "1px solid #E2E8F0", background: "#fff",
                color: "#64748B", fontWeight: 500, fontSize: 13.5, cursor: "pointer",
              }}
            >
              Reset
            </button>
          )}

          {statusMsg && (
            <div style={{ fontSize: 13, color: "#64748B", display: "flex", alignItems: "center", gap: 6 }}>
              <Spinner /> {statusMsg}
            </div>
          )}
        </div>

        {/* ── Error ── */}
        {error && (
          <div style={{
            background: "#FFF1F2", border: "1px solid #FECDD3",
            borderRadius: 10, padding: "12px 16px",
            fontSize: 13, color: "#9F1239", marginBottom: 20,
          }}>
            ⚠️ {error}
          </div>
        )}

        {/* ── Calendar notice when not connected ── */}
        {stage === "done" && tasks.length > 0 && !calendarConnected && (
          <div style={{
            background: "#FFFBEB", border: "1px solid #FDE68A",
            borderRadius: 10, padding: "12px 16px",
            fontSize: 13, color: "#92400E", marginBottom: 20,
            display: "flex", alignItems: "center", gap: 8,
          }}>
            ℹ️ Connect Google (top right) to enable adding tasks to your Calendar.
          </div>
        )}

        {/* ── Results ── */}
        {tasks.length > 0 && (
          <div style={{
            background: "#fff",
            border: "1px solid #E2E8F0",
            borderRadius: 16,
            overflow: "hidden",
            animation: "fadeUp 0.3s ease",
          }}>
            <div style={{
              display: "flex",
              borderBottom: "1px solid #E2E8F0",
              background: "#F8FAFC",
              padding: "0 4px",
            }}>
              {[
                { id: "tasks", label: `All Tasks (${tasks.filter(t => !calendarEventIds[t.task]).length})` },
                { id: "scheduled", label: `Added to Calendar (${addedCount})` },
              ].map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  style={{
                    padding: "11px 16px", border: "none", background: "transparent",
                    fontSize: 12.5,
                    fontWeight: activeTab === tab.id ? 700 : 500,
                    color: activeTab === tab.id ? "#0F172A" : "#94A3B8",
                    borderBottom: `2px solid ${activeTab === tab.id ? "#0F172A" : "transparent"}`,
                    cursor: "pointer", transition: "all 0.12s",
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
              {(activeTab === "tasks"
                ? tasks.filter(t => !calendarEventIds[t.task])
                : tasks.filter(t => !!calendarEventIds[t.task])
              ).map((t, i) => (
                <TaskCard
                  key={t.task + i}
                  task={t}
                  index={i}
                  onCalendarToggle={onCalendarToggle}
                  calendarEventIds={calendarEventIds}
                  calendarLoading={calendarLoading}
                  onPriorityChange={onPriorityChange}
                  onRemoveTask={removeTask}
                  onUpdateTask={updateTask}
                />
              ))}
              {activeTab === "tasks" && tasks.filter(t => !calendarEventIds[t.task]).length === 0 && (
                <div style={{ textAlign: "center", padding: "24px 0", fontSize: 13, color: "#94A3B8" }}>
                  🎉 All tasks added to Calendar!
                </div>
              )}
              {activeTab === "scheduled" && addedCount === 0 && (
                <div style={{ textAlign: "center", padding: "24px 0", fontSize: 13, color: "#94A3B8" }}>
                  No tasks added to Calendar yet. Hit "+ Cal" on any task.
                </div>
              )}
            </div>

            <div style={{
              borderTop: "1px solid #F1F5F9",
              padding: "12px 20px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              background: "#F8FAFC",
            }}>
              <span style={{ fontSize: 12, color: "#94A3B8" }}>
                {tasks.length} action items extracted
              </span>
              {calendarConnected && (
                <span style={{ fontSize: 12, color: "#64748B" }}>
                  {addedCount} / {tasks.length} added to Calendar
                </span>
              )}
            </div>
          </div>
        )}

        {/* ── Removed Tasks ── */}
        {removedTasks.length > 0 && (
          <div style={{
            background: "#FEF7F7",
            border: "1px solid #FECDD3",
            borderRadius: 12,
            padding: "16px 20px",
            marginTop: 20,
            animation: "fadeUp 0.3s ease",
          }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#991B1B", marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
              🗑️ Removed Tasks ({removedTasks.length})
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {removedTasks.map((t, i) => (
                <div key={i} style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  padding: "8px 12px", background: "#fff",
                  border: "1px solid #FECDD3", borderRadius: 8,
                  fontSize: 12, color: "#64748B",
                }}>
                  <span>{t.task}</span>
                  <button
                    onClick={() => restoreTask(t)}
                    style={{
                      padding: "4px 10px", borderRadius: 6,
                      background: "#F0FDF4", color: "#166534",
                      border: "1px solid #BBF7D0",
                      fontSize: 11, fontWeight: 600, cursor: "pointer", transition: "all 0.15s",
                    }}
                  >
                    ↩️ Restore
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Empty state ── */}
        {stage === "idle" && tasks.length === 0 && (
          <div style={{
            textAlign: "center", padding: "60px 20px",
            color: "#94A3B8", animation: "fadeUp 0.3s ease 0.2s both",
          }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📝</div>
            <div style={{ fontSize: 15, fontWeight: 500, color: "#64748B", marginBottom: 6 }}>
              {driveConnected
                ? "Select a file or paste your notes, then run."
                : "Connect Google to load from Drive, or paste notes below."}
            </div>
            <div style={{ fontSize: 13 }}>
              The AI will extract the title, date, all action items, owners, and deadlines.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
