'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

/** Vuelve a leer la pagina cada `segundos` (sin recargarla del todo): el costo de OpenRouter se ve conforme se consume. Se pausa si la pestana esta oculta. */
export function ActualizarCada({ segundos = 60 }: { segundos?: number }) {
  const router = useRouter();
  const [ultima, setUltima] = useState<Date | null>(null);
  useEffect(() => {
    setUltima(new Date());
    const id = setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      router.refresh();
      setUltima(new Date());
    }, segundos * 1000);
    return () => clearInterval(id);
  }, [router, segundos]);
  return <span className="rtm-nota" data-testid="en-vivo-actualizacion">Se actualiza solo cada {segundos} s{ultima ? ` · revisado ${[ultima.getHours(), ultima.getMinutes(), ultima.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':')}` : ''}</span>;
}
