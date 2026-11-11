import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Sin fuentes por red: todas las tipografias son archivos locales (src/fuentes).
};

export default config;
