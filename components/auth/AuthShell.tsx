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
    <main className="min-h-[100dvh] w-full overflow-x-hidden bg-[#FFF7F8] text-[#111111]">
      <div className="mx-auto grid min-h-[100dvh] w-full max-w-[1440px] lg:grid-cols-[minmax(0,1.05fr)_minmax(420px,.95fr)]">
        <section className="relative hidden overflow-hidden bg-[#FFB6C1] p-8 text-[#111111] lg:flex lg:flex-col lg:justify-between lg:p-10 xl:p-14">
          <div className="pointer-events-none absolute -right-28 -top-28 h-80 w-80 rounded-full border-[48px] border-white/25" />
          <div className="pointer-events-none absolute -bottom-36 -left-24 h-[28rem] w-[28rem] rounded-full border-[64px] border-[#E5798F]/30" />

          <div className="relative z-10">
            <Link href="/" className="inline-flex items-center gap-2 text-base font-bold tracking-[-0.01em] sm:text-lg">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-black text-[#FFB6C1]">e</span>
              <span>enotes</span>
            </Link>
          </div>

          <div className="relative z-10 max-w-xl pb-8">
            <div className="mb-5 inline-flex items-center rounded-full border border-black/10 bg-white/60 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-black/80">
              Your digital journal
            </div>
            <h2 className="max-w-lg font-serif text-5xl font-bold leading-[1.02] tracking-[-0.04em] xl:text-6xl">
              {asideTitle}
            </h2>
            <p className="mt-6 max-w-md text-[15px] leading-7 text-black/75">{asideDescription}</p>
          </div>

          <p className="relative z-10 text-xs text-black/65">A private space for your everyday memories.</p>
        </section>

        <section className="flex min-h-[100dvh] w-full items-start justify-center px-3 py-4 sm:px-6 sm:py-8 md:items-center lg:px-10 xl:px-16">
          <div className="w-full max-w-[480px] min-w-0">
            <div className="mb-4 flex items-center justify-between gap-3 lg:hidden sm:mb-6">
              <Link href="/" className="inline-flex min-w-0 items-center gap-2 text-[17px] font-bold tracking-[-0.015em]">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-black text-[#FFB6C1]">e</span>
                <span>enotes</span>
              </Link>
              <span className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.14em] text-black/50">{eyebrow}</span>
            </div>

            <div className="w-full rounded-[22px] border border-black/[0.07] bg-white p-4 shadow-[0_18px_55px_rgba(17,17,17,0.09)] sm:rounded-[28px] sm:p-7 md:p-8">
              <div className="mb-6 sm:mb-7">
                <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.17em] text-[#1E90FF]">{eyebrow}</p>
                <h1 className="font-serif text-[28px] font-bold leading-[1.08] tracking-[-0.035em] sm:text-[32px]">
                  {title}
                </h1>
                <p className="mt-2 max-w-[42ch] text-[13px] leading-5 text-black/60 sm:text-sm sm:leading-6">
                  {description}
                </p>
              </div>
              <div className="min-w-0">{children}</div>
            </div>

            {footer && <div className="mt-4 px-1 text-center sm:mt-5">{footer}</div>}
          </div>
        </section>
      </div>
    </main>
  );
}
