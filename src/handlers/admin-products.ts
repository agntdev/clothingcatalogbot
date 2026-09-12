import { Composer } from "grammy";
import type { Ctx, AdminCategoryDraft, AdminProductDraft } from "../bot.js";
import { auditAdminAction, auditDeniedAdminAction, categoriesFor, categoryById, clearCartForOwner, deleteCategory, deleteComment, deleteProduct, formatPrice, inquiriesForOwner, markInquiryProcessed, productById, productsFor, recentCommentsForOwner, saveCategory, saveProduct, type Category, type Product } from "../catalog.js";
import { now } from "../clock.js";
import { inlineButton, inlineKeyboard, isOwner, requireOwner } from "../toolkit/index.js";
import { answerCallback, replaceCallbackMessage } from "../callbacks.js";

const composer = new Composer<Ctx>();
const PAGE_SIZE = 8;
type Step = NonNullable<Ctx["session"]["adminStep"]> | "product_sku" | "product_order" | "product_photos" | "category_order" | "search_products";

function rowsMenu() { return [inlineButton("Главное меню", "menu:main")]; }
function back(data: string) { return [inlineButton("Назад", data)]; }
function clear(ctx: Ctx) { ctx.session.adminDraft = undefined; ctx.session.adminCategoryDraft = undefined; ctx.session.adminStep = undefined; ctx.session.adminCategoryTargetId = undefined; ctx.session.adminCategoryParentId = undefined; }
function productDraft(ctx: Ctx) { return ctx.session.adminDraft as (AdminProductDraft & { id?: string; created_at?: number }) | undefined; }
async function guard(ctx: Ctx) {
  if (!isOwner(ctx)) {
    await requireOwner(ctx);
    await auditDeniedAdminAction(ctx, ctx.callbackQuery?.data ?? "admin_message", now());
    return false;
  }
  await answerCallback(ctx);
  return true;
}
function stamp<T extends object>(value: T, ctx: Ctx): T & { updated_by_admin_id: number; updated_at: number } { return { ...value, updated_by_admin_id: ctx.from!.id, updated_at: now() }; }

