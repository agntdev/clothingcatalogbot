import type { Ctx } from "./bot.js";

export type CategoryId = string;

export interface Category {
  id: string;
  title: string;
  order?: number;
}

export interface Product {
  id: string;
  /** Main catalogue category after the one-time legacy migration. */
  category?: "Одежда" | "Обувь" | "Аксессуары";
  photo?: string;
  description?: string;
  category_id: string;
  photo_file_id_or_url?: string;
  title: string;
  short_description: string;
  price_minor_units: number;
  currency: string;
  created_by_admin_id?: number;
  created_at?: number;
  order?: number;
  needs_category_review?: boolean;
}

export interface Inquiry {
  id: string;
  product_id: string;
  user_id: number;
  user_display_name: string;
  message_text: string;
  timestamp: number;
  sent_to_admin_at?: number;
  product_snapshot?: { title: string; price_minor_units: number; photo_file_id_or_url?: string; photo_url?: string };
  username?: string;
}

type CatalogStub = { fetch(input: string, init?: RequestInit): Promise<Response> };
type CatalogEnv = { CHAT_DO?: { idFromName(name: string): unknown; get(id: unknown): CatalogStub } };

const categories: ReadonlyArray<Category> = [
  { id: "clothes", title: "Одежда" },
  { id: "shoes", title: "Обувь" },
  { id: "accessories", title: "Аксессуары" },
];

function stub(ctx: Ctx): CatalogStub | undefined {
  const env = (ctx as unknown as { env?: CatalogEnv }).env;
  const namespace = env?.CHAT_DO;
  return namespace?.get(namespace.idFromName("catalog"));
}

const CATALOG_TIMEOUT_MS = 2_500;

async function request<T>(ctx: Ctx, path: string, init?: RequestInit): Promise<T | undefined> {
  const target = stub(ctx);
  if (!target) return undefined;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CATALOG_TIMEOUT_MS);
  try {
    const response = await target.fetch(`https://catalog${path}`, {
      ...init,
      ...(init?.body ? { headers: { "content-type": "application/json" } } : {}),
      signal: controller.signal,
    });
    if (!response.ok) return undefined;
    return (await response.json()) as T;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}

export function categoryTitle(id: CategoryId): string {
  return id === "all" ? "Все товары" : categories.find((category) => category.id === id)?.title ?? "Каталог";
}

/**
 * Converts the former nested catalogue to the three owner-requested roots.
 * The Durable Object reads only its explicit all-product index and is therefore
 * safe to call repeatedly from any entry point.
 */
export async function migrateCatalog(ctx: Ctx): Promise<Product[]> {
  const result = await request<{ flagged?: Product[] }>(ctx, "/catalog/migrate", { method: "POST" });
  return result?.flagged ?? [];
}

export async function categoryReviewReport(ctx: Ctx): Promise<Product[]> {
  const result = await request<{ flagged?: Product[] }>(ctx, "/catalog/category-review-report");
  return result?.flagged ?? [];
}

export async function markCategoryReviewReported(ctx: Ctx): Promise<void> {
  await request(ctx, "/catalog/category-review-report", { method: "PUT" });
}

export async function categoriesFor(ctx: Ctx): Promise<Category[]> {
  await migrateCatalog(ctx);
  const stored = await request<Category[]>(ctx, "/catalog/categories");
  return stored ?? [...categories];
}

export async function categoryById(ctx: Ctx, id: string): Promise<Category | undefined> {
  return request<Category>(ctx, `/catalog/category?id=${encodeURIComponent(id)}`);
}

export async function saveCategory(ctx: Ctx, category: Category): Promise<boolean> {
  return (await request<{ saved: boolean }>(ctx, "/catalog/category", {
    method: "PUT", body: JSON.stringify(category),
  }))?.saved === true;
}

export async function deleteCategory(ctx: Ctx, id: string): Promise<boolean> {
  return (await request<{ saved: boolean }>(ctx, `/catalog/category?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
  }))?.saved === true;
}

export async function productsFor(ctx: Ctx, category: CategoryId): Promise<Product[]> {
  await migrateCatalog(ctx);
  const products = (await request<Product[]>(ctx, `/catalog/products?category=${encodeURIComponent(category)}`)) ?? [];
  return products.sort((a, b) => (a.order ?? a.created_at ?? 0) - (b.order ?? b.created_at ?? 0));
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

/** Owner-only inbox is read through the durable inquiry index, never a key scan. */
export async function inquiriesForOwner(ctx: Ctx): Promise<Inquiry[]> {
  return (await request<Inquiry[]>(ctx, "/catalog/inquiries")) ?? [];
}

export async function saveProduct(ctx: Ctx, product: Product): Promise<boolean> {
  return (await request<{ saved: boolean }>(ctx, "/catalog/product", {
    method: "PUT",
    body: JSON.stringify(product),
  }))?.saved === true;
}

export async function deleteProduct(ctx: Ctx, id: string): Promise<boolean> {
  return (await request<{ saved: boolean }>(ctx, `/catalog/product?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
  }))?.saved === true;
}

export async function auditAdminAction(ctx: Ctx, action: "product_added" | "product_deleted", productId: string, timestamp: number): Promise<void> {
  const adminId = ctx.from?.id;
  if (!adminId) return;
  await request(ctx, "/catalog/audit", {
    method: "PUT",
    body: JSON.stringify({ admin_id: adminId, action, product_id: productId, timestamp }),
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
