import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { auditAdminAction, categoriesFor, deleteProduct, formatPrice, inquiriesForOwner, productById, productsFor, saveProduct, type Product } from "../catalog.js";
import { now } from "../clock.js";
import { inlineButton, inlineKeyboard, isOwner, requireOwner } from "../toolkit/index.js";
import { answerCallback, replaceCallbackMessage } from "../callbacks.js";

const composer = new Composer<Ctx>();
const roots = ["clothes", "shoes", "accessories"] as const;
type Root = typeof roots[number];
type Draft = import("../bot.js").AdminProductDraft & { id?: string; created_at?: number };
function draftState(ctx: Ctx): Draft | undefined { return ctx.session.adminDraft as Draft | undefined; }

async function guard(ctx: Ctx): Promise<boolean> {
  if (!isOwner(ctx)) return requireOwner(ctx);
  await answerCallback(ctx);
  return true;
}
function menu() { return [inlineButton("Главное меню", "menu:main")]; }
function back(data: string) { return [inlineButton("Назад", data)]; }
function clearDraft(ctx: Ctx) { ctx.session.adminDraft = undefined; ctx.session.adminStep = undefined; }

async function home(ctx: Ctx) {
  await replaceCallbackMessage(ctx, "Управляйте товарами и заявками каталога.", inlineKeyboard([
    [inlineButton("Товары", "admin:products")], [inlineButton("Заявки", "admin:inquiries")], back("menu:main"), menu(),
  ]));
}
async function categories(ctx: Ctx) {
  const entries = await categoriesFor(ctx);
  await replaceCallbackMessage(ctx, "Выберите категорию товаров.", inlineKeyboard([
    ...entries.map((category) => [inlineButton(category.title, `admin:products:category:${category.id}`)]), back("admin:open"), menu(),
  ]));
}
async function products(ctx: Ctx, categoryId: Root) {
  const productsInCategory = await productsFor(ctx, categoryId);
  await replaceCallbackMessage(ctx, productsInCategory.length ? "Выберите товар или добавьте новый." : "В этой категории пока нет товаров.", inlineKeyboard([
    ...productsInCategory.slice(0, 50).map((product) => [inlineButton(product.title, `admin:product:open:${product.id}`)]),
    [inlineButton("Добавить товар", `admin:product:add:${categoryId}`)], back("admin:products"), menu(),
  ]));
}
async function productActions(ctx: Ctx, product: Product) {
  await replaceCallbackMessage(ctx, `${product.title}\n\n${formatPrice(product)}`, inlineKeyboard([
    [inlineButton("Изменить", `admin:product:edit:${product.id}`)], [inlineButton("Удалить", `admin:product:delete:${product.id}`)], back(`admin:products:category:${product.category_id}`), menu(),
  ]));
}
async function ask(ctx: Ctx, step: "photo" | "title" | "description" | "price") {
  ctx.session.adminStep = step;
  const text = step === "photo" ? "Отправьте фото товара." : step === "title" ? "Введите название товара." : step === "description" ? "Введите описание товара." : "Введите цену в рублях, например 1999.50.";
  await ctx.reply(text, { reply_markup: { force_reply: true, input_field_placeholder: step === "price" ? "1999.50" : "Введите текст" } });
}
async function preview(ctx: Ctx) {
  const draft = draftState(ctx);
  if (!draft?.title || !draft.short_description || !draft.price_minor_units || !draft.photo_file_id_or_url) { clearDraft(ctx); await ctx.reply("Не удалось собрать карточку товара. Начните ещё раз."); return; }
  ctx.session.adminStep = "preview";
  const card: Product = { id: "", category_id: draft.category_id, photo_file_id_or_url: draft.photo_file_id_or_url, title: draft.title, short_description: draft.short_description, price_minor_units: draft.price_minor_units, currency: "RUB" };
  await ctx.replyWithPhoto(draft.photo_file_id_or_url, { caption: `${draft.title}\n\n${draft.short_description}\n\n${formatPrice(card)}`, reply_markup: inlineKeyboard([[inlineButton("Сохранить", "admin:product:save")], [inlineButton("Отмена", "admin:cancel")], menu()]) });
}

