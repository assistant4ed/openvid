import Link from 'next/link';

import manifest from '../../public/showcase/manifest.json';

export const metadata = {
    title: 'Community — OpenVid Studio',
    description: 'Real clips made in OpenVid Studio, with the model, move and settings behind each one.',
};

// Community gallery. Every entry is a REAL render produced in this studio —
// the manifest carries the AI Director's own direction for each shot, so the
// page shows how a piece was made, not just that it exists.
const SAMPLES = manifest.map((entry) => ({
    slug: entry.slug,
    title: entry.title,
    direction: entry.direction,
    poster: `/showcase/${entry.slug}.jpg`,
    clip: `/showcase/clips/${entry.slug}.mp4`,
    preset: entry.preset || null,
}));

const HOW = [
    {
        title: 'Every clip here started as one sentence',
        body: 'The Prompt Agent expands a short brief into a 200-word shot description — subject, set, light, lens, and how the motion resolves — before anything renders.',
    },
    {
        title: 'The camera move is directed, not guessed',
        body: 'Draw a path over your frame or pick a preset; the AI Director writes the cinematography for it, then a frame-exact model renders from your real image.',
    },
    {
        title: 'Made with your own key',
        body: 'Nothing is rendered on a shared account. You bring a SuperbAPI key, the studio only offers models it has verified on it, and shows the cost before you spend.',
    },
];

export default function CommunityPage() {
    return (
        <main className="min-h-screen bg-[#050505] text-white">
            <header className="border-b border-white/8">
                <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
                    <Link href="/" className="flex items-center gap-2.5">
                        <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#d4f939] text-black">◆</span>
                        <span className="font-bold">OpenVid Studio</span>
                    </Link>
                    <nav className="flex items-center gap-5">
                        <Link href="/showcase" className="slate-label text-white/50 transition-colors hover:text-white">Showcase</Link>
                        <Link href="/#how-it-works" className="slate-label text-white/50 transition-colors hover:text-white">How it works</Link>
                        <Link href="/studio/workspace" className="rounded-lg bg-[#d4f939] px-3.5 py-1.5 text-[13px] font-bold text-black">
                            Open the studio
                        </Link>
                    </nav>
                </div>
            </header>

            <section className="mx-auto max-w-7xl px-6 pb-8 pt-16">
                <span className="slate-label text-white/40">Community</span>
                <h1 className="display-1 mt-3 max-w-4xl">Made in OpenVid Studio</h1>
                <p className="mt-4 max-w-2xl text-white/55">
                    Real renders, not stock. Each one shows the direction the AI wrote for it,
                    so you can see what a brief turns into before spending anything of your own.
                </p>
            </section>

            <section className="mx-auto max-w-7xl px-6 pb-20">
                <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                    {SAMPLES.map((sample) => (
                        <figure key={sample.slug} className="panel group overflow-hidden">
                            <div className="relative aspect-video bg-black">
                                <video
                                    src={sample.clip}
                                    poster={sample.poster}
                                    muted
                                    loop
                                    playsInline
                                    preload="none"
                                    controls
                                    className="h-full w-full object-contain"
                                />
                            </div>
                            <figcaption className="space-y-2 px-4 py-3.5">
                                <h2 className="text-base font-bold">{sample.title}</h2>
                                <p className="text-[12px] leading-relaxed text-white/45">
                                    <span className="slate-label mr-1.5 text-[#d4f939]">AI Director</span>
                                    {sample.direction}
                                </p>
                            </figcaption>
                        </figure>
                    ))}
                </div>
            </section>

            <section className="letterbox-rule mx-auto max-w-7xl px-6 py-20">
                <h2 className="display-2 max-w-3xl">How these were made</h2>
                <div className="mt-10 grid gap-6 md:grid-cols-3">
                    {HOW.map((item) => (
                        <div key={item.title} className="panel px-5 py-5">
                            <h3 className="text-base font-bold">{item.title}</h3>
                            <p className="mt-2 text-sm leading-relaxed text-white/55">{item.body}</p>
                        </div>
                    ))}
                </div>
            </section>

            <section className="letterbox-rule px-6 py-24 text-center">
                <div className="panel mx-auto max-w-2xl px-8 py-12">
                    <h2 className="display-2">Put yours here</h2>
                    <p className="mt-3 text-white/55">
                        Anything you render in the studio can be shared to this page.
                        Open the workspace, make a clip, and use Share on the result.
                    </p>
                    <Link
                        href="/studio/workspace"
                        className="mt-7 inline-block rounded-xl bg-[#d4f939] px-6 py-3 font-bold text-black transition-transform hover:scale-[1.02]"
                    >
                        Open the studio
                    </Link>
                </div>
            </section>
        </main>
    );
}
