import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient, type FailedRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { errorText } from "@/lib/api-error";
import {
  formatMoney, priceOf, OUTCOME_COPY, outcomeCopy, PAY_ENDPOINTS,
  type ActionPrice, type NovaActionId, type PaymentRequiredBody, type PricedOutcomeId, type Wallet,
} from "@shared/plans";
import { cn } from "@/lib/utils";
import { Check, Clock, Loader2, Wallet as WalletIcon } from "lucide-react";

/**
 * The one dialog that asks for money.
 *
 * Every 402 in the product has the same body (PaymentRequiredBody), which
 * carries what was being bought, what it costs, what is on the account and
 * which single thing to offer. So this is mounted once and no screen has to
 * know the price list — a price that moves on the server moves here with it,
 * and thirty call sites keep working without being touched.
 *
 * The rule the whole file is built around: a person who pays gets the thing
 * they were trying to do. Paying and then being handed a closed dialog and the
 * job of remembering which button they pressed is how a product makes someone
 * feel charged rather than served — so the request that was refused is kept,
 * and replayed the moment the money is there.
 */
export const PAYMENT_EVENT = "sparktower:payment";
export interface PaymentEventDetail { body: PaymentRequiredBody; request?: FailedRequest }

/** Where an interrupted action waits while its buyer is away at Stripe. */
const PENDING_KEY = "sparktower:pending-purchase";

interface PendingPurchase { request: FailedRequest; label: string; at: number }

/*
 * Half an hour. Long enough for a card that asks for a bank app, short enough
 * that an action nobody remembers starting is never silently finished for
 * them — coming back tomorrow to a roadmap you don't remember asking for is
 * worse than being asked again.
 */
const PENDING_TTL_MS = 30 * 60 * 1000;

function rememberPending(pending: PendingPurchase) {
  try { sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending)); } catch { /* private window: they'll be asked again */ }
}

function takePending(): PendingPurchase | null {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    sessionStorage.removeItem(PENDING_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingPurchase;
    if (!parsed?.request?.url || Date.now() - parsed.at > PENDING_TTL_MS) return null;
    return parsed;
  } catch { return null; }
}

export function openPayment(detail: PaymentEventDetail) {
  window.dispatchEvent(new CustomEvent<PaymentEventDetail>(PAYMENT_EVENT, { detail }));
}

/**
 * What the account has, for anything that wants to show it before a price is
 * refused.
 *
 * The route answers with the wallet *and* the price list, the notice and the
 * recent ledger, so this unwraps it. Typed as the envelope rather than as the
 * wallet, because getting that wrong is silent: every balance on screen simply
 * renders empty.
 */
/**
 * What is on the account, read fresh every time it is asked for.
 *
 * The app's default is `staleTime: Infinity` — right for almost everything
 * here, and wrong for money. A balance cached for the life of a tab is a
 * balance that is wrong the moment it changes anywhere else: in another tab,
 * on a phone, from a top-up that completed while this page sat open. It showed
 * up as a confirmation dialog telling somebody with a hundred dollars on their
 * account that $14.99 was "more than your balance", because the number it was
 * comparing against had been fetched before they added any.
 *
 * `refetchOnMount: "always"` as well as `staleTime: 0`, because the dialog
 * mounts its copy of this the moment it opens, which is exactly the moment the
 * figure has to be true.
 */
export function useWallet(enabled = true) {
  return useQuery({
    queryKey: [PAY_ENDPOINTS.wallet],
    enabled,
    staleTime: 0,
    refetchOnMount: "always",
    select: (d: { wallet: Wallet }) => d.wallet,
  });
}

/**
 * The projects whose priced outcomes are already paid for.
 *
 * Read from the same endpoint as the balance, so asking costs no extra call.
 * Fetched ahead of any dialog rather than alongside one, because the answer
 * decides whether a dialog opens at all — but only once somebody is signed in.
 * Without that guard it fired on the signup page and on every logged-out
 * route, where the wallet endpoint quite correctly answers 401.
 */
export function useBuildPasses() {
  const { user } = useAuth();
  return useQuery({
    queryKey: [PAY_ENDPOINTS.wallet],
    enabled: !!user,
    /* Same reason as `useWallet`: what has been paid for decides whether a
       dialog opens at all, and a stale answer either charges twice or offers
       something already owned. */
    staleTime: 0,
    refetchOnMount: "always",
    select: (d: { buildPasses?: string[] }) => d.buildPasses ?? [],
  });
}

