import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { mainMenuKeyboard } from "../toolkit/index.js";
import { now } from "../clock.js";
import { saveUser } from "../catalog.js";
import { answerCallback, replaceCallbackMessage } from "../callbacks.js";

// The /start handler renders the bot's MAIN MENU — the primary way users operate
// a button-first bot. A feature adds its own button by calling
// `registerMainMenuItem(...)` in its own `src/handlers/<slug>.ts`; this handler
// renders whatever is registered (plus a Help button), so you do NOT edit this
// file to add a feature. Send ONE message — no placeholder line above the menu.
const composer = new Composer<Ctx>();

const WELCOME = "Добро пожаловать в каталог одежды.\nВыберите категорию, откройте товар и отправьте вопрос продавцу.";

composer.command("start", async (ctx) => {
  await saveUser(ctx, now());
  await ctx.reply(WELCOME, { reply_markup: mainMenuKeyboard() });
});

// "Back to menu" — re-render the main menu in place from any sub-view.
composer.callbackQuery("menu:main", async (ctx) => {
  await answerCallback(ctx);
  await replaceCallbackMessage(ctx, WELCOME, mainMenuKeyboard());
});

export default composer;
