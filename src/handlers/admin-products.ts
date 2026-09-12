import { Composer } from "grammy";
import type { AdminCategoryDraft, AdminProductDraft, Ctx } from "../bot.js";
import { categoriesFor, categoryById, createProduct, deleteCategory, deleteProduct, formatPrice, productById, productsFor, saveCategory, saveProduct, type Category, type Product } from "../catalog.js";
import { now } from "../clock.js";
import { inlineButton, inlineKeyboard, isOwner, requireOwner } from "../toolkit/index.js";
import { answerCallback, replaceCallbackMessage } from "../callbacks.js";

const composer = new Composer<Ctx>();
const PAGE_SIZE = 8;
type Draft = AdminProductDraft & { id?: string; created_at?: number; photo_file_id_or_url?: string };

function menu() { return [inlineButton("Главное меню", "menu:main")]; }
function back(data: string) { return inlineButton("Назад", data); }
function reset(ctx: Ctx) { ctx.session.adminDraft = undefined; ctx.session.adminCategoryDraft = undefined; ctx.session.adminStep = undefined; ctx.session.adminCategoryTargetId = undefined; }
async function guard(ctx: Ctx): Promise<boolean> {
  if (isOwner(ctx)) { await answerCallback(ctx); return true; }
  await requireOwner(ctx);
  return false;
}
function draft(ctx: Ctx): Draft | undefined { return ctx.session.adminDraft as Draft | undefined; }
function ask(ctx: Ctx, step: NonNullable<Ctx["session"]["adminStep"]>, text: string, placeholder: string) {
  ctx.session.adminStep = step;
  return ctx.reply(text, { reply_markup: { force_reply: true, input_field_placeholder: placeholder } });
}

async function panel(ctx: Ctx) {
  await replaceCallbackMessage(ctx, "Выберите действие.", inlineKeyboard([
    [inlineButton("➕ Добавить товар", "admin:add")],
    [inlineButton("✏️ Редактировать товар", "admin:edit:list:1")],
    [inlineButton("🗑 Удалить товар", "admin:delete:list:1")],
    [inlineButton("📁 Управление категориями", "admin:categories")],
    [inlineButton("📋 Все товары", "admin:all:1")],
    [back("menu:main")],
  ]));
}

async function categoryPicker(ctx: Ctx, mode: "add" | "edit") {
  const categories = await categoriesFor(ctx, undefined, true);
  await replaceCallbackMessage(ctx, categories.length ? "Выберите категорию товара." : "Сначала создайте категорию.", inlineKeyboard([
    ...categories.map((category) => [inlineButton(category.title.slice(0, 60), `admin:wizard:category:${mode}:${category.id}`)]),
    [back("admin:open")],
  ]));
}

async function allProducts(ctx: Ctx, page: number, mode: "view" | "edit" | "delete") {
  const products = await productsFor(ctx, "all", true);
  const pages = Math.max(1, Math.ceil(products.length / PAGE_SIZE));
  const actual = Math.max(1, Math.min(page, pages));
  const action = mode === "view" ? "admin:product" : `admin:${mode}:product`;
  const nav = [
    ...(actual > 1 ? [inlineButton("Предыдущая", `admin:${mode === "view" ? "all" : mode + ":list"}:${actual - 1}`)] : []),
    ...(actual < pages ? [inlineButton("Далее", `admin:${mode === "view" ? "all" : mode + ":list"}:${actual + 1}`)] : []),
  ];
  await replaceCallbackMessage(ctx, products.length ? `Все товары — страница ${actual} из ${pages}.` : "Товаров пока нет — добавьте первый товар.", inlineKeyboard([
    ...products.slice((actual - 1) * PAGE_SIZE, actual * PAGE_SIZE).map((product) => [inlineButton(`${product.title} — ${formatPrice(product)}`.slice(0, 60), `${action}:${product.id}`)]),
    ...(nav.length ? [nav] : []), [back("admin:open")],
  ]));
}

async function productCard(ctx: Ctx, id: string) {
  const product = await productById(ctx, id);
  if (!product) return allProducts(ctx, 1, "view");
  await replaceCallbackMessage(ctx, `${product.title}\n\n${product.short_description}\n\nЦена: ${formatPrice(product)}${product.photo_file_id_or_url ? "" : "\n\nФото недоступно"}`, inlineKeyboard([
    [inlineButton("✏️ Редактировать товар", `admin:edit:product:${id}`)],
    [inlineButton("🗑 Удалить товар", `admin:delete:product:${id}`)],
    [back("admin:all:1")],
  ]));
}