function AllowanceLine({ wallet }: { wallet: Wallet }) {
  if (wallet.dayPassActive) {
    return (
      <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Clock className="h-3.5 w-3.5" />
        Your day pass covers small actions{wallet.dayPassUntil ? ` until ${new Date(wallet.dayPassUntil).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}.
      </p>
    );
  }
  return (
    <p className="text-sm text-muted-foreground">
      {wallet.allowanceRemaining} of {wallet.allowanceLimit} free Nova actions left this month
      {/* The bought ones are said separately: they are a different promise —
          the free ones come back next month and reset to 25, these stay until
          they are used. Rolling them into one figure would make "25 left" mean
          two different things on two different days. */}
      {wallet.actionsBought > 0 && `, and ${wallet.actionsBought} you've bought`}.
    </p>
  );
}

export function PaymentDialog() {
  const [detail, setDetail] = useState<PaymentEventDetail | null>(null);
  /** Set when they have come back from Stripe with money and an unfinished action. */
  const [returned, setReturned] = useState<PendingPurchase | null>(null);
  const [amountCents, setAmountCents] = useState<number | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    const on = (e: Event) => {
      const next = (e as CustomEvent<PaymentEventDetail>).detail;
      setDetail(next);
      setAmountCents(next.body.topUp?.suggestCents ?? null);
    };
    window.addEventListener(PAYMENT_EVENT, on);
    return () => window.removeEventListener(PAYMENT_EVENT, on);
  }, []);

  const close = useCallback(() => { setDetail(null); setReturned(null); }, []);

  /**
   * Run the refused request again, now that it is paid for, and then refresh
   * everything. The screen behind this dialog made the original call and owns
   * the result; it cannot learn about a call this component made any other
   * way.
   */
  const replay = useMutation({
    mutationFn: async (request: FailedRequest) => {
      await apiRequest(request.method, request.url, request.data);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries();
      close();
    },
    onError: (e) => {
      // A second 402 re-opens this dialog through the usual event, so nothing is said about money here.
      toast({ title: "That didn't go through", description: errorText(e), variant: "destructive" });
      close();
    },
  });

  /*
   * Buys whatever the refusal named — a pack of Nova actions, or a day of
   * images. Two prices, two endpoints, one button: to the person it is the
   * same press, and the 402 already said which one it is.
   */
  const buyMore = useMutation({
    mutationFn: async () => {
      const endpoint = detail?.body.outcome === "imagePass" ? PAY_ENDPOINTS.imagePass : PAY_ENDPOINTS.actionPack;
      return (await apiRequest("POST", endpoint)).json() as Promise<{ wallet: Wallet }>;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: [PAY_ENDPOINTS.wallet] });
      const request = detail?.request;
      if (request) { replay.mutate(request); return; }
      toast({
        title: detail?.body.outcome === "imagePass" ? "Images are on" : "Day pass on",
        description: detail?.body.outcome === "imagePass"
          ? "Unlimited image generation for the next 24 hours."
          : "Small Nova actions are unlimited for the next 24 hours.",
      });
      close();
    },
    onError: (e) => toast({ title: "Couldn't add those", description: errorText(e), variant: "destructive" }),
  });

  const topUp = useMutation({
    mutationFn: async (cents: number) => (await apiRequest("POST", PAY_ENDPOINTS.topUp, {
      amountCents: cents, returnTo: `${window.location.pathname}${window.location.search}`,
    })).json() as Promise<{ url?: string }>,
    onSuccess: ({ url }) => {
      if (!url) { toast({ title: "Couldn't start checkout", variant: "destructive" }); return; }
      // Kept across the trip to Stripe, so coming back can offer to finish it.
      if (detail?.request) rememberPending({ request: detail.request, label: detail.body.label, at: Date.now() });
      window.location.href = url;
    },
    onError: (e) => toast({ title: "Couldn't start checkout", description: errorText(e), variant: "destructive" }),
  });

  // The way back from Stripe, dispatched by TopUpReturn below.
  useEffect(() => {
    const on = (e: Event) => setReturned((e as CustomEvent<PendingPurchase | null>).detail);
    window.addEventListener(TOPUP_RETURN_EVENT, on);
    return () => window.removeEventListener(TOPUP_RETURN_EVENT, on);
  }, []);

  const busy = buyMore.isPending || topUp.isPending || replay.isPending;

  if (returned) {
    /*
     * Back with the money, and the action they bought it for still undone.
     * Offered rather than run: a page that finishes a purchase by itself on
     * load will eventually finish it twice, and this is the one screen where
     * that costs real money.
     */
    return (
      <Dialog open onOpenChange={(o) => { if (!o && !busy) close(); }}>
        <DialogContent className="sm:max-w-md" data-testid="dialog-topup-return">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Check className="h-5 w-5 text-emerald-600" /> Money's on your account
            </DialogTitle>
            <DialogDescription>
              You were part way through {returned.label.toLowerCase()}. Pick it up where you left off.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="ghost" onClick={close} disabled={busy} data-testid="button-topup-later">Not now</Button>
            <Button onClick={() => replay.mutate(returned.request)} disabled={busy} data-testid="button-topup-continue">
              {replay.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Working…</> : `Continue with ${returned.label.toLowerCase()}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  if (!detail) return null;
  const { body } = detail;
  const options = body.topUp?.optionsCents ?? [];

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) close(); }}>
      <DialogContent className="sm:max-w-md" data-testid="dialog-payment">
        <DialogHeader>
          <DialogTitle>{body.label}</DialogTitle>
          <DialogDescription data-testid="text-payment-message">{body.message}</DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border bg-muted/40 p-3 space-y-1.5">
          <p className="flex items-center justify-between text-sm font-medium">
            <span className="flex items-center gap-1.5"><WalletIcon className="h-4 w-4" /> Balance</span>
            <span data-testid="text-payment-balance">{body.wallet.balanceDisplay}</span>
          </p>
          <AllowanceLine wallet={body.wallet} />
        </div>

        {body.remedy === "top_up" && options.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium">Add to your balance</p>
            <div className="grid grid-cols-3 gap-2">
              {options.map((cents) => (
                <button
                  key={cents}
                  type="button"
                  onClick={() => setAmountCents(cents)}
                  data-testid={`button-topup-${cents}`}
                  className={cn(
                    "rounded-md border py-2 text-sm font-medium transition-colors",
                    amountCents === cents ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted",
                  )}
                >
                  {formatMoney(cents)}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Your balance never expires, and it works on anything — there's no plan to cancel.
            </p>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="ghost" onClick={close} disabled={busy} data-testid="button-payment-cancel">Not now</Button>

          {body.remedy === "buy_pass" && (
            <Button onClick={() => buyMore.mutate()} disabled={busy} data-testid="button-buy-day-pass">
              {/*
                * The outcome's name, not the label.
                *
                * `label` is the thing that was refused — "Nova coaching", "a
                * persona" — and putting it on the button made it read "Get
                * nova coaching — $5" when what the five dollars actually buys
                * is twenty-five Nova actions, of which coaching is one. The
                * price comes off the 402 rather than a literal, because it has
                * moved once already.
                */}
              {busy
                ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Working…</>
                : `Get ${(outcomeCopy(body.outcome)?.name ?? body.label).toLowerCase()} — ${body.price?.display ?? ""}`.trim()}
            </Button>
          )}

          {body.remedy === "top_up" && (
            <Button
              onClick={() => amountCents && topUp.mutate(amountCents)}
              disabled={busy || !amountCents}
              data-testid="button-topup-checkout"
            >
              {busy ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Working…</> : `Add ${amountCents ? formatMoney(amountCents) : ""} and continue`}
            </Button>
          )}

          {body.remedy === "none" && (
            <Button onClick={close} data-testid="button-payment-ok">Close</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Asking before spending.
 *
 * The 402 dialog above only ever appears when someone *cannot* pay. An action
 * they can afford is charged by the server on the first call, which means
 * without this the first time anybody learns a roadmap costs $3 is from their
 * balance afterwards. One surprise charge is all it takes for a person to stop
 * pressing anything, and a product where you are afraid to press things is the
 * "pay to win" feeling whatever the prices are.
 *
 * So: the priced outcomes ask, every time, showing the price and what the
 * charge leaves behind. Small actions never ask — they are free until the
 * month's allowance is gone, and a confirmation on something free is just a
 * door with nothing behind it.
 */
interface PurchaseRequest { price: ActionPrice; title: string; detail?: string; resolve: (ok: boolean) => void }

const PurchaseConfirmContext = createContext<((action: NovaActionId, opts?: { title?: string; detail?: string; projectId?: string | null }) => Promise<boolean>) | null>(null);

export function PurchaseConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PurchaseRequest | null>(null);
  const { data: wallet } = useWallet(!!pending);
  const { data: buildPasses } = useBuildPasses();

  const confirmPurchase = useCallback(
    (action: NovaActionId, opts?: { title?: string; detail?: string; projectId?: string | null }) => {
      const price = priceOf(action);
      // Free and allowance-covered work goes straight through, unasked.
      if (price.cents == null) return Promise.resolve(true);
      /*
       * So does anything on a project that bought the whole-business build.
       *
       * The server has always treated the build pass as covering every priced
       * outcome on that project (server/entitlements.ts) and takes nothing.
       * This dialog did not know, so it quoted a price and a new balance for
       * work already owned — "Price $6, Balance $20 → $14" — and then charged
       * nothing. A confirmation that asks for money it will not take is worse
       * than no confirmation: it is either declined, costing somebody a
       * feature they paid for, or accepted, leaving them wrong about what
       * they have spent.
       */
      if (opts?.projectId && buildPasses?.includes(opts.projectId)) return Promise.resolve(true);
      return new Promise<boolean>((resolve) => {
        /*
         * `price.kind` is not always a priced outcome — `priceOf` returns
         * "free" and "small" too — so this used to cast it and crash on the
         * miss. The action's own name is the honest fallback.
         */
        setPending({ price, title: opts?.title ?? outcomeCopy(price.kind)?.name ?? price.action, detail: opts?.detail, resolve });
      });
    },
    [buildPasses],
  );

  const settle = (ok: boolean) => { pending?.resolve(ok); setPending(null); };

  const cents = pending?.price.cents ?? 0;
  const covered = wallet ? wallet.balanceCents >= cents : true;
  const after = wallet ? wallet.balanceCents - cents : null;

  return (
    <PurchaseConfirmContext.Provider value={confirmPurchase}>
      {children}
      {pending && (
        <Dialog open onOpenChange={(o) => { if (!o) settle(false); }}>
          <DialogContent className="sm:max-w-md" data-testid="dialog-confirm-purchase">
            <DialogHeader>
              <DialogTitle>{pending.title}</DialogTitle>
              <DialogDescription>
                {pending.detail ?? outcomeCopy(pending.price.kind)?.blurb}
              </DialogDescription>
            </DialogHeader>

            <div className="rounded-lg border bg-muted/40 p-3 space-y-1.5 text-sm">
              <p className="flex items-center justify-between font-medium">
                <span>Price</span>
                <span data-testid="text-confirm-price">{pending.price.display}</span>
              </p>
              <p className="flex items-center justify-between text-muted-foreground">
                <span className="flex items-center gap-1.5"><WalletIcon className="h-4 w-4" /> Balance</span>
                <span data-testid="text-confirm-balance">
                  {wallet ? wallet.balanceDisplay : "…"}
                  {wallet && covered && after != null && <span className="ml-1">→ {formatMoney(after)}</span>}
                </span>
              </p>
              {wallet && !covered && (
                /*
                 * Said here rather than left to the 402: it is the difference
                 * between "press this and we'll ask you for money" and "press
                 * this and find out". Pressing on is still allowed — the
                 * refusal that follows is the one that offers the top-up.
                 */
                <p className="text-muted-foreground">
                  That's {formatMoney(cents - (wallet.balanceCents ?? 0))} more than your balance. Continuing takes you to
                  checkout to add it, and brings you straight back here to finish.
                </p>
              )}
            </div>

            <DialogFooter className="gap-2 sm:gap-2">
              <Button variant="ghost" onClick={() => settle(false)} data-testid="button-confirm-cancel">Cancel</Button>
              {/*
                * The button says where it goes. "Continue" on a balance that
                * cannot cover the price reads as "buy it", and what actually
                * happens is a refusal, a second dialog and a trip to Stripe —
                * three screens somebody was not expecting when they pressed a
                * button that said Continue. The trip is still the right design
                * (the refusal is what captures the request so it can be
                * finished on the way back); the surprise was not.
                */}
              <Button onClick={() => settle(true)} data-testid="button-confirm-purchase">
                {covered ? `Pay ${pending.price.display}` : "Add money and continue"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </PurchaseConfirmContext.Provider>
  );
}

/**
 * `if (!(await confirmPurchase("roadmapGeneration"))) return;` before a priced
 * call. Returns true immediately for anything free or allowance-covered, so a
 * caller never has to know which is which — and an action whose price changes
 * starts (or stops) asking without its screen being edited.
 */
export function useConfirmPurchase() {
  const ctx = useContext(PurchaseConfirmContext);
  if (!ctx) throw new Error("useConfirmPurchase needs PurchaseConfirmProvider (mounted in App).");
  return ctx;
}

const TOPUP_RETURN_EVENT = "sparktower:topup-return";

/**
 * The way back from a top-up. Mounted beside CheckoutReturn, which handles the
 * subscription marker; this one handles `checkout=topup`.
 *
 * The webhook is what actually credits the balance, and it can land after the
 * browser does, so the wallet is re-read rather than assumed.
 */
export function TopUpReturn() {
  const { toast } = useToast();
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("checkout") !== "topup") return;
    handled.current = true;

    params.delete("checkout");
    const rest = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${rest ? `?${rest}` : ""}${window.location.hash}`);

    void (async () => {
      await queryClient.invalidateQueries({ queryKey: [PAY_ENDPOINTS.wallet] });
      const pending = takePending();
      if (pending) {
        window.dispatchEvent(new CustomEvent<PendingPurchase>(TOPUP_RETURN_EVENT, { detail: pending }));
        return;
      }
      toast({ title: "Money's on your account", description: "It never expires, and it works on anything." });
    })();
  }, [toast]);

  return null;
}
