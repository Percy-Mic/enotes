import type { Metadata } from 'next';
import Link from 'next/link';
import { Mail, Flag, LifeBuoy } from 'lucide-react';
import { SITE } from '@/lib/site';

export const metadata: Metadata = {
  title: `Contact — ${SITE.name}`,
  description: `Get in touch with the ${SITE.name} team.`,
};

export default function ContactPage() {
  return (
    <main className="min-h-[100dvh] bg-[#FFF7F8] px-4 py-8 text-[#111111] sm:px-6">
      <div className="mx-auto max-w-2xl">
        <h1 className="text-3xl font-bold tracking-tight">Contact us</h1>
        <p className="mt-1 text-sm text-[#6B6B6B]">Real humans, one inbox each.</p>

        <div className="mt-6 space-y-4">
          <a
            href={`mailto:${SITE.contactEmail}`}
            className="flex items-center gap-4 rounded-2xl border border-[#E8E2E4] bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
          >
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#FFF0F3]">
              <Mail className="h-6 w-6 text-[#E5798F]" />
            </span>
            <span>
              <span className="block font-bold">General &amp; support</span>
              <span className="block text-sm text-[#6B6B6B]">
                {SITE.contactEmail} — account help, data requests, appeals, feedback.
              </span>
            </span>
          </a>

          <a
            href={`mailto:${SITE.abuseEmail}`}
            className="flex items-center gap-4 rounded-2xl border border-[#E8E2E4] bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
          >
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#FFF0F3]">
              <Flag className="h-6 w-6 text-[#E5798F]" />
            </span>
            <span>
              <span className="block font-bold">Safety &amp; abuse reports</span>
              <span className="block text-sm text-[#6B6B6B]">
                {SITE.abuseEmail} — report harassment, illegal content, or impersonation. Include links
                and usernames.
              </span>
            </span>
          </a>

          <div className="flex items-center gap-4 rounded-2xl border border-[#E8E2E4] bg-white p-5 shadow-sm">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#FFF0F3]">
              <LifeBuoy className="h-6 w-6 text-[#E5798F]" />
            </span>
            <span>
              <span className="block font-bold">Before writing in</span>
              <span className="block text-sm text-[#6B6B6B]">
                For sign-in problems, try password reset first. To delete your account or data, use
                Settings → Profile → Danger zone — it is instant and does not need an email.
              </span>
            </span>
          </div>
        </div>

        <p className="mt-6 text-center text-xs text-[#9B9B9B]">
          {SITE.operator} · {SITE.tagline}
        </p>

        <p className="mt-4 text-center text-sm text-[#6B6B6B]">
          <Link href="/" className="font-semibold underline">← Back to {SITE.name}</Link>
          <span className="mx-2">·</span>
          <Link href="/privacy" className="font-semibold underline">Privacy Policy</Link>
          <span className="mx-2">·</span>
          <Link href="/terms" className="font-semibold underline">Terms of Service</Link>
        </p>
      </div>
    </main>
  );
}
