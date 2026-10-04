'use client';

import React from 'react';
import Link from 'next/link';

type AuthShellProps = {
  eyebrow?: string;
  title: string;
  description: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  asideTitle?: string;
  asideDescription?: string;
};

export default function AuthShell({
  eyebrow = 'enotes',
  title,
  description,
  children,
  footer,
  asideTitle = 'Your stories deserve a place that feels like yours.',
  asideDescription = 'Write, collect, create, and keep the moments that matter — all in one calm digital space.',
}: AuthShellProps) {
  return (
    <main className="min-h-[100dvh] w-full overflow-x-hidden bg-[#FFF7F8] text-[#111]">
      <div className="mx-auto grid min-h-[100dvh] w-full max-w-[1440px] lg:grid-cols-[minmax(0,1.06fr)_minmax(420px,.94fr)]">
        <section className="relative hidden overflow-hidden bg-[#FFB6C1] p-8 text-[#111] lg:flex lg:flex-col lg:justify-between lg:p-10 xl:p-14">
          <div className="pointer-events-none absolute -right-28 -top-28 h-80 w-80 rounded-full border-[48px] border-white/25" />
          <div className="pointer-events-none absolute -bottom-36 -left-24 h-[28rem] w-[28rem] rounded-full border-[64px] border-[#E5798F]/30" />

          <Link href="/" className="relative z-10 inline-flex w-fit items-center gap-2 text-[17px] font-bold tracking-[-0.02em]">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-black text-[19px] leading-none text-[#FFB6C1]">e</span>
            <span>enotes</span>
          </Link>

          <div className="relative z-10 max-w-xl pb-8">
            <div className="mb-5 inline-flex items-center rounded-full border border-black/10 bg-white/60 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.17em] text-black/75">
              Your digital journal
            </div>
            <h2 className="max-w-lg font-serif text-[44px] font-bold leading-[1.04] tracking-[-0.04em] xl:text-[56px]">
              {asideTitle}
            </h2>
            <p className="mt-5 max-w-md text-[15px] leading-7 text-black/70">{asideDescription}</p>
          </div>

          <p className="relative z-10 text-[11px] font-medium tracking-[0.01em] text-black/55">
            A private space for your everyday memories.
          </p>
        </section>

        <section className="flex min-h-[100dvh] w-full items-start justify-center px-3 py-4 sm:px-6 sm:py-8 md:items-center lg:px-10 xl:px-16">
          <div className="w-full max-w-[500px] min-w-0">
            <div className="mb-4 flex items-center justify-between gap-3 px-1 sm:mb-6 lg:hidden">
              <Link href="/" className="inline-flex min-w-0 items-center gap-2 text-[16px] font-bold tracking-[-0.02em]">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-black text-[19px] leading-none text-[#FFB6C1]">e</span>
                <span>enotes</span>
              </Link>
              <span className="shrink-0 rounded-full bg-black/[0.045] px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.14em] text-black/50">
                {eyebrow}
              </span>
            </div>

            <div className="w-full rounded-[24px] border border-black/[0.065] bg-white px-4 py-5 shadow-[0_20px_60px_rgba(17,17,17,0.08)] sm:rounded-[28px] sm:px-8 sm:py-8">
              <div className="mb-6 sm:mb-7">
                <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-[#1E90FF]">{eyebrow}</p>
                <h1 className="font-[cursive] text-[30px] font-bold leading-[1.08] tracking-[-0.02em] sm:text-[34px]">
                  {title}
                </h1>
                <p className="mt-2.5 max-w-[43ch] text-[13px] leading-[1.55] text-black/55 sm:text-[14px]">
                  {description}
                </p>
              </div>

              <div className="min-w-0">{children}</div>
            </div>

            {footer && <div className="mt-4 px-2 text-center sm:mt-5">{footer}</div>}
          </div>
        </section>
      </div>
    </main>
  );
}
