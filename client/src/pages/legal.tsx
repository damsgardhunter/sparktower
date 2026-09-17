/**
 * The privacy policy and terms, as pages anyone can open without an account.
 *
 * Both app stores refuse a first submission without a reachable privacy policy
 * URL (Apple's guideline 5.1.1(i), Google's Data safety form), and the
 * reviewer opens it signed out — so these sit in the public half of the router
 * alongside /verify-email, not behind the auth gate.
 *
 * Everything below describes what this code actually does. Each claim was
 * written from the thing that does it: the columns in shared/models/auth.ts,
 * the sweeps in server/retention.ts, the export and delete in
 * server/account-data.ts, and the third parties named in the env contract. A
 * privacy policy assembled from a template is a document that describes
 * somebody else's product, and the first person to notice is a regulator or a
 * store reviewer.
 *
 * It is not legal advice and has not been through a lawyer. It is an accurate
 * description of the system, which is the part a lawyer cannot write for you
 * and the part that makes their review cheap.
 */
import { useEffect } from "react";
import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";

/** Changing this is how people know something changed. Update it when the substance does, not when a typo is fixed. */
const LAST_UPDATED = "17 September 2026";
const CONTACT = "privacy@sparktower.app";

function LegalPage({ title, children }: { title: string; children: React.ReactNode }) {
  useEffect(() => { document.title = `${title} · SparkTower`; }, [title]);
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-2xl px-5 py-10 sm:py-14">
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground" data-testid="link-legal-home">
          <ArrowLeft className="h-4 w-4" /> SparkTower
        </Link>
        <h1 className="mt-6 text-3xl font-bold tracking-tight">{title}</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">Last updated {LAST_UPDATED}</p>
        <div className="mt-8 space-y-7 text-[15px] leading-relaxed [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:mt-8 [&_h2]:mb-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1.5 [&_a]:text-primary [&_a]:underline [&_strong]:font-semibold">
          {children}
        </div>
        <p className="mt-12 border-t border-border pt-6 text-sm text-muted-foreground">
          Questions about any of this: <a href={`mailto:${CONTACT}`} className="text-primary underline">{CONTACT}</a>
        </p>
      </div>
    </div>
  );
}

export function PrivacyPolicy() {
  return (
    <LegalPage title="Privacy policy">
      <p>
        SparkTower is a place to plan, build and share a project. This says what it collects, who else sees it,
        how long it's kept, and how to take it back or delete it. It describes what the software actually does —
        if something here doesn't match what you see, that's a bug and we'd like to know.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li><strong>Your account.</strong> Email address, first and last name, and a profile image if you add one. If you sign in with Google we store the identifier Google gives us, not your Google password. If you sign in with a password we store a bcrypt hash of it, never the password.</li>
        <li><strong>What you put in.</strong> Your profile, projects, posts, comments, messages, uploaded files and anything else you type. Most of it is visible to other people by design — that's what the product is for — and a project marked private is visible only to you and the people you add to it.</li>
        <li><strong>Payment records.</strong> If you subscribe or back a project, Stripe handles the card. We never see or store card numbers. We keep the Stripe customer and subscription identifiers, your plan, and whether a payment failed.</li>
        <li><strong>How the site is used.</strong> Page views and actions, with a visitor identifier, the page address, the referring page and the browser's user-agent string. This is how we know which parts of the product work.</li>
        <li><strong>Sign-in state.</strong> A session cookie in the browser, or a refresh token on a phone. Both identify the session, not you personally.</li>
      </ul>

      <h2>What we do not collect</h2>
      <ul>
        <li>No advertising identifiers, no third-party ad or tracking networks, and nothing is sold to anybody.</li>
        <li>No card numbers, ever — those go to Stripe directly.</li>
        <li>No location beyond what a network address implies, and no contacts, photos or files except the ones you choose to upload.</li>
      </ul>

      <h2>Who else receives it</h2>
      <p>These are the companies that process data to make the product work. Each one gets only what its job needs.</p>
      <ul>
        <li><strong>Render</strong> — runs the servers and the database (Oregon, United States).</li>
        <li><strong>Stripe</strong> — payments and subscriptions.</li>
        <li><strong>Resend</strong> — sends the emails we send you: confirm your address, reset your password, invitations.</li>
        <li><strong>Google Cloud Storage</strong> — stores uploaded images and files.</li>
        <li><strong>Google</strong> — only if you choose to sign in with Google.</li>
        <li><strong>OpenAI</strong> — powers Nova. <strong>When you use an AI feature, the text it needs is sent to OpenAI to produce the answer.</strong> That includes what you write in a Nova conversation and the project details a feature is working from. Don't put anything in an AI feature you wouldn't want leaving this system.</li>
      </ul>

      <h2>How long it's kept</h2>
      <ul>
        <li>Your account and what you've written stay until you delete them.</li>
        <li>Email confirmation links: 7 days. Password reset links: 1 hour. Phone sign-in tokens: 30 days after they expire or are revoked. Unaccepted project invitations: 30 days.</li>
        <li>Payment processing records: 90 days after they're processed.</li>
        <li>Usage events are kept while they're still useful for understanding the product.</li>
      </ul>

      <h2>Taking it with you, and deleting it</h2>
      <ul>
        <li><strong>Export.</strong> Settings → your account holds a full export of what's yours, as a file.</li>
        <li><strong>Delete.</strong> Settings → Delete my account, in the app and on the web. It removes your account and your content. You can choose to leave posts you've made in shared conversations so they don't leave holes in other people's threads — that choice is yours to make at the time, and those posts stop being attributed to a live account.</li>
        <li>Deleting is not reversible, and we don't keep a shadow copy to reverse it with. Backups age out on their own schedule.</li>
      </ul>

      <h2>Security</h2>
      <p>
        Passwords are hashed with bcrypt. Two-factor secrets, sign-in tokens and reset links are stored as hashes or
        encrypted, never as something that could be used as-is. Traffic is encrypted in transit. Setting a new password
        signs out every other session and device. None of this makes a system unbreakable, and we'd rather say that
        than imply otherwise — if you find a hole, <a href="https://github.com/damsgardhunter/sparktower/security/advisories/new">tell us here</a>.
      </p>

      <h2>Children</h2>
      <p>SparkTower isn't for under-13s, and accounts aren't knowingly created for them. If one exists, write to us and it will be removed.</p>

      <h2>Where the data lives</h2>
      <p>
        On servers in the United States. If you're somewhere else, using SparkTower means your information is processed
        there.
      </p>

      <h2>Changes</h2>
      <p>
        When this changes in a way that matters, the date at the top changes and we say so in the product. Continuing to
        use SparkTower after that means the new version applies.
      </p>
    </LegalPage>
  );
}

