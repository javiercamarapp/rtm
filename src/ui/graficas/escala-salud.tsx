/** Escala de salud en tres tramos con palabra (Critico, Atencion, Sano) y marcador: el estado nunca es solo color y no hay degradado. `pct` 0 a 100. */
export function EscalaSalud({ etiquetaAria, pct, texto }: { etiquetaAria: string; pct: number; texto: string }) {
  const p = Math.min(100, Math.max(0, Number.isFinite(pct) ? pct : 0));
  return (
    <div className="rtm-salud">
      <svg width="100%" height="22" role="img" aria-label={`${etiquetaAria}: ${texto}`} focusable="false">
        <rect x="0" y="8" width="33%" height="6" rx="3" className="rtm-salud-malo" />
        <rect x="33.7%" y="8" width="32.6%" height="6" rx="3" className="rtm-salud-medio" />
        <rect x="67%" y="8" width="33%" height="6" rx="3" className="rtm-salud-bueno" />
        <rect x={`${p}%`} y="2" width="3" height="18" rx="1.5" className="rtm-salud-marca" />
      </svg>
      <span className="rtm-salud-pie"><small>Crítico</small><strong>{texto}</strong><small>Sano</small></span>
    </div>
  );
}
