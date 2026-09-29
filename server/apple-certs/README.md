# Apple's root certificates

`server/apple-iap.ts` verifies StoreKit receipts against these. They are read
from disk rather than fetched, because verification that downloads its own
trust anchors is verification a network can defeat.

Download from <https://www.apple.com/certificateauthority/> and drop the `.cer`
files in beside this file:

- **Apple Root CA - G3** (`AppleRootCA-G3.cer`) — the one StoreKit receipts
  chain to. This is the only one strictly required.
- Apple Inc. Root Certificate (`AppleIncRootCertificate.cer`) — harmless to
  include and useful if Apple moves a chain.

With none of them present the endpoint answers 503 `iap_unconfigured` and no
purchase is ever credited, which is the right way round: a missing certificate
must not become a reason to trust a receipt.

Nothing here is secret — these are public certificates — so they are committed
rather than kept in an environment variable.
