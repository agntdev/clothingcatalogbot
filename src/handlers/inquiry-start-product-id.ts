import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { formatPrice, markInquirySent, productById, saveInquiry, saveUser, type Inquiry, type Product } from "../catalog.js";
import { now } from "../clock.js";
import { adminChatId, inlineButton, inlineKeyboard, urlButton } from "../toolkit/index.js";
import { answerCallback, replaceCallbackMessage } from "../callbacks.js";

const composer = new Composer<Ctx>();
const FLOW_TTL_MS = 5 * 60 * 1000;
const NOTIFICATION_WAIT_MS = 2_500;

/** Keep an inquiry update responsive if Telegram's admin delivery is slow. */
async function notificationWithinDeadline(task: Promise<boolean>): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      task,
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), NOTIFICATION_WAIT_MS);
      }),
    ]);
  } catch {
    return false;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

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
    `Описание: ${product.short_description}`,
    `Цена: ${formatPrice(product)}`,
    `Сообщение: ${inquiry.message_text || "—"}`,
      `Покупатель: ${inquiry.user_display_name}${inquiry.username ? ` (@${inquiry.username})` : ""} (Telegram ID: ${inquiry.user_id})`,
      "Для ответа используйте кнопку ниже.",
  ].join("\n");
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (product.photo_file_id_or_url) {
        await ctx.api.sendPhoto(admin, product.photo_file_id_or_url, {
          caption: `${product.title}\n${product.price_minor_units / 100} ₽`,
        });
      }
      await ctx.api.sendMessage(admin, text, {
        reply_markup: inlineKeyboard([[urlButton("Ответить покупателю", `tg://user?id=${inquiry.user_id}`)]]),
      });
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
  if (ctx.session.inquirySubmitting) {
    await ctx.reply("Заявка уже отправляется. Подождите немного.");
    return;
  }
  ctx.session.inquirySubmitting = true;
  ctx.session.inquiryProductId = undefined;
  ctx.session.inquiryStartedAt = undefined;
  try {
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
      username: ctx.from.username,
      product_snapshot: {
        title: product.title,
        price_minor_units: product.price_minor_units,
        photo_file_id_or_url: product.photo_file_id_or_url,
        photo_url: product.photo_file_id_or_url,
      },
    };
    await saveUser(ctx, timestamp);
    const saved = await saveInquiry(ctx, inquiry);
    // The record is already durable. Do not hold the update queue for Telegram's
    // network timeout; notifyAdmin continues its bounded retries in the
    // background and marks the record when delivery succeeds.
    const delivered = saved && (await notificationWithinDeadline(notifyAdmin(ctx, inquiry, product)));
    await ctx.reply(
      delivered
        ? "Заявка принята. Продавец свяжется с вами."
        : "Ваша заявка сохранена, но администратор недоступен. Мы свяжемся с вами.",
    );
  } finally {
    ctx.session.inquirySubmitting = undefined;
  }
}

composer.callbackQuery(/^inquiry:start:([^:]+)$/, async (ctx) => {
  await answerCallback(ctx);
  const product = await productById(ctx, ctx.match[1]);
  if (!product) {
    await replaceCallbackMessage(ctx, "Этот товар больше недоступен. Выберите другой товар в каталоге.", inlineKeyboard([[inlineButton("В главное меню", "menu:main")]]));
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

composer.callbackQuery(/^order:start:([^:]+)$/, async (ctx) => {
  await answerCallback(ctx);
  const product = await productById(ctx, ctx.match[1]);
  if (!product) {
    await replaceCallbackMessage(ctx, "Этот товар больше недоступен. Выберите другой товар в каталоге.", inlineKeyboard([[inlineButton("В главное меню", "menu:main")]]));
    return;
  }
  ctx.session.inquiryProductId = product.id;
  ctx.session.inquiryStartedAt = now();
  await finishInquiry(ctx, "");
});

composer.callbackQuery("inquiry:empty", async (ctx) => {
  await answerCallback(ctx);
  await finishInquiry(ctx, "");
});

composer.callbackQuery("inquiry:cancel", async (ctx) => {
  await answerCallback(ctx);
  ctx.session.inquiryProductId = undefined;
  ctx.session.inquiryStartedAt = undefined;
  await ctx.reply("Заявка отменена.");
});

composer.on("message:text", async (ctx, next) => {
  if (!ctx.session.inquiryProductId) return next();
  // Navigation is always available, including while the optional note prompt is
  // open. Do not accidentally send the word "Меню" (or a new /start) as a lead.
  if (ctx.message.text === "Меню" || /^\/start(?:@[A-Za-z0-9_]+)?(?:\s|$)/.test(ctx.message.text)) {
    ctx.session.inquiryProductId = undefined;
    ctx.session.inquiryStartedAt = undefined;
    return next();
  }
  if ((ctx.session.inquiryStartedAt ?? 0) + FLOW_TTL_MS < now()) {
    ctx.session.inquiryProductId = undefined;
    ctx.session.inquiryStartedAt = undefined;
    await ctx.reply("Время для заявки истекло. Откройте товар и попробуйте ещё раз.");
    return;
  }
  await finishInquiry(ctx, ctx.message.text);
});

export default composer;
