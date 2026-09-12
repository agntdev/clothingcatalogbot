import type { Ctx } from "./bot.js";

export type CategoryId = string;

export interface Category {
  id: string;
  title: string;
  /** Kept as `order` for compatibility with the existing catalogue seed. */
  order?: number;
  position?: number;
  parent_id?: string | null;
  slug?: string;
  description?: string;
  image_file_id?: string;
  created_by_admin_id?: number;
  created_at?: number;
  visible?: boolean;
  updated_by_admin_id?: number;
  updated_at?: number;
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
  photos?: string[];
  sku?: string;
  visible?: boolean;
  available?: boolean;
  updated_by_admin_id?: number;
  updated_at?: number;
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
  kind?: "product" | "cart";
  cart_snapshot?: CartItem[];
  total_minor_units?: number;
  status?: "new" | "processed";
}

export interface CartItem {
  id: string;
  cart_user_id: number;
  product_id: string;
  title_snapshot: string;
  price_snapshot_rub: number;
  qty: number;
  thumbnail_url?: string;
}

export interface Cart { user_id: number; updated_at: number; items: CartItem[]; }
export interface Comment { id: string; product_id: string; user_id: number; user_display_name: string; text: string; created_at: number; }

type CatalogStub = { fetch(input: string, init?: RequestInit): Promise<Response> };
type CatalogEnv = { CHAT_DO?: { idFromName(name: string): unknown; get(id: unknown): CatalogStub } };

const categories: ReadonlyArray<Category> = [
  { id: "male", title: "Мужская", order: 1, visible: true },
  { id: "female", title: "Женская", order: 2, visible: true },
  { id: "kids", title: "Детская", order: 3, visible: true },
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
    // CatalogDO is an internal API, but administrative writes still carry the
    // Telegram actor id so the Durable Object can independently enforce owner
    // access. This is intentionally not a user-supplied value.
    const headers = new Headers(init?.headers);
    if (ctx.from?.id !== undefined) headers.set("x-agntdev-actor-id", String(ctx.from.id));
    if (init?.body) headers.set("content-type", "application/json");
    const response = await target.fetch(`https://catalog${path}`, {
      ...init,
      headers,
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

export function productPhotos(product: Product): string[] {
  return product.photos?.filter(Boolean) ?? (product.photo_file_id_or_url ? [product.photo_file_id_or_url] : []);
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

export async function categoriesFor(ctx: Ctx, parentId?: string | null, includeHidden = false): Promise<Category[]> {
  await migrateCatalog(ctx);
  const suffix = parentId === undefined ? "" : `?parent=${encodeURIComponent(parentId ?? "")}`;
  const stored = await request<Category[]>(ctx, `/catalog/categories${suffix}`);
  return (stored ?? (parentId === undefined || parentId === null ? [...categories] : [])).filter((category) => includeHidden || category.visible !== false);
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

export async function productsFor(ctx: Ctx, category: CategoryId, includeHidden = false): Promise<Product[]> {
  await migrateCatalog(ctx);
  const products = (await request<Product[]>(ctx, `/catalog/products?category=${encodeURIComponent(category)}`)) ?? [];
  return products.filter((product) => includeHidden || product.visible !== false).sort((a, b) => (a.order ?? a.created_at ?? 0) - (b.order ?? b.created_at ?? 0));
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

export async function markInquiryProcessed(ctx: Ctx, id: string): Promise<boolean> {
  return (await request<{ saved: boolean }>(ctx, "/catalog/inquiry/processed", { method: "PUT", body: JSON.stringify({ id }) }))?.saved === true;
}

export async function cartFor(ctx: Ctx, userId: number): Promise<Cart | undefined> {
  return request<Cart>(ctx, `/catalog/cart?user_id=${encodeURIComponent(String(userId))}`);
}
export async function addCartItem(ctx: Ctx, product: Product, userId: number, timestamp: number): Promise<Cart | undefined> {
  return request<Cart>(ctx, "/catalog/cart/add", { method: "PUT", body: JSON.stringify({ user_id: userId, product_id: product.id, title_snapshot: product.title, price_snapshot_rub: product.price_minor_units, thumbnail_url: productPhotos(product)[0], updated_at: timestamp }) });
}
export async function changeCartItem(ctx: Ctx, userId: number, itemId: string, delta: number, timestamp: number): Promise<Cart | undefined> {
  return request<Cart>(ctx, "/catalog/cart/item", { method: "PUT", body: JSON.stringify({ user_id: userId, item_id: itemId, delta, updated_at: timestamp }) });
}
export async function removeCartItem(ctx: Ctx, userId: number, itemId: string, timestamp: number): Promise<Cart | undefined> {
  return request<Cart>(ctx, `/catalog/cart/item?user_id=${encodeURIComponent(String(userId))}&item_id=${encodeURIComponent(itemId)}&updated_at=${timestamp}`, { method: "DELETE" });
}
export async function clearCart(ctx: Ctx, userId: number, timestamp: number): Promise<boolean> {
  return (await request<{ saved: boolean }>(ctx, "/catalog/cart/clear", { method: "PUT", body: JSON.stringify({ user_id: userId, updated_at: timestamp }) }))?.saved === true;
}
export async function clearCartForOwner(ctx: Ctx, userId: number, timestamp: number): Promise<boolean> {
  return (await request<{ saved: boolean }>(ctx, "/catalog/cart/admin-clear", { method: "PUT", body: JSON.stringify({ user_id: userId, updated_at: timestamp }) }))?.saved === true;
}
export async function commentsFor(ctx: Ctx, productId: string, page = 1): Promise<{ items: Comment[]; pages: number; page: number }> {
  return (await request<{ items: Comment[]; pages: number; page: number }>(ctx, `/catalog/comments?product_id=${encodeURIComponent(productId)}&page=${page}`)) ?? { items: [], pages: 1, page: 1 };
}
export async function saveComment(ctx: Ctx, comment: Comment): Promise<boolean> {
  return (await request<{ saved: boolean }>(ctx, "/catalog/comment", { method: "PUT", body: JSON.stringify(comment) }))?.saved === true;
}
export async function recentCommentsForOwner(ctx: Ctx): Promise<Comment[]> { return (await request<Comment[]>(ctx, "/catalog/comments/recent")) ?? []; }
export async function deleteComment(ctx: Ctx, id: string): Promise<boolean> { return (await request<{ saved: boolean }>(ctx, `/catalog/comment?id=${encodeURIComponent(id)}`, { method: "DELETE" }))?.saved === true; }

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

export async function auditAdminAction(ctx: Ctx, action: string, productId: string, timestamp: number): Promise<void> {
  const adminId = ctx.from?.id;
  if (!adminId) return;
  await request(ctx, "/catalog/audit", {
    method: "PUT",
    body: JSON.stringify({ admin_id: adminId, action, product_id: productId, timestamp }),
  });
}

/** Record a rejected administrative action without granting any mutation. */
export async function auditDeniedAdminAction(ctx: Ctx, action: string, timestamp: number): Promise<void> {
  const actorId = ctx.from?.id;
  if (!actorId) return;
  await request(ctx, "/catalog/audit", {
    method: "PUT",
    body: JSON.stringify({ admin_id: actorId, action: "admin_access_denied", product_id: action.slice(0, 64), timestamp }),
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
