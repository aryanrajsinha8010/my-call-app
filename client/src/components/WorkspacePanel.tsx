import { useState, useEffect, useRef } from 'react';
import { 
  FileText, Save, Download, RotateCcw, 
  Trash2, Layers, AlertCircle, RefreshCw, FileCode, Flame, History,
  Lock, Unlock
} from 'lucide-react';

interface WorkspacePanelProps {
  socket: any;
  roomName: string;
  myAlias: { name: string; avatar: string };
  participants: any[];
}

interface SavedVersion {
  id: string;
  title: string;
  savedBy: string;
  savedAt: string;
  text: string;
}

// Rich engineering templates
const ENGINEERING_TEMPLATES = {
  architecture: {
    title: "System Architecture Design",
    description: "High-fidelity blueprint including microservices, DB, caching and queue layers.",
    icon: Layers,
    text: `# NexaLink Core System Architecture Design
> [!NOTE]
> This is a collaborative workspace document. Real-time updates are enabled for all participants in this room.

## 1. Executive Topology Overview
We design NexaLink as an elite, ultra-low latency real-time communication platform utilizing a split-gateway hybrid topology:
- **Client Application**: React SPA utilizing WebRTC Peer-to-Peer data tunnels protected by AES-GCM-256 E2EE.
- **Signalling Server (Node.js/Socket.IO)**: Manages dynamic presence registrations, SDP/ICE candidate negotiations, and active room roster states.
- **API Core Gateway (FastAPI)**: Serves persistent schema queries, authentication endpoints, and compliance logging to Supabase.
- **AI Sidecar Server (Python)**: Orchestrates pipeline operations (transcriptions, neural TTS, translation layers).

## 2. Microservice Topology Diagram
\`\`\`mermaid
[Web Browser Client] <--- (WebRTC Data/Media Tunnels E2EE) ---> [Web Browser Peer]
       |                                                             |
(HTTP REST)                                                    (HTTP REST)
       v                                                             v
[API Core Gateway (Port 8001)] <--- (Auth & DB Actions) ---> [Supabase Storage/DB]
       |
  (Internal IPC)
       v
[AI Sidecar (Port 8002)] <--- (GPU Inference) ---> [Whisper / XTTS-v2 Engine]
\`\`\`

## 3. Data Residency & Encryption Protocol
1. **P2P Encrypted Channels**: Audio, video, and whiteboard stroke feeds are negotiated using ephemeral passphrases.
2. **Metadata Stripping**: Active files exchanged via peer data connections are dynamically stripped of EXIF and structural metadata.
3. **Residency Enforcement**: Supabase routing dynamically pins database queries to specified regions (e.g., US-West vs EU-Central).

---
*Created via NexaWorkspace Live Engineering Sandbox*`
  },
  retro: {
    title: "Sprint Retrospective Checklist",
    description: "Structure sprint review, milestones accomplished, and actionable future changes.",
    icon: RotateCcw,
    text: `# Sprint Retrospective Checklist
> [!TIP]
> Use this retro workspace to review our sprint deliverables, address tech-debt bottlenecks, and align on upcoming sprint milestones.

## 1. Velocity & Deliverables Summary
- **Sprint Target**: Real-time E2EE collaborative document workspace component (NexaWorkspace).
- **Velocity Target**: 45 Story Points.
- **Actual Delivered**: 48 Story Points.

## 2. Core Retrospective Pillars

### 👍 What Went Well
- Real-time WebRTC media tunnels successfully transitioned to adaptive-bitrate routing (ABR).
- Custom markdown tokenizer executes with extremely fast repaint loops on large documents.
- Signalling server CPU usage was reduced by 15% through event debouncing.

### ⚠️ What Needs Refinement
- Local testing of WebPush VAPID wake-ups under low-bandwidth connections showed minor timeouts.
- We need to establish automated migrations for PostgreSQL schema evolution inside the Supabase pipeline.

### 🚀 Concrete Action Items
1. **[E2E Optimization]**: Implement index optimizations for \`direct_messages\` matching conversations.
2. **[Diagnostics]**: Expose real-time websocket heartbeat graphs inside the developer diagnostics dashboard.

---
*Created via NexaWorkspace Live Engineering Sandbox*`
  },
  postmortem: {
    title: "Incident Post-Mortem Spec",
    description: "Trace service disruptions, reconstruct timelines, identify root cause and preventative fixes.",
    icon: Flame,
    text: `# Incident Post-Mortem Spec
> [!CAUTION]
> Treat post-mortems with maximum transparency. Focus on fixing system designs and processes, not assigning individual blame.

## 1. Incident Overview
- **Incident ID**: INC-9810
- **Severity**: SEV-1 (Critical Outage)
- **Impacted Systems**: Direct Messages REST routing and client presence visibility.
- **Duration**: 24 minutes (10:14 UTC - 10:38 UTC)

## 2. Root Cause Analysis (The 5 Whys)
1. **Why was the DM history endpoint unresponsive?**
   - The Supabase connection pool became saturated with pending requests.
2. **Why was the connection pool saturated?**
   - The client application was triggering redundant chat history refetches on every scroll event.
3. **Why were redundant refetches happening?**
   - The scroll listener lacked throttling or virtual viewport caching.
4. **Why was viewport caching missing?**
   - We prioritized rapid prototyping of the DM window without verifying performance under large message counts.
5. **Why was this performance flaw missed in code review?**
   - Our staging environment had less than 50 messages, masking the performance degradation.

## 3. Corrective Measures & Timelines
- [x] **[Immediate]** Apply debounce throttling to scroll-based direct message history loaders.
- [ ] **[Mid-term]** Integrate virtualized infinite scroll for the chat timeline.
- [ ] **[Staging]** Add performance testing suite mocking conversations with 10k+ messages.

---
*Created via NexaWorkspace Live Engineering Sandbox*`
  },
  featurespec: {
    title: "Feature Specification Sheet",
    description: "Write feature specs outlining user stories, technical challenges, and KPIs.",
    icon: FileCode,
    text: `# Feature Specification Sheet
> [!NOTE]
> Review this feature spec before beginning the sprint implementation cycle. Update technical specs in collaboration.

## 1. High-Level Requirements
- **Goal**: Allow real-time collaborative document editing inside live rooms.
- **Users**: High-performance software engineering teams.
- **Key KPIs**:
  1. Under 80ms latency for keystroke updates.
  2. Cursor preservation during concurrent edits.
  3. Easy markdown-to-HTML high-fidelity rendering.

## 2. Technical Strategy
- We utilize the primary **Socket.IO signalling server** for character-by-character updates.
- Keep a local selection cache to restore cursor indices dynamically.
- Cache snapshots inside the Room Local Storage and support cloud synchronization.

---
*Created via NexaWorkspace Live Engineering Sandbox*`
  }
};

