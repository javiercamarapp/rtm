import { describe, expect, it } from 'vitest';
import { configPrivada } from '@/config/privada';

describe('configPrivada recorta espacios', () => {
  it('un token guardado con espacio o salto de linea al borde se usa sin ellos', () => {
    const c = configPrivada({ TELEGRAM_BOT_TOKEN: ' 123456789:ABCdefGHIjklMNOpqrSTUvwxYZ\n', TELEGRAM_WEBHOOK_SECRET: '  0123456789abcdef0123  ' });
    expect(c.TELEGRAM_BOT_TOKEN).toBe('123456789:ABCdefGHIjklMNOpqrSTUvwxYZ');
    expect(c.TELEGRAM_WEBHOOK_SECRET).toBe('0123456789abcdef0123');
  });
});
