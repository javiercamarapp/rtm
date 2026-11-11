import type { ReactNode } from 'react';
import { SubnavInventario } from './subnav';

export default function LayoutInventario({ children }: { children: ReactNode }) {
  return (
    <>
      <SubnavInventario />
      {children}
    </>
  );
}
