"use client";

import { motion, useInView } from "framer-motion";
import { useRef, useState } from "react";
import { Copy, Check, Download, ExternalLink } from "lucide-react";

function CommandBlock({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="mt-4 flex items-center justify-between gap-3 rounded-md border border-border bg-[#080e0b] px-4 py-2.5 font-mono text-sm">
      <span className="text-primary select-all">{command}</span>
      <button
        onClick={copy}
        className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
        aria-label="Copy command"
      >
        {copied ? <Check size={14} className="text-primary" /> : <Copy size={14} />}
      </button>
    </div>
  );
}

const steps = [
  {
    num: "01",
    title: "Install Liveflow",
    desc: "Add the Python package to your environment.",
    command: "pip install liveflow",
  },
  {
    num: "02",
    title: "Run Your Agent",
    desc: "Drop-in replacement for your normal run command. Your browser dashboard opens automatically.",
    command: "liveflow agent.py dev",
  },
  {
    num: "03",
    title: "Download Standalone App",
    desc: "Get Liveflow as a single-file executable. Your agent still uses its own Python environment.",
    isButton: true,
    buttonHref: "https://github.com/21lakshh/Liveflow/releases",
    buttonLabel: "Get Liveflow",
    buttonIcon: Download,
  },
];

const HowItWorks = () => {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-80px" });

  return (
    <section ref={ref} id="how-it-works" className="relative py-32 px-6">
      <div className="max-w-2xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.5 }}
          className="mb-16"
        >
          <p className="text-xs font-mono text-primary uppercase tracking-widest mb-3">Setup</p>
          <h2 className="text-3xl sm:text-4xl font-semibold tracking-tight">
            Get running in three steps
          </h2>
        </motion.div>

        {/* Tree */}
        <div className="relative">
          {/* Vertical line */}
          <div className="absolute left-[11px] top-2 bottom-2 w-px bg-border" />

          <div className="space-y-10">
            {steps.map((step, i) => (
              <motion.div
                key={step.num}
                initial={{ opacity: 0, x: -16 }}
                animate={isInView ? { opacity: 1, x: 0 } : {}}
                transition={{ duration: 0.45, delay: 0.12 * i }}
                className="relative pl-9"
              >
                {/* Node dot */}
                <div className="absolute left-0 top-1 w-[23px] h-[23px] rounded-full border border-primary bg-background flex items-center justify-center">
                  <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                </div>

                <div>
                  <span className="text-[11px] font-mono text-primary tracking-widest">{step.num}</span>
                  <h3 className="mt-0.5 text-base font-semibold text-foreground">{step.title}</h3>
                  <p className="mt-1 text-sm text-muted-foreground leading-relaxed">{step.desc}</p>

                  {step.command && <CommandBlock command={step.command} />}

                  {step.isButton && step.buttonIcon && (
                    <div className="mt-4">
                      <a
                        href={step.buttonHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2.5 rounded-md border border-border bg-surface px-4 py-2.5 text-sm font-medium text-foreground transition-all hover:border-primary hover:text-primary"
                      >
                        <step.buttonIcon size={15} className="text-primary" />
                        {step.buttonLabel}
                        <ExternalLink size={12} className="text-muted-foreground" />
                      </a>
                    </div>
                  )}
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};

export default HowItWorks;
