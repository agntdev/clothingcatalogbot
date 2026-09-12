import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { categoryTitle, commentsFor, formatPrice, productById, productPhotos } from "../catalog.js";
import { inlineButton, inlineKeyboard, isOwner } from "../toolkit/index.js";
import { answerCallback, replaceCallbackMessage } from "../callbacks.js";
import { pushView } from "../navigation.js";

const composer = new Composer<Ctx>();

composer.callbackQuery(/^product:view:([^:]+)/, async (ctx) => {
  await answerCallback(ctx);
  const product = await productById(ctx, ctx.match[1]);
  if (!product) {
    await replaceCallbackMessage(ctx, "Этот товар больше недоступен. Выберите другой товар в каталоге.", inlineKeyboard([[inlineButton("Главное меню", "menu:main")]]));
    return;
  }
  pushView(ctx, { kind: "product", productId: product.id, categoryId: ctx.session.catalogCategory, page: ctx.session.catalogPage });
  if (product.visible === false && !isOwner(ctx)) {
    await replaceCallbackMessage(ctx, "Этот товар больше недоступен. Выберите другой товар в каталоге.", inlineKeyboard([[inlineButton("Главное меню", "menu:main")]]));
    return;
  }
  const photos = productPhotos(product);
  const comments = await commentsFor(ctx, product.id);
  const commentPreview = comments.items.length ? `\n\nОтзывы\n${comments.items.map((item) => `• ${item.user_display_name}: ${item.text}`).join("\n")}` : "\n\nОтзывы: пока нет.";
  const text = `${product.title}\n\n${product.short_description}\n\nКатегория: ${categoryTitle(product.category_id)}\nЦена: ${formatPrice(product)}${photos.length ? "" : "\n\nФото недоступно"}${commentPreview}`;
  const rows = [[inlineButton("Добавить в корзину", `cart:add:${product.id}`)], [inlineButton("Задать вопрос", `inquiry:start:${product.id}`)], [inlineButton("Отзывы", `comment:show:${product.id}`), inlineButton("Корзина", "cart:open")], [inlineButton("Назад", "catalog:back")], [inlineButton("Главное меню", "menu:main")]];
  if (isOwner(ctx)) rows.splice(1, 0, [inlineButton("Удалить товар", `admin:product:delete:${product.id}`)]);
  const keyboard = inlineKeyboard(rows);
  // A text message cannot be converted to media with editMessageText. Replace
  // it with the product photo so the catalogue remains a single active view.
  if (photos[0] && ctx.callbackQuery.message && !("photo" in ctx.callbackQuery.message)) {
    try { await ctx.deleteMessage(); } catch { /* old messages may be immutable */ }
    await ctx.replyWithPhoto(photos[0], { caption: text, reply_markup: keyboard });
    return;
  }
  await replaceCallbackMessage(ctx, text, keyboard);
});

export default composer;
