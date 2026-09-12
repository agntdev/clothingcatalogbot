import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { auditAdminAction, categoriesFor, deleteProduct, formatPrice, inquiriesForOwner, productById, productsFor, saveCategory, saveProduct, type Category, type Product } from "../catalog.js";
import { now } from "../clock.js";
import { inlineButton, inlineKeyboard, isOwner, requireOwner } from "../toolkit/index.js";
import { answerCallback, replaceCallbackMessage } from "../callbacks.js";

const composer = new Composer<Ctx>();
type Draft = import("../bot.js").AdminProductDraft & { id?: string; created_at?: number };
function draftState(ctx: Ctx): Draft | undefined { return ctx.session.adminDraft as Draft | undefined; }

async function guard(ctx: Ctx): Promise<boolean> {
  if (!isOwner(ctx)) return requireOwner(ctx);
  await answerCallback(ctx);
  return true;
}
function menu() { return [inlineButton("Главное меню", "menu:main")]; }
function back(data: string) { return [inlineButton("Назад", data)]; }
function clearDraft(ctx: Ctx) { ctx.session.adminDraft = undefined; ctx.session.adminCategoryDraft = undefined; ctx.session.adminStep = undefined; ctx.session.adminCategoryParentId = undefined; ctx.session.adminCategoryPage = undefined; }

