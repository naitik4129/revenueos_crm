import type { ReactNode } from "react";
import { BrandLogo } from "@/components/common/brand-logo";

const CONTACT_EMAIL = "govinda@motm.tech";
const EFFECTIVE_DATE = "October 3, 2026";

/**
 * Public privacy policy, served without authentication at /privacy (the root
 * AuthGate in routes/__root.tsx deliberately skips this path). Google's OAuth
 * consent-screen verification requires a publicly reachable privacy policy
 * URL on the app's authorised domain. Keep in sync with /PRIVACY_POLICY.md.
 */
export function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-4">
          <BrandLogo variant="mark" />
          <span className="text-sm font-semibold">MOTM Flow</span>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-8 px-4 py-10 text-sm leading-relaxed">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Privacy Policy</h1>
          <p className="mt-2 text-muted-foreground">
            MOTM KAM Portal (MOTM Flow) · Effective {EFFECTIVE_DATE} · Last updated {EFFECTIVE_DATE}
          </p>
        </div>

        <p>
          This Privacy Policy explains how MOTM Technologies ("<strong>we</strong>", "
          <strong>us</strong>", "<strong>our</strong>") collects, uses, stores, and protects
          information when you use MOTM KAM Portal, also known as MOTM Flow (the "
          <strong>Service</strong>"), a lead management and sales automation tool. It also explains
          what happens when you connect your Google account to the Service.
        </p>
        <p>
          If you have questions about this policy, contact us at{" "}
          <a className="underline" href={`mailto:${CONTACT_EMAIL}`}>
            {CONTACT_EMAIL}
          </a>
          .
        </p>

        <Section title="1. Information we collect">
          <H3>1.1 Account information</H3>
          <p>
            When you sign in, we collect your name, email address, and role in the Service.
            Authentication is handled through our authentication provider, Supabase.
          </p>
          <H3>1.2 Business and lead data you enter</H3>
          <p>
            The Service is used to manage sales leads. You and your team may enter or import
            information about your prospects and customers, such as names, company names, email
            addresses, phone numbers, notes, tasks, meetings, proposals, and message history. You
            are responsible for having the right to store and contact these people.
          </p>
          <H3>1.3 Messaging and email data</H3>
          <p>
            If you connect email or WhatsApp, we process the messages sent through those channels,
            along with delivery status, so the Service can run your automations and show
            conversation history.
          </p>
          <H3>1.4 Google account and Google Calendar data</H3>
          <p>
            This applies only if you choose to connect Google Calendar. See Section 3 for full
            details.
          </p>
          <H3>1.5 Technical data</H3>
          <p>
            We may collect basic technical information such as error logs and request metadata to
            keep the Service secure and working.
          </p>
        </Section>

        <Section title="2. How we use information">
          <p>We use the information above to:</p>
          <ul className="list-disc space-y-1 pl-6">
            <li>
              Provide and operate the Service, including scheduling meetings, sending follow-ups,
              and running your automations.
            </li>
            <li>Authenticate you and keep your workspace secure.</li>
            <li>Diagnose problems, prevent abuse, and improve reliability.</li>
            <li>Communicate with you about the Service.</li>
          </ul>
          <p>
            We do <strong>not</strong> sell your personal information, and we do{" "}
            <strong>not</strong> use your data for advertising.
          </p>
        </Section>

        <Section title="3. Google user data">
          <H3>3.1 What you are asked to allow</H3>
          <p>
            When you click <strong>Connect Google Calendar</strong>, Google asks you to approve the
            following permissions:
          </p>
          <div className="overflow-x-auto">
            <table className="w-full border text-left">
              <thead className="bg-muted/50">
                <tr>
                  <th className="border px-3 py-2 font-semibold">Permission (scope)</th>
                  <th className="border px-3 py-2 font-semibold">Why we request it</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="border px-3 py-2 font-mono text-xs break-all">
                    https://www.googleapis.com/auth/calendar.events
                  </td>
                  <td className="border px-3 py-2">
                    To create, update, and delete calendar events (including a Google Meet link) for
                    meetings you schedule inside the Service.
                  </td>
                </tr>
                <tr>
                  <td className="border px-3 py-2 font-mono text-xs break-all">
                    https://www.googleapis.com/auth/userinfo.email
                  </td>
                  <td className="border px-3 py-2">
                    To show you which Google account is connected.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <H3>3.2 What we do with Google Calendar access</H3>
          <p>When you schedule, reschedule, or cancel a meeting in the Service, we:</p>
          <ul className="list-disc space-y-1 pl-6">
            <li>
              <strong>Create</strong> a calendar event on your connected calendar, with a Google
              Meet link, and invite the lead and any participants you added.
            </li>
            <li>
              <strong>Update</strong> that event if you reschedule the meeting.
            </li>
            <li>
              <strong>Delete</strong> that event if you cancel the meeting.
            </li>
          </ul>
          <p>
            We only act on events that the Service itself creates for meetings you schedule in it.
            We do not browse, copy, or analyze your other calendar events.
          </p>
          <H3>3.3 What we store</H3>
          <ul className="list-disc space-y-1 pl-6">
            <li>
              The <strong>email address</strong> of the connected Google account, to display in
              Settings.
            </li>
            <li>
              A <strong>refresh token</strong>, which lets the Service create and update events on
              your behalf without asking you to sign in each time. It is stored{" "}
              <strong>encrypted</strong> in our database.
            </li>
            <li>
              The <strong>event ID and Meet link</strong> of events we create, so we can update or
              cancel them later.
            </li>
          </ul>
          <p>We do not store your Google password.</p>
          <H3>3.4 Limited Use disclosure</H3>
          <p>
            MOTM Flow's use and transfer to any other app of information received from Google APIs
            will adhere to the{" "}
            <a
              className="underline"
              href="https://developers.google.com/terms/api-services-user-data-policy"
              target="_blank"
              rel="noreferrer"
            >
              Google API Services User Data Policy
            </a>
            , including the <strong>Limited Use</strong> requirements. Specifically:
          </p>
          <ul className="list-disc space-y-1 pl-6">
            <li>
              We use Google user data only to provide and improve the user-facing calendar features
              described above.
            </li>
            <li>
              We do not transfer Google user data to others except as needed to provide those
              features, to comply with applicable law, or as part of a merger or sale of assets with
              notice to you.
            </li>
            <li>We do not use Google user data for serving advertisements.</li>
            <li>
              We do not allow humans to read your Google user data unless we have your affirmative
              consent for specific data, it is necessary for security purposes (for example,
              investigating abuse), to comply with applicable law, or the data is aggregated and
              anonymized for internal operations.
            </li>
            <li>
              We do not use Google user data to develop, improve, or train generalized AI or machine
              learning models.
            </li>
          </ul>
          <H3>3.5 Disconnecting and revoking access</H3>
          <p>
            You can disconnect Google Calendar at any time from{" "}
            <strong>Settings → Google Calendar → Disconnect</strong>. When you do, we delete the
            stored refresh token and connected email from our database, and the Service can no
            longer access your calendar.
          </p>
          <p>
            You can also revoke the Service's access directly from your Google Account at{" "}
            <a
              className="underline"
              href="https://myaccount.google.com/permissions"
              target="_blank"
              rel="noreferrer"
            >
              myaccount.google.com/permissions
            </a>
            . If access is revoked this way, the Service will notice on its next attempt and ask you
            to reconnect.
          </p>
          <p>Events already created on your calendar remain there unless you delete them.</p>
        </Section>

        <Section title="4. How we share information">
          <p>We share information only in these limited cases:</p>
          <ul className="list-disc space-y-1 pl-6">
            <li>
              <strong>Service providers</strong> that help us run the Service, acting on our
              instructions. These include our database and authentication provider (Supabase), our
              hosting provider, and the email and messaging providers you choose to connect (for
              example, Resend, your SMTP provider, or WhatsApp).
            </li>
            <li>
              <strong>Google</strong>, when the Service calls Google Calendar on your behalf as
              described in Section 3.
            </li>
            <li>
              <strong>Legal reasons</strong>, if required by law or to protect the rights, safety,
              and security of our users or the Service.
            </li>
            <li>
              <strong>Business transfers</strong>, if we are involved in a merger, acquisition, or
              sale of assets, in which case we will notify you.
            </li>
          </ul>
          <p>We do not sell personal information.</p>
        </Section>

        <Section title="5. Data security">
          <p>We take reasonable measures to protect your information, including:</p>
          <ul className="list-disc space-y-1 pl-6">
            <li>
              Encrypting sensitive credentials, such as Google refresh tokens and provider secrets,
              before storing them in the database.
            </li>
            <li>Encrypting data in transit using HTTPS.</li>
            <li>Restricting access to data by user and workspace.</li>
          </ul>
          <p>
            No system is perfectly secure, and we cannot guarantee absolute security. If we become
            aware of a breach affecting your data, we will notify you as required by law.
          </p>
        </Section>

        <Section title="6. Data retention and deletion">
          <p>
            We keep your information for as long as your account is active or as needed to provide
            the Service. Google Calendar credentials are deleted when you disconnect (Section 3.5).
          </p>
          <p>
            To request deletion of your account or your data, email{" "}
            <a className="underline" href={`mailto:${CONTACT_EMAIL}`}>
              {CONTACT_EMAIL}
            </a>{" "}
            from your account email address. We will respond within a reasonable time and delete the
            data we are not legally required to keep.
          </p>
        </Section>

        <Section title="7. Your rights and choices">
          <p>
            Depending on where you live, you may have the right to access, correct, export, or
            delete your personal information, and to object to or restrict certain processing. To
            exercise these rights, contact us at{" "}
            <a className="underline" href={`mailto:${CONTACT_EMAIL}`}>
              {CONTACT_EMAIL}
            </a>
            .
          </p>
          <p>
            If you entered information about other people (such as leads) into the Service, you are
            responsible for responding to their requests and for having a lawful basis to store and
            contact them.
          </p>
        </Section>

        <Section title="8. Children's privacy">
          <p>
            The Service is intended for business use and is not directed to children under 16. We do
            not knowingly collect personal information from children.
          </p>
        </Section>

        <Section title="9. International data transfers">
          <p>
            Our providers may process data in countries other than your own. Where required, we take
            steps to ensure appropriate safeguards are in place.
          </p>
        </Section>

        <Section title="10. Changes to this policy">
          <p>
            We may update this Privacy Policy from time to time. We will post the updated version on
            this page and change the "Last updated" date. If changes are significant, we will give
            additional notice, for example by email or inside the Service.
          </p>
        </Section>

        <Section title="11. Contact us">
          <p>
            MOTM Technologies
            <br />
            Email:{" "}
            <a className="underline" href={`mailto:${CONTACT_EMAIL}`}>
              {CONTACT_EMAIL}
            </a>
            <br />
            Website:{" "}
            <a className="underline" href="https://b2botix.ai" target="_blank" rel="noreferrer">
              https://b2botix.ai
            </a>
          </p>
        </Section>
      </main>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="border-t pt-6 text-xl font-semibold tracking-tight">{title}</h2>
      {children}
    </section>
  );
}

function H3({ children }: { children: ReactNode }) {
  return <h3 className="pt-1 font-semibold">{children}</h3>;
}
