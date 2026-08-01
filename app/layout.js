import './globals.css';

import { Anton, Inter, JetBrains_Mono } from 'next/font/google';

// Type system — the single biggest lever of the redesign.
// Bricolage Grotesque: chunky, characterful display face for headlines.
// Inter: quiet, readable body.
// JetBrains Mono: the film-slate voice — every metadata micro-label
// (SCENE 01 · 16:9 · 25S · 205 CR) is set in mono uppercase.
const display = Anton({
  variable: '--font-display',
  subsets: ['latin'],
  weight: '400',
});

const body = Inter({
  variable: '--font-body',
  subsets: ['latin'],
});

const mono = JetBrains_Mono({
  variable: '--font-mono',
  subsets: ['latin'],
  weight: ['400', '500', '700'],
});

export const metadata = {
  title: 'OpenVid Studio — Draw the Camera. Direct the AI.',
  description:
    'Open-source AI film studio: 400+ image & video models (Seedance 2.0, Kling, Veo, Flux), a hand-drawn camera-path director, chained long-form renders, and no content filters. Bring your SuperbAPI key.',
  keywords:
    'ai video generator, camera path, seedance 2.0, kling, veo, open source ai studio, superbapi',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
