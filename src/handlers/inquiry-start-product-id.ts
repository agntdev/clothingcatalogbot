import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { markInquirySent, productById, saveInquiry, saveUser, type Inquiry, type Product } from "../catalog.js";
import { now } from "../clock.js";
import { adminChatId, inlineButton, inlineKeyboard } from "../toolkit/index.js";

const composer = new Composer<Ctx>();
const FLOW_TTL_MS = 5 * 60 * 1000;

function userDisplay(ctx: Ctx): string {
  const from = ctx.from;
  return [from?.first_name, from?.last_name].filter(Boolean).join(" ") || from?.username || "Покупатель";
}

function inquiryId(userId: number, timestamp: number): string {
  return `${userId}-${timestamp}-${crypto.randomUUID()}`;
}

async function notifyAdmin(ctx: Ctx, inquiry: Inquiry, product: Product): Promise<boolean> {
  const admin = adminChatId(ctx as Ctx & { env?: Record<string, unknown> });
  if (!admin || !/^-?\d+$/.test(admin)) return false;
  const text = [
    "Новая заявка по товару",
    `Товар: ${product.title}`,
    `Цена: ${product.price_minor_units / 100} ₽`,
    `Сообщение: ${inquiry.message_text || "—"}`,
    `Покупатель: ${inquiry.user_display_name} (Telegram ID: ${inquiry.user_id})`,
    `Связаться: tg://user?id=${inquiry.user_id}`,
  ].join("\n");
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (product.photo_file_id_or_url) {
        await ctx.api.sendPhoto(admin, product.photo_file_id_or_url, {
          caption: `${product.title}\n${product.price_minor_units / 100} ₽`,
        });
      }
      await ctx.api.sendMessage(admin, text);
      await markInquirySent(ctx, inquiry.id, now());
      return true;
    } catch {
      // The record remains queued. Retries stay within the ten-second delivery budget.
      if (attempt < 2) await new Promise<void>((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }
  return false;
}

async function finishInquiry(ctx: Ctx, message: string) {
  const productId = ctx.session.inquiryProductId;
  ctx.session.inquiryProductId = undefined;
  ctx.session.inquiryStartedAt = undefined;
  if (!productId) return;
  const product = await productById(ctx, productId);
  if (!product || !ctx.from) {
    await ctx.reply("Этот товар больше недоступен. Выберите другой товар в каталоге.");
    return;
  }
  const timestamp = now();
  const inquiry: Inquiry = {
    id: inquiryId(ctx.from.id, timestamp),
    product_id: product.id,
    user_id: ctx.from.id,
    user_display_name: userDisplay(ctx),
    message_text: message.trim(),
    timestamp,
  };
  await saveUser(ctx, timestamp);
  const saved = await saveInquiry(ctx, inquiry);
  const delivered = saved && (await notifyAdmin(ctx, inquiry, product));
  await ctx.reply(
    delivered
      ? "Заявка принята. Продавец свяжется с вами."
      : "Ваша заявка сохранена, но администратор недоступен. Мы свяжемся с вами.",
  );
}

composer.callbackQuery(/^inquiry:start:([^:]+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const product = await productById(ctx, ctx.match[1]);
  if (!product) {
    await ctx.editMessageText("Этот товар больше недоступен. Выберите другой товар в каталоге.", {
      reply_markup: inlineKeyboard([[inlineButton("В главное меню", "menu:main")]]),
    });
    return;
  }
  ctx.session.inquiryProductId = product.id;
  ctx.session.inquiryStartedAt = now();
  await ctx.reply("Напишите сообщение для продавца или нажмите «Отправить без сообщения».", {
    reply_markup: { force_reply: true, input_field_placeholder: "Ваш вопрос о товаре" },
  });
  await ctx.reply("Сообщение необязательно.", {
    reply_markup: inlineKeyboard([[inlineButton("Отправить без сообщения", "inquiry:empty")], [inlineButton("Отмена", "inquiry:cancel")]]),
  });
});

composer.callbackQuery("inquiry:empty", async (ctx) => {
  await ctx.answerCallbackQuery();
  await finishInquiry(ctx, "");
});

composer.callbackQuery("inquiry:cancel", async (ctx) => {
  await ctx.answerCallbackQuery();
  await finishInquiry(ctx, "");
});

composer.on("message:text", async (ctx, next) => {
  if (!ctx.session.inquiryProductId) return next();
  if ((ctx.session.inquiryStartedAt ?? 0) + FLOW_TTL_MS < now()) {
    ctx.session.inquiryProductId = undefined;
    ctx.session.inquiryStartedAt = undefined;
    await ctx.reply("Время для заявки истекло. Откройте товар и попробуйте ещё раз.");
    return;
  }
  await finishInquiry(ctx, ctx.message.text);
});

export default composer;
