import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Vox — Realtime Voice Agent',
  description: 'A natural, expressive AI voice agent for conversation and sales.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