async function preview(ctx: Ctx) {
  const item = draft(ctx);
  if (!item?.category_id || !item.photos?.[0] || !item.title || !item.short_description || !item.price_minor_units) {
    await ctx.reply("Заполните категорию, фото, название, описание и цену.");
    return;
  }
  ctx.session.adminStep = "preview";
  const previewProduct: Product = { id: item.id ?? "draft", category_id: item.category_id, title: item.title, short_description: item.short_description, price_minor_units: item.price_minor_units, currency: "RUB" };
  await ctx.reply(`${item.title}\n\n${item.short_description}\n\nЦена: ${formatPrice(previewProduct)}`, { reply_markup: inlineKeyboard([[inlineButton("Сохранить товар", "admin:save")], [inlineButton("Отмена", "admin:cancel")]]) });
}

async function saveDraft(ctx: Ctx) {
  const item = draft(ctx);
  if (!item || !ctx.from || !item.category_id || !item.photos?.[0] || !item.title || !item.short_description || !item.price_minor_units) return;
  const productBase: Omit<Product, "id"> = { category_id: item.category_id, photo_file_id_or_url: item.photos[0], photos: item.photos, title: item.title, short_description: item.short_description, price_minor_units: item.price_minor_units, currency: "RUB", visible: true, available: true, created_by_admin_id: ctx.from.id, created_at: item.created_at ?? now(), updated_by_admin_id: ctx.from.id, updated_at: now() };
  const saved = item.id ? await saveProduct(ctx, { ...productBase, id: item.id }) : Boolean(await createProduct(ctx, productBase));
  reset(ctx);
  await replaceCallbackMessage(ctx, saved ? "Товар сохранён. Он уже виден в каталоге." : "Не удалось сохранить товар. Попробуйте ещё раз.", inlineKeyboard([[back("admin:all:1")], menu()]));
}

async function categories(ctx: Ctx) {
  const list = await categoriesFor(ctx, undefined, true);
  await replaceCallbackMessage(ctx, "Управление категориями.", inlineKeyboard([
    ...list.map((category) => [inlineButton(category.title.slice(0, 60), `admin:category:${category.id}`)]),
    [inlineButton("➕ Создать категорию", "admin:category:add")], [back("admin:open")],
  ]));
}