async function home(ctx: Ctx) {
  await replaceCallbackMessage(ctx, "Управляйте разделами, товарами и заявками.", inlineKeyboard([
    [inlineButton("Разделы", "admin:catalog")], [inlineButton("Товары", "admin:products:all:1")], [inlineButton("Заявки", "admin:inquiries")], [inlineButton("Заказы из корзины", "admin:cart-inquiries")], [inlineButton("Отзывы", "admin:comments")], [inlineButton("Настройки", "admin:settings")], back("menu:main"),
  ]));
}
async function catalog(ctx: Ctx) {
  const roots = await categoriesFor(ctx, null, true);
  await replaceCallbackMessage(ctx, "Разделы каталога.", inlineKeyboard([
    ...roots.map((x) => [inlineButton(`${x.visible === false ? "Скрыт: " : ""}${x.title}`.slice(0, 60), `admin:category:${x.id}`)]),
    [inlineButton("Добавить раздел", "admin:category:add")], [inlineButton("Добавить подраздел", "admin:subcategory:pick:1")], back("admin:open"), rowsMenu(),
  ]));
}
async function categoryCard(ctx: Ctx, id: string) {
  const category = await categoryById(ctx, id);
  if (!category) return catalog(ctx);
  const children = await categoriesFor(ctx, id, true);
  await replaceCallbackMessage(ctx, `${category.title}\n${category.description ?? "Без описания"}\n\n${category.visible === false ? "Скрыт" : "Опубликован"}${category.updated_at ? "\nИзменён администратором" : ""}`, inlineKeyboard([
    ...children.map((x) => [inlineButton(`${x.visible === false ? "Скрыт: " : ""}${x.title}`.slice(0, 60), `admin:category:${x.id}`)]),
    [inlineButton("Переименовать", `admin:category:rename:${id}`), inlineButton("Изменить порядок", `admin:category:order:${id}`)],
    [inlineButton(category.visible === false ? "Опубликовать" : "Скрыть", `admin:category:visible:${id}`)],
    [inlineButton("Переместить", `admin:category:move:${id}`), inlineButton("Удалить", `admin:category:delete:${id}`)],
    [inlineButton("Товары раздела", `admin:products:${id}:1`)], [inlineButton("Добавить подраздел", `admin:subcategory:new:${id}`)], back("admin:catalog"), rowsMenu(),
  ]));
}
async function productList(ctx: Ctx, categoryId: string, requested: number, query = "") {
  const all = await productsFor(ctx, categoryId, true);
  const matched = query ? all.filter((p) => `${p.title} ${p.sku ?? ""}`.toLocaleLowerCase("ru-RU").includes(query.toLocaleLowerCase("ru-RU"))) : all;
  const pages = Math.max(1, Math.ceil(matched.length / PAGE_SIZE));
  const page = Math.max(1, Math.min(requested, pages));
  const title = categoryId === "all" ? "Все товары" : (await categoryById(ctx, categoryId))?.title ?? "Товары";
  const nav = [];
  if (page > 1) nav.push(inlineButton("Предыдущая", `admin:products:${categoryId}:${page - 1}`));
  if (page < pages) nav.push(inlineButton("Далее", `admin:products:${categoryId}:${page + 1}`));
  await replaceCallbackMessage(ctx, matched.length ? `${title} — страница ${page} из ${pages}.` : "Товаров пока нет.", inlineKeyboard([
    ...matched.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((p) => [inlineButton(`${p.visible === false ? "Скрыт: " : ""}${p.title}`.slice(0, 60), `admin:product:${p.id}`)]),
    ...(nav.length ? [nav] : []), [inlineButton("Добавить товар", `admin:product:add:${categoryId === "all" ? "male" : categoryId}`)], [inlineButton("Поиск", "admin:search")], back("admin:open"), rowsMenu(),
  ]));
}
async function productCard(ctx: Ctx, id: string) {
  const p = await productById(ctx, id); if (!p) return productList(ctx, "all", 1);
  await replaceCallbackMessage(ctx, `${p.title}\n\n${formatPrice(p)}\n${p.sku ? `Артикул: ${p.sku}\n` : ""}${p.available === false ? "Нет в наличии\n" : "В наличии\n"}${p.visible === false ? "Скрыт" : "Опубликован"}${p.updated_at ? "\nИзменён администратором" : ""}`, inlineKeyboard([
    [inlineButton("Изменить", `admin:product:edit:${id}`), inlineButton("Фото", `admin:photos:${id}`)],
    [inlineButton("Копировать", `admin:product:copy:${id}`)],
    [inlineButton(p.visible === false ? "Опубликовать" : "Скрыть", `admin:product:visible:${id}`), inlineButton(p.available === false ? "В наличии" : "Нет в наличии", `admin:product:available:${id}`)],
    [inlineButton("Переместить", `admin:product:move:${id}`), inlineButton("Удалить", `admin:product:delete:${id}`)], back("admin:products:all:1"), rowsMenu(),
  ]));
}
async function ask(ctx: Ctx, step: Step, text: string, placeholder = "Введите значение") { ctx.session.adminStep = step as Ctx["session"]["adminStep"]; await ctx.reply(text, { reply_markup: { force_reply: true, input_field_placeholder: placeholder } }); }
async function askProduct(ctx: Ctx, step: "title" | "description" | "price" | "product_sku" | "product_order") {
  const copy = { title: "Введите название товара.", description: "Введите описание товара или /skip.", price: "Введите цену в рублях, например 1999.50.", product_sku: "Введите артикул или /skip.", product_order: "Введите порядок показа числом или /skip." };
  await ask(ctx, step, copy[step], step === "price" ? "1999.50" : "Введите значение");
}
async function photoMenu(ctx: Ctx) { const photos = productDraft(ctx)?.photos ?? []; ctx.session.adminStep = "product_photos"; await ctx.reply(photos.length ? `Добавлено фото: ${photos.length}.` : "Добавьте хотя бы одно фото товара.", { reply_markup: inlineKeyboard([[inlineButton("Добавить фото", "admin:photo:add")], ...photos.map((_, index) => [inlineButton(`Удалить фото ${index + 1}`, `admin:photo:remove:${index}`), ...(index ? [inlineButton("↑", `admin:photo:up:${index}`)] : []), ...(index < photos.length - 1 ? [inlineButton("↓", `admin:photo:down:${index}`)] : [])]), ...(photos.length ? [[inlineButton("Сохранить фото", "admin:photo:done")]] : []), [inlineButton("Отмена", "admin:cancel")]]) }); }
async function finishProduct(ctx: Ctx) {
  const d = productDraft(ctx); if (!d?.title || !d.price_minor_units || !d.category_id || !ctx.from) { clear(ctx); return ctx.reply("Не удалось сохранить товар. Проверьте название и цену."); }
  const photos = d.photos ?? [];
  const product = stamp<Product>({ id: d.id ?? crypto.randomUUID(), category_id: d.category_id, title: d.title, short_description: d.short_description ?? "", price_minor_units: d.price_minor_units, currency: "RUB", photos, photo_file_id_or_url: photos[0], sku: d.sku, visible: d.visible ?? true, available: d.available ?? true, order: d.order, created_by_admin_id: ctx.from.id, created_at: d.created_at ?? now() }, ctx);
  const saved = await saveProduct(ctx, product); await auditAdminAction(ctx, d.id ? "product_updated" : "product_created", product.id, now()); clear(ctx);
  await replaceCallbackMessage(ctx, saved ? "Товар сохранён. Изменения уже видны в каталоге." : "Не удалось сохранить товар. Попробуйте ещё раз.", inlineKeyboard([back("admin:products:all:1"), rowsMenu()]));
}
async function parentPicker(ctx: Ctx, page: number, mode: "new" | "move-category" | "move-product") {
  const roots = await categoriesFor(ctx, null, true);
  const choices = mode === "move-product" ? (await Promise.all(roots.map(async (root) => [root, ...(await categoriesFor(ctx, root.id, true))]))).flat() : roots;
  const pages = Math.max(1, Math.ceil(choices.length / PAGE_SIZE)); const current = Math.max(1, Math.min(page, pages));
  ctx.session.adminCategoryParentId = mode;
  await replaceCallbackMessage(ctx, choices.length ? "Выберите раздел." : "Сначала создайте раздел.", inlineKeyboard([
    ...choices.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE).map((x) => [inlineButton(x.title.slice(0, 60), `admin:parent:${x.id}`)]),
    ...(current > 1 || current < pages ? [[...(current > 1 ? [inlineButton("Предыдущая", `admin:subcategory:pick:${current - 1}`)] : []), ...(current < pages ? [inlineButton("Далее", `admin:subcategory:pick:${current + 1}`)] : [])]] : []), back("admin:catalog"), rowsMenu(),
  ]));
}

