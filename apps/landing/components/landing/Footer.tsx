"use client";

import Image from "next/image";
import { Github, Twitter } from "lucide-react";

const links = {
  Product: [
    { label: "Features", href: "#features" },
    { label: "How It Works", href: "#how-it-works" },
    { label: "Browser Dashboard", href: "https://github.com/21lakshh/Liveflow/releases" },
    { label: "GitHub", href: "https://github.com/21lakshh/Liveflow" },
  ],
  Resources: [
    { label: "PyPI Package", href: "https://pypi.org/project/liveflow/" },
  ],
};

export default function Footer() {
  return (
    <footer className="relative z-10">
      <div className="max-w-7xl mx-auto px-6 py-14 flex flex-col md:flex-row justify-between gap-12 md:gap-0">

        {/* Left: brand */}
        <div className="flex flex-col gap-6 max-w-xs">
          <div className="flex items-center gap-2">
            <Image src="/liveflow.png" alt="Liveflow" width={20} height={20} className="rounded-sm" />
            <span className="text-sm font-semibold tracking-tight">Liveflow</span>
          </div>

          <p className="text-sm text-muted-foreground leading-relaxed">
            Real-time visibility into your LiveKit agents —<br />
            built for developers who need to see inside the loop.
          </p>

          <div className="flex items-center gap-4">
            <a
              href="https://github.com/21lakshh/Liveflow"
              aria-label="GitHub"
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <Github size={16} />
            </a>
            <a
              href="https://x.com/lakshh__"
              aria-label="Twitter"
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <Twitter size={16} />
            </a>
          </div>
        </div>

        {/* Right: link columns */}
        <div className="grid grid-cols-2 gap-10 md:gap-16">
          {Object.entries(links).map(([group, items]) => (
            <div key={group} className="flex flex-col gap-3">
              <h3 className="text-[11px] font-mono uppercase tracking-widest text-primary">{group}</h3>
              <div className="flex flex-col gap-2">
                {items.map((item) => (
                  <a
                    key={item.label}
                    href={item.href}
                    className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {item.label}
                  </a>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Bottom bar */}
      <div className="px-6 py-4 max-w-7xl mx-auto flex flex-col sm:flex-row justify-between items-center gap-2 text-[11px] text-muted-foreground font-mono">
        <span>© 2026 Liveflow. Open source developer tooling.</span>
      </div>
    </footer>
  );
}
