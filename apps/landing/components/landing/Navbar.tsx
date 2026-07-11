import { motion } from "framer-motion";
import Link from "next/link";
import Image from "next/image";
import { Github } from "lucide-react";

const Navbar = () => {
  return (
    <motion.nav
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="fixed top-0 left-0 right-0 z-50 border-b border-border/40 bg-background/75 backdrop-blur-md"
    >
      <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">

        {/* Brand */}
        <Link href="/" className="flex items-center gap-2.5 group">
          <Image
            src="/liveflow.png"
            alt="Liveflow Logo"
            width={22}
            height={22}
            className="rounded-sm opacity-90 group-hover:opacity-100 transition-opacity"
          />
          <span className="font-semibold text-sm tracking-tight text-foreground">Liveflow</span>
        </Link>

        {/* Nav links */}
        <div className="hidden sm:flex items-center gap-7 text-sm text-muted-foreground">
          <a href="#features" className="hover:text-foreground transition-colors">Features</a>
          <a href="#how-it-works" className="hover:text-foreground transition-colors">How It Works</a>
          <a
            href="https://github.com/21lakshh/Liveflow"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 hover:text-foreground transition-colors"
          >
            <Github size={14} />
            GitHub
          </a>
        </div>

        {/* CTA */}
        <a
          href="#how-it-works"
          className="flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary text-primary-foreground text-xs font-semibold tracking-tight hover:shadow-[0_0_20px_rgba(52,211,103,0.3)] transition-all duration-300 hover:scale-[1.03]"
        >
          Get Started
        </a>
      </div>
    </motion.nav>
  );
};

export default Navbar;

