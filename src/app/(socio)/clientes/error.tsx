'use client';

import { ErrorConReintento } from '@/ui/componentes/error-con-reintento';

export default function Error(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorConReintento {...props} />;
}
