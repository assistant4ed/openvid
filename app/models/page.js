import Link from 'next/link';

import ModelPricingTable from './ModelPricingTable';

export const metadata = {
    title: 'Model pricing — OpenVid Studio',
    description: 'Compare every video, image and text model on the gateway: price, capabilities, clip lengths and context, with live figures from the billing catalog.',
};

export default function ModelsPage() {
    return (
        <main className="min-h-screen bg-[#050505] text-white">
            <header className="border-b border-white/8">
                <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
                    <Link href="/" className="flex items-center gap-2.5">
                        <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#d4f939] text-black">◆</span>
                        <span className="font-bold">OpenVid Studio</span>
                    </Link>
                    <nav className="flex items-center gap-5 text-sm text-white/55">
                        <Link href="/community" className="hover:text-white">Community</Link>
                        <Link href="/models" className="text-[#d4f939]">Models</Link>
                        <Link href="/studio" className="rounded-lg bg-[#d4f939] px-3.5 py-1.5 font-medium text-black hover:bg-[#c2e632]">
                            Open studio
                        </Link>
                    </nav>
                </div>
            </header>

            <div className="mx-auto max-w-7xl px-6 py-10">
                <div className="mb-8 max-w-2xl">
                    <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.2em] text-[#d4f939]">
                        Price list
                    </p>
                    <h1 className="mb-3 text-3xl font-bold tracking-tight sm:text-4xl">
                        What every model costs
                    </h1>
                    <p className="text-sm leading-relaxed text-white/50">
                        Search and filter the full catalog. Video and image models are
                        priced per call; text models per million tokens — so the chart
                        compares within a type, never across.
                    </p>
                </div>

                <ModelPricingTable />
            </div>
        </main>
    );
}
