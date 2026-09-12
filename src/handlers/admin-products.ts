import { Composer } from "grammy";
import type { AdminProductDraft, Ctx } from "../bot.js";
import { auditAdminAction, categoriesFor, categoryById, deleteCategory, deleteProduct, formatPrice, inquiriesForOwner, productById, productsFor, saveCategory, saveProduct, type Category, type Product } from "../catalog.js";
import { now } from "../clock.js";
import { inlineButton, inlineKeyboard, isOwner, requireOwner } from "../toolkit/index.js";
import { answerCallback, replaceCallbackMessage } from "../callbacks.js";

const composer = new Composer<Ctx>();
type Draft = Omit<AdminProductDraft, "category_id"> & { id?: string; existing?: boolean; category_id: string };
type AdminSession = Omit<Ctx["session"], "adminDraft" | "adminCategoryParentId" | "adminCategoryTargetId" | "adminStep"> & { adminDraft?: Draft; adminCategoryParentId?: string; adminCategoryTargetId?: string; adminStep?: string };
const state = (ctx: Ctx): AdminSession => ctx.session as AdminSession;

async function guard(ctx: Ctx): Promise<boolean> {
  if (!isOwner(ctx)) return requireOwner(ctx);
  await answerCallback(ctx);
  return true;
}
function clear(ctx: Ctx) { state(ctx).adminDraft = undefined; state(ctx).adminStep = undefined; }
function back(label: string, data: string) { return [inlineButton(label, data)]; }
function mainMenu() { return [inlineButton("Главное меню", "menu:main")]; }

async function home(ctx: Ctx) {
  await replaceCallbackMessage(ctx, "Управляйте разделами и товарами каталога.", inlineKeyboard([
    [inlineButton("Разделы", "admin:categories")],
    [inlineButton("Товары", "admin:products")],
    [inlineButton("Заявки", "admin:inquiries")],
    [inlineButton("Назад", "menu:main")],
    mainMenu(),
  ]));
}

async function categoryList(ctx: Ctx, parentId?: string) {
  state(ctx).adminCategoryParentId = parentId;
  const entries = await categoriesFor(ctx, parentId);
  const rows = entries.map((item) => [inlineButton(item.title, `admin:category:open:${item.id}`)]);
  rows.push([inlineButton(parentId ? "Добавить подраздел" : "Добавить раздел", "admin:category:add")]);
  rows.push(back("Назад", parentId ? `admin:category:open:${parentId}` : "admin:open"));
  rows.push(mainMenu());
  await replaceCallbackMessage(ctx, parentId ? "Выберите подраздел или добавьте новый." : "Выберите раздел или добавьте новый.", inlineKeyboard(rows));
}

async function categoryActions(ctx: Ctx, item: Category) {
  state(ctx).adminCategoryTargetId = item.id;
  await replaceCallbackMessage(ctx, `Раздел «${item.title}».`, inlineKeyboard([
    [inlineButton("Переименовать", "admin:category:rename")],
    [inlineButton("Добавить подраздел", "admin:category:add:child")],
    [inlineButton("Удалить", "admin:category:delete")],
    back("Назад", item.parent_id ? `admin:category:open:${item.parent_id}` : "admin:categories"),
    mainMenu(),
  ]));
}

async function productCategories(ctx: Ctx, parentId?: string) {
  state(ctx).adminCategoryParentId = parentId;
  const entries = await categoriesFor(ctx, parentId);
  const rows = entries.map((item) => [inlineButton(item.title, `admin:products:category:${item.id}`)]);
  rows.push(back("Назад", parentId ? `admin:products:category:${parentId}` : "admin:open"));
  rows.push(mainMenu());
  await replaceCallbackMessage(ctx, "Выберите раздел с товарами.", inlineKeyboard(rows));
}

async function productList(ctx: Ctx, categoryId: string) {
  const [category, children, products] = await Promise.all([categoryById(ctx, categoryId), categoriesFor(ctx, categoryId), productsFor(ctx, categoryId)]);
  const direct = products.filter((p) => p.category_id === categoryId);
  const rows = children.map((child) => [inlineButton(child.title, `admin:products:category:${child.id}`)]);
  rows.push(...direct.map((product) => [inlineButton(product.title, `admin:product:open:${product.id}`)]));
  rows.push([inlineButton("Добавить товар", `admin:product:add:${categoryId}`)]);
  rows.push(back("Назад", category?.parent_id ? `admin:products:category:${category.parent_id}` : "admin:products"));
  rows.push(mainMenu());
  await replaceCallbackMessage(ctx, direct.length || children.length ? `Товары раздела «${category?.title ?? "Каталог"}».` : "В этом разделе пока нет товаров.", inlineKeyboard(rows));
}

