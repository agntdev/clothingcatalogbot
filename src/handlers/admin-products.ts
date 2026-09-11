import { Composer } from "grammy";
import type { AdminProductDraft, Ctx } from "../bot.js";
import { auditAdminAction, categoryTitle, deleteProduct, formatPrice, productById, saveProduct, type CategoryId, type Product } from "../catalog.js";
import { now } from "../clock.js";
import { inlineButton, inlineKeyboard, requireOwner } from "../toolkit/index.js";
import { answerCallback, replaceCallbackMessage } from "../callbacks.js";

const composer = new Composer<Ctx>();

function clearDraft(ctx: Ctx): void {
  ctx.session.adminDraft = undefined;
  ctx.session.adminStep = undefined;
}

async function owner(ctx: Ctx): Promise<boolean> {
  await answerCallback(ctx);
  if (!(await requireOwner(ctx))) return false;
  return true;
}

async function openAdmin(ctx: Ctx): Promise<void> {
  await replaceCallbackMessage(ctx, "Управляйте товарами каталога.", inlineKeyboard([
      [inlineButton("Добавить товар", "admin:add")],
      [inlineButton("В главное меню", "menu:main")],
    ]));
}

async function chooseCategory(ctx: Ctx, edit = false): Promise<void> {
  ctx.session.adminStep = "category";
  const options = {
    reply_markup: inlineKeyboard([
      [inlineButton("Мужская", "admin:category:male"), inlineButton("Женская", "admin:category:female")],
      [inlineButton("Детская", "admin:category:kids")],
      [inlineButton("Назад", "admin:open"), inlineButton("Отмена", "admin:cancel")],
    ]),
  };
  if (edit) await replaceCallbackMessage(ctx, "Выберите категорию товара.", options.reply_markup);
  else await ctx.reply("Выберите категорию товара.", options);
}

async function askPhoto(ctx: Ctx): Promise<void> {
  ctx.session.adminStep = "photo";
  await ctx.reply("Отправьте фото товара.", {
    reply_markup: inlineKeyboard([[inlineButton("Назад", "admin:back")], [inlineButton("Отмена", "admin:cancel")]]),
  });
}

async function askText(ctx: Ctx, step: "title" | "description" | "price"): Promise<void> {
  ctx.session.adminStep = step;
  const prompt = step === "title" ? "Введите название товара." : step === "description" ? "Введите описание товара." : "Введите цену в RUB, например 1999.50.";
  await ctx.reply(prompt, {
    reply_markup: { force_reply: true, input_field_placeholder: step === "price" ? "1999.50" : "Введите текст" },
  });
  await ctx.reply("Можно вернуться или отменить добавление.", {
    reply_markup: inlineKeyboard([[inlineButton("Назад", "admin:back")], [inlineButton("Отмена", "admin:cancel")]]),
  });
}

function completeDraft(draft: AdminProductDraft | undefined): draft is Required<AdminProductDraft> {
  return Boolean(draft?.category_id && draft.photo_file_id_or_url && draft.title && draft.short_description && draft.price_minor_units);
}

async function preview(ctx: Ctx): Promise<void> {
  const draft = ctx.session.adminDraft;
  if (!completeDraft(draft)) {
    clearDraft(ctx);
    await ctx.reply("Не удалось собрать карточку товара. Начните добавление ещё раз.");
    return;
  }
  ctx.session.adminStep = "preview";
  const caption = `${draft.title}\n\n${draft.short_description}\n\n${formatPrice({ id: "", category_id: draft.category_id, photo_file_id_or_url: draft.photo_file_id_or_url, title: draft.title, short_description: draft.short_description, price_minor_units: draft.price_minor_units, currency: "RUB" })}`;
  await ctx.replyWithPhoto(draft.photo_file_id_or_url, {
    caption,
    reply_markup: inlineKeyboard([
      [inlineButton("Подтвердить", "admin:confirm"), inlineButton("Изменить", "admin:edit")],
      [inlineButton("Отмена", "admin:cancel")],
    ]),
  });
}

composer.command("admin", async (ctx) => {
  if (!(await requireOwner(ctx))) return;
  await ctx.reply("Управляйте товарами каталога.", {
    reply_markup: inlineKeyboard([[inlineButton("Добавить товар", "admin:add")], [inlineButton("В главное меню", "menu:main")]]),
  });
});