composer.callbackQuery("admin:open", async (ctx) => { if (await guard(ctx)) await home(ctx); });
composer.callbackQuery("admin:settings", async (ctx) => { if (await guard(ctx)) await replaceCallbackMessage(ctx, "Уведомления о заявках отправляются в настроенный чат владельца. Валюта каталога — RUB.", inlineKeyboard([back("admin:open"), rowsMenu()])); });
composer.callbackQuery("admin:catalog", async (ctx) => { if (await guard(ctx)) await catalog(ctx); });
composer.callbackQuery(/^admin:category:([^:]+)$/, async (ctx) => { if (await guard(ctx)) await categoryCard(ctx, ctx.match[1]); });
composer.callbackQuery("admin:category:add", async (ctx) => { if (!(await guard(ctx))) return; clear(ctx); ctx.session.adminCategoryDraft = { visible: true }; await ask(ctx, "section_name", "Введите название раздела."); });
composer.callbackQuery(/^admin:subcategory:(?:pick|choose):(\d+)$/, async (ctx) => { if (await guard(ctx)) await parentPicker(ctx, Number(ctx.match[1]), "new"); });
composer.callbackQuery(/^admin:subcategory:new:([^:]+)$/, async (ctx) => { if (!(await guard(ctx))) return; clear(ctx); ctx.session.adminCategoryDraft = { parent_id: ctx.match[1], visible: true }; await ask(ctx, "section_name", "Введите название подраздела."); });
composer.callbackQuery(/^admin:category:rename:([^:]+)$/, async (ctx) => { if (!(await guard(ctx))) return; ctx.session.adminCategoryTargetId = ctx.match[1]; await ask(ctx, "section_rename", "Введите новое название раздела."); });
composer.callbackQuery(/^admin:category:order:([^:]+)$/, async (ctx) => { if (!(await guard(ctx))) return; ctx.session.adminCategoryTargetId = ctx.match[1]; await ask(ctx, "category_order", "Введите порядок показа числом от нуля."); });
composer.callbackQuery(/^admin:category:visible:([^:]+)$/, async (ctx) => { if (!(await guard(ctx))) return; const c = await categoryById(ctx, ctx.match[1]); if (c && ctx.from) { await saveCategory(ctx, stamp({ ...c, visible: c.visible === false }, ctx)); await auditAdminAction(ctx, "category_visibility", c.id, now()); } await categoryCard(ctx, ctx.match[1]); });
composer.callbackQuery(/^admin:category:delete:([^:]+)$/, async (ctx) => { if (!(await guard(ctx))) return; const c = await categoryById(ctx, ctx.match[1]); if (c) await replaceCallbackMessage(ctx, `Удалить раздел «${c.title}»? Это действие нельзя отменить.`, inlineKeyboard([[inlineButton("Удалить", `admin:category:deleteyes:${c.id}`)], back(`admin:category:${c.id}`), rowsMenu()])); });
composer.callbackQuery(/^admin:category:deleteyes:([^:]+)$/, async (ctx) => { if (!(await guard(ctx))) return; const ok = await deleteCategory(ctx, ctx.match[1]); if (ok) await auditAdminAction(ctx, "category_deleted", ctx.match[1], now()); await replaceCallbackMessage(ctx, ok ? "Раздел удалён." : "Раздел нельзя удалить, пока в нём есть товары или подразделы.", inlineKeyboard([back("admin:catalog"), rowsMenu()])); });
composer.callbackQuery(/^admin:category:move:([^:]+)$/, async (ctx) => { if (!(await guard(ctx))) return; ctx.session.adminCategoryTargetId = ctx.match[1]; await parentPicker(ctx, 1, "move-category"); });
composer.callbackQuery(/^admin:products:([^:]+):(\d+)$/, async (ctx) => { if (await guard(ctx)) await productList(ctx, ctx.match[1], Number(ctx.match[2])); });
composer.callbackQuery("admin:search", async (ctx) => { if (await guard(ctx)) await ask(ctx, "search_products", "Введите название или артикул для поиска."); });
composer.callbackQuery(/^admin:product:([^:]+)$/, async (ctx) => { if (await guard(ctx)) await productCard(ctx, ctx.match[1]); });
composer.callbackQuery(/^admin:product:add:([^:]+)$/, async (ctx) => { if (!(await guard(ctx))) return; clear(ctx); ctx.session.adminDraft = { category_id: ctx.match[1], visible: true, available: true, photos: [] }; await askProduct(ctx, "title"); });
composer.callbackQuery(/^admin:product:edit:([^:]+)$/, async (ctx) => { if (!(await guard(ctx))) return; const p = await productById(ctx, ctx.match[1]); if (!p) return productList(ctx, "all", 1); clear(ctx); ctx.session.adminDraft = { ...p, photos: p.photos ?? (p.photo_file_id_or_url ? [p.photo_file_id_or_url] : []) }; await askProduct(ctx, "title"); });
composer.callbackQuery(/^admin:photos:([^:]+)$/, async (ctx) => { if (!(await guard(ctx))) return; const p = await productById(ctx, ctx.match[1]); if (!p) return; clear(ctx); ctx.session.adminDraft = { ...p, photos: p.photos ?? (p.photo_file_id_or_url ? [p.photo_file_id_or_url] : []) }; await photoMenu(ctx); });
composer.callbackQuery(/^admin:product:copy:([^:]+)$/, async (ctx) => { if (!(await guard(ctx))) return; const p = await productById(ctx, ctx.match[1]); if (!p) return; const copy = stamp<Product>({ ...p, id: crypto.randomUUID(), title: `${p.title} (копия)`, created_at: now() }, ctx); await saveProduct(ctx, copy); await auditAdminAction(ctx, "product_duplicated", copy.id, now()); await productCard(ctx, copy.id); });
composer.callbackQuery(/^admin:product:(visible|available):([^:]+)$/, async (ctx) => { if (!(await guard(ctx))) return; const p = await productById(ctx, ctx.match[2]); if (p && ctx.from) { const field = ctx.match[1] as "visible" | "available"; await saveProduct(ctx, stamp({ ...p, [field]: p[field] === false }, ctx)); await auditAdminAction(ctx, `product_${field}`, p.id, now()); } await productCard(ctx, ctx.match[2]); });
composer.callbackQuery(/^admin:product:move:([^:]+)$/, async (ctx) => { if (!(await guard(ctx))) return; ctx.session.adminCategoryTargetId = ctx.match[1]; await parentPicker(ctx, 1, "move-product"); });
composer.callbackQuery(/^admin:product:delete:([^:]+)$/, async (ctx) => { if (!(await guard(ctx))) return; const p = await productById(ctx, ctx.match[1]); if (p) await replaceCallbackMessage(ctx, `Удалить товар «${p.title}»? Это действие нельзя отменить.`, inlineKeyboard([[inlineButton("Удалить", `admin:product:deleteyes:${p.id}`)], back(`admin:product:${p.id}`), rowsMenu()])); });
composer.callbackQuery(/^admin:product:deleteyes:([^:]+)$/, async (ctx) => { if (!(await guard(ctx))) return; const ok = await deleteProduct(ctx, ctx.match[1]); if (ok) await auditAdminAction(ctx, "product_deleted", ctx.match[1], now()); await replaceCallbackMessage(ctx, ok ? "Товар удалён." : "Не удалось удалить товар.", inlineKeyboard([back("admin:products:all:1"), rowsMenu()])); });
composer.callbackQuery("admin:photo:add", async (ctx) => { if (await guard(ctx)) await ask(ctx, "product_photos", "Отправьте фото товара."); });
composer.callbackQuery(/^admin:photo:(remove|up|down):(\d+)$/, async (ctx) => { if (!(await guard(ctx))) return; const d = productDraft(ctx); const index = Number(ctx.match[2]); if (!d?.photos?.[index]) return photoMenu(ctx); if (ctx.match[1] === "remove") d.photos.splice(index, 1); else { const other = ctx.match[1] === "up" ? index - 1 : index + 1; if (d.photos[other]) [d.photos[index], d.photos[other]] = [d.photos[other], d.photos[index]]; } await photoMenu(ctx); });
composer.callbackQuery("admin:photo:done", async (ctx) => { if (await guard(ctx)) await finishProduct(ctx); });
composer.callbackQuery("admin:cancel", async (ctx) => { if (!(await guard(ctx))) return; clear(ctx); await replaceCallbackMessage(ctx, "Изменения отменены.", inlineKeyboard([back("admin:open"), rowsMenu()])); });
composer.callbackQuery("admin:inquiries", async (ctx) => { if (!(await guard(ctx))) return; const list = await inquiriesForOwner(ctx); await replaceCallbackMessage(ctx, list.length ? list.slice(0, 20).map((x) => `• ${x.product_snapshot?.title ?? "Товар"}: ${x.user_display_name} — ${x.message_text || "без сообщения"}`).join("\n") : "Заявок пока нет.", inlineKeyboard([back("admin:open"), rowsMenu()])); });
composer.callbackQuery("admin:cart-inquiries", async (ctx) => {
  if (!(await guard(ctx))) return;
  const list = (await inquiriesForOwner(ctx)).filter((item) => item.kind === "cart").slice(0, 15);
  await replaceCallbackMessage(ctx, list.length ? list.map((item) => `• ${item.user_display_name}: ${(item.cart_snapshot ?? []).map((x) => `${x.title_snapshot} × ${x.qty}`).join(", ")}\nСтатус: ${item.status === "processed" ? "обработан" : "новый"}`).join("\n\n") : "Заказов из корзины пока нет.", inlineKeyboard([
    ...list.flatMap((item) => [[inlineButton("Отметить обработанным", `admin:cart:processed:${item.id}`)], [inlineButton("Очистить корзину покупателя", `admin:cart:clear:${item.user_id}`)]]), back("admin:open"), rowsMenu(),
  ]));
});
composer.callbackQuery(/^admin:cart:processed:([^:]+)$/, async (ctx) => { if (!(await guard(ctx))) return; await markInquiryProcessed(ctx, ctx.match[1]); await replaceCallbackMessage(ctx, "Заказ отмечен как обработанный.", inlineKeyboard([back("admin:cart-inquiries"), rowsMenu()])); });
composer.callbackQuery(/^admin:cart:clear:(-?\d+)$/, async (ctx) => { if (!(await guard(ctx))) return; await clearCartForOwner(ctx, Number(ctx.match[1]), now()); await replaceCallbackMessage(ctx, "Корзина покупателя очищена.", inlineKeyboard([back("admin:cart-inquiries"), rowsMenu()])); });
composer.callbackQuery("admin:comments", async (ctx) => { if (!(await guard(ctx))) return; const list = await recentCommentsForOwner(ctx); await replaceCallbackMessage(ctx, list.length ? list.slice(0, 20).map((item) => `• ${item.user_display_name}: ${item.text}`).join("\n") : "Отзывов пока нет.", inlineKeyboard([...list.slice(0, 20).map((item) => [inlineButton("Удалить отзыв", `admin:comment:delete:${item.id}`), inlineButton("Открыть товар", `product:view:${item.product_id}`)]), back("admin:open"), rowsMenu()])); });
composer.callbackQuery(/^admin:comment:delete:([^:]+)$/, async (ctx) => { if (!(await guard(ctx))) return; const ok = await deleteComment(ctx, ctx.match[1]); await replaceCallbackMessage(ctx, ok ? "Отзыв удалён." : "Отзыв уже удалён.", inlineKeyboard([back("admin:comments"), rowsMenu()])); });
composer.callbackQuery(/^admin:parent:([^:]+)$/, async (ctx) => { if (!(await guard(ctx))) return; const target = ctx.session.adminCategoryTargetId; const mode = ctx.session.adminCategoryParentId; if (mode === "new") { clear(ctx); ctx.session.adminCategoryDraft = { parent_id: ctx.match[1], visible: true }; await ask(ctx, "section_name", "Введите название подраздела."); return; } if (target && mode === "move-category") { const c = await categoryById(ctx, target); if (c && ctx.from && c.id !== ctx.match[1]) { await saveCategory(ctx, stamp({ ...c, parent_id: ctx.match[1] }, ctx)); await auditAdminAction(ctx, "category_moved", c.id, now()); } clear(ctx); return catalog(ctx); } if (target && mode === "move-product") { const p = await productById(ctx, target); if (p && ctx.from) { await saveProduct(ctx, stamp({ ...p, category_id: ctx.match[1] }, ctx)); await auditAdminAction(ctx, "product_moved", p.id, now()); } clear(ctx); return productList(ctx, "all", 1); } });