export default function WorkspacePanel({ socket, roomName, myAlias, participants }: WorkspacePanelProps) {
  const [text, setText] = useState<string>(ENGINEERING_TEMPLATES.architecture.text);
  const [previewMode, setPreviewMode] = useState<'split' | 'edit' | 'preview'>('split');
  const [collaborators, setCollaborators] = useState<string[]>([]);
  const [versions, setVersions] = useState<SavedVersion[]>([]);
  const [activeTemplate, setActiveTemplate] = useState<string>('architecture');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [isLocked, setIsLocked] = useState<boolean>(false);
  const [lockedBy, setLockedBy] = useState<string>('');
  
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isIncomingChange = useRef<boolean>(false);

  // Show dynamic toast helper
  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  // Populate local versions list from local storage
  const loadLocalVersions = () => {
    try {
      const stored = localStorage.getItem(`nexaworkspace_versions_${roomName}`);
      if (stored) {
        setVersions(JSON.parse(stored));
      } else {
        setVersions([]);
      }
    } catch (err) {
      console.error('Failed to load local workspace versions:', err);
    }
  };

  // Save version to local storage list and broadcast to room
  const saveLocalVersion = (customTitle?: string) => {
    const title = customTitle || `Snapshot - ${new Date().toLocaleTimeString()}`;
    const newVersion: SavedVersion = {
      id: `ver-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      title,
      savedBy: myAlias.name,
      savedAt: new Date().toISOString(),
      text
    };

    try {
      const updated = [newVersion, ...versions];
      localStorage.setItem(`nexaworkspace_versions_${roomName}`, JSON.stringify(updated));
      setVersions(updated);
      showToast("Workspace snapshot logged!", "success");

      if (socket) {
        socket.emit('workspace_version_saved', {
          roomName,
          version: newVersion
        });
      }
    } catch (err) {
      showToast("Storage quota exceeded", "error");
    }
  };

  // Delete version and broadcast to room
  const deleteVersion = (id: string) => {
    const filtered = versions.filter(v => v.id !== id);
    localStorage.setItem(`nexaworkspace_versions_${roomName}`, JSON.stringify(filtered));
    setVersions(filtered);
    showToast("Snapshot removed", "info");

    if (socket) {
      socket.emit('workspace_version_deleted', {
        roomName,
        versionId: id
      });
    }
  };

  // Toggle cooperative workspace edit lock
  const toggleWorkspaceLock = () => {
    const nextLocked = !isLocked;
    setIsLocked(nextLocked);
    setLockedBy(nextLocked ? myAlias.name : '');
    showToast(nextLocked ? "Workspace locked!" : "Workspace unlocked!", "info");

    if (socket) {
      socket.emit('workspace_lock_changed', {
        roomName,
        locked: nextLocked,
        lockedBy: nextLocked ? myAlias.name : ''
      });
    }
  };

  // Load selected version
  const loadVersion = (savedText: string, title: string) => {
    setText(savedText);
    showToast(`Restored: ${title}`, "info");
    // Broadcast loaded state to others
    if (socket) {
      socket.emit('workspace_change', {
        roomName,
        text: savedText,
        sender: myAlias.name
      });
    }
  };

  // Export to markdown file
  const exportMarkdown = () => {
    try {
      const blob = new Blob([text], { type: 'text/markdown;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `nexalink-workspace-${roomName}.md`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      showToast("Exported as markdown file", "success");
    } catch (err) {
      showToast("Export failed", "error");
    }
  };

  // Set active template
  const applyTemplate = (key: keyof typeof ENGINEERING_TEMPLATES) => {
    const tpl = ENGINEERING_TEMPLATES[key];
    setText(tpl.text);
    setActiveTemplate(key);
    showToast(`Applied ${tpl.title} template`, "info");

    // Broadcast template to others
    if (socket) {
      socket.emit('workspace_change', {
        roomName,
        text: tpl.text,
        sender: myAlias.name
      });
    }
  };

  // Handle local text change
  const handleTextChange = (newVal: string) => {
    if (isIncomingChange.current) return;
    setText(newVal);

    // Emit live changes with selection indices to maintain collaborative cursors
    if (socket) {
      const textarea = textareaRef.current;
      const selectionStart = textarea ? textarea.selectionStart : 0;
      const selectionEnd = textarea ? textarea.selectionEnd : 0;

      socket.emit('workspace_change', {
        roomName,
        text: newVal,
        selectionStart,
        selectionEnd,
        sender: myAlias.name
      });
    }
  };

  // Socket collaborative effects
  useEffect(() => {
    if (!socket) return;

    // 1. Listen for incoming workspace changes from peers
    const handleRemoteWorkspaceUpdate = ({ text: incomingText, sender, versions: incomingVersions, locked: remoteLocked, lockedBy: remoteLockedBy }: any) => {
      isIncomingChange.current = true;
      
      const textarea = textareaRef.current;
      if (textarea && document.activeElement === textarea) {
        // Active writer: preserve cursor indices dynamically
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        
        if (incomingText !== undefined) setText(incomingText);
        
        // Restore cursor in next tick
        setTimeout(() => {
          textarea.selectionStart = start;
          textarea.selectionEnd = end;
          isIncomingChange.current = false;
        }, 0);
      } else {
        if (incomingText !== undefined) setText(incomingText);
        isIncomingChange.current = false;
      }

      // Sync incoming versions array
      if (incomingVersions && Array.isArray(incomingVersions)) {
        setVersions(incomingVersions);
        try {
          localStorage.setItem(`nexaworkspace_versions_${roomName}`, JSON.stringify(incomingVersions));
        } catch (e) {
          console.warn("Local storage write failed: ", e);
        }
      }

      // Sync incoming lock status
      if (remoteLocked !== undefined) {
        setIsLocked(remoteLocked);
        setLockedBy(remoteLocked ? remoteLockedBy : '');
      }

      // Add user temporarily to active collaborators
      if (sender && sender !== myAlias.name) {
        setCollaborators(prev => {
          if (!prev.includes(sender)) {
            return [...prev, sender];
          }
          return prev;
        });

        // Clear user from list after 3s of inactivity
        setTimeout(() => {
          setCollaborators(prev => prev.filter(c => c !== sender));
        }, 3000);
      }
    };

    // 2. Sync request for newcomers joining late - send text, versions list and lock status
    const handleSyncRequest = ({ requesterId }: any) => {
      socket.emit('workspace_sync_response', {
        targetId: requesterId,
        text,
        versions,
        locked: isLocked,
        lockedBy: lockedBy
      });
    };

    // 3. Listen for version saved by other peers
    const handleRemoteVersionSaved = (incomingVersion: SavedVersion) => {
      setVersions(prev => {
        if (prev.some(v => v.id === incomingVersion.id)) return prev;
        const updated = [incomingVersion, ...prev];
        try {
          localStorage.setItem(`nexaworkspace_versions_${roomName}`, JSON.stringify(updated));
        } catch (e) {}
        return updated;
      });
      showToast(`Snapshot saved by ${incomingVersion.savedBy}`, "info");
    };

    // 4. Listen for version deleted by other peers
    const handleRemoteVersionDeleted = ({ versionId }: { versionId: string }) => {
      setVersions(prev => {
        const updated = prev.filter(v => v.id !== versionId);
        try {
          localStorage.setItem(`nexaworkspace_versions_${roomName}`, JSON.stringify(updated));
        } catch (e) {}
        return updated;
      });
      showToast("A workspace snapshot was removed", "info");
    };

    // 5. Listen for workspace lock changed by other peers
    const handleRemoteLockChanged = ({ locked, lockedBy: remoteLockedBy }: any) => {
      setIsLocked(locked);
      setLockedBy(locked ? remoteLockedBy : '');
      showToast(locked ? `Workspace locked by ${remoteLockedBy}` : "Workspace unlocked by peer", "info");
    };

    const handleInsert = (e: Event) => {
      const customEvent = e as CustomEvent;
      const tasksMarkdown = customEvent.detail;
      setText(prev => {
        const updated = prev + tasksMarkdown;
        socket.emit('workspace_change', {
          roomName,
          text: updated,
          selectionStart: 0,
          selectionEnd: 0,
          sender: myAlias.name
        });
        return updated;
      });
      showToast("Synced AI meeting tasks to collaborative workspace!", "success");
    };

    socket.on('remote_workspace_update', handleRemoteWorkspaceUpdate);
    socket.on('remote_workspace_sync_requested', handleSyncRequest);
    socket.on('remote_workspace_version_saved', handleRemoteVersionSaved);
    socket.on('remote_workspace_version_deleted', handleRemoteVersionDeleted);
    socket.on('remote_workspace_lock_changed', handleRemoteLockChanged);
    window.addEventListener('nexalink_workspace_insert', handleInsert);

    // Trigger sync request immediately upon loading
    socket.emit('workspace_sync_request', {
      roomName,
      requesterId: socket.id
    });

    loadLocalVersions();

    return () => {
      socket.off('remote_workspace_update', handleRemoteWorkspaceUpdate);
      socket.off('remote_workspace_sync_requested', handleSyncRequest);
      socket.off('remote_workspace_version_saved', handleRemoteVersionSaved);
      socket.off('remote_workspace_version_deleted', handleRemoteVersionDeleted);
      socket.off('remote_workspace_lock_changed', handleRemoteLockChanged);
      window.removeEventListener('nexalink_workspace_insert', handleInsert);
    };
  }, [socket, roomName, text, versions, isLocked, lockedBy]);

  // Clean markdown parsing into high-fidelity HTML elements (fast token-based parser)
  const parseMarkdown = (md: string) => {
    if (!md) return '';
    let html = md;

    // Escaping standard entities
    html = html
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // 1. Alerts blockquote tags (GitHub alert syntax [!NOTE], [!TIP], [!WARNING], [!CAUTION])
    html = html.replace(/^&gt;\s*\[!NOTE\]\s*\n((?:^&gt;.*\n?)*)/gm, (_, content) => {
      const cleanContent = content.replace(/^&gt;\s?/gm, '');
      return `<div class="nx-callout callout-note">
        <div class="callout-header"><span class="emoji">ℹ️</span> NOTE</div>
        <div class="callout-content">${cleanContent}</div>
      </div>`;
    });

    html = html.replace(/^&gt;\s*\[!TIP\]\s*\n((?:^&gt;.*\n?)*)/gm, (_, content) => {
      const cleanContent = content.replace(/^&gt;\s?/gm, '');
      return `<div class="nx-callout callout-tip">
        <div class="callout-header"><span class="emoji">💡</span> TIP</div>
        <div class="callout-content">${cleanContent}</div>
      </div>`;
    });

    html = html.replace(/^&gt;\s*\[!WARNING\]\s*\n((?:^&gt;.*\n?)*)/gm, (_, content) => {
      const cleanContent = content.replace(/^&gt;\s?/gm, '');
      return `<div class="nx-callout callout-warning">
        <div class="callout-header"><span class="emoji">⚠️</span> WARNING</div>
        <div class="callout-content">${cleanContent}</div>
      </div>`;
    });

    html = html.replace(/^&gt;\s*\[!CAUTION\]\s*\n((?:^&gt;.*\n?)*)/gm, (_, content) => {
      const cleanContent = content.replace(/^&gt;\s?/gm, '');
      return `<div class="nx-callout callout-caution">
        <div class="callout-header"><span class="emoji">🛑</span> CAUTION</div>
        <div class="callout-content">${cleanContent}</div>
      </div>`;
    });

    // 2. Standard Blockquotes
    html = html.replace(/^&gt;\s*(.*)/gm, '<blockquote class="nx-quote">$1</blockquote>');

    // 3. Fenced Code Blocks (```lang ... ```)
    html = html.replace(/```(mermaid|javascript|typescript|python|json|html|css|bash|sh)?\n([\s\S]*?)\n```/g, (_, lang, code) => {
      const safeCode = code.trim();
      if (lang === 'mermaid') {
        return `<div class="nx-mermaid-box">
          <div class="mermaid-hdr flex items-center justify-between px-3 py-1.5 bg-slate-900 border-b border-white/5 text-[9px] uppercase tracking-wider font-extrabold text-indigo-400">
            <span>📊 Mermaid Diagram Blueprint</span>
            <span class="text-[8px] bg-indigo-500/10 text-indigo-300 px-1 rounded">Live Spec</span>
          </div>
          <pre class="mermaid-preview text-slate-300 font-mono text-2xs p-3.5 bg-slate-950 overflow-x-auto">${safeCode}</pre>
        </div>`;
      }
      
      // Basic syntax highlighter keywords
      let highlighted = safeCode;
      if (lang) {
        const keywords = /\b(const|let|var|function|return|import|export|class|extends|if|else|for|while|async|await|def|from|import|print|true|false|null|undefined)\b/g;
        highlighted = highlighted.replace(keywords, '<span class="code-kw">$1</span>');
      }

      return `<div class="nx-code-box">
        <div class="code-hdr flex items-center justify-between px-3 py-1 bg-slate-900 border-b border-white/5 text-[9px] uppercase tracking-wider font-mono text-slate-500">
          <span>💻 ${lang || 'Code block'}</span>
          <button class="hover:text-white transition-colors" onclick="navigator.clipboard.writeText(\`${safeCode.replace(/`/g, '\\`').replace(/\$/g, '\\$')}\`)">Copy</button>
        </div>
        <pre class="code-preview text-slate-300 font-mono text-2xs p-3.5 bg-slate-950 overflow-x-auto">${highlighted}</pre>
      </div>`;
    });

    // 4. Headers (# to ######)
    html = html.replace(/^######\s(.*)/gm, '<h6 class="text-xs font-bold text-slate-400 uppercase mt-4 mb-1.5">$1</h6>');
    html = html.replace(/^#####\s(.*)/gm, '<h5 class="text-sm font-bold text-slate-300 mt-4 mb-2">$1</h5>');
    html = html.replace(/^####\s(.*)/gm, '<h4 class="text-base font-bold text-slate-200 mt-5 mb-2 border-b border-white/5 pb-1">$1</h4>');
    html = html.replace(/^###\s(.*)/gm, '<h3 class="text-lg font-bold text-slate-100 mt-5 mb-2.5">$1</h3>');
    html = html.replace(/^##\s(.*)/gm, '<h2 class="text-xl font-extrabold text-white mt-6 mb-3 border-b border-white/5 pb-1.5">$2</h2>');
    // Note: To avoid regex collision we process # last or match strictly
    html = html.replace(/^#\s(.*)/gm, '<h1 class="text-2xl font-extrabold text-white mt-7 mb-4 border-b-2 border-indigo-500/30 pb-2">$1</h1>');

    // 5. Lists (unordered)
    html = html.replace(/^\s*[-*]\s(.*)/gm, '<li class="list-disc ml-5 text-slate-300 text-xs mt-1">$1</li>');
    // Lists (ordered)
    html = html.replace(/^\s*\d+\.\s(.*)/gm, '<li class="list-decimal ml-5 text-slate-300 text-xs mt-1">$1</li>');

    // 6. Inline formatting
    html = html.replace(/\*\*([\s\S]*?)\*\*/g, '<strong class="font-extrabold text-white">$1</strong>');
    html = html.replace(/\*([\s\S]*?)\*/g, '<em class="italic text-slate-200">$1</em>');
    html = html.replace(/`([^`]+)`/g, '<code class="px-1.5 py-0.5 rounded bg-slate-950 font-mono text-3xs text-teal-400">$1</code>');

    // 7. Divider lines
    html = html.replace(/^---$/gm, '<hr class="my-6 border-white/5" />');

    return html;
  };

  return (
    <div className="flex flex-col h-[calc(100vh-210px)] relative overflow-hidden select-none">
      
      {/* Toast Alert popup */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-2.5 rounded-xl shadow-2xl backdrop-blur-xl border flex items-center gap-2 animate-in fade-in slide-in-from-top-4 duration-300 text-2xs font-bold ${
          toast.type === 'success' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' :
          toast.type === 'error' ? 'bg-rose-500/10 border-rose-500/20 text-rose-400' :
          'bg-indigo-500/10 border-indigo-500/20 text-indigo-400'
        }`}>
          <AlertCircle className="w-3.5 h-3.5" />
          <span>{toast.message}</span>
        </div>
      )}

      {/* Roster / Roster banner */}
      <div className="flex items-center justify-between p-3 rounded-2xl bg-slate-950/40 border border-white/5 backdrop-blur-md mb-3">
        <div className="flex items-center gap-3.5 text-left">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-500/20 to-teal-500/20 border border-indigo-500/30 flex items-center justify-center">
            <FileText className="w-4 h-4 text-teal-400" />
          </div>
          <div>
            <p className="text-[10px] font-bold text-slate-200 tracking-wide uppercase">NexaWorkspace Sandbox</p>
            <p className="text-[8px] text-slate-500 mt-0.5">Real-time dynamic engine design workspace</p>
          </div>
        </div>

        {/* Live Collaborators list */}
        <div className="flex items-center gap-2">
          {collaborators.length > 0 && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 animate-pulse">
              <span className="w-1.5 h-1.5 rounded-full bg-teal-400" />
              <span className="text-[8px] font-bold text-indigo-300 uppercase tracking-wider">
                {collaborators.join(', ')} typing...
              </span>
            </div>
          )}

          <div className="flex -space-x-1.5 overflow-hidden">
            <div className="w-6 h-6 rounded-full bg-indigo-600 border border-slate-950 flex items-center justify-center text-[10px]" title={`You (${myAlias.name})`}>
              {myAlias.avatar}
            </div>
            {participants.map(p => (
              <div key={p.id} className="w-6 h-6 rounded-full bg-slate-800 border border-slate-950 flex items-center justify-center text-[10px]" title={p.name}>
                {p.avatar}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Template Bar */}
      <div className="flex gap-2 mb-3 bg-slate-900/40 p-1.5 rounded-2xl border border-white/5 overflow-x-auto">
        {(Object.keys(ENGINEERING_TEMPLATES) as Array<keyof typeof ENGINEERING_TEMPLATES>).map(key => {
          const tpl = ENGINEERING_TEMPLATES[key];
          const Icon = tpl.icon;
          const isActive = activeTemplate === key;
          return (
            <button
              key={key}
              onClick={() => applyTemplate(key)}
              className={`flex items-center gap-2 px-3 py-2 rounded-xl text-left transition-all duration-200 min-w-[140px] flex-shrink-0 border ${
                isActive 
                  ? 'bg-indigo-500/10 border-indigo-500/20 text-indigo-300' 
                  : 'bg-transparent border-transparent hover:bg-white/5 text-slate-400 hover:text-slate-200'
              }`}
            >
              <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-indigo-400' : 'text-slate-500'}`} />
              <div className="min-w-0">
                <p className="text-[9px] font-extrabold truncate uppercase tracking-wider">{tpl.title.split(' ')[0]}</p>
                <p className="text-[7px] text-slate-500 truncate">{tpl.description}</p>
              </div>
            </button>
          );
        })}
      </div>

      {/* Editor & Sidebar layout */}
      <div className="flex-1 flex gap-3 overflow-hidden">
        
        {/* Main Workspace split panel */}
        <div className="flex-1 flex flex-col overflow-hidden bg-slate-950/20 border border-white/5 rounded-2xl relative">
          
          {/* Header Controls */}
          <div className="flex items-center justify-between p-2.5 border-b border-white/5 bg-slate-950/40">
            <div className="flex bg-slate-950/80 p-0.5 rounded-xl border border-white/5">
              {[
                { id: 'split', label: 'Split View' },
                { id: 'edit', label: 'Editor Only' },
                { id: 'preview', label: 'Preview Only' }
              ].map(mode => (
                <button
                  key={mode.id}
                  onClick={() => setPreviewMode(mode.id as any)}
                  className={`px-3 py-1 rounded-lg text-[9px] font-extrabold uppercase transition-all duration-300 ${
                    previewMode === mode.id
                      ? 'bg-gradient-to-r from-indigo-500/20 to-teal-500/20 border border-indigo-500/30 text-indigo-300'
                      : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  {mode.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <button 
                onClick={toggleWorkspaceLock}
                className={`py-1.5 px-3 rounded-xl border transition-all text-[9px] font-extrabold uppercase flex items-center gap-1.5 ${
                  isLocked 
                    ? 'bg-rose-500/10 border-rose-500/20 text-rose-400 hover:bg-rose-500/20' 
                    : 'border-white/10 hover:bg-white/5 text-slate-400 hover:text-white'
                }`}
                title={isLocked ? `Locked by ${lockedBy}` : "Lock Workspace Editing"}
              >
                {isLocked ? <Lock className="w-3 h-3 text-rose-400" /> : <Unlock className="w-3 h-3" />}
                {isLocked ? `Locked` : "Lock Edit"}
              </button>
              <button 
                onClick={() => saveLocalVersion()}
                className="nx-btn nx-btn-primary flex items-center gap-1.5 text-[9px] font-extrabold uppercase py-1.5 px-3 rounded-xl"
              >
                <Save className="w-3 h-3" /> Save version
              </button>
              <button 
                onClick={exportMarkdown}
                className="py-1.5 px-3 rounded-xl border border-white/10 hover:bg-white/5 transition-all text-slate-400 hover:text-white text-[9px] font-extrabold uppercase flex items-center gap-1.5"
              >
                <Download className="w-3 h-3" /> Export MD
              </button>
            </div>
          </div>

          {/* Interactive Workspace Split Body */}
          <div className="flex-1 flex overflow-hidden">
            
            {/* TEXTAREA WRAPPER */}
            {(previewMode === 'split' || previewMode === 'edit') && (
              <div className="flex-1 flex flex-col h-full bg-slate-950/40 relative">
                {isLocked && (
                  <div className="px-4 py-2 bg-rose-500/10 border-b border-rose-500/20 flex items-center gap-2 text-[10px] font-semibold text-rose-300 text-left">
                    <Lock className="w-3.5 h-3.5 text-rose-400" />
                    <span>Read-only: Locked by <span className="font-bold text-white">{lockedBy}</span></span>
                  </div>
                )}
                <textarea
                  ref={textareaRef}
                  value={text}
                  onChange={e => handleTextChange(e.target.value)}
                  readOnly={isLocked && lockedBy !== myAlias.name}
                  placeholder={isLocked ? "Workspace locked. Read-only mode active." : "Collaborative engineering document starts here..."}
                  className="flex-1 w-full h-full p-4 font-mono text-2xs bg-transparent border-0 outline-none text-slate-300 placeholder-slate-700 resize-none overflow-y-auto leading-relaxed select-text"
                  style={{ caretColor: 'var(--nx-primary)' }}
                />
              </div>
            )}

            {/* Split Divider line */}
            {previewMode === 'split' && (
              <div className="w-[1px] bg-white/5 self-stretch" />
            )}

            {/* LIVE PREVIEW WRAPPER */}
            {(previewMode === 'split' || previewMode === 'preview') && (
              <div className="flex-1 h-full p-5 overflow-y-auto bg-slate-950/20 text-left select-text select-safe">
                <div 
                  className="nx-markdown-preview prose prose-invert max-w-none space-y-4"
                  dangerouslySetInnerHTML={{ __html: parseMarkdown(text) }}
                />
              </div>
            )}

          </div>

        </div>

        {/* Document Snapshots timeline sidebar */}
        <aside className="w-64 flex flex-col bg-slate-950/20 border border-white/5 rounded-2xl overflow-hidden p-3.5">
          <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 mb-3 flex items-center gap-1.5">
            <History className="w-3.5 h-3.5 text-indigo-400" /> Version Registry
          </p>

          <p className="text-[8px] text-slate-500 leading-normal mb-4">
            Snapshots are saved persistently inside this room. Recover versions instantly to roll back changes.
          </p>

          {/* Registry Timeline list */}
          <div className="flex-1 overflow-y-auto space-y-3 pr-1">
            {versions.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center gap-2">
                <RefreshCw className="w-6 h-6 text-slate-700 animate-spin" style={{ animationDuration: '4s' }} />
                <p className="text-[9px] text-slate-600 font-mono">No logged versions yet.</p>
              </div>
            ) : (
              versions.map((ver) => (
                <div 
                  key={ver.id}
                  className="p-3 rounded-xl bg-slate-900/60 border border-white/5 hover:border-indigo-500/20 hover:bg-slate-900 transition-all flex flex-col gap-2 relative group"
                >
                  <div className="flex items-start justify-between min-w-0">
                    <div className="min-w-0 pr-4">
                      <p className="text-[9px] font-extrabold text-slate-200 truncate pr-1" title={ver.title}>
                        {ver.title}
                      </p>
                      <p className="text-[7px] text-slate-500 font-mono mt-0.5">
                        {new Date(ver.savedAt).toLocaleTimeString()} · by {ver.savedBy}
                      </p>
                    </div>
                    
                    <button
                      onClick={() => deleteVersion(ver.id)}
                      className="opacity-0 group-hover:opacity-100 absolute top-2 right-2 p-1 text-slate-600 hover:text-rose-400 hover:bg-rose-500/10 rounded transition-all"
                      title="Delete version"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>

                  <button
                    onClick={() => loadVersion(ver.text, ver.title)}
                    className="w-full py-1 text-center bg-indigo-500/5 hover:bg-indigo-500/10 border border-indigo-500/10 hover:border-indigo-500/20 rounded-lg text-[8px] font-extrabold uppercase text-indigo-300 transition-all"
                  >
                    Restore snapshot
                  </button>
                </div>
              ))
            )}
          </div>
        </aside>

      </div>

    </div>
  );
}