export function TermsOfService() {
  return (
    <LegalPage title="Terms of service">
      <p>
        These are the terms for using SparkTower. They're written to be read rather than to be impenetrable, and the
        short version is: it's your work, be decent to other people, and this is a young product that can break.
      </p>

      <h2>Your account</h2>
      <ul>
        <li>You need to be 13 or older, and old enough where you live to agree to this.</li>
        <li>One person, one account. Keep your password to yourself — turning on two-factor authentication is the single best thing you can do here.</li>
        <li>You're responsible for what happens under your account.</li>
      </ul>

      <h2>Your work stays yours</h2>
      <ul>
        <li>Everything you write, upload and build here belongs to you. We claim no ownership of it.</li>
        <li>You give us permission to store it, back it up and display it to the people you've chosen to show it to — which is what "publishing a page" or "posting in a feed" means. Nothing more.</li>
        <li>When you make something public, other people can see it. Deleting it removes it from SparkTower; it doesn't reach into copies other people already made.</li>
      </ul>

      <h2>What you can't do here</h2>
      <ul>
        <li>Break the law, or help someone else do it.</li>
        <li>Post someone else's work as your own, or anything you don't have the right to post.</li>
        <li>Harass, threaten or impersonate anybody.</li>
        <li>Attack the service — scraping it at scale, breaking into other people's accounts, or hunting for holes in ways that damage things. Security research done responsibly is welcome and has an address to go to.</li>
        <li>Use it to send spam, or to build a list of people to spam.</li>
      </ul>
      <p>Accounts that do these things get suspended, and content that does gets removed.</p>

      <h2>Money</h2>
      <ul>
        <li>Paid plans are billed through Stripe, monthly, and renew until you cancel. Cancelling stops the next charge; it doesn't refund the current period.</li>
        <li>Prices can change. If they do for a plan you're on, we'll tell you before it takes effect.</li>
        <li>Backing a project sends money to that project's owner, minus the processing fee. We're not a party to what they do with it, and we don't guarantee any project's outcome.</li>
      </ul>

      <h2>What Nova is, and isn't</h2>
      <p>
        Nova is a language model. It's useful, it's confident, and it's sometimes wrong. Nothing it produces is legal,
        financial, tax or professional advice, and any plan it writes is a starting point for your judgement rather
        than a replacement for it. Where it points you at another company's service, that's a signpost — we're not
        responsible for what happens on the other end, and you should read their terms.
      </p>

      <h2>The product can break</h2>
      <p>
        SparkTower is provided as it is, with no promise that it will be available, uninterrupted, or free of faults.
        We back things up and we test, and we still can't promise nothing will ever be lost. Keep your own copy of
        anything you can't afford to lose — the export in your settings exists for exactly this.
      </p>
      <p>
        To the extent the law allows, our liability for anything arising out of using SparkTower is limited to what you
        paid us in the twelve months before it happened.
      </p>

      <h2>Ending it</h2>
      <ul>
        <li>You can delete your account whenever you like, from Settings.</li>
        <li>We can suspend or close an account that breaks these terms, or that puts other people at risk. Where it's possible to tell you why, we will.</li>
      </ul>

      <h2>Changes</h2>
      <p>
        These terms will change as the product does. The date at the top says when, and material changes get said out
        loud in the product rather than slipped in.
      </p>
    </LegalPage>
  );
}
