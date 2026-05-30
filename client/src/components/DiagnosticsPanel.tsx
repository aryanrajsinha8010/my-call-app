import { useEffect, useState } from 'react';
import { 
  Activity, 
  BarChart2, 
  WifiOff, 
  ShieldCheck, 
  Cpu, 
  Server, 
  Terminal, 
  Network, 
  ArrowUpRight, 
  ArrowDownLeft,
  SlidersHorizontal,
  Zap,
  AlertTriangle,
  Sliders,
  CheckCircle2
} from 'lucide-react';
import { ConnectionStats, SimulatedNetworkProfile, CustomSimSettings } from '../hooks/useWebRTC';

interface DiagnosticsPanelProps {
  stats: ConnectionStats & {
    bytesSent?: number;
    bytesReceived?: number;
    bitrateSent?: number;
    bitrateReceived?: number;
    videoFps?: number;
    audioCodec?: string;
    videoCodec?: string;
    localCandidateType?: string;
    remoteCandidateType?: string;
    transportType?: string;
  };
  participantsCount: number;
  controlLogs: string[];
  roomName: string;
  simulatedProfile: SimulatedNetworkProfile;
  setSimulatedProfile: (profile: SimulatedNetworkProfile) => void;
  customSimSettings: CustomSimSettings;
  setCustomSimSettings: React.Dispatch<React.SetStateAction<CustomSimSettings>>;
  qualityPreference: 'auto' | 'hd' | 'sd' | 'low' | 'audio-only';
  setQualityPreference: (pref: 'auto' | 'hd' | 'sd' | 'low' | 'audio-only') => void;
  currentQualityProfile: 'hd' | 'sd' | 'low' | 'audio-only';
}

