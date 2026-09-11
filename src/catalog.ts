import type { Ctx } from "./bot.js";

export type CategoryId = "male" | "female" | "kids" | "all";

export interface Product {
  id: string;
  category_id: Exclude<CategoryId, "all">;
  photo_file_id_or_url?: string;
  title: string;
  short_description: string;
  price_minor_units: number;
  currency: string;
}

export interface Inquiry {
  id: string;
  product_id: string;
  user_id: number;
  user_display_name: string;
  message_text: string;
  timestamp: number;
  sent_to_admin_at?: number;
}

type CatalogStub = { fetch(input: string, init?: { method?: string; body?: string }): Promise<Response> };
type CatalogEnv = { CHAT_DO?: { idFromName(name: string): unknown; get(id: unknown): CatalogStub } };

const categories: ReadonlyArray<{ id: Exclude<CategoryId, "all">; title: string }> = [
  { id: "male", title: "Мужская" },
  { id: "female", title: "Женская" },
  { id: "kids", title: "Детская" },
];

function stub(ctx: Ctx): CatalogStub | undefined {
  const env = (ctx as unknown as { env?: CatalogEnv }).env;
  const namespace = env?.CHAT_DO;
  return namespace?.get(namespace.idFromName("catalog"));
}

async function request<T>(ctx: Ctx, path: string, init?: { method?: string; body?: string }): Promise<T | undefined> {
  const target = stub(ctx);
  if (!target) return undefined;
  try {
    const response = await target.fetch(`https://catalog${path}`, init);
    if (!response.ok) return undefined;
    return (await response.json()) as T;
  } catch {
    return undefined;
  }
}

export function categoryTitle(id: CategoryId): string {
  return id === "all" ? "Все товары" : categories.find((category) => category.id === id)?.title ?? "Каталог";
}

export async function productsFor(ctx: Ctx, category: CategoryId): Promise<Product[]> {
  return (await request<Product[]>(ctx, `/catalog/products?category=${encodeURIComponent(category)}`)) ?? [];
}

export async function productById(ctx: Ctx, id: string): Promise<Product | undefined> {
  return request<Product>(ctx, `/catalog/product?id=${encodeURIComponent(id)}`);
}

export async function saveUser(ctx: Ctx, timestamp: number): Promise<void> {
  const from = ctx.from;
  if (!from) return;
  await request(ctx, "/catalog/user", {
    method: "PUT",
    body: JSON.stringify({
      user_id: from.id,
      first_name: from.first_name,
      last_name: from.last_name,
      username: from.username,
      last_interaction_at: timestamp,
    }),
  });
}

export async function saveInquiry(ctx: Ctx, inquiry: Inquiry): Promise<boolean> {
  return (await request<{ saved: boolean }>(ctx, "/catalog/inquiry", {
    method: "PUT",
    body: JSON.stringify(inquiry),
  }))?.saved === true;
}

export async function markInquirySent(ctx: Ctx, id: string, sentAt: number): Promise<void> {
  await request(ctx, "/catalog/inquiry/sent", {
    method: "PUT",
    body: JSON.stringify({ id, sent_at: sentAt }),
  });
}

export function formatPrice(product: Product): string {
  const amount = product.price_minor_units / 100;
  const formatted = new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: product.price_minor_units % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);
  return product.currency === "RUB" ? `${formatted} ₽` : `${formatted} ${product.currency}`;
}