async function productActions(ctx: Ctx, product: Product) {
  await replaceCallbackMessage(ctx, `${product.title}\n\n${formatPrice(product)}`, inlineKeyboard([
    [inlineButton("Изменить", `admin:product:edit:${product.id}`)],
    [inlineButton("Удалить", `admin:product:delete:${product.id}`)],
    back("Назад", `admin:products:category:${product.category_id}`),
    mainMenu(),
  ]));
}

async function askPhoto(ctx: Ctx) {
  state(ctx).adminStep = "photo";
  const keep = state(ctx).adminDraft?.photo_file_id_or_url ? [[inlineButton("Оставить текущее фото", "admin:photo:keep")]] : [];
  await ctx.reply("Отправьте фото товара.", { reply_markup: inlineKeyboard([...keep, [inlineButton("Отмена", "admin:cancel")], mainMenu()]) });
}
async function ask(ctx: Ctx, step: "title" | "description" | "price") {
  state(ctx).adminStep = step;
  const text = step === "title" ? "Введите название товара." : step === "description" ? "Введите описание товара." : "Введите цену в рублях, например 1999.50.";
  await ctx.reply(text, { reply_markup: { force_reply: true, input_field_placeholder: step === "price" ? "1999.50" : "Введите текст" } });
}
async function preview(ctx: Ctx) {
  const draft = state(ctx).adminDraft;
  if (!draft?.title || !draft.short_description || !draft.price_minor_units || !draft.photo_file_id_or_url) { clear(ctx); await ctx.reply("Не удалось собрать карточку товара. Начните ещё раз."); return; }
  state(ctx).adminStep = "preview";
  const product = { ...draft, id: draft.id ?? "", currency: "RUB" } as Product;
  await ctx.replyWithPhoto(draft.photo_file_id_or_url, { caption: `${draft.title}\n\n${draft.short_description}\n\n${formatPrice(product)}`, reply_markup: inlineKeyboard([[inlineButton("Сохранить", "admin:product:save")], [inlineButton("Отмена", "admin:cancel")], mainMenu()]) });
}

composer.callbackQuery("admin:open", async (ctx) => { if (await guard(ctx)) await home(ctx); });
composer.callbackQuery("admin:categories", async (ctx) => { if (await guard(ctx)) await categoryList(ctx); });
composer.callbackQuery(/^admin:category:open:([^:]+)$/, async (ctx) => { if (!(await guard(ctx))) return; const item = await categoryById(ctx, ctx.match[1]); if (item) await categoryActions(ctx, item); else await categoryList(ctx); });
composer.callbackQuery("admin:category:add", async (ctx) => { if (!(await guard(ctx))) return; state(ctx).adminCategoryParentId = undefined; state(ctx).adminStep = "category_add"; await ctx.reply("Введите название раздела.", { reply_markup: { force_reply: true, input_field_placeholder: "Название раздела" } }); });
composer.callbackQuery("admin:category:add:child", async (ctx) => { if (!(await guard(ctx))) return; state(ctx).adminCategoryParentId = state(ctx).adminCategoryTargetId; state(ctx).adminStep = "category_add"; await ctx.reply("Введите название подраздела.", { reply_markup: { force_reply: true, input_field_placeholder: "Название подраздела" } }); });
composer.callbackQuery("admin:category:rename", async (ctx) => { if (!(await guard(ctx))) return; state(ctx).adminStep = "category_rename"; await ctx.reply("Введите новое название раздела.", { reply_markup: { force_reply: true, input_field_placeholder: "Новое название" } }); });
composer.callbackQuery("admin:category:delete", async (ctx) => { if (!(await guard(ctx))) return; const id = state(ctx).adminCategoryTargetId; if (!id) return categoryList(ctx); const deleted = await deleteCategory(ctx, id); await replaceCallbackMessage(ctx, deleted ? "Раздел удалён." : "Нельзя удалить раздел с товарами или подразделами.", inlineKeyboard([back("К разделам", "admin:categories"), mainMenu()])); });