composer.callbackQuery("admin:open", async (ctx) => { if (await guard(ctx)) await panel(ctx); });
composer.callbackQuery("admin:add", async (ctx) => { if (!(await guard(ctx))) return; reset(ctx); ctx.session.adminDraft = { category_id: "", photos: [] }; await categoryPicker(ctx, "add"); });
composer.callbackQuery(/^admin:wizard:category:(add|edit):([^:]+)$/, async (ctx) => { if (!(await guard(ctx))) return; const item = draft(ctx); if (!item) return panel(ctx); item.category_id = ctx.match[2]; await ask(ctx, "photo", "Отправьте фото товара.", "Прикрепите изображение"); });
composer.callbackQuery("admin:all:1", async (ctx) => { if (await guard(ctx)) await allProducts(ctx, 1, "view"); });
composer.callbackQuery(/^admin:all:(\d+)$/, async (ctx) => { if (await guard(ctx)) await allProducts(ctx, Number(ctx.match[1]), "view"); });
composer.callbackQuery(/^admin:product:([^:]+)$/, async (ctx) => { if (await guard(ctx)) await productCard(ctx, ctx.match[1]); });
composer.callbackQuery(/^admin:edit:list:(\d+)$/, async (ctx) => { if (await guard(ctx)) await allProducts(ctx, Number(ctx.match[1]), "edit"); });
composer.callbackQuery(/^admin:edit:product:([^:]+)$/, async (ctx) => { if (!(await guard(ctx))) return; const product = await productById(ctx, ctx.match[1]); if (!product) return allProducts(ctx, 1, "edit"); reset(ctx); ctx.session.adminDraft = { ...product, photos: product.photos?.length ? [...product.photos] : product.photo_file_id_or_url ? [product.photo_file_id_or_url] : [] }; await categoryPicker(ctx, "edit"); });
composer.callbackQuery(/^admin:delete:list:(\d+)$/, async (ctx) => { if (await guard(ctx)) await allProducts(ctx, Number(ctx.match[1]), "delete"); });
composer.callbackQuery(/^admin:delete:product:([^:]+)$/, async (ctx) => { if (!(await guard(ctx))) return; const product = await productById(ctx, ctx.match[1]); if (!product) return allProducts(ctx, 1, "delete"); await replaceCallbackMessage(ctx, `Удалить товар «${product.title}»?`, inlineKeyboard([[inlineButton("🗑 Удалить товар", `admin:delete:confirm:${product.id}`)], [back(`admin:product:${product.id}`)]])); });
composer.callbackQuery(/^admin:delete:confirm:([^:]+)$/, async (ctx) => { if (!(await guard(ctx))) return; const deleted = await deleteProduct(ctx, ctx.match[1]); await replaceCallbackMessage(ctx, deleted ? "Товар удалён." : "Не удалось удалить товар.", inlineKeyboard([[back("admin:all:1")], menu()])); });
composer.callbackQuery("admin:categories", async (ctx) => { if (await guard(ctx)) await categories(ctx); });
composer.callbackQuery("admin:category:add", async (ctx) => { if (!(await guard(ctx))) return; reset(ctx); ctx.session.adminCategoryDraft = { visible: true }; await ask(ctx, "section_name", "Введите название категории.", "Название категории"); });
composer.callbackQuery(/^admin:category:([^:]+)$/, async (ctx) => { if (!(await guard(ctx))) return; const category = await categoryById(ctx, ctx.match[1]); if (!category) return categories(ctx); await replaceCallbackMessage(ctx, category.title, inlineKeyboard([[inlineButton("🗑 Удалить категорию", `admin:category:delete:${category.id}`)], [back("admin:categories")]])); });
composer.callbackQuery(/^admin:category:delete:([^:]+)$/, async (ctx) => { if (!(await guard(ctx))) return; const deleted = await deleteCategory(ctx, ctx.match[1]); await replaceCallbackMessage(ctx, deleted ? "Категория удалена." : "Категорию нельзя удалить, пока в ней есть товары.", inlineKeyboard([[back("admin:categories")]])); });
composer.callbackQuery("admin:save", async (ctx) => { if (await guard(ctx)) await saveDraft(ctx); });
composer.callbackQuery("admin:cancel", async (ctx) => { if (!(await guard(ctx))) return; reset(ctx); await replaceCallbackMessage(ctx, "Изменения отменены.", inlineKeyboard([[back("admin:open")]])); });
// Every administrative callback is denied even if it is stale or an old deep
// link from an earlier panel version. This keeps management inaccessible to
// shoppers without leaking a route that happens to be absent from the menu.
composer.callbackQuery(/^admin:/, async (ctx) => {
  if (!(await guard(ctx))) return;
  await replaceCallbackMessage(ctx, "Это действие больше недоступно.", inlineKeyboard([[back("admin:open")]]));
});

composer.on("message", async (ctx, next) => {
  const step = ctx.session.adminStep; if (!step) return next();
  if (!isOwner(ctx)) { await requireOwner(ctx); return; }
  if (ctx.message.text?.trim() === "/cancel") { reset(ctx); await ctx.reply("Изменения отменены."); return; }
  const item = draft(ctx);
  if (step === "section_name") {
    const title = ctx.message.text?.trim(); if (!title || !ctx.from) { await ctx.reply("Введите название категории."); return; }
    const category: Category = { id: crypto.randomUUID(), title, visible: true, created_by_admin_id: ctx.from.id, created_at: now(), updated_by_admin_id: ctx.from.id, updated_at: now() };
    const saved = await saveCategory(ctx, category); reset(ctx); await ctx.reply(saved ? "Категория создана." : "Не удалось создать категорию."); return;
  }
  if (!item) return next();
  if (step === "photo") { const photo = ctx.message.photo?.at(-1)?.file_id; if (!photo) { await ctx.reply("Отправьте изображение товара."); return; } item.photos = [photo]; item.photo_file_id_or_url = photo; await ask(ctx, "title", "Введите название товара.", "Название товара"); return; }
  const text = ctx.message.text?.trim();
  if (step === "title") { if (!text) { await ctx.reply("Введите название товара."); return; } item.title = text; await ask(ctx, "description", "Введите описание товара.", "Описание товара"); return; }
  if (step === "description") { if (!text) { await ctx.reply("Введите описание товара."); return; } item.short_description = text; await ask(ctx, "price", "Введите цену в рублях, например 1999.50.", "1999.50"); return; }
  if (step === "price") { const value = Number((text ?? "").replace(",", ".")); if (!Number.isFinite(value) || value <= 0) { await ctx.reply("Введите цену числом больше нуля."); return; } item.price_minor_units = Math.round(value * 100); await preview(ctx); return; }
  return next();
});

export default composer;
