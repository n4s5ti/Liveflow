import { motion, useInView } from "framer-motion";
import { useRef } from "react";

const FinalCTA = () => {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-80px" });

  return (
    <section ref={ref} className="relative overflow-hidden py-40 px-6">

      {/* Semi-circle glow at top */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 -translate-x-1/2 -top-40 w-[700px] h-[380px] rounded-[50%]"
        style={{
          background:
            "radial-gradient(ellipse at 50% 0%, hsl(145 65% 52% / 0.22) 0%, hsl(145 65% 52% / 0.07) 55%, transparent 75%)",
          filter: "blur(1px)",
        }}
      />
      {/* Thin arc border */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 -translate-x-1/2 -top-40 w-[700px] h-[380px] rounded-[50%]"
        style={{
          boxShadow: "inset 0 1px 0 0 hsl(145 65% 52% / 0.35)",
        }}
      />

      <div className="relative max-w-3xl mx-auto text-center">
        <motion.h2
          initial={{ opacity: 0, y: 30 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.7 }}
          className="text-5xl sm:text-6xl md:text-7xl font-semibold tracking-tight leading-[1.1] mb-6"
        >
          Agent debugging,{" "}
          <br className="hidden sm:block" />
          finally visible.
        </motion.h2>

        <motion.p
          initial={{ opacity: 0 }}
          animate={isInView ? { opacity: 1 } : {}}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="text-muted-foreground text-base mb-10 max-w-md mx-auto leading-relaxed"
        >
          See every tool call, state transition, and conversation turn as it happens. Free and open source.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.5, delay: 0.3 }}
        >
          <a
            href="https://github.com/21lakshh/Liveflow/releases"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block px-8 py-3.5 rounded-full bg-foreground text-background font-semibold text-sm transition-all duration-300 hover:shadow-[0_0_40px_rgba(52,211,103,0.25)] hover:scale-[1.03]"
          >
            Download Liveflow
          </a>
        </motion.div>
      </div>
    </section>
  );
};

export default FinalCTA;

