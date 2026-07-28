import Navbar from '@/components/Navbar';
import Hero from "./components/Hero";
import { TrendingUp } from "lucide-react";
import Link from "next/link";
import FeaturedMarkets from "./components/FeaturedMarkets";

export default function Home() {
  return (
    <main className="min-h-screen bg-background text-foreground selection:bg-primary/20 animate-in fade-in duration-700">
      <Navbar />
      <Hero />

      {/* Featured Pools */}
      <section className="py-24 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col md:flex-row justify-between items-end mb-12 gap-4">
          <div>
            <h2 className="text-3xl md:text-4xl font-extrabold mb-4 tracking-tight">
              Featured <span className="gradient-text">Markets</span>
            </h2>
            <p className="text-muted-foreground max-w-lg">
              The most active prediction markets on the protocol. Analyze the data and place your bets.
            </p>
          </div>
          <Link
            href="/markets"
            className="group flex items-center gap-2 text-primary hover:text-primary/80 transition-colors font-semibold"
          >
            View All Markets
            <TrendingUp size={18} className="group-hover:translate-x-1 group-hover:-translate-y-1 transition-transform" />
          </Link>
        </div>

        <FeaturedMarkets />

        {/* Call to Action */}
        <div className="text-center mt-20 p-12 glass-panel">
          <h3 className="text-2xl font-bold mb-4">Don&apos;t see a market you&apos;re looking for?</h3>
          <p className="text-muted-foreground mb-8 max-w-xl mx-auto">
            You can create your own prediction market on any event using our community-driven protocol.
          </p>
          <Link
            href="/create"
            className="btn-primary"
          >
            Create Your Own Market
          </Link>
        </div>
      </section>
    </main>
  );
}
