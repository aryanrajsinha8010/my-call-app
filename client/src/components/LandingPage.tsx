import React from 'react';
import { ShieldCheck, Zap, Lock, Sliders, Edit2 } from 'lucide-react';

interface LandingPageProps {
  onStartConnecting: () => void;
}

export const LandingPage: React.FC<LandingPageProps> = ({ onStartConnecting }) => {
  return (
    <div className="w-full landing-container">
      {/* Premium Floating Header */}
      <header className="landing-nav animate-in fade-in slide-in-from-top-4 duration-500">
        <div className="landing-logo">
          <ShieldCheck className="w-6 h-6 text-[var(--nx-primary)] animate-pulse" />
          <span className="font-display font-extrabold text-xl tracking-tight text-[var(--nx-ink)]">NexaLink</span>
          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[var(--nx-primary)]/10 text-[var(--nx-primary)] font-bold">SECURE v1.0</span>
        </div>
        <div className="flex items-center gap-4">
          <a 
            href="#features" 
            onClick={(e) => { 
              e.preventDefault(); 
              document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' }); 
            }} 
            className="text-xs font-bold text-[var(--nx-muted)] hover:text-[var(--nx-primary)] transition"
          >
            Capabilities
          </a>
          <a 
            href="#architecture" 
            onClick={(e) => { 
              e.preventDefault(); 
              document.getElementById('architecture')?.scrollIntoView({ behavior: 'smooth' }); 
            }} 
            className="text-xs font-bold text-[var(--nx-muted)] hover:text-[var(--nx-primary)] transition"
          >
            Architecture
          </a>
          <button 
            onClick={onStartConnecting} 
            className="nx-btn nx-btn-primary flex items-center gap-1.5"
            style={{ padding: '8px 18px', fontSize: '12px' }}
          >
            <Zap className="w-3.5 h-3.5" /> Start Connecting
          </button>
        </div>
      </header>

      {/* Hero Section - Premium Two Column */}
      <section className="landing-hero-section">
        <div className="landing-hero-left">
          <div className="landing-badge-premium animate-in fade-in duration-500">
            <Zap className="w-3 h-3 text-[var(--nx-primary)]" />
            <span>INTRODUCING THE SECURE ZONE</span>
          </div>
          <h1 className="landing-title animate-in fade-in duration-700">
            Secure Real-Time Talking & <span className="title-gradient">Instant Connection</span> Hub
          </h1>
          <p className="landing-subtitle animate-in fade-in duration-1000">
            A premium secure communications platform designed for real-time collaboration — not just another corporate meeting app. NexaLink blends military-grade privacy, real-time voice DSP morphing, vector whiteboard canvas, and sandboxed remote operations into a beautiful, high-fidelity experience.
          </p>
          <div className="landing-cta-group animate-in fade-in duration-1000">
            <button 
              onClick={onStartConnecting} 
              className="nx-btn nx-btn-primary flex items-center gap-2 shadow-lg shadow-[var(--nx-primary)]/25 hover:shadow-[var(--nx-primary)]/40 hover:scale-105 active:scale-95 transition-all duration-300" 
              style={{ padding: '16px 32px', fontSize: '15px', borderRadius: '16px' }}
            >
              <Zap className="w-4 h-4 animate-bounce" /> Start Connecting
            </button>
            <a 
              href="#features" 
              onClick={(e) => { 
                e.preventDefault(); 
                document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' }); 
              }} 
              className="nx-btn nx-btn-ghost flex items-center gap-2 border border-[var(--nx-line-strong)] hover:bg-[var(--nx-primary)]/5 hover:border-[var(--nx-primary)]/30 hover:scale-105 active:scale-95 transition-all duration-300" 
              style={{ padding: '16px 32px', borderRadius: '16px' }}
            >
              Explore Capabilities
            </a>
          </div>
        </div>

        <div className="landing-hero-right animate-in fade-in zoom-in-95 duration-1000">
          <div className="preview-glow-backdrop"></div>
          <div className="preview-frame-wrapper">
            <img 
              src="/nexalink_dashboard_preview.png" 
              alt="NexaLink Premium Interface Dashboard" 
              className="preview-dashboard-img" 
            />
            <div className="preview-frame-overlay">
              <div className="overlay-indicator">
                <span className="dot animate-ping"></span>
                <span className="text">LIVE SECURE PROTOCOL ACTIVE</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Capabilities Highlights Grid */}
      <section id="features" className="landing-section-wrapper">
        <div className="section-header text-center max-w-xl mx-auto">
          <h2 className="section-title">Engineered for Absolute Privacy & Real-Time Sync</h2>
          <p className="section-desc">
            Experience a secure sandbox designed for collaborative editing, secure peer-to-peer audio links, and sub-millisecond encryption.
          </p>
        </div>

        <div className="landing-features-grid">
          <div className="landing-feature-card">
            <div className="landing-feature-icon">
              <Lock className="w-5 h-5" />
            </div>
            <h3 className="landing-feature-title">Military-Grade Encryption</h3>
            <p className="landing-feature-desc">
              Your media streams, collaborative vector blackboard drawings, and chat channels are secured via client-side AES-GCM-256 for absolute privacy.
            </p>
          </div>

          <div className="landing-feature-card">
            <div className="landing-feature-icon">
              <Sliders className="w-5 h-5" />
            </div>
            <h3 className="landing-feature-title">Real-Time DSP Morphing</h3>
            <p className="landing-feature-desc">
              Adjust your voice parameters live using custom pitch-shifters, sub-ambient noise gates, frequency equalizers, and voice cloning models.
            </p>
          </div>

          <div className="landing-feature-card">
            <div className="landing-feature-icon">
              <Zap className="w-5 h-5" />
            </div>
            <h3 className="landing-feature-title">Chaperoned Tunneling</h3>
            <p className="landing-feature-desc">
              Safely initiate, grant, and run collaborative remote control operations inside a secure browser sandboxed viewport with emergency panic locks.
            </p>
          </div>

          <div className="landing-feature-card">
            <div className="landing-feature-icon">
              <Edit2 className="w-5 h-5" />
            </div>
            <h3 className="landing-feature-title">Interactive Shared Board</h3>
            <p className="landing-feature-desc">
              Co-sketch code architectures, design mockups, and draw vector overlays on a high-speed blackboard canvas synced seamlessly via Yjs.
            </p>
          </div>
        </div>
      </section>

      {/* Architecture - How it works */}
      <section id="architecture" className="landing-section-wrapper architecture-section">
        <div className="section-header text-center max-w-xl mx-auto">
          <h2 className="section-title">Under The Hood</h2>
          <p className="section-desc">
            NexaLink integrates high-performance P2P structures with persistent cloud channels to keep you connected, secure, and notified.
          </p>
        </div>

        <div className="architecture-grid">
          <div className="architecture-step-card">
            <div className="step-num">01</div>
            <h4 className="step-title">Supabase Identity Gateway</h4>
            <p className="step-desc">
              Rigorous authentication and RLS database schemas secure your user profiles. Secure HTTP-only cookies retain your session safely across browser relaunches.
            </p>
          </div>

          <div className="architecture-step-card">
            <div className="step-num">02</div>
            <h4 className="step-title">WebRTC Secure Signalling</h4>
            <p className="step-desc">
              Socket.IO servers broker instantaneous RTC handshakes, enabling a direct, peer-to-peer connection for audio, video, and Yjs whiteboards without cloud storage hops.
            </p>
          </div>

          <div className="architecture-step-card">
            <div className="step-num">03</div>
            <h4 className="step-title">Asynchronous Web Push</h4>
            <p className="step-desc">
              When a contact goes offline, the push-waking service monitors state changes in Supabase and triggers native Web Push notifications so they never miss an incoming call.
            </p>
          </div>
        </div>
      </section>

      {/* Bottom Glowing CTA */}
      <section className="landing-bottom-cta">
        <div className="cta-backdrop-glow"></div>
        <div className="relative z-10 flex flex-col items-center gap-6">
          <h2 className="text-3xl font-display font-extrabold text-[var(--nx-ink)] max-w-md text-center leading-tight">
            Establish Your Secure Connection Gateway
          </h2>
          <p className="text-xs text-[var(--nx-muted)] text-center max-w-sm leading-relaxed">
            Log in once. Stay synced securely. Receive calls even when closed. Elevate your engineering discussions to absolute comfort.
          </p>
          <button 
            onClick={onStartConnecting} 
            className="nx-btn nx-btn-primary flex items-center gap-2 hover:scale-105 active:scale-95 transition-all shadow-xl shadow-[var(--nx-primary)]/20"
            style={{ padding: '16px 36px', fontSize: '14px', borderRadius: '14px' }}
          >
            <Zap className="w-4 h-4 animate-pulse" /> Enter Connection Lobby
          </button>
        </div>
      </section>

      {/* Footer */}
      <footer className="landing-footer">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 w-full">
          <span className="text-3xs text-[var(--nx-muted)] font-mono">
            © 2026 NexaLink Inc. All cryptographic rights reserved.
          </span>
          <div className="flex items-center gap-4 text-3xs font-bold text-[var(--nx-muted)]">
            <span>E2EE Active</span>
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
            <span>All services nominal</span>
          </div>
        </div>
      </footer>
    </div>
  );
};