composer.on("message", async (ctx, next) => {
  const step = ctx.session.adminStep as Step | undefined; if (!step) return next(); if (!isOwner(ctx)) { await requireOwner(ctx); return; }
  const text = ctx.message.text?.trim(); if (text === "/cancel") { clear(ctx); await ctx.reply("Изменения отменены."); return; }
  if (step === "search_products") { ctx.session.adminStep = undefined; return productList(ctx, "all", 1, text ?? ""); }
  if (step === "section_rename") { const c = await categoryById(ctx, ctx.session.adminCategoryTargetId ?? ""); if (!c || !text || !ctx.from) return ctx.reply("Введите название раздела."); await saveCategory(ctx, stamp({ ...c, title: text }, ctx)); await auditAdminAction(ctx, "category_renamed", c.id, now()); ctx.session.adminStep = undefined; return categoryCard(ctx, c.id); }
  if (step === "category_order") { const c = await categoryById(ctx, ctx.session.adminCategoryTargetId ?? ""); const value = Number(text); if (!c || !Number.isInteger(value) || value < 0 || !ctx.from) return ctx.reply("Введите целое число от нуля."); await saveCategory(ctx, stamp({ ...c, order: value, position: value }, ctx)); await auditAdminAction(ctx, "category_reordered", c.id, now()); ctx.session.adminStep = undefined; return categoryCard(ctx, c.id); }
  const cd = ctx.session.adminCategoryDraft as AdminCategoryDraft | undefined;
  if (cd) { if (step === "section_name") { if (!text) return ctx.reply("Введите название раздела."); cd.title = text; return ask(ctx, "section_description", "Введите описание или /skip."); } if (step === "section_description") { cd.description = text === "/skip" ? undefined : text; if (!cd.title || !ctx.from) return; const c = stamp<Category>({ id: cd.id ?? crypto.randomUUID(), title: cd.title, description: cd.description, parent_id: cd.parent_id ?? null, visible: cd.visible ?? true, order: cd.order, created_by_admin_id: ctx.from.id, created_at: now() }, ctx); const ok = await saveCategory(ctx, c); await auditAdminAction(ctx, cd.id ? "category_updated" : "category_created", c.id, now()); clear(ctx); return ctx.reply(ok ? "Раздел сохранён. Изменения уже видны в каталоге." : "Не удалось сохранить раздел."); } }
  const d = productDraft(ctx); if (!d) return next();
  if (step === "title") { if (!text) return ctx.reply("Введите название товара."); d.title = text; return askProduct(ctx, "description"); }
  if (step === "description") { d.short_description = text === "/skip" ? "" : text ?? ""; return askProduct(ctx, "price"); }
  if (step === "price") { const n = Number((text ?? "").replace(",", ".")); if (!Number.isFinite(n) || n <= 0) return ctx.reply("Введите цену числом больше нуля, например 1999.50."); d.price_minor_units = Math.round(n * 100); return askProduct(ctx, "product_sku"); }
  if (step === "product_sku") { d.sku = text === "/skip" ? undefined : text; return askProduct(ctx, "product_order"); }
  if (step === "product_order") { if (text !== "/skip") { const n = Number(text); if (!Number.isInteger(n) || n < 0) return ctx.reply("Введите целое число от нуля или /skip."); d.order = n; } return photoMenu(ctx); }
  if (step === "product_photos") { const photo = ctx.message.photo?.at(-1)?.file_id; if (!photo) return ctx.reply("Отправьте фото товара."); d.photos = [...(d.photos ?? []), photo]; return photoMenu(ctx); }
  return next();
});

export default composer;
