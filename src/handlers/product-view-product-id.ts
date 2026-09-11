import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { categoryTitle, formatPrice, productById } from "../catalog.js";
import { inlineButton, inlineKeyboard, isOwner } from "../toolkit/index.js";
import { answerCallback, replaceCallbackMessage } from "../callbacks.js";

const composer = new Composer<Ctx>();

composer.callbackQuery(/^product:view:([^:]+)$/, async (ctx) => {
  await answerCallback(ctx);
  const product = await productById(ctx, ctx.match[1]);
  if (!product) {
    await replaceCallbackMessage(ctx, "Этот товар больше недоступен. Выберите другой товар в каталоге.", inlineKeyboard([[inlineButton("В главное меню", "menu:main")]]));
    return;
  }
  const text = `${product.title}\n\n${product.short_description}\n\n${formatPrice(product)}${product.photo_file_id_or_url ? "" : "\n\nФото недоступно"}`;
  const rows = [
    [inlineButton("Заказать", `order:start:${product.id}`)],
    [inlineButton("Задать вопрос", `inquiry:start:${product.id}`)],
    [inlineButton("К категории", `category:${product.category_id}`)],
    [inlineButton("В главное меню", "menu:main")],
  ];
  if (isOwner(ctx)) rows.splice(2, 0, [inlineButton("Удалить товар", `admin:delete:${product.id}`)]);
  const markup = inlineKeyboard(rows);
  if (product.photo_file_id_or_url) {
    await ctx.replyWithPhoto(product.photo_file_id_or_url, { caption: text, reply_markup: markup });
  } else {
    await replaceCallbackMessage(ctx, text, markup);
  }
});

export default composer;
