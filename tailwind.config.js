/** @type {import('tailwindcss').Config} */
module.exports = {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
        "./app/**/*.{js,ts,jsx,tsx}",
        "./components/**/*.{js,ts,jsx,tsx}",
        "./packages/studio/src/**/*.{js,jsx}",
        "./packages/Open-AI-Design-Agent/packages/design-agent/src/**/*.{js,jsx}",
        "./packages/Open-Poe-AI/packages/agents/src/**/*.{js,jsx,ts,tsx}",
        "./packages/Vibe-Workflow/packages/workflow-builder/src/**/*.{js,jsx,ts,tsx}",
    ],
    theme: {
        extend: {
            colors: {
                primary: {
                    DEFAULT: '#d4f939',
                    hover: '#e4ff66',
                    deep: '#a8c614',
                    ink: '#151a02',
                },
                rec: {
                    DEFAULT: '#f59e0b',
                    deep: '#b45309',
                },
                ink: {
                    0: '#030304',
                    1: '#08080a',
                    2: '#0d0d10',
                    3: '#121216',
                    4: '#1a1a20',
                },
                'app-bg': '#030304',
                'panel-bg': '#08080a',
                'card-bg': '#121216',
                secondary: '#a1a1aa',
                muted: '#52525b',
            },
            fontFamily: {
                sans: ['var(--font-body)', 'Inter', 'system-ui', 'sans-serif'],
                display: ['var(--font-display)', 'Bricolage Grotesque', 'system-ui', 'sans-serif'],
                slate: ['var(--font-mono)', 'JetBrains Mono', 'ui-monospace', 'monospace'],
            },
            borderRadius: {
                'xl': '1rem',
                '2xl': '1.5rem',
                '3xl': '2rem',
            },
            boxShadow: {
                'glow': '0 0 20px rgba(212, 249, 57, 0.4)',
                'glow-accent': '0 0 20px rgba(168, 85, 247, 0.4)',
                'cyan-whisper': '0 0 0 1px rgba(212, 249, 57, 0.18), 0 8px 30px rgba(212, 249, 57, 0.07)',
                'panel': '0 24px 80px rgba(0, 0, 0, 0.7)',
                '3xl': '0 35px 60px -15px rgba(0, 0, 0, 0.8)',
            },
            letterSpacing: {
                'slate': '0.18em',
            },
        },
    },
    plugins: [],
}
