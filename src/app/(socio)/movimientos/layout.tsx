import type { ReactNode } from 'react';
import { SubnavMovimientos } from './subnav';

export default function LayoutMovimientos({ children }: { children: ReactNode }) {
  return (
    <>
      <SubnavMovimientos />
      {children}
    </>
  );
}
