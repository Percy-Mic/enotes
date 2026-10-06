'use client';

import React from 'react';
import Link from 'next/link';
import AuthThemeSelector from '@/components/auth/AuthThemeSelector';

type AuthShellProps = {
  eyebrow?: string;
  title: string;
  description: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  asideTitle?: string;
  asideDescription?: string;
  showThemeSelector?: boolean;
};

export default function AuthShell({
  eyebrow = 'enotes',
  title,
  description,
  children,
  footer,
  asideTitle = 'Your stories deserve a place that feels like yours.',
  asideDescription = 'Write, collect, create, and keep the moments that matter — all in one calm digital space.',
  showThemeSelector = false,
}: AuthShellProps) {
  return (
    <main className="auth-page min-h-[100dvh] w-full overflow-x-hidden">
      <div className="mx-auto grid min-h-[100dvh] w-full max-w-[1440px] grid-cols-1 lg:grid-cols-[minmax(0,1.06fr)_minmax(420px,.94fr)]">
        <section className="auth-brand-panel relative hidden overflow-hidden p-8 lg:flex lg:flex-col lg:justify-between lg:p-10 xl:p-14">
          <div className="pointer-events-none absolute -right-28 -top-28 h-80 w-80 rounded-full border-[48px] border-white/25" />
          <div className="pointer-events-none absolute -bottom-36 -left-24 h-[28rem] w-[28rem] rounded-full border-[64px] auth-brand-ring" />

          <div className="relative z-10 flex items-center justify-between gap-4">
            <Link href="/" className="inline-flex w-fit items-center gap-2 text-[17px] font-bold tracking-[-0.02em]">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-[var(--auth-primary-bg)] text-[19px] leading-none text-[var(--auth-primary-ink)]">e</span>
              <span>enotes</span>
            </Link>
            {showThemeSelector && <AuthThemeSelector />}
          </div>

          <div className="relative z-10 max-w-xl pb-8">
            <div className="mb-5 inline-flex items-center rounded-full auth-brand-soft border px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.17em] auth-ink">
              Your digital journal
            </div>
            <h2 className="max-w-lg font-serif text-[44px] font-bold leading-[1.04] tracking-[-0.04em] xl:text-[56px]">
              {asideTitle}
            </h2>
            <p className="mt-5 max-w-md text-[15px] leading-7 auth-muted">{asideDescription}</p>
          </div>

          <p className="relative z-10 text-[11px] font-medium tracking-[0.01em] auth-subtle">
            A private space for your everyday memories.
          </p>
        </section>

        <section className="flex min-h-[100dvh] w-screen max-w-none items-center justify-center justify-self-center px-3 py-4 sm:px-6 sm:py-8 lg:w-full lg:max-w-none lg:px-10 xl:px-16">
          <div className="mx-auto w-full max-w-[500px] min-w-0">
            <div className="mb-4 flex items-center justify-between gap-3 px-1 sm:mb-6 lg:hidden">
              <Link href="/" className="inline-flex min-w-0 items-center gap-2 text-[16px] font-bold tracking-[-0.02em]">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[var(--auth-primary-bg)] text-[19px] leading-none text-[var(--auth-primary-ink)]">e</span>
                <span>enotes</span>
              </Link>
              <div className="flex shrink-0 items-center gap-2">
                <span className="rounded-full auth-brand-soft px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.14em] auth-subtle">
                  {eyebrow}
                </span>
                {showThemeSelector && <AuthThemeSelector />}
              </div>
            </div>

            <div className="auth-surface auth-border w-full rounded-[24px] border px-4 py-5 shadow-[0_20px_60px_rgba(17,17,17,0.08)] sm:rounded-[28px] sm:px-8 sm:py-8">
              <div className="mb-6 sm:mb-7">
                <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] auth-accent">{eyebrow}</p>
                <h1 className="font-[cursive] text-[30px] font-bold leading-[1.08] tracking-[-0.02em] sm:text-[34px]">
                  {title}
                </h1>
                <p className="mt-2.5 max-w-[43ch] text-[13px] leading-[1.55] auth-muted sm:text-[14px]">
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
