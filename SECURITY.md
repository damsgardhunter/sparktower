# Security policy

If you've found a vulnerability in SparkTower — the web app at sparktower.app, the mobile app, the API, or the editor bridge — please tell us privately first so we can fix it before anyone is put at risk.

## How to report

- **Email:** security@sparktower.app
- **GitHub:** [Report a vulnerability](https://github.com/damsgardhunter/sparktower/security/advisories/new) (private to the maintainers)

Please don't open a public issue, pull request or discussion for a security problem.

A good report includes:

- what an attacker could do, and to whom
- the steps, requests or code to reproduce it
- the URL, endpoint or file involved, and the account type you used (signed out, free, paid, project member)

Plain text is fine; you don't need a polished write-up.

## What to expect

| When | What happens |
| --- | --- |
| Within 3 business days | We confirm we've received your report. |
| Within 7 days | We tell you whether we can reproduce it and how serious we think it is. |
| After that | We keep you updated at least every 14 days until it's fixed. |

We aim to fix critical and high-severity issues within 30 days and others within 90. We'll tell you when the fix ships, and credit you in the release notes if you'd like to be named.

## Scope

In scope:

- sparktower.app and its API (`/api/*`)
- the SparkTower mobile apps
- the editor bridge and its tokens
- this repository's code

Out of scope:

- denial-of-service or load testing
- social engineering, phishing, or physical attacks
- spam or rate-limit reports with no security impact
- findings in third-party services we use (Stripe, Google, OpenAI) — report those to the vendor
- missing best-practice headers or settings with no demonstrated way to exploit them
- reports from automated scanners without a working proof of concept

## Safe harbor

We won't pursue or support legal action against you for research that follows this policy. That means you:

- only access, change or delete data in accounts you own or have permission to test
- stop and tell us as soon as you reach anyone else's data, and don't keep it
- don't degrade the service for other people
- give us a reasonable time to fix the issue before sharing it publicly

## Supported versions

Only the current production deployment and the latest `main` branch receive security fixes.

The same contact details are published at [`/.well-known/security.txt`](https://sparktower.app/.well-known/security.txt).
