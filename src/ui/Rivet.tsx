/** A rivet, drawn as simple clip art: a domed brass head on a short shank. Sized by the text around it. */
export function Rivet({ className = '' }: { className?: string }) {
  return (
    <svg className={`rivet ${className}`} viewBox="0 0 24 24" aria-hidden focusable="false">
      <defs>
        <linearGradient id="rivet-head" x1="0" y1="0" x2="0.35" y2="1">
          <stop offset="0" stopColor="#fff1b8" />
          <stop offset="0.45" stopColor="#f6c445" />
          <stop offset="1" stopColor="#b7791f" />
        </linearGradient>
        <linearGradient id="rivet-shank" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#8a5a12" />
          <stop offset="0.45" stopColor="#e0a92e" />
          <stop offset="1" stopColor="#8a5a12" />
        </linearGradient>
      </defs>
      {/* The shank, below the head. */}
      <rect x="9" y="12" width="6" height="10" rx="1.2" fill="url(#rivet-shank)" stroke="#5c3a07" strokeWidth="1.2" />
      {/* The domed head and the rim under it. */}
      <path d="M2.5 13.2 C2.5 6.5 6.8 3 12 3 C17.2 3 21.5 6.5 21.5 13.2 Z" fill="url(#rivet-head)" stroke="#5c3a07" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M2.5 13.2 H21.5 V14.6 Q21.5 15.3 20.8 15.3 H3.2 Q2.5 15.3 2.5 14.6 Z" fill="#a8721c" stroke="#5c3a07" strokeWidth="1.2" strokeLinejoin="round" />
      {/* A shine on the dome. */}
      <path d="M6.2 9.4 C6.8 7 8.6 5.6 10.8 5.2" fill="none" stroke="#fffbe8" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
