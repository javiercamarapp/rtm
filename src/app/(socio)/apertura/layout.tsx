import type { ReactNode } from 'react';
import { NavPasos } from './nav-pasos';

export default function LayoutApertura({ children }: { children: ReactNode }) {
  return (
    <>
      <NavPasos />
      {children}
    </>
  );
}