composer.callbackQuery("admin:products", async (ctx) => { if (await guard(ctx)) await productCategories(ctx); });
composer.callbackQuery("admin:inquiries", async (ctx) => { if (!(await guard(ctx))) return; const inquiries = await inquiriesForOwner(ctx); const text = inquiries.length ? inquiries.map((item) => `• ${item.product_snapshot?.title ?? "Товар"}: ${item.user_display_name} — ${item.message_text || "без сообщения"}`).join("\n").slice(0, 3500) : "Заявок пока нет."; await replaceCallbackMessage(ctx, text, inlineKeyboard([back("Назад", "admin:open"), mainMenu()])); });
composer.callbackQuery(/^admin:products:category:([^:]+)$/, async (ctx) => { if (await guard(ctx)) await productList(ctx, ctx.match[1]); });
composer.callbackQuery(/^admin:product:add:([^:]+)$/, async (ctx) => { if (!(await guard(ctx))) return; clear(ctx); state(ctx).adminDraft = { category_id: ctx.match[1] }; await askPhoto(ctx); });
composer.callbackQuery(/^admin:product:open:([^:]+)$/, async (ctx) => { if (!(await guard(ctx))) return; const product = await productById(ctx, ctx.match[1]); if (product) await productActions(ctx, product); else await productCategories(ctx); });
composer.callbackQuery(/^admin:product:edit:([^:]+)$/, async (ctx) => { if (!(await guard(ctx))) return; const product = await productById(ctx, ctx.match[1]); if (!product) return productCategories(ctx); state(ctx).adminDraft = { ...product, existing: true }; await askPhoto(ctx); });
composer.callbackQuery("admin:photo:keep", async (ctx) => { if (await guard(ctx)) await ask(ctx, "title"); });
composer.callbackQuery(/^admin:product:delete:([^:]+)$/, async (ctx) => { if (!(await guard(ctx))) return; const product = await productById(ctx, ctx.match[1]); if (!product) return productCategories(ctx); await replaceCallbackMessage(ctx, `Удалить товар «${product.title}»?`, inlineKeyboard([[inlineButton("Удалить", `admin:product:delete:yes:${product.id}`)], back("Назад", `admin:product:open:${product.id}`), mainMenu()])); });
composer.callbackQuery(/^admin:product:delete:yes:([^:]+)$/, async (ctx) => { if (!(await guard(ctx))) return; const id = ctx.match[1]; const deleted = await deleteProduct(ctx, id); if (deleted) await auditAdminAction(ctx, "product_deleted", id, now()); await replaceCallbackMessage(ctx, deleted ? "Товар удалён." : "Не удалось удалить товар.", inlineKeyboard([back("К товарам", "admin:products"), mainMenu()])); });
composer.callbackQuery("admin:product:save", async (ctx) => { if (!(await guard(ctx))) return; const draft = state(ctx).adminDraft; if (!draft?.title || !draft.short_description || !draft.price_minor_units || !draft.photo_file_id_or_url || !ctx.from) { clear(ctx); await ctx.reply("Не удалось сохранить товар. Начните ещё раз.", { reply_markup: inlineKeyboard([mainMenu()]) }); return; } const product: Product = { id: draft.id ?? crypto.randomUUID(), category_id: draft.category_id, photo_file_id_or_url: draft.photo_file_id_or_url, title: draft.title, short_description: draft.short_description, price_minor_units: draft.price_minor_units, currency: "RUB", created_by_admin_id: ctx.from.id, created_at: draft.existing ? undefined : now() }; const saved = await saveProduct(ctx, product); if (saved) await auditAdminAction(ctx, "product_added", product.id, now()); clear(ctx); await replaceCallbackMessage(ctx, saved ? "Товар сохранён." : "Не удалось сохранить товар.", inlineKeyboard([back("К товарам", `admin:products:category:${product.category_id}`), mainMenu()])); });
composer.callbackQuery("admin:cancel", async (ctx) => { if (!(await guard(ctx))) return; clear(ctx); await replaceCallbackMessage(ctx, "Изменения отменены.", inlineKeyboard([back("К управлению", "admin:open"), mainMenu()])); });

composer.on("message", async (ctx, next) => {
  const s = state(ctx); const step = s.adminStep;
  if (!step) return next();
  // Commands must keep their normal meaning even when an owner leaves a draft open.
  if (ctx.message.text?.startsWith("/")) return next();
  if (!isOwner(ctx)) { await requireOwner(ctx); return; }
  if (step === "photo") { const photo = ctx.message.photo?.at(-1)?.file_id; if (!photo) { await ctx.reply("Отправьте фото товара или оставьте текущее."); return; } if (s.adminDraft) s.adminDraft.photo_file_id_or_url = photo; await ask(ctx, "title"); return; }
  const value = ctx.message.text?.trim();
  if (!value) { await ctx.reply("Введите значение и попробуйте ещё раз."); return; }
  if (step === "category_add" || step === "category_rename") { if (value.length > 60) { await ctx.reply("Название должно быть не длиннее 60 символов."); return; } if (step === "category_add") await saveCategory(ctx, { id: crypto.randomUUID(), title: value, parent_id: s.adminCategoryParentId }); else { const old = s.adminCategoryTargetId && await categoryById(ctx, s.adminCategoryTargetId); if (old) await saveCategory(ctx, { ...old, title: value }); } s.adminStep = undefined; await categoryList(ctx, s.adminCategoryParentId); return; }
  const draft = s.adminDraft; if (!draft) return next();
  if (step === "title") { draft.title = value; await ask(ctx, "description"); return; }
  if (step === "description") { draft.short_description = value; await ask(ctx, "price"); return; }
  if (step === "price") { const n = value.replace(",", "."); if (!/^\d+(?:\.\d{1,2})?$/.test(n) || Number(n) <= 0) { await ctx.reply("Введите цену числом больше нуля, например 1999.50."); return; } draft.price_minor_units = Math.round(Number(n) * 100); await preview(ctx); return; }
  return next();
});

export default composer;
