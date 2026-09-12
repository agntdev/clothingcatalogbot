import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard } from "../toolkit/index.js";
import { answerCallback, replaceCallbackMessage } from "../callbacks.js";

// /help — plain-language explanation for non-technical users. This bot is
// button-driven: tell the user to tap /start to open the menu rather than listing
// slash commands. The same text is shown when the user taps the Help button on the
// main menu (`menu:help`). Enhance the copy for your specific bot; keep it short.
const composer = new Composer<Ctx>();

const HELP =
  "Нажмите «Меню» и выберите категорию.\n\n" +
  "В карточке товара нажмите «Задать вопрос», чтобы связаться с продавцом.";

const backToMenu = inlineKeyboard([[inlineButton("Главное меню", "menu:main")]]);

composer.command("help", async (ctx) => {
  await ctx.reply(HELP, { reply_markup: backToMenu });
});

composer.callbackQuery("menu:help", async (ctx) => {
  await answerCallback(ctx);
  await replaceCallbackMessage(ctx, HELP, backToMenu);
});

export default composer;
