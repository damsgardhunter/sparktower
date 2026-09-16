# The sending domain: SPF, DKIM, DMARC

This app sends mail people are waiting for — the address-verification link, a
project invite, a password they asked to change. Unauthenticated mail from a new
domain lands in spam, and the person concludes the product is broken. Worse, a
domain with no policy is one anybody can send *as*: a convincing "SparkTower
security alert" from your own domain costs an attacker nothing.

Three records, in this order. They live in DNS, so nothing in this repository can
prove they exist — this file is the written record of what should be there and
who checked. The check in the audit says the same thing about itself.

## 1. SPF — which servers may send as us

One TXT record at the root of the sending domain. One record only: two SPF
records is a permanent failure, not a merge.

```
sparktower.example.  TXT  "v=spf1 include:_spf.resend.com ~all"
```

`include:` names the provider actually sending (Resend here — `RESEND_API_KEY`,
`EMAIL_FROM`). Add an include for anything else that sends as this domain
(support desk, marketing tool); each one costs a DNS lookup and there is a hard
limit of ten. `~all` is softfail while you are watching the reports; `-all` once
they are clean.

## 2. DKIM — the mail is signed, and the signature checks out

The provider generates the key pair and gives you the record; you publish it and
they sign with the private half. In Resend: Domains → Add domain → copy the
CNAME (or TXT) rows it prints. Do not invent these by hand.

```
resend._domainkey.sparktower.example.  CNAME  …   # exactly as the provider prints it
```

DKIM survives forwarding, which SPF does not — it is the one that matters most
for mailing lists and "forward to my other address" users.

## 3. DMARC — what receivers should do when the first two fail, and tell us

```
_dmarc.sparktower.example.  TXT  "v=DMARC1; p=none; rua=mailto:dmarc@sparktower.example; pct=100; adkim=s; aspf=s"
```

Start at `p=none`. It changes nothing about delivery and starts the daily
aggregate reports arriving at `rua=`. Read them for two or three weeks: they
tell you every source sending as your domain, which is how you find the one
legitimate sender you forgot before it gets quarantined. Then `p=quarantine`,
and `p=reject` once that is quiet.

Skipping straight to `p=reject` is how people silently lose their own invoices.

## Checking, and the record of who did

From any machine:

```sh
dig +short TXT sparktower.example            # one v=spf1 record
dig +short TXT _dmarc.sparktower.example     # v=DMARC1
dig +short CNAME resend._domainkey.sparktower.example
```

Then send one real invite to a Gmail address, open the message, and view the
original: `SPF: PASS`, `DKIM: PASS`, `DMARC: PASS`. That end-to-end check is the
one worth trusting; the `dig` output only proves the records parse.

| date | domain | SPF | DKIM | DMARC policy | checked by |
|---|---|---|---|---|---|
| — | — | — | — | — | *Not yet published. Until there is a row here, the app's mail is unauthenticated.* |