composer.callbackQuery("admin:open", async (ctx) => { if (await owner(ctx)) await openAdmin(ctx); });
composer.callbackQuery("admin:add", async (ctx) => {
  if (!(await owner(ctx))) return;
  clearDraft(ctx);
  await chooseCategory(ctx, true);
});
composer.callbackQuery(/^admin:category:(male|female|kids)$/, async (ctx) => {
  if (!(await owner(ctx))) return;
  ctx.session.adminDraft = { category_id: ctx.match[1] as Exclude<CategoryId, "all"> };
  await askPhoto(ctx);
});
composer.callbackQuery("admin:cancel", async (ctx) => {
  if (!(await owner(ctx))) return;
  clearDraft(ctx);
  await replaceCallbackMessage(ctx, "Добавление товара отменено.", inlineKeyboard([[inlineButton("К управлению", "admin:open")]]));
});
composer.callbackQuery("admin:edit", async (ctx) => { if (await owner(ctx)) await chooseCategory(ctx, true); });
composer.callbackQuery("admin:back", async (ctx) => {
  if (!(await owner(ctx))) return;
  const step = ctx.session.adminStep;
  if (step === "photo") await chooseCategory(ctx, true);
  else if (step === "title") await askPhoto(ctx);
  else if (step === "description") await askText(ctx, "title");
  else if (step === "price") await askText(ctx, "description");
  else await chooseCategory(ctx, true);
});
composer.callbackQuery("admin:confirm", async (ctx) => {
  if (!(await owner(ctx))) return;
  const draft = ctx.session.adminDraft;
  if (!completeDraft(draft) || !ctx.from) {
    clearDraft(ctx);
    await replaceCallbackMessage(ctx, "Не удалось сохранить товар. Начните добавление ещё раз.");
    return;
  }
  const timestamp = now();
  const product: Product = { id: crypto.randomUUID(), category_id: draft.category_id, category: categoryTitle(draft.category_id) as "Мужская" | "Женская" | "Детская", photo_file_id_or_url: draft.photo_file_id_or_url, photo: draft.photo_file_id_or_url, title: draft.title.trim(), short_description: draft.short_description.trim(), description: draft.short_description.trim(), price_minor_units: draft.price_minor_units, currency: "RUB", created_by_admin_id: ctx.from.id, created_at: timestamp };
  const saved = await saveProduct(ctx, product);
  clearDraft(ctx);
  if (!saved) {
    await replaceCallbackMessage(ctx, "Не удалось сохранить товар. Попробуйте ещё раз.");
    return;
  }
  await auditAdminAction(ctx, "product_added", product.id, timestamp);
  await replaceCallbackMessage(ctx, "Товар сохранён.", inlineKeyboard([[inlineButton("Добавить товар", "admin:add")], [inlineButton("К управлению", "admin:open")]]));
});
composer.callbackQuery(/^admin:delete:([^:]+)$/, async (ctx) => {
  if (!(await owner(ctx))) return;
  const product = await productById(ctx, ctx.match[1]);
  if (!product) { await replaceCallbackMessage(ctx, "Этот товар уже удалён."); return; }
  await replaceCallbackMessage(ctx, `Удалить товар «${product.title}»?`, inlineKeyboard([[inlineButton("Удалить", `admin:delete:yes:${product.id}`), inlineButton("Назад", `product:view:${product.id}`)]]));
});
composer.callbackQuery(/^admin:delete:yes:([^:]+)$/, async (ctx) => {
  if (!(await owner(ctx))) return;
  const id = ctx.match[1];
  const deleted = await deleteProduct(ctx, id);
  if (!deleted) { await replaceCallbackMessage(ctx, "Не удалось удалить товар. Попробуйте ещё раз."); return; }
  await auditAdminAction(ctx, "product_deleted", id, now());
  await replaceCallbackMessage(ctx, "Товар удалён.", inlineKeyboard([[inlineButton("К управлению", "admin:open")]]));
});

composer.on("message", async (ctx, next) => {
  const step = ctx.session.adminStep;
  const draft = ctx.session.adminDraft;
  if (!step || !draft || !ctx.from) return next();
  if (step === "photo") {
    const photo = ctx.message.photo?.at(-1)?.file_id;
    if (!photo) { await ctx.reply("Нужно отправить фото товара. Попробуйте ещё раз."); return; }
    draft.photo_file_id_or_url = photo;
    await askText(ctx, "title");
    return;
  }
  const text = ctx.message.text?.trim();
  if (!text) { await ctx.reply(step === "price" ? "Введите цену числом больше нуля." : "Это поле не может быть пустым. Попробуйте ещё раз."); return; }
  if (step === "title") { draft.title = text; await askText(ctx, "description"); return; }
  if (step === "description") { draft.short_description = text; await askText(ctx, "price"); return; }
  if (step === "price") {
    const normalized = text.replace(",", ".");
    if (!/^\d+(?:\.\d{1,2})?$/.test(normalized) || Number(normalized) <= 0) { await ctx.reply("Введите цену числом больше нуля, например 1999.50."); return; }
    draft.price_minor_units = Math.round(Number(normalized) * 100);
    await preview(ctx);
    return;
  }
  return next();
});

export default composer;
