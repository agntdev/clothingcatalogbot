import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard, isOwner } from "../toolkit/index.js";
import { now } from "../clock.js";
import { saveUser } from "../catalog.js";
import { answerCallback, replaceCallbackMessage } from "../callbacks.js";
import { resetNavigation } from "../navigation.js";

const composer = new Composer<Ctx>();
export const MENU_TEXT = "Выберите раздел. Откройте товар и нажмите «Задать вопрос», чтобы связаться с продавцом.";

export function mainMenu(ctx: Ctx) {
  const rows = [
    [inlineButton("Мужская", "category:open:male")],
    [inlineButton("Женская", "category:open:female")],
    [inlineButton("Детская", "category:open:kids")],
    [inlineButton("Все товары", "category:list:all:1")],
  ];
  if (isOwner(ctx)) rows.push([inlineButton("Управление каталогом", "admin:open")]);
  return inlineKeyboard(rows);
}

function clearPendingInquiry(ctx: Ctx) { ctx.session.inquiryProductId = undefined; ctx.session.inquiryStartedAt = undefined; }

composer.command("start", async (ctx) => {
  clearPendingInquiry(ctx);
  resetNavigation(ctx);
  await saveUser(ctx, now());
  await ctx.reply(MENU_TEXT, { reply_markup: mainMenu(ctx) });
});

composer.callbackQuery("menu:main", async (ctx) => {
  await answerCallback(ctx);
  clearPendingInquiry(ctx);
  resetNavigation(ctx);
  await replaceCallbackMessage(ctx, MENU_TEXT, mainMenu(ctx));
});

export default composer;