async function home(ctx: Ctx) {
  await replaceCallbackMessage(ctx, "Управляйте товарами и заявками каталога.", inlineKeyboard([
    [inlineButton("Разделы", "admin:catalog")], [inlineButton("Товары", "admin:products")], [inlineButton("Заявки", "admin:inquiries")], back("menu:main"), menu(),
  ]));
}
async function categories(ctx: Ctx) {
  const entries = await categoriesFor(ctx);
  await replaceCallbackMessage(ctx, "Выберите категорию товаров.", inlineKeyboard([
    ...entries.map((category) => [inlineButton(category.title, `admin:products:category:${category.id}`)]), back("admin:open"), menu(),
  ]));
}
async function products(ctx: Ctx, categoryId: string) {
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
async function catalogMenu(ctx: Ctx) {
  await replaceCallbackMessage(ctx, "Создавайте разделы и подразделы каталога.", inlineKeyboard([
    [inlineButton("Добавить раздел", "admin:category:add")],
    [inlineButton("Добавить подраздел", "admin:subcategory:choose:1")],
    [inlineButton("Отмена", "admin:cancel")],
  ]));
}
async function parentPicker(ctx: Ctx, wantedPage: number): Promise<void> {
  const parents = await categoriesFor(ctx, null);
  const pages = Math.max(1, Math.ceil(parents.length / 10));
  const page = Math.min(Math.max(1, wantedPage), pages);
  const rows = parents.slice((page - 1) * 10, page * 10).map((category) => [inlineButton(category.title.slice(0, 60), `admin:subcategory:parent:${category.id}`)]);
  const nav = [];
  if (page > 1) nav.push(inlineButton("Предыдущая", `admin:subcategory:choose:${page - 1}`));
  if (page < pages) nav.push(inlineButton("Далее", `admin:subcategory:choose:${page + 1}`));
  if (nav.length) rows.push(nav);
  rows.push(back("admin:catalog"), menu());
  await replaceCallbackMessage(ctx, parents.length ? "Выберите родительский раздел." : "Сначала создайте раздел.", inlineKeyboard(rows));
}
async function askCategoryTitle(ctx: Ctx): Promise<void> {
  ctx.session.adminStep = "section_name";
  await ctx.reply("Введите название раздела:", { reply_markup: { force_reply: true, input_field_placeholder: "Название раздела" } });
}
async function askCategoryDescription(ctx: Ctx): Promise<void> {
  ctx.session.adminStep = "section_description";
  await ctx.reply("Введите описание раздела или отправьте /skip:", { reply_markup: { force_reply: true, input_field_placeholder: "Описание раздела" } });
}
async function askCategoryPhoto(ctx: Ctx): Promise<void> {
  ctx.session.adminStep = "section_photo";
  await ctx.reply("Отправьте фото для раздела или /skip:", { reply_markup: { force_reply: true, input_field_placeholder: "Фото раздела" } });
}
async function categoryPreview(ctx: Ctx): Promise<void> {
  const draft = ctx.session.adminCategoryDraft;
  if (!draft?.title) return;
  ctx.session.adminStep = "section_preview";
  const caption = `${draft.title}${draft.description ? `\n\n${draft.description}` : ""}\n\nПодтвердите создание раздела.`;
  const keyboard = inlineKeyboard([[inlineButton("Подтвердить", "admin:category:save")], [inlineButton("Отмена", "admin:cancel")]]);
  if (draft.image_file_id) await ctx.replyWithPhoto(draft.image_file_id, { caption, reply_markup: keyboard });
  else await ctx.reply(caption, { reply_markup: keyboard });
}
async function preview(ctx: Ctx) {
  const draft = draftState(ctx);
  if (!draft?.title || !draft.short_description || !draft.price_minor_units || !draft.photo_file_id_or_url) { clearDraft(ctx); await ctx.reply("Не удалось собрать карточку товара. Начните ещё раз."); return; }
  ctx.session.adminStep = "preview";
  const card: Product = { id: "", category_id: draft.category_id, photo_file_id_or_url: draft.photo_file_id_or_url, title: draft.title, short_description: draft.short_description, price_minor_units: draft.price_minor_units, currency: "RUB" };
  await ctx.replyWithPhoto(draft.photo_file_id_or_url, { caption: `${draft.title}\n\n${draft.short_description}\n\n${formatPrice(card)}`, reply_markup: inlineKeyboard([[inlineButton("Сохранить", "admin:product:save")], [inlineButton("Отмена", "admin:cancel")], menu()]) });
}

composer.callbackQuery("admin:open", async (ctx) => { if (await guard(ctx)) await home(ctx); });
composer.callbackQuery("admin:catalog", async (ctx) => { if (await guard(ctx)) await catalogMenu(ctx); });
composer.callbackQuery("admin:category:add", async (ctx) => { if (!(await guard(ctx))) return; clearDraft(ctx); ctx.session.adminCategoryDraft = {}; await askCategoryTitle(ctx); });
composer.callbackQuery(/^admin:subcategory:choose:(\d+)$/, async (ctx) => { if (await guard(ctx)) await parentPicker(ctx, Number(ctx.match[1])); });
composer.callbackQuery(/^admin:subcategory:parent:([^:]+)$/, async (ctx) => { if (!(await guard(ctx))) return; const parent = await (async () => (await categoriesFor(ctx, null)).find((category) => category.id === ctx.match[1]))(); if (!parent) { await parentPicker(ctx, 1); return; } clearDraft(ctx); ctx.session.adminCategoryDraft = { parent_id: parent.id }; await askCategoryTitle(ctx); });
composer.callbackQuery("admin:products", async (ctx) => { if (await guard(ctx)) await categories(ctx); });
composer.callbackQuery("admin:inquiries", async (ctx) => { if (!(await guard(ctx))) return; const rows = await inquiriesForOwner(ctx); const text = rows.length ? rows.map((item) => `• ${item.product_snapshot?.title ?? "Товар"}: ${item.user_display_name} — ${item.message_text || "без сообщения"}`).join("\n").slice(0, 3500) : "Заявок пока нет."; await replaceCallbackMessage(ctx, text, inlineKeyboard([back("admin:open"), menu()])); });
composer.callbackQuery(/^admin:products:category:([^:]+)$/, async (ctx) => { if (await guard(ctx)) await products(ctx, ctx.match[1]); });
composer.callbackQuery(/^admin:product:add:([^:]+)$/, async (ctx) => { if (!(await guard(ctx))) return; clearDraft(ctx); ctx.session.adminDraft = { category_id: ctx.match[1] }; await ask(ctx, "photo"); });
composer.callbackQuery(/^admin:product:open:([^:]+)$/, async (ctx) => { if (!(await guard(ctx))) return; const product = await productById(ctx, ctx.match[1]); if (product) await productActions(ctx, product); else await categories(ctx); });
composer.callbackQuery(/^admin:product:edit:([^:]+)$/, async (ctx) => { if (!(await guard(ctx))) return; const product = await productById(ctx, ctx.match[1]); if (!product) return categories(ctx); ctx.session.adminDraft = { ...product, category_id: product.category_id }; await ask(ctx, "photo"); });
composer.callbackQuery(/^admin:product:delete:([^:]+)$/, async (ctx) => { if (!(await guard(ctx))) return; const product = await productById(ctx, ctx.match[1]); if (!product) return categories(ctx); await replaceCallbackMessage(ctx, `Удалить товар «${product.title}»?`, inlineKeyboard([[inlineButton("Удалить", `admin:product:delete:yes:${product.id}`)], back(`admin:product:open:${product.id}`), menu()])); });
composer.callbackQuery(/^admin:product:delete:yes:([^:]+)$/, async (ctx) => { if (!(await guard(ctx))) return; const product = await productById(ctx, ctx.match[1]); const deleted = product && await deleteProduct(ctx, product.id); if (deleted) await auditAdminAction(ctx, "product_deleted", product!.id, now()); await replaceCallbackMessage(ctx, deleted ? "Товар удалён." : "Не удалось удалить товар.", inlineKeyboard([back("admin:products"), menu()])); });
composer.callbackQuery("admin:product:save", async (ctx) => { if (!(await guard(ctx))) return; const draft = draftState(ctx); if (!draft?.title || !draft.short_description || !draft.price_minor_units || !draft.photo_file_id_or_url || !ctx.from) { clearDraft(ctx); await ctx.reply("Не удалось сохранить товар. Начните ещё раз."); return; } const product: Product = { id: draft.id ?? crypto.randomUUID(), category_id: draft.category_id, photo_file_id_or_url: draft.photo_file_id_or_url, title: draft.title, short_description: draft.short_description, price_minor_units: draft.price_minor_units, currency: "RUB", created_by_admin_id: ctx.from.id, created_at: draft.created_at ?? now() }; const saved = await saveProduct(ctx, product); if (saved) await auditAdminAction(ctx, "product_added", product.id, now()); clearDraft(ctx); await replaceCallbackMessage(ctx, saved ? "Товар сохранён." : "Не удалось сохранить товар.", inlineKeyboard([back(`admin:products:category:${product.category_id}`), menu()])); });
composer.callbackQuery("admin:cancel", async (ctx) => { if (!(await guard(ctx))) return; clearDraft(ctx); await replaceCallbackMessage(ctx, "Изменения отменены.", inlineKeyboard([back("admin:open"), menu()])); });
composer.callbackQuery("admin:category:save", async (ctx) => {
  if (!(await guard(ctx))) return;
  const draft = ctx.session.adminCategoryDraft;
  if (!draft?.title || !ctx.from) { clearDraft(ctx); await ctx.reply("Не удалось сохранить раздел. Начните ещё раз."); return; }
  const parent = draft.parent_id ? await (async () => (await categoriesFor(ctx, null)).find((category) => category.id === draft.parent_id))() : undefined;
  const category: Category = { id: crypto.randomUUID(), title: draft.title, slug: draft.title.toLocaleLowerCase("ru-RU").trim().replace(/[^a-zа-яё0-9]+/gi, "-").replace(/^-|-$/g, "") || "section", description: draft.description, image_file_id: draft.image_file_id, parent_id: draft.parent_id ?? null, created_by_admin_id: ctx.from.id, created_at: now() };
  const saved = await saveCategory(ctx, category);
  clearDraft(ctx);
  const kind = parent ? "Подраздел" : "Раздел";
  await replaceCallbackMessage(ctx, saved ? `${kind} '${category.title}' создан.\nID: ${category.id}` : "Не удалось сохранить раздел. Такое название уже есть или данные недоступны.", inlineKeyboard([[inlineButton("К разделам", "admin:catalog")], menu()]));
});
composer.on("message", async (ctx, next) => {
  const step = ctx.session.adminStep;
  if (!step || step === "preview" || step === "section_preview") return next();
  if (!isOwner(ctx)) { await requireOwner(ctx); return; }
  const text = ctx.message.text?.trim();
  if (text === "/cancel") {
    clearDraft(ctx);
    await ctx.reply("Изменения отменены.", { reply_markup: inlineKeyboard([[inlineButton("К разделам", "admin:catalog")], menu()]) });
    return;
  }
  const categoryDraft = ctx.session.adminCategoryDraft;
  if (categoryDraft && ["section_name", "section_description", "section_photo"].includes(step)) {
    if (step === "section_name") {
      if (!text) { await ctx.reply("Введите название раздела."); return; }
      if (text.length > 100) { await ctx.reply("Название должно быть не длиннее 100 символов."); return; }
      categoryDraft.title = text;
      await askCategoryDescription(ctx);
      return;
    }
    if (step === "section_description") {
      if (text === "/skip") { categoryDraft.description = undefined; await askCategoryPhoto(ctx); return; }
      if (!text) { await ctx.reply("Введите описание или отправьте /skip."); return; }
      if (text.length > 2000) { await ctx.reply("Описание должно быть не длиннее 2000 символов."); return; }
      categoryDraft.description = text;
      await askCategoryPhoto(ctx);
      return;
    }
    if (step === "section_photo") {
      if (text === "/skip") { categoryDraft.image_file_id = undefined; await categoryPreview(ctx); return; }
      const photo = ctx.message.photo?.at(-1)?.file_id;
      if (!photo) { await ctx.reply("Отправьте фото раздела или /skip."); return; }
      categoryDraft.image_file_id = photo;
      await categoryPreview(ctx);
      return;
    }
  }
  if (text?.startsWith("/")) return next();
  const draft = draftState(ctx);
  if (!draft) return next();
  if (step === "photo") {
    const photo = ctx.message.photo?.at(-1)?.file_id;
    if (!photo) { await ctx.reply("Отправьте фото товара."); return; }
    draft.photo_file_id_or_url = photo;
    await ask(ctx, "title");
    return;
  }
  if (!text) { await ctx.reply("Введите значение и попробуйте ещё раз."); return; }
  if (step === "title") { draft.title = text; await ask(ctx, "description"); return; }
  if (step === "description") { draft.short_description = text; await ask(ctx, "price"); return; }
  if (step === "price") {
    const price = text.replace(",", ".");
    if (!/^\d+(?:\.\d{1,2})?$/.test(price) || Number(price) <= 0) { await ctx.reply("Введите цену числом больше нуля, например 1999.50."); return; }
    draft.price_minor_units = Math.round(Number(price) * 100);
    await preview(ctx);
  }
});
export default composer;