composer.callbackQuery("admin:open", async (ctx) => { if (await guard(ctx)) await home(ctx); });
composer.callbackQuery("admin:products", async (ctx) => { if (await guard(ctx)) await categories(ctx); });
composer.callbackQuery("admin:inquiries", async (ctx) => { if (!(await guard(ctx))) return; const rows = await inquiriesForOwner(ctx); const text = rows.length ? rows.map((item) => `• ${item.product_snapshot?.title ?? "Товар"}: ${item.user_display_name} — ${item.message_text || "без сообщения"}`).join("\n").slice(0, 3500) : "Заявок пока нет."; await replaceCallbackMessage(ctx, text, inlineKeyboard([back("admin:open"), menu()])); });
composer.callbackQuery(/^admin:products:category:(clothes|shoes|accessories)$/, async (ctx) => { if (await guard(ctx)) await products(ctx, ctx.match[1] as Root); });
composer.callbackQuery(/^admin:product:add:(clothes|shoes|accessories)$/, async (ctx) => { if (!(await guard(ctx))) return; clearDraft(ctx); ctx.session.adminDraft = { category_id: ctx.match[1] as Root }; await ask(ctx, "photo"); });
composer.callbackQuery(/^admin:product:open:([^:]+)$/, async (ctx) => { if (!(await guard(ctx))) return; const product = await productById(ctx, ctx.match[1]); if (product) await productActions(ctx, product); else await categories(ctx); });
composer.callbackQuery(/^admin:product:edit:([^:]+)$/, async (ctx) => { if (!(await guard(ctx))) return; const product = await productById(ctx, ctx.match[1]); if (!product) return categories(ctx); ctx.session.adminDraft = { ...product, category_id: product.category_id as Root }; await ask(ctx, "photo"); });
composer.callbackQuery(/^admin:product:delete:([^:]+)$/, async (ctx) => { if (!(await guard(ctx))) return; const product = await productById(ctx, ctx.match[1]); if (!product) return categories(ctx); await replaceCallbackMessage(ctx, `Удалить товар «${product.title}»?`, inlineKeyboard([[inlineButton("Удалить", `admin:product:delete:yes:${product.id}`)], back(`admin:product:open:${product.id}`), menu()])); });
composer.callbackQuery(/^admin:product:delete:yes:([^:]+)$/, async (ctx) => { if (!(await guard(ctx))) return; const product = await productById(ctx, ctx.match[1]); const deleted = product && await deleteProduct(ctx, product.id); if (deleted) await auditAdminAction(ctx, "product_deleted", product!.id, now()); await replaceCallbackMessage(ctx, deleted ? "Товар удалён." : "Не удалось удалить товар.", inlineKeyboard([back("admin:products"), menu()])); });
composer.callbackQuery("admin:product:save", async (ctx) => { if (!(await guard(ctx))) return; const draft = draftState(ctx); if (!draft?.title || !draft.short_description || !draft.price_minor_units || !draft.photo_file_id_or_url || !ctx.from) { clearDraft(ctx); await ctx.reply("Не удалось сохранить товар. Начните ещё раз."); return; } const product: Product = { id: draft.id ?? crypto.randomUUID(), category_id: draft.category_id, photo_file_id_or_url: draft.photo_file_id_or_url, title: draft.title, short_description: draft.short_description, price_minor_units: draft.price_minor_units, currency: "RUB", created_by_admin_id: ctx.from.id, created_at: draft.created_at ?? now() }; const saved = await saveProduct(ctx, product); if (saved) await auditAdminAction(ctx, "product_added", product.id, now()); clearDraft(ctx); await replaceCallbackMessage(ctx, saved ? "Товар сохранён." : "Не удалось сохранить товар.", inlineKeyboard([back(`admin:products:category:${product.category_id}`), menu()])); });
composer.callbackQuery("admin:cancel", async (ctx) => { if (!(await guard(ctx))) return; clearDraft(ctx); await replaceCallbackMessage(ctx, "Изменения отменены.", inlineKeyboard([back("admin:open"), menu()])); });
composer.on("message", async (ctx, next) => { const step = ctx.session.adminStep; if (!step || step === "preview") return next(); if (ctx.message.text?.startsWith("/")) return next(); if (!isOwner(ctx)) { await requireOwner(ctx); return; } const draft = draftState(ctx); if (!draft) return next(); if (step === "photo") { const photo = ctx.message.photo?.at(-1)?.file_id; if (!photo) { await ctx.reply("Отправьте фото товара."); return; } draft.photo_file_id_or_url = photo; await ask(ctx, "title"); return; } const value = ctx.message.text?.trim(); if (!value) { await ctx.reply("Введите значение и попробуйте ещё раз."); return; } if (step === "title") { draft.title = value; await ask(ctx, "description"); return; } if (step === "description") { draft.short_description = value; await ask(ctx, "price"); return; } if (step === "price") { const price = value.replace(",", "."); if (!/^\d+(?:\.\d{1,2})?$/.test(price) || Number(price) <= 0) { await ctx.reply("Введите цену числом больше нуля, например 1999.50."); return; } draft.price_minor_units = Math.round(Number(price) * 100); await preview(ctx); } });
export default composer;
