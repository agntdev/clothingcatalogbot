import type { InlineKeyboardMarkup } from "./toolkit/index.js";
import type { Ctx } from "./bot.js";

/** Acknowledge callbacks before doing storage or Telegram work. */
export async function answerCallback(ctx: Ctx): Promise<void> {
  try {
    await ctx.answerCallbackQuery();
  } catch {
    // Duplicate or expired callback ids are harmless and must not abort updates.
  }
}

function sourceIsMedia(ctx: Ctx): boolean {
  const message = ctx.callbackQuery?.message;
  return Boolean(message && "photo" in message && message.photo?.length);
}

/** Replace a callback's source safely whether it is text or a product photo. */
export async function replaceCallbackMessage(ctx: Ctx, text: string, replyMarkup?: InlineKeyboardMarkup): Promise<void> {
  try {
    if (sourceIsMedia(ctx)) await ctx.editMessageCaption({ caption: text, reply_markup: replyMarkup });
    else await ctx.editMessageText(text, { reply_markup: replyMarkup });
  } catch (error) {
    const description = error instanceof Error ? error.message : String(error);
    if (description.includes("message is not modified")) return;
    try {
      await ctx.reply(text, replyMarkup ? { reply_markup: replyMarkup } : undefined);
    } catch {
      // Do not let a failed recovery leave an update unhandled.
    }
  }
}
