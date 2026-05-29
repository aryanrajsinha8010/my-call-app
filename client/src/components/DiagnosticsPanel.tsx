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
  ArrowDownLeft
} from 'lucide-react';
import { ConnectionStats } from '../hooks/useWebRTC';

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
}

export default function DiagnosticsPanel({ 
  stats, 
  participantsCount, 
  controlLogs, 
  roomName 
}: DiagnosticsPanelProps) {
  const [latencyHistory, setLatencyHistory] = useState<number[]>([]);
  const [bitrateHistory, setBitrateHistory] = useState<{ sent: number; recv: number }[]>([]);
  
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
    if (loss > 5 || lat > 250) {
      return { label: 'CRITICAL', color: 'text-rose-400 bg-rose-500/10 border-rose-500/30', dot: 'bg-rose-500' };
    } else if (loss > 1 || lat > 120) {
      return { label: 'DEGRADED', color: 'text-amber-400 bg-amber-500/10 border-amber-500/30', dot: 'bg-amber-500' };
    }
    return { label: 'OPTIMAL', color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30', dot: 'bg-emerald-500' };
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

  return (
    <div className="flex flex-col gap-4 animate-in fade-in duration-200">
      
      {/* Dynamic Health Header Banner */}
      <div className={`p-4 rounded-2xl border flex items-center justify-between transition-all duration-300 ${health.color}`}>
        <div className="flex items-center gap-3">
          <span className={`w-3 h-3 rounded-full animate-ping ${health.dot}`} style={{ animationDuration: '2s' }} />
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider font-display">System Health: {health.label}</h4>
            <p className="text-[10px] opacity-75">Room: <span className="font-mono font-bold">#{roomName}</span> · Peers: {participantsCount}</p>
          </div>
        </div>
        <div className="flex items-center gap-1 bg-white/5 border border-white/10 px-2 py-1 rounded-lg">
          <ShieldCheck className="w-3.5 h-3.5" />
          <span className="text-[9px] font-bold font-mono">E2EE Tunnel</span>
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
              className={`h-full rounded-full transition-all duration-300 ${stats.packetLoss > 0 ? 'bg-rose-500' : 'bg-emerald-500'}`} 
              style={{ width: `${Math.min(100, (stats.packetLoss || 0) * 10)}%` }}
            />
          </div>
        </div>
      </div>

      {/* Bitrate & Throughput Info */}
      <div className="bg-slate-950/40 border border-white/5 p-4 rounded-2xl space-y-3">
        <h4 className="text-[10px] uppercase font-bold text-slate-400 tracking-wider flex items-center gap-1.5">
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
      <div className="bg-slate-950/40 border border-white/5 p-4 rounded-2xl space-y-3.5">
        <h4 className="text-[10px] uppercase font-bold text-slate-400 tracking-wider flex items-center gap-1.5">
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
      <div className="bg-slate-950/40 border border-white/5 p-4 rounded-2xl space-y-3">
        <h4 className="text-[10px] uppercase font-bold text-slate-400 tracking-wider flex items-center gap-1.5">
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
      <div className="bg-slate-950/40 border border-white/5 p-4 rounded-2xl flex-1 flex flex-col gap-2 min-h-[140px]">
        <h4 className="text-[10px] uppercase font-bold text-slate-400 tracking-wider flex items-center gap-1.5">
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
                    : log.includes('Warning') || log.includes('rejected')
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
