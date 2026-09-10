# Placeholder database URLs flagged as credentials (September 2026)

**What was flagged.** The codebase audit reported "a database URL with a password in it" in three files: the data-source card's input placeholder, and two test files that build connection strings to exercise the URL guard and the seal.

**What they were.** Placeholders, not credentials. The hosts were `example.com`, `localhost`, private ranges and an RFC 5737 test address; the password parts were stand-in words. None of them has ever been valid anywhere. Nothing was rotated because there was nothing to rotate, and history was not rewritten: rewriting history over fake strings would cost every clone and CI run and remove nothing real.

**What changed.**
- The placeholder text no longer has the shape of a credential.
- Test fixtures assemble URLs from parts at runtime, so no line in the repository has the `scheme://user:password@host` shape.
- The audit's secret detector now recognises documented placeholders (example/test/invalid hosts, the RFC 5737 networks, localhost, obvious stand-in passwords) and does not report them, while a real-looking URL is still reported. Unit-tested.

**Standing rule.** No string of the shape `scheme://user:password@host` anywhere in the tree, even fake. Describe credentials in words, or build them from parts.
