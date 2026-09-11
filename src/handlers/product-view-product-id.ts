import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { categoryTitle, formatPrice, productById } from "../catalog.js";
import { inlineButton, inlineKeyboard } from "../toolkit/index.js";

const composer = new Composer<Ctx>();

composer.callbackQuery(/^product:view:([^:]+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const product = await productById(ctx, ctx.match[1]);
  if (!product) {
    await ctx.editMessageText("Этот товар больше недоступен. Выберите другой товар в каталоге.", {
      reply_markup: inlineKeyboard([[inlineButton("В главное меню", "menu:main")]]),
    });
    return;
  }
  const text = `${product.title}\n\n${product.short_description}\n\n${formatPrice(product)}${product.photo_file_id_or_url ? "" : "\n\nФото недоступно"}`;
  const markup = inlineKeyboard([
    [inlineButton("Задать вопрос", `inquiry:start:${product.id}`)],
    [inlineButton("К категории", `category:${product.category_id}`)],
    [inlineButton("В главное меню", "menu:main")],
  ]);
  if (product.photo_file_id_or_url) {
    await ctx.replyWithPhoto(product.photo_file_id_or_url, { caption: text, reply_markup: markup });
  } else {
    await ctx.editMessageText(text, { reply_markup: markup });
  }
});

export default composer;
