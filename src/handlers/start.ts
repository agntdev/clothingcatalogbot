import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard, isOwner } from "../toolkit/index.js";
import { now } from "../clock.js";
import { saveUser } from "../catalog.js";
import { answerCallback, replaceCallbackMessage } from "../callbacks.js";

const composer = new Composer<Ctx>();

const MENU_TEXT = "Выберите раздел. Откройте товар и нажмите «Задать вопрос», чтобы связаться с продавцом.";

function menuKeyboard(ctx: Ctx) {
  const rows = [
    [inlineButton("Мужская", "category:male")],
    [inlineButton("Женская", "category:female")],
    [inlineButton("Детская", "category:kids")],
    [inlineButton("Browse All", "category:all")],
  ];
  if (isOwner(ctx)) rows.push([inlineButton("Управление товарами", "admin:open")]);
  return inlineKeyboard(rows);
}

const persistentKeyboard = {
  keyboard: [[{ text: "Меню" }]],
  resize_keyboard: true,
  is_persistent: true,
  input_field_placeholder: "Выберите «Меню» для каталога",
};

function clearPendingInquiry(ctx: Ctx): void {
  ctx.session.inquiryProductId = undefined;
  ctx.session.inquiryStartedAt = undefined;
}

/** Send a durable navigation message rather than replacing product/list cards. */
async function sendMenu(ctx: Ctx): Promise<void> {
  const menu = await ctx.reply(MENU_TEXT, {
    reply_markup: menuKeyboard(ctx),
  });
  // Pinning is a convenience only: private-chat permissions and old clients may
  // reject it, while the reply keyboard remains an always-available fallback.
  if (ctx.chat?.type === "private") {
    try {
      await ctx.api.pinChatMessage(ctx.chat.id, menu.message_id, {
        disable_notification: true,
      });
    } catch {
      // The menu was still sent successfully, so no user-facing error is needed.
    }
  }
}

composer.command("start", async (ctx) => {
  await saveUser(ctx, now());
  await sendMenu(ctx);
  // Keep this control after every navigation step without creating another menu.
  await ctx.reply("Каталог всегда можно открыть кнопкой «Меню».", {
    reply_markup: persistentKeyboard,
  });
});

// A card's menu action must not consume the pinned menu message: send a fresh,
// durable menu in the private chat instead.
composer.callbackQuery("menu:main", async (ctx) => {
  await answerCallback(ctx);
  clearPendingInquiry(ctx);
  await replaceCallbackMessage(ctx, MENU_TEXT, menuKeyboard(ctx));
});

composer.hears("Меню", async (ctx) => {
  clearPendingInquiry(ctx);
  await saveUser(ctx, now());
  await sendMenu(ctx);
});

export default composer;
