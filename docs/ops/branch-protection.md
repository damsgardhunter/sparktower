# Branch protection on `main`

Seven checks are required — `server-web`, `mobile`, `e2e`, `secrets`,
`dependencies`, `codeql`, `packages` — and admins are not exempt. One setting is
wrong: **`strict` is false**, which means a pull request can merge while its base
is out of date. It passed CI against an older `main` than the one it lands on.

That matters here more than it would on most repositories, because several
sessions commit to the same branch at once: two changes that are each green
against yesterday's `main` can be red together, and nothing stops them merging.

## Turning it on

The payload below is the current protection with `strict` flipped and everything
else preserved — the API call replaces the whole object, so nothing may be left
out. Run it as somebody with admin on the repository:

```sh
cat > /tmp/protection.json <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["server-web", "mobile", "e2e", "secrets", "dependencies", "codeql", "packages"]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": null,
  "restrictions": null,
  "required_linear_history": false,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "block_creations": false,
  "required_conversation_resolution": false,
  "lock_branch": false,
  "allow_fork_syncing": false
}
JSON

gh api -X PUT repos/damsgardhunter/sparktower/branches/main/protection \
  --input /tmp/protection.json
```

Or in the web interface: **Settings → Branches → `main` → Require branches to be
up to date before merging.**

## What it costs

An "Update branch" press on a pull request whose base has moved, and another CI
run. That is the whole price, and it is the point: the second run is the one that
tests the combination that is actually going to be on `main`.

## Why this is a document and not a script

An agent working in this repository is refused this call — it is classified as a
change to CI enforcement, which is exactly the kind of thing that should need a
person. The payload is written out so that it is one paste rather than a
reconstruction.
