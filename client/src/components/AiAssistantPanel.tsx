import React, { useState } from 'react';
import { 
  Sparkles, Download, Languages, Globe, Plus, Trash2, 
  Calendar, User, Share2, Check, X
} from 'lucide-react';

export interface TranscriptEntry {
  id: string;
  sender: string;
  text: string;
  translatedText?: string;
  timestamp: Date;
}

export interface ActionItem {
  id: string;
  task: string;
  owner: string;
  due_date?: string;
  priority?: 'high' | 'medium' | 'low';
  completed?: boolean;
}

interface AiAssistantPanelProps {
  liveCaptionsEnabled: boolean;
  setLiveCaptionsEnabled: (enabled: boolean) => void;
  captionsLanguage: string;
  setCaptionsLanguage: (lang: string) => void;
  translationLanguage: string;
  setTranslationLanguage: (lang: string) => void;
  meetingTranscript: TranscriptEntry[];
  captionSearchQuery: string;
  setCaptionSearchQuery: (query: string) => void;
  isAnalyzingMeeting: boolean;
  extractedSummary: string;
  extractedActionItems: ActionItem[];
  extractActionItems: () => Promise<void>;
  exportTranscriptMD: () => void;
  setExtractedActionItems: React.Dispatch<React.SetStateAction<ActionItem[]>>;
  participants: any[];
  userName: string;
  extractedSentiment: string;
  extractedTopics: string[];
}

