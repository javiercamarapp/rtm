import type { ReactNode } from 'react';

/** Texto de ayuda largo, cerrado por omision: el encabezado queda en una linea y nada de la explicacion se pierde. */
export function Ayuda({ resumen = 'Cómo se lee', children, testid }: { resumen?: string; children: ReactNode; testid?: string }) {
  return (
    <details className="rtm-bc-ayuda" data-testid={testid}>
      <summary>{resumen}</summary>
      <p>{children}</p>
    </details>
  );
}