export default function DiagnosticsPanel({ 
  stats, 
  participantsCount, 
  controlLogs, 
  roomName,
  simulatedProfile,
  setSimulatedProfile,
  customSimSettings,
  setCustomSimSettings,
  qualityPreference,
  setQualityPreference,
  currentQualityProfile,
}: DiagnosticsPanelProps) {
  const [latencyHistory, setLatencyHistory] = useState<number[]>([]);
  const [bitrateHistory, setBitrateHistory] = useState<{ sent: number; recv: number }[]>([]);
  const [isSpikeActive, setIsSpikeActive] = useState(false);
  const [isDropoutActive, setIsDropoutActive] = useState(false);

  // Track history for sparklines (up to 15 points)
  useEffect(() => {
    setLatencyHistory(prev => {
      const next = [...prev, stats.videoLatency];
      if (next.length > 15) next.shift();
      return next;
    });

    setBitrateHistory(prev => {
      const next = [...prev, { sent: stats.bitrateSent || 0, recv: stats.bitrateReceived || 0 }];
      if (next.length > 15) next.shift();
      return next;
    });
  }, [stats.videoLatency, stats.bitrateSent, stats.bitrateReceived]);

  // Determine health status
  const getHealthStatus = () => {
    const loss = stats.packetLoss || 0;
    const lat = stats.videoLatency || 0;
    if (loss > 18 || lat > 500) {
      return { label: 'CRITICAL', color: 'text-rose-400 bg-rose-500/10 border-rose-500/30 shadow-rose-950/20', dot: 'bg-rose-500' };
    } else if (loss > 4 || lat > 120) {
      return { label: 'DEGRADED', color: 'text-amber-400 bg-amber-500/10 border-amber-500/30 shadow-amber-950/20', dot: 'bg-amber-500' };
    }
    return { label: 'OPTIMAL', color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30 shadow-emerald-950/20', dot: 'bg-emerald-500' };
  };

  const health = getHealthStatus();

  // Helper to draw Sparkline SVG Path
  const getSparklinePath = (points: number[], width: number, height: number, maxVal = 100) => {
    if (points.length < 2) return '';
    const actualMax = Math.max(...points, maxVal) || 1;
    const xStep = width / (points.length - 1);
    
    return points
      .map((val, idx) => {
        const x = idx * xStep;
        const y = height - (val / actualMax) * (height - 4) - 2;
        return `${idx === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(' ');
  };

  // Inject temporary 30% Loss Spike
  const triggerLossSpike = () => {
    if (isSpikeActive || isDropoutActive) return;
    setIsSpikeActive(true);
    const originalProfile = simulatedProfile;
    const originalSettings = { ...customSimSettings };

    setSimulatedProfile('custom');
    setCustomSimSettings({ latency: 260, packetLoss: 30, jitter: 18 });

    setTimeout(() => {
      setSimulatedProfile(originalProfile);
      setCustomSimSettings(originalSettings);
      setIsSpikeActive(false);
    }, 5000);
  };

  // Inject temporary 100% Signal Dropout
  const triggerSignalDropout = () => {
    if (isSpikeActive || isDropoutActive) return;
    setIsDropoutActive(true);
    const originalProfile = simulatedProfile;
    const originalSettings = { ...customSimSettings };

    setSimulatedProfile('custom');
    setCustomSimSettings({ latency: 1200, packetLoss: 100, jitter: 60 });

    setTimeout(() => {
      setSimulatedProfile(originalProfile);
      setCustomSimSettings(originalSettings);
      setIsDropoutActive(false);
    }, 4000);
  };

  return (
    <div className="flex flex-col gap-4 animate-in fade-in duration-200">
      
      {/* Dynamic Health Header Banner */}
      <div className={`p-4 rounded-2xl border flex items-center justify-between transition-all duration-300 shadow-sm ${health.color}`}>
        <div className="flex items-center gap-3">
          <span className={`w-3.5 h-3.5 rounded-full animate-pulse ${health.dot}`} style={{ animationDuration: '1.5s' }} />
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider font-display flex items-center gap-1.5">
              System Health: {health.label}
              {health.label !== 'OPTIMAL' && <AlertTriangle className="w-3.5 h-3.5 animate-bounce" />}
            </h4>
            <p className="text-[10px] opacity-75">Room: <span className="font-mono font-bold">#{roomName}</span> · Peers: {participantsCount}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 bg-white/5 border border-white/10 px-2 py-1 rounded-lg">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
          <span className="text-[9px] font-bold font-mono">E2EE Tunnel</span>
        </div>
      </div>

      {/* ── PREMIUM NETWORK SIMULATION LAB ── */}
      <div className="bg-slate-950/60 border border-indigo-500/20 p-4 rounded-2xl flex flex-col gap-3.5 shadow-lg relative overflow-hidden">
        <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/5 rounded-full blur-2xl pointer-events-none" />
        
        <div className="flex items-center justify-between">
          <h4 className="text-[10px] uppercase font-bold text-slate-300 tracking-wider flex items-center gap-1.5 font-display">
            <SlidersHorizontal className="w-3.5 h-3.5 text-indigo-400" /> Network Simulation Lab
          </h4>
          <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 font-mono">
            {simulatedProfile === 'auto-drift' ? 'Auto Drift' : simulatedProfile === 'fiber' ? 'Fiber core' : simulatedProfile === 'lte' ? 'Strained LTE' : simulatedProfile === 'satellite' ? 'Satellite Link' : 'Custom Mod'}
          </span>
        </div>

        {/* Profile Grid Picker */}
        <div className="grid grid-cols-5 gap-1.5">
          {[
            { id: 'auto-drift', label: 'Auto' },
            { id: 'fiber', label: 'Fiber' },
            { id: 'lte', label: 'LTE' },
            { id: 'satellite', label: 'Sat' },
            { id: 'custom', label: 'Custom' },
          ].map(prof => (
            <button
              key={prof.id}
              onClick={() => setSimulatedProfile(prof.id as SimulatedNetworkProfile)}
              disabled={isSpikeActive || isDropoutActive}
              className={`py-1.5 text-[9px] font-bold font-mono rounded-lg transition-all border ${
                simulatedProfile === prof.id
                  ? 'bg-indigo-600/20 border-indigo-500 text-indigo-300 shadow-inner'
                  : 'bg-slate-900/60 border-white/5 text-slate-400 hover:text-slate-200 hover:bg-slate-900'
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {prof.label}
            </button>
          ))}
        </div>

        {/* Custom Simulation Range Sliders */}
        {simulatedProfile === 'custom' && (
          <div className="p-3 bg-slate-950/40 border border-white/5 rounded-xl flex flex-col gap-3 animate-in slide-in-from-top-2 duration-200">
            {/* Latency Slider */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-[9px]">
                <span className="text-slate-400 font-bold uppercase tracking-wider font-mono">Simulated Latency</span>
                <span className="font-mono text-indigo-400 font-bold">{customSimSettings.latency} ms</span>
              </div>
              <input
                type="range"
                min="10"
                max="1500"
                step="10"
                value={customSimSettings.latency}
                onChange={(e) => setCustomSimSettings(prev => ({ ...prev, latency: parseInt(e.target.value) }))}
                className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
              />
            </div>

            {/* Packet Loss Slider */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-[9px]">
                <span className="text-slate-400 font-bold uppercase tracking-wider font-mono">Simulated Packet Loss</span>
                <span className={`font-mono font-bold ${customSimSettings.packetLoss > 15 ? 'text-rose-400' : 'text-indigo-400'}`}>
                  {customSimSettings.packetLoss}%
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="50"
                step="1"
                value={customSimSettings.packetLoss}
                onChange={(e) => setCustomSimSettings(prev => ({ ...prev, packetLoss: parseInt(e.target.value) }))}
                className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
              />
            </div>

            {/* Jitter Slider */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-[9px]">
                <span className="text-slate-400 font-bold uppercase tracking-wider font-mono">Simulated Jitter</span>
                <span className="font-mono text-indigo-400 font-bold">{customSimSettings.jitter} ms</span>
              </div>
              <input
                type="range"
                min="1"
                max="80"
                step="1"
                value={customSimSettings.jitter}
                onChange={(e) => setCustomSimSettings(prev => ({ ...prev, jitter: parseInt(e.target.value) }))}
                className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
              />
            </div>
          </div>
        )}

        {/* Quick Simulation Event Injections */}
        <div className="grid grid-cols-2 gap-2 mt-0.5">
          <button
            onClick={triggerLossSpike}
            disabled={isSpikeActive || isDropoutActive}
            className={`py-2 px-3 text-[9px] font-bold tracking-wider uppercase font-mono rounded-xl transition-all border flex items-center justify-center gap-1.5 ${
              isSpikeActive
                ? 'bg-amber-600/30 border-amber-500 text-amber-300 animate-pulse'
                : 'bg-slate-900 border-white/5 text-slate-300 hover:bg-slate-900/80 hover:text-white'
            }`}
          >
            <Zap className={`w-3 h-3 ${isSpikeActive ? 'text-amber-400 animate-bounce' : 'text-slate-400'}`} /> 
            {isSpikeActive ? 'Loss Spike Active' : 'Inject 30% Loss Spike'}
          </button>
          <button
            onClick={triggerSignalDropout}
            disabled={isSpikeActive || isDropoutActive}
            className={`py-2 px-3 text-[9px] font-bold tracking-wider uppercase font-mono rounded-xl transition-all border flex items-center justify-center gap-1.5 ${
              isDropoutActive
                ? 'bg-rose-600/30 border-rose-500 text-rose-300 animate-pulse'
                : 'bg-slate-900 border-white/5 text-slate-300 hover:bg-slate-900/80 hover:text-white'
            }`}
          >
            <WifiOff className={`w-3 h-3 ${isDropoutActive ? 'text-rose-400 animate-bounce' : 'text-slate-400'}`} />
            {isDropoutActive ? 'Signal Drop active' : 'Simulate 100% Dropout'}
          </button>
        </div>
      </div>

      {/* ── CALL QUALITY & ABR OVERRIDES ── */}
      <div className="bg-slate-950/60 border border-white/5 p-4 rounded-2xl flex flex-col gap-3 shadow-lg">
        <div className="flex items-center justify-between">
          <h4 className="text-[10px] uppercase font-bold text-slate-400 tracking-wider flex items-center gap-1.5 font-display">
            <Sliders className="w-3.5 h-3.5 text-indigo-400" /> ABR Quality Settings
          </h4>
          <span className="text-[9px] font-bold font-mono text-emerald-400 flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" /> Configured
          </span>
        </div>

        <div className="flex flex-col gap-2">
          {/* Quality Preferences Selector */}
          <div className="grid grid-cols-5 gap-1">
            {[
              { id: 'auto', label: 'Auto' },
              { id: 'hd', label: 'HD' },
              { id: 'sd', label: 'SD' },
              { id: 'low', label: 'Low' },
              { id: 'audio-only', label: 'Audio' },
            ].map(pref => (
              <button
                key={pref.id}
                onClick={() => setQualityPreference(pref.id as any)}
                className={`py-1 text-[9px] font-bold font-mono rounded-md transition-all border ${
                  qualityPreference === pref.id
                    ? 'bg-emerald-600/20 border-emerald-500 text-emerald-300'
                    : 'bg-slate-900/40 border-white/5 text-slate-400 hover:text-slate-200'
                }`}
              >
                {pref.label}
              </button>
            ))}
          </div>

          <div className="flex items-center justify-between bg-slate-950/40 border border-white/5 p-2.5 rounded-xl mt-1">
            <span className="text-[9.5px] text-slate-400 font-medium">Negotiated Call Profile</span>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
              <span className="text-[10px] font-mono font-bold text-emerald-300 uppercase">
                {currentQualityProfile === 'hd' ? 'High Def (720p)' : currentQualityProfile === 'sd' ? 'Std Def (480p)' : currentQualityProfile === 'low' ? 'Low Band (180p)' : 'Audio Only'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Connection & Network Summary Cards */}
      <div className="grid grid-cols-2 gap-3">
        {/* Card: Latency */}
        <div className="bg-slate-950/40 border border-white/5 p-3 rounded-2xl flex flex-col gap-1.5 relative overflow-hidden">
          <div className="flex justify-between items-center text-[10px] text-slate-400 font-bold uppercase tracking-wider">
            <span className="flex items-center gap-1.5"><Activity className="w-3 h-3 text-indigo-400" /> Latency</span>
            <span className="font-mono text-white text-xs">{stats.videoLatency} ms</span>
          </div>
          {/* Sparkline Graph */}
          <div className="h-10 w-full mt-1.5 opacity-80">
            <svg className="w-full h-full" viewBox="0 0 160 40" preserveAspectRatio="none">
              <path
                d={getSparklinePath(latencyHistory, 160, 40, 60)}
                fill="none"
                stroke="#6366f1"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <span className="text-[9px] text-slate-500 font-mono self-end">RTT Diagnostic</span>
        </div>

        {/* Card: Jitter & Packet Loss */}
        <div className="bg-slate-950/40 border border-white/5 p-3 rounded-2xl flex flex-col gap-1.5">
          <div className="flex justify-between items-center text-[10px] text-slate-400 font-bold uppercase tracking-wider">
            <span className="flex items-center gap-1.5"><BarChart2 className="w-3 h-3 text-emerald-400" /> Jitter</span>
            <span className="font-mono text-white text-xs">{stats.jitter} ms</span>
          </div>
          
          <div className="flex items-center justify-between border-t border-white/5 pt-2 mt-auto">
            <span className="text-[10px] text-slate-400 flex items-center gap-1">
              <WifiOff className="w-3.5 h-3.5 text-rose-400" /> Loss:
            </span>
            <span className={`font-mono text-xs font-bold ${stats.packetLoss > 0 ? 'text-rose-400' : 'text-slate-300'}`}>
              {stats.packetLoss}%
            </span>
          </div>

          <div className="w-full h-1 bg-slate-900 rounded-full overflow-hidden mt-1">
            <div 
              className={`h-full rounded-full transition-all duration-300 ${stats.packetLoss > 10 ? 'bg-rose-500' : stats.packetLoss > 0 ? 'bg-amber-500' : 'bg-emerald-500'}`} 
              style={{ width: `${Math.min(100, (stats.packetLoss || 0) * 2.5)}%` }}
            />
          </div>
        </div>
      </div>

      {/* Bitrate & Throughput Info */}
      <div className="bg-slate-950/40 border border-white/5 p-4 rounded-2xl space-y-3 shadow-md">
        <h4 className="text-[10px] uppercase font-bold text-slate-400 tracking-wider flex items-center gap-1.5 font-display">
          <Network className="w-3.5 h-3.5 text-indigo-400" /> Bandwidth Throughput
        </h4>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-slate-500 flex items-center gap-1">
                <ArrowUpRight className="w-3 h-3 text-indigo-400" /> Transmitting
              </span>
              <span className="font-mono font-bold text-white">{stats.bitrateSent || 0} kbps</span>
            </div>
            {/* Outgoing Sparkline */}
            <div className="h-6 w-full opacity-60">
              <svg className="w-full h-full" viewBox="0 0 100 24" preserveAspectRatio="none">
                <path
                  d={getSparklinePath(bitrateHistory.map(b => b.sent), 100, 24, 500)}
                  fill="none"
                  stroke="#818cf8"
                  strokeWidth="1.5"
                />
              </svg>
            </div>
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-slate-500 flex items-center gap-1">
                <ArrowDownLeft className="w-3 h-3 text-emerald-400" /> Receiving
              </span>
              <span className="font-mono font-bold text-white">{stats.bitrateReceived || 0} kbps</span>
            </div>
            {/* Incoming Sparkline */}
            <div className="h-6 w-full opacity-60">
              <svg className="w-full h-full" viewBox="0 0 100 24" preserveAspectRatio="none">
                <path
                  d={getSparklinePath(bitrateHistory.map(b => b.recv), 100, 24, 500)}
                  fill="none"
                  stroke="#34d399"
                  strokeWidth="1.5"
                />
              </svg>
            </div>
          </div>
        </div>
      </div>

      {/* Codecs & Media Pipeline Details */}
      <div className="bg-slate-950/40 border border-white/5 p-4 rounded-2xl space-y-3.5 shadow-md">
        <h4 className="text-[10px] uppercase font-bold text-slate-400 tracking-wider flex items-center gap-1.5 font-display">
          <Cpu className="w-3.5 h-3.5 text-indigo-400" /> DSP & Codec Configuration
        </h4>

        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[10px]">
          <div className="flex items-center justify-between py-1 border-b border-white/5">
            <span className="text-slate-500">Audio Codec</span>
            <span className="font-mono text-indigo-300 font-semibold">{stats.audioCodec || 'opus'}</span>
          </div>
          <div className="flex items-center justify-between py-1 border-b border-white/5">
            <span className="text-slate-500">Video Codec</span>
            <span className="font-mono text-indigo-300 font-semibold">{stats.videoCodec || 'VP8'}</span>
          </div>
          <div className="flex items-center justify-between py-1 border-b border-white/5">
            <span className="text-slate-500">Video Capture</span>
            <span className="font-mono text-slate-300">{stats.videoFps || 30} FPS</span>
          </div>
          <div className="flex items-center justify-between py-1 border-b border-white/5">
            <span className="text-slate-500">Encryption</span>
            <span className="font-mono text-emerald-400 font-semibold">AES-GCM-256</span>
          </div>
        </div>
      </div>

      {/* ICE Negotiation & Signaling Transport */}
      <div className="bg-slate-950/40 border border-white/5 p-4 rounded-2xl space-y-3 shadow-md">
        <h4 className="text-[10px] uppercase font-bold text-slate-400 tracking-wider flex items-center gap-1.5 font-display">
          <Server className="w-3.5 h-3.5 text-indigo-400" /> ICE Negotiation & Transport
        </h4>

        <div className="space-y-2 text-[10px]">
          <div className="flex justify-between items-center bg-slate-950/60 p-2 rounded-xl border border-white/5">
            <span className="text-slate-500">Local ICE Candidate</span>
            <span className="font-mono text-slate-300">{stats.localCandidateType || 'host'}</span>
          </div>
          <div className="flex justify-between items-center bg-slate-950/60 p-2 rounded-xl border border-white/5">
            <span className="text-slate-500">Remote ICE Candidate</span>
            <span className="font-mono text-slate-300">{stats.remoteCandidateType || 'srflx'}</span>
          </div>
          <div className="flex justify-between items-center bg-slate-950/60 p-2 rounded-xl border border-white/5">
            <span className="text-slate-500">DTLS / Transport State</span>
            <span className="font-mono text-slate-300 lowercase">{stats.transportType || 'connected'}</span>
          </div>
        </div>
      </div>

      {/* Audit Logs (Chaperone actions / Control Override signals) */}
      <div className="bg-slate-950/40 border border-white/5 p-4 rounded-2xl flex-1 flex flex-col gap-2 min-h-[140px] shadow-md">
        <h4 className="text-[10px] uppercase font-bold text-slate-400 tracking-wider flex items-center gap-1.5 font-display">
          <Terminal className="w-3.5 h-3.5 text-indigo-400" /> Chaperone Audit Log
        </h4>

        <div className="flex-1 overflow-y-auto max-h-[160px] pr-1 flex flex-col gap-1.5 font-mono text-[9px] bg-slate-950/50 p-2.5 rounded-xl border border-white/5 text-slate-400">
          {controlLogs.length === 0 ? (
            <p className="italic text-slate-600 text-center my-auto">No security audits recorded yet.</p>
          ) : (
            controlLogs.map((log, idx) => (
              <div 
                key={idx} 
                className={`py-0.5 border-l-2 pl-2 ${
                  log.includes('✅') || log.includes('approved') 
                    ? 'border-emerald-500/50 text-emerald-300/90' 
                    : log.includes('🖐') || log.includes('Host') 
                    ? 'border-amber-500/50 text-amber-300/90' 
                    : log.includes('Warning') || log.includes('rejected') || log.includes('⚠️')
                    ? 'border-rose-500/50 text-rose-300/90'
                    : 'border-slate-700 text-slate-400'
                }`}
              >
                {log}
              </div>
            ))
          )}
        </div>
      </div>

    </div>
  );
}