export default function AiAssistantPanel({
  liveCaptionsEnabled,
  setLiveCaptionsEnabled,
  captionsLanguage,
  setCaptionsLanguage,
  translationLanguage,
  setTranslationLanguage,
  meetingTranscript,
  captionSearchQuery,
  setCaptionSearchQuery,
  isAnalyzingMeeting,
  extractedSummary,
  extractedActionItems,
  extractActionItems,
  exportTranscriptMD,
  setExtractedActionItems,
  participants,
  userName,
  extractedSentiment,
  extractedTopics,
}: AiAssistantPanelProps) {
  
  // Custom Task Creator Drawer States
  const [isAddingTask, setIsAddingTask] = useState(false);
  const [newTaskText, setNewTaskText] = useState('');
  const [newTaskOwner, setNewTaskOwner] = useState(userName || 'Alice (Self)');
  const [newTaskDueDate, setNewTaskDueDate] = useState('ASAP');
  const [newTaskPriority, setNewTaskPriority] = useState<'high' | 'medium' | 'low'>('medium');

  // Inline Editing States
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editingTaskText, setEditingTaskText] = useState('');
  const [editingDueDateId, setEditingDueDateId] = useState<string | null>(null);
  const [editingDueDateText, setEditingDueDateText] = useState('');

  const filteredTranscript = meetingTranscript.filter(t => 
    t.text.toLowerCase().includes(captionSearchQuery.toLowerCase())
  );

  // Task Mutators
  const toggleTaskCompleted = (id: string) => {
    setExtractedActionItems(prev => prev.map(item => 
      item.id === id ? { ...item, completed: !item.completed } : item
    ));
  };

  const updateTaskOwner = (id: string, newOwner: string) => {
    setExtractedActionItems(prev => prev.map(item => 
      item.id === id ? { ...item, owner: newOwner } : item
    ));
  };

  const updateTaskPriority = (id: string, newPriority: 'high' | 'medium' | 'low') => {
    setExtractedActionItems(prev => prev.map(item => 
      item.id === id ? { ...item, priority: newPriority } : item
    ));
  };

  const startEditingTaskText = (id: string, currentText: string) => {
    setEditingTaskId(id);
    setEditingTaskText(currentText);
  };

  const saveTaskText = (id: string) => {
    if (!editingTaskText.trim()) return;
    setExtractedActionItems(prev => prev.map(item => 
      item.id === id ? { ...item, task: editingTaskText.trim() } : item
    ));
    setEditingTaskId(null);
  };

  const startEditingDueDate = (id: string, currentDueDate: string) => {
    setEditingDueDateId(id);
    setEditingDueDateText(currentDueDate || 'ASAP');
  };

  const saveDueDate = (id: string) => {
    setExtractedActionItems(prev => prev.map(item => 
      item.id === id ? { ...item, due_date: editingDueDateText.trim() || 'ASAP' } : item
    ));
    setEditingDueDateId(null);
  };

  const deleteTask = (id: string) => {
    setExtractedActionItems(prev => prev.filter(item => item.id !== id));
  };

  const handleAddTaskSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTaskText.trim()) return;
    
    const newItem: ActionItem = {
      id: `task-${Date.now()}`,
      task: newTaskText.trim(),
      owner: newTaskOwner,
      due_date: newTaskDueDate.trim() || 'ASAP',
      priority: newTaskPriority,
      completed: false
    };

    setExtractedActionItems(prev => [...prev, newItem]);
    setNewTaskText('');
    setNewTaskDueDate('ASAP');
    setNewTaskPriority('medium');
    setIsAddingTask(false);
  };

  // Collaborative Syncing to Room Workspace
  const syncActionItemsToWorkspace = () => {
    if (extractedActionItems.length === 0) return;

    const tasksMarkdown = `\n\n### 📋 Call Deliverables & Actions (${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})
> [!NOTE]
> Synchronized by AI Call Intelligence Assistant. Tasks are interactive.

${extractedActionItems.map(item => {
  const completedBox = item.completed ? '- [x]' : '- [ ]';
  const priorityTag = item.priority ? ` [Priority: ${item.priority.toUpperCase()}]` : '';
  const dueTag = item.due_date ? ` [Due: ${item.due_date}]` : '';
  return `${completedBox} **${item.task}**${priorityTag}${dueTag} *(Assignee: ${item.owner})*`;
}).join('\n')}

---`;

    const event = new CustomEvent('nexalink_workspace_insert', { detail: tasksMarkdown });
    window.dispatchEvent(event);
  };

  // Completion metrics
  const completedCount = extractedActionItems.filter(t => t.completed).length;
  const totalCount = extractedActionItems.length;
  const progressPercentage = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  // Sentiment glowing styles helper
  const getSentimentGlowStyle = (sentiment: string) => {
    const s = sentiment.toLowerCase();
    if (s.includes('positive') || s.includes('success')) {
      return {
        bg: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400',
        dot: 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]'
      };
    }
    if (s.includes('urgent') || s.includes('critical') || s.includes('conflict')) {
      return {
        bg: 'bg-rose-500/10 border-rose-500/30 text-rose-400',
        dot: 'bg-rose-400 shadow-[0_0_8px_rgba(251,113,133,0.8)]'
      };
    }
    if (s.includes('technical') || s.includes('focused') || s.includes('collaborative')) {
      return {
        bg: 'bg-cyan-500/10 border-cyan-500/30 text-cyan-400',
        dot: 'bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.8)]'
      };
    }
    return {
      bg: 'bg-slate-500/10 border-slate-500/30 text-slate-400',
      dot: 'bg-slate-400 shadow-[0_0_6px_rgba(148,163,184,0.6)]'
    };
  };

  const sentimentStyle = getSentimentGlowStyle(extractedSentiment);

  return (
    <div className="flex flex-col gap-4 text-slate-200 animate-in fade-in duration-200">
      <div className="flex items-center justify-between pb-2 border-b mb-1 text-slate-200" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-cyan-400 animate-pulse" />
          <p className="nx-section-header m-0 font-bold text-white tracking-wider">AI Call Intelligence</p>
        </div>
        <div className="flex items-center gap-2">
          {liveCaptionsEnabled ? (
            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-3xs font-semibold text-emerald-400 uppercase tracking-wider animate-pulse">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              Live Transcribing
            </span>
          ) : (
            <span className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-3xs font-semibold text-slate-400 uppercase tracking-wider">
              Offline
            </span>
          )}
          <button onClick={exportTranscriptMD} className="nx-btn-icon" style={{ padding: 6 }} title="Export Transcript (Markdown)">
            <Download className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Controls Card */}
      <div className="p-3.5 rounded-2xl bg-slate-900/50 border border-white/5 backdrop-blur-sm flex flex-col gap-3.5" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
        <div className="flex items-center justify-between">
          <span className="text-2xs font-semibold text-slate-300">Speech Recognition Engine</span>
          <label className="relative inline-flex items-center cursor-pointer">
            <input 
              type="checkbox" 
              checked={liveCaptionsEnabled} 
              onChange={(e) => setLiveCaptionsEnabled(e.target.checked)} 
              className="sr-only peer" 
            />
            <div className="w-9 h-5 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-slate-400 after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-cyan-500 peer-checked:after:bg-white"></div>
          </label>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] uppercase font-bold text-slate-400 flex items-center gap-1">
              <Languages className="w-3 h-3 text-cyan-400" /> Source
            </label>
            <select 
              className="nx-select text-3xs py-1 px-2" 
              value={captionsLanguage} 
              onChange={(e) => setCaptionsLanguage(e.target.value)}
            >
              <option value="en-US">English (US)</option>
              <option value="es-ES">Español</option>
              <option value="fr-FR">Français</option>
              <option value="de-DE">Deutsch</option>
              <option value="ja-JP">日本語</option>
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[10px] uppercase font-bold text-slate-400 flex items-center gap-1">
              <Globe className="w-3 h-3 text-cyan-400" /> Translate
            </label>
            <select 
              className="nx-select text-3xs py-1 px-2" 
              value={translationLanguage} 
              onChange={(e) => setTranslationLanguage(e.target.value)}
            >
              <option value="none">None</option>
              <option value="es">Español</option>
              <option value="fr">Français</option>
              <option value="de">Deutsch</option>
              <option value="ja">日本語</option>
            </select>
          </div>
        </div>
      </div>

      {/* Search & Transcript Container */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-wider font-bold text-slate-400">Call Log & Transcription</span>
          <span className="text-3xs text-slate-500 font-semibold">{meetingTranscript.length} entries</span>
        </div>
        
        <input 
          type="text" 
          value={captionSearchQuery} 
          onChange={(e) => setCaptionSearchQuery(e.target.value)} 
          placeholder="Search transcription history..." 
          className="nx-input text-2xs py-1.5 px-3 w-full bg-slate-950/40 border-white/5 text-slate-200"
          style={{ borderColor: 'rgba(255,255,255,0.05)' }}
        />

        <div className="h-44 overflow-y-auto pr-1 flex flex-col gap-2 ai-transcript-box p-3 rounded-2xl bg-slate-950/20 border border-white/5" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
          {filteredTranscript.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-4">
              <span className="text-3xs text-slate-600 font-mono">No spoken segments captured.</span>
              {liveCaptionsEnabled && (
                <div className="soundwave-anim mt-2">
                  <span className="soundwave-bar animate-pulse" />
                  <span className="soundwave-bar animate-pulse delay-75" />
                  <span className="soundwave-bar animate-pulse delay-150" />
                  <span className="soundwave-bar animate-pulse delay-200" />
                </div>
              )}
            </div>
          ) : (
            filteredTranscript.map((t) => (
              <div key={t.id} className={`ai-transcript-bubble flex flex-col gap-0.5 ${t.sender === 'You' ? 'self bg-cyan-950/15 border-cyan-800/10' : ''}`}>
                <div className="flex items-center justify-between">
                  <span className="text-3xs font-bold text-cyan-400">{t.sender}</span>
                  <span className="text-[9px] text-slate-500 font-mono">
                    {t.timestamp instanceof Date 
                      ? t.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) 
                      : new Date(t.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                    }
                  </span>
                </div>
                <p className="text-[11px] text-slate-100 leading-relaxed font-medium">{t.text}</p>
                {t.translatedText && (
                  <p className="text-[11px] text-cyan-300 italic leading-relaxed border-t border-white/5 pt-0.5 mt-0.5" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
                    {t.translatedText}
                  </p>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* AI Extraction Controller */}
      <div className="flex flex-col gap-3.5 pt-3 border-t" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
        <button 
          onClick={extractActionItems} 
          disabled={isAnalyzingMeeting || meetingTranscript.length === 0}
          className="nx-btn w-full text-xs font-bold flex items-center justify-center gap-2 bg-gradient-to-r from-cyan-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 text-white disabled:opacity-40 shadow-lg shadow-cyan-950/20 active:scale-[0.98] transition-transform duration-100 py-2.5 rounded-xl"
        >
          {isAnalyzingMeeting ? (
            <>
              <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Processing Call Intelligence...
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4 text-cyan-200" />
              Synthesize Meeting Analytics
            </>
          )}
        </button>

        {/* AI High-Fidelity Summary & Mood Analytics */}
        {extractedSummary && (
          <div className="p-3.5 rounded-2xl bg-slate-900/40 border border-white/5 flex flex-col gap-3" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">AI Executive Briefing</span>
              
              {/* Sentiment Badge */}
              <span className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[9px] font-bold tracking-wide uppercase ${sentimentStyle.bg}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${sentimentStyle.dot}`} />
                {extractedSentiment}
              </span>
            </div>

            <p className="text-[10px] text-slate-300 leading-relaxed font-medium">
              {extractedSummary}
            </p>

            {/* Topics hashtags */}
            {extractedTopics && extractedTopics.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1.5 border-t border-white/5" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
                {extractedTopics.map((topic, i) => (
                  <span key={i} className="px-2 py-0.5 rounded bg-slate-950/60 border border-white/5 text-[9px] font-mono text-cyan-400 font-semibold transition-transform duration-200 hover:scale-105">
                    #{topic}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Call Action Items & Collaborative Checklist */}
        {totalCount > 0 && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="flex flex-col gap-0.5">
                <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Deliverables Checklist</span>
                <span className="text-3xs text-slate-500 font-semibold">{completedCount} of {totalCount} completed</span>
              </div>

              {/* Action sync to workspace */}
              <button 
                onClick={syncActionItemsToWorkspace}
                className="flex items-center gap-1 text-[9px] font-bold text-cyan-400 hover:text-cyan-300 transition-colors bg-cyan-950/30 hover:bg-cyan-950/50 border border-cyan-800/30 px-2.5 py-1 rounded-lg"
                title="Synchronize action list with collaborative Room Workspace editor"
              >
                <Share2 className="w-3 h-3" />
                Sync to Workspace
              </button>
            </div>

            {/* Progress Bar */}
            <div className="w-full bg-slate-950/60 rounded-full h-1.5 border border-white/5 overflow-hidden" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
              <div 
                className="bg-gradient-to-r from-cyan-400 to-indigo-500 h-full rounded-full transition-all duration-500 ease-out shadow-[0_0_8px_rgba(34,211,238,0.4)]"
                style={{ width: `${progressPercentage}%` }}
              />
            </div>

            {/* Tasks scroll wrapper */}
            <div className="flex flex-col gap-2 max-h-56 overflow-y-auto pr-1">
              {extractedActionItems.map((item) => {
                const isEditingText = editingTaskId === item.id;
                const isEditingDue = editingDueDateId === item.id;

                return (
                  <div 
                    key={item.id} 
                    className={`p-2.5 rounded-xl bg-slate-900/30 border border-white/5 flex flex-col gap-2 transition-all duration-200 ${item.completed ? 'opacity-65 scale-[0.99] border-cyan-950/30 bg-slate-950/25' : 'hover:bg-slate-900/50'}`}
                    style={{ borderColor: 'rgba(255,255,255,0.05)' }}
                  >
                    <div className="flex items-start gap-2.5">
                      {/* Checkbox */}
                      <button 
                        onClick={() => toggleTaskCompleted(item.id)} 
                        className={`w-4 h-4 rounded border flex items-center justify-center mt-0.5 transition-all duration-100 ${item.completed ? 'bg-cyan-500 border-cyan-400 text-slate-950' : 'bg-slate-950/60 border-slate-700 hover:border-slate-500'}`}
                      >
                        {item.completed && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                      </button>

                      {/* Task Text Content */}
                      <div className="flex-1 min-w-0">
                        {isEditingText ? (
                          <div className="flex items-center gap-1">
                            <input 
                              type="text"
                              value={editingTaskText}
                              onChange={(e) => setEditingTaskText(e.target.value)}
                              onKeyDown={(e) => { if (e.key === 'Enter') saveTaskText(item.id); if (e.key === 'Escape') setEditingTaskId(null); }}
                              className="nx-input py-0.5 px-2 text-2xs bg-slate-950 text-slate-200 border-cyan-800 w-full"
                              autoFocus
                            />
                            <button onClick={() => saveTaskText(item.id)} className="text-emerald-400 hover:text-emerald-300">
                              <Check className="w-3 h-3" />
                            </button>
                            <button onClick={() => setEditingTaskId(null)} className="text-slate-500 hover:text-slate-400">
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        ) : (
                          <p 
                            className={`text-[10px] leading-relaxed font-semibold cursor-pointer select-none text-slate-200 hover:text-cyan-200 break-words ${item.completed ? 'line-through text-slate-500' : ''}`}
                            onDoubleClick={() => startEditingTaskText(item.id, item.task)}
                            title="Double click to edit task description"
                          >
                            {item.task}
                          </p>
                        )}
                      </div>

                      {/* Inline Mutator: Delete task */}
                      <button 
                        onClick={() => deleteTask(item.id)} 
                        className="text-slate-600 hover:text-rose-400 transition-colors p-0.5 rounded"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>

                    {/* Metadata & Controls Bottom Row */}
                    <div className="flex flex-wrap items-center gap-2 text-3xs text-slate-400 pt-2 border-t border-white/5" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
                      {/* Priority selector */}
                      <button 
                        onClick={() => {
                          const nextPriority: Record<string, 'high' | 'medium' | 'low'> = {
                            'high': 'medium',
                            'medium': 'low',
                            'low': 'high'
                          };
                          updateTaskPriority(item.id, nextPriority[item.priority || 'medium']);
                        }}
                        className={`px-1.5 py-0.5 rounded font-bold uppercase tracking-wider text-[8px] transition-transform active:scale-95 ${
                          item.priority === 'high' 
                            ? 'bg-rose-500/10 border border-rose-500/20 text-rose-400' 
                            : item.priority === 'low' 
                              ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400' 
                              : 'bg-amber-500/10 border border-amber-500/20 text-amber-400'
                        }`}
                        title="Click to cycle priority"
                      >
                        {item.priority || 'medium'}
                      </button>

                      {/* Owner Dropdown */}
                      <div className="flex items-center gap-1 bg-slate-950/40 px-1.5 py-0.5 rounded border border-white/5" style={{ borderColor: 'rgba(255,255,255,0.03)' }}>
                        <User className="w-2.5 h-2.5 text-cyan-400" />
                        <select 
                          value={item.owner} 
                          onChange={(e) => updateTaskOwner(item.id, e.target.value)}
                          className="bg-transparent text-slate-300 font-medium cursor-pointer border-none outline-none text-3xs p-0 pr-3.5 focus:ring-0 select-owner-custom"
                        >
                          <option value="Alice (Self)">Alice (Self)</option>
                          <option value="All Participants">All Participants</option>
                          <option value="Remote Peer">Remote Peer</option>
                          {participants.map((p, idx) => (
                            <option key={idx} value={p.name}>{p.name}</option>
                          ))}
                        </select>
                      </div>

                      {/* Due Date Editor */}
                      <div className="flex items-center gap-1 bg-slate-950/40 px-1.5 py-0.5 rounded border border-white/5 ml-auto" style={{ borderColor: 'rgba(255,255,255,0.03)' }}>
                        <Calendar className="w-2.5 h-2.5 text-slate-500" />
                        {isEditingDue ? (
                          <input 
                            type="text"
                            value={editingDueDateText}
                            onChange={(e) => setEditingDueDateText(e.target.value)}
                            onBlur={() => saveDueDate(item.id)}
                            onKeyDown={(e) => { if (e.key === 'Enter') saveDueDate(item.id); if (e.key === 'Escape') setEditingDueDateId(null); }}
                            className="bg-transparent text-slate-200 text-3xs border-none p-0 outline-none w-14"
                            autoFocus
                          />
                        ) : (
                          <span 
                            className="cursor-pointer hover:text-cyan-300 font-semibold"
                            onClick={() => startEditingDueDate(item.id, item.due_date || 'ASAP')}
                            title="Click to edit due date inline"
                          >
                            {item.due_date || 'ASAP'}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Custom Task Creator Drawer Trigger */}
        {!isAddingTask ? (
          <button 
            onClick={() => setIsAddingTask(true)}
            className="flex items-center justify-center gap-1 text-[10px] font-bold text-slate-400 hover:text-white py-1.5 border border-dashed border-slate-700 rounded-xl hover:border-slate-500 transition-all duration-200 mt-1"
          >
            <Plus className="w-3.5 h-3.5" />
            Create Custom Action Item
          </button>
        ) : (
          <form 
            onSubmit={handleAddTaskSubmit}
            className="p-3.5 rounded-2xl bg-slate-900/50 border border-cyan-800/20 flex flex-col gap-3 animate-in slide-in-from-bottom duration-200"
          >
            <span className="text-[9px] uppercase font-bold text-slate-400 tracking-wider">New Action Item Setup</span>
            
            <div className="flex flex-col gap-1">
              <input 
                type="text" 
                value={newTaskText}
                onChange={(e) => setNewTaskText(e.target.value)}
                placeholder="Deliverable/task details..."
                className="nx-input text-2xs py-1.5 px-3 bg-slate-950 w-full"
                required
                autoFocus
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-0.5">
                <label className="text-[8px] uppercase font-bold text-slate-500">Assignee</label>
                <select 
                  value={newTaskOwner}
                  onChange={(e) => setNewTaskOwner(e.target.value)}
                  className="nx-select text-3xs py-1 px-2"
                >
                  <option value="Alice (Self)">Alice (Self)</option>
                  <option value="All Participants">All Participants</option>
                  <option value="Remote Peer">Remote Peer</option>
                  {participants.map((p, idx) => (
                    <option key={idx} value={p.name}>{p.name}</option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-0.5">
                <label className="text-[8px] uppercase font-bold text-slate-500">Due Date</label>
                <input 
                  type="text" 
                  value={newTaskDueDate}
                  onChange={(e) => setNewTaskDueDate(e.target.value)}
                  placeholder="ASAP, tomorrow..."
                  className="nx-input text-3xs py-1 px-2 bg-slate-950 border-white/5"
                  style={{ borderColor: 'rgba(255,255,255,0.05)' }}
                />
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 pt-1 border-t border-white/5" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
              <div className="flex items-center gap-1.5">
                <span className="text-[8px] uppercase font-bold text-slate-500">Priority:</span>
                {(['high', 'medium', 'low'] as const).map(p => (
                  <button 
                    key={p}
                    type="button"
                    onClick={() => setNewTaskPriority(p)}
                    className={`px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider transition-colors ${
                      newTaskPriority === p
                        ? p === 'high' 
                          ? 'bg-rose-500 text-white' 
                          : p === 'low' 
                            ? 'bg-emerald-500 text-white' 
                            : 'bg-amber-500 text-slate-950'
                        : 'bg-slate-950 text-slate-500 hover:text-slate-300'
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-1.5 ml-auto">
                <button 
                  type="button"
                  onClick={() => setIsAddingTask(false)}
                  className="px-2.5 py-1 rounded bg-slate-800 text-[10px] font-bold text-slate-400 hover:bg-slate-700"
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  className="px-2.5 py-1 rounded bg-cyan-600 hover:bg-cyan-500 text-[10px] font-bold text-white shadow-md shadow-cyan-900/20"
                >
                  Create
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
