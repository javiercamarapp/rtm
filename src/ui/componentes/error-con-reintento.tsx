'use client';

import { useRouter } from 'next/navigation';
import { startTransition } from 'react';
import { PaginaError } from './estado-pagina';

/** Limite de error de Next: reintentar vuelve a pedir los datos al servidor (refresh) y reintenta el render. */
export function ErrorConReintento({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();
  return (
    <PaginaError
      referencia={error.digest ?? null}
      onReintentar={() => {
        startTransition(() => {
          router.refresh();
          reset();
        });
      }}
    />
  );
}
