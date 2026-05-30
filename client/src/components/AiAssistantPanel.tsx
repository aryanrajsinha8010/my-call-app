import { Sparkles, Download, Languages, Globe, CheckSquare } from 'lucide-react';

export interface TranscriptEntry {
  id: string;
  sender: string;
  text: string;
  translatedText?: string;
  timestamp: Date;
}

export interface ActionItem {
  task: string;
  owner: string;
  due_date?: string;
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
}: AiAssistantPanelProps) {
  const filteredTranscript = meetingTranscript.filter(t => 
    t.text.toLowerCase().includes(captionSearchQuery.toLowerCase())
  );

  return (
    <div className="flex flex-col gap-4 text-slate-200 animate-in fade-in duration-200">
      <div className="flex items-center justify-between pb-2 border-b border-white/5 mb-1 text-slate-200" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-cyan-400 animate-pulse" />
          <p className="nx-section-header m-0 font-bold text-white tracking-wider">AI Assistant</p>
        </div>
        <div className="flex items-center gap-2">
          {liveCaptionsEnabled ? (
            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-3xs font-semibold text-emerald-400 uppercase tracking-wider animate-pulse">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              Transcribing
            </span>
          ) : (
            <span className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-3xs font-semibold text-slate-400 uppercase tracking-wider">
              Inactive
            </span>
          )}
          <button onClick={exportTranscriptMD} className="nx-btn-icon" style={{ padding: 6 }} title="Export as MD">
            <Download className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Controls Card */}
      <div className="p-3.5 rounded-2xl bg-slate-900/50 border border-white/5 backdrop-blur-sm flex flex-col gap-3.5" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
        <div className="flex items-center justify-between">
          <span className="text-2xs font-semibold text-slate-300">Speech Recognition</span>
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
              <Languages className="w-3 h-3 text-cyan-400" /> Language
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
              <Globe className="w-3 h-3 text-cyan-400" /> Translate To
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
          <span className="text-[10px] uppercase tracking-wider font-bold text-slate-400">Meeting Transcript</span>
          <span className="text-3xs text-slate-500 font-semibold">{meetingTranscript.length} entries</span>
        </div>
        
        <input 
          type="text" 
          value={captionSearchQuery} 
          onChange={(e) => setCaptionSearchQuery(e.target.value)} 
          placeholder="Search transcript log..." 
          className="nx-input text-2xs py-1.5 px-3 w-full bg-slate-950/40 border-white/5 text-slate-200"
          style={{ borderColor: 'rgba(255,255,255,0.05)' }}
        />

        <div className="h-44 overflow-y-auto pr-1 flex flex-col gap-2 ai-transcript-box p-3">
          {filteredTranscript.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-4">
              <span className="text-3xs text-slate-600 font-mono">No transcript history.</span>
              {liveCaptionsEnabled && (
                <div className="soundwave-anim mt-2">
                  <span className="soundwave-bar" />
                  <span className="soundwave-bar" />
                  <span className="soundwave-bar" />
                  <span className="soundwave-bar" />
                </div>
              )}
            </div>
          ) : (
            filteredTranscript.map((t) => (
              <div key={t.id} className={`ai-transcript-bubble flex flex-col gap-0.5 ${t.sender === 'You' ? 'self' : ''}`}>
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

      {/* AI Intelligence Section */}
      <div className="flex flex-col gap-2.5 pt-2 border-t border-white/5" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
        <button 
          onClick={extractActionItems} 
          disabled={isAnalyzingMeeting || meetingTranscript.length === 0}
          className="nx-btn w-full text-xs font-bold flex items-center justify-center gap-1.5 bg-gradient-to-r from-cyan-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 text-white disabled:opacity-40"
        >
          {isAnalyzingMeeting ? (
            <>
              <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Analyzing Audio...
            </>
          ) : (
            <>
              <CheckSquare className="w-3.5 h-3.5" />
              Extract Tasks & Summarize
            </>
          )}
        </button>

        {/* Summary Display */}
        {extractedSummary && (
          <div className="flex flex-col gap-1">
            <span className="text-[10px] uppercase font-bold text-slate-400">AI Summary</span>
            <p className="text-[10px] bg-slate-950/40 p-2.5 rounded-xl border border-white/5 text-slate-300 leading-relaxed max-h-20 overflow-y-auto font-medium" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
              {extractedSummary}
            </p>
          </div>
        )}

        {/* Action Items List */}
        {extractedActionItems.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] uppercase font-bold text-slate-400">Extracted Action Items</span>
            <div className="action-items-grid max-h-24 overflow-y-auto text-[10px]">
              <div className="action-item-row header">
                <span>Task</span>
                <span>Owner</span>
                <span>Due</span>
              </div>
              {extractedActionItems.map((item, idx) => (
                <div key={idx} className="action-item-row text-slate-300">
                  <span className="font-semibold truncate" title={item.task}>{item.task}</span>
                  <span className="text-cyan-400 truncate">{item.owner}</span>
                  <span className="text-slate-500">{item.due_date || 'N/A'}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
