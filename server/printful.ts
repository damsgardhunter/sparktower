/**
 * Printful — printing and shipping the backer merch.
 *
 * Every export here is safe to call with no API key configured. Fulfillment is
 * the last thing that gets wired up in a campaign's life and the first thing
 * that breaks in local development, so nothing in the creator's setup flow or
 * the checkout is allowed to depend on Printful being reachable: previews are
 * rendered locally, and orders queue in our own table until they can be sent.
 *
 * Set PRINTFUL_API_KEY to turn fulfillment on. The product ids in
 * shared/backing.ts start out null on purpose — map them from `listCatalog()`
 * rather than hard-coding ids that Printful is free to change under you.
 */

const API_BASE = "https://api.printful.com";

export function isPrintfulConfigured(): boolean {
  return Boolean(process.env.PRINTFUL_API_KEY);
}

export class PrintfulNotConfiguredError extends Error {
  constructor() {
    super("Printful is not configured. Set PRINTFUL_API_KEY to enable fulfillment.");
    this.name = "PrintfulNotConfiguredError";
  }
}

export class PrintfulError extends Error {
  constructor(message: string, readonly status: number, readonly body?: unknown) {
    super(message);
    this.name = "PrintfulError";
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const key = process.env.PRINTFUL_API_KEY;
  if (!key) throw new PrintfulNotConfiguredError();

  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(process.env.PRINTFUL_STORE_ID
        ? { "X-PF-Store-Id": process.env.PRINTFUL_STORE_ID }
        : {}),
      ...(init.headers || {}),
    },
  });

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    // Printful puts the useful part in result, not in the HTTP status text.
    const detail = (body as any)?.result || (body as any)?.error?.message || res.statusText;
    throw new PrintfulError(`Printful ${res.status}: ${detail}`, res.status, body);
  }
  return (body as any)?.result as T;
}

export interface PrintfulCatalogProduct {
  id: number;
  type: string;
  brand: string | null;
  model: string;
  image: string;
  variant_count: number;
}

/**
 * The catalog, for mapping our product keys onto real Printful ids.
 *
 * Used by the reviewer-only catalog endpoint; not on any hot path.
 */
export function listCatalog(): Promise<PrintfulCatalogProduct[]> {
  return request<PrintfulCatalogProduct[]>("/products");
}

export interface PrintfulVariant {
  id: number;
  name: string;
  size: string;
  color: string;
  price: string;
}

export function listVariants(productId: number): Promise<{ variants: PrintfulVariant[] }> {
  return request<{ variants: PrintfulVariant[] }>(`/products/${productId}`);
}

export interface PrintfulOrderItem {
  variant_id: number;
  quantity: number;
  /** Print files, already hosted somewhere Printful can fetch them. */
  files: { type: string; url: string }[];
}

export interface PrintfulRecipient {
  name: string;
  address1: string;
  address2?: string;
  city: string;
  state_code?: string;
  country_code: string;
  zip: string;
}

export interface PrintfulOrder {
  id: number;
  status: string;
  shipments?: { tracking_url?: string }[];
}

/**
 * Submits an order.
 *
 * `confirm: false` creates it as a draft in the Printful dashboard so the
 * first real orders can be eyeballed before any money is spent on printing.
 * Flip it on once the artwork pipeline has proved itself.
 */
export function createOrder(input: {
  externalId: string;
  recipient: PrintfulRecipient;
  items: PrintfulOrderItem[];
  confirm?: boolean;
}): Promise<PrintfulOrder> {
  return request<PrintfulOrder>(`/orders?confirm=${input.confirm ? "1" : "0"}`, {
    method: "POST",
    body: JSON.stringify({
      external_id: input.externalId,
      recipient: input.recipient,
      items: input.items,
    }),
  });
}

export function getOrder(printfulOrderId: string): Promise<PrintfulOrder> {
  return request<PrintfulOrder>(`/orders/${printfulOrderId}`);
}
