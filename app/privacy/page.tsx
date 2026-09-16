import type { Metadata } from 'next';
import Link from 'next/link';
import { SITE } from '@/lib/site';

export const metadata: Metadata = {
  title: `Privacy Policy — ${SITE.name}`,
  description: `How ${SITE.name} collects, uses, and protects your data.`,
};

export default function PrivacyPage() {
  return (
    <main className="min-h-[100dvh] bg-[#FFF7F8] px-4 py-8 text-[#111111] sm:px-6">
      <div className="mx-auto max-w-2xl">
        <h1 className="text-3xl font-bold tracking-tight">Privacy Policy</h1>
        <p className="mt-1 text-sm text-[#6B6B6B]">Last updated: {SITE.legalUpdated}</p>

        <div className="mt-6 space-y-6 rounded-2xl border border-[#E8E2E4] bg-white p-5 text-sm leading-relaxed shadow-sm sm:p-7">
          <section>
            <h2 className="text-lg font-bold">1. Who we are</h2>
            <p className="mt-2 text-[#3D3D3D]">
              {SITE.operator} (&ldquo;{SITE.name}&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;) operates a
              journaling and social platform where users write personal journals, share posts and
              stories, and message each other. You can reach us at{' '}
              <a className="font-semibold text-[#E5798F] underline" href={`mailto:${SITE.contactEmail}`}>
                {SITE.contactEmail}
              </a>
              .
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold">2. What we collect</h2>
            <ul className="mt-2 list-disc space-y-1.5 pl-5 text-[#3D3D3D]">
              <li><b>Account data:</b> email address, display name, username, and profile photo you choose.</li>
              <li><b>Content you create:</b> journals, pages, posts, stories, comments, chat messages, and media you upload.</li>
              <li><b>Activity data:</b> likes, comments, follows, and story views, plus when you last read notifications or messages.</li>
              <li><b>Technical data:</b> IP address, device and browser information, and usage logs needed to run and secure the service.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-bold">3. What we do <em>not</em> do</h2>
            <p className="mt-2 text-[#3D3D3D]">
              We do not sell your personal data. We do not use your private journals to advertise to
              you. We do not read or index the content of private journals for anyone other than you
              and the people you explicitly share them with.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold">4. How your content is shared</h2>
            <ul className="mt-2 list-disc space-y-1.5 pl-5 text-[#3D3D3D]">
              <li><b>Private journals</b> are visible only to you, unless you share a page, share the journal with a specific person, or set its visibility to public or link-only.</li>
              <li><b>Posts and stories</b> are visible according to the audience you pick (public or followers-only).</li>
              <li><b>Direct messages</b> are visible only to conversation members.</li>
              <li><b>Locked pages</b> are protected by a PIN verified on our servers.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-bold">5. Service providers</h2>
            <p className="mt-2 text-[#3D3D3D]">
              We run the service on Supabase (database, authentication, file storage) and Vercel or a
              similar hosting provider. These providers process data on our behalf under their own
              privacy and security terms.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold">6. How long we keep things</h2>
            <p className="mt-2 text-[#3D3D3D]">
              Stories automatically expire and become invisible 24 hours after posting. We keep your
              content until you delete it or delete your account. When you delete your account, we
              delete your profile, posts, stories, messages, journals, and pages.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold">7. Your rights</h2>
            <p className="mt-2 text-[#3D3D3D]">
              Wherever you live, you can: access and export your data, correct it in your profile
              settings, delete individual posts or journals at any time, and delete your whole
              account from Settings → Profile → Danger zone. If you are in the EEA or UK, you may
              also object to or restrict certain processing, and lodge a complaint with your local
              data protection authority. California residents may request disclosure of the personal
              information we collect. To exercise any right, email{' '}
              <a className="font-semibold text-[#E5798F] underline" href={`mailto:${SITE.contactEmail}`}>
                {SITE.contactEmail}
              </a>
              .
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold">8. Children</h2>
            <p className="mt-2 text-[#3D3D3D]">
              {SITE.name} is not directed at children under 13 (or 16 in the EEA). We do not knowingly
              collect data from children. If you believe a child is using the service, contact us and
              we will remove the account.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold">9. Security</h2>
            <p className="mt-2 text-[#3D3D3D]">
              We use transport encryption (HTTPS), database-level access rules, and hashed page-lock
              PINs. No service is perfectly secure; please use a strong, unique password and tell us
              immediately about anything suspicious.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold">10. Changes to this policy</h2>
            <p className="mt-2 text-[#3D3D3D]">
              If we change this policy materially, we will notify you in the app or by email before
              the change takes effect. The &ldquo;last updated&rdquo; date above always shows the
              current version.
            </p>
          </section>
        </div>

        <p className="mt-6 text-center text-sm text-[#6B6B6B]">
          <Link href="/" className="font-semibold underline">← Back to {SITE.name}</Link>
          <span className="mx-2">·</span>
          <Link href="/terms" className="font-semibold underline">Terms of Service</Link>
          <span className="mx-2">·</span>
          <Link href="/contact" className="font-semibold underline">Contact</Link>
        </p>
      </div>
    </main>
  );
}
