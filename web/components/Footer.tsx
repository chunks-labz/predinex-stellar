import Link from "next/link";

export default function Footer() {
    return (
        <footer className="py-12 border-t border-white/10 glass-panel !rounded-none !border-x-0 !border-b-0">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="flex flex-col md:flex-row justify-between items-center gap-8">
                    <Link href="/" className="flex items-center gap-2 group">
                        <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center group-hover:scale-110 transition-transform text-white font-bold">P</div>
                        <span className="font-bold text-xl tracking-tight gradient-text">Predinex</span>
                    </Link>

                    <div className="flex gap-8 text-sm text-muted-foreground">
                        <Link href="/markets" className="hover:text-primary transition-colors">Markets</Link>
                        <Link href="/create" className="hover:text-primary transition-colors">Create</Link>
                        <Link href="/about" className="hover:text-primary transition-colors">About</Link>
                        <Link href="/docs" className="hover:text-primary transition-colors">Documentation</Link>
                    </div>

                    <p className="text-sm text-muted-foreground">
                        © 2026 Predinex Protocol. Built on Stellar.
                    </p>
                </div>
            </div>
        </footer>
    );
}
